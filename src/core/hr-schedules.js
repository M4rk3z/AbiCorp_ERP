export class HrScheduleError extends Error {
  constructor(status, message, details = null) { super(message); this.status = status; this.details = details; }
}

export function control(db, periodId = null, calendarStart = null) {
  const periods = db.prepare(`SELECT p.*,
    (SELECT COUNT(*) FROM hr_schedule_versions v WHERE v.period_id = p.id) AS versions_count,
    (SELECT MAX(version_number) FROM hr_schedule_versions v WHERE v.period_id = p.id AND v.status = 'published') AS published_version
    FROM hr_schedule_periods p ORDER BY p.start_date DESC LIMIT 104`).all();
  const selectedPeriod = periodId
    ? periods.find((row) => row.id === Number(periodId))
    : periods.find((row) => row.start_date <= today() && row.end_date >= today()) || periods[0] || null;
  const versions = selectedPeriod ? db.prepare(`SELECT v.*, u.full_name AS published_by_name,
    (SELECT COUNT(*) FROM hr_scheduled_shifts s WHERE s.schedule_version_id = v.id) AS entries_count
    FROM hr_schedule_versions v LEFT JOIN users u ON u.id = v.published_by
    WHERE v.period_id = ? ORDER BY v.version_number DESC`).all(selectedPeriod.id) : [];
  const activeVersion = versions.find((row) => row.status === "draft") || versions.find((row) => row.status === "published") || null;
  const entries = activeVersion ? scheduledEntries(db, activeVersion.id) : [];
  const comparisons = selectedPeriod ? comparePeriod(db, selectedPeriod.id) : [];
  const corrections = db.prepare(`SELECT c.*, e.employee_number, e.full_name AS employee_name,
    u.full_name AS requested_by_name, d.full_name AS decided_by_name
    FROM hr_schedule_corrections c JOIN employees e ON e.id = c.employee_id
    LEFT JOIN users u ON u.id = c.requested_by LEFT JOIN users d ON d.id = c.decided_by
    ORDER BY c.status = 'pending' DESC, c.created_at DESC LIMIT 200`).all();
  const automaticStart = monday(calendarStart || today());
  const automaticEnd = addDays(automaticStart, 6);
  const automaticEntries = workforceSchedule(db, automaticStart, automaticEnd);
  return {
    periods, selectedPeriod, versions, activeVersion, entries, comparisons, corrections,
    automaticRange: { startDate: automaticStart, endDate: automaticEnd },
    automaticEntries,
  };
}

export function createPeriod(db, body, userId) {
  const startDate = requiredDate(body.startDate, "fecha inicial");
  const start = new Date(`${startDate}T00:00:00Z`), weekday = start.getUTCDay();
  if (weekday !== 1) throw new HrScheduleError(400, "El periodo semanal debe comenzar en lunes.");
  const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const endDate = end.toISOString().slice(0, 10);
  try {
    db.exec("BEGIN IMMEDIATE");
    const result = db.prepare("INSERT INTO hr_schedule_periods (start_date, end_date, created_by) VALUES (?, ?, ?)")
      .run(startDate, endDate, userId);
    const id = Number(result.lastInsertRowid);
    const version = db.prepare(`INSERT INTO hr_schedule_versions
      (period_id, version_number, source, notes, created_by) VALUES (?, 1, 'manual', ?, ?)`)
      .run(id, clean(body.notes, 500), userId);
    db.exec("COMMIT");
    return { id, startDate, endDate, versionId: Number(version.lastInsertRowid) };
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    if (String(error.message).includes("UNIQUE")) throw new HrScheduleError(409, "Ya existe un periodo para esa semana.");
    throw error;
  }
}

export function applyDefaultShifts(db, periodId, userId) {
  const { period, version } = editableVersion(db, periodId, "default_shift", userId);
  const people = db.prepare(`SELECT e.id, p.work_shift_id, ws.schedule_json, ws.start_time, ws.end_time,
    ws.work_days, ws.break_minutes FROM employees e JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id WHERE e.status <> 'inactive'`).all();
  let imported = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const person of people) {
      if (!person.work_shift_id) continue;
      const schedule = parsedShift(person);
      for (let offset = 0; offset < 7; offset += 1) {
        const date = addDays(period.start_date, offset), day = DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
        const group = schedule.find((item) => item.days.includes(day));
        if (!group) continue;
        const periods = group.periods.filter((item) => validTime(item.start) && validTime(item.end));
        if (!periods.length) continue;
        const breakMinutes = periods.length > 1 ? Math.max(0, timeValue(periods[1].start) - timeValue(periods[0].end)) : Number(person.break_minutes || 0);
        upsertScheduled(db, version.id, { employeeId: person.id, workDate: date,
          startTime: periods[0].start, endTime: periods.at(-1).end, breakMinutes,
          workShiftId: person.work_shift_id, isDayOff: 0, notes: "Turno predeterminado" });
        imported += 1;
      }
    }
    db.exec("COMMIT");
    return { periodId: period.id, versionId: version.id, imported };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function copyPreviousWeek(db, periodId, userId) {
  const period = requirePeriod(db, periodId), previousStart = addDays(period.start_date, -7);
  const previous = db.prepare(`SELECT v.id FROM hr_schedule_versions v JOIN hr_schedule_periods p ON p.id = v.period_id
    WHERE p.start_date = ? AND v.status = 'published' ORDER BY v.version_number DESC LIMIT 1`).get(previousStart);
  if (!previous) throw new HrScheduleError(409, "No existe una versión publicada en la semana anterior.");
  const editable = editableVersion(db, period.id, "previous_week", userId).version;
  const rows = db.prepare("SELECT * FROM hr_scheduled_shifts WHERE schedule_version_id = ? ORDER BY id").all(previous.id);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) upsertScheduled(db, editable.id, {
      employeeId: row.employee_id, workDate: addDays(row.work_date, 7), startTime: row.start_time,
      endTime: row.end_time, breakMinutes: row.break_minutes, workShiftId: row.work_shift_id,
      isDayOff: row.is_day_off, notes: "Copiado de la semana anterior",
    });
    db.prepare("UPDATE hr_schedule_versions SET copied_from_version_id = ?, source = 'previous_week' WHERE id = ?")
      .run(previous.id, editable.id);
    db.exec("COMMIT");
    return { periodId: period.id, versionId: editable.id, imported: rows.length };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function saveScheduledEntry(db, versionId, body) {
  const version = requireDraft(db, versionId), period = requirePeriod(db, version.period_id);
  const employeeId = existingEmployee(db, body.employeeId || employeeByNumber(db, body.employeeNumber));
  const workDate = requiredDate(body.workDate, "fecha programada");
  if (workDate < period.start_date || workDate > period.end_date) throw new HrScheduleError(400, "La fecha no pertenece al periodo.");
  const isDayOff = flag(body.isDayOff), startTime = optionalTime(body.startTime), endTime = optionalTime(body.endTime);
  if (!isDayOff && (!startTime || !endTime)) throw new HrScheduleError(400, "Captura entrada y salida programadas.");
  upsertScheduled(db, version.id, { employeeId, workDate, startTime, endTime,
    breakMinutes: integer(body.breakMinutes || 0, 0, 1440, "descanso"), workShiftId: body.workShiftId || null,
    isDayOff, notes: clean(body.notes, 500) });
  return { versionId: version.id, employeeId, workDate };
}

export function publishVersion(db, versionId, userId) {
  const version = requireDraft(db, versionId);
  const count = db.prepare("SELECT COUNT(*) AS value FROM hr_scheduled_shifts WHERE schedule_version_id = ?").get(version.id).value;
  if (!count) throw new HrScheduleError(409, "No se puede publicar una versión sin horarios.");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("UPDATE hr_schedule_versions SET status = 'superseded' WHERE period_id = ? AND status = 'published'").run(version.period_id);
    db.prepare(`UPDATE hr_schedule_versions SET status = 'published', published_by = ?,
      published_at = CURRENT_TIMESTAMP WHERE id = ?`).run(userId, version.id);
    db.exec("COMMIT");
    return { id: version.id, status: "published", entries: Number(count) };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export async function importSchedule(db, periodId, body, userId) {
  const format = importFormat(body.originalName), rows = await tabularRows(body.contentBase64, format);
  const { period, version } = editableVersion(db, periodId, format, userId);
  return importRows(db, { rows, format, originalName: body.originalName, type: "scheduled", userId }, (row) => {
    const employeeId = existingEmployee(db, employeeByNumber(db, row.employee_number));
    const workDate = requiredDate(row.date, "fecha");
    if (workDate < period.start_date || workDate > period.end_date) throw new Error("fecha fuera del periodo");
    const isDayOff = flag(row.day_off), startTime = optionalTime(row.start), endTime = optionalTime(row.end);
    if (!isDayOff && (!startTime || !endTime)) throw new Error("faltan entrada o salida programadas");
    upsertScheduled(db, version.id, { employeeId, workDate, startTime, endTime,
      breakMinutes: integer(row.break_minutes || 0, 0, 1440, "descanso"), workShiftId: null,
      isDayOff, notes: clean(row.notes, 500) });
  }, { versionId: version.id });
}

export function captureActual(db, body, userId, source = "manual", importBatchId = null) {
  const employeeId = existingEmployee(db, body.employeeId || employeeByNumber(db, body.employeeNumber));
  const workDate = requiredDate(body.workDate || body.date, "fecha real");
  const current = db.prepare("SELECT id FROM hr_actual_shift_versions WHERE employee_id = ? AND work_date = ? AND is_current = 1")
    .get(employeeId, workDate);
  if (current && source !== "correction") throw new HrScheduleError(409, "Ya existe un horario real; solicita una corrección para conservar el historial.");
  const start = optionalTime(body.actualStart || body.start), end = optionalTime(body.actualEnd || body.end);
  if (!start && !end) throw new HrScheduleError(400, "Captura al menos una hora real.");
  const nextVersion = Number(db.prepare("SELECT MAX(version_number) AS value FROM hr_actual_shift_versions WHERE employee_id = ? AND work_date = ?")
    .get(employeeId, workDate).value || 0) + 1;
  if (current) db.prepare("UPDATE hr_actual_shift_versions SET is_current = 0 WHERE id = ?").run(current.id);
  const result = db.prepare(`INSERT INTO hr_actual_shift_versions
    (employee_id, work_date, actual_start, actual_end, break_minutes, source, version_number,
     replaces_actual_id, import_batch_id, reason, created_by, approved_by, approved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? IS NULL THEN NULL ELSE CURRENT_TIMESTAMP END)`)
    .run(employeeId, workDate, start, end, integer(body.breakMinutes || body.break_minutes || 0, 0, 1440, "descanso"),
      source, nextVersion, current?.id || null, importBatchId, clean(body.reason, 800), userId,
      source === "correction" ? userId : null, source === "correction" ? userId : null);
  return { id: Number(result.lastInsertRowid), employeeId, workDate, versionNumber: nextVersion };
}

export async function importActual(db, body, userId) {
  const format = importFormat(body.originalName), rows = await tabularRows(body.contentBase64, format);
  return importRows(db, { rows, format, originalName: body.originalName, type: "actual", userId },
    (row, batchId) => captureActual(db, { employeeNumber: row.employee_number, date: row.date,
      start: row.start, end: row.end, break_minutes: row.break_minutes, reason: row.reason || "Importación" }, userId, format, batchId));
}

export function requestCorrection(db, body, userId) {
  const employeeId = existingEmployee(db, body.employeeId);
  const workDate = requiredDate(body.workDate, "fecha");
  const current = db.prepare("SELECT id FROM hr_actual_shift_versions WHERE employee_id = ? AND work_date = ? AND is_current = 1")
    .get(employeeId, workDate);
  const reason = clean(body.reason, 800); if (reason.length < 5) throw new HrScheduleError(400, "Captura el motivo de la corrección.");
  const proposedStart = optionalTime(body.proposedStart), proposedEnd = optionalTime(body.proposedEnd);
  if (!proposedStart && !proposedEnd) throw new HrScheduleError(400, "Captura al menos una hora propuesta.");
  const result = db.prepare(`INSERT INTO hr_schedule_corrections
    (employee_id, work_date, current_actual_id, proposed_start, proposed_end, proposed_break_minutes, reason, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(employeeId, workDate, current?.id || null, proposedStart, proposedEnd,
      integer(body.proposedBreakMinutes || 0, 0, 1440, "descanso"), reason, userId);
  return { id: Number(result.lastInsertRowid), status: "pending" };
}

export function correctionAction(db, id, body, userId) {
  const correction = db.prepare("SELECT * FROM hr_schedule_corrections WHERE id = ?").get(positiveId(id));
  if (!correction) throw new HrScheduleError(404, "Corrección no encontrada.");
  if (correction.status !== "pending") throw new HrScheduleError(409, "La corrección ya fue atendida.");
  const action = ["approve", "reject"].includes(body.action) ? body.action : null;
  if (!action) throw new HrScheduleError(400, "Selecciona una decisión válida.");
  const reason = clean(body.reason, 800); if (reason.length < 5) throw new HrScheduleError(400, "Captura el motivo de la decisión.");
  db.exec("BEGIN IMMEDIATE");
  try {
    if (action === "approve") captureActual(db, { employeeId: correction.employee_id, workDate: correction.work_date,
      actualStart: correction.proposed_start, actualEnd: correction.proposed_end,
      breakMinutes: correction.proposed_break_minutes, reason: correction.reason }, userId, "correction");
    db.prepare(`UPDATE hr_schedule_corrections SET status = ?, decided_by = ?, decision_reason = ?,
      decided_at = CURRENT_TIMESTAMP WHERE id = ?`).run(action === "approve" ? "approved" : "rejected", userId, reason, correction.id);
    db.exec("COMMIT");
    return { id: correction.id, status: action === "approve" ? "approved" : "rejected" };
  } catch (error) { db.exec("ROLLBACK"); throw error; }
}

export function employeeSchedule(db, employeeId, startDate = monday(today()), endDate = addDays(monday(today()), 34)) {
  const id = existingEmployee(db, employeeId);
  return workforceSchedule(db, requiredDate(startDate, "fecha inicial"), requiredDate(endDate, "fecha final"), [id]);
}

export function workforceSchedule(db, startDate, endDate, employeeIds = null) {
  const start = requiredDate(startDate, "fecha inicial"), end = requiredDate(endDate, "fecha final");
  if (end < start) throw new HrScheduleError(400, "El rango del calendario tiene fechas invertidas.");
  if (daysBetween(start, end) > 62) throw new HrScheduleError(400, "El calendario automático admite hasta 63 días por consulta.");
  const requestedIds = Array.isArray(employeeIds) && employeeIds.length
    ? employeeIds.map((id) => positiveId(id)) : null;
  const filter = requestedIds ? ` AND e.id IN (${requestedIds.map(() => "?").join(",")})` : "";
  const people = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.status,
    p.work_shift_id, ws.name AS shift_name, ws.schedule_json, ws.start_time, ws.end_time,
    ws.work_days, ws.break_minutes
    FROM employees e LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    WHERE e.status <> 'inactive'${filter} ORDER BY e.full_name`).all(...(requestedIds || []));
  if (!people.length) return [];
  const ids = people.map((person) => Number(person.id));
  const placeholders = ids.map(() => "?").join(",");
  const published = db.prepare(`SELECT s.*, v.version_number FROM hr_scheduled_shifts s
    JOIN hr_schedule_versions v ON v.id = s.schedule_version_id
    WHERE s.employee_id IN (${placeholders}) AND s.work_date BETWEEN ? AND ? AND v.status = 'published'
      AND NOT EXISTS (SELECT 1 FROM hr_schedule_versions newer WHERE newer.period_id = v.period_id
        AND newer.status = 'published' AND newer.version_number > v.version_number)`).all(...ids, start, end);
  const actual = db.prepare(`SELECT * FROM hr_actual_shift_versions
    WHERE employee_id IN (${placeholders}) AND work_date BETWEEN ? AND ? AND is_current = 1`).all(...ids, start, end);
  const leaves = db.prepare(`SELECT id, folio, employee_id, leave_type, subtype, start_date, end_date,
    total_hours, working_days FROM hr_leave_requests
    WHERE employee_id IN (${placeholders}) AND status = 'approved' AND start_date <= ? AND end_date >= ?
    ORDER BY start_date, id`).all(...ids, end, start);
  const holidays = db.prepare(`SELECT holiday_date, name FROM hr_holidays
    WHERE is_active = 1 AND holiday_date BETWEEN ? AND ? ORDER BY holiday_date`).all(start, end);
  const publishedByKey = new Map(published.map((row) => [`${row.employee_id}:${row.work_date}`, row]));
  const actualByKey = new Map(actual.map((row) => [`${row.employee_id}:${row.work_date}`, row]));
  const holidayByDate = new Map(holidays.map((row) => [row.holiday_date, row]));
  const result = [];
  for (const person of people) {
    const shift = parsedShift(person);
    for (let offset = 0; offset <= daysBetween(start, end); offset += 1) {
      const workDate = addDays(start, offset), key = `${person.id}:${workDate}`;
      const publishedEntry = publishedByKey.get(key);
      const dayKey = DAY_KEYS[new Date(`${workDate}T00:00:00Z`).getUTCDay()];
      const group = shift.find((item) => item.days.includes(dayKey));
      const periods = (group?.periods || []).filter((item) => validTime(item.start) && validTime(item.end));
      const base = publishedEntry ? {
        start: publishedEntry.start_time, end: publishedEntry.end_time,
        breakMinutes: Number(publishedEntry.break_minutes || 0), isDayOff: Boolean(publishedEntry.is_day_off),
        versionNumber: Number(publishedEntry.version_number || 0), source: "published",
      } : {
        start: periods[0]?.start || null, end: periods.at(-1)?.end || null,
        breakMinutes: periods.length > 1
          ? Math.max(0, timeValue(periods[1].start) - timeValue(periods[0].end))
          : Number(person.break_minutes || 0),
        isDayOff: !periods.length, versionNumber: null, source: "automatic",
      };
      const holiday = holidayByDate.get(workDate);
      const leave = leaves.find((row) => Number(row.employee_id) === Number(person.id)
        && row.start_date <= workDate && row.end_date >= workDate);
      const partialLeave = Boolean(leave && Number(leave.total_hours || 0) > 0
        && leave.start_date === leave.end_date && !base.isDayOff && !holiday);
      let calendarStatus = base.isDayOff ? "rest" : "scheduled", eventLabel = "";
      let effectiveDayOff = base.isDayOff;
      if (holiday) {
        calendarStatus = "holiday"; eventLabel = holiday.name; effectiveDayOff = true;
      } else if (leave && !base.isDayOff) {
        calendarStatus = leave.leave_type;
        eventLabel = leaveLabel(leave.leave_type, leave.subtype);
        effectiveDayOff = !partialLeave;
      }
      const actualEntry = actualByKey.get(key);
      const row = comparisonValues({
        employee_id: Number(person.id), employee_number: person.employee_number,
        employee_name: person.full_name, shift_name: person.shift_name || "Sin turno asignado",
        work_date: workDate, scheduled_start: base.start, scheduled_end: base.end,
        scheduled_break: base.breakMinutes, is_day_off: effectiveDayOff ? 1 : 0,
        version_number: base.versionNumber, actual_start: actualEntry?.actual_start || null,
        actual_end: actualEntry?.actual_end || null, actual_break: actualEntry?.break_minutes || 0,
        actual_version: actualEntry?.version_number || null,
      });
      result.push({ ...row, calendar_status: calendarStatus, event_label: eventLabel,
        schedule_source: base.source, base_is_day_off: base.isDayOff ? 1 : 0,
        holiday_name: holiday?.name || null, leave_id: leave?.id || null,
        leave_folio: leave?.folio || null, leave_type: leave?.leave_type || null,
        absence_hours: partialLeave ? Number(leave.total_hours || 0) : 0 });
    }
  }
  return result;
}

function comparePeriod(db, periodId) {
  const version = db.prepare(`SELECT id FROM hr_schedule_versions WHERE period_id = ? AND status = 'published'
    ORDER BY version_number DESC LIMIT 1`).get(periodId);
  if (!version) return [];
  return db.prepare(`SELECT s.*, e.employee_number, e.full_name AS employee_name,
    a.id AS actual_id, a.actual_start, a.actual_end, a.break_minutes AS actual_break,
    a.version_number AS actual_version FROM hr_scheduled_shifts s JOIN employees e ON e.id = s.employee_id
    LEFT JOIN hr_actual_shift_versions a ON a.employee_id = s.employee_id AND a.work_date = s.work_date AND a.is_current = 1
    WHERE s.schedule_version_id = ? ORDER BY s.work_date, e.full_name`).all(version.id).map(comparisonValues);
}

function comparisonValues(row) {
  const scheduledMinutes = row.is_day_off ? 0 : duration(row.start_time || row.scheduled_start, row.end_time || row.scheduled_end, row.break_minutes ?? row.scheduled_break);
  const actualMinutes = duration(row.actual_start, row.actual_end, row.actual_break);
  return { ...row, scheduled_minutes: scheduledMinutes, actual_minutes: actualMinutes,
    variance_minutes: actualMinutes == null ? null : actualMinutes - scheduledMinutes };
}

function scheduledEntries(db, versionId) {
  return db.prepare(`SELECT s.*, e.employee_number, e.full_name AS employee_name FROM hr_scheduled_shifts s
    JOIN employees e ON e.id = s.employee_id WHERE s.schedule_version_id = ? ORDER BY s.work_date, e.full_name`).all(versionId);
}

function editableVersion(db, periodId, source, userId) {
  const period = requirePeriod(db, periodId);
  let version = db.prepare("SELECT * FROM hr_schedule_versions WHERE period_id = ? AND status = 'draft' ORDER BY version_number DESC LIMIT 1").get(period.id);
  if (!version) {
    const number = Number(db.prepare("SELECT MAX(version_number) AS value FROM hr_schedule_versions WHERE period_id = ?").get(period.id).value || 0) + 1;
    const result = db.prepare(`INSERT INTO hr_schedule_versions
      (period_id, version_number, source, created_by) VALUES (?, ?, ?, ?)`).run(period.id, number, source, userId);
    version = db.prepare("SELECT * FROM hr_schedule_versions WHERE id = ?").get(Number(result.lastInsertRowid));
  }
  return { period, version };
}

function upsertScheduled(db, versionId, row) {
  db.prepare(`INSERT INTO hr_scheduled_shifts
    (schedule_version_id, employee_id, work_date, start_time, end_time, break_minutes, work_shift_id, is_day_off, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(schedule_version_id, employee_id, work_date) DO UPDATE SET start_time = excluded.start_time,
      end_time = excluded.end_time, break_minutes = excluded.break_minutes, work_shift_id = excluded.work_shift_id,
      is_day_off = excluded.is_day_off, notes = excluded.notes, updated_at = CURRENT_TIMESTAMP`)
    .run(versionId, row.employeeId, row.workDate, row.startTime || null, row.endTime || null,
      Number(row.breakMinutes || 0), row.workShiftId || null, flag(row.isDayOff), row.notes || "");
}

async function importRows(db, options, handler, extra = {}) {
  const errors = [], batch = db.prepare(`INSERT INTO hr_schedule_import_batches
    (import_type, source_format, original_name, rows_received, created_by) VALUES (?, ?, ?, ?, ?)`)
    .run(options.type, options.format, clean(options.originalName, 240), options.rows.length, options.userId);
  const batchId = Number(batch.lastInsertRowid); let imported = 0;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (let index = 0; index < options.rows.length; index += 1) {
      try { handler(normalizeRow(options.rows[index]), batchId); imported += 1; }
      catch (error) { errors.push({ row: index + 2, error: error.message }); }
    }
    db.prepare("UPDATE hr_schedule_import_batches SET rows_imported = ?, errors_json = ? WHERE id = ?")
      .run(imported, JSON.stringify(errors.slice(0, 200)), batchId);
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  if (!imported) throw new HrScheduleError(400, "No se pudo importar ninguna fila.", errors);
  return { batchId, imported, errors, ...extra };
}

async function tabularRows(base64, format) {
  let bytes;
  try { bytes = Buffer.from(String(base64 || ""), "base64"); } catch { throw new HrScheduleError(400, "Archivo inválido."); }
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new HrScheduleError(413, "El archivo debe pesar entre 1 byte y 8 MB.");
  if (format === "csv") return csvRows(bytes.toString("utf8"));
  const imported = await import("xlsx");
  const XLSX = imported.default || imported;
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: false, dense: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

function csvRows(text) {
  const rows = []; let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field); if (row.some((value) => value.trim())) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field); if (row.some((value) => value.trim())) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map((value) => key(value));
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function normalizeRow(row) { return Object.fromEntries(Object.entries(row).map(([name, value]) => [key(name), String(value ?? "").trim()])); }
function key(value) { return String(value || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function importFormat(name) { const lower = String(name || "").toLowerCase(); if (lower.endsWith(".csv")) return "csv"; if (lower.endsWith(".xlsx")) return "xlsx"; throw new HrScheduleError(400, "Utiliza un archivo CSV o XLSX."); }
function requirePeriod(db, id) { const row = db.prepare("SELECT * FROM hr_schedule_periods WHERE id = ?").get(positiveId(id)); if (!row) throw new HrScheduleError(404, "Periodo no encontrado."); return row; }
function requireDraft(db, id) { const row = db.prepare("SELECT * FROM hr_schedule_versions WHERE id = ?").get(positiveId(id)); if (!row) throw new HrScheduleError(404, "Versión no encontrada."); if (row.status !== "draft") throw new HrScheduleError(409, "Una versión publicada es inmutable; crea una nueva versión."); return row; }
function employeeByNumber(db, value) { return db.prepare("SELECT id FROM employees WHERE employee_number = ? AND status <> 'inactive'").get(String(value || "").trim())?.id; }
function existingEmployee(db, id) { const value = positiveId(id); if (!db.prepare("SELECT id FROM employees WHERE id = ? AND status <> 'inactive'").get(value)) throw new HrScheduleError(404, "Colaborador no encontrado o inactivo."); return value; }
function parsedShift(row) { try { const value = JSON.parse(row.schedule_json || "[]"); if (Array.isArray(value) && value.length) return value; } catch {} return [{ days: String(row.work_days || "").split(",").filter(Boolean), periods: [{ start: row.start_time, end: row.end_time }] }]; }
function duration(start, end, breakMinutes = 0) { if (!validTime(start) || !validTime(end)) return null; let value = timeValue(end) - timeValue(start); if (value <= 0) value += 1440; return Math.max(0, value - Number(breakMinutes || 0)); }
function timeValue(value) { const [hour, minute] = String(value).split(":").map(Number); return hour * 60 + minute; }
function optionalTime(value) { const cleanValue = String(value || "").trim(); if (!cleanValue) return null; if (!validTime(cleanValue)) throw new HrScheduleError(400, `Hora inválida: ${cleanValue}.`); return cleanValue; }
function validTime(value) { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value || "")); }
function requiredDate(value, label) { const cleanValue = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(cleanValue) || Number.isNaN(Date.parse(`${cleanValue}T00:00:00Z`))) throw new HrScheduleError(400, `Captura una ${label} válida.`); return cleanValue; }
function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function monday(date) { const value = requiredDate(date, "fecha del calendario"); const weekday = new Date(`${value}T00:00:00Z`).getUTCDay(); return addDays(value, weekday === 0 ? -6 : 1 - weekday); }
function daysBetween(start, end) { return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000); }
function leaveLabel(type, subtype) { const label = ({ vacation: "Vacaciones", permission: "Permiso", incapacity: "Incapacidad" })[type] || "Ausencia"; return subtype ? `${label} · ${subtype}` : label; }
function integer(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new HrScheduleError(400, `El ${label} no es válido.`); return number; }
function positiveId(value) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new HrScheduleError(400, "Identificador no válido."); return number; }
function flag(value) { return value === true || value === 1 || value === "1" || value === "true" ? 1 : 0; }
function clean(value, max) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, max); }
function today() { return new Date().toISOString().slice(0, 10); }
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export class HrError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function options(db) {
  syncVacationPlans(db);
  return {
    employees: db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.area_id, e.status,
      p.employment_type, p.vacation_balance, p.vacation_debt,
      p.vacation_balance - p.vacation_debt AS vacation_available,
      p.vacation_cycle_year, vp.name AS vacation_plan_name, vp.annual_days AS vacation_plan_days
      FROM employees e
      LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
      LEFT JOIN hr_vacation_plans vp ON vp.id = p.vacation_plan_id
      ORDER BY e.full_name`).all(),
    areas: db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1 ORDER BY name").all(),
    jobPositions: db.prepare("SELECT * FROM hr_job_positions WHERE is_active = 1 ORDER BY name").all(),
    workShifts: db.prepare("SELECT * FROM hr_work_shifts WHERE is_active = 1 ORDER BY name").all(),
    vacationPlans: db.prepare("SELECT * FROM hr_vacation_plans WHERE is_active = 1 ORDER BY annual_days, name").all(),
  };
}

export function control(db) {
  syncVacationPlans(db);
  const people = db.prepare(`SELECT e.*, a.name AS area_name, p.employment_type, p.shift, p.work_schedule,
    p.emergency_contact, p.emergency_phone, p.vacation_balance, p.notes AS profile_notes,
    p.vacation_debt, p.vacation_balance - p.vacation_debt AS vacation_available,
    p.vacation_cycle_year, p.vacation_renewed_at,
    p.photo_filename, p.photo_mime, p.photo_original_name, p.work_shift_id, p.vacation_plan_id,
    p.contract_end_date, p.organization_name, p.organization_details, p.organization_contact_name,
    p.organization_contact_phone, p.organization_contact_email, p.advisor_name, p.advisor_phone,
    p.advisor_email, p.service_start_date, p.service_end_date, p.required_service_hours,
    jp.name AS job_position_name, ws.name AS shift_name, ws.start_time AS shift_start_time,
    ws.end_time AS shift_end_time, ws.work_days AS shift_work_days, ws.break_minutes AS shift_break_minutes,
    ws.schedule_json AS shift_schedule_json,
    vp.name AS vacation_plan_name, vp.annual_days AS vacation_plan_days
    FROM employees e
    LEFT JOIN areas a ON a.id = e.area_id
    LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN hr_job_positions jp ON jp.id = e.position_id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    LEFT JOIN hr_vacation_plans vp ON vp.id = p.vacation_plan_id
    ORDER BY e.status = 'active' DESC, e.full_name`).all();
  const leaves = db.prepare(`SELECT l.*, e.employee_number, e.full_name AS employee_name, i.folio AS incident_folio
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    LEFT JOIN safety_incidents i ON i.id = l.safety_incident_id ORDER BY l.created_at DESC, l.id DESC`).all();
  const attendance = db.prepare(`SELECT a.*, e.employee_number, e.full_name AS employee_name
    FROM hr_attendance a JOIN employees e ON e.id = a.employee_id ORDER BY a.occurred_at DESC, a.id DESC LIMIT 200`).all();
  for (const person of people) {
    person.service_total_days = serviceDayCount(person.service_start_date, person.service_end_date);
    person.planned_service_hours = plannedShiftHours(person, person.service_start_date, person.service_end_date);
    const elapsedServiceEnd = person.service_start_date && today() >= person.service_start_date
      ? (person.service_end_date && today() > person.service_end_date ? person.service_end_date : today())
      : null;
    person.completed_service_hours = Math.min(Number(person.required_service_hours || 0),
      plannedShiftHours(person, person.service_start_date, elapsedServiceEnd));
    person.remaining_service_hours = Math.max(0,
      Math.round((Number(person.required_service_hours || 0) - person.completed_service_hours) * 100) / 100);
    person.service_progress_percent = Number(person.required_service_hours || 0) > 0
      ? Math.min(100, Math.round(person.completed_service_hours / Number(person.required_service_hours) * 100))
      : 0;
  }
  const currentMonth = today().slice(0, 7);
  const activePeople = people.filter((row) => row.status === "active").length;
  const staffEntriesMonth = people.filter((row) => String(row.hire_date || row.created_at || "").slice(0, 7) === currentMonth).length;
  const staffExitsMonth = people.filter((row) => row.status === "inactive"
    && String(row.updated_at || "").slice(0, 7) === currentMonth).length;
  const turnoverRate = Math.round(staffExitsMonth / Math.max(1, activePeople + staffExitsMonth / 2) * 1000) / 10;
  return {
    people, leaves, attendance,
    indicators: {
      activePeople,
      pendingRequests: leaves.filter((row) => row.status === "submitted").length,
      awayToday: leaves.filter((row) => row.status === "approved" && row.start_date <= today() && row.end_date >= today()).length,
      staffEntriesMonth,
      staffExitsMonth,
      turnoverRate,
    },
  };
}

export function createPerson(db, body) {
  const fullName = requiredText(body.fullName, 180, "El nombre completo");
  const areaId = optionalExistingId(db, "areas", body.areaId, "área");
  const position = optionalCatalogRecord(db, "hr_job_positions", body.positionId, "puesto");
  const employmentType = enumValue(body.employmentType, ["permanent", "temporary", "contractor", "intern"], "permanent");
  const hireDate = optionalDate(body.hireDate);
  const employment = employmentDetails(body, employmentType, hireDate);
  const workShift = employmentType === "contractor" ? null : optionalCatalogRecord(db, "hr_work_shifts", body.workShiftId, "turno");
  const vacationPlan = employmentType === "permanent" ? automaticVacationPlan(db, hireDate) : null;
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO employees
      (employee_number, full_name, email, phone, area_id, position, position_id, hire_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
      .run(placeholder("EMP"), fullName, email(body.email), text(body.phone, 40), areaId,
        position?.name || "", position?.id || null, hireDate);
    const id = Number(result.lastInsertRowid), folio = `E-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE employees SET employee_number = ? WHERE id = ?").run(folio, id);
    db.prepare(`INSERT INTO hr_employee_profiles
      (employee_id, employment_type, shift, work_schedule, work_shift_id, emergency_contact, emergency_phone,
       vacation_balance, vacation_plan_id, notes, contract_end_date, organization_name, organization_details,
       organization_contact_name, organization_contact_phone, organization_contact_email, advisor_name,
       advisor_phone, advisor_email, service_start_date, service_end_date, required_service_hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, employmentType,
        legacyShift(workShift), workShift ? shiftSchedule(workShift) : "", workShift?.id || null,
        text(body.emergencyContact, 180), text(body.emergencyPhone, 40),
        vacationPlan?.annual_days || 0, vacationPlan?.id || null, text(body.notes, 800),
        employment.contractEndDate, employment.organizationName, employment.organizationDetails,
        employment.organizationContactName, employment.organizationContactPhone,
        employment.organizationContactEmail, employment.advisorName, employment.advisorPhone,
        employment.advisorEmail, employment.serviceStartDate, employment.serviceEndDate,
        employment.requiredServiceHours);
    return { id, folio };
  });
}

export function updatePerson(db, id, body) {
  const employeeId = positiveId(id, "empleado");
  const existing = db.prepare(`SELECT e.employee_number, p.vacation_plan_id, p.vacation_balance
    FROM employees e LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id WHERE e.id = ?`).get(employeeId);
  if (!existing) throw new HrError(404, "Trabajador no encontrado.");
  const fullName = requiredText(body.fullName, 180, "El nombre completo");
  const areaId = optionalExistingId(db, "areas", body.areaId, "área");
  const position = optionalCatalogRecord(db, "hr_job_positions", body.positionId, "puesto");
  const employmentType = enumValue(body.employmentType, ["permanent", "temporary", "contractor", "intern"], "permanent");
  const hireDate = optionalDate(body.hireDate);
  const employment = employmentDetails(body, employmentType, hireDate);
  const workShift = employmentType === "contractor" ? null : optionalCatalogRecord(db, "hr_work_shifts", body.workShiftId, "turno");
  const vacationPlan = employmentType === "permanent" ? automaticVacationPlan(db, hireDate) : null;
  const status = enumRequired(body.status, ["active", "leave", "inactive"], "estado");
  const vacationPlanId = vacationPlan?.id || null;
  const vacationBalance = employmentType === "permanent"
    ? (Number(existing.vacation_plan_id || 0) === Number(vacationPlanId || 0)
      ? existing.vacation_balance
      : vacationPlan?.annual_days || 0)
    : 0;
  try {
    return transaction(db, () => {
      db.prepare(`UPDATE employees SET full_name = ?, email = ?, phone = ?, area_id = ?, position = ?,
        position_id = ?, hire_date = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(fullName, email(body.email), text(body.phone, 40), areaId, position?.name || "", position?.id || null,
          hireDate, status, employeeId);
      db.prepare(`UPDATE hr_employee_profiles SET employment_type = ?, shift = ?, work_schedule = ?,
        work_shift_id = ?, emergency_contact = ?, emergency_phone = ?, vacation_balance = ?,
        vacation_plan_id = ?, notes = ?, contract_end_date = ?, organization_name = ?,
        organization_details = ?, organization_contact_name = ?, organization_contact_phone = ?,
        organization_contact_email = ?, advisor_name = ?, advisor_phone = ?, advisor_email = ?,
        service_start_date = ?, service_end_date = ?, required_service_hours = ?,
        updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?`)
        .run(employmentType,
          legacyShift(workShift), workShift ? shiftSchedule(workShift) : "", workShift?.id || null,
          text(body.emergencyContact, 180), text(body.emergencyPhone, 40), vacationBalance,
          vacationPlanId, text(body.notes, 800), employment.contractEndDate, employment.organizationName,
          employment.organizationDetails, employment.organizationContactName,
          employment.organizationContactPhone, employment.organizationContactEmail,
          employment.advisorName, employment.advisorPhone, employment.advisorEmail,
          employment.serviceStartDate, employment.serviceEndDate, employment.requiredServiceHours, employeeId);
      return { id: employeeId, folio: existing.employee_number, fullName };
    });
  } catch (error) {
    constraint(error, "El correo electrónico ya está asignado a otro trabajador.");
  }
}

export function personAction(db, id, body) {
  const employeeId = positiveId(id, "empleado");
  const employee = db.prepare("SELECT id, employee_number, full_name, status FROM employees WHERE id = ?").get(employeeId);
  if (!employee) throw new HrError(404, "Trabajador no encontrado.");
  if (body.action !== "deactivate") throw new HrError(400, "La acción solicitada no es válida.");
  if (employee.status === "inactive") throw new HrError(409, "El trabajador ya está dado de baja.");
  db.prepare("UPDATE employees SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(employeeId);
  return { id: employeeId, folio: employee.employee_number, fullName: employee.full_name, status: "inactive" };
}

export function createJobPosition(db, body) {
  const name = requiredText(body.name, 120, "El nombre del puesto");
  try {
    const result = db.prepare("INSERT INTO hr_job_positions (code, name, description) VALUES (?, ?, ?)")
      .run(placeholder("PUE"), name, text(body.description, 500));
    const id = Number(result.lastInsertRowid), folio = `PUE-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_job_positions SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un puesto con ese nombre.");
  }
}

export function updateJobPosition(db, id, body) {
  const recordId = positiveId(id, "puesto");
  const current = db.prepare("SELECT id, code FROM hr_job_positions WHERE id = ? AND is_active = 1").get(recordId);
  if (!current) throw new HrError(404, "Puesto no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del puesto");
  try {
    db.prepare(`UPDATE hr_job_positions SET name = ?, description = ?,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, text(body.description, 500), recordId);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un puesto con ese nombre.");
  }
}

export function createWorkShift(db, body) {
  const name = requiredText(body.name, 120, "El nombre del turno");
  const schedule = weeklySchedule(body);
  const firstPeriod = schedule[0].periods[0];
  const lastPeriod = schedule[0].periods.at(-1);
  const workDays = [...new Set(schedule.flatMap((group) => group.days))];
  const breakMinutes = schedule[0].periods.length > 1
    ? minutesBetween(firstPeriod.end, schedule[0].periods[1].start)
    : integerBetween(body.breakMinutes || 0, 0, 480, "Los minutos de descanso");
  try {
    const result = db.prepare(`INSERT INTO hr_work_shifts
      (code, name, start_time, end_time, work_days, break_minutes, schedule_json) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("TUR"), name, firstPeriod.start, lastPeriod.end, workDays.join(","), breakMinutes, JSON.stringify(schedule));
    const id = Number(result.lastInsertRowid), folio = `TUR-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_work_shifts SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un turno con ese nombre.");
  }
}

export function updateWorkShift(db, id, body) {
  const recordId = positiveId(id, "turno");
  const current = db.prepare("SELECT id, code FROM hr_work_shifts WHERE id = ? AND is_active = 1").get(recordId);
  if (!current) throw new HrError(404, "Turno no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del turno");
  const schedule = weeklySchedule(body);
  const firstPeriod = schedule[0].periods[0];
  const lastPeriod = schedule[0].periods.at(-1);
  const workDays = [...new Set(schedule.flatMap((group) => group.days))];
  const breakMinutes = schedule[0].periods.length > 1
    ? minutesBetween(firstPeriod.end, schedule[0].periods[1].start)
    : integerBetween(body.breakMinutes || 0, 0, 480, "Los minutos de descanso");
  try {
    db.prepare(`UPDATE hr_work_shifts SET name = ?, start_time = ?, end_time = ?, work_days = ?,
      break_minutes = ?, schedule_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, firstPeriod.start, lastPeriod.end, workDays.join(","), breakMinutes,
        JSON.stringify(schedule), recordId);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un turno con ese nombre.");
  }
}

export function createVacationPlan(db, body) {
  const name = requiredText(body.name, 120, "El nombre del plan");
  const annualDays = positiveNumber(body.annualDays, "Los días anuales");
  const minServiceYears = integerBetween(body.minServiceYears || 1, 1, 100, "La antigüedad mínima");
  const maxServiceYears = body.maxServiceYears === "" || body.maxServiceYears == null
    ? null
    : integerBetween(body.maxServiceYears, minServiceYears, 100, "La antigüedad máxima");
  try {
    const result = db.prepare(`INSERT INTO hr_vacation_plans
      (code, name, annual_days, min_service_years, max_service_years, description) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PLV"), name, annualDays, minServiceYears, maxServiceYears, text(body.description, 500));
    const id = Number(result.lastInsertRowid), folio = `PLV-${String(id).padStart(5, "0")}`;
    db.prepare("UPDATE hr_vacation_plans SET code = ? WHERE id = ?").run(folio, id);
    return { id, folio, name };
  } catch (error) {
    constraint(error, "Ya existe un plan de vacaciones con ese nombre.");
  }
}

export function updateVacationPlan(db, id, body) {
  const recordId = positiveId(id, "plan de vacaciones");
  const current = db.prepare("SELECT id, code FROM hr_vacation_plans WHERE id = ? AND is_active = 1").get(recordId);
  if (!current) throw new HrError(404, "Plan de vacaciones no encontrado.");
  const name = requiredText(body.name, 120, "El nombre del plan");
  const annualDays = positiveNumber(body.annualDays, "Los días anuales");
  const minServiceYears = integerBetween(body.minServiceYears || 1, 1, 100, "La antigüedad mínima");
  const maxServiceYears = body.maxServiceYears === "" || body.maxServiceYears == null
    ? null
    : integerBetween(body.maxServiceYears, minServiceYears, 100, "La antigüedad máxima");
  try {
    db.prepare(`UPDATE hr_vacation_plans SET name = ?, annual_days = ?, min_service_years = ?,
      max_service_years = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(name, annualDays, minServiceYears, maxServiceYears, text(body.description, 500), recordId);
    syncVacationPlans(db);
    return { id: recordId, folio: current.code, name };
  } catch (error) {
    constraint(error, "Ya existe un plan de vacaciones con ese nombre.");
  }
}

export function syncVacationPlans(db) {
  const people = db.prepare(`SELECT e.id, e.hire_date, p.employment_type, p.vacation_plan_id,
    p.vacation_balance, p.vacation_debt, p.vacation_cycle_year, p.vacation_renewed_at
    FROM employees e JOIN hr_employee_profiles p ON p.employee_id = e.id`).all();
  const update = db.prepare(`UPDATE hr_employee_profiles
    SET vacation_plan_id = ?, vacation_balance = ?, vacation_debt = ?,
      vacation_cycle_year = ?, vacation_renewed_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE employee_id = ?`);
  for (const person of people) {
    if (person.employment_type !== "permanent") {
      if (person.vacation_plan_id || person.vacation_balance || person.vacation_debt || person.vacation_cycle_year)
        update.run(null, 0, 0, 0, null, person.id);
      continue;
    }
    const years = serviceYears(person.hire_date);
    const plan = automaticVacationPlan(db, person.hire_date);
    const previousCycle = Number(person.vacation_cycle_year || 0);
    let balance = Number(person.vacation_balance || 0);
    let debt = Number(person.vacation_debt || 0);
    let cycle = previousCycle;
    let renewedAt = person.vacation_renewed_at || null;
    if (!plan) {
      balance = 0;
      cycle = 0;
    } else if (years > previousCycle) {
      const renewedNet = Number(plan.annual_days || 0) - debt;
      balance = Math.max(0, renewedNet);
      debt = Math.max(0, -renewedNet);
      cycle = years;
      renewedAt = today();
    }
    if (Number(person.vacation_plan_id || 0) !== Number(plan?.id || 0)
      || Number(person.vacation_balance || 0) !== balance
      || Number(person.vacation_debt || 0) !== debt
      || previousCycle !== cycle
      || String(person.vacation_renewed_at || "") !== String(renewedAt || "")) {
      update.run(plan?.id || null, balance, debt, cycle, renewedAt, person.id);
    }
  }
}

export function createLeave(db, body, userId) {
  const employeeId = positiveId(body.employeeId, "empleado");
  requireRecord(db, "employees", employeeId, "Empleado");
  const leaveType = enumRequired(body.leaveType, ["permission", "vacation", "incapacity"], "tipo de ausencia");
  if (leaveType === "vacation") {
    const profile = db.prepare("SELECT employment_type FROM hr_employee_profiles WHERE employee_id = ?").get(employeeId);
    if (profile?.employment_type !== "permanent") {
      throw new HrError(409, "Las vacaciones solo aplican al personal permanente.");
    }
  }
  const startDate = requiredDate(body.startDate), endDate = requiredDate(body.endDate || body.startDate);
  if (endDate < startDate) throw new HrError(400, "La fecha final no puede ser anterior a la inicial.");
  const totalDays = body.totalDays === "" || body.totalDays == null ? dateDays(startDate, endDate) : nonNegative(body.totalDays, "Los días");
  const prefix = { permission: "PER-", vacation: "VAC-", incapacity: "INA-" }[leaveType];
  const result = db.prepare(`INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason, certificate_number, medical_provider, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("AUS"), employeeId, leaveType, text(body.subtype, 100), startDate, endDate, totalDays,
      nonNegative(body.totalHours || 0, "Las horas"), requiredText(body.reason, 800, "El motivo"),
      text(body.certificateNumber, 120), text(body.medicalProvider, 180), userId);
  const id = Number(result.lastInsertRowid), folio = prefix + String(id).padStart(6, "0");
  db.prepare("UPDATE hr_leave_requests SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function leaveAction(db, id, body, userId) {
  const row = db.prepare("SELECT * FROM hr_leave_requests WHERE id = ?").get(id);
  if (!row) throw new HrError(404, "Solicitud no encontrada.");
  const action = body.action;
  const transitions = {
    approve: [["submitted"], "approved"],
    reject: [["submitted"], "rejected"],
    cancel: [["submitted", "approved"], "cancelled"],
    close: [["approved"], "closed"],
  };
  if (!transitions[action] || !transitions[action][0].includes(row.status)) throw new HrError(409, "La solicitud no admite esa acción.");
  const status = transitions[action][1];
  db.prepare("UPDATE hr_leave_requests SET status = ?, approved_by = CASE WHEN ? IN ('approved','rejected') THEN ? ELSE approved_by END, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, status, userId, id);
  if (status === "approved" && row.start_date <= today() && row.end_date >= today())
    db.prepare("UPDATE employees SET status = 'leave', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.employee_id);
  if (["closed", "cancelled"].includes(status))
    db.prepare("UPDATE employees SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'leave'").run(row.employee_id);
  return { id, folio: row.folio, status };
}

export function createAttendance(db, body, userId) {
  const employeeId = positiveId(body.employeeId, "empleado");
  requireRecord(db, "employees", employeeId, "Empleado");
  const eventType = enumRequired(body.eventType, ["entry", "exit"], "movimiento");
  const occurredAt = body.occurredAt ? dateTime(body.occurredAt) : new Date().toISOString().replace("T", " ").replace("Z", "");
  const last = db.prepare("SELECT event_type, occurred_at FROM hr_attendance WHERE employee_id = ? ORDER BY occurred_at DESC, id DESC LIMIT 1").get(employeeId);
  if (last && last.event_type === eventType && String(last.occurred_at).slice(0, 10) === String(occurredAt).slice(0, 10))
    throw new HrError(409, `La última marcación del día ya es una ${eventType === "entry" ? "entrada" : "salida"}.`);
  const result = db.prepare("INSERT INTO hr_attendance (folio, employee_id, event_type, occurred_at, notes, created_by) VALUES (?, ?, ?, ?, ?, ?)")
    .run(placeholder("ASI"), employeeId, eventType, occurredAt, text(body.notes, 500), userId);
  const id = Number(result.lastInsertRowid), folio = `ASI-${String(id).padStart(6, "0")}`;
  db.prepare("UPDATE hr_attendance SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

function requireRecord(db, table, id, label) { if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new HrError(404, `${label} no encontrado.`); }
function optionalExistingId(db, table, value, label) { if (value == null || value === "") return null; const id = positiveId(value, label); requireRecord(db, table, id, label); return id; }
function optionalCatalogRecord(db, table, value, label) {
  if (value == null || value === "") return null;
  const id = positiveId(value, label);
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND is_active = 1`).get(id);
  if (!row) throw new HrError(404, `${label[0].toUpperCase() + label.slice(1)} no encontrado o inactivo.`);
  return row;
}
function positiveId(value, label) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new HrError(400, `Selecciona un ${label} válido.`); return n; }
function requiredText(value, max, label) { const valueText = text(value, max); if (!valueText) throw new HrError(400, `${label} es obligatorio.`); return valueText; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function email(value) { const valueText = text(value, 180); if (valueText && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(valueText)) throw new HrError(400, "El correo no es válido."); return valueText; }
function enumRequired(value, allowed, label) { if (!allowed.includes(value)) throw new HrError(400, `Selecciona un ${label} válido.`); return value; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function requiredDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new HrError(400, "La fecha no es válida."); return String(value); }
function optionalDate(value) { return value ? requiredDate(value) : null; }
function dateTime(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new HrError(400, "La fecha y hora no son válidas."); return date.toISOString().replace("T", " ").replace("Z", ""); }
function nonNegative(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new HrError(400, `${label} no es válido.`); return Math.round(n * 100) / 100; }
function positiveNumber(value, label) { const number = nonNegative(value, label); if (number <= 0) throw new HrError(400, `${label} debe ser mayor que cero.`); return number; }
function integerBetween(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new HrError(400, `${label} no es válido.`);
  return number;
}
function timeValue(value, label) {
  const result = String(value || "");
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(result)) throw new HrError(400, `${label} no es válida.`);
  return result;
}
function workDayValues(value) {
  const allowed = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  if (!Array.isArray(value)) throw new HrError(400, "Selecciona al menos un día laboral.");
  const selected = allowed.filter((day) => value.includes(day));
  if (!selected.length || selected.length !== new Set(value).size) throw new HrError(400, "Los días laborales no son válidos.");
  return selected;
}
function weeklySchedule(body) {
  if (!Array.isArray(body.scheduleGroups) || !body.scheduleGroups.length) {
    return [{
      days: workDayValues(body.workDays),
      periods: [{
        start: timeValue(body.startTime, "La hora de inicio"),
        end: timeValue(body.endTime, "La hora de salida"),
      }],
    }];
  }
  if (body.scheduleGroups.length > 7) throw new HrError(400, "El turno no puede tener más de siete grupos de horario.");
  const usedDays = new Set();
  return body.scheduleGroups.map((group, groupIndex) => {
    const days = workDayValues(group?.days);
    for (const day of days) {
      if (usedDays.has(day)) throw new HrError(400, "Cada día solo puede pertenecer a un horario del turno.");
      usedDays.add(day);
    }
    if (!Array.isArray(group?.periods) || !group.periods.length || group.periods.length > 2)
      throw new HrError(400, `El horario ${groupIndex + 1} debe tener uno o dos bloques.`);
    const periods = group.periods.map((period, periodIndex) => {
      const start = timeValue(period?.start, `La entrada ${periodIndex + 1} del horario ${groupIndex + 1}`);
      const end = timeValue(period?.end, `La salida ${periodIndex + 1} del horario ${groupIndex + 1}`);
      if (start === end) throw new HrError(400, "La entrada y salida de un bloque no pueden ser iguales.");
      return { start, end };
    });
    if (periods.length === 2) {
      if (periods[0].end > periods[1].start)
        throw new HrError(400, `El segundo bloque del horario ${groupIndex + 1} debe comenzar después del primero.`);
      if (periods[0].start > periods[0].end || periods[1].start > periods[1].end)
        throw new HrError(400, "Los horarios divididos deben iniciar y terminar el mismo día.");
    }
    return { days, periods };
  });
}
function minutesBetween(start, end) {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  return Math.max(0, Math.min(480, endHour * 60 + endMinute - startHour * 60 - startMinute));
}
function legacyShift(shift) {
  if (!shift) return "day";
  const byCode = { "TUR-00001": "day", "TUR-00002": "evening", "TUR-00003": "night", "TUR-00004": "mixed" };
  if (byCode[shift.code]) return byCode[shift.code];
  const hour = Number(String(shift.start_time).slice(0, 2));
  return hour >= 20 || hour < 5 ? "night" : hour >= 12 ? "evening" : "day";
}
function shiftSchedule(shift) {
  const schedule = parsedSchedule(shift.schedule_json);
  if (schedule.length) return schedule.map((group) => {
    const days = group.days.map((day) => ({ mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" })[day]).filter(Boolean).join(", ");
    return `${days}: ${group.periods.map((period) => `${period.start}–${period.end}`).join(" / ")}`;
  }).join(" · ");
  const labels = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };
  const days = String(shift.work_days || "").split(",").map((day) => labels[day]).filter(Boolean).join(", ");
  return `${days} · ${shift.start_time}–${shift.end_time}`;
}
function parsedSchedule(value) {
  if (!value) return [];
  try {
    const schedule = JSON.parse(value);
    return Array.isArray(schedule) ? schedule : [];
  } catch {
    return [];
  }
}
function dateDays(start, end) { return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1; }
function today() { return new Date().toISOString().slice(0, 10); }
function serviceYears(hireDate) {
  if (!hireDate) return 0;
  const [hireYear, hireMonth, hireDay] = String(hireDate).slice(0, 10).split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = today().split("-").map(Number);
  let years = currentYear - hireYear;
  if (currentMonth < hireMonth || (currentMonth === hireMonth && currentDay < hireDay)) years -= 1;
  return Math.max(0, years);
}
function automaticVacationPlan(db, hireDate) {
  const years = serviceYears(hireDate);
  if (years < 1) return null;
  return db.prepare(`SELECT * FROM hr_vacation_plans
    WHERE is_active = 1 AND min_service_years <= ?
      AND (max_service_years IS NULL OR max_service_years >= ?)
    ORDER BY min_service_years DESC,
      CASE WHEN max_service_years IS NULL THEN 1 ELSE 0 END,
      id DESC
    LIMIT 1`).get(years, years)
    || null;
}
function serviceDayCount(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  return dateDays(startDate, endDate);
}
function plannedShiftHours(person, startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate || !person.work_shift_id) return 0;
  const schedule = parsedSchedule(person.shift_schedule_json);
  const groups = schedule.length ? schedule : [{
    days: String(person.shift_work_days || "").split(",").filter(Boolean),
    periods: [{ start: person.shift_start_time, end: person.shift_end_time }],
  }];
  const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const cursor = new Date(`${startDate}T00:00:00Z`);
  const limit = new Date(`${endDate}T00:00:00Z`);
  let minutes = 0;
  let iterations = 0;
  while (cursor <= limit && iterations < 3660) {
    const day = dayKeys[cursor.getUTCDay()];
    for (const group of groups) {
      if (!Array.isArray(group.days) || !group.days.includes(day)) continue;
      for (const period of Array.isArray(group.periods) ? group.periods : []) {
        if (!period?.start || !period?.end) continue;
        const [startHour, startMinute] = period.start.split(":").map(Number);
        const [endHour, endMinute] = period.end.split(":").map(Number);
        let duration = endHour * 60 + endMinute - (startHour * 60 + startMinute);
        if (duration <= 0) duration += 1440;
        minutes += Math.min(duration, 1440);
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    iterations += 1;
  }
  return Math.round(minutes / 60 * 100) / 100;
}
function employmentDetails(body, employmentType, hireDate) {
  const details = {
    contractEndDate: null,
    organizationName: "",
    organizationDetails: "",
    organizationContactName: "",
    organizationContactPhone: "",
    organizationContactEmail: "",
    advisorName: "",
    advisorPhone: "",
    advisorEmail: "",
    serviceStartDate: null,
    serviceEndDate: null,
    requiredServiceHours: 0,
  };
  if (employmentType === "temporary") {
    details.contractEndDate = requiredDate(body.contractEndDate);
    if (hireDate && details.contractEndDate < hireDate) {
      throw new HrError(400, "La fecha final del contrato no puede ser anterior a la fecha de alta.");
    }
  }
  if (employmentType === "contractor" || employmentType === "intern") {
    details.organizationName = requiredText(body.organizationName, 180,
      employmentType === "contractor" ? "La empresa de procedencia" : "La institución");
    details.organizationDetails = text(body.organizationDetails, 500);
    details.organizationContactName = text(body.organizationContactName, 180);
    details.organizationContactPhone = text(body.organizationContactPhone, 40);
    details.organizationContactEmail = email(body.organizationContactEmail);
    details.serviceStartDate = requiredDate(body.serviceStartDate);
    details.serviceEndDate = requiredDate(body.serviceEndDate);
    if (details.serviceEndDate < details.serviceStartDate) {
      throw new HrError(400, "La fecha final del servicio no puede ser anterior a la fecha inicial.");
    }
  }
  if (employmentType === "intern") {
    details.advisorName = requiredText(body.advisorName, 180, "El asesor");
    details.advisorPhone = text(body.advisorPhone, 40);
    details.advisorEmail = email(body.advisorEmail);
    details.requiredServiceHours = positiveNumber(body.requiredServiceHours, "Las horas requeridas");
  }
  return details;
}
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function constraint(error, message) { if (String(error?.message || "").includes("UNIQUE constraint failed")) throw new HrError(409, message); throw error; }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }

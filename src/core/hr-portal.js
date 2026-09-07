import { createOpaqueToken, hashPassword, hashToken, verifyPassword } from "./security.js";
import * as hrSchedules from "./hr-schedules.js";

export class HrPortalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const GENERIC_LOGIN_ERROR = "El ID laboral o PIN no es correcto, o el acceso no est\u00e1 disponible.";

export function publicStatus(db) {
  const settings = portalSettings(db);
  return { enabled: Boolean(settings.portal_enabled) };
}

export function portalSettings(db) {
  return db.prepare("SELECT * FROM hr_portal_settings WHERE id = 1").get();
}

export function updatePortalSettings(db, body, userId) {
  const current = portalSettings(db);
  const enabled = body.enabled == null ? Number(current.portal_enabled) : flag(body.enabled);
  const sessionHours = boundedInteger(body.sessionHours ?? current.session_hours, 1, 24, "duraci\u00f3n de sesi\u00f3n");
  const activationHours = boundedInteger(body.activationHours ?? current.activation_hours, 1, 24, "vigencia de activaci\u00f3n");
  const managerApprovalRequired = body.managerApprovalRequired == null ? Number(current.manager_approval_required) : flag(body.managerApprovalRequired);
  const minimumAdvanceDays = boundedInteger(body.minimumAdvanceDays ?? current.minimum_advance_days, 0, 90, "anticipaci\u00f3n m\u00ednima");
  const excludeWeekends = body.excludeWeekends == null ? Number(current.exclude_weekends) : flag(body.excludeWeekends);
  const excludeHolidays = body.excludeHolidays == null ? Number(current.exclude_holidays) : flag(body.excludeHolidays);
  const minimumCoveragePercent = boundedInteger(body.minimumCoveragePercent ?? current.minimum_coverage_percent, 0, 100, "cobertura m\u00ednima");
  db.prepare(`UPDATE hr_portal_settings SET portal_enabled = ?, session_hours = ?, activation_hours = ?,
    manager_approval_required = ?, minimum_advance_days = ?, exclude_weekends = ?, exclude_holidays = ?,
    minimum_coverage_percent = ?,
    updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(enabled, sessionHours, activationHours, managerApprovalRequired, minimumAdvanceDays,
      excludeWeekends, excludeHolidays, minimumCoveragePercent, userId);
  if (!enabled) db.prepare("UPDATE hr_portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE revoked_at IS NULL").run();
  return portalSettings(db);
}

export function configureEmployeeAccess(db, employeeId, body, userId) {
  const employee = db.prepare("SELECT id, status FROM employees WHERE id = ?").get(positiveId(employeeId));
  if (!employee) throw new HrPortalError(404, "Colaborador no encontrado.");
  const status = ["active", "blocked", "inactive"].includes(body.status) ? body.status : "active";
  const existing = db.prepare("SELECT * FROM hr_employee_portal_access WHERE employee_id = ?").get(employee.id);
  const permissions = {
    canViewFile: permission(body.canViewFile, existing?.can_view_file, true),
    canViewVacation: permission(body.canViewVacation, existing?.can_view_vacation, true),
    canCreateRequests: permission(body.canCreateRequests, existing?.can_create_requests, true),
    canUploadDocuments: permission(body.canUploadDocuments, existing?.can_upload_documents, true),
    canViewSchedule: permission(body.canViewSchedule, existing?.can_view_schedule, true),
    canViewSalary: permission(body.canViewSalary, existing?.can_view_salary, false),
    canViewCfdi: permission(body.canViewCfdi, existing?.can_view_cfdi, true),
    canViewMedical: permission(body.canViewMedical, existing?.can_view_medical, true),
  };
  const shouldActivate = status === "active" && (!existing || body.restartActivation === true
    || existing.access_status !== "active"
    || (existing.must_change_pin && (!existing.activation_expires_at || utcMillis(existing.activation_expires_at) <= Date.now())));
  const activationExpiresAt = shouldActivate
    ? sqlDate(Date.now() + Number(portalSettings(db).activation_hours) * 3600 * 1000)
    : existing?.activation_expires_at || null;
  db.prepare(`INSERT INTO hr_employee_portal_access
    (employee_id, access_status, must_change_pin, activation_expires_at,
     can_view_file, can_view_vacation, can_create_requests, can_upload_documents, can_view_schedule,
     can_view_salary, can_view_cfdi, can_view_medical, enabled_by, updated_by)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET access_status = excluded.access_status,
      activation_expires_at = CASE WHEN ? = 1 THEN excluded.activation_expires_at ELSE hr_employee_portal_access.activation_expires_at END,
      can_view_file = excluded.can_view_file, can_view_vacation = excluded.can_view_vacation,
      can_create_requests = excluded.can_create_requests, can_upload_documents = excluded.can_upload_documents,
      can_view_schedule = excluded.can_view_schedule, can_view_salary = excluded.can_view_salary,
      can_view_cfdi = excluded.can_view_cfdi, can_view_medical = excluded.can_view_medical,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(employee.id, status, activationExpiresAt, permissions.canViewFile, permissions.canViewVacation,
      permissions.canCreateRequests, permissions.canUploadDocuments, permissions.canViewSchedule,
      permissions.canViewSalary, permissions.canViewCfdi, permissions.canViewMedical, userId, userId,
      shouldActivate ? 1 : 0);
  if (status !== "active") revokeEmployeeSessions(db, employee.id);
  return employeeAccess(db, employee.id);
}

export function resetEmployeePin(db, employeeId, userId) {
  const employee = db.prepare("SELECT id FROM employees WHERE id = ?").get(positiveId(employeeId));
  if (!employee) throw new HrPortalError(404, "Colaborador no encontrado.");
  const expires = sqlDate(Date.now() + Number(portalSettings(db).activation_hours) * 3600 * 1000);
  db.prepare(`INSERT INTO hr_employee_portal_access
    (employee_id, access_status, pin_hash, must_change_pin, activation_expires_at, enabled_by, updated_by)
    VALUES (?, 'active', NULL, 1, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET access_status = 'active', pin_hash = NULL, must_change_pin = 1,
      activation_expires_at = excluded.activation_expires_at, failed_attempt_count = 0, locked_until = NULL,
      updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(employee.id, expires, userId, userId);
  revokeEmployeeSessions(db, employee.id);
  return employeeAccess(db, employee.id);
}

export function listEmployeeAccess(db) {
  return db.prepare(`SELECT e.id AS employee_id, e.employee_number, e.full_name, e.email, e.status AS employee_status,
    COALESCE(pa.access_status, 'inactive') AS access_status, COALESCE(pa.must_change_pin, 1) AS must_change_pin,
    pa.activation_expires_at, pa.last_login_at, pa.locked_until,
    COALESCE(pa.can_view_file, 1) AS can_view_file,
    COALESCE(pa.can_view_vacation, 1) AS can_view_vacation,
    COALESCE(pa.can_create_requests, 1) AS can_create_requests,
    COALESCE(pa.can_upload_documents, 1) AS can_upload_documents,
    COALESCE(pa.can_view_schedule, 1) AS can_view_schedule,
    COALESCE(pa.can_view_salary, 0) AS can_view_salary,
    COALESCE(pa.can_view_cfdi, 1) AS can_view_cfdi,
    COALESCE(pa.can_view_medical, 1) AS can_view_medical
    FROM employees e LEFT JOIN hr_employee_portal_access pa ON pa.employee_id = e.id
    ORDER BY e.status = 'active' DESC, e.full_name`).all();
}

export function holidays(db) {
  return db.prepare("SELECT id, holiday_date, name, is_active FROM hr_holidays WHERE is_active = 1 ORDER BY holiday_date").all();
}

export function createHoliday(db, body, userId) {
  const date = String(body.date || "");
  const name = String(body.name || "").trim().replace(/\s+/g, " ").slice(0, 140);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) throw new HrPortalError(400, "Captura fecha y nombre del día festivo.");
  try {
    const result = db.prepare("INSERT INTO hr_holidays (holiday_date, name, created_by) VALUES (?, ?, ?)").run(date, name, userId);
    return { id: Number(result.lastInsertRowid), date, name };
  } catch (error) {
    if (String(error.message).includes("UNIQUE")) throw new HrPortalError(409, "La fecha ya está registrada como festiva.");
    throw error;
  }
}

export function deleteHoliday(db, id) {
  const result = db.prepare("UPDATE hr_holidays SET is_active = 0 WHERE id = ?").run(positiveId(id));
  if (!result.changes) throw new HrPortalError(404, "Día festivo no encontrado.");
}

export function absenceLimits(db) {
  return db.prepare(`SELECT d.id AS department_id, d.name AS department_name,
    COALESCE(l.maximum_absent, 1) AS maximum_absent, COALESCE(l.minimum_available, 1) AS minimum_available
    FROM hr_departments d LEFT JOIN hr_department_absence_limits l ON l.department_id = d.id
    WHERE d.is_active = 1 ORDER BY d.name`).all();
}

export function saveAbsenceLimit(db, departmentId, body, userId) {
  const id = positiveId(departmentId);
  if (!db.prepare("SELECT id FROM hr_departments WHERE id = ? AND is_active = 1").get(id))
    throw new HrPortalError(404, "Departamento no encontrado.");
  const maximumAbsent = boundedInteger(body.maximumAbsent, 0, 10000, "cantidad máxima de ausentes");
  const minimumAvailable = boundedInteger(body.minimumAvailable, 0, 10000, "cantidad mínima disponible");
  db.prepare(`INSERT INTO hr_department_absence_limits
    (department_id, maximum_absent, minimum_available, updated_by) VALUES (?, ?, ?, ?)
    ON CONFLICT(department_id) DO UPDATE SET maximum_absent = excluded.maximum_absent,
      minimum_available = excluded.minimum_available, updated_by = excluded.updated_by, updated_at = CURRENT_TIMESTAMP`)
    .run(id, maximumAbsent, minimumAvailable, userId);
  return absenceLimits(db).find((row) => row.department_id === id);
}

export function login(db, { employeeNumber, pin, ip = "", userAgent = "" }) {
  const settings = portalSettings(db);
  const employee = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.status,
    pa.* FROM employees e LEFT JOIN hr_employee_portal_access pa ON pa.employee_id = e.id
    WHERE e.employee_number = ?`).get(cleanEmployeeNumber(employeeNumber));
  if (!settings.portal_enabled || !employee || employee.status === "inactive" || employee.access_status !== "active")
    throw loginFailure(db, employee, ip);
  if (employee.locked_until && utcMillis(employee.locked_until) > Date.now()) throw loginFailure(db, employee, ip, false);
  if (!/^\d{4}$/.test(String(pin || ""))) throw loginFailure(db, employee, ip);

  let sessionType = "portal";
  if (employee.must_change_pin) {
    if (pin !== "0000" || !employee.activation_expires_at || utcMillis(employee.activation_expires_at) <= Date.now())
      throw loginFailure(db, employee, ip);
    sessionType = "setup";
  } else if (!employee.pin_hash || !verifyPassword(pin, employee.pin_hash)) {
    throw loginFailure(db, employee, ip);
  }

  db.prepare("UPDATE hr_employee_portal_access SET failed_attempt_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE employee_id = ?")
    .run(employee.id);
  const session = createSession(db, employee.id, sessionType, sessionType === "setup" ? 15 / 60 : Number(settings.session_hours), ip, userAgent);
  portalAudit(db, employee.id, sessionType === "setup" ? "portal.pin_setup_started" : "portal.login", null, null, null, ip);
  return { ...session, requiresPinChange: sessionType === "setup", employee: safeEmployee(employee) };
}

export function authenticate(db, token, expectedType = null) {
  if (!token || !portalSettings(db).portal_enabled) return null;
  const session = db.prepare(`SELECT s.*, e.employee_number, e.full_name, e.status AS employee_status,
    pa.access_status, pa.must_change_pin, pa.can_view_file, pa.can_view_vacation,
    pa.can_create_requests, pa.can_upload_documents, pa.can_view_schedule, pa.can_view_salary,
    pa.can_view_cfdi, pa.can_view_medical
    FROM hr_portal_sessions s JOIN employees e ON e.id = s.employee_id
    JOIN hr_employee_portal_access pa ON pa.employee_id = s.employee_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > CURRENT_TIMESTAMP`)
    .get(hashToken(token));
  if (!session || session.employee_status === "inactive" || session.access_status !== "active") return null;
  if (expectedType && session.session_type !== expectedType) return null;
  db.prepare("UPDATE hr_portal_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
  return session;
}

export function changePin(db, session, newPin, ip = "") {
  if (session.session_type !== "setup") throw new HrPortalError(403, "La sesi\u00f3n no permite configurar el PIN.");
  validatePin(newPin);
  const settings = portalSettings(db);
  const expires = sqlDate(Date.now() + Number(settings.session_hours) * 3600 * 1000);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE hr_employee_portal_access SET pin_hash = ?, must_change_pin = 0,
      activation_expires_at = NULL, pin_changed_at = CURRENT_TIMESTAMP, failed_attempt_count = 0,
      locked_until = NULL, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?`)
      .run(hashPassword(newPin), session.employee_id);
    db.prepare(`UPDATE hr_portal_sessions SET session_type = 'portal', authenticated_at = CURRENT_TIMESTAMP,
      expires_at = ? WHERE id = ?`).run(expires, session.id);
    db.prepare("UPDATE hr_portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND id <> ? AND revoked_at IS NULL")
      .run(session.employee_id, session.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  portalAudit(db, session.employee_id, "portal.pin_changed", null, null, null, ip);
  return { expiresAt: expires };
}

export function logout(db, session, ip = "") {
  db.prepare("UPDATE hr_portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
  portalAudit(db, session.employee_id, "portal.logout", null, null, null, ip);
}

export function overview(db, session) {
  const employeeId = session.employee_id;
  const employee = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.email, e.phone, e.position,
    e.hire_date, e.status, c.legal_name AS company_name, wc.name AS work_center_name,
    d.name AS department_name, a.name AS area_name, jp.name AS job_position_name,
    p.employment_type, p.vacation_balance, p.vacation_debt,
    p.vacation_balance - p.vacation_debt AS vacation_available,
    p.vacation_cycle_year, p.vacation_renewed_at, p.work_schedule,
    ws.name AS shift_name, ws.schedule_json AS shift_schedule_json,
    fd.curp, fd.rfc, fd.nss, ld.contract_type, ld.contract_start_date, ld.contract_end_date
    FROM employees e LEFT JOIN companies c ON c.id = e.company_id
    LEFT JOIN hr_work_centers wc ON wc.id = e.work_center_id
    LEFT JOIN hr_departments d ON d.id = e.department_id LEFT JOIN areas a ON a.id = e.area_id
    LEFT JOIN hr_job_positions jp ON jp.id = e.position_id
    LEFT JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    LEFT JOIN hr_employee_fiscal_data fd ON fd.employee_id = e.id
    LEFT JOIN hr_employee_labor_data ld ON ld.employee_id = e.id WHERE e.id = ?`).get(employeeId);
  const leaves = db.prepare(`SELECT l.id, l.folio, l.leave_type, l.subtype, l.start_date, l.end_date,
    l.total_days, l.total_hours, l.reason, l.status, l.request_origin, l.created_at, l.updated_at,
    l.current_approval_step, l.rejection_reason, l.proposed_start_date, l.proposed_end_date,
    l.coverage_employee_id, l.is_unpaid, l.unpaid_terms_accepted, l.working_days,
    ce.full_name AS coverage_employee_name,
    (SELECT r.action FROM hr_leave_request_reviews r WHERE r.leave_request_id = l.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_action,
    (SELECT r.reason FROM hr_leave_request_reviews r WHERE r.leave_request_id = l.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_reason,
    (SELECT r.created_at FROM hr_leave_request_reviews r WHERE r.leave_request_id = l.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_created_at
    FROM hr_leave_requests l LEFT JOIN employees ce ON ce.id = l.coverage_employee_id
    WHERE l.employee_id = ? ORDER BY l.created_at DESC, l.id DESC LIMIT 100`).all(employeeId);
  for (const leave of leaves) {
    leave.history = db.prepare(`SELECT h.*, e.full_name AS actor_employee_name,
      u.full_name AS actor_user_name FROM hr_leave_status_history h
      LEFT JOIN employees e ON e.id = h.actor_employee_id LEFT JOIN users u ON u.id = h.actor_user_id
      WHERE h.leave_request_id = ? ORDER BY h.created_at, h.id`).all(leave.id);
    leave.documents = db.prepare(`SELECT d.id, d.original_name, d.mime_type, d.created_at
      FROM hr_leave_request_documents rd JOIN documents d ON d.id = rd.document_id
      WHERE rd.leave_request_id = ? AND d.deleted_at IS NULL ORDER BY rd.linked_at`).all(leave.id);
  }
  const unread = db.prepare("SELECT COUNT(*) AS value FROM hr_portal_notifications WHERE employee_id = ? AND is_read = 0").get(employeeId).value;
  const directs = db.prepare("SELECT COUNT(*) AS value FROM hr_employee_profiles WHERE manager_employee_id = ?").get(employeeId).value;
  const documentTypes = db.prepare(`SELECT id, code, name, sensitivity, requires_issue_date,
    requires_expiry_date, allows_expiry_date
    FROM hr_document_types WHERE is_active = 1 AND sensitivity IN ('standard', 'fiscal', 'medical') ORDER BY name`).all()
    .filter((row) => row.sensitivity !== "medical" || session.can_view_medical);
  const coverageOptions = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.position
    FROM employees e JOIN employees owner ON owner.id = ?
    WHERE e.id <> owner.id AND e.status = 'active'
      AND COALESCE(e.department_id, 0) = COALESCE(owner.department_id, 0) ORDER BY e.full_name`).all(employeeId);
  return {
    employee: session.can_view_file ? employee : safeEmployee(employee),
    vacation: session.can_view_vacation ? {
      balance: Number(employee.vacation_balance || 0), debt: Number(employee.vacation_debt || 0),
      available: Number(employee.vacation_available || 0), cycleYear: Number(employee.vacation_cycle_year || 0),
      renewedAt: employee.vacation_renewed_at,
    } : null,
    schedule: session.can_view_schedule ? scheduleFor(employee) : null,
    publishedSchedule: session.can_view_schedule ? hrSchedules.employeeSchedule(db, employeeId) : null,
    requests: leaves,
    unreadNotifications: Number(unread || 0),
    hasDirectReports: Number(directs || 0) > 0,
    documentTypes,
    coverageOptions,
    permissions: sessionPermissions(session),
  };
}

export function teamOverview(db, managerEmployeeId) {
  const people = db.prepare(`SELECT e.id, e.employee_number, e.full_name, e.status, e.position, e.department_id,
    d.name AS department_name, a.name AS area_name, ws.name AS shift_name, ws.schedule_json AS shift_schedule_json,
    p.work_schedule, p.vacation_balance - p.vacation_debt AS vacation_available
    FROM hr_employee_profiles p JOIN employees e ON e.id = p.employee_id
    LEFT JOIN hr_departments d ON d.id = e.department_id LEFT JOIN areas a ON a.id = e.area_id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    WHERE p.manager_employee_id = ? ORDER BY e.full_name`).all(managerEmployeeId);
  const ids = people.map((row) => row.id);
  if (!ids.length) return { people: [], calendar: [], coverage: [], pendingRequests: [] };
  const placeholders = ids.map(() => "?").join(",");
  const calendar = db.prepare(`SELECT l.id, l.folio, l.employee_id, e.full_name AS employee_name,
    l.leave_type, l.start_date, l.end_date, l.status
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    WHERE l.employee_id IN (${placeholders}) AND l.status IN ('submitted', 'approved')
      AND l.end_date >= date('now') ORDER BY l.start_date, e.full_name`).all(...ids);
  const pendingRequests = db.prepare(`SELECT l.id, l.folio, l.employee_id, e.full_name AS employee_name,
    e.employee_number, e.department_id, d.name AS department_name, l.leave_type, l.subtype,
    l.start_date, l.end_date, l.total_days, l.total_hours, l.reason, l.status, l.created_at,
    ws.name AS shift_name, ws.schedule_json AS shift_schedule_json, p.work_schedule,
    (SELECT r.action FROM hr_leave_request_reviews r WHERE r.leave_request_id = l.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_action,
    (SELECT r.reason FROM hr_leave_request_reviews r WHERE r.leave_request_id = l.id
      ORDER BY r.created_at DESC, r.id DESC LIMIT 1) AS review_reason
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    JOIN hr_employee_profiles p ON p.employee_id = e.id
    LEFT JOIN hr_departments d ON d.id = e.department_id
    LEFT JOIN hr_work_shifts ws ON ws.id = p.work_shift_id
    WHERE p.manager_employee_id = ? AND l.status = 'submitted' AND l.current_approval_step = 'manager'
    ORDER BY l.created_at, l.id`).all(managerEmployeeId);
  const departments = new Map();
  for (const person of people) {
    const name = person.department_name || person.area_name || "Sin departamento";
    if (!departments.has(name)) departments.set(name, { department: name, active: 0, absentToday: 0, availableToday: 0 });
    if (person.status !== "inactive") departments.get(name).active += 1;
  }
  for (const leave of calendar) {
    if (leave.status !== "approved" || leave.start_date > today() || leave.end_date < today()) continue;
    const person = people.find((row) => row.id === leave.employee_id);
    const name = person?.department_name || person?.area_name || "Sin departamento";
    departments.get(name).absentToday += 1;
  }
  for (const row of departments.values()) row.availableToday = Math.max(0, row.active - row.absentToday);
  const policy = portalSettings(db);
  for (const request of pendingRequests) {
    const departmentPeople = people.filter((person) => Number(person.department_id || 0) === Number(request.department_id || 0)
      && person.status !== "inactive");
    const overlaps = calendar.filter((leave) => leave.status === "approved" && leave.employee_id !== request.employee_id
      && leave.start_date <= request.end_date && leave.end_date >= request.start_date
      && departmentPeople.some((person) => person.id === leave.employee_id));
    request.coverage_total = departmentPeople.length;
    request.coverage_absent = new Set(overlaps.map((leave) => leave.employee_id)).size;
    request.coverage_available_after = Math.max(0, departmentPeople.length - request.coverage_absent - 1);
    const limit = db.prepare("SELECT maximum_absent, minimum_available FROM hr_department_absence_limits WHERE department_id = ?").get(request.department_id);
    request.coverage_minimum_available = Math.max(Number(limit?.minimum_available || 0),
      Math.ceil(departmentPeople.length * Number(policy.minimum_coverage_percent || 0) / 100));
    request.coverage_maximum_absent = limit ? Number(limit.maximum_absent)
      : Math.max(0, departmentPeople.length - request.coverage_minimum_available);
    request.coverage_within_limit = request.coverage_available_after >= request.coverage_minimum_available
      && request.coverage_absent + 1 <= request.coverage_maximum_absent;
    request.schedule = scheduleFor(request);
  }
  return {
    people: people.map((row) => ({ ...row, schedule: scheduleFor(row) })),
    calendar,
    coverage: [...departments.values()],
    pendingRequests,
  };
}

export function managerReviewContext(db, managerEmployeeId, requestId, action, reason) {
  const allowedActions = ["approve", "reject", "request_changes"];
  if (!allowedActions.includes(action)) throw new HrPortalError(400, "Selecciona una decisión válida.");
  const cleanReason = String(reason || "").trim().replace(/\s+/g, " ").slice(0, 800);
  if (cleanReason.length < 5) throw new HrPortalError(400, "Captura un motivo de al menos 5 caracteres.");
  const request = db.prepare(`SELECT l.*, e.full_name AS employee_name, p.vacation_balance, p.vacation_debt
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    JOIN hr_employee_profiles p ON p.employee_id = e.id
    WHERE l.id = ? AND p.manager_employee_id = ?`).get(positiveId(requestId), positiveId(managerEmployeeId));
  if (!request) throw new HrPortalError(404, "La solicitud no pertenece a tu plantilla.");
  if (request.status !== "submitted") throw new HrPortalError(409, "La solicitud ya fue atendida.");
  const latest = db.prepare(`SELECT action FROM hr_leave_request_reviews WHERE leave_request_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 1`).get(request.id);
  if (latest?.action === "request_changes" && action !== "request_changes")
    throw new HrPortalError(409, "Espera a que el colaborador envíe las modificaciones solicitadas.");
  if (action === "approve" && request.leave_type === "vacation") {
    const available = Number(request.vacation_balance || 0) - Number(request.vacation_debt || 0);
    if (Number(request.total_days || 0) > available)
      throw new HrPortalError(409, "La solicitud requiere vacaciones adelantadas y debe autorizarla el Administrador RH.");
  }
  return { request, action, reason: cleanReason };
}

export function recordRequestReview(db, requestId, actorEmployeeId, action, reason) {
  const normalized = ({ approve: "approved", reject: "rejected" })[action] || action;
  db.prepare(`INSERT INTO hr_leave_request_reviews
    (leave_request_id, actor_employee_id, action, reason) VALUES (?, ?, ?, ?)`)
    .run(positiveId(requestId), positiveId(actorEmployeeId), normalized, String(reason || "").slice(0, 800));
}

export function notifications(db, employeeId) {
  return db.prepare(`SELECT id, title, message, notification_type, related_entity_type, related_entity_id,
    is_read, read_at, created_at FROM hr_portal_notifications WHERE employee_id = ?
    ORDER BY created_at DESC, id DESC LIMIT 100`).all(employeeId);
}

export function markNotificationRead(db, employeeId, id) {
  const result = db.prepare(`UPDATE hr_portal_notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP
    WHERE id = ? AND employee_id = ?`).run(positiveId(id), employeeId);
  if (!result.changes) throw new HrPortalError(404, "Notificaci\u00f3n no encontrada.");
}

export function notify(db, employeeId, title, message, type = "info", relatedType = null, relatedId = null, userId = null) {
  db.prepare(`INSERT INTO hr_portal_notifications
    (employee_id, title, message, notification_type, related_entity_type, related_entity_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(employeeId, String(title).slice(0, 180), String(message).slice(0, 1000), type, relatedType, relatedId, userId);
}

export function portalAudit(db, employeeId, action, entityType = null, entityId = null, details = null, ip = "") {
  db.prepare(`INSERT INTO hr_portal_audit_log
    (employee_id, action, entity_type, entity_id, details_json, ip_address) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(employeeId, action, entityType, entityId, details ? JSON.stringify(details) : null, String(ip).slice(0, 80));
}

function createSession(db, employeeId, sessionType, hours, ip, userAgent) {
  const token = createOpaqueToken();
  const csrfToken = createOpaqueToken(24);
  const expiresAt = sqlDate(Date.now() + hours * 3600 * 1000);
  db.prepare(`INSERT INTO hr_portal_sessions
    (employee_id, token_hash, csrf_token, session_type, ip_address, user_agent, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(employeeId, hashToken(token), csrfToken, sessionType, String(ip).slice(0, 80), String(userAgent).slice(0, 300), expiresAt);
  return { token, csrfToken, expiresAt };
}

function loginFailure(db, employee, ip, count = true) {
  if (employee?.id && count) {
    const settings = portalSettings(db);
    const attempts = Number(employee.failed_attempt_count || 0) + 1;
    const lock = attempts >= Number(settings.failed_attempt_limit)
      ? sqlDate(Date.now() + Number(settings.lock_minutes) * 60 * 1000) : null;
    db.prepare("UPDATE hr_employee_portal_access SET failed_attempt_count = ?, locked_until = ? WHERE employee_id = ?")
      .run(lock ? 0 : attempts, lock, employee.id);
    portalAudit(db, employee.id, "portal.login_failed", null, null, null, ip);
  }
  return new HrPortalError(401, GENERIC_LOGIN_ERROR);
}

export function employeeAccess(db, employeeId) {
  return db.prepare("SELECT * FROM hr_employee_portal_access WHERE employee_id = ?").get(employeeId);
}

function revokeEmployeeSessions(db, employeeId) {
  db.prepare("UPDATE hr_portal_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND revoked_at IS NULL").run(employeeId);
}

function validatePin(pin) {
  if (!/^\d{4}$/.test(String(pin || ""))) throw new HrPortalError(400, "El PIN debe contener exactamente 4 d\u00edgitos.");
  if (pin === "0000") throw new HrPortalError(400, "El PIN definitivo no puede ser 0000.");
}

function cleanEmployeeNumber(value) { return String(value || "").trim().slice(0, 80); }
function positiveId(value) { const id = Number(value); if (!Number.isInteger(id) || id < 1) throw new HrPortalError(400, "Identificador no v\u00e1lido."); return id; }
function flag(value) { return value === true || value === 1 || value === "1" ? 1 : 0; }
function permission(value, current, fallback) { return value == null ? (current == null ? flag(fallback) : Number(current)) : flag(value); }
function boundedInteger(value, min, max, label) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new HrPortalError(400, `La ${label} no es v\u00e1lida.`); return n; }
function sqlDate(ms) { return new Date(ms).toISOString().replace("T", " ").replace("Z", ""); }
function utcMillis(value) { return new Date(String(value).replace(" ", "T") + (String(value).endsWith("Z") ? "" : "Z")).getTime(); }
function safeEmployee(row) { return { id: row.id, employee_number: row.employee_number, full_name: row.full_name }; }
function sessionPermissions(row) { return {
  viewFile: Boolean(row.can_view_file), viewVacation: Boolean(row.can_view_vacation),
  createRequests: Boolean(row.can_create_requests), uploadDocuments: Boolean(row.can_upload_documents),
  viewSchedule: Boolean(row.can_view_schedule), viewSalary: Boolean(row.can_view_salary),
  viewCfdi: Boolean(row.can_view_cfdi), viewMedical: Boolean(row.can_view_medical),
}; }
function scheduleFor(row) {
  try { const parsed = JSON.parse(row.shift_schedule_json || ""); if (Array.isArray(parsed)) return { name: row.shift_name || "Turno", groups: parsed }; }
  catch { /* Formato heredado: se muestra como texto. */ }
  return { name: row.shift_name || "Horario", description: row.work_schedule || "Sin horario asignado", groups: [] };
}
function today() { return new Date().toISOString().slice(0, 10); }

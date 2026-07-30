export class SafetyError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function options(db) {
  return {
    employees: db.prepare("SELECT id, employee_number, full_name, area_id FROM employees WHERE status <> 'inactive' ORDER BY full_name").all(),
    areas: db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1 ORDER BY name").all(),
    incidents: db.prepare("SELECT id, folio, employee_id, event_type, event_date FROM safety_incidents WHERE status <> 'cancelled' ORDER BY event_date DESC").all(),
  };
}

export function control(db) {
  db.prepare("UPDATE safety_compliance_requirements SET status = 'overdue', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND due_date IS NOT NULL AND due_date < date('now')").run();
  const incidents = db.prepare(`SELECT i.*, e.employee_number, e.full_name AS employee_name, a.name AS area_name
    FROM safety_incidents i LEFT JOIN employees e ON e.id = i.employee_id LEFT JOIN areas a ON a.id = i.area_id
    ORDER BY i.event_date DESC, i.id DESC`).all();
  const incapacities = db.prepare(`SELECT l.*, e.employee_number, e.full_name AS employee_name, i.folio AS incident_folio
    FROM hr_leave_requests l JOIN employees e ON e.id = l.employee_id
    LEFT JOIN safety_incidents i ON i.id = l.safety_incident_id
    WHERE l.leave_type = 'incapacity' AND l.safety_incident_id IS NOT NULL ORDER BY l.start_date DESC, l.id DESC`).all();
  const risks = db.prepare(`SELECT r.*, a.name AS area_name, e.full_name AS responsible_name
    FROM safety_risk_assessments r LEFT JOIN areas a ON a.id = r.area_id
    LEFT JOIN employees e ON e.id = r.responsible_employee_id ORDER BY r.risk_score DESC, r.id DESC`).all();
  const compliance = db.prepare(`SELECT c.*, e.full_name AS responsible_name
    FROM safety_compliance_requirements c LEFT JOIN employees e ON e.id = c.responsible_employee_id
    ORDER BY CASE c.status WHEN 'overdue' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, c.due_date, c.id DESC`).all();
  const totalCompliance = compliance.filter((row) => row.status !== "not_applicable").length;
  const compliant = compliance.filter((row) => row.status === "compliant").length;
  const indicators = {
    incidents30Days: Number(db.prepare("SELECT COUNT(*) AS value FROM safety_incidents WHERE status <> 'cancelled' AND date(event_date) >= date('now', '-30 days')").get().value),
    lostTimeEvents: incidents.filter((row) => row.lost_time && row.status !== "cancelled").length,
    incapacityDays: round(incapacities.filter((row) => !["rejected", "cancelled"].includes(row.status)).reduce((sum, row) => sum + Number(row.total_days || 0), 0)),
    highRisks: risks.filter((row) => row.risk_score >= 15 && !["controlled", "closed"].includes(row.status)).length,
    complianceRate: totalCompliance ? Math.round(compliant / totalCompliance * 100) : 100,
  };
  return { incidents, incapacities, risks, compliance, indicators };
}

export function createIncident(db, body, userId) {
  const result = db.prepare(`INSERT INTO safety_incidents
    (folio, employee_id, area_id, event_type, event_date, location, description, immediate_action, severity, lost_time, reported_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("SST"), optionalExistingId(db, "employees", body.employeeId, "empleado"),
      optionalExistingId(db, "areas", body.areaId, "área"),
      enumRequired(body.eventType, ["accident", "incident", "near_miss", "occupational_disease"], "tipo de evento"),
      requiredDateTime(body.eventDate), text(body.location, 180),
      requiredText(body.description, 1500, "La descripción"), text(body.immediateAction, 1000),
      enumValue(body.severity, ["low", "medium", "high", "critical"], "low"), body.lostTime ? 1 : 0, userId);
  return finishFolio(db, "safety_incidents", result, "SST-");
}

export function createIncapacity(db, body, userId) {
  const incidentId = positiveId(body.incidentId, "evento");
  const incident = db.prepare("SELECT * FROM safety_incidents WHERE id = ? AND status <> 'cancelled'").get(incidentId);
  if (!incident) throw new SafetyError(404, "El evento de seguridad no existe.");
  const employeeId = positiveId(body.employeeId || incident.employee_id, "empleado");
  requireRecord(db, "employees", employeeId, "Empleado");
  const startDate = requiredDate(body.startDate), endDate = requiredDate(body.endDate);
  if (endDate < startDate) throw new SafetyError(400, "La fecha final no puede ser anterior a la inicial.");
  const days = dateDays(startDate, endDate);
  const result = db.prepare(`INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, reason, certificate_number, medical_provider, safety_incident_id, created_by)
    VALUES (?, ?, 'incapacity', ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("INA"), employeeId, text(body.subtype, 100), startDate, endDate, days,
      requiredText(body.reason, 800, "El motivo"), text(body.certificateNumber, 120), text(body.medicalProvider, 180), incidentId, userId);
  return finishFolio(db, "hr_leave_requests", result, "INA-");
}

export function createRisk(db, body, userId) {
  const probability = integerRange(body.probability, 1, 5, "La probabilidad");
  const consequence = integerRange(body.consequence, 1, 5, "La consecuencia");
  const result = db.prepare(`INSERT INTO safety_risk_assessments
    (folio, area_id, activity, hazard, risk_type, probability, consequence, risk_score, controls, responsible_employee_id, review_date, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("RIE"), optionalExistingId(db, "areas", body.areaId, "área"),
      requiredText(body.activity, 240, "La actividad"), requiredText(body.hazard, 800, "El peligro"),
      enumRequired(body.riskType, ["physical", "chemical", "biological", "ergonomic", "psychosocial", "safety"], "tipo de riesgo"),
      probability, consequence, probability * consequence, text(body.controls, 1200),
      optionalExistingId(db, "employees", body.responsibleEmployeeId, "responsable"), optionalDate(body.reviewDate), userId);
  return finishFolio(db, "safety_risk_assessments", result, "RIE-");
}

export function createCompliance(db, body, userId) {
  const result = db.prepare(`INSERT INTO safety_compliance_requirements
    (folio, requirement_code, title, authority, category, due_date, responsible_employee_id, evidence, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("CUM"), text(body.requirementCode, 100), requiredText(body.title, 240, "El requisito"),
      text(body.authority, 160), text(body.category, 120), optionalDate(body.dueDate),
      optionalExistingId(db, "employees", body.responsibleEmployeeId, "responsable"),
      text(body.evidence, 800), text(body.notes, 800), userId);
  return finishFolio(db, "safety_compliance_requirements", result, "CUM-");
}

export function incidentAction(db, id, body, userId) {
  const row = db.prepare("SELECT * FROM safety_incidents WHERE id = ?").get(id);
  if (!row) throw new SafetyError(404, "Evento no encontrado.");
  const action = body.action;
  const transitions = {
    investigate: [["reported"], "investigating"],
    plan: [["reported", "investigating"], "action_plan"],
    close: [["investigating", "action_plan"], "closed"],
    cancel: [["reported"], "cancelled"],
  };
  if (!transitions[action] || !transitions[action][0].includes(row.status)) throw new SafetyError(409, "El evento no admite esa acción.");
  const status = transitions[action][1];
  db.prepare(`UPDATE safety_incidents SET status = ?, investigation = COALESCE(NULLIF(?, ''), investigation),
    root_cause = COALESCE(NULLIF(?, ''), root_cause), corrective_action = COALESCE(NULLIF(?, ''), corrective_action),
    closed_by = CASE WHEN ? = 'closed' THEN ? ELSE closed_by END, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, text(body.investigation, 1500), text(body.rootCause, 1000), text(body.correctiveAction, 1200), status, userId, id);
  return { id, folio: row.folio, status };
}

export function riskAction(db, id, body) {
  const row = db.prepare("SELECT * FROM safety_risk_assessments WHERE id = ?").get(id);
  if (!row) throw new SafetyError(404, "Análisis de riesgo no encontrado.");
  const next = { treat: "in_treatment", control: "controlled", close: "closed", reopen: "open" }[body.action];
  if (!next) throw new SafetyError(400, "Acción de riesgo no válida.");
  db.prepare("UPDATE safety_risk_assessments SET status = ?, controls = COALESCE(NULLIF(?, ''), controls), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(next, text(body.controls, 1200), id);
  return { id, folio: row.folio, status: next };
}

export function complianceAction(db, id, body) {
  const row = db.prepare("SELECT * FROM safety_compliance_requirements WHERE id = ?").get(id);
  if (!row) throw new SafetyError(404, "Requisito no encontrado.");
  const status = { comply: "compliant", pending: "pending", not_applicable: "not_applicable" }[body.action];
  if (!status) throw new SafetyError(400, "Acción de cumplimiento no válida.");
  db.prepare("UPDATE safety_compliance_requirements SET status = ?, evidence = COALESCE(NULLIF(?, ''), evidence), updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(status, text(body.evidence, 800), id);
  return { id, folio: row.folio, status };
}

function finishFolio(db, table, result, prefix) {
  const id = Number(result.lastInsertRowid), folio = prefix + String(id).padStart(6, "0");
  db.prepare(`UPDATE ${table} SET folio = ? WHERE id = ?`).run(folio, id);
  return { id, folio };
}
function requireRecord(db, table, id, label) { if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id)) throw new SafetyError(404, `${label} no encontrado.`); }
function optionalExistingId(db, table, value, label) { if (value == null || value === "") return null; const id = positiveId(value, label); requireRecord(db, table, id, label); return id; }
function positiveId(value, label) { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new SafetyError(400, `Selecciona un ${label} válido.`); return n; }
function requiredText(value, max, label) { const valueText = text(value, max); if (!valueText) throw new SafetyError(400, `${label} es obligatoria.`); return valueText; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumRequired(value, allowed, label) { if (!allowed.includes(value)) throw new SafetyError(400, `Selecciona un ${label} válido.`); return value; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function requiredDate(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) throw new SafetyError(400, "La fecha no es válida."); return String(value); }
function optionalDate(value) { return value ? requiredDate(value) : null; }
function requiredDateTime(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw new SafetyError(400, "La fecha y hora no son válidas."); return date.toISOString().replace("T", " ").replace("Z", ""); }
function integerRange(value, min, max, label) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new SafetyError(400, `${label} debe estar entre ${min} y ${max}.`); return n; }
function dateDays(start, end) { return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1; }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }

export class HrComplianceError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function control(db) {
  const cases = db.prepare(`SELECT c.id, c.folio, c.title, c.category, c.channel, c.reporter_type,
    c.occurred_on, c.location, c.severity, c.confidentiality, c.status, c.target_date,
    c.anti_retaliation_notice, c.created_at, c.updated_at, c.resolved_at, c.closed_at,
    e.employee_number AS reporter_employee_number, e.full_name AS reporter_employee_name,
    u.full_name AS investigator_name,
    (SELECT COUNT(*) FROM hr_grievance_evidence ev WHERE ev.case_id = c.id) AS evidence_count,
    (SELECT COUNT(*) FROM hr_grievance_history h WHERE h.case_id = c.id) AS history_count
    FROM hr_grievance_cases c
    LEFT JOIN employees e ON e.id = c.reporter_employee_id
    LEFT JOIN users u ON u.id = c.investigator_user_id
    ORDER BY CASE c.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      CASE c.status WHEN 'received' THEN 0 WHEN 'triage' THEN 1 WHEN 'investigating' THEN 2
        WHEN 'action_plan' THEN 3 WHEN 'resolved' THEN 4 ELSE 5 END, c.created_at DESC`).all();
  const users = db.prepare("SELECT id, username, full_name FROM users WHERE status = 'active' ORDER BY full_name").all();
  const employees = db.prepare("SELECT id, employee_number, full_name FROM employees WHERE status <> 'inactive' ORDER BY full_name").all();
  const openStatuses = new Set(["received", "triage", "investigating", "action_plan"]);
  return {
    cases,
    users,
    employees,
    indicators: {
      open: cases.filter((row) => openStatuses.has(row.status)).length,
      critical: cases.filter((row) => openStatuses.has(row.status) && row.severity === "critical").length,
      unassigned: cases.filter((row) => openStatuses.has(row.status) && !row.investigator_name).length,
      resolved: cases.filter((row) => ["resolved", "closed"].includes(row.status)).length,
    },
  };
}

export function detail(db, id) {
  const row = db.prepare(`SELECT c.*, e.employee_number AS reporter_employee_number,
    e.full_name AS reporter_employee_name, u.full_name AS investigator_name,
    creator.full_name AS created_by_name
    FROM hr_grievance_cases c
    LEFT JOIN employees e ON e.id = c.reporter_employee_id
    LEFT JOIN users u ON u.id = c.investigator_user_id
    LEFT JOIN users creator ON creator.id = c.created_by
    WHERE c.id = ?`).get(positiveId(id, "caso"));
  if (!row) throw new HrComplianceError(404, "Caso confidencial no encontrado.");
  const history = db.prepare(`SELECT h.*, u.full_name AS actor_name
    FROM hr_grievance_history h LEFT JOIN users u ON u.id = h.actor_user_id
    WHERE h.case_id = ? ORDER BY h.created_at DESC, h.id DESC`).all(row.id);
  const evidence = db.prepare(`SELECT ev.*, d.original_name, d.mime_type, d.size_bytes,
    u.full_name AS created_by_name
    FROM hr_grievance_evidence ev
    LEFT JOIN documents d ON d.id = ev.document_id
    LEFT JOIN users u ON u.id = ev.created_by
    WHERE ev.case_id = ? ORDER BY ev.created_at DESC, ev.id DESC`).all(row.id);
  return { case: row, history, evidence };
}

export function createCase(db, body, userId) {
  const reporterType = enumRequired(body.reporterType, ["anonymous", "employee", "third_party"], "tipo de reporte");
  const reporterEmployeeId = reporterType === "employee"
    ? existingId(db, "employees", body.reporterEmployeeId, "colaborador") : null;
  const result = db.prepare(`INSERT INTO hr_grievance_cases
    (folio, title, description, category, channel, reporter_type, reporter_employee_id,
      reporter_contact, occurred_on, location, subject_names, severity, confidentiality,
      target_date, anti_retaliation_notice, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
    .run(placeholder("CAS"), requiredText(body.title, 180, "El asunto"),
      requiredText(body.description, 4000, "La descripción"),
      enumRequired(body.category, ["harassment", "discrimination", "retaliation", "labor", "safety", "ethics", "other"], "categoría"),
      enumValue(body.channel, ["internal", "portal", "email", "phone", "in_person", "other"], "internal"),
      reporterType, reporterEmployeeId, reporterType === "anonymous" ? "" : text(body.reporterContact, 240),
      optionalDate(body.occurredOn), text(body.location, 240), text(body.subjectNames, 500),
      enumValue(body.severity, ["low", "medium", "high", "critical"], "medium"),
      enumValue(body.confidentiality, ["restricted", "strict"], "strict"), optionalDate(body.targetDate), userId);
  const id = Number(result.lastInsertRowid), folio = `CAS-${String(id).padStart(6, "0")}`;
  db.prepare("UPDATE hr_grievance_cases SET folio = ? WHERE id = ?").run(folio, id);
  recordHistory(db, id, "created", null, "received", "Caso recibido y protegido contra represalias.", userId);
  return { id, folio, status: "received" };
}

export function addEvidence(db, caseId, body, userId) {
  const grievance = requireCase(db, caseId);
  const documentId = optionalExistingId(db, "documents", body.documentId, "documento");
  const result = db.prepare(`INSERT INTO hr_grievance_evidence
    (case_id, evidence_type, title, description, document_id, external_reference,
      checksum, sensitivity, retention_until, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(grievance.id,
      enumValue(body.evidenceType, ["note", "document", "email", "photo", "link", "other"], documentId ? "document" : "note"),
      requiredText(body.title, 180, "El título de la evidencia"), text(body.description, 2000), documentId,
      text(body.externalReference, 500), text(body.checksum, 128),
      enumValue(body.sensitivity, ["restricted", "strict"], "strict"), optionalDate(body.retentionUntil), userId);
  recordHistory(db, grievance.id, "evidence_added", grievance.status, grievance.status,
    `Evidencia registrada: ${requiredText(body.title, 180, "El título de la evidencia")}`, userId);
  return { id: Number(result.lastInsertRowid), caseId: grievance.id, folio: grievance.folio };
}

export function action(db, caseId, body, userId) {
  const grievance = requireCase(db, caseId);
  const actionName = String(body.action || "");
  const comment = text(body.comment, 2000);
  let nextStatus = grievance.status;
  let investigatorId = grievance.investigator_user_id;
  let resolution = grievance.resolution;

  if (actionName === "assign") {
    investigatorId = existingId(db, "users", body.investigatorUserId, "responsable");
    nextStatus = grievance.status === "received" ? "triage" : grievance.status;
  } else {
    const transitions = {
      triage: [["received"], "triage"],
      investigate: [["received", "triage"], "investigating"],
      plan: [["investigating"], "action_plan"],
      resolve: [["investigating", "action_plan"], "resolved"],
      close: [["resolved"], "closed"],
      reopen: [["resolved", "closed", "dismissed"], "investigating"],
      dismiss: [["received", "triage"], "dismissed"],
    };
    const transition = transitions[actionName];
    if (!transition || !transition[0].includes(grievance.status))
      throw new HrComplianceError(409, "El caso no admite esa acción en su estado actual.");
    nextStatus = transition[1];
  }
  if (["resolve", "dismiss"].includes(actionName) && comment.length < 10)
    throw new HrComplianceError(400, "Documenta el motivo o resolución con al menos 10 caracteres.");
  if (actionName === "resolve") resolution = comment;

  db.prepare(`UPDATE hr_grievance_cases SET status = ?, investigator_user_id = ?, resolution = ?,
    resolved_at = CASE WHEN ? = 'resolved' THEN CURRENT_TIMESTAMP WHEN ? = 'investigating' THEN NULL ELSE resolved_at END,
    closed_at = CASE WHEN ? = 'closed' THEN CURRENT_TIMESTAMP WHEN ? = 'investigating' THEN NULL ELSE closed_at END,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(nextStatus, investigatorId, resolution, nextStatus, nextStatus, nextStatus, nextStatus, grievance.id);
  recordHistory(db, grievance.id, actionName, grievance.status, nextStatus, comment, userId);
  return { id: grievance.id, folio: grievance.folio, status: nextStatus };
}

function requireCase(db, id) {
  const row = db.prepare("SELECT * FROM hr_grievance_cases WHERE id = ?").get(positiveId(id, "caso"));
  if (!row) throw new HrComplianceError(404, "Caso confidencial no encontrado.");
  return row;
}

function recordHistory(db, caseId, actionName, previousStatus, nextStatus, comment, userId) {
  db.prepare(`INSERT INTO hr_grievance_history
    (case_id, action, previous_status, next_status, comment, actor_user_id)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(caseId, actionName, previousStatus, nextStatus, comment || "", userId);
}

function existingId(db, table, value, label) {
  const id = positiveId(value, label);
  if (!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id))
    throw new HrComplianceError(404, `${capitalize(label)} no encontrado.`);
  return id;
}
function optionalExistingId(db, table, value, label) {
  return value == null || value === "" ? null : existingId(db, table, value, label);
}
function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw new HrComplianceError(400, `Selecciona un ${label} válido.`);
  return id;
}
function requiredText(value, max, label) {
  const result = text(value, max);
  if (!result) throw new HrComplianceError(400, `${label} es obligatorio.`);
  return result;
}
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumRequired(value, allowed, label) {
  if (!allowed.includes(value)) throw new HrComplianceError(400, `Selecciona un ${label} válido.`);
  return value;
}
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function optionalDate(value) {
  if (value == null || value === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new HrComplianceError(400, "La fecha no es válida.");
  return String(value);
}
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function capitalize(value) { return String(value).charAt(0).toUpperCase() + String(value).slice(1); }

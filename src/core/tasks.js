export class TasksError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    users: db.prepare(`SELECT u.id, u.username, u.full_name,
      COALESCE(MAX(r.level), 1) AS max_level FROM users u
      LEFT JOIN user_roles ur ON ur.user_id = u.id LEFT JOIN roles r ON r.id = ur.role_id
      WHERE u.status = 'active' GROUP BY u.id ORDER BY u.full_name`).all(),
    flows: db.prepare(`SELECT f.id, f.folio, f.name, f.module, f.entity_type,
      COUNT(s.id) AS step_count FROM approval_flows f LEFT JOIN approval_flow_steps s ON s.flow_id = f.id
      WHERE f.is_active = 1 GROUP BY f.id ORDER BY f.name`).all(),
  };
}

export function control(db, userId) {
  const taskSelect = `SELECT t.*, f.folio AS flow_folio, f.name AS flow_name,
    a.full_name AS assigned_to_name, a.username AS assigned_to_username,
    c.full_name AS created_by_name,
    (SELECT s.name FROM approval_flow_steps s WHERE s.flow_id = t.flow_id AND s.sequence = t.current_step) AS current_step_name,
    (SELECT COUNT(*) FROM workflow_task_comments x WHERE x.task_id = t.id) AS comment_count,
    CAST(julianday(t.due_date) - julianday(date('now')) AS INTEGER) AS days_remaining
    FROM workflow_tasks t LEFT JOIN approval_flows f ON f.id = t.flow_id
    JOIN users a ON a.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by`;
  const tasks = db.prepare(taskSelect + " ORDER BY CASE WHEN t.status IN ('pending','in_progress','submitted') THEN 0 ELSE 1 END, t.due_date, t.id DESC").all();
  const assigned = db.prepare(taskSelect + " WHERE t.assigned_to = ? ORDER BY CASE t.priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.due_date, t.id DESC").all(userId);
  const flows = db.prepare(`SELECT f.*,
    (SELECT u.full_name FROM users u WHERE u.id = f.created_by) AS created_by_name,
    (SELECT COUNT(*) FROM approval_flow_steps s WHERE s.flow_id = f.id) AS step_count,
    (SELECT GROUP_CONCAT(s.sequence || '. ' || s.name, ' → ') FROM approval_flow_steps s WHERE s.flow_id = f.id) AS step_summary
    FROM approval_flows f ORDER BY f.is_active DESC, f.name`).all();
  const comments = db.prepare(`SELECT x.*, t.folio AS task_folio, t.title AS task_title,
    u.full_name AS created_by_name FROM workflow_task_comments x
    JOIN workflow_tasks t ON t.id = x.task_id LEFT JOIN users u ON u.id = x.created_by
    ORDER BY x.id DESC LIMIT 300`).all();
  const decisions = db.prepare(`SELECT d.*, t.folio AS task_folio, t.title AS task_title,
    actor.full_name AS decided_by_name, fu.full_name AS from_user_name, tu.full_name AS to_user_name
    FROM workflow_decisions d JOIN workflow_tasks t ON t.id = d.task_id
    LEFT JOIN users actor ON actor.id = d.decided_by LEFT JOIN users fu ON fu.id = d.from_user_id
    LEFT JOIN users tu ON tu.id = d.to_user_id ORDER BY d.id DESC LIMIT 400`).all();
  const rejections = decisions.filter((row) => row.action === "rejected");
  const reassignments = decisions.filter((row) => row.action === "reassigned");
  const deadlines = tasks.filter((row) => row.due_date && ["pending", "in_progress", "submitted"].includes(row.status))
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)));
  const metrics = {
    assignedOpen: assigned.filter((row) => ["pending", "in_progress", "submitted"].includes(row.status)).length,
    awaitingApproval: assigned.filter((row) => row.status === "submitted").length,
    overdue: assigned.filter((row) => row.due_date && row.days_remaining < 0 && ["pending", "in_progress", "submitted"].includes(row.status)).length,
    decided: decisions.filter((row) => ["approved", "rejected"].includes(row.action)).length,
  };
  return { metrics, tasks, assigned, flows, comments, decisions, rejections, reassignments, deadlines };
}

export function flowDetail(db, id) {
  const flow = db.prepare("SELECT * FROM approval_flows WHERE id = ?").get(id);
  if (!flow) throw new TasksError(404, "Flujo de aprobación no encontrado.");
  const steps = db.prepare(`SELECT s.*, u.full_name AS default_assignee_name
    FROM approval_flow_steps s LEFT JOIN users u ON u.id = s.default_assignee_id
    WHERE s.flow_id = ? ORDER BY s.sequence`).all(id);
  return { flow, steps };
}

export function taskDetail(db, id) {
  const task = db.prepare(`SELECT t.*, f.folio AS flow_folio, f.name AS flow_name,
    a.full_name AS assigned_to_name, c.full_name AS created_by_name,
    (SELECT s.name FROM approval_flow_steps s WHERE s.flow_id = t.flow_id AND s.sequence = t.current_step) AS current_step_name
    FROM workflow_tasks t LEFT JOIN approval_flows f ON f.id = t.flow_id
    JOIN users a ON a.id = t.assigned_to LEFT JOIN users c ON c.id = t.created_by WHERE t.id = ?`).get(id);
  if (!task) throw new TasksError(404, "Tarea no encontrada.");
  const comments = db.prepare(`SELECT x.*, u.full_name AS created_by_name FROM workflow_task_comments x
    LEFT JOIN users u ON u.id = x.created_by WHERE x.task_id = ? ORDER BY x.id`).all(id);
  const decisions = db.prepare(`SELECT d.*, actor.full_name AS decided_by_name,
    fu.full_name AS from_user_name, tu.full_name AS to_user_name
    FROM workflow_decisions d LEFT JOIN users actor ON actor.id = d.decided_by
    LEFT JOIN users fu ON fu.id = d.from_user_id LEFT JOIN users tu ON tu.id = d.to_user_id
    WHERE d.task_id = ? ORDER BY d.id`).all(id);
  const steps = task.flow_id ? db.prepare(`SELECT s.*, u.full_name AS default_assignee_name
    FROM approval_flow_steps s LEFT JOIN users u ON u.id = s.default_assignee_id
    WHERE s.flow_id = ? ORDER BY s.sequence`).all(task.flow_id) : [];
  return { task, comments, decisions, steps };
}

export function createFlow(db, body, userId) {
  const steps = Array.isArray(body.steps) ? body.steps : [];
  if (!steps.length) throw new TasksError(400, "Agrega al menos una etapa de aprobación.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO approval_flows
      (folio, name, module, entity_type, description, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("FLU"), requiredText(body.name, 180, "El nombre del flujo"), moduleName(body.module),
        text(body.entityType, 100), text(body.description, 1000), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("FLU-", id);
    db.prepare("UPDATE approval_flows SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO approval_flow_steps
      (flow_id, sequence, name, required_level, default_assignee_id, instructions) VALUES (?, ?, ?, ?, ?, ?)`);
    steps.forEach((raw, index) => {
      const assignee = optionalId(raw.defaultAssigneeId, "responsable de etapa");
      if (assignee && !activeUser(db, assignee)) throw new TasksError(400, "Un responsable de etapa no está disponible.");
      insert.run(id, index + 1, requiredText(raw.name, 160, "El nombre de la etapa"),
        integerRange(raw.requiredLevel ?? 3, 1, 4, "El nivel requerido"), assignee, text(raw.instructions, 500));
    });
    return { id, folio };
  });
}

export function createTask(db, body, userId) {
  const flowId = optionalId(body.flowId, "flujo");
  let firstStep = null;
  if (flowId) {
    if (!db.prepare("SELECT id FROM approval_flows WHERE id = ? AND is_active = 1").get(flowId)) throw new TasksError(400, "El flujo no está disponible.");
    firstStep = db.prepare("SELECT * FROM approval_flow_steps WHERE flow_id = ? ORDER BY sequence LIMIT 1").get(flowId);
  }
  const requestedAssignee = optionalId(body.assignedTo, "responsable");
  const assignedTo = requestedAssignee || firstStep?.default_assignee_id || userId;
  if (!activeUser(db, assignedTo)) throw new TasksError(400, "El responsable no está disponible.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO workflow_tasks
      (folio, flow_id, title, description, module, entity_type, entity_id, assigned_to,
        priority, current_step, due_date, created_by, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(placeholder("TAR"), flowId, requiredText(body.title, 220, "El título"), text(body.description, 2000),
        moduleName(body.module), text(body.entityType, 100), text(body.entityId, 100) || null, assignedTo,
        enumValue(body.priority, ["low", "medium", "high", "critical"], "medium"), firstStep?.sequence || 0,
        optionalDate(body.dueDate, "La fecha límite"), userId, userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("TAR-", id);
    db.prepare("UPDATE workflow_tasks SET folio = ? WHERE id = ?").run(folio, id);
    insertDecision(db, { taskId: id, action: "assigned", toUserId: assignedTo, step: firstStep?.sequence || 0,
      comment: firstStep ? `Asignada en etapa ${firstStep.name}` : "Tarea asignada", actorId: userId });
    return { id, folio };
  });
}

export function addComment(db, id, body, userId) {
  const task = db.prepare("SELECT id, folio FROM workflow_tasks WHERE id = ?").get(id);
  if (!task) throw new TasksError(404, "Tarea no encontrada.");
  const comment = requiredText(body.comment, 2000, "El comentario");
  const result = db.prepare("INSERT INTO workflow_task_comments (task_id, comment, created_by) VALUES (?, ?, ?)").run(id, comment, userId);
  insertDecision(db, { taskId: id, action: "commented", comment, actorId: userId });
  return { id: Number(result.lastInsertRowid), folio: task.folio };
}

export function taskAction(db, id, body, userId) {
  const action = String(body.action || "");
  return transaction(db, () => {
    const task = db.prepare("SELECT * FROM workflow_tasks WHERE id = ?").get(id);
    if (!task) throw new TasksError(404, "Tarea no encontrada.");
    if (["started", "submitted", "completed", "approved", "rejected"].includes(action) && task.assigned_to !== userId)
      throw new TasksError(403, "Solo el responsable actual puede realizar esta acción.");
    if (action === "started") {
      requireStatus(task, ["pending"], "iniciar");
      updateTask(db, id, { status: "in_progress", userId });
      insertDecision(db, { taskId: id, action, step: task.current_step, actorId: userId });
    } else if (action === "submitted") {
      requireStatus(task, ["pending", "in_progress"], "enviar a aprobación");
      updateTask(db, id, { status: "submitted", userId });
      insertDecision(db, { taskId: id, action, step: task.current_step, comment: text(body.comment, 1000), actorId: userId });
    } else if (action === "approved") {
      requireStatus(task, ["submitted"], "aprobar");
      requireApprovalLevel(db, task, userId);
      approveTask(db, task, body, userId);
    } else if (action === "rejected") {
      requireStatus(task, ["submitted"], "rechazar");
      requireApprovalLevel(db, task, userId);
      const comment = requiredText(body.comment, 1500, "El motivo del rechazo");
      db.prepare("UPDATE workflow_tasks SET status = 'rejected', completed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
      db.prepare("INSERT INTO workflow_task_comments (task_id, comment, comment_type, created_by) VALUES (?, ?, 'rejection', ?)").run(id, comment, userId);
      insertDecision(db, { taskId: id, action, step: task.current_step, fromUserId: task.assigned_to, comment, actorId: userId });
    } else if (action === "reassigned") {
      requireStatus(task, ["pending", "in_progress", "submitted"], "reasignar");
      const toUserId = positiveId(body.toUserId, "nuevo responsable");
      if (!activeUser(db, toUserId)) throw new TasksError(400, "El nuevo responsable no está disponible.");
      const comment = requiredText(body.comment, 1000, "El motivo de la reasignación");
      db.prepare("UPDATE workflow_tasks SET assigned_to = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(toUserId, userId, id);
      db.prepare("INSERT INTO workflow_task_comments (task_id, comment, comment_type, created_by) VALUES (?, ?, 'reassignment', ?)").run(id, comment, userId);
      insertDecision(db, { taskId: id, action, step: task.current_step, fromUserId: task.assigned_to, toUserId, comment, actorId: userId });
    } else if (action === "completed") {
      requireStatus(task, ["pending", "in_progress"], "completar");
      if (task.flow_id) throw new TasksError(409, "Esta tarea debe enviarse al flujo de aprobación.");
      db.prepare("UPDATE workflow_tasks SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
      insertDecision(db, { taskId: id, action, comment: text(body.comment, 1000), actorId: userId });
    } else if (action === "cancelled") {
      requireStatus(task, ["pending", "in_progress", "submitted"], "cancelar");
      db.prepare("UPDATE workflow_tasks SET status = 'cancelled', completed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
      insertDecision(db, { taskId: id, action, step: task.current_step, comment: text(body.comment, 1000), actorId: userId });
    } else throw new TasksError(400, "Acción de tarea no reconocida.");
    const updated = db.prepare("SELECT status, assigned_to, current_step FROM workflow_tasks WHERE id = ?").get(id);
    return { id, folio: task.folio, ...updated };
  });
}

function approveTask(db, task, body, userId) {
  const comment = text(body.comment, 1500);
  if (!task.flow_id) {
    db.prepare("UPDATE workflow_tasks SET status = 'approved', completed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, task.id);
    insertDecision(db, { taskId: task.id, action: "approved", step: task.current_step, fromUserId: task.assigned_to, comment, actorId: userId });
    return;
  }
  const steps = db.prepare("SELECT * FROM approval_flow_steps WHERE flow_id = ? ORDER BY sequence").all(task.flow_id);
  const currentIndex = steps.findIndex((step) => step.sequence === task.current_step);
  const next = currentIndex >= 0 ? steps[currentIndex + 1] : null;
  if (next) {
    const nextAssignee = next.default_assignee_id || task.assigned_to;
    db.prepare("UPDATE workflow_tasks SET status = 'submitted', current_step = ?, assigned_to = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(next.sequence, nextAssignee, userId, task.id);
    insertDecision(db, { taskId: task.id, action: "approved", step: task.current_step, fromUserId: task.assigned_to,
      toUserId: nextAssignee, comment: comment || `Avanza a ${next.name}`, actorId: userId });
  } else {
    db.prepare("UPDATE workflow_tasks SET status = 'approved', completed_at = CURRENT_TIMESTAMP, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, task.id);
    insertDecision(db, { taskId: task.id, action: "approved", step: task.current_step, fromUserId: task.assigned_to, comment, actorId: userId });
  }
}

function requireApprovalLevel(db, task, userId) {
  if (!task.flow_id) return;
  const step = db.prepare("SELECT required_level FROM approval_flow_steps WHERE flow_id = ? AND sequence = ?").get(task.flow_id, task.current_step);
  const actorLevel = Number(db.prepare(`SELECT COALESCE(MAX(r.level), 1) AS value FROM user_roles ur
    JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = ?`).get(userId).value);
  if (step && actorLevel < Number(step.required_level)) throw new TasksError(403, `Esta etapa requiere nivel ${step.required_level} o superior.`);
}

function updateTask(db, id, { status, userId }) {
  db.prepare("UPDATE workflow_tasks SET status = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, userId, id);
}
function insertDecision(db, { taskId, action, step = 0, fromUserId = null, toUserId = null, comment = "", actorId }) {
  db.prepare(`INSERT INTO workflow_decisions
    (task_id, action, step_number, from_user_id, to_user_id, comment, decided_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(taskId, action, step, fromUserId, toUserId, comment, actorId);
}
function requireStatus(task, allowed, action) { if (!allowed.includes(task.status)) throw new TasksError(409, `La tarea no se puede ${action} en su estado actual.`); }
function activeUser(db, id) { return Boolean(db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(id)); }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const value = work(); db.exec("COMMIT"); return value; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value, label) { const number = Number(value); if (!Number.isInteger(number) || number < 1) throw new TasksError(400, `Selecciona un ${label} válido.`); return number; }
function optionalId(value, label) { return value == null || value === "" ? null : positiveId(value, label); }
function integerRange(value, min, max, label) { const number = Number(value); if (!Number.isInteger(number) || number < min || number > max) throw new TasksError(400, `${label} no es válido.`); return number; }
function requiredText(value, max, label) { const result = text(value, max); if (!result) throw new TasksError(400, `${label} es obligatorio.`); return result; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, values, fallback) { return values.includes(value) ? value : fallback; }
function moduleName(value) { const result = text(value, 60).toLowerCase().replace(/[^a-z0-9_-]/g, ""); return result || "general"; }
function optionalDate(value, label) { if (value == null || value === "") return null; const result = String(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new TasksError(400, `${label} no es válida.`); return result; }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id, padding = 6) { return `${prefix}${String(id).padStart(padding, "0")}`; }

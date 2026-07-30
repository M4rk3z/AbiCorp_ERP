export class QualityError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function options(db) {
  return {
    items: db.prepare(`SELECT i.id, i.sku, i.name, u.symbol AS unit_symbol
      FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id WHERE i.is_active = 1 ORDER BY i.name`).all(),
    plans: db.prepare(`SELECT p.id, p.folio, p.name, p.inspection_type, p.item_id, i.sku, i.name AS item_name,
      COUNT(c.id) AS check_count FROM quality_inspection_plans p LEFT JOIN items i ON i.id = p.item_id
      LEFT JOIN quality_plan_checks c ON c.plan_id = p.id WHERE p.is_active = 1 GROUP BY p.id ORDER BY p.name`).all(),
    orders: db.prepare(`SELECT o.id, o.folio, o.item_id, o.status, i.sku, i.name AS item_name
      FROM production_orders o JOIN items i ON i.id = o.item_id
      WHERE o.status IN ('released','in_progress','paused','completed') ORDER BY o.id DESC`).all(),
    warehouses: db.prepare("SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY name").all(),
    lots: db.prepare("SELECT id, item_id, lot_number, status FROM inventory_lots WHERE status IN ('active','quarantine') ORDER BY id DESC").all(),
    users: db.prepare("SELECT id, full_name FROM users WHERE status = 'active' ORDER BY full_name").all(),
    inspections: db.prepare("SELECT id, folio, item_id, status FROM quality_inspections ORDER BY id DESC LIMIT 100").all(),
    nonconformities: db.prepare("SELECT id, folio, status FROM quality_nonconformities WHERE status NOT IN ('closed','cancelled') ORDER BY id DESC").all(),
  };
}

export function control(db) {
  const plans = db.prepare(`SELECT p.*, i.sku, i.name AS item_name, COUNT(c.id) AS check_count
    FROM quality_inspection_plans p LEFT JOIN items i ON i.id = p.item_id
    LEFT JOIN quality_plan_checks c ON c.plan_id = p.id GROUP BY p.id ORDER BY p.id DESC`).all();
  const inspections = db.prepare(`SELECT q.*, i.sku, i.name AS item_name, p.name AS plan_name, o.folio AS order_folio,
    w.name AS warehouse_name, lot.lot_number, u.full_name AS inspected_by_name,
    (SELECT COUNT(*) FROM quality_inspection_results r WHERE r.inspection_id = q.id) AS result_count,
    (SELECT COUNT(*) FROM quality_inspection_results r WHERE r.inspection_id = q.id AND r.is_conforming = 0) AS failed_count
    FROM quality_inspections q JOIN items i ON i.id = q.item_id
    LEFT JOIN quality_inspection_plans p ON p.id = q.plan_id LEFT JOIN production_orders o ON o.id = q.production_order_id
    LEFT JOIN warehouses w ON w.id = q.warehouse_id LEFT JOIN inventory_lots lot ON lot.id = q.lot_id
    LEFT JOIN users u ON u.id = q.inspected_by ORDER BY q.id DESC`).all();
  const nonconformities = db.prepare(`SELECT n.*, i.sku, i.name AS item_name, q.folio AS inspection_folio,
    o.folio AS order_folio, COUNT(a.id) AS action_count,
    SUM(CASE WHEN a.status IN ('verified','closed') THEN 1 ELSE 0 END) AS completed_actions
    FROM quality_nonconformities n JOIN items i ON i.id = n.item_id
    LEFT JOIN quality_inspections q ON q.id = n.inspection_id LEFT JOIN production_orders o ON o.id = n.production_order_id
    LEFT JOIN quality_corrective_actions a ON a.nonconformity_id = n.id GROUP BY n.id ORDER BY n.id DESC`).all();
  const actions = db.prepare(`SELECT a.*, n.folio AS nonconformity_folio, i.sku, i.name AS item_name,
    u.full_name AS owner_name FROM quality_corrective_actions a
    JOIN quality_nonconformities n ON n.id = a.nonconformity_id JOIN items i ON i.id = n.item_id
    LEFT JOIN users u ON u.id = a.owner_id ORDER BY a.id DESC`).all();
  return { plans, inspections, nonconformities, actions };
}

export function createPlan(db, body, userId) {
  const name = requiredText(body.name, 120, "El nombre del plan");
  const inspectionType = enumRequired(body.inspectionType, ["receipt", "process", "final"], "tipo de inspección");
  const itemId = optionalId(body.itemId);
  if (itemId) validateItem(db, itemId);
  const sampleSize = positiveNumber(body.sampleSize ?? 1, "El tamaño de muestra");
  const acceptanceLimit = nonNegativeNumber(body.acceptanceLimit ?? 0, "El límite de aceptación");
  const checks = Array.isArray(body.checks) ? body.checks.map((row, index) => cleanCheck(row, index)) : [];
  if (!checks.length) throw new QualityError(400, "Agrega al menos una característica al plan.");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO quality_inspection_plans
      (folio, name, inspection_type, item_id, sample_size, acceptance_limit, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(placeholder("PLC"), name, inspectionType, itemId, sampleSize,
        acceptanceLimit, text(body.notes, 500), userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("PLC-", id);
    db.prepare("UPDATE quality_inspection_plans SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare(`INSERT INTO quality_plan_checks
      (plan_id, sequence, characteristic, check_type, min_value, max_value, unit, is_required)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const check of checks) insert.run(id, check.sequence, check.characteristic, check.checkType,
      check.minValue, check.maxValue, check.unit, check.isRequired);
    return { id, folio };
  });
}

export function createInspection(db, body, userId) {
  const planId = positiveId(body.planId, "plan de inspección");
  const plan = db.prepare("SELECT * FROM quality_inspection_plans WHERE id = ? AND is_active = 1").get(planId);
  if (!plan) throw new QualityError(404, "Plan de inspección no encontrado.");
  const itemId = body.itemId ? positiveId(body.itemId, "artículo") : plan.item_id;
  if (!itemId) throw new QualityError(400, "Selecciona el artículo a inspeccionar.");
  validateItem(db, itemId);
  if (plan.item_id && Number(plan.item_id) !== itemId) throw new QualityError(400, "El artículo no corresponde al plan seleccionado.");
  const productionOrderId = optionalId(body.productionOrderId);
  if (productionOrderId) {
    const order = db.prepare("SELECT item_id FROM production_orders WHERE id = ?").get(productionOrderId);
    if (!order || Number(order.item_id) !== itemId) throw new QualityError(400, "La orden no corresponde al artículo inspeccionado.");
  }
  const quantityInspected = positiveNumber(body.quantityInspected ?? plan.sample_size, "La cantidad inspeccionada");
  return transaction(db, () => {
    const result = db.prepare(`INSERT INTO quality_inspections
      (folio, plan_id, inspection_type, item_id, production_order_id, inventory_movement_id,
       warehouse_id, lot_id, quantity_inspected, status, notes, inspected_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
      .run(placeholder("INS"), planId, plan.inspection_type, itemId, productionOrderId, optionalId(body.inventoryMovementId),
        optionalId(body.warehouseId), optionalId(body.lotId), quantityInspected, text(body.notes, 500), userId);
    const id = Number(result.lastInsertRowid);
    const folio = autoFolio("INS-", id);
    db.prepare("UPDATE quality_inspections SET folio = ? WHERE id = ?").run(folio, id);
    db.prepare(`INSERT INTO quality_inspection_results (inspection_id, check_id, characteristic)
      SELECT ?, id, characteristic FROM quality_plan_checks WHERE plan_id = ? ORDER BY sequence`).run(id, planId);
    return { id, folio };
  });
}

export function inspectionDetail(db, id) {
  const inspection = db.prepare(`SELECT q.*, i.sku, i.name AS item_name, u.symbol AS unit_symbol,
    p.folio AS plan_folio, p.name AS plan_name, p.acceptance_limit, o.folio AS order_folio,
    w.name AS warehouse_name, lot.lot_number
    FROM quality_inspections q JOIN items i ON i.id = q.item_id
    LEFT JOIN units_of_measure u ON u.id = i.unit_id LEFT JOIN quality_inspection_plans p ON p.id = q.plan_id
    LEFT JOIN production_orders o ON o.id = q.production_order_id LEFT JOIN warehouses w ON w.id = q.warehouse_id
    LEFT JOIN inventory_lots lot ON lot.id = q.lot_id WHERE q.id = ?`).get(id);
  if (!inspection) throw new QualityError(404, "Inspección no encontrada.");
  const results = db.prepare(`SELECT r.*, c.sequence, c.check_type, c.min_value, c.max_value, c.unit, c.is_required
    FROM quality_inspection_results r LEFT JOIN quality_plan_checks c ON c.id = r.check_id
    WHERE r.inspection_id = ? ORDER BY c.sequence, r.id`).all(id);
  const nonconformities = db.prepare("SELECT * FROM quality_nonconformities WHERE inspection_id = ? ORDER BY id DESC").all(id);
  return { inspection, results, nonconformities };
}

export function recordResults(db, id, body, userId) {
  const inspection = db.prepare("SELECT q.*, p.acceptance_limit FROM quality_inspections q LEFT JOIN quality_inspection_plans p ON p.id = q.plan_id WHERE q.id = ?").get(id);
  if (!inspection) throw new QualityError(404, "Inspección no encontrada.");
  if (!["pending", "in_progress"].includes(inspection.status)) throw new QualityError(409, "La inspección ya no admite resultados.");
  const input = Array.isArray(body.results) ? body.results : [];
  const existing = db.prepare(`SELECT r.*, c.check_type, c.min_value, c.max_value, c.is_required
    FROM quality_inspection_results r LEFT JOIN quality_plan_checks c ON c.id = r.check_id WHERE r.inspection_id = ?`).all(id);
  if (!existing.length) throw new QualityError(409, "El plan no tiene características configuradas.");
  const byId = new Map(input.map((row) => [Number(row.id), row]));
  let failed = 0;
  return transaction(db, () => {
    const update = db.prepare("UPDATE quality_inspection_results SET measured_value = ?, is_conforming = ?, notes = ? WHERE id = ? AND inspection_id = ?");
    for (const result of existing) {
      const row = byId.get(result.id);
      if (!row && result.is_required) throw new QualityError(400, `Captura la característica ${result.characteristic}.`);
      const measured = text(row?.measuredValue, 120);
      const conforming = evaluate(result, measured, row?.isConforming);
      if (!conforming) failed += 1;
      update.run(measured, conforming ? 1 : 0, text(row?.notes, 300), result.id, id);
    }
    const rejected = nonNegativeNumber(body.quantityRejected ?? 0, "La cantidad rechazada");
    if (rejected > Number(inspection.quantity_inspected)) throw new QualityError(400, "La cantidad rechazada supera lo inspeccionado.");
    const accepted = round(Number(inspection.quantity_inspected) - rejected);
    const status = failed > Number(inspection.acceptance_limit || 0) || rejected > 0 ? "rejected" : "approved";
    db.prepare(`UPDATE quality_inspections SET status = ?, quantity_accepted = ?, quantity_rejected = ?,
      inspected_by = ?, inspected_at = CURRENT_TIMESTAMP, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(status, accepted, rejected, userId, text(body.notes, 500) || inspection.notes, id);
    return { id, folio: inspection.folio, status, failed };
  });
}

export function inspectionAction(db, id, body, userId) {
  const inspection = db.prepare("SELECT * FROM quality_inspections WHERE id = ?").get(id);
  if (!inspection) throw new QualityError(404, "Inspección no encontrada.");
  const action = String(body.action || "");
  if (action === "start") {
    if (inspection.status !== "pending") throw new QualityError(409, "La inspección ya fue iniciada.");
    db.prepare("UPDATE quality_inspections SET status = 'in_progress', inspected_by = ?, inspected_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
    return { id, folio: inspection.folio, status: "in_progress" };
  }
  if (action === "release") {
    if (inspection.status !== "approved") throw new QualityError(409, "Solo una inspección aprobada puede liberarse.");
    db.prepare("UPDATE quality_inspections SET status = 'released', released_by = ?, released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, id);
    if (inspection.lot_id) db.prepare("UPDATE inventory_lots SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'quarantine'").run(inspection.lot_id);
    return { id, folio: inspection.folio, status: "released" };
  }
  if (action === "cancel") {
    if (!["pending", "in_progress"].includes(inspection.status)) throw new QualityError(409, "La inspección ya no puede cancelarse.");
    db.prepare("UPDATE quality_inspections SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    return { id, folio: inspection.folio, status: "cancelled" };
  }
  throw new QualityError(400, "La acción de calidad no es válida.");
}

export function createNonconformity(db, body, userId) {
  const inspectionId = optionalId(body.inspectionId);
  const productionOrderId = optionalId(body.productionOrderId);
  let itemId = optionalId(body.itemId);
  if (inspectionId) {
    const inspection = db.prepare("SELECT item_id, production_order_id FROM quality_inspections WHERE id = ?").get(inspectionId);
    if (!inspection) throw new QualityError(404, "Inspección no encontrada.");
    itemId ||= inspection.item_id;
  }
  if (!itemId) throw new QualityError(400, "Selecciona el artículo no conforme.");
  validateItem(db, itemId);
  const description = requiredText(body.description, 700, "La descripción");
  const result = db.prepare(`INSERT INTO quality_nonconformities
    (folio, inspection_id, production_order_id, item_id, quantity, severity, disposition, description, root_cause, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(placeholder("NC"), inspectionId, productionOrderId, itemId, nonNegativeNumber(body.quantity ?? 0, "La cantidad"),
      enumValue(body.severity, ["minor", "major", "critical"], "minor"),
      enumValue(body.disposition, ["pending", "rework", "scrap", "return", "use_as_is"], "pending"),
      description, text(body.rootCause, 700), userId);
  const id = Number(result.lastInsertRowid);
  const folio = autoFolio("NC-", id);
  db.prepare("UPDATE quality_nonconformities SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function createCorrectiveAction(db, body, userId) {
  const nonconformityId = positiveId(body.nonconformityId, "no conformidad");
  if (!db.prepare("SELECT id FROM quality_nonconformities WHERE id = ?").get(nonconformityId)) throw new QualityError(404, "No conformidad no encontrada.");
  const action = requiredText(body.action, 700, "La acción correctiva");
  const result = db.prepare(`INSERT INTO quality_corrective_actions
    (folio, nonconformity_id, action, owner_id, due_date, created_by) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(placeholder("AC"), nonconformityId, action, optionalId(body.ownerId), optionalDate(body.dueDate), userId);
  const id = Number(result.lastInsertRowid);
  const folio = autoFolio("AC-", id);
  db.prepare("UPDATE quality_corrective_actions SET folio = ? WHERE id = ?").run(folio, id);
  db.prepare("UPDATE quality_nonconformities SET status = 'analysis', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'open'").run(nonconformityId);
  return { id, folio };
}

export function correctiveActionUpdate(db, id, body) {
  const existing = db.prepare("SELECT * FROM quality_corrective_actions WHERE id = ?").get(id);
  if (!existing) throw new QualityError(404, "Acción correctiva no encontrada.");
  const status = enumRequired(body.status, ["open", "in_progress", "verified", "closed", "cancelled"], "estado");
  db.prepare(`UPDATE quality_corrective_actions SET status = ?, verification = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(status, text(body.verification, 700), id);
  if (status === "closed") {
    const open = db.prepare("SELECT COUNT(*) AS value FROM quality_corrective_actions WHERE nonconformity_id = ? AND status NOT IN ('closed','cancelled')").get(existing.nonconformity_id).value;
    if (!open) db.prepare("UPDATE quality_nonconformities SET status = 'closed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.nonconformity_id);
  }
  return { id, folio: existing.folio, status };
}

function evaluate(result, measured, explicit) {
  if (result.check_type === "numeric") {
    const number = Number(measured);
    if (!Number.isFinite(number)) throw new QualityError(400, `${result.characteristic} requiere un valor numérico.`);
    if (result.min_value != null && number < Number(result.min_value)) return false;
    if (result.max_value != null && number > Number(result.max_value)) return false;
    return true;
  }
  if (result.check_type === "boolean" || result.check_type === "visual") return explicit === true || explicit === 1 || explicit === "true";
  return explicit == null ? Boolean(measured) : explicit === true || explicit === 1 || explicit === "true";
}

function cleanCheck(row, index) {
  const checkType = enumValue(row.checkType, ["numeric", "visual", "boolean", "text"], "numeric");
  const minValue = row.minValue == null || row.minValue === "" ? null : Number(row.minValue);
  const maxValue = row.maxValue == null || row.maxValue === "" ? null : Number(row.maxValue);
  if ((minValue != null && !Number.isFinite(minValue)) || (maxValue != null && !Number.isFinite(maxValue)) || (minValue != null && maxValue != null && minValue > maxValue))
    throw new QualityError(400, "Los límites de una característica no son válidos.");
  return { sequence: (index + 1) * 10, characteristic: requiredText(row.characteristic, 160, "La característica"),
    checkType, minValue, maxValue, unit: text(row.unit, 30), isRequired: row.isRequired === false ? 0 : 1 };
}

function validateItem(db, id) { if (!db.prepare("SELECT id FROM items WHERE id = ? AND is_active = 1").get(id)) throw new QualityError(400, "El artículo no está disponible."); }
function positiveId(value, label = "registro") { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new QualityError(400, `Selecciona un ${label} válido.`); return n; }
function optionalId(value) { return value == null || value === "" ? null : positiveId(value); }
function positiveNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new QualityError(400, `${label} debe ser mayor que cero.`); return round(n); }
function nonNegativeNumber(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new QualityError(400, `${label} no es válido.`); return round(n); }
function requiredText(value, max, label) { const v = text(value, max); if (!v) throw new QualityError(400, `${label} es obligatoria.`); return v; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function enumRequired(value, allowed, label) { if (!allowed.includes(value)) throw new QualityError(400, `Selecciona un ${label} válido.`); return value; }
function optionalDate(value) { if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new QualityError(400, "La fecha no es válida."); return String(value); }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
function placeholder(kind) { return `AUTO-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`; }
function autoFolio(prefix, id) { return `${prefix}${String(id).padStart(6, "0")}`; }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }

import * as inventory from "./inventory.js";
import { createHash } from "node:crypto";

export class MaintenanceError extends Error {
  constructor(status, message, details) { super(message); this.status = status; this.details = details; }
}

export function options(db) {
  return {
    equipment: db.prepare("SELECT id, folio, name, status, criticality, meter_type, meter_value FROM maintenance_equipment WHERE status <> 'retired' ORDER BY name").all(),
    plans: db.prepare("SELECT p.id, p.folio, p.equipment_id, p.name, p.next_due_date, p.annual_year, e.name AS equipment_name FROM maintenance_plans p JOIN maintenance_equipment e ON e.id = p.equipment_id WHERE p.is_active = 1 ORDER BY p.next_due_date, p.name").all(),
    schedule: db.prepare("SELECT s.id, s.plan_id, s.scheduled_date, s.status, p.equipment_id, p.name AS plan_name, p.folio AS plan_folio, e.name AS equipment_name FROM maintenance_plan_schedule s JOIN maintenance_plans p ON p.id = s.plan_id JOIN maintenance_equipment e ON e.id = p.equipment_id WHERE p.is_active = 1 AND s.order_id IS NULL ORDER BY s.scheduled_date").all(),
    suppliers: db.prepare("SELECT id, folio, name, specialty, hourly_rate FROM maintenance_suppliers WHERE is_active = 1 ORDER BY name").all(),
    requests: db.prepare("SELECT r.id, r.folio, r.equipment_id, r.request_type, r.priority, e.name AS equipment_name FROM maintenance_requests r JOIN maintenance_equipment e ON e.id = r.equipment_id WHERE r.status IN ('open','approved') ORDER BY r.id DESC").all(),
    resources: db.prepare("SELECT id, code, name, resource_type FROM resources WHERE status <> 'inactive' ORDER BY name").all(),
    employees: db.prepare("SELECT id, employee_number, full_name FROM employees WHERE status = 'active' ORDER BY full_name").all(),
    areas: db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1 ORDER BY name").all(),
    items: db.prepare("SELECT i.id, i.sku, i.name, i.standard_cost, u.symbol AS unit_symbol FROM items i LEFT JOIN units_of_measure u ON u.id = i.unit_id WHERE i.is_active = 1 AND i.inventory_tracked = 1 ORDER BY i.name").all(),
    warehouses: db.prepare("SELECT id, code, name FROM warehouses WHERE is_active = 1 ORDER BY name").all(),
    locations: db.prepare("SELECT id, warehouse_id, code, name FROM inventory_locations WHERE is_active = 1 ORDER BY name").all(),
    lots: db.prepare("SELECT id, item_id, lot_number FROM inventory_lots WHERE status = 'active' ORDER BY id DESC").all(),
  };
}

export function control(db) {
  const equipment = db.prepare("SELECT e.*, r.code AS resource_code, r.name AS resource_name, a.name AS area_name, (SELECT COUNT(*) FROM maintenance_orders o WHERE o.equipment_id = e.id) AS order_count, (SELECT MAX(o.actual_end) FROM maintenance_orders o WHERE o.equipment_id = e.id AND o.status IN ('completed','closed')) AS last_maintenance FROM maintenance_equipment e LEFT JOIN resources r ON r.id = e.resource_id LEFT JOIN areas a ON a.id = e.area_id ORDER BY e.id DESC").all();
  const plans = db.prepare("SELECT p.*, e.folio AS equipment_folio, e.name AS equipment_name, e.meter_value, e.meter_type, s.name AS supplier_name, CASE WHEN p.next_due_date IS NOT NULL AND p.next_due_date <= date('now') THEN 1 WHEN p.next_due_meter IS NOT NULL AND p.next_due_meter <= e.meter_value THEN 1 ELSE 0 END AS is_due FROM maintenance_plans p JOIN maintenance_equipment e ON e.id = p.equipment_id LEFT JOIN maintenance_suppliers s ON s.id = p.supplier_id ORDER BY p.is_active DESC, p.next_due_date, p.id DESC").all();
  const requests = db.prepare("SELECT r.*, e.folio AS equipment_folio, e.name AS equipment_name, u.full_name AS reported_by_name, (SELECT o.id FROM maintenance_orders o WHERE o.request_id = r.id ORDER BY o.id DESC LIMIT 1) AS order_id, (SELECT o.folio FROM maintenance_orders o WHERE o.request_id = r.id ORDER BY o.id DESC LIMIT 1) AS order_folio, (SELECT o.status FROM maintenance_orders o WHERE o.request_id = r.id ORDER BY o.id DESC LIMIT 1) AS order_status FROM maintenance_requests r JOIN maintenance_equipment e ON e.id = r.equipment_id LEFT JOIN users u ON u.id = r.reported_by ORDER BY r.id DESC").all();
  const orders = listOrders(db);
  const parts = db.prepare("SELECT p.*, o.folio AS order_folio, o.status AS order_status, e.folio AS equipment_folio, e.name AS equipment_name, i.sku, i.name AS item_name, u.symbol AS unit_symbol, w.name AS warehouse_name, l.name AS location_name FROM maintenance_order_parts p JOIN maintenance_orders o ON o.id = p.order_id JOIN maintenance_equipment e ON e.id = o.equipment_id JOIN items i ON i.id = p.item_id LEFT JOIN units_of_measure u ON u.id = i.unit_id LEFT JOIN warehouses w ON w.id = p.warehouse_id LEFT JOIN inventory_locations l ON l.id = p.location_id ORDER BY p.id DESC").all();
  const downtimes = db.prepare("SELECT d.*, e.folio AS equipment_folio, e.name AS equipment_name, e.downtime_cost_per_hour, ROUND(CAST(d.duration_minutes / 60.0 * e.downtime_cost_per_hour AS NUMERIC), 2) AS downtime_cost, o.folio AS order_folio FROM maintenance_downtimes d JOIN maintenance_equipment e ON e.id = d.equipment_id LEFT JOIN maintenance_orders o ON o.id = d.order_id ORDER BY d.id DESC LIMIT 100").all();
  const history = db.prepare("SELECT h.*, e.folio AS equipment_folio, e.name AS equipment_name, o.folio AS order_folio, u.full_name AS created_by_name FROM maintenance_history h JOIN maintenance_equipment e ON e.id = h.equipment_id LEFT JOIN maintenance_orders o ON o.id = h.order_id LEFT JOIN users u ON u.id = h.created_by ORDER BY h.id DESC LIMIT 30").all();
  const suppliers = db.prepare("SELECT s.*, (SELECT COUNT(*) FROM maintenance_orders o WHERE o.supplier_id = s.id) AS order_count, (SELECT COALESCE(SUM(o.external_cost), 0) FROM maintenance_orders o WHERE o.supplier_id = s.id) AS accumulated_cost FROM maintenance_suppliers s ORDER BY s.is_active DESC, s.name").all();
  const programImports = db.prepare(`SELECT i.*, u.full_name AS imported_by_name
    FROM maintenance_program_imports i
    LEFT JOIN users u ON u.id = i.imported_by
    ORDER BY i.annual_year DESC, i.id DESC`).all();
  const annualSchedule = db.prepare(`SELECT ps.*, p.folio AS plan_folio, p.name AS plan_name, p.annual_year, p.iso_reference,
      e.folio AS equipment_folio, e.name AS equipment_name, o.folio AS order_folio, o.status AS order_status,
      CASE WHEN o.status IN ('completed','closed') THEN 'completed'
           WHEN ps.order_id IS NOT NULL THEN 'ot_created'
           WHEN ps.scheduled_date < date('now') THEN 'overdue'
           ELSE ps.status END AS effective_status
    FROM maintenance_plan_schedule ps
    JOIN maintenance_plans p ON p.id = ps.plan_id
    JOIN maintenance_equipment e ON e.id = p.equipment_id
    LEFT JOIN maintenance_orders o ON o.id = ps.order_id
    ORDER BY ps.scheduled_date, p.name`).all();
  const currentYear = new Date().getFullYear();
  const yearSchedule = annualSchedule.filter((row) => Number(String(row.scheduled_date).slice(0, 4)) === currentYear);
  const dueSchedule = yearSchedule.filter((row) => row.scheduled_date <= today());
  const completedSchedule = dueSchedule.filter((row) => row.effective_status === "completed");
  const compliance = {
    year: currentYear,
    programmed: yearSchedule.length,
    due: dueSchedule.length,
    completed: completedSchedule.length,
    overdue: dueSchedule.filter((row) => row.effective_status === "overdue").length,
    percent: dueSchedule.length ? Math.round(completedSchedule.length / dueSchedule.length * 1000) / 10 : 0,
  };
  const costs = {
    labor: round(orders.reduce((sum, row) => sum + Number(row.labor_cost || 0), 0)),
    external: round(orders.reduce((sum, row) => sum + Number(row.external_cost || 0), 0)),
    parts: round(orders.reduce((sum, row) => sum + Number(row.parts_cost || 0), 0)),
    downtime: round(orders.reduce((sum, row) => sum + Number(row.downtime_cost || 0), 0)),
    total: round(orders.reduce((sum, row) => sum + Number(row.total_cost || 0), 0)),
  };
  return { equipment, plans, requests, orders, parts, downtimes, history, suppliers, programImports, annualSchedule, compliance, costs };
}

function validateAnnualProgram(db, body) {
  const content = typeof body.content === "string" ? body.content : "";
  if (!content.trim()) throw new MaintenanceError(400, "Selecciona una plantilla CSV con información.");
  if (Buffer.byteLength(content, "utf8") > 2 * 1024 * 1024) throw new MaintenanceError(413, "La plantilla supera el límite de 2 MB.");

  const table = parseCsv(content);
  if (table.length < 2) throw new MaintenanceError(400, "La plantilla no contiene filas para cargar.");
  const aliases = {
    anio: "year", ano: "year",
    folio_equipo: "equipmentFolio", equipo_folio: "equipmentFolio",
    actividad: "activity",
    frecuencia: "frequencyType", tipo_frecuencia: "frequencyType",
    cada: "frequencyValue", frecuencia_valor: "frequencyValue",
    primera_fecha: "firstDate",
    horas_estimadas: "estimatedHours",
    referencia_iso: "isoReference",
    folio_proveedor: "supplierFolio", proveedor_folio: "supplierFolio",
    instrucciones: "instructions",
  };
  const mappedHeaders = table[0].map((header) => aliases[normalizeHeader(header)] || null);
  const requiredHeaders = ["year", "equipmentFolio", "activity", "frequencyType", "frequencyValue", "firstDate"];
  const missing = requiredHeaders.filter((field) => !mappedHeaders.includes(field));
  if (missing.length) {
    const labels = { year: "AÑO", equipmentFolio: "FOLIO_EQUIPO", activity: "ACTIVIDAD", frequencyType: "FRECUENCIA", frequencyValue: "CADA", firstDate: "PRIMERA_FECHA" };
    throw new MaintenanceError(400, `Faltan columnas obligatorias: ${missing.map((field) => labels[field]).join(", ")}.`);
  }

  const equipment = new Map(db.prepare("SELECT id, folio, name FROM maintenance_equipment WHERE status <> 'retired'").all().map((row) => [String(row.folio).toUpperCase(), row]));
  const suppliers = new Map(db.prepare("SELECT id, folio, name FROM maintenance_suppliers WHERE is_active = 1").all().map((row) => [String(row.folio).toUpperCase(), row]));
  const errors = [];
  const rows = [];
  const previewRows = [];
  const years = new Set();
  const duplicates = new Set();

  table.slice(1).forEach((cells, index) => {
    if (cells.every((cell) => !String(cell).trim())) return;
    const source = {};
    mappedHeaders.forEach((field, column) => { if (field) source[field] = String(cells[column] ?? "").trim(); });
    const rowNumber = index + 2;
    const rowErrors = [];
    const year = Number(source.year);
    const equipmentFolio = String(source.equipmentFolio || "").toUpperCase();
    const equipmentRecord = equipment.get(equipmentFolio);
    const activity = text(source.activity, 140);
    const frequencyType = normalizeFrequency(source.frequencyType);
    const frequencyValue = parseLocalizedNumber(source.frequencyValue);
    const firstDate = source.firstDate;
    const estimatedHours = source.estimatedHours === "" || source.estimatedHours == null ? 0 : parseLocalizedNumber(source.estimatedHours);
    const supplierFolio = String(source.supplierFolio || "").toUpperCase();
    const supplier = supplierFolio ? suppliers.get(supplierFolio) : null;

    if (!Number.isInteger(year) || year < 2020 || year > 2100) rowErrors.push("AÑO debe ser un año válido.");
    else years.add(year);
    if (!equipmentRecord) rowErrors.push(`No existe el equipo ${equipmentFolio || "(vacío)"}.`);
    if (!activity) rowErrors.push("ACTIVIDAD es obligatoria.");
    if (!frequencyType) rowErrors.push("FRECUENCIA debe ser DÍAS, SEMANAS o MESES.");
    if (!Number.isInteger(frequencyValue) || frequencyValue < 1) rowErrors.push("CADA debe ser un número entero mayor que cero.");
    if (!isIsoDate(firstDate)) rowErrors.push("PRIMERA_FECHA debe usar el formato AAAA-MM-DD.");
    else if (Number.isInteger(year) && Number(firstDate.slice(0, 4)) !== year) rowErrors.push("PRIMERA_FECHA debe pertenecer al año indicado.");
    if (!Number.isFinite(estimatedHours) || estimatedHours < 0) rowErrors.push("HORAS_ESTIMADAS debe ser cero o un número positivo.");
    if (supplierFolio && !supplier) rowErrors.push(`No existe el proveedor ${supplierFolio}.`);

    const duplicateKey = equipmentRecord && activity ? `${equipmentRecord.id}|${activity.toLocaleLowerCase("es")}` : "";
    if (duplicateKey && duplicates.has(duplicateKey)) rowErrors.push("La actividad está repetida para el mismo equipo dentro del archivo.");
    if (duplicateKey) duplicates.add(duplicateKey);
    if (equipmentRecord && activity && Number.isInteger(year)) {
      const existingPlan = db.prepare("SELECT folio FROM maintenance_plans WHERE equipment_id = ? AND annual_year = ? AND lower(trim(name)) = lower(trim(?)) AND is_active = 1").get(equipmentRecord.id, year, activity);
      if (existingPlan) rowErrors.push(`Ya existe el plan ${existingPlan.folio} con esta actividad.`);
    }

    if (rowErrors.length) errors.push({ row: rowNumber, messages: rowErrors });
    else rows.push({
      rowNumber,
      equipmentId: equipmentRecord.id,
      equipmentFolio: equipmentRecord.folio,
      equipmentName: equipmentRecord.name,
      activity,
      frequencyType,
      frequencyValue,
      firstDate,
      estimatedHours: round(estimatedHours),
      isoReference: text(source.isoReference, 120),
      supplierId: supplier?.id || null,
      supplierFolio: supplier?.folio || "",
      supplierName: supplier?.name || "",
      instructions: text(source.instructions, 1200),
      scheduledDates: annualDates(firstDate, frequencyType, frequencyValue, year).length,
    });
    if (previewRows.length < 60) previewRows.push({
      row: rowNumber,
      equipment: equipmentRecord ? `${equipmentRecord.folio} · ${equipmentRecord.name}` : equipmentFolio,
      activity: activity || "Sin actividad",
      frequency: frequencyType ? `${frequencyLabel(frequencyType)} / ${frequencyValue || "—"}` : source.frequencyType,
      firstDate,
      status: rowErrors.length ? "error" : "ready",
      messages: rowErrors,
    });
  });

  if (!rows.length && !errors.length) errors.push({ row: 0, messages: ["El archivo no contiene filas con información."] });
  if (years.size > 1) errors.unshift({ row: 0, messages: ["Todas las filas deben pertenecer al mismo año."] });
  const year = years.size === 1 ? [...years][0] : Number(body.year) || new Date().getFullYear();
  const existingImport = db.prepare("SELECT id, folio, annual_year, original_name, row_count, plans_created, schedule_count, created_at FROM maintenance_program_imports WHERE annual_year = ?").get(year) || null;
  return {
    year,
    locked: Boolean(existingImport),
    existingImport,
    sourceRows: table.length - 1,
    validRows: rows.length,
    equipmentCount: new Set(rows.map((row) => row.equipmentId)).size,
    scheduleCount: rows.reduce((sum, row) => sum + row.scheduledDates, 0),
    errors,
    previewRows,
    rows,
  };
}

function parseCsv(content) {
  const source = String(content).replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] || "";
  const delimiter = countOutsideQuotes(firstLine, ";") >= countOutsideQuotes(firstLine, ",") ? ";" : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((cells) => cells.some((value) => String(value).trim()));
}

function countOutsideQuotes(value, token) {
  let count = 0, quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (!quoted && value[index] === token) count += 1;
  }
  return count;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function normalizeFrequency(value) {
  const normalized = normalizeHeader(value);
  return ({ dia: "days", dias: "days", day: "days", days: "days", semana: "weeks", semanas: "weeks", week: "weeks", weeks: "weeks", mes: "months", meses: "months", month: "months", months: "months" })[normalized] || null;
}

function frequencyLabel(value) {
  return ({ days: "Días", weeks: "Semanas", months: "Meses" })[value] || value;
}

function parseLocalizedNumber(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  return normalized === "" ? NaN : Number(normalized);
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function createEquipment(db, body, userId) {
  const name = requiredText(body.name, 140, "El nombre del equipo");
  const resourceId = optionalId(body.resourceId);
  if (resourceId && !db.prepare("SELECT id FROM resources WHERE id = ?").get(resourceId)) throw new MaintenanceError(400, "El recurso vinculado no existe.");
  const result = db.prepare("INSERT INTO maintenance_equipment (folio, resource_id, name, category, manufacturer, model, serial_number, area_id, physical_location, criticality, status, meter_type, meter_value, acquisition_date, notes, downtime_cost_per_hour, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'operational', ?, ?, ?, ?, ?, ?)")
    .run(placeholder("EQU"), resourceId, name, text(body.category, 80), text(body.manufacturer, 100), text(body.model, 100), text(body.serialNumber, 120), optionalId(body.areaId), text(body.physicalLocation, 160), enumValue(body.criticality, ["low","medium","high","critical"], "medium"), enumValue(body.meterType, ["none","hours","cycles","kilometers"], "none"), nonNegative(body.meterValue || 0, "La lectura inicial"), optionalDate(body.acquisitionDate), text(body.notes, 500), nonNegative(body.downtimeCostPerHour || 0, "El costo por hora de paro"), userId);
  const id = Number(result.lastInsertRowid), folio = autoFolio("EQU-", id);
  db.prepare("UPDATE maintenance_equipment SET folio = ? WHERE id = ?").run(folio, id);
  addHistory(db, id, null, null, "equipment_created", "Equipo registrado", body, userId);
  return { id, folio };
}

export function createPlan(db, body, userId) {
  const equipmentId = positiveId(body.equipmentId, "equipo");
  requireEquipment(db, equipmentId);
  const name = requiredText(body.name, 140, "El nombre del plan");
  const type = enumRequired(body.frequencyType, ["days","weeks","months","meter"], "frecuencia");
  const value = positive(body.frequencyValue, "La frecuencia");
  if (type === "meter" && (body.nextDueMeter == null || body.nextDueMeter === "")) throw new MaintenanceError(400, "Captura la próxima lectura del medidor.");
  const nextDueDate = optionalDate(body.nextDueDate);
  if (type !== "meter" && !nextDueDate) throw new MaintenanceError(400, "Captura la primera fecha del programa anual.");
  const annualYear = integerRange(body.annualYear || nextDueDate?.slice(0, 4) || new Date().getFullYear(), 2020, 2100, "El año del programa");
  const supplierId = optionalId(body.supplierId);
  requireSupplier(db, supplierId);
  return transaction(db, () => {
    const result = db.prepare("INSERT INTO maintenance_plans (folio, equipment_id, name, frequency_type, frequency_value, next_due_date, next_due_meter, estimated_hours, instructions, annual_year, iso_reference, supplier_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(placeholder("PMP"), equipmentId, name, type, value, nextDueDate, optionalNumber(body.nextDueMeter), nonNegative(body.estimatedHours || 0, "Las horas estimadas"), text(body.instructions, 1200), annualYear, text(body.isoReference, 120), supplierId, userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("PMP-", id);
    db.prepare("UPDATE maintenance_plans SET folio = ? WHERE id = ?").run(folio, id);
    const dates = type === "meter" ? [] : annualDates(nextDueDate, type, value, annualYear);
    const insertDate = db.prepare("INSERT OR IGNORE INTO maintenance_plan_schedule (plan_id, scheduled_date) VALUES (?, ?)");
    for (const date of dates) insertDate.run(id, date);
    addHistory(db, equipmentId, null, null, "plan_created", "Programa anual " + folio + " creado", body, userId);
    return { id, folio, programmedDates: dates.length };
  });
}

export function previewAnnualProgram(db, body) {
  return validateAnnualProgram(db, body);
}

export function importAnnualProgram(db, body, userId) {
  const preview = validateAnnualProgram(db, body);
  if (preview.locked) throw new MaintenanceError(409, `El programa anual ${preview.year} ya fue cargado. Solo se permite una carga masiva por año.`);
  if (preview.errors.length) throw new MaintenanceError(400, "Corrige los errores del archivo antes de cargar el programa.", { errors: preview.errors });

  return transaction(db, () => {
    const importResult = db.prepare(`INSERT INTO maintenance_program_imports
      (folio, annual_year, original_name, file_checksum, row_count, imported_by)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(placeholder("PAM"), preview.year, text(body.fileName, 240), createHash("sha256").update(String(body.content || ""), "utf8").digest("hex"), preview.rows.length, userId);
    const importId = Number(importResult.lastInsertRowid);
    const importFolio = autoFolio("PAM-", importId);
    db.prepare("UPDATE maintenance_program_imports SET folio = ? WHERE id = ?").run(importFolio, importId);

    const insertPlan = db.prepare(`INSERT INTO maintenance_plans
      (folio, equipment_id, name, frequency_type, frequency_value, next_due_date, estimated_hours, instructions, annual_year, iso_reference, supplier_id, import_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insertDate = db.prepare("INSERT OR IGNORE INTO maintenance_plan_schedule (plan_id, scheduled_date) VALUES (?, ?)");
    let scheduleCount = 0;
    const planFolios = [];
    for (const row of preview.rows) {
      const planResult = insertPlan.run(placeholder("PMP"), row.equipmentId, row.activity, row.frequencyType, row.frequencyValue, row.firstDate, row.estimatedHours, row.instructions, preview.year, row.isoReference, row.supplierId, importId, userId);
      const planId = Number(planResult.lastInsertRowid);
      const planFolio = autoFolio("PMP-", planId);
      db.prepare("UPDATE maintenance_plans SET folio = ? WHERE id = ?").run(planFolio, planId);
      planFolios.push(planFolio);
      const dates = annualDates(row.firstDate, row.frequencyType, row.frequencyValue, preview.year);
      for (const date of dates) {
        insertDate.run(planId, date);
        scheduleCount += 1;
      }
      addHistory(db, row.equipmentId, null, null, "plan_imported", `Plan ${planFolio} cargado desde ${importFolio}`, { importFolio, sourceRow: row.rowNumber }, userId);
    }
    db.prepare("UPDATE maintenance_program_imports SET plans_created = ?, schedule_count = ? WHERE id = ?").run(preview.rows.length, scheduleCount, importId);
    return { id: importId, folio: importFolio, year: preview.year, plansCreated: preview.rows.length, scheduleCount, planFolios };
  });
}

export function createSupplier(db, body, userId) {
  const name = requiredText(body.name, 160, "El nombre del proveedor");
  const result = db.prepare("INSERT INTO maintenance_suppliers (folio, name, contact_name, phone, email, specialty, hourly_rate, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(placeholder("PMV"), name, text(body.contactName, 140), text(body.phone, 40), text(body.email, 180), text(body.specialty, 180), nonNegative(body.hourlyRate || 0, "La tarifa por hora"), userId);
  const id = Number(result.lastInsertRowid), folio = autoFolio("PMV-", id);
  db.prepare("UPDATE maintenance_suppliers SET folio = ? WHERE id = ?").run(folio, id);
  return { id, folio };
}

export function createRequest(db, body, userId) {
  const equipmentId = positiveId(body.equipmentId, "equipo");
  requireEquipment(db, equipmentId);
  const failure = requiredText(body.failureDescription, 1000, "La descripción de la falla");
  const result = db.prepare("INSERT INTO maintenance_requests (folio, equipment_id, request_type, priority, failure_description, downtime_required, requested_at, reported_by, notes) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), ?, ?)")
    .run(placeholder("SOL"), equipmentId, enumValue(body.requestType, ["corrective","emergency","inspection","improvement"], "corrective"), enumValue(body.priority, ["low","medium","high","critical"], "medium"), failure, body.downtimeRequired ? 1 : 0, optionalDateTime(body.requestedAt), userId, text(body.notes, 500));
  const id = Number(result.lastInsertRowid), folio = autoFolio("SOL-", id);
  db.prepare("UPDATE maintenance_requests SET folio = ? WHERE id = ?").run(folio, id);
  addHistory(db, equipmentId, null, id, "request_created", "Solicitud " + folio + ": " + failure, body, userId);
  return { id, folio };
}

export function createOrder(db, body, userId) {
  const requestId = optionalId(body.requestId), scheduleId = optionalId(body.scheduleId);
  const schedule = scheduleId ? db.prepare("SELECT s.*, p.equipment_id FROM maintenance_plan_schedule s JOIN maintenance_plans p ON p.id = s.plan_id WHERE s.id = ? AND s.order_id IS NULL AND s.status <> 'cancelled'").get(scheduleId) : null;
  if (scheduleId && !schedule) throw new MaintenanceError(409, "La fecha programada ya tiene una OT o no está disponible.");
  const planId = optionalId(body.planId) || schedule?.plan_id || null;
  const request = requestId ? db.prepare("SELECT * FROM maintenance_requests WHERE id = ? AND status IN ('open','approved')").get(requestId) : null;
  const plan = planId ? db.prepare("SELECT * FROM maintenance_plans WHERE id = ? AND is_active = 1").get(planId) : null;
  let equipmentId = optionalId(body.equipmentId) || request?.equipment_id || schedule?.equipment_id || plan?.equipment_id;
  if (!equipmentId) throw new MaintenanceError(400, "Selecciona el equipo.");
  requireEquipment(db, equipmentId);
  if (request && request.equipment_id !== equipmentId || plan && plan.equipment_id !== equipmentId) throw new MaintenanceError(400, "El origen no corresponde al equipo.");
  const supplierId = optionalId(body.supplierId) || plan?.supplier_id || null;
  requireSupplier(db, supplierId);
  const orderType = enumValue(body.orderType, ["preventive","corrective","emergency","inspection"], plan ? "preventive" : request?.request_type === "emergency" ? "emergency" : "corrective");
  const parts = Array.isArray(body.parts) ? body.parts.map(cleanPart) : [];
  return transaction(db, () => {
    const result = db.prepare("INSERT INTO maintenance_orders (folio, request_id, plan_id, equipment_id, order_type, priority, assigned_resource_id, technician_id, scheduled_start, scheduled_end, notes, schedule_id, supplier_id, external_cost, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(placeholder("OTM"), requestId, planId, equipmentId, orderType, enumValue(body.priority, ["low","medium","high","critical"], request?.priority || "medium"), optionalId(body.assignedResourceId), optionalId(body.technicianId), optionalDateTime(body.scheduledStart || (schedule?.scheduled_date ? schedule.scheduled_date + "T08:00" : null)), optionalDateTime(body.scheduledEnd), text(body.notes, 700), scheduleId, supplierId, nonNegative(body.externalCost || 0, "El costo externo"), userId);
    const id = Number(result.lastInsertRowid), folio = autoFolio("OTM-", id);
    db.prepare("UPDATE maintenance_orders SET folio = ? WHERE id = ?").run(folio, id);
    const insert = db.prepare("INSERT INTO maintenance_order_parts (order_id, item_id, planned_quantity, notes) VALUES (?, ?, ?, ?)");
    for (const part of parts) insert.run(id, part.itemId, part.quantity, part.notes);
    if (requestId) db.prepare("UPDATE maintenance_requests SET status = 'converted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(requestId);
    if (scheduleId) db.prepare("UPDATE maintenance_plan_schedule SET status = 'ot_created', order_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id, scheduleId);
    addHistory(db, equipmentId, id, requestId, "order_created", "Orden " + folio + " creada", body, userId);
    return { id, folio };
  });
}

export function orderDetail(db, id) {
  const order = db.prepare(`SELECT o.*, e.folio AS equipment_folio, e.name AS equipment_name, e.status AS equipment_status, e.meter_type, e.meter_value, e.downtime_cost_per_hour,
      r.folio AS request_folio, p.folio AS plan_folio, p.name AS plan_name, p.iso_reference, res.name AS resource_name, emp.full_name AS technician_name,
      s.name AS supplier_name,
      (SELECT COALESCE(SUM(x.used_quantity * i.standard_cost),0) FROM maintenance_order_parts x JOIN items i ON i.id = x.item_id WHERE x.order_id = o.id) AS parts_cost,
      (SELECT COALESCE(SUM(d.duration_minutes),0) FROM maintenance_downtimes d WHERE d.order_id = o.id) AS downtime_minutes,
      (SELECT COALESCE(SUM(d.duration_minutes),0) / 60.0 * e.downtime_cost_per_hour FROM maintenance_downtimes d WHERE d.order_id = o.id) AS downtime_cost
    FROM maintenance_orders o
    JOIN maintenance_equipment e ON e.id = o.equipment_id
    LEFT JOIN maintenance_requests r ON r.id = o.request_id
    LEFT JOIN maintenance_plans p ON p.id = o.plan_id
    LEFT JOIN resources res ON res.id = o.assigned_resource_id
    LEFT JOIN employees emp ON emp.id = o.technician_id
    LEFT JOIN maintenance_suppliers s ON s.id = o.supplier_id
    WHERE o.id = ?`).get(id);
  if (!order) throw new MaintenanceError(404, "Orden de mantenimiento no encontrada.");
  order.total_cost = round(Number(order.labor_cost || 0) + Number(order.external_cost || 0) + Number(order.parts_cost || 0) + Number(order.downtime_cost || 0));
  const parts = db.prepare("SELECT p.*, i.sku, i.name AS item_name, i.standard_cost, p.used_quantity * i.standard_cost AS line_cost, u.symbol AS unit_symbol FROM maintenance_order_parts p JOIN items i ON i.id = p.item_id LEFT JOIN units_of_measure u ON u.id = i.unit_id WHERE p.order_id = ? ORDER BY p.id").all(id);
  const downtimes = db.prepare("SELECT * FROM maintenance_downtimes WHERE order_id = ? ORDER BY id DESC").all(id);
  const history = db.prepare("SELECT h.*, u.full_name AS created_by_name FROM maintenance_history h LEFT JOIN users u ON u.id = h.created_by WHERE h.order_id = ? ORDER BY h.id DESC").all(id);
  return { order, parts, downtimes, history };
}

export function equipmentHistory(db, id) {
  const equipment = db.prepare("SELECT e.*, r.name AS resource_name, a.name AS area_name FROM maintenance_equipment e LEFT JOIN resources r ON r.id = e.resource_id LEFT JOIN areas a ON a.id = e.area_id WHERE e.id = ?").get(id);
  if (!equipment) throw new MaintenanceError(404, "Equipo no encontrado.");
  const history = db.prepare("SELECT h.*, o.folio AS order_folio, r.folio AS request_folio, u.full_name AS created_by_name FROM maintenance_history h LEFT JOIN maintenance_orders o ON o.id = h.order_id LEFT JOIN maintenance_requests r ON r.id = h.request_id LEFT JOIN users u ON u.id = h.created_by WHERE h.equipment_id = ? ORDER BY h.id DESC").all(id);
  return { equipment, history };
}

export function orderAction(db, id, body, userId) {
  const order = db.prepare("SELECT * FROM maintenance_orders WHERE id = ?").get(id);
  if (!order) throw new MaintenanceError(404, "Orden de mantenimiento no encontrada.");
  const action = String(body.action || "");
  if (action === "approve") return transition(db, order, ["draft"], "approved", "Orden aprobada", userId);
  if (action === "start") return startOrder(db, order, body, userId);
  if (action === "pause") return transition(db, order, ["in_progress"], "paused", "Trabajo pausado", userId);
  if (action === "resume") return transition(db, order, ["paused"], "in_progress", "Trabajo reanudado", userId);
  if (action === "use_part") return usePart(db, order, body, userId);
  if (action === "downtime_start") return startDowntime(db, order, body, userId);
  if (action === "downtime_end") return endDowntime(db, order, body, userId);
  if (action === "complete") return completeOrder(db, order, body, userId);
  if (action === "close") return closeOrder(db, order, body, userId);
  if (action === "cancel") return transition(db, order, ["draft","approved"], "cancelled", "Orden cancelada", userId);
  throw new MaintenanceError(400, "La acción de mantenimiento no es válida.");
}

function listOrders(db) {
  const rows = db.prepare(`SELECT o.*, e.folio AS equipment_folio, e.name AS equipment_name, e.criticality, e.downtime_cost_per_hour,
      req.folio AS request_folio, p.folio AS plan_folio, p.iso_reference, res.name AS resource_name, emp.full_name AS technician_name, sup.name AS supplier_name,
      (SELECT COALESCE(SUM(used_quantity),0) FROM maintenance_order_parts x WHERE x.order_id = o.id) AS used_parts,
      (SELECT COALESCE(SUM(x.used_quantity * i.standard_cost),0) FROM maintenance_order_parts x JOIN items i ON i.id = x.item_id WHERE x.order_id = o.id) AS parts_cost,
      (SELECT COALESCE(SUM(duration_minutes),0) FROM maintenance_downtimes d WHERE d.order_id = o.id) AS downtime_minutes
    FROM maintenance_orders o
    JOIN maintenance_equipment e ON e.id = o.equipment_id
    LEFT JOIN maintenance_requests req ON req.id = o.request_id
    LEFT JOIN maintenance_plans p ON p.id = o.plan_id
    LEFT JOIN resources res ON res.id = o.assigned_resource_id
    LEFT JOIN employees emp ON emp.id = o.technician_id
    LEFT JOIN maintenance_suppliers sup ON sup.id = o.supplier_id
    ORDER BY o.id DESC`).all();
  return rows.map((row) => {
    row.downtime_cost = round(Number(row.downtime_minutes || 0) / 60 * Number(row.downtime_cost_per_hour || 0));
    row.total_cost = round(Number(row.labor_cost || 0) + Number(row.external_cost || 0) + Number(row.parts_cost || 0) + row.downtime_cost);
    return row;
  });
}

function transition(db, order, allowed, status, summary, userId) {
  if (!allowed.includes(order.status)) throw new MaintenanceError(409, "La orden no puede cambiar a ese estado.");
  db.prepare("UPDATE maintenance_orders SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, order.id);
  addHistory(db, order.equipment_id, order.id, order.request_id, status, summary, null, userId);
  return { id: order.id, folio: order.folio, status };
}

function startOrder(db, order, body, userId) {
  if (order.status !== "approved") throw new MaintenanceError(409, "Primero aprueba la orden.");
  db.prepare("UPDATE maintenance_orders SET status = 'in_progress', actual_start = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.id);
  db.prepare("UPDATE maintenance_equipment SET status = 'maintenance', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.equipment_id);
  addHistory(db, order.equipment_id, order.id, order.request_id, "order_started", "Mantenimiento iniciado", body, userId);
  const request = order.request_id ? db.prepare("SELECT downtime_required FROM maintenance_requests WHERE id = ?").get(order.request_id) : null;
  if (request?.downtime_required || order.order_type === "emergency") startDowntime(db, { ...order, status: "in_progress" }, { reason: body.reason || "Paro por mantenimiento" }, userId);
  return { id: order.id, folio: order.folio, status: "in_progress" };
}

function usePart(db, order, body, userId) {
  if (!["in_progress","paused"].includes(order.status)) throw new MaintenanceError(409, "La orden debe estar en ejecución para consumir refacciones.");
  const itemId = positiveId(body.itemId, "refacción"), quantity = positive(body.quantity, "La cantidad utilizada");
  const movement = inventory.postExit(db, { itemId, quantity, fromWarehouseId: body.warehouseId, fromLocationId: body.locationId, lotId: body.lotId, reason: "Refacción de mantenimiento", reference: order.folio }, userId);
  const existing = db.prepare("SELECT id FROM maintenance_order_parts WHERE order_id = ? AND item_id = ?").get(order.id, itemId);
  if (existing) db.prepare("UPDATE maintenance_order_parts SET used_quantity = used_quantity + ?, warehouse_id = ?, location_id = ?, inventory_movement_id = ?, notes = ? WHERE id = ?").run(quantity, positiveId(body.warehouseId, "almacén"), optionalId(body.locationId), movement.id, text(body.notes, 300), existing.id);
  else db.prepare("INSERT INTO maintenance_order_parts (order_id, item_id, used_quantity, warehouse_id, location_id, inventory_movement_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?)").run(order.id, itemId, quantity, positiveId(body.warehouseId, "almacén"), optionalId(body.locationId), movement.id, text(body.notes, 300));
  addHistory(db, order.equipment_id, order.id, order.request_id, "part_used", "Refacción consumida", { itemId, quantity, movement: movement.folio }, userId);
  return { id: order.id, folio: order.folio, movement };
}

function startDowntime(db, order, body, userId) {
  if (!["approved","in_progress","paused"].includes(order.status)) throw new MaintenanceError(409, "La orden no admite un paro.");
  if (db.prepare("SELECT id FROM maintenance_downtimes WHERE equipment_id = ? AND status = 'open'").get(order.equipment_id)) throw new MaintenanceError(409, "El equipo ya tiene un paro abierto.");
  const result = db.prepare("INSERT INTO maintenance_downtimes (folio, equipment_id, order_id, reason, created_by) VALUES (?, ?, ?, ?, ?)").run(placeholder("PAR"), order.equipment_id, order.id, text(body.reason, 500) || "Paro por mantenimiento", userId);
  const id = Number(result.lastInsertRowid), folio = autoFolio("PAR-", id);
  db.prepare("UPDATE maintenance_downtimes SET folio = ? WHERE id = ?").run(folio, id);
  db.prepare("UPDATE maintenance_equipment SET status = 'stopped', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.equipment_id);
  addHistory(db, order.equipment_id, order.id, order.request_id, "downtime_started", "Paro " + folio + " iniciado", body, userId);
  return { id: order.id, folio: order.folio, downtimeFolio: folio, status: order.status };
}

function endDowntime(db, order, body, userId) {
  const downtime = db.prepare("SELECT * FROM maintenance_downtimes WHERE equipment_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(order.equipment_id);
  if (!downtime) throw new MaintenanceError(409, "El equipo no tiene un paro abierto.");
  const end = body.endedAt ? new Date(body.endedAt) : new Date();
  if (Number.isNaN(end.getTime())) throw new MaintenanceError(400, "La fecha final no es válida.");
  const start = new Date(String(downtime.started_at).replace(" ", "T") + "Z");
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000 * 100) / 100);
  const endSql = end.toISOString().replace("T", " ").replace("Z", "");
  db.prepare("UPDATE maintenance_downtimes SET status = 'closed', ended_at = ?, duration_minutes = ? WHERE id = ?").run(endSql, minutes, downtime.id);
  db.prepare("UPDATE maintenance_equipment SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(["in_progress","paused"].includes(order.status) ? "maintenance" : "operational", order.equipment_id);
  addHistory(db, order.equipment_id, order.id, order.request_id, "downtime_ended", "Paro " + downtime.folio + " terminado: " + minutes + " min", body, userId);
  return { id: order.id, folio: order.folio, downtimeFolio: downtime.folio, minutes };
}

function completeOrder(db, order, body, userId) {
  if (!["in_progress","paused"].includes(order.status)) throw new MaintenanceError(409, "La orden no está en ejecución.");
  const work = requiredText(body.workPerformed, 1200, "El trabajo realizado");
  const hours = nonNegative(body.actualHours || 0, "Las horas reales");
  const open = db.prepare("SELECT id FROM maintenance_downtimes WHERE equipment_id = ? AND status = 'open'").get(order.equipment_id);
  if (open) endDowntime(db, order, {}, userId);
  db.prepare("UPDATE maintenance_orders SET status = 'completed', actual_end = CURRENT_TIMESTAMP, actual_hours = ?, labor_cost = ?, external_cost = ?, failure_found = ?, root_cause = ?, work_performed = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
    .run(hours, nonNegative(body.laborCost || 0, "El costo de mano de obra"), nonNegative(body.externalCost ?? order.external_cost ?? 0, "El costo externo"), text(body.failureFound, 1000), text(body.rootCause, 1000), work, order.id);
  db.prepare("UPDATE maintenance_equipment SET status = 'operational', meter_value = COALESCE(?, meter_value), updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(optionalNumber(body.meterValue), order.equipment_id);
  addHistory(db, order.equipment_id, order.id, order.request_id, "order_completed", "Mantenimiento terminado: " + work, body, userId);
  return { id: order.id, folio: order.folio, status: "completed" };
}

function closeOrder(db, order, body, userId) {
  if (order.status !== "completed") throw new MaintenanceError(409, "La orden debe estar terminada antes de cerrarse.");
  db.prepare("UPDATE maintenance_orders SET status = 'closed', closed_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(userId, order.id);
  if (order.schedule_id) db.prepare("UPDATE maintenance_plan_schedule SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(order.schedule_id);
  if (order.plan_id) {
    const plan = db.prepare("SELECT * FROM maintenance_plans WHERE id = ?").get(order.plan_id);
    const nextDate = plan.frequency_type === "meter" ? plan.next_due_date : addFrequency(new Date(), plan.frequency_type, plan.frequency_value);
    const equipment = db.prepare("SELECT meter_value FROM maintenance_equipment WHERE id = ?").get(order.equipment_id);
    const nextMeter = plan.frequency_type === "meter" ? Number(equipment.meter_value) + Number(plan.frequency_value) : plan.next_due_meter;
    db.prepare("UPDATE maintenance_plans SET last_performed_at = CURRENT_TIMESTAMP, next_due_date = ?, next_due_meter = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(nextDate, nextMeter, plan.id);
  }
  addHistory(db, order.equipment_id, order.id, order.request_id, "order_closed", "Orden cerrada", body, userId);
  return { id: order.id, folio: order.folio, status: "closed" };
}

function cleanPart(row) { return { itemId: positiveId(row.itemId, "refacción"), quantity: positive(row.quantity, "La cantidad planeada"), notes: text(row.notes, 300) }; }
function requireEquipment(db, id) { if (!db.prepare("SELECT id FROM maintenance_equipment WHERE id = ? AND status <> 'retired'").get(id)) throw new MaintenanceError(404, "Equipo no encontrado o retirado."); }
function requireSupplier(db, id) { if (id && !db.prepare("SELECT id FROM maintenance_suppliers WHERE id = ? AND is_active = 1").get(id)) throw new MaintenanceError(404, "Proveedor de mantenimiento no encontrado."); }
function addHistory(db, equipmentId, orderId, requestId, type, summary, details, userId) { db.prepare("INSERT INTO maintenance_history (equipment_id, order_id, request_id, event_type, summary, details_json, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)").run(equipmentId, orderId || null, requestId || null, type, summary, details ? JSON.stringify(details) : null, userId); }
function addFrequency(date, type, value) { const next = new Date(date); if (type === "days") next.setDate(next.getDate() + Number(value)); if (type === "weeks") next.setDate(next.getDate() + Number(value) * 7); if (type === "months") next.setMonth(next.getMonth() + Number(value)); return next.toISOString().slice(0, 10); }
function annualDates(firstDate, type, value, year) {
  const dates = [];
  let cursor = new Date(firstDate + "T12:00:00Z");
  const step = Math.max(1, Math.round(Number(value)));
  while (cursor.getUTCFullYear() < year) {
    if (type === "days") cursor.setUTCDate(cursor.getUTCDate() + step);
    if (type === "weeks") cursor.setUTCDate(cursor.getUTCDate() + step * 7);
    if (type === "months") cursor.setUTCMonth(cursor.getUTCMonth() + step);
  }
  while (cursor.getUTCFullYear() === year && dates.length < 400) {
    dates.push(cursor.toISOString().slice(0, 10));
    if (type === "days") cursor.setUTCDate(cursor.getUTCDate() + step);
    if (type === "weeks") cursor.setUTCDate(cursor.getUTCDate() + step * 7);
    if (type === "months") cursor.setUTCMonth(cursor.getUTCMonth() + step);
  }
  return dates;
}
function positiveId(value, label = "registro") { const n = Number(value); if (!Number.isInteger(n) || n < 1) throw new MaintenanceError(400, "Selecciona un " + label + " válido."); return n; }
function optionalId(value) { return value == null || value === "" ? null : positiveId(value); }
function integerRange(value, min, max, label) { const n = Number(value); if (!Number.isInteger(n) || n < min || n > max) throw new MaintenanceError(400, label + " no es válido."); return n; }
function positive(value, label) { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new MaintenanceError(400, label + " debe ser mayor que cero."); return round(n); }
function nonNegative(value, label) { const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new MaintenanceError(400, label + " no es válido."); return round(n); }
function optionalNumber(value) { return value == null || value === "" ? null : nonNegative(value, "El valor"); }
function requiredText(value, max, label) { const v = text(value, max); if (!v) throw new MaintenanceError(400, label + " es obligatorio."); return v; }
function text(value, max) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : ""; }
function enumValue(value, allowed, fallback) { return allowed.includes(value) ? value : fallback; }
function enumRequired(value, allowed, label) { if (!allowed.includes(value)) throw new MaintenanceError(400, "Selecciona una " + label + " válida."); return value; }
function optionalDate(value) { if (!value) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) throw new MaintenanceError(400, "La fecha no es válida."); return String(value); }
function optionalDateTime(value) { if (!value) return null; const d = new Date(value); if (Number.isNaN(d.getTime())) throw new MaintenanceError(400, "La fecha y hora no son válidas."); return d.toISOString().replace("T", " ").replace("Z", ""); }
function round(value) { return Math.round((Number(value) + Number.EPSILON) * 1e6) / 1e6; }
function today() { return new Date().toISOString().slice(0, 10); }
function placeholder(kind) { return "AUTO-" + kind + "-" + Date.now() + "-" + Math.random().toString(36).slice(2); }
function autoFolio(prefix, id) { return prefix + String(id).padStart(6, "0"); }
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }

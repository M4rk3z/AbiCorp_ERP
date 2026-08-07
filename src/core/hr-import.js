import { createHash } from "node:crypto";
import { createPerson } from "./hr.js";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const MAX_IMPORT_ROWS = 500;
const PREVIEW_VERSION = 2;

const COLUMNS = [
  "nombre_completo", "curp", "rfc", "nss", "fecha_nacimiento", "correo", "telefono",
  "calle", "numero_exterior", "numero_interior", "colonia", "municipio", "estado",
  "codigo_postal", "pais", "contacto_emergencia", "telefono_emergencia",
  "parentesco_emergencia", "empresa_codigo", "centro_codigo", "departamento_codigo",
  "area_codigo", "puesto_codigo", "jefe_id_laboral", "fecha_ingreso", "tipo_contratacion",
  "turno_codigo", "tipo_contrato", "numero_contrato", "inicio_contrato", "fin_contrato",
  "periodicidad_nomina", "condicion_sindical", "salario_base", "moneda", "metodo_pago",
  "referencia_bancaria", "organizacion", "detalle_organizacion", "contacto_organizacion",
  "telefono_organizacion", "correo_organizacion", "asesor", "telefono_asesor",
  "correo_asesor", "inicio_servicio", "fin_servicio", "horas_requeridas", "notas",
];

const REQUIRED = new Map([
  ["nombre_completo", "Nombre completo"], ["curp", "CURP"], ["rfc", "RFC"], ["nss", "NSS"],
  ["fecha_nacimiento", "Fecha de nacimiento"], ["calle", "Calle"], ["colonia", "Colonia"],
  ["municipio", "Municipio"], ["estado", "Estado"], ["codigo_postal", "Código postal"],
  ["contacto_emergencia", "Contacto de emergencia"], ["telefono_emergencia", "Teléfono de emergencia"],
  ["fecha_ingreso", "Fecha de ingreso"], ["tipo_contratacion", "Tipo de contratación"],
  ["tipo_contrato", "Tipo de contrato"], ["periodicidad_nomina", "Periodicidad de nómina"],
]);

const CONFIRMABLE_ORGANIZATION_FIELDS = new Map([
  ["empresa_codigo", "Empresa"], ["centro_codigo", "Centro de trabajo"],
  ["departamento_codigo", "Departamento"], ["area_codigo", "Área"], ["puesto_codigo", "Puesto"],
]);

export class HrImportError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export async function previewEmployeeImport(db, body, userId) {
  expireOldPreviews(db);
  const file = importFile(body);
  const checksum = createHash("sha256").update(file.bytes).digest("hex");
  const completed = db.prepare(`SELECT id FROM hr_employee_import_batches
    WHERE checksum = ? AND status = 'completed' ORDER BY id DESC LIMIT 1`).get(checksum);
  if (completed) throw new HrImportError(409, `Este archivo ya fue importado en el lote ${completed.id}.`);
  const reusable = db.prepare(`SELECT * FROM hr_employee_import_batches
    WHERE checksum = ? AND status = 'preview' AND created_by = ? ORDER BY id DESC LIMIT 1`).get(checksum, userId);
  if (reusable) {
    const response = batchResponse(reusable);
    if (response.previewVersion === PREVIEW_VERSION) return response;
    db.prepare("UPDATE hr_employee_import_batches SET status = 'expired', rows_json = '[]' WHERE id = ?")
      .run(reusable.id);
  }

  const sourceRows = await spreadsheetRows(file);
  if (!sourceRows.length) throw new HrImportError(400, "La hoja Personal no contiene colaboradores.");
  if (sourceRows.length > MAX_IMPORT_ROWS)
    throw new HrImportError(413, `La carga admite un máximo de ${MAX_IMPORT_ROWS} colaboradores por lote.`);
  const context = importContext(db);
  const seen = { curp: new Map(), rfc: new Map(), nss: new Map(), email: new Map() };
  const validRows = [], previewRows = [], errors = [], warnings = [];

  sourceRows.forEach((source, index) => {
    const rowNumber = index + 2;
    const normalized = normalizedRow(source);
    const result = validateRow(normalized, rowNumber, context, seen);
    previewRows.push({ rowNumber, fullName: normalized.nombre_completo, curp: normalized.curp,
      companyCode: normalized.empresa_codigo, departmentCode: normalized.departamento_codigo,
      status: result.errors.length ? "error" : result.warnings.length ? "warning" : "valid",
      errors: result.errors, warnings: result.warnings });
    if (result.errors.length) errors.push({ rowNumber, fullName: normalized.nombre_completo, errors: result.errors });
    else {
      validRows.push(result.body);
      if (result.warnings.length) warnings.push({ rowNumber, fullName: normalized.nombre_completo, warnings: result.warnings });
    }
  });

  const result = db.prepare(`INSERT INTO hr_employee_import_batches
    (original_name, source_format, checksum, total_rows, valid_rows, error_rows,
     rows_json, errors_json, result_json, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(file.originalName, file.format, checksum, sourceRows.length, validRows.length, errors.length,
      JSON.stringify(validRows), JSON.stringify(errors), JSON.stringify({
        previewVersion: PREVIEW_VERSION, previewRows, warningRows: warnings.length, warnings,
      }), userId);
  return batchResponse(db.prepare("SELECT * FROM hr_employee_import_batches WHERE id = ?").get(Number(result.lastInsertRowid)));
}

export function commitEmployeeImport(db, batchId, userId, { confirmWarnings = false } = {}) {
  const id = positiveId(batchId);
  let batch = db.prepare("SELECT * FROM hr_employee_import_batches WHERE id = ? AND created_by = ?").get(id, userId);
  if (!batch) throw new HrImportError(404, "Lote de importación no encontrado.");
  if (batch.status === "completed") return batchResponse(batch);
  if (batch.status !== "preview") throw new HrImportError(409, "El lote ya no está disponible para confirmación.");
  if (Number(batch.error_rows) > 0)
    throw new HrImportError(409, "Corrige las filas marcadas y vuelve a cargar el archivo.");
  const preview = batchResponse(batch);
  if (preview.warningRows > 0 && !confirmWarnings)
    throw new HrImportError(409, "El lote contiene expedientes incompletos. Confirma expresamente que deseas importarlos con advertencias.");
  const claim = db.prepare(`UPDATE hr_employee_import_batches SET status = 'processing', confirmed_by = ?,
    confirmed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'preview'`).run(userId, id);
  if (Number(claim.changes || 0) !== 1) throw new HrImportError(409, "El lote ya está siendo procesado.");
  const rows = safeJson(batch.rows_json, []);
  try {
    const imported = transaction(db, () => {
      const results = rows.map((row) => createPerson(db, row, userId, { withinTransaction: true }));
      const payload = { imported: results.length, employees: results };
      db.prepare(`UPDATE hr_employee_import_batches SET status = 'completed', imported_rows = ?,
        rows_json = '[]', result_json = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(results.length, JSON.stringify(payload), id);
      return payload;
    });
    batch = db.prepare("SELECT * FROM hr_employee_import_batches WHERE id = ?").get(id);
    return { ...batchResponse(batch), ...imported };
  } catch (error) {
    db.prepare(`UPDATE hr_employee_import_batches SET status = 'failed', result_json = ?,
      rows_json = '[]', completed_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(JSON.stringify({ error: String(error?.message || "No fue posible importar el lote.") }), id);
    throw new HrImportError(409, `La carga fue cancelada sin guardar filas: ${error.message}`);
  }
}

export async function employeeImportTemplate(db) {
  const imported = await import("xlsx");
  const XLSX = imported.default || imported;
  const context = importContext(db);
  const workbook = XLSX.utils.book_new();
  const example = Object.fromEntries(COLUMNS.map((column) => [column, ""]));
  Object.assign(example, {
    nombre_completo: "EJEMPLO - BORRAR ESTA FILA", curp: "XEXX010101HNEXXXA4",
    rfc: "XAXX010101000", nss: "12345678901", fecha_nacimiento: "2001-01-01",
    correo: "persona@example.com", telefono: "5555555555", calle: "Calle ejemplo",
    colonia: "Centro", municipio: "Municipio", estado: "Estado", codigo_postal: "00000",
    pais: "México", contacto_emergencia: "Contacto ejemplo", telefono_emergencia: "5555555555",
    empresa_codigo: context.companies.values().next().value?.code || "EMP-00001",
    centro_codigo: context.centers.values().next().value?.code || "CTR-00001",
    departamento_codigo: context.departments.values().next().value?.code || "DEP-00001",
    area_codigo: context.areas.values().next().value?.code || "ARE-00001",
    puesto_codigo: context.positions.values().next().value?.code || "PUE-00001",
    fecha_ingreso: "2026-08-04", tipo_contratacion: "permanent",
    tipo_contrato: "permanent", periodicidad_nomina: "biweekly", moneda: "MXN",
  });
  const peopleSheet = XLSX.utils.json_to_sheet([example], { header: COLUMNS });
  peopleSheet["!cols"] = COLUMNS.map((column) => ({ wch: Math.min(28, Math.max(14, column.length + 2)) }));
  XLSX.utils.book_append_sheet(workbook, peopleSheet, "Personal");

  const catalogs = [];
  for (const [type, records] of [["empresa", context.companies], ["centro", context.centers],
    ["departamento", context.departments], ["área", context.areas], ["puesto", context.positions],
    ["turno", context.shifts]]) {
    for (const row of records.values()) catalogs.push({ tipo: type, codigo: row.code, nombre: row.name || row.legal_name });
  }
  const catalogSheet = XLSX.utils.json_to_sheet(catalogs, { header: ["tipo", "codigo", "nombre"] });
  catalogSheet["!cols"] = [{ wch: 18 }, { wch: 20 }, { wch: 38 }];
  XLSX.utils.book_append_sheet(workbook, catalogSheet, "Catalogos");
  const instructions = [
    ["CARGA MASIVA DE PERSONAL"],
    ["1", "Borra la fila de ejemplo de la hoja Personal."],
    ["2", "No cambies los encabezados. Usa fechas con formato yyyy-mm-dd."],
    ["3", "Usa los códigos exactos incluidos en la hoja Catalogos."],
    ["4", "Tipos de contratación: permanent, temporary, contractor o intern."],
    ["5", "Periodicidad: weekly, biweekly, monthly u other."],
    ["6", "La vista previa no guarda colaboradores; debes confirmar el lote."],
    ["7", "Los datos organizacionales faltantes generan advertencias y requieren confirmación expresa."],
    ["8", "Si una fila tiene un error bloqueante, no se importará ninguna."],
  ];
  const instructionSheet = XLSX.utils.aoa_to_sheet(instructions);
  instructionSheet["!cols"] = [{ wch: 8 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, instructionSheet, "Instrucciones");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx", compression: true });
}

function importContext(db) {
  return {
    companies: recordsMap(db.prepare("SELECT id, code, legal_name, trade_name FROM companies WHERE is_active = 1").all(), "legal_name"),
    centers: recordsMap(db.prepare("SELECT id, company_id, code, name FROM hr_work_centers WHERE is_active = 1").all()),
    departments: recordsMap(db.prepare("SELECT id, company_id, work_center_id, code, name FROM hr_departments WHERE is_active = 1").all()),
    areas: recordsMap(db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1").all()),
    positions: recordsMap(db.prepare("SELECT id, code, name FROM hr_job_positions WHERE is_active = 1").all()),
    shifts: recordsMap(db.prepare("SELECT id, code, name FROM hr_work_shifts WHERE is_active = 1").all()),
    managers: new Map(db.prepare("SELECT id, employee_number FROM employees WHERE status <> 'inactive'").all()
      .map((row) => [upper(row.employee_number), row])),
    existing: db.prepare(`SELECT e.email, fd.curp, fd.rfc, fd.nss FROM employees e
      LEFT JOIN hr_employee_fiscal_data fd ON fd.employee_id = e.id`).all(),
  };
}

function validateRow(row, rowNumber, context, seen) {
  const errors = [], warnings = [];
  for (const [key, label] of REQUIRED) if (!row[key]) errors.push(`${label} es obligatorio.`);
  for (const [key, label] of CONFIRMABLE_ORGANIZATION_FIELDS) {
    if (!row[key]) warnings.push(`${label} no fue indicado; el expediente quedará incompleto.`);
  }
  row.curp = upper(row.curp); row.rfc = upper(row.rfc); row.nss = text(row.nss);
  if (row.curp && !/^[A-Z0-9]{18}$/.test(row.curp)) errors.push("CURP debe contener 18 caracteres alfanuméricos.");
  if (row.rfc && !/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(row.rfc)) errors.push("RFC no tiene un formato válido.");
  if (row.nss && !/^\d{11}$/.test(row.nss)) errors.push("NSS debe contener 11 dígitos.");
  for (const [key, label] of [["fecha_nacimiento", "Fecha de nacimiento"], ["fecha_ingreso", "Fecha de ingreso"],
    ["inicio_contrato", "Inicio de contrato"], ["fin_contrato", "Fin de contrato"],
    ["inicio_servicio", "Inicio de servicio"], ["fin_servicio", "Fin de servicio"]]) {
    if (row[key] && !validDate(row[key])) errors.push(`${label} debe usar yyyy-mm-dd.`);
  }
  if (row.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.correo)) errors.push("El correo no es válido.");

  const employmentType = enumAlias(row.tipo_contratacion, {
    permanent: "permanent", permanente: "permanent", temporary: "temporary", temporal: "temporary",
    contractor: "contractor", contratista: "contractor", intern: "intern", practicante: "intern",
  });
  if (!employmentType) errors.push("Tipo de contratación no reconocido.");
  const payrollFrequency = enumAlias(row.periodicidad_nomina, {
    weekly: "weekly", semanal: "weekly", biweekly: "biweekly", quincenal: "biweekly",
    monthly: "monthly", mensual: "monthly", other: "other", otra: "other", otro: "other",
  });
  if (!payrollFrequency) errors.push("Periodicidad de nómina no reconocida.");

  const company = catalog(row.empresa_codigo, context.companies, "empresa", warnings, true);
  const center = catalog(row.centro_codigo, context.centers, "centro de trabajo", warnings, true);
  const department = catalog(row.departamento_codigo, context.departments, "departamento", warnings, true);
  const area = catalog(row.area_codigo, context.areas, "área", warnings, true);
  const position = catalog(row.puesto_codigo, context.positions, "puesto", warnings, true);
  const shift = row.turno_codigo ? catalog(row.turno_codigo, context.shifts, "turno", errors) : null;
  if (company && center && Number(center.company_id) !== Number(company.id)) errors.push("El centro no pertenece a la empresa.");
  if (company && department && Number(department.company_id) !== Number(company.id)) errors.push("El departamento no pertenece a la empresa.");
  if (department?.work_center_id && center && Number(department.work_center_id) !== Number(center.id))
    errors.push("El departamento no pertenece al centro de trabajo.");
  const manager = row.jefe_id_laboral ? context.managers.get(upper(row.jefe_id_laboral)) : null;
  if (row.jefe_id_laboral && !manager) errors.push(`No existe el jefe ${row.jefe_id_laboral}.`);
  if (employmentType === "temporary" && !row.fin_contrato) errors.push("Fin de contrato es obligatorio para personal temporal.");
  if (["contractor", "intern"].includes(employmentType)) {
    if (!row.organizacion) errors.push("Organización es obligatoria para contratistas y practicantes.");
    if (!row.inicio_servicio || !row.fin_servicio) errors.push("Inicio y fin de servicio son obligatorios.");
  }
  if (employmentType === "intern") {
    if (!row.asesor) errors.push("Asesor es obligatorio para practicantes.");
    if (!(Number(row.horas_requeridas) > 0)) errors.push("Horas requeridas debe ser mayor que cero.");
  }
  if (row.salario_base && (!Number.isFinite(Number(row.salario_base)) || Number(row.salario_base) < 0))
    errors.push("Salario base no es válido.");

  const existingValues = {
    curp: context.existing.map((item) => upper(item.curp)), rfc: context.existing.map((item) => upper(item.rfc)),
    nss: context.existing.map((item) => text(item.nss)), email: context.existing.map((item) => lower(item.email)),
  };
  for (const [key, value, label] of [["curp", row.curp, "CURP"], ["rfc", row.rfc, "RFC"],
    ["nss", row.nss, "NSS"], ["email", lower(row.correo), "correo"]]) {
    if (!value) continue;
    if (existingValues[key].includes(value)) errors.push(`${label} ya existe en otro expediente.`);
    if (seen[key].has(value)) errors.push(`${label} está repetido en las filas ${seen[key].get(value)} y ${rowNumber}.`);
    else seen[key].set(value, rowNumber);
  }

  return { errors, warnings, body: errors.length ? null : {
    fullName: row.nombre_completo, curp: row.curp, rfc: row.rfc, nss: row.nss,
    birthDate: row.fecha_nacimiento, email: row.correo, phone: row.telefono,
    street: row.calle, exteriorNumber: row.numero_exterior, interiorNumber: row.numero_interior,
    neighborhood: row.colonia, municipality: row.municipio, addressState: row.estado,
    postalCode: row.codigo_postal, country: row.pais || "México",
    emergencyContact: row.contacto_emergencia, emergencyPhone: row.telefono_emergencia,
    emergencyRelationship: row.parentesco_emergencia, companyId: company?.id, workCenterId: center?.id,
    departmentId: department?.id, areaId: area?.id, positionId: position?.id,
    managerEmployeeId: manager?.id || null, hireDate: row.fecha_ingreso, employmentType,
    workShiftId: shift?.id || null, contractType: row.tipo_contrato, contractNumber: row.numero_contrato,
    contractStartDate: row.inicio_contrato || row.fecha_ingreso, contractEndDate: row.fin_contrato,
    payrollFrequency, unionStatus: row.condicion_sindical, baseSalary: row.salario_base || 0,
    currencyCode: row.moneda || "MXN", paymentMethod: row.metodo_pago,
    bankReference: row.referencia_bancaria, organizationName: row.organizacion,
    organizationDetails: row.detalle_organizacion, organizationContactName: row.contacto_organizacion,
    organizationContactPhone: row.telefono_organizacion, organizationContactEmail: row.correo_organizacion,
    advisorName: row.asesor, advisorPhone: row.telefono_asesor, advisorEmail: row.correo_asesor,
    serviceStartDate: row.inicio_servicio, serviceEndDate: row.fin_servicio,
    requiredServiceHours: row.horas_requeridas || 0, notes: row.notas,
    changeReason: "Alta mediante carga masiva de personal",
  } };
}

async function spreadsheetRows(file) {
  try {
    const imported = await import("xlsx");
    const XLSX = imported.default || imported;
    const workbook = XLSX.read(file.bytes, { type: "buffer", cellDates: false, dense: true });
    const sheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === "personal") || workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false })
      .filter((row) => Object.values(row).some((value) => text(value)));
  } catch {
    throw new HrImportError(400, "El archivo no es una hoja CSV/XLSX válida.");
  }
}

function importFile(body) {
  const originalName = text(body?.originalName).slice(0, 240);
  const format = originalName.toLowerCase().endsWith(".csv") ? "csv"
    : originalName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "";
  if (!format) throw new HrImportError(400, "Utiliza un archivo CSV o XLSX.");
  const encoded = String(body?.contentBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new HrImportError(400, "El archivo no es válido.");
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw new HrImportError(400, "El archivo está vacío.");
  if (bytes.length > MAX_IMPORT_BYTES) throw new HrImportError(413, "El archivo no puede superar 5 MB.");
  return { originalName, format, bytes };
}

function normalizedRow(source) {
  const values = {};
  for (const [key, value] of Object.entries(source)) values[normalizeHeader(key)] = text(value);
  return Object.fromEntries(COLUMNS.map((column) => [column, values[column] || ""]));
}
function recordsMap(rows, fallbackName = "name") {
  return new Map(rows.map((row) => [upper(row.code), { ...row, name: row.name || row[fallbackName] || "" }]));
}
function catalog(code, records, label, messages, confirmable = false) {
  if (!code) return null;
  const record = records.get(upper(code));
  if (!record) messages.push(confirmable
    ? `No existe ${label} con código ${code}; se importará sin esa asignación.`
    : `No existe ${label} con código ${code}.`);
  return record || null;
}
function batchResponse(row) {
  const result = safeJson(row.result_json, {});
  return { id: Number(row.id), originalName: row.original_name, format: row.source_format,
    status: row.status, totalRows: Number(row.total_rows), validRows: Number(row.valid_rows),
    errorRows: Number(row.error_rows), importedRows: Number(row.imported_rows),
    errors: safeJson(row.errors_json, []), previewRows: result.previewRows || [],
    previewVersion: Number(result.previewVersion || 0), warningRows: Number(result.warningRows || 0),
    warnings: result.warnings || [],
    employees: result.employees || [], createdAt: row.created_at, completedAt: row.completed_at || null };
}
function expireOldPreviews(db) {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "");
  db.prepare(`UPDATE hr_employee_import_batches SET status = 'expired', rows_json = '[]', errors_json = '[]'
    WHERE status = 'preview' AND created_at < ?`).run(cutoff);
}
function transaction(db, work) { db.exec("BEGIN IMMEDIATE"); try { const result = work(); db.exec("COMMIT"); return result; } catch (error) { db.exec("ROLLBACK"); throw error; } }
function positiveId(value) { const id = Number(value); if (!Number.isInteger(id) || id < 1) throw new HrImportError(400, "Lote no válido."); return id; }
function enumAlias(value, aliases) { return aliases[lower(value)] || ""; }
function validDate(value) { const clean = String(value); const parsed = new Date(`${clean}T00:00:00Z`); return /^\d{4}-\d{2}-\d{2}$/.test(clean) && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === clean; }
function normalizeHeader(value) { return lower(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); }
function upper(value) { return text(value).toUpperCase(); }
function lower(value) { return text(value).toLowerCase(); }
function text(value) { return value == null ? "" : String(value).trim(); }
function safeJson(value, fallback) { try { return JSON.parse(value || ""); } catch { return fallback; } }

import { createHash, randomUUID } from "node:crypto";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { notify } from "./hr-portal.js";

const MAX_XML_BYTES = 4 * 1024 * 1024;
const MAX_PDF_BYTES = 7 * 1024 * 1024;
const UUID_PATTERN = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class PayrollCfdiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function parsePayrollCfdiXml(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(String(input ?? ""), "utf8");
  if (!bytes.length) throw new PayrollCfdiError(400, "El XML est\u00e1 vac\u00edo.");
  if (bytes.length > MAX_XML_BYTES) throw new PayrollCfdiError(413, "El XML supera el l\u00edmite de 4 MB.");
  const xml = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (xml.includes("\0")) throw new PayrollCfdiError(400, "El XML contiene bytes no v\u00e1lidos.");
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(xml))
    throw new PayrollCfdiError(400, "El XML contiene declaraciones no permitidas por seguridad.");
  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: false });
  if (validation !== true) throw new PayrollCfdiError(400, "El XML no tiene una estructura v\u00e1lida.", validation);

  let parsed;
  try {
    parsed = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      removeNSPrefix: true,
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: false,
      trimValues: true,
    }).parse(xml);
  } catch {
    throw new PayrollCfdiError(400, "No fue posible leer el XML del CFDI.");
  }

  const comprobante = first(parsed?.Comprobante);
  const emisor = first(comprobante?.Emisor);
  const receptor = first(comprobante?.Receptor);
  const complemento = first(comprobante?.Complemento);
  const nomina = first(complemento?.Nomina);
  const nominaReceptor = first(nomina?.Receptor);
  const timbre = first(complemento?.TimbreFiscalDigital);
  if (!comprobante || !emisor || !receptor || !nomina || !nominaReceptor || !timbre)
    throw new PayrollCfdiError(400, "El XML no contiene un CFDI de n\u00f3mina timbrado completo.");

  const cfdiVersion = attribute(comprobante, "Version");
  const payrollVersion = attribute(nomina, "Version");
  if (cfdiVersion !== "4.0") throw new PayrollCfdiError(400, "Solamente se admite CFDI 4.0.");
  if (payrollVersion !== "1.2") throw new PayrollCfdiError(400, "Solamente se admite el complemento de n\u00f3mina 1.2.");
  const uuid = attribute(timbre, "UUID").toUpperCase();
  if (!UUID_PATTERN.test(uuid)) throw new PayrollCfdiError(400, "El UUID del timbre fiscal no es v\u00e1lido.");
  const payrollType = attribute(nomina, "TipoNomina").toUpperCase();
  if (!['O', 'E'].includes(payrollType)) throw new PayrollCfdiError(400, "El tipo de n\u00f3mina del CFDI no es v\u00e1lido.");

  const paymentDate = requiredDate(attribute(nomina, "FechaPago"), "fecha de pago");
  const periodStart = requiredDate(attribute(nomina, "FechaInicialPago"), "inicio del periodo");
  const periodEnd = requiredDate(attribute(nomina, "FechaFinalPago"), "fin del periodo");
  if (periodEnd < periodStart) throw new PayrollCfdiError(400, "El periodo del CFDI tiene fechas invertidas.");
  const issuerRfc = normalizedIdentifier(attribute(emisor, "Rfc"));
  const receiverRfc = normalizedIdentifier(attribute(receptor, "Rfc"));
  if (!issuerRfc || !receiverRfc) throw new PayrollCfdiError(400, "El CFDI debe incluir los RFC del emisor y receptor.");

  return {
    uuid,
    cfdiVersion,
    payrollVersion,
    payrollType,
    issuerRfc,
    issuerName: text(attribute(emisor, "Nombre"), 240),
    receiverRfc,
    receiverName: text(attribute(receptor, "Nombre"), 240),
    receiverCurp: normalizedIdentifier(attribute(nominaReceptor, "Curp")),
    receiverEmployeeNumber: text(attribute(nominaReceptor, "NumEmpleado"), 80),
    receiverNss: normalizedIdentifier(attribute(nominaReceptor, "NumSeguridadSocial")),
    issuedAt: optionalDateTime(attribute(comprobante, "Fecha")),
    stampedAt: optionalDateTime(attribute(timbre, "FechaTimbrado")),
    paymentDate,
    periodStart,
    periodEnd,
    paidDays: nonNegativeNumber(attribute(nomina, "NumDiasPagados"), "d\u00edas pagados"),
    totalPerceptions: optionalMoney(attribute(nomina, "TotalPercepciones")),
    totalDeductions: optionalMoney(attribute(nomina, "TotalDeducciones")),
    totalOtherPayments: optionalMoney(attribute(nomina, "TotalOtrosPagos")),
    total: nonNegativeNumber(attribute(comprobante, "Total"), "total"),
    currencyCode: text(attribute(comprobante, "Moneda") || "MXN", 8).toUpperCase(),
    xmlChecksum: checksum(bytes),
  };
}

export function matchEmployee(db, cfdi) {
  const candidates = new Map();
  collectMatches(db, candidates, "employee_number", cfdi.receiverEmployeeNumber,
    `SELECT id, employee_number, full_name FROM employees WHERE UPPER(TRIM(employee_number)) = ?`);
  collectMatches(db, candidates, "rfc", cfdi.receiverRfc,
    `SELECT e.id, e.employee_number, e.full_name FROM employees e
     JOIN hr_employee_fiscal_data f ON f.employee_id = e.id WHERE UPPER(TRIM(f.rfc)) = ?`);
  collectMatches(db, candidates, "curp", cfdi.receiverCurp,
    `SELECT e.id, e.employee_number, e.full_name FROM employees e
     JOIN hr_employee_fiscal_data f ON f.employee_id = e.id WHERE UPPER(TRIM(f.curp)) = ?`);
  const matches = [...candidates.values()];
  if (!matches.length) return { status: "unmatched", method: "none", employee: null, candidates: [] };
  if (matches.length > 1) return { status: "ambiguous", method: "none", employee: null, candidates: matches };
  const employee = matches[0];
  const method = ["employee_number", "rfc", "curp"].find((value) => employee.methods.includes(value)) || "none";
  return { status: "associated", method, employee, candidates: matches };
}

export function createPeriod(db, body, userId = null) {
  const code = requiredText(body.code, 60, "El c\u00f3digo del periodo").toUpperCase();
  const frequency = enumValue(body.frequency, ["weekly", "biweekly", "monthly", "other"], "frecuencia");
  const startDate = requiredDate(body.startDate, "inicio del periodo");
  const endDate = requiredDate(body.endDate, "fin del periodo");
  const paymentDate = requiredDate(body.paymentDate, "fecha de pago");
  if (endDate < startDate) throw new PayrollCfdiError(400, "La fecha final no puede ser anterior a la inicial.");
  try {
    const result = db.prepare(`INSERT INTO payroll_periods
      (code, frequency, start_date, end_date, payment_date, status, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, frequency, startDate, endDate, paymentDate,
        enumOptional(body.status, ["draft", "open"], "open"), text(body.notes, 800), userId);
    return periodById(db, Number(result.lastInsertRowid));
  } catch (error) {
    if (isUniqueError(error)) throw new PayrollCfdiError(409, "Ya existe ese periodo o c\u00f3digo de n\u00f3mina.");
    throw error;
  }
}

export function control(db) {
  const periods = db.prepare(`SELECT * FROM payroll_periods ORDER BY payment_date DESC, id DESC`).all();
  const receipts = db.prepare(`SELECT r.*, e.employee_number, e.full_name AS employee_name,
      p.code AS period_code,
      (SELECT COUNT(*) FROM payroll_cfdi_files f WHERE f.receipt_id = r.id) AS file_count,
      (SELECT COUNT(*) FROM payroll_cfdi_clarifications c WHERE c.receipt_id = r.id AND c.status IN ('open', 'in_review')) AS open_clarifications
    FROM payroll_cfdi_receipts r
    LEFT JOIN employees e ON e.id = r.employee_id
    LEFT JOIN payroll_periods p ON p.id = r.period_id
    ORDER BY r.payment_date DESC, r.id DESC`).all();
  const batches = db.prepare(`SELECT * FROM payroll_cfdi_import_batches ORDER BY id DESC LIMIT 50`).all();
  return {
    periods,
    receipts,
    batches,
    indicators: {
      receipts: receipts.length,
      associated: receipts.filter((row) => row.association_status === "associated").length,
      unmatched: receipts.filter((row) => row.association_status === "unmatched").length,
      ambiguous: receipts.filter((row) => row.association_status === "ambiguous").length,
      pendingConfirmations: receipts.filter((row) => row.association_status === "associated" && !row.confirmed_at).length,
      openClarifications: receipts.reduce((total, row) => total + Number(row.open_clarifications || 0), 0),
    },
  };
}

export async function importReceipt(db, storage, body, userId = null, namespace = "default") {
  const xmlFile = requiredFile(body.xml, "XML", MAX_XML_BYTES, ["application/xml", "text/xml"]);
  const cfdi = parsePayrollCfdiXml(xmlFile.bytes);
  const duplicate = db.prepare("SELECT id, uuid FROM payroll_cfdi_receipts WHERE UPPER(uuid) = ?").get(cfdi.uuid);
  if (duplicate) throw new PayrollCfdiError(409, "Este UUID ya fue importado.", { receiptId: Number(duplicate.id), uuid: cfdi.uuid });
  const pdfFile = body.pdf ? requiredFile(body.pdf, "PDF", MAX_PDF_BYTES, ["application/pdf"], "%PDF-") : null;
  const periodId = optionalPeriod(db, body.periodId);
  const association = matchEmployee(db, cfdi);
  const folder = `${safeSegment(namespace)}/${cfdi.paymentDate.slice(0, 7)}/${cfdi.uuid}`;
  const stored = [];
  try {
    stored.push({ type: "xml", file: xmlFile,
      location: await storage.put(`${folder}/${randomUUID()}.xml`, xmlFile.bytes) });
    if (pdfFile) stored.push({ type: "pdf", file: pdfFile,
      location: await storage.put(`${folder}/${randomUUID()}.pdf`, pdfFile.bytes) });
  } catch (error) {
    await cleanupStored(storage, stored);
    throw error;
  }

  let receiptId;
  db.exec("BEGIN IMMEDIATE");
  try {
    const batch = db.prepare(`INSERT INTO payroll_cfdi_import_batches
      (period_id, source, file_count, imported_count, unmatched_count, ambiguous_count, created_by)
      VALUES (?, ?, ?, 1, ?, ?, ?)`)
      .run(periodId, body.source === "bulk" ? "bulk" : "individual", stored.length,
        association.status === "unmatched" ? 1 : 0, association.status === "ambiguous" ? 1 : 0, userId);
    const result = db.prepare(`INSERT INTO payroll_cfdi_receipts
      (period_id, import_batch_id, employee_id, association_status, association_method, uuid,
       cfdi_version, payroll_version, payroll_type, issuer_rfc, issuer_name, receiver_rfc,
       receiver_name, receiver_curp, receiver_employee_number, receiver_nss, issued_at, stamped_at,
       payment_date, period_start, period_end, paid_days, total_perceptions, total_deductions,
       total_other_payments, total, currency_code, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(periodId, Number(batch.lastInsertRowid), association.employee?.id || null, association.status,
        association.method, cfdi.uuid, cfdi.cfdiVersion, cfdi.payrollVersion, cfdi.payrollType,
        cfdi.issuerRfc, cfdi.issuerName, cfdi.receiverRfc, cfdi.receiverName, cfdi.receiverCurp,
        cfdi.receiverEmployeeNumber, cfdi.receiverNss, cfdi.issuedAt, cfdi.stampedAt, cfdi.paymentDate,
        cfdi.periodStart, cfdi.periodEnd, cfdi.paidDays, cfdi.totalPerceptions, cfdi.totalDeductions,
        cfdi.totalOtherPayments, cfdi.total, cfdi.currencyCode, userId);
    receiptId = Number(result.lastInsertRowid);
    const insertFile = db.prepare(`INSERT INTO payroll_cfdi_files
      (receipt_id, file_type, storage_provider, storage_key, original_name, mime_type, size_bytes, checksum, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const item of stored) insertFile.run(receiptId, item.type, item.location.provider, item.location.key,
      item.file.originalName, item.file.mimeType, item.file.bytes.length, checksum(item.file.bytes), userId);
    db.prepare(`INSERT INTO payroll_cfdi_association_history
      (receipt_id, employee_id, association_method, reason, changed_by) VALUES (?, ?, ?, ?, ?)`)
      .run(receiptId, association.employee?.id || null, association.method,
        association.status === "associated" ? "Asociaci\u00f3n autom\u00e1tica durante la importaci\u00f3n." :
          association.status === "ambiguous" ? "M\u00faltiples trabajadores coinciden con los identificadores fiscales." :
          "No se encontr\u00f3 un trabajador coincidente.", userId);
    if (association.employee) notify(db, association.employee.id, "Nuevo CFDI de n\u00f3mina disponible",
      `Tu recibo de pago del ${cfdi.paymentDate} ya est\u00e1 disponible para consulta.`, "action", "payroll_cfdi", receiptId, userId);
    if (association.employee) db.prepare("UPDATE payroll_cfdi_receipts SET notified_at = CURRENT_TIMESTAMP WHERE id = ?").run(receiptId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    await cleanupStored(storage, stored);
    if (isUniqueError(error)) throw new PayrollCfdiError(409, "Este UUID ya fue importado.");
    throw error;
  }
  return receiptById(db, receiptId);
}

export function associateReceipt(db, receiptId, employeeId, reason, userId = null) {
  const receipt = receiptById(db, receiptId);
  const employee = db.prepare("SELECT id, employee_number, full_name FROM employees WHERE id = ?").get(positiveId(employeeId, "trabajador"));
  if (!employee) throw new PayrollCfdiError(404, "Trabajador no encontrado.");
  const explanation = requiredText(reason, 500, "El motivo de la asociaci\u00f3n manual");
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`UPDATE payroll_cfdi_receipts SET employee_id = ?, association_status = 'associated',
      association_method = 'manual', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(employee.id, receipt.id);
    db.prepare(`INSERT INTO payroll_cfdi_association_history
      (receipt_id, previous_employee_id, employee_id, association_method, reason, changed_by)
      VALUES (?, ?, ?, 'manual', ?, ?)`)
      .run(receipt.id, receipt.employee_id, employee.id, explanation, userId);
    if (Number(receipt.employee_id || 0) !== Number(employee.id)) notify(db, employee.id, "Nuevo CFDI de n\u00f3mina disponible",
      `Tu recibo de pago del ${receipt.payment_date} ya est\u00e1 disponible para consulta.`, "action", "payroll_cfdi", receipt.id, userId);
    db.prepare("UPDATE payroll_cfdi_receipts SET notified_at = CURRENT_TIMESTAMP WHERE id = ?").run(receipt.id);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return receiptById(db, receipt.id);
}

export function receiptById(db, id) {
  const row = db.prepare(`SELECT r.*, e.employee_number, e.full_name AS employee_name,
      p.code AS period_code FROM payroll_cfdi_receipts r
      LEFT JOIN employees e ON e.id = r.employee_id LEFT JOIN payroll_periods p ON p.id = r.period_id
      WHERE r.id = ?`).get(positiveId(id, "CFDI"));
  if (!row) throw new PayrollCfdiError(404, "CFDI de n\u00f3mina no encontrado.");
  row.files = db.prepare(`SELECT id, file_type, original_name, mime_type, size_bytes, checksum, created_at
    FROM payroll_cfdi_files WHERE receipt_id = ? ORDER BY id`).all(row.id);
  return row;
}

export function receiptFile(db, receiptId, fileId = null) {
  const row = fileId == null
    ? db.prepare(`SELECT f.*, r.employee_id, r.uuid FROM payroll_cfdi_files f
        JOIN payroll_cfdi_receipts r ON r.id = f.receipt_id WHERE f.receipt_id = ? AND f.file_type = 'xml'`).get(receiptId)
    : db.prepare(`SELECT f.*, r.employee_id, r.uuid FROM payroll_cfdi_files f
        JOIN payroll_cfdi_receipts r ON r.id = f.receipt_id WHERE f.receipt_id = ? AND f.id = ?`).get(receiptId, fileId);
  if (!row) throw new PayrollCfdiError(404, "Archivo del CFDI no encontrado.");
  return row;
}

export function portalReceipts(db, employeeId) {
  const rows = db.prepare(`SELECT r.id, r.uuid, r.payroll_type, r.payment_date, r.period_start, r.period_end,
      r.total_perceptions, r.total_deductions, r.total, r.currency_code, r.confirmed_at, r.status,
      (SELECT COUNT(*) FROM payroll_cfdi_files f WHERE f.receipt_id = r.id) AS file_count,
      (SELECT COUNT(*) FROM payroll_cfdi_clarifications c WHERE c.receipt_id = r.id AND c.employee_id = r.employee_id AND c.status IN ('open', 'in_review')) AS open_clarifications
    FROM payroll_cfdi_receipts r WHERE r.employee_id = ? AND r.association_status = 'associated'
    ORDER BY r.payment_date DESC, r.id DESC`).all(employeeId);
  const files = db.prepare(`SELECT id, receipt_id, file_type, original_name, mime_type, size_bytes
    FROM payroll_cfdi_files WHERE receipt_id = ? ORDER BY id`);
  return rows.map((row) => ({ ...row, files: files.all(row.id) }));
}

export function confirmReceipt(db, receiptId, employeeId, ip = "") {
  const receipt = ownReceipt(db, receiptId, employeeId);
  if (!receipt.confirmed_at)
    db.prepare("UPDATE payroll_cfdi_receipts SET confirmed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(receipt.id);
  recordAccess(db, { receiptId: receipt.id, employeeId, action: "confirm", ip });
  return receiptById(db, receipt.id);
}

export function createClarification(db, receiptId, employeeId, message, ip = "") {
  const receipt = ownReceipt(db, receiptId, employeeId);
  const result = db.prepare(`INSERT INTO payroll_cfdi_clarifications (receipt_id, employee_id, message)
    VALUES (?, ?, ?)`).run(receipt.id, employeeId, requiredText(message, 1500, "El mensaje de aclaraci\u00f3n"));
  recordAccess(db, { receiptId: receipt.id, employeeId, action: "clarification", ip });
  return { id: Number(result.lastInsertRowid), receiptId: receipt.id, status: "open" };
}

export function ownReceipt(db, receiptId, employeeId) {
  const row = db.prepare(`SELECT * FROM payroll_cfdi_receipts
    WHERE id = ? AND employee_id = ? AND association_status = 'associated'`).get(receiptId, employeeId);
  if (!row) throw new PayrollCfdiError(404, "CFDI de n\u00f3mina no encontrado.");
  return row;
}

export function recordAccess(db, { receiptId, fileId = null, employeeId = null, userId = null, action, fileName = "", ip = "" }) {
  db.prepare(`INSERT INTO payroll_cfdi_access_log
    (receipt_id, file_id, employee_id, user_id, action, file_name, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(receiptId, fileId, employeeId, userId, action, fileName, String(ip || "").slice(0, 120));
}

function periodById(db, id) {
  const row = db.prepare("SELECT * FROM payroll_periods WHERE id = ?").get(id);
  if (!row) throw new PayrollCfdiError(404, "Periodo de n\u00f3mina no encontrado.");
  return row;
}

function optionalPeriod(db, value) {
  if (value == null || value === "") return null;
  const id = positiveId(value, "periodo");
  periodById(db, id);
  return id;
}

function collectMatches(db, candidates, method, value, sql) {
  const identifier = normalizedIdentifier(value);
  if (!identifier) return;
  for (const row of db.prepare(sql).all(identifier)) {
    const id = Number(row.id);
    if (!candidates.has(id)) candidates.set(id, { id, employeeNumber: row.employee_number, fullName: row.full_name, methods: [] });
    candidates.get(id).methods.push(method);
  }
}

function requiredFile(value, label, limit, mimeTypes, signature = null) {
  if (!value || typeof value !== "object") throw new PayrollCfdiError(400, `Selecciona el archivo ${label}.`);
  const originalName = requiredText(value.originalName, 240, `El nombre del archivo ${label}`);
  const mimeType = text(value.mimeType, 120).toLowerCase() || mimeTypes[0];
  if (!mimeTypes.includes(mimeType)) throw new PayrollCfdiError(400, `El archivo ${label} no tiene un tipo permitido.`);
  const encoded = String(value.contentBase64 ?? "").replace(/\s/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0)
    throw new PayrollCfdiError(400, `El archivo ${label} no tiene una codificaci\u00f3n v\u00e1lida.`);
  const bytes = Buffer.from(encoded, "base64");
  if (!bytes.length) throw new PayrollCfdiError(400, `El archivo ${label} est\u00e1 vac\u00edo.`);
  if (bytes.length > limit) throw new PayrollCfdiError(413, `El archivo ${label} supera el l\u00edmite permitido.`);
  if (signature && !bytes.subarray(0, signature.length).equals(Buffer.from(signature)))
    throw new PayrollCfdiError(400, `El archivo ${label} no tiene una firma v\u00e1lida.`);
  return { originalName, mimeType, bytes };
}

async function cleanupStored(storage, stored) {
  await Promise.allSettled(stored.map((item) => storage.delete(item.location.key)));
}

function attribute(node, name) {
  return String(node?.[`@_${name}`] ?? "").trim();
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function requiredText(value, max, label) {
  const result = text(value, max);
  if (!result) throw new PayrollCfdiError(400, `${label} es obligatorio.`);
  return result;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function normalizedIdentifier(value) {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, "").slice(0, 30);
}

function requiredDate(value, label) {
  const result = String(value ?? "").trim();
  if (!DATE_PATTERN.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`)))
    throw new PayrollCfdiError(400, `La ${label} no es v\u00e1lida.`);
  return result;
}

function optionalDateTime(value) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (Number.isNaN(Date.parse(result))) throw new PayrollCfdiError(400, "El CFDI contiene una fecha y hora no v\u00e1lida.");
  return result.slice(0, 35);
}

function nonNegativeNumber(value, label) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) throw new PayrollCfdiError(400, `El valor de ${label} no es v\u00e1lido.`);
  return result;
}

function optionalMoney(value) {
  return value === "" || value == null ? 0 : nonNegativeNumber(value, "importe");
}

function enumValue(value, allowed, label) {
  const result = String(value ?? "").trim();
  if (!allowed.includes(result)) throw new PayrollCfdiError(400, `Selecciona una ${label} v\u00e1lida.`);
  return result;
}

function enumOptional(value, allowed, fallback) {
  const result = String(value ?? fallback).trim();
  if (!allowed.includes(result)) throw new PayrollCfdiError(400, "El estado indicado no es v\u00e1lido.");
  return result;
}

function positiveId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new PayrollCfdiError(400, `El ${label} no es v\u00e1lido.`);
  return id;
}

function safeSegment(value) {
  return String(value ?? "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "") || "default";
}

function checksum(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function isUniqueError(error) {
  return /unique|duplicate/i.test(String(error?.message ?? "")) || error?.code === "23505";
}

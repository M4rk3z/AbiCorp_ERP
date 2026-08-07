import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import { commitEmployeeImport, employeeImportTemplate, HrImportError, previewEmployeeImport } from "../src/core/hr-import.js";
import { openDatabase } from "../src/db/index.js";

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-hr-import-"));
  const opened = openDatabase({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const db = opened.db;
  const userId = Number(db.prepare("SELECT id FROM users WHERE username = 'admin'").get().id);
  const companyId = Number(db.prepare(`INSERT INTO companies (code, legal_name, trade_name)
    VALUES ('EMP-TEST', 'Empresa de prueba', 'Prueba')`).run().lastInsertRowid);
  const centerId = Number(db.prepare(`INSERT INTO hr_work_centers (company_id, code, name)
    VALUES (?, 'CTR-TEST', 'Centro de prueba')`).run(companyId).lastInsertRowid);
  db.prepare(`INSERT INTO hr_departments (company_id, work_center_id, code, name)
    VALUES (?, ?, 'DEP-TEST', 'Departamento de prueba')`).run(companyId, centerId);
  db.prepare("INSERT INTO areas (code, name) VALUES ('ARE-TEST', 'Área de prueba')").run();
  db.prepare("INSERT INTO hr_job_positions (code, name) VALUES ('PUE-TEST', 'Puesto de prueba')").run();
  return { db, userId, close() { db.close(); rmSync(dataDir, { recursive: true, force: true }); } };
}

function row(overrides = {}) {
  return {
    nombre_completo: "Persona Importada", curp: "XEXX010101HNEXXXA4", rfc: "XAXX010101000",
    nss: "12345678901", fecha_nacimiento: "2001-01-01", correo: "importada@example.test",
    telefono: "5555555555", calle: "Calle Uno", colonia: "Centro", municipio: "Municipio",
    estado: "Estado", codigo_postal: "00000", pais: "México", contacto_emergencia: "Contacto",
    telefono_emergencia: "5555555556", parentesco_emergencia: "Familiar",
    empresa_codigo: "EMP-TEST", centro_codigo: "CTR-TEST", departamento_codigo: "DEP-TEST",
    area_codigo: "ARE-TEST", puesto_codigo: "PUE-TEST", fecha_ingreso: "2024-01-10",
    tipo_contratacion: "permanent", tipo_contrato: "permanent", periodicidad_nomina: "biweekly",
    moneda: "MXN", notas: "Alta de prueba", ...overrides,
  };
}

function upload(rows, name = "personal.xlsx") {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Personal");
  return { originalName: name,
    contentBase64: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64") };
}

test("la carga masiva previsualiza y confirma una sola vez sin altas parciales", async () => {
  const fx = fixture();
  try {
    const preview = await previewEmployeeImport(fx.db, upload([row()]), fx.userId);
    assert.equal(preview.totalRows, 1);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.errorRows, 0);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE email = ?").get("importada@example.test").total, 0);

    const committed = commitEmployeeImport(fx.db, preview.id, fx.userId);
    assert.equal(committed.importedRows, 1);
    assert.equal(committed.status, "completed");
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE email = ?").get("importada@example.test").total, 1);
    const repeated = commitEmployeeImport(fx.db, preview.id, fx.userId);
    assert.equal(repeated.importedRows, 1);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE email = ?").get("importada@example.test").total, 1);
  } finally { fx.close(); }
});

test("detecta identificadores repetidos y bloquea la confirmación del lote completo", async () => {
  const fx = fixture();
  try {
    const preview = await previewEmployeeImport(fx.db, upload([
      row(), row({ nombre_completo: "Persona Repetida", correo: "otra@example.test" }),
    ], "duplicados.xlsx"), fx.userId);
    assert.equal(preview.totalRows, 2);
    assert.equal(preview.errorRows, 1);
    assert.match(preview.errors[0].errors.join(" "), /CURP está repetido/);
    assert.throws(() => commitEmployeeImport(fx.db, preview.id, fx.userId),
      (error) => error instanceof HrImportError && error.status === 409);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM employees WHERE email IN (?, ?)")
      .get("importada@example.test", "otra@example.test").total, 0);
  } finally { fx.close(); }
});

test("permite confirmar expedientes sin adscripcion organizacional", async () => {
  const fx = fixture();
  try {
    const preview = await previewEmployeeImport(fx.db, upload([row({
      empresa_codigo: "", centro_codigo: "", departamento_codigo: "", area_codigo: "", puesto_codigo: "",
    })], "incompletos.xlsx"), fx.userId);
    assert.equal(preview.validRows, 1);
    assert.equal(preview.warningRows, 1);
    assert.equal(preview.errorRows, 0);
    assert.match(preview.warnings[0].warnings.join(" "), /Empresa no fue indicado/);
    assert.throws(() => commitEmployeeImport(fx.db, preview.id, fx.userId),
      (error) => error instanceof HrImportError && error.status === 409 && /Confirma expresamente/.test(error.message));

    const committed = commitEmployeeImport(fx.db, preview.id, fx.userId, { confirmWarnings: true });
    assert.equal(committed.importedRows, 1);
    const person = fx.db.prepare(`SELECT company_id, work_center_id, department_id, area_id, position_id
      FROM employees WHERE email = ?`).get("importada@example.test");
    assert.deepEqual({ ...person }, {
      company_id: null, work_center_id: null, department_id: null, area_id: null, position_id: null,
    });
  } finally { fx.close(); }
});

test("la plantilla Excel incluye personal, catálogos e instrucciones", async () => {
  const fx = fixture();
  try {
    const bytes = await employeeImportTemplate(fx.db);
    const workbook = XLSX.read(bytes, { type: "buffer" });
    assert.deepEqual(workbook.SheetNames, ["Personal", "Catalogos", "Instrucciones"]);
    const catalogs = XLSX.utils.sheet_to_json(workbook.Sheets.Catalogos, { defval: "" });
    assert.ok(catalogs.some((item) => item.codigo === "EMP-TEST"));
    assert.ok(bytes.length > 1000);
  } finally { fx.close(); }
});

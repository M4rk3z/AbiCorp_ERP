import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db/index.js";
import {
  createPrivateStorage,
  MemoryPrivateStorage,
  PrivateStorageError,
} from "../src/core/private-storage.js";
import {
  PayrollCfdiError,
  associateReceipt,
  confirmReceipt,
  createClarification,
  createPeriod,
  importReceipt,
  parsePayrollCfdiXml,
  portalReceipts,
} from "../src/core/payroll-cfdi.js";

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-cfdi-"));
  const opened = openDatabase({
    dataDir,
    initialAdminUser: "admin",
    initialAdminPassword: "Cambiar123!",
    seedAdmin: false,
  });
  return {
    db: opened.db,
    storage: new MemoryPrivateStorage(),
    close() {
      opened.db.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

function employee(db, number, { rfc = "", curp = "", name = "Colaborador de prueba" } = {}) {
  const result = db.prepare(`INSERT INTO employees (employee_number, full_name) VALUES (?, ?)`)
    .run(number, name);
  const id = Number(result.lastInsertRowid);
  db.prepare(`INSERT INTO hr_employee_fiscal_data (employee_id, rfc, curp, nss) VALUES (?, ?, ?, '')`)
    .run(id, rfc, curp);
  return id;
}

function xml({
  uuid = "12345678-1234-1234-1234-1234567890AB",
  rfc = "XAXX010101000",
  curp = "XEXX010101HNEXXXA4",
  employeeNumber = "E-00001",
} = {}) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12"
 xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-07-31T12:00:00"
 Total="12500.50" Moneda="MXN">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="EMPRESA DEMO" />
  <cfdi:Receptor Rfc="${rfc}" Nombre="PERSONA DEMO" />
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="O" FechaPago="2026-07-31"
      FechaInicialPago="2026-07-16" FechaFinalPago="2026-07-31" NumDiasPagados="15"
      TotalPercepciones="15000.50" TotalDeducciones="2500" TotalOtrosPagos="0">
      <nomina12:Receptor Curp="${curp}" NumEmpleado="${employeeNumber}" NumSeguridadSocial="12345678901" />
    </nomina12:Nomina>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-07-31T12:01:00" />
  </cfdi:Complemento>
</cfdi:Comprobante>`, "utf8");
}

function file(bytes, originalName, mimeType) {
  return { originalName, mimeType, contentBase64: bytes.toString("base64") };
}

test("lee un CFDI 4.0 con complemento de n\u00f3mina 1.2 sin conservar el archivo en PostgreSQL", () => {
  const parsed = parsePayrollCfdiXml(xml());
  assert.equal(parsed.uuid, "12345678-1234-1234-1234-1234567890AB");
  assert.equal(parsed.receiverEmployeeNumber, "E-00001");
  assert.equal(parsed.paymentDate, "2026-07-31");
  assert.equal(parsed.total, 12500.5);
  assert.equal(parsed.payrollVersion, "1.2");
});

test("rechaza DTD y entidades antes de analizar el XML", () => {
  assert.throws(() => parsePayrollCfdiXml("<!DOCTYPE foo [<!ENTITY x SYSTEM 'file:///etc/passwd'>]><foo>&x;</foo>"),
    (error) => error instanceof PayrollCfdiError && error.status === 400 && /seguridad/.test(error.message));
});

test("impide usar el disco efímero con PostgreSQL y protege las rutas del almacenamiento local", async () => {
  const unconfigured = createPrivateStorage({ isPostgres: true });
  assert.equal(unconfigured.provider, "unconfigured");
  await assert.rejects(() => unconfigured.put("cfdi/test.xml", Buffer.from("test")),
    (error) => error instanceof PrivateStorageError && error.status === 503);

  const root = mkdtempSync(join(tmpdir(), "abicorp-private-storage-"));
  try {
    const local = createPrivateStorage({ provider: "filesystem", root });
    await local.put("tenant/receipt.xml", Buffer.from("contenido privado"));
    assert.equal((await local.get("tenant/receipt.xml")).toString("utf8"), "contenido privado");
    assert.throws(() => local.pathFor("../fuera.xml"),
      (error) => error instanceof PrivateStorageError && error.status === 400);
    await local.delete("tenant/receipt.xml");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("importa XML y PDF, asocia por identidad laboral y detecta UUID duplicado", async () => {
  const fx = fixture();
  try {
    const employeeId = employee(fx.db, "E-00001", { rfc: "XAXX010101000", curp: "XEXX010101HNEXXXA4" });
    const period = createPeriod(fx.db, {
      code: "2026-Q14", frequency: "biweekly", startDate: "2026-07-16", endDate: "2026-07-31", paymentDate: "2026-07-31",
    });
    const receipt = await importReceipt(fx.db, fx.storage, {
      periodId: period.id,
      xml: file(xml(), "nomina.xml", "application/xml"),
      pdf: file(Buffer.from("%PDF-1.7\nsynthetic", "utf8"), "nomina.pdf", "application/pdf"),
    }, null, "tenant-test");
    assert.equal(receipt.employee_id, employeeId);
    assert.equal(receipt.association_status, "associated");
    assert.equal(receipt.files.length, 2);
    assert.equal(fx.storage.files.size, 2);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM hr_portal_notifications WHERE employee_id = ?").get(employeeId).total, 1);
    await assert.rejects(() => importReceipt(fx.db, fx.storage, {
      xml: file(xml(), "duplicado.xml", "application/xml"),
    }), (error) => error instanceof PayrollCfdiError && error.status === 409);
    assert.equal(fx.storage.files.size, 2);
  } finally {
    fx.close();
  }
});

test("env\u00eda coincidencias conflictivas a la bandeja ambigua y permite asociarlas manualmente", async () => {
  const fx = fixture();
  try {
    const byNumber = employee(fx.db, "E-00001", { rfc: "AAA010101AAA", curp: "AAAA010101HAAAAAA1" });
    const byRfc = employee(fx.db, "E-00002", { rfc: "XAXX010101000", curp: "BBBB010101HBBBBBB2" });
    const receipt = await importReceipt(fx.db, fx.storage, {
      xml: file(xml(), "ambiguo.xml", "application/xml"),
    });
    assert.equal(receipt.association_status, "ambiguous");
    assert.equal(receipt.employee_id, null);
    const associated = associateReceipt(fx.db, receipt.id, byRfc, "Validado contra expediente fiscal.");
    assert.equal(associated.association_status, "associated");
    assert.equal(associated.employee_id, byRfc);
    assert.notEqual(associated.employee_id, byNumber);
  } finally {
    fx.close();
  }
});

test("el colaborador s\u00f3lo ve sus recibos y puede confirmar o solicitar aclaraci\u00f3n", async () => {
  const fx = fixture();
  try {
    const employeeId = employee(fx.db, "E-00001", { rfc: "XAXX010101000", curp: "XEXX010101HNEXXXA4" });
    const otherEmployeeId = employee(fx.db, "E-00002", { rfc: "AAA010101AAA", curp: "AAAA010101HAAAAAA1" });
    const receipt = await importReceipt(fx.db, fx.storage, { xml: file(xml(), "recibo.xml", "application/xml") });
    assert.equal(portalReceipts(fx.db, employeeId).length, 1);
    assert.equal(portalReceipts(fx.db, otherEmployeeId).length, 0);
    assert.ok(confirmReceipt(fx.db, receipt.id, employeeId).confirmed_at);
    const clarification = createClarification(fx.db, receipt.id, employeeId, "Solicito revisar el descuento aplicado.");
    assert.equal(clarification.status, "open");
    assert.throws(() => confirmReceipt(fx.db, receipt.id, otherEmployeeId),
      (error) => error instanceof PayrollCfdiError && error.status === 404);
    assert.equal(fx.db.prepare("SELECT COUNT(*) AS total FROM payroll_cfdi_access_log").get().total, 2);
  } finally {
    fx.close();
  }
});

import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createApplication } from "../src/app.js";
import { FileSystemPrivateStorage } from "../src/core/private-storage.js";
import { createPeriod, importReceipt } from "../src/core/payroll-cfdi.js";
import * as portal from "../src/core/hr-portal.js";
import { hashPassword } from "../src/core/security.js";

const dataDir = resolve(".tmp-phase9-preview", String(Date.now()));
rmSync(dataDir, { recursive: true, force: true });
const privateStorage = new FileSystemPrivateStorage(resolve(dataDir, "private"));
const app = createApplication({
  dataDir,
  initialAdminUser: "preview-admin",
  initialAdminPassword: "Vista1234!",
  privateStorage,
});
const db = app.db;
db.prepare("UPDATE users SET must_change_password = 0 WHERE username = 'preview-admin'").run();

const employee = db.prepare(`INSERT INTO employees
  (employee_number, full_name, email, position, hire_date, status)
  VALUES ('E-00001', 'Andrea Morales', 'andrea@example.test', 'Analista de operaciones', '2023-05-15', 'active')`).run();
db.prepare(`INSERT INTO hr_employee_profiles
  (employee_id, employment_type, vacation_balance, work_schedule)
  VALUES (?, 'permanent', 12, 'Lunes a viernes · 08:00 a 17:00')`).run(employee.lastInsertRowid);
db.prepare(`INSERT INTO hr_employee_fiscal_data (employee_id, rfc, curp, nss)
  VALUES (?, 'XAXX010101000', 'XEXX010101HNEXXXA4', '12345678901')`).run(employee.lastInsertRowid);
db.prepare("UPDATE hr_portal_settings SET portal_enabled = 1 WHERE id = 1").run();
portal.resetEmployeePin(db, Number(employee.lastInsertRowid), 1);
db.prepare(`UPDATE hr_employee_portal_access SET pin_hash = ?, must_change_pin = 0,
  activation_expires_at = NULL WHERE employee_id = ?`).run(hashPassword("1937"), employee.lastInsertRowid);

const period = createPeriod(db, {
  code: "2026-Q14", frequency: "biweekly", startDate: "2026-07-16",
  endDate: "2026-07-31", paymentDate: "2026-07-31",
}, 1);
await importReceipt(db, privateStorage, {
  periodId: period.id,
  xml: sampleFile(sampleXml({}), "nomina-andrea.xml", "application/xml"),
  pdf: sampleFile(Buffer.from("%PDF-1.7\nABICORP PREVIEW", "utf8"), "nomina-andrea.pdf", "application/pdf"),
}, 1, "preview");
await importReceipt(db, privateStorage, {
  periodId: period.id,
  xml: sampleFile(sampleXml({
    uuid: "22345678-1234-1234-1234-1234567890AB",
    rfc: "COSC8001137NA", curp: "COSC800113MDFRRL09", employeeNumber: "E-00999", name: "Persona sin relacionar",
  }), "nomina-pendiente.xml", "application/xml"),
}, 1, "preview");

const server = createServer(app.handle);
server.listen(5260, "127.0.0.1", () => console.log("Preview fase 9: http://127.0.0.1:5260"));

function sampleFile(bytes, originalName, mimeType) {
  return { originalName, mimeType, contentBase64: bytes.toString("base64") };
}

function sampleXml({
  uuid = "12345678-1234-1234-1234-1234567890AB",
  rfc = "XAXX010101000",
  curp = "XEXX010101HNEXXXA4",
  employeeNumber = "E-00001",
  name = "Andrea Morales",
}) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:nomina12="http://www.sat.gob.mx/nomina12" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital" Version="4.0" Fecha="2026-07-31T12:00:00" Total="12500.50" Moneda="MXN">
  <cfdi:Emisor Rfc="AAA010101AAA" Nombre="EMPRESA DEMO" />
  <cfdi:Receptor Rfc="${rfc}" Nombre="${name}" />
  <cfdi:Complemento>
    <nomina12:Nomina Version="1.2" TipoNomina="O" FechaPago="2026-07-31" FechaInicialPago="2026-07-16" FechaFinalPago="2026-07-31" NumDiasPagados="15" TotalPercepciones="15000.50" TotalDeducciones="2500" TotalOtrosPagos="0">
      <nomina12:Receptor Curp="${curp}" NumEmpleado="${employeeNumber}" NumSeguridadSocial="12345678901" />
    </nomina12:Nomina>
    <tfd:TimbreFiscalDigital Version="1.1" UUID="${uuid}" FechaTimbrado="2026-07-31T12:01:00" />
  </cfdi:Complemento>
</cfdi:Comprobante>`, "utf8");
}

import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createApplication } from "../src/app.js";
import * as portal from "../src/core/hr-portal.js";
import * as hr from "../src/core/hr.js";
import { hashPassword } from "../src/core/security.js";

const dataDir = resolve(".tmp-phase5-preview", String(Date.now()));
rmSync(dataDir, { recursive: true, force: true });
const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
const db = app.db;
const area = db.prepare("INSERT INTO areas (code, name) VALUES ('OPS', 'Operaciones')").run();
const manager = db.prepare(`INSERT INTO employees
  (employee_number, full_name, email, phone, area_id, position, hire_date, status)
  VALUES ('E-00001', 'Mariana Torres', 'mariana@abicorp.test', '81 5555 0180', ?, 'Coordinadora de operaciones', '2022-03-14', 'active')`).run(area.lastInsertRowid);
db.prepare(`INSERT INTO hr_employee_profiles
  (employee_id, employment_type, vacation_balance, vacation_debt, work_schedule)
  VALUES (?, 'permanent', 14, 2, 'Lunes a viernes · 08:00 a 17:00')`).run(manager.lastInsertRowid);
let firstDirectReportId = null;
for (const [number, name, position, balance] of [
  ['E-00002', 'Diego Salazar', 'Analista de producción', 8],
  ['E-00003', 'Renata Lozano', 'Inspectora de calidad', 11],
]) {
  const employee = db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, area_id, position, hire_date, status)
    VALUES (?, ?, ?, ?, ?, '2024-02-01', 'active')`).run(number, name, `${number.toLowerCase()}@abicorp.test`, area.lastInsertRowid, position);
  db.prepare(`INSERT INTO hr_employee_profiles
    (employee_id, manager_employee_id, employment_type, vacation_balance, work_schedule)
    VALUES (?, ?, 'permanent', ?, 'Lunes a viernes · 08:00 a 17:00')`).run(employee.lastInsertRowid, manager.lastInsertRowid, balance);
  if (!firstDirectReportId) firstDirectReportId = Number(employee.lastInsertRowid);
}
db.prepare("UPDATE hr_portal_settings SET portal_enabled = 1 WHERE id = 1").run();
portal.resetEmployeePin(db, Number(manager.lastInsertRowid), 1);
db.prepare(`UPDATE hr_employee_portal_access SET pin_hash = ?, must_change_pin = 0,
  activation_expires_at = NULL WHERE employee_id = ?`).run(hashPassword("1937"), Number(manager.lastInsertRowid));
portal.notify(db, Number(manager.lastInsertRowid), "Bienvenida al portal", "Ya puedes consultar tu información y crear solicitudes.", "info");
const leave = hr.createLeave(db, {
  employeeId: firstDirectReportId, leaveType: "vacation", startDate: "2026-08-17",
  endDate: "2026-08-18", totalDays: 2, reason: "Asunto familiar programado",
}, null);
db.prepare("UPDATE hr_leave_requests SET request_origin = 'portal' WHERE id = ?").run(leave.id);

const server = createServer(app.handle);
server.listen(5250, "127.0.0.1", () => console.log("Preview portal: http://127.0.0.1:5250/portal"));

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canAccessSensitiveDocument, filterHrControl, laborIdentityForUser, visibleEmployeeIds } from "../src/core/hr-identity.js";
import { hashPassword } from "../src/core/security.js";
import { openDatabase } from "../src/db/index.js";

test("los perfiles Colaborador, Auxiliar RH y Administrador RH respetan su alcance", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-hr-identity-"));
  const opened = openDatabase({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const { db } = opened;
  t.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

  const companyA = Number(db.prepare("INSERT INTO companies (code, legal_name, trade_name) VALUES ('A', 'Empresa A', 'A')").run().lastInsertRowid);
  const companyB = Number(db.prepare("INSERT INTO companies (code, legal_name, trade_name) VALUES ('B', 'Empresa B', 'B')").run().lastInsertRowid);
  const centerA = Number(db.prepare("INSERT INTO hr_work_centers (company_id, code, name) VALUES (?, 'CA', 'Centro A')").run(companyA).lastInsertRowid);
  const employees = [
    createEmployee("E-001", "Trabajador Uno", companyA, centerA),
    createEmployee("E-002", "Reporte Directo", companyA, centerA),
    createEmployee("E-003", "Otra Empresa", companyB, null),
  ];
  db.prepare("UPDATE hr_employee_profiles SET manager_employee_id = ? WHERE employee_id = ?").run(employees[0], employees[1]);

  const collaborator = createUser("collaborator");
  const hrAdmin = createUser("hr.admin");
  const hrAssistant = createUser("hr.assistant");
  db.prepare(`INSERT INTO hr_user_access
    (user_id, employee_id, identity_type, access_scope, can_view_medical)
    VALUES (?, ?, 'worker', 'own', 0)`).run(collaborator, employees[1]);
  db.prepare(`INSERT INTO hr_user_access
    (user_id, identity_type, access_scope, can_view_medical)
    VALUES (?, 'manager', 'company', 1)`).run(hrAdmin);
  db.prepare("INSERT INTO hr_user_company_scopes (user_id, company_id) VALUES (?, ?)").run(hrAdmin, companyA);
  db.prepare(`INSERT INTO hr_user_access
    (user_id, identity_type, access_scope, can_view_medical)
    VALUES (?, 'hr', 'center', 0)`).run(hrAssistant);
  db.prepare("INSERT INTO hr_user_work_center_scopes (user_id, work_center_id) VALUES (?, ?)").run(hrAssistant, centerA);

  assert.deepEqual([...visibleEmployeeIds(db, collaborator)], [employees[1]]);
  assert.deepEqual([...visibleEmployeeIds(db, hrAdmin)].sort(), [employees[0], employees[1]].sort());
  assert.deepEqual([...visibleEmployeeIds(db, hrAssistant)].sort(), [employees[0], employees[1]].sort());

  const globalAuditor = createUser("global.auditor");
  db.prepare(`INSERT INTO hr_user_access
    (user_id, identity_type, access_scope, can_view_salary, can_view_medical)
    VALUES (?, 'payroll', 'company', 0, 0)`).run(globalAuditor);
  assert.deepEqual([...visibleEmployeeIds(db, globalAuditor)].sort(), [...employees].sort());

  const payload = {
    people: employees.map((id) => ({ id, status: "active", hire_date: "2026-01-01",
      base_salary: 25000, currency_code: "MXN", payment_method: "transfer", bank_reference: "private" })),
    leaves: employees.map((employee_id, index) => ({ id: index + 1, employee_id, leave_type: "incapacity",
      subtype: "diagnostico", reason: "dato privado", certificate_number: "CERT", medical_provider: "IMSS", status: "submitted" })),
    attendance: employees.map((employee_id) => ({ employee_id })),
    indicators: {},
  };
  const collaboratorView = filterHrControl(db, collaborator, payload);
  assert.deepEqual(collaboratorView.people.map((row) => row.id), [employees[1]]);
  assert.equal("base_salary" in collaboratorView.people[0], false);
  assert.equal(collaboratorView.leaves[0].reason, "Informaci\u00f3n m\u00e9dica restringida");
  const assistantView = filterHrControl(db, hrAssistant, payload);
  assert.deepEqual(assistantView.people.map((row) => row.id).sort(), [employees[0], employees[1]].sort());
  assert.equal(assistantView.leaves[0].reason, "Informaci\u00f3n m\u00e9dica restringida");
  const adminIdentity = laborIdentityForUser(db, hrAdmin);
  assert.equal(canAccessSensitiveDocument(adminIdentity, "medical"), true);

  assert.ok(db.prepare("SELECT 1 FROM hr_employee_fiscal_data LIMIT 1"));
  assert.ok(db.prepare("SELECT 1 FROM hr_employee_history LIMIT 1"));
  assert.ok(db.prepare("SELECT 1 FROM hr_employee_personal_data LIMIT 1"));
  assert.ok(db.prepare("SELECT 1 FROM hr_document_types LIMIT 1"));
  assert.ok(db.prepare("SELECT 1 FROM hr_document_access_log LIMIT 1"));
  assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE version = 28").get().name,
    "hr_complete_digital_employee_file");
  assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE version = 29").get().name,
    "hr_document_retention");

  function createEmployee(number, name, companyId, workCenterId) {
    const id = Number(db.prepare(`INSERT INTO employees
      (employee_number, full_name, company_id, work_center_id) VALUES (?, ?, ?, ?)`)
      .run(number, name, companyId, workCenterId).lastInsertRowid);
    db.prepare("INSERT INTO hr_employee_profiles (employee_id) VALUES (?)").run(id);
    return id;
  }

  function createUser(username) {
    return Number(db.prepare(`INSERT INTO users (username, full_name, password_hash, must_change_password)
      VALUES (?, ?, ?, 0)`).run(username, username, hashPassword("Temporal123!")).lastInsertRowid);
  }
});

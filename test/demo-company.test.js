import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEMO_TEMPORARY_PASSWORD, seedDemoCompany } from "../src/core/demo-company.js";
import { openDatabase, synchronizeManagedCompanyIdentity } from "../src/db/index.js";
import { verifyPassword } from "../src/core/security.js";

test("la empresa demo crea un escenario mediano ficticio, completo e idempotente", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-demo-company-"));
  const { db } = openDatabase({ dataDir, databasePath: join(dataDir, "demo.db"), seedAdmin: false });
  t.after(() => {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const company = { id: 99, code: "DEMO-99", legalName: "Nova Manufactura Demo, S.A. de C.V.", tradeName: "Nova Manufactura Demo" };
  synchronizeManagedCompanyIdentity(db, company);
  const first = seedDemoCompany(db, { company });

  assert.equal(first.alreadySeeded, false);
  assert.equal(first.employees, 30);
  assert.equal(first.users, 6);
  assert.equal(first.areas, 8);
  assert.equal(first.workCenters, 2);
  assert.equal(first.positions, 11);
  assert.equal(first.payrollLines, 30);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM customers").get().value, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM suppliers").get().value, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM hr_scheduled_shifts").get().value, 210);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM production_orders").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM maintenance_plans").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM finance_receivables").get().value, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM safety_incidents").get().value, 1);
  const admin = db.prepare("SELECT password_hash, must_change_password FROM users WHERE username = 'demo.admin'").get();
  assert.equal(verifyPassword(DEMO_TEMPORARY_PASSWORD, admin.password_hash), true);
  assert.equal(admin.must_change_password, 0);

  const second = seedDemoCompany(db, { company });
  assert.equal(second.alreadySeeded, true);
  assert.equal(second.employees, 30);
  assert.equal(db.prepare("SELECT COUNT(*) AS value FROM payroll_preparation_lines").get().value, 30);
});

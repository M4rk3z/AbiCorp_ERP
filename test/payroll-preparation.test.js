import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db/index.js";
import * as preparation from "../src/core/payroll-preparation.js";

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-prepayroll-"));
  const opened = openDatabase({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!", seedAdmin: false });
  return {
    db: opened.db,
    close() { opened.db.close(); rmSync(dataDir, { recursive: true, force: true }); },
  };
}

test("la prenómina calcula sueldo, permiso sin goce, deducciones y neto por colaborador", () => {
  const context = fixture();
  try {
    const { db } = context;
    const employeeId = Number(db.prepare(`INSERT INTO employees
      (employee_number, full_name, hire_date, status) VALUES ('E-PRE-01', 'Persona Prenómina', '2024-01-01', 'active')`)
      .run().lastInsertRowid);
    db.prepare(`INSERT INTO hr_employee_labor_data (employee_id, payroll_frequency) VALUES (?, 'biweekly')`).run(employeeId);
    db.prepare(`INSERT INTO hr_employee_compensation_private (employee_id, base_salary, currency_code)
      VALUES (?, 15000, 'MXN')`).run(employeeId);
    const requestId = Number(db.prepare(`INSERT INTO hr_leave_requests
      (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, working_days,
       total_hours, reason, status, is_unpaid, unpaid_terms_accepted)
      VALUES ('PER-PRE-01', ?, 'permission', 'Sin goce', '2026-08-13', '2026-08-13', 1, 1,
        0, 'Asunto personal', 'approved', 1, 1)`).run(employeeId).lastInsertRowid);
    const incidentId = Number(db.prepare(`INSERT INTO hr_payroll_incidents
      (leave_request_id, employee_id, incident_type, start_date, end_date, days, hours)
      VALUES (?, ?, 'unpaid_permission', '2026-08-13', '2026-08-13', 1, 0)`)
      .run(requestId, employeeId).lastInsertRowid);
    const periodId = Number(db.prepare(`INSERT INTO payroll_periods
      (code, frequency, start_date, end_date, payment_date, status)
      VALUES ('2026-Q16', 'biweekly', '2026-08-01', '2026-08-15', '2026-08-15', 'open')`)
      .run().lastInsertRowid);

    let result = preparation.generate(db, periodId, null);
    assert.equal(result.lines.length, 1);
    assert.equal(result.lines[0].base_pay, 15000);
    assert.equal(result.lines[0].unpaid_leave_deduction, 1000);
    assert.equal(result.lines[0].net_pay, 14000);
    assert.equal(result.lines[0].incident_count, 1);

    preparation.updateLine(db, result.lines[0].id, {
      otherPerceptions: 1000,
      taxDeduction: 1500,
      socialSecurityDeduction: 500,
      otherDeductions: 0,
      notes: "Cálculo preliminar",
    });
    result = preparation.control(db, periodId);
    assert.equal(result.totals.grossPay, 16000);
    assert.equal(result.totals.totalDeductions, 3000);
    assert.equal(result.totals.netPay, 13000);

    result = preparation.finalize(db, result.preparation.id, null);
    assert.equal(result.preparation.status, "finalized");
    assert.equal(db.prepare("SELECT status FROM hr_payroll_incidents WHERE id = ?").get(incidentId).status, "processed");
    assert.throws(() => preparation.updateLine(db, result.lines[0].id, {}), /finalizada/);
  } finally { context.close(); }
});

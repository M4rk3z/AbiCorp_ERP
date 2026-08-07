import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import * as hr from "../src/core/hr.js";
import { openDatabase } from "../src/db/index.js";

test("el tablero de RH calcula cobertura sin consultas por cada solicitud", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-hr-performance-"));
  const opened = openDatabase({
    dataDir,
    initialAdminUser: "admin",
    initialAdminPassword: "Cambiar123!",
    seedAdmin: false,
  });
  const db = opened.db;
  try {
    const companyId = Number(db.prepare(`INSERT INTO companies (code, legal_name, trade_name)
      VALUES ('PERF', 'Empresa de rendimiento', 'Rendimiento')`).run().lastInsertRowid);
    const departmentId = Number(db.prepare(`INSERT INTO hr_departments (company_id, code, name)
      VALUES (?, 'OPS', 'Operaciones')`).run(companyId).lastInsertRowid);
    const insertEmployee = db.prepare(`INSERT INTO employees
      (employee_number, full_name, hire_date, status, company_id, department_id)
      VALUES (?, ?, '2024-01-01', 'active', ?, ?)`);
    const insertProfile = db.prepare(`INSERT INTO hr_employee_profiles
      (employee_id, employment_type, vacation_balance) VALUES (?, 'permanent', 12)`);
    const insertLeave = db.prepare(`INSERT INTO hr_leave_requests
      (folio, employee_id, leave_type, start_date, end_date, total_days, reason, status)
      VALUES (?, ?, 'vacation', '2026-08-10', '2026-08-12', 3, 'Prueba de cobertura', ?)`);
    for (let index = 1; index <= 60; index += 1) {
      const employeeId = Number(insertEmployee.run(`PERF-${String(index).padStart(3, "0")}`,
        `Colaborador ${index}`, companyId, departmentId).lastInsertRowid);
      insertProfile.run(employeeId);
      insertLeave.run(`PERF-L-${String(index).padStart(3, "0")}`, employeeId,
        index % 2 ? "submitted" : "approved");
    }
    db.prepare(`INSERT INTO hr_department_absence_limits
      (department_id, maximum_absent, minimum_available) VALUES (?, 10, 5)`).run(departmentId);
    hr.syncVacationPlans(db);

    let preparedQueries = 0;
    const countingDb = {
      prepare(sql) { preparedQueries += 1; return db.prepare(sql); },
      exec(sql) { return db.exec(sql); },
    };
    const control = hr.control(countingDb);

    assert.equal(control.leaves.length, 60);
    assert.equal(control.leaves[0].coverage.total, 60);
    assert.equal(control.leaves[0].coverage.absent, 60);
    assert.equal(control.leaves[0].coverage.withinLimit, false);
    assert.ok(preparedQueries <= 12, `Se prepararon ${preparedQueries} consultas; existe una regresión N+1.`);

    const beforeOptions = preparedQueries;
    const options = hr.options(countingDb, { syncVacation: false, includeEmployees: false });
    assert.equal(Array.isArray(options.areas), true);
    assert.equal(options.companies.some((row) => row.id === companyId), true);
    assert.equal(preparedQueries - beforeOptions, 1,
      "Los catálogos de RH deben resolverse en un solo viaje a la base de datos.");
  } finally {
    db.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
});

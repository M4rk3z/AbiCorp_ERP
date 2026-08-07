import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import XLSX from "xlsx";
import { createApplication } from "../src/app.js";
import * as schedules from "../src/core/hr-schedules.js";

test("los horarios programados, reales y sus correcciones conservan versiones", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-schedules-test-"));
  const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const db = app.db;
  t.after(() => { app.close(); rmSync(dataDir, { recursive: true, force: true }); });

  const employeeId = Number(db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, position, hire_date, status)
    VALUES ('E-HOR-01', 'Persona con Horario', 'horario@example.test', 'Operación', '2024-01-10', 'active')`).run().lastInsertRowid);
  const shiftId = Number(db.prepare(`INSERT INTO hr_work_shifts
    (code, name, start_time, end_time, work_days, break_minutes, schedule_json)
    VALUES ('MAT-01', 'Matutino prueba', '08:00', '17:00', 'mon,tue,wed,thu,fri', 60, ?)`)
    .run(JSON.stringify([{ days: ["mon", "tue", "wed", "thu", "fri"], periods: [{ start: "08:00", end: "17:00" }] }])).lastInsertRowid);
  db.prepare(`INSERT INTO hr_employee_profiles
    (employee_id, employment_type, vacation_balance, work_shift_id)
    VALUES (?, 'permanent', 12, ?)`).run(employeeId, shiftId);

  const period = schedules.createPeriod(db, { startDate: "2026-08-03" }, 1);
  const defaults = schedules.applyDefaultShifts(db, period.id, 1);
  assert.equal(defaults.imported, 5);

  const csv = [
    "employee_number,date,start,end,break_minutes,day_off,notes",
    "E-HOR-01,2026-08-08,,,0,true,Descanso especial",
  ].join("\n");
  const imported = await schedules.importSchedule(db, period.id, {
    originalName: "programados.csv", contentBase64: Buffer.from(csv).toString("base64"),
  }, 1);
  assert.equal(imported.imported, 1);
  assert.equal(schedules.control(db, period.id).entries.length, 6);

  schedules.publishVersion(db, defaults.versionId, 1);
  assert.throws(() => schedules.saveScheduledEntry(db, defaults.versionId, {
    employeeId, workDate: "2026-08-03", startTime: "09:00", endTime: "18:00",
  }), /inmutable/i);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    employee_number: "E-HOR-01", date: "2026-08-04", start: "08:10", end: "17:04",
    break_minutes: 60, reason: "Importación de control",
  }]), "Horarios reales");
  const xlsxImport = await schedules.importActual(db, {
    originalName: "reales.xlsx", contentBase64: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }).toString("base64"),
  }, 1);
  assert.equal(xlsxImport.imported, 1);

  const actual = schedules.captureActual(db, {
    employeeId, workDate: "2026-08-03", actualStart: "08:07", actualEnd: "17:12", breakMinutes: 60,
  }, 1);
  assert.equal(actual.versionNumber, 1);
  assert.throws(() => schedules.captureActual(db, {
    employeeId, workDate: "2026-08-03", actualStart: "08:00", actualEnd: "17:00",
  }, 1), /corrección/i);

  const correction = schedules.requestCorrection(db, {
    employeeId, workDate: "2026-08-03", proposedStart: "08:02", proposedEnd: "17:05",
    proposedBreakMinutes: 60, reason: "Corrección validada con evidencia",
  }, 1);
  schedules.correctionAction(db, correction.id, { action: "approve", reason: "Evidencia revisada y autorizada" }, 1);
  const history = db.prepare(`SELECT version_number, is_current, source FROM hr_actual_shift_versions
    WHERE employee_id = ? AND work_date = ? ORDER BY version_number`).all(employeeId, "2026-08-03");
  assert.deepEqual(history.map((row) => [row.version_number, row.is_current, row.source]), [
    [1, 0, "manual"], [2, 1, "correction"],
  ]);

  const published = schedules.employeeSchedule(db, employeeId, "2026-08-03", "2026-08-09");
  assert.equal(published.length, 7);
  assert.equal(published[0].actual_version, 2);
  assert.equal(published[0].variance_minutes, 3);

  db.prepare("INSERT INTO hr_holidays (holiday_date, name, created_by) VALUES ('2026-08-05', 'Feriado de prueba', 1)").run();
  db.prepare(`INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason, status, approved_by)
    VALUES ('VAC-HOR-01', ?, 'vacation', 'ordinaria', '2026-08-06', '2026-08-06', 1, 0, 'Vacaciones aprobadas', 'approved', 1)`).run(employeeId);
  db.prepare(`INSERT INTO hr_leave_requests
    (folio, employee_id, leave_type, subtype, start_date, end_date, total_days, total_hours, reason, status, approved_by)
    VALUES ('PER-HOR-01', ?, 'permission', 'personal', '2026-08-07', '2026-08-07', 0, 2, 'Permiso parcial aprobado', 'approved', 1)`).run(employeeId);
  const automatic = schedules.employeeSchedule(db, employeeId, "2026-08-03", "2026-08-09");
  assert.equal(automatic.find((row) => row.work_date === "2026-08-05").calendar_status, "holiday");
  assert.equal(automatic.find((row) => row.work_date === "2026-08-06").calendar_status, "vacation");
  assert.equal(automatic.find((row) => row.work_date === "2026-08-07").absence_hours, 2);
  assert.equal(automatic.find((row) => row.work_date === "2026-08-09").calendar_status, "rest");

  const nextPeriod = schedules.createPeriod(db, { startDate: "2026-08-10" }, 1);
  const copied = schedules.copyPreviousWeek(db, nextPeriod.id, 1);
  assert.equal(copied.imported, 6);
  assert.equal(schedules.control(db, nextPeriod.id).entries[0].work_date, "2026-08-10");
});

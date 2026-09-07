import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { openDatabase } from "../src/db/index.js";
import * as compliance from "../src/core/hr-compliance.js";

test("el canal confidencial conserva evidencia, responsable y todo el historial", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-hr-compliance-"));
  const opened = openDatabase({ dataDir, seedAdmin: false });
  const { db } = opened;
  t.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });

  assert.equal(db.prepare("SELECT name FROM schema_migrations WHERE version = 38").get().name,
    "hr_confidential_compliance_cases");
  const userId = Number(db.prepare(`INSERT INTO users
    (username, full_name, password_hash, must_change_password)
    VALUES ('rh.admin', 'Administrador RH', 'hash-pruebas', 0)`).run().lastInsertRowid);
  const employeeId = Number(db.prepare(`INSERT INTO employees
    (employee_number, full_name, status) VALUES ('E-CUM-01', 'Colaborador Protegido', 'active')`)
    .run().lastInsertRowid);

  const created = compliance.createCase(db, {
    title: "Posible represalia laboral",
    description: "El colaborador reporta un cambio de turno posterior a una queja.",
    category: "retaliation",
    channel: "internal",
    reporterType: "employee",
    reporterEmployeeId: employeeId,
    severity: "high",
    confidentiality: "strict",
    occurredOn: "2026-08-18",
    targetDate: "2026-08-25",
  }, userId);
  assert.equal(created.folio, "CAS-000001");

  compliance.addEvidence(db, created.id, {
    evidenceType: "email",
    title: "Correo de reasignación",
    description: "Referencia preservada por Recursos Humanos.",
    sensitivity: "strict",
  }, userId);
  compliance.action(db, created.id, {
    action: "assign", investigatorUserId: userId, comment: "Responsable designado.",
  }, userId);
  compliance.action(db, created.id, { action: "investigate", comment: "Se inicia revisión." }, userId);
  assert.throws(() => compliance.action(db, created.id, { action: "resolve", comment: "Breve" }, userId),
    /al menos 10 caracteres/);
  compliance.action(db, created.id, {
    action: "resolve", comment: "Se restituyó el turno y se documentó la medida preventiva.",
  }, userId);
  compliance.action(db, created.id, { action: "close", comment: "Cierre validado por RH." }, userId);

  const detail = compliance.detail(db, created.id);
  assert.equal(detail.case.status, "closed");
  assert.equal(detail.case.anti_retaliation_notice, 1);
  assert.equal(detail.case.investigator_user_id, userId);
  assert.equal(detail.evidence.length, 1);
  assert.deepEqual(detail.history.map((row) => row.action),
    ["close", "resolve", "investigate", "assign", "evidence_added", "created"]);
  const dashboard = compliance.control(db);
  assert.equal(dashboard.indicators.open, 0);
  assert.equal(dashboard.indicators.resolved, 1);
});

test("un reporte anónimo no conserva identidad ni contacto", (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-hr-anonymous-"));
  const opened = openDatabase({ dataDir, seedAdmin: false });
  const { db } = opened;
  t.after(() => { db.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const userId = Number(db.prepare(`INSERT INTO users
    (username, full_name, password_hash) VALUES ('captura', 'Captura Segura', 'hash')`).run().lastInsertRowid);
  const created = compliance.createCase(db, {
    title: "Reporte anónimo",
    description: "Descripción suficiente del hecho reportado de forma anónima.",
    category: "ethics",
    reporterType: "anonymous",
    reporterEmployeeId: 999,
    reporterContact: "no-debe-guardarse@example.com",
  }, userId);
  const detail = compliance.detail(db, created.id);
  assert.equal(detail.case.reporter_employee_id, null);
  assert.equal(detail.case.reporter_contact, "");
});

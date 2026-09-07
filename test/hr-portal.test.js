import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplication } from "../src/app.js";
import * as hr from "../src/core/hr.js";
import * as portal from "../src/core/hr-portal.js";

function futureMonday(weeksAhead = 8) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + weeksAhead * 7);
  date.setUTCDate(date.getUTCDate() + ((8 - date.getUTCDay()) % 7));
  return date;
}

function isoDay(anchor, offset = 0) {
  const date = new Date(anchor);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

test("el portal protege el primer acceso y limita la información al colaborador", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-portal-test-"));
  const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const db = app.db;
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const employeeResult = db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, position, hire_date, status)
    VALUES ('E-00991', 'Colaborador Portal', 'portal@example.test', 'Operador', '2024-01-10', 'active')`).run();
  const employeeId = Number(employeeResult.lastInsertRowid);
  db.prepare(`INSERT INTO hr_employee_profiles
    (employee_id, employment_type, vacation_balance, work_schedule)
    VALUES (?, 'permanent', 12, 'Lunes a viernes 08:00-17:00')`).run(employeeId);
  db.prepare("UPDATE hr_portal_settings SET portal_enabled = 1 WHERE id = 1").run();
  portal.resetEmployeePin(db, employeeId, 1);

  const page = await fetch(`${baseUrl}/portal`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Portal de colaboradores/);

  const firstLogin = await jsonRequest("/api/portal/login", {
    method: "POST", body: { employeeNumber: "E-00991", pin: "0000" },
  });
  assert.equal(firstLogin.response.status, 200);
  assert.equal(firstLogin.data.requiresPinChange, true);
  const cookie = firstLogin.response.headers.get("set-cookie").split(";")[0];

  const protectedBeforePin = await jsonRequest("/api/portal/me", { cookie });
  assert.equal(protectedBeforePin.response.status, 401);

  const pinChange = await jsonRequest("/api/portal/pin", {
    method: "POST", cookie, csrf: firstLogin.data.csrfToken, body: { newPin: "4826" },
  });
  assert.equal(pinChange.response.status, 200);

  const overview = await jsonRequest("/api/portal/me", { cookie });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.data.employee.employee_number, "E-00991");
  assert.equal(overview.data.vacation.available, 12);
  assert.equal(overview.data.employee.base_salary, undefined);

  const requestMonday = futureMonday();
  const request = await jsonRequest("/api/portal/requests", {
    method: "POST", cookie, csrf: overview.data.csrfToken,
    body: { leaveType: "vacation", startDate: isoDay(requestMonday), endDate: isoDay(requestMonday, 1), totalDays: 2, reason: "Descanso personal" },
  });
  assert.equal(request.response.status, 201);
  assert.match(request.data.folio, /^VAC-/);
  assert.equal(db.prepare("SELECT request_origin FROM hr_leave_requests WHERE id = ?").get(request.data.id).request_origin, "portal");

  const afterRequest = await jsonRequest("/api/portal/me", { cookie });
  assert.equal(afterRequest.data.requests[0].folio, request.data.folio);
  assert.equal(afterRequest.data.unreadNotifications, 1);

  const badOldPin = await jsonRequest("/api/portal/login", {
    method: "POST", body: { employeeNumber: "E-00991", pin: "0000" },
  });
  assert.equal(badOldPin.response.status, 401);

  async function jsonRequest(path, { method = "GET", body, cookie: requestCookie, csrf } = {}) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (requestCookie) headers.Cookie = requestCookie;
    if (csrf) headers["X-CSRF-Token"] = csrf;
    const response = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    return { response, data };
  }
});

test("el jefe revisa su plantilla con motivo y el colaborador puede corregir la solicitud", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-portal-manager-test-"));
  const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const db = app.db;
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const managerId = Number(db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, position, hire_date, status)
    VALUES ('J-00001', 'Jefa de Operaciones', 'jefa@example.test', 'Jefatura', '2020-01-10', 'active')`).run().lastInsertRowid);
  const employeeId = Number(db.prepare(`INSERT INTO employees
    (employee_number, full_name, email, position, hire_date, status)
    VALUES ('E-00022', 'Colaborador Directo', 'directo@example.test', 'Operador', '2024-01-10', 'active')`).run().lastInsertRowid);
  db.prepare(`INSERT INTO hr_employee_profiles
    (employee_id, employment_type, vacation_balance, work_schedule)
    VALUES (?, 'permanent', 12, 'Lunes a viernes 08:00-17:00')`).run(managerId);
  db.prepare(`INSERT INTO hr_employee_profiles
    (employee_id, manager_employee_id, employment_type, vacation_balance, work_schedule)
    VALUES (?, ?, 'permanent', 12, 'Lunes a viernes 08:00-17:00')`).run(employeeId, managerId);
  db.prepare("UPDATE hr_portal_settings SET portal_enabled = 1 WHERE id = 1").run();
  portal.resetEmployeePin(db, managerId, 1);
  portal.resetEmployeePin(db, employeeId, 1);

  const manager = await activate("J-00001", "1937");
  const employee = await activate("E-00022", "4826");
  const managerRequestMonday = futureMonday(9);
  const created = await jsonRequest("/api/portal/requests", employee, {
    method: "POST", body: { leaveType: "vacation", startDate: isoDay(managerRequestMonday), endDate: isoDay(managerRequestMonday, 1), totalDays: 2, reason: "Asunto personal" },
  });
  assert.equal(created.response.status, 201);

  const team = await jsonRequest("/api/portal/team", manager);
  assert.equal(team.data.pendingRequests.length, 1);
  assert.equal(team.data.pendingRequests[0].employee_name, "Colaborador Directo");
  assert.equal(team.data.pendingRequests[0].coverage_available_after, 0);

  const missingReason = await jsonRequest(`/api/portal/team/requests/${created.data.id}/action`, manager, {
    method: "POST", body: { action: "request_changes", reason: "No" },
  });
  assert.equal(missingReason.response.status, 400);
  const changes = await jsonRequest(`/api/portal/team/requests/${created.data.id}/action`, manager, {
    method: "POST", body: { action: "request_changes", reason: "Ajusta las fechas para conservar cobertura." },
  });
  assert.equal(changes.response.status, 200);

  const observed = await jsonRequest("/api/portal/me", employee);
  assert.equal(observed.data.requests[0].review_action, "request_changes");
  const corrected = await jsonRequest(`/api/portal/requests/${created.data.id}`, employee, {
    method: "PATCH", body: { startDate: isoDay(managerRequestMonday, 2), endDate: isoDay(managerRequestMonday, 3), totalDays: 2, reason: "Fechas ajustadas" },
  });
  assert.equal(corrected.response.status, 200);
  const correctedTeam = await jsonRequest("/api/portal/team", manager);
  assert.equal(correctedTeam.data.pendingRequests[0].review_action, "resubmitted");

  const approved = await jsonRequest(`/api/portal/team/requests/${created.data.id}/action`, manager, {
    method: "POST", body: { action: "approve", reason: "Cobertura confirmada para las fechas corregidas." },
  });
  assert.equal(approved.response.status, 200);
  assert.equal(approved.data.status, "submitted");
  assert.equal(approved.data.currentStep, "hr");
  const hrDecision = hr.leaveAction(db, created.data.id,
    { action: "approve", reason: "Autorizado por Administrador RH." }, 1);
  assert.equal(hrDecision.status, "approved");
  const finalState = await jsonRequest("/api/portal/me", employee);
  assert.equal(finalState.data.requests[0].status, "approved");
  assert.equal(finalState.data.requests[0].review_action, "approved");

  async function activate(employeeNumber, newPin) {
    const login = await jsonRequest("/api/portal/login", {}, { method: "POST", body: { employeeNumber, pin: "0000" } });
    const cookie = login.response.headers.get("set-cookie").split(";")[0];
    const context = { cookie, csrf: login.data.csrfToken };
    const changed = await jsonRequest("/api/portal/pin", context, { method: "POST", body: { newPin } });
    assert.equal(changed.response.status, 200);
    return context;
  }

  async function jsonRequest(path, context = {}, { method = "GET", body } = {}) {
    const headers = {};
    if (body) headers["Content-Type"] = "application/json";
    if (context.cookie) headers.Cookie = context.cookie;
    if (context.csrf && !["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = context.csrf;
    const response = await fetch(baseUrl + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await response.json();
    return { response, data };
  }
});

test("las políticas calculan días hábiles, evitan traslapes y envían permisos sin goce a prenómina", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-leave-policy-test-"));
  const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const db = app.db;
  try {
    const employeeId = Number(db.prepare(`INSERT INTO employees
      (employee_number, full_name, email, position, hire_date, status)
      VALUES ('E-00400', 'Colaboradora Políticas', 'politicas@example.test', 'Analista', '2022-01-10', 'active')`).run().lastInsertRowid);
    db.prepare(`INSERT INTO hr_employee_profiles
      (employee_id, employment_type, vacation_balance, vacation_debt, work_schedule)
      VALUES (?, 'permanent', 10, 0, 'Lunes a viernes')`).run(employeeId);
    db.prepare(`UPDATE hr_portal_settings SET manager_approval_required = 0, minimum_advance_days = 0,
      exclude_weekends = 1, exclude_holidays = 1 WHERE id = 1`).run();
    const policyMonday = futureMonday(12);
    const policyFriday = isoDay(policyMonday, -3);
    const policyTuesday = isoDay(policyMonday, 1);
    const unpaidDate = isoDay(policyMonday, 21);
    portal.createHoliday(db, { date: isoDay(policyMonday), name: "Festivo de prueba" }, 1);

    const preview = hr.previewLeave(db, {
      employeeId, leaveType: "vacation", startDate: policyFriday, endDate: policyTuesday,
    });
    assert.equal(preview.workingDays, 2);
    assert.equal(preview.balance.availableBefore, 10);
    assert.equal(preview.balance.availableAfter, 8);

    const vacation = hr.createLeave(db, {
      employeeId, leaveType: "vacation", startDate: policyFriday, endDate: policyTuesday,
      totalHours: 2, reason: "Periodo anual",
    }, null);
    assert.equal(vacation.workingDays, 2);
    assert.equal(vacation.currentStep, "hr");
    assert.equal(vacation.balance.availableAfter, 8);
    const receipt = hr.leaveReceipt(db, vacation.id);
    assert.equal(receipt.request.total_hours, 0);
    assert.equal(receipt.balance.available_before, 10);
    assert.equal(receipt.balance.requested_days, 2);
    assert.equal(receipt.printCount, 0);
    assert.equal(hr.recordLeavePrint(db, vacation.id, 1, "127.0.0.1").printCount, 1);
    hr.leaveAction(db, vacation.id, { action: "approve", reason: "Autorizado por RH." }, 1);
    const profile = db.prepare("SELECT vacation_balance FROM hr_employee_profiles WHERE employee_id = ?").get(employeeId);
    assert.equal(profile.vacation_balance, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS value FROM hr_vacation_balance_movements WHERE leave_request_id = ?").get(vacation.id).value, 1);
    assert.throws(() => hr.createLeave(db, {
      employeeId, leaveType: "incapacity", startDate: isoDay(policyMonday, -2), endDate: isoDay(policyMonday, -1), reason: "Traslape",
    }, null), /coinciden con/);

    assert.throws(() => hr.createLeave(db, {
      employeeId, leaveType: "permission", startDate: unpaidDate, endDate: unpaidDate,
      reason: "Asunto personal", isUnpaid: true,
    }, null), /prenómina/);
    const unpaid = hr.createLeave(db, {
      employeeId, leaveType: "permission", startDate: unpaidDate, endDate: unpaidDate,
      reason: "Asunto personal", isUnpaid: true, unpaidTermsAccepted: true,
    }, null);
    hr.leaveAction(db, unpaid.id, { action: "approve", reason: "Autorizado por RH." }, 1);
    assert.equal(db.prepare("SELECT status FROM hr_payroll_incidents WHERE leave_request_id = ?").get(unpaid.id).status, "pending");
    assert.ok(db.prepare("SELECT COUNT(*) AS value FROM hr_leave_status_history WHERE leave_request_id = ?").get(unpaid.id).value >= 2);
  } finally {
    app.close(); rmSync(dataDir, { recursive: true, force: true });
  }
});

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createControlApplication } from "../src/control-app.js";

test("el Gestor crea y precarga una empresa demo desde una sola acción", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-control-demo-"));
  const app = createControlApplication({
    dataDir,
    initialAdminUser: "admin",
    initialAdminPassword: "AdminTemporal2026!",
    controlUser: "control",
    controlPassword: "ControlTemporal2026!",
  });
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await fetch(`${url}/api/control/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "control", password: "ControlTemporal2026!" }),
  });
  const loginData = await login.json();
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "Content-Type": "application/json", "X-CSRF-Token": loginData.csrfToken };
  const changed = await fetch(`${url}/api/control/auth/change-password`, {
    method: "POST",
    headers,
    body: JSON.stringify({ currentPassword: "ControlTemporal2026!", newPassword: "CentroDemoSeguro2026!" }),
  });
  assert.equal(changed.status, 200);

  const invalidDuration = await fetch(`${url}/api/control/demo-company`, {
    method: "POST",
    headers,
    body: JSON.stringify({ durationHours: 48 }),
  });
  assert.equal(invalidDuration.status, 400);

  const created = await fetch(`${url}/api/control/demo-company`, {
    method: "POST",
    headers,
    body: JSON.stringify({ durationHours: 12 }),
  });
  const result = await created.json();
  assert.equal(created.status, 201, JSON.stringify(result));
  assert.match(result.company.tradeName, /^Nova Manufactura Demo/);
  assert.equal(result.company.modules.length, 16);
  assert.equal(result.company.activeUsers, 6);
  assert.equal(result.summary.employees, 30);
  assert.equal(result.summary.payrollLines, 30);
  assert.equal(result.access.username, "demo.admin");
  assert.equal(result.access.mustChangePassword, false);
  assert.equal(result.subscription.status, "trial");
  assert.equal(result.subscription.isDemo, true);
  assert.equal(result.subscription.demoDurationHours, 12);
  assert.equal(result.demo.durationHours, 12);
  assert.match(result.demo.expiresAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

  const companies = await fetch(`${url}/api/control/companies`, { headers: { Cookie: cookie } });
  const companyData = await companies.json();
  assert.equal(companyData.companies.some((company) => company.id === result.company.id && company.activeUsers === 6), true);

  const registry = new DatabaseSync(join(dataDir, "abicorp-control.db"));
  registry.prepare("UPDATE company_subscriptions SET demo_expires_at = '2000-01-01 00:00:00' WHERE company_id = ?")
    .run(result.company.id);
  registry.close();

  const expiredResponse = await fetch(`${url}/api/control/companies`, { headers: { Cookie: cookie } });
  const expiredData = await expiredResponse.json();
  const expiredCompany = expiredData.companies.find((company) => company.id === result.company.id);
  assert.equal(expiredCompany.status, "inactive");
  assert.equal(expiredCompany.subscription.status, "suspended");
});

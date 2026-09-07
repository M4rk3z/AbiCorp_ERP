import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const syncSource = read("../src/db/postgres-sync.js");
const workerSource = read("../src/db/postgres-worker.js");
const controlSource = read("../scripts/start-control-postgres.ps1");
const erpSource = read("../scripts/start-erp-test-postgres.ps1");
const environmentSource = read("../scripts/start-test-environment.ps1");
const launcherSource = read("../INICIAR_AMBIENTE_PRUEBAS.cmd");
const stopEnvironmentSource = read("../scripts/stop-test-environment.ps1");
const stopLauncherSource = read("../DETENER_AMBIENTE_PRUEBAS.cmd");

test("PostgreSQL tolera interrupciones transitorias durante la primera conexion", () => {
  assert.match(syncSource, /DEFAULT_TIMEOUT_MS = 240_000/);
  assert.match(workerSource, /POSTGRES_CONNECT_ATTEMPTS = 6/);
  assert.match(workerSource, /isTransientPostgresConnectionError\(error\)/);
  assert.match(workerSource, /Math\.min\(attempt \* 2_000, 10_000\)/);
  for (const source of [controlSource, erpSource]) {
    assert.match(source, /\$startupAttempt -ge 4/);
    assert.match(source, /connection terminated\|ECONNRESET/);
    assert.match(source, /Reintentando/);
  }
});

test("un solo acceso inicia el Gestor y el ERP del ambiente de pruebas", () => {
  assert.match(environmentSource, /start-control-postgres\.ps1/);
  assert.match(environmentSource, /start-erp-test-postgres\.ps1/);
  assert.match(environmentSource, /-EnvironmentName test -Detached/);
  assert.match(environmentSource, /\$controlUrl = "http:\/\/127\.0\.0\.1:\$ControlPort"/);
  assert.match(environmentSource, /\$erpUrl = "http:\/\/127\.0\.0\.1:\$ErpPort"/);
  assert.match(environmentSource, /if \(\$controlStartedHere\)/);
  assert.match(launcherSource, /start-test-environment\.ps1/);
  assert.match(launcherSource, /-ControlPort 5151 -ErpPort 5150 -OpenBrowser/);
});

test("un solo acceso detiene el Gestor y el ERP del ambiente de pruebas", () => {
  assert.match(stopEnvironmentSource, /stop-erp-test-postgres\.ps1/);
  assert.match(stopEnvironmentSource, /stop-control-postgres\.ps1/);
  assert.match(stopEnvironmentSource, /-EnvironmentName test/);
  assert.match(stopLauncherSource, /stop-test-environment\.ps1/);
  assert.equal(existsSync(new URL("../DETENER_ERP_PRUEBAS.cmd", import.meta.url)), false);
  assert.equal(existsSync(new URL("../DETENER_GESTOR_PRUEBAS.cmd", import.meta.url)), false);
});

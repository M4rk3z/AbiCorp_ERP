import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../control/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../control/index.html", import.meta.url), "utf8");
const backend = readFileSync(new URL("../src/control-app.js", import.meta.url), "utf8");

test("el Centro de Gestion no afirma que una contrasena pendiente sea welcome1", () => {
  assert.doesNotMatch(source, /Contraseña predeterminada: welcome1/);
  assert.match(source, /contraseña inicial pendiente/);
  assert.match(source, /Contraseña temporal pendiente de cambio/);
  assert.match(source, /la contraseña actual no se muestra ni puede recuperarse/);
  assert.match(source, /Restablecimiento preparado/);
});

test("el Centro de Gestion identifica el rol ADMIN sin depender del nombre de usuario", () => {
  assert.match(backend, /r\.code = 'ADMIN'/);
  assert.match(backend, /isSystemAdmin: systemAdmin/);
  assert.match(source, /user\.isSystemAdmin \? "Administrador del sistema"/);
});

test("la cuenta ADMIN es de solo lectura en interfaz y servidor", () => {
  assert.match(source, /Cuenta ADMIN protegida/);
  assert.match(source, /protectedAdmin/);
  assert.match(source, /user\.isSystemAdmin \? "Consultar" : "Gestionar"/);
  assert.match(backend, /cuenta ADMIN del sistema esta protegida y no puede modificarse/);
  assert.match(backend, /cuenta ADMIN del sistema esta protegida y no puede retirarse/);
});

test("el Centro de Gestion versiona la interfaz corregida", () => {
  assert.match(html, /styles\.css\?v=20260807-21/);
  assert.match(html, /app\.js\?v=20260807-21/);
});

test("la eliminacion de empresas exige confirmacion escrita y comunica su impacto", () => {
  assert.match(html, /id="remove-company-dialog"/);
  assert.match(html, /id="confirm-remove-company"[^>]*disabled/);
  assert.match(source, /data-delete-company/);
  assert.match(source, /function refreshCompanyDeleteConfirmation/);
  assert.match(source, /body: \{ confirmCode: form\.elements\.confirmCode\.value \}/);
  assert.match(backend, /method === "DELETE"[^]*deleteCompany/);
  assert.match(backend, /Debe permanecer al menos una empresa activa/);
  assert.match(backend, /DROP SCHEMA IF EXISTS/);
});

test("el Centro de Gestion organiza los modulos por paquetes operativos", () => {
  assert.match(source, /Núcleo obligatorio/);
  assert.match(source, /Operación comercial básica/);
  assert.match(source, /Operación industrial/);
  assert.match(source, /Administrativos/);
  assert.match(source, /Adicionales/);
  assert.match(source, /function moduleAccessGroups/);
  assert.match(source, /module-group-grid/);
});

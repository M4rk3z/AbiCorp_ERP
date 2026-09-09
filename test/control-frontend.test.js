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

test("la cuenta ADMIN permite editar accesos sin perder su proteccion", () => {
  assert.match(source, /Cuenta ADMIN protegida/);
  assert.match(source, /protectedAdmin/);
  assert.match(source, /data-edit-user="\$\{user\.id\}">Gestionar/);
  assert.match(source, /Puedes modificar sus datos y accesos/);
  assert.match(source, /input\[name="status"\]/);
  assert.match(backend, /const systemAdmin = userHasSystemAdminRole/);
  assert.match(backend, /if \(!systemAdmin\) \{/);
  assert.match(backend, /cuenta ADMIN del sistema esta protegida y no puede retirarse/);
});

test("el Centro de Gestion versiona la interfaz corregida", () => {
  assert.match(html, /styles\.css\?v=20260909-01/);
  assert.match(html, /app\.js\?v=20260909-01/);
});

test("la creación de empresas continúa en una tarjeta sin bloquear el Gestor", () => {
  const styles = readFileSync(new URL("../control/styles.css", import.meta.url), "utf8");
  assert.match(html, /id="companies-grid"[^>]+aria-live="polite"/);
  assert.match(source, /pendingCompanies: \[\]/);
  assert.match(source, /function pendingCompanyCard/);
  assert.match(source, /function beginPendingCompany/);
  assert.match(source, /function failPendingCompany/);
  assert.match(source, /Puedes seguir usando el Centro de Gestión/);
  assert.match(source, /demoCompanyDialog\.close\(\);[^]*api\("\/api\/control\/demo-company"/);
  assert.match(source, /companyDialog\.close\(\);[^]*api\("\/api\/control\/companies"/);
  assert.doesNotMatch(source, /title: "Preparando empresa demo"/);
  assert.match(styles, /\.company-card-pending\.creating::before/);
  assert.match(styles, /@keyframes pending-company-progress/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("el Centro de Gestion puede crear una empresa demo precargada", () => {
  assert.match(html, /id="load-demo-company-button"/);
  assert.match(html, /id="demo-company-dialog"/);
  assert.match(html, /id="demo-ready-dialog"/);
  assert.match(html, /Nova Manufactura Demo/);
  assert.match(html, /name="durationHours"[^>]+value="12"/);
  assert.match(html, /name="durationHours"[^>]+value="24"/);
  assert.match(html, /name="durationHours"[^>]+value="72"/);
  assert.doesNotMatch(html, /name="planId"[^>]*>Usar plan activo o crear plan demo/);
  assert.match(source, /function openDemoCompanyDialog/);
  assert.match(source, /function saveDemoCompany/);
  assert.match(source, /api\("\/api\/control\/demo-company"/);
  assert.match(backend, /seedDemoCompany/);
  assert.match(backend, /control\.demo_company_created/);
});

test("el Centro de Gestion usa perfiles globales y conserva permisos sensibles", () => {
  assert.match(html, /<option value="manager">Administrador<\/option>/);
  assert.match(html, /<option value="hr">Auxiliar<\/option>/);
  assert.match(html, /<option value="payroll">Auditor<\/option>/);
  assert.doesNotMatch(html, /name="employeeId"|name="accessScope"|name="companyIds"|name="workCenterIds"/);
  assert.doesNotMatch(html, /Trabajador vinculado|Empresas autorizadas|Centros autorizados/);
  assert.match(html, /name="canViewSalary"/);
  assert.match(html, /name="canViewCfdi"/);
  assert.match(html, /name="canViewMedical"/);
  assert.doesNotMatch(source, /refreshLaborAccessControls|selectedNumbers/);
  assert.match(backend, /\["manager", "hr", "payroll"\]/);
  assert.match(backend, /accessScope: "company"/);
  assert.doesNotMatch(backend, /requieren alcance por empresa o centro de trabajo/);
  assert.doesNotMatch(backend, /Selecciona al menos una empresa autorizada/);
  assert.doesNotMatch(backend, /Selecciona al menos un centro de trabajo autorizado/);
});

test("el Centro de Gestion administra planes y suscripciones sin exponer cobros", () => {
  assert.match(html, /data-control-view="subscriptions"/);
  assert.match(html, /id="subscription-form"/);
  assert.match(html, /id="plan-form"/);
  assert.match(html, /id="plans-panel"[^>]*hidden/);
  assert.match(html, /id="manage-plans-button"/);
  assert.match(html, /id="close-plans-button"/);
  assert.doesNotMatch(html, /id="new-subscription-button"/);
  assert.match(html, /class="form-section new-company-subscription"/);
  assert.match(html, /name="planId" required/);
  assert.match(html, /<h3>Seleccionar Plan<\/h3>/);
  assert.doesNotMatch(html, /Suscripción inicial|name="subscriptionStartsOn"|name="subscriptionNextBillingOn"|name="subscriptionStatus"|REQUERIDA/);
  assert.doesNotMatch(html, /id="charge-form"|id="collection-form"|Cargos y cobros|Cobros registrados|Nuevo cargo/);
  assert.match(source, /function renderSubscriptionWorkspace/);
  assert.match(source, /function renderPlans/);
  assert.match(source, /function setPlanManagerVisible/);
  assert.match(source, /function openPlanDialog/);
  assert.doesNotMatch(html, /Código automático|name="code"/);
  assert.doesNotMatch(html, /company-code-preview|ID de empresa|Automático al guardar/);
  assert.doesNotMatch(source, /automaticPlanCode|form\.elements\.code/);
  assert.match(source, /body\.code = automaticCompanyRequestCode\(\)/);
  assert.match(backend, /function nextSubscriptionPlanCode/);
  assert.match(backend, /function nextCompanyCode/);
  assert.match(backend, /function automaticSubscriptionSchedule/);
  assert.match(source, /body\.subscription = \{/);
  assert.match(source, /planId: Number\(data\.get\("planId"\)\)/);
  assert.match(source, /function armActionButton/);
  assert.doesNotMatch(source, /openChargeDialog|saveSubscriptionCollection|data-collect-charge/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS company_subscriptions|company_subscriptions/);
  assert.match(backend, /CREATE TABLE IF NOT EXISTS subscription_plans|subscription_plans/);
  assert.match(backend, /cleanPlanAssignment\(body\.subscription\)/);
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

test("el Centro de Gestion ofrece presets funcionales y conserva la personalizacion manual", () => {
  assert.match(html, /id="module-preset-selector"/);
  assert.match(html, /id="module-preset-summary"/);
  assert.match(html, /name="modulePreset"[^>]*value="custom"/);
  assert.match(source, /label: "Administración"/);
  assert.match(source, /label: "Recursos Humanos"/);
  assert.match(source, /label: "Producción"/);
  assert.match(source, /label: "Mantenimiento"/);
  assert.match(source, /label: "Gestión"/);
  assert.match(source, /label: "Ambiental"/);
  assert.match(source, /label: "Personalizada"/);
  assert.match(source, /function applyModulePreset/);
  assert.match(source, /function findMatchingModulePreset/);
  assert.match(source, /function applyIdentityModuleLevelPolicy/);
  assert.match(source, /identityType === "manager"/);
  assert.match(source, /identityType === "payroll"/);
  assert.match(source, /option\.level >= 2 && option\.level <= 3/);
  assert.match(source, /setActiveModulePreset\("custom"\)/);
  assert.match(backend, /function normalizeUserModuleLevels/);
});

test("el modal de usuarios usa un solo desplazamiento y conserva visibles sus acciones", () => {
  assert.match(html, /id="user-form"[^>]*class="modal-card"[^]*class="modal-scroll-content"/);
  assert.match(html, /class="modal-scroll-content"[^]*class="modal-actions"/);
  const styles = readFileSync(new URL("../control/styles.css", import.meta.url), "utf8");
  assert.match(styles, /#user-dialog \{[^}]*height:/);
  assert.match(styles, /#user-form \{[^}]*display: flex;[^}]*overflow: hidden/);
  assert.match(styles, /#user-form \.modal-scroll-content \{[^}]*overflow-y: auto/);
  assert.match(styles, /#user-form > \.modal-actions \{[^}]*flex: 0 0 auto/);
});

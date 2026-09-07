const state = {
  user: null,
  company: null,
  csrfToken: "",
  companySlug: "",
  currentView: "dashboard",
  users: [],
  roles: [],
  areas: [],
  permissions: [],
  catalogType: "companies",
  catalogCache: {},
  masterOptions: null,
  masterFilter: {},
  masterRecords: {},
  masterHubSection: "items",
  masterHubQuery: "",
  inventoryOptions: null,
  inventoryOverviewApiAvailable: null,
  inventoryWarehouseId: null,
  inventoryStockQuery: "",
  salesOptions: null,
  productionOrderFilter: "all",
  productionOptions: null,
  qualityOptions: null,
  maintenanceOptions: null,
  logisticsOptions: null,
  logisticsHubSection: "logistics_preparation",
  financeOptions: null,
  financeHubSection: "finance_receivables",
  tasksOptions: null,
  purchasesOptions: null,
  purchaseHubSection: "purchases_requests",
  safetyOptions: null,
  safetyHubSection: "safety_incidents",
  hrOptions: null,
  hrControl: null,
  payrollSection: "overview",
  payrollPeriodId: null,
  settingsSection: "general",
  renderToken: 0,
  clockTimer: null,
};

// En un host remoto, la interfaz y la API comparten el mismo origen. Live Server
// conserva el puente al backend local que escucha en el puerto 5050.
const isRemoteHost = !["", "localhost", "127.0.0.1"].includes(location.hostname);
const API_BASE = ["5050", "5150", "5260"].includes(location.port) || isRemoteHost ? "" : "http://127.0.0.1:5050";
const API_GET_CACHE_MS = 15_000;
const HR_CONTROL_CACHE_MS = 60_000;
const INVENTORY_OVERVIEW_CACHE_MS = 30_000;
const apiGetCache = new Map();
const apiGetPending = new Map();
const guardedFormSubmissions = [];
const guardedFormExclusions = new Set([
  "login-form", "password-form", "dashboard-shortcut-form", "hr-bulk-form", "annual-maintenance-import-form",
]);

const catalogUi = {
  companies: { label: "Empresas", singular: "Empresa", description: "Razones sociales y entidades operativas.", fields: [
    ["code", "Código", "text"], ["legal_name", "Razón social", "text"], ["trade_name", "Nombre comercial", "text"], ["tax_id", "RFC / identificación fiscal", "text"], ["is_active", "Registro activo", "boolean"],
  ] },
  branches: { label: "Sucursales", singular: "Sucursal", description: "Ubicaciones pertenecientes a cada empresa.", fields: [
    ["company_id", "Empresa", "company"], ["code", "Código", "text"], ["name", "Nombre", "text"], ["address", "Dirección", "textarea"], ["timezone", "Zona horaria", "text"], ["is_active", "Registro activo", "boolean"],
  ] },
  areas: { label: "Áreas", singular: "Área", description: "Unidades funcionales de la organización.", fields: [
    ["code", "Código", "text"], ["name", "Nombre", "text"], ["description", "Descripción", "textarea"], ["is_active", "Registro activo", "boolean"],
  ] },
  warehouses: { label: "Almacenes", singular: "Almacén", description: "Puntos físicos de resguardo y movimiento.", fields: [
    ["branch_id", "Sucursal", "branch"], ["code", "Código", "text"], ["name", "Nombre", "text"], ["description", "Descripción", "textarea"], ["is_active", "Registro activo", "boolean"],
  ] },
  units: { label: "Unidades de medida", singular: "Unidad de medida", description: "Unidades utilizadas por artículos y operaciones.", fields: [
    ["code", "Código", "text"], ["name", "Nombre", "text"], ["symbol", "Símbolo", "text"], ["decimals", "Decimales", "number"], ["is_active", "Registro activo", "boolean"],
  ] },
  currencies: { label: "Monedas", singular: "Moneda", description: "Monedas y tipos de cambio operativos.", fields: [
    ["code", "Código ISO", "text"], ["name", "Nombre", "text"], ["symbol", "Símbolo", "text"], ["exchange_rate", "Tipo de cambio", "decimal"], ["is_base", "Moneda base", "boolean"], ["is_active", "Registro activo", "boolean"],
  ] },
  document_states: { label: "Estados de documentos", singular: "Estado", description: "Etapas disponibles para los flujos documentales.", fields: [
    ["code", "Código", "text"], ["name", "Nombre", "text"], ["description", "Descripción", "textarea"], ["color", "Color", "color"], ["sequence", "Orden", "number"], ["is_terminal", "Estado terminal", "boolean"], ["is_active", "Registro activo", "boolean"],
  ] },
};

const masterUi = {
  items: { label: "Artículos", singular: "Artículo", description: "Productos, materiales, consumibles, herramientas, servicios y activos.", code: "sku", name: "name", category: "item_type", categories: {
    finished: "Productos terminados", raw_material: "Materias primas", consumable: "Consumibles", tool: "Herramientas", service: "Servicios", asset: "Activos",
  }, fields: [
    ["sku", "SKU / código", "text", true], ["name", "Nombre", "text", true], ["item_type", "Tipo de artículo", "item_type", true], ["description", "Descripción", "textarea"],
    ["unit_id", "Unidad de medida", "unit"], ["currency_id", "Moneda", "currency"], ["standard_cost", "Costo estándar", "decimal"], ["list_price", "Precio de lista", "decimal"],
    ["tax_rate", "Impuesto (%)", "decimal"], ["min_stock", "Existencia mínima", "decimal"], ["max_stock", "Existencia máxima", "decimal"],
    ["inventory_tracked", "Controla inventario", "boolean"], ["purchase_enabled", "Disponible en compras", "boolean"], ["sales_enabled", "Disponible en ventas", "boolean"], ["production_enabled", "Disponible en producción", "boolean"], ["is_active", "Registro activo", "boolean"],
  ] },
  customers: { label: "Clientes", singular: "Cliente", description: "Datos comerciales, fiscales y condiciones de crédito.", code: "code", name: "legal_name", fields: partyFieldsUi("customer") },
  suppliers: { label: "Proveedores", singular: "Proveedor", description: "Fuentes de suministro y condiciones de compra.", code: "code", name: "legal_name", fields: partyFieldsUi("supplier") },
  areas: { label: "Áreas", singular: "Área", description: "Departamentos y unidades funcionales de la organización.", code: "code", name: "name", fields: [
    ["code", "Código", "text", true], ["name", "Nombre", "text", true], ["description", "Descripción", "textarea"], ["is_active", "Registro activo", "boolean"],
  ] },
  employees: { label: "Empleados", singular: "Empleado", description: "Personal interno, puestos y asignación organizacional.", code: "employee_number", name: "full_name", category: "status", categories: { active: "Activos", leave: "Permiso / ausencia", inactive: "Inactivos" }, fields: [
    ["employee_number", "Número de empleado", "text", true], ["full_name", "Nombre completo", "text", true], ["email", "Correo", "email"], ["phone", "Teléfono", "text"], ["area_id", "Área", "area"], ["position", "Puesto", "text"], ["hire_date", "Fecha de ingreso", "date"], ["status", "Estado", "employee_status", true],
  ] },
  resources: { label: "Recursos", singular: "Recurso", description: "Máquinas, centros de trabajo, herramientas y personal productivo.", code: "code", name: "name", category: "resource_type", categories: { machine: "Máquinas", work_center: "Centros de trabajo", tool: "Herramientas", personnel: "Personal" }, fields: [
    ["code", "Código", "text", true], ["name", "Nombre", "text", true], ["resource_type", "Tipo de recurso", "resource_type", true], ["area_id", "Área", "area"], ["employee_id", "Empleado vinculado", "employee"], ["description", "Descripción", "textarea"], ["capacity_per_hour", "Capacidad por hora", "decimal"], ["hourly_cost", "Costo por hora", "decimal"], ["currency_id", "Moneda", "currency"], ["status", "Disponibilidad", "resource_status", true],
  ] },
  price_lists: { label: "Listas de precios y costos", singular: "Lista", description: "Tarifas de venta y costos por artículo, moneda y vigencia.", code: "code", name: "name", category: "list_type", categories: { sale: "Precios de venta", cost: "Listas de costos" }, lines: true, fields: [
    ["code", "Código", "text", true], ["name", "Nombre", "text", true], ["list_type", "Tipo de lista", "list_type", true], ["currency_id", "Moneda", "currency", true], ["valid_from", "Vigente desde", "date"], ["valid_to", "Vigente hasta", "date"], ["is_active", "Lista activa", "boolean"],
  ] },
};

const inventoryViews = new Set([
  "inventory_stock", "inventory_entries", "inventory_exits", "inventory_transfers",
  "inventory_adjustments", "inventory_reservations", "inventory_lots",
  "inventory_locations", "inventory_counts",
]);

const masterHubViews = new Set(["masters_hub"]);
const salesViews = new Set(["sales_control"]);
const productionViews = new Set(["production_control"]);
const qualityViews = new Set(["quality_control"]);
const maintenanceViews = new Set(["maintenance_control", "maintenance_equipment", "maintenance_plans", "maintenance_requests", "maintenance_orders", "maintenance_parts", "maintenance_downtimes", "maintenance_history"]);
const logisticsViews = new Set(["logistics_control", "logistics_preparation", "logistics_picking", "logistics_packing", "logistics_routes", "logistics_carriers", "logistics_evidence", "logistics_confirmation"]);
const financeViews = new Set(["finance_control", "finance_receivables", "finance_payables", "finance_payments", "finance_collections", "finance_cost_centers", "finance_budgets", "finance_reconciliations"]);
const tasksViews = new Set(["tasks_assigned", "tasks_flows", "tasks_comments", "tasks_rejections", "tasks_reassignments", "tasks_deadlines", "tasks_history"]);
const purchasesViews = new Set(["purchases_control", "purchases_requests", "purchases_comparisons", "purchases_orders", "purchases_receipts", "purchases_returns", "purchases_invoices"]);
const safetyViews = new Set(["safety_control"]);
const hrViews = new Set(["hr_control"]);
const payrollViews = new Set(["payroll_control"]);
const operationalTaskModuleByView = {
  sales_control: "sales",
  production_control: "production",
  inventory_stock: "inventory",
  purchases_control: "purchases",
  quality_control: "quality",
  logistics_control: "logistics",
  maintenance_control: "maintenance",
  finance_control: "finance",
  safety_control: "safety",
  hr_control: "hr",
  payroll_control: "payroll",
};

const automaticCatalogCodes = {
  companies: { field: "code", example: "EMP-00001" },
  branches: { field: "code", example: "SUC-00001" },
  areas: { field: "code", example: "ARE-00001" },
  warehouses: { field: "code", example: "ALM-00001" },
};

const automaticMasterCodes = {
  items: { field: "sku", example: "Según el tipo: PT-00001, MP-00001…" },
  customers: { field: "code", example: "CLI-00001" },
  suppliers: { field: "code", example: "PRV-00001" },
  employees: { field: "employee_number", example: "E-00001" },
  resources: { field: "code", example: "Según el tipo: MAQ-00001, CT-00001…" },
  price_lists: { field: "code", example: "Según el tipo: LPV-00001 o LPC-00001" },
};

function partyFieldsUi(kind) {
  const extra = kind === "customer" ? [["credit_limit", "Límite de crédito", "decimal"]] : [["lead_time_days", "Tiempo de entrega (días)", "number"]];
  return [["code", "Código", "text", true], ["legal_name", "Razón social", "text", true], ["trade_name", "Nombre comercial", "text"], ["tax_id", "RFC / identificación fiscal", "text"], ["email", "Correo", "email"], ["phone", "Teléfono", "text"], ["address", "Dirección", "textarea"], ["currency_id", "Moneda", "currency"], ["payment_terms_days", "Días de crédito", "number"], ...extra, ["is_active", "Registro activo", "boolean"]];
}

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const loadingScreen = $("#loading-screen");
const loginScreen = $("#login-screen");
const appShell = $("#app-shell");
const pageContent = $("#page-content");
const entityDialog = $("#entity-dialog");
const actionDialog = $("#action-dialog");
const passwordDialog = $("#password-dialog");

function syncPageDialogLock() {
  document.body.classList.toggle("dialog-open", $$('dialog[open]').length > 0);
}

document.addEventListener("DOMContentLoaded", boot);

async function boot() {
  bindGlobalEvents();
  try {
    const result = await api("/api/auth/me");
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    setCompanyContext(result.company);
    showApplication();
    if (state.user.mustChangePassword) showPasswordDialog();
    else await navigate("dashboard");
  } catch (error) {
    if (error.status !== 401) toast(error.message, "error");
    showLogin();
  }
}

function bindGlobalEvents() {
  initLoginModuleCarousel();
  $$('dialog').forEach((dialog) => {
    new MutationObserver(syncPageDialogLock).observe(dialog, { attributes: true, attributeFilter: ["open"] });
    dialog.addEventListener("close", syncPageDialogLock);
  });
  document.addEventListener("submit", guardFormSubmission, true);
  $("#login-form").addEventListener("submit", submitLogin);
  $("#password-form").addEventListener("submit", submitPasswordChange);
  $("#logout-button").addEventListener("click", logout);
  $(".notification-button").addEventListener("click", () => hasPermission("notifications.view") && navigate("notifications"));
  $("#mobile-menu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#main-nav").addEventListener("click", (event) => {
    const toggle = event.target.closest(".nav-group-toggle");
    if (toggle) {
      const group = toggle.closest("[data-nav-group]");
      const shouldOpen = !group.classList.contains("open");
      $$('[data-nav-group]').forEach((item) => setNavGroupOpen(item, false));
      setNavGroupOpen(group, shouldOpen);
      return;
    }
    const button = event.target.closest("[data-view]");
    if (!button) return;
    navigate(button.dataset.view);
    $(".sidebar").classList.remove("open");
  });
  const prepareRequestedModule = (event) => {
    const button = event.target.closest("[data-view]");
    if (button) void prefetchViewData(button.dataset.view);
  };
  $("#main-nav").addEventListener("pointerover", prepareRequestedModule);
  $("#main-nav").addEventListener("focusin", prepareRequestedModule);
  $$('[data-peek]').forEach((button) => button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.peek);
    input.type = input.type === "password" ? "text" : "password";
    const visible = input.type === "text";
    button.textContent = visible ? "Ocultar" : "Ver";
    button.setAttribute("aria-pressed", String(visible));
    button.setAttribute("aria-label", `${visible ? "Ocultar" : "Mostrar"} ${button.dataset.peekLabel || "contraseña"}`);
  }));
  entityDialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-modal]")) entityDialog.close();
  });
  entityDialog.addEventListener("close", () => $("#entity-modal-content").classList.remove("wide", "compact", "hr-person-modal", "hr-schedule-modal"));
  passwordDialog.addEventListener("cancel", (event) => {
    if (state.user?.mustChangePassword) event.preventDefault();
  });
}

function initLoginModuleCarousel() {
  const carousel = $("#login-module-carousel");
  if (!carousel) return;
  const track = $("#login-module-track", carousel);
  const pages = $$(".module-carousel-page", carousel);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let current = 0;
  let timer = null;

  const render = (next) => {
    current = (next + pages.length) % pages.length;
    track.style.transform = "translateX(-" + (current * 100) + "%)";
    pages.forEach((page, index) => page.setAttribute("aria-hidden", index === current ? "false" : "true"));
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    if (!reduceMotion && !document.hidden) timer = setInterval(() => render(current + 1), 4500);
  };

  carousel.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      render(current + (event.key === "ArrowRight" ? 1 : -1));
      start();
    }
  });
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);
  carousel.addEventListener("focusin", stop);
  carousel.addEventListener("focusout", start);
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  render(0);
  start();
}

async function submitLogin(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $("#login-error");
  const button = $("button[type=submit]", form);
  errorBox.classList.add("hidden");
  button.disabled = true;
  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: { username: form.username.value, password: form.password.value },
    });
    state.user = result.user;
    state.csrfToken = result.csrfToken;
    setCompanyContext(result.company);
    form.password.value = "";
    showApplication();
    if (state.user.mustChangePassword) showPasswordDialog();
    else await navigate("dashboard");
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
}

function showLogin() {
  apiGetCache.clear();
  apiGetPending.clear();
  if (state.clockTimer) {
    clearInterval(state.clockTimer);
    state.clockTimer = null;
  }
  loadingScreen.classList.add("hidden");
  appShell.classList.add("hidden");
  loginScreen.classList.remove("hidden");
  setTimeout(() => $("#login-username").focus(), 50);
}

function showApplication() {
  loadingScreen.classList.add("hidden");
  loginScreen.classList.add("hidden");
  appShell.classList.remove("hidden");
  renderIdentity();
  renderNavigation();
  startHeaderClock();
  loadNotifications();
}

function confirmAction(options = {}) {
  return openActionDialog({
    eyebrow: options.eyebrow || "CONFIRMACIÓN REQUERIDA",
    title: options.title || "Confirma esta acción",
    message: options.message || "Revisa la información antes de continuar.",
    confirmLabel: options.confirmLabel || "Confirmar",
    cancelLabel: options.cancelLabel || "Cancelar",
    tone: options.tone || "primary",
  }).then(Boolean);
}

function requestActionText(options = {}) {
  return openActionDialog({
    eyebrow: options.eyebrow || "MOTIVO REQUERIDO",
    title: options.title || "Captura el motivo",
    message: options.message || "Esta información quedará registrada en el historial.",
    confirmLabel: options.confirmLabel || "Guardar motivo",
    cancelLabel: options.cancelLabel || "Cancelar",
    tone: options.tone || "primary",
    fieldLabel: options.fieldLabel || "Motivo",
    placeholder: options.placeholder || "Describe brevemente el motivo…",
    minLength: Number(options.minLength || 5),
    initialValue: options.initialValue || "",
  });
}

function openActionDialog(options) {
  return new Promise((resolve) => {
    const asksForText = Boolean(options.fieldLabel);
    actionDialog.innerHTML = '<form class="modal-card compact action-dialog-card" method="dialog">' +
      (asksForText ? '<div class="action-dialog-symbol">✎</div>' : '') +
      '<span class="eyebrow">' + escapeHtml(options.eyebrow) + '</span><h2 id="action-dialog-title">' + escapeHtml(options.title) + '</h2><p class="muted">' + escapeHtml(options.message) + '</p>' +
      (asksForText ? '<label class="action-dialog-field">' + escapeHtml(options.fieldLabel) + '<textarea name="actionValue" rows="4" minlength="' + options.minLength + '" placeholder="' + escapeAttribute(options.placeholder) + '" required>' + escapeHtml(options.initialValue) + '</textarea></label><p class="form-error hidden" role="alert"></p>' : "") +
      '<div class="modal-actions"><button class="button ghost" type="button" data-action-cancel>' + escapeHtml(options.cancelLabel) + '</button><button class="button ' + (options.tone === "danger" ? "danger" : "primary") + '" type="submit">' + escapeHtml(options.confirmLabel) + '</button></div></form>';
    const form = $("form", actionDialog), input = $('[name="actionValue"]', actionDialog);
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      actionDialog.onclick = null;
      actionDialog.oncancel = null;
      if (actionDialog.open) actionDialog.close();
      resolve(value);
    };
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!asksForText) return finish(true);
      const value = input.value.trim();
      if (value.length < options.minLength) {
        const box = $(".form-error", form); box.textContent = "Captura al menos " + options.minLength + " caracteres."; box.classList.remove("hidden"); input.focus(); return;
      }
      finish(value);
    });
    $("[data-action-cancel]", actionDialog).addEventListener("click", () => finish(asksForText ? null : false));
    actionDialog.oncancel = (event) => { event.preventDefault(); finish(asksForText ? null : false); };
    actionDialog.onclick = (event) => { if (event.target === actionDialog) finish(asksForText ? null : false); };
    actionDialog.showModal();
    requestAnimationFrame(() => (input || $("button[type=submit]", form))?.focus());
  });
}

async function prefetchHrControl() {
  if (state.hrControl || state.user?.mustChangePassword || !hasPermission("hr.view")) return;
  try {
    const control = await api("/api/hr/control", { cacheTtlMs: HR_CONTROL_CACHE_MS });
    state.hrControl = control;
    state.hrOptions = control.options || state.hrOptions;
  } catch {
    // La navegación normal mostrará el error si RH realmente no está disponible.
  }
}

async function prefetchInventoryOverview() {
  if (state.user?.mustChangePassword || !hasPermission("inventory.view")) return;
  try {
    const overview = await loadInventoryOverview();
    state.inventoryOptions = overview.options;
  } catch {
    // La navegación normal mostrará el error si el almacén realmente no está disponible.
  }
}

async function loadInventoryOverview() {
  if (state.inventoryOverviewApiAvailable !== false) {
    try {
      const overview = await api("/api/inventory/overview", { cacheTtlMs: INVENTORY_OVERVIEW_CACHE_MS });
      state.inventoryOverviewApiAvailable = true;
      return overview;
    } catch (error) {
      if (error.status !== 404) throw error;
      state.inventoryOverviewApiAvailable = false;
    }
  }
  const [options, { balances }, { movements }] = await Promise.all([
    api("/api/inventory/options"),
    api("/api/inventory/balances"),
    api("/api/inventory/movements"),
  ]);
  return { options, balances, movements };
}

const viewPrefetchPaths = {
  masters_hub: ["/api/masters/options"],
  sales_control: ["/api/sales/options", "/api/sales/control"],
  production_control: ["/api/production/options", "/api/production/control"],
  purchases_control: ["/api/purchases/options", "/api/purchases/control"],
  quality_control: ["/api/quality/options", "/api/quality/control"],
  maintenance_control: ["/api/maintenance/options", "/api/maintenance/control"],
  logistics_control: ["/api/logistics/options", "/api/logistics/control"],
  finance_control: ["/api/finance/options", "/api/finance/control"],
  safety_control: ["/api/safety/options", "/api/safety/control"],
  tasks_assigned: ["/api/tasks/options", "/api/tasks/control"],
};

async function prefetchViewData(view) {
  if (state.user?.mustChangePassword) return;
  if (view === "inventory_stock") return prefetchInventoryOverview();
  if (view === "hr_control") {
    try { await Promise.all([prefetchHrControl(), loadHrUiModule()]); } catch {}
    return;
  }
  const paths = [...(viewPrefetchPaths[view] || [])];
  if (view === "payroll_control") {
    const payrollQuery = state.payrollPeriodId ? `?periodId=${encodeURIComponent(state.payrollPeriodId)}` : "";
    paths.push("/api/payroll/control" + payrollQuery);
  }
  if (operationalTaskModuleByView[view] && hasPermission("tasks.view")) paths.push("/api/tasks/control");
  if (!paths.length) return;
  try {
    await Promise.all(paths.map((path) => api(path)));
  } catch {
    // La navegación conserva el manejo visible de errores de cada módulo.
  }
}

function startHeaderClock() {
  const update = () => {
    const now = new Date();
    $("#current-date").textContent = new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(now);
    $("#current-time").textContent = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(now);
  };
  update();
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = setInterval(update, 1000);
}

function renderIdentity() {
  const name = state.user.fullName || state.user.username;
  $("#profile-name").textContent = name;
  $("#profile-role").textContent = state.user.roles[0]?.name ?? "Sin rol";
  $("#profile-initials").textContent = initials(name);
}

function renderNavigation() {
  $$('[data-permission]').forEach((item) => {
    item.classList.toggle("hidden", !hasPermission(item.dataset.permission));
  });
  $$('[data-nav-group]').forEach((group) => {
    group.classList.toggle("hidden", !$(".nav-item:not(.hidden)", group));
  });
  openNavGroupForView(state.currentView);
}

function setNavGroupOpen(group, open) {
  group.classList.toggle("open", open);
  $(".nav-group-toggle", group)?.setAttribute("aria-expanded", String(open));
}

function openNavGroupForView(view) {
  const activeItem = $(`.nav-item[data-view="${view}"]`);
  const activeGroup = activeItem?.closest("[data-nav-group]");
  $$('[data-nav-group]').forEach((group) => setNavGroupOpen(group, group === activeGroup));
}

async function submitPasswordChange(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $(".form-error", form);
  const button = $("button[type=submit]", form);
  errorBox.classList.add("hidden");
  if (form.newPassword.value !== form.confirmPassword.value) {
    errorBox.textContent = "Las contraseñas nuevas no coinciden.";
    return errorBox.classList.remove("hidden");
  }
  button.disabled = true;
  try {
    const result = await api("/api/auth/change-password", {
      method: "POST",
      body: { currentPassword: form.currentPassword.value, newPassword: form.newPassword.value },
    });
    state.user = result.user;
    form.reset();
    passwordDialog.close();
    renderIdentity();
    toast("Contraseña actualizada. Tu cuenta ya está protegida.");
    await navigate("dashboard");
  } catch (error) {
    errorBox.textContent = [error.message, ...(error.details ?? [])].join(" ");
    errorBox.classList.remove("hidden");
  } finally {
    button.disabled = false;
  }
}

function showPasswordDialog() {
  if (!passwordDialog.open) passwordDialog.showModal();
}

async function logout() {
  const confirmed = await confirmAction({
    eyebrow: "CIERRE DE SESIÓN",
    title: "¿Deseas cerrar tu sesión?",
    message: "Se cerrará tu acceso actual y volverás a la pantalla de inicio.",
    confirmLabel: "Cerrar sesión",
    cancelLabel: "Permanecer aquí",
    tone: "danger",
  });
  if (!confirmed) return;
  try { await api("/api/auth/logout", { method: "POST" }); } catch {}
  state.user = null;
  state.csrfToken = "";
  showLogin();
}

async function navigate(view) {
  const permission = masterHubViews.has(view) || masterUi[view] ? "masters.view" : inventoryViews.has(view) ? "inventory.view" : purchasesViews.has(view) ? "purchases.view" : salesViews.has(view) ? "sales.view" : productionViews.has(view) ? "production.view" : qualityViews.has(view) ? "quality.view" : maintenanceViews.has(view) ? "maintenance.view" : logisticsViews.has(view) ? "logistics.view" : financeViews.has(view) ? "finance.view" : tasksViews.has(view) ? "tasks.view" : safetyViews.has(view) ? "safety.view" : hrViews.has(view) ? "hr.view" : payrollViews.has(view) ? "payroll.view" : ({
    dashboard: "dashboard.view", users: "users.view", roles: "roles.view",
    areas: "areas.view", catalogs: "catalogs.view", folios: "folios.view", documents: "documents.view",
    notifications: "notifications.view", audit: "audit.view", settings: "settings.view",
  }[view]);
  if (!permission || !hasPermission(permission)) return;
  state.currentView = view;
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  openNavGroupForView(view);
  const titles = {
    dashboard: ["Dashboards", "OPERACIÓN / DASHBOARDS"], users: ["Usuarios", "NÚCLEO / USUARIOS"],
    roles: ["Roles y permisos", "NÚCLEO / SEGURIDAD"], areas: ["Áreas", "CATÁLOGOS / ÁREAS"],
    catalogs: ["Catálogos generales", "NÚCLEO / CATÁLOGOS"], folios: ["Folios y consecutivos", "NÚCLEO / FOLIOS"],
    documents: ["Archivos y documentos", "NÚCLEO / DOCUMENTOS"], notifications: ["Notificaciones", "NÚCLEO / NOTIFICACIONES"],
    masters_hub: ["Datos maestros", "DATOS MAESTROS / MIS DATOS"],
    items: ["Artículos", "MAESTROS / ARTÍCULOS"], customers: ["Clientes", "MAESTROS / CLIENTES"],
    suppliers: ["Proveedores", "MAESTROS / PROVEEDORES"], employees: ["Empleados", "MAESTROS / EMPLEADOS"],
    resources: ["Recursos", "MAESTROS / RECURSOS"], price_lists: ["Precios y costos", "MAESTROS / LISTAS"],
    inventory_stock: ["Mis almacenes", "ALMACÉN / CONTROL VISUAL"], inventory_entries: ["Entradas", "INVENTARIO / ENTRADAS"],
    inventory_exits: ["Salidas", "INVENTARIO / SALIDAS"], inventory_transfers: ["Transferencias", "INVENTARIO / TRANSFERENCIAS"],
    inventory_adjustments: ["Ajustes", "INVENTARIO / AJUSTES"], inventory_reservations: ["Reservas", "INVENTARIO / RESERVAS"],
    inventory_lots: ["Lotes y series", "INVENTARIO / TRAZABILIDAD"], inventory_locations: ["Ubicaciones", "INVENTARIO / UBICACIONES"],
    inventory_counts: ["Conteos físicos", "INVENTARIO / CONTEOS"],
    purchases_control: ["Mis compras", "COMPRAS / CONTROL VISUAL"],
    purchases_requests: ["Solicitud de compra", "COMPRAS / SOLICITUDES"], purchases_comparisons: ["Comparación de proveedores", "COMPRAS / COMPARACIONES"],
    purchases_orders: ["Orden de compra", "COMPRAS / ÓRDENES"], purchases_receipts: ["Recepción", "COMPRAS / RECEPCIONES"],
    purchases_returns: ["Devolución", "COMPRAS / DEVOLUCIONES"], purchases_invoices: ["Factura de proveedor", "COMPRAS / FACTURAS"],
    sales_control: ["Mis ventas", "VENTAS / CONTROL VISUAL"],
    production_control: ["Mi producción", "PRODUCCIÓN / CONTROL VISUAL"],
    quality_control: ["Mi calidad", "CALIDAD / CONTROL VISUAL"],
    maintenance_control: ["Programa anual", "MANTENIMIENTO / PROGRAMA ISO"],
    maintenance_equipment: ["Equipos", "MANTENIMIENTO / EQUIPOS"], maintenance_plans: ["Planes preventivos", "MANTENIMIENTO / PLANES PREVENTIVOS"],
    maintenance_requests: ["Solicitudes de mantenimiento", "MANTENIMIENTO / SOLICITUDES"], maintenance_orders: ["Órdenes de mantenimiento", "MANTENIMIENTO / ÓRDENES"],
    maintenance_parts: ["Refacciones", "MANTENIMIENTO / REFACCIONES"], maintenance_downtimes: ["Paros", "MANTENIMIENTO / PAROS"],
    maintenance_history: ["Historial de equipos", "MANTENIMIENTO / HISTORIAL"],
    safety_control: ["Seguridad y salud", "SEGURIDAD Y SALUD / CONTROL INTEGRAL"],
    hr_control: ["Recursos humanos", "RECURSOS HUMANOS / CONTROL INTEGRAL"],
    payroll_control: ["Nómina y CFDI", "RECURSOS HUMANOS / NÓMINA"],
    logistics_control: ["Mi logística", "LOGÍSTICA / CONTROL VISUAL"],
    logistics_preparation: ["Preparación de pedidos", "LOGÍSTICA / PREPARACIÓN"], logistics_picking: ["Picking", "LOGÍSTICA / PICKING"],
    logistics_packing: ["Packing", "LOGÍSTICA / PACKING"], logistics_routes: ["Rutas de entrega", "LOGÍSTICA / RUTAS"],
    logistics_carriers: ["Transportistas", "LOGÍSTICA / TRANSPORTISTAS"], logistics_evidence: ["Evidencias", "LOGÍSTICA / EVIDENCIAS"],
    logistics_confirmation: ["Confirmación de entrega", "LOGÍSTICA / CONFIRMACIÓN"],
    finance_control: ["Mis finanzas", "FINANZAS / CONTROL VISUAL"],
    finance_receivables: ["Cuentas por cobrar", "FINANZAS / CUENTAS POR COBRAR"], finance_payables: ["Cuentas por pagar", "FINANZAS / CUENTAS POR PAGAR"],
    finance_payments: ["Pagos", "FINANZAS / PAGOS"], finance_collections: ["Cobros", "FINANZAS / COBROS"],
    finance_cost_centers: ["Centros de costos", "FINANZAS / CENTROS DE COSTOS"], finance_budgets: ["Presupuestos", "FINANZAS / PRESUPUESTOS"],
    finance_reconciliations: ["Conciliaciones", "FINANZAS / CONCILIACIONES"],
    tasks_assigned: ["Tareas asignadas", "TAREAS / ASIGNADAS"], tasks_flows: ["Flujos de aprobación", "TAREAS / FLUJOS"],
    tasks_comments: ["Comentarios", "TAREAS / COMENTARIOS"], tasks_rejections: ["Rechazos", "TAREAS / RECHAZOS"],
    tasks_reassignments: ["Reasignaciones", "TAREAS / REASIGNACIONES"], tasks_deadlines: ["Fechas límite", "TAREAS / FECHAS LÍMITE"],
    tasks_history: ["Historial de decisiones", "TAREAS / HISTORIAL"],
    audit: ["Bitácora de movimientos", "NÚCLEO / AUDITORÍA"], settings: ["Configuración general", "SISTEMA / CONFIGURACIÓN"],
  };
  $("#page-title").textContent = titles[view][0];
  $("#breadcrumbs").textContent = titles[view][1];
  pageContent.setAttribute("aria-busy", "true");
  pageContent.innerHTML = moduleLoadingSkeleton(view, titles[view]);
  void prefetchViewData(view);
  try {
    if (masterHubViews.has(view)) await renderMasterHub();
    else if (masterUi[view]) await renderMaster(view);
    else if (inventoryViews.has(view)) await renderInventory(view);
    else if (purchasesViews.has(view)) await renderPurchases(view);
    else if (salesViews.has(view)) await renderSales(view);
    else if (productionViews.has(view)) await renderProduction(view);
    else if (qualityViews.has(view)) await renderQuality(view);
    else if (maintenanceViews.has(view)) await renderMaintenance(view);
    else if (logisticsViews.has(view)) await renderLogistics(view);
    else if (financeViews.has(view)) await renderFinance(view);
    else if (tasksViews.has(view)) await renderTasks(view);
    else if (safetyViews.has(view)) await renderSafety();
    else if (hrViews.has(view)) await renderHr();
    else if (payrollViews.has(view)) await renderPayroll();
    else await ({ dashboard: renderDashboard, users: renderUsers, roles: renderRoles, areas: renderAreas, catalogs: renderCatalogs,
      folios: renderFolios, documents: renderDocuments, notifications: renderNotifications, audit: renderAudit, settings: renderSettings })[view]();
    if (operationalTaskModuleByView[view] && hasPermission("tasks.view")) {
      await appendOperationalTaskPanel(operationalTaskModuleByView[view], view);
    }
    pageContent.focus();
  } catch (error) {
    if (state.currentView === view) pageContent.innerHTML = errorState(error.message);
  } finally {
    if (state.currentView === view) pageContent.setAttribute("aria-busy", "false");
  }
}

function beginPageRender() {
  const token = ++state.renderToken;
  pageContent.onclick = null;
  return token;
}

function renderIsCurrent(token) {
  return token === state.renderToken;
}

const dashboardShortcutCatalog = [
  { id: "sales", label: "Ventas", description: "Pedidos y seguimiento comercial", symbol: "↗", permission: "sales.view", view: "sales_control" },
  { id: "inventory", label: "Almacén", description: "Existencias y movimientos", symbol: "▤", permission: "inventory.view", view: "inventory_stock" },
  { id: "purchases", label: "Compras", description: "Solicitudes y órdenes", symbol: "↘", permission: "purchases.view", view: "purchases_control" },
  { id: "production", label: "Producción", description: "Órdenes y avance de planta", symbol: "⚒", permission: "production.view", view: "production_control" },
  { id: "quality", label: "Calidad", description: "Inspecciones y liberaciones", symbol: "✓", permission: "quality.view", view: "quality_control" },
  { id: "maintenance", label: "Mantenimiento", description: "Equipos y trabajos técnicos", symbol: "⚙", permission: "maintenance.view", view: "maintenance_control" },
  { id: "safety", label: "Seguridad y salud", description: "Prevención, riesgos y cumplimiento", symbol: "✚", permission: "safety.view", view: "safety_control" },
  { id: "hr", label: "Recursos humanos", description: "Personal, ausencias y asistencia", symbol: "♙", permission: "hr.view", view: "hr_control" },
  { id: "logistics", label: "Logística", description: "Preparación y entregas", symbol: "⇢", permission: "logistics.view", view: "logistics_control" },
  { id: "finance", label: "Finanzas", description: "Tesorería y compromisos", symbol: "$", permission: "finance.view", view: "finance_control" },
  { id: "tasks", label: "Mis tareas", description: "Pendientes y aprobaciones", symbol: "●", permission: "tasks.view", view: "tasks_assigned" },
  { id: "masters", label: "Datos maestros", description: "Artículos, clientes y proveedores", symbol: "▦", permission: "masters.view", view: "masters_hub" },
  { id: "audit", label: "Bitácora", description: "Movimientos del sistema", symbol: "≡", permission: "audit.view", view: "audit" },
  { id: "supervision", label: "Supervisión del sistema", description: "Sesiones, eventos y actividad", symbol: "◉", permission: "settings.view", view: "settings", section: "supervision" },
  { id: "settings", label: "Configuración", description: "Identidad y seguridad", symbol: "⚙", permission: "settings.view", view: "settings", section: "general" },
];

function dashboardShortcutStorageKey() {
  return "abicorp.dashboard.shortcuts." + (state.user?.id || state.user?.username || "local");
}

function availableDashboardShortcuts() {
  return dashboardShortcutCatalog.filter((shortcut) => hasPermission(shortcut.permission));
}

function dashboardShortcutIds() {
  const available = availableDashboardShortcuts();
  const validIds = new Set(available.map((shortcut) => shortcut.id));
  try {
    const stored = JSON.parse(localStorage.getItem(dashboardShortcutStorageKey()));
    if (Array.isArray(stored)) return stored.filter((id, index) => validIds.has(id) && stored.indexOf(id) === index);
  } catch {}
  return ["sales", "inventory", "purchases", "tasks", "supervision"].filter((id) => validIds.has(id));
}

function saveDashboardShortcutIds(ids) {
  localStorage.setItem(dashboardShortcutStorageKey(), JSON.stringify(ids));
}

function dashboardShortcutCard(shortcut) {
  return '<article class="dashboard-shortcut-card"><button type="button" class="dashboard-shortcut-open" data-dashboard-shortcut="' + shortcut.id + '"><span>' + shortcut.symbol + '</span><div><strong>' + escapeHtml(shortcut.label) + '</strong><small>' + escapeHtml(shortcut.description) + '</small></div><b>→</b></button><button type="button" class="dashboard-shortcut-remove" data-remove-dashboard-shortcut="' + shortcut.id + '" aria-label="Quitar atajo ' + escapeAttribute(shortcut.label) + '" title="Quitar atajo">×</button></article>';
}

async function renderDashboard() {
  beginPageRender();
  const selectedIds = dashboardShortcutIds();
  const catalog = availableDashboardShortcuts();
  const selected = selectedIds.map((id) => catalog.find((shortcut) => shortcut.id === id)).filter(Boolean);
  pageContent.innerHTML = '<section class="dashboard-welcome"><div><span class="eyebrow">DASHBOARDS</span><h2>Buenos días, ' + escapeHtml(firstName(state.user.fullName)) + '.</h2><p>Organiza aquí los accesos que utilizas con mayor frecuencia.</p></div></section>' +
    '<section class="dashboard-shortcuts-panel"><div class="dashboard-shortcuts-head"><div><span class="eyebrow">TU ESPACIO DE TRABAJO</span><h3>Mis atajos</h3><p>Puedes agregar o quitar los accesos que utilizas cada día.</p></div><div class="dashboard-shortcuts-actions"><span>' + selected.length + ' ATAJO(S)</span><button class="button primary" type="button" id="add-dashboard-shortcut">＋ Agregar atajo</button></div></div>' +
    (selected.length ? '<div class="dashboard-shortcut-grid">' + selected.map(dashboardShortcutCard).join("") + '</div>' : '<div class="dashboard-shortcut-empty"><span>＋</span><strong>Tu dashboard está vacío</strong><p>Agrega los módulos que quieres tener siempre a la mano.</p><button class="button primary" type="button" data-empty-add-shortcut>Agregar mi primer atajo</button></div>') + '</section>';
  pageContent.onclick = (event) => {
    if (event.target.closest("#add-dashboard-shortcut") || event.target.closest("[data-empty-add-shortcut]")) return openDashboardShortcutModal();
    const remove = event.target.closest("[data-remove-dashboard-shortcut]");
    if (remove) {
      saveDashboardShortcutIds(dashboardShortcutIds().filter((id) => id !== remove.dataset.removeDashboardShortcut));
      return renderDashboard();
    }
    const open = event.target.closest("[data-dashboard-shortcut]");
    if (!open) return;
    const shortcut = dashboardShortcutCatalog.find((item) => item.id === open.dataset.dashboardShortcut);
    if (!shortcut) return;
    if (shortcut.section) state.settingsSection = shortcut.section;
    navigate(shortcut.view);
  };
}

function openDashboardShortcutModal() {
  const selected = new Set(dashboardShortcutIds());
  const available = availableDashboardShortcuts().filter((shortcut) => !selected.has(shortcut.id));
  $("#entity-modal-content").classList.remove("wide");
  $("#entity-modal-content").innerHTML = '<form id="dashboard-shortcut-form"><div class="modal-head"><div><span class="eyebrow">PERSONALIZAR DASHBOARD</span><h2>Agregar atajos</h2><p class="muted">Selecciona uno o varios accesos para tu pantalla principal.</p></div><button type="button" data-close-modal>×</button></div>' +
    (available.length ? '<div class="shortcut-picker">' + available.map((shortcut) => '<label><input type="checkbox" name="shortcut" value="' + shortcut.id + '" /><span>' + shortcut.symbol + '</span><div><strong>' + escapeHtml(shortcut.label) + '</strong><small>' + escapeHtml(shortcut.description) + '</small></div></label>').join("") + '</div>' : emptyMarkup("Ya agregaste todos los atajos", "Puedes quitar alguno del dashboard para cambiarlo.")) +
    '<p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cerrar</button>' + (available.length ? '<button class="button primary" type="submit">Agregar seleccionados</button>' : "") + '</div></form>';
  $("#dashboard-shortcut-form").onsubmit = (event) => {
    event.preventDefault();
    const additions = Array.from(new FormData(event.currentTarget).getAll("shortcut"));
    const error = $(".form-error", event.currentTarget);
    if (!additions.length) {
      error.textContent = "Selecciona al menos un atajo.";
      return error.classList.remove("hidden");
    }
    saveDashboardShortcutIds([...dashboardShortcutIds(), ...additions]);
    entityDialog.close();
    renderDashboard();
  };
  entityDialog.showModal();
}

async function renderUsers() {
  const token = beginPageRender();
  const [usersResult, rolesResult, areasResult] = await Promise.all([api("/api/users"), api("/api/roles"), api("/api/areas")]);
  if (!renderIsCurrent(token)) return;
  state.users = usersResult.users;
  state.roles = rolesResult.roles;
  state.areas = areasResult.areas;
  pageContent.innerHTML = `
    <section class="page-lead"><div><span class="eyebrow">CONTROL DE ACCESO</span><h2>Personas con acceso</h2><p>Administra identidades, áreas asignadas y el nivel de autorización de cada persona.</p></div>
    ${hasPermission("users.manage") ? '<button id="new-user-button" class="button primary">＋ Nuevo usuario</button>' : ""}</section>
    <div class="table-wrap"><table><thead><tr><th>Usuario</th><th>Rol</th><th>Área</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${state.users.map(userRow).join("")}
    </tbody></table></div>`;
  $("#new-user-button")?.addEventListener("click", () => openUserModal());
  pageContent.onclick = (event) => {
    const button = event.target.closest("[data-edit-user]");
    if (button) openUserModal(state.users.find((user) => user.id === Number(button.dataset.editUser)));
  };
}

function userRow(user) {
  const status = user.status === "active" ? ["Activo", ""] : user.status === "blocked" ? ["Bloqueado", "danger"] : ["Inactivo", "warn"];
  return `<tr><td><strong>${escapeHtml(user.fullName)}</strong><small>${escapeHtml(user.username)}${user.email ? ` · ${escapeHtml(user.email)}` : ""}</small></td>
    <td><div class="chips">${user.roles.map((role) => `<span class="chip">N${role.level} · ${escapeHtml(role.name)}</span>`).join("")}</div></td>
    <td>${user.areas.length ? user.areas.map((area) => escapeHtml(area.name)).join(", ") : '<span class="muted">Sin asignar</span>'}</td>
    <td><span class="badge ${status[1]}">● ${status[0]}</span></td><td>${formatDate(user.lastLoginAt, "Nunca")}</td>
    <td><div class="table-actions">${hasPermission("users.manage") ? `<button class="link-button" data-edit-user="${user.id}">Editar</button>` : ""}</div></td></tr>`;
}

function openUserModal(user = null) {
  const editing = Boolean(user);
  const content = $("#entity-modal-content");
  content.innerHTML = `<form id="user-form">
    <div class="modal-head"><div><span class="eyebrow">${editing ? "EDITAR CUENTA" : "NUEVA CUENTA"}</span><h2>${editing ? escapeHtml(user.fullName) : "Crear usuario"}</h2><p class="muted">Define sus datos de acceso y alcance dentro del ERP.</p></div><button type="button" data-close-modal aria-label="Cerrar">×</button></div>
    <div class="form-grid">
      <label>Usuario<input name="username" value="${escapeAttribute(user?.username ?? "")}" ${editing ? "disabled" : "required"} placeholder="nombre.apellido" /></label>
      <label>Nombre completo<input name="fullName" value="${escapeAttribute(user?.fullName ?? "")}" required /></label>
    </div>
    <div class="form-grid"><label>Correo electrónico<input name="email" type="email" value="${escapeAttribute(user?.email ?? "")}" placeholder="persona@empresa.com" /></label>
      ${editing ? `<label>Estado<select name="status"><option value="active" ${user.status === "active" ? "selected" : ""}>Activo</option><option value="blocked" ${user.status === "blocked" ? "selected" : ""}>Bloqueado</option><option value="inactive" ${user.status === "inactive" ? "selected" : ""}>Inactivo</option></select></label>` : '<label>Contraseña temporal<input name="password" type="password" required placeholder="Mínimo 10 caracteres" /></label>'}
    </div>
    <label>Roles asignados<div class="check-grid">${state.roles.map((role) => checkbox("roleIds", role.id, `Nivel ${role.level} · ${role.name}`, user?.roles.some((item) => item.id === role.id))).join("")}</div></label>
    <label>Áreas asignadas<div class="check-grid">${state.areas.length ? state.areas.map((area) => checkbox("areaIds", area.id, `${area.code} · ${area.name}`, user?.areas.some((item) => item.id === area.id))).join("") : '<span class="muted">No hay áreas registradas.</span>'}</div></label>
    <p class="form-error hidden" role="alert"></p>
    <div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">${editing ? "Guardar cambios" : "Crear usuario"}</button></div>
  </form>`;
  $("#user-form").addEventListener("submit", (event) => saveUser(event, user));
  entityDialog.showModal();
}

async function saveUser(event, user) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $(".form-error", form);
  const submit = $("button[type=submit]", form);
  const data = new FormData(form);
  const body = {
    fullName: data.get("fullName"), email: data.get("email"),
    roleIds: data.getAll("roleIds").map(Number), areaIds: data.getAll("areaIds").map(Number),
  };
  if (user) body.status = data.get("status");
  else { body.username = data.get("username"); body.password = data.get("password"); }
  submit.disabled = true;
  errorBox.classList.add("hidden");
  try {
    await api(user ? `/api/users/${user.id}` : "/api/users", { method: user ? "PATCH" : "POST", body });
    entityDialog.close();
    toast(user ? "Usuario actualizado." : "Usuario creado con contraseña temporal.");
    await renderUsers();
  } catch (error) {
    errorBox.textContent = [error.message, ...(error.details ?? [])].join(" ");
    errorBox.classList.remove("hidden");
  } finally { submit.disabled = false; }
}

async function renderRoles() {
  const token = beginPageRender();
  const result = await api("/api/roles");
  if (!renderIsCurrent(token)) return;
  state.roles = result.roles;
  state.permissions = result.permissions;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">AUTORIZACIÓN</span><h2>Cuatro niveles de control</h2><p>Los permisos se heredan mediante roles y siempre se verifican en el servidor.</p></div></section>
    <section class="level-explainer"><div><strong>Nivel 1</strong><span>Consultar</span></div><div><strong>Nivel 2</strong><span>Crear y editar</span></div><div><strong>Nivel 3</strong><span>Validar y aprobar</span></div><div><strong>Nivel 4</strong><span>Administrar</span></div></section>
    <section class="role-grid">${state.roles.map((role) => `<article class="role-card" data-level="${role.level}"><span class="eyebrow">NIVEL ${role.level}</span><h3>${escapeHtml(role.name)}</h3><p>${escapeHtml(role.description)}</p><div class="permission-list">${role.permissions.slice(0, 4).map((permission) => `<span class="chip">${escapeHtml(permission.code)}</span>`).join("")}${role.permissions.length > 4 ? `<span class="chip">+${role.permissions.length - 4}</span>` : ""}</div><div class="role-meta"><span>${role.usersCount} usuario(s)</span><span>${role.permissions.length} permisos</span></div>${hasPermission("roles.manage") && role.code !== "ADMIN" ? `<button class="button ghost role-edit" data-edit-role="${role.id}">Configurar permisos</button>` : role.code === "ADMIN" ? '<span class="protected-label">ROL PROTEGIDO</span>' : ""}</article>`).join("")}</section>`;
  pageContent.onclick = (event) => {
    const button = event.target.closest("[data-edit-role]");
    if (button) openRoleModal(state.roles.find((role) => role.id === Number(button.dataset.editRole)));
  };
}

function openRoleModal(role) {
  const grouped = state.permissions.reduce((result, permission) => {
    (result[permission.module] ??= []).push(permission);
    return result;
  }, {});
  $("#entity-modal-content").innerHTML = `<form id="role-form"><div class="modal-head"><div><span class="eyebrow">NIVEL ${role.level}</span><h2>${escapeHtml(role.name)}</h2><p class="muted">Selecciona las acciones que este nivel puede realizar. Los permisos superiores permanecen bloqueados.</p></div><button type="button" data-close-modal>×</button></div>
    <div class="permission-matrix">${Object.entries(grouped).map(([module, permissions]) => `<section><h3>${escapeHtml(module)}</h3>${permissions.map((permission) => `<label class="check-option ${permission.min_level > role.level ? "locked" : ""}"><input type="checkbox" name="permissionIds" value="${permission.id}" ${role.permissions.some((item) => item.id === permission.id) ? "checked" : ""} ${permission.min_level > role.level ? "disabled" : ""}/><span><strong>${escapeHtml(permission.description)}</strong><small>${escapeHtml(permission.code)} · Nivel ${permission.min_level}</small></span></label>`).join("")}</section>`).join("")}</div>
    <p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar permisos</button></div></form>`;
  $("#role-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      await api(`/api/roles/${role.id}`, { method: "PATCH", body: { permissionIds: new FormData(form).getAll("permissionIds").map(Number) } });
      entityDialog.close(); toast(`Permisos de ${role.name} actualizados.`); await renderRoles();
    } catch (error) { const box = $(".form-error", form); box.textContent = error.message; box.classList.remove("hidden"); }
  });
  entityDialog.showModal();
}

async function renderCatalogs(type = state.catalogType) {
  const token = beginPageRender();
  state.catalogType = type;
  const requests = [api(`/api/catalogs/${type}`)];
  if (!state.catalogCache.companies && type !== "companies") requests.push(api("/api/catalogs/companies"));
  if (!state.catalogCache.branches && !["companies", "branches"].includes(type)) requests.push(api("/api/catalogs/branches"));
  const results = await Promise.all(requests);
  if (!renderIsCurrent(token)) return;
  state.catalogCache[type] = results[0].records;
  for (const result of results.slice(1)) {
    if (result.type) state.catalogCache[result.type] = result.records;
  }
  const definition = catalogUi[type];
  const records = state.catalogCache[type];
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">DATOS COMPARTIDOS</span><h2>${escapeHtml(definition.label)}</h2><p>${escapeHtml(definition.description)}</p></div>${hasPermission("catalogs.manage") ? `<button id="new-catalog-record" class="button primary">＋ Nueva ${escapeHtml(definition.singular.toLowerCase())}</button>` : ""}</section>
    <div class="catalog-tabs" role="tablist">${Object.entries(catalogUi).map(([key, item]) => `<button role="tab" class="catalog-tab ${key === type ? "active" : ""}" data-catalog="${key}">${escapeHtml(item.label)}</button>`).join("")}</div>
    <div class="table-wrap"><table><thead><tr><th>Código / identificación</th><th>Nombre</th><th>Detalle</th><th>Estado</th><th></th></tr></thead><tbody>${records.length ? records.map((record) => catalogRow(type, record)).join("") : `<tr><td colspan="5">${emptyMarkup(`No hay ${definition.label.toLowerCase()}`, "Crea el primer registro para comenzar.")}</td></tr>`}</tbody></table></div>`;
  $("#new-catalog-record")?.addEventListener("click", () => openCatalogModal(type));
  pageContent.onclick = (event) => {
    const tab = event.target.closest("[data-catalog]");
    if (tab) return renderCatalogs(tab.dataset.catalog);
    const edit = event.target.closest("[data-edit-catalog]");
    if (edit) openCatalogModal(type, records.find((record) => record.id === Number(edit.dataset.editCatalog)));
  };
}

function catalogRow(type, record) {
  const code = record.code ?? record.document_type ?? `#${record.id}`;
  const name = record.legal_name ?? record.name ?? "—";
  let detail = record.trade_name || record.description || record.address || record.symbol || "";
  if (type === "branches") detail = record.company_name;
  if (type === "warehouses") detail = record.branch_name;
  if (type === "units") detail = `${record.symbol} · ${record.decimals} decimal(es)`;
  if (type === "currencies") detail = `${record.symbol} · Cambio ${Number(record.exchange_rate).toLocaleString("es-MX")}${record.is_base ? " · Base" : ""}`;
  if (type === "document_states") detail = `${record.description || "Sin descripción"} · Orden ${record.sequence}${record.is_terminal ? " · Terminal" : ""}`;
  return `<tr><td><strong>${type === "document_states" ? '<span class="state-color"></span>' : ""}${escapeHtml(code)}</strong><small>#${record.id}</small></td><td><strong>${escapeHtml(name)}</strong>${record.tax_id ? `<small>${escapeHtml(record.tax_id)}</small>` : ""}</td><td>${escapeHtml(detail || "—")}</td><td><span class="badge ${record.is_active ? "" : "warn"}">● ${record.is_active ? "Activo" : "Inactivo"}</span></td><td><div class="table-actions">${hasPermission("catalogs.manage") ? `<button class="link-button" data-edit-catalog="${record.id}">Editar</button>` : ""}</div></td></tr>`;
}

function openCatalogModal(type, record = null) {
  const definition = catalogUi[type];
  const automatic = automaticCatalogCodes[type];
  const fields = definition.fields.filter(([name]) => name !== automatic?.field).map(([name, label, inputType]) => catalogField(name, label, inputType, record)).join("");
  $("#entity-modal-content").innerHTML = `<form id="catalog-form"><div class="modal-head"><div><span class="eyebrow">CATÁLOGOS GENERALES</span><h2>${record ? `Editar ${escapeHtml(definition.singular.toLowerCase())}` : `Nueva ${escapeHtml(definition.singular.toLowerCase())}`}</h2><p class="muted">Este dato estará disponible para todos los módulos autorizados.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid catalog-form-grid">${fields}</div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar registro</button></div></form>`;
  if (automatic) $(".modal-head", $("#catalog-form")).insertAdjacentHTML("afterend", automaticCodeBanner(record?.[automatic.field] ?? automatic.example, !record));
  $("#catalog-form").addEventListener("submit", (event) => saveCatalogRecord(event, type, record));
  entityDialog.showModal();
}

function catalogField(name, label, inputType, record) {
  const value = record?.[name];
  const optionalFields = new Set(["trade_name", "tax_id", "address", "description"]);
  const required = optionalFields.has(name) ? "" : "required";
  if (inputType === "boolean") return `<label class="toggle-field"><input type="checkbox" name="${name}" ${value === undefined || Boolean(value) ? "checked" : ""}/><span>${escapeHtml(label)}</span></label>`;
  if (inputType === "textarea") return `<label class="span-two">${escapeHtml(label)}<textarea name="${name}" rows="3">${escapeHtml(value ?? "")}</textarea></label>`;
  if (inputType === "company") return `<label>${escapeHtml(label)}<select name="${name}" required><option value="">Selecciona una empresa</option>${(state.catalogCache.companies ?? []).map((company) => `<option value="${company.id}" ${Number(value) === company.id ? "selected" : ""}>${escapeHtml(company.legal_name)}</option>`).join("")}</select></label>`;
  if (inputType === "branch") return `<label>${escapeHtml(label)}<select name="${name}" required><option value="">Selecciona una sucursal</option>${(state.catalogCache.branches ?? []).map((branch) => `<option value="${branch.id}" ${Number(value) === branch.id ? "selected" : ""}>${escapeHtml(branch.name)}</option>`).join("")}</select></label>`;
  const htmlType = inputType === "decimal" || inputType === "number" ? "number" : inputType;
  const step = inputType === "decimal" ? 'step="0.000001" min="0.000001"' : inputType === "number" ? 'step="1" min="0"' : "";
  const defaultValue = name === "timezone" ? "America/Chicago" : name === "exchange_rate" ? "1" : name === "color" ? "#68736d" : "";
  return `<label>${escapeHtml(label)}<input type="${htmlType}" name="${name}" value="${escapeAttribute(value ?? defaultValue)}" ${step} ${required} /></label>`;
}

async function saveCatalogRecord(event, type, record) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const definition = catalogUi[type];
  const automatic = automaticCatalogCodes[type];
  const body = {};
  for (const [name, , inputType] of definition.fields) {
    if (name === automatic?.field) continue;
    if (inputType === "boolean") body[name] = data.has(name);
    else if (["company", "branch", "number", "decimal"].includes(inputType)) body[name] = Number(data.get(name));
    else body[name] = data.get(name);
  }
  try {
    const result = await api(record ? `/api/catalogs/${type}/${record.id}` : `/api/catalogs/${type}`, { method: record ? "PATCH" : "POST", body });
    entityDialog.close(); state.catalogCache = {}; toast(record ? `${definition.singular} actualizada.` : `${definition.singular} guardada con folio ${result.code ?? "automático"}.`); await renderCatalogs(type);
  } catch (error) { const box = $(".form-error", form); box.textContent = error.message; box.classList.remove("hidden"); }
}

const masterHubConfig = {
  organization_structure: { label: "Estructura", singular: "registro", symbol: "▦", description: "Empresas, centros de trabajo y departamentos", tone: "teal" },
  items: { label: "Artículos", singular: "artículo", symbol: "◆", description: "Productos, materiales y servicios", tone: "lime" },
  customers: { label: "Clientes", singular: "cliente", symbol: "◎", description: "Personas y empresas que compran", tone: "blue" },
  suppliers: { label: "Proveedores", singular: "proveedor", symbol: "◇", description: "Empresas que te venden", tone: "amber" },
  areas: { label: "Áreas", singular: "área", symbol: "▦", description: "Estructura organizacional de Recursos Humanos", tone: "teal" },
  employees: { label: "Personal", singular: "persona", symbol: "♙", description: "Expedientes sincronizados desde Recursos Humanos", tone: "mint" },
  resources: { label: "Equipos", singular: "equipo", symbol: "⚒", description: "Máquinas, herramientas y recursos", tone: "steel" },
  price_lists: { label: "Precios", singular: "lista", symbol: "$", description: "Precios de venta y costos", tone: "gold" },
  maintenance_program: { label: "Programa anual", singular: "programa", symbol: "12", description: "Carga masiva de mantenimiento", tone: "teal" },
};

const masterHubModuleRequirements = {
  items: ["inventory", "purchases", "sales", "production", "quality", "maintenance", "logistics"],
  customers: ["sales", "logistics"],
  suppliers: ["purchases", "maintenance"],
  areas: ["hr", "payroll", "safety", "production", "quality", "maintenance"],
  employees: ["hr", "payroll", "safety"],
  resources: ["production", "quality", "maintenance"],
  price_lists: ["sales", "purchases"],
};

function hasModuleAccess(moduleKey) {
  return Boolean(state.user?.moduleAccess?.some((entry) => entry.key === moduleKey && Number(entry.level) > 0));
}

function availableMasterHubTypes() {
  return Object.keys(masterUi).filter((type) => masterHubModuleRequirements[type].some(hasModuleAccess));
}

async function renderMasterHub() {
  const token = beginPageRender();
  const types = availableMasterHubTypes();
  const canViewStructure = ["hr", "payroll", "safety"].some(hasModuleAccess) && hasPermission("hr.view");
  const canViewMaintenance = hasModuleAccess("maintenance") && hasPermission("maintenance.view");
  const sections = [...(canViewStructure ? ["organization_structure"] : []), ...types,
    ...(canViewMaintenance ? ["maintenance_program"] : [])];
  if (!sections.length) {
    if (!renderIsCurrent(token)) return;
    pageContent.innerHTML = `<section class="master-hub-topbar"><div><span class="eyebrow">INFORMACIÓN BASE DEL ERP</span><h2>Datos maestros</h2><p>Los catálogos se muestran según los módulos habilitados para esta empresa.</p></div></section>${emptyMarkup("Sin catálogos operativos", "Activa un módulo comercial, industrial o administrativo desde el Centro de Gestión.")}`;
    return;
  }
  const responses = await Promise.all([api("/api/masters/options"), ...types.map((type) => api(type === "areas" ? "/api/areas" : `/api/masters/${type}`)),
    ...(canViewStructure ? [api("/api/hr/structure")] : []), ...(canViewMaintenance ? [api("/api/maintenance/control")] : [])]);
  if (!renderIsCurrent(token)) return;
  state.masterOptions = responses[0];
  types.forEach((type, index) => state.masterRecords[type] = type === "areas" ? responses[index + 1].areas : responses[index + 1].records);
  const structureControl = canViewStructure ? responses[types.length + 1] : null;
  const maintenanceControl = canViewMaintenance ? responses[responses.length - 1] : null;
  const type = sections.includes(state.masterHubSection) ? state.masterHubSection : sections[0];
  state.masterHubSection = type;
  if (type === "organization_structure") return renderOrganizationStructureMaster(sections, structureControl, maintenanceControl);
  if (type === "maintenance_program") return renderMaintenanceProgramMaster(sections, maintenanceControl, structureControl);
  const config = masterHubConfig[type], definition = masterUi[type], records = state.masterRecords[type];
  const filter = state.masterFilter[type] ?? "all";
  const visible = filter === "all" || !definition.category ? records : records.filter((record) => record[definition.category] === filter);
  const active = records.filter((record) => masterRecordInfo(type, record).active).length;
  const categories = definition.categories ? new Set(records.map((record) => record[definition.category])).size : 1;
  const last = records[0]?.[definition.code] || "—";
  const employeeReadOnly = type === "employees";
  const canManageCurrentMaster = type === "areas" ? hasPermission("areas.manage") : hasPermission("masters.manage");
  const commandAction = employeeReadOnly
    ? (hasPermission("hr.view") ? '<div class="master-command-actions">' + (hasPermission("hr.manage") || hasPermission("hr.approve") || hasPermission("areas.manage") ? '<button class="button master-create" data-open-hr-catalogs><span>＋</span> Áreas y puestos</button>' : "") + '<button class="button ghost light" data-open-hr><span>→</span> Ver personal</button></div>' : '<span class="master-readonly-note">Consulta sincronizada</span>')
    : (canManageCurrentMaster ? `<button class="button master-create" id="new-master-hub"><span>＋</span> ${type === "areas" ? "Nueva" : "Nuevo"} ${escapeHtml(config.singular)}</button>` : "");
  const emptyDetail = employeeReadOnly ? "Registra al personal desde Recursos Humanos para consultarlo aquí." : `Crea el primer ${config.singular} para comenzar.`;
  pageContent.innerHTML = `<section class="master-hub-topbar"><div><span class="eyebrow">INFORMACIÓN BASE DEL ERP</span><h2>Datos maestros</h2><p>Catálogos relacionados con los módulos habilitados para esta empresa.</p></div></section>
    <section class="master-domain-switcher" aria-label="Tipo de dato">${sections.map((key) => key === "organization_structure" ? organizationStructureDomainCard(structureControl, key === type) : key === "maintenance_program" ? maintenanceProgramDomainCard(maintenanceControl, key === type) : masterDomainCard(key, state.masterRecords[key], key === type)).join("")}</section>
    <section class="master-command">
      <div class="master-command-copy"><span class="master-live"><i></i> ${employeeReadOnly ? "CONECTADO CON RECURSOS HUMANOS" : "SECCIÓN ACTIVA"}</span><h3>${escapeHtml(config.label)}</h3><p>${escapeHtml(config.description)}.</p><div class="master-command-stats"><span><strong>${records.length}</strong><small>registros</small></span><span><strong>${active}</strong><small>activos</small></span></div>${commandAction}</div>
      ${masterDataScene(type, records)}
    </section>
    <section class="master-vitals"><article><span>Total</span><strong>${records.length}</strong><small>Registros guardados</small></article><article><span>Activos</span><strong>${active}</strong><small>Disponibles para usar</small></article><article><span>Grupos</span><strong>${categories}</strong><small>Clasificaciones usadas</small></article><article><span>Último código</span><strong>${escapeHtml(last)}</strong><small>Registro más reciente</small></article></section>
    <section class="master-record-panel"><div class="master-record-head"><div><span class="eyebrow">${escapeHtml(config.label.toUpperCase())}</span><h3>Mis registros</h3></div><label class="master-search"><span>⌕</span><input id="master-hub-search" type="search" placeholder="Buscar por nombre o código…" value="${escapeAttribute(state.masterHubQuery)}" /></label></div>
    ${definition.categories ? `<div class="master-hub-filters"><button class="${filter === "all" ? "active" : ""}" data-master-hub-filter="all">Todos <span>${records.length}</span></button>${Object.entries(definition.categories).map(([key, label]) => `<button class="${filter === key ? "active" : ""}" data-master-hub-filter="${key}">${escapeHtml(masterSimpleCategory(label))} <span>${records.filter((record) => record[definition.category] === key).length}</span></button>`).join("")}</div>` : ""}
    <div id="master-hub-records" class="master-record-grid">${visible.length ? visible.map((record) => masterHubRecordCard(type, record)).join("") : emptyMarkup(`No hay ${config.label.toLowerCase()}`, emptyDetail)}</div></section>`;
  $("#new-master-hub")?.addEventListener("click", () => openMasterModal(type));
  pageContent.onclick = async (event) => {
    const section = event.target.closest("[data-master-hub-section]");
    if (section) { state.masterHubSection = section.dataset.masterHubSection; state.masterHubQuery = ""; return navigate("masters_hub"); }
    const filterButton = event.target.closest("[data-master-hub-filter]");
    if (filterButton) { state.masterFilter[type] = filterButton.dataset.masterHubFilter; return renderMasterHub(); }
    const edit = event.target.closest("[data-edit-master-hub]");
    if (edit) return openMasterModal(type, records.find((record) => record.id === Number(edit.dataset.editMasterHub)));
    if (event.target.closest("[data-open-hr-catalogs]")) {
      const hrModule = await loadHrUiModule();
      return hrModule.openCatalogs("areas");
    }
    if (event.target.closest("[data-open-hr]")) return navigate("hr_control");
    const lines = event.target.closest("[data-price-lines]");
    if (lines) return openPriceListItems(records.find((record) => record.id === Number(lines.dataset.priceLines)));
  };
  const search = $("#master-hub-search");
  if (search) search.oninput = () => {
    state.masterHubQuery = search.value;
    const query = search.value.trim().toLocaleLowerCase("es");
    let count = 0;
    $$(".master-record-card", $("#master-hub-records")).forEach((card) => { const show = !query || card.dataset.search.includes(query); card.hidden = !show; if (show) count += 1; });
    $("#master-search-empty")?.remove();
    if (!count && visible.length) $("#master-hub-records").insertAdjacentHTML("beforeend", '<div id="master-search-empty">' + emptyMarkup("Sin coincidencias", "Prueba con otro nombre o código.") + "</div>");
  };
}

function masterDomainCard(type, records, active) {
  const config = masterHubConfig[type], enabled = records.filter((record) => masterRecordInfo(type, record).active).length;
  return `<button class="master-domain ${config.tone} ${active ? "active" : ""}" data-master-hub-section="${type}"><span class="master-domain-icon">${config.symbol}<i></i></span><span><strong>${escapeHtml(config.label)}</strong><small>${escapeHtml(config.description)}</small></span><b>${records.length}</b><em>${enabled} activos</em></button>`;
}

function organizationStructureDomainCard(control, active) {
  const records = [...(control?.companies || []), ...(control?.workCenters || []), ...(control?.departments || [])];
  const config = masterHubConfig.organization_structure;
  return `<button class="master-domain ${config.tone} ${active ? "active" : ""}" data-master-hub-section="organization_structure"><span class="master-domain-icon">${config.symbol}<i></i></span><span><strong>${config.label}</strong><small>${config.description}</small></span><b>${records.length}</b><em>${records.filter((record) => record.is_active).length} activos</em></button>`;
}

function organizationChartMarkup(companies, centers, departments) {
  const company = companies[0];
  if (!company) return `<section class="panel organization-chart-panel">${emptyMarkup("Sin estructura disponible", "La empresa aparecerá aquí cuando esté disponible.")}</section>`;
  const departmentTree = (records) => {
    if (!records.length) return '<div class="organization-chart-empty">Sin departamentos</div>';
    const ids = new Set(records.map((row) => Number(row.id)));
    const children = new Map();
    records.forEach((row) => {
      const parentId = ids.has(Number(row.parent_department_id)) ? Number(row.parent_department_id) : 0;
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(row);
    });
    const visited = new Set();
    const renderNodes = (parentId = 0) => (children.get(parentId) || []).map((row) => {
      if (visited.has(Number(row.id))) return "";
      visited.add(Number(row.id));
      const descendants = renderNodes(Number(row.id));
      return `<div class="organization-department-tree"><button type="button" class="organization-chart-node department" data-manage-organization-structure="departments"><span>DEPARTAMENTO</span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.area_name || row.code || "Unidad organizativa")}</small></button>${descendants ? `<div class="organization-department-children">${descendants}</div>` : ""}</div>`;
    }).join("");
    const roots = renderNodes();
    const orphans = records.filter((row) => !visited.has(Number(row.id))).map((row) => `<div class="organization-department-tree"><button type="button" class="organization-chart-node department" data-manage-organization-structure="departments"><span>DEPARTAMENTO</span><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.area_name || row.code || "Unidad organizativa")}</small></button></div>`).join("");
    return roots + orphans;
  };
  const activeCenters = centers.filter((row) => Number(row.company_id) === Number(company.id));
  const generalDepartments = departments.filter((row) => Number(row.company_id) === Number(company.id) && !row.work_center_id);
  const branches = activeCenters.map((center) => {
    const linked = departments.filter((row) => Number(row.work_center_id) === Number(center.id));
    return `<article class="organization-chart-branch"><button type="button" class="organization-chart-node center" data-manage-organization-structure="work_centers"><span>${escapeHtml(organizationCenterLabel(center.center_type).toUpperCase())}</span><strong>${escapeHtml(center.name)}</strong><small>${linked.length} departamento(s)</small></button><div class="organization-chart-departments">${departmentTree(linked)}</div></article>`;
  });
  if (generalDepartments.length) branches.push(`<article class="organization-chart-branch general"><div class="organization-chart-node center"><span>ESTRUCTURA GENERAL</span><strong>Departamentos corporativos</strong><small>${generalDepartments.length} departamento(s)</small></div><div class="organization-chart-departments">${departmentTree(generalDepartments)}</div></article>`);
  const branchEdge = branches.length > 1 ? `${50 / branches.length}%` : "50%";
  return `<section class="panel organization-chart-panel"><div class="panel-title"><div><span class="eyebrow">ORGANIGRAMA</span><h3>Estructura actual</h3></div><span>${centers.length} centro(s) · ${departments.length} departamento(s)</span></div><div class="organization-chart" aria-label="Organigrama de la empresa"><button type="button" class="organization-chart-node company" data-manage-organization-structure="companies"><span>EMPRESA</span><strong>${escapeHtml(company.trade_name || company.legal_name)}</strong><small>${escapeHtml(company.code || company.legal_name)}</small></button>${branches.length ? `<div class="organization-chart-trunk" aria-hidden="true"></div><div class="organization-chart-branches" style="--branch-edge:${branchEdge}">${branches.join("")}</div>` : '<div class="organization-chart-empty main">Aún no hay centros ni departamentos.</div>'}</div></section>`;
}

function organizationCenterLabel(type) {
  return ({ plant: "Planta", branch: "Sucursal", work_center: "Centro de trabajo", office: "Oficina", other: "Otro" })[type] || "Centro de trabajo";
}

function renderOrganizationStructureMaster(sections, control, maintenanceControl) {
  const companies = control?.companies || [], centers = control?.workCenters || [], departments = control?.departments || [];
  const total = companies.length + centers.length + departments.length;
  pageContent.innerHTML = `<section class="master-hub-topbar"><div><span class="eyebrow">INFORMACIÓN BASE DEL ERP</span><h2>Datos maestros</h2><p>Catálogos generales compartidos por los módulos habilitados para esta empresa.</p></div></section>
    <section class="master-domain-switcher" aria-label="Tipo de dato">${sections.map((key) => key === "organization_structure" ? organizationStructureDomainCard(control, true) : key === "maintenance_program" ? maintenanceProgramDomainCard(maintenanceControl, false) : masterDomainCard(key, state.masterRecords[key], false)).join("")}</section>
    <section class="master-command organization-command">
      <div class="master-command-copy"><span class="master-live"><i></i> ESTRUCTURA COMPARTIDA</span><h3>Organización de la empresa</h3><p>La empresa proviene del Centro de Gestión. Aquí se agregan únicamente sus centros de trabajo y departamentos para alimentar los expedientes laborales.</p><div class="master-command-stats"><span><strong>${total}</strong><small>registros</small></span><span><strong>${companies.filter((row) => row.is_active).length}</strong><small>empresa administrada</small></span></div>${hasPermission("hr.manage") ? '<button class="button master-create" data-manage-organization-structure="companies"><span>→</span> Consultar estructura</button>' : ""}</div>
      <div class="organization-structure-scene" aria-label="Flujo de estructura organizacional"><article><span>01</span><strong>Empresa</strong><small>Entidad legal</small></article><i>→</i><article><span>02</span><strong>Centro</strong><small>Planta o ubicación</small></article><i>→</i><article><span>03</span><strong>Departamento</strong><small>Unidad de trabajo</small></article></div>
    </section>
    <section class="master-vitals organization-vitals">
      <button data-manage-organization-structure="companies"><span>Empresa</span><strong>${companies.length}</strong><small>Identidad principal</small></button>
      <button data-manage-organization-structure="work_centers"><span>Centros de trabajo</span><strong>${centers.length}</strong><small>Plantas, oficinas y ubicaciones</small></button>
      <button data-manage-organization-structure="departments"><span>Departamentos</span><strong>${departments.length}</strong><small>Equipos y unidades organizativas</small></button>
    </section>
    ${organizationChartMarkup(companies, centers, departments)}`;
  pageContent.onclick = async (event) => {
    const section = event.target.closest("[data-master-hub-section]");
    if (section) { state.masterHubSection = section.dataset.masterHubSection; state.masterHubQuery = ""; return navigate("masters_hub"); }
    const manage = event.target.closest("[data-manage-organization-structure]");
    if (manage) {
      const hrModule = await loadHrUiModule();
      return hrModule.openStructure(manage.dataset.manageOrganizationStructure || "companies");
    }
  };
}

function maintenanceProgramDomainCard(control, active) {
  const imports = control?.programImports || [];
  const plans = control?.plans?.filter((plan) => plan.import_id) || [];
  return `<button class="master-domain teal ${active ? "active" : ""}" data-master-hub-section="maintenance_program"><span class="master-domain-icon">12<i></i></span><span><strong>Programa anual</strong><small>Carga masiva de mantenimiento</small></span><b>${imports.length}</b><em>${plans.length} planes</em></button>`;
}

function renderMaintenanceProgramMaster(sections, control, structureControl) {
  const imports = control.programImports || [];
  const importedPlans = control.plans.filter((plan) => plan.import_id);
  const year = new Date().getFullYear();
  const currentImport = imports.find((item) => Number(item.annual_year) === year);
  const totalDates = imports.reduce((sum, item) => sum + Number(item.schedule_count || 0), 0);
  const latest = imports[0];
  pageContent.innerHTML = `<section class="master-hub-topbar"><div><span class="eyebrow">INFORMACIÓN BASE DEL ERP</span><h2>Datos maestros</h2><p>Administra los datos que utilizan Compras, Ventas, Inventario, Producción y Mantenimiento.</p></div></section>
    <section class="master-domain-switcher" aria-label="Tipo de dato">${sections.map((key) => key === "organization_structure" ? organizationStructureDomainCard(structureControl, false) : key === "maintenance_program" ? maintenanceProgramDomainCard(control, true) : masterDomainCard(key, state.masterRecords[key], false)).join("")}</section>
    <section class="maintenance-import-command">
      <div class="maintenance-import-copy">
        <span class="master-live"><i></i> CARGA CENTRALIZADA</span>
        <h3>Programa anual de mantenimiento</h3>
        <p>Carga el plan completo una sola vez. El sistema validará equipos, proveedores, fechas y frecuencias antes de crear el calendario.</p>
        <div class="maintenance-import-actions">
          <label>Año de la plantilla<select id="maintenance-template-year"><option value="${year}">${year}</option><option value="${year + 1}">${year + 1}</option></select></label>
          <button class="button ghost light" type="button" data-download-maintenance-template>↓ Descargar plantilla</button>
          ${hasPermission("maintenance.manage") ? '<button class="button workforce-accent" type="button" data-import-maintenance-program>＋ Cargar archivo</button>' : ""}
        </div>
      </div>
      <div class="maintenance-import-visual">
        <div class="maintenance-sheet sheet-back"><span>AÑO</span><i></i><i></i><i></i></div>
        <div class="maintenance-sheet sheet-front"><span>PROGRAMA</span><strong>${year}</strong><small>${control.equipment.length} EQUIPOS REGISTRADOS</small><i></i><i></i><i></i><b>CSV</b></div>
        <div class="maintenance-import-arrow">→</div>
        <div class="maintenance-calendar-stack"><span>CALENDARIO</span><strong>${currentImport ? currentImport.schedule_count : 0}</strong><small>FECHAS PROGRAMADAS</small><div>${Array.from({ length: 12 }, (_, index) => `<i class="${index < Math.min(12, Math.ceil((currentImport?.schedule_count || 0) / 3)) ? "filled" : ""}"></i>`).join("")}</div></div>
        <footer><span>Archivo editable → validación → carga única</span><strong>CONTROL ISO</strong></footer>
      </div>
    </section>
    <section class="master-vitals maintenance-import-vitals">
      <article><span>Cargas realizadas</span><strong>${imports.length}</strong><small>Una por año</small></article>
      <article><span>Planes creados</span><strong>${importedPlans.length}</strong><small>Desde archivo maestro</small></article>
      <article><span>Fechas programadas</span><strong>${totalDates}</strong><small>Calendario consolidado</small></article>
      <article><span>Última carga</span><strong>${escapeHtml(latest?.folio || "—")}</strong><small>${latest ? `${latest.annual_year} · ${formatDate(latest.created_at)}` : "Aún no hay cargas"}</small></article>
    </section>
    <section class="maintenance-import-layout">
      <article class="panel maintenance-import-guide">
        <div class="panel-title"><div><span class="eyebrow">CÓMO FUNCIONA</span><h3>Un archivo para toda la planta</h3></div><span>3 PASOS</span></div>
        <div class="maintenance-import-steps">
          <div><span>1</span><div><strong>Descarga</strong><p>La plantilla incluye automáticamente los folios y nombres de todos los equipos registrados.</p></div></div>
          <div><span>2</span><div><strong>Edita en Excel</strong><p>Define actividad, frecuencia, primera fecha, horas, referencia ISO y proveedor. Duplica una fila si un equipo requiere varias actividades.</p></div></div>
          <div><span>3</span><div><strong>Valida y confirma</strong><p>Verás una vista previa. La carga es atómica: si una fila tiene error, no se guarda ninguna.</p></div></div>
        </div>
        <div class="maintenance-template-columns"><strong>Columnas incluidas</strong><p>AÑO · FOLIO_EQUIPO · ACTIVIDAD · FRECUENCIA · CADA · PRIMERA_FECHA · HORAS_ESTIMADAS · REFERENCIA_ISO · FOLIO_PROVEEDOR · INSTRUCCIONES</p></div>
      </article>
      <article class="panel maintenance-import-history">
        <div class="panel-title"><div><span class="eyebrow">TRAZABILIDAD</span><h3>Programas cargados</h3></div><span>${imports.length} ARCHIVO(S)</span></div>
        <div>${imports.length ? imports.map((item) => `<article><span>${item.annual_year}</span><div><strong>${escapeHtml(item.folio)}</strong><small>${escapeHtml(item.original_name || "Plantilla CSV")} · ${escapeHtml(item.imported_by_name || "Sistema")}</small></div><div><strong>${item.plans_created} planes</strong><small>${item.schedule_count} fechas · ${formatDate(item.created_at)}</small></div></article>`).join("") : emptyMarkup("Sin programas cargados", "Descarga la plantilla para preparar el primer programa anual.")}</div>
      </article>
    </section>`;
  pageContent.onclick = (event) => {
    const section = event.target.closest("[data-master-hub-section]");
    if (section && section.dataset.masterHubSection !== "maintenance_program") { state.masterHubSection = section.dataset.masterHubSection; state.masterHubQuery = ""; return navigate("masters_hub"); }
    if (event.target.closest("[data-download-maintenance-template]")) return downloadAnnualMaintenanceTemplate(control, Number($("#maintenance-template-year")?.value || year));
    if (event.target.closest("[data-import-maintenance-program]")) return openAnnualMaintenanceImportModal();
  };
}

function downloadAnnualMaintenanceTemplate(control, year) {
  if (!control.equipment.length) return toast("Primero registra los equipos que formarán parte del programa.", "error");
  const headers = ["AÑO", "FOLIO_EQUIPO", "EQUIPO_NOMBRE", "ACTIVIDAD", "FRECUENCIA", "CADA", "PRIMERA_FECHA", "HORAS_ESTIMADAS", "REFERENCIA_ISO", "FOLIO_PROVEEDOR", "INSTRUCCIONES"];
  const firstDate = `${year}-01-15`;
  const rows = control.equipment.map((equipment) => [
    year,
    equipment.folio,
    equipment.name,
    "Mantenimiento preventivo general",
    "MESES",
    1,
    firstDate,
    2,
    "PR-MTO-01",
    "",
    "Inspeccionar, limpiar, ajustar y documentar resultados",
  ]);
  const csv = "\uFEFF" + [headers, ...rows].map((row) => row.map(csvCell).join(";")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `programa-anual-mantenimiento-${year}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Plantilla ${year} descargada con ${rows.length} equipo(s).`);
}

function csvCell(value) {
  let textValue = String(value ?? "");
  if (/^[=+\-@]/.test(textValue)) textValue = `'${textValue}`;
  return `"${textValue.replace(/"/g, '""')}"`;
}

function openAnnualMaintenanceImportModal() {
  let fileContent = "";
  let preview = null;
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = `<form id="annual-maintenance-import-form">
    <div class="modal-head"><div><span class="eyebrow">DATOS MAESTROS · MANTENIMIENTO</span><h2>Cargar programa anual</h2><p class="muted">Selecciona la misma plantilla CSV que editaste. Antes de guardar podrás revisar todas las filas.</p></div><button type="button" data-close-modal>×</button></div>
    <label class="maintenance-file-drop" for="annual-maintenance-file"><span>CSV</span><div><strong>Selecciona la plantilla del programa anual</strong><small>Archivo compatible con Excel · Máximo 2 MB</small></div><b>Elegir archivo</b><input id="annual-maintenance-file" type="file" accept=".csv,text/csv" required /></label>
    <div id="annual-maintenance-preview" class="maintenance-import-preview">${emptyMarkup("Esperando archivo", "Al seleccionarlo se validarán equipos, fechas, frecuencias y proveedores.")}</div>
    <p class="form-error hidden"></p>
    <div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button id="confirm-annual-maintenance-import" class="button primary" type="submit" disabled>Confirmar carga única</button></div>
  </form>`;
  const form = $("#annual-maintenance-import-form");
  const input = $("#annual-maintenance-file");
  const confirmButton = $("#confirm-annual-maintenance-import");
  const errorBox = $(".form-error", form);
  input.onchange = async () => {
    const file = input.files?.[0];
    preview = null;
    confirmButton.disabled = true;
    errorBox.classList.add("hidden");
    if (!file) return;
    if (!file.name.toLocaleLowerCase("es").endsWith(".csv")) return showAnnualImportError(errorBox, "Selecciona un archivo CSV.");
    if (file.size > 2 * 1024 * 1024) return showAnnualImportError(errorBox, "El archivo supera el límite de 2 MB.");
    try {
      $("#annual-maintenance-preview").innerHTML = skeleton();
      fileContent = await file.text();
      preview = await api("/api/maintenance/annual-program/preview", { method: "POST", body: { fileName: file.name, content: fileContent } });
      renderAnnualProgramPreview(preview);
      confirmButton.disabled = preview.locked || preview.errors.length > 0 || preview.validRows < 1;
    } catch (error) {
      $("#annual-maintenance-preview").innerHTML = emptyMarkup("No se pudo validar", error.message);
      showAnnualImportError(errorBox, error.message);
    }
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file || !preview || confirmButton.disabled) return;
    confirmButton.disabled = true;
    confirmButton.textContent = "Cargando programa…";
    try {
      const result = await api("/api/maintenance/annual-program/import", { method: "POST", body: { fileName: file.name, content: fileContent, year: preview.year } });
      entityDialog.close();
      state.maintenanceOptions = null;
      toast(`${result.folio}: ${result.plansCreated} planes y ${result.scheduleCount} fechas cargadas.`);
      await navigate("masters_hub");
    } catch (error) {
      showAnnualImportError(errorBox, error.message);
      confirmButton.disabled = false;
      confirmButton.textContent = "Confirmar carga única";
    }
  };
  entityDialog.showModal();
}

function renderAnnualProgramPreview(preview) {
  const status = preview.locked
    ? `<div class="maintenance-import-alert locked"><strong>El programa ${preview.year} ya fue cargado</strong><span>${escapeHtml(preview.existingImport?.folio || "")}. Para proteger la trazabilidad no se permite una segunda carga del mismo año.</span></div>`
    : preview.errors.length
      ? `<div class="maintenance-import-alert error"><strong>${preview.errors.length} fila(s) requieren corrección</strong><span>No se guardará información hasta que la plantilla quede completa.</span></div>`
      : `<div class="maintenance-import-alert ready"><strong>Archivo listo para confirmar</strong><span>La carga creará todo el programa en una sola operación.</span></div>`;
  $("#annual-maintenance-preview").innerHTML = `${status}
    <div class="maintenance-preview-metrics"><div><span>Año</span><strong>${preview.year}</strong></div><div><span>Planes válidos</span><strong>${preview.validRows}</strong></div><div><span>Equipos</span><strong>${preview.equipmentCount}</strong></div><div><span>Fechas</span><strong>${preview.scheduleCount}</strong></div></div>
    <div class="table-wrap maintenance-preview-table"><table><thead><tr><th>Fila</th><th>Equipo</th><th>Actividad</th><th>Frecuencia</th><th>Primera fecha</th><th>Revisión</th></tr></thead><tbody>${preview.previewRows.map((row) => `<tr class="${row.status === "error" ? "has-error" : ""}"><td>${row.row}</td><td>${escapeHtml(row.equipment || "—")}</td><td>${escapeHtml(row.activity)}</td><td>${escapeHtml(row.frequency || "—")}</td><td>${escapeHtml(row.firstDate || "—")}</td><td>${row.status === "ready" ? '<span class="badge">● Lista</span>' : `<span class="maintenance-row-error">${escapeHtml(row.messages.join(" "))}</span>`}</td></tr>`).join("")}</tbody></table></div>`;
}

function showAnnualImportError(element, message) {
  element.textContent = message;
  element.classList.remove("hidden");
}

function masterDataScene(type, records) {
  const config = masterHubConfig[type], sample = records.slice(0, 6);
  return `<div class="master-data-scene ${config.tone}" aria-label="Representación visual de ${escapeAttribute(config.label)}"><div class="master-data-grid"></div><div class="master-data-orbit orbit-one"></div><div class="master-data-orbit orbit-two"></div><div class="master-data-core"><span>${config.symbol}</span><i></i><i></i><i></i><strong>${records.length}</strong><small>DATOS</small></div>${sample.map((record, index) => { const definition = masterUi[type], name = String(record[definition.name] || record[definition.code] || "?"); return `<span class="master-data-token token-${index + 1}" title="${escapeAttribute(name)}"><i>${escapeHtml(name.slice(0, 2).toUpperCase())}</i><small>${escapeHtml(String(record[definition.code] || "").slice(0, 10))}</small></span>`; }).join("")}<div class="master-data-caption"><span>Datos conectados con todo el sistema</span><strong>SQLite LOCAL</strong></div></div>`;
}

function masterHubRecordCard(type, record) {
  const definition = masterUi[type], config = masterHubConfig[type], info = masterRecordInfo(type, record);
  const code = record[definition.code], name = record[definition.name];
  const search = [code, name, info.secondary, info.category, info.operational].filter(Boolean).join(" ").toLocaleLowerCase("es");
  const symbol = type === "employees" && record.photo_filename && hasPermission("hr.view")
    ? `<img class="master-employee-photo" src="${API_BASE}/api/hr/people/${record.id}/photo" alt="Fotografía de ${escapeAttribute(name)}" />`
    : `<div class="master-record-symbol">${config.symbol}</div>`;
  const status = record.status === "leave" ? "Ausente" : info.active ? "Activo" : "Inactivo";
  const canManageRecord = type === "areas" ? hasPermission("areas.manage") : hasPermission("masters.manage");
  const action = type === "employees"
    ? (hasPermission("hr.view") ? '<button class="button ghost small" data-open-hr>Ver en RH</button>' : "")
    : `${definition.lines ? `<button class="link-button" data-price-lines="${record.id}">Ver precios</button>` : ""}${canManageRecord ? `<button class="button ghost small" data-edit-master-hub="${record.id}">Editar</button>` : ""}`;
  return `<article class="master-record-card ${config.tone}" data-search="${escapeAttribute(search)}">${symbol}<div class="master-record-main"><span>${escapeHtml(code)}</span><h4>${escapeHtml(name)}</h4>${info.secondary ? `<p>${escapeHtml(info.secondary)}</p>` : ""}<small>${escapeHtml(info.operational)}</small></div><div class="master-record-meta"><span class="chip">${escapeHtml(masterSimpleCategory(info.category))}</span><span class="badge ${info.active ? "" : "warn"}">● ${status}</span></div><div class="master-record-actions">${action}</div></article>`;
}

function masterRecordInfo(type, record) {
  const definition = masterUi[type];
  const category = definition.categories?.[record[definition.category]] ?? "General";
  let operational = "Sin datos adicionales";
  let active = record.is_active ?? (record.status === "active" || record.status === "available");
  if (type === "items") operational = `${record.unit_code || "Sin unidad"} · Costo ${money(record.standard_cost, record.currency_code)} · Precio ${money(record.list_price, record.currency_code)}`;
  if (type === "customers") operational = `${record.currency_code || "Sin moneda"} · Crédito ${money(record.credit_limit, record.currency_code)} · ${record.payment_terms_days} días`;
  if (type === "suppliers") operational = `${record.currency_code || "Sin moneda"} · Crédito ${record.payment_terms_days} días · Entrega ${record.lead_time_days} días`;
  if (type === "employees") operational = `${record.job_position_name || record.position || "Sin puesto"} · ${record.area_name || "Sin área"} · ${record.shift_name || "Sin turno"} · ${record.vacation_plan_name || "Sin plan de vacaciones"}`;
  if (type === "resources") { operational = `${record.area_name || "Sin área"} · Capacidad ${record.capacity_per_hour}/h · ${money(record.hourly_cost, record.currency_code)}/h`; active = record.status !== "inactive"; }
  if (type === "price_lists") operational = `${record.currency_code} · ${record.items_count} artículo(s) · ${dateRange(record.valid_from, record.valid_to)}`;
  return { category, operational, active: Boolean(active), secondary: record.trade_name || record.email || record.description || "" };
}

function masterSimpleCategory(label) {
  return ({ "Productos terminados": "Productos", "Materias primas": "Materiales", "Centros de trabajo": "Centros", "Precios de venta": "Venta", "Listas de costos": "Costos", "Permiso / ausencia": "Ausente" })[label] || label;
}

async function renderMaster(type) {
  const token = beginPageRender();
  const requests = [api(`/api/masters/${type}`)];
  if (!state.masterOptions) requests.push(api("/api/masters/options"));
  const [result, options] = await Promise.all(requests);
  if (!renderIsCurrent(token)) return;
  if (options) state.masterOptions = options;
  state.masterRecords[type] = result.records;
  const definition = masterUi[type];
  const filter = state.masterFilter[type] ?? "all";
  const visible = filter === "all" || !definition.category ? result.records : result.records.filter((record) => record[definition.category] === filter);
  const employeeReadOnly = type === "employees";
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">DATOS MAESTROS</span><h2>${escapeHtml(definition.label)}</h2><p>${employeeReadOnly ? "Consulta sincronizada desde Recursos Humanos." : escapeHtml(definition.description)}</p></div>${employeeReadOnly ? (hasPermission("hr.view") ? '<button data-open-hr class="button primary">Ver Recursos Humanos →</button>' : "") : hasPermission("masters.manage") ? `<button id="new-master" class="button primary">＋ Nuevo ${escapeHtml(definition.singular.toLowerCase())}</button>` : ""}</section>
    ${definition.categories ? `<div class="master-filters"><button class="master-filter ${filter === "all" ? "active" : ""}" data-master-filter="all">Todos <span>${result.records.length}</span></button>${Object.entries(definition.categories).map(([key, label]) => `<button class="master-filter ${filter === key ? "active" : ""}" data-master-filter="${key}">${escapeHtml(label)} <span>${result.records.filter((record) => record[definition.category] === key).length}</span></button>`).join("")}</div>` : ""}
    <div class="table-wrap"><table><thead><tr><th>Código</th><th>Nombre</th><th>Clasificación</th><th>Datos operativos</th><th>Estado</th><th></th></tr></thead><tbody>${visible.length ? visible.map((record) => masterRow(type, record)).join("") : `<tr><td colspan="6">${emptyMarkup(`No hay ${definition.label.toLowerCase()}`, "Crea el primer registro maestro para comenzar.")}</td></tr>`}</tbody></table></div>`;
  $("#new-master")?.addEventListener("click", () => openMasterModal(type));
  pageContent.onclick = (event) => {
    const filterButton = event.target.closest("[data-master-filter]");
    if (filterButton) { state.masterFilter[type] = filterButton.dataset.masterFilter; return renderMaster(type); }
    const edit = event.target.closest("[data-edit-master]");
    if (edit) return openMasterModal(type, result.records.find((record) => record.id === Number(edit.dataset.editMaster)));
    if (event.target.closest("[data-open-hr]")) return navigate("hr_control");
    const lines = event.target.closest("[data-price-lines]");
    if (lines) return openPriceListItems(result.records.find((record) => record.id === Number(lines.dataset.priceLines)));
  };
}

function masterRow(type, record) {
  const definition = masterUi[type];
  const code = record[definition.code];
  const name = record[definition.name];
  const category = definition.categories?.[record[definition.category]] ?? "Maestro";
  let operational = "—";
  let active = record.is_active ?? (record.status === "active" || record.status === "available");
  if (type === "items") operational = `${record.unit_code || "Sin unidad"} · Costo ${money(record.standard_cost, record.currency_code)} · Precio ${money(record.list_price, record.currency_code)}`;
  if (type === "customers") operational = `${record.currency_code || "Sin moneda"} · Crédito ${money(record.credit_limit, record.currency_code)} · ${record.payment_terms_days} días`;
  if (type === "suppliers") operational = `${record.currency_code || "Sin moneda"} · ${record.payment_terms_days} días crédito · ${record.lead_time_days} días entrega`;
  if (type === "employees") operational = `${record.job_position_name || record.position || "Sin puesto"} · ${record.area_name || "Sin área"} · ${record.shift_name || "Sin turno"} · ${record.vacation_plan_name || "Sin plan"}`;
  if (type === "resources") { operational = `${record.area_name || "Sin área"} · ${record.capacity_per_hour} /h · ${money(record.hourly_cost, record.currency_code)}/h`; active = record.status !== "inactive"; }
  if (type === "price_lists") operational = `${record.currency_code} · ${record.items_count} partida(s) · ${dateRange(record.valid_from, record.valid_to)}`;
  const secondary = record.trade_name || record.email || record.description || "";
  return `<tr><td><strong>${escapeHtml(code)}</strong><small>#${record.id}</small></td><td><strong>${escapeHtml(name)}</strong>${secondary ? `<small>${escapeHtml(secondary)}</small>` : ""}</td><td><span class="chip">${escapeHtml(category)}</span></td><td>${escapeHtml(operational)}</td><td><span class="badge ${active ? "" : "warn"}">● ${active ? "Activo" : record.status === "leave" ? "Ausente" : record.status === "maintenance" ? "Mantenimiento" : "Inactivo"}</span></td><td><div class="table-actions">${type === "employees" ? (hasPermission("hr.view") ? '<button class="link-button" data-open-hr>Ver en RH</button>' : "") : definition.lines ? `<button class="link-button" data-price-lines="${record.id}">Partidas</button>` : hasPermission("masters.manage") ? `<button class="link-button" data-edit-master="${record.id}">Editar</button>` : ""}</div></td></tr>`;
}

function openMasterModal(type, record = null) {
  if (type === "employees") return navigate("hr_control");
  if (type === "areas") return openAreaModal(record);
  const definition = masterUi[type];
  const automatic = automaticMasterCodes[type];
  $("#entity-modal-content").innerHTML = `<form id="master-form"><div class="modal-head"><div><span class="eyebrow">DATOS MAESTROS</span><h2>${record ? `Editar ${escapeHtml(definition.singular.toLowerCase())}` : `Nuevo ${escapeHtml(definition.singular.toLowerCase())}`}</h2><p class="muted">La información quedará disponible para los módulos operativos autorizados.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner(record?.[automatic.field] ?? automatic.example, !record)}<div class="form-grid master-form-grid">${definition.fields.filter(([name]) => name !== automatic.field).map((field) => masterField(field, record)).join("")}</div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar registro</button></div></form>`;
  $("#master-form").addEventListener("submit", (event) => saveMasterRecord(event, type, record));
  entityDialog.showModal();
}

function masterField([name, label, type, required], record) {
  const value = record?.[name];
  if (type === "boolean") {
    const checkedByDefault = ["is_active", "inventory_tracked", "purchase_enabled"].includes(name);
    return `<label class="toggle-field"><input type="checkbox" name="${name}" ${value === undefined ? (checkedByDefault ? "checked" : "") : (value ? "checked" : "")}/><span>${escapeHtml(label)}</span></label>`;
  }
  if (type === "textarea") return `<label class="span-two">${escapeHtml(label)}<textarea name="${name}" rows="3">${escapeHtml(value ?? "")}</textarea></label>`;
  const optionSources = { unit: state.masterOptions.units, currency: state.masterOptions.currencies, area: state.masterOptions.areas, employee: state.masterOptions.employees };
  if (optionSources[type]) {
    const options = optionSources[type];
    return `<label>${escapeHtml(label)}<select name="${name}" ${required ? "required" : ""}><option value="">Sin asignar</option>${options.map((option) => `<option value="${option.id}" ${Number(value) === option.id ? "selected" : ""}>${escapeHtml(option.name || option.full_name)}${option.code ? ` · ${escapeHtml(option.code)}` : ""}</option>`).join("")}</select></label>`;
  }
  const enumOptions = masterEnumOptions(type);
  if (enumOptions) return `<label>${escapeHtml(label)}<select name="${name}" ${required ? "required" : ""}>${Object.entries(enumOptions).map(([key, text]) => `<option value="${key}" ${value === key ? "selected" : ""}>${escapeHtml(text)}</option>`).join("")}</select></label>`;
  const htmlType = ["decimal", "number"].includes(type) ? "number" : type;
  const step = type === "decimal" ? 'step="0.000001" min="0"' : type === "number" ? 'step="1" min="0"' : "";
  return `<label>${escapeHtml(label)}<input type="${htmlType}" name="${name}" value="${escapeAttribute(value ?? (["decimal", "number"].includes(type) ? 0 : ""))}" ${step} ${required ? "required" : ""}/></label>`;
}

function masterEnumOptions(type) {
  return ({
    item_type: masterUi.items.categories,
    resource_type: masterUi.resources.categories,
    employee_status: { active: "Activo", leave: "Permiso / ausencia", inactive: "Inactivo" },
    resource_status: { available: "Disponible", maintenance: "Mantenimiento", inactive: "Inactivo" },
    list_type: masterUi.price_lists.categories,
  })[type];
}

async function saveMasterRecord(event, type, record) {
  event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const definition = masterUi[type]; const body = {};
  const automatic = automaticMasterCodes[type];
  for (const [name, , fieldType] of definition.fields) {
    if (name === automatic.field) continue;
    if (fieldType === "boolean") body[name] = data.has(name);
    else if (["unit", "currency", "area", "employee"].includes(fieldType)) body[name] = data.get(name) ? Number(data.get(name)) : null;
    else if (["decimal", "number"].includes(fieldType)) body[name] = Number(data.get(name) || 0);
    else body[name] = data.get(name) || null;
  }
  const box = $(".form-error", form);
  try { const result = await api(record ? `/api/masters/${type}/${record.id}` : `/api/masters/${type}`, { method: record ? "PATCH" : "POST", body }); entityDialog.close(); state.masterOptions = null; if (type === "items") state.salesOptions = null; toast(record ? `${definition.singular} actualizado.` : `${definition.singular} guardado con folio ${result.code}.`); if (state.currentView === "masters_hub") { state.masterHubSection = type; await renderMasterHub(); } else await renderMaster(type); }
  catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
}

async function openPriceListItems(priceList, editingLine = null) {
  const result = await api(`/api/price-lists/${priceList.id}/items`);
  if (!state.masterOptions) state.masterOptions = await api("/api/masters/options");
  $("#entity-modal-content").innerHTML = `<div class="modal-head"><div><span class="eyebrow">${escapeHtml(priceList.list_type === "sale" ? "PRECIOS DE VENTA" : "LISTA DE COSTOS")}</span><h2>${escapeHtml(priceList.name)}</h2><p class="muted">${escapeHtml(priceList.currency_code)} · ${result.items.length} partida(s)</p></div><button type="button" data-close-modal>×</button></div>
    <div class="price-lines">${result.items.length ? result.items.map((line) => `<div class="price-line"><div><strong>${escapeHtml(line.sku)} · ${escapeHtml(line.name)}</strong><small>Desde ${line.min_quantity} unidad(es)${line.valid_from || line.valid_to ? ` · ${dateRange(line.valid_from, line.valid_to)}` : ""}</small></div><span>${money(line.price, priceList.currency_code)}</span>${hasPermission("masters.manage") ? `<button class="link-button" data-edit-price-line="${line.id}">Editar</button><button class="link-button danger-link" data-delete-price-line="${line.id}">Eliminar</button>` : ""}</div>`).join("") : emptyMarkup("Lista sin partidas", "Agrega artículos y sus precios o costos.")}</div>
    ${hasPermission("masters.manage") ? `<form id="price-line-form" class="price-line-form"><input type="hidden" name="lineId" value="${editingLine?.id ?? ""}"/><h3>${editingLine ? "Editar partida" : "Agregar partida"}</h3><div class="form-grid"><label>Artículo<select name="itemId" required><option value="">Selecciona un artículo</option>${state.masterOptions.items.map((item) => `<option value="${item.id}" ${editingLine?.item_id === item.id ? "selected" : ""}>${escapeHtml(item.sku)} · ${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Precio / costo<input name="price" type="number" min="0" step="0.000001" value="${editingLine?.price ?? 0}" required/></label><label>Cantidad mínima<input name="minQuantity" type="number" min="0.000001" step="0.000001" value="${editingLine?.min_quantity ?? 1}" required/></label><label>Vigente desde<input name="validFrom" type="date" value="${escapeAttribute(editingLine?.valid_from ?? "")}"/></label><label>Vigente hasta<input name="validTo" type="date" value="${escapeAttribute(editingLine?.valid_to ?? "")}"/></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button primary" type="submit">${editingLine ? "Actualizar partida" : "Agregar partida"}</button></div></form>` : ""}`;
  $("#price-line-form")?.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const lineId = data.get("lineId"); const body = { itemId: Number(data.get("itemId")), price: Number(data.get("price")), minQuantity: Number(data.get("minQuantity")), validFrom: data.get("validFrom") || null, validTo: data.get("validTo") || null };
    try { await api(lineId ? `/api/price-lists/${priceList.id}/items/${lineId}` : `/api/price-lists/${priceList.id}/items`, { method: lineId ? "PATCH" : "POST", body }); toast("Partida guardada."); await openPriceListItems(priceList); }
    catch (error) { const box = $(".form-error", form); box.textContent = error.message; box.classList.remove("hidden"); }
  });
  $("#entity-modal-content").onclick = async (event) => {
    const edit = event.target.closest("[data-edit-price-line]");
    if (edit) return openPriceListItems(priceList, result.items.find((line) => line.id === Number(edit.dataset.editPriceLine)));
    const remove = event.target.closest("[data-delete-price-line]");
    if (remove && await confirmAction({ eyebrow: "LISTA DE PRECIOS", title: "Eliminar partida", message: "La partida dejará de formar parte de esta lista.", confirmLabel: "Sí, eliminar", tone: "danger" })) {
      try { await api(`/api/price-lists/${priceList.id}/items/${remove.dataset.deletePriceLine}`, { method: "DELETE" }); toast("Partida eliminada."); await openPriceListItems(priceList); }
      catch (error) { toast(error.message, "error"); }
    }
  };
  if (!entityDialog.open) entityDialog.showModal();
}

async function renderInventory(view) {
  const token = beginPageRender();
  if (view === "inventory_stock") return renderInventoryStock(token);
  if (!state.inventoryOptions) state.inventoryOptions = await api("/api/inventory/options");
  if (!renderIsCurrent(token)) return;
  if (["inventory_entries", "inventory_exits", "inventory_transfers", "inventory_adjustments"].includes(view)) return renderInventoryMovements(view, token);
  if (view === "inventory_reservations") return renderInventoryReservations(token);
  if (view === "inventory_lots") return renderInventoryLots(token);
  if (view === "inventory_locations") return renderInventoryLocations(token);
  if (view === "inventory_counts") return renderInventoryCounts(token);
}

async function renderInventoryStock(token) {
  const { options, balances, movements } = await loadInventoryOverview();
  if (!renderIsCurrent(token)) return;
  state.inventoryOptions = options;
  const warehouses = options.warehouses;
  if (!warehouses.length) {
    pageContent.innerHTML = `<section class="warehouse-empty-world"><div class="empty-warehouse-icon"><span></span><span></span><span></span></div><span class="eyebrow">ALMACÉN</span><h2>Crea tu primer almacén</h2><p>Cuando registres un almacén podrás verlo, cargar artículos y mover existencias desde esta misma pantalla.</p><button class="button primary" data-open-catalog-warehouses>Registrar almacén</button></section>`;
    pageContent.onclick = (event) => { if (event.target.closest("[data-open-catalog-warehouses]")) { state.catalogType = "warehouses"; navigate("catalogs"); } };
    return;
  }
  if (!warehouses.some((row) => row.id === state.inventoryWarehouseId)) {
    state.inventoryWarehouseId = warehouses.find((warehouse) => balances.some((row) => row.warehouse_id === warehouse.id))?.id || warehouses[0].id;
  }
  const warehouse = warehouses.find((row) => row.id === state.inventoryWarehouseId);
  const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
  const warehouseMovements = movements.filter((row) => row.from_warehouse_id === warehouse.id || row.to_warehouse_id === warehouse.id).slice(0, 8);
  const total = stock.reduce((sum, row) => sum + Number(row.quantity), 0);
  const reserved = stock.reduce((sum, row) => sum + Number(row.reserved_quantity), 0);
  const available = stock.reduce((sum, row) => sum + Number(row.available_quantity), 0);
  const value = stock.reduce((sum, row) => sum + Number(row.quantity) * Number(row.average_cost), 0);
  const uniqueItems = new Set(stock.map((row) => row.item_id)).size;
  const alerts = stock.filter((row) => Number(row.min_stock) > 0 && Number(row.available_quantity) <= Number(row.min_stock)).length;
  pageContent.innerHTML = `<section class="warehouse-topbar"><div><span class="eyebrow">CENTRO VISUAL DE ALMACENES</span><h2>Mis almacenes</h2><p>Explora cada espacio y administra artículos sin salir de esta pantalla.</p></div><details class="warehouse-tools"><summary><span class="warehouse-tools-trigger">•••</span><strong>Más acciones</strong><i>⌄</i></summary><div class="warehouse-tool-menu"><span class="warehouse-tool-title">ORGANIZAR ALMACÉN</span><button data-inventory-tool="inventory_reservations"><span class="warehouse-tool-icon">◈</span><span><strong>Apartar</strong><small>Separar artículos para usarlos después</small></span><i>›</i></button><button data-inventory-tool="inventory_lots"><span class="warehouse-tool-icon">⌗</span><span><strong>Lotes</strong><small>Consultar lotes y números de serie</small></span><i>›</i></button><button data-inventory-tool="inventory_locations"><span class="warehouse-tool-icon">⌖</span><span><strong>Zonas</strong><small>Organizar pasillos y espacios</small></span><i>›</i></button><button data-inventory-tool="inventory_counts"><span class="warehouse-tool-icon">✓</span><span><strong>Contar</strong><small>Revisar la cantidad real del almacén</small></span><i>›</i></button>${hasPermission("inventory.adjust") ? '<span class="warehouse-tool-divider"></span><button data-inventory-action="adjustment"><span class="warehouse-tool-icon warning">±</span><span><strong>Corregir</strong><small>Aumentar o disminuir una existencia</small></span><i>›</i></button>' : ""}</div></details></section>
    <section class="warehouse-switcher" aria-label="Seleccionar almacén">${warehouses.map((row) => warehouseSelectorCard(row, balances, row.id === warehouse.id)).join("")}</section>
    <section class="warehouse-command">
      <div class="warehouse-command-copy"><span class="warehouse-live"><i></i> ALMACÉN ACTIVO</span><h3>${escapeHtml(warehouse.name)}</h3><p>${escapeHtml(warehouse.code)} · ${escapeHtml(warehouse.branch_name)}</p><div class="warehouse-command-actions">${hasPermission("inventory.operate") ? `<button class="warehouse-action add" data-inventory-action="entry"><span>＋</span><div><strong>Cargar artículos</strong><small>Agregar existencia</small></div></button><button class="warehouse-action remove" data-inventory-action="exit"><span>−</span><div><strong>Retirar artículos</strong><small>Registrar una salida</small></div></button><button class="warehouse-action move" data-inventory-action="transfer"><span>⇄</span><div><strong>Mover artículos</strong><small>Enviar a otro almacén</small></div></button>` : ""}</div></div>
      ${warehouseScene(stock)}
    </section>
    <section class="warehouse-vitals"><article><span>Artículos distintos</span><strong>${uniqueItems}</strong><small>${stock.length} espacio(s) ocupado(s)</small></article><article><span>Existencia física</span><strong>${inventoryNumber(total)}</strong><small>${inventoryNumber(available)} disponible</small></article><article><span>Reservado</span><strong>${inventoryNumber(reserved)}</strong><small>Separado para operaciones</small></article><article class="${alerts ? "alert" : ""}"><span>Alertas de mínimo</span><strong>${alerts}</strong><small>${alerts ? "Requieren atención" : "Todo en orden"}</small></article><article><span>Valor estimado</span><strong>${money(value)}</strong><small>A costo promedio</small></article></section>
    <section class="warehouse-content-grid">
      <article class="warehouse-stock-panel"><div class="warehouse-panel-head"><div><span class="eyebrow">CONTENIDO DEL ALMACÉN</span><h3>Artículos y ubicaciones</h3></div><label class="warehouse-search"><span>⌕</span><input id="warehouse-stock-search" type="search" placeholder="Buscar artículo, SKU, lote…" value="${escapeAttribute(state.inventoryStockQuery)}" /></label></div><div id="warehouse-stock-list" class="warehouse-stock-list">${stock.length ? stock.map(warehouseStockCard).join("") : emptyMarkup("Este almacén está vacío", "Usa «Cargar artículos» para registrar la primera existencia.")}</div></article>
      <aside class="warehouse-activity"><div class="warehouse-panel-head"><div><span class="eyebrow">ACTIVIDAD</span><h3>Movimientos recientes</h3></div></div><div class="warehouse-activity-list">${warehouseMovements.length ? warehouseMovements.map((row) => warehouseMovementCard(row, warehouse.id)).join("") : emptyMarkup("Sin movimientos", "La actividad de este almacén aparecerá aquí.")}</div></aside>
    </section>`;
  pageContent.onclick = (event) => {
    const selector = event.target.closest("[data-warehouse-id]");
    if (selector) { state.inventoryWarehouseId = Number(selector.dataset.warehouseId); state.inventoryStockQuery = ""; return navigate("inventory_stock"); }
    const tool = event.target.closest("[data-inventory-tool]"); if (tool) { tool.closest("details")?.removeAttribute("open"); return navigate(tool.dataset.inventoryTool); }
    const action = event.target.closest("[data-inventory-action]");
    if (action) {
      action.closest("details")?.removeAttribute("open");
      if (action.dataset.inventoryAction === "transfer" && warehouses.length < 2) return toast("Registra un segundo almacén antes de mover artículos.", "error");
      const row = balances.find((balance) => balance.id === Number(action.dataset.balanceId));
      return openInventoryMovementModal(action.dataset.inventoryAction, {
        itemId: row?.item_id || null,
        warehouseId: warehouse.id,
        locationId: row?.location_id || null,
        lotId: row?.lot_id || null,
        toWarehouseId: warehouses.find((candidate) => candidate.id !== warehouse.id)?.id || null,
      });
    }
  };
  const search = $("#warehouse-stock-search");
  if (search) search.oninput = () => {
    state.inventoryStockQuery = search.value;
    const query = search.value.trim().toLocaleLowerCase("es");
    let visible = 0;
    $$(".warehouse-stock-card", $("#warehouse-stock-list")).forEach((card) => { const show = !query || card.dataset.search.includes(query); card.hidden = !show; if (show) visible += 1; });
    $("#warehouse-search-empty")?.remove();
    if (!visible && stock.length) $("#warehouse-stock-list").insertAdjacentHTML("beforeend", '<div id="warehouse-search-empty">' + emptyMarkup("Sin coincidencias", "Prueba con otro nombre, SKU, ubicación o lote.") + "</div>");
  };
}

function warehouseSelectorCard(warehouse, balances, selected) {
  const stock = balances.filter((row) => row.warehouse_id === warehouse.id);
  const units = stock.reduce((sum, row) => sum + Number(row.quantity), 0);
  const items = new Set(stock.map((row) => row.item_id)).size;
  return `<button class="warehouse-selector ${selected ? "active" : ""}" data-warehouse-id="${warehouse.id}"><span class="warehouse-selector-icon"><i></i><i></i><i></i></span><span><strong>${escapeHtml(warehouse.name)}</strong><small>${escapeHtml(warehouse.code)} · ${items} artículo(s)</small></span><b>${inventoryNumber(units)}</b></button>`;
}

function warehouseScene(stock) {
  const slots = [...stock.slice(0, 12)];
  while (slots.length < 12) slots.push(null);
  const maxQuantity = Math.max(1, ...stock.map((row) => Number(row.quantity)));
  return `<div class="warehouse-scene" aria-label="Representación visual del almacén"><div class="warehouse-light"></div><div class="warehouse-floor"></div><div class="warehouse-back-wall"><span>${stock.length ? "OPERACIÓN EN LÍNEA" : "ESPACIO DISPONIBLE"}</span></div><div class="warehouse-racks">${[0, 1, 2].map((rack) => `<div class="warehouse-rack rack-${rack + 1}"><div class="rack-label">R-${String(rack + 1).padStart(2, "0")}</div>${slots.slice(rack * 4, rack * 4 + 4).map((row, index) => row ? `<button class="warehouse-bin ${Number(row.available_quantity) <= Number(row.min_stock) && Number(row.min_stock) > 0 ? "low" : ""}" data-inventory-action="exit" data-balance-id="${row.id}" title="${escapeAttribute(row.sku + ' · ' + row.item_name)}" style="--box-load:${Math.max(25, Math.round(Number(row.quantity) / maxQuantity * 100))}%"><span class="box-face">${escapeHtml(row.sku.slice(0, 8))}</span><i></i><small>${inventoryNumber(row.quantity)}</small></button>` : `<span class="warehouse-bin empty"><i></i><small>Libre</small></span>`).join("")}</div>`).join("")}</div><div class="warehouse-forklift"><span></span><i></i><b></b><em></em></div><div class="warehouse-scene-caption"><span>Haz clic en una caja para retirarla</span><strong>${stock.length} posición(es) con saldo</strong></div></div>`;
}

function warehouseStockCard(row) {
  const available = Number(row.available_quantity), quantity = Number(row.quantity);
  const percent = quantity ? Math.max(0, Math.min(100, available / quantity * 100)) : 0;
  const search = [row.sku, row.item_name, row.location_code, row.location_name, row.lot_number].filter(Boolean).join(" ").toLocaleLowerCase("es");
  return `<article class="warehouse-stock-card" data-search="${escapeAttribute(search)}"><div class="warehouse-item-cube"><span>${escapeHtml(row.sku.slice(0, 3))}</span></div><div class="warehouse-item-main"><strong>${escapeHtml(row.item_name)}</strong><small>${escapeHtml(row.sku)} · ${escapeHtml(row.location_code ? row.location_code + ' / ' + row.location_name : "Zona general")}${row.lot_number ? ' · Lote ' + escapeHtml(row.lot_number) : ""}</small><div class="warehouse-availability"><i style="width:${percent}%"></i></div></div><div class="warehouse-item-qty"><strong>${inventoryNumber(row.available_quantity)}</strong><small>disponible de ${inventoryNumber(row.quantity)} ${escapeHtml(row.unit_symbol || "")}</small>${Number(row.reserved_quantity) ? `<em>${inventoryNumber(row.reserved_quantity)} reservado</em>` : ""}</div><div class="warehouse-item-actions">${hasPermission("inventory.operate") ? `<button title="Cargar más" data-inventory-action="entry" data-balance-id="${row.id}">＋</button><button title="Retirar" data-inventory-action="exit" data-balance-id="${row.id}">−</button><button title="Mover" data-inventory-action="transfer" data-balance-id="${row.id}">⇄</button>` : ""}</div></article>`;
}

function warehouseMovementCard(row, warehouseId) {
  const incoming = row.to_warehouse_id === warehouseId && row.from_warehouse_id !== warehouseId;
  const type = row.movement_type === "transfer" ? (incoming ? "in" : "out") : row.movement_type === "entry" || (row.movement_type === "adjustment" && incoming) ? "in" : "out";
  const label = row.movement_type === "entry" ? "Carga" : row.movement_type === "exit" ? "Retiro" : row.movement_type === "transfer" ? (incoming ? "Transferencia recibida" : "Transferencia enviada") : "Ajuste";
  return `<article class="warehouse-movement ${type}"><span>${type === "in" ? "↘" : "↗"}</span><div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(row.sku + ' · ' + row.item_name)}</small><time>${formatDate(row.occurred_at)}</time></div><b>${type === "in" ? "+" : "−"}${inventoryNumber(row.quantity)}</b></article>`;
}

const inventoryMovementUi = {
  inventory_entries: { type: "entry", title: "Entradas", singular: "entrada", description: "Recepciones y aumentos de inventario con costo promedio.", permission: "inventory.operate" },
  inventory_exits: { type: "exit", title: "Salidas", singular: "salida", description: "Consumos y entregas limitados a la cantidad disponible.", permission: "inventory.operate" },
  inventory_transfers: { type: "transfer", title: "Transferencias", singular: "transferencia", description: "Movimientos internos entre almacenes o ubicaciones.", permission: "inventory.operate" },
  inventory_adjustments: { type: "adjustment", title: "Ajustes", singular: "ajuste", description: "Correcciones autorizadas con motivo obligatorio y trazabilidad.", permission: "inventory.adjust" },
};

async function renderInventoryMovements(view, token) {
  const definition = inventoryMovementUi[view];
  const { movements } = await api(`/api/inventory/movements?type=${definition.type}`);
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">MOVIMIENTOS DE INVENTARIO</span><h2>${definition.title}</h2><p>${definition.description}</p></div>${hasPermission(definition.permission) ? `<button class="button primary" data-new-movement="${definition.type}">＋ Registrar ${definition.singular}</button>` : ""}</section>
    ${inventoryMovementTable(movements)}`;
  pageContent.onclick = (event) => {
    const button = event.target.closest("[data-new-movement]");
    if (button) openInventoryMovementModal(button.dataset.newMovement);
  };
}

function inventoryMovementTable(movements) {
  return `<div class="table-wrap"><table><thead><tr><th>Folio / fecha</th><th>Artículo</th><th>Cantidad</th><th>Origen</th><th>Destino</th><th>Lote</th><th>Referencia</th><th>Usuario</th></tr></thead><tbody>${movements.length ? movements.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small>${formatDate(row.occurred_at)}</small></td><td><strong>${escapeHtml(row.sku)}</strong><small>${escapeHtml(row.item_name)}</small></td><td><strong>${inventoryNumber(row.quantity)}</strong> ${escapeHtml(row.unit_symbol || "")}<small>${money(row.unit_cost)} c/u</small></td><td>${inventoryPlace(row.from_warehouse_name, row.from_location_name)}</td><td>${inventoryPlace(row.to_warehouse_name, row.to_location_name)}</td><td>${escapeHtml(row.lot_number || "—")}</td><td>${escapeHtml(row.reference || row.reason || "—")}</td><td>${escapeHtml(row.created_by_name || "Sistema")}</td></tr>`).join("") : `<tr><td colspan="8">${emptyMarkup("Sin movimientos registrados", "Los folios se asignarán automáticamente al guardar.")}</td></tr>`}</tbody></table></div>`;
}

function openInventoryMovementModal(type, context = {}) {
  const labels = { entry: "Entrada", exit: "Salida", transfer: "Transferencia", adjustment: "Ajuste" };
  const options = state.inventoryOptions;
  const needsFrom = ["exit", "transfer"].includes(type);
  const needsTo = ["entry", "transfer", "adjustment"].includes(type);
  const signed = type === "adjustment";
  const endpoint = { entry: "entries", exit: "exits", transfer: "transfers", adjustment: "adjustments" }[type];
  $("#entity-modal-content").innerHTML = `<form id="inventory-movement-form"><div class="modal-head"><div><span class="eyebrow">MOVIMIENTO DE INVENTARIO</span><h2>Registrar ${labels[type].toLowerCase()}</h2><p class="muted">La operación se aplicará inmediatamente al saldo.</p></div><button type="button" data-close-modal>×</button></div>
    ${automaticCodeBanner(`${{ entry: "ENT", exit: "SAL", transfer: "TRA", adjustment: "AJU" }[type]}-000000`, true)}
    <div class="form-grid"><label>Artículo<select name="itemId" required>${inventoryItemOptions(context.itemId)}</select></label><label>${signed ? "Cantidad (+ aumenta / − disminuye)" : "Cantidad"}<input name="quantity" type="number" step="0.000001" ${signed ? "" : 'min="0.000001"'} required /></label>
    ${needsFrom ? inventoryWarehouseFields("from", context.warehouseId, context.locationId) : ""}${needsTo ? inventoryWarehouseFields("to", type === "transfer" ? context.toWarehouseId : context.warehouseId, type === "transfer" ? null : context.locationId) : ""}
    <label>Lote<select name="lotId"><option value="">Sin lote</option>${options.lots.map((row) => `<option value="${row.id}" ${row.id === context.lotId ? "selected" : ""}>${escapeHtml(row.lot_number)} · ${escapeHtml(row.item_name)}</option>`).join("")}</select></label>
    ${["entry", "adjustment"].includes(type) ? '<label>Costo unitario<input name="unitCost" type="number" min="0" step="0.000001" value="0" /></label>' : ""}
    <label>Fecha del movimiento<input name="occurredAt" type="datetime-local" value="${nowLocalInput()}" /></label><label>Referencia<input name="reference" maxlength="120" placeholder="Orden, solicitud o documento" /></label></div>
    <label>Motivo / observaciones<textarea name="reason" rows="3" ${signed ? "required" : ""}></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Aplicar ${labels[type].toLowerCase()}</button></div></form>`;
  if (needsFrom) wireInventoryLocationSelect("from", context.locationId);
  if (needsTo) wireInventoryLocationSelect("to", type === "transfer" ? null : context.locationId);
  $("#inventory-movement-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form);
    const body = { itemId: Number(data.get("itemId")), quantity: Number(data.get("quantity")), lotId: numberOrNull(data.get("lotId")), unitCost: Number(data.get("unitCost") || 0), occurredAt: data.get("occurredAt") || null, reference: data.get("reference"), reason: data.get("reason") };
    if (needsFrom) { body.fromWarehouseId = Number(data.get("fromWarehouseId")); body.fromLocationId = numberOrNull(data.get("fromLocationId")); }
    if (needsTo) { body.toWarehouseId = Number(data.get("toWarehouseId")); body.toLocationId = numberOrNull(data.get("toLocationId")); }
    try { const result = await api(`/api/inventory/${endpoint}`, { method: "POST", body }); entityDialog.close(); toast(`${labels[type]} registrada con folio ${result.folio}.`); await navigate(state.currentView); }
    catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  });
  entityDialog.showModal();
}

function wireInventoryLocationSelect(prefix, selectedLocation = null) {
  const warehouseSelect = $(`[name="${prefix}WarehouseId"]`, $("#inventory-movement-form"));
  const locationSelect = $(`[name="${prefix}LocationId"]`, $("#inventory-movement-form"));
  if (!warehouseSelect || !locationSelect) return;
  const render = () => {
    const warehouseId = Number(warehouseSelect.value);
    locationSelect.innerHTML = '<option value="">Zona general</option>' + state.inventoryOptions.locations.filter((row) => row.warehouse_id === warehouseId).map((row) => `<option value="${row.id}" ${row.id === selectedLocation ? "selected" : ""}>${escapeHtml(row.code)} · ${escapeHtml(row.name)}</option>`).join("");
    selectedLocation = null;
  };
  warehouseSelect.addEventListener("change", render);
  render();
}

async function renderInventoryReservations(token) {
  const { reservations } = await api("/api/inventory/reservations");
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">COMPROMISO DE EXISTENCIAS</span><h2>Reservas</h2><p>Separa cantidad disponible sin retirarla físicamente del almacén.</p></div>${hasPermission("inventory.operate") ? '<button class="button primary" data-new-reservation>＋ Nueva reserva</button>' : ""}</section>
    <div class="table-wrap"><table><thead><tr><th>Folio</th><th>Artículo</th><th>Almacén / ubicación</th><th>Cantidad</th><th>Requerida</th><th>Referencia</th><th>Estado</th><th></th></tr></thead><tbody>${reservations.length ? reservations.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small>${formatDate(row.created_at)}</small></td><td><strong>${escapeHtml(row.sku)}</strong><small>${escapeHtml(row.item_name)}</small></td><td>${inventoryPlace(row.warehouse_name, row.location_name)}</td><td><strong>${inventoryNumber(row.quantity)}</strong> ${escapeHtml(row.unit_symbol || "")}</td><td>${row.required_at ? formatDateOnly(row.required_at) : "—"}</td><td>${escapeHtml(row.reference || "—")}</td><td>${inventoryStatusBadge(row.status)}</td><td>${row.status === "active" && hasPermission("inventory.operate") ? `<div class="table-actions"><button class="link-button" data-reservation-action="consume" data-id="${row.id}">Consumir</button><button class="link-button danger-link" data-reservation-action="release" data-id="${row.id}">Liberar</button></div>` : ""}</td></tr>`).join("") : `<tr><td colspan="8">${emptyMarkup("No hay reservas", "Las reservas activas descontarán la cantidad disponible.")}</td></tr>`}</tbody></table></div>`;
  pageContent.onclick = async (event) => {
    if (event.target.closest("[data-new-reservation]")) return openReservationModal();
    const button = event.target.closest("[data-reservation-action]"); if (!button) return;
    try { await api(`/api/inventory/reservations/${button.dataset.id}/${button.dataset.reservationAction}`, { method: "POST", body: {} }); toast(button.dataset.reservationAction === "consume" ? "Reserva consumida y salida generada." : "Reserva liberada."); await navigate("inventory_reservations"); }
    catch (error) { toast(error.message, "error"); }
  };
}

function openReservationModal() {
  $("#entity-modal-content").innerHTML = `<form id="reservation-form"><div class="modal-head"><div><span class="eyebrow">RESERVA DE INVENTARIO</span><h2>Nueva reserva</h2><p class="muted">Solo puede reservarse la cantidad actualmente disponible.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner("RES-000000", true)}<div class="form-grid"><label>Artículo<select name="itemId" required>${inventoryItemOptions()}</select></label>${inventoryWarehouseFields("reservation")}<label>Cantidad<input name="quantity" type="number" min="0.000001" step="0.000001" required /></label><label>Lote<select name="lotId"><option value="">Sin lote</option>${state.inventoryOptions.lots.map((row) => `<option value="${row.id}">${escapeHtml(row.lot_number)} · ${escapeHtml(row.item_name)}</option>`).join("")}</select></label><label>Fecha requerida<input name="requiredAt" type="date" /></label><label>Referencia<input name="reference" maxlength="120" /></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear reserva</button></div></form>`;
  $("#reservation-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api("/api/inventory/reservations", { method: "POST", body: { itemId: Number(data.get("itemId")), warehouseId: Number(data.get("reservationWarehouseId")), locationId: numberOrNull(data.get("reservationLocationId")), lotId: numberOrNull(data.get("lotId")), quantity: Number(data.get("quantity")), requiredAt: data.get("requiredAt") || null, reference: data.get("reference") } }); entityDialog.close(); toast(`Reserva creada con folio ${result.folio}.`); await navigate("inventory_reservations"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } });
  entityDialog.showModal();
}

async function renderInventoryLots(token) {
  const [{ lots }, { serials }] = await Promise.all([api("/api/inventory/lots"), api("/api/inventory/serials")]);
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">TRAZABILIDAD UNITARIA</span><h2>Lotes y series</h2><p>Identificación por partida de fabricación y por unidad serializada.</p></div>${hasPermission("inventory.operate") ? '<div class="lead-actions"><button class="button ghost" data-new-serial>＋ Nueva serie</button><button class="button primary" data-new-lot>＋ Nuevo lote</button></div>' : ""}</section>
    <section class="inventory-split"><article class="panel"><div class="panel-head"><h3>Lotes</h3><span>${lots.length} REGISTRO(S)</span></div><div class="compact-list">${lots.length ? lots.map((row) => `<div class="inventory-list-row"><div><strong>${escapeHtml(row.lot_number)}</strong><small>${escapeHtml(row.sku)} · ${escapeHtml(row.item_name)}${row.expiration_date ? ` · Caduca ${formatDateOnly(row.expiration_date)}` : ""}</small></div>${inventoryStatusBadge(row.status)}${hasPermission("inventory.operate") ? `<button class="link-button" data-edit-lot="${row.id}">Editar</button>` : ""}</div>`).join("") : emptyMarkup("Sin lotes", "Registra el primero cuando el artículo requiera trazabilidad.")}</div></article>
    <article class="panel"><div class="panel-head"><h3>Series</h3><span>${serials.length} REGISTRO(S)</span></div><div class="compact-list">${serials.length ? serials.map((row) => `<div class="inventory-list-row"><div><strong>${escapeHtml(row.serial_number)}</strong><small>${escapeHtml(row.sku)} · ${escapeHtml(row.item_name)}${row.warehouse_name ? ` · ${escapeHtml(row.warehouse_name)}` : ""}</small></div>${inventoryStatusBadge(row.status)}${hasPermission("inventory.operate") ? `<button class="link-button" data-edit-serial="${row.id}">Editar</button>` : ""}</div>`).join("") : emptyMarkup("Sin series", "Agrega unidades serializadas cuando sea necesario.")}</div></article></section>`;
  pageContent.onclick = (event) => {
    if (event.target.closest("[data-new-lot]")) return openLotModal();
    if (event.target.closest("[data-new-serial]")) return openSerialModal();
    const lot = event.target.closest("[data-edit-lot]"); if (lot) return openLotModal(lots.find((row) => row.id === Number(lot.dataset.editLot)));
    const serial = event.target.closest("[data-edit-serial]"); if (serial) return openSerialModal(serials.find((row) => row.id === Number(serial.dataset.editSerial)));
  };
}

function openLotModal(record = null) {
  $("#entity-modal-content").innerHTML = `<form id="lot-form"><div class="modal-head"><div><span class="eyebrow">${record ? "EDITAR LOTE" : "NUEVO LOTE"}</span><h2>${record ? escapeHtml(record.lot_number) : "Registrar lote"}</h2><p class="muted">Si dejas el número vacío, el sistema asignará uno automático.</p></div><button type="button" data-close-modal>×</button></div>${record ? automaticCodeBanner(record.lot_number, false) : automaticCodeBanner("LOT-000000", true)}<div class="form-grid"><label>Artículo<select name="itemId" ${record ? "disabled" : "required"}>${inventoryItemOptions(record?.item_id)}</select></label><label>Número de lote<input name="lotNumber" maxlength="80" value="${escapeAttribute(record?.lot_number || "")}" placeholder="Automático" /></label><label>Fabricación<input name="manufacturingDate" type="date" value="${escapeAttribute(record?.manufacturing_date || "")}" /></label><label>Caducidad<input name="expirationDate" type="date" value="${escapeAttribute(record?.expiration_date || "")}" /></label><label>Estado<select name="status">${statusOptions(["active", "quarantine", "blocked", "expired"], record?.status || "active")}</select></label></div><label>Notas<textarea name="notes" rows="3">${escapeHtml(record?.notes || "")}</textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar lote</button></div></form>`;
  $("#lot-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api(record ? `/api/inventory/lots/${record.id}` : "/api/inventory/lots", { method: record ? "PATCH" : "POST", body: { itemId: record?.item_id || Number(data.get("itemId")), lotNumber: data.get("lotNumber"), manufacturingDate: data.get("manufacturingDate") || null, expirationDate: data.get("expirationDate") || null, status: data.get("status"), notes: data.get("notes") } }); entityDialog.close(); state.inventoryOptions = null; toast(`Lote ${result.lotNumber} guardado.`); await navigate("inventory_lots"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
}

function openSerialModal(record = null) {
  $("#entity-modal-content").innerHTML = `<form id="serial-form"><div class="modal-head"><div><span class="eyebrow">${record ? "EDITAR SERIE" : "NUEVA SERIE"}</span><h2>${record ? escapeHtml(record.serial_number) : "Registrar serie"}</h2><p class="muted">El número puede ser capturado o generado automáticamente.</p></div><button type="button" data-close-modal>×</button></div>${record ? automaticCodeBanner(record.serial_number, false) : automaticCodeBanner("SER-0000000", true)}<div class="form-grid"><label>Artículo<select name="itemId" ${record ? "disabled" : "required"}>${inventoryItemOptions(record?.item_id)}</select></label><label>Número de serie<input name="serialNumber" maxlength="120" value="${escapeAttribute(record?.serial_number || "")}" placeholder="Automático" /></label><label>Lote<select name="lotId"><option value="">Sin lote</option>${state.inventoryOptions.lots.map((row) => `<option value="${row.id}" ${row.id === record?.lot_id ? "selected" : ""}>${escapeHtml(row.lot_number)} · ${escapeHtml(row.item_name)}</option>`).join("")}</select></label>${inventoryWarehouseFields("serial", record?.current_warehouse_id, record?.current_location_id, true)}<label>Estado<select name="status">${statusOptions(["available", "reserved", "issued", "blocked"], record?.status || "available")}</select></label></div><label>Notas<textarea name="notes" rows="3">${escapeHtml(record?.notes || "")}</textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar serie</button></div></form>`;
  $("#serial-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api(record ? `/api/inventory/serials/${record.id}` : "/api/inventory/serials", { method: record ? "PATCH" : "POST", body: { itemId: record?.item_id || Number(data.get("itemId")), serialNumber: data.get("serialNumber"), lotId: numberOrNull(data.get("lotId")), warehouseId: numberOrNull(data.get("serialWarehouseId")), locationId: numberOrNull(data.get("serialLocationId")), status: data.get("status"), notes: data.get("notes") } }); entityDialog.close(); toast(`Serie ${result.serialNumber} guardada.`); await navigate("inventory_lots"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
}

async function renderInventoryLocations(token) {
  const { locations } = await api("/api/inventory/locations");
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">MAPA DE ALMACENES</span><h2>Ubicaciones</h2><p>Zonas, pasillos, racks, niveles y contenedores donde se resguarda el inventario.</p></div>${hasPermission("inventory.operate") ? '<button class="button primary" data-new-location>＋ Nueva ubicación</button>' : ""}</section><div class="table-wrap"><table><thead><tr><th>Código</th><th>Almacén</th><th>Nombre</th><th>Zona</th><th>Pasillo / rack</th><th>Nivel / contenedor</th><th>Estado</th><th></th></tr></thead><tbody>${locations.length ? locations.map((row) => `<tr><td><strong>${escapeHtml(row.code)}</strong></td><td><strong>${escapeHtml(row.warehouse_name)}</strong><small>${escapeHtml(row.branch_name)}</small></td><td>${escapeHtml(row.name)}</td><td>${escapeHtml(row.zone || "—")}</td><td>${escapeHtml([row.aisle, row.rack].filter(Boolean).join(" / ") || "—")}</td><td>${escapeHtml([row.level, row.bin].filter(Boolean).join(" / ") || "—")}</td><td><span class="badge ${row.is_active ? "" : "warn"}">● ${row.is_active ? "Activa" : "Inactiva"}</span></td><td>${hasPermission("inventory.operate") ? `<button class="link-button" data-edit-location="${row.id}">Editar</button>` : ""}</td></tr>`).join("") : `<tr><td colspan="8">${emptyMarkup("No hay ubicaciones", "Puedes operar por almacén o crear un mapa más detallado.")}</td></tr>`}</tbody></table></div>`;
  pageContent.onclick = (event) => { if (event.target.closest("[data-new-location]")) return openLocationModal(); const button = event.target.closest("[data-edit-location]"); if (button) openLocationModal(locations.find((row) => row.id === Number(button.dataset.editLocation))); };
}

function openLocationModal(record = null) {
  $("#entity-modal-content").innerHTML = `<form id="location-form"><div class="modal-head"><div><span class="eyebrow">${record ? "EDITAR UBICACIÓN" : "NUEVA UBICACIÓN"}</span><h2>${record ? escapeHtml(record.name) : "Registrar ubicación"}</h2><p class="muted">El código se calcula automáticamente con el número de registro.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner(record?.code || "UBI-00000", !record)}<div class="form-grid"><label>Almacén<select name="warehouseId" required>${inventoryWarehouseOptions(record?.warehouse_id)}</select></label><label>Nombre<input name="name" maxlength="120" required value="${escapeAttribute(record?.name || "")}" /></label><label>Zona<input name="zone" maxlength="50" value="${escapeAttribute(record?.zone || "")}" /></label><label>Pasillo<input name="aisle" maxlength="50" value="${escapeAttribute(record?.aisle || "")}" /></label><label>Rack<input name="rack" maxlength="50" value="${escapeAttribute(record?.rack || "")}" /></label><label>Nivel<input name="level" maxlength="50" value="${escapeAttribute(record?.level || "")}" /></label><label>Contenedor<input name="bin" maxlength="50" value="${escapeAttribute(record?.bin || "")}" /></label><label>Estado<select name="isActive"><option value="true" ${record?.is_active !== 0 ? "selected" : ""}>Activa</option><option value="false" ${record?.is_active === 0 ? "selected" : ""}>Inactiva</option></select></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar ubicación</button></div></form>`;
  $("#location-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api(record ? `/api/inventory/locations/${record.id}` : "/api/inventory/locations", { method: record ? "PATCH" : "POST", body: { warehouseId: Number(data.get("warehouseId")), name: data.get("name"), zone: data.get("zone"), aisle: data.get("aisle"), rack: data.get("rack"), level: data.get("level"), bin: data.get("bin"), isActive: data.get("isActive") === "true" } }); entityDialog.close(); state.inventoryOptions = null; toast(`Ubicación ${result.code} guardada.`); await navigate("inventory_locations"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
}

async function renderInventoryCounts(token) {
  const { counts } = await api("/api/inventory/counts");
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">VERIFICACIÓN DE SALDOS</span><h2>Conteos físicos</h2><p>Compara la cantidad del sistema con la cantidad observada y aplica sus diferencias.</p></div>${hasPermission("inventory.count") ? '<button class="button primary" data-new-count>＋ Iniciar conteo</button>' : ""}</section><div class="table-wrap"><table><thead><tr><th>Folio</th><th>Almacén</th><th>Programado</th><th>Avance</th><th>Estado</th><th>Responsable</th><th></th></tr></thead><tbody>${counts.length ? counts.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small>${formatDate(row.created_at)}</small></td><td><strong>${escapeHtml(row.warehouse_code)}</strong><small>${escapeHtml(row.warehouse_name)}</small></td><td>${row.scheduled_at ? formatDateOnly(row.scheduled_at) : "—"}</td><td>${Number(row.counted_lines)}/${Number(row.line_count)} partidas</td><td>${inventoryStatusBadge(row.status)}</td><td>${escapeHtml(row.created_by_name || "Sistema")}</td><td><button class="link-button" data-open-count="${row.id}">${row.status === "in_progress" ? "Capturar" : "Consultar"}</button></td></tr>`).join("") : `<tr><td colspan="7">${emptyMarkup("No hay conteos físicos", "Inicia uno para comparar el inventario real con el sistema.")}</td></tr>`}</tbody></table></div>`;
  pageContent.onclick = (event) => { if (event.target.closest("[data-new-count]")) return openCountModal(); const button = event.target.closest("[data-open-count]"); if (button) renderInventoryCountDetail(Number(button.dataset.openCount)); };
}

function openCountModal() {
  $("#entity-modal-content").innerHTML = `<form id="count-form"><div class="modal-head"><div><span class="eyebrow">CONTEO FÍSICO</span><h2>Iniciar conteo</h2><p class="muted">Se tomará una fotografía de todas las existencias del almacén.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner("CNT-000000", true)}<div class="form-grid"><label>Almacén<select name="warehouseId" required>${inventoryWarehouseOptions()}</select></label><label>Fecha programada<input name="scheduledAt" type="date" value="${new Date().toISOString().slice(0, 10)}" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Iniciar conteo</button></div></form>`;
  $("#count-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api("/api/inventory/counts", { method: "POST", body: { warehouseId: Number(data.get("warehouseId")), scheduledAt: data.get("scheduledAt") || null, notes: data.get("notes") } }); entityDialog.close(); toast(`Conteo ${result.folio} iniciado.`); await renderInventoryCountDetail(result.id); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
}

async function renderInventoryCountDetail(id) {
  const token = beginPageRender();
  pageContent.innerHTML = skeleton();
  const { count, lines } = await api(`/api/inventory/counts/${id}`);
  if (!renderIsCurrent(token)) return;
  $("#page-title").textContent = `Conteo ${count.folio}`; $("#breadcrumbs").textContent = "INVENTARIO / CONTEOS / CAPTURA";
  const editable = count.status === "in_progress" && hasPermission("inventory.count");
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">${escapeHtml(count.folio)}</span><h2>${escapeHtml(count.warehouse_name)}</h2><p>${escapeHtml(count.notes || "Captura la existencia física observada en cada partida.")}</p></div><div class="lead-actions"><button class="button ghost" data-back-counts>← Volver</button>${count.status === "in_progress" && hasPermission("inventory.adjust") ? '<button class="button primary" data-complete-count>Aplicar y cerrar</button>' : ""}</div></section><form id="count-capture-form"><div class="table-wrap"><table><thead><tr><th>Artículo</th><th>Ubicación</th><th>Lote</th><th>Sistema</th><th>Conteo físico</th><th>Diferencia</th></tr></thead><tbody>${lines.map((row) => `<tr><td><strong>${escapeHtml(row.sku)}</strong><small>${escapeHtml(row.item_name)}</small></td><td>${escapeHtml(row.location_code ? `${row.location_code} · ${row.location_name}` : "Sin ubicación")}</td><td>${escapeHtml(row.lot_number || "—")}</td><td>${inventoryNumber(row.system_quantity)} ${escapeHtml(row.unit_symbol || "")}</td><td>${editable ? `<input class="count-input" name="line-${row.id}" type="number" min="0" step="0.000001" value="${row.counted_quantity ?? ""}" required />` : inventoryNumber(row.counted_quantity ?? row.system_quantity)}</td><td>${row.counted_quantity == null ? "—" : `<strong class="${Number(row.variance) < 0 ? "negative" : "positive"}">${signedInventoryNumber(row.variance)}</strong>`}</td></tr>`).join("")}</tbody></table></div>${editable ? '<div class="count-actions"><p class="form-error hidden"></p><button class="button primary" type="submit">Guardar captura</button></div>' : ""}</form>`;
  $("#count-capture-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const box = $(".form-error", form); try { const data = new FormData(form); await Promise.all(lines.map((row) => api(`/api/inventory/counts/${id}/lines/${row.id}`, { method: "PATCH", body: { countedQuantity: Number(data.get(`line-${row.id}`)) } }))); toast("Captura del conteo guardada."); await renderInventoryCountDetail(id); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } });
  pageContent.onclick = async (event) => { if (event.target.closest("[data-back-counts]")) return navigate("inventory_counts"); if (!event.target.closest("[data-complete-count]")) return; try { const result = await api(`/api/inventory/counts/${id}/complete`, { method: "POST", body: {} }); toast(`Conteo cerrado con ${result.adjustments} ajuste(s).`); await navigate("inventory_counts"); } catch (error) { toast(error.message, "error"); } };
}

function inventoryItemOptions(selected = null) {
  return `<option value="">Selecciona un artículo</option>${state.inventoryOptions.items.map((row) => `<option value="${row.id}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row.sku)} · ${escapeHtml(row.name)}</option>`).join("")}`;
}

function inventoryWarehouseOptions(selected = null, optional = false) {
  return `${optional ? '<option value="">Sin almacén</option>' : '<option value="">Selecciona un almacén</option>'}${state.inventoryOptions.warehouses.map((row) => `<option value="${row.id}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row.code)} · ${escapeHtml(row.name)}</option>`).join("")}`;
}

function inventoryWarehouseFields(prefix, selectedWarehouse = null, selectedLocation = null, optional = false) {
  const title = ({ from: "Origen", to: "Destino", reservation: "Almacén", serial: "Almacén actual" })[prefix];
  return `<label>${title}<select name="${prefix}WarehouseId" ${optional ? "" : "required"}>${inventoryWarehouseOptions(selectedWarehouse, optional)}</select></label><label>Ubicación ${prefix === "from" ? "de origen" : prefix === "to" ? "de destino" : ""}<select name="${prefix}LocationId"><option value="">Sin ubicación específica</option>${state.inventoryOptions.locations.map((row) => `<option value="${row.id}" ${row.id === selectedLocation ? "selected" : ""}>${escapeHtml(row.warehouse_code)} · ${escapeHtml(row.code)} · ${escapeHtml(row.name)}</option>`).join("")}</select></label>`;
}

function inventoryPlace(warehouse, location) { return warehouse ? `<strong>${escapeHtml(warehouse)}</strong><small>${escapeHtml(location || "Sin ubicación")}</small>` : "—"; }
function inventoryNumber(value) { return Number(value || 0).toLocaleString("es-MX", { maximumFractionDigits: 6 }); }
function signedInventoryNumber(value) { const number = Number(value || 0); return `${number > 0 ? "+" : ""}${inventoryNumber(number)}`; }
function numberOrNull(value) { return value === "" || value == null ? null : Number(value); }
function nowLocalInput() { const date = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return date.toISOString().slice(0, 16); }
function stockBadge(row) { const available = Number(row.available_quantity); const min = Number(row.min_stock); const max = Number(row.max_stock); if (available <= 0) return '<span class="badge warn">● Agotado</span>'; if (min > 0 && available <= min) return '<span class="badge warn">● Bajo mínimo</span>'; if (max > 0 && available > max) return '<span class="badge">● Sobre máximo</span>'; return '<span class="badge">● Disponible</span>'; }
function inventoryStatusBadge(status) { const labels = { active: "Activa", released: "Liberada", consumed: "Consumida", cancelled: "Cancelada", quarantine: "Cuarentena", blocked: "Bloqueado", expired: "Caducado", available: "Disponible", reserved: "Reservada", issued: "Emitida", draft: "Borrador", in_progress: "En proceso", completed: "Terminado" }; const warning = ["cancelled", "blocked", "expired", "quarantine"].includes(status); return `<span class="badge ${warning ? "warn" : ""}">● ${escapeHtml(labels[status] || status)}</span>`; }
function statusOptions(statuses, selected) { const labels = { active: "Activo", quarantine: "Cuarentena", blocked: "Bloqueado", expired: "Caducado", available: "Disponible", reserved: "Reservada", issued: "Emitida" }; return statuses.map((status) => `<option value="${status}" ${status === selected ? "selected" : ""}>${labels[status]}</option>`).join(""); }

const salesDocumentUi = {
  sales_quotes: { type: "quote", title: "Cotizaciones", singular: "cotización", description: "Propuestas comerciales para prospectos y clientes.", permission: "sales.manage" },
  sales_orders: { type: "order", title: "Pedidos", singular: "pedido", description: "Compromisos confirmados de venta y surtimiento.", permission: "sales.manage" },
  sales_deliveries: { type: "delivery", title: "Entregas", singular: "entrega", description: "Surtimiento de pedidos con salida automática de inventario.", permission: "sales.fulfill" },
  sales_returns: { type: "return", title: "Devoluciones", singular: "devolución", description: "Recepción de mercancía devuelta y reingreso al inventario.", permission: "sales.fulfill" },
  sales_invoices: { type: "invoice", title: "Facturación", singular: "factura", description: "Control interno de facturas, vencimientos y pagos.", permission: "sales.approve" },
};

async function renderSales(view) {
  const token = beginPageRender();
  state.salesOptions = await api("/api/sales/options");
  if (!renderIsCurrent(token)) return;
  if (view === "sales_control") return renderSalesControl(token);
  if (view === "sales_prospects") return renderSalesProspects(token);
  return renderSalesDocuments(view, token);
}

function tradeStageCard({ key, label, description, symbol, count, active = false, module }) {
  return `<button type="button" class="trade-stage ${module} ${active ? "active" : ""}" data-${module}-stage="${key}"><span class="trade-stage-symbol">${symbol}</span><span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></span><b>${count}</b></button>`;
}

function tradeScene(module, nodes, caption) {
  return `<div class="trade-scene ${module}" aria-label="${escapeAttribute(caption)}"><div class="trade-scene-grid"></div><div class="trade-route"></div><span class="trade-packet">${module === "sales" ? "＄" : "□"}</span>${nodes.map((node, index) => `<div class="trade-scene-node node-${index + 1}"><span>${node.symbol}</span><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.detail)}</small></div>`).join("")}<div class="trade-scene-caption"><span>${escapeHtml(caption)}</span><strong>FLUJO CONECTADO</strong></div></div>`;
}

function salesHubHeader(control) {
  const openOrders = control.orders.filter((row) => !["cancelled", "fulfilled"].includes(row.status)).length;
  const openProspects = control.prospects.filter((row) => !["won", "lost"].includes(row.stage)).length;
  return `<section class="trade-hub-topbar"><div><span class="eyebrow">TODO EL RECORRIDO COMERCIAL</span><h2>Mis ventas</h2><p>Del primer contacto al cobro, con el seguimiento completo en una sola pantalla.</p></div></section>
    <section class="trade-command sales"><div class="trade-command-copy"><span class="trade-live"><i></i> CENTRO COMERCIAL</span><h3>Pipeline de ventas</h3><p>Convierte oportunidades en cotizaciones, pedidos, entregas y cobros con todo el historial del cliente conectado.</p><div class="trade-command-stats"><span><strong>${openProspects}</strong><small>oportunidades abiertas</small></span><span><strong>${openOrders}</strong><small>pedidos en seguimiento</small></span></div><div class="trade-command-actions">${hasPermission("sales.manage") ? '<button class="button ghost light-button" data-control-new="prospect">＋ Prospecto</button><button class="button ghost light-button" data-control-new="order">＋ Pedido</button><button class="button trade-primary" data-control-new="quote">＋ Cotizar</button>' : ""}</div></div>${salesOperationsScene(control)}</section>`;
}

function salesOperationsScene(control) {
  const activeProspects = control.prospects.filter((row) => !["won", "lost"].includes(row.stage)).length;
  const openOrders = control.orders.filter((row) => !["cancelled", "fulfilled"].includes(row.status)).length;
  const pendingInvoices = control.invoices.filter((row) => row.status === "posted").length;
  return '<div class="sales-pipeline-scene" aria-label="Centro comercial con oportunidad, cotización, pedido y factura por cobrar">' +
    '<div class="sales-pipeline-grid"></div><div class="sales-pipeline-status"><span>PIPELINE EN VIVO</span><i></i><b>OPORTUNIDAD</b><i></i><b>COTIZACIÓN</b><i></i><b>PEDIDO</b><i></i><b>COBRO</b></div>' +
    '<div class="sales-client-card"><div class="sales-avatar">◎</div><span>CLIENTE POTENCIAL</span><strong>' + activeProspects + '</strong><small>OPORTUNIDADES</small><i></i><i></i></div>' +
    '<div class="sales-flow-wire"><i></i><i></i><i></i><span>COT</span></div>' +
    '<div class="sales-quote-card"><span>COT</span><strong>' + control.quotes.length + '</strong><small>PROPUESTAS</small><i></i><i></i><div><b>SUBTOTAL</b><b>IMPUESTOS</b><b>TOTAL</b></div></div>' +
    '<div class="sales-order-monitor"><span>PEDIDOS</span><strong>' + openOrders + '</strong><small>EN SEGUIMIENTO</small><div><i></i><b>CONFIRMADO</b></div><div><i></i><b>POR ENTREGAR</b></div><div><i></i><b>FACTURAR</b></div></div>' +
    '<div class="sales-payment-terminal"><span>$</span><strong>' + pendingInvoices + '</strong><small>POR COBRAR</small><div><i></i><i></i><i></i><i></i></div><b>CUENTA DEL CLIENTE</b></div>' +
    '<div class="trade-scene-caption"><span>Oportunidad → cotización → pedido → entrega → factura</span><strong>VENTA CONECTADA</strong></div></div>';
}

async function renderSalesControl(token) {
  const control = await api("/api/sales/control");
  if (!renderIsCurrent(token)) return;
  const activeOrders = control.orders.filter((row) => !["cancelled", "fulfilled"].includes(row.status));
  const pendingUnits = control.orders.reduce((sum, row) => sum + Math.max(0, Number(row.ordered_quantity) - Number(row.delivered_quantity)), 0);
  const pendingInvoices = control.invoices.filter((row) => row.status === "posted").length;
  const pipelineValue = control.orders.filter((row) => row.status !== "cancelled").reduce((sum, row) => sum + Number(row.total), 0);
  pageContent.innerHTML = salesHubHeader(control) +
    `<section class="metrics sales-control-metrics">${metricCard("Pedidos activos", activeOrders.length, "En control comercial", "▣", true)}${metricCard("Unidades por entregar", inventoryNumber(pendingUnits), "Pendiente de surtimiento", "→")}${metricCard("Facturas por cobrar", pendingInvoices, "Publicadas y pendientes", "＄")}${metricCard("Valor en pedidos", money(pipelineValue), "Sin cancelaciones", "◇")}</section>
    <section id="sales-orders" class="panel sales-order-control"><div class="panel-head"><div><h3>Seguimiento de pedidos</h3><p>La operación completa de cada venta, sin cambiar de pantalla.</p></div><span>${control.orders.length} PEDIDO(S)</span></div>${control.orders.length ? `<div class="sales-order-list">${control.orders.map(salesControlOrder).join("")}</div>` : emptyMarkup("Todavía no hay pedidos", "Crea una cotización o registra un pedido directo para comenzar.")}</section>
    <section class="sales-control-grid"><article id="sales-quotes" class="panel"><div class="panel-head"><div><h3>Cotizaciones</h3><p>Propuestas recientes y su siguiente acción.</p></div><span>${control.quotes.length} REGISTRO(S)</span></div><div class="compact-list">${control.quotes.length ? control.quotes.slice(0, 8).map((row) => `<div class="sales-control-row"><div><strong>${escapeHtml(row.folio)} · ${escapeHtml(row.party_name || "Sin asignar")}</strong><small>${formatDateOnly(row.issue_date)} · ${money(row.total, row.currency_code)}</small></div>${salesStatusBadge(row.status)}<div class="table-actions"><button class="link-button" data-view-sales-document="${row.id}">Ver</button>${row.status === "accepted" && !control.orders.some((order) => order.quote_folio === row.folio) && hasPermission("sales.manage") ? `<button class="link-button" data-from-quote="${row.id}">Crear pedido</button>` : ""}${["draft", "sent"].includes(row.status) && hasPermission("sales.approve") ? `<button class="link-button" data-control-action="accept" data-id="${row.id}">Aceptar</button>` : ""}${["draft", "sent"].includes(row.status) && hasPermission("sales.manage") ? `<button class="link-button danger-link" data-control-action="cancel" data-id="${row.id}">Cancelar</button>` : ""}</div></div>`).join("") : emptyMarkup("Sin cotizaciones", "Crea la primera desde el botón superior.")}</div></article>
    <article id="sales-prospects" class="panel"><div class="panel-head"><div><h3>Prospectos</h3><p>Oportunidades que aún pueden convertirse en clientes.</p></div><span>${control.prospects.length} REGISTRO(S)</span></div><div class="compact-list">${control.prospects.length ? control.prospects.slice(0, 8).map((row) => `<div class="sales-control-row"><div><strong>${escapeHtml(row.folio)} · ${escapeHtml(row.company_name || row.contact_name)}</strong><small>${escapeHtml(row.contact_name)} · ${money(row.estimated_value, row.currency_code)}</small></div>${salesStatusBadge(row.stage)}<div class="table-actions">${hasPermission("sales.manage") ? `<button class="link-button" data-edit-prospect="${row.id}">Editar</button>${!row.customer_id && row.stage !== "lost" ? `<button class="link-button" data-convert-prospect="${row.id}">Convertir</button>` : ""}` : ""}</div></div>`).join("") : emptyMarkup("Sin prospectos", "Puedes registrar una oportunidad desde esta misma página.")}</div></article></section>
    <section id="sales-history" class="panel sales-history"><div class="panel-head"><div><h3>Movimientos recientes</h3><p>Entregas, devoluciones y facturas generadas.</p></div><span>TRAZABILIDAD</span></div><div class="sales-history-grid">${salesHistoryColumn("Entregas", control.deliveries, "delivery")}${salesHistoryColumn("Devoluciones", control.returns, "return")}${salesHistoryColumn("Facturas", control.invoices, "invoice")}</div></section>`;
  pageContent.onclick = async (event) => {
    const create = event.target.closest("[data-control-new]");
    if (create) return create.dataset.controlNew === "prospect" ? openProspectModal() : openSalesDocumentModal(create.dataset.controlNew);
    const view = event.target.closest("[data-view-sales-document]"); if (view) return openSalesDocumentDetail(Number(view.dataset.viewSalesDocument));
    const editProspect = event.target.closest("[data-edit-prospect]"); if (editProspect) return openProspectModal(control.prospects.find((row) => row.id === Number(editProspect.dataset.editProspect)));
    const convertProspect = event.target.closest("[data-convert-prospect]");
    if (convertProspect) { try { const result = await api(`/api/sales/prospects/${convertProspect.dataset.convertProspect}/convert`, { method: "POST", body: {} }); state.salesOptions = null; toast(`Cliente ${result.customerCode} creado.`); return navigate("sales_control"); } catch (error) { return toast(error.message, "error"); } }
    const quote = event.target.closest("[data-from-quote]"); if (quote) return openSalesDocumentModal("order", Number(quote.dataset.fromQuote));
    const delivery = event.target.closest("[data-deliver-order]"); if (delivery) return openSalesFulfillmentModal("delivery", Number(delivery.dataset.deliverOrder));
    const salesReturn = event.target.closest("[data-return-delivery]"); if (salesReturn) return openSalesFulfillmentModal("return", Number(salesReturn.dataset.returnDelivery));
    const invoice = event.target.closest("[data-invoice-order]"); if (invoice) return openSalesDocumentModal("invoice", Number(invoice.dataset.invoiceOrder));
    const productionOrder = event.target.closest("[data-sales-production-order]"); if (productionOrder) return openProductionOrderDetail(Number(productionOrder.dataset.salesProductionOrder));
    const action = event.target.closest("[data-control-action]"); if (!action) return;
    try { const result = await api(`/api/sales/documents/${action.dataset.id}/action`, { method: "POST", body: { action: action.dataset.controlAction } }); state.salesOptions = null; const created = result.production?.created?.length || 0; toast(created ? `Pedido aprobado: ${created} orden(es) de trabajo generadas.` : action.dataset.controlAction === "cancel" ? "Operación cancelada sin afectar inventario." : "Estado comercial actualizado."); await navigate("sales_control"); }
    catch (error) { toast(error.message, "error"); }
  };
}

function salesControlOrder(row) {
  const ordered = Number(row.ordered_quantity); const delivered = Number(row.delivered_quantity); const returned = Number(row.returned_quantity);
  const percent = ordered > 0 ? Math.min(100, Math.round(delivered / ordered * 100)) : 0;
  const canCancel = ["draft", "confirmed"].includes(row.status) && Number(row.delivery_count) === 0;
  const canDeliver = ["confirmed", "partially_fulfilled"].includes(row.status) && delivered < ordered;
  return `<article class="sales-order-card ${row.status === "cancelled" ? "cancelled" : ""}"><div class="sales-order-main"><div class="sales-order-id"><span>${escapeHtml(row.customer_code)}</span><strong>${escapeHtml(row.folio)}</strong><small>${escapeHtml(row.customer_name)}</small></div><div class="sales-order-origin"><span>COTIZACIÓN</span><strong>${escapeHtml(row.quote_folio || "Pedido directo")}</strong><small>${formatDateOnly(row.issue_date)} · ${money(row.total, row.currency_code)}</small></div><div class="sales-delivery-progress"><div><span>ENTREGA</span><strong>${inventoryNumber(delivered)} / ${inventoryNumber(ordered)}</strong></div><div class="progress-track"><span style="width:${percent}%"></span></div><small>${percent}% surtido · ${row.delivery_count} entrega(s)${returned ? ` · ${inventoryNumber(returned)} devuelto` : ""}</small></div><div class="sales-invoice-state"><span>FACTURA</span><strong>${escapeHtml(row.invoice_folio || "Pendiente")}</strong><small>${row.invoice_status ? salesStatusLabel(row.invoice_status) : "Aún no generada"}</small></div><div>${salesStatusBadge(row.status)}</div></div><div class="sales-order-actions"><button class="link-button" data-view-sales-document="${row.id}">Ver pedido</button>${row.production_order_id ? `<button class="sales-production-link" data-sales-production-order="${row.production_order_id}"><span>PRODUCCIÓN</span><strong>${escapeHtml(row.production_order_folios)}</strong><small>${row.production_order_count} OT · ${escapeHtml(productionStatusLabel(row.production_status))}</small></button>` : ""}${row.status === "draft" && hasPermission("sales.approve") ? `<button class="button ghost small" data-control-action="confirm" data-id="${row.id}">Confirmar pedido</button>` : ""}${canDeliver && hasPermission("sales.fulfill") ? `<button class="button primary small" data-deliver-order="${row.id}">Registrar entrega</button>` : ""}${delivered > returned && row.latest_delivery_id && hasPermission("sales.fulfill") ? `<button class="button ghost small" data-return-delivery="${row.latest_delivery_id}">Devolución</button>` : ""}${!row.invoice_id && ["confirmed", "partially_fulfilled", "fulfilled"].includes(row.status) && hasPermission("sales.approve") ? `<button class="button ghost small" data-invoice-order="${row.id}">Facturar</button>` : ""}${row.invoice_id ? `<button class="link-button" data-view-sales-document="${row.invoice_id}">Ver factura</button>` : ""}${row.invoice_status === "posted" && hasPermission("sales.approve") ? `<button class="button ghost small" data-control-action="mark_paid" data-id="${row.invoice_id}">Marcar pagada</button>` : ""}${canCancel && hasPermission("sales.manage") ? `<button class="link-button danger-link" data-control-action="cancel" data-id="${row.id}">Cancelar pedido</button>` : ""}</div></article>`;
}

function salesHistoryColumn(title, records, type) {
  return `<div><h4>${title}</h4>${records.length ? records.slice(0, 5).map((row) => `<button class="sales-history-item" data-view-sales-document="${row.id}"><span>${escapeHtml(row.folio)}</span><strong>${escapeHtml(row.party_name || "Sin cliente")}</strong><small>${formatDateOnly(row.issue_date)} · ${money(row.total, row.currency_code)} · ${salesStatusLabel(row.status)}</small></button>`).join("") : `<p class="muted">Sin ${title.toLowerCase()}.</p>`}</div>`;
}

async function renderSalesProspects(token) {
  const { prospects } = await api("/api/sales/prospects");
  if (!renderIsCurrent(token)) return;
  const openValue = prospects.filter((row) => !["won", "lost"].includes(row.stage)).reduce((sum, row) => sum + Number(row.estimated_value), 0);
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">EMBUDO COMERCIAL</span><h2>Prospectos</h2><p>Oportunidades previas a convertirse en clientes y generar una cotización.</p></div>${hasPermission("sales.manage") ? '<button class="button primary" data-new-prospect>＋ Nuevo prospecto</button>' : ""}</section>
    <section class="metrics sales-metrics">${metricCard("Prospectos activos", prospects.filter((row) => !["won", "lost"].includes(row.stage)).length, "Oportunidades abiertas", "◎", true)}${metricCard("Calificados", prospects.filter((row) => ["qualified", "proposal"].includes(row.stage)).length, "Con avance comercial", "◇")}${metricCard("Valor estimado", money(openValue), "Cartera abierta", "＄")}</section>
    <div class="table-wrap"><table><thead><tr><th>Folio / contacto</th><th>Empresa</th><th>Contacto</th><th>Origen</th><th>Valor estimado</th><th>Etapa</th><th>Cliente</th><th></th></tr></thead><tbody>${prospects.length ? prospects.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small>${escapeHtml(row.email || row.phone || "Sin datos de contacto")}</small></td><td>${escapeHtml(row.company_name || "Persona física")}</td><td>${escapeHtml(row.contact_name)}</td><td>${escapeHtml(row.source || "—")}</td><td>${money(row.estimated_value, row.currency_code)}</td><td>${salesStatusBadge(row.stage)}</td><td>${row.customer_code ? `<strong>${escapeHtml(row.customer_code)}</strong><small>${escapeHtml(row.customer_name)}</small>` : "—"}</td><td><div class="table-actions">${hasPermission("sales.manage") ? `<button class="link-button" data-edit-prospect="${row.id}">Editar</button>${!row.customer_id && row.stage !== "lost" ? `<button class="link-button" data-convert-prospect="${row.id}">Convertir</button>` : ""}` : ""}</div></td></tr>`).join("") : `<tr><td colspan="8">${emptyMarkup("No hay prospectos", "Registra la primera oportunidad comercial.")}</td></tr>`}</tbody></table></div>`;
  pageContent.onclick = async (event) => {
    if (event.target.closest("[data-new-prospect]")) return openProspectModal();
    const edit = event.target.closest("[data-edit-prospect]"); if (edit) return openProspectModal(prospects.find((row) => row.id === Number(edit.dataset.editProspect)));
    const convert = event.target.closest("[data-convert-prospect]"); if (!convert) return;
    try { const result = await api(`/api/sales/prospects/${convert.dataset.convertProspect}/convert`, { method: "POST", body: {} }); state.salesOptions = null; toast(`Cliente ${result.customerCode} creado desde el prospecto.`); await navigate("sales_control"); }
    catch (error) { toast(error.message, "error"); }
  };
}

function openProspectModal(record = null) {
  const baseCurrency = state.salesOptions.currencies.find((row) => row.is_base) ?? state.salesOptions.currencies[0];
  $("#entity-modal-content").innerHTML = `<form id="prospect-form"><div class="modal-head"><div><span class="eyebrow">${record ? "EDITAR PROSPECTO" : "NUEVO PROSPECTO"}</span><h2>${record ? escapeHtml(record.contact_name) : "Registrar oportunidad"}</h2><p class="muted">El folio se asigna automáticamente al guardar.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner(record?.folio || "PRO-000000", !record)}<div class="form-grid"><label>Empresa<input name="companyName" maxlength="180" value="${escapeAttribute(record?.company_name || "")}" /></label><label>Contacto<input name="contactName" maxlength="160" required value="${escapeAttribute(record?.contact_name || "")}" /></label><label>Correo<input name="email" type="email" maxlength="180" value="${escapeAttribute(record?.email || "")}" /></label><label>Teléfono<input name="phone" maxlength="50" value="${escapeAttribute(record?.phone || "")}" /></label><label>Origen<input name="source" maxlength="100" value="${escapeAttribute(record?.source || "")}" placeholder="Referido, web, evento…" /></label><label>Etapa<select name="stage">${salesStageOptions(record?.stage || "new")}</select></label><label>Valor estimado<input name="estimatedValue" type="number" min="0" step="0.01" value="${record?.estimated_value ?? 0}" /></label><label>Moneda<select name="currencyId" required>${salesCurrencyOptions(record?.currency_id || baseCurrency?.id)}</select></label></div><label>Notas<textarea name="notes" rows="3">${escapeHtml(record?.notes || "")}</textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar prospecto</button></div></form>`;
  $("#prospect-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); try { const result = await api(record ? `/api/sales/prospects/${record.id}` : "/api/sales/prospects", { method: record ? "PATCH" : "POST", body: { companyName: data.get("companyName"), contactName: data.get("contactName"), email: data.get("email"), phone: data.get("phone"), source: data.get("source"), stage: data.get("stage"), estimatedValue: Number(data.get("estimatedValue")), currencyId: Number(data.get("currencyId")), notes: data.get("notes") } }); entityDialog.close(); state.salesOptions = null; toast(`Prospecto ${result.folio} guardado.`); await navigate("sales_control"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
}

async function renderSalesDocuments(view, token) {
  const definition = salesDocumentUi[view];
  const { documents } = await api(`/api/sales/documents/${definition.type}`);
  if (!renderIsCurrent(token)) return;
  const total = documents.filter((row) => !["cancelled", "rejected"].includes(row.status)).reduce((sum, row) => sum + Number(row.total), 0);
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">CONTROL COMERCIAL</span><h2>${definition.title}</h2><p>${definition.description}</p></div>${hasPermission(definition.permission) ? `<button class="button primary" data-new-sales-document="${definition.type}">＋ Nueva ${definition.singular}</button>` : ""}</section>
    <section class="sales-summary"><span><strong>${documents.length}</strong> documento(s)</span><span><strong>${money(total)}</strong> valor acumulado</span><span>Folios automáticos y trazabilidad por documento origen</span></section>
    <div class="table-wrap"><table><thead><tr><th>Folio / fecha</th><th>Cliente o prospecto</th><th>Origen</th><th>Partidas</th><th>Total</th><th>Estado</th><th>Responsable</th><th></th></tr></thead><tbody>${documents.length ? documents.map((row) => `<tr><td><strong>${escapeHtml(row.folio)}</strong><small>${formatDateOnly(row.issue_date)}</small></td><td><strong>${escapeHtml(row.party_name || "Sin asignar")}</strong><small>${escapeHtml(row.customer_code || row.prospect_folio || "")}</small></td><td>${escapeHtml(row.source_folio || "—")}</td><td>${row.line_count}</td><td><strong>${money(row.total, row.currency_code)}</strong><small>Impuestos ${money(row.tax_total, row.currency_code)}</small></td><td>${salesStatusBadge(row.status)}${row.document_type === "invoice" ? `<small>${escapeHtml(row.payment_status)}</small>` : ""}</td><td>${escapeHtml(row.created_by_name || "Sistema")}</td><td><div class="table-actions"><button class="link-button" data-view-sales-document="${row.id}">Ver</button>${salesActionButtons(row)}</div></td></tr>`).join("") : `<tr><td colspan="8">${emptyMarkup(`No hay ${definition.title.toLowerCase()}`, `Crea la primera ${definition.singular} para iniciar el flujo.`)}</td></tr>`}</tbody></table></div>`;
  pageContent.onclick = async (event) => {
    const create = event.target.closest("[data-new-sales-document]"); if (create) return openSalesDocumentModal(create.dataset.newSalesDocument);
    const viewButton = event.target.closest("[data-view-sales-document]"); if (viewButton) return openSalesDocumentDetail(Number(viewButton.dataset.viewSalesDocument));
    const action = event.target.closest("[data-sales-action]"); if (!action) return;
    try { const result = await api(`/api/sales/documents/${action.dataset.id}/action`, { method: "POST", body: { action: action.dataset.salesAction } }); state.salesOptions = null; const created = result.production?.created?.length || 0; toast(created ? `Pedido aprobado: ${created} orden(es) de trabajo generadas.` : `Documento actualizado a ${salesStatusLabel(result.status)}.`); await navigate(view); }
    catch (error) { toast(error.message, "error"); }
  };
}

function salesActionButtons(row) {
  if (row.document_type === "quote") {
    if (row.status === "draft") return `${hasPermission("sales.manage") ? `<button class="link-button" data-sales-action="send" data-id="${row.id}">Enviar</button>` : ""}${hasPermission("sales.approve") ? `<button class="link-button" data-sales-action="accept" data-id="${row.id}">Aceptar</button>` : ""}`;
    if (row.status === "sent") return `${hasPermission("sales.approve") ? `<button class="link-button" data-sales-action="accept" data-id="${row.id}">Aceptar</button>` : ""}${hasPermission("sales.manage") ? `<button class="link-button danger-link" data-sales-action="reject" data-id="${row.id}">Rechazar</button>` : ""}`;
  }
  if (row.document_type === "order" && row.status === "draft" && hasPermission("sales.approve")) return `<button class="link-button" data-sales-action="confirm" data-id="${row.id}">Confirmar</button>`;
  if (row.document_type === "invoice" && row.status === "posted" && hasPermission("sales.approve")) return `<button class="link-button" data-sales-action="mark_paid" data-id="${row.id}">Marcar pagada</button>`;
  return "";
}

function openSalesDocumentModal(type, sourceId = null) {
  if (["delivery", "return"].includes(type)) return openSalesFulfillmentModal(type);
  const isQuote = type === "quote"; const isOrder = type === "order"; const isInvoice = type === "invoice";
  const labels = { quote: "Cotización", order: "Pedido", invoice: "Factura" };
  const prefixes = { quote: "COT-000000", order: "PED-000000", invoice: "FAC-000000" };
  const baseCurrency = state.salesOptions.currencies.find((row) => row.is_base) ?? state.salesOptions.currencies[0];
  const sources = state.salesOptions.sourceDocuments.filter((row) => row.document_type === (isOrder ? "quote" : "order"));
  const draftLines = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = `<form id="sales-document-form"><div class="modal-head"><div><span class="eyebrow">NUEVA ${labels[type].toUpperCase()}</span><h2>Registrar ${labels[type].toLowerCase()}</h2><p class="muted">Los importes se calculan por partida antes de guardar.</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner(prefixes[type], true)}
    <div class="form-grid">${!isQuote ? `<label>Documento origen<select id="sales-commercial-source" name="sourceDocumentId" ${isInvoice ? "required" : ""}><option value="">${isOrder ? "Pedido directo, sin cotización" : "Selecciona un pedido"}</option>${sources.map((row) => `<option value="${row.id}" ${row.id === sourceId ? "selected" : ""}>${escapeHtml(row.folio)} · ${escapeHtml(row.party_name)} · ${money(row.total)}</option>`).join("")}</select></label>` : ""}
    ${isQuote ? `<label>Cliente<select name="customerId"><option value="">Sin cliente</option>${salesCustomerOptions()}</select></label><label>Prospecto<select name="prospectId"><option value="">Sin prospecto</option>${state.salesOptions.prospects.map((row) => `<option value="${row.id}">${escapeHtml(row.folio)} · ${escapeHtml(row.company_name || row.contact_name)}</option>`).join("")}</select></label>` : isOrder ? `<label>Cliente para pedido directo<select name="customerId"><option value="">Se tomará de la cotización</option>${salesCustomerOptions()}</select></label>` : ""}
    <label>Moneda<select name="currencyId" required>${salesCurrencyOptions(baseCurrency?.id)}</select></label><label>Tipo de cambio<input name="exchangeRate" type="number" min="0.000001" step="0.000001" value="1" required /></label><label>Fecha de emisión<input name="issueDate" type="date" value="${todayInput()}" required /></label>${isQuote ? `<label>Vigencia<input name="validUntil" type="date" /></label>` : isOrder ? `<label>Entrega esperada<input name="expectedDate" type="date" /></label>` : `<label>Vencimiento<input name="dueDate" type="date" /></label><label>Referencia fiscal interna<input name="fiscalReference" maxlength="180" placeholder="UUID o referencia, si aplica" /></label>`}<label>Días de crédito<input name="paymentTermsDays" type="number" min="0" step="1" value="0" /></label></div>${!isQuote ? '<div id="sales-source-preview" class="sales-source-preview hidden"></div>' : ""}
    ${!isInvoice ? `<section class="sales-line-builder"><div class="panel-head"><h3>Partidas</h3><span>PRECIO, DESCUENTO E IMPUESTO</span></div><div class="sales-line-fields"><label>Artículo<select id="sales-line-item">${salesItemOptions()}</select></label><label>Cantidad<input id="sales-line-quantity" type="number" min="0.000001" step="0.000001" value="1" /></label><label>Precio<input id="sales-line-price" type="number" min="0" step="0.000001" value="0" /></label><label>Desc. %<input id="sales-line-discount" type="number" min="0" max="100" step="0.01" value="0" /></label><label>Impuesto %<input id="sales-line-tax" type="number" min="0" max="100" step="0.01" value="16" /></label><button class="button ghost" type="button" id="add-sales-line">Agregar</button></div><div id="sales-draft-lines">${emptyMarkup("Sin partidas", isOrder ? "Agrega partidas para un pedido directo o selecciona una cotización." : "Agrega los artículos cotizados.")}</div></section>` : '<div class="automatic-code"><span>FACTURACIÓN INTERNA</span><strong>Control comercial</strong><small>Este módulo no realiza timbrado fiscal ante el SAT; conserva la referencia del comprobante externo.</small></div>'}
    <label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar ${labels[type].toLowerCase()}</button></div></form>`;
  if (!isInvoice) {
    $("#sales-line-item").addEventListener("change", (event) => { const item = state.salesOptions.items.find((row) => row.id === Number(event.target.value)); if (item) { $("#sales-line-price").value = item.list_price; $("#sales-line-tax").value = item.tax_rate; } });
    $("#add-sales-line").addEventListener("click", () => { const item = state.salesOptions.items.find((row) => row.id === Number($("#sales-line-item").value)); const quantity = Number($("#sales-line-quantity").value); if (!item || !(quantity > 0)) return toast("Selecciona un artículo y cantidad válida.", "error"); draftLines.push({ itemId: item.id, sku: item.sku, name: item.name, description: item.description || item.name, quantity, unitPrice: Number($("#sales-line-price").value), discountRate: Number($("#sales-line-discount").value), taxRate: Number($("#sales-line-tax").value) }); renderSalesDraftLines(draftLines); });
    $("#sales-draft-lines").addEventListener("click", (event) => { const remove = event.target.closest("[data-remove-sales-line]"); if (!remove) return; draftLines.splice(Number(remove.dataset.removeSalesLine), 1); renderSalesDraftLines(draftLines); });
  }
  const sourceSelect = $("#sales-commercial-source");
  const hydrateFromSource = async () => {
    const selectedId = Number(sourceSelect?.value);
    const form = $("#sales-document-form");
    const preview = $("#sales-source-preview");
    if (!selectedId) {
      preview?.classList.add("hidden");
      if (isOrder) { draftLines.splice(0); renderSalesDraftLines(draftLines); }
      return;
    }
    if (preview) { preview.innerHTML = "<strong>Cargando datos del documento…</strong>"; preview.classList.remove("hidden"); }
    try {
      const detail = await api(`/api/sales/documents/${selectedId}`);
      if (Number(sourceSelect.value) !== selectedId) return;
      if (form.elements.customerId && detail.document.customer_id) form.elements.customerId.value = String(detail.document.customer_id);
      form.elements.currencyId.value = String(detail.document.currency_id);
      form.elements.exchangeRate.value = detail.document.exchange_rate;
      form.elements.paymentTermsDays.value = detail.document.payment_terms_days;
      if (!form.elements.notes.value.trim() && detail.document.notes) form.elements.notes.value = detail.document.notes;
      if (isOrder) {
        draftLines.splice(0, draftLines.length, ...detail.lines.map((line) => ({
          sourceLineId: line.id, itemId: line.item_id, sku: line.sku, name: line.item_name,
          description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unit_price),
          discountRate: Number(line.discount_rate), taxRate: Number(line.tax_rate),
        })));
        renderSalesDraftLines(draftLines);
      }
      if (preview) preview.innerHTML = `<span>DATOS PRECARGADOS</span><strong>${escapeHtml(detail.document.folio)} · ${escapeHtml(detail.document.party_name || "Cliente")}</strong><small>${detail.lines.length} partida(s) · ${money(detail.document.total, detail.document.currency_code)} · Los valores pueden ajustarse antes de guardar.</small>`;
    } catch (error) {
      if (preview) preview.innerHTML = `<strong>No fue posible cargar el documento.</strong><small>${escapeHtml(error.message)}</small>`;
    }
  };
  sourceSelect?.addEventListener("change", hydrateFromSource);
  $("#sales-document-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); const sourceDocumentId = numberOrNull(data.get("sourceDocumentId")); if (!isInvoice && !draftLines.length && !(isOrder && sourceDocumentId)) { box.textContent = "Agrega partidas o selecciona una cotización aceptada."; return box.classList.remove("hidden"); } try { const result = await api(`/api/sales/documents/${type}`, { method: "POST", body: { sourceDocumentId, customerId: numberOrNull(data.get("customerId")), prospectId: numberOrNull(data.get("prospectId")), currencyId: Number(data.get("currencyId")), exchangeRate: Number(data.get("exchangeRate")), issueDate: data.get("issueDate"), validUntil: data.get("validUntil") || null, expectedDate: data.get("expectedDate") || null, dueDate: data.get("dueDate") || null, paymentTermsDays: Number(data.get("paymentTermsDays") || 0), fiscalReference: data.get("fiscalReference") || "", notes: data.get("notes"), lines: draftLines } }); entityDialog.close(); state.salesOptions = null; toast(`${labels[type]} ${result.folio} guardada.`); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
  if (sourceId) hydrateFromSource();
}

function renderSalesDraftLines(lines) {
  $("#sales-draft-lines").innerHTML = lines.length ? `<div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Cantidad</th><th>Precio</th><th>Desc.</th><th>Impuesto</th><th>Total</th><th></th></tr></thead><tbody>${lines.map((line, index) => { const subtotal = line.quantity * line.unitPrice; const total = (subtotal - subtotal * line.discountRate / 100) * (1 + line.taxRate / 100); return `<tr><td><strong>${escapeHtml(line.sku)}</strong><small>${escapeHtml(line.name)}</small></td><td>${inventoryNumber(line.quantity)}</td><td>${money(line.unitPrice)}</td><td>${line.discountRate}%</td><td>${line.taxRate}%</td><td><strong>${money(total)}</strong></td><td><button class="link-button danger-link" type="button" data-remove-sales-line="${index}">Quitar</button></td></tr>`; }).join("")}</tbody></table></div>` : emptyMarkup("Sin partidas", "Agrega los artículos del documento.");
}

function openSalesFulfillmentModal(type, sourceId = null) {
  const isDelivery = type === "delivery"; const label = isDelivery ? "Entrega" : "Devolución"; const sourceType = isDelivery ? "order" : "delivery";
  const sources = state.salesOptions.sourceDocuments.filter((row) => row.document_type === sourceType && (isDelivery ? ["confirmed", "partially_fulfilled"].includes(row.status) : row.status === "posted"));
  const baseCurrency = state.salesOptions.currencies.find((row) => row.is_base) ?? state.salesOptions.currencies[0];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = `<form id="sales-fulfillment-form"><div class="modal-head"><div><span class="eyebrow">NUEVA ${label.toUpperCase()}</span><h2>Registrar ${label.toLowerCase()}</h2><p class="muted">${isDelivery ? "Las cantidades se descontarán del inventario al guardar." : "Las cantidades volverán al inventario al guardar."}</p></div><button type="button" data-close-modal>×</button></div>${automaticCodeBanner(isDelivery ? "ENV-000000" : "DEV-000000", true)}<div class="form-grid"><label>${isDelivery ? "Pedido" : "Entrega original"}<select name="sourceDocumentId" id="sales-source-document" required><option value="">Selecciona un documento</option>${sources.map((row) => `<option value="${row.id}" ${row.id === sourceId ? "selected" : ""}>${escapeHtml(row.folio)} · ${escapeHtml(row.party_name)}</option>`).join("")}</select></label><label>Fecha<input name="issueDate" type="date" value="${todayInput()}" required /></label><label>Moneda<select name="currencyId" id="fulfillment-currency" required>${salesCurrencyOptions(baseCurrency?.id)}</select></label><label>Tipo de cambio<input name="exchangeRate" type="number" min="0.000001" step="0.000001" value="1" required /></label></div><div id="fulfillment-lines" class="panel">${emptyMarkup("Selecciona el documento origen", "Después podrás capturar las cantidades y ubicaciones.")}</div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Aplicar ${label.toLowerCase()}</button></div></form>`;
  let sourceDetail = null;
  $("#sales-source-document").addEventListener("change", async (event) => { const id = Number(event.target.value); if (!id) return; try { sourceDetail = await api(`/api/sales/documents/${id}`); $("#fulfillment-currency").value = sourceDetail.document.currency_id; renderFulfillmentLines(sourceDetail.lines, isDelivery); } catch (error) { toast(error.message, "error"); } });
  $("#sales-fulfillment-form").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form); const lines = $$("[data-fulfillment-line]", form).map((row) => ({ sourceLineId: Number(row.dataset.fulfillmentLine), quantity: Number($("[data-field=quantity]", row).value), warehouseId: numberOrNull($("[data-field=warehouse]", row).value), locationId: numberOrNull($("[data-field=location]", row).value), lotId: numberOrNull($("[data-field=lot]", row).value) })).filter((row) => row.quantity > 0); if (!lines.length) { box.textContent = "Captura al menos una cantidad."; return box.classList.remove("hidden"); } try { const result = await api(`/api/sales/documents/${type}`, { method: "POST", body: { sourceDocumentId: Number(data.get("sourceDocumentId")), currencyId: Number(data.get("currencyId")), exchangeRate: Number(data.get("exchangeRate")), issueDate: data.get("issueDate"), notes: data.get("notes"), lines } }); entityDialog.close(); state.salesOptions = null; toast(`${label} ${result.folio} aplicada al inventario.`); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }); entityDialog.showModal();
  if (sourceId) $("#sales-source-document").dispatchEvent(new Event("change"));
}

function renderFulfillmentLines(lines, isDelivery) {
  const eligible = lines.filter((row) => Number(row.quantity) - Number(isDelivery ? row.delivered_quantity : row.returned_quantity) > 0.0000001);
  $("#fulfillment-lines").innerHTML = eligible.length ? `<div class="panel-head"><h3>Partidas pendientes</h3><span>CAPTURA CANTIDAD Y DESTINO</span></div><div class="fulfillment-grid">${eligible.map((row) => { const pending = Number(row.quantity) - Number(isDelivery ? row.delivered_quantity : row.returned_quantity); return `<article class="fulfillment-line" data-fulfillment-line="${row.id}"><div><strong>${escapeHtml(row.sku)} · ${escapeHtml(row.item_name)}</strong><small>Máximo ${inventoryNumber(pending)} ${escapeHtml(row.unit_symbol || "")}</small></div><label>Cantidad<input data-field="quantity" type="number" min="0" max="${pending}" step="0.000001" value="0" /></label><label>Almacén<select data-field="warehouse" ${isDelivery ? "required" : ""}><option value="">${isDelivery ? "Selecciona" : "Almacén original"}</option>${state.salesOptions.warehouses.map((item) => `<option value="${item.id}" ${!isDelivery && item.id === row.warehouse_id ? "selected" : ""}>${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Ubicación<select data-field="location"><option value="">Sin ubicación</option>${state.salesOptions.locations.map((item) => `<option value="${item.id}" ${!isDelivery && item.id === row.location_id ? "selected" : ""}>${escapeHtml(item.warehouse_code)} · ${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join("")}</select></label><label>Lote<select data-field="lot"><option value="">Sin lote</option>${state.salesOptions.lots.filter((item) => item.item_id === row.item_id).map((item) => `<option value="${item.id}" ${!isDelivery && item.id === row.lot_id ? "selected" : ""}>${escapeHtml(item.lot_number)}</option>`).join("")}</select></label></article>`; }).join("")}</div>` : emptyMarkup("Sin cantidades pendientes", isDelivery ? "El pedido ya fue surtido por completo." : "Toda la entrega ya fue devuelta.");
}

async function openSalesDocumentDetail(id) {
  try {
    const { document, lines, productionOrders = [] } = await api(`/api/sales/documents/${id}`);
    $("#entity-modal-content").classList.add("wide");
    $("#entity-modal-content").innerHTML = `<div><div class="modal-head"><div><span class="eyebrow">${escapeHtml(document.folio)}</span><h2>${escapeHtml(document.party_name || "Documento comercial")}</h2><p class="muted">${formatDateOnly(document.issue_date)} · ${salesStatusLabel(document.status)}${document.source_folio ? ` · Origen ${escapeHtml(document.source_folio)}` : ""}</p></div><button type="button" data-close-modal>×</button></div><section class="sales-document-totals"><div><span>Subtotal</span><strong>${money(document.subtotal, document.currency_code)}</strong></div><div><span>Descuento</span><strong>${money(document.discount_total, document.currency_code)}</strong></div><div><span>Impuestos</span><strong>${money(document.tax_total, document.currency_code)}</strong></div><div class="highlight"><span>Total</span><strong>${money(document.total, document.currency_code)}</strong></div></section>${productionOrders.length ? `<section class="sales-work-orders"><div class="panel-head"><div><span class="eyebrow">VENTA CONECTADA CON PRODUCCIÓN</span><h3>Órdenes de trabajo generadas</h3></div><span>${productionOrders.length} OT</span></div><div>${productionOrders.map((order) => `<button type="button" data-sales-production-order="${order.id}"><span>OT</span><div><strong>${escapeHtml(order.folio)} · ${escapeHtml(order.sku)}</strong><small>${escapeHtml(order.item_name)} · ${inventoryNumber(order.planned_quantity)} planeado</small></div><div><strong>${escapeHtml(order.bom_folio || "Sin BOM")} · ${escapeHtml(order.route_folio || "Sin ruta")}</strong><small>${order.material_count} materia(s) prima(s) · ${order.operation_count} operación(es)</small></div>${productionStatusBadge(order.status)}</button>`).join("")}</div></section>` : ""}<div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Descripción</th><th>Cantidad</th><th>Precio</th><th>Descuento</th><th>Impuesto</th><th>Total</th></tr></thead><tbody>${lines.map((row) => `<tr><td><strong>${escapeHtml(row.sku)}</strong><small>${escapeHtml(row.item_name)}</small></td><td>${escapeHtml(row.description)}</td><td>${inventoryNumber(row.quantity)} ${escapeHtml(row.unit_symbol || "")}</td><td>${money(row.unit_price)}</td><td>${money(row.discount_amount)}</td><td>${money(row.tax_amount)}</td><td><strong>${money(row.line_total)}</strong></td></tr>`).join("")}</tbody></table></div>${document.notes ? `<div class="document-notes"><strong>Notas</strong><p>${escapeHtml(document.notes)}</p></div>` : ""}<div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>`;
    $("#entity-modal-content").onclick = (event) => {
      const workOrder = event.target.closest("[data-sales-production-order]");
      if (workOrder) { entityDialog.close(); return openProductionOrderDetail(Number(workOrder.dataset.salesProductionOrder)); }
    };
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function productionHubHeader(control, active, produced) {
  return '<section class="trade-hub-topbar"><div><span class="eyebrow">PLANTA Y ÓRDENES EN UN SOLO LUGAR</span><h2>Mi producción</h2><p>Prepara lo necesario, inicia el trabajo y observa el avance de cada orden.</p></div></section>' +
    '<section class="trade-command production"><div class="trade-command-copy"><span class="trade-live"><i></i> PISO DE PRODUCCIÓN</span><h3>Control de planta</h3><p>Programa órdenes, libera materiales, asigna centros de trabajo y registra piezas buenas, rechazos y tiempos reales.</p><div class="trade-command-stats"><span><strong>' + active.length + '</strong><small>órdenes en proceso</small></span><span><strong>' + inventoryNumber(produced) + '</strong><small>piezas terminadas</small></span></div><div class="trade-command-actions">' +
    (hasPermission("production.manage") ? '<button class="button ghost light-button" data-production-new="bom">＋ Materiales</button><button class="button ghost light-button" data-production-new="route">＋ Proceso</button><button class="button ghost light-button" data-production-new="demand">＋ Planear</button><button class="button trade-primary" data-production-new="order">＋ Orden</button>' : "") +
    '</div></div>' + productionFactoryScene(active.length, control.orders.length) + '</section>';
}

function productionFactoryScene(activeCount, totalCount) {
  return '<div class="production-factory" aria-label="Piso de producción con materiales, centro de trabajo, inspección y producto terminado">' +
    '<div class="factory-grid"></div><div class="factory-beam"></div>' +
    '<div class="factory-zone-label zone-material">01 · PREPARACIÓN</div><div class="factory-zone-label zone-process">02 · FABRICACIÓN</div><div class="factory-zone-label zone-quality">03 · LIBERACIÓN</div>' +
    '<div class="factory-materials"><strong>MP</strong><div><i></i><i></i><i></i><i></i><i></i><i></i></div><span>MATERIAL LISTO</span><small>Para surtir</small></div>' +
    '<div class="factory-conveyor"><i></i><i></i><i></i><i></i><span class="factory-part">OP</span></div>' +
    '<div class="factory-workcell"><div class="factory-stack"><i></i><i></i><i></i></div><div class="factory-screen"><span>OP-01</span><b>' + activeCount + ' ACTIVAS</b></div><div class="factory-tool"><i></i></div><strong>CENTRO DE TRABAJO</strong><small>Operación y tiempo real</small></div>' +
    '<div class="factory-operator"><span></span><i></i><strong>OPERADOR</strong></div>' +
    '<div class="factory-quality-gate"><span>✓</span><strong>CALIDAD</strong><small>Inspección</small></div>' +
    '<div class="factory-output"><div><i></i><i></i><i></i></div><strong>TERMINADO</strong><small>' + totalCount + ' orden(es) controladas</small></div>' +
    '<div class="trade-scene-caption"><span>Material → centro de trabajo → inspección → producto terminado</span><strong>CELDA EN LÍNEA</strong></div></div>';
}

function productionOrderFilters(orders) {
  const groups = [
    ["all", "Todas", orders.length],
    ["pending", "Por iniciar", orders.filter((row) => ["draft", "planned", "released"].includes(row.status)).length],
    ["working", "Trabajando", orders.filter((row) => ["in_progress", "paused"].includes(row.status)).length],
    ["finished", "Terminadas", orders.filter((row) => ["completed", "closed"].includes(row.status)).length],
  ];
  return '<div class="production-order-filters" aria-label="Filtrar órdenes">' + groups.map(([key, label, count]) => '<button type="button" class="' + (state.productionOrderFilter === key ? "active" : "") + '" data-production-filter="' + key + '">' + label + '<span>' + count + '</span></button>').join("") + '</div>';
}

function productionFilterGroup(status) {
  if (["draft", "planned", "released"].includes(status)) return "pending";
  if (["in_progress", "paused"].includes(status)) return "working";
  if (["completed", "closed"].includes(status)) return "finished";
  return "other";
}

async function renderProduction() {
  const token = beginPageRender();
  const [control, options] = await Promise.all([api("/api/production/control"), api("/api/production/options")]);
  if (!renderIsCurrent(token)) return;
  state.productionOptions = options;
  const active = control.orders.filter((row) => ["released", "in_progress", "paused"].includes(row.status));
  const produced = control.orders.reduce((sum, row) => sum + Number(row.produced_quantity || 0), 0);
  const rejected = control.orders.reduce((sum, row) => sum + Number(row.rejected_quantity || 0), 0);
  pageContent.innerHTML =
    productionHubHeader(control, active, produced) +
    '<section class="metrics">' + metricCard("Órdenes activas", active.length, "Liberadas o en ejecución", "⚒", true) + metricCard("Demanda abierta", control.demands.filter((r) => ["open", "planned"].includes(r.status)).length, "Requerimientos por cubrir", "◇") + metricCard("Cantidad producida", inventoryNumber(produced), "Avance acumulado", "✓") + metricCard("Rechazos", inventoryNumber(rejected), "Control de merma", "!") + '</section>' +
    '<section class="panel production-orders"><div class="panel-head"><div><h3>Órdenes de producción</h3><p>Observa qué se fabricará, cuánto lleva y cuál es el siguiente paso.</p></div><span>' + control.orders.length + ' ORDEN(ES)</span></div>' +
    (control.orders.length ? productionOrderFilters(control.orders) + '<div class="production-order-list">' + control.orders.map(productionOrderCard).join("") + '</div><div id="production-filter-empty" class="hidden">' + emptyMarkup("Sin órdenes en este estado", "Elige otro filtro para continuar.") + '</div>' : emptyMarkup("Sin órdenes de producción", "Prepara materiales y crea la primera orden.")) + '</section>' +
    '<section class="production-engineering-grid"><article class="panel"><div class="panel-head"><div><h3>Qué se necesita</h3><p>Materiales, cantidades, versiones y sustitutos de cada producto.</p></div><span>' + control.boms.length + ' LISTA(S)</span></div><div class="compact-list">' +
    (control.boms.length ? control.boms.slice(0, 8).map((row) => '<div class="production-compact-row"><div><strong>' + escapeHtml(row.folio) + ' · ' + escapeHtml(row.sku) + '</strong><small>' + escapeHtml(row.product_name) + ' · Versión ' + escapeHtml(row.version) + ' · ' + row.line_count + ' material(es)</small></div>' + (row.is_phantom ? '<span class="badge warn">FANTASMA</span>' : productionStatusBadge(row.status)) + '</div>').join("") : emptyMarkup("Sin listas de materiales", "Define los componentes requeridos.")) + '</div></article>' +
    '<article class="panel"><div class="panel-head"><div><h3>Cómo se fabrica</h3><p>Pasos, equipos y tiempos necesarios para producir.</p></div><span>' + control.routes.length + ' PROCESO(S)</span></div><div class="compact-list">' +
    (control.routes.length ? control.routes.slice(0, 8).map((row) => '<div class="production-compact-row"><div><strong>' + escapeHtml(row.folio) + ' · ' + escapeHtml(row.sku) + '</strong><small>' + escapeHtml(row.product_name) + ' · ' + row.operation_count + ' operación(es) · ' + inventoryNumber(row.standard_minutes) + ' min</small></div>' + productionStatusBadge(row.status) + '</div>').join("") : emptyMarkup("Sin rutas", "Define operaciones y recursos de fabricación.")) + '</div></article></section>' +
    '<section class="panel"><div class="panel-head"><div><h3>Qué producir</h3><p>Necesidades, existencia disponible y fecha requerida.</p></div><span>' + control.demands.length + ' PLAN(ES)</span></div><div class="table-wrap embedded"><table><thead><tr><th>Folio</th><th>Producto</th><th>Requerido</th><th>Existencia</th><th>Suministro</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.demands.length ? control.demands.map((row) => '<tr><td><strong>' + escapeHtml(row.folio) + '</strong><small>' + escapeHtml(row.source) + '</small></td><td><strong>' + escapeHtml(row.sku) + '</strong><small>' + escapeHtml(row.item_name) + '</small></td><td>' + inventoryNumber(row.quantity) + '</td><td>' + inventoryNumber(row.available_quantity) + '</td><td>' + inventoryNumber(row.planned_supply) + '</td><td>' + formatDateOnly(row.required_date) + '</td><td>' + productionStatusBadge(row.status) + '</td><td>' + (hasPermission("production.manage") && row.status === "open" ? '<button class="link-button" data-order-from-demand="' + row.id + '" data-item-id="' + row.item_id + '">Crear orden</button>' : "") + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin demanda", "Registra pronósticos o requerimientos.") + '</td></tr>') + '</tbody></table></div></section>' +
    '<section class="panel production-events"><div class="panel-head"><div><h3>Actividad reciente</h3><p>Inicios, pausas, avances, uso de materiales y productos terminados.</p></div><span>TRAZABILIDAD</span></div><div class="compact-list">' +
    (control.events.length ? control.events.map((row) => '<div class="production-event-row"><span class="event-symbol">' + productionEventSymbol(row.event_type) + '</span><div><strong>' + escapeHtml(row.order_folio) + ' · ' + productionEventLabel(row.event_type) + '</strong><small>' + escapeHtml(row.operation_name || row.item_name) + (Number(row.quantity) ? ' · ' + inventoryNumber(row.quantity) + ' unidad(es)' : "") + ' · ' + formatDate(row.created_at) + '</small></div><span>' + escapeHtml(row.created_by_name || "Sistema") + '</span></div>').join("") : emptyMarkup("Sin ejecución registrada", "Las acciones de las órdenes aparecerán aquí.")) + '</div></section>';
  $("#production-filter-empty")?.classList.toggle("hidden", $$(".production-order-card:not([hidden])").length > 0);
  pageContent.onclick = (event) => {
    const filter = event.target.closest("[data-production-filter]");
    if (filter) {
      state.productionOrderFilter = filter.dataset.productionFilter;
      $$("[data-production-filter]").forEach((button) => button.classList.toggle("active", button === filter));
      let visible = 0;
      $$(".production-order-card").forEach((card) => { const show = state.productionOrderFilter === "all" || card.dataset.productionGroup === state.productionOrderFilter; card.hidden = !show; if (show) visible += 1; });
      $("#production-filter-empty")?.classList.toggle("hidden", visible > 0);
      return;
    }
    const create = event.target.closest("[data-production-new]"); if (create) return openProductionCreateModal(create.dataset.productionNew);
    const demand = event.target.closest("[data-order-from-demand]"); if (demand) return openProductionOrderModal(Number(demand.dataset.orderFromDemand), Number(demand.dataset.itemId));
    const detail = event.target.closest("[data-production-order]"); if (detail) return openProductionOrderDetail(Number(detail.dataset.productionOrder));
    const action = event.target.closest("[data-production-action]"); if (action) return handleProductionAction(Number(action.dataset.id), action.dataset.productionAction);
    const formAction = event.target.closest("[data-production-form-action]"); if (formAction) return openProductionActionModal(Number(formAction.dataset.id), formAction.dataset.productionFormAction);
  };
}

function productionOrderCard(row) {
  const planned = Number(row.planned_quantity), produced = Number(row.produced_quantity);
  const percent = planned ? Math.min(100, Math.round(produced / planned * 100)) : 0;
  const group = productionFilterGroup(row.status);
  const hidden = state.productionOrderFilter !== "all" && state.productionOrderFilter !== group ? " hidden" : "";
  const source = row.sales_order_folio ? "PEDIDO " + row.sales_order_folio : row.parent_folio ? "HIJA DE " + row.parent_folio : "ORDEN PRINCIPAL";
  const productKind = row.item_type === "finished" ? "Producto terminado" : productionItemTypeLabel(row.item_type);
  return '<article class="production-order-card status-' + escapeAttribute(row.status) + '" data-production-group="' + group + '"' + hidden + '><div class="production-order-summary"><div><span>' + escapeHtml(source) + '</span><strong>' + escapeHtml(row.folio) + '</strong><small>' + escapeHtml(row.sku) + ' · ' + escapeHtml(row.item_name) + '</small><em>' + escapeHtml(productKind) + (row.sales_customer_name ? ' · ' + escapeHtml(row.sales_customer_name) : '') + '</em></div><div><span>INICIO</span><strong>' + (row.scheduled_start ? formatDate(row.scheduled_start) : "Sin programar") + '</strong><small>' + escapeHtml(row.warehouse_name) + '</small></div><div class="production-progress"><div><span>AVANCE</span><strong>' + inventoryNumber(produced) + ' / ' + inventoryNumber(planned) + '</strong></div><div class="progress-track"><span style="width:' + percent + '%"></span></div><small>' + percent + '% · ' + row.completed_operations + '/' + row.operation_count + ' pasos</small></div><div><span>MATERIA PRIMA</span><strong>' + inventoryNumber(row.required_materials) + ' requerida</strong><small>' + inventoryNumber(row.consumed_materials) + ' consumida</small></div><div>' + productionStatusBadge(row.status) + '</div></div><div class="production-order-actions"><button class="link-button" data-production-order="' + row.id + '">Ver orden de trabajo</button>' + productionOrderButtons(row) + '</div></article>';
}

function productionOrderButtons(row) {
  if (row.status === "planned" && hasPermission("production.manage")) return '<button class="button primary small" data-production-action="release" data-id="' + row.id + '">Preparar</button>';
  if (row.status === "released" && hasPermission("production.execute")) return '<button class="button primary small" data-production-action="start" data-id="' + row.id + '">Iniciar</button><button class="button ghost small" data-production-form-action="consume" data-id="' + row.id + '">Usar material</button>';
  if (["in_progress", "paused"].includes(row.status) && hasPermission("production.execute")) return (row.status === "paused" ? '<button class="button primary small" data-production-action="resume" data-id="' + row.id + '">Reanudar</button>' : '<button class="button ghost small" data-production-action="pause" data-id="' + row.id + '">Pausar</button>') + '<button class="button primary small" data-production-form-action="report" data-id="' + row.id + '">Registrar avance</button><button class="button ghost small" data-production-form-action="consume" data-id="' + row.id + '">Usar material</button><button class="button ghost small" data-production-form-action="receipt" data-id="' + row.id + '">Guardar producto</button><button class="link-button" data-production-action="complete" data-id="' + row.id + '">Terminar</button>';
  if (row.status === "completed") return (hasPermission("production.execute") ? '<button class="button ghost small" data-production-form-action="receipt" data-id="' + row.id + '">Guardar producto</button><button class="button ghost small" data-production-form-action="byproduct" data-id="' + row.id + '">Subproducto</button>' : "") + (hasPermission("production.close") ? '<button class="button primary small" data-production-action="close" data-id="' + row.id + '">Cerrar orden</button>' : "");
  return "";
}

async function handleProductionAction(id, action) {
  if (["complete", "close"].includes(action) && !await confirmAction({ eyebrow: "ORDEN DE PRODUCCIÓN", title: action === "close" ? "Cerrar definitivamente la orden" : "Terminar la producción", message: action === "close" ? "La orden quedará cerrada y ya no admitirá movimientos operativos." : "Se marcará la ejecución como terminada para continuar con el cierre.", confirmLabel: action === "close" ? "Cerrar orden" : "Terminar producción", tone: action === "close" ? "danger" : "primary" })) return;
  try { const result = await api("/api/production/orders/" + id + "/action", { method: "POST", body: { action } }); state.productionOptions = null; toast(result.folio + " actualizada."); await navigate("production_control"); }
  catch (error) { toast(error.message, "error"); }
}

function openProductionCreateModal(type) {
  if (type === "bom") return openProductionBomModal();
  if (type === "route") return openProductionRouteModal();
  if (type === "demand") return openProductionDemandModal();
  return openProductionOrderModal();
}

function productionProductOptions(selected) { return '<option value="">Selecciona un producto</option>' + state.productionOptions.products.map((row) => '<option value="' + row.id + '" ' + (row.id === selected ? "selected" : "") + '>' + escapeHtml(row.sku) + ' · ' + escapeHtml(row.name) + '</option>').join(""); }
function productionAllItemOptions(selected) { return '<option value="">Selecciona un artículo</option>' + state.productionOptions.items.map((row) => '<option value="' + row.id + '" ' + (row.id === selected ? "selected" : "") + '>' + escapeHtml(row.sku) + ' · ' + escapeHtml(row.name) + '</option>').join(""); }
function productionWarehouseOptions(selected) { return '<option value="">Selecciona un almacén</option>' + state.productionOptions.warehouses.map((row) => '<option value="' + row.id + '" ' + (row.id === selected ? "selected" : "") + '>' + escapeHtml(row.code) + ' · ' + escapeHtml(row.name) + '</option>').join(""); }

function openProductionBomModal() {
  const lines = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="production-bom-form"><div class="modal-head"><div><span class="eyebrow">INGENIERÍA DE PRODUCTO</span><h2>Nueva lista de materiales</h2><p class="muted">Versiones, sustitutos y productos fantasma.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("BOM-000000", true) + '<div class="form-grid"><label>Producto<select name="productId" required>' + productionProductOptions() + '</select></label><label>Versión<input name="version" value="1.0" required /></label><label>Cantidad de salida<input name="outputQuantity" type="number" min="0.000001" step="0.000001" value="1" required /></label><label>Estado<select name="status"><option value="draft">Borrador</option><option value="active">Activa</option></select></label><label>Vigente desde<input name="effectiveFrom" type="date" /></label><label>Vigente hasta<input name="effectiveTo" type="date" /></label><label class="check-option"><input name="isPhantom" type="checkbox" /><span><strong>Producto fantasma</strong><small>Se explota dentro de la orden padre.</small></span></label></div><section class="line-builder"><div class="panel-head"><h3>Materiales</h3><span>CANTIDAD, MERMA Y SUSTITUTO</span></div><div class="production-line-fields"><label>Material<select id="bom-component">' + productionAllItemOptions() + '</select></label><label>Cantidad<input id="bom-quantity" type="number" min="0.000001" step="0.000001" value="1" /></label><label>Merma %<input id="bom-scrap" type="number" min="0" max="100" value="0" /></label><label>Sustituto<select id="bom-substitute">' + productionAllItemOptions() + '</select></label><button type="button" class="button ghost" id="add-bom-line">Agregar</button></div><div id="bom-lines"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar lista</button></div></form>';
  const render = () => { $("#bom-lines").innerHTML = lines.length ? '<div class="table-wrap embedded"><table><thead><tr><th>Material</th><th>Cantidad</th><th>Merma</th><th>Sustituto</th><th></th></tr></thead><tbody>' + lines.map((row, i) => '<tr><td><strong>' + escapeHtml(row.sku) + '</strong><small>' + escapeHtml(row.name) + '</small></td><td>' + inventoryNumber(row.quantity) + '</td><td>' + row.scrapRate + '%</td><td>' + escapeHtml(row.substituteName || "—") + '</td><td><button type="button" class="link-button danger-link" data-remove-bom="' + i + '">Quitar</button></td></tr>').join("") + '</tbody></table></div>' : emptyMarkup("Sin materiales", "Agrega los componentes requeridos."); };
  render();
  $("#add-bom-line").onclick = () => { const item = state.productionOptions.items.find((r) => r.id === Number($("#bom-component").value)); if (!item) return toast("Selecciona un material.", "error"); if (lines.some((r) => r.componentItemId === item.id)) return toast("El material ya está agregado.", "error"); const substitute = state.productionOptions.items.find((r) => r.id === Number($("#bom-substitute").value)); lines.push({ componentItemId: item.id, sku: item.sku, name: item.name, quantity: Number($("#bom-quantity").value), scrapRate: Number($("#bom-scrap").value), substituteItemId: substitute?.id || null, substituteName: substitute ? substitute.sku + " · " + substitute.name : "" }); render(); };
  $("#bom-lines").onclick = (event) => { const button = event.target.closest("[data-remove-bom]"); if (button) { lines.splice(Number(button.dataset.removeBom), 1); render(); } };
  bindModuleForm("#production-bom-form", "/api/production/boms", () => ({ lines }), "Lista de materiales");
  entityDialog.showModal();
}

function openProductionRouteModal() {
  const operations = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="production-route-form"><div class="modal-head"><div><span class="eyebrow">RUTA DE PRODUCCIÓN</span><h2>Nueva ruta</h2><p class="muted">Secuencias, recursos y tiempos estándar.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("RUT-000000", true) + '<div class="form-grid"><label>Producto<select name="productId" required>' + productionProductOptions() + '</select></label><label>Versión<input name="version" value="1.0" required /></label><label>Estado<select name="status"><option value="draft">Borrador</option><option value="active">Activa</option></select></label></div><section class="line-builder"><div class="panel-head"><h3>Operaciones</h3><span>SECUENCIA, RECURSO Y TIEMPO</span></div><div class="production-operation-fields"><label>Operación<input id="route-operation-name" /></label><label>Recurso<select id="route-resource"><option value="">Sin recurso</option>' + state.productionOptions.resources.map((row) => '<option value="' + row.id + '">' + escapeHtml(row.code) + ' · ' + escapeHtml(row.name) + '</option>').join("") + '</select></label><label>Preparación (min)<input id="route-setup" type="number" min="0" value="0" /></label><label>Min/unidad<input id="route-run" type="number" min="0" value="0" /></label><button type="button" class="button ghost" id="add-route-operation">Agregar</button></div><div id="route-operations"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar ruta</button></div></form>';
  const render = () => { $("#route-operations").innerHTML = operations.length ? '<div class="table-wrap embedded"><table><thead><tr><th>Sec.</th><th>Operación</th><th>Recurso</th><th>Preparación</th><th>Estándar</th><th></th></tr></thead><tbody>' + operations.map((row, i) => '<tr><td>' + row.sequence + '</td><td><strong>' + escapeHtml(row.name) + '</strong></td><td>' + escapeHtml(row.resourceName || "Sin recurso") + '</td><td>' + inventoryNumber(row.setupMinutes) + ' min</td><td>' + inventoryNumber(row.runMinutes) + ' min/u</td><td><button type="button" class="link-button danger-link" data-remove-operation="' + i + '">Quitar</button></td></tr>').join("") + '</tbody></table></div>' : emptyMarkup("Sin operaciones", "Agrega la secuencia de fabricación."); };
  render();
  $("#add-route-operation").onclick = () => { const name = $("#route-operation-name").value.trim(); if (!name) return toast("Captura el nombre de la operación.", "error"); const resource = state.productionOptions.resources.find((r) => r.id === Number($("#route-resource").value)); operations.push({ sequence: (operations.length + 1) * 10, name, resourceId: resource?.id || null, resourceName: resource ? resource.code + " · " + resource.name : "", setupMinutes: Number($("#route-setup").value), runMinutes: Number($("#route-run").value) }); render(); $("#route-operation-name").value = ""; };
  $("#route-operations").onclick = (event) => { const button = event.target.closest("[data-remove-operation]"); if (button) { operations.splice(Number(button.dataset.removeOperation), 1); operations.forEach((r, i) => r.sequence = (i + 1) * 10); render(); } };
  bindModuleForm("#production-route-form", "/api/production/routes", () => ({ operations }), "Ruta de producción");
  entityDialog.showModal();
}

function openProductionDemandModal() {
  $("#entity-modal-content").innerHTML = '<form id="production-demand-form"><div class="modal-head"><div><span class="eyebrow">PLANEACIÓN</span><h2>Nueva demanda</h2><p class="muted">Requerimiento para revisar materiales y capacidad.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("DEM-000000", true) + '<div class="form-grid"><label>Producto<select name="itemId" required>' + productionProductOptions() + '</select></label><label>Cantidad<input name="quantity" type="number" min="0.000001" step="0.000001" required /></label><label>Fecha requerida<input name="requiredDate" type="date" required /></label><label>Origen<input name="source" value="Pronóstico" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar demanda</button></div></form>';
  bindModuleForm("#production-demand-form", "/api/production/demands", null, "Demanda");
  entityDialog.showModal();
}

function openProductionOrderModal(demandId = null, itemId = null) {
  $("#entity-modal-content").innerHTML = '<form id="production-order-form"><div class="modal-head"><div><span class="eyebrow">ORDEN DE PRODUCCIÓN</span><h2>Nueva orden</h2><p class="muted">Copia materiales y operaciones desde ingeniería.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("OP-000000", true) + '<div class="form-grid"><label>Producto<select name="itemId" id="production-order-item" required>' + productionProductOptions(itemId) + '</select></label><label>Demanda origen<select name="demandId"><option value="">Sin demanda</option>' + state.productionOptions.demands.filter((r) => ["open", "planned"].includes(r.status)).map((r) => '<option value="' + r.id + '" ' + (r.id === demandId ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.sku) + '</option>').join("") + '</select></label><label>Orden padre<select name="parentOrderId"><option value="">Orden principal</option>' + state.productionOptions.orders.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio) + '</option>').join("") + '</select></label><label>Cantidad planeada<input name="plannedQuantity" type="number" min="0.000001" step="0.000001" required /></label><label>Almacén<select name="warehouseId" required>' + productionWarehouseOptions() + '</select></label><label>Lista de materiales<select name="bomId" id="production-order-bom"></select></label><label>Ruta<select name="routeId" id="production-order-route"></select></label><label>Inicio programado<input name="scheduledStart" type="datetime-local" /></label><label>Fin programado<input name="scheduledEnd" type="datetime-local" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear orden</button></div></form>';
  const refresh = () => { const id = Number($("#production-order-item").value); const boms = state.productionOptions.boms.filter((r) => r.product_id === id); const routes = state.productionOptions.routes.filter((r) => r.product_id === id); $("#production-order-bom").innerHTML = '<option value="">Lista activa automática</option>' + boms.map((r) => '<option value="' + r.id + '" ' + (r.status === "active" ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · v' + escapeHtml(r.version) + '</option>').join(""); $("#production-order-route").innerHTML = '<option value="">Ruta activa automática</option>' + routes.map((r) => '<option value="' + r.id + '" ' + (r.status === "active" ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · v' + escapeHtml(r.version) + '</option>').join(""); };
  $("#production-order-item").onchange = refresh; refresh();
  bindModuleForm("#production-order-form", "/api/production/orders", null, "Orden de producción");
  entityDialog.showModal();
}

function bindModuleForm(selector, endpoint, extra, label) {
  $(selector).onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget; const box = $(".form-error", form); const body = Object.fromEntries(new FormData(form)); $$('input[type="checkbox"]', form).forEach((input) => body[input.name] = input.checked); Object.assign(body, extra?.() || {}); try { const result = await api(endpoint, { method: "POST", body }); entityDialog.close(); state.productionOptions = null; state.qualityOptions = null; state.maintenanceOptions = null; state.logisticsOptions = null; state.financeOptions = null; state.tasksOptions = null; state.purchasesOptions = null; state.safetyOptions = null; state.hrOptions = null; toast(label + " " + result.folio + " guardada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } };
}

async function openProductionOrderDetail(id) {
  try {
    const d = await api("/api/production/orders/" + id), order = d.order;
    $("#entity-modal-content").classList.add("wide");
    const origin = order.sales_order_folio ? `Pedido ${order.sales_order_folio} · ${order.sales_customer_name || "Cliente"}` : order.parent_folio ? `Orden hija de ${order.parent_folio}` : "Orden de producción interna";
    const sourcePanel = order.sales_order_folio ? '<section class="production-sales-origin"><div><span>ORIGEN COMERCIAL</span><strong>' + escapeHtml(order.sales_order_folio) + '</strong><small>' + escapeHtml(order.sales_customer_name || "Cliente sin nombre") + '</small></div><div><span>PRODUCTO</span><strong>Producto terminado</strong><small>' + escapeHtml(order.sku + " · " + order.item_name) + '</small></div><div><span>INGENIERÍA</span><strong>' + escapeHtml(order.bom_folio) + ' · ' + escapeHtml(order.route_folio) + '</strong><small>Lista de materiales y ruta congeladas en esta OT</small></div></section>' : "";
    $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">ORDEN DE TRABAJO · ' + escapeHtml(order.folio) + '</span><h2>' + escapeHtml(order.sku) + ' · ' + escapeHtml(order.item_name) + '</h2><p class="muted">' + escapeHtml(origin) + ' · ' + escapeHtml(order.warehouse_name) + '</p></div><button type="button" data-close-modal>×</button></div>' + sourcePanel +
      '<section class="production-detail-metrics"><div><span>Planeado</span><strong>' + inventoryNumber(order.planned_quantity) + ' ' + escapeHtml(order.unit_symbol || "") + '</strong></div><div><span>Producido</span><strong>' + inventoryNumber(order.produced_quantity) + '</strong></div><div><span>Lista / ruta</span><strong>' + escapeHtml(order.bom_folio + " · " + order.route_folio) + '</strong></div><div><span>Estado</span>' + productionStatusBadge(order.status) + '</div></section>' +
      '<div class="detail-section"><div class="panel-head"><div><h3>Materia prima requerida</h3><p>Explosión de la lista de materiales para la cantidad vendida.</p></div><span>' + d.materials.length + ' MATERIAL(ES)</span></div><div class="table-wrap embedded"><table><thead><tr><th>Materia prima / material</th><th>Tipo</th><th>Requerido</th><th>Consumido</th><th>Disponible</th><th>Sustituto</th></tr></thead><tbody>' + d.materials.map((r) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.item_name) + '</small></td><td><span class="chip">' + escapeHtml(productionItemTypeLabel(r.item_type)) + '</span></td><td><strong>' + inventoryNumber(r.required_quantity) + ' ' + escapeHtml(r.unit_symbol || "") + '</strong></td><td>' + inventoryNumber(r.consumed_quantity) + '</td><td>' + inventoryNumber(r.available_quantity) + '</td><td>' + escapeHtml(r.substitute_sku ? r.substitute_sku + " · " + r.substitute_name : "—") + '</td></tr>').join("") + '</tbody></table></div></div>' +
      '<div class="detail-section"><div class="panel-head"><div><h3>Ruta de trabajo</h3><p>Secuencia, centro de trabajo, instrucciones y tiempo estándar.</p></div><span>' + escapeHtml(order.route_folio) + '</span></div><div class="production-operation-list work-route">' + d.operations.map((r) => '<div><span>' + r.sequence + '</span><div><strong>' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.resource_name || "Sin recurso") + ' · Estándar ' + inventoryNumber(r.standard_minutes) + ' min · Real ' + inventoryNumber(r.actual_minutes) + ' min</small>' + (r.instructions ? '<p>' + escapeHtml(r.instructions) + '</p>' : "") + '</div>' + productionStatusBadge(r.status) + '</div>').join("") + '</div></div>' +
      '<div class="detail-section"><div class="panel-head"><h3>Bitácora de ejecución</h3><span>' + d.events.length + ' EVENTO(S)</span></div><div class="compact-list">' + (d.events.length ? d.events.slice(0, 12).map((r) => '<div class="production-event-row"><span class="event-symbol">' + productionEventSymbol(r.event_type) + '</span><div><strong>' + productionEventLabel(r.event_type) + '</strong><small>' + escapeHtml(r.operation_name || r.notes || "Orden de trabajo") + ' · ' + formatDate(r.created_at) + '</small></div></div>').join("") : emptyMarkup("Sin eventos", "La ejecución aún no inicia.")) + '</div></div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

async function openProductionActionModal(id, action) {
  try {
    const d = await api("/api/production/orders/" + id), o = d.order;
    const titles = { report: "Registrar avance", consume: "Consumir material", receipt: "Entrada de producto terminado", byproduct: "Registrar subproducto" };
    let fields = "";
    if (action === "report") fields = '<div class="form-grid"><label>Operación<select name="operationId"><option value="">Avance general</option>' + d.operations.filter((r) => r.status !== "completed").map((r) => '<option value="' + r.id + '">' + r.sequence + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Cantidad producida<input name="producedQuantity" type="number" min="0" value="0" /></label><label>Rechazos<input name="rejectedQuantity" type="number" min="0" value="0" /></label><label>Desperdicio<input name="wasteQuantity" type="number" min="0" value="0" /></label><label>Tiempo real (min)<input name="actualMinutes" type="number" min="0" value="0" /></label><label class="check-option"><input name="completeOperation" type="checkbox" /><span><strong>Terminar operación</strong><small>Continuará con la siguiente secuencia.</small></span></label></div>';
    if (action === "consume") fields = '<div class="form-grid"><label>Material<select name="materialId" required>' + d.materials.filter((r) => Number(r.consumed_quantity) < Number(r.required_quantity)).map((r) => '<option value="' + r.id + '">' + escapeHtml(r.sku) + ' · Pendiente ' + inventoryNumber(Number(r.required_quantity) - Number(r.consumed_quantity)) + '</option>').join("") + '</select></label><label>Cantidad<input name="quantity" type="number" min="0.000001" required /></label><label>Almacén<select name="warehouseId" required>' + productionWarehouseOptions(o.warehouse_id) + '</select></label><label>Ubicación<select name="locationId"><option value="">Sin ubicación</option>' + state.productionOptions.locations.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Lote<select name="lotId"><option value="">Sin lote</option>' + state.productionOptions.lots.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.lot_number) + '</option>').join("") + '</select></label><label class="check-option"><input name="useSubstitute" type="checkbox" /><span><strong>Usar sustituto</strong><small>Solo si ingeniería lo definió.</small></span></label></div>';
    if (action === "receipt") fields = '<div class="form-grid"><label>Cantidad terminada<input name="quantity" type="number" min="0.000001" required /></label><label>Almacén<select name="warehouseId" required>' + productionWarehouseOptions(o.warehouse_id) + '</select></label><label>Ubicación<select name="locationId"><option value="">Sin ubicación</option>' + state.productionOptions.locations.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Lote<select name="lotId"><option value="">Sin lote</option>' + state.productionOptions.lots.filter((r) => r.item_id === o.item_id).map((r) => '<option value="' + r.id + '">' + escapeHtml(r.lot_number) + '</option>').join("") + '</select></label></div>';
    if (action === "byproduct") fields = '<div class="form-grid"><label>Subproducto<select name="itemId" required>' + productionAllItemOptions() + '</select></label><label>Cantidad<input name="quantity" type="number" min="0.000001" required /></label><label>Almacén<select name="warehouseId" required>' + productionWarehouseOptions(o.warehouse_id) + '</select></label><label>Ubicación<select name="locationId"><option value="">Sin ubicación</option>' + state.productionOptions.locations.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label></div>';
    $("#entity-modal-content").innerHTML = '<form id="production-action-form"><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(o.folio) + '</span><h2>' + titles[action] + '</h2><p class="muted">' + escapeHtml(o.sku) + ' · ' + escapeHtml(o.item_name) + '</p></div><button type="button" data-close-modal>×</button></div>' + fields + '<label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button type="submit" class="button primary">Aplicar</button></div></form>';
    $("#production-action-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form)), box = $(".form-error", form); $$('input[type="checkbox"]', form).forEach((input) => body[input.name] = input.checked); body.action = action; try { await api("/api/production/orders/" + id + "/action", { method: "POST", body }); entityDialog.close(); state.productionOptions = null; toast("Movimiento de producción registrado."); await navigate("production_control"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } };
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function productionStatusLabel(status) { return ({ draft: "Borrador", active: "Activa", obsolete: "Obsoleta", open: "Abierta", planned: "Planeada", covered: "Cubierta", released: "Liberada", in_progress: "En proceso", paused: "Pausada", completed: "Terminada", closed: "Cerrada", cancelled: "Cancelada", pending: "Pendiente", skipped: "Omitida" })[status] || status; }
function productionStatusBadge(status) { const kind = ["draft", "planned", "paused", "pending"].includes(status) ? "warn" : ["cancelled", "obsolete"].includes(status) ? "danger" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(productionStatusLabel(status)) + '</span>'; }
function productionItemTypeLabel(type) { return ({ finished: "Producto terminado", raw_material: "Materia prima", consumable: "Consumible", tool: "Herramienta", service: "Servicio", asset: "Activo" })[type] || "Artículo"; }
function productionEventLabel(type) { return ({ sales_order_created: "OT generada desde pedido", sales_order_cancelled: "OT cancelada con pedido", start: "Inicio de operación", paused: "Pausa", in_progress: "Reanudación", progress: "Avance registrado", material_consumption: "Consumo de materiales", finished_receipt: "Entrada de producto terminado", byproduct: "Subproducto ingresado", complete: "Producción terminada", close: "Orden cerrada", released: "Orden liberada" })[type] || type; }
function productionEventSymbol(type) { return ({ start: "▶", progress: "+", material_consumption: "−", finished_receipt: "✓", byproduct: "◇", complete: "■", close: "●", paused: "Ⅱ" })[type] || "·"; }

function qualityHubHeader(control, pending, rejected) {
  return '<section class="trade-hub-topbar"><div><span class="eyebrow">REVISIÓN Y LIBERACIÓN EN UN SOLO LUGAR</span><h2>Mi calidad</h2><p>Revisa productos, registra problemas y libera únicamente lo que cumple.</p></div></section>' +
    '<section class="trade-command quality"><div class="trade-command-copy"><span class="trade-live"><i></i> CONTROL DE CALIDAD</span><h3>Revisa y decide</h3><p>Cada inspección conserva su producto, resultado, problema detectado y corrección.</p><div class="trade-command-stats"><span><strong>' + pending.length + '</strong><small>por revisar</small></span><span><strong>' + rejected.length + '</strong><small>rechazadas</small></span></div><div class="trade-command-actions">' +
    (hasPermission("quality.manage") ? '<button class="button ghost light-button" data-quality-new="plan">＋ Plan</button><button class="button ghost light-button" data-quality-new="action">＋ Corrección</button>' : "") +
    (hasPermission("quality.inspect") ? '<button class="button ghost light-button" data-quality-new="nc">＋ Problema</button><button class="button trade-primary" data-quality-new="inspection">＋ Revisar</button>' : "") +
    '</div></div>' + tradeScene("quality", [{ symbol: "▤", label: "Plan", detail: "Qué revisar" }, { symbol: "⌕", label: "Inspección", detail: "Medir" }, { symbol: "✓", label: "Liberación", detail: "Decidir" }], "Calidad conectada con producción e inventario") + '</section>';
}

async function renderQuality() {
  const token = beginPageRender();
  const [control, options] = await Promise.all([api("/api/quality/control"), api("/api/quality/options")]);
  if (!renderIsCurrent(token)) return;
  state.qualityOptions = options;
  const pending = control.inspections.filter((r) => ["pending", "in_progress"].includes(r.status));
  const rejected = control.inspections.filter((r) => r.status === "rejected");
  const openNc = control.nonconformities.filter((r) => !["closed", "cancelled"].includes(r.status));
  const overdue = control.actions.filter((r) => r.due_date && r.due_date < todayInput() && !["closed", "cancelled"].includes(r.status));
  pageContent.innerHTML =
    qualityHubHeader(control, pending, rejected) +
    '<section class="metrics">' + metricCard("Por inspeccionar", pending.length, "Pendientes o en proceso", "⌕", true) + metricCard("Rechazadas", rejected.length, "Requieren disposición", "!") + metricCard("No conformidades", openNc.length, "Casos abiertos", "◇") + metricCard("Acciones vencidas", overdue.length, "Seguimiento requerido", "⌛") + '</section>' +
    '<section class="panel quality-inspections"><div class="panel-head"><div><h3>Revisiones de calidad</h3><p>Recepción, proceso, producto final y liberación.</p></div><span>' + control.inspections.length + ' REVISIÓN(ES)</span></div><div class="table-wrap embedded"><table><thead><tr><th>Folio</th><th>Tipo</th><th>Artículo</th><th>Origen</th><th>Muestra</th><th>Resultado</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.inspections.length ? control.inspections.map(qualityInspectionRow).join("") : '<tr><td colspan="8">' + emptyMarkup("Sin inspecciones", "Crea un plan y registra la primera inspección.") + '</td></tr>') + '</tbody></table></div></section>' +
    '<section class="quality-grid"><article class="panel"><div class="panel-head"><div><h3>Qué revisar</h3><p>Características, límites y tamaño de muestra.</p></div><span>' + control.plans.length + ' PLAN(ES)</span></div><div class="compact-list">' +
    (control.plans.length ? control.plans.map((r) => '<div class="quality-compact-row"><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</strong><small>' + qualityTypeLabel(r.inspection_type) + ' · ' + escapeHtml(r.sku || "Todos los artículos") + ' · ' + r.check_count + ' característica(s)</small></div>' + (r.is_active ? '<span class="badge">● Activo</span>' : '<span class="badge warn">Inactivo</span>') + '</div>').join("") : emptyMarkup("Sin planes", "Define las verificaciones de calidad.")) + '</div></article>' +
    '<article class="panel"><div class="panel-head"><div><h3>Problemas detectados</h3><p>Severidad, decisión y causa del rechazo.</p></div><span>' + control.nonconformities.length + ' CASO(S)</span></div><div class="compact-list">' +
    (control.nonconformities.length ? control.nonconformities.map((r) => '<div class="quality-compact-row"><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.description) + ' · ' + qualitySeverityLabel(r.severity) + ' · ' + r.action_count + ' acción(es)</small></div>' + qualityStatusBadge(r.status) + (hasPermission("quality.manage") && !["closed", "cancelled"].includes(r.status) ? '<button class="link-button" data-quality-action-for="' + r.id + '">Acción</button>' : "") + '</div>').join("") : emptyMarkup("Sin no conformidades", "Los rechazos documentados aparecerán aquí.")) + '</div></article></section>' +
    '<section class="panel"><div class="panel-head"><div><h3>Correcciones</h3><p>Responsables, fechas compromiso y verificación.</p></div><span>' + control.actions.length + ' ACCIÓN(ES)</span></div><div class="table-wrap embedded"><table><thead><tr><th>Folio</th><th>Problema</th><th>Acción</th><th>Responsable</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.actions.length ? control.actions.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td>' + escapeHtml(r.nonconformity_folio) + '<small>' + escapeHtml(r.sku + " · " + r.item_name) + '</small></td><td>' + escapeHtml(r.action) + '</td><td>' + escapeHtml(r.owner_name || "Sin asignar") + '</td><td>' + (r.due_date ? formatDateOnly(r.due_date) : "—") + '</td><td>' + qualityStatusBadge(r.status) + '</td><td>' + (hasPermission("quality.manage") && !["closed", "cancelled"].includes(r.status) ? '<div class="table-actions"><button class="link-button" data-quality-action-status="in_progress" data-id="' + r.id + '">Iniciar</button><button class="link-button" data-quality-action-status="closed" data-id="' + r.id + '">Cerrar</button></div>' : "") + '</td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup("Sin acciones correctivas", "Crea una desde una no conformidad.") + '</td></tr>') + '</tbody></table></div></section>';
  pageContent.onclick = (event) => {
    const create = event.target.closest("[data-quality-new]"); if (create) return openQualityCreateModal(create.dataset.qualityNew);
    const inspect = event.target.closest("[data-quality-inspection]"); if (inspect) return openQualityInspectionDetail(Number(inspect.dataset.qualityInspection));
    const start = event.target.closest("[data-quality-start]"); if (start) return qualityInspectionAction(Number(start.dataset.qualityStart), "start");
    const release = event.target.closest("[data-quality-release]"); if (release) return qualityInspectionAction(Number(release.dataset.qualityRelease), "release");
    const nc = event.target.closest("[data-quality-nc]"); if (nc) return openQualityNonconformityModal(Number(nc.dataset.qualityNc));
    const actionFor = event.target.closest("[data-quality-action-for]"); if (actionFor) return openQualityCorrectiveModal(Number(actionFor.dataset.qualityActionFor));
    const status = event.target.closest("[data-quality-action-status]"); if (status) return updateQualityAction(Number(status.dataset.id), status.dataset.qualityActionStatus);
  };
}

function qualityInspectionRow(row) {
  const actions = '<button class="link-button" data-quality-inspection="' + row.id + '">' + (["pending", "in_progress"].includes(row.status) ? "Capturar" : "Ver") + '</button>' +
    (row.status === "pending" && hasPermission("quality.inspect") ? '<button class="link-button" data-quality-start="' + row.id + '">Iniciar</button>' : "") +
    (row.status === "approved" && hasPermission("quality.release") ? '<button class="link-button" data-quality-release="' + row.id + '">Liberar</button>' : "") +
    (row.status === "rejected" && hasPermission("quality.inspect") ? '<button class="link-button danger-link" data-quality-nc="' + row.id + '">No conformidad</button>' : "");
  return '<tr><td><strong>' + escapeHtml(row.folio) + '</strong><small>' + formatDate(row.created_at) + '</small></td><td>' + qualityTypeLabel(row.inspection_type) + '</td><td><strong>' + escapeHtml(row.sku) + '</strong><small>' + escapeHtml(row.item_name) + '</small></td><td>' + escapeHtml(row.order_folio || row.warehouse_name || "Registro directo") + '</td><td>' + inventoryNumber(row.quantity_inspected) + '</td><td>' + row.failed_count + '/' + row.result_count + ' fuera de especificación</td><td>' + qualityStatusBadge(row.status) + '</td><td><div class="table-actions">' + actions + '</div></td></tr>';
}

function openQualityCreateModal(type) {
  if (type === "plan") return openQualityPlanModal();
  if (type === "inspection") return openQualityInspectionModal();
  if (type === "nc") return openQualityNonconformityModal();
  return openQualityCorrectiveModal();
}

function qualityItemOptions(selected) { return '<option value="">Selecciona un artículo</option>' + state.qualityOptions.items.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.sku) + ' · ' + escapeHtml(r.name) + '</option>').join(""); }

function openQualityPlanModal() {
  const checks = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="quality-plan-form"><div class="modal-head"><div><span class="eyebrow">PLAN DE INSPECCIÓN</span><h2>Nuevo plan</h2><p class="muted">Define muestra, características y criterios de aceptación.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("PLC-000000", true) + '<div class="form-grid"><label>Nombre<input name="name" required /></label><label>Tipo<select name="inspectionType" required><option value="receipt">Recepción</option><option value="process">Proceso</option><option value="final">Final</option></select></label><label>Artículo específico<select name="itemId"><option value="">Aplicar a cualquiera</option>' + state.qualityOptions.items.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.sku) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Tamaño de muestra<input name="sampleSize" type="number" min="0.000001" value="1" required /></label><label>Máximo de fallas<input name="acceptanceLimit" type="number" min="0" value="0" required /></label></div><section class="line-builder"><div class="panel-head"><h3>Características</h3><span>LÍMITES Y TIPO DE CONTROL</span></div><div class="quality-check-fields"><label>Característica<input id="quality-check-name" /></label><label>Tipo<select id="quality-check-type"><option value="numeric">Numérico</option><option value="visual">Visual</option><option value="boolean">Sí / no</option><option value="text">Texto</option></select></label><label>Mínimo<input id="quality-check-min" type="number" step="0.000001" /></label><label>Máximo<input id="quality-check-max" type="number" step="0.000001" /></label><label>Unidad<input id="quality-check-unit" /></label><button class="button ghost" type="button" id="add-quality-check">Agregar</button></div><div id="quality-checks"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar plan</button></div></form>';
  const render = () => { $("#quality-checks").innerHTML = checks.length ? '<div class="table-wrap embedded"><table><thead><tr><th>Característica</th><th>Tipo</th><th>Especificación</th><th></th></tr></thead><tbody>' + checks.map((r, i) => '<tr><td><strong>' + escapeHtml(r.characteristic) + '</strong></td><td>' + qualityCheckTypeLabel(r.checkType) + '</td><td>' + escapeHtml(r.minValue || r.maxValue ? (r.minValue || "—") + " a " + (r.maxValue || "—") + " " + r.unit : "Conforme / no conforme") + '</td><td><button class="link-button danger-link" type="button" data-remove-quality-check="' + i + '">Quitar</button></td></tr>').join("") + '</tbody></table></div>' : emptyMarkup("Sin características", "Agrega al menos una verificación."); };
  render();
  $("#add-quality-check").onclick = () => { const characteristic = $("#quality-check-name").value.trim(); if (!characteristic) return toast("Captura la característica.", "error"); checks.push({ characteristic, checkType: $("#quality-check-type").value, minValue: $("#quality-check-min").value, maxValue: $("#quality-check-max").value, unit: $("#quality-check-unit").value, isRequired: true }); render(); $("#quality-check-name").value = ""; };
  $("#quality-checks").onclick = (event) => { const button = event.target.closest("[data-remove-quality-check]"); if (button) { checks.splice(Number(button.dataset.removeQualityCheck), 1); render(); } };
  bindModuleForm("#quality-plan-form", "/api/quality/plans", () => ({ checks }), "Plan de inspección");
  entityDialog.showModal();
}

function openQualityInspectionModal() {
  $("#entity-modal-content").innerHTML = '<form id="quality-inspection-form"><div class="modal-head"><div><span class="eyebrow">NUEVA INSPECCIÓN</span><h2>Registrar inspección</h2><p class="muted">Recepción, proceso o producto final.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("INS-000000", true) + '<div class="form-grid"><label>Plan<select name="planId" id="quality-inspection-plan" required><option value="">Selecciona un plan</option>' + state.qualityOptions.plans.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Artículo<select name="itemId" id="quality-inspection-item" required>' + qualityItemOptions() + '</select></label><label>Orden de producción<select name="productionOrderId"><option value="">Sin orden</option>' + state.qualityOptions.orders.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.sku) + '</option>').join("") + '</select></label><label>Cantidad inspeccionada<input name="quantityInspected" id="quality-inspection-quantity" type="number" min="0.000001" value="1" required /></label><label>Almacén<select name="warehouseId"><option value="">Sin almacén</option>' + state.qualityOptions.warehouses.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Lote<select name="lotId"><option value="">Sin lote</option>' + state.qualityOptions.lots.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.lot_number) + '</option>').join("") + '</select></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear inspección</button></div></form>';
  $("#quality-inspection-plan").onchange = () => { const plan = state.qualityOptions.plans.find((r) => r.id === Number($("#quality-inspection-plan").value)); if (plan?.item_id) $("#quality-inspection-item").value = plan.item_id; };
  bindModuleForm("#quality-inspection-form", "/api/quality/inspections", null, "Inspección");
  entityDialog.showModal();
}

async function openQualityInspectionDetail(id) {
  try {
    const d = await api("/api/quality/inspections/" + id), q = d.inspection, editable = ["pending", "in_progress"].includes(q.status) && hasPermission("quality.inspect");
    $("#entity-modal-content").classList.add("wide");
    $("#entity-modal-content").innerHTML = '<form id="quality-results-form"><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(q.folio) + '</span><h2>' + escapeHtml(q.sku) + ' · ' + escapeHtml(q.item_name) + '</h2><p class="muted">' + qualityTypeLabel(q.inspection_type) + ' · ' + escapeHtml(q.plan_name || "Sin plan") + '</p></div><button type="button" data-close-modal>×</button></div><section class="quality-result-summary"><div><span>Muestra</span><strong>' + inventoryNumber(q.quantity_inspected) + '</strong></div><div><span>Aceptado</span><strong>' + inventoryNumber(q.quantity_accepted) + '</strong></div><div><span>Rechazado</span><strong>' + inventoryNumber(q.quantity_rejected) + '</strong></div><div><span>Estado</span>' + qualityStatusBadge(q.status) + '</div></section><div class="quality-result-list">' + d.results.map((r) => '<article data-quality-result="' + r.id + '"><div><strong>' + escapeHtml(r.characteristic) + '</strong><small>' + qualitySpecification(r) + '</small></div>' + (editable ? qualityResultInput(r) : '<strong>' + escapeHtml(r.measured_value || "Sin captura") + '</strong>') + (editable && ["visual", "boolean", "text"].includes(r.check_type) ? '<label>Conformidad<select data-result-conforming><option value="true" ' + (r.is_conforming === 1 ? "selected" : "") + '>Conforme</option><option value="false" ' + (r.is_conforming === 0 ? "selected" : "") + '>No conforme</option></select></label>' : r.is_conforming == null ? "" : (r.is_conforming ? '<span class="badge">● Conforme</span>' : '<span class="badge danger">● No conforme</span>')) + '</article>').join("") + '</div>' + (editable ? '<div class="form-grid"><label>Cantidad rechazada<input name="quantityRejected" type="number" min="0" max="' + q.quantity_inspected + '" value="' + q.quantity_rejected + '" /></label></div><label>Observaciones<textarea name="notes" rows="3">' + escapeHtml(q.notes || "") + '</textarea></label><p class="form-error hidden"></p>' : "") + '<div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cerrar</button>' + (editable ? '<button class="button primary" type="submit">Evaluar inspección</button>' : "") + '</div></form>';
    if (editable) $("#quality-results-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form); const results = $$("[data-quality-result]", form).map((row) => ({ id: Number(row.dataset.qualityResult), measuredValue: $("[data-result-value]", row)?.value || "", isConforming: $("[data-result-conforming]", row)?.value === "true" })); try { const result = await api("/api/quality/inspections/" + id + "/results", { method: "POST", body: { results, quantityRejected: form.quantityRejected.value, notes: form.notes.value } }); entityDialog.close(); toast(result.status === "approved" ? "Inspección aprobada." : "Inspección rechazada."); await navigate("quality_control"); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } };
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function qualityResultInput(row) {
  if (row.check_type === "numeric") return '<label>Medición<input data-result-value type="number" step="0.000001" value="' + escapeAttribute(row.measured_value || "") + '" required /></label>';
  return '<label>Resultado<input data-result-value value="' + escapeAttribute(row.measured_value || "") + '" required /></label>';
}

async function qualityInspectionAction(id, action) {
  try { await api("/api/quality/inspections/" + id + "/action", { method: "POST", body: { action } }); toast(action === "release" ? "Producto liberado." : "Inspección iniciada."); await navigate("quality_control"); }
  catch (error) { toast(error.message, "error"); }
}

async function openQualityNonconformityModal(inspectionId = null) {
  let detail = null;
  if (inspectionId) try { detail = await api("/api/quality/inspections/" + inspectionId); } catch {}
  $("#entity-modal-content").innerHTML = '<form id="quality-nc-form"><div class="modal-head"><div><span class="eyebrow">PRODUCTO NO CONFORME</span><h2>Nueva no conformidad</h2><p class="muted">Documenta cantidad, severidad, disposición y causa.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("NC-000000", true) + '<input type="hidden" name="inspectionId" value="' + (inspectionId || "") + '" /><div class="form-grid"><label>Artículo<select name="itemId" required>' + qualityItemOptions(detail?.inspection.item_id) + '</select></label><label>Orden de producción<select name="productionOrderId"><option value="">Sin orden</option>' + state.qualityOptions.orders.map((r) => '<option value="' + r.id + '" ' + (r.id === detail?.inspection.production_order_id ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.sku) + '</option>').join("") + '</select></label><label>Cantidad<input name="quantity" type="number" min="0" value="' + (detail?.inspection.quantity_rejected || 0) + '" /></label><label>Severidad<select name="severity"><option value="minor">Menor</option><option value="major">Mayor</option><option value="critical">Crítica</option></select></label><label>Disposición<select name="disposition"><option value="pending">Pendiente</option><option value="rework">Retrabajo</option><option value="scrap">Desperdicio</option><option value="return">Devolución</option><option value="use_as_is">Usar como está</option></select></label></div><label>Descripción<textarea name="description" rows="3" required></textarea></label><label>Causa raíz inicial<textarea name="rootCause" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar caso</button></div></form>';
  bindModuleForm("#quality-nc-form", "/api/quality/nonconformities", null, "No conformidad");
  entityDialog.showModal();
}

function openQualityCorrectiveModal(nonconformityId = null) {
  $("#entity-modal-content").innerHTML = '<form id="quality-action-form"><div class="modal-head"><div><span class="eyebrow">ACCIÓN CORRECTIVA</span><h2>Nueva acción</h2><p class="muted">Asigna responsable, compromiso y seguimiento.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("AC-000000", true) + '<div class="form-grid"><label>No conformidad<select name="nonconformityId" required><option value="">Selecciona un caso</option>' + state.qualityOptions.nonconformities.map((r) => '<option value="' + r.id + '" ' + (r.id === nonconformityId ? "selected" : "") + '>' + escapeHtml(r.folio) + '</option>').join("") + '</select></label><label>Responsable<select name="ownerId"><option value="">Sin asignar</option>' + state.qualityOptions.users.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.full_name) + '</option>').join("") + '</select></label><label>Fecha compromiso<input name="dueDate" type="date" /></label></div><label>Acción correctiva<textarea name="action" rows="4" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar acción</button></div></form>';
  bindModuleForm("#quality-action-form", "/api/quality/corrective-actions", null, "Acción correctiva");
  entityDialog.showModal();
}

async function updateQualityAction(id, status) {
  const verification = status === "closed" ? await requestActionText({ eyebrow: "CONTROL DE CALIDAD", title: "Verificación de la acción", message: "Describe cómo comprobaste que la acción correctiva fue efectiva.", fieldLabel: "Evidencia de verificación", confirmLabel: "Cerrar acción" }) : "";
  if (status === "closed" && verification == null) return;
  try { await api("/api/quality/corrective-actions/" + id, { method: "PATCH", body: { status, verification } }); toast("Acción correctiva actualizada."); await navigate("quality_control"); }
  catch (error) { toast(error.message, "error"); }
}

function qualityTypeLabel(type) { return ({ receipt: "Recepción", process: "Proceso", final: "Final" })[type] || type; }
function qualitySeverityLabel(value) { return ({ minor: "Menor", major: "Mayor", critical: "Crítica" })[value] || value; }
function qualityCheckTypeLabel(value) { return ({ numeric: "Numérico", visual: "Visual", boolean: "Sí / no", text: "Texto" })[value] || value; }
function qualityStatusLabel(value) { return ({ pending: "Pendiente", in_progress: "En proceso", approved: "Aprobada", rejected: "Rechazada", released: "Liberada", cancelled: "Cancelada", open: "Abierta", analysis: "En análisis", contained: "Contenida", verified: "Verificada", closed: "Cerrada" })[value] || value; }
function qualityStatusBadge(value) { const kind = ["pending", "in_progress", "analysis"].includes(value) ? "warn" : ["rejected", "cancelled"].includes(value) ? "danger" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(qualityStatusLabel(value)) + '</span>'; }
function qualitySpecification(row) { if (row.check_type !== "numeric") return qualityCheckTypeLabel(row.check_type); return escapeHtml((row.min_value ?? "—") + " a " + (row.max_value ?? "—") + " " + (row.unit || "")); }

function maintenanceHubHeader(view, control) {
  const current = ({
    maintenance_control: ["Control integral", "Todo el taller en una sola pantalla"],
    maintenance_equipment: ["Equipos", "Estado y ficha de cada activo"],
    maintenance_plans: ["Prevención", "Trabajo programado antes de una falla"],
    maintenance_requests: ["Solicitudes", "Reportes que originan el mantenimiento"],
    maintenance_orders: ["Órdenes", "Trabajo técnico y responsables"],
    maintenance_parts: ["Refacciones", "Material planeado y utilizado"],
    maintenance_downtimes: ["Paros", "Tiempo detenido por equipo"],
    maintenance_history: ["Historial", "Todo lo ocurrido en cada equipo"],
  })[view] || ["Mantenimiento", "Equipos, fallas y trabajos"];
  const stopped = control.equipment.filter((row) => ["stopped", "maintenance"].includes(row.status)).length;
  const openRequests = control.requests.filter((row) => ["open", "approved"].includes(row.status)).length;
  const activeOrders = control.orders.filter((row) => ["approved", "in_progress", "paused"].includes(row.status)).length;
  return '<section class="trade-hub-topbar"><div><span class="eyebrow">EQUIPOS Y SOLICITUDES CONECTADOS</span><h2>Mi mantenimiento</h2><p>Cada solicitud conserva su equipo, orden, refacciones, paro e historial.</p></div></section>' +
    '<section class="trade-command maintenance"><div class="trade-command-copy"><span class="trade-live"><i></i> TALLER DE MANTENIMIENTO</span><h3>Disponibilidad de planta</h3><p>Detecta, diagnostica y atiende trabajos preventivos y correctivos sin perder la trazabilidad del equipo.</p><div class="trade-command-stats"><span><strong>' + stopped + '</strong><small>equipos fuera de servicio</small></span><span><strong>' + activeOrders + '</strong><small>órdenes trabajando</small></span></div><div class="maintenance-active-view"><span>SECCIÓN ACTUAL</span><strong>' + escapeHtml(current[0]) + '</strong><small>' + escapeHtml(current[1]) + '</small></div></div>' +
    maintenanceOperationsScene(openRequests, activeOrders, stopped) + '</section>';
}

function maintenanceOperationsScene(openRequests, activeOrders, stopped) {
  return '<div class="maintenance-bay" aria-label="Taller de mantenimiento con equipo industrial, diagnóstico, orden de trabajo, técnico y refacciones">' +
    '<div class="maintenance-bay-grid"></div><div class="maintenance-bay-beam"><span>TALLER M-01</span><i></i><i></i><i></i></div>' +
    '<div class="maintenance-machine"><div class="maintenance-machine-status ' + (stopped ? "alert" : "") + '"><i></i><span>' + (stopped ? "ATENCIÓN" : "OPERATIVO") + '</span></div><div class="maintenance-motor"><span>⚙</span><i></i></div><div class="maintenance-shaft"></div><strong>EQUIPO</strong><small>' + stopped + ' fuera de servicio</small></div>' +
    '<div class="maintenance-signal"><i></i><i></i><i></i></div>' +
    '<div class="maintenance-diagnostic"><span>DIAGNÓSTICO</span><strong>' + openRequests + '</strong><small>SOLICITUDES</small><div><i></i><i></i><i></i><i></i></div><b>MONITOREO ACTIVO</b></div>' +
    '<div class="maintenance-workorder"><span>OT</span><strong>' + activeOrders + '</strong><small>EN EJECUCIÓN</small><i></i><i></i><i></i></div>' +
    '<div class="maintenance-technician"><span></span><i></i><b>⌕</b><strong>TÉCNICO</strong></div>' +
    '<div class="maintenance-parts-cart"><span>REFACCIONES</span><i></i><i></i><i></i><b></b><b></b></div>' +
    '<div class="trade-scene-caption"><span>Equipo → diagnóstico → orden → reparación → regreso a operación</span><strong>SERVICIO CONECTADO</strong></div></div>';
}

function maintenanceIsoDashboard(control) {
  const year = Number(control.compliance?.year || new Date().getFullYear());
  const schedule = control.annualSchedule.filter((row) => Number(String(row.scheduled_date).slice(0, 4)) === year);
  const openOrders = control.orders.filter((row) => !["closed", "cancelled"].includes(row.status));
  const corrective = control.orders.filter((row) => ["corrective", "emergency"].includes(row.order_type));
  const monthNames = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SEP", "OCT", "NOV", "DIC"];
  const calendar = monthNames.map((name, index) => {
    const rows = schedule.filter((row) => Number(row.scheduled_date.slice(5, 7)) === index + 1);
    const completed = rows.filter((row) => row.effective_status === "completed").length;
    const overdue = rows.filter((row) => row.effective_status === "overdue").length;
    return '<article class="iso-month ' + (overdue ? "has-overdue" : completed && completed === rows.length ? "is-complete" : "") + '"><div><strong>' + name + '</strong><span>' + rows.length + ' actividad(es)</span></div><div class="iso-month-dots">' + (rows.length ? rows.slice(0, 8).map((row) => '<i class="' + escapeHtml(row.effective_status) + '" title="' + escapeHtml(row.equipment_name + " · " + formatDateOnly(row.scheduled_date)) + '"></i>').join("") : '<small>Sin programa</small>') + '</div><footer><span>' + completed + ' cumplidas</span>' + (overdue ? '<b>' + overdue + ' vencidas</b>' : "") + '</footer></article>';
  }).join("");
  const upcoming = schedule.filter((row) => !["completed", "cancelled"].includes(row.effective_status)).slice(0, 10);
  const compliance = Number(control.compliance?.percent || 0);
  return '<section class="maintenance-iso-head"><div><span class="eyebrow">CONTROL DOCUMENTADO PARA ISO</span><h2>Programa anual de mantenimiento</h2><p>Consulta el programa cargado desde Datos Maestros, genera OTs y mide cumplimiento, paros y costos.</p></div><div class="lead-actions">' +
    (hasPermission("maintenance.manage") ? '<button class="button ghost" data-maintenance-new="equipment">＋ Equipo</button><button class="button ghost" data-maintenance-new="supplier">＋ Proveedor</button><button class="button ghost" data-open-maintenance-program>Programa anual</button><button class="button ghost" data-maintenance-new="request">＋ Correctivo</button><button class="button primary" data-maintenance-new="order">＋ Nueva OT</button>' : "") + '</div></section>' +
    '<section class="iso-maintenance-hero"><div class="iso-compliance"><div class="iso-ring" style="--compliance:' + Math.min(100, compliance) + '"><span><strong>' + inventoryNumber(compliance) + '%</strong><small>CUMPLIMIENTO</small></span></div><div><span class="trade-live"><i></i> PROGRAMA ' + year + '</span><h3>Mantenimiento bajo control</h3><p>El indicador considera las actividades vencidas y las OTs cerradas del programa anual.</p></div></div><div class="iso-hero-stats"><article><span>PROGRAMADAS</span><strong>' + control.compliance.programmed + '</strong><small>actividades del año</small></article><article><span>CUMPLIDAS</span><strong>' + control.compliance.completed + '</strong><small>OTs terminadas</small></article><article><span>VENCIDAS</span><strong>' + control.compliance.overdue + '</strong><small>requieren seguimiento</small></article><article><span>OT ABIERTAS</span><strong>' + openOrders.length + '</strong><small>en control técnico</small></article></div></section>' +
    '<section class="panel iso-calendar-panel"><div class="panel-head"><div><span class="eyebrow">PLAN DE MANTENIMIENTO</span><h3>Calendario anual ' + year + '</h3><p>Se genera automáticamente desde el archivo maestro validado.</p></div><span>' + schedule.length + ' FECHA(S)</span></div><div class="iso-year-grid">' + calendar + '</div></section>' +
    '<section class="maintenance-iso-layout"><article class="panel iso-followup"><div class="panel-head"><div><h3>Seguimiento del programa</h3><p>Genera la OT desde cada fecha y conserva el vínculo con el plan.</p></div><span>' + upcoming.length + ' POR ATENDER</span></div><div class="compact-list">' +
    (upcoming.length ? upcoming.map((row) => '<div class="iso-followup-row"><time>' + formatDateOnly(row.scheduled_date) + '</time><div><strong>' + escapeHtml(row.equipment_folio + " · " + row.equipment_name) + '</strong><small>' + escapeHtml(row.plan_folio + " · " + row.plan_name + (row.iso_reference ? " · " + row.iso_reference : "")) + '</small></div>' + maintenanceScheduleBadge(row.effective_status) + (hasPermission("maintenance.manage") && !row.order_id ? '<button class="button ghost small" data-order-from-schedule="' + row.id + '" data-equipment-id="' + row.equipment_id + '" data-plan-id="' + row.plan_id + '" data-scheduled-date="' + row.scheduled_date + '">Generar OT</button>' : row.order_id ? '<button class="link-button" data-maintenance-order="' + row.order_id + '">' + escapeHtml(row.order_folio || "Ver OT") + '</button>' : "") + '</div>').join("") : emptyMarkup("Programa al día", "No hay actividades preventivas pendientes.")) + '</div></article>' +
    '<aside class="panel iso-cost-panel"><div class="panel-head"><div><h3>Costos de mantenimiento</h3><p>Acumulado de OTs registradas.</p></div><span>MXN</span></div><dl><div><dt>Mano de obra</dt><dd>' + money(control.costs.labor) + '</dd></div><div><dt>Proveedores</dt><dd>' + money(control.costs.external) + '</dd></div><div><dt>Refacciones</dt><dd>' + money(control.costs.parts) + '</dd></div><div class="downtime"><dt>Costo por paro</dt><dd>' + money(control.costs.downtime) + '</dd></div><div class="total"><dt>Total acumulado</dt><dd>' + money(control.costs.total) + '</dd></div></dl></aside></section>' +
    '<section class="panel maintenance-orders iso-orders"><div class="panel-head"><div><span class="eyebrow">ÓRDENES DE TRABAJO</span><h3>OTs y ejecución</h3><p>Preventivas y correctivas con responsable, evidencia, costos e impresión.</p></div><span>' + control.orders.length + ' OT(S)</span></div>' +
    (control.orders.length ? '<div class="maintenance-order-list">' + control.orders.map(maintenanceOrderCard).join("") + '</div>' : emptyMarkup("Sin órdenes de trabajo", "Genera una OT desde el calendario o registra un correctivo.")) + '</section>' +
    '<section class="maintenance-iso-layout"><article class="panel"><div class="panel-head"><div><h3>Proveedores</h3><p>Servicios externos vinculados a las OTs.</p></div><span>' + control.suppliers.length + ' PROVEEDOR(ES)</span></div><div class="compact-list">' +
    (control.suppliers.length ? control.suppliers.map((row) => '<div class="maintenance-compact-row"><div><strong>' + escapeHtml(row.folio + " · " + row.name) + '</strong><small>' + escapeHtml(row.specialty || "Sin especialidad") + ' · ' + escapeHtml(row.contact_name || "Sin contacto") + '</small></div><strong>' + money(row.accumulated_cost) + '</strong><span>' + row.order_count + ' OT(s)</span></div>').join("") : emptyMarkup("Sin proveedores", "Registra talleres o especialistas externos.")) + '</div></article>' +
    '<article class="panel"><div class="panel-head"><div><h3>Mantenimiento correctivo</h3><p>Fallas, emergencias y costo de equipos detenidos.</p></div><span>' + corrective.length + ' OT(S)</span></div><div class="compact-list">' +
    (corrective.length ? corrective.slice(0, 8).map((row) => '<div class="maintenance-compact-row"><div><strong>' + escapeHtml(row.folio + " · " + row.equipment_name) + '</strong><small>' + inventoryNumber(row.downtime_minutes) + ' min de paro · ' + maintenanceStatusLabel(row.status) + '</small></div><strong>' + money(row.downtime_cost) + '</strong><button class="link-button" data-maintenance-order="' + row.id + '">Ver</button></div>').join("") : emptyMarkup("Sin correctivos", "Las fallas atendidas aparecerán aquí.")) + '</div></article></section>';
}

function maintenanceScheduleBadge(status) {
  const label = ({ scheduled: "Programado", ot_created: "OT generada", completed: "Cumplido", overdue: "Vencido", cancelled: "Cancelado" })[status] || status;
  const kind = status === "overdue" ? "danger" : status === "scheduled" ? "warn" : "";
  return '<span class="badge ' + kind + '">● ' + escapeHtml(label) + '</span>';
}

async function renderMaintenance(view) {
  const token = beginPageRender();
  const [control, options] = await Promise.all([api("/api/maintenance/control"), api("/api/maintenance/options")]);
  if (!renderIsCurrent(token)) return;
  state.maintenanceOptions = options;
  if (view !== "maintenance_control" && maintenanceViews.has(view)) {
    pageContent.innerHTML = maintenanceHubHeader(view, control) + maintenanceSectionPage(view, control);
    bindMaintenancePageEvents();
    return;
  }
  pageContent.innerHTML = maintenanceIsoDashboard(control);
  bindMaintenancePageEvents();
  return;
  const stopped = control.equipment.filter((r) => ["stopped", "maintenance"].includes(r.status));
  const due = control.plans.filter((r) => r.is_active && r.is_due);
  const openRequests = control.requests.filter((r) => ["open", "approved"].includes(r.status));
  const activeOrders = control.orders.filter((r) => ["approved", "in_progress", "paused"].includes(r.status));
  pageContent.innerHTML =
    maintenanceHubHeader("maintenance_control", control) +
    '<section class="maintenance-context-bar maintenance-unified-toolbar"><div><span class="eyebrow">TODO EL TALLER EN UNA SOLA PANTALLA</span><h2>Acciones de mantenimiento</h2><p>Registra equipos, programa prevención, reporta fallas y ejecuta órdenes sin cambiar de módulo.</p></div><div class="lead-actions">' +
    (hasPermission("maintenance.manage") ? '<button class="button ghost" data-maintenance-new="equipment">＋ Equipo</button><button class="button ghost" data-maintenance-new="plan">＋ Plan preventivo</button><button class="button ghost" data-maintenance-new="request">＋ Solicitud</button><button class="button primary" data-maintenance-new="order">＋ Orden</button>' : "") + '</div></section>' +
    '<section class="metrics">' + metricCard("Equipos detenidos", stopped.length, "Paro o mantenimiento", "■", true) + metricCard("Preventivos vencidos", due.length, "Atención programada", "⌛") + metricCard("Solicitudes abiertas", openRequests.length, "Fallas por atender", "!") + metricCard("Órdenes activas", activeOrders.length, "Aprobadas o en proceso", "⚙") + '</section>' +
    '<section class="panel maintenance-orders"><div class="panel-head"><div><h3>Órdenes de mantenimiento</h3><p>Programación, responsables, refacciones, paros y ejecución.</p></div><span>' + control.orders.length + ' ORDEN(ES)</span></div>' +
    (control.orders.length ? '<div class="maintenance-order-list">' + control.orders.map(maintenanceOrderCard).join("") + '</div>' : emptyMarkup("Sin órdenes", "Crea una desde una solicitud o plan preventivo.")) + '</section>' +
    '<section class="maintenance-grid"><article class="panel"><div class="panel-head"><div><h3>Equipos</h3><p>Estado, criticidad, ubicación y lectura actual.</p></div><span>' + control.equipment.length + ' EQUIPO(S)</span></div><div class="compact-list">' +
    (control.equipment.length ? control.equipment.map((r) => '<div class="maintenance-equipment-row"><span class="equipment-state ' + escapeHtml(r.status) + '"></span><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</strong><small>' + escapeHtml([r.manufacturer, r.model, r.physical_location].filter(Boolean).join(" · ") || "Sin datos complementarios") + '</small></div><div><span>LECTURA</span><strong>' + maintenanceMeter(r) + '</strong></div>' + maintenanceStatusBadge(r.status) + '<button class="link-button" data-equipment-history="' + r.id + '">Historial</button></div>').join("") : emptyMarkup("Sin equipos", "Registra la primera máquina o activo.")) + '</div></article>' +
    '<article class="panel"><div class="panel-head"><div><h3>Planes preventivos</h3><p>Frecuencia, próxima atención y estado.</p></div><span>' + control.plans.length + ' PLAN(ES)</span></div><div class="compact-list">' +
    (control.plans.length ? control.plans.map((r) => '<div class="maintenance-plan-row"><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</strong><small>' + escapeHtml(r.equipment_folio + " · " + r.equipment_name) + ' · Cada ' + inventoryNumber(r.frequency_value) + ' ' + maintenanceFrequencyLabel(r.frequency_type) + '</small></div><div><span>PRÓXIMO</span><strong>' + (r.frequency_type === "meter" ? inventoryNumber(r.next_due_meter) + " " + maintenanceMeterUnit(r.meter_type) : r.next_due_date ? formatDateOnly(r.next_due_date) : "Sin fecha") + '</strong></div>' + (r.is_due ? '<span class="badge danger">● Vencido</span>' : '<span class="badge">● Vigente</span>') + '</div>').join("") : emptyMarkup("Sin planes", "Programa el mantenimiento preventivo.")) + '</div></article></section>' +
    '<section class="panel"><div class="panel-head"><div><h3>Solicitudes de mantenimiento</h3><p>Fallas reportadas, prioridad y conversión a orden.</p></div><span>' + control.requests.length + ' SOLICITUD(ES)</span></div><div class="table-wrap embedded"><table><thead><tr><th>Folio</th><th>Equipo</th><th>Tipo</th><th>Falla</th><th>Prioridad</th><th>Estado</th><th>Reportó</th><th></th></tr></thead><tbody>' +
    (control.requests.length ? control.requests.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + formatDate(r.requested_at) + '</small></td><td><strong>' + escapeHtml(r.equipment_folio) + '</strong><small>' + escapeHtml(r.equipment_name) + '</small></td><td>' + maintenanceTypeLabel(r.request_type) + '</td><td>' + escapeHtml(r.failure_description) + '</td><td>' + maintenancePriorityBadge(r.priority) + '</td><td>' + maintenanceStatusBadge(r.status) + '</td><td>' + escapeHtml(r.reported_by_name || "Sistema") + '</td><td>' + (hasPermission("maintenance.manage") && ["open", "approved"].includes(r.status) ? '<button class="link-button" data-order-from-request="' + r.id + '" data-equipment-id="' + r.equipment_id + '">Crear orden</button>' : "") + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin solicitudes", "Las fallas reportadas aparecerán aquí.") + '</td></tr>') + '</tbody></table></div></section>' +
    '<section class="maintenance-grid maintenance-bottom"><article class="panel"><div class="panel-head"><div><h3>Paros</h3><p>Duración y motivo por equipo.</p></div><span>' + control.downtimes.length + ' REGISTRO(S)</span></div><div class="compact-list">' +
    (control.downtimes.length ? control.downtimes.slice(0, 10).map((r) => '<div class="maintenance-compact-row"><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.equipment_name) + '</strong><small>' + escapeHtml(r.reason) + ' · ' + formatDate(r.started_at) + '</small></div><strong>' + (r.status === "open" ? "EN CURSO" : inventoryNumber(r.duration_minutes) + " min") + '</strong>' + maintenanceStatusBadge(r.status) + '</div>').join("") : emptyMarkup("Sin paros", "Los periodos detenidos quedarán registrados.")) + '</div></article>' +
    '<article class="panel"><div class="panel-head"><div><h3>Historial reciente</h3><p>Cambios y trabajos realizados por equipo.</p></div><span>TRAZABILIDAD</span></div><div class="compact-list">' +
    (control.history.length ? control.history.slice(0, 12).map((r) => '<div class="maintenance-history-row"><span>' + maintenanceEventSymbol(r.event_type) + '</span><div><strong>' + escapeHtml(r.equipment_folio) + ' · ' + escapeHtml(r.summary) + '</strong><small>' + (r.order_folio ? escapeHtml(r.order_folio) + ' · ' : "") + formatDate(r.created_at) + ' · ' + escapeHtml(r.created_by_name || "Sistema") + '</small></div></div>').join("") : emptyMarkup("Sin historial", "Los eventos técnicos aparecerán aquí.")) + '</div></article></section>';
  bindMaintenancePageEvents();
}

function maintenanceSectionPage(view, control) {
  const definitions = {
    maintenance_equipment: { eyebrow: "ACTIVOS MANTENIBLES", title: "Equipos", description: "Ficha técnica, ubicación, criticidad, medidores y estado operativo.", action: "equipment", button: "＋ Nuevo equipo" },
    maintenance_plans: { eyebrow: "PREVENCIÓN", title: "Planes preventivos", description: "Programa mantenimientos por calendario o por lectura del equipo.", action: "plan", button: "＋ Nuevo plan" },
    maintenance_requests: { eyebrow: "ORIGEN DEL MANTENIMIENTO", title: "Solicitudes de mantenimiento", description: "Cada falla inicia aquí y conserva el vínculo con su orden, ejecución y cierre.", action: "request", button: "＋ Nueva solicitud" },
    maintenance_orders: { eyebrow: "EJECUCIÓN TÉCNICA", title: "Órdenes de mantenimiento", description: "Programa responsables, trabajos, refacciones y cierre de cada solicitud.", action: "order", button: "＋ Nueva orden" },
    maintenance_parts: { eyebrow: "CONSUMO DE INVENTARIO", title: "Refacciones", description: "Consulta lo planeado y utilizado por orden y equipo.", action: null, button: "" },
    maintenance_downtimes: { eyebrow: "DISPONIBILIDAD DE EQUIPOS", title: "Paros", description: "Controla inicio, término y duración del tiempo detenido.", action: null, button: "" },
    maintenance_history: { eyebrow: "TRAZABILIDAD TÉCNICA", title: "Historial de equipos", description: "Consulta fallas, trabajos, refacciones y cierres por equipo.", action: null, button: "" },
  };
  const d = definitions[view];
  const lead = '<section class="maintenance-context-bar"><div><span class="eyebrow">' + d.eyebrow + '</span><h2>' + d.title + '</h2><p>' + d.description + '</p></div>' + (d.action && hasPermission("maintenance.manage") ? '<button class="button primary" data-maintenance-new="' + d.action + '">' + d.button + '</button>' : "") + '</section>';
  if (view === "maintenance_equipment") return lead + maintenanceEquipmentPage(control);
  if (view === "maintenance_plans") return lead + maintenancePlansPage(control);
  if (view === "maintenance_requests") return lead + maintenanceRequestsPage(control);
  if (view === "maintenance_orders") return lead + maintenanceOrdersPage(control);
  if (view === "maintenance_parts") return lead + maintenancePartsPage(control);
  if (view === "maintenance_downtimes") return lead + maintenanceDowntimesPage(control);
  return lead + maintenanceHistoryPage(control);
}

function maintenanceEquipmentPage(control) {
  const operational = control.equipment.filter((r) => r.status === "operational").length;
  const stopped = control.equipment.filter((r) => r.status === "stopped").length;
  const critical = control.equipment.filter((r) => r.criticality === "critical").length;
  return '<section class="metrics">' + metricCard("Equipos registrados", control.equipment.length, "Activos bajo control", "⚙", true) + metricCard("Operativos", operational, "Disponibles para trabajar", "✓") + metricCard("Detenidos", stopped, "Requieren seguimiento", "■") + metricCard("Criticidad alta", critical, "Equipos esenciales", "!") + '</section><section class="panel maintenance-section-panel"><div class="panel-head"><div><h3>Catálogo de equipos</h3><p>Selecciona un equipo para consultar todo su historial.</p></div><span>' + control.equipment.length + ' EQUIPO(S)</span></div><div class="maintenance-equipment-grid">' + (control.equipment.length ? control.equipment.map((r) => '<article><div class="equipment-card-head"><span class="equipment-state ' + escapeHtml(r.status) + '"></span><div><strong>' + escapeHtml(r.folio) + '</strong><h3>' + escapeHtml(r.name) + '</h3></div>' + maintenanceStatusBadge(r.status) + '</div><dl><div><dt>Fabricante / modelo</dt><dd>' + escapeHtml([r.manufacturer, r.model].filter(Boolean).join(" · ") || "Sin datos") + '</dd></div><div><dt>Ubicación</dt><dd>' + escapeHtml(r.physical_location || r.area_name || "Sin ubicación") + '</dd></div><div><dt>Criticidad</dt><dd>' + maintenancePriorityBadge(r.criticality) + '</dd></div><div><dt>Lectura</dt><dd>' + maintenanceMeter(r) + '</dd></div><div><dt>Último mantenimiento</dt><dd>' + (r.last_maintenance ? formatDate(r.last_maintenance) : "Sin mantenimiento") + '</dd></div></dl><button class="button ghost" data-equipment-history="' + r.id + '">Ver historial completo</button></article>').join("") : emptyMarkup("Sin equipos", "Registra el primer equipo mantenible.")) + '</div></section>';
}

function maintenancePlansPage(control) {
  const active = control.plans.filter((r) => r.is_active).length;
  const due = control.plans.filter((r) => r.is_due).length;
  return '<section class="metrics">' + metricCard("Planes activos", active, "Rutinas vigentes", "⌚", true) + metricCard("Vencidos", due, "Requieren orden preventiva", "!") + metricCard("Por calendario", control.plans.filter((r) => r.frequency_type !== "meter").length, "Días, semanas o meses", "□") + metricCard("Por medidor", control.plans.filter((r) => r.frequency_type === "meter").length, "Horas, ciclos o kilómetros", "◇") + '</section><section class="panel maintenance-section-panel"><div class="panel-head"><div><h3>Programación preventiva</h3><p>Genera una orden cuando el plan llegue a su fecha o lectura.</p></div><span>' + control.plans.length + ' PLAN(ES)</span></div><div class="table-wrap"><table><thead><tr><th>Plan</th><th>Equipo</th><th>Frecuencia</th><th>Próxima atención</th><th>Horas estimadas</th><th>Estado</th><th></th></tr></thead><tbody>' + (control.plans.length ? control.plans.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.name) + '</small></td><td><strong>' + escapeHtml(r.equipment_folio) + '</strong><small>' + escapeHtml(r.equipment_name) + '</small></td><td>Cada ' + inventoryNumber(r.frequency_value) + ' ' + maintenanceFrequencyLabel(r.frequency_type) + '</td><td>' + (r.frequency_type === "meter" ? inventoryNumber(r.next_due_meter) + ' ' + maintenanceMeterUnit(r.meter_type) : r.next_due_date ? formatDateOnly(r.next_due_date) : "Sin fecha") + '</td><td>' + inventoryNumber(r.estimated_hours) + ' h</td><td>' + (r.is_due ? '<span class="badge danger">● Vencido</span>' : '<span class="badge">● Vigente</span>') + '</td><td>' + (hasPermission("maintenance.manage") ? '<button class="link-button" data-order-from-plan="' + r.id + '" data-equipment-id="' + r.equipment_id + '">Crear orden</button>' : "") + '</td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup("Sin planes", "Crea el primer plan preventivo.") + '</td></tr>') + '</tbody></table></div></section>';
}

function maintenanceRequestsPage(control) {
  const open = control.requests.filter((r) => r.status === "open").length;
  const converted = control.requests.filter((r) => r.order_id).length;
  const critical = control.requests.filter((r) => r.priority === "critical" && !r.order_id).length;
  return '<section class="metrics">' + metricCard("Solicitudes abiertas", open, "Pendientes de orden", "!", true) + metricCard("Con orden vinculada", converted, "Seguimiento iniciado", "▣") + metricCard("Críticas sin orden", critical, "Atención inmediata", "■") + metricCard("Total reportado", control.requests.length, "Histórico de solicitudes", "≡") + '</section><section class="panel maintenance-section-panel request-centric"><div class="panel-head"><div><h3>Seguimiento por solicitud</h3><p>La orden y su estado siempre permanecen ligados al reporte original.</p></div><span>' + control.requests.length + ' SOLICITUD(ES)</span></div><div class="maintenance-request-list">' + (control.requests.length ? control.requests.map((r) => '<article class="' + (r.priority === "critical" ? "critical" : "") + '"><div class="request-identity"><span>' + maintenanceTypeLabel(r.request_type).toUpperCase() + '</span><strong>' + escapeHtml(r.folio) + '</strong><small>' + formatDate(r.requested_at) + '</small></div><div class="request-equipment"><span>EQUIPO</span><strong>' + escapeHtml(r.equipment_folio) + ' · ' + escapeHtml(r.equipment_name) + '</strong><small>' + escapeHtml(r.reported_by_name || "Sistema") + '</small></div><div class="request-failure"><span>FALLA REPORTADA</span><strong>' + escapeHtml(r.failure_description) + '</strong><small>' + (r.downtime_required ? "Requiere paro del equipo" : "Puede continuar operando") + '</small></div><div class="request-link"><span>ORDEN RELACIONADA</span>' + (r.order_id ? '<button class="linked-order" data-maintenance-order="' + r.order_id + '"><strong>' + escapeHtml(r.order_folio) + '</strong><small>' + maintenanceStatusLabel(r.order_status) + '</small></button>' : '<strong>Sin orden</strong><small>Pendiente de programación</small>') + '</div><div class="request-state">' + maintenancePriorityBadge(r.priority) + maintenanceStatusBadge(r.status) + '</div></div><div class="request-actions">' + (r.order_id ? '<button class="button ghost small" data-maintenance-order="' + r.order_id + '">Ver orden y ejecución</button>' : hasPermission("maintenance.manage") ? '<button class="button primary small" data-order-from-request="' + r.id + '" data-equipment-id="' + r.equipment_id + '">Crear orden desde solicitud</button>' : "") + '</div></article>').join("") : emptyMarkup("Sin solicitudes", "Reporta la primera falla o necesidad de mantenimiento.")) + '</div></section>';
}

function maintenanceOrdersPage(control) {
  const active = control.orders.filter((r) => ["approved", "in_progress", "paused"].includes(r.status)).length;
  return '<section class="metrics">' + metricCard("Órdenes activas", active, "Aprobadas o en ejecución", "▣", true) + metricCard("Preventivas", control.orders.filter((r) => r.order_type === "preventive").length, "Originadas por plan", "⌚") + metricCard("Correctivas", control.orders.filter((r) => ["corrective", "emergency"].includes(r.order_type)).length, "Originadas por falla", "!") + metricCard("Terminadas", control.orders.filter((r) => ["completed", "closed"].includes(r.status)).length, "Trabajo concluido", "✓") + '</section><section class="panel maintenance-section-panel"><div class="panel-head"><div><h3>Control de órdenes</h3><p>Cada tarjeta conserva su solicitud o plan de origen.</p></div><span>' + control.orders.length + ' ORDEN(ES)</span></div>' + (control.orders.length ? '<div class="maintenance-order-list">' + control.orders.map(maintenanceOrderCard).join("") + '</div>' : emptyMarkup("Sin órdenes", "Crea una desde una solicitud o plan.")) + '</section>';
}

function maintenancePartsPage(control) {
  const planned = control.parts.reduce((s, r) => s + Number(r.planned_quantity), 0), used = control.parts.reduce((s, r) => s + Number(r.used_quantity), 0);
  return '<section class="metrics">' + metricCard("Partidas registradas", control.parts.length, "Refacciones por orden", "◆", true) + metricCard("Cantidad planeada", inventoryNumber(planned), "Requerimiento estimado", "□") + metricCard("Cantidad utilizada", inventoryNumber(used), "Salida real de inventario", "−") + metricCard("Pendiente", inventoryNumber(Math.max(0, planned - used)), "Por consumir", "◇") + '</section><section class="panel maintenance-section-panel"><div class="panel-head"><div><h3>Refacciones por orden</h3><p>Los consumos utilizados generan automáticamente una salida de inventario.</p></div><span>' + control.parts.length + ' PARTIDA(S)</span></div><div class="table-wrap"><table><thead><tr><th>Refacción</th><th>Orden</th><th>Equipo</th><th>Planeado</th><th>Utilizado</th><th>Almacén / ubicación</th><th>Estado</th></tr></thead><tbody>' + (control.parts.length ? control.parts.map((r) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.item_name) + '</small></td><td><button class="link-button" data-maintenance-order="' + r.order_id + '">' + escapeHtml(r.order_folio) + '</button></td><td><strong>' + escapeHtml(r.equipment_folio) + '</strong><small>' + escapeHtml(r.equipment_name) + '</small></td><td>' + inventoryNumber(r.planned_quantity) + ' ' + escapeHtml(r.unit_symbol || "") + '</td><td>' + inventoryNumber(r.used_quantity) + ' ' + escapeHtml(r.unit_symbol || "") + '</td><td>' + escapeHtml([r.warehouse_name, r.location_name].filter(Boolean).join(" · ") || "Sin consumo") + '</td><td>' + maintenanceStatusBadge(r.order_status) + '</td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup("Sin refacciones", "Las refacciones planeadas y utilizadas aparecerán aquí.") + '</td></tr>') + '</tbody></table></div></section>';
}

function maintenanceDowntimesPage(control) {
  const open = control.downtimes.filter((r) => r.status === "open").length, minutes = control.downtimes.reduce((s, r) => s + Number(r.duration_minutes), 0);
  return '<section class="metrics">' + metricCard("Paros abiertos", open, "Equipos actualmente detenidos", "Ⅱ", true) + metricCard("Paros registrados", control.downtimes.length, "Eventos históricos", "■") + metricCard("Minutos acumulados", inventoryNumber(minutes), "Tiempo detenido cerrado", "⌛") + metricCard("Equipos afectados", new Set(control.downtimes.map((r) => r.equipment_id)).size, "Activos con paro", "⚙") + '</section><section class="panel maintenance-section-panel"><div class="panel-head"><div><h3>Registro de paros</h3><p>Duración calculada desde el inicio hasta la reanudación.</p></div><span>' + control.downtimes.length + ' PARO(S)</span></div><div class="table-wrap"><table><thead><tr><th>Folio</th><th>Equipo</th><th>Orden</th><th>Inicio</th><th>Fin</th><th>Duración</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>' + (control.downtimes.length ? control.downtimes.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td><strong>' + escapeHtml(r.equipment_folio) + '</strong><small>' + escapeHtml(r.equipment_name) + '</small></td><td>' + (r.order_id ? '<button class="link-button" data-maintenance-order="' + r.order_id + '">' + escapeHtml(r.order_folio) + '</button>' : "—") + '</td><td>' + formatDate(r.started_at) + '</td><td>' + (r.ended_at ? formatDate(r.ended_at) : "En curso") + '</td><td><strong>' + (r.status === "open" ? "En curso" : inventoryNumber(r.duration_minutes) + " min") + '</strong></td><td>' + escapeHtml(r.reason) + '</td><td>' + maintenanceStatusBadge(r.status) + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin paros", "Los tiempos detenidos aparecerán aquí.") + '</td></tr>') + '</tbody></table></div></section>';
}

function maintenanceHistoryPage(control) {
  const equipment = control.equipment;
  return '<section class="maintenance-history-layout"><aside class="panel"><div class="panel-head"><div><h3>Equipos</h3><p>Selecciona para abrir su expediente.</p></div><span>' + equipment.length + '</span></div><div class="compact-list">' + (equipment.length ? equipment.map((r) => '<button class="history-equipment-button" data-equipment-history="' + r.id + '"><span class="equipment-state ' + escapeHtml(r.status) + '"></span><div><strong>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</strong><small>' + r.order_count + ' orden(es) · ' + maintenanceStatusLabel(r.status) + '</small></div><span>→</span></button>').join("") : emptyMarkup("Sin equipos", "Registra un equipo para iniciar el historial.")) + '</div></aside><section class="panel"><div class="panel-head"><div><h3>Eventos recientes</h3><p>Solicitudes, trabajos, refacciones, paros y cierres.</p></div><span>TRAZABILIDAD</span></div><div class="equipment-timeline maintenance-page-timeline">' + (control.history.length ? control.history.map((r) => '<article><span>' + maintenanceEventSymbol(r.event_type) + '</span><div><strong>' + escapeHtml(r.equipment_folio) + ' · ' + escapeHtml(r.summary) + '</strong><small>' + (r.order_folio ? escapeHtml(r.order_folio) + ' · ' : "") + formatDate(r.created_at) + ' · ' + escapeHtml(r.created_by_name || "Sistema") + '</small></div></article>').join("") : emptyMarkup("Sin eventos", "El historial técnico aparecerá aquí.")) + '</div></section></section>';
}

function bindMaintenancePageEvents() {
  pageContent.onclick = (event) => {
    if (event.target.closest("[data-open-maintenance-program]")) { state.masterHubSection = "maintenance_program"; return navigate("masters_hub"); }
    const create = event.target.closest("[data-maintenance-new]"); if (create) return openMaintenanceCreateModal(create.dataset.maintenanceNew);
    const print = event.target.closest("[data-maintenance-print]"); if (print) return printMaintenanceOrder(Number(print.dataset.maintenancePrint));
    const detail = event.target.closest("[data-maintenance-order]"); if (detail) return openMaintenanceOrderDetail(Number(detail.dataset.maintenanceOrder));
    const action = event.target.closest("[data-maintenance-action]"); if (action) return handleMaintenanceAction(Number(action.dataset.id), action.dataset.maintenanceAction);
    const formAction = event.target.closest("[data-maintenance-form-action]"); if (formAction) return openMaintenanceActionModal(Number(formAction.dataset.id), formAction.dataset.maintenanceFormAction);
    const history = event.target.closest("[data-equipment-history]"); if (history) return openEquipmentHistory(Number(history.dataset.equipmentHistory));
    const request = event.target.closest("[data-order-from-request]"); if (request) return openMaintenanceOrderModal(Number(request.dataset.orderFromRequest), Number(request.dataset.equipmentId));
    const plan = event.target.closest("[data-order-from-plan]"); if (plan) return openMaintenanceOrderFromPlan(Number(plan.dataset.orderFromPlan), Number(plan.dataset.equipmentId));
    const schedule = event.target.closest("[data-order-from-schedule]"); if (schedule) return openMaintenanceOrderFromSchedule(Number(schedule.dataset.orderFromSchedule), Number(schedule.dataset.equipmentId), Number(schedule.dataset.planId), schedule.dataset.scheduledDate);
  };
}

function openMaintenanceOrderFromSchedule(scheduleId, equipmentId, planId, scheduledDate) {
  openMaintenanceOrderModal(null, equipmentId);
  $("#maintenance-order-plan").value = String(planId);
  $("#maintenance-order-plan").dispatchEvent(new Event("change"));
  const form = $("#maintenance-order-form");
  const hidden = document.createElement("input");
  hidden.type = "hidden";
  hidden.name = "scheduleId";
  hidden.value = String(scheduleId);
  form.append(hidden);
  form.elements.orderType.value = "preventive";
  form.elements.scheduledStart.value = scheduledDate + "T08:00";
}

function openMaintenanceOrderFromPlan(planId, equipmentId) {
  openMaintenanceOrderModal(null, equipmentId);
  $("#maintenance-order-plan").value = String(planId);
  $("#maintenance-order-plan").dispatchEvent(new Event("change"));
  const plan = state.maintenanceOptions.plans.find((r) => r.id === planId);
  if (plan) $("#maintenance-order-form").elements.orderType.value = "preventive";
}

function maintenanceOrderCard(row) {
  return '<article class="maintenance-order-card"><div class="maintenance-order-summary"><div><span>' + maintenanceTypeLabel(row.order_type).toUpperCase() + '</span><strong>' + escapeHtml(row.folio) + '</strong><small>' + escapeHtml(row.request_folio || row.plan_folio || "Orden directa") + '</small></div><div><span>EQUIPO</span><strong>' + escapeHtml(row.equipment_folio) + '</strong><small>' + escapeHtml(row.equipment_name) + '</small></div><div><span>RESPONSABLE</span><strong>' + escapeHtml(row.technician_name || row.resource_name || row.supplier_name || "Sin asignar") + '</strong><small>' + (row.scheduled_start ? formatDate(row.scheduled_start) : "Sin programar") + '</small></div><div><span>PARO / COSTO</span><strong>' + inventoryNumber(row.downtime_minutes) + ' min</strong><small>' + money(row.total_cost) + ' total</small></div><div>' + maintenancePriorityBadge(row.priority) + maintenanceStatusBadge(row.status) + '</div></div><div class="maintenance-order-actions"><button class="link-button" data-maintenance-order="' + row.id + '">Ver detalle</button><button class="link-button" data-maintenance-print="' + row.id + '">Imprimir OT</button>' + maintenanceOrderButtons(row) + '</div></article>';
}

function maintenanceOrderButtons(row) {
  if (row.status === "draft" && hasPermission("maintenance.manage")) return '<button class="button primary small" data-maintenance-action="approve" data-id="' + row.id + '">Aprobar</button>';
  if (row.status === "approved" && hasPermission("maintenance.execute")) return '<button class="button primary small" data-maintenance-action="start" data-id="' + row.id + '">Iniciar</button><button class="button ghost small" data-maintenance-form-action="downtime_start" data-id="' + row.id + '">Registrar paro</button>';
  if (["in_progress", "paused"].includes(row.status) && hasPermission("maintenance.execute")) return (row.status === "paused" ? '<button class="button primary small" data-maintenance-action="resume" data-id="' + row.id + '">Reanudar</button>' : '<button class="button ghost small" data-maintenance-action="pause" data-id="' + row.id + '">Pausar</button>') + '<button class="button ghost small" data-maintenance-form-action="use_part" data-id="' + row.id + '">Refacción</button><button class="button ghost small" data-maintenance-form-action="downtime_start" data-id="' + row.id + '">Iniciar paro</button><button class="button ghost small" data-maintenance-action="downtime_end" data-id="' + row.id + '">Terminar paro</button><button class="button primary small" data-maintenance-form-action="complete" data-id="' + row.id + '">Terminar trabajo</button>';
  if (row.status === "completed" && hasPermission("maintenance.close")) return '<button class="button primary small" data-maintenance-action="close" data-id="' + row.id + '">Cerrar orden</button>';
  return "";
}

function openMaintenanceCreateModal(type) {
  if (type === "equipment") return openMaintenanceEquipmentModal();
  if (type === "plan") return openMaintenancePlanModal();
  if (type === "supplier") return openMaintenanceSupplierModal();
  if (type === "request") return openMaintenanceRequestModal();
  return openMaintenanceOrderModal();
}

function maintenanceEquipmentOptions(selected) { return '<option value="">Selecciona un equipo</option>' + state.maintenanceOptions.equipment.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</option>').join(""); }
function maintenanceWarehouseOptions(selected) { return '<option value="">Selecciona un almacén</option>' + state.maintenanceOptions.warehouses.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join(""); }

function maintenanceSupplierOptions(selected) {
  return '<option value="">Sin proveedor externo</option>' + state.maintenanceOptions.suppliers.map((row) => '<option value="' + row.id + '" ' + (row.id === selected ? "selected" : "") + '>' + escapeHtml(row.folio) + ' · ' + escapeHtml(row.name) + '</option>').join("");
}

function openMaintenanceSupplierModal() {
  $("#entity-modal-content").innerHTML = '<form id="maintenance-supplier-form"><div class="modal-head"><div><span class="eyebrow">SERVICIO EXTERNO</span><h2>Nuevo proveedor</h2><p class="muted">Registra especialistas y talleres que participan en mantenimiento.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("PMV-000000", true) + '<div class="form-grid"><label>Razón social o nombre<input name="name" required /></label><label>Especialidad<input name="specialty" placeholder="Eléctrico, hidráulico, calibración…" /></label><label>Contacto<input name="contactName" /></label><label>Teléfono<input name="phone" /></label><label>Correo electrónico<input name="email" type="email" /></label><label>Tarifa por hora<input name="hourlyRate" type="number" min="0" step="0.01" value="0" /></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar proveedor</button></div></form>';
  bindModuleForm("#maintenance-supplier-form", "/api/maintenance/suppliers", null, "Proveedor");
  entityDialog.showModal();
}

function openMaintenanceEquipmentModal() {
  $("#entity-modal-content").innerHTML = '<form id="maintenance-equipment-form"><div class="modal-head"><div><span class="eyebrow">FICHA TÉCNICA</span><h2>Nuevo equipo</h2><p class="muted">Identificación, ubicación, criticidad y medidor.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("EQU-000000", true) + '<div class="form-grid"><label>Nombre<input name="name" required /></label><label>Recurso vinculado<select name="resourceId"><option value="">Sin recurso maestro</option>' + state.maintenanceOptions.resources.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Categoría<input name="category" placeholder="Máquina, vehículo…" /></label><label>Fabricante<input name="manufacturer" /></label><label>Modelo<input name="model" /></label><label>Número de serie<input name="serialNumber" /></label><label>Área<select name="areaId"><option value="">Sin área</option>' + state.maintenanceOptions.areas.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Ubicación física<input name="physicalLocation" /></label><label>Criticidad<select name="criticality"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Tipo de medidor<select name="meterType"><option value="none">Sin medidor</option><option value="hours">Horas</option><option value="cycles">Ciclos</option><option value="kilometers">Kilómetros</option></select></label><label>Lectura inicial<input name="meterValue" type="number" min="0" value="0" /></label><label>Fecha de adquisición<input name="acquisitionDate" type="date" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar equipo</button></div></form>';
  $("#maintenance-equipment-form .form-grid").insertAdjacentHTML("beforeend", '<label>Costo por hora de paro<input name="downtimeCostPerHour" type="number" min="0" step="0.01" value="0" /><small>Calcula el impacto económico del mantenimiento correctivo.</small></label>');
  bindModuleForm("#maintenance-equipment-form", "/api/maintenance/equipment", null, "Equipo");
  entityDialog.showModal();
}

function openMaintenancePlanModal() {
  $("#entity-modal-content").innerHTML = '<form id="maintenance-plan-form"><div class="modal-head"><div><span class="eyebrow">MANTENIMIENTO PREVENTIVO</span><h2>Nuevo plan</h2><p class="muted">Programa la intervención por fecha o lectura.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("PMP-000000", true) + '<div class="form-grid"><label>Equipo<select name="equipmentId" required>' + maintenanceEquipmentOptions() + '</select></label><label>Nombre del plan<input name="name" required /></label><label>Frecuencia<select name="frequencyType"><option value="days">Días</option><option value="weeks">Semanas</option><option value="months">Meses</option><option value="meter">Lectura del medidor</option></select></label><label>Cada<input name="frequencyValue" type="number" min="0.000001" value="30" required /></label><label>Próxima fecha<input name="nextDueDate" type="date" /></label><label>Próxima lectura<input name="nextDueMeter" type="number" min="0" /></label><label>Horas estimadas<input name="estimatedHours" type="number" min="0" value="0" /></label></div><label>Instrucciones<textarea name="instructions" rows="5" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar plan</button></div></form>';
  $("#maintenance-plan-form .form-grid").insertAdjacentHTML("beforeend", '<label>Año del programa<input name="annualYear" type="number" min="2020" max="2100" value="' + new Date().getFullYear() + '" required /></label><label>Referencia ISO<input name="isoReference" placeholder="Procedimiento, cláusula o documento" /></label><label>Proveedor previsto<select name="supplierId">' + maintenanceSupplierOptions() + '</select></label>');
  bindModuleForm("#maintenance-plan-form", "/api/maintenance/plans", null, "Plan preventivo");
  entityDialog.showModal();
}

function openMaintenanceRequestModal() {
  $("#entity-modal-content").innerHTML = '<form id="maintenance-request-form"><div class="modal-head"><div><span class="eyebrow">REPORTE DE FALLA</span><h2>Nueva solicitud</h2><p class="muted">Describe el problema y su impacto operativo.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("SOL-000000", true) + '<div class="form-grid"><label>Equipo<select name="equipmentId" required>' + maintenanceEquipmentOptions() + '</select></label><label>Tipo<select name="requestType"><option value="corrective">Correctivo</option><option value="emergency">Emergencia</option><option value="inspection">Inspección</option><option value="improvement">Mejora</option></select></label><label>Prioridad<select name="priority"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Fecha y hora<input name="requestedAt" type="datetime-local" /></label><label class="check-option"><input name="downtimeRequired" type="checkbox" /><span><strong>Requiere paro</strong><small>El equipo no puede seguir operando.</small></span></label></div><label>Descripción de la falla<textarea name="failureDescription" rows="4" required></textarea></label><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Enviar solicitud</button></div></form>';
  bindModuleForm("#maintenance-request-form", "/api/maintenance/requests", null, "Solicitud");
  entityDialog.showModal();
}

function openMaintenanceOrderModal(requestId = null, equipmentId = null) {
  const parts = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="maintenance-order-form"><div class="modal-head"><div><span class="eyebrow">ORDEN DE MANTENIMIENTO</span><h2>Nueva orden</h2><p class="muted">Programa responsables y refacciones planeadas.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("OTM-000000", true) + '<div class="form-grid"><label>Solicitud origen<select name="requestId" id="maintenance-order-request"><option value="">Orden directa</option>' + state.maintenanceOptions.requests.map((r) => '<option value="' + r.id + '" data-equipment="' + r.equipment_id + '" ' + (r.id === requestId ? "selected" : "") + '>' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.equipment_name) + '</option>').join("") + '</select></label><label>Plan preventivo<select name="planId" id="maintenance-order-plan"><option value="">Sin plan</option>' + state.maintenanceOptions.plans.map((r) => '<option value="' + r.id + '" data-equipment="' + r.equipment_id + '">' + escapeHtml(r.folio) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Equipo<select name="equipmentId" id="maintenance-order-equipment" required>' + maintenanceEquipmentOptions(equipmentId) + '</select></label><label>Tipo<select name="orderType"><option value="preventive">Preventivo</option><option value="corrective">Correctivo</option><option value="emergency">Emergencia</option><option value="inspection">Inspección</option></select></label><label>Prioridad<select name="priority"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Recurso asignado<select name="assignedResourceId"><option value="">Sin recurso</option>' + state.maintenanceOptions.resources.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Técnico<select name="technicianId"><option value="">Sin técnico</option>' + state.maintenanceOptions.employees.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.employee_number) + ' · ' + escapeHtml(r.full_name) + '</option>').join("") + '</select></label><label>Inicio programado<input name="scheduledStart" type="datetime-local" /></label><label>Fin programado<input name="scheduledEnd" type="datetime-local" /></label></div><section class="line-builder"><div class="panel-head"><h3>Refacciones planeadas</h3><span>ARTÍCULO Y CANTIDAD</span></div><div class="maintenance-part-fields"><label>Refacción<select id="maintenance-part-item"><option value="">Selecciona</option>' + state.maintenanceOptions.items.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.sku) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Cantidad<input id="maintenance-part-quantity" type="number" min="0.000001" value="1" /></label><button class="button ghost" type="button" id="add-maintenance-part">Agregar</button></div><div id="maintenance-parts"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear orden</button></div></form>';
  $("#maintenance-order-form .form-grid").insertAdjacentHTML("beforeend", '<label>Proveedor externo<select name="supplierId">' + maintenanceSupplierOptions() + '</select></label><label>Costo externo estimado<input name="externalCost" type="number" min="0" step="0.01" value="0" /></label>');
  const render = () => { $("#maintenance-parts").innerHTML = parts.length ? '<div class="table-wrap embedded"><table><thead><tr><th>Refacción</th><th>Cantidad</th><th></th></tr></thead><tbody>' + parts.map((r, i) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.name) + '</small></td><td>' + inventoryNumber(r.quantity) + '</td><td><button class="link-button danger-link" type="button" data-remove-maintenance-part="' + i + '">Quitar</button></td></tr>').join("") + '</tbody></table></div>' : emptyMarkup("Sin refacciones planeadas", "Puedes agregarlas ahora o consumirlas durante el trabajo."); };
  render();
  $("#add-maintenance-part").onclick = () => { const item = state.maintenanceOptions.items.find((r) => r.id === Number($("#maintenance-part-item").value)); if (!item) return toast("Selecciona una refacción.", "error"); if (parts.some((r) => r.itemId === item.id)) return toast("La refacción ya está agregada.", "error"); parts.push({ itemId: item.id, sku: item.sku, name: item.name, quantity: Number($("#maintenance-part-quantity").value) }); render(); };
  $("#maintenance-parts").onclick = (event) => { const button = event.target.closest("[data-remove-maintenance-part]"); if (button) { parts.splice(Number(button.dataset.removeMaintenancePart), 1); render(); } };
  const syncEquipment = (select) => { const option = select.selectedOptions[0]; if (option?.dataset.equipment) $("#maintenance-order-equipment").value = option.dataset.equipment; };
  $("#maintenance-order-request").onchange = (event) => syncEquipment(event.target);
  $("#maintenance-order-plan").onchange = (event) => syncEquipment(event.target);
  bindModuleForm("#maintenance-order-form", "/api/maintenance/orders", () => ({ parts }), "Orden de mantenimiento");
  entityDialog.showModal();
}

async function openMaintenanceOrderDetail(id) {
  try {
    const d = await api("/api/maintenance/orders/" + id), o = d.order;
    $("#entity-modal-content").classList.add("wide");
    $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(o.folio) + '</span><h2>' + escapeHtml(o.equipment_folio) + ' · ' + escapeHtml(o.equipment_name) + '</h2><p class="muted">' + maintenanceTypeLabel(o.order_type) + ' · ' + escapeHtml(o.technician_name || o.resource_name || "Sin responsable") + '</p></div><button type="button" data-close-modal>×</button></div><section class="maintenance-detail-metrics"><div><span>Estado</span>' + maintenanceStatusBadge(o.status) + '</div><div><span>Horas reales</span><strong>' + inventoryNumber(o.actual_hours) + '</strong></div><div><span>Costo de mano de obra</span><strong>' + money(o.labor_cost) + '</strong></div><div><span>Lectura</span><strong>' + inventoryNumber(o.meter_value) + ' ' + maintenanceMeterUnit(o.meter_type) + '</strong></div></section><div class="detail-section"><div class="panel-head"><h3>Refacciones</h3><span>PLANEADO Y CONSUMIDO</span></div><div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Planeado</th><th>Utilizado</th></tr></thead><tbody>' + (d.parts.length ? d.parts.map((r) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.item_name) + '</small></td><td>' + inventoryNumber(r.planned_quantity) + '</td><td>' + inventoryNumber(r.used_quantity) + '</td></tr>').join("") : '<tr><td colspan="3">' + emptyMarkup("Sin refacciones", "No se han registrado consumos.") + '</td></tr>') + '</tbody></table></div></div><div class="maintenance-findings"><article><span>Falla encontrada</span><p>' + escapeHtml(o.failure_found || "Sin captura") + '</p></article><article><span>Causa raíz</span><p>' + escapeHtml(o.root_cause || "Sin captura") + '</p></article><article><span>Trabajo realizado</span><p>' + escapeHtml(o.work_performed || "Sin captura") + '</p></article></div><div class="detail-section"><div class="panel-head"><h3>Paros asociados</h3><span>' + d.downtimes.length + ' REGISTRO(S)</span></div><div class="compact-list">' + (d.downtimes.length ? d.downtimes.map((r) => '<div class="maintenance-compact-row"><div><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.reason) + ' · ' + formatDate(r.started_at) + '</small></div><strong>' + (r.status === "open" ? "En curso" : inventoryNumber(r.duration_minutes) + " min") + '</strong></div>').join("") : emptyMarkup("Sin paros", "No hay tiempo detenido asociado.")) + '</div></div><div class="detail-section"><div class="panel-head"><h3>Historial de la orden</h3><span>' + d.history.length + ' EVENTO(S)</span></div><div class="compact-list">' + d.history.map((r) => '<div class="maintenance-history-row"><span>' + maintenanceEventSymbol(r.event_type) + '</span><div><strong>' + escapeHtml(r.summary) + '</strong><small>' + formatDate(r.created_at) + ' · ' + escapeHtml(r.created_by_name || "Sistema") + '</small></div></div>').join("") + '</div></div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

async function printMaintenanceOrder(id) {
  try {
    const data = await api("/api/maintenance/orders/" + id);
    const order = data.order;
    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) return toast("Permite las ventanas emergentes para imprimir la OT.", "error");
    const partRows = data.parts.length ? data.parts.map((row) => '<tr><td>' + escapeHtml(row.sku) + ' · ' + escapeHtml(row.item_name) + '</td><td>' + inventoryNumber(row.planned_quantity) + '</td><td>' + inventoryNumber(row.used_quantity) + '</td><td>' + money(row.line_cost) + '</td></tr>').join("") : '<tr><td colspan="4">Sin refacciones registradas</td></tr>';
    popup.document.write('<!doctype html><html lang="es"><head><meta charset="utf-8"><title>' + escapeHtml(order.folio) + '</title><style>@page{size:letter;margin:14mm}*{box-sizing:border-box}body{font:13px Arial,sans-serif;color:#15261f;margin:0}header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0d4b37;padding-bottom:14px}h1{font-size:25px;margin:4px 0}.brand{color:#0d4b37;font-weight:800;letter-spacing:.12em}.folio{text-align:right}.folio strong{font-size:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid #ccd8d1;margin:18px 0}.grid div{padding:11px;border-right:1px solid #ccd8d1;border-bottom:1px solid #ccd8d1;min-height:58px}.grid span,.section-title{display:block;color:#5e7369;font-size:10px;font-weight:800;letter-spacing:.1em;margin-bottom:5px}section{margin:18px 0}table{width:100%;border-collapse:collapse}th,td{padding:9px;border:1px solid #ccd8d1;text-align:left}th{background:#edf4ef;font-size:10px;letter-spacing:.08em}.costs{margin-left:auto;width:320px}.costs div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #ccd8d1}.costs .total{font-size:16px;font-weight:800}.signatures{display:grid;grid-template-columns:repeat(3,1fr);gap:35px;margin-top:55px}.signatures div{border-top:1px solid #172b22;text-align:center;padding-top:7px}.no-print{margin:0 0 16px;padding:10px 16px;border:0;background:#0d4b37;color:white;font-weight:700}@media print{.no-print{display:none}}</style></head><body><button class="no-print" onclick="window.print()">Imprimir</button><header><div><div class="brand">ABICORP · MANTENIMIENTO</div><h1>Orden de trabajo</h1><span>Documento de control y evidencia</span></div><div class="folio"><span>FOLIO</span><strong>' + escapeHtml(order.folio) + '</strong><br><small>' + escapeHtml(order.iso_reference || "Programa interno") + '</small></div></header><div class="grid"><div><span>EQUIPO</span><strong>' + escapeHtml(order.equipment_folio + " · " + order.equipment_name) + '</strong></div><div><span>TIPO</span><strong>' + escapeHtml(maintenanceTypeLabel(order.order_type)) + '</strong></div><div><span>ESTADO</span><strong>' + escapeHtml(maintenanceStatusLabel(order.status)) + '</strong></div><div><span>PROGRAMADA</span>' + escapeHtml(order.scheduled_start ? formatDate(order.scheduled_start) : "Sin fecha") + '</div><div><span>RESPONSABLE</span>' + escapeHtml(order.technician_name || order.resource_name || "Sin asignar") + '</div><div><span>PROVEEDOR</span>' + escapeHtml(order.supplier_name || "Interno") + '</div></div><section><span class="section-title">TRABAJO SOLICITADO / NOTAS</span><p>' + escapeHtml(order.notes || order.plan_name || "Sin notas") + '</p></section><section><span class="section-title">DIAGNÓSTICO Y TRABAJO REALIZADO</span><p><strong>Falla:</strong> ' + escapeHtml(order.failure_found || "Pendiente") + '</p><p><strong>Causa raíz:</strong> ' + escapeHtml(order.root_cause || "Pendiente") + '</p><p><strong>Trabajo:</strong> ' + escapeHtml(order.work_performed || "Pendiente") + '</p></section><section><span class="section-title">REFACCIONES</span><table><thead><tr><th>Artículo</th><th>Planeado</th><th>Utilizado</th><th>Costo</th></tr></thead><tbody>' + partRows + '</tbody></table></section><section class="costs"><div><span>Mano de obra</span><strong>' + money(order.labor_cost) + '</strong></div><div><span>Servicio externo</span><strong>' + money(order.external_cost) + '</strong></div><div><span>Refacciones</span><strong>' + money(order.parts_cost) + '</strong></div><div><span>Costo por paro</span><strong>' + money(order.downtime_cost) + '</strong></div><div class="total"><span>Total</span><strong>' + money(order.total_cost) + '</strong></div></section><div class="signatures"><div>Elaboró</div><div>Ejecutó</div><div>Validó / cerró</div></div><script>setTimeout(()=>window.print(),250)<\/script></body></html>');
    popup.document.close();
  } catch (error) { toast(error.message, "error"); }
}

async function openEquipmentHistory(id) {
  try {
    const d = await api("/api/maintenance/equipment/" + id + "/history"), e = d.equipment;
    $("#entity-modal-content").classList.add("wide");
    $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(e.folio) + '</span><h2>' + escapeHtml(e.name) + '</h2><p class="muted">' + escapeHtml([e.manufacturer, e.model, e.serial_number].filter(Boolean).join(" · ") || "Ficha de equipo") + '</p></div><button type="button" data-close-modal>×</button></div><section class="maintenance-detail-metrics"><div><span>Estado</span>' + maintenanceStatusBadge(e.status) + '</div><div><span>Criticidad</span>' + maintenancePriorityBadge(e.criticality) + '</div><div><span>Área</span><strong>' + escapeHtml(e.area_name || "Sin área") + '</strong></div><div><span>Lectura</span><strong>' + maintenanceMeter(e) + '</strong></div></section><div class="equipment-timeline">' + (d.history.length ? d.history.map((r) => '<article><span>' + maintenanceEventSymbol(r.event_type) + '</span><div><strong>' + escapeHtml(r.summary) + '</strong><small>' + (r.order_folio ? escapeHtml(r.order_folio) + ' · ' : "") + (r.request_folio ? escapeHtml(r.request_folio) + ' · ' : "") + formatDate(r.created_at) + ' · ' + escapeHtml(r.created_by_name || "Sistema") + '</small></div></article>').join("") : emptyMarkup("Sin historial", "Los eventos del equipo aparecerán aquí.")) + '</div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

async function handleMaintenanceAction(id, action) {
  if (action === "downtime_end") {
    try { await api("/api/maintenance/orders/" + id + "/action", { method: "POST", body: { action } }); toast("Paro terminado."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
    return;
  }
  if (action === "close" && !await confirmAction({ eyebrow: "MANTENIMIENTO", title: "Cerrar orden de mantenimiento", message: "El cierre será definitivo y conservará el historial de trabajos y costos.", confirmLabel: "Cerrar orden", tone: "danger" })) return;
  try { const result = await api("/api/maintenance/orders/" + id + "/action", { method: "POST", body: { action } }); toast(result.folio + " actualizada."); await navigate(state.currentView); }
  catch (error) { toast(error.message, "error"); }
}

async function openMaintenanceActionModal(id, action) {
  try {
    const d = await api("/api/maintenance/orders/" + id), o = d.order;
    const titles = { use_part: "Consumir refacción", downtime_start: "Registrar paro", complete: "Terminar mantenimiento" };
    let fields = "";
    if (action === "use_part") fields = '<div class="form-grid"><label>Refacción<select name="itemId" required><option value="">Selecciona</option>' + state.maintenanceOptions.items.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.sku) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Cantidad<input name="quantity" type="number" min="0.000001" required /></label><label>Almacén<select name="warehouseId" required>' + maintenanceWarehouseOptions() + '</select></label><label>Ubicación<select name="locationId"><option value="">Sin ubicación</option>' + state.maintenanceOptions.locations.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code) + ' · ' + escapeHtml(r.name) + '</option>').join("") + '</select></label><label>Lote<select name="lotId"><option value="">Sin lote</option>' + state.maintenanceOptions.lots.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.lot_number) + '</option>').join("") + '</select></label></div>';
    if (action === "downtime_start") fields = '<label>Motivo del paro<textarea name="reason" rows="4" required></textarea></label>';
    if (action === "complete") fields = '<div class="form-grid"><label>Horas reales<input name="actualHours" type="number" min="0" step="0.01" value="0" /></label><label>Costo mano de obra<input name="laborCost" type="number" min="0" step="0.01" value="0" /></label><label>Costo externo<input name="externalCost" type="number" min="0" step="0.01" value="' + Number(o.external_cost || 0) + '" /></label><label>Lectura final del equipo<input name="meterValue" type="number" min="0" value="' + o.meter_value + '" /></label></div><label>Falla encontrada<textarea name="failureFound" rows="3"></textarea></label><label>Causa raíz<textarea name="rootCause" rows="3"></textarea></label><label>Trabajo realizado<textarea name="workPerformed" rows="4" required></textarea></label>';
    $("#entity-modal-content").innerHTML = '<form id="maintenance-action-form"><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(o.folio) + '</span><h2>' + titles[action] + '</h2><p class="muted">' + escapeHtml(o.equipment_folio) + ' · ' + escapeHtml(o.equipment_name) + '</p></div><button type="button" data-close-modal>×</button></div>' + fields + '<label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Aplicar</button></div></form>';
    $("#maintenance-action-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, body = Object.fromEntries(new FormData(form)), box = $(".form-error", form); body.action = action; try { await api("/api/maintenance/orders/" + id + "/action", { method: "POST", body }); entityDialog.close(); state.maintenanceOptions = null; toast("Movimiento de mantenimiento registrado."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } };
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function maintenanceTypeLabel(value) { return ({ preventive: "Preventivo", corrective: "Correctivo", emergency: "Emergencia", inspection: "Inspección", improvement: "Mejora" })[value] || value; }
function maintenanceStatusLabel(value) { return ({ operational: "Operativo", maintenance: "En mantenimiento", stopped: "Detenido", retired: "Retirado", open: "Abierta", approved: "Aprobada", rejected: "Rechazada", converted: "Convertida", draft: "Borrador", in_progress: "En proceso", paused: "Pausada", completed: "Terminada", closed: "Cerrada", cancelled: "Cancelada" })[value] || value; }
function maintenanceStatusBadge(value) { const kind = ["stopped", "rejected", "cancelled"].includes(value) ? "danger" : ["maintenance", "open", "draft", "paused"].includes(value) ? "warn" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(maintenanceStatusLabel(value)) + '</span>'; }
function maintenancePriorityLabel(value) { return ({ low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" })[value] || value; }
function maintenancePriorityBadge(value) { const kind = value === "critical" ? "danger" : value === "high" ? "warn" : ""; return '<span class="badge ' + kind + '">' + escapeHtml(maintenancePriorityLabel(value)) + '</span>'; }
function maintenanceFrequencyLabel(value) { return ({ days: "días", weeks: "semanas", months: "meses", meter: "unidades de medidor" })[value] || value; }
function maintenanceMeterUnit(value) { return ({ hours: "h", cycles: "ciclos", kilometers: "km", none: "" })[value] || ""; }
function maintenanceMeter(row) { return row.meter_type === "none" ? "Sin medidor" : inventoryNumber(row.meter_value) + " " + maintenanceMeterUnit(row.meter_type); }
function maintenanceEventSymbol(value) { return ({ equipment_created: "E", plan_created: "P", request_created: "!", order_created: "O", order_started: "▶", approved: "✓", paused: "Ⅱ", in_progress: "▶", part_used: "−", downtime_started: "■", downtime_ended: "□", order_completed: "✓", order_closed: "●", cancelled: "×" })[value] || "·"; }

const logisticsHubConfig = {
  logistics_preparation: { label: "Preparar", description: "Crear embarque", symbol: "▣", source: "shipments" },
  logistics_picking: { label: "Surtir", description: "Tomar del almacén", symbol: "✓", source: "shipments" },
  logistics_packing: { label: "Empacar", description: "Armar los bultos", symbol: "□", source: "shipments" },
  logistics_routes: { label: "Rutas", description: "Planear recorrido", symbol: "⇢", source: "routes" },
  logistics_carriers: { label: "Transporte", description: "Quién entrega", symbol: "◇", source: "carriers" },
  logistics_evidence: { label: "Evidencias", description: "Fotos y firmas", symbol: "◉", source: "evidence" },
  logistics_confirmation: { label: "Entregar", description: "Confirmar recepción", symbol: "●", source: "shipments" },
};

async function renderLogistics(view) {
  const token = beginPageRender();
  if (!state.logisticsOptions) state.logisticsOptions = await api("/api/logistics/options");
  const control = await api("/api/logistics/control");
  if (!renderIsCurrent(token)) return;
  if (view !== "logistics_control" && logisticsHubConfig[view]) state.logisticsHubSection = view;
  const stage = logisticsHubConfig[state.logisticsHubSection] ? state.logisticsHubSection : "logistics_preparation";
  state.logisticsHubSection = stage;
  pageContent.innerHTML = logisticsHubHeader(control, stage) + '<section class="trade-workspace">' + logisticsPage(stage, control) + '</section>';
  bindLogisticsEvents();
}

function logisticsHubHeader(control, activeStage) {
  const countFor = (key, config) => {
    if (key === "logistics_preparation") return control.shipments.filter((row) => row.status === "preparing").length;
    if (key === "logistics_picking") return control.shipments.filter((row) => ["picking", "picked"].includes(row.status)).length;
    if (key === "logistics_packing") return control.shipments.filter((row) => ["packed", "in_transit"].includes(row.status)).length;
    if (key === "logistics_confirmation") return control.shipments.filter((row) => ["in_transit", "delivered"].includes(row.status)).length;
    return control[config.source].length;
  };
  const stages = Object.entries(logisticsHubConfig).map(([key, config]) => ({ key, ...config, count: countFor(key, config) }));
  const active = control.shipments.filter((row) => !["delivered", "cancelled"].includes(row.status)).length;
  const inTransit = control.shipments.filter((row) => row.status === "in_transit").length;
  return '<section class="trade-hub-topbar"><div><span class="eyebrow">DEL ALMACÉN HASTA EL CLIENTE</span><h2>Mi logística</h2><p>Prepara, surte, empaca y entrega pedidos desde una sola pantalla.</p></div></section>' +
    '<section class="trade-stage-switcher logistics-stages" aria-label="Secciones de logística">' + stages.map((stage) => tradeStageCard({ ...stage, active: stage.key === activeStage, module: "logistics" })).join("") + '</section>' +
    '<section class="trade-command logistics"><div class="trade-command-copy"><span class="trade-live"><i></i> CENTRO DE DISTRIBUCIÓN</span><h3>Centro de envíos</h3><p>Coordina surtido, empaque, andén, transporte y entrega desde el mismo embarque.</p><div class="trade-command-stats"><span><strong>' + active + '</strong><small>embarques activos</small></span><span><strong>' + inTransit + '</strong><small>unidades en ruta</small></span></div></div>' +
    logisticsOperationsScene(control) + '</section>';
}

function logisticsOperationsScene(control) {
  const ready = control.shipments.filter((row) => ["packed", "in_transit"].includes(row.status)).length;
  const inTransit = control.shipments.filter((row) => row.status === "in_transit").length;
  return '<div class="logistics-yard" aria-label="Centro logístico con almacén, andén de carga, transporte y ruta de entrega">' +
    '<div class="logistics-yard-grid"></div>' +
    '<div class="logistics-warehouse"><strong>ALMACÉN</strong><div class="logistics-rack"><i></i><i></i><i></i><i></i><i></i><i></i></div></div>' +
    '<div class="logistics-conveyor"><i></i><i></i><i></i><span class="logistics-box">AB</span></div>' +
    '<div class="logistics-dock"><span>ANDÉN 01</span><i></i><small>CARGA</small></div>' +
    '<div class="logistics-truck"><div class="logistics-truck-box"><span>' + ready + '</span><small>LISTOS</small></div><div class="logistics-truck-cab"><i></i></div><b></b><b></b></div>' +
    '<div class="logistics-route-line"><i></i><i></i><i></i></div>' +
    '<div class="logistics-destination"><span>●</span><strong>CLIENTE</strong><small>' + inTransit + ' EN RUTA</small></div>' +
    '<div class="trade-scene-caption"><span>Almacén → andén → ruta → cliente</span><strong>OPERACIÓN LOGÍSTICA</strong></div></div>';
}

function logisticsPage(view, control) {
  const pages = {
    logistics_preparation: logisticsPreparationPage,
    logistics_picking: logisticsPickingPage,
    logistics_packing: logisticsPackingPage,
    logistics_routes: logisticsRoutesPage,
    logistics_carriers: logisticsCarriersPage,
    logistics_evidence: logisticsEvidencePage,
    logistics_confirmation: logisticsConfirmationPage,
  };
  return pages[view](control);
}

function logisticsLead(eyebrow, title, text, action = "") {
  return '<section class="page-lead logistics-lead"><div><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2><p>' + text + '</p></div>' + action + '</section>';
}

function logisticsPreparationPage(control) {
  const open = control.shipments.filter((row) => row.status === "preparing");
  const action = hasPermission("logistics.manage") ? '<button id="new-logistics-shipment" class="button primary">＋ Preparar pedido</button>' : '';
  const eligible = state.logisticsOptions.orders;
  return logisticsLead("LOGÍSTICA Y EMBARQUES", "Preparar pedidos", "Convierte pedidos confirmados en embarques controlados.", action) +
    '<section class="logistics-summary-grid"><article><span>Pedidos disponibles</span><strong>' + eligible.length + '</strong><small>Sin preparación activa</small></article><article><span>En preparación</span><strong>' + open.length + '</strong><small>Listos para iniciar picking</small></article><article><span>Entregados</span><strong>' + control.shipments.filter((r) => r.status === "delivered").length + '</strong><small>Con salida de inventario</small></article></section>' +
    '<section class="panel logistics-panel"><div class="panel-head"><div><h3>Preparaciones abiertas</h3><p>El contenido se copia automáticamente desde el pedido.</p></div><span>' + open.length + ' REGISTRO(S)</span></div>' +
    (open.length ? '<div class="logistics-card-list">' + open.map(logisticsShipmentCard).join("") + '</div>' : emptyMarkup("Sin preparaciones abiertas", "Selecciona un pedido confirmado para comenzar.")) + '</section>';
}

function logisticsPickingPage(control) {
  const rows = control.shipments.filter((row) => ["preparing", "picking", "picked"].includes(row.status));
  return logisticsLead("SURTIDO DE ALMACÉN", "Surtir", "Registra ubicación, lote y cantidad tomada del almacén.") + logisticsShipmentTable(rows, "picking");
}

function logisticsPackingPage(control) {
  const rows = control.shipments.filter((row) => ["picked", "packed", "in_transit"].includes(row.status));
  return logisticsLead("ACONDICIONAMIENTO", "Empacar", "Consolida bultos, peso y referencia de rastreo antes del despacho.") + logisticsShipmentTable(rows, "packing");
}

function logisticsRoutesPage(control) {
  const action = hasPermission("logistics.manage") ? '<button id="new-logistics-route" class="button primary">＋ Nueva ruta</button>' : '';
  return logisticsLead("DISTRIBUCIÓN", "Rutas", "Programa trayectos, conductor, vehículo y transportista.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Ruta</th><th>Fecha</th><th>Transportista</th><th>Trayecto</th><th>Embarques</th><th>Estado</th></tr></thead><tbody>' +
    (control.routes.length ? control.routes.map((row) => '<tr><td><strong>' + escapeHtml(row.folio) + ' · ' + escapeHtml(row.name) + '</strong><small>' + escapeHtml([row.driver_name, row.vehicle_plate].filter(Boolean).join(" · ") || "Sin conductor asignado") + '</small></td><td>' + formatDateOnly(row.route_date) + '</td><td>' + escapeHtml(row.carrier_name || "Flota propia / sin asignar") + '</td><td>' + escapeHtml(row.origin || "Origen pendiente") + '<small>→ ' + escapeHtml(row.destination || "Destino pendiente") + '</small></td><td><strong>' + Number(row.delivered_count || 0) + ' / ' + Number(row.shipment_count || 0) + '</strong><small>entregados</small></td><td>' + logisticsStatusBadge(row.status) + '</td></tr>').join("") : '<tr><td colspan="6">' + emptyMarkup("Sin rutas", "Crea la primera ruta para asignar embarques empacados.") + '</td></tr>') + '</tbody></table></div>';
}

function logisticsCarriersPage(control) {
  const action = hasPermission("logistics.manage") ? '<button id="new-logistics-carrier" class="button primary">＋ Nuevo transportista</button>' : '';
  return logisticsLead("RED DE TRANSPORTE", "Transporte", "Administra flota propia y proveedores de entrega.", action) +
    '<section class="logistics-carrier-grid">' + (control.carriers.length ? control.carriers.map((row) => '<article class="panel"><div class="carrier-mark">' + escapeHtml(row.code.slice(0, 2)) + '</div><div><span class="eyebrow">' + escapeHtml(logisticsServiceLabel(row.service_type)) + '</span><h3>' + escapeHtml(row.name) + '</h3><p>' + escapeHtml(row.contact_name || "Sin contacto") + (row.phone ? ' · ' + escapeHtml(row.phone) : '') + '</p><small>' + Number(row.route_count) + ' ruta(s) · ' + Number(row.shipment_count) + ' embarque(s)</small></div></article>').join("") : emptyMarkup("Sin transportistas", "Registra flota propia o un proveedor logístico.")) + '</section>';
}

function logisticsEvidencePage(control) {
  const shipments = control.shipments.filter((row) => !["preparing", "cancelled"].includes(row.status));
  const action = hasPermission("logistics.execute") && shipments.length ? '<button id="new-logistics-evidence" class="button primary">＋ Agregar evidencia</button>' : '';
  return logisticsLead("TRAZABILIDAD DE ENTREGA", "Evidencias", "Conserva fotografías, firmas, documentos y notas del embarque.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Embarque</th><th>Tipo</th><th>Evidencia</th><th>Captura</th><th></th></tr></thead><tbody>' +
    (control.evidence.length ? control.evidence.map((row) => '<tr><td><strong>' + escapeHtml(row.shipment_folio) + '</strong><small>' + escapeHtml(row.order_folio + ' · ' + row.customer_name) + '</small></td><td>' + escapeHtml(logisticsEvidenceLabel(row.evidence_type)) + '</td><td><strong>' + escapeHtml(row.original_name || row.description || "Nota") + '</strong><small>' + escapeHtml(row.description || (row.size_bytes ? formatBytes(row.size_bytes) : "Evidencia registrada")) + '</small></td><td>' + formatDate(row.captured_at) + '</td><td>' + (row.document_id ? '<a class="link-button" href="' + API_BASE + '/api/documents/' + row.document_id + '/download">Descargar</a>' : '') + '</td></tr>').join("") : '<tr><td colspan="5">' + emptyMarkup("Sin evidencias", "Los archivos y firmas de entrega aparecerán aquí.") + '</td></tr>') + '</tbody></table></div>';
}

function logisticsConfirmationPage(control) {
  const rows = control.shipments.filter((row) => ["packed", "in_transit", "delivered"].includes(row.status));
  return logisticsLead("ÚLTIMA MILLA", "Entregas", "Despacha, documenta la recepción y genera automáticamente la entrega de Ventas.") + logisticsShipmentTable(rows, "confirmation");
}

function logisticsShipmentTable(rows, mode) {
  return '<div class="table-wrap"><table><thead><tr><th>Embarque / pedido</th><th>Cliente</th><th>Avance</th><th>Ruta</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (rows.length ? rows.map((row) => '<tr><td><strong>' + escapeHtml(row.folio) + '</strong><small>' + escapeHtml(row.order_folio) + ' · ' + escapeHtml(row.warehouse_code) + '</small></td><td><strong>' + escapeHtml(row.customer_name) + '</strong><small>' + escapeHtml(row.shipping_address || "Sin dirección capturada") + '</small></td><td>' + logisticsProgress(row) + '</td><td>' + escapeHtml(row.route_folio ? row.route_folio + ' · ' + row.route_name : row.carrier_name || "Sin ruta") + '</td><td>' + logisticsStatusBadge(row.status) + '</td><td><div class="table-actions">' + logisticsRowActions(row, mode) + '</div></td></tr>').join("") : '<tr><td colspan="6">' + emptyMarkup("Sin embarques en esta etapa", "Los registros aparecerán conforme avance el flujo.") + '</td></tr>') + '</tbody></table></div>';
}

function logisticsShipmentCard(row) {
  return '<article><div><span class="eyebrow">' + escapeHtml(row.order_folio) + '</span><h3>' + escapeHtml(row.folio + ' · ' + row.customer_name) + '</h3><p>' + escapeHtml(row.shipping_address || "Sin dirección de entrega") + '</p></div><div class="shipment-card-progress">' + logisticsProgress(row) + '</div><div class="table-actions"><button class="link-button" data-logistics-detail="' + row.id + '">Ver</button>' + (hasPermission("logistics.execute") ? '<button class="button primary small" data-logistics-action="start_picking" data-id="' + row.id + '">Iniciar surtido</button>' : '') + '</div></article>';
}

function logisticsRowActions(row, mode) {
  let html = '<button class="link-button" data-logistics-detail="' + row.id + '">Ver</button>';
  if (mode === "picking" && hasPermission("logistics.execute")) {
    if (row.status === "preparing") html += '<button class="link-button" data-logistics-action="start_picking" data-id="' + row.id + '">Iniciar</button>';
    if (row.status === "picking") html += '<button class="link-button" data-logistics-pick="' + row.id + '">Surtir</button><button class="link-button" data-logistics-action="complete_picking" data-id="' + row.id + '">Terminar</button>';
  }
  if (mode === "packing" && hasPermission("logistics.execute") && row.status === "picked") html += '<button class="link-button" data-logistics-pack="' + row.id + '">Empacar</button>';
  if (mode === "packing" && hasPermission("logistics.manage") && row.status === "packed") html += '<button class="link-button" data-logistics-route="' + row.id + '">Asignar ruta</button>';
  if (mode === "confirmation" && hasPermission("logistics.manage") && row.status === "packed") html += '<button class="link-button" data-logistics-route="' + row.id + '">Ruta</button>';
  if (mode === "confirmation" && hasPermission("logistics.execute") && row.status === "packed") html += '<button class="link-button" data-logistics-action="dispatch" data-id="' + row.id + '">Despachar</button>';
  if (mode === "confirmation" && hasPermission("logistics.execute") && row.status === "in_transit") html += '<button class="link-button" data-logistics-evidence="' + row.id + '">Evidencia</button>';
  if (mode === "confirmation" && hasPermission("logistics.confirm") && row.status === "in_transit") html += '<button class="button primary small" data-logistics-confirm="' + row.id + '">Confirmar</button>';
  return html;
}

function logisticsProgress(row) {
  const requested = Number(row.requested_quantity || 0), picked = Number(row.picked_quantity || 0), packed = Number(row.packed_quantity || 0);
  const value = row.status === "delivered" ? 100 : requested ? Math.min(100, Math.round(((picked + packed) / (requested * 2)) * 100)) : 0;
  return '<div class="shipment-progress"><div><span style="width:' + value + '%"></span></div><small>' + inventoryNumber(picked) + ' surtido · ' + inventoryNumber(packed) + ' empacado</small></div>';
}

function bindLogisticsEvents() {
  $("#new-logistics-shipment")?.addEventListener("click", openLogisticsShipmentModal);
  $("#new-logistics-route")?.addEventListener("click", openLogisticsRouteModal);
  $("#new-logistics-carrier")?.addEventListener("click", openLogisticsCarrierModal);
  $("#new-logistics-evidence")?.addEventListener("click", () => openLogisticsEvidenceModal());
  pageContent.onclick = async (event) => {
    const stage = event.target.closest("[data-logistics-stage]");
    if (stage) { state.logisticsHubSection = stage.dataset.logisticsStage; return renderLogistics("logistics_control"); }
    const detail = event.target.closest("[data-logistics-detail]"); if (detail) return openLogisticsDetail(Number(detail.dataset.logisticsDetail));
    const pick = event.target.closest("[data-logistics-pick]"); if (pick) return openLogisticsPickModal(Number(pick.dataset.logisticsPick));
    const pack = event.target.closest("[data-logistics-pack]"); if (pack) return openLogisticsPackModal(Number(pack.dataset.logisticsPack));
    const route = event.target.closest("[data-logistics-route]"); if (route) return openLogisticsRouteAssignModal(Number(route.dataset.logisticsRoute));
    const evidence = event.target.closest("[data-logistics-evidence]"); if (evidence) return openLogisticsEvidenceModal(Number(evidence.dataset.logisticsEvidence));
    const confirmButton = event.target.closest("[data-logistics-confirm]"); if (confirmButton) return openLogisticsConfirmModal(Number(confirmButton.dataset.logisticsConfirm));
    const action = event.target.closest("[data-logistics-action]");
    if (action) return runLogisticsAction(Number(action.dataset.id), action.dataset.logisticsAction);
  };
}

function openLogisticsShipmentModal() {
  const orders = state.logisticsOptions.orders;
  if (!orders.length) return toast("No hay pedidos confirmados disponibles para preparar.", "error");
  $("#entity-modal-content").innerHTML = '<form id="logistics-shipment-form"><div class="modal-head"><div><span class="eyebrow">PREPARACIÓN DE PEDIDO</span><h2>Nuevo embarque</h2><p class="muted">Las partidas pendientes se copiarán desde Ventas.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("EMB-000000", true) + '<div class="form-grid"><label>Pedido confirmado<select name="orderId" id="logistics-order" required>' + orders.map((r) => '<option value="' + r.id + '" data-address="' + escapeAttribute(r.address || "") + '">' + escapeHtml(r.folio + ' · ' + r.customer_name) + ' · Pendiente ' + inventoryNumber(Number(r.ordered_quantity) - Number(r.delivered_quantity)) + '</option>').join("") + '</select></label><label>Almacén de surtido<select name="warehouseId" required>' + logisticsWarehouseOptions() + '</select></label><label>Fecha programada<input name="scheduledDate" type="date" value="' + todayInput() + '" /></label></div><label>Dirección de entrega<textarea name="shippingAddress" id="logistics-address" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Iniciar preparación</button></div></form>';
  const sync = () => { const option = $("#logistics-order").selectedOptions[0]; $("#logistics-address").value = option?.dataset.address || ""; }; $("#logistics-order").onchange = sync; sync();
  bindModuleForm("#logistics-shipment-form", "/api/logistics/shipments", null, "Preparación"); entityDialog.showModal();
}

function openLogisticsCarrierModal() {
  $("#entity-modal-content").innerHTML = '<form id="logistics-carrier-form"><div class="modal-head"><div><span class="eyebrow">TRANSPORTISTAS</span><h2>Nuevo transportista</h2><p class="muted">Datos de contacto y cobertura del servicio.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("TRP-00000", true) + '<div class="form-grid"><label>Nombre<input name="name" required /></label><label>Tipo de servicio<select name="serviceType"><option value="local">Local</option><option value="national">Nacional</option><option value="international">Internacional</option><option value="own_fleet">Flota propia</option></select></label><label>Contacto<input name="contactName" /></label><label>Teléfono<input name="phone" /></label><label>Correo<input name="email" type="email" /></label><label>Tipo de vehículo<input name="vehicleType" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar transportista</button></div></form>';
  bindModuleForm("#logistics-carrier-form", "/api/logistics/carriers", null, "Transportista"); entityDialog.showModal();
}

function openLogisticsRouteModal() {
  $("#entity-modal-content").innerHTML = '<form id="logistics-route-form"><div class="modal-head"><div><span class="eyebrow">RUTA DE ENTREGA</span><h2>Nueva ruta</h2><p class="muted">Programa el trayecto y responsable de transporte.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("RLE-000000", true) + '<div class="form-grid"><label>Nombre de ruta<input name="name" required /></label><label>Fecha<input name="routeDate" type="date" value="' + todayInput() + '" required /></label><label>Transportista<select name="carrierId"><option value="">Flota propia / pendiente</option>' + logisticsCarrierOptions() + '</select></label><label>Conductor<input name="driverName" /></label><label>Placas / unidad<input name="vehiclePlate" /></label><label>Origen<input name="origin" /></label><label>Destino<input name="destination" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar ruta</button></div></form>';
  bindModuleForm("#logistics-route-form", "/api/logistics/routes", null, "Ruta"); entityDialog.showModal();
}

async function openLogisticsDetail(id) {
  try {
    const d = await api("/api/logistics/shipments/" + id), s = d.shipment;
    $("#entity-modal-content").classList.add("wide");
    $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(s.folio) + '</span><h2>' + escapeHtml(s.customer_name) + '</h2><p class="muted">' + escapeHtml(s.order_folio + ' · ' + s.warehouse_name) + '</p></div><button type="button" data-close-modal>×</button></div><section class="logistics-detail-metrics"><div><span>Estado</span>' + logisticsStatusBadge(s.status) + '</div><div><span>Bultos</span><strong>' + Number(s.package_count) + '</strong></div><div><span>Ruta</span><strong>' + escapeHtml(s.route_folio || "Sin ruta") + '</strong></div><div><span>Entrega comercial</span><strong>' + escapeHtml(s.delivery_folio || "Pendiente") + '</strong></div></section><div class="detail-section"><div class="panel-head"><h3>Partidas</h3><span>SOLICITADO, SURTIDO Y EMPACADO</span></div><div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Solicitado</th><th>Surtido</th><th>Empacado</th><th>Origen</th></tr></thead><tbody>' + d.lines.map((r) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.item_name) + '</small></td><td>' + inventoryNumber(r.requested_quantity) + '</td><td>' + inventoryNumber(r.picked_quantity) + '</td><td>' + inventoryNumber(r.packed_quantity) + '</td><td>' + escapeHtml([r.location_code, r.lot_number].filter(Boolean).join(" · ") || "Pendiente") + '</td></tr>').join("") + '</tbody></table></div></div><div class="detail-section"><div class="panel-head"><h3>Evidencias</h3><span>' + d.evidence.length + ' REGISTRO(S)</span></div><div class="compact-list">' + (d.evidence.length ? d.evidence.map((r) => '<div class="maintenance-compact-row"><div><strong>' + escapeHtml(r.original_name || logisticsEvidenceLabel(r.evidence_type)) + '</strong><small>' + escapeHtml(r.description || "Sin descripción") + ' · ' + formatDate(r.captured_at) + '</small></div>' + (r.document_id ? '<a class="link-button" href="' + API_BASE + '/api/documents/' + r.document_id + '/download">Descargar</a>' : '') + '</div>').join("") : emptyMarkup("Sin evidencias", "Aún no se han adjuntado archivos o notas.")) + '</div></div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

async function openLogisticsPickModal(id) {
  try {
    const d = await api("/api/logistics/shipments/" + id), lines = d.lines.filter((r) => Number(r.picked_quantity) + 0.000001 < Number(r.requested_quantity));
    if (!lines.length) return toast("Todas las partidas ya fueron surtidas.");
    $("#entity-modal-content").innerHTML = '<form id="logistics-pick-form"><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(d.shipment.folio) + '</span><h2>Registrar surtido</h2><p class="muted">Selecciona la existencia física utilizada.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid"><label>Partida<select name="lineId" id="logistics-pick-line" required>' + lines.map((r) => '<option value="' + r.id + '" data-item="' + r.item_id + '" data-pending="' + (Number(r.requested_quantity) - Number(r.picked_quantity)) + '">' + escapeHtml(r.sku + ' · ' + r.item_name) + '</option>').join("") + '</select></label><label>Cantidad<input name="quantity" id="logistics-pick-quantity" type="number" min="0.000001" step="0.000001" required /></label><label>Ubicación<select name="locationId" id="logistics-pick-location"><option value="">Sin ubicación</option>' + state.logisticsOptions.locations.filter((r) => r.warehouse_id === d.shipment.warehouse_id).map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join("") + '</select></label><label>Lote<select name="lotId" id="logistics-pick-lot"></select></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar surtido</button></div></form>';
    const sync = () => { const option = $("#logistics-pick-line").selectedOptions[0], item = Number(option.dataset.item); $("#logistics-pick-quantity").value = option.dataset.pending; $("#logistics-pick-lot").innerHTML = '<option value="">Sin lote</option>' + state.logisticsOptions.lots.filter((r) => r.item_id === item).map((r) => '<option value="' + r.id + '">' + escapeHtml(r.lot_number) + '</option>').join(""); }; $("#logistics-pick-line").onchange = sync; sync();
    bindLogisticsActionForm("#logistics-pick-form", id, "pick", "Picking registrado."); entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function openLogisticsPackModal(id) {
  $("#entity-modal-content").innerHTML = '<form id="logistics-pack-form"><div class="modal-head"><div><span class="eyebrow">EMPAQUE</span><h2>Empacar embarque</h2><p class="muted">Consolida todas las partidas surtidas.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid"><label>Número de bultos<input name="packageCount" type="number" min="1" value="1" required /></label><label>Peso total<input name="totalWeight" type="number" min="0" step="0.001" value="0" /></label><label>Número de rastreo<input name="trackingNumber" /></label></div><label>Notas de empaque<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Confirmar empaque</button></div></form>';
  bindLogisticsActionForm("#logistics-pack-form", id, "pack", "Packing registrado."); entityDialog.showModal();
}

function openLogisticsRouteAssignModal(id) {
  if (!state.logisticsOptions.routes.length) return toast("Primero crea una ruta de entrega disponible.", "error");
  $("#entity-modal-content").innerHTML = '<form id="logistics-route-assign-form"><div class="modal-head"><div><span class="eyebrow">PROGRAMACIÓN</span><h2>Asignar ruta</h2><p class="muted">El transportista se tomará de la ruta seleccionada.</p></div><button type="button" data-close-modal>×</button></div><label>Ruta disponible<select name="routeId" required>' + state.logisticsOptions.routes.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio + ' · ' + r.name) + ' · ' + formatDateOnly(r.route_date) + '</option>').join("") + '</select></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Asignar</button></div></form>';
  bindLogisticsActionForm("#logistics-route-assign-form", id, "assign_route", "Ruta asignada."); entityDialog.showModal();
}

function openLogisticsEvidenceModal(shipmentId = null) {
  api("/api/logistics/control").then((control) => {
    const available = control.shipments.filter((r) => !["preparing", "cancelled"].includes(r.status));
    if (!available.length) return toast("No hay embarques disponibles para evidencias.", "error");
    $("#entity-modal-content").innerHTML = '<form id="logistics-evidence-form"><div class="modal-head"><div><span class="eyebrow">EVIDENCIA DE EMBARQUE</span><h2>Agregar evidencia</h2><p class="muted">Archivo local de hasta 8 MB o nota de trazabilidad.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid"><label>Embarque<select name="shipmentId" required>' + available.map((r) => '<option value="' + r.id + '" ' + (r.id === shipmentId ? "selected" : "") + '>' + escapeHtml(r.folio + ' · ' + r.customer_name) + '</option>').join("") + '</select></label><label>Tipo<select name="evidenceType"><option value="photo">Fotografía</option><option value="signature">Firma</option><option value="document">Documento</option><option value="note">Nota</option></select></label><label>Fecha de captura<input name="capturedAt" type="datetime-local" /></label><label>Archivo<input name="evidenceFile" type="file" accept="image/*,.pdf" /></label></div><label>Descripción<textarea name="description" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar evidencia</button></div></form>';
    $("#logistics-evidence-form").onsubmit = submitLogisticsEvidence; entityDialog.showModal();
  }).catch((error) => toast(error.message, "error"));
}

async function submitLogisticsEvidence(event) {
  event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), file = form.evidenceFile.files[0];
  try {
    let documentId = null;
    if (file) {
      const uploaded = await api("/api/documents", { method: "POST", body: { originalName: file.name, module: "logistics", entityType: "logistics_shipment", entityId: form.shipmentId.value, mimeType: file.type || "application/octet-stream", description: form.description.value, contentBase64: await fileToBase64(file) } });
      documentId = uploaded.id;
    }
    await api("/api/logistics/evidence", { method: "POST", body: { shipmentId: form.shipmentId.value, evidenceType: form.evidenceType.value, capturedAt: form.capturedAt.value, description: form.description.value, documentId } });
    entityDialog.close(); toast("Evidencia registrada."); await navigate(state.currentView);
  } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
}

function openLogisticsConfirmModal(id) {
  $("#entity-modal-content").innerHTML = '<form id="logistics-confirm-form"><div class="modal-head"><div><span class="eyebrow">CONFIRMACIÓN DE ENTREGA</span><h2>Registrar recepción</h2><p class="muted">Esto generará la entrega de Ventas y la salida de inventario.</p></div><button type="button" data-close-modal>×</button></div><label>Nombre de quien recibe<input name="receiverName" required /></label><label>Observaciones de entrega<textarea name="notes" rows="4"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Confirmar entrega</button></div></form>';
  bindLogisticsActionForm("#logistics-confirm-form", id, "confirm", "Entrega confirmada y existencias actualizadas."); entityDialog.showModal();
}

function bindLogisticsActionForm(selector, id, action, message) {
  $(selector).onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.action = action; try { await api("/api/logistics/shipments/" + id + "/action", { method: "POST", body }); entityDialog.close(); state.logisticsOptions = null; toast(message); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } };
}

async function runLogisticsAction(id, action) {
  if (action === "dispatch" && !await confirmAction({ eyebrow: "LOGÍSTICA", title: "Enviar embarque a ruta", message: "El embarque cambiará a tránsito y quedará visible para el seguimiento de entrega.", confirmLabel: "Confirmar salida" })) return;
  try { await api("/api/logistics/shipments/" + id + "/action", { method: "POST", body: { action } }); state.logisticsOptions = null; toast("Embarque actualizado."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
}

function logisticsWarehouseOptions(selected = null) { return state.logisticsOptions.warehouses.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join(""); }
function logisticsCarrierOptions(selected = null) { return state.logisticsOptions.carriers.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join(""); }
function logisticsServiceLabel(value) { return ({ local: "Servicio local", national: "Cobertura nacional", international: "Internacional", own_fleet: "Flota propia" })[value] || value; }
function logisticsEvidenceLabel(value) { return ({ photo: "Fotografía", signature: "Firma", document: "Documento", note: "Nota" })[value] || value; }
function logisticsStatusLabel(value) { return ({ preparing: "En preparación", picking: "En picking", picked: "Surtido", packed: "Empacado", in_transit: "En tránsito", delivered: "Entregado", cancelled: "Cancelado", planned: "Planeada", completed: "Completada" })[value] || value; }
function logisticsStatusBadge(value) { const kind = value === "cancelled" ? "danger" : ["preparing", "picking", "planned"].includes(value) ? "warn" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(logisticsStatusLabel(value)) + '</span>'; }

const financeHubConfig = {
  finance_receivables: { label: "Por cobrar", description: "Lo que te deben", symbol: "↙", source: "receivables" },
  finance_payables: { label: "Por pagar", description: "Lo que debes", symbol: "↗", source: "payables" },
  finance_collections: { label: "Cobros", description: "Dinero recibido", symbol: "＋", source: "collections" },
  finance_payments: { label: "Pagos", description: "Dinero entregado", symbol: "−", source: "payments" },
  finance_cost_centers: { label: "Centros", description: "Dónde se gasta", symbol: "◎", source: "costCenters" },
  finance_budgets: { label: "Presupuesto", description: "Cuánto puedes usar", symbol: "▤", source: "budgets" },
  finance_reconciliations: { label: "Conciliar", description: "Comparar saldos", symbol: "⇄", source: "reconciliations" },
};

async function renderFinance(view) {
  const token = beginPageRender();
  if (!state.financeOptions) state.financeOptions = await api("/api/finance/options");
  const control = await api("/api/finance/control");
  if (!renderIsCurrent(token)) return;
  if (view !== "finance_control" && financeHubConfig[view]) state.financeHubSection = view;
  const stage = financeHubConfig[state.financeHubSection] ? state.financeHubSection : "finance_receivables";
  state.financeHubSection = stage;
  pageContent.innerHTML = financeHubHeader(control, stage) + financeMetrics(control.metrics) + '<section class="trade-workspace">' + financePage(stage, control) + '</section>';
  bindFinanceEvents();
}

function financeHubHeader(control, activeStage) {
  const stages = Object.entries(financeHubConfig).map(([key, config]) => ({ key, ...config, count: control[config.source].length }));
  const flow = Number(control.metrics.collected_month) - Number(control.metrics.paid_month);
  return '<section class="trade-hub-topbar"><div><span class="eyebrow">INGRESOS, EGRESOS Y COMPROMISOS</span><h2>Mis finanzas</h2><p>Observa lo que entra, lo que sale y lo que aún está pendiente.</p></div></section>' +
    '<section class="trade-stage-switcher finance-stages" aria-label="Secciones financieras">' + stages.map((stage) => tradeStageCard({ ...stage, active: stage.key === activeStage, module: "finance" })).join("") + '</section>' +
    '<section class="trade-command finance"><div class="trade-command-copy"><span class="trade-live"><i></i> TESORERÍA EN LÍNEA</span><h3>Centro financiero</h3><p>Administra cobranza, pagos, liquidez, presupuestos y bancos desde una misma posición de tesorería.</p><div class="trade-command-stats"><span><strong>' + money(flow, "MXN") + '</strong><small>flujo neto del mes</small></span><span><strong>' + money(control.metrics.payable_balance, "MXN") + '</strong><small>compromisos por pagar</small></span></div></div>' +
    financeTreasuryScene(control, activeStage, flow) + '</section>';
}

function financeTreasuryScene(control, activeStage, flow) {
  const activeLabel = financeHubConfig[activeStage]?.label || "Finanzas";
  const flowClass = flow < 0 ? "negative" : "positive";
  return '<div class="finance-treasury-scene" aria-label="Centro de tesorería con cuentas por cobrar, flujo de caja, cuentas por pagar, presupuesto y conciliación bancaria">' +
    '<div class="finance-treasury-grid"></div><div class="finance-treasury-status"><span>POSICIÓN DE TESORERÍA</span><strong>' + escapeHtml(activeLabel.toUpperCase()) + '</strong><i></i></div>' +
    '<div class="finance-ledger finance-ledger-in"><span>CXC</span><strong>' + control.receivables.length + '</strong><small>CUENTAS POR COBRAR</small><i></i><i></i><i></i><b>CLIENTES</b></div>' +
    '<div class="finance-cash-route"><i></i><i></i><span>$</span></div>' +
    '<div class="finance-bank-console"><span>FLUJO NETO</span><strong class="' + flowClass + '">' + money(flow, "MXN") + '</strong><div class="finance-cash-chart"><i></i><i></i><i></i><i></i><i></i></div><div class="finance-vault"><span>$</span><i></i><i></i><i></i></div><small>CAJA Y BANCOS</small></div>' +
    '<div class="finance-ledger finance-ledger-out"><span>CXP</span><strong>' + control.payables.length + '</strong><small>CUENTAS POR PAGAR</small><i></i><i></i><i></i><b>PROVEEDORES</b></div>' +
    '<div class="finance-budget-dial"><div><span>' + control.budgets.length + '</span></div><strong>PRESUPUESTOS</strong><small>Control autorizado</small></div>' +
    '<div class="finance-reconcile-panel"><span>⇄</span><strong>' + control.reconciliations.length + '</strong><small>CONCILIACIONES</small><i></i><b>BANCO = LIBROS</b></div>' +
    '<div class="trade-scene-caption"><span>Ventas → cobranza → tesorería → pagos → conciliación</span><strong>POSICIÓN ACTUALIZADA</strong></div></div>';
}

function financeMetrics(metrics) {
  const flow = Number(metrics.collected_month) - Number(metrics.paid_month);
  return '<section class="finance-metrics"><article><span>Por cobrar</span><strong>' + money(metrics.receivable_balance, "MXN") + '</strong><small>Saldo de clientes</small></article><article><span>Por pagar</span><strong>' + money(metrics.payable_balance, "MXN") + '</strong><small>Compromisos pendientes</small></article><article><span>Flujo del mes</span><strong class="' + (flow < 0 ? "negative" : "") + '">' + money(flow, "MXN") + '</strong><small>Cobros menos pagos</small></article><article><span>Presupuesto aprobado</span><strong>' + money(metrics.approved_budget, "MXN") + '</strong><small>Ejercicio vigente</small></article></section>';
}

function financePage(view, control) {
  return ({ finance_receivables: financeReceivablesPage, finance_payables: financePayablesPage,
    finance_payments: financePaymentsPage, finance_collections: financeCollectionsPage,
    finance_cost_centers: financeCostCentersPage, finance_budgets: financeBudgetsPage,
    finance_reconciliations: financeReconciliationsPage })[view](control);
}

function financeLead(eyebrow, title, text, action = "") {
  return '<section class="page-lead finance-lead"><div><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2><p>' + text + '</p></div>' + action + '</section>';
}

function financeReceivablesPage(control) {
  return financeLead("INGRESOS COMPROMETIDOS", "Cuentas por cobrar", "Se generan automáticamente al emitir facturas desde Ventas.") +
    '<div class="table-wrap"><table><thead><tr><th>Cuenta / factura</th><th>Cliente</th><th>Vencimiento</th><th>Importe</th><th>Cobrado</th><th>Saldo</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.receivables.length ? control.receivables.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.invoice_folio) + '</small></td><td><strong>' + escapeHtml(r.customer_name) + '</strong><small>' + escapeHtml(r.customer_code) + '</small></td><td>' + (r.due_date ? formatDateOnly(r.due_date) : 'Sin vencimiento') + '</td><td>' + money(r.original_amount, r.currency_code) + '</td><td>' + money(r.paid_amount, r.currency_code) + '</td><td><strong>' + money(r.balance, r.currency_code) + '</strong></td><td>' + financeStatusBadge(r.display_status) + '</td><td>' + (hasPermission("finance.operate") && ["pending", "partial"].includes(r.status) ? '<button class="link-button" data-finance-collection="' + r.id + '">Registrar cobro</button>' : '') + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin cuentas por cobrar", "Las facturas publicadas aparecerán aquí automáticamente.") + '</td></tr>') + '</tbody></table></div>';
}

function financePayablesPage(control) {
  const action = hasPermission("finance.manage") ? '<button id="new-finance-payable" class="button primary">＋ Nueva cuenta por pagar</button>' : '';
  return financeLead("EGRESOS COMPROMETIDOS", "Cuentas por pagar", "Controla facturas y obligaciones pendientes con proveedores.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Cuenta / referencia</th><th>Proveedor</th><th>Centro de costo</th><th>Vencimiento</th><th>Importe</th><th>Saldo</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.payables.length ? control.payables.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.invoice_reference || r.concept) + '</small></td><td><strong>' + escapeHtml(r.supplier_name) + '</strong><small>' + escapeHtml(r.supplier_code) + '</small></td><td>' + escapeHtml(r.cost_center_code ? r.cost_center_code + ' · ' + r.cost_center_name : "Sin asignar") + '</td><td>' + (r.due_date ? formatDateOnly(r.due_date) : 'Sin vencimiento') + '</td><td>' + money(r.original_amount, r.currency_code) + '</td><td><strong>' + money(r.balance, r.currency_code) + '</strong></td><td>' + financeStatusBadge(r.display_status) + '</td><td>' + (hasPermission("finance.operate") && ["pending", "partial"].includes(r.status) ? '<button class="link-button" data-finance-payment="' + r.id + '">Registrar pago</button>' : '') + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin cuentas por pagar", "Registra el primer compromiso con un proveedor.") + '</td></tr>') + '</tbody></table></div>';
}

function financeCollectionsPage(control) {
  const action = hasPermission("finance.operate") && state.financeOptions.receivables.length ? '<button id="new-finance-collection" class="button primary">＋ Nuevo cobro</button>' : '';
  return financeLead("ENTRADAS DE DINERO", "Cobros", "Aplicaciones recibidas de clientes contra facturas pendientes.", action) + financeMovementTable(control.collections, "collection");
}

function financePaymentsPage(control) {
  const action = hasPermission("finance.operate") && state.financeOptions.payables.length ? '<button id="new-finance-payment" class="button primary">＋ Nuevo pago</button>' : '';
  return financeLead("SALIDAS DE DINERO", "Pagos", "Egresos aplicados a compromisos de proveedores.", action) + financeMovementTable(control.payments, "payment");
}

function financeMovementTable(rows, type) {
  const collection = type === "collection";
  return '<div class="table-wrap"><table><thead><tr><th>Movimiento</th><th>' + (collection ? 'Cliente / factura' : 'Proveedor / cuenta') + '</th><th>Fecha</th><th>Método</th><th>Cuenta</th><th>Referencia</th><th>Importe</th></tr></thead><tbody>' +
    (rows.length ? rows.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(collection ? r.receivable_folio : r.payable_folio) + '</small></td><td><strong>' + escapeHtml(collection ? r.customer_name : r.supplier_name) + '</strong><small>' + escapeHtml(collection ? r.invoice_folio : r.cost_center_code || "Sin centro de costo") + '</small></td><td>' + formatDateOnly(collection ? r.collection_date : r.payment_date) + '</td><td>' + escapeHtml(financeMethodLabel(r.payment_method)) + '</td><td>' + escapeHtml(r.bank_account || "No especificada") + '</td><td>' + escapeHtml(r.reference || "—") + '</td><td><strong class="' + (collection ? "amount-in" : "amount-out") + '">' + (collection ? '+' : '−') + money(r.amount, r.currency_code) + '</strong></td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup(collection ? "Sin cobros" : "Sin pagos", "Los movimientos aplicados aparecerán aquí.") + '</td></tr>') + '</tbody></table></div>';
}

function financeCostCentersPage(control) {
  const action = hasPermission("finance.manage") ? '<button id="new-finance-cost-center" class="button primary">＋ Nuevo centro</button>' : '';
  return financeLead("RESPONSABILIDAD FINANCIERA", "Centros de costos", "Agrupa compromisos y gastos por unidad responsable.", action) +
    '<section class="finance-cost-grid">' + (control.costCenters.length ? control.costCenters.map((r) => '<article class="panel"><div class="cost-center-head"><span>' + escapeHtml(r.code) + '</span>' + financeStatusBadge(r.is_active ? "active" : "inactive") + '</div><h3>' + escapeHtml(r.name) + '</h3><p>' + escapeHtml(r.description || (r.parent_name ? "Depende de " + r.parent_name : "Centro de costo principal")) + '</p><dl><div><dt>Comprometido</dt><dd>' + money(r.committed_amount, "MXN") + '</dd></div><div><dt>Pagado</dt><dd>' + money(r.paid_amount, "MXN") + '</dd></div><div><dt>Responsable</dt><dd>' + escapeHtml(r.responsible_name || "Sin asignar") + '</dd></div></dl></article>').join("") : emptyMarkup("Sin centros de costo", "Crea el primero para organizar presupuestos y egresos.")) + '</section>';
}

function financeBudgetsPage(control) {
  const action = hasPermission("finance.manage") ? '<button id="new-finance-budget" class="button primary">＋ Nuevo presupuesto</button>' : '';
  return financeLead("CONTROL PRESUPUESTAL", "Presupuestos", "Compara lo autorizado, comprometido y pagado por centro de costo.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Presupuesto</th><th>Centro / categoría</th><th>Periodo</th><th>Autorizado</th><th>Comprometido</th><th>Pagado</th><th>Disponible</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.budgets.length ? control.budgets.map((r) => { const available = Number(r.amount) - Number(r.committed_amount), ratio = Number(r.amount) ? Math.min(100, Math.round(Number(r.committed_amount) / Number(r.amount) * 100)) : 0; return '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.currency_code) + '</small></td><td><strong>' + escapeHtml(r.cost_center_code + ' · ' + r.cost_center_name) + '</strong><small>' + escapeHtml(r.category) + '</small></td><td>' + escapeHtml(financePeriodLabel(r)) + '</td><td>' + money(r.amount, r.currency_code) + '</td><td>' + money(r.committed_amount, r.currency_code) + '<div class="budget-bar"><span style="width:' + ratio + '%"></span></div></td><td>' + money(r.spent_amount, r.currency_code) + '</td><td><strong class="' + (available < 0 ? "amount-out" : "") + '">' + money(available, r.currency_code) + '</strong></td><td>' + financeStatusBadge(r.status) + '</td><td><div class="table-actions">' + (hasPermission("finance.approve") && r.status === "draft" ? '<button class="link-button" data-finance-budget-action="approve" data-id="' + r.id + '">Aprobar</button>' : '') + (hasPermission("finance.approve") && r.status === "approved" ? '<button class="link-button" data-finance-budget-action="close" data-id="' + r.id + '">Cerrar</button>' : '') + '</div></td></tr>'; }).join("") : '<tr><td colspan="9">' + emptyMarkup("Sin presupuestos", "Define un monto anual o mensual por centro de costo.") + '</td></tr>') + '</tbody></table></div>';
}

function financeReconciliationsPage(control) {
  const action = hasPermission("finance.operate") ? '<button id="new-finance-reconciliation" class="button primary">＋ Nueva conciliación</button>' : '';
  return financeLead("CONTROL DE SALDOS", "Conciliaciones", "Compara el saldo bancario contra los cobros y pagos registrados.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Conciliación</th><th>Cuenta</th><th>Fecha de corte</th><th>Saldo bancario</th><th>Saldo sistema</th><th>Diferencia</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.reconciliations.length ? control.reconciliations.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.reconciled_by_name || "Pendiente de revisión") + '</small></td><td>' + escapeHtml(r.account_name) + '</td><td>' + formatDateOnly(r.statement_date) + '</td><td>' + money(r.statement_balance, "MXN") + '</td><td>' + money(r.system_balance, "MXN") + '</td><td><strong class="' + (Math.abs(Number(r.difference)) > .009 ? "amount-out" : "amount-in") + '">' + money(r.difference, "MXN") + '</strong></td><td>' + financeStatusBadge(r.status) + '</td><td>' + (hasPermission("finance.approve") && r.status === "draft" ? '<button class="link-button" data-finance-reconcile="' + r.id + '" data-difference="' + r.difference + '">Conciliar</button>' : '') + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin conciliaciones", "Registra un corte bancario para comparar los saldos.") + '</td></tr>') + '</tbody></table></div>';
}

function bindFinanceEvents() {
  $("#new-finance-payable")?.addEventListener("click", openFinancePayableModal);
  $("#new-finance-collection")?.addEventListener("click", () => openFinanceCollectionModal());
  $("#new-finance-payment")?.addEventListener("click", () => openFinancePaymentModal());
  $("#new-finance-cost-center")?.addEventListener("click", openFinanceCostCenterModal);
  $("#new-finance-budget")?.addEventListener("click", openFinanceBudgetModal);
  $("#new-finance-reconciliation")?.addEventListener("click", openFinanceReconciliationModal);
  pageContent.onclick = async (event) => {
    const stage = event.target.closest("[data-finance-stage]");
    if (stage) { state.financeHubSection = stage.dataset.financeStage; return renderFinance("finance_control"); }
    const collection = event.target.closest("[data-finance-collection]"); if (collection) return openFinanceCollectionModal(Number(collection.dataset.financeCollection));
    const payment = event.target.closest("[data-finance-payment]"); if (payment) return openFinancePaymentModal(Number(payment.dataset.financePayment));
    const budget = event.target.closest("[data-finance-budget-action]"); if (budget) return runFinanceBudgetAction(Number(budget.dataset.id), budget.dataset.financeBudgetAction);
    const reconcile = event.target.closest("[data-finance-reconcile]"); if (reconcile) return openFinanceReconcileModal(Number(reconcile.dataset.financeReconcile), Number(reconcile.dataset.difference));
  };
}

function openFinanceCostCenterModal() {
  $("#entity-modal-content").innerHTML = '<form id="finance-cost-center-form"><div class="modal-head"><div><span class="eyebrow">CENTRO DE COSTO</span><h2>Nuevo centro</h2><p class="muted">Unidad responsable para compromisos y presupuesto.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("CC-00000", true) + '<div class="form-grid"><label>Nombre<input name="name" required /></label><label>Centro padre<select name="parentId"><option value="">Sin centro padre</option>' + financeCostCenterOptions() + '</select></label></div><label>Descripción<textarea name="description" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar centro</button></div></form>';
  bindModuleForm("#finance-cost-center-form", "/api/finance/cost-centers", null, "Centro de costo"); entityDialog.showModal();
}

function openFinancePayableModal() {
  if (!state.financeOptions.suppliers.length) return toast("Primero registra un proveedor activo.", "error");
  $("#entity-modal-content").innerHTML = '<form id="finance-payable-form"><div class="modal-head"><div><span class="eyebrow">CUENTA POR PAGAR</span><h2>Nuevo compromiso</h2><p class="muted">Factura u obligación pendiente con proveedor.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("CXP-000000", true) + '<div class="form-grid"><label>Proveedor<select name="supplierId" required>' + state.financeOptions.suppliers.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + ' · ' + (r.trade_name || r.legal_name)) + '</option>').join("") + '</select></label><label>Centro de costo<select name="costCenterId"><option value="">Sin asignar</option>' + financeCostCenterOptions() + '</select></label><label>Moneda<select name="currencyId" required>' + financeCurrencyOptions() + '</select></label><label>Referencia de factura<input name="invoiceReference" /></label><label>Concepto<input name="concept" required /></label><label>Categoría<input name="category" value="General" required /></label><label>Importe<input name="amount" type="number" min="0.01" step="0.01" required /></label><label>Fecha de emisión<input name="issueDate" type="date" value="' + todayInput() + '" required /></label><label>Vencimiento<input name="dueDate" type="date" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar cuenta</button></div></form>';
  bindModuleForm("#finance-payable-form", "/api/finance/payables", null, "Cuenta por pagar"); entityDialog.showModal();
}

function openFinanceCollectionModal(id = null) {
  const accounts = state.financeOptions.receivables; if (!accounts.length) return toast("No hay cuentas por cobrar pendientes.", "error");
  $("#entity-modal-content").innerHTML = '<form id="finance-collection-form"><div class="modal-head"><div><span class="eyebrow">COBRO</span><h2>Registrar ingreso</h2><p class="muted">Aplica el importe a una factura pendiente.</p></div><button type="button" data-close-modal>×</button></div>' + financeMovementFields("receivableId", accounts, id, "collection") + '<p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Registrar cobro</button></div></form>';
  bindModuleForm("#finance-collection-form", "/api/finance/collections", null, "Cobro"); entityDialog.showModal();
}

function openFinancePaymentModal(id = null) {
  const accounts = state.financeOptions.payables; if (!accounts.length) return toast("No hay cuentas por pagar pendientes.", "error");
  $("#entity-modal-content").innerHTML = '<form id="finance-payment-form"><div class="modal-head"><div><span class="eyebrow">PAGO</span><h2>Registrar egreso</h2><p class="muted">Aplica el importe a un compromiso pendiente.</p></div><button type="button" data-close-modal>×</button></div>' + financeMovementFields("payableId", accounts, id, "payment") + '<p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Registrar pago</button></div></form>';
  bindModuleForm("#finance-payment-form", "/api/finance/payments", null, "Pago"); entityDialog.showModal();
}

function financeMovementFields(name, accounts, selected, type) {
  const collection = type === "collection", dateName = collection ? "collectionDate" : "paymentDate";
  return '<div class="form-grid"><label>' + (collection ? 'Cuenta por cobrar' : 'Cuenta por pagar') + '<select name="' + name + '" id="finance-movement-account" required>' + accounts.map((r) => '<option value="' + r.id + '" data-balance="' + r.balance + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.folio + ' · ' + (collection ? r.customer_name : r.supplier_name)) + ' · ' + money(r.balance, r.currency_code) + '</option>').join("") + '</select></label><label>Importe<input name="amount" id="finance-movement-amount" type="number" min="0.01" step="0.01" required /></label><label>Fecha<input name="' + dateName + '" type="date" value="' + todayInput() + '" required /></label><label>Método<select name="paymentMethod"><option value="transfer">Transferencia</option><option value="cash">Efectivo</option><option value="card">Tarjeta</option><option value="check">Cheque</option><option value="other">Otro</option></select></label><label>Cuenta bancaria<input name="bankAccount" /></label><label>Referencia<input name="reference" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label>';
}

function openFinanceBudgetModal() {
  if (!state.financeOptions.costCenters.length) return toast("Primero crea un centro de costo.", "error");
  $("#entity-modal-content").innerHTML = '<form id="finance-budget-form"><div class="modal-head"><div><span class="eyebrow">PRESUPUESTO</span><h2>Nuevo presupuesto</h2><p class="muted">Monto autorizado por periodo y categoría.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("PRE-000000", true) + '<div class="form-grid"><label>Centro de costo<select name="costCenterId" required>' + financeCostCenterOptions() + '</select></label><label>Moneda<select name="currencyId" required>' + financeCurrencyOptions() + '</select></label><label>Ejercicio<input name="fiscalYear" type="number" min="2000" max="2200" value="' + new Date().getFullYear() + '" required /></label><label>Periodo<select name="periodType" id="finance-budget-period"><option value="annual">Anual</option><option value="monthly">Mensual</option></select></label><label>Mes<select name="periodNumber" id="finance-budget-month" disabled>' + Array.from({ length: 12 }, (_, i) => '<option value="' + (i + 1) + '">' + new Intl.DateTimeFormat("es-MX", { month: "long" }).format(new Date(2026, i, 1)) + '</option>').join("") + '</select></label><label>Categoría<input name="category" value="General" required /></label><label>Importe<input name="amount" type="number" min="0" step="0.01" required /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar presupuesto</button></div></form>';
  $("#finance-budget-period").onchange = (e) => $("#finance-budget-month").disabled = e.target.value !== "monthly";
  bindModuleForm("#finance-budget-form", "/api/finance/budgets", null, "Presupuesto"); entityDialog.showModal();
}

function openFinanceReconciliationModal() {
  $("#entity-modal-content").innerHTML = '<form id="finance-reconciliation-form"><div class="modal-head"><div><span class="eyebrow">CONCILIACIÓN</span><h2>Nuevo corte bancario</h2><p class="muted">Compara el saldo externo con el flujo registrado.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("CON-000000", true) + '<div class="form-grid"><label>Cuenta bancaria<input name="accountName" required /></label><label>Fecha de corte<input name="statementDate" type="date" value="' + todayInput() + '" required /></label><label>Saldo bancario<input name="statementBalance" type="number" step="0.01" required /></label><label>Saldo del sistema<input name="systemBalance" type="number" step="0.01" placeholder="Se calculará automáticamente" /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear conciliación</button></div></form>';
  bindModuleForm("#finance-reconciliation-form", "/api/finance/reconciliations", null, "Conciliación"); entityDialog.showModal();
}

function openFinanceReconcileModal(id, difference) {
  $("#entity-modal-content").innerHTML = '<form id="finance-reconcile-form"><div class="modal-head"><div><span class="eyebrow">CIERRE DE CONCILIACIÓN</span><h2>Confirmar conciliación</h2><p class="muted">Diferencia detectada: ' + money(difference, "MXN") + '</p></div><button type="button" data-close-modal>×</button></div><label>Explicación o notas de cierre<textarea name="notes" rows="4" ' + (Math.abs(difference) > .009 ? "required" : "") + '></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Conciliar</button></div></form>';
  $("#finance-reconcile-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form); try { await api("/api/finance/reconciliations/" + id + "/action", { method: "POST", body: { action: "reconcile", notes: form.notes.value } }); entityDialog.close(); toast("Conciliación cerrada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }; entityDialog.showModal();
}

async function runFinanceBudgetAction(id, action) {
  if (action === "close" && !await confirmAction({ eyebrow: "FINANZAS", title: "Cerrar presupuesto", message: "El presupuesto quedará cerrado para nuevos movimientos.", confirmLabel: "Cerrar presupuesto", tone: "danger" })) return;
  try { await api("/api/finance/budgets/" + id + "/action", { method: "POST", body: { action } }); toast("Presupuesto actualizado."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
}

function financeCostCenterOptions(selected = null) { return state.financeOptions.costCenters.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join(""); }
function financeCurrencyOptions(selected = null) { return state.financeOptions.currencies.map((r) => '<option value="' + r.id + '" ' + (r.id === selected || (!selected && r.is_base) ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join(""); }
function financeMethodLabel(value) { return ({ cash: "Efectivo", transfer: "Transferencia", card: "Tarjeta", check: "Cheque", other: "Otro" })[value] || value; }
function financePeriodLabel(row) { return row.period_type === "annual" ? 'Anual ' + row.fiscal_year : new Intl.DateTimeFormat("es-MX", { month: "long" }).format(new Date(row.fiscal_year, row.period_number - 1, 1)) + ' ' + row.fiscal_year; }
function financeStatusLabel(value) { return ({ pending: "Pendiente", partial: "Parcial", paid: "Pagado", overdue: "Vencido", cancelled: "Cancelado", draft: "Borrador", approved: "Aprobado", closed: "Cerrado", reconciled: "Conciliado", active: "Activo", inactive: "Inactivo" })[value] || value; }
function financeStatusBadge(value) { const kind = ["overdue", "cancelled", "inactive"].includes(value) ? "danger" : ["pending", "partial", "draft"].includes(value) ? "warn" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(financeStatusLabel(value)) + '</span>'; }

const taskModuleLabels = {
  general: "General", sales: "Ventas", production: "Producción", inventory: "Almacén",
  purchases: "Compras", quality: "Calidad", logistics: "Logística", maintenance: "Mantenimiento",
  finance: "Finanzas", safety: "Seguridad y salud", hr: "Recursos humanos", payroll: "Nómina y CFDI",
};

function taskModuleOptions(selected = "general") {
  return Object.entries(taskModuleLabels).map(([value, label]) => '<option value="' + value + '" ' + (value === selected ? "selected" : "") + '>' + escapeHtml(label) + '</option>').join("");
}

async function ensureTasksOptions() {
  if (!state.tasksOptions) state.tasksOptions = await api("/api/tasks/options");
}

async function appendOperationalTaskPanel(module, view) {
  try {
    const control = await api("/api/tasks/control");
    if (state.currentView !== view) return;
    const openStatuses = new Set(["pending", "in_progress", "submitted"]);
    const tasks = control.tasks.filter((task) => task.module === module && openStatuses.has(task.status));
    const flows = control.flows.filter((flow) => flow.module === module && flow.is_active);
    const overdue = tasks.filter((task) => task.due_date && Number(task.days_remaining) < 0).length;
    const taskRows = tasks.slice(0, 6).map((task) => '<article class="module-workflow-row"><div><span class="eyebrow">' + escapeHtml(task.folio + ' · ' + taskPriorityLabel(task.priority)) + '</span><strong>' + escapeHtml(task.title) + '</strong><small>' + escapeHtml(task.assigned_to_name || "Sin responsable") + ' · ' + (task.due_date ? formatDateOnly(task.due_date) : "Sin fecha límite") + '</small></div>' + taskStatusBadge(task.status) + '<button class="link-button" type="button" data-module-task-detail="' + task.id + '">Ver</button></article>').join("");
    const flowRows = flows.slice(0, 5).map((flow) => '<article class="module-workflow-flow"><div><strong>' + escapeHtml(flow.name) + '</strong><small>' + flow.step_count + ' etapa(s) · ' + escapeHtml(flow.step_summary || "Sin etapas") + '</small></div><button class="link-button" type="button" data-module-flow-detail="' + flow.id + '">Ver</button></article>').join("");
    const actions = (hasPermission("tasks.manage") ? '<button class="button ghost" type="button" data-new-module-flow>＋ Flujo</button><button class="button primary" type="button" data-new-module-task>＋ Tarea</button>' : '') + '<button class="link-button" type="button" data-open-personal-tasks>Ver mis tareas</button>';
    pageContent.insertAdjacentHTML("beforeend", '<section class="panel module-workflow-panel" data-operational-task-panel="' + module + '"><div class="panel-head module-workflow-head"><div><span class="eyebrow">SEGUIMIENTO DE ' + escapeHtml(taskModuleLabels[module].toUpperCase()) + '</span><h3>Tareas y aprobaciones</h3><p>El seguimiento de esta área permanece junto a su operación.</p></div><div class="module-workflow-actions">' + actions + '</div></div><div class="module-workflow-metrics"><div><span>Abiertas</span><strong>' + tasks.length + '</strong></div><div><span>Vencidas</span><strong class="' + (overdue ? 'danger-number' : '') + '">' + overdue + '</strong></div><div><span>Flujos activos</span><strong>' + flows.length + '</strong></div></div><div class="module-workflow-grid"><div><div class="module-workflow-title"><strong>Trabajo pendiente</strong><span>' + tasks.length + '</span></div><div class="module-workflow-list">' + (taskRows || '<div class="module-workflow-empty"><strong>Sin tareas abiertas</strong><small>El área está al día.</small></div>') + '</div></div><div><div class="module-workflow-title"><strong>Rutas de aprobación</strong><span>' + flows.length + '</span></div><div class="module-workflow-list">' + (flowRows || '<div class="module-workflow-empty"><strong>Sin flujos configurados</strong><small>Las tareas pueden administrarse de forma directa.</small></div>') + '</div></div></div></section>');
    const panel = $('[data-operational-task-panel="' + module + '"]', pageContent);
    panel.onclick = async (event) => {
      const task = event.target.closest("[data-module-task-detail]");
      if (task) return openTaskDetail(Number(task.dataset.moduleTaskDetail));
      const flow = event.target.closest("[data-module-flow-detail]");
      if (flow) return openApprovalFlowDetail(Number(flow.dataset.moduleFlowDetail));
      if (event.target.closest("[data-open-personal-tasks]")) return navigate("tasks_assigned");
      if (event.target.closest("[data-new-module-task]")) { try { await ensureTasksOptions(); openTaskModal(module); } catch (error) { toast(error.message, "error"); } return; }
      if (event.target.closest("[data-new-module-flow]")) { try { await ensureTasksOptions(); openApprovalFlowModal(module); } catch (error) { toast(error.message, "error"); } }
    };
  } catch {
    // El área operativa debe seguir disponible aunque el seguimiento temporal no pueda cargarse.
  }
}

async function renderTasks(view) {
  const token = beginPageRender();
  await ensureTasksOptions();
  const control = await api("/api/tasks/control");
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = tasksMetrics(control.metrics) + tasksPage(view, control);
  bindTasksEvents();
}

function tasksMetrics(metrics) {
  return '<section class="tasks-metrics"><article><span>Asignadas abiertas</span><strong>' + metrics.assignedOpen + '</strong><small>Requieren atención</small></article><article><span>Por decidir</span><strong>' + metrics.awaitingApproval + '</strong><small>En aprobación</small></article><article><span>Vencidas</span><strong class="' + (metrics.overdue ? 'danger-number' : '') + '">' + metrics.overdue + '</strong><small>Fuera de fecha</small></article><article><span>Decisiones</span><strong>' + metrics.decided + '</strong><small>Aprobaciones y rechazos</small></article></section>';
}

function tasksPage(view, control) {
  return ({ tasks_assigned: tasksAssignedPage, tasks_flows: tasksFlowsPage, tasks_comments: tasksCommentsPage,
    tasks_rejections: tasksRejectionsPage, tasks_reassignments: tasksReassignmentsPage,
    tasks_deadlines: tasksDeadlinesPage, tasks_history: tasksHistoryPage })[view](control);
}

function tasksLead(eyebrow, title, text, action = "") {
  return '<section class="page-lead tasks-lead"><div><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2><p>' + text + '</p></div>' + action + '</section>';
}

function tasksAssignedPage(control) {
  const action = '<div class="module-workflow-actions">' + (hasPermission("tasks.manage") ? '<button id="open-task-flows" class="button ghost">Flujos del sistema</button><button id="new-workflow-task" class="button primary">＋ Nueva tarea</button>' : '') + '</div>';
  return tasksLead("BANDEJA PERSONAL", "Mis tareas", "Actividades y decisiones que requieren tu atención. El historial permanece dentro de cada tarea.", action) +
    '<section class="tasks-board">' + (control.assigned.length ? control.assigned.map(taskCard).join("") : emptyMarkup("Sin tareas asignadas", "Tu bandeja está al día.")) + '</section>';
}

function taskCard(task) {
  const overdue = task.due_date && Number(task.days_remaining) < 0 && ["pending", "in_progress", "submitted"].includes(task.status);
  return '<article class="panel task-card ' + (overdue ? 'overdue' : '') + '"><div class="task-card-top"><div><span class="eyebrow">' + escapeHtml(task.folio + ' · ' + taskPriorityLabel(task.priority)) + '</span><h3>' + escapeHtml(task.title) + '</h3></div>' + taskStatusBadge(task.status) + '</div><p>' + escapeHtml(task.description || "Sin descripción") + '</p><div class="task-context"><span>' + escapeHtml(task.module.toUpperCase()) + (task.entity_id ? ' · ' + escapeHtml(task.entity_type + ' #' + task.entity_id) : '') + '</span><span>' + escapeHtml(task.flow_name || "Tarea directa") + '</span><span class="' + (overdue ? 'deadline-danger' : '') + '">' + (task.due_date ? formatDateOnly(task.due_date) : "Sin fecha límite") + '</span></div>' + (task.current_step_name ? '<div class="task-step"><span>' + task.current_step + '</span><div><strong>' + escapeHtml(task.current_step_name) + '</strong><small>Etapa actual de aprobación</small></div></div>' : '') + '<div class="task-card-actions">' + taskActions(task) + '</div></article>';
}

function taskActions(task) {
  let html = '<button class="link-button" data-task-detail="' + task.id + '">Ver</button>';
  if (hasPermission("tasks.operate") && ["pending", "in_progress", "submitted"].includes(task.status)) html += '<button class="link-button" data-task-comment="' + task.id + '">Comentar</button><button class="link-button" data-task-action="reassigned" data-id="' + task.id + '">Reasignar</button>';
  if (hasPermission("tasks.operate") && task.status === "pending") html += '<button class="link-button" data-task-quick="started" data-id="' + task.id + '">Iniciar</button>';
  if (hasPermission("tasks.operate") && ["pending", "in_progress"].includes(task.status)) html += task.flow_id ? '<button class="button primary small" data-task-action="submitted" data-id="' + task.id + '">Enviar</button>' : '<button class="button primary small" data-task-action="completed" data-id="' + task.id + '">Completar</button>';
  if (hasPermission("tasks.approve") && task.status === "submitted") html += '<button class="button primary small" data-task-action="approved" data-id="' + task.id + '">Aprobar</button><button class="link-button danger-link" data-task-action="rejected" data-id="' + task.id + '">Rechazar</button>';
  return html;
}

function tasksFlowsPage(control) {
  const action = '<div class="module-workflow-actions"><button id="back-to-personal-tasks" class="button ghost">← Mis tareas</button>' + (hasPermission("tasks.manage") ? '<button id="new-approval-flow" class="button primary">＋ Nuevo flujo</button>' : '') + '</div>';
  return tasksLead("REGLAS DE DECISIÓN", "Flujos de aprobación", "Define etapas, niveles y responsables para decisiones repetibles.", action) +
    '<section class="approval-flow-grid">' + (control.flows.length ? control.flows.map((flow) => '<article class="panel"><div class="flow-card-head"><span>' + escapeHtml(flow.folio) + '</span>' + taskStatusBadge(flow.is_active ? "active" : "inactive") + '</div><h3>' + escapeHtml(flow.name) + '</h3><p>' + escapeHtml(flow.description || "Sin descripción") + '</p><div class="flow-module">' + escapeHtml(flow.module.toUpperCase()) + (flow.entity_type ? ' · ' + escapeHtml(flow.entity_type) : '') + '</div><div class="flow-steps-summary"><strong>' + flow.step_count + ' etapa(s)</strong><small>' + escapeHtml(flow.step_summary || "Sin etapas") + '</small></div><button class="button ghost wide" data-flow-detail="' + flow.id + '">Ver flujo</button></article>').join("") : emptyMarkup("Sin flujos de aprobación", "Crea el primero y define sus responsables.")) + '</section>';
}

function tasksCommentsPage(control) {
  return tasksLead("COLABORACIÓN", "Comentarios", "Conversaciones y observaciones registradas dentro de las tareas.") + tasksEventList(control.comments.map((r) => ({ symbol: "◌", title: r.task_folio + ' · ' + r.task_title, detail: r.comment, meta: (r.created_by_name || "Sistema") + ' · ' + formatDate(r.created_at), kind: r.comment_type })));
}

function tasksRejectionsPage(control) {
  return tasksLead("DECISIONES NEGATIVAS", "Rechazos", "Motivos documentados y responsables de cada rechazo.") +
    '<div class="table-wrap"><table><thead><tr><th>Tarea</th><th>Etapa</th><th>Motivo</th><th>Decidió</th><th>Fecha</th><th></th></tr></thead><tbody>' + (control.rejections.length ? control.rejections.map((r) => '<tr><td><strong>' + escapeHtml(r.task_folio) + '</strong><small>' + escapeHtml(r.task_title) + '</small></td><td>' + (r.step_number || 'Directa') + '</td><td>' + escapeHtml(r.comment || "Sin motivo") + '</td><td>' + escapeHtml(r.decided_by_name || "Sistema") + '</td><td>' + formatDate(r.created_at) + '</td><td><button class="link-button" data-task-detail="' + r.task_id + '">Ver tarea</button></td></tr>').join("") : '<tr><td colspan="6">' + emptyMarkup("Sin rechazos", "No hay decisiones negativas registradas.") + '</td></tr>') + '</tbody></table></div>';
}

function tasksReassignmentsPage(control) {
  return tasksLead("CAMBIOS DE RESPONSABLE", "Reasignaciones", "Trazabilidad de quién transfirió una tarea y por qué.") + tasksEventList(control.reassignments.map((r) => ({ symbol: "↝", title: r.task_folio + ' · ' + r.task_title, detail: (r.from_user_name || "Sin responsable") + ' → ' + (r.to_user_name || "Sin responsable") + (r.comment ? ' · ' + r.comment : ''), meta: (r.decided_by_name || "Sistema") + ' · ' + formatDate(r.created_at) })));
}

function tasksDeadlinesPage(control) {
  return tasksLead("CONTROL DE TIEMPOS", "Fechas límite", "Prioriza actividades vencidas y próximas a vencer.") +
    '<section class="deadline-list">' + (control.deadlines.length ? control.deadlines.map((task) => { const days = Number(task.days_remaining), tone = days < 0 ? 'overdue' : days <= 2 ? 'soon' : ''; return '<article class="' + tone + '"><div class="deadline-date"><strong>' + (days < 0 ? Math.abs(days) : days) + '</strong><span>' + (days < 0 ? 'día(s) vencida' : 'día(s) restante') + '</span></div><div><span class="eyebrow">' + escapeHtml(task.folio + ' · ' + task.assigned_to_name) + '</span><h3>' + escapeHtml(task.title) + '</h3><p>' + escapeHtml(task.module.toUpperCase() + ' · ' + (task.flow_name || "Tarea directa")) + '</p></div>' + taskStatusBadge(task.status) + '<button class="link-button" data-task-detail="' + task.id + '">Ver</button></article>'; }).join("") : emptyMarkup("Sin fechas pendientes", "No hay tareas abiertas con fecha límite.")) + '</section>';
}

function tasksHistoryPage(control) {
  return tasksLead("TRAZABILIDAD COMPLETA", "Historial de decisiones", "Secuencia cronológica de asignaciones, avances y decisiones.") + tasksEventList(control.decisions.map((r) => ({ symbol: taskDecisionSymbol(r.action), title: r.task_folio + ' · ' + taskDecisionLabel(r.action), detail: r.task_title + (r.comment ? ' · ' + r.comment : ''), meta: (r.decided_by_name || "Sistema") + ' · ' + formatDate(r.created_at), taskId: r.task_id })));
}

function tasksEventList(rows) {
  return '<section class="tasks-event-list">' + (rows.length ? rows.map((r) => '<article class="' + escapeHtml(r.kind || '') + '"><span>' + r.symbol + '</span><div><strong>' + escapeHtml(r.title) + '</strong><p>' + escapeHtml(r.detail) + '</p><small>' + escapeHtml(r.meta) + '</small></div>' + (r.taskId ? '<button class="link-button" data-task-detail="' + r.taskId + '">Ver</button>' : '') + '</article>').join("") : emptyMarkup("Sin movimientos", "Los eventos aparecerán conforme avance el trabajo.")) + '</section>';
}

function bindTasksEvents() {
  $("#new-workflow-task")?.addEventListener("click", () => openTaskModal());
  $("#new-approval-flow")?.addEventListener("click", () => openApprovalFlowModal());
  $("#open-task-flows")?.addEventListener("click", () => navigate("tasks_flows"));
  $("#back-to-personal-tasks")?.addEventListener("click", () => navigate("tasks_assigned"));
  pageContent.onclick = async (event) => {
    const detail = event.target.closest("[data-task-detail]"); if (detail) return openTaskDetail(Number(detail.dataset.taskDetail));
    const flow = event.target.closest("[data-flow-detail]"); if (flow) return openApprovalFlowDetail(Number(flow.dataset.flowDetail));
    const comment = event.target.closest("[data-task-comment]"); if (comment) return openTaskCommentModal(Number(comment.dataset.taskComment));
    const action = event.target.closest("[data-task-action]"); if (action) return openTaskActionModal(Number(action.dataset.id), action.dataset.taskAction);
    const quick = event.target.closest("[data-task-quick]"); if (quick) return runTaskAction(Number(quick.dataset.id), quick.dataset.taskQuick);
  };
}

function openTaskModal(defaultModule = "general") {
  $("#entity-modal-content").innerHTML = '<form id="workflow-task-form"><div class="modal-head"><div><span class="eyebrow">TAREA</span><h2>Nueva tarea</h2><p class="muted">Asigna trabajo directo o vincúlalo a un flujo.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("TAR-000000", true) + '<div class="form-grid"><label>Título<input name="title" required /></label><label>Flujo de aprobación<select name="flowId"><option value="">Tarea directa</option>' + taskFlowOptions() + '</select></label><label>Responsable<select name="assignedTo"><option value="">Automático según flujo / creador</option>' + taskUserOptions() + '</select></label><label>Prioridad<select name="priority"><option value="low">Baja</option><option value="medium" selected>Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Fecha límite<input name="dueDate" type="date" /></label><label>Área operativa<select name="module">' + taskModuleOptions(defaultModule) + '</select></label><label>Tipo de registro<input name="entityType" placeholder="pedido, factura, orden…" /></label><label>ID o folio relacionado<input name="entityId" /></label></div><label>Descripción<textarea name="description" rows="4"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear tarea</button></div></form>';
  bindModuleForm("#workflow-task-form", "/api/tasks", null, "Tarea"); entityDialog.showModal();
}

function openApprovalFlowModal(defaultModule = "general") {
  const steps = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="approval-flow-form"><div class="modal-head"><div><span class="eyebrow">FLUJO DE APROBACIÓN</span><h2>Nuevo flujo</h2><p class="muted">Construye la secuencia de decisión de principio a fin.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("FLU-000000", true) + '<div class="form-grid"><label>Nombre<input name="name" required /></label><label>Área operativa<select name="module">' + taskModuleOptions(defaultModule) + '</select></label><label>Tipo de registro<input name="entityType" /></label></div><label>Descripción<textarea name="description" rows="3"></textarea></label><section class="line-builder"><div class="panel-head"><h3>Etapas de aprobación</h3><span>ORDEN, NIVEL Y RESPONSABLE</span></div><div class="approval-step-fields"><label>Etapa<input id="approval-step-name" placeholder="Revisión del supervisor" /></label><label>Nivel requerido<select id="approval-step-level"><option value="1">1 · Consultar</option><option value="2">2 · Crear y editar</option><option value="3" selected>3 · Validar y aprobar</option><option value="4">4 · Administrar</option></select></label><label>Responsable<select id="approval-step-user"><option value="">Se conserva el responsable</option>' + taskUserOptions() + '</select></label><button class="button ghost" type="button" id="add-approval-step">Agregar etapa</button></div><div id="approval-flow-steps"></div></section><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar flujo</button></div></form>';
  const render = () => { $("#approval-flow-steps").innerHTML = steps.length ? '<div class="approval-step-list">' + steps.map((s, i) => '<article><span>' + (i + 1) + '</span><div><strong>' + escapeHtml(s.name) + '</strong><small>Nivel ' + s.requiredLevel + ' · ' + escapeHtml(s.assigneeName || "Responsable actual") + '</small></div><button type="button" class="link-button danger-link" data-remove-approval-step="' + i + '">Quitar</button></article>').join("") + '</div>' : emptyMarkup("Sin etapas", "Agrega al menos una etapa de aprobación."); }; render();
  $("#add-approval-step").onclick = () => { const name = $("#approval-step-name").value.trim(); if (!name) return toast("Captura el nombre de la etapa.", "error"); const user = state.tasksOptions.users.find((u) => u.id === Number($("#approval-step-user").value)); steps.push({ name, requiredLevel: Number($("#approval-step-level").value), defaultAssigneeId: user?.id || null, assigneeName: user?.full_name || "" }); $("#approval-step-name").value = ""; render(); };
  $("#approval-flow-steps").onclick = (event) => { const button = event.target.closest("[data-remove-approval-step]"); if (button) { steps.splice(Number(button.dataset.removeApprovalStep), 1); render(); } };
  bindModuleForm("#approval-flow-form", "/api/tasks/flows", () => ({ steps }), "Flujo"); entityDialog.showModal();
}

async function openApprovalFlowDetail(id) {
  try { const d = await api("/api/tasks/flows/" + id); $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(d.flow.folio) + '</span><h2>' + escapeHtml(d.flow.name) + '</h2><p class="muted">' + escapeHtml(d.flow.module.toUpperCase() + (d.flow.entity_type ? ' · ' + d.flow.entity_type : '')) + '</p></div><button type="button" data-close-modal>×</button></div><div class="flow-detail-steps">' + d.steps.map((s) => '<article><span>' + s.sequence + '</span><div><strong>' + escapeHtml(s.name) + '</strong><small>Nivel ' + s.required_level + ' · ' + escapeHtml(s.default_assignee_name || "Conservar responsable actual") + '</small><p>' + escapeHtml(s.instructions || "Sin instrucciones adicionales") + '</p></div></article>').join("") + '</div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>'; entityDialog.showModal(); } catch (error) { toast(error.message, "error"); }
}

async function openTaskDetail(id) {
  try { const d = await api("/api/tasks/" + id), t = d.task; $("#entity-modal-content").classList.add("wide"); $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(t.folio) + '</span><h2>' + escapeHtml(t.title) + '</h2><p class="muted">' + escapeHtml(t.assigned_to_name + ' · ' + t.module.toUpperCase()) + '</p></div><button type="button" data-close-modal>×</button></div><section class="task-detail-metrics"><div><span>Estado</span>' + taskStatusBadge(t.status) + '</div><div><span>Prioridad</span><strong>' + escapeHtml(taskPriorityLabel(t.priority)) + '</strong></div><div><span>Fecha límite</span><strong>' + (t.due_date ? formatDateOnly(t.due_date) : "Sin fecha") + '</strong></div><div><span>Flujo</span><strong>' + escapeHtml(t.flow_name || "Directa") + '</strong></div></section><div class="task-description">' + escapeHtml(t.description || "Sin descripción") + '</div>' + (d.steps.length ? '<div class="detail-section"><div class="panel-head"><h3>Ruta de aprobación</h3><span>ETAPA ' + t.current_step + '</span></div><div class="task-route">' + d.steps.map((s) => '<div class="' + (s.sequence < t.current_step ? "done" : s.sequence === t.current_step ? "current" : "") + '"><span>' + s.sequence + '</span><strong>' + escapeHtml(s.name) + '</strong><small>' + escapeHtml(s.default_assignee_name || "Responsable actual") + '</small></div>').join("") + '</div></div>' : '') + '<div class="task-detail-grid"><div class="detail-section"><div class="panel-head"><h3>Comentarios</h3><span>' + d.comments.length + '</span></div>' + tasksEventList(d.comments.map((r) => ({ symbol: "◌", title: r.created_by_name || "Sistema", detail: r.comment, meta: formatDate(r.created_at), kind: r.comment_type }))) + '</div><div class="detail-section"><div class="panel-head"><h3>Decisiones</h3><span>' + d.decisions.length + '</span></div>' + tasksEventList(d.decisions.map((r) => ({ symbol: taskDecisionSymbol(r.action), title: taskDecisionLabel(r.action), detail: r.comment || (r.to_user_name ? 'Responsable: ' + r.to_user_name : "Sin observaciones"), meta: (r.decided_by_name || "Sistema") + ' · ' + formatDate(r.created_at) }))) + '</div></div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>'; entityDialog.showModal(); } catch (error) { toast(error.message, "error"); }
}

function openTaskCommentModal(id) {
  $("#entity-modal-content").innerHTML = '<form id="task-comment-form"><div class="modal-head"><div><span class="eyebrow">COMENTARIO</span><h2>Agregar comentario</h2><p class="muted">La conversación quedará en el historial.</p></div><button type="button" data-close-modal>×</button></div><label>Comentario<textarea name="comment" rows="5" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Publicar</button></div></form>';
  $("#task-comment-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form); try { await api("/api/tasks/" + id + "/comments", { method: "POST", body: { comment: form.comment.value } }); entityDialog.close(); toast("Comentario agregado."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }; entityDialog.showModal();
}

function openTaskActionModal(id, action) {
  const titles = { submitted: "Enviar a aprobación", approved: "Aprobar tarea", rejected: "Rechazar tarea", reassigned: "Reasignar tarea", completed: "Completar tarea" };
  const needsComment = ["rejected", "reassigned"].includes(action);
  const userField = action === "reassigned" ? '<label>Nuevo responsable<select name="toUserId" required>' + taskUserOptions() + '</select></label>' : '';
  $("#entity-modal-content").innerHTML = '<form id="task-action-form"><div class="modal-head"><div><span class="eyebrow">TAREA</span><h2>' + titles[action] + '</h2><p class="muted">La acción quedará registrada con fecha y usuario.</p></div><button type="button" data-close-modal>×</button></div>' + userField + '<label>' + (needsComment ? 'Motivo' : 'Comentario opcional') + '<textarea name="comment" rows="4" ' + (needsComment ? "required" : "") + '></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Confirmar</button></div></form>';
  $("#task-action-form").onsubmit = async (event) => { event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.action = action; try { await api("/api/tasks/" + id + "/action", { method: "POST", body }); entityDialog.close(); state.tasksOptions = null; toast("Tarea actualizada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); } }; entityDialog.showModal();
}

async function runTaskAction(id, action) {
  try { await api("/api/tasks/" + id + "/action", { method: "POST", body: { action } }); toast("Tarea actualizada."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
}

function taskUserOptions(selected = null) { return state.tasksOptions.users.map((u) => '<option value="' + u.id + '" ' + (u.id === selected ? "selected" : "") + '>' + escapeHtml(u.full_name + ' · Nivel ' + u.max_level) + '</option>').join(""); }
function taskFlowOptions(selected = null) { return state.tasksOptions.flows.map((f) => '<option value="' + f.id + '" ' + (f.id === selected ? "selected" : "") + '>' + escapeHtml(f.folio + ' · ' + f.name) + ' · ' + f.step_count + ' etapa(s)</option>').join(""); }
function taskPriorityLabel(value) { return ({ low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" })[value] || value; }
function taskStatusLabel(value) { return ({ pending: "Pendiente", in_progress: "En proceso", submitted: "Por aprobar", approved: "Aprobada", rejected: "Rechazada", completed: "Completada", cancelled: "Cancelada", active: "Activo", inactive: "Inactivo" })[value] || value; }
function taskStatusBadge(value) { const kind = ["rejected", "cancelled", "inactive"].includes(value) ? "danger" : ["pending", "submitted"].includes(value) ? "warn" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(taskStatusLabel(value)) + '</span>'; }
function taskDecisionLabel(value) { return ({ assigned: "Asignada", started: "Iniciada", commented: "Comentario", submitted: "Enviada a aprobación", approved: "Aprobada", rejected: "Rechazada", reassigned: "Reasignada", completed: "Completada", cancelled: "Cancelada" })[value] || value; }
function taskDecisionSymbol(value) { return ({ assigned: "→", started: "▶", commented: "◌", submitted: "↑", approved: "✓", rejected: "×", reassigned: "↝", completed: "●", cancelled: "−" })[value] || "·"; }

function salesCustomerOptions(selected = null) { return state.salesOptions.customers.map((row) => `<option value="${row.id}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row.code)} · ${escapeHtml(row.trade_name || row.legal_name)}</option>`).join(""); }
function salesCurrencyOptions(selected = null) { return `<option value="">Selecciona moneda</option>${state.salesOptions.currencies.map((row) => `<option value="${row.id}" ${row.id === selected ? "selected" : ""}>${escapeHtml(row.code)} · ${escapeHtml(row.name)}</option>`).join("")}`; }
function salesItemOptions() { return `<option value="">Selecciona un artículo</option>${state.salesOptions.items.map((row) => `<option value="${row.id}">${escapeHtml(row.sku)} · ${escapeHtml(row.name)}</option>`).join("")}`; }
function salesStageOptions(selected) { const labels = { new: "Nuevo", contacted: "Contactado", qualified: "Calificado", proposal: "Propuesta", won: "Ganado", lost: "Perdido" }; return Object.entries(labels).map(([value, label]) => `<option value="${value}" ${value === selected ? "selected" : ""}>${label}</option>`).join(""); }
function salesStatusLabel(status) { return ({ new: "Nuevo", contacted: "Contactado", qualified: "Calificado", proposal: "Propuesta", won: "Ganado", lost: "Perdido", draft: "Borrador", sent: "Enviada", accepted: "Aceptada", rejected: "Rechazada", confirmed: "Confirmado", partially_fulfilled: "Surtido parcial", fulfilled: "Surtido", posted: "Publicado", cancelled: "Cancelado", paid: "Pagado" })[status] || status; }
function salesStatusBadge(status) { const warning = ["lost", "rejected", "cancelled"].includes(status); return `<span class="badge ${warning ? "warn" : ""}">● ${escapeHtml(salesStatusLabel(status))}</span>`; }

const purchaseHubConfig = {
  purchases_requests: { label: "Pedir", title: "Solicitudes", description: "Anota lo que hace falta", symbol: "＋", source: "requests", action: "request", actionLabel: "Nueva solicitud", permission: "purchases.manage" },
  purchases_comparisons: { label: "Comparar", title: "Proveedores", description: "Elige la mejor opción", symbol: "≋", source: "comparisons", action: "comparison", actionLabel: "Comparar ofertas", permission: "purchases.manage" },
  purchases_orders: { label: "Comprar", title: "Órdenes", description: "Confirma la compra", symbol: "▣", source: "orders", action: "order", actionLabel: "Nueva orden", permission: "purchases.manage" },
  purchases_receipts: { label: "Recibir", title: "Recepciones", description: "Carga lo que llegó", symbol: "↘", source: "receipts", action: "receipt", actionLabel: "Recibir compra", permission: "purchases.receive" },
  purchases_returns: { label: "Devolver", title: "Devoluciones", description: "Regresa material", symbol: "↶", source: "returns", action: "return", actionLabel: "Nueva devolución", permission: "purchases.receive" },
  purchases_invoices: { label: "Facturas", title: "Facturas", description: "Registra lo que debes", symbol: "$", source: "invoices", action: "invoice", actionLabel: "Registrar factura", permission: "purchases.receive" },
};

async function renderPurchases(view) {
  const token = beginPageRender();
  if (!state.purchasesOptions) state.purchasesOptions = await api("/api/purchases/options");
  const control = await api("/api/purchases/control");
  if (!renderIsCurrent(token)) return;
  if (view !== "purchases_control" && purchaseHubConfig[view]) state.purchaseHubSection = view;
  const stage = purchaseHubConfig[state.purchaseHubSection] ? state.purchaseHubSection : "purchases_requests";
  state.purchaseHubSection = stage;
  pageContent.innerHTML = purchaseHubHeader(control, stage) + purchaseMetrics(control.metrics) + `<section id="purchase-workspace" class="trade-workspace">${purchasePage(stage, control)}</section>`;
  bindPurchaseEvents();
}

function purchaseHubHeader(control, activeStage) {
  const config = purchaseHubConfig[activeStage];
  const stageOptions = Object.entries(purchaseHubConfig).map(([key, stage]) => '<option value="' + key + '" ' + (key === activeStage ? "selected" : "") + '>' + escapeHtml(stage.label + " · " + stage.title) + '</option>').join("");
  const primary = hasPermission(config.permission) ? `<button type="button" class="button trade-primary" data-purchase-create="${config.action}">＋ ${escapeHtml(config.actionLabel)}</button>` : "";
  return `<section class="trade-hub-topbar purchase-hub-topbar"><div><span class="eyebrow">TODO EL RECORRIDO DE ABASTECIMIENTO</span><h2>Mis compras</h2><p>Solicita, compara, compra y recibe materiales desde una sola pantalla.</p></div><label class="purchase-view-selector"><span>VISTA DE COMPRAS</span><select id="purchase-stage-select" aria-label="Seleccionar vista de compras">${stageOptions}</select></label></section>
    <section class="trade-command purchase"><div class="trade-command-copy"><span class="trade-live"><i></i> MESA DE ABASTECIMIENTO</span><h3>${escapeHtml(config.title)}</h3><p>Convierte necesidades internas en compras autorizadas, compara costo y plazo, y acompaña al proveedor hasta la recepción.</p><div class="trade-command-stats"><span><strong>${control[config.source].length}</strong><small>registros en ${escapeHtml(config.label.toLowerCase())}</small></span><span><strong>${control.metrics.openOrders}</strong><small>órdenes por recibir</small></span></div><div class="trade-command-actions">${primary}</div></div>${purchaseOperationsScene(control, config)}</section>`;
}

function purchaseOperationsScene(control, config) {
  const pendingRequests = control.metrics.pendingRequests;
  const openOrders = control.metrics.openOrders;
  return '<div class="purchase-desk" aria-label="Mesa de abastecimiento con requisición, comparación de proveedores, orden de compra y recepción">' +
    '<div class="purchase-desk-grid"></div><div class="purchase-stage-monitor"><span>ETAPA ACTUAL</span><strong>' + escapeHtml(config.label.toUpperCase()) + '</strong><i></i></div>' +
    '<div class="purchase-requisition"><span>REQ</span><strong>' + pendingRequests + '</strong><small>PENDIENTES</small><i></i><i></i><i></i><b>SOLICITUD INTERNA</b></div>' +
    '<div class="purchase-flow-line"><i></i><i></i><i></i><span>DOC</span></div>' +
    '<div class="purchase-quotes"><strong>COMPARATIVO</strong><small>COSTO · PLAZO · CALIDAD</small><div><article><span>A</span><i></i><i></i></article><article class="selected"><span>B</span><i></i><i></i><b>✓</b></article><article><span>C</span><i></i><i></i></article></div></div>' +
    '<div class="purchase-order-paper"><span>OC</span><strong>' + openOrders + '</strong><small>ABIERTAS</small><i></i><i></i><b>AUTORIZADA</b></div>' +
    '<div class="purchase-inbound"><div class="purchase-inbound-dock"><span>RECIBO</span><i></i></div><div class="purchase-inbound-truck"><i></i><b></b><b></b></div><strong>EN TRÁNSITO</strong><small>Proveedor → almacén</small></div>' +
    '<div class="trade-scene-caption"><span>Requisición → proveedores → orden de compra → recepción</span><strong>ABASTECIMIENTO ACTIVO</strong></div></div>';
}

function purchaseMetrics(metrics) {
  return '<section class="purchase-metrics"><article><span>Solicitudes pendientes</span><strong>' + metrics.pendingRequests + '</strong><small>Borradores y por aprobar</small></article><article><span>Órdenes abiertas</span><strong>' + metrics.openOrders + '</strong><small>En espera de recepción</small></article><article><span>Cantidad pendiente</span><strong>' + inventoryNumber(metrics.pendingQuantity) + '</strong><small>Unidades por recibir</small></article><article><span>Total facturado</span><strong>' + money(metrics.invoicedTotal, "MXN") + '</strong><small>Facturas registradas</small></article></section>';
}

function purchasePage(view, control) {
  return ({
    purchases_requests: purchaseRequestsPage,
    purchases_comparisons: purchaseComparisonsPage,
    purchases_orders: purchaseOrdersPage,
    purchases_receipts: purchaseReceiptsPage,
    purchases_returns: purchaseReturnsPage,
    purchases_invoices: purchaseInvoicesPage,
  })[view](control);
}

function purchaseLead(eyebrow, title, text, action = "") {
  return '<section class="page-lead purchase-lead"><div><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2><p>' + text + '</p></div></section>';
}

function purchaseRequestsPage(control) {
  const action = hasPermission("purchases.manage") ? '<button id="new-purchase-request" class="button primary">＋ Nueva solicitud</button>' : "";
  return purchaseLead("INICIO DE LA ADQUISICIÓN", "Solicitudes", "Define qué se necesita, cuándo y para qué centro de costo.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Solicitud</th><th>Solicitante</th><th>Centro de costo</th><th>Fecha requerida</th><th>Partidas</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.requests.length ? control.requests.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(purchasePriorityLabel(r.priority)) + '</small></td><td>' + escapeHtml(r.requester_name) + '</td><td>' + escapeHtml(r.cost_center_code ? r.cost_center_code + ' · ' + r.cost_center_name : "Sin asignar") + '</td><td>' + (r.required_date ? formatDateOnly(r.required_date) : "Sin fecha") + '</td><td>' + r.line_count + ' · ' + inventoryNumber(r.total_quantity) + ' unidad(es)</td><td>' + purchaseStatusBadge(r.status) + '</td><td><div class="table-actions"><button class="link-button" data-purchase-detail="request" data-id="' + r.id + '">Ver</button>' + purchaseRequestActions(r) + '</div></td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup("Sin solicitudes", "Crea la primera necesidad de compra.") + '</td></tr>') + '</tbody></table></div>';
}

function purchaseRequestActions(row) {
  let html = "";
  if (hasPermission("purchases.manage") && row.status === "draft") html += '<button class="link-button" data-purchase-request-action="submit" data-id="' + row.id + '">Enviar</button>';
  if (hasPermission("purchases.approve") && row.status === "submitted") html += '<button class="link-button" data-purchase-request-action="approve" data-id="' + row.id + '">Aprobar</button><button class="link-button danger-link" data-purchase-request-action="reject" data-id="' + row.id + '">Rechazar</button>';
  return html;
}

function purchaseComparisonsPage(control) {
  const action = hasPermission("purchases.manage") && state.purchasesOptions.requests.length && state.purchasesOptions.suppliers.length > 1 ? '<button id="new-purchase-comparison" class="button primary">＋ Nueva comparación</button>' : "";
  return purchaseLead("EVALUACIÓN DE OFERTAS", "Comparar proveedores", "Compara importe, crédito y tiempo de entrega antes de elegir.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Comparación</th><th>Solicitud</th><th>Ofertas</th><th>Rango cotizado</th><th>Proveedor elegido</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.comparisons.length ? control.comparisons.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + formatDate(r.created_at) + '</small></td><td>' + escapeHtml(r.request_folio) + '</td><td>' + r.offer_count + '</td><td>' + money(r.lowest_amount || 0) + ' — ' + money(r.highest_amount || 0) + '</td><td>' + escapeHtml(r.selected_supplier_name || "Pendiente") + '</td><td>' + purchaseStatusBadge(r.status) + '</td><td><button class="link-button" data-purchase-detail="comparison" data-id="' + r.id + '">Ver y decidir</button></td></tr>').join("") : '<tr><td colspan="7">' + emptyMarkup("Sin comparaciones", "Registra dos o más propuestas para evaluarlas.") + '</td></tr>') + '</tbody></table></div>';
}

function purchaseOrdersPage(control) {
  const action = hasPermission("purchases.manage") && state.purchasesOptions.requests.length ? '<button id="new-purchase-order" class="button primary">＋ Nueva orden</button>' : "";
  return purchaseLead("COMPROMISO CON PROVEEDOR", "Órdenes", "Controla aprobación, importes y avance de recepción.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Orden</th><th>Proveedor</th><th>Origen</th><th>Emisión / entrega</th><th>Avance</th><th>Total</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.orders.length ? control.orders.map((r) => { const pct = Number(r.ordered_quantity) ? Math.min(100, Math.round(Number(r.received_quantity) / Number(r.ordered_quantity) * 100)) : 0; return '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + r.line_count + ' partida(s)</small></td><td><strong>' + escapeHtml(r.supplier_name) + '</strong><small>' + escapeHtml(r.supplier_code) + '</small></td><td>' + escapeHtml(r.request_folio + (r.comparison_folio ? ' · ' + r.comparison_folio : '')) + '</td><td>' + formatDateOnly(r.issue_date) + '<small>' + (r.expected_date ? 'Esperada ' + formatDateOnly(r.expected_date) : "Sin fecha esperada") + '</small></td><td><strong>' + pct + '%</strong><div class="purchase-progress"><span style="width:' + pct + '%"></span></div><small>' + inventoryNumber(r.received_quantity) + ' de ' + inventoryNumber(r.ordered_quantity) + '</small></td><td><strong>' + money(r.total, r.currency_code) + '</strong></td><td>' + purchaseStatusBadge(r.status) + '</td><td><div class="table-actions"><button class="link-button" data-purchase-detail="order" data-id="' + r.id + '">Ver</button>' + (hasPermission("purchases.approve") && r.status === "draft" ? '<button class="link-button" data-purchase-order-action="approve" data-id="' + r.id + '">Aprobar</button>' : '') + (hasPermission("purchases.approve") && r.status === "received" ? '<button class="link-button" data-purchase-order-action="close" data-id="' + r.id + '">Cerrar</button>' : '') + '</div></td></tr>'; }).join("") : '<tr><td colspan="8">' + emptyMarkup("Sin órdenes", "Convierte una solicitud aprobada en orden de compra.") + '</td></tr>') + '</tbody></table></div>';
}

function purchaseReceiptsPage(control) {
  const available = state.purchasesOptions.orders.filter((r) => ["approved", "partially_received"].includes(r.status));
  const action = hasPermission("purchases.receive") && available.length ? '<button id="new-purchase-receipt" class="button primary">＋ Nueva recepción</button>' : "";
  return purchaseLead("ENTRADA DE MATERIALES", "Recepciones", "Registra entregas parciales o completas y actualiza existencias.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Recepción</th><th>Orden</th><th>Proveedor</th><th>Almacén</th><th>Fecha</th><th>Cantidad</th><th>Estado</th><th></th></tr></thead><tbody>' +
    (control.receipts.length ? control.receipts.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.supplier_reference || "Sin referencia") + '</small></td><td>' + escapeHtml(r.order_folio) + '</td><td>' + escapeHtml(r.supplier_name) + '</td><td>' + escapeHtml(r.warehouse_code + ' · ' + r.warehouse_name) + '</td><td>' + formatDateOnly(r.receipt_date) + '</td><td>' + inventoryNumber(r.total_quantity) + ' · ' + r.line_count + ' partida(s)</td><td>' + purchaseStatusBadge(r.status) + '</td><td><button class="link-button" data-purchase-detail="receipt" data-id="' + r.id + '">Ver</button></td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin recepciones", "Las entradas de órdenes aprobadas aparecerán aquí.") + '</td></tr>') + '</tbody></table></div>';
}

function purchaseReturnsPage(control) {
  const action = hasPermission("purchases.receive") && state.purchasesOptions.receipts.length ? '<button id="new-purchase-return" class="button primary">＋ Nueva devolución</button>' : "";
  return purchaseLead("RETORNO A PROVEEDOR", "Devoluciones", "Devuelve material recibido y descuéntalo de la existencia disponible.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Devolución</th><th>Recepción / orden</th><th>Proveedor</th><th>Almacén</th><th>Fecha</th><th>Cantidad</th><th>Motivo</th><th>Estado</th></tr></thead><tbody>' +
    (control.returns.length ? control.returns.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td><strong>' + escapeHtml(r.receipt_folio) + '</strong><small>' + escapeHtml(r.order_folio) + '</small></td><td>' + escapeHtml(r.supplier_name) + '</td><td>' + escapeHtml(r.warehouse_code) + '</td><td>' + formatDateOnly(r.return_date) + '</td><td>' + inventoryNumber(r.total_quantity) + ' · ' + r.line_count + ' partida(s)</td><td>' + escapeHtml(r.reason) + '</td><td>' + purchaseStatusBadge(r.status) + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin devoluciones", "Aquí se mostrará el material retornado a proveedor.") + '</td></tr>') + '</tbody></table></div>';
}

function purchaseInvoicesPage(control) {
  const action = hasPermission("purchases.receive") && state.purchasesOptions.orders.length ? '<button id="new-purchase-invoice" class="button primary">＋ Nueva factura</button>' : "";
  return purchaseLead("DOCUMENTO DEL PROVEEDOR", "Facturas", "Registra la factura y genera automáticamente la cuenta por pagar.", action) +
    '<div class="table-wrap"><table><thead><tr><th>Factura interna</th><th>Proveedor</th><th>Orden</th><th>Referencia</th><th>Emisión / vencimiento</th><th>Total</th><th>Cuenta por pagar</th><th>Estado</th></tr></thead><tbody>' +
    (control.invoices.length ? control.invoices.map((r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td><strong>' + escapeHtml(r.supplier_name) + '</strong><small>' + escapeHtml(r.supplier_code) + '</small></td><td>' + escapeHtml(r.order_folio) + '</td><td>' + escapeHtml(r.supplier_invoice_reference) + '</td><td>' + formatDateOnly(r.issue_date) + '<small>' + (r.due_date ? 'Vence ' + formatDateOnly(r.due_date) : "Sin vencimiento") + '</small></td><td><strong>' + money(r.total, r.currency_code) + '</strong></td><td><strong>' + escapeHtml(r.payable_folio || "Pendiente") + '</strong><small>' + (r.payable_folio ? purchaseStatusLabel(r.payable_status) + ' · ' + money(r.payable_balance, r.currency_code) : "") + '</small></td><td>' + purchaseStatusBadge(r.status) + '</td></tr>').join("") : '<tr><td colspan="8">' + emptyMarkup("Sin facturas de proveedor", "Al registrarlas se enlazarán con Finanzas.") + '</td></tr>') + '</tbody></table></div>';
}

function bindPurchaseEvents() {
  $("#new-purchase-request")?.addEventListener("click", openPurchaseRequestModal);
  $("#new-purchase-comparison")?.addEventListener("click", openPurchaseComparisonModal);
  $("#new-purchase-order")?.addEventListener("click", openPurchaseOrderModal);
  $("#new-purchase-receipt")?.addEventListener("click", openPurchaseReceiptModal);
  $("#new-purchase-return")?.addEventListener("click", openPurchaseReturnModal);
  $("#new-purchase-invoice")?.addEventListener("click", openPurchaseInvoiceModal);
  $("#purchase-stage-select")?.addEventListener("change", (event) => {
    state.purchaseHubSection = event.target.value;
    renderPurchases("purchases_control");
  });
  pageContent.onclick = (event) => {
    const create = event.target.closest("[data-purchase-create]");
    if (create) return ({ request: openPurchaseRequestModal, comparison: openPurchaseComparisonModal, order: openPurchaseOrderModal, receipt: openPurchaseReceiptModal, return: openPurchaseReturnModal, invoice: openPurchaseInvoiceModal })[create.dataset.purchaseCreate]();
    const detail = event.target.closest("[data-purchase-detail]"); if (detail) return openPurchaseDetail(detail.dataset.purchaseDetail, Number(detail.dataset.id));
    const requestAction = event.target.closest("[data-purchase-request-action]"); if (requestAction) return runPurchaseRequestAction(Number(requestAction.dataset.id), requestAction.dataset.purchaseRequestAction);
    const orderAction = event.target.closest("[data-purchase-order-action]"); if (orderAction) return runPurchaseOrderAction(Number(orderAction.dataset.id), orderAction.dataset.purchaseOrderAction);
  };
}

function purchaseStatusLabel(value) {
  return ({ draft: "Borrador", submitted: "Por aprobar", approved: "Aprobada", rejected: "Rechazada", converted: "Convertida", cancelled: "Cancelada", selected: "Proveedor elegido", partially_received: "Recepción parcial", received: "Recibida", closed: "Cerrada", posted: "Aplicada", pending: "Pendiente", partial: "Parcial", paid: "Pagada" })[value] || value;
}
function purchaseStatusBadge(value) { const kind = ["rejected", "cancelled"].includes(value) ? "danger" : ["draft", "submitted", "partially_received", "pending", "partial"].includes(value) ? "warn" : ""; return '<span class="badge ' + kind + '">● ' + escapeHtml(purchaseStatusLabel(value)) + '</span>'; }
function purchasePriorityLabel(value) { return ({ low: "Prioridad baja", medium: "Prioridad media", high: "Prioridad alta", critical: "Prioridad crítica" })[value] || value; }
function purchaseSupplierOptions(selected = null) { return state.purchasesOptions.suppliers.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + (r.trade_name || r.legal_name)) + '</option>').join(""); }
function purchaseCurrencyOptions(selected = null) { return state.purchasesOptions.currencies.map((r) => '<option value="' + r.id + '" ' + (r.id === selected || (!selected && r.is_base) ? "selected" : "") + '>' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join(""); }
function purchaseItemOptions(selected = null) { return '<option value="">Selecciona un artículo</option>' + state.purchasesOptions.items.map((r) => '<option value="' + r.id + '" ' + (r.id === selected ? "selected" : "") + '>' + escapeHtml(r.sku + ' · ' + r.name) + '</option>').join(""); }

function openPurchaseRequestModal() {
  if (!state.purchasesOptions.items.length) return toast("Primero registra un artículo disponible para compras.", "error");
  const lines = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="purchase-request-form"><div class="modal-head"><div><span class="eyebrow">SOLICITUD DE COMPRA</span><h2>Nueva solicitud</h2><p class="muted">El folio se asignará automáticamente al guardar.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("SC-000000", true) + '<div class="form-grid"><label>Fecha requerida<input name="requiredDate" type="date" /></label><label>Prioridad<select name="priority"><option value="low">Baja</option><option value="medium" selected>Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label><label>Centro de costo<select name="costCenterId"><option value="">Sin asignar</option>' + state.purchasesOptions.costCenters.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join("") + '</select></label></div><section class="line-builder"><div class="panel-head"><h3>Partidas solicitadas</h3><span>ARTÍCULO Y CANTIDAD</span></div><div class="purchase-request-fields"><label>Artículo<select id="purchase-request-item">' + purchaseItemOptions() + '</select></label><label>Cantidad<input id="purchase-request-quantity" type="number" min="0.000001" step="0.000001" value="1" /></label><label>Descripción<input id="purchase-request-description" /></label><button id="add-purchase-request-line" class="button ghost" type="button">Agregar</button></div><div id="purchase-request-lines"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar solicitud</button></div></form>';
  const render = () => {
    $("#purchase-request-lines").innerHTML = lines.length ? '<div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Descripción</th><th>Cantidad</th><th></th></tr></thead><tbody>' + lines.map((r, i) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.name) + '</small></td><td>' + escapeHtml(r.description) + '</td><td>' + inventoryNumber(r.quantity) + ' ' + escapeHtml(r.unit) + '</td><td><button class="link-button danger-link" type="button" data-remove-purchase-line="' + i + '">Quitar</button></td></tr>').join("") + '</tbody></table></div>' : emptyMarkup("Sin partidas", "Agrega al menos un artículo.");
    $$("[data-remove-purchase-line]", $("#purchase-request-lines")).forEach((button) => button.onclick = () => { lines.splice(Number(button.dataset.removePurchaseLine), 1); render(); });
  };
  $("#add-purchase-request-line").onclick = () => {
    const item = state.purchasesOptions.items.find((r) => r.id === Number($("#purchase-request-item").value)), quantity = Number($("#purchase-request-quantity").value);
    if (!item || quantity <= 0) return toast("Selecciona un artículo y una cantidad válida.", "error");
    if (lines.some((r) => r.itemId === item.id)) return toast("Ese artículo ya está en la solicitud.", "error");
    lines.push({ itemId: item.id, sku: item.sku, name: item.name, unit: item.unit_symbol || "", quantity, description: $("#purchase-request-description").value.trim() || item.name });
    $("#purchase-request-item").value = ""; $("#purchase-request-quantity").value = "1"; $("#purchase-request-description").value = ""; render();
  };
  $("#purchase-request-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.lines = lines;
    if (!lines.length) { box.textContent = "Agrega al menos una partida."; box.classList.remove("hidden"); return; }
    try { const result = await api("/api/purchases/requests", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; toast("Solicitud " + result.folio + " guardada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  render(); entityDialog.showModal();
}

function openPurchaseComparisonModal() {
  const requests = state.purchasesOptions.requests;
  if (!requests.length) return toast("No hay solicitudes aprobadas disponibles.", "error");
  if (state.purchasesOptions.suppliers.length < 2) return toast("Registra al menos dos proveedores activos.", "error");
  const offers = [];
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="purchase-comparison-form"><div class="modal-head"><div><span class="eyebrow">COMPARACIÓN DE PROVEEDORES</span><h2>Nueva comparación</h2><p class="muted">Evalúa como mínimo dos propuestas.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("CP-000000", true) + '<label>Solicitud aprobada<select name="requestId" required>' + requests.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio) + ' · ' + r.line_count + ' partida(s)</option>').join("") + '</select></label><section class="line-builder"><div class="panel-head"><h3>Ofertas recibidas</h3><span>PRECIO, ENTREGA Y CRÉDITO</span></div><div class="purchase-offer-fields"><label>Proveedor<select id="purchase-offer-supplier">' + purchaseSupplierOptions() + '</select></label><label>Moneda<select id="purchase-offer-currency">' + purchaseCurrencyOptions() + '</select></label><label>Total<input id="purchase-offer-total" type="number" min="0" step="0.01" value="0" /></label><label>Entrega (días)<input id="purchase-offer-lead" type="number" min="0" value="0" /></label><label>Crédito (días)<input id="purchase-offer-credit" type="number" min="0" value="0" /></label><button id="add-purchase-offer" class="button ghost" type="button">Agregar</button></div><div id="purchase-offers"></div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar comparación</button></div></form>';
  const render = () => {
    $("#purchase-offers").innerHTML = offers.length ? '<div class="purchase-offer-list">' + offers.map((r, i) => '<article><div><strong>' + escapeHtml(r.supplierName) + '</strong><small>' + escapeHtml(r.currencyCode) + ' · Entrega ' + r.leadTimeDays + ' días · Crédito ' + r.paymentTermsDays + ' días</small></div><strong>' + money(r.totalAmount, r.currencyCode) + '</strong><button class="link-button danger-link" type="button" data-remove-purchase-offer="' + i + '">Quitar</button></article>').join("") + '</div>' : emptyMarkup("Sin ofertas", "Agrega al menos dos proveedores.");
    $$("[data-remove-purchase-offer]", $("#purchase-offers")).forEach((button) => button.onclick = () => { offers.splice(Number(button.dataset.removePurchaseOffer), 1); render(); });
  };
  const syncSupplier = () => { const supplier = state.purchasesOptions.suppliers.find((r) => r.id === Number($("#purchase-offer-supplier").value)); if (!supplier) return; $("#purchase-offer-lead").value = supplier.lead_time_days || 0; $("#purchase-offer-credit").value = supplier.payment_terms_days || 0; if (supplier.currency_id) $("#purchase-offer-currency").value = supplier.currency_id; };
  $("#purchase-offer-supplier").onchange = syncSupplier; syncSupplier();
  $("#add-purchase-offer").onclick = () => {
    const supplier = state.purchasesOptions.suppliers.find((r) => r.id === Number($("#purchase-offer-supplier").value)), currency = state.purchasesOptions.currencies.find((r) => r.id === Number($("#purchase-offer-currency").value));
    if (!supplier || !currency) return toast("Selecciona proveedor y moneda.", "error");
    if (offers.some((r) => r.supplierId === supplier.id)) return toast("Ese proveedor ya fue agregado.", "error");
    offers.push({ supplierId: supplier.id, supplierName: supplier.trade_name || supplier.legal_name, currencyId: currency.id, currencyCode: currency.code, totalAmount: Number($("#purchase-offer-total").value), leadTimeDays: Number($("#purchase-offer-lead").value), paymentTermsDays: Number($("#purchase-offer-credit").value) }); render();
  };
  $("#purchase-comparison-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.offers = offers;
    if (offers.length < 2) { box.textContent = "Agrega al menos dos ofertas."; box.classList.remove("hidden"); return; }
    try { const result = await api("/api/purchases/comparisons", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; toast("Comparación " + result.folio + " guardada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  render(); entityDialog.showModal();
}

function openPurchaseOrderModal() {
  const requests = state.purchasesOptions.requests;
  if (!requests.length) return toast("No hay solicitudes aprobadas disponibles.", "error");
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="purchase-order-form"><div class="modal-head"><div><span class="eyebrow">ORDEN DE COMPRA</span><h2>Nueva orden</h2><p class="muted">Las partidas se copiarán de la solicitud aprobada.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("OC-000000", true) + '<div class="form-grid"><label>Solicitud<select name="requestId" id="purchase-order-request" required>' + requests.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio) + ' · ' + r.line_count + ' partida(s)</option>').join("") + '</select></label><label>Comparación elegida<select name="comparisonId" id="purchase-order-comparison"><option value="">Sin comparación</option></select></label><label>Proveedor<select name="supplierId" id="purchase-order-supplier" required>' + purchaseSupplierOptions() + '</select></label><label>Moneda<select name="currencyId" required>' + purchaseCurrencyOptions() + '</select></label><label>Fecha de emisión<input name="issueDate" type="date" value="' + todayInput() + '" required /></label><label>Entrega esperada<input name="expectedDate" type="date" /></label></div><section class="line-builder"><div class="panel-head"><h3>Partidas y precios</h3><span>PRECIO E IMPUESTO</span></div><div id="purchase-order-lines">' + emptyMarkup("Cargando partidas", "Un momento…") + '</div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar orden</button></div></form>';
  let requestLines = [];
  const load = async () => {
    const requestId = Number($("#purchase-order-request").value), detail = await api("/api/purchases/requests/" + requestId);
    requestLines = detail.lines;
    const comparisons = state.purchasesOptions.comparisons.filter((r) => r.request_id === requestId);
    $("#purchase-order-comparison").innerHTML = '<option value="">Sin comparación</option>' + comparisons.map((r) => '<option value="' + r.id + '" data-supplier="' + r.selected_supplier_id + '">' + escapeHtml(r.folio + ' · ' + r.supplier_name) + '</option>').join("");
    $("#purchase-order-lines").innerHTML = '<div class="purchase-order-line-list">' + requestLines.map((r) => '<article><div><strong>' + escapeHtml(r.sku + ' · ' + r.item_name) + '</strong><small>' + inventoryNumber(r.quantity) + ' ' + escapeHtml(r.unit_symbol || "") + ' · ' + escapeHtml(r.description) + '</small></div><label>Precio unitario<input data-order-price="' + r.id + '" type="number" min="0" step="0.000001" value="' + Number(r.standard_cost || 0) + '" required /></label><label>Impuesto %<input data-order-tax="' + r.id + '" type="number" min="0" max="100" step="0.01" value="' + Number(r.tax_rate || 0) + '" required /></label></article>').join("") + '</div>';
  };
  $("#purchase-order-request").onchange = () => load().catch((error) => toast(error.message, "error"));
  $("#purchase-order-comparison").onchange = (event) => { const option = event.target.selectedOptions[0]; if (option?.dataset.supplier) $("#purchase-order-supplier").value = option.dataset.supplier; };
  $("#purchase-order-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form));
    body.lines = requestLines.map((r) => ({ requestLineId: r.id, unitPrice: Number($('[data-order-price="' + r.id + '"]').value), taxRate: Number($('[data-order-tax="' + r.id + '"]').value) }));
    try { const result = await api("/api/purchases/orders", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; toast("Orden " + result.folio + " guardada por " + money(result.total) + "."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  load().catch((error) => toast(error.message, "error")); entityDialog.showModal();
}

function openPurchaseReceiptModal() {
  const orders = state.purchasesOptions.orders.filter((r) => ["approved", "partially_received"].includes(r.status));
  if (!orders.length) return toast("No hay órdenes aprobadas pendientes de recepción.", "error");
  if (!state.purchasesOptions.warehouses.length) return toast("Primero registra un almacén activo.", "error");
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="purchase-receipt-form"><div class="modal-head"><div><span class="eyebrow">RECEPCIÓN DE COMPRA</span><h2>Nueva recepción</h2><p class="muted">Las cantidades recibidas actualizarán inventario.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("REC-000000", true) + '<div class="form-grid"><label>Orden aprobada<select name="orderId" id="purchase-receipt-order" required>' + orders.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio + ' · ' + r.supplier_name) + '</option>').join("") + '</select></label><label>Almacén<select name="warehouseId" id="purchase-receipt-warehouse" required>' + state.purchasesOptions.warehouses.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join("") + '</select></label><label>Ubicación<select name="locationId" id="purchase-receipt-location"><option value="">Sin ubicación</option></select></label><label>Fecha de recepción<input name="receiptDate" type="date" value="' + todayInput() + '" required /></label><label>Referencia del proveedor<input name="supplierReference" /></label></div><section class="line-builder"><div class="panel-head"><h3>Cantidades recibidas</h3><span>PENDIENTE POR PARTIDA</span></div><div id="purchase-receipt-lines">' + emptyMarkup("Cargando orden", "Un momento…") + '</div></section><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Aplicar recepción</button></div></form>';
  let orderLines = [];
  const locations = () => {
    const warehouse = Number($("#purchase-receipt-warehouse").value);
    $("#purchase-receipt-location").innerHTML = '<option value="">Sin ubicación</option>' + state.purchasesOptions.locations.filter((r) => r.warehouse_id === warehouse).map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + ' · ' + r.name) + '</option>').join("");
  };
  const load = async () => {
    const detail = await api("/api/purchases/orders/" + $("#purchase-receipt-order").value);
    orderLines = detail.lines.filter((r) => Number(r.pending_quantity) > 0);
    $("#purchase-receipt-lines").innerHTML = '<div class="purchase-receipt-line-list">' + orderLines.map((r) => '<article><div><strong>' + escapeHtml(r.sku + ' · ' + r.item_name) + '</strong><small>Pendiente ' + inventoryNumber(r.pending_quantity) + ' ' + escapeHtml(r.unit_symbol || "") + (r.inventory_tracked ? " · Actualiza existencia" : " · Sin inventario") + '</small></div><label>Cantidad recibida<input data-receipt-quantity="' + r.id + '" type="number" min="0" max="' + Number(r.pending_quantity) + '" step="0.000001" value="' + Number(r.pending_quantity) + '" /></label></article>').join("") + '</div>';
  };
  $("#purchase-receipt-warehouse").onchange = locations; locations();
  $("#purchase-receipt-order").onchange = () => load().catch((error) => toast(error.message, "error"));
  $("#purchase-receipt-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.lines = orderLines.map((r) => ({ orderLineId: r.id, quantity: Number($('[data-receipt-quantity="' + r.id + '"]').value) })).filter((r) => r.quantity > 0);
    try { const result = await api("/api/purchases/receipts", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; state.inventoryOptions = null; toast("Recepción " + result.folio + " aplicada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  load().catch((error) => toast(error.message, "error")); entityDialog.showModal();
}

function openPurchaseReturnModal() {
  const receipts = state.purchasesOptions.receipts;
  if (!receipts.length) return toast("No hay recepciones con cantidades disponibles.", "error");
  $("#entity-modal-content").classList.add("wide");
  $("#entity-modal-content").innerHTML = '<form id="purchase-return-form"><div class="modal-head"><div><span class="eyebrow">DEVOLUCIÓN A PROVEEDOR</span><h2>Nueva devolución</h2><p class="muted">Los artículos con control de inventario se descontarán del almacén.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("DCP-000000", true) + '<div class="form-grid"><label>Recepción origen<select name="receiptId" id="purchase-return-receipt" required>' + receipts.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio + ' · ' + r.order_folio + ' · ' + r.supplier_name) + '</option>').join("") + '</select></label><label>Fecha de devolución<input name="returnDate" type="date" value="' + todayInput() + '" required /></label></div><section class="line-builder"><div class="panel-head"><h3>Partidas a devolver</h3><span>CANTIDAD DISPONIBLE</span></div><div id="purchase-return-lines">' + emptyMarkup("Cargando recepción", "Un momento…") + '</div></section><label>Motivo<textarea name="reason" rows="3" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Aplicar devolución</button></div></form>';
  let receiptLines = [];
  const load = async () => {
    const detail = await api("/api/purchases/receipts/" + $("#purchase-return-receipt").value);
    receiptLines = detail.lines.map((r) => ({ ...r, available: Number(r.quantity) - Number(r.returned_quantity) })).filter((r) => r.available > 0);
    $("#purchase-return-lines").innerHTML = '<div class="purchase-receipt-line-list">' + receiptLines.map((r) => '<article><div><strong>' + escapeHtml(r.sku + ' · ' + r.item_name) + '</strong><small>Disponible ' + inventoryNumber(r.available) + ' ' + escapeHtml(r.unit_symbol || "") + ' · ' + escapeHtml([r.location_code, r.lot_number].filter(Boolean).join(" · ") || "Sin ubicación/lote") + '</small></div><label>Cantidad a devolver<input data-return-quantity="' + r.id + '" type="number" min="0" max="' + r.available + '" step="0.000001" value="0" /></label></article>').join("") + '</div>';
  };
  $("#purchase-return-receipt").onchange = () => load().catch((error) => toast(error.message, "error"));
  $("#purchase-return-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form)); body.lines = receiptLines.map((r) => ({ receiptLineId: r.id, quantity: Number($('[data-return-quantity="' + r.id + '"]').value) })).filter((r) => r.quantity > 0);
    try { const result = await api("/api/purchases/returns", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; state.inventoryOptions = null; toast("Devolución " + result.folio + " aplicada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  load().catch((error) => toast(error.message, "error")); entityDialog.showModal();
}

function openPurchaseInvoiceModal() {
  const orders = state.purchasesOptions.orders;
  if (!orders.length) return toast("No hay órdenes disponibles para facturar.", "error");
  $("#entity-modal-content").innerHTML = '<form id="purchase-invoice-form"><div class="modal-head"><div><span class="eyebrow">FACTURA DE PROVEEDOR</span><h2>Nueva factura</h2><p class="muted">Se generará una cuenta por pagar enlazada.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("FCP-000000", true) + '<div class="form-grid"><label>Orden de compra<select name="orderId" id="purchase-invoice-order" required>' + orders.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio + ' · ' + r.supplier_name) + ' · ' + money(r.total) + '</option>').join("") + '</select></label><label>Referencia de factura<input name="supplierInvoiceReference" required /></label><label>Fecha de emisión<input name="issueDate" type="date" value="' + todayInput() + '" required /></label><label>Fecha de vencimiento<input name="dueDate" type="date" /></label><label>Subtotal<input name="subtotal" id="purchase-invoice-subtotal" type="number" min="0" step="0.01" required /></label><label>Impuestos<input name="taxTotal" id="purchase-invoice-tax" type="number" min="0" step="0.01" required /></label><label>Total<input name="total" id="purchase-invoice-total" type="number" min="0.01" step="0.01" required /></label></div><label>Notas<textarea name="notes" rows="3"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Registrar factura</button></div></form>';
  const sync = async () => {
    const detail = await api("/api/purchases/orders/" + $("#purchase-invoice-order").value), order = detail.order;
    $("#purchase-invoice-subtotal").value = Number(order.subtotal); $("#purchase-invoice-tax").value = Number(order.tax_total); $("#purchase-invoice-total").value = Number(order.total);
  };
  $("#purchase-invoice-order").onchange = () => sync().catch((error) => toast(error.message, "error"));
  $("#purchase-invoice-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), body = Object.fromEntries(new FormData(form));
    try { const result = await api("/api/purchases/invoices", { method: "POST", body }); entityDialog.close(); state.purchasesOptions = null; state.financeOptions = null; toast("Factura " + result.folio + " registrada; cuenta " + result.payableFolio + " creada."); await navigate(state.currentView); } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  };
  sync().catch((error) => toast(error.message, "error")); entityDialog.showModal();
}

async function openPurchaseDetail(type, id) {
  try {
    const detail = await api("/api/purchases/" + ({ request: "requests", comparison: "comparisons", order: "orders", receipt: "receipts" })[type] + "/" + id);
    $("#entity-modal-content").classList.add("wide");
    if (type === "request") purchaseRequestDetailModal(detail);
    if (type === "comparison") purchaseComparisonDetailModal(detail);
    if (type === "order") purchaseOrderDetailModal(detail);
    if (type === "receipt") purchaseReceiptDetailModal(detail);
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function purchaseRequestDetailModal(detail) {
  const r = detail.request;
  $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(r.folio) + '</span><h2>Solicitud de compra</h2><p class="muted">' + escapeHtml(r.requester_name) + ' · ' + purchasePriorityLabel(r.priority) + '</p></div><button type="button" data-close-modal>×</button></div><section class="purchase-detail-metrics"><div><span>Estado</span>' + purchaseStatusBadge(r.status) + '</div><div><span>Fecha requerida</span><strong>' + (r.required_date ? formatDateOnly(r.required_date) : "Sin fecha") + '</strong></div><div><span>Centro de costo</span><strong>' + escapeHtml(r.cost_center_code || "Sin asignar") + '</strong></div><div><span>Partidas</span><strong>' + detail.lines.length + '</strong></div></section>' + purchaseLinesTable(detail.lines, "request") + (r.notes ? '<div class="document-notes"><strong>Notas</strong><p>' + escapeHtml(r.notes) + '</p></div>' : '') + '<div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
}

function purchaseComparisonDetailModal(detail) {
  const c = detail.comparison;
  $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(c.folio) + '</span><h2>Comparación de proveedores</h2><p class="muted">Solicitud ' + escapeHtml(c.request_folio) + '</p></div><button type="button" data-close-modal>×</button></div><div class="purchase-comparison-cards">' + detail.offers.map((r) => '<article class="' + (r.is_selected ? "selected" : "") + '"><div><strong>' + escapeHtml(r.supplier_name) + '</strong><small>' + escapeHtml(r.supplier_code + ' · ' + r.currency_code) + '</small></div><h3>' + money(r.total_amount, r.currency_code) + '</h3><dl><div><dt>Entrega</dt><dd>' + r.lead_time_days + ' días</dd></div><div><dt>Crédito</dt><dd>' + r.payment_terms_days + ' días</dd></div></dl>' + (r.is_selected ? '<span class="badge">● Elegido</span>' : hasPermission("purchases.approve") && c.status === "draft" ? '<button class="button ghost wide" data-select-purchase-supplier="' + r.supplier_id + '">Elegir proveedor</button>' : '') + '</article>').join("") + '</div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
  $$("[data-select-purchase-supplier]", $("#entity-modal-content")).forEach((button) => button.onclick = async () => { try { await api("/api/purchases/comparisons/" + c.id + "/select", { method: "POST", body: { supplierId: button.dataset.selectPurchaseSupplier } }); entityDialog.close(); state.purchasesOptions = null; toast("Proveedor seleccionado."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); } });
}

function purchaseOrderDetailModal(detail) {
  const o = detail.order;
  $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(o.folio) + '</span><h2>' + escapeHtml(o.supplier_name) + '</h2><p class="muted">Solicitud ' + escapeHtml(o.request_folio) + ' · ' + escapeHtml(o.currency_code) + '</p></div><button type="button" data-close-modal>×</button></div><section class="purchase-detail-metrics"><div><span>Estado</span>' + purchaseStatusBadge(o.status) + '</div><div><span>Subtotal</span><strong>' + money(o.subtotal, o.currency_code) + '</strong></div><div><span>Impuestos</span><strong>' + money(o.tax_total, o.currency_code) + '</strong></div><div class="highlight"><span>Total</span><strong>' + money(o.total, o.currency_code) + '</strong></div></section>' + purchaseLinesTable(detail.lines, "order") + '<div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
}

function purchaseReceiptDetailModal(detail) {
  const r = detail.receipt;
  $("#entity-modal-content").innerHTML = '<div><div class="modal-head"><div><span class="eyebrow">' + escapeHtml(r.folio) + '</span><h2>Recepción de compra</h2><p class="muted">Orden ' + escapeHtml(r.order_folio) + ' · ' + escapeHtml(r.warehouse_name) + '</p></div><button type="button" data-close-modal>×</button></div><section class="purchase-detail-metrics"><div><span>Estado</span>' + purchaseStatusBadge(r.status) + '</div><div><span>Fecha</span><strong>' + formatDateOnly(r.receipt_date) + '</strong></div><div><span>Referencia</span><strong>' + escapeHtml(r.supplier_reference || "Sin referencia") + '</strong></div><div><span>Partidas</span><strong>' + detail.lines.length + '</strong></div></section>' + purchaseLinesTable(detail.lines, "receipt") + '<div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>';
}

function purchaseLinesTable(lines, type) {
  const request = type === "request", order = type === "order";
  return '<div class="table-wrap embedded"><table><thead><tr><th>Artículo</th><th>Descripción / ubicación</th><th>Cantidad</th>' + (order ? '<th>Precio</th><th>Impuesto</th><th>Total</th><th>Recibido</th>' : '') + (!request && !order ? '<th>Devuelto</th>' : '') + '</tr></thead><tbody>' + lines.map((r) => '<tr><td><strong>' + escapeHtml(r.sku) + '</strong><small>' + escapeHtml(r.item_name) + '</small></td><td>' + escapeHtml(request || order ? r.description : [r.location_code, r.lot_number].filter(Boolean).join(" · ") || "Sin ubicación/lote") + '</td><td>' + inventoryNumber(r.quantity) + ' ' + escapeHtml(r.unit_symbol || "") + '</td>' + (order ? '<td>' + money(r.unit_price) + '</td><td>' + inventoryNumber(r.tax_rate) + '%</td><td>' + money(r.line_total) + '</td><td>' + inventoryNumber(r.received_quantity) + '</td>' : '') + (!request && !order ? '<td>' + inventoryNumber(r.returned_quantity) + '</td>' : '') + '</tr>').join("") + '</tbody></table></div>';
}

async function runPurchaseRequestAction(id, action) {
  if (action === "reject" && !await confirmAction({ eyebrow: "COMPRAS", title: "Rechazar solicitud", message: "La solicitud quedará rechazada y conservará esta decisión en su historial.", confirmLabel: "Rechazar solicitud", tone: "danger" })) return;
  try { await api("/api/purchases/requests/" + id + "/action", { method: "POST", body: { action } }); state.purchasesOptions = null; toast("Solicitud actualizada."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
}

async function runPurchaseOrderAction(id, action) {
  try { await api("/api/purchases/orders/" + id + "/action", { method: "POST", body: { action } }); state.purchasesOptions = null; toast("Orden actualizada."); await navigate(state.currentView); } catch (error) { toast(error.message, "error"); }
}

function todayInput() { return new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); }

async function renderFolios() {
  const token = beginPageRender();
  const [result, branches] = await Promise.all([api("/api/folios"), api("/api/catalogs/branches")]);
  if (!renderIsCurrent(token)) return;
  state.catalogCache.branches = branches.records;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">IDENTIFICACIÓN DOCUMENTAL</span><h2>Folios y consecutivos</h2><p>Controla la numeración única por tipo de documento y sucursal.</p></div>${hasPermission("folios.manage") ? '<button id="new-folio" class="button primary">＋ Nuevo consecutivo</button>' : ""}</section>
    <div class="table-wrap"><table><thead><tr><th>Documento</th><th>Sucursal</th><th>Último número</th><th>Siguiente folio</th><th>Reinicio</th><th></th></tr></thead><tbody>${result.folios.length ? result.folios.map((folio) => `<tr><td><strong>${escapeHtml(folio.document_type)}</strong><small>${folio.is_active ? "Activo" : "Inactivo"}</small></td><td>${escapeHtml(folio.branch_name || "Todas / General")}</td><td>${Number(folio.current_value).toLocaleString("es-MX")}</td><td><span class="folio-preview">${escapeHtml(folio.preview)}</span></td><td>${folio.reset_period === "none" ? "Sin reinicio" : folio.reset_period === "year" ? "Anual" : "Mensual"}</td><td><div class="table-actions">${hasPermission("folios.manage") ? `<button class="link-button" data-next-folio="${folio.id}">Emitir</button><button class="link-button" data-edit-folio="${folio.id}">Editar</button>` : ""}</div></td></tr>`).join("") : `<tr><td colspan="6">${emptyMarkup("No hay consecutivos", "Configura el primero para emitir folios controlados.")}</td></tr>`}</tbody></table></div>`;
  $("#new-folio")?.addEventListener("click", () => openFolioModal());
  pageContent.onclick = async (event) => {
    const edit = event.target.closest("[data-edit-folio]");
    if (edit) return openFolioModal(result.folios.find((folio) => folio.id === Number(edit.dataset.editFolio)));
    const next = event.target.closest("[data-next-folio]");
    if (next) {
      try { const issued = await api(`/api/folios/${next.dataset.nextFolio}/next`, { method: "POST" }); toast(`Folio emitido: ${issued.value}`); if (state.currentView === "folios") await renderFolios(); }
      catch (error) { toast(error.message, "error"); }
    }
  };
}

function openFolioModal(folio = null) {
  $("#entity-modal-content").innerHTML = `<form id="folio-form"><div class="modal-head"><div><span class="eyebrow">CONTROL DE FOLIOS</span><h2>${folio ? "Editar consecutivo" : "Nuevo consecutivo"}</h2><p class="muted">El siguiente número se genera dentro de una transacción para evitar duplicados.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid">
    <label>Tipo de documento<input name="documentType" value="${escapeAttribute(folio?.document_type ?? "")}" placeholder="ORDEN_COMPRA" required /></label><label>Prefijo<input name="prefix" value="${escapeAttribute(folio?.prefix ?? "")}" placeholder="OC-" /></label>
    <label>Consecutivo actual<input name="currentValue" type="number" min="0" value="${folio?.current_value ?? 0}" required /></label><label>Longitud numérica<input name="padding" type="number" min="1" max="12" value="${folio?.padding ?? 6}" required /></label>
    <label>Sucursal<select name="branchId"><option value="">General</option>${(state.catalogCache.branches ?? []).map((branch) => `<option value="${branch.id}" ${folio?.branch_id === branch.id ? "selected" : ""}>${escapeHtml(branch.name)}</option>`).join("")}</select></label><label>Reinicio<select name="resetPeriod"><option value="none" ${folio?.reset_period === "none" ? "selected" : ""}>Sin reinicio</option><option value="year" ${folio?.reset_period === "year" ? "selected" : ""}>Cada año</option><option value="month" ${folio?.reset_period === "month" ? "selected" : ""}>Cada mes</option></select></label>
    <label class="toggle-field span-two"><input type="checkbox" name="isActive" ${folio?.is_active === 0 ? "" : "checked"}/><span>Consecutivo activo</span></label></div><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar consecutivo</button></div></form>`;
  $("#folio-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form);
    const body = { documentType: data.get("documentType"), prefix: data.get("prefix"), currentValue: Number(data.get("currentValue")), padding: Number(data.get("padding")), branchId: data.get("branchId") ? Number(data.get("branchId")) : null, resetPeriod: data.get("resetPeriod"), isActive: data.has("isActive") };
    try { await api(folio ? `/api/folios/${folio.id}` : "/api/folios", { method: folio ? "PATCH" : "POST", body }); entityDialog.close(); toast("Consecutivo guardado."); await renderFolios(); }
    catch (error) { const box = $(".form-error", form); box.textContent = error.message; box.classList.remove("hidden"); }
  });
  entityDialog.showModal();
}

async function renderDocuments() {
  const token = beginPageRender();
  const result = await api("/api/documents");
  if (!renderIsCurrent(token)) return;
  state.documentOptions = result;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">EXPEDIENTE DOCUMENTAL</span><h2>Archivos y documentos</h2><p>Conserva versiones, vencimientos y archivos sensibles vinculados a cada colaborador.</p></div>${hasPermission("documents.manage") ? '<button id="upload-document" class="button primary">↑ Cargar archivo</button>' : ""}</section>
    <section class="document-summary"><div><strong>${result.documents.length}</strong><span>Documentos registrados</span></div><div><strong>${formatBytes(result.documents.reduce((sum, item) => sum + Number(item.size_bytes), 0))}</strong><span>Almacenamiento utilizado</span></div><div><strong>8 MB</strong><span>Límite por archivo</span></div></section>
    <div class="table-wrap"><table><thead><tr><th>Archivo</th><th>Colaborador</th><th>Clasificación</th><th>Versión</th><th>Vigencia</th><th></th></tr></thead><tbody>${result.documents.length ? result.documents.map((document) => `<tr class="${document.is_current ? "" : "muted-row"}"><td><strong>${escapeHtml(document.original_name)}</strong><small>${formatDate(document.created_at)} · ${formatBytes(document.size_bytes)}</small></td><td>${document.employee_name ? `<strong>${escapeHtml(document.employee_name)}</strong><small>${escapeHtml(document.employee_number || "")}</small>` : "Documento general"}</td><td><span class="chip">${escapeHtml(document.document_type_name || document.module)}</span><small>${documentSensitivityLabel(document.sensitivity)}</small></td><td><strong>v${Number(document.version_number || 1)}</strong><small>${document.is_current ? "Vigente" : "Sustituida"}</small></td><td>${document.expiry_date ? `<strong>${formatDate(document.expiry_date)}</strong><small>${documentExpiryLabel(document.expiry_date)}</small>` : "Sin vencimiento"}</td><td><div class="table-actions"><button class="link-button" data-view-document="${document.id}">Ver ficha</button><a class="link-button text-link" href="${API_BASE}/api/documents/${document.id}/download">Descargar</a>${hasPermission("documents.manage") ? `<button class="link-button danger-link" data-delete-document="${document.id}">Eliminar</button>` : ""}</div></td></tr>`).join("") : `<tr><td colspan="6">${emptyMarkup("No hay documentos", "Carga el primer archivo del expediente documental.")}</td></tr>`}</tbody></table></div>`;
  $("#upload-document")?.addEventListener("click", openDocumentModal);
  pageContent.onclick = async (event) => {
    const view = event.target.closest("[data-view-document]");
    if (view) return openDocumentDetail(view.dataset.viewDocument);
    const button = event.target.closest("[data-delete-document]");
    if (!button || !await confirmAction({ eyebrow: "EXPEDIENTE DOCUMENTAL", title: "Eliminar documento", message: "Si es la versión vigente, el sistema restaurará automáticamente la versión anterior.", confirmLabel: "Eliminar documento", tone: "danger" })) return;
    try { await api(`/api/documents/${button.dataset.deleteDocument}`, { method: "DELETE" }); toast("Documento eliminado."); if (state.currentView === "documents") await renderDocuments(); }
    catch (error) { toast(error.message, "error"); }
  };
}

function guardFormSubmission(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || guardedFormExclusions.has(form.id) || form.dataset.submitFeedback === "off") return;
  if (form.dataset.submitting === "true") {
    event.preventDefault();
    event.stopImmediatePropagation();
    return;
  }
  const submitter = event.submitter || $("button[type='submit']:not(:disabled), input[type='submit']:not(:disabled)", form);
  if (!submitter) return;
  const buttons = $$('button[type="submit"], input[type="submit"]', form);
  const originalLabel = String(submitter.textContent || submitter.value || "").trim();
  const savingAction = /guardar|agregar|crear|registrar|actualizar|confirmar|cargar|aplicar/i.test(originalLabel);
  const progressLabel = savingAction ? "Guardando…" : "Procesando…";
  const notice = document.createElement("div");
  notice.className = "form-save-progress";
  notice.setAttribute("role", "status");
  notice.setAttribute("aria-live", "polite");
  notice.innerHTML = '<span class="form-save-spinner" aria-hidden="true"></span><span><strong>' + progressLabel + '</strong><small>Espera a que termine la operación. No es necesario volver a presionar.</small></span>';
  const actions = $(".modal-actions", form);
  if (actions) actions.insertAdjacentElement("beforebegin", notice);
  else submitter.insertAdjacentElement("beforebegin", notice);
  const submission = {
    form,
    notice,
    submitter,
    buttons: buttons.map((button) => ({ button, disabled: button.disabled, html: button instanceof HTMLButtonElement ? button.innerHTML : null, value: button.value })),
    claimed: false,
    activeRequests: 0,
    releaseTimer: null,
    fallbackTimer: null,
  };
  form.dataset.submitting = "true";
  form.setAttribute("aria-busy", "true");
  buttons.forEach((button) => { button.disabled = true; });
  submitter.classList.add("is-saving");
  if (submitter instanceof HTMLButtonElement) submitter.textContent = progressLabel;
  else submitter.value = progressLabel;
  submission.fallbackTimer = setTimeout(() => {
    if (!submission.claimed) finishGuardedFormSubmission(submission);
  }, 30_000);
  guardedFormSubmissions.push(submission);
}

function claimGuardedFormSubmission(method) {
  const submission = [...guardedFormSubmissions].reverse().find((entry) => entry.form.isConnected && (entry.claimed || !["GET", "HEAD"].includes(method)));
  if (!submission) return null;
  submission.claimed = true;
  clearTimeout(submission.fallbackTimer);
  clearTimeout(submission.releaseTimer);
  submission.activeRequests += 1;
  return submission;
}

function releaseGuardedFormSubmission(submission) {
  if (!submission) return;
  submission.activeRequests = Math.max(0, submission.activeRequests - 1);
  if (submission.activeRequests > 0) return;
  clearTimeout(submission.releaseTimer);
  submission.releaseTimer = setTimeout(() => finishGuardedFormSubmission(submission), 180);
}

function finishGuardedFormSubmission(submission) {
  const index = guardedFormSubmissions.indexOf(submission);
  if (index >= 0) guardedFormSubmissions.splice(index, 1);
  clearTimeout(submission.fallbackTimer);
  clearTimeout(submission.releaseTimer);
  submission.form.removeAttribute("aria-busy");
  delete submission.form.dataset.submitting;
  submission.notice.remove();
  submission.buttons.forEach(({ button, disabled, html, value }) => {
    button.disabled = disabled;
    button.classList.remove("is-saving");
    if (button instanceof HTMLButtonElement) button.innerHTML = html;
    else button.value = value;
  });
}

function openDocumentModal() {
  const options = state.documentOptions || { documentTypes: [], employees: [] };
  const employeeOptions = '<option value="">Documento general</option>' + (options.employees || []).map((row) => `<option value="${row.id}">${escapeHtml(row.employee_number)} · ${escapeHtml(row.full_name)}</option>`).join("");
  const typeOptions = '<option value="">Sin clasificación laboral</option>' + (options.documentTypes || []).map((row) => `<option value="${row.id}" data-sensitive="${escapeAttribute(row.sensitivity)}" data-issue="${row.requires_issue_date}" data-expiry="${row.requires_expiry_date}" data-allows-expiry="${row.allows_expiry_date}">${escapeHtml(row.name)}</option>`).join("");
  $("#entity-modal-content").innerHTML = `<form id="document-form"><div class="modal-head"><div><span class="eyebrow">NUEVO DOCUMENTO</span><h2>Cargar archivo</h2><p class="muted">Si ya existe un archivo de la misma clase para el colaborador, se conservará como una versión anterior.</p></div><button type="button" data-close-modal>×</button></div><label>Archivo<input name="file" type="file" required /></label><div class="form-grid"><label>Colaborador<select name="employeeId" id="document-employee">${employeeOptions}</select></label><label>Clasificación<select name="documentTypeId" id="document-type">${typeOptions}</select><small class="field-help" id="document-sensitivity-help">Documento general sin clasificación sensible.</small></label><label>Fecha de emisión<input name="issueDate" type="date" /></label><label id="document-expiry-field">Fecha de vencimiento<input name="expiryDate" type="date" /></label><label>Módulo<input name="module" value="core" placeholder="recursos_humanos" required /></label><label>Tipo de referencia<input name="entityType" placeholder="expediente_empleado" /></label><label>ID de referencia<input name="entityId" placeholder="125" /></label><label>Descripción<input name="description" placeholder="Documento firmado" /></label></div><p class="upload-note">Tamaño máximo: 8 MB por archivo. La clasificación define automáticamente sus permisos.</p><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Cargar documento</button></div></form>`;
  const form = $("#document-form"), employeeSelect = $("#document-employee"), typeSelect = $("#document-type");
  const syncDocumentRules = () => {
    const option = typeSelect.selectedOptions[0];
    const allowsExpiry = !option?.value || option.dataset.allowsExpiry === "1";
    typeSelect.required = Boolean(employeeSelect.value);
    form.module.value = employeeSelect.value ? "hr" : (form.module.value || "core");
    form.entityType.value = employeeSelect.value ? "employee" : form.entityType.value;
    form.entityId.value = employeeSelect.value || form.entityId.value;
    form.issueDate.required = option?.dataset.issue === "1";
    $("#document-expiry-field").hidden = !allowsExpiry;
    form.expiryDate.disabled = !allowsExpiry;
    form.expiryDate.required = allowsExpiry && option?.dataset.expiry === "1";
    if (!allowsExpiry) form.expiryDate.value = "";
    $("#document-sensitivity-help").textContent = option?.value
      ? "Acceso: " + documentSensitivityLabel(option.dataset.sensitive) : "Documento general sin clasificación sensible.";
  };
  employeeSelect.onchange = syncDocumentRules;
  typeSelect.onchange = syncDocumentRules;
  syncDocumentRules();
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get("file"); const box = $(".form-error", form); const submit = $("button[type=submit]", form);
    if (!(file instanceof File) || !file.size) { box.textContent = "Selecciona un archivo."; return box.classList.remove("hidden"); }
    if (file.size > 8 * 1024 * 1024) { box.textContent = "El archivo supera el límite de 8 MB."; return box.classList.remove("hidden"); }
    submit.disabled = true;
    try {
      const contentBase64 = await fileToBase64(file);
      await api("/api/documents", { method: "POST", body: { originalName: file.name, mimeType: file.type || "application/octet-stream", contentBase64, module: data.get("module"), entityType: data.get("entityType"), entityId: data.get("entityId"), employeeId: data.get("employeeId"), documentTypeId: data.get("documentTypeId"), issueDate: data.get("issueDate"), expiryDate: data.get("expiryDate"), description: data.get("description") } });
      entityDialog.close(); toast("Documento cargado correctamente."); await renderDocuments();
    } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
    finally { submit.disabled = false; }
  });
  entityDialog.showModal();
}

async function openDocumentDetail(id) {
  try {
    const { document, accessLog = [] } = await api(`/api/documents/${id}`);
    const accessMarkup = accessLog.length ? `<section class="document-access-log"><div class="panel-head"><div><h3>Bitácora de acceso</h3><p>Consultas y descargas registradas.</p></div><span>${accessLog.length} EVENTO(S)</span></div>${accessLog.map((entry) => `<div><strong>${entry.action === "download" ? "Descarga" : "Consulta"}</strong><span>${escapeHtml(entry.user_name || "Usuario retirado")}</span><small>${formatDate(entry.created_at)} · ${escapeHtml(entry.ip_address || "Sin IP")}</small></div>`).join("")}</section>` : "";
    $("#entity-modal-content").innerHTML = `<section><div class="modal-head"><div><span class="eyebrow">FICHA DOCUMENTAL</span><h2>${escapeHtml(document.original_name)}</h2><p class="muted">La consulta quedó registrada en la bitácora de seguridad.</p></div><button type="button" data-close-modal>×</button></div><div class="detail-grid"><div><span>Colaborador</span><strong>${escapeHtml(document.employee_name || "Documento general")}</strong></div><div><span>Clasificación</span><strong>${escapeHtml(document.document_type_name || "General")}</strong></div><div><span>Sensibilidad</span><strong>${documentSensitivityLabel(document.sensitivity)}</strong></div><div><span>Versión</span><strong>v${Number(document.version_number || 1)} · ${document.is_current ? "Vigente" : "Sustituida"}</strong></div><div><span>Emisión</span><strong>${document.issue_date ? formatDate(document.issue_date) : "Sin fecha"}</strong></div><div><span>Vencimiento</span><strong>${document.expiry_date ? formatDate(document.expiry_date) : "Sin vencimiento"}</strong></div><div><span>Cargado por</span><strong>${escapeHtml(document.uploaded_by_name || "Sistema")}</strong></div><div><span>Tamaño</span><strong>${formatBytes(document.size_bytes)}</strong></div></div><p>${escapeHtml(document.description || "Sin descripción")}</p>${accessMarkup}<div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cerrar</button><a class="button primary" href="${API_BASE}/api/documents/${document.id}/download">Descargar</a></div></section>`;
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

function documentSensitivityLabel(value) {
  return ({ standard: "General", fiscal: "Fiscal", salary: "Salarial restringido", cfdi: "CFDI restringido", medical: "Médico restringido" })[value] || value || "General";
}

function documentExpiryLabel(date) {
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) return "Vencido";
  const days = Math.ceil((new Date(`${date}T00:00:00Z`) - new Date(`${today}T00:00:00Z`)) / 86400000);
  return days <= 90 ? `Vence en ${days} día(s)` : "Vigente";
}

async function renderNotifications() {
  const token = beginPageRender();
  const requests = [api("/api/notifications")];
  if (hasPermission("notifications.manage")) requests.push(api("/api/users"));
  const [result, usersResult] = await Promise.all(requests);
  if (!renderIsCurrent(token)) return;
  if (usersResult) state.users = usersResult.users;
  const unread = result.notifications.filter((item) => !item.is_read).length;
  $("#notification-count").textContent = unread;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">CENTRO DE AVISOS</span><h2>Notificaciones</h2><p>Mensajes internos, alertas y avisos dirigidos a cada usuario.</p></div>${hasPermission("notifications.manage") ? '<button id="new-notification" class="button primary">＋ Enviar notificación</button>' : ""}</section><section class="notification-list">${result.notifications.length ? result.notifications.map((item) => `<article class="notification-card ${item.is_read ? "read" : ""}" data-notification-id="${item.id}"><span class="notification-type ${item.type}">${notificationSymbol(item.type)}</span><div><div class="notification-heading"><h3>${escapeHtml(item.title)}</h3><time>${formatDate(item.created_at)}</time></div><p>${escapeHtml(item.message)}</p></div>${item.is_read ? '<span class="read-label">LEÍDA</span>' : `<button class="link-button" data-read-notification="${item.id}">Marcar leída</button>`}</article>`).join("") : emptyMarkup("No tienes notificaciones", "Los avisos dirigidos a tu cuenta aparecerán aquí.")}</section>`;
  $("#new-notification")?.addEventListener("click", openNotificationModal);
  pageContent.onclick = async (event) => {
    const button = event.target.closest("[data-read-notification]");
    if (!button) return;
    try { await api(`/api/notifications/${button.dataset.readNotification}/read`, { method: "PATCH" }); if (state.currentView === "notifications") await renderNotifications(); }
    catch (error) { toast(error.message, "error"); }
  };
}

function openNotificationModal() {
  $("#entity-modal-content").innerHTML = `<form id="notification-form"><div class="modal-head"><div><span class="eyebrow">MENSAJE INTERNO</span><h2>Enviar notificación</h2><p class="muted">El aviso aparecerá en la bandeja de los destinatarios seleccionados.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid"><label>Título<input name="title" maxlength="140" required /></label><label>Tipo<select name="type"><option value="info">Información</option><option value="success">Confirmación</option><option value="warning">Advertencia</option><option value="error">Urgente</option></select></label></div><label>Mensaje<textarea name="message" rows="4" maxlength="1000" required></textarea></label><label class="toggle-field"><input id="all-active-users" type="checkbox" name="allActive"/><span>Enviar a todos los usuarios activos</span></label><label>Destinatarios<div id="notification-users" class="check-grid">${state.users.filter((user) => user.status === "active").map((user) => checkbox("userIds", user.id, `${user.fullName} · ${user.username}`, false)).join("")}</div></label><p class="form-error hidden"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">Enviar aviso</button></div></form>`;
  $("#all-active-users").addEventListener("change", (event) => $$("input[type=checkbox]", $("#notification-users")).forEach((input) => { input.checked = event.target.checked; input.disabled = event.target.checked; }));
  $("#notification-form").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const box = $(".form-error", form);
    try { const result = await api("/api/notifications", { method: "POST", body: { title: data.get("title"), message: data.get("message"), type: data.get("type"), allActive: data.has("allActive"), userIds: data.getAll("userIds").map(Number) } }); entityDialog.close(); toast(`Notificación enviada a ${result.recipients} usuario(s).`); await renderNotifications(); }
    catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
  });
  entityDialog.showModal();
}

async function renderAreas() {
  const token = beginPageRender();
  const result = await api("/api/areas");
  if (!renderIsCurrent(token)) return;
  state.areas = result.areas;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">ESTRUCTURA ORGANIZACIONAL</span><h2>Áreas de trabajo</h2><p>Organiza usuarios y operaciones según la estructura real de la empresa.</p></div>${hasPermission("areas.manage") ? '<button id="new-area-button" class="button primary">＋ Nueva área</button>' : ""}</section>
    ${state.areas.length ? `<section class="area-grid">${state.areas.map((area) => `<article class="area-card"><span class="area-code">${escapeHtml(area.code)}</span><h3>${escapeHtml(area.name)}</h3><p>${escapeHtml(area.description || "Sin descripción registrada.")}</p><div class="area-foot"><span>${area.users_count} usuario(s) · ${area.is_active ? "Activa" : "Inactiva"}</span>${hasPermission("areas.manage") ? `<button class="link-button" data-edit-area="${area.id}">Editar</button>` : ""}</div></article>`).join("")}</section>` : `<div class="panel">${emptyMarkup("Aún no hay áreas", "Crea la primera para comenzar a organizar usuarios y operaciones.")}</div>`}`;
  $("#new-area-button")?.addEventListener("click", () => openAreaModal());
  pageContent.onclick = (event) => {
    const button = event.target.closest("[data-edit-area]");
    if (button) openAreaModal(state.areas.find((area) => area.id === Number(button.dataset.editArea)));
  };
}

function openAreaModal(area = null) {
  const editing = Boolean(area);
  $("#entity-modal-content").innerHTML = `<form id="area-form"><div class="modal-head"><div><span class="eyebrow">${editing ? "EDITAR ÁREA" : "NUEVA ÁREA"}</span><h2>${editing ? escapeHtml(area.name) : "Registrar área"}</h2><p class="muted">Identifica una unidad funcional de la organización.</p></div><button type="button" data-close-modal>×</button></div>
    ${editing ? "" : '<label>Código<input name="code" required maxlength="30" placeholder="PROD" /></label>'}<label>Nombre<input name="name" required maxlength="120" value="${escapeAttribute(area?.name ?? "")}" placeholder="Producción" /></label><label>Descripción<textarea name="description" rows="3">${escapeHtml(area?.description ?? "")}</textarea></label>
    ${editing ? `<label>Estado<select name="isActive"><option value="true" ${area.is_active ? "selected" : ""}>Activa</option><option value="false" ${!area.is_active ? "selected" : ""}>Inactiva</option></select></label>` : ""}<p class="form-error hidden" role="alert"></p><div class="modal-actions"><button class="button ghost" type="button" data-close-modal>Cancelar</button><button class="button primary" type="submit">${editing ? "Guardar cambios" : "Crear área"}</button></div></form>`;
  $("#area-form").addEventListener("submit", (event) => saveArea(event, area));
  entityDialog.showModal();
}

async function saveArea(event, area) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const errorBox = $(".form-error", form);
  const body = { name: data.get("name"), description: data.get("description") };
  if (area) body.isActive = data.get("isActive") === "true";
  else body.code = data.get("code");
  try {
    await api(area ? `/api/areas/${area.id}` : "/api/areas", { method: area ? "PATCH" : "POST", body });
    entityDialog.close();
    toast(area ? "Área actualizada." : "Área creada.");
    if (state.currentView === "masters_hub") {
      state.masterHubSection = "areas";
      await renderMasterHub();
    } else {
      await renderAreas();
    }
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.classList.remove("hidden");
  }
}

async function renderAudit() {
  const token = beginPageRender();
  const result = await api("/api/audit?limit=50");
  if (!renderIsCurrent(token)) return;
  pageContent.innerHTML = `<section class="page-lead"><div><span class="eyebrow">TRAZABILIDAD</span><h2>Cada movimiento deja huella</h2><p>Registro cronológico de accesos, cambios y decisiones realizadas en el sistema.</p></div></section>
    <div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Usuario</th><th>Módulo</th><th>Movimiento</th><th>Referencia</th></tr></thead><tbody>${result.logs.map((log) => `<tr><td>${formatDate(log.created_at)}</td><td><strong>${escapeHtml(log.full_name || "Sistema")}</strong><small>${escapeHtml(log.username || "Automático")}</small></td><td><span class="chip">${escapeHtml(log.module)}</span></td><td><strong>${escapeHtml(log.summary)}</strong><small>${escapeHtml(log.action)}</small></td><td>${log.entity_type ? `${escapeHtml(log.entity_type)} #${escapeHtml(log.entity_id || "—")}` : "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

const predefinedTimezones = [
  ["America/Mexico_City", "México · Centro (Ciudad de México)"],
  ["America/Monterrey", "México · Noreste (Monterrey)"],
  ["America/Matamoros", "México · Frontera noreste (Matamoros)"],
  ["America/Merida", "México · Sureste (Mérida)"],
  ["America/Cancun", "México · Quintana Roo (Cancún)"],
  ["America/Chihuahua", "México · Chihuahua"],
  ["America/Ciudad_Juarez", "México · Frontera norte (Ciudad Juárez)"],
  ["America/Ojinaga", "México · Frontera norte (Ojinaga)"],
  ["America/Mazatlan", "México · Pacífico (Mazatlán)"],
  ["America/Hermosillo", "México · Sonora (Hermosillo)"],
  ["America/Tijuana", "México · Noroeste (Tijuana)"],
  ["America/Bahia_Banderas", "México · Bahía de Banderas"],
  ["America/Chicago", "Norteamérica · Centro (Chicago)"],
  ["America/Denver", "Norteamérica · Montaña (Denver)"],
  ["America/Los_Angeles", "Norteamérica · Pacífico (Los Ángeles)"],
  ["America/New_York", "Norteamérica · Este (Nueva York)"],
  ["UTC", "UTC · Tiempo universal coordinado"],
];

function predefinedTimezoneOptions(selected) {
  const timezones = predefinedTimezones.some(([value]) => value === selected)
    ? predefinedTimezones
    : [[selected, "Zona configurada actualmente"], ...predefinedTimezones];
  return timezones.map(([value, label]) => '<option value="' + escapeAttribute(value) + '" ' + (value === selected ? "selected" : "") + '>' + escapeHtml(label + " · " + value) + '</option>').join("");
}

async function renderSettings() {
  const token = beginPageRender();
  const section = state.settingsSection === "supervision" ? "supervision" : "general";
  const result = await api(section === "supervision" ? "/api/dashboard" : "/api/settings");
  if (!renderIsCurrent(token)) return;
  $("#page-title").textContent = section === "supervision" ? "Supervisión del sistema" : "Configuración general";
  $("#breadcrumbs").textContent = section === "supervision" ? "SISTEMA / SUPERVISIÓN" : "SISTEMA / CONFIGURACIÓN";
  const header = '<section class="settings-hub-head"><div><span class="eyebrow">ADMINISTRACIÓN DEL SISTEMA</span><h2>Configuración</h2><p>Ajusta el entorno o consulta su funcionamiento desde un mismo lugar.</p></div><div class="settings-section-tabs" role="tablist" aria-label="Secciones de configuración"><button type="button" class="' + (section === "general" ? "active" : "") + '" data-settings-section="general">Configuración general</button><button type="button" class="' + (section === "supervision" ? "active" : "") + '" data-settings-section="supervision">Supervisión del sistema</button></div></section>';
  if (section === "supervision") {
    const { metrics, recent } = result;
    pageContent.innerHTML = header + '<section class="supervision-lead"><div><span class="eyebrow">ESTADO GENERAL</span><h3>Supervisión del sistema</h3><p>Usuarios, sesiones y movimientos recientes del núcleo administrativo.</p></div><span class="supervision-live"><i></i> SISTEMA OPERATIVO</span></section>' +
      '<section class="metrics supervision-metrics">' +
      metricCard("Usuarios activos", metrics.users, "Cuentas habilitadas", "◎", true) +
      metricCard("Áreas operativas", metrics.areas, "Estructura registrada", "▦") +
      metricCard("Sesiones abiertas", metrics.activeSessions, "Actividad en tiempo real", "↗") +
      metricCard("Eventos de hoy", metrics.eventsToday, "Movimientos auditados", "≡") + '</section>' +
      '<section class="supervision-grid"><article class="panel"><div class="panel-head"><div><h3>Actividad reciente</h3><p>Últimos movimientos registrados por el sistema.</p></div><span>ÚLTIMOS MOVIMIENTOS</span></div><div class="activity-list">' +
      (recent.length ? recent.map(activityItem).join("") : emptyMarkup("Todavía no hay actividad", "Los movimientos aparecerán aquí.")) +
      '</div></article><aside class="panel supervision-status-panel"><div class="panel-head"><h3>Servicios locales</h3><span>ESTADO</span></div><div class="supervision-service-list"><div><i class="status-dot"></i><span><strong>Base de datos</strong><small>SQLite local conectado</small></span><b>Disponible</b></div><div><i class="status-dot"></i><span><strong>Servidor ERP</strong><small>Aplicación y API local</small></span><b>Activo</b></div><div><i class="status-dot"></i><span><strong>Sesiones</strong><small>' + metrics.activeSessions + ' conexión(es) abiertas</small></span><b>Monitoreado</b></div></div>' +
      (hasPermission("audit.view") ? '<button class="button ghost wide" type="button" data-open-system-audit><span>Abrir bitácora completa</span><span>→</span></button>' : "") + '</aside></section>';
  } else {
    const { settings } = result;
    const managedCompany = result.managedCompany || state.company || {};
    const managedName = managedCompany.tradeName || managedCompany.legalName || settings.company_name?.value || "Empresa administrada";
    pageContent.innerHTML = header + `<section class="settings-grid"><aside class="settings-aside"><span class="eyebrow light">CONFIGURACIÓN DEL ENTORNO</span><h3>Una identidad, una base empresarial.</h3><p>El nombre y la identidad de esta empresa se administran exclusivamente desde el Centro de Gestión. Aquí sólo se ajusta el comportamiento operativo del ERP.</p></aside><form id="settings-form" class="panel settings-form"><div class="managed-company-field"><span>EMPRESA ADMINISTRADA</span><div><strong>${escapeHtml(managedName)}</strong><small>${escapeHtml(managedCompany.legalName || managedName)}${managedCompany.code ? " · " + escapeHtml(managedCompany.code) : ""}</small></div></div><label>Zona horaria<select name="timezone" required>${predefinedTimezoneOptions(settings.timezone.value)}</select></label><label>Duración de sesión (horas)<input name="session_hours" type="number" min="1" max="72" value="${escapeAttribute(settings.session_hours.value)}" required /></label><p class="form-error hidden"></p>${hasPermission("settings.manage") ? '<button class="button primary" type="submit">Guardar configuración operativa</button>' : ""}</form></section>`;
  }
  pageContent.onclick = (event) => {
    const tab = event.target.closest("[data-settings-section]");
    if (tab) {
      state.settingsSection = tab.dataset.settingsSection;
      return renderSettings();
    }
    if (event.target.closest("[data-open-system-audit]")) return navigate("audit");
  };
  if (section === "supervision") return;
  $("#settings-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try { await api("/api/settings", { method: "PATCH", body: data }); toast("Configuración guardada."); }
    catch (error) { const box = $(".form-error", event.currentTarget); box.textContent = error.message; box.classList.remove("hidden"); }
  });
}

async function loadNotifications() {
  try {
    const result = await api("/api/notifications", { cache: false });
    $("#notification-count").textContent = result.notifications.filter((item) => !item.is_read).length;
  } catch {}
}

async function api(path, options = {}) {
  const method = options.method ?? "GET";
  const cacheEnabled = method === "GET" && options.cache !== false;
  const cacheTtlMs = Number(options.cacheTtlMs ?? API_GET_CACHE_MS);
  const cacheKey = `${state.companySlug || "default"}:${path}`;
  if (cacheEnabled) {
    const cached = apiGetCache.get(cacheKey);
    if (cached && Date.now() - cached.storedAt < cacheTtlMs) return cached.data;
    if (apiGetPending.has(cacheKey)) return apiGetPending.get(cacheKey);
  }
  const guardedSubmission = claimGuardedFormSubmission(method);
  const headers = { Accept: "application/json", ...(options.headers ?? {}) };
  if (!["/api/companies", "/api/auth/login"].includes(path) && state.companySlug) headers["X-Company-Slug"] = state.companySlug;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (state.csrfToken && !["GET", "HEAD"].includes(method)) headers["X-CSRF-Token"] = state.csrfToken;
  const request = (async () => {
    const response = await fetch(`${API_BASE}${path}`, { method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body), credentials: "include" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error ?? "No fue posible completar la operación.");
      error.status = response.status;
      error.details = data.details;
      if (response.status === 401 && state.user) showLogin();
      throw error;
    }
    if (cacheEnabled) apiGetCache.set(cacheKey, { data, storedAt: Date.now() });
    else if (!["GET", "HEAD"].includes(method)) {
      apiGetCache.clear();
      if (mutationAffectsHrSnapshot(path, method)) {
        state.hrControl = null;
        state.hrOptions = null;
      }
    }
    return data;
  })();
  if (cacheEnabled) apiGetPending.set(cacheKey, request);
  try { return await request; }
  finally {
    if (cacheEnabled) apiGetPending.delete(cacheKey);
    releaseGuardedFormSubmission(guardedSubmission);
  }
}

function mutationAffectsHrSnapshot(path, method) {
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return false;
  return path.startsWith("/api/hr/")
    || path.startsWith("/api/portal/")
    || path === "/api/safety/incapacities"
    || path.startsWith("/api/areas")
    || path.startsWith("/api/documents")
    || path.startsWith("/api/masters/employees")
    || path.startsWith("/api/catalogs/companies")
    || path.startsWith("/api/users")
    || path.startsWith("/api/roles");
}

function setCompanyContext(company) {
  if (!company?.slug) return;
  if (state.companySlug !== company.slug) apiGetCache.clear();
  state.company = company;
  state.companySlug = company.slug;
  localStorage.setItem("abicorp_company", state.companySlug);
}

async function renderSafety() {
  const token = beginPageRender();
  const [control, options] = await Promise.all([api("/api/safety/control"), api("/api/safety/options")]);
  if (!renderIsCurrent(token)) return;
  state.safetyOptions = options;
  const stage = state.safetyHubSection;
  const stages = [
    ["safety_incidents", "Eventos", "Accidentes e incidentes", "!", control.incidents.length],
    ["safety_incapacities", "Incapacidades", "Ausencias vinculadas", "+", control.incapacities.length],
    ["safety_risks", "Riesgos", "Peligros y controles", "◇", control.risks.length],
    ["safety_compliance", "Normativa", "Requisitos y evidencia", "✓", control.compliance.length],
    ["safety_indicators", "Indicadores", "Salud del trabajo", "◉", control.indicators.incidents30Days],
  ];
  pageContent.innerHTML =
    '<section class="workforce-command safety-command"><div class="workforce-command-copy"><span class="workforce-live"><i></i>PROTECCIÓN ACTIVA</span><h2>Previene y protege</h2><p>Eventos, riesgos, salud y obligaciones permanecen conectados desde el reporte hasta el cierre.</p><div class="workforce-command-kpis"><div><strong>' + control.incidents.filter((r) => !["closed", "cancelled"].includes(r.status)).length + '</strong><span>eventos abiertos</span></div><div><strong>' + control.indicators.highRisks + '</strong><span>riesgos prioritarios</span></div></div><div class="workforce-command-actions">' + (hasPermission("safety.manage") ? '<button class="button ghost light" data-safety-new="incident">＋ Reportar evento</button><button class="button workforce-accent" data-safety-new="risk">＋ Analizar riesgo</button>' : "") + '</div></div>' +
    safetyOperationsScene(control) + '</section>' +
    '<section class="metrics workforce-summary">' + metricCard("Eventos en 30 días", control.indicators.incidents30Days, "Accidentes e incidentes", "!", true) + metricCard("Días de incapacidad", inventoryNumber(control.indicators.incapacityDays), "Vinculados con SST", "+") + metricCard("Riesgos altos", control.indicators.highRisks, "Requieren tratamiento", "◇") + metricCard("Cumplimiento", control.indicators.complianceRate + "%", "Requisitos aplicables", "✓") + '</section>' +
    '<section class="trade-stage-switcher workforce-switcher">' + stages.map(([key, label, description, symbol, count]) => tradeStageCard({ key, label, description, symbol, count, active: key === stage, module: "safety" })).join("") + '</section>' +
    safetySection(control, stage);
  $$("[data-safety-stage]").forEach((button) => button.onclick = () => { state.safetyHubSection = button.dataset.safetyStage; renderSafety(); });
  $$("[data-safety-new]").forEach((button) => button.onclick = () => openSafetyModal(button.dataset.safetyNew));
  $$("[data-safety-action]").forEach((button) => button.onclick = async () => {
    try {
      await api(`/api/safety/${button.dataset.safetyEntity}/${button.dataset.safetyId}/action`, { method: "POST", body: { action: button.dataset.safetyAction } });
      toast("Registro de seguridad actualizado."); await renderSafety();
    } catch (error) { toast(error.message, "error"); }
  });
}

function safetyOperationsScene(control) {
  const open = control.incidents.filter((r) => !["closed", "cancelled"].includes(r.status)).length;
  const overdue = control.compliance.filter((r) => r.status === "overdue").length;
  return '<div class="workforce-scene safety-scene" aria-hidden="true"><div class="workforce-grid-floor"></div><div class="safety-overhead"><i></i><i></i><i></i><span>ZONA MONITOREADA</span></div><div class="safety-floor-zone"><span>01</span><strong>PISO SEGURO</strong></div><div class="safety-pedestal safety-person-pad"></div><div class="safety-pedestal safety-risk-pad"></div><div class="safety-pedestal safety-control-pad"></div><div class="safety-ppe-station"><div class="ppe-cabinet"><span class="ppe-label">EPP</span><i class="ppe-helmet"></i><b class="ppe-vest"></b><em class="ppe-boots"></em><small>✓ LISTO</small></div><strong>EQUIPO DE PROTECCIÓN</strong><small>Disponibilidad verificada</small></div><div class="safety-scan"><span></span><i></i><b>' + control.indicators.highRisks + '</b><strong>RIESGO</strong><small>Evaluación activa</small></div><div class="safety-shield"><span>✓</span><strong>CONTROL</strong><small>' + control.indicators.complianceRate + '% conforme</small></div><div class="safety-cone"><span></span><i></i><b></b></div><div class="safety-barrier"><i></i><i></i><span></span></div><div class="safety-route"><i></i><i></i><i></i><span></span></div><div class="workforce-scene-caption"><span>Detectar → evaluar → controlar → verificar</span><strong>' + open + ' EVENTO(S) · ' + overdue + ' VENCIDO(S)</strong></div></div>';
}

function safetySection(control, stage) {
  if (stage === "safety_indicators") return '<section class="metrics workforce-metrics">' +
    metricCard("Eventos últimos 30 días", control.indicators.incidents30Days, "Accidentes, incidentes y casi accidentes", "!", true) +
    metricCard("Eventos con tiempo perdido", control.indicators.lostTimeEvents, "Afectaron la jornada", "⌛") +
    metricCard("Días de incapacidad", inventoryNumber(control.indicators.incapacityDays), "Vinculados a eventos", "+") +
    metricCard("Riesgos altos abiertos", control.indicators.highRisks, "Puntuación de 15 o más", "◇") +
    metricCard("Cumplimiento", control.indicators.complianceRate + "%", "Requisitos aplicables", "✓") + '</section>' +
    '<section class="panel workforce-insight"><div class="panel-head"><div><h3>Lectura preventiva</h3><p>Los indicadores se calculan directamente con los registros operativos.</p></div><span>DATOS EN TIEMPO REAL</span></div><div class="workforce-insight-grid"><article><span>Prioridad</span><strong>' + (control.indicators.highRisks ? "Tratar riesgos altos" : "Operación controlada") + '</strong><p>' + (control.indicators.highRisks ? "Hay peligros con nivel alto que todavía requieren controles." : "No existen riesgos altos abiertos en este momento.") + '</p></article><article><span>Seguimiento</span><strong>' + control.incapacities.filter((r) => r.status === "submitted").length + ' incapacidad(es) por revisar</strong><p>La resolución se administra también desde Recursos Humanos.</p></article><article><span>Normativa</span><strong>' + control.compliance.filter((r) => r.status === "overdue").length + ' requisito(s) vencido(s)</strong><p>Adjunta evidencia y marca el requisito como cumplido.</p></article></div></section>';
  if (stage === "safety_incapacities") return workforceLead("INCAPACIDADES LABORALES", "Incapacidades", "Relaciona la ausencia médica con el accidente, incidente o enfermedad laboral.", "incapacity", "Registrar incapacidad", "safety.manage") +
    workforceTable(["Folio", "Personal", "Evento", "Periodo", "Días", "Certificado", "Estado"], control.incapacities, (r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td><strong>' + escapeHtml(r.employee_name) + '</strong><small>' + escapeHtml(r.employee_number) + '</small></td><td>' + escapeHtml(r.incident_folio || "—") + '</td><td>' + formatDateOnly(r.start_date) + ' — ' + formatDateOnly(r.end_date) + '</td><td>' + inventoryNumber(r.total_days) + '</td><td>' + escapeHtml(r.certificate_number || "Sin certificado") + '</td><td>' + workforceStatus(r.status) + '</td></tr>', "No hay incapacidades vinculadas");
  if (stage === "safety_risks") return workforceLead("ANÁLISIS PREVENTIVO", "Análisis de riesgos", "Evalúa probabilidad y consecuencia; la prioridad se calcula automáticamente.", "risk", "Nuevo análisis", "safety.manage") +
    workforceTable(["Folio", "Área / actividad", "Peligro", "Tipo", "Nivel", "Responsable", "Estado", ""], control.risks, (r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td><strong>' + escapeHtml(r.area_name || "General") + '</strong><small>' + escapeHtml(r.activity) + '</small></td><td>' + escapeHtml(r.hazard) + '</td><td>' + safetyRiskType(r.risk_type) + '</td><td><span class="risk-score risk-' + safetyRiskBand(r.risk_score) + '">' + r.risk_score + ' / 25</span></td><td>' + escapeHtml(r.responsible_name || "Sin asignar") + '</td><td>' + workforceStatus(r.status) + '</td><td>' + safetyRiskActions(r) + '</td></tr>', "No hay análisis de riesgos");
  if (stage === "safety_compliance") return workforceLead("CONTROL NORMATIVO", "Cumplimiento normativo", "Concentra obligaciones, fechas, responsables y evidencia.", "compliance", "Nuevo requisito", "safety.manage") +
    workforceTable(["Folio", "Requisito", "Autoridad", "Vencimiento", "Responsable", "Estado", ""], control.compliance, (r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong><small>' + escapeHtml(r.requirement_code || "Sin clave") + '</small></td><td><strong>' + escapeHtml(r.title) + '</strong><small>' + escapeHtml(r.category || "General") + '</small></td><td>' + escapeHtml(r.authority || "—") + '</td><td>' + (r.due_date ? formatDateOnly(r.due_date) : "Sin fecha") + '</td><td>' + escapeHtml(r.responsible_name || "Sin asignar") + '</td><td>' + workforceStatus(r.status) + '</td><td>' + (hasPermission("safety.approve") && r.status !== "compliant" ? '<button class="link-button" data-safety-action="comply" data-safety-entity="compliance" data-safety-id="' + r.id + '">Marcar cumplido</button>' : "") + '</td></tr>', "No hay requisitos normativos");
  return workforceLead("GESTIÓN DE EVENTOS", "Accidentes e incidentes", "Reporta el evento y conserva investigación, causa y acción correctiva.", "incident", "Reportar evento", "safety.manage") +
    workforceTable(["Folio", "Fecha", "Tipo", "Persona / área", "Descripción", "Severidad", "Estado", ""], control.incidents, (r) => '<tr><td><strong>' + escapeHtml(r.folio) + '</strong></td><td>' + formatDate(r.event_date) + '</td><td>' + safetyEventType(r.event_type) + '</td><td><strong>' + escapeHtml(r.employee_name || "Sin persona") + '</strong><small>' + escapeHtml(r.area_name || r.location || "Sin área") + '</small></td><td>' + escapeHtml(r.description) + '</td><td>' + workforceStatus(r.severity) + '</td><td>' + workforceStatus(r.status) + '</td><td>' + safetyIncidentActions(r) + '</td></tr>', "No hay accidentes ni incidentes");
}

function workforceLead(eyebrow, title, description, action, button, permission) {
  return '<section class="workforce-lead"><div><span class="eyebrow">' + eyebrow + '</span><h2>' + title + '</h2><p>' + description + '</p></div>' + (hasPermission(permission) ? '<button class="button primary" data-safety-new="' + action + '">' + button + '</button>' : "") + '</section>';
}

function workforceTable(headers, rows, renderRow, emptyTitle) {
  return '<section class="panel workforce-panel"><div class="table-wrap"><table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join("") + '</tr></thead><tbody>' + (rows.length ? rows.map(renderRow).join("") : '<tr><td colspan="' + headers.length + '">' + emptyMarkup(emptyTitle, "Crea el primer registro para comenzar.") + '</td></tr>') + '</tbody></table></div></section>';
}

function safetyIncidentActions(row) {
  if (hasPermission("safety.operate") && row.status === "reported") return '<button class="link-button" data-safety-action="investigate" data-safety-entity="incidents" data-safety-id="' + row.id + '">Investigar</button>';
  if (hasPermission("safety.operate") && row.status === "investigating") return '<button class="link-button" data-safety-action="plan" data-safety-entity="incidents" data-safety-id="' + row.id + '">Crear plan</button>';
  if (hasPermission("safety.approve") && ["investigating", "action_plan"].includes(row.status)) return '<button class="link-button" data-safety-action="close" data-safety-entity="incidents" data-safety-id="' + row.id + '">Cerrar</button>';
  return "";
}
function safetyRiskActions(row) {
  if (!hasPermission("safety.operate")) return "";
  const action = row.status === "open" ? "treat" : row.status === "in_treatment" ? "control" : row.status === "controlled" && hasPermission("safety.approve") ? "close" : "";
  return action ? '<button class="link-button" data-safety-action="' + action + '" data-safety-entity="risks" data-safety-id="' + row.id + '">' + ({ treat: "Tratar", control: "Controlar", close: "Cerrar" })[action] + '</button>' : "";
}

function openSafetyModal(type) {
  const o = state.safetyOptions;
  const employeeOptions = '<option value="">Sin asignar</option>' + o.employees.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.employee_number + " · " + r.full_name) + '</option>').join("");
  const areaOptions = '<option value="">Área general</option>' + o.areas.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.code + " · " + r.name) + '</option>').join("");
  const configs = {
    incident: {
      eyebrow: "SEGURIDAD Y SALUD", title: "Reportar evento", endpoint: "/api/safety/incidents", label: "Evento",
      fields: '<div class="form-grid"><label>Tipo de evento<select name="eventType" required><option value="accident">Accidente</option><option value="incident">Incidente</option><option value="near_miss">Casi accidente</option><option value="occupational_disease">Enfermedad laboral</option></select></label><label>Fecha y hora<input name="eventDate" type="datetime-local" value="' + new Date().toISOString().slice(0, 16) + '" required /></label><label>Personal<select name="employeeId">' + employeeOptions + '</select></label><label>Área<select name="areaId">' + areaOptions + '</select></label><label>Ubicación<input name="location" maxlength="180" /></label><label>Severidad<select name="severity"><option value="low">Baja</option><option value="medium">Media</option><option value="high">Alta</option><option value="critical">Crítica</option></select></label></div><label>Descripción<textarea name="description" rows="4" required></textarea></label><label>Acción inmediata<textarea name="immediateAction" rows="3"></textarea></label><label class="check-option"><input name="lostTime" type="checkbox" /><span><strong>Generó tiempo perdido</strong><small>El evento afectó la jornada laboral.</small></span></label>',
    },
    incapacity: {
      eyebrow: "SALUD EN EL TRABAJO", title: "Registrar incapacidad", endpoint: "/api/safety/incapacities", label: "Incapacidad",
      fields: '<div class="form-grid"><label>Evento relacionado<select name="incidentId" required><option value="">Selecciona un evento</option>' + o.incidents.map((r) => '<option value="' + r.id + '">' + escapeHtml(r.folio + " · " + safetyEventType(r.event_type)) + '</option>').join("") + '</select></label><label>Personal<select name="employeeId" required>' + employeeOptions + '</select></label><label>Inicio<input name="startDate" type="date" required /></label><label>Fin<input name="endDate" type="date" required /></label><label>Tipo / diagnóstico<input name="subtype" maxlength="100" /></label><label>Número de certificado<input name="certificateNumber" maxlength="120" /></label><label>Institución médica<input name="medicalProvider" maxlength="180" /></label></div><label>Motivo<textarea name="reason" rows="3" required></textarea></label>',
    },
    risk: {
      eyebrow: "PREVENCIÓN", title: "Nuevo análisis de riesgo", endpoint: "/api/safety/risks", label: "Análisis",
      fields: '<div class="form-grid"><label>Área<select name="areaId">' + areaOptions + '</select></label><label>Actividad<input name="activity" maxlength="240" required /></label><label>Tipo de riesgo<select name="riskType" required><option value="safety">Seguridad</option><option value="physical">Físico</option><option value="chemical">Químico</option><option value="biological">Biológico</option><option value="ergonomic">Ergonómico</option><option value="psychosocial">Psicosocial</option></select></label><label>Probabilidad (1–5)<input name="probability" type="number" min="1" max="5" value="1" required /></label><label>Consecuencia (1–5)<input name="consequence" type="number" min="1" max="5" value="1" required /></label><label>Responsable<select name="responsibleEmployeeId">' + employeeOptions + '</select></label><label>Fecha de revisión<input name="reviewDate" type="date" /></label></div><label>Peligro identificado<textarea name="hazard" rows="3" required></textarea></label><label>Controles existentes o propuestos<textarea name="controls" rows="3"></textarea></label>',
    },
    compliance: {
      eyebrow: "CUMPLIMIENTO", title: "Nuevo requisito normativo", endpoint: "/api/safety/compliance", label: "Requisito",
      fields: '<div class="form-grid"><label>Clave normativa<input name="requirementCode" maxlength="100" /></label><label>Requisito<input name="title" maxlength="240" required /></label><label>Autoridad<input name="authority" maxlength="160" /></label><label>Categoría<input name="category" maxlength="120" /></label><label>Fecha límite<input name="dueDate" type="date" /></label><label>Responsable<select name="responsibleEmployeeId">' + employeeOptions + '</select></label></div><label>Evidencia / referencia<textarea name="evidence" rows="3"></textarea></label><label>Notas<textarea name="notes" rows="3"></textarea></label>',
    },
  };
  const c = configs[type];
  $("#entity-modal-content").innerHTML = '<form id="safety-form"><div class="modal-head"><div><span class="eyebrow">' + c.eyebrow + '</span><h2>' + c.title + '</h2><p class="muted">El folio se asignará automáticamente al guardar.</p></div><button type="button" data-close-modal>×</button></div>' + automaticCodeBanner("AUTOMÁTICO", true) + c.fields + '<p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar</button></div></form>';
  bindModuleForm("#safety-form", c.endpoint, null, c.label);
  entityDialog.showModal();
}

async function renderPayroll() {
  beginPageRender();
  const payrollQuery = state.payrollPeriodId ? `?periodId=${encodeURIComponent(state.payrollPeriodId)}` : "";
  const control = await api("/api/payroll/control" + payrollQuery);
  const cfdi = control.cfdi || { periods: [], receipts: [], indicators: {} };
  const preparation = control.preparation || { selectedPeriod: null, preparation: null, lines: [], totals: {}, warnings: [] };
  if (preparation.selectedPeriod) state.payrollPeriodId = Number(preparation.selectedPeriod.id);
  const payrollSections = new Set(["overview", "receipts", "periods", "incidents"]);
  if (!payrollSections.has(state.payrollSection)) state.payrollSection = "overview";
  const incidentRows = control.incidents.map((row) => '<tr><td><strong>' + escapeHtml(row.employee_name) + '</strong><small>' + escapeHtml(row.employee_number) + '</small></td><td>' + escapeHtml(row.folio) + '</td><td>' + formatDateOnly(row.start_date) + ' — ' + formatDateOnly(row.end_date) + '</td><td>' + inventoryNumber(row.days) + ' d · ' + inventoryNumber(row.hours) + ' h</td><td>' + payrollIncidentStatus(row.status, row.preparation_status) + '</td></tr>').join("");
  const receiptRows = cfdi.receipts.map((row) => `<tr><td><strong>${escapeHtml(row.receiver_name || row.employee_name || "Sin identificar")}</strong><small class="table-note">${escapeHtml(row.receiver_employee_number || row.receiver_rfc)}</small></td><td><strong>${escapeHtml(row.uuid)}</strong><small class="table-note">${row.payroll_type === "E" ? "Extraordinaria" : "Ordinaria"} · ${escapeHtml(row.period_code || "Sin periodo interno")}</small></td><td>${formatDateOnly(row.payment_date)}<small class="table-note">${formatDateOnly(row.period_start)} — ${formatDateOnly(row.period_end)}</small></td><td><strong>${money(row.total, row.currency_code)}</strong><small class="table-note">${row.file_count} archivo(s)</small></td><td>${payrollAssociationBadge(row.association_status)}${row.confirmed_at ? '<small class="table-note">Recepción confirmada</small>' : '<small class="table-note">Sin confirmar</small>'}</td><td><div class="table-actions"><button class="link-button" data-payroll-receipt="${row.id}">Ver</button>${row.association_status !== "associated" && hasPermission("payroll.manage") ? `<button class="link-button" data-payroll-associate="${row.id}">Relacionar</button>` : ""}</div></td></tr>`).join("");
  const periodRows = cfdi.periods.map((row) => `<tr><td><strong>${escapeHtml(row.code)}</strong><small>${payrollFrequencyLabel(row.frequency)}</small></td><td>${formatDateOnly(row.start_date)} — ${formatDateOnly(row.end_date)}</td><td>${formatDateOnly(row.payment_date)}</td><td>${workforceStatus(row.status)}</td></tr>`).join("");
  const storageReady = cfdi.storageProvider && cfdi.storageProvider !== "unconfigured";
  const pendingAssociations = (cfdi.indicators.unmatched || 0) + (cfdi.indicators.ambiguous || 0);
  const pendingIncidents = control.indicators.pending || 0;
  const processedIncidents = control.indicators.processed || 0;
  const includedIncidents = control.indicators.included || processedIncidents;
  const canManage = hasPermission("payroll.manage");
  const canApprove = hasPermission("payroll.approve");
  const sectionClass = (section) => state.payrollSection === section ? "" : " hidden";
  const tab = (section, label, count = null) => `<button type="button" class="payroll-tab${state.payrollSection === section ? " active" : ""}" data-payroll-section="${section}" role="tab" aria-selected="${state.payrollSection === section}"><span>${label}</span>${count == null ? "" : `<strong>${inventoryNumber(count)}</strong>`}</button>`;
  const selectedPayrollPeriod = preparation.selectedPeriod;
  const payrollPeriodOptions = cfdi.periods.map((row) => `<option value="${row.id}" ${Number(row.id) === Number(selectedPayrollPeriod?.id) ? "selected" : ""}>${escapeHtml(row.code)} · ${formatDateOnly(row.start_date)} — ${formatDateOnly(row.end_date)}</option>`).join("");
  const prepayroll = preparation.preparation;
  const prepayrollLines = preparation.lines || [];
  const prepayrollTotals = preparation.totals || {};
  const prepayrollRows = prepayrollLines.map((row) => `<tr><td><strong>${escapeHtml(row.employee_name)}</strong><small>${escapeHtml(row.employee_number)} · ${payrollFrequencyLabel(row.payroll_frequency || selectedPayrollPeriod?.frequency)}</small></td><td><strong>${money(row.base_pay, row.currency_code)}</strong></td><td>${money(row.other_perceptions, row.currency_code)}</td><td class="payroll-negative">− ${money(row.unpaid_leave_deduction, row.currency_code)}${Number(row.incident_count) ? `<small>${row.incident_count} incidencia(s)</small>` : ""}</td><td class="payroll-negative">− ${money(row.tax_deduction, row.currency_code)}</td><td class="payroll-negative">− ${money(row.social_security_deduction, row.currency_code)}</td><td class="payroll-negative">− ${money(row.other_deductions, row.currency_code)}</td><td class="payroll-net"><strong>${money(row.net_pay, row.currency_code)}</strong></td><td>${canManage && prepayroll?.status === "draft" ? `<button class="link-button" data-prepayroll-line="${row.id}">Ajustar</button>` : ""}</td></tr>`).join("");
  const prepayrollWarnings = (preparation.warnings || []).map((warning) => `<li>${escapeHtml(warning)}</li>`).join("");

  pageContent.innerHTML = `
    <section class="payroll-heading">
      <div>
        <span class="eyebrow">RECURSOS HUMANOS / NÓMINA Y CFDI</span>
        <h2>Nómina y CFDI</h2>
        <p>Submódulo laboral para preparar incidencias, periodos y recibos. Finanzas recibe únicamente la información necesaria para su procesamiento.</p>
      </div>
      <span class="payroll-owner-chip"><i></i> Administrado por Recursos Humanos</span>
    </section>
    <section class="payroll-command">
      <div class="payroll-command-copy">
        <span class="payroll-live"><i></i> CONTROL LABORAL Y FISCAL</span>
        <h3>Del expediente al recibo</h3>
        <p>Un flujo único conecta las incidencias autorizadas con cada periodo de nómina y su CFDI.</p>
        <div class="payroll-command-stats">
          <span><strong>${inventoryNumber(pendingIncidents)}</strong><small>incidencias pendientes</small></span>
          <span><strong>${inventoryNumber(cfdi.indicators.receipts || 0)}</strong><small>CFDI importados</small></span>
        </div>
      </div>
      <div class="payroll-flow" aria-label="Flujo operativo de nómina">
        <article class="payroll-flow-step"><span>01</span><div><small>ORIGEN</small><strong>Incidencias</strong><p>Permisos y ajustes autorizados por RH.</p></div><b>${inventoryNumber(pendingIncidents)}</b></article>
        <i aria-hidden="true">→</i>
        <article class="payroll-flow-step"><span>02</span><div><small>PROCESO</small><strong>Periodo</strong><p>Consolida fechas y movimientos laborales.</p></div><b>${inventoryNumber(cfdi.periods.length)}</b></article>
        <i aria-hidden="true">→</i>
        <article class="payroll-flow-step"><span>03</span><div><small>RESULTADO</small><strong>CFDI</strong><p>Relaciona, protege y entrega los recibos.</p></div><b>${inventoryNumber(cfdi.indicators.associated || 0)}</b></article>
      </div>
    </section>
    <nav class="payroll-tabs" role="tablist" aria-label="Secciones de nómina">
      ${tab("overview", "Resumen")}${tab("receipts", "Recibos CFDI", cfdi.indicators.receipts || 0)}${tab("periods", "Periodos", cfdi.periods.length)}${tab("incidents", "Prenómina", pendingIncidents)}
    </nav>
    <div class="payroll-workspace">
      <section class="payroll-workspace-section${sectionClass("overview")}" data-payroll-panel="overview" role="tabpanel">
        <div class="payroll-metrics">
          ${metricCard("CFDI importados", cfdi.indicators.receipts || 0, "XML fiscales registrados", "▣", true)}
          ${metricCard("Relacionados", cfdi.indicators.associated || 0, "Con expediente laboral", "✓")}
          ${metricCard("Bandeja pendiente", pendingAssociations, "Requieren validación", "!")}
          ${metricCard("Por confirmar", cfdi.indicators.pendingConfirmations || 0, "Recepción del colaborador", "→")}
        </div>
        <div class="payroll-overview-grid">
          <article class="payroll-status-card ${storageReady ? "ready" : "warning"}">
            <div class="payroll-status-icon">${storageReady ? "✓" : "!"}</div>
            <div><span>ARCHIVOS PRIVADOS</span><h3>${storageReady ? "Almacenamiento disponible" : "Configuración pendiente"}</h3><p>${storageReady ? "Los XML y PDF pueden resguardarse con auditoría de acceso." : "La carga de XML y PDF permanece bloqueada hasta configurar almacenamiento privado. PostgreSQL conserva solamente metadatos."}</p></div>
          </article>
          <article class="payroll-queue-card">
            <div class="panel-head"><div><span class="eyebrow">TRABAJO PENDIENTE</span><h3>Cola operativa</h3></div></div>
            <button type="button" data-payroll-section="incidents"><span>Incidencias por procesar</span><strong>${inventoryNumber(pendingIncidents)}</strong></button>
            <button type="button" data-payroll-section="receipts"><span>CFDI por relacionar</span><strong>${inventoryNumber(pendingAssociations)}</strong></button>
            <button type="button" data-payroll-section="receipts"><span>Confirmaciones pendientes</span><strong>${inventoryNumber(cfdi.indicators.pendingConfirmations || 0)}</strong></button>
          </article>
        </div>
        <div class="payroll-responsibility">
          <div><span>RH</span><strong>Autoriza y prepara</strong><small>Expedientes, incidencias y periodos</small></div><i>→</i>
          <div><span>FIN</span><strong>Procesa el impacto</strong><small>Cálculo, dispersión y contabilidad</small></div><i>→</i>
          <div><span>COL</span><strong>Recibe y confirma</strong><small>Consulta protegida desde el portal</small></div>
        </div>
      </section>
      <section class="payroll-workspace-section${sectionClass("receipts")}" data-payroll-panel="receipts" role="tabpanel">
        <div class="panel payroll-panel"><div class="panel-head"><div><span class="eyebrow">ARCHIVO FISCAL</span><h3>Recibos CFDI de nómina</h3><p>UUID, relación laboral, archivos privados y confirmación del colaborador.</p></div>${canManage && storageReady ? '<button class="button primary" data-payroll-import>Importar CFDI</button>' : ""}</div>${receiptRows ? `<div class="table-wrap"><table><thead><tr><th>Receptor</th><th>UUID / periodo</th><th>Pago</th><th>Total</th><th>Asociación</th><th></th></tr></thead><tbody>${receiptRows}</tbody></table></div>` : emptyMarkup("Sin recibos CFDI", storageReady ? "Importa un XML de nómina timbrado para comenzar." : "Configura el almacenamiento privado para habilitar la importación.")}</div>
      </section>
      <section class="payroll-workspace-section${sectionClass("periods")}" data-payroll-panel="periods" role="tabpanel">
        <div class="panel payroll-panel"><div class="panel-head"><div><span class="eyebrow">CALENDARIO DE PAGO</span><h3>Periodos de nómina</h3><p>Configura una periodicidad semanal, quincenal, mensual o personalizada.</p></div>${canManage ? '<button class="button primary" data-payroll-period>Nuevo periodo</button>' : ""}</div>${periodRows ? `<div class="table-wrap"><table><thead><tr><th>Periodo</th><th>Rango</th><th>Fecha de pago</th><th>Estado</th></tr></thead><tbody>${periodRows}</tbody></table></div>` : emptyMarkup("Sin periodos", "Crea el primer periodo antes de organizar los CFDI.")}</div>
      </section>
      <section class="payroll-workspace-section${sectionClass("incidents")}" data-payroll-panel="incidents" role="tabpanel">
        <section class="prepayroll-command-bar"><div><span class="eyebrow">PRENÓMINA DEL PERIODO</span><h3>Vista previa de pago</h3><p>Calcula el sueldo esperado, integra incidencias y completa las retenciones antes de generar los CFDI.</p></div><div class="prepayroll-command-actions">${cfdi.periods.length ? `<label><span>Periodo</span><select id="prepayroll-period">${payrollPeriodOptions}</select></label>${canManage && selectedPayrollPeriod?.status !== "closed" && prepayroll?.status !== "finalized" ? `<button class="button primary" type="button" data-prepayroll-generate>${prepayroll ? "Actualizar cálculo" : "Calcular prenómina"}</button>` : ""}${canApprove && prepayroll?.status === "draft" ? '<button class="button dark" type="button" data-prepayroll-finalize>Finalizar prenómina</button>' : ""}` : ""}</div></section>
        ${!cfdi.periods.length ? emptyMarkup("Primero crea un periodo", "La prenómina necesita fechas de inicio, fin y pago para determinar qué incidencias debe incluir.") : !prepayroll ? `<section class="prepayroll-empty"><div>∑</div><h3>El periodo está listo para calcularse</h3><p>Se tomarán el salario base y periodicidad de cada expediente. Los permisos sin goce autorizados se descontarán automáticamente.</p>${canManage ? '<button class="button primary" type="button" data-prepayroll-generate>Calcular ahora</button>' : ""}</section>` : `<section class="prepayroll-summary"><article><span>PERSONAL</span><strong>${inventoryNumber(prepayrollTotals.employees || 0)}</strong><small>colaboradores incluidos</small></article><article><span>PERCEPCIONES</span><strong>${money(prepayrollTotals.grossPay || 0, "MXN")}</strong><small>Sueldo y percepciones adicionales</small></article><article><span>DEDUCCIONES</span><strong>${money(prepayrollTotals.totalDeductions || 0, "MXN")}</strong><small>Incidencias, ISR, IMSS y otras</small></article><article class="net"><span>NETO ESTIMADO</span><strong>${money(prepayrollTotals.netPay || 0, "MXN")}</strong><small>Total previsto a pagar</small></article></section>${prepayrollWarnings ? `<div class="notice warning"><strong>Información pendiente</strong><ul>${prepayrollWarnings}</ul></div>` : ""}<div class="panel payroll-panel prepayroll-detail"><div class="panel-head"><div><span class="eyebrow">DESGLOSE POR COLABORADOR</span><h3>${escapeHtml(selectedPayrollPeriod?.code || "Periodo")}</h3><p>El ISR, IMSS y otros conceptos se capturan como importes preliminares; el cálculo fiscal definitivo debe validarse antes del timbrado.</p></div><span class="status ${prepayroll.status === "finalized" ? "active" : "pending"}">${prepayroll.status === "finalized" ? "Finalizada" : "Borrador editable"}</span></div><div class="table-wrap"><table class="prepayroll-table"><thead><tr><th>Colaborador</th><th>Sueldo base</th><th>Otras percepciones</th><th>Sin goce</th><th>ISR</th><th>IMSS</th><th>Otras deducciones</th><th>Neto</th><th></th></tr></thead><tbody>${prepayrollRows}</tbody><tfoot><tr><th colspan="2">Totales del periodo</th><td>${money(prepayrollTotals.otherPerceptions || 0, "MXN")}</td><td>− ${money(prepayrollTotals.unpaidLeaveDeduction || 0, "MXN")}</td><td>− ${money(prepayrollTotals.taxDeduction || 0, "MXN")}</td><td>− ${money(prepayrollTotals.socialSecurityDeduction || 0, "MXN")}</td><td>− ${money(prepayrollTotals.otherDeductions || 0, "MXN")}</td><td>${money(prepayrollTotals.netPay || 0, "MXN")}</td><td></td></tr></tfoot></table></div></div>`}
        <div class="panel payroll-panel prepayroll-incidents"><div class="panel-head"><div><span class="eyebrow">INCIDENCIAS DE ORIGEN</span><h3>Permisos sin goce autorizados</h3><p>“Lista para prenómina” significa que RH ya aprobó la solicitud y falta calcular el periodo. Al calcularse cambia a “Incluida en borrador”.</p></div><span class="payroll-processed-chip">${inventoryNumber(includedIncidents)} vinculadas</span></div>${incidentRows ? '<div class="table-wrap"><table><thead><tr><th>Colaborador</th><th>Solicitud</th><th>Periodo</th><th>Impacto</th><th>Proceso de nómina</th></tr></thead><tbody>' + incidentRows + '</tbody></table></div>' : emptyMarkup("Sin incidencias", "Los permisos sin goce autorizados aparecerán aquí.")}</div>
      </section>
    </div>`;
  $$('[data-payroll-section]').forEach((button) => button.addEventListener("click", () => {
    state.payrollSection = button.dataset.payrollSection;
    $$('[data-payroll-section]').forEach((item) => {
      item.classList.toggle("active", item.dataset.payrollSection === state.payrollSection && item.classList.contains("payroll-tab"));
      if (item.classList.contains("payroll-tab")) item.setAttribute("aria-selected", String(item.dataset.payrollSection === state.payrollSection));
    });
    $$('[data-payroll-panel]').forEach((panel) => panel.classList.toggle("hidden", panel.dataset.payrollPanel !== state.payrollSection));
  }));
  $$('[data-payroll-period]').forEach((button) => button.addEventListener("click", openPayrollPeriodModal));
  $$('[data-payroll-import]').forEach((button) => button.addEventListener("click", () => openPayrollCfdiImportModal(cfdi.periods)));
  $$('[data-payroll-receipt]').forEach((button) => button.onclick = () => openPayrollCfdiDetail(Number(button.dataset.payrollReceipt)));
  $$('[data-payroll-associate]').forEach((button) => button.onclick = () => openPayrollCfdiAssociation(Number(button.dataset.payrollAssociate)));
  $("#prepayroll-period")?.addEventListener("change", async (event) => {
    state.payrollPeriodId = Number(event.target.value); state.payrollSection = "incidents"; await renderPayroll();
  });
  $$('[data-prepayroll-generate]').forEach((button) => button.onclick = async () => {
    if (!selectedPayrollPeriod) return toast("Crea o selecciona un periodo de nómina.", "error");
    setButtonBusy(button, true, "Calculando…");
    try {
      await api("/api/payroll/preparation/generate", { method: "POST", body: { periodId: selectedPayrollPeriod.id } });
      state.payrollSection = "incidents"; toast("Prenómina calculada con las incidencias autorizadas."); await renderPayroll();
    } catch (error) { toast(error.message, "error"); }
    finally { setButtonBusy(button, false); }
  });
  $$('[data-prepayroll-line]').forEach((button) => button.onclick = () =>
    openPrepayrollLineModal(prepayrollLines.find((row) => Number(row.id) === Number(button.dataset.prepayrollLine))));
  $("[data-prepayroll-finalize]")?.addEventListener("click", async () => {
    if (!await confirmAction({ eyebrow: "CIERRE DE PRENÓMINA", title: "Finalizar cálculo del periodo", message: "Las líneas quedarán protegidas y las incidencias pasarán a incluidas. Confirma solamente después de revisar percepciones y deducciones.", confirmLabel: "Finalizar prenómina" })) return;
    try {
      await api("/api/payroll/preparation/finalize", { method: "POST", body: { preparationId: prepayroll.id } });
      toast("Prenómina finalizada. Las incidencias quedaron incluidas."); await renderPayroll();
    } catch (error) { toast(error.message, "error"); }
  });
}

function openPrepayrollLineModal(line) {
  if (!line) return;
  const gross = Number(line.base_pay || 0) + Number(line.other_perceptions || 0);
  const fixedDeductions = Number(line.unpaid_leave_deduction || 0);
  $("#entity-modal-content").innerHTML = `<form id="prepayroll-line-form"><div class="modal-head"><div><span class="eyebrow">AJUSTE DE PRENÓMINA</span><h2>${escapeHtml(line.employee_name)}</h2><p class="muted">${escapeHtml(line.employee_number)} · Sueldo base ${money(line.base_pay, line.currency_code)}</p></div><button type="button" data-close-modal>×</button></div><section class="prepayroll-line-balance"><div><span>Percepción base</span><strong>${money(line.base_pay, line.currency_code)}</strong></div><div><span>Descuento automático sin goce</span><strong>− ${money(fixedDeductions, line.currency_code)}</strong></div><div class="net"><span>Neto actual</span><strong>${money(line.net_pay, line.currency_code)}</strong></div></section><div class="form-grid"><label>Percepciones adicionales<input name="otherPerceptions" type="number" min="0" step="0.01" value="${Number(line.other_perceptions || 0)}"><small class="field-help">Bonos, comisiones u otros pagos.</small></label><label>Retención ISR<input name="taxDeduction" type="number" min="0" step="0.01" value="${Number(line.tax_deduction || 0)}"><small class="field-help">Importe preliminar a validar.</small></label><label>Seguridad social / IMSS<input name="socialSecurityDeduction" type="number" min="0" step="0.01" value="${Number(line.social_security_deduction || 0)}"></label><label>Otras deducciones<input name="otherDeductions" type="number" min="0" step="0.01" value="${Number(line.other_deductions || 0)}"><small class="field-help">Préstamos, pensión u otros conceptos.</small></label></div><label>Notas<textarea name="notes" rows="3" maxlength="800">${escapeHtml(line.notes || "")}</textarea></label><div class="notice info"><strong>Cálculo transparente</strong><p>Bruto actual: ${money(gross, line.currency_code)}. La deducción por permiso sin goce se obtiene automáticamente del periodo y no se edita aquí.</p></div><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar ajuste</button></div></form>`;
  $("#prepayroll-line-form").onsubmit = async (event) => {
    event.preventDefault(); const form = event.currentTarget, box = $(".form-error", form), submit = $('button[type="submit"]', form);
    setButtonBusy(submit, true, "Guardando…");
    try {
      await api(`/api/payroll/preparation/lines/${line.id}`, { method: "PATCH", body: Object.fromEntries(new FormData(form)) });
      entityDialog.close(); toast("Ajuste de prenómina guardado."); state.payrollSection = "incidents"; await renderPayroll();
    } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
    finally { setButtonBusy(submit, false); }
  };
  entityDialog.showModal();
}

function payrollIncidentStatus(status, preparationStatus = "") {
  if (status === "processed") return '<span class="status active">● Incluida en prenómina</span>';
  if (status === "cancelled") return '<span class="status inactive">Cancelada</span>';
  if (preparationStatus === "draft") return '<span class="status pending">● Incluida en borrador</span>';
  return '<span class="status pending">● Lista para prenómina</span>';
}

function setButtonBusy(button, busy, label = "Procesando…") {
  if (!button) return;
  if (busy) {
    button.dataset.idleLabel = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    if (button.dataset.idleLabel) button.textContent = button.dataset.idleLabel;
    delete button.dataset.idleLabel;
  }
}

function payrollAssociationBadge(status) {
  const labels = { associated: "Relacionado", unmatched: "No relacionado", ambiguous: "Coincidencia ambigua" };
  return `<span class="badge ${status === "associated" ? "success" : "danger"}">● ${labels[status] || status}</span>`;
}

function payrollFrequencyLabel(value) {
  return ({ weekly: "Semanal", biweekly: "Quincenal", monthly: "Mensual", other: "Otra" })[value] || value;
}

function openPayrollPeriodModal() {
  $("#entity-modal-content").innerHTML = `<form id="payroll-period-form"><div class="modal-head"><div><span class="eyebrow">NÓMINA</span><h2>Nuevo periodo</h2><p class="muted">Define el rango y la fecha efectiva de pago.</p></div><button type="button" data-close-modal>×</button></div><div class="form-grid"><label>Código<input name="code" maxlength="60" placeholder="Ej. 2026-Q15" required></label><label>Periodicidad<select name="frequency" required><option value="weekly">Semanal</option><option value="biweekly">Quincenal</option><option value="monthly">Mensual</option><option value="other">Otra</option></select></label><label>Inicio<input name="startDate" type="date" required></label><label>Fin<input name="endDate" type="date" required></label><label>Fecha de pago<input name="paymentDate" type="date" required></label><label>Estado<select name="status"><option value="open">Abierto</option><option value="draft">Borrador</option></select></label></div><label>Notas<textarea name="notes" rows="3" maxlength="800"></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Crear periodo</button></div></form>`;
  $("#payroll-period-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget, box = $(".form-error", form), submit = $('button[type="submit"]', form);
    submit.disabled = true;
    try {
      await api("/api/payroll/periods", { method: "POST", body: Object.fromEntries(new FormData(form)) });
      entityDialog.close(); toast("Periodo de nómina creado."); await renderPayroll();
    } catch (error) {
      submit.disabled = false; box.textContent = error.message; box.classList.remove("hidden");
    }
  };
  entityDialog.showModal();
}

function openPayrollCfdiImportModal(periods) {
  const periodOptions = '<option value="">Sin periodo interno</option>' + periods.map((row) => `<option value="${row.id}">${escapeHtml(row.code)} · ${formatDateOnly(row.payment_date)}</option>`).join("");
  $("#entity-modal-content").innerHTML = `<form id="payroll-cfdi-form"><div class="modal-head"><div><span class="eyebrow">ARCHIVO FISCAL PRIVADO</span><h2>Importar CFDI de nómina</h2><p class="muted">El XML es obligatorio; el PDF puede adjuntarse en la misma operación.</p></div><button type="button" data-close-modal>×</button></div><label>Periodo de nómina<select name="periodId">${periodOptions}</select></label><div class="form-grid"><label>XML timbrado<input name="xml" type="file" accept=".xml,application/xml,text/xml" required><small class="field-help">CFDI 4.0 · complemento Nómina 1.2 · máximo 4 MB</small></label><label>Representación PDF <small>Opcional</small><input name="pdf" type="file" accept=".pdf,application/pdf"><small class="field-help">Máximo 7 MB</small></label></div><div class="notice info"><strong>Validación automática</strong><p>Se verificará el UUID, se detectarán duplicados y se buscará al colaborador por ID laboral, RFC y CURP.</p></div><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Validar e importar</button></div></form>`;
  $("#payroll-cfdi-form").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget, data = new FormData(form), xmlFile = data.get("xml"), pdfFile = data.get("pdf"), box = $(".form-error", form), submit = $('button[type="submit"]', form);
    submit.disabled = true; submit.textContent = "Validando XML…";
    try {
      const body = { periodId: data.get("periodId") || null, xml: { originalName: xmlFile.name, mimeType: xmlFile.type || "application/xml", contentBase64: await fileToBase64(xmlFile) } };
      if (pdfFile?.size) body.pdf = { originalName: pdfFile.name, mimeType: pdfFile.type || "application/pdf", contentBase64: await fileToBase64(pdfFile) };
      const result = await api("/api/payroll/cfdi/receipts", { method: "POST", body });
      entityDialog.close();
      toast(result.receipt.association_status === "associated" ? "CFDI importado y relacionado." : "CFDI importado a la bandeja pendiente.");
      await renderPayroll();
    } catch (error) {
      submit.disabled = false; submit.textContent = "Validar e importar"; box.textContent = error.message; box.classList.remove("hidden");
    }
  };
  entityDialog.showModal();
}

async function openPayrollCfdiDetail(id) {
  try {
    const { receipt } = await api(`/api/payroll/cfdi/receipts/${id}`);
    $("#entity-modal-content").innerHTML = `<div><div class="modal-head"><div><span class="eyebrow">${escapeHtml(receipt.uuid)}</span><h2>${escapeHtml(receipt.employee_name || receipt.receiver_name || "CFDI sin relacionar")}</h2><p class="muted">Pago ${formatDateOnly(receipt.payment_date)} · ${money(receipt.total, receipt.currency_code)}</p></div><button type="button" data-close-modal>×</button></div><section class="metrics">${metricCard("Percepciones", receipt.total_perceptions, receipt.currency_code, "+", true)}${metricCard("Deducciones", receipt.total_deductions, receipt.currency_code, "−")}${metricCard("Otros pagos", receipt.total_other_payments, receipt.currency_code, "+")}</section><div class="card-grid"><article class="info-card"><small>RFC receptor</small><strong>${escapeHtml(receipt.receiver_rfc)}</strong></article><article class="info-card"><small>CURP receptor</small><strong>${escapeHtml(receipt.receiver_curp || "Sin registrar")}</strong></article><article class="info-card"><small>ID laboral XML</small><strong>${escapeHtml(receipt.receiver_employee_number || "Sin registrar")}</strong></article><article class="info-card"><small>Asociación</small><strong>${escapeHtml(receipt.association_status)}</strong></article></div><div class="panel-head"><div><h3>Archivos privados</h3><p>La descarga queda registrada en auditoría.</p></div></div><div class="compact-list">${receipt.files.map((file) => `<div class="sales-control-row"><div><strong>${escapeHtml(file.original_name)}</strong><small>${escapeHtml(file.file_type.toUpperCase())} · ${formatBytes(file.size_bytes)}</small></div><button class="link-button" data-payroll-download="${file.id}" data-name="${escapeAttribute(file.original_name)}">Descargar</button></div>`).join("")}</div><div class="modal-actions"><button class="button primary" type="button" data-close-modal>Cerrar</button></div></div>`;
    $$('[data-payroll-download]', $("#entity-modal-content")).forEach((button) => button.onclick = () => downloadAuthenticatedFile(`/api/payroll/cfdi/receipts/${id}/files/${button.dataset.payrollDownload}`, button.dataset.name));
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

async function openPayrollCfdiAssociation(id) {
  try {
    const options = state.hrOptions || await api("/api/hr/options");
    state.hrOptions = options;
    const employees = options.employees.map((row) => `<option value="${row.id}">${escapeHtml(row.employee_number)} · ${escapeHtml(row.full_name)}</option>`).join("");
    $("#entity-modal-content").innerHTML = `<form id="payroll-associate-form"><div class="modal-head"><div><span class="eyebrow">REVISIÓN MANUAL</span><h2>Relacionar CFDI</h2><p class="muted">Utiliza esta acción sólo después de validar el expediente fiscal.</p></div><button type="button" data-close-modal>×</button></div><label>Colaborador<select name="employeeId" required><option value="">Selecciona un colaborador</option>${employees}</select></label><label>Motivo de la asociación<textarea name="reason" minlength="5" maxlength="500" rows="4" required></textarea></label><p class="form-error hidden"></p><div class="modal-actions"><button type="button" class="button ghost" data-close-modal>Cancelar</button><button class="button primary" type="submit">Guardar relación</button></div></form>`;
    $("#payroll-associate-form").onsubmit = async (event) => {
      event.preventDefault(); const form = event.currentTarget, data = new FormData(form), box = $(".form-error", form);
      try {
        await api(`/api/payroll/cfdi/receipts/${id}/associate`, { method: "PATCH", body: { employeeId: Number(data.get("employeeId")), reason: data.get("reason") } });
        entityDialog.close(); toast("CFDI relacionado y colaborador notificado."); await renderPayroll();
      } catch (error) { box.textContent = error.message; box.classList.remove("hidden"); }
    };
    entityDialog.showModal();
  } catch (error) { toast(error.message, "error"); }
}

let hrUiModulePromise = null;

async function loadHrUiModule() {
  if (!hrUiModulePromise) {
    hrUiModulePromise = import("./modules/hr.js?v=20260901-05")
      .then(({ createHrModule }) => createHrModule({ $, $$, API_BASE, HR_CONTROL_CACHE_MS, state, api, hasPermission, pageContent, entityDialog, confirmAction, requestActionText, beginPageRender, renderIsCurrent, escapeHtml, escapeAttribute, toast, formatDate, formatDateOnly, todayInput, inventoryNumber, emptyMarkup, workforceStatus, hrEmployment, hrShift, hrShiftCatalogSummary, hrParsedShiftSchedule, hrShiftSchedule, hrVacationSeniority, hrServiceYears, hrAutomaticVacationPlan, fileToBase64, downloadAuthenticatedFile, automaticCodeBanner, checkbox, initials }))
      .catch((error) => { hrUiModulePromise = null; throw error; });
  }
  return hrUiModulePromise;
}

async function renderHr() {
  const module = await loadHrUiModule();
  return module.render();
}

function workforceStatus(status) {
  const labels = { active: "Activo", inactive: "Inactivo", leave: "Ausente", low: "Baja", medium: "Media", high: "Alta", critical: "Crítica", reported: "Reportado", investigating: "Investigando", action_plan: "Plan de acción", closed: "Cerrado", cancelled: "Cancelado", open: "Abierto", in_treatment: "En tratamiento", controlled: "Controlado", pending: "Pendiente", compliant: "Cumplido", overdue: "Vencido", not_applicable: "No aplica", submitted: "Por aprobar", approved: "Aprobado", rejected: "Rechazado", entry: "Entrada", exit: "Salida" };
  const danger = ["inactive", "critical", "overdue", "rejected", "cancelled"].includes(status);
  return '<span class="badge ' + (danger ? "danger" : "") + '">● ' + escapeHtml(labels[status] || status || "—") + '</span>';
}
function safetyEventType(type) { return ({ accident: "Accidente", incident: "Incidente", near_miss: "Casi accidente", occupational_disease: "Enfermedad laboral" })[type] || type; }
function safetyRiskType(type) { return ({ physical: "Físico", chemical: "Químico", biological: "Biológico", ergonomic: "Ergonómico", psychosocial: "Psicosocial", safety: "Seguridad" })[type] || type; }
function safetyRiskBand(score) { return score >= 15 ? "critical" : score >= 8 ? "medium" : "low"; }
function hrEmployment(type) { return ({ permanent: "Permanente", temporary: "Temporal", contractor: "Contratista", intern: "Practicante" })[type] || "Sin definir"; }
function hrShift(type) { return ({ day: "Diurno", evening: "Vespertino", night: "Nocturno", mixed: "Mixto" })[type] || "Sin definir"; }
function hrWorkDayLabels(value) {
  const labels = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };
  return String(value || "").split(",").map((day) => labels[day]).filter(Boolean).join(", ");
}
function hrShiftCatalogSummary(shift) {
  const schedule = hrParsedShiftSchedule(shift.schedule_json);
  if (schedule.length) return schedule.map((group) => {
    const days = hrWorkDayLabels(group.days.join(","));
    const periods = group.periods.map((period) => period.start + "–" + period.end).join(" / ");
    return (days || "Sin días") + ": " + periods;
  }).join(" · ");
  const days = hrWorkDayLabels(shift.work_days);
  const breakText = Number(shift.break_minutes) ? " · " + shift.break_minutes + " min descanso" : "";
  return (days || "Sin días") + " · " + shift.start_time + "–" + shift.end_time + breakText;
}
function hrParsedShiftSchedule(value) {
  if (!value) return [];
  try {
    const schedule = JSON.parse(value);
    return Array.isArray(schedule) ? schedule : [];
  } catch {
    return [];
  }
}
function hrShiftSchedule(row) {
  if (row.shift_work_days) return hrShiftCatalogSummary({
    work_days: row.shift_work_days,
    start_time: row.shift_start_time,
    end_time: row.shift_end_time,
    break_minutes: row.shift_break_minutes,
    schedule_json: row.shift_schedule_json,
  });
  return row.work_schedule || "Sin horario";
}
function hrVacationSeniority(plan) {
  const minimum = Number(plan.min_service_years || 0);
  if (plan.max_service_years == null || plan.max_service_years === "") return minimum ? "Desde " + minimum + " años" : "Sin límite de antigüedad";
  return minimum + "–" + Number(plan.max_service_years) + " años";
}
function hrServiceYears(hireDate) {
  if (!hireDate) return 0;
  const [hireYear, hireMonth, hireDay] = String(hireDate).slice(0, 10).split("-").map(Number);
  const [currentYear, currentMonth, currentDay] = todayInput().split("-").map(Number);
  let years = currentYear - hireYear;
  if (currentMonth < hireMonth || (currentMonth === hireMonth && currentDay < hireDay)) years -= 1;
  return Math.max(0, years);
}
function hrAutomaticVacationPlan(plans, hireDate) {
  const years = hrServiceYears(hireDate);
  if (years < 1) return null;
  return [...plans].filter((plan) => Number(plan.min_service_years || 0) <= years
    && (plan.max_service_years == null || plan.max_service_years === "" || Number(plan.max_service_years) >= years))
    .sort((a, b) => Number(b.min_service_years || 0) - Number(a.min_service_years || 0)
      || Number(a.max_service_years == null || a.max_service_years === "") - Number(b.max_service_years == null || b.max_service_years === "")
      || Number(b.id || 0) - Number(a.id || 0))[0]
    || null;
}

function metricCard(label, value, detail, symbol, highlight = false) {
  return `<article class="metric-card ${highlight ? "highlight" : ""}"><div class="metric-top"><span>${label}</span><span class="metric-spark">${symbol}</span></div><strong>${Number(value).toLocaleString("es-MX")}</strong><small>${detail}</small></article>`;
}
function activityItem(item) {
  return `<div class="activity-item"><span class="activity-bullet">${escapeHtml(item.module.slice(0, 1).toUpperCase())}</span><div><strong>${escapeHtml(item.summary)}</strong><small>${escapeHtml(item.full_name || "Sistema")} · ${escapeHtml(item.module)}</small></div><time>${formatDate(item.created_at)}</time></div>`;
}
function checkbox(name, value, label, checked) {
  return `<label class="check-option"><input type="checkbox" name="${name}" value="${value}" ${checked ? "checked" : ""} /><span>${escapeHtml(label)}</span></label>`;
}
function automaticCodeBanner() {
  // El identificador continúa asignándose al guardar; no requiere una vista previa en el formulario.
  return "";
}
function hasPermission(code) { return state.user?.permissions.includes(code); }
function initials(name) { return String(name).split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function firstName(name) { return String(name || "").trim().split(/\s+/)[0] || "usuario"; }
function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(String(value).includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function loadingContext(view) {
  if (masterUi[view] || masterHubViews.has(view)) return { key: "masters", label: "Datos maestros" };
  const contexts = [
    [salesViews, "sales", "Ventas"], [productionViews, "production", "Producción"],
    [inventoryViews, "inventory", "Almacén"], [purchasesViews, "purchases", "Compras"],
    [qualityViews, "quality", "Calidad"], [maintenanceViews, "maintenance", "Mantenimiento"],
    [logisticsViews, "logistics", "Logística"], [financeViews, "finance", "Finanzas"],
    [tasksViews, "tasks", "Tareas"], [safetyViews, "safety", "Seguridad y salud"],
    [hrViews, "hr", "Recursos humanos"], [payrollViews, "payroll", "Nómina"],
  ];
  const match = contexts.find(([views]) => views.has(view));
  return match ? { key: match[1], label: match[2] } : { key: "core", label: "Sistema" };
}

function skeleton() { return moduleLoadingSkeleton(state.currentView); }
function moduleLoadingSkeleton(view, titleEntry = null) {
  const context = loadingContext(view);
  const title = titleEntry?.[0] || context.label;
  return `<section class="module-loading module-loading-${context.key}" role="status" aria-live="polite" aria-label="Cargando ${escapeAttribute(context.label)}">
    <header class="module-loading-head">
      <div><span class="eyebrow">PREPARANDO ${escapeHtml(context.label.toUpperCase())}</span><h2>Cargando ${escapeHtml(title)}</h2><p>Sincronizando información y actividad reciente…</p></div>
      <span class="module-loading-indicator" aria-hidden="true"><i></i><i></i><i></i></span>
    </header>
    <div class="module-loading-switcher" aria-hidden="true">
      ${Array.from({ length: 3 }, () => '<span class="module-loading-selector"><i></i><b></b><em></em></span>').join("")}
    </div>
    <div class="module-loading-command" aria-hidden="true">
      <div class="module-loading-copy"><span></span><strong></strong><i></i><i></i><i></i></div>
      <div class="module-loading-scene"><span></span><span></span><span></span></div>
    </div>
    <div class="module-loading-vitals" aria-hidden="true">
      ${Array.from({ length: 5 }, () => '<span><i></i><strong></strong><small></small></span>').join("")}
    </div>
    <div class="module-loading-panels" aria-hidden="true"><span></span><span></span></div>
  </section>`;
}
function emptyMarkup(title, detail) { return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`; }
function errorState(message) { return `<div class="panel">${emptyMarkup("No fue posible cargar esta sección", message)}</div>`; }
function toast(message, type = "success") {
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  $("#toast-region").append(element);
  setTimeout(() => element.remove(), 4200);
}
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("No fue posible leer el archivo."));
    reader.readAsDataURL(file);
  });
}
async function downloadAuthenticatedFile(path, filename) {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      credentials: "include",
      headers: state.companySlug ? { "X-Company-Slug": state.companySlug } : {},
    });
    if (!response.ok) {
      const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
      if (response.status === 404 && path === "/api/hr/people/import/template") {
        throw new Error("El servidor necesita reiniciarse para habilitar la carga masiva. Recarga la página cuando vuelva a estar disponible.");
      }
      throw new Error(body?.error || "No fue posible descargar el archivo.");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url; link.download = filename || "archivo"; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast(error.message, "error"); }
}
function formatBytes(value) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function money(value, currency = "") { return `${Number(value || 0).toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}${currency ? ` ${currency}` : ""}`; }
function dateRange(from, to) {
  if (!from && !to) return "Sin vigencia definida";
  return `${from ? formatDateOnly(from) : "Inicio abierto"} – ${to ? formatDateOnly(to) : "Sin vencimiento"}`;
}
function formatDateOnly(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(date);
}
function notificationSymbol(type) { return ({ info: "i", success: "✓", warning: "!", error: "×" })[type] ?? "i"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }
function escapeAttribute(value) { return escapeHtml(value); }

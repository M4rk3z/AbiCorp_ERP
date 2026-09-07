import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const hrSource = readFileSync(new URL("../public/modules/hr.js", import.meta.url), "utf8");
const hrComplianceSource = readFileSync(new URL("../public/modules/hr-compliance.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../public/styles.css", import.meta.url), "utf8");
const source = `${appSource}\n${hrSource}`;
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const portalHtml = readFileSync(new URL("../public/portal.html", import.meta.url), "utf8");
const portalSource = readFileSync(new URL("../public/portal.js", import.meta.url), "utf8");
const portalStyles = readFileSync(new URL("../public/portal.css", import.meta.url), "utf8");
const hrReceiptStyles = readFileSync(new URL("../public/hr-receipt.css", import.meta.url), "utf8");

test("la interfaz versiona sus archivos para evitar código obsoleto en caché", () => {
  assert.match(html, /styles\.css\?v=\d{8}-\d+/);
  assert.match(html, /app\.js\?v=\d{8}-\d+/);
});

test("los formularios conservan el folio automático sin mostrar su recuadro informativo", () => {
  assert.match(appSource, /function automaticCodeBanner\(\) \{[^]*return "";/);
  assert.doesNotMatch(appSource, /FOLIO AUTOMÁTICO|FOLIO ASIGNADO|Se calculará al guardar según el tipo y número de registro/);
});

test("la aplicacion operativa usa un sistema consistente de esquinas redondeadas", () => {
  assert.match(stylesSource, /--radius-control: 9px/);
  assert.match(stylesSource, /--radius-card: 14px/);
  assert.match(stylesSource, /--radius-panel: 18px/);
  assert.match(stylesSource, /\.master-command,[^]*border-radius: var\(--radius-panel\)/);
  assert.match(stylesSource, /\.organization-structure-scene article,[^]*border-radius: var\(--radius-card\)/);
  assert.match(stylesSource, /\.page-content :where\(/);
  assert.match(html, /styles\.css\?v=20260901-06/);
  assert.match(html, /app\.js\?v=20260901-08/);
});

test("la portada usa la marca y presenta los módulos en un carrusel", () => {
  assert.match(html, /Tu operación completa,<br \/>en un solo lugar/);
  assert.match(html, /id="login-module-carousel"/);
  assert.doesNotMatch(html, /MÓDULOS CONECTADOS|data-carousel-prev|data-carousel-next/);
  assert.match(html, /Derechos Reservados Fimma/);
  assert.match(html, /VERSIÓN BETA 1\.2/);
  assert.doesNotMatch(html, /NÚCLEO DEL SISTEMA|M4rk3z Solutions|VERSIÓN 0\.1/);
  assert.ok((html.match(/assets\/abicorp-logo\.png/g) ?? []).length >= 4);
  assert.doesNotMatch(html, /class="brand-mark[^"]*">A</);
  assert.match(source, /function initLoginModuleCarousel/);
  assert.match(source, /prefers-reduced-motion/);
});

test("el login detecta la empresa sin pedirla al usuario", () => {
  assert.doesNotMatch(html, /id="login-company"|name="company"/);
  assert.doesNotMatch(source, /loadLoginCompanies|form\.company/);
  assert.match(source, /setCompanyContext\(result\.company\)/);
  assert.match(source, /\["\/api\/companies", "\/api\/auth\/login"\]\.includes\(path\)/);
  assert.match(html, /<span>Entrar<\/span><span aria-hidden="true">→<\/span>/);
  assert.doesNotMatch(html, /Entrar al sistema/);
});

test("el cambio de contraseña permite mostrar cada campo", () => {
  for (const id of ["current-password", "new-password", "confirm-password"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*type="password"`));
    assert.match(html, new RegExp(`data-peek="${id}"`));
  }
  assert.match(source, /button\.setAttribute\("aria-pressed", String\(visible\)\)/);
});

test("el encabezado muestra usuario fecha y hora local", () => {
  const topbar = html.match(/<header class="topbar">[^]*?<\/header>/)?.[0] ?? "";
  const sidebarFoot = html.match(/<div class="sidebar-foot">[^]*?<\/aside>/)?.[0] ?? "";
  assert.match(topbar, /top-profile/);
  assert.match(topbar, /id="profile-name"/);
  assert.match(topbar, /id="logout-button"/);
  assert.match(topbar, /id="current-date"/);
  assert.match(topbar, /id="current-time"/);
  assert.doesNotMatch(sidebarFoot, /profile-mini/);
  assert.match(sidebarFoot, /system-health/);
  assert.match(source, /function startHeaderClock/);
  assert.match(source, /setInterval\(update, 1000\)/);
});

test("la navegación oculta su barra y el cierre de sesión pide confirmación interna", () => {
  assert.match(stylesSource, /\.sidebar nav \{[^}]*scrollbar-width: none/);
  assert.match(stylesSource, /\.sidebar nav::\-webkit-scrollbar \{[^}]*display: none !important/);
  assert.match(stylesSource, /\.sidebar \{[^}]*overflow: hidden/);
  assert.match(appSource, /async function logout\(\) \{[^]*await confirmAction\(\{/);
  assert.match(appSource, /title: "¿Deseas cerrar tu sesión\?"/);
  assert.match(appSource, /confirmLabel: "Cerrar sesión"/);
  assert.match(appSource, /if \(!confirmed\) return/);
  assert.doesNotMatch(appSource, /asksForText \? "✎" : "!"/);
});

test("dashboards permite personalizar atajos y mueve la supervisión a configuración", () => {
  assert.match(html, /data-view="dashboard"[^>]*>[^<]*<span class="nav-icon">⌂<\/span>Dashboards<\/button>/);
  assert.match(source, /dashboardShortcutCatalog/);
  assert.match(source, /dashboardShortcutStorageKey/);
  assert.match(source, /localStorage\.setItem/);
  assert.match(source, /openDashboardShortcutModal/);
  assert.match(source, /data-remove-dashboard-shortcut/);
  assert.match(source, /dashboard-shortcuts-actions[^]*add-dashboard-shortcut/);
  assert.match(source, /settingsSection: "general"/);
  assert.match(source, /data-settings-section="supervision"/);
  assert.match(source, /Supervisión del sistema/);
  assert.match(source, /SQLite local conectado/);
  assert.doesNotMatch(source, /Acciones rápidas/);
});

test("configuración usa una lista predeterminada de zonas horarias", () => {
  assert.match(appSource, /const predefinedTimezones/);
  assert.match(appSource, /America\/Mexico_City/);
  assert.match(appSource, /America\/Chicago/);
  assert.match(appSource, /<select name="timezone" required>/);
  assert.doesNotMatch(appSource, /<input name="timezone"/);
});

test("las vistas no acumulan controladores de clic", () => {
  assert.equal(source.includes('pageContent.addEventListener("click"'), false);
  assert.match(source, /pageContent\.onclick = null/);
});

test("las respuestas antiguas no reemplazan la vista actual", () => {
  const renderStarts = source.match(/beginPageRender\(\)/g)?.length ?? 0;
  const renderGuards = source.match(/renderIsCurrent\(token\)/g)?.length ?? 0;
  assert.ok(renderStarts >= 10);
  assert.ok(renderGuards >= 10);
});

test("almacén concentra las operaciones en un centro visual", () => {
  assert.equal(html.includes('data-view="inventory_stock"'), true);
  for (const view of ["inventory_entries", "inventory_exits", "inventory_transfers", "inventory_adjustments", "inventory_reservations", "inventory_lots", "inventory_locations", "inventory_counts"]) {
    assert.equal(html.includes(`data-view="${view}"`), false);
    assert.equal(source.includes(`"${view}"`), true);
  }
  assert.match(source, /warehouseScene/);
  assert.match(source, /warehouseStockCard/);
  assert.match(source, /data-inventory-action="entry"/);
  assert.match(source, /data-inventory-action="exit"/);
  assert.match(source, /data-inventory-action="transfer"/);
  for (const label of ["Más acciones", "Apartar", "Lotes", "Zonas", "Contar", "Corregir"]) assert.equal(source.includes(label), true);
  assert.match(source, /renderInventoryCountDetail/);
  assert.match(source, /\/api\/inventory\/overview/);
  assert.match(source, /prefetchInventoryOverview/);
  assert.match(source, /error\.status !== 404/);
  assert.match(source, /\/api\/inventory\/balances/);
});

test("todos los módulos comparten una carga contextual y precargan su información", () => {
  assert.match(appSource, /moduleLoadingSkeleton\(view, titles\[view\]\)/);
  assert.match(appSource, /function moduleLoadingSkeleton/);
  assert.match(appSource, /function prefetchViewData/);
  for (const view of ["sales_control", "production_control", "purchases_control", "quality_control", "maintenance_control", "logistics_control", "finance_control", "safety_control", "tasks_assigned"]) {
    assert.match(appSource, new RegExp(`${view}: \\[`));
  }
  assert.match(appSource, /view === "payroll_control"/);
  assert.match(appSource, /loadHrUiModule\(\)/);
  assert.match(appSource, /Promise\.all\(paths\.map/);
  assert.match(stylesSource, /module-loading-shimmer/);
  assert.match(stylesSource, /module-loading-(?:sales|production|quality|hr)/);
  assert.doesNotMatch(appSource, /Cargando información…<\/strong><span>Un momento, por favor/);
});

test("datos maestros muestra sólo los catálogos relacionados con los módulos habilitados", () => {
  assert.equal(html.includes('data-view="masters_hub"'), true);
  for (const view of ["items", "customers", "suppliers", "employees", "resources", "price_lists"]) {
    assert.equal(html.includes(`data-view="${view}"`), false);
    assert.equal(source.includes(`${view}:`), true);
  }
  for (const label of ["Artículos", "Clientes", "Proveedores", "Áreas", "Personal", "Equipos", "Precios"]) {
    assert.equal(source.includes(`label: "${label}"`), true);
  }
  assert.match(source, /renderMasterHub/);
  assert.match(source, /const masterHubModuleRequirements/);
  assert.match(source, /function availableMasterHubTypes/);
  assert.match(source, /const types = availableMasterHubTypes\(\)/);
  assert.match(source, /areas: \["hr", "payroll", "safety", "production", "quality", "maintenance"\]/);
  assert.match(source, /type === "areas" \? "\/api\/areas" : `\/api\/masters\/\$\{type\}`/);
  assert.match(source, /if \(type === "areas"\) return openAreaModal\(record\)/);
  assert.match(source, /state\.masterHubSection = "areas"/);
  assert.match(source, /organization_structure: \{ label: "Estructura"/);
  assert.match(source, /renderOrganizationStructureMaster/);
  assert.match(source, /function organizationChartMarkup/);
  assert.match(source, /organization-chart-branches/);
  assert.match(source, /organization-department-tree/);
  assert.doesNotMatch(source, /ORDEN RECOMENDADO/);
  assert.match(source, /organizationStructureDomainCard/);
  assert.match(source, /data-manage-organization-structure/);
  assert.match(source, /hrModule\.openStructure/);
  assert.match(source, /hasModuleAccess\("maintenance"\)/);
  assert.match(source, /Sin catálogos operativos/);
  assert.doesNotMatch(source, /const types = Object\.keys\(masterUi\)/);
  assert.match(source, /data-open-hr-catalogs/);
  assert.match(source, /Áreas y puestos/);
  assert.match(source, /hrModule\.openCatalogs\("areas"\)/);
  assert.match(hrSource, /return \{ render: renderHr, openCatalogs, openStructure: openOrganizationStructure \}/);
  assert.match(source, /masterDataScene/);
  assert.match(source, /masterHubRecordCard/);
  assert.match(source, /\/api\/masters\/options/);
  assert.match(source, /const employeeReadOnly = type === "employees"/);
  assert.match(source, /data-open-hr/);
  assert.match(source, /if \(type === "employees"\) return navigate\("hr_control"\)/);
  assert.match(source, /maintenance_program/);
  assert.match(source, /renderMaintenanceProgramMaster/);
  assert.match(source, /downloadAnnualMaintenanceTemplate/);
  assert.match(source, /openAnnualMaintenanceImportModal/);
  assert.match(source, /programa-anual-mantenimiento-/);
  assert.match(source, /\/api\/maintenance\/annual-program\/preview/);
  assert.match(source, /\/api\/maintenance\/annual-program\/import/);
});

test("el módulo de ventas concentra el flujo en una sola página", () => {
  assert.equal(html.includes('data-view="sales_control"'), true);
  for (const view of ["sales_prospects", "sales_quotes", "sales_orders", "sales_deliveries", "sales_returns", "sales_invoices"]) assert.equal(html.includes(`data-view="${view}"`), false);
  assert.match(source, /renderSalesControl/);
  assert.match(source, /salesHubHeader/);
  assert.match(source, /salesOperationsScene/);
  assert.match(source, /sales-pipeline-scene/);
  assert.match(source, /sales-order-monitor/);
  assert.doesNotMatch(source, /data-sales-stage/);
  assert.match(source, /openSalesFulfillmentModal/);
  assert.match(source, /\/api\/sales\/control/);
  assert.match(source, /state\.salesOptions = await api\("\/api\/sales\/options"\)/);
});

test("crear un pedido precarga los datos de la cotizacion", () => {
  assert.match(source, /hydrateFromSource/);
  assert.match(source, /\/api\/sales\/documents\/\$\{selectedId\}/);
  assert.match(source, /DATOS PRECARGADOS/);
  assert.match(source, /draftLines\.splice\(0, draftLines\.length/);
});

test("el menu lateral agrupa los modulos en desplegables", () => {
  assert.ok((html.match(/data-nav-group/g) ?? []).length >= 2);
  assert.match(html, /nav-group-toggle/);
  assert.match(source, /setNavGroupOpen/);
  assert.match(source, /openNavGroupForView/);
});

test("la gestión de usuarios queda fuera de la web operativa", () => {
  assert.doesNotMatch(html, /data-view="users"/);
  assert.doesNotMatch(html, /data-view="roles"/);
  assert.doesNotMatch(html, />Usuarios<\/button>/);
  assert.doesNotMatch(html, />Roles y permisos<\/button>/);
});

test("los módulos con una sola pantalla son accesos directos", () => {
  const directViews = ["dashboard", "masters_hub", "inventory_stock", "purchases_control", "sales_control", "production_control", "quality_control", "maintenance_control", "safety_control", "logistics_control", "finance_control", "settings"];
  for (const view of directViews) {
    assert.match(html, new RegExp(`class="nav-item nav-direct[^"]*" data-view="${view}"`));
  }
  const groups = html.match(/<section class="nav-group[^]*?<\/section>/g) ?? [];
  for (const group of groups) assert.ok((group.match(/class="nav-item/g) ?? []).length >= 2);
});

test("seguridad y recursos humanos comparten incapacidades y control operativo", () => {
  assert.equal(html.includes('data-view="safety_control"'), true);
  assert.equal(html.includes('data-view="hr_control"'), true);
  assert.equal(html.includes("Seguridad y salud"), true);
  assert.equal(html.includes("Recursos humanos"), true);
  assert.match(source, /renderSafety/);
  assert.match(source, /renderHr/);
  assert.match(source, /safetyOperationsScene/);
  assert.match(source, /safety-ppe-station/);
  assert.match(source, /safety-shield/);
  assert.match(source, /hrPeopleScene/);
  assert.match(source, /hr-team-console/);
  assert.match(source, /hr-request-console/);
  assert.match(source, /hr-attendance-console/);
  assert.match(source, /data-safety-stage/);
  assert.doesNotMatch(source, /data-hr-stage/);
  assert.match(source, /hrUnifiedDashboard/);
  assert.match(source, /hrAnalyticsDashboard/);
  assert.match(source, /bindHrAnalytics/);
  assert.match(source, /Pulso de Recursos Humanos/);
  assert.match(source, /INTELIGENCIA DE PLANTILLA/);
  assert.match(source, /data-hr-filter="period"/);
  assert.match(source, /data-hr-filter="area"/);
  assert.match(source, /data-hr-filter="shift"/);
  assert.doesNotMatch(source, /row\.shift_name \|\| hrShift\(row\.shift\)\]\)\.entries\(\)/);
  assert.match(source, /data-hr-filter="employment"/);
  assert.match(source, /data-hr-filter="status"/);
  assert.match(source, /hrAbsenceProjection/);
  assert.match(source, /hrAnalyticsAlerts/);
  assert.match(source, /Proyección de disponibilidad/);
  assert.match(source, /Composición de la plantilla/);
  assert.match(source, /data-hr-employee-action="vacation"/);
  assert.match(source, /data-hr-employee-action="incapacity"/);
  assert.match(source, /hr-selected-employee/);
  assert.match(source, /type="hidden" name="employeeId" value="' \+ selectedEmployee\.id/);
  assert.match(source, /Selecciona la solicitud desde la fila de un colaborador activo/);
  assert.match(source, /data-hr-hours-help/);
  assert.match(source, /hr-hours-help-popover/);
  assert.match(source, /¿Cuándo se aplica\?/);
  assert.match(source, /La incapacidad se calcula por fechas/);
  assert.match(source, /data-hr-certificate-help/);
  assert.match(source, /¿Qué debo capturar\?/);
  assert.match(source, /const certificateField = leaveType === "incapacity"/);
  assert.match(source, /const leaveSubtypeOptions =/);
  assert.match(source, /data-vacation-balance/);
  assert.match(source, /if \(leaveType === "vacation"\) \$\("\.hr-hours-field", leaveForm\)\?\.remove\(\)/);
  assert.match(source, /Días solicitados/);
  assert.match(source, /Saldo proyectado/);
  assert.match(source, /\/api\/hr\/leaves\/preview/);
  assert.match(source, /function hrLeavePrintDocument/);
  assert.match(source, /function printHrLeaveReceipt/);
  assert.match(hrSource, /hr-receipt\.css\?v=20260826-01/);
  assert.match(hrSource, /class="receipt-sheet"/);
  assert.match(hrSource, /class="receipt-loading"/);
  assert.match(hrReceiptStyles, /\.receipt-header/);
  assert.match(hrReceiptStyles, /@media print/);
  assert.match(source, /data-hr-print/);
  assert.match(source, /Accidente en trayecto/);
  assert.match(source, /<select name="subtype" required>/);
  assert.doesNotMatch(source, /hr-selected-employee-avatar/);
  assert.doesNotMatch(source, /<b>VINCULADO<\/b>/);
  assert.doesNotMatch(source, /El folio y los días se calculan automáticamente/);
  assert.match(source, /\/api\/safety\/incapacities/);
  assert.match(source, /\/api\/hr\/leaves/);
  assert.doesNotMatch(source, /data-hr-new="attendance"/);
  assert.doesNotMatch(source, /Registrar entrada o salida/);
  assert.doesNotMatch(source, /Asistencia reciente/);
  assert.match(source, /hr-team-head-actions/);
  assert.match(source, /data-hr-new="person">＋ Agregar personal/);
  assert.match(source, /también aparece en Datos Maestros/);
  assert.match(source, /safety_indicators/);
  assert.match(source, /hr-team-panel/);
  assert.match(source, /hr-person-registration/);
  assert.match(source, /hr-person-form/);
  assert.match(source, /hrDigitalFileMarkup/);
  assert.match(source, /name="curp"/);
  assert.match(source, /name="companyId" data-hr-company/);
  assert.match(source, /name="payrollFrequency" required/);
  assert.match(source, /SALARIO · ACCESO RESTRINGIDO/);
  assert.match(source, /file_completion_percent/);
  assert.match(source, /document_expiry_alerts/);
  assert.match(source, /data-view-document/);
  assert.match(source, /Bitácora de acceso/);
  assert.match(source, /hr-labor-grid/);
  assert.match(source, /hr-derived-field/);
  assert.match(source, /hr-photo-picker/);
  assert.match(source, /photoBase64/);
  assert.match(source, /hr-employee-avatar/);
  assert.match(source, /openHrCatalogsModal/);
  assert.match(source, /\/api\/hr\/job-positions/);
  assert.match(source, /\/api\/hr\/work-shifts/);
  assert.match(source, /addHrShiftScheduleGroup/);
  assert.match(source, /readHrShiftSchedule/);
  assert.match(source, /normalizeHrTimeEntry/);
  assert.match(source, /inputmode="numeric"/);
  assert.doesNotMatch(source, /type="time" data-shift-time/);
  assert.match(source, /Regreso/);
  assert.match(source, /Agregar otro horario/);
  assert.match(source, /\/api\/hr\/vacation-plans/);
  assert.match(source, /hr-catalog-submenu/);
  assert.match(source, /data-edit-hr-catalog/);
  assert.match(source, /method: recordId \? "PATCH" : "POST"/);
  assert.match(source, /<h2>Catálogos<\/h2>/);
  assert.doesNotMatch(source, /Un centro conectado para definir las opciones/);
  assert.match(source, /name="positionId"/);
  assert.match(source, /name="workShiftId"/);
  assert.doesNotMatch(source, /name="vacationPlanId"/);
  assert.match(source, /hrAutomaticVacationPlan/);
  assert.match(source, /name="minServiceYears" type="number" min="1"/);
  assert.match(source, /Disponible al cumplir 1 año/);
  assert.match(source, /No se edita: depende de la antigüedad/);
  assert.match(source, /function bindHrEmploymentRules/);
  assert.match(source, /data-employment-section="temporary"/);
  assert.match(source, /data-employment-section="contractor"/);
  assert.match(source, /data-employment-section="intern"/);
  assert.match(source, /No genera antigüedad/);
  assert.match(source, /name="serviceStartDate"/);
  assert.match(source, /name="serviceEndDate"/);
  assert.match(source, /name="requiredServiceHours"/);
  assert.match(source, /function hrPlannedShiftHours/);
  assert.match(source, /HORAS ACUMULADAS/);
  assert.match(source, /ALTAS DEL MES/);
  assert.match(source, /ROTACIÓN DEL MES/);
  assert.doesNotMatch(source, /ÚLTIMA MARCACIÓN/);
  assert.doesNotMatch(source, /MARCACIONES HOY/);
  assert.match(source, /hr-collaborator-head/);
  assert.match(source, /<h2>Colaborador<\/h2>/);
  assert.match(source, /hr-collaborator-folio/);
  assert.doesNotMatch(source, /automaticCodeBanner\(person\.employee_number, false\)/);
  assert.doesNotMatch(source, /Actualiza los datos del expediente sin cambiar su folio/);
  assert.match(source, /showHrPersonConfirmation/);
  assert.match(source, /El expediente se guardó, pero el tablero no pudo actualizarse/);
  assert.match(source, /openHrEditPersonModal/);
  assert.match(source, /data-hr-employee-action="edit"/);
  assert.match(source, /Permiso[\s\S]*Vacaciones[\s\S]*Incapacidad[\s\S]*Dar de baja[\s\S]*Editar expediente/);
  assert.match(source, /openHrDeactivateModal/);
  assert.match(source, /\["inactive", "critical", "overdue", "rejected", "cancelled"\]/);
  assert.match(source, /data-hr-deactivate/);
  assert.match(source, /Confirmar baja/);
  assert.match(source, /hr-edit-action/);
  assert.match(source, /hr-row-actions\[open\]/);
  assert.match(source, /\/api\/hr\/people\/" \+ person\.id/);
  assert.match(source, /Guardar cambios/);
  assert.match(source, /Quitar fotografía/);
  assert.match(source, /Continuar en Recursos Humanos/);
  assert.doesNotMatch(source, /name="vacationBalance"/);
});

test("produccion y calidad exponen sus controles integrados", () => {
  assert.equal(html.includes('data-view="production_control"'), true);
  assert.equal(html.includes('data-view="quality_control"'), true);
  assert.match(source, /renderProduction/);
  assert.match(source, /productionHubHeader/);
  assert.match(source, /productionFactoryScene/);
  assert.match(source, /factory-workcell/);
  assert.match(source, /factory-quality-gate/);
  assert.match(source, /productionOrderFilters/);
  assert.match(source, /data-production-filter/);
  assert.match(source, /openProductionBomModal/);
  assert.match(source, /openProductionActionModal/);
  assert.match(source, /\/api\/production\/control/);
  assert.match(source, /data-sales-production-order/);
  assert.match(source, /Órdenes de trabajo generadas/);
  assert.match(source, /Producto terminado/);
  assert.match(source, /Materia prima requerida/);
  assert.match(source, /Ruta de trabajo/);
  assert.match(source, /renderQuality/);
  assert.match(source, /qualityHubHeader/);
  assert.match(source, /tradeScene\("quality"/);
  assert.match(source, /openQualityPlanModal/);
  assert.match(source, /openQualityInspectionDetail/);
  assert.match(source, /\/api\/quality\/control/);
});

test("mantenimiento integra equipos, ordenes, refacciones y paros", () => {
  assert.equal(html.includes('data-view="maintenance_control"'), true);
  for (const view of ["maintenance_equipment", "maintenance_plans", "maintenance_requests", "maintenance_orders", "maintenance_parts", "maintenance_downtimes", "maintenance_history"]) {
    assert.equal(html.includes('data-view="' + view + '"'), false);
  }
  assert.match(source, /renderMaintenance/);
  assert.match(source, /maintenanceIsoDashboard/);
  assert.match(source, /Programa anual de mantenimiento/);
  assert.match(source, /maintenanceScheduleBadge/);
  assert.match(source, /openMaintenanceSupplierModal/);
  assert.match(source, /printMaintenanceOrder/);
  assert.match(source, /Costo por hora de paro/);
  assert.match(source, /data-open-maintenance-program/);
  assert.match(source, /maintenance-unified-toolbar/);
  assert.doesNotMatch(source, /module-flow maintenance-flow/);
  assert.match(source, /maintenanceHubHeader/);
  assert.match(source, /maintenanceOperationsScene/);
  assert.match(source, /maintenance-bay/);
  assert.match(source, /maintenance-diagnostic/);
  assert.match(source, /maintenanceRequestsPage/);
  assert.match(source, /order_folio/);
  assert.match(source, /openMaintenanceEquipmentModal/);
  assert.match(source, /openMaintenanceOrderModal/);
  assert.match(source, /openMaintenanceActionModal/);
  assert.match(source, /openEquipmentHistory/);
  assert.match(source, /\/api\/maintenance\/control/);
});

test("logistica conecta preparacion, picking, packing y entrega", () => {
  assert.equal(html.includes('data-view="logistics_control"'), true);
  for (const view of ["logistics_preparation", "logistics_picking", "logistics_packing", "logistics_routes", "logistics_carriers", "logistics_evidence", "logistics_confirmation"]) {
    assert.equal(html.includes('data-view="' + view + '"'), false);
    assert.equal(source.includes(view + ":"), true);
  }
  assert.match(source, /renderLogistics/);
  assert.match(source, /logisticsHubHeader/);
  assert.match(source, /logisticsOperationsScene/);
  assert.match(source, /logistics-yard/);
  assert.match(source, /data-logistics-stage/);
  assert.match(source, /openLogisticsPickModal/);
  assert.match(source, /openLogisticsPackModal/);
  assert.match(source, /openLogisticsEvidenceModal/);
  assert.match(source, /openLogisticsConfirmModal/);
  assert.match(source, /\/api\/logistics\/control/);
});

test("finanzas controla ingresos egresos presupuestos y conciliaciones", () => {
  assert.equal(html.includes('data-view="finance_control"'), true);
  for (const view of ["finance_receivables", "finance_payables", "finance_payments", "finance_collections", "finance_cost_centers", "finance_budgets", "finance_reconciliations"]) {
    assert.equal(html.includes('data-view="' + view + '"'), false);
    assert.equal(source.includes(view + ":"), true);
  }
  assert.match(source, /renderFinance/);
  assert.match(source, /financeHubHeader/);
  assert.match(source, /financeTreasuryScene/);
  assert.match(source, /finance-treasury-scene/);
  assert.match(source, /finance-bank-console/);
  assert.match(source, /data-finance-stage/);
  assert.match(source, /openFinancePayableModal/);
  assert.match(source, /openFinanceCollectionModal/);
  assert.match(source, /openFinancePaymentModal/);
  assert.match(source, /openFinanceBudgetModal/);
  assert.match(source, /openFinanceReconciliationModal/);
  assert.match(source, /\/api\/finance\/control/);
});

test("el menu prioriza el flujo de valor antes de las funciones administrativas", () => {
  const orderedViews = [
    "dashboard", "sales_control", "production_control", "inventory_stock", "purchases_control",
    "quality_control", "logistics_control", "maintenance_control", "finance_control",
    "tasks_assigned", "safety_control", "hr_control", "masters_hub", "catalogs", "settings",
  ];
  const positions = orderedViews.map((view) => html.indexOf(`data-view="${view}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("el acceso del colaborador es minimalista y muestra la empresa seleccionada", () => {
  assert.match(portalHtml, /portal\.css\?v=20260807-81/);
  assert.match(portalHtml, /portal\.js\?v=20260901-01/);
  assert.match(portalHtml, /class="brand-copy"/);
  assert.ok((portalHtml.match(/data-portal-company-name/g) ?? []).length >= 2);
  assert.doesNotMatch(portalHtml, /public-features|Tu vida laboral/);
  assert.match(portalSource, /function syncPortalCompanyName/);
  assert.match(portalSource, /company\?\.tradeName \|\| company\?\.legalName/);
  assert.match(portalStyles, /Acceso publico minimalista/);
});

test("horarios presenta un calendario automatico con ausencias y conserva el control real", () => {
  assert.match(hrSource, /CALENDARIO AUTOM.TICO DE PERSONAL/);
  assert.match(hrSource, /No necesitas generar ni publicar semanas/);
  assert.match(hrSource, /data-auto-schedule-week/);
  assert.match(hrSource, /hrAutomaticCalendarCell/);
  assert.match(hrSource, /Control real y correcciones/);
  assert.match(hrSource, /Programado contra real/);
});

test("las confirmaciones operativas pertenecen al ERP y no al navegador", () => {
  assert.match(html, /id="action-dialog"/);
  assert.match(appSource, /function confirmAction/);
  assert.match(appSource, /function requestActionText/);
  assert.match(appSource, /function openActionDialog/);
  assert.doesNotMatch(appSource, /\b(?:confirm|prompt|alert)\s*\(/);
  assert.doesNotMatch(hrSource, /\b(?:confirm|prompt|alert)\s*\(/);
});

test("nomina es un submodulo de Recursos Humanos con salida controlada a Finanzas", () => {
  assert.equal(html.includes('data-view="payroll_control"'), true);
  assert.match(html, /data-permission="payroll\.view"/);
  assert.match(html, /nav-group-hr/);
  assert.match(html, /nav-group-toggle nav-module-toggle/);
  assert.match(html, /nav-module-label/);
  assert.match(html, /Gestión de personal/);
  assert.match(html, /Nómina y CFDI/);
  assert.match(source, /const payrollViews/);
  assert.match(source, /function renderPayroll/);
  assert.match(source, /RECURSOS HUMANOS \/ NÓMINA Y CFDI/);
  assert.match(source, /tab\("overview", "Resumen"\)/);
  assert.match(source, /tab\("receipts", "Recibos CFDI"/);
  assert.match(source, /tab\("periods", "Periodos"/);
  assert.match(source, /tab\("incidents", "Prenómina"/);
  assert.match(source, /Administrado por Recursos Humanos/);
  assert.match(source, /Vista previa de pago/);
  assert.match(source, /Calcular prenómina/);
  assert.match(source, /DESGLOSE POR COLABORADOR/);
  assert.match(source, /Retención ISR/);
  assert.match(source, /Seguridad social \/ IMSS/);
  assert.match(source, /Lista para prenómina/);
  assert.match(source, /\/api\/payroll\/preparation\/generate/);
  assert.match(stylesSource, /\.prepayroll-summary/);
  assert.doesNotMatch(html, /option value="payroll"/);
});

test("la interfaz reutiliza respuestas recientes y RH carga control y catálogos juntos", () => {
  assert.match(source, /const API_GET_CACHE_MS = 15_000/);
  assert.match(source, /const HR_CONTROL_CACHE_MS = 60_000/);
  assert.match(source, /apiGetPending\.has\(cacheKey\)/);
  assert.match(appSource, /function prefetchHrControl/);
  assert.match(appSource, /pointerover", prepareRequestedModule/);
  assert.match(source, /const control = await api\("\/api\/hr\/control", \{ cacheTtlMs: HR_CONTROL_CACHE_MS \}\)/);
  assert.match(source, /const options = control\.options \|\| await api\("\/api\/hr\/options"\)/);
  assert.match(source, /api\("\/api\/notifications", \{ cache: false \}\)/);
  assert.match(appSource, /import\("\.\/modules\/hr\.js\?v=20260901-05"\)/);
  assert.match(hrSource, /export function createHrModule/);
  assert.match(hrSource, /import\("\.\/hr-compliance\.js\?v=20260821-01"\)/);
  assert.doesNotMatch(appSource, /\bformatDateTime\b/);
  assert.doesNotMatch(hrSource, /\bformatDateTime\b/);
  assert.match(hrSource, /PIN 0000 vigente hasta " \+ formatDate\(portal\.activation_expires_at\)/);
});

test("RH carga el canal confidencial únicamente para usuarios autorizados", () => {
  assert.match(hrSource, /hasPermission\("hr\.compliance\.view"\)/);
  assert.match(hrSource, /data-hr-compliance/);
  assert.match(hrComplianceSource, /Canal confidencial/);
  assert.match(hrComplianceSource, /Protección contra represalias activa/);
  assert.match(hrComplianceSource, /\/api\/hr\/compliance\/grievances/);
  assert.match(stylesSource, /\.hr-compliance-center/);
  assert.doesNotMatch(hrComplianceSource, /window\.confirm|window\.alert/);
});

test("el portal, las políticas y el acceso individual de RH tienen responsabilidades separadas", () => {
  const portalStart = hrSource.indexOf("async function openHrPortalModal");
  const portalEnd = hrSource.indexOf("function portalPermission", portalStart);
  const portalModalSource = hrSource.slice(portalStart, portalEnd);

  assert.match(portalModalSource, /\/api\/hr\/portal\/settings/);
  assert.match(portalModalSource, /Guardar estado/);
  assert.match(portalModalSource, /perfil de cada colaborador/);
  assert.doesNotMatch(portalModalSource, /Días festivos|Cobertura por departamento|Accesos individuales|reset-pin/);
  assert.match(hrSource, /Fechas feriadas/);
  assert.match(hrSource, /Políticas y cobertura/);
  assert.match(hrSource, /\/api\/hr\/policies/);
  assert.match(hrSource, /hrEmployeePortalAccessMarkup/);
  assert.match(hrSource, /USUARIO DE ACCESO/);
  assert.match(hrSource, /Reiniciar PIN a 0000/);
  assert.match(hrSource, /Disponibilidad de la cuenta/);
  assert.match(hrSource, /type=\"radio\" name=\"portalAccessStatus\"/);
  assert.match(hrSource, /\[data-profile-portal-status\]:checked/);
  assert.match(portalSource, /const formNode = event\.currentTarget/);
  assert.match(portalSource, /function syncPortalDocumentRules/);
  assert.match(portalSource, /option\?\.dataset\.allowsExpiry === "1"/);
  assert.match(portalHtml, /id="portal-document-expiry-field" hidden/);
  assert.doesNotMatch(portalSource, /event\.currentTarget\.reset\(\)/);
});

test("el expediente de RH usa pestañas internas y abre la sección con errores", () => {
  assert.match(hrSource, /function setupHrProfileTabs/);
  assert.match(hrSource, /role=\"tab\" data-hr-profile-tab/);
  assert.match(hrSource, /Resumen/);
  assert.match(hrSource, /Identidad/);
  assert.match(hrSource, /Laboral/);
  assert.match(hrSource, /label: "Puesto", detail: "Descriptivo y perfil"/);
  assert.match(hrSource, /Documentos/);
  assert.match(hrSource, /Portal/);
  assert.match(hrSource, /addEventListener\("invalid"/);
  assert.match(hrSource, /activate\(panel\.dataset\.hrProfilePanel\)/);
  assert.match(hrSource, /const completionNode = originalNodes\.find/);
  assert.match(hrSource, /if \(completionNode\) fields\.append\(completionNode\)/);
  assert.match(hrSource, /INFORMACI&Oacute;N SALARIAL/);
  assert.match(hrSource, /body\.portalAccess = readHrEmployeePortalAccess\(\)/);
  assert.match(hrSource, /Un solo guardado para todo el expediente/);
  assert.ok((hrSource.match(/\[name="notes"\].+insertAdjacentHTML\("beforebegin".+Parentesco/g) ?? []).length >= 2);
  assert.match(hrSource, /profileHeader\.innerHTML = '<div><span>EXPEDIENTE<\/span>/);
  assert.match(hrSource, /\$\("\.hr-photo-column", editForm\)\.prepend\(profileHeader\)/);
  assert.match(hrSource, /editForm\.append\(modalClose\)/);
  assert.match(hrSource, /\/api\/documents\?employeeId=/);
  assert.match(hrSource, /data-hr-documents-section/);
  assert.match(hrSource, /data-upload-hr-document/);
  assert.match(hrSource, /data-allows-expiry/);
  assert.match(hrSource, /expiryField\.hidden = !allowsExpiry/);
  assert.match(appSource, /document-expiry-field/);
  assert.match(hrSource, /Documento integrado al expediente/);
  assert.match(hrSource, /function printHrPositionProfile/);
  assert.match(hrSource, /data-print-position-document="description">Imprimir descriptivo/);
  assert.match(hrSource, /data-print-position-document="profile">Imprimir perfil/);
  assert.match(hrSource, /function hrPositionProfileMarkup/);
  assert.match(hrSource, /data-hr-position-profile-section/);
  assert.match(hrSource, /data-edit-profile-position/);
  assert.match(hrSource, /data-print-catalog-position/);
  assert.match(hrSource, /¿Qué hace este puesto\?/);
  assert.match(hrSource, /¿Quién puede desempeñar este puesto\?/);
  for (const field of ["profileEducation", "profileExperience", "profileKnowledge", "profileSkills", "profileCompetencies"]) {
    assert.match(hrSource, new RegExp('name="' + field + '"'));
  }
  assert.match(stylesSource, /\.hr-document-checklist/);
  assert.match(stylesSource, /\.hr-position-profile-facts/);
  assert.match(stylesSource, /\.hr-position-profile-requirements/);
  assert.doesNotMatch(hrSource, /data-profile-portal-save>Guardar acceso/);
  assert.match(appSource, /function syncPageDialogLock/);
  assert.doesNotMatch(appSource, /event\.target === entityDialog/);
  assert.match(stylesSource, /\.dialog-open \{ overflow: hidden/);
  assert.match(stylesSource, /overscroll-behavior: contain/);
});

test("recursos humanos permite validar y confirmar una carga masiva", () => {
  assert.match(source, /data-hr-bulk>Carga masiva/);
  assert.match(source, /function openHrBulkImportModal/);
  assert.match(source, /\/api\/hr\/people\/import\/template/);
  assert.match(source, /\/api\/hr\/people\/import\/preview/);
  assert.match(source, /\/api\/hr\/people\/import-batches\//);
  assert.match(source, /El servidor necesita reiniciarse para habilitar la carga masiva/);
  assert.match(source, /Listo con advertencias/);
  assert.match(source, /data-hr-bulk-warning-accept/);
  assert.match(source, /aria-pressed="false"/);
  assert.match(source, /Confirmación aceptada/);
  assert.match(source, /is-accepted/);
  assert.match(source, /data-hr-bulk-file-state/);
  assert.match(source, /Listo para validar/);
  assert.match(source, /Validado ✓/);
  assert.match(source, /hr-bulk-validate-button" type="submit" disabled/);
  assert.match(source, /Importar de todos modos/);
  assert.match(source, /confirmWarnings: hasWarnings/);
});

test("recursos humanos administra áreas desde sus propios catálogos", () => {
  assert.match(source, /areas: \{ number: "01", label: "Áreas"/);
  assert.match(source, /id="hr-area-form"/);
  assert.match(source, /canManageAreas = hasPermission\("areas\.manage"\) \|\| hasPermission\("hr\.approve"\)/);
  assert.match(source, /bindHrCatalogForm\("#hr-area-form", "\/api\/areas"/);
});

test("los formularios bloquean envíos repetidos y muestran el guardado en curso", () => {
  assert.match(source, /document\.addEventListener\("submit", guardFormSubmission, true\)/);
  assert.match(source, /form\.dataset\.submitting === "true"/);
  assert.match(source, /form-save-progress/);
  assert.match(source, /Guardando…/);
  assert.match(source, /No es necesario volver a presionar/);
  assert.match(source, /claimGuardedFormSubmission\(method\)/);
  assert.match(source, /releaseGuardedFormSubmission\(guardedSubmission\)/);
});

test("datos maestros conserva la empresa del Gestor y administra centros y departamentos", () => {
  assert.match(hrSource, /openOrganizationStructure/);
  assert.match(hrSource, /DATOS GENERALES/);
  assert.match(hrSource, /label: "Empresa"/);
  assert.doesNotMatch(hrSource, /El nombre, código y estado de esta empresa/);
  assert.doesNotMatch(hrSource, /Para modificarla, utiliza el Gestor local/);
  assert.match(hrSource, /managedFromControl/);
  assert.match(hrSource, /Centros de trabajo/);
  assert.match(hrSource, /Departamentos/);
  assert.match(hrSource, /\/api\/hr\/structure\/work-centers/);
  assert.doesNotMatch(hrSource, /Zona horaria<input name="timezone"/);
  assert.match(hrSource, /\/api\/hr\/structure\/departments/);
  assert.match(hrSource, /openStructure: openOrganizationStructure/);
});

test("configuración muestra la identidad del Gestor sin permitir editarla", () => {
  assert.match(appSource, /EMPRESA ADMINISTRADA/);
  assert.doesNotMatch(appSource, /Definida desde el Gestor/);
  assert.match(appSource, /managed-company-field/);
  assert.doesNotMatch(appSource, /name="company_name"/);
});

test("las tareas se integran en cada area sin saturar el menu lateral", () => {
  assert.equal(html.includes('data-view="tasks_assigned"'), true);
  assert.match(html, /data-view="tasks_assigned"[^>]*>[^]*Mis tareas<\/button>/);
  for (const view of ["tasks_flows", "tasks_comments", "tasks_rejections", "tasks_reassignments", "tasks_deadlines", "tasks_history"]) {
    assert.equal(html.includes('data-view="' + view + '"'), false);
  }
  assert.doesNotMatch(html, /TAREAS Y APROBACIONES/);
  assert.match(source, /operationalTaskModuleByView/);
  assert.match(source, /appendOperationalTaskPanel/);
  for (const module of ["sales", "production", "inventory", "purchases", "quality", "logistics", "maintenance", "finance", "safety", "hr", "payroll"]) {
    assert.match(source, new RegExp(module + ': "'));
  }
  assert.match(source, /data-operational-task-panel/);
  assert.match(source, /El seguimiento de esta área permanece junto a su operación/);
  assert.match(source, /taskModuleOptions\(defaultModule\)/);
  assert.match(source, /Área operativa<select name="module">/);
  assert.match(source, /Flujos del sistema/);
  assert.match(source, /renderTasks/);
  assert.match(source, /openTaskModal/);
  assert.match(source, /openApprovalFlowModal/);
  assert.match(source, /openTaskCommentModal/);
  assert.match(source, /openTaskActionModal/);
  assert.match(source, /taskDecisionLabel/);
  assert.match(source, /\/api\/tasks\/control/);
});

test("compras conecta solicitud comparación orden recepción devolución y factura", () => {
  assert.equal(html.includes('data-view="purchases_control"'), true);
  for (const view of ["purchases_requests", "purchases_comparisons", "purchases_orders", "purchases_receipts", "purchases_returns", "purchases_invoices"]) {
    assert.equal(html.includes('data-view="' + view + '"'), false);
    assert.equal(source.includes(view + ":"), true);
  }
  assert.match(source, /renderPurchases/);
  assert.match(source, /purchaseHubHeader/);
  assert.match(source, /purchaseOperationsScene/);
  assert.match(source, /purchase-desk/);
  assert.match(source, /purchase-quotes/);
  assert.match(source, /purchase-stage-select/);
  assert.doesNotMatch(source, /data-purchase-stage/);
  assert.match(source, /openPurchaseRequestModal/);
  assert.match(source, /openPurchaseComparisonModal/);
  assert.match(source, /openPurchaseOrderModal/);
  assert.match(source, /openPurchaseReceiptModal/);
  assert.match(source, /openPurchaseReturnModal/);
  assert.match(source, /openPurchaseInvoiceModal/);
  assert.match(source, /\/api\/purchases\/control/);
});

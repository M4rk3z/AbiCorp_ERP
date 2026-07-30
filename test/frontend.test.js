import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("la interfaz versiona sus archivos para evitar código obsoleto en caché", () => {
  assert.match(html, /styles\.css\?v=\d{8}-\d+/);
  assert.match(html, /app\.js\?v=\d{8}-\d+/);
});

test("la portada usa la marca y presenta los módulos en un carrusel", () => {
  assert.match(html, /Tu operación completa,<br \/>en un solo lugar/);
  assert.match(html, /id="login-module-carousel"/);
  assert.doesNotMatch(html, /MÓDULOS CONECTADOS|data-carousel-prev|data-carousel-next/);
  assert.match(html, /Todos los derechos reservados M4rk3z Solutions/);
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
  assert.match(source, /const predefinedTimezones/);
  assert.match(source, /America\/Mexico_City/);
  assert.match(source, /America\/Chicago/);
  assert.match(source, /<select name="timezone" required>/);
  assert.doesNotMatch(source, /<input name="timezone"/);
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
  assert.match(source, /\/api\/inventory\/balances/);
});

test("datos maestros concentra sus seis tipos en un panel visual", () => {
  assert.equal(html.includes('data-view="masters_hub"'), true);
  for (const view of ["items", "customers", "suppliers", "employees", "resources", "price_lists"]) {
    assert.equal(html.includes(`data-view="${view}"`), false);
    assert.equal(source.includes(`${view}:`), true);
  }
  for (const label of ["Artículos", "Clientes", "Proveedores", "Personal", "Equipos", "Precios"]) {
    assert.equal(source.includes(`label: "${label}"`), true);
  }
  assert.match(source, /renderMasterHub/);
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
  const directViews = ["dashboard", "masters_hub", "inventory_stock", "purchases_control", "sales_control", "production_control", "quality_control", "maintenance_control", "safety_control", "hr_control", "logistics_control", "finance_control", "settings"];
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

test("tareas conserva flujos comentarios rechazos y decisiones", () => {
  for (const view of ["tasks_assigned", "tasks_flows", "tasks_comments", "tasks_rejections", "tasks_reassignments", "tasks_deadlines", "tasks_history"]) {
    assert.equal(html.includes('data-view="' + view + '"'), true);
  }
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

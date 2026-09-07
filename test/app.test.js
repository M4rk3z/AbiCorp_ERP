import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApplication } from "../src/app.js";

test("flujo principal del núcleo ERP", async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), "abicorp-erp-test-"));
  const app = createApplication({ dataDir, initialAdminUser: "admin", initialAdminPassword: "Cambiar123!" });
  const server = createServer(app.handle);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    app.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  assert.equal(existsSync(join(dataDir, "abicorp-erp.db")), true);

  const health = await fetch(`${baseUrl}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).database, "connected");
  const applicationScript = await fetch(`${baseUrl}/app.js?v=test`);
  assert.equal(applicationScript.status, 200);
  assert.equal(applicationScript.headers.get("cache-control"), "no-cache");
  const positionDocumentStyles = await fetch(`${baseUrl}/hr-position-document.css?v=test`);
  assert.equal(positionDocumentStyles.status, 200);
  assert.match(positionDocumentStyles.headers.get("content-type"), /text\/css/);

  const rejected = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "incorrecta" }),
  });
  assert.equal(rejected.status, 401);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "Cambiar123!" }),
  });
  assert.equal(login.status, 200);
  const loginData = await login.json();
  const cookie = login.headers.get("set-cookie").split(";")[0];
  const csrf = loginData.csrfToken;
  assert.equal(loginData.user.mustChangePassword, true);
  assert.equal(loginData.user.permissions.includes("users.manage"), true);
  assert.equal(loginData.user.permissions.includes("inventory.adjust"), true);
  assert.equal(loginData.user.permissions.includes("sales.approve"), true);
  assert.equal(loginData.user.permissions.includes("production.close"), true);
  assert.equal(loginData.user.permissions.includes("quality.release"), true);
  assert.equal(loginData.user.permissions.includes("maintenance.close"), true);
  assert.equal(loginData.user.permissions.includes("logistics.confirm"), true);
  assert.equal(loginData.user.permissions.includes("finance.approve"), true);
  assert.equal(loginData.user.permissions.includes("tasks.approve"), true);
  assert.equal(loginData.user.permissions.includes("purchases.approve"), true);

  const forcedChange = await fetch(`${baseUrl}/api/dashboard`, { headers: { Cookie: cookie } });
  assert.equal(forcedChange.status, 428);

  const missingCsrf = await fetch(`${baseUrl}/api/auth/change-password`, {
    method: "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword: "Cambiar123!", newPassword: "NuevaSegura2026!" }),
  });
  assert.equal(missingCsrf.status, 403);

  const passwordChange = await request("/api/auth/change-password", {
    method: "POST",
    body: { currentPassword: "Cambiar123!", newPassword: "NuevaSegura2026!" },
  });
  assert.equal(passwordChange.response.status, 200);
  assert.equal(passwordChange.data.user.mustChangePassword, false);

  const dashboard = await request("/api/dashboard");
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.data.metrics.users, 1);

  const hrPortalSettings = await request("/api/hr/portal/settings");
  assert.equal(hrPortalSettings.response.status, 200);
  assert.equal(typeof hrPortalSettings.data.settings.portal_enabled, "number");
  const hrPolicies = await request("/api/hr/policies");
  assert.equal(hrPolicies.response.status, 200);
  assert.equal(Array.isArray(hrPolicies.data.holidays), true);
  assert.equal(Array.isArray(hrPolicies.data.absenceLimits), true);
  const emptyCompliance = await request("/api/hr/compliance");
  assert.equal(emptyCompliance.response.status, 200);
  assert.equal(emptyCompliance.data.indicators.open, 0);
  const grievance = await request("/api/hr/compliance/grievances", {
    method: "POST",
    body: { title: "Canal confidencial de prueba", description: "Caso protegido creado durante la prueba de integración.",
      category: "ethics", reporterType: "anonymous", severity: "high", confidentiality: "strict" },
  });
  assert.equal(grievance.response.status, 201);
  assert.match(grievance.data.folio, /^CAS-\d{6}$/);
  assert.equal((await request(`/api/hr/compliance/grievances/${grievance.data.id}/evidence`, {
    method: "POST", body: { evidenceType: "note", title: "Nota de recepción", description: "Referencia inicial" },
  })).response.status, 201);
  assert.equal((await request(`/api/hr/compliance/grievances/${grievance.data.id}/action`, {
    method: "POST", body: { action: "assign", investigatorUserId: loginData.user.id, comment: "Asignación de prueba" },
  })).data.status, "triage");
  const grievanceDetail = await request(`/api/hr/compliance/grievances/${grievance.data.id}`);
  assert.equal(grievanceDetail.data.case.reporter_contact, "");
  assert.equal(grievanceDetail.data.evidence.length, 1);
  assert.equal(grievanceDetail.data.history.length, 3);

  const area = await request("/api/areas", {
    method: "POST",
    body: { code: "PROD", name: "Producción", description: "Operaciones de manufactura" },
  });
  assert.equal(area.response.status, 201);
  assert.equal(area.data.folio, "PROD");

  const roles = await request("/api/roles");
  const operationalRole = roles.data.roles.find((role) => role.code === "OPERATIVO");
  assert.ok(operationalRole);
  assert.equal(roles.data.permissions.some((permission) => permission.code === "workflow.approve" && permission.min_level === 3), true);

  const user = await request("/api/users", {
    method: "POST",
    body: {
      username: "operador.uno",
      fullName: "Operador Uno",
      email: "operador@abicorp.local",
      password: "Temporal2026!",
      roleIds: [operationalRole.id],
      areaIds: [area.data.area.id],
    },
  });
  assert.equal(user.response.status, 201);
  assert.equal(user.data.user.roles[0].code, "OPERATIVO");
  assert.equal(user.data.user.areas[0].code, "PROD");

  const company = await request("/api/catalogs/companies", {
    method: "POST",
    body: { legal_name: "Abicorp de México", trade_name: "Abicorp", tax_id: "ABI260101AA1", is_active: true },
  });
  assert.equal(company.response.status, 201);
  assert.match(company.data.code, /^EMP-\d{5}$/);
  const initialHrStructure = await request("/api/hr/structure");
  assert.equal(initialHrStructure.response.status, 200);
  assert.equal(initialHrStructure.data.companies.length, 1);
  assert.equal(initialHrStructure.data.managedCompany.tradeName, "ABICORP");
  const managedHrCompany = initialHrStructure.data.companies[0];
  const blockedHrCompany = await request("/api/hr/structure/companies", {
    method: "POST",
    body: { legalName: "Empresa Estructural", tradeName: "Estructural", taxId: "EST260101AA1" },
  });
  assert.equal(blockedHrCompany.response.status, 409);
  assert.match(blockedHrCompany.data.error, /Centro de Gesti/);
  const hrWorkCenter = await request("/api/hr/structure/work-centers", {
    method: "POST",
    body: { companyId: managedHrCompany.id, name: "Planta de Pruebas", centerType: "plant",
      address: "Zona industrial" },
  });
  assert.equal(hrWorkCenter.response.status, 201);
  assert.match(hrWorkCenter.data.folio, /^CTR-\d{5}$/);
  const hrDepartment = await request("/api/hr/structure/departments", {
    method: "POST",
    body: { companyId: managedHrCompany.id, workCenterId: hrWorkCenter.data.id,
      areaId: area.data.area.id, name: "Recursos Humanos" },
  });
  assert.equal(hrDepartment.response.status, 201);
  assert.match(hrDepartment.data.folio, /^DEP-\d{5}$/);
  const hrStructure = await request("/api/hr/structure");
  assert.equal(hrStructure.response.status, 200);
  assert.equal(hrStructure.data.companies.length, 1);
  assert.equal(hrStructure.data.companies[0].id, managedHrCompany.id);
  const storedHrWorkCenter = hrStructure.data.workCenters.find((row) => row.id === hrWorkCenter.data.id);
  assert.equal(storedHrWorkCenter.timezone, "America/Chicago");
  assert.equal(hrStructure.data.departments.some((row) => row.id === hrDepartment.data.id), true);
  const branch = await request("/api/catalogs/branches", {
    method: "POST",
    body: { company_id: company.data.id, name: "Monterrey", address: "Nuevo León", timezone: "America/Monterrey", is_active: true },
  });
  assert.equal(branch.response.status, 201);
  assert.match(branch.data.code, /^SUC-\d{5}$/);
  const warehouse = await request("/api/catalogs/warehouses", {
    method: "POST",
    body: { branch_id: branch.data.id, name: "Materia prima", description: "Almacén principal", is_active: true },
  });
  assert.equal(warehouse.response.status, 201);
  assert.match(warehouse.data.code, /^ALM-\d{5}$/);
  const secondWarehouse = await request("/api/catalogs/warehouses", {
    method: "POST",
    body: { branch_id: branch.data.id, name: "Producto terminado", description: "Almacén de embarques", is_active: true },
  });
  assert.equal(secondWarehouse.response.status, 201);
  const seededStates = await request("/api/catalogs/document_states");
  assert.equal(seededStates.data.records.some((item) => item.code === "APROBADO"), true);
  const seededUnits = await request("/api/catalogs/units");
  assert.equal(seededUnits.data.records.some((item) => item.code === "PZA"), true);
  const seededCurrencies = await request("/api/catalogs/currencies");
  const mxn = seededCurrencies.data.records.find((item) => item.code === "MXN");
  const piece = seededUnits.data.records.find((item) => item.code === "PZA");

  const item = await request("/api/masters/items", {
    method: "POST",
    body: { name: "Producto terminado de prueba", item_type: "finished", description: "Artículo de validación", unit_id: piece.id, currency_id: mxn.id, standard_cost: 80, list_price: 125, tax_rate: 16, min_stock: 5, max_stock: 100, inventory_tracked: true, purchase_enabled: false, sales_enabled: true, production_enabled: true, is_active: true },
  });
  assert.equal(item.response.status, 201);
  assert.match(item.data.code, /^PT-\d{5}$/);

  const sourceLocation = await request("/api/inventory/locations", {
    method: "POST",
    body: { warehouseId: warehouse.data.id, name: "Rack de recepción", zone: "A", aisle: "01", rack: "R1", level: "1", bin: "A", isActive: true },
  });
  assert.equal(sourceLocation.response.status, 201);
  assert.match(sourceLocation.data.code, /^UBI-\d{5}$/);
  const destinationLocation = await request("/api/inventory/locations", {
    method: "POST",
    body: { warehouseId: secondWarehouse.data.id, name: "Rack de surtido", zone: "B", aisle: "02", rack: "R2", level: "1", bin: "B", isActive: true },
  });
  assert.equal(destinationLocation.response.status, 201);

  const lot = await request("/api/inventory/lots", {
    method: "POST",
    body: { itemId: item.data.id, lotNumber: "", manufacturingDate: "2026-07-01", expirationDate: "2027-07-01", status: "active", notes: "Lote automático" },
  });
  assert.equal(lot.response.status, 201);
  assert.match(lot.data.lotNumber, /^LOT-\d{6}$/);
  const serial = await request("/api/inventory/serials", {
    method: "POST",
    body: { itemId: item.data.id, serialNumber: "", lotId: lot.data.id, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id, status: "available", notes: "Serie automática" },
  });
  assert.equal(serial.response.status, 201);
  assert.match(serial.data.serialNumber, /^SER-\d{7}$/);

  const entry = await request("/api/inventory/entries", {
    method: "POST",
    body: { itemId: item.data.id, quantity: 100, toWarehouseId: warehouse.data.id, toLocationId: sourceLocation.data.id, lotId: lot.data.id, unitCost: 80, reason: "Recepción inicial", reference: "OC-PRUEBA" },
  });
  assert.equal(entry.response.status, 201);
  assert.match(entry.data.folio, /^ENT-\d{6}$/);
  const reservation = await request("/api/inventory/reservations", {
    method: "POST",
    body: { itemId: item.data.id, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id, lotId: lot.data.id, quantity: 20, reference: "PED-001", requiredAt: "2026-07-30" },
  });
  assert.equal(reservation.response.status, 201);
  assert.match(reservation.data.folio, /^RES-\d{6}$/);
  const exit = await request("/api/inventory/exits", {
    method: "POST",
    body: { itemId: item.data.id, quantity: 10, fromWarehouseId: warehouse.data.id, fromLocationId: sourceLocation.data.id, lotId: lot.data.id, reason: "Consumo de prueba" },
  });
  assert.equal(exit.response.status, 201);
  assert.match(exit.data.folio, /^SAL-\d{6}$/);
  const rejectedExit = await request("/api/inventory/exits", {
    method: "POST",
    body: { itemId: item.data.id, quantity: 1000, fromWarehouseId: warehouse.data.id, fromLocationId: sourceLocation.data.id, lotId: lot.data.id },
  });
  assert.equal(rejectedExit.response.status, 409);
  const transfer = await request("/api/inventory/transfers", {
    method: "POST",
    body: { itemId: item.data.id, quantity: 15, fromWarehouseId: warehouse.data.id, fromLocationId: sourceLocation.data.id, toWarehouseId: secondWarehouse.data.id, toLocationId: destinationLocation.data.id, lotId: lot.data.id, reference: "TRASPASO-1" },
  });
  assert.equal(transfer.response.status, 201);
  assert.match(transfer.data.folio, /^TRA-\d{6}$/);
  const adjustment = await request("/api/inventory/adjustments", {
    method: "POST",
    body: { itemId: item.data.id, quantity: 5, toWarehouseId: secondWarehouse.data.id, toLocationId: destinationLocation.data.id, lotId: lot.data.id, unitCost: 80, reason: "Hallazgo físico" },
  });
  assert.equal(adjustment.response.status, 201);
  assert.match(adjustment.data.folio, /^AJU-\d{6}$/);

  let stock = await request("/api/inventory/balances");
  assert.equal(stock.response.status, 200);
  assert.equal(stock.data.balances.reduce((sum, row) => sum + row.quantity, 0), 95);
  assert.equal(stock.data.balances.reduce((sum, row) => sum + row.reserved_quantity, 0), 20);
  const inventoryOverview = await request("/api/inventory/overview");
  assert.equal(inventoryOverview.response.status, 200);
  assert.equal(inventoryOverview.data.options.warehouses.length, 2);
  assert.equal(inventoryOverview.data.balances.length, stock.data.balances.length);
  assert.equal(inventoryOverview.data.movements.length, 4);
  const released = await request(`/api/inventory/reservations/${reservation.data.id}/release`, { method: "POST", body: {} });
  assert.equal(released.response.status, 200);

  const count = await request("/api/inventory/counts", {
    method: "POST",
    body: { warehouseId: warehouse.data.id, scheduledAt: "2026-07-22", notes: "Conteo de validación" },
  });
  assert.equal(count.response.status, 201);
  assert.match(count.data.folio, /^CNT-\d{6}$/);
  const countDetail = await request(`/api/inventory/counts/${count.data.id}`);
  assert.equal(countDetail.data.lines.length, 1);
  const countLine = countDetail.data.lines[0];
  const countCapture = await request(`/api/inventory/counts/${count.data.id}/lines/${countLine.id}`, {
    method: "PATCH", body: { countedQuantity: 73 },
  });
  assert.equal(countCapture.response.status, 200);
  const countComplete = await request(`/api/inventory/counts/${count.data.id}/complete`, { method: "POST", body: {} });
  assert.equal(countComplete.response.status, 200);
  assert.equal(countComplete.data.adjustments, 1);
  stock = await request("/api/inventory/balances");
  assert.equal(stock.data.balances.reduce((sum, row) => sum + row.quantity, 0), 93);
  const customer = await request("/api/masters/customers", {
    method: "POST",
    body: { legal_name: "Cliente de Prueba SA", trade_name: "Cliente Prueba", tax_id: "CPR260101AA1", email: "compras@cliente.local", phone: "8112345678", address: "Monterrey", currency_id: mxn.id, payment_terms_days: 30, credit_limit: 50000, is_active: true },
  });
  assert.equal(customer.response.status, 201);
  assert.match(customer.data.code, /^CLI-\d{5}$/);
  const supplier = await request("/api/masters/suppliers", {
    method: "POST",
    body: { legal_name: "Proveedor de Prueba SA", trade_name: "Proveedor Prueba", tax_id: "PPR260101AA1", email: "ventas@proveedor.local", phone: "8187654321", address: "Saltillo", currency_id: mxn.id, payment_terms_days: 15, lead_time_days: 7, is_active: true },
  });
  assert.equal(supplier.response.status, 201);
  assert.match(supplier.data.code, /^PRV-\d{5}$/);
  const blockedMasterEmployee = await request("/api/masters/employees", {
    method: "POST",
    body: { full_name: "Empleado de Prueba", email: "empleado@abicorp.local", phone: "8100000000", area_id: area.data.area.id, position: "Operador", hire_date: "2026-07-01", status: "active" },
  });
  assert.equal(blockedMasterEmployee.response.status, 405);
  assert.match(blockedMasterEmployee.data.error, /Recursos Humanos/);

  const jobPosition = await request("/api/hr/job-positions", {
    method: "POST",
    body: {
      name: "Coordinación SST",
      description: "Coordinar el sistema de seguridad y salud y reportar a Dirección.",
      profileEducation: "Ingeniería Industrial o afín.",
      profileExperience: "Tres años en seguridad industrial.",
      profileKnowledge: "Normatividad SST y análisis de riesgos.",
      profileSkills: "Comunicación, organización y análisis.",
      profileCompetencies: "Liderazgo preventivo y orientación a resultados.",
    },
  });
  assert.equal(jobPosition.response.status, 201);
  assert.match(jobPosition.data.folio, /^PUE-\d{5}$/);
  const workShift = await request("/api/hr/work-shifts", {
    method: "POST",
    body: { name: "Turno administrativo", startTime: "08:00", endTime: "17:00", breakMinutes: 60, workDays: ["mon", "tue", "wed", "thu", "fri"] },
  });
  assert.equal(workShift.response.status, 201);
  assert.match(workShift.data.folio, /^TUR-\d{5}$/);
  const splitWorkShift = await request("/api/hr/work-shifts", {
    method: "POST",
    body: {
      name: "Administrativo con sábado",
      scheduleGroups: [
        {
          days: ["mon", "tue", "wed", "thu", "fri"],
          periods: [{ start: "09:00", end: "14:00" }, { start: "16:00", end: "19:00" }],
        },
        {
          days: ["sat"],
          periods: [{ start: "09:00", end: "14:00" }],
        },
      ],
    },
  });
  assert.equal(splitWorkShift.response.status, 201);
  assert.match(splitWorkShift.data.folio, /^TUR-\d{5}$/);
  const hrOptions = await request("/api/hr/options");
  assert.equal(hrOptions.data.areaCatalog.some((row) => row.code === "PROD" && row.description === "Operaciones de manufactura"), true);
  const savedPositionProfile = hrOptions.data.jobPositions.find((row) => row.id === jobPosition.data.id);
  assert.match(savedPositionProfile.description, /Coordinar el sistema/);
  assert.match(savedPositionProfile.profile_education, /Ingeniería Industrial/);
  assert.match(savedPositionProfile.profile_experience, /Tres años/);
  assert.match(savedPositionProfile.profile_knowledge, /Normatividad SST/);
  assert.match(savedPositionProfile.profile_skills, /Comunicación/);
  assert.match(savedPositionProfile.profile_competencies, /Liderazgo preventivo/);
  const savedSplitShift = hrOptions.data.workShifts.find((row) => row.id === splitWorkShift.data.id);
  assert.equal(JSON.parse(savedSplitShift.schedule_json).length, 2);
  assert.equal(JSON.parse(savedSplitShift.schedule_json)[0].periods.length, 2);
  assert.equal(savedSplitShift.work_days, "mon,tue,wed,thu,fri,sat");
  const vacationPlan = await request("/api/hr/vacation-plans", {
    method: "POST",
    body: { name: "Plan de prueba", annualDays: 12, minServiceYears: 1, maxServiceYears: 1, description: "Plan inicial" },
  });
  assert.equal(vacationPlan.response.status, 201);
  assert.match(vacationPlan.data.folio, /^PLV-\d{5}$/);

  const hrPerson = await request("/api/hr/people", {
    method: "POST",
    body: {
      fullName: "Especialista SST",
      email: "sst@abicorp.local",
      phone: "8100000001",
      areaId: area.data.area.id,
      positionId: jobPosition.data.id,
      hireDate: new Date().toISOString().slice(0, 10),
      employmentType: "permanent",
      workShiftId: workShift.data.id,
      emergencyContact: "Contacto SST",
      emergencyPhone: "8100000099",
      photoName: "especialista.png",
      photoMime: "image/png",
      photoBase64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    },
  });
  assert.equal(hrPerson.response.status, 201);
  assert.match(hrPerson.data.folio, /^E-\d{5}$/);
  const recentPermanentControl = await request("/api/hr/control");
  const recentPermanent = recentPermanentControl.data.people.find((row) => row.id === hrPerson.data.id);
  assert.equal(recentPermanent.vacation_balance, 0);
  assert.equal(recentPermanent.vacation_plan_id, null);
  const employeePhoto = await fetch(`${baseUrl}/api/hr/people/${hrPerson.data.id}/photo`, { headers: { Cookie: cookie } });
  assert.equal(employeePhoto.status, 200);
  assert.equal(employeePhoto.headers.get("content-type"), "image/png");
  assert.ok((await employeePhoto.arrayBuffer()).byteLength > 20);
  const personUpdate = await request(`/api/hr/people/${hrPerson.data.id}`, {
    method: "PATCH",
    body: {
      fullName: "Especialista SST Actualizado",
      email: "sst.actualizado@abicorp.local",
      phone: "8100000022",
      areaId: area.data.area.id,
      positionId: jobPosition.data.id,
      hireDate: "2026-07-16",
      employmentType: "temporary",
      contractEndDate: "2026-12-31",
      status: "active",
      workShiftId: splitWorkShift.data.id,
      emergencyContact: "Contacto actualizado",
      emergencyPhone: "8100000088",
      notes: "Expediente actualizado desde Recursos Humanos",
      removePhoto: false,
      portalAccess: {
        status: "active",
        canViewFile: true,
        canViewVacation: true,
        canCreateRequests: true,
        canUploadDocuments: false,
        canViewSchedule: true,
        canViewSalary: false,
        canViewCfdi: true,
        canViewMedical: false,
      },
    },
  });
  assert.equal(personUpdate.response.status, 200);
  assert.equal(personUpdate.data.folio, hrPerson.data.folio);
  const updatedHrControl = await request("/api/hr/control");
  const updatedPerson = updatedHrControl.data.people.find((row) => row.id === hrPerson.data.id);
  assert.equal(updatedPerson.full_name, "Especialista SST Actualizado");
  assert.equal(updatedPerson.phone, "8100000022");
  assert.equal(updatedPerson.employment_type, "temporary");
  assert.equal(updatedPerson.contract_end_date, "2026-12-31");
  assert.equal(updatedPerson.work_shift_id, splitWorkShift.data.id);
  assert.match(updatedPerson.work_schedule, /09:00–14:00/);
  assert.equal(updatedPerson.vacation_balance, 0);
  assert.equal(updatedPerson.vacation_plan_id, null);
  const unifiedPortalAccess = await request(`/api/hr/portal/employees/${hrPerson.data.id}`);
  assert.equal(unifiedPortalAccess.response.status, 200);
  assert.equal(unifiedPortalAccess.data.access.access_status, "active");
  assert.equal(unifiedPortalAccess.data.access.can_upload_documents, 0);
  assert.equal(unifiedPortalAccess.data.access.can_view_medical, 0);
  const rejectedTemporaryVacation = await request("/api/hr/leaves", {
    method: "POST",
    body: {
      employeeId: hrPerson.data.id,
      leaveType: "vacation",
      startDate: "2026-08-10",
      endDate: "2026-08-11",
      reason: "No debe aplicar",
    },
  });
  assert.equal(rejectedTemporaryVacation.response.status, 409);
  const contractorPerson = await request("/api/hr/people", {
    method: "POST",
    body: {
      fullName: "Especialista contratista",
      email: "contratista@abicorp.local",
      hireDate: "2026-07-20",
      employmentType: "contractor",
      workShiftId: workShift.data.id,
      organizationName: "Servicios Industriales del Norte",
      organizationContactName: "Coordinación externa",
      organizationContactPhone: "8100000033",
      organizationContactEmail: "contacto@servicios.local",
      organizationDetails: "Proveedor especializado",
      serviceStartDate: "2026-08-01",
      serviceEndDate: "2026-08-10",
    },
  });
  assert.equal(contractorPerson.response.status, 201);
  const internPerson = await request("/api/hr/people", {
    method: "POST",
    body: {
      fullName: "Practicante de calidad",
      email: "practicante@abicorp.local",
      hireDate: "2026-07-21",
      employmentType: "intern",
      workShiftId: workShift.data.id,
      organizationName: "Universidad Técnica",
      organizationDetails: "Programa de estadías",
      serviceStartDate: "2026-07-21",
      serviceEndDate: "2026-07-31",
      requiredServiceHours: 80,
      advisorName: "Asesora Académica",
      advisorPhone: "8100000044",
      advisorEmail: "asesora@universidad.local",
    },
  });
  assert.equal(internPerson.response.status, 201);
  const employmentControl = await request("/api/hr/control");
  const savedContractor = employmentControl.data.people.find((row) => row.id === contractorPerson.data.id);
  const savedIntern = employmentControl.data.people.find((row) => row.id === internPerson.data.id);
  assert.equal(savedContractor.work_shift_id, null);
  assert.equal(savedContractor.organization_name, "Servicios Industriales del Norte");
  assert.equal(savedContractor.vacation_balance, 0);
  assert.equal(savedContractor.service_total_days, 10);
  assert.equal(savedIntern.organization_name, "Universidad Técnica");
  assert.equal(savedIntern.advisor_name, "Asesora Académica");
  assert.equal(savedIntern.vacation_plan_id, null);
  assert.equal(savedIntern.required_service_hours, 80);
  assert.ok(savedIntern.completed_service_hours > 0);
  assert.ok(savedIntern.completed_service_hours <= savedIntern.required_service_hours);
  assert.equal(savedIntern.remaining_service_hours,
    Math.round((savedIntern.required_service_hours - savedIntern.completed_service_hours) * 100) / 100);
  assert.ok(savedIntern.service_progress_percent > 0);
  assert.ok(savedIntern.planned_service_hours >= savedIntern.completed_service_hours);
  const retainedPhoto = await fetch(`${baseUrl}/api/hr/people/${hrPerson.data.id}/photo`, { headers: { Cookie: cookie } });
  assert.equal(retainedPhoto.status, 200);
  const updatedPosition = await request(`/api/hr/job-positions/${jobPosition.data.id}`, {
    method: "PATCH",
    body: {
      name: "Coordinación SST y ambiente",
      description: "Administrar el sistema integral y sus indicadores.",
      profileEducation: "Ingeniería Ambiental, Industrial o afín.",
      profileExperience: "Cuatro años en SST y ambiente.",
      profileKnowledge: "ISO 14001, ISO 45001 y legislación aplicable.",
      profileSkills: "Análisis, comunicación y gestión de proyectos.",
      profileCompetencies: "Liderazgo, ética y orientación preventiva.",
    },
  });
  assert.equal(updatedPosition.response.status, 200);
  assert.equal(updatedPosition.data.folio, jobPosition.data.folio);
  const renamedPosition = await request(`/api/hr/job-positions/${jobPosition.data.id}`, {
    method: "PATCH",
    body: { name: "Coordinación SST y ambiente" },
  });
  assert.equal(renamedPosition.response.status, 200);
  const optionsAfterPartialPositionUpdate = await request("/api/hr/options");
  const positionAfterPartialUpdate = optionsAfterPartialPositionUpdate.data.jobPositions
    .find((row) => row.id === jobPosition.data.id);
  assert.equal(positionAfterPartialUpdate.description, "Administrar el sistema integral y sus indicadores.");
  assert.match(positionAfterPartialUpdate.profile_education, /Ingeniería Ambiental/);
  assert.match(positionAfterPartialUpdate.profile_experience, /Cuatro años/);
  assert.match(positionAfterPartialUpdate.profile_knowledge, /ISO 14001/);
  assert.match(positionAfterPartialUpdate.profile_skills, /gestión de proyectos/);
  assert.match(positionAfterPartialUpdate.profile_competencies, /orientación preventiva/);
  const updatedShift = await request(`/api/hr/work-shifts/${splitWorkShift.data.id}`, {
    method: "PATCH",
    body: {
      name: "Administrativo flexible",
      scheduleGroups: [
        {
          days: ["mon", "tue", "wed", "thu", "fri"],
          periods: [{ start: "09:00", end: "14:00" }, { start: "16:00", end: "19:00" }],
        },
        {
          days: ["sat"],
          periods: [{ start: "10:00", end: "14:00" }],
        },
      ],
    },
  });
  assert.equal(updatedShift.response.status, 200);
  assert.equal(updatedShift.data.folio, splitWorkShift.data.folio);
  const updatedVacationPlan = await request(`/api/hr/vacation-plans/${vacationPlan.data.id}`, {
    method: "PATCH",
    body: {
      name: "Plan base actualizado",
      annualDays: 14,
      minServiceYears: 1,
      maxServiceYears: 1,
      description: "Plan actualizado desde el catálogo",
    },
  });
  assert.equal(updatedVacationPlan.response.status, 200);
  assert.equal(updatedVacationPlan.data.folio, vacationPlan.data.folio);

  const safetyIncident = await request("/api/safety/incidents", {
    method: "POST",
    body: { employeeId: hrPerson.data.id, areaId: area.data.area.id, eventType: "accident", eventDate: "2026-07-25T10:30", location: "Nave A", description: "Golpe menor durante maniobra", immediateAction: "Valoración y aislamiento del área", severity: "medium", lostTime: true },
  });
  assert.equal(safetyIncident.response.status, 201);
  assert.match(safetyIncident.data.folio, /^SST-\d{6}$/);

  const safetyIncapacity = await request("/api/safety/incapacities", {
    method: "POST",
    body: { incidentId: safetyIncident.data.id, employeeId: hrPerson.data.id, subtype: "Accidente de trabajo", startDate: "2026-07-25", endDate: "2026-07-27", reason: "Reposo indicado", certificateNumber: "CERT-001", medicalProvider: "Clínica local" },
  });
  assert.equal(safetyIncapacity.response.status, 201);
  assert.match(safetyIncapacity.data.folio, /^INA-\d{6}$/);

  const risk = await request("/api/safety/risks", {
    method: "POST",
    body: { areaId: area.data.area.id, activity: "Movimiento de materiales", hazard: "Atrapamiento durante maniobra", riskType: "safety", probability: 4, consequence: 4, controls: "Delimitar y usar señalero", responsibleEmployeeId: hrPerson.data.id, reviewDate: "2026-08-15" },
  });
  assert.equal(risk.response.status, 201);
  assert.match(risk.data.folio, /^RIE-\d{6}$/);

  const compliance = await request("/api/safety/compliance", {
    method: "POST",
    body: { requirementCode: "NOM-SST-01", title: "Revisión mensual de condiciones", authority: "STPS", category: "Seguridad", dueDate: "2026-08-01", responsibleEmployeeId: hrPerson.data.id, evidence: "Lista de verificación" },
  });
  assert.equal(compliance.response.status, 201);
  assert.match(compliance.data.folio, /^CUM-\d{6}$/);

  assert.equal((await request(`/api/safety/incidents/${safetyIncident.data.id}/action`, { method: "POST", body: { action: "investigate", investigation: "Se revisó el área" } })).response.status, 200);
  assert.equal((await request(`/api/safety/incidents/${safetyIncident.data.id}/action`, { method: "POST", body: { action: "close", rootCause: "Zona sin delimitar", correctiveAction: "Instalar barrera" } })).data.status, "closed");
  assert.equal((await request(`/api/safety/risks/${risk.data.id}/action`, { method: "POST", body: { action: "treat", controls: "Barrera y señalero" } })).data.status, "in_treatment");
  assert.equal((await request(`/api/safety/compliance/${compliance.data.id}/action`, { method: "POST", body: { action: "comply", evidence: "Acta firmada" } })).data.status, "compliant");
  assert.equal((await request(`/api/hr/leaves/${safetyIncapacity.data.id}/action`, { method: "POST", body: { action: "approve" } })).data.status, "approved");

  const permanentVacationPerson = await request("/api/hr/people", {
    method: "POST",
    body: {
      fullName: "Colaborador permanente",
      email: "permanente@abicorp.local",
      hireDate: "2025-07-01",
      employmentType: "permanent",
      workShiftId: workShift.data.id,
    },
  });
  assert.equal(permanentVacationPerson.response.status, 201);
  const vacationPreview = await request("/api/hr/leaves/preview", {
    method: "POST",
    body: { employeeId: permanentVacationPerson.data.id, leaveType: "vacation", startDate: "2026-08-03", endDate: "2026-08-07" },
  });
  assert.equal(vacationPreview.response.status, 200);
  assert.equal(vacationPreview.data.workingDays, 5);
  assert.ok(vacationPreview.data.balance.availableBefore >= 5);
  const vacation = await request("/api/hr/leaves", {
    method: "POST",
    body: { employeeId: permanentVacationPerson.data.id, leaveType: "vacation", startDate: "2026-08-03", endDate: "2026-08-07", totalHours: 2, reason: "Periodo anual" },
  });
  assert.equal(vacation.response.status, 201);
  assert.match(vacation.data.folio, /^VAC-\d{6}$/);
  assert.equal(vacation.data.receipt.request.folio, vacation.data.folio);
  assert.equal(vacation.data.receipt.request.total_hours, 0);
  assert.equal(vacation.data.receipt.balance.requested_days, 5);
  const vacationPrint = await request(`/api/hr/leaves/${vacation.data.id}/print`, { method: "POST", body: {} });
  assert.equal(vacationPrint.response.status, 200);
  assert.equal(vacationPrint.data.receipt.printCount, 1);
  app.db.prepare("UPDATE hr_leave_requests SET current_approval_step = 'manager' WHERE id = ?").run(vacation.data.id);
  app.db.prepare("UPDATE hr_leave_workflow_steps SET status = 'pending' WHERE leave_request_id = ? AND step_type = 'manager'").run(vacation.data.id);
  app.db.prepare("UPDATE hr_leave_workflow_steps SET status = 'blocked' WHERE leave_request_id = ? AND step_type = 'hr'").run(vacation.data.id);

  const attendanceEntry = await request("/api/hr/attendance", {
    method: "POST",
    body: { employeeId: hrPerson.data.id, eventType: "entry", occurredAt: "2026-07-27T08:00", notes: "Entrada normal" },
  });
  assert.equal(attendanceEntry.response.status, 201);
  const attendanceExit = await request("/api/hr/attendance", {
    method: "POST",
    body: { employeeId: hrPerson.data.id, eventType: "exit", occurredAt: "2026-07-27T17:00", notes: "Salida normal" },
  });
  assert.equal(attendanceExit.response.status, 201);

  const safetyControl = await request("/api/safety/control");
  assert.equal(safetyControl.data.incapacities.some((entry) => entry.id === safetyIncapacity.data.id), true);
  assert.equal(safetyControl.data.indicators.incapacityDays, 3);
  const hrControl = await request("/api/hr/control");
  const integratedHrPerson = hrControl.data.people.find((entry) => entry.id === hrPerson.data.id);
  assert.equal(integratedHrPerson.vacation_balance, 0);
  assert.equal(integratedHrPerson.job_position_name, "Coordinación SST y ambiente");
  assert.equal(integratedHrPerson.shift_name, "Administrativo flexible");
  assert.equal(integratedHrPerson.vacation_plan_name, null);
  assert.ok(integratedHrPerson.photo_filename);
  assert.equal(hrControl.data.leaves.some((entry) => entry.id === safetyIncapacity.data.id && entry.incident_folio === safetyIncident.data.folio), true);
  assert.equal(hrControl.data.attendance.length >= 2, true);
  const linkedMasterPeople = await request("/api/masters/employees");
  const linkedPerson = linkedMasterPeople.data.records.find((entry) => entry.id === hrPerson.data.id);
  assert.equal(linkedPerson.job_position_name, "Coordinación SST y ambiente");
  assert.equal(linkedPerson.shift_name, "Administrativo flexible");
  assert.equal(linkedPerson.vacation_plan_name, null);
  assert.ok(linkedPerson.photo_filename);

  const resource = await request("/api/masters/resources", {
    method: "POST",
    body: { name: "Operador principal", resource_type: "personnel", area_id: area.data.area.id, employee_id: hrPerson.data.id, description: "Recurso humano", capacity_per_hour: 10, hourly_cost: 150, currency_id: mxn.id, status: "available" },
  });
  assert.equal(resource.response.status, 201);
  assert.match(resource.data.code, /^PER-\d{5}$/);
  const priceList = await request("/api/masters/price_lists", {
    method: "POST",
    body: { name: "Precios base", list_type: "sale", currency_id: mxn.id, valid_from: "2026-07-01", valid_to: null, is_active: true },
  });
  assert.equal(priceList.response.status, 201);
  assert.match(priceList.data.code, /^LPV-\d{5}$/);
  const priceLine = await request(`/api/price-lists/${priceList.data.id}/items`, {
    method: "POST",
    body: { itemId: item.data.id, price: 125, minQuantity: 1, validFrom: "2026-07-01", validTo: null },
  });
  assert.equal(priceLine.response.status, 201);
  const priceLines = await request(`/api/price-lists/${priceList.data.id}/items`);
  assert.equal(priceLines.data.items[0].sku, item.data.code);
  const masterOptions = await request("/api/masters/options");
  assert.equal(masterOptions.data.items.some((entry) => entry.id === item.data.id), true);

  const rawMaterial = await request("/api/masters/items", {
    method: "POST",
    body: { name: "Materia prima de producción", item_type: "raw_material", description: "Componente para pruebas", unit_id: piece.id, currency_id: mxn.id, standard_cost: 20, list_price: 0, tax_rate: 16, min_stock: 5, max_stock: 200, inventory_tracked: true, purchase_enabled: true, sales_enabled: false, production_enabled: false, is_active: true },
  });
  assert.equal(rawMaterial.response.status, 201);
  const bom = await request("/api/production/boms", {
    method: "POST",
    body: { productId: item.data.id, version: "1.0", outputQuantity: 1, status: "active", isPhantom: false, lines: [{ componentItemId: rawMaterial.data.id, quantity: 2, scrapRate: 0 }] },
  });
  assert.equal(bom.response.status, 201);
  assert.match(bom.data.folio, /^BOM-\d{6}$/);
  const route = await request("/api/production/routes", {
    method: "POST",
    body: { productId: item.data.id, version: "1.0", status: "active", operations: [{ sequence: 10, name: "Ensamble", resourceId: resource.data.id, setupMinutes: 5, runMinutes: 2, instructions: "Ensamblar conforme a la especificación del producto terminado." }] },
  });
  assert.equal(route.response.status, 201);
  assert.match(route.data.folio, /^RUT-\d{6}$/);

  const prospect = await request("/api/sales/prospects", {
    method: "POST",
    body: { companyName: "Comercial del Norte", contactName: "Laura Prospecto", email: "laura@prospecto.local", phone: "8111111111", source: "Referido", stage: "qualified", estimatedValue: 25000, currencyId: mxn.id, notes: "Interés en producto terminado" },
  });
  assert.equal(prospect.response.status, 201);
  assert.match(prospect.data.folio, /^PRO-\d{6}$/);
  const convertedProspect = await request(`/api/sales/prospects/${prospect.data.id}/convert`, { method: "POST", body: {} });
  assert.equal(convertedProspect.response.status, 200);
  assert.match(convertedProspect.data.customerCode, /^CLI-\d{5}$/);

  const quote = await request("/api/sales/documents/quote", {
    method: "POST",
    body: { customerId: convertedProspect.data.customerId, prospectId: prospect.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-22", validUntil: "2026-08-05", paymentTermsDays: 15, notes: "Cotización de prueba", lines: [{ itemId: item.data.id, quantity: 2, unitPrice: 125, discountRate: 10, taxRate: 16, description: "Producto cotizado" }] },
  });
  assert.equal(quote.response.status, 201);
  assert.match(quote.data.folio, /^COT-\d{6}$/);
  assert.equal(quote.data.total, 261);
  assert.equal((await request(`/api/sales/documents/${quote.data.id}/action`, { method: "POST", body: { action: "send" } })).data.status, "sent");
  assert.equal((await request(`/api/sales/documents/${quote.data.id}/action`, { method: "POST", body: { action: "accept" } })).data.status, "accepted");

  const order = await request("/api/sales/documents/order", {
    method: "POST",
    body: { sourceDocumentId: quote.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-22", expectedDate: "2026-07-28", paymentTermsDays: 15, notes: "Pedido originado desde cotización" },
  });
  assert.equal(order.response.status, 201);
  assert.match(order.data.folio, /^PED-\d{6}$/);
  const confirmedOrder = await request(`/api/sales/documents/${order.data.id}/action`, { method: "POST", body: { action: "confirm" } });
  assert.equal(confirmedOrder.data.status, "confirmed");
  assert.equal(confirmedOrder.data.production.created.length, 1);
  assert.match(confirmedOrder.data.production.created[0].folio, /^OT-P-\d{6}$/);
  const orderDetail = await request(`/api/sales/documents/${order.data.id}`);
  assert.equal(orderDetail.data.lines.length, 1);
  assert.equal(orderDetail.data.productionOrders.length, 1);
  assert.equal(orderDetail.data.productionOrders[0].material_count, 1);
  assert.equal(orderDetail.data.productionOrders[0].operation_count, 1);
  const salesWorkOrder = await request(`/api/production/orders/${orderDetail.data.productionOrders[0].id}`);
  assert.equal(salesWorkOrder.data.order.sales_order_id, order.data.id);
  assert.equal(salesWorkOrder.data.order.item_type, "finished");
  assert.equal(salesWorkOrder.data.materials[0].item_type, "raw_material");
  assert.equal(salesWorkOrder.data.materials[0].required_quantity, 4);
  assert.equal(salesWorkOrder.data.operations[0].name, "Ensamble");
  assert.match(salesWorkOrder.data.operations[0].instructions, /especificación/);

  const delivery = await request("/api/sales/documents/delivery", {
    method: "POST",
    body: { sourceDocumentId: order.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-23", notes: "Entrega completa", lines: [{ sourceLineId: orderDetail.data.lines[0].id, quantity: 2, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id, lotId: lot.data.id }] },
  });
  assert.equal(delivery.response.status, 201);
  assert.match(delivery.data.folio, /^ENV-\d{6}$/);
  const fulfilledOrder = await request(`/api/sales/documents/${order.data.id}`);
  assert.equal(fulfilledOrder.data.document.status, "fulfilled");
  const deliveryDetail = await request(`/api/sales/documents/${delivery.data.id}`);

  const salesReturn = await request("/api/sales/documents/return", {
    method: "POST",
    body: { sourceDocumentId: delivery.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-24", notes: "Devolución parcial", lines: [{ sourceLineId: deliveryDetail.data.lines[0].id, quantity: 1 }] },
  });
  assert.equal(salesReturn.response.status, 201);
  assert.match(salesReturn.data.folio, /^DEV-\d{6}$/);

  const invoice = await request("/api/sales/documents/invoice", {
    method: "POST",
    body: { sourceDocumentId: order.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-24", dueDate: "2026-08-08", paymentTermsDays: 15, fiscalReference: "FACTURA-INTERNA-001", notes: "Control interno; sin timbrado fiscal" },
  });
  assert.equal(invoice.response.status, 201);
  assert.match(invoice.data.folio, /^FAC-\d{6}$/);
  const paidInvoice = await request(`/api/sales/documents/${invoice.data.id}/action`, { method: "POST", body: { action: "mark_paid" } });
  assert.equal(paidInvoice.data.status, "paid");
  const cancellableOrder = await request("/api/sales/documents/order", {
    method: "POST",
    body: { customerId: customer.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-24", expectedDate: "2026-08-01", notes: "Pedido para cancelar", lines: [{ itemId: item.data.id, quantity: 1, unitPrice: 125, discountRate: 0, taxRate: 16 }] },
  });
  assert.equal(cancellableOrder.response.status, 201);
  const cancelledOrder = await request(`/api/sales/documents/${cancellableOrder.data.id}/action`, { method: "POST", body: { action: "cancel" } });
  assert.equal(cancelledOrder.data.status, "cancelled");
  const salesControl = await request("/api/sales/control");
  const controlledOrder = salesControl.data.orders.find((entry) => entry.id === order.data.id);
  assert.equal(controlledOrder.delivered_quantity, 2);
  assert.equal(controlledOrder.returned_quantity, 1);
  assert.equal(controlledOrder.invoice_status, "paid");
  const salesOptions = await request("/api/sales/options");
  assert.equal(salesOptions.data.sourceDocuments.some((entry) => entry.id === order.data.id), true);

  const rawEntry = await request("/api/inventory/entries", {
    method: "POST",
    body: { itemId: rawMaterial.data.id, quantity: 50, toWarehouseId: warehouse.data.id, toLocationId: sourceLocation.data.id, unitCost: 20, reason: "Materia prima para producción" },
  });
  assert.equal(rawEntry.response.status, 201);
  const demand = await request("/api/production/demands", {
    method: "POST", body: { itemId: item.data.id, quantity: 3, requiredDate: "2026-08-01", source: "Pedido de prueba" },
  });
  assert.equal(demand.response.status, 201);
  const productionOrder = await request("/api/production/orders", {
    method: "POST",
    body: { demandId: demand.data.id, itemId: item.data.id, bomId: bom.data.id, routeId: route.data.id, warehouseId: warehouse.data.id, plannedQuantity: 3, scheduledStart: "2026-07-25T08:00" },
  });
  assert.equal(productionOrder.response.status, 201);
  assert.match(productionOrder.data.folio, /^OP-\d{6}$/);
  assert.equal((await request("/api/production/orders/" + productionOrder.data.id + "/action", { method: "POST", body: { action: "release" } })).data.status, "released");
  assert.equal((await request("/api/production/orders/" + productionOrder.data.id + "/action", { method: "POST", body: { action: "start" } })).data.status, "in_progress");
  let productionDetail = await request("/api/production/orders/" + productionOrder.data.id);
  assert.equal(productionDetail.data.materials.length, 1);
  assert.equal(productionDetail.data.operations.length, 1);
  const consumed = await request("/api/production/orders/" + productionOrder.data.id + "/action", {
    method: "POST",
    body: { action: "consume", materialId: productionDetail.data.materials[0].id, quantity: 6, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id },
  });
  assert.equal(consumed.response.status, 200);
  const progress = await request("/api/production/orders/" + productionOrder.data.id + "/action", {
    method: "POST",
    body: { action: "report", operationId: productionDetail.data.operations[0].id, producedQuantity: 3, rejectedQuantity: 0, wasteQuantity: 0, actualMinutes: 11, completeOperation: true },
  });
  assert.equal(progress.response.status, 200);
  const receipt = await request("/api/production/orders/" + productionOrder.data.id + "/action", {
    method: "POST",
    body: { action: "receipt", quantity: 3, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id },
  });
  assert.equal(receipt.response.status, 200);
  assert.equal((await request("/api/production/orders/" + productionOrder.data.id + "/action", { method: "POST", body: { action: "complete" } })).data.status, "completed");
  assert.equal((await request("/api/production/orders/" + productionOrder.data.id + "/action", { method: "POST", body: { action: "close" } })).data.status, "closed");
  productionDetail = await request("/api/production/orders/" + productionOrder.data.id);
  assert.equal(productionDetail.data.order.produced_quantity, 3);
  assert.equal(productionDetail.data.order.status, "closed");

  const qualityPlan = await request("/api/quality/plans", {
    method: "POST",
    body: { name: "Inspección final dimensional", inspectionType: "final", itemId: item.data.id, sampleSize: 1, acceptanceLimit: 0, checks: [{ characteristic: "Longitud", checkType: "numeric", minValue: 9.5, maxValue: 10.5, unit: "mm", isRequired: true }] },
  });
  assert.equal(qualityPlan.response.status, 201);
  assert.match(qualityPlan.data.folio, /^PLC-\d{6}$/);
  const qualityInspection = await request("/api/quality/inspections", {
    method: "POST",
    body: { planId: qualityPlan.data.id, itemId: item.data.id, productionOrderId: productionOrder.data.id, warehouseId: warehouse.data.id, quantityInspected: 1 },
  });
  assert.equal(qualityInspection.response.status, 201);
  assert.match(qualityInspection.data.folio, /^INS-\d{6}$/);
  await request("/api/quality/inspections/" + qualityInspection.data.id + "/action", { method: "POST", body: { action: "start" } });
  const inspectionDetail = await request("/api/quality/inspections/" + qualityInspection.data.id);
  assert.equal(inspectionDetail.data.results.length, 1);
  const evaluated = await request("/api/quality/inspections/" + qualityInspection.data.id + "/results", {
    method: "POST",
    body: { quantityRejected: 0, results: [{ id: inspectionDetail.data.results[0].id, measuredValue: "10.1", isConforming: true }] },
  });
  assert.equal(evaluated.data.status, "approved");
  const releasedQuality = await request("/api/quality/inspections/" + qualityInspection.data.id + "/action", { method: "POST", body: { action: "release" } });
  assert.equal(releasedQuality.data.status, "released");
  const nonconformity = await request("/api/quality/nonconformities", {
    method: "POST",
    body: { productionOrderId: productionOrder.data.id, itemId: item.data.id, quantity: 1, severity: "minor", disposition: "rework", description: "Acabado superficial fuera de estándar", rootCause: "Parámetro de ajuste" },
  });
  assert.equal(nonconformity.response.status, 201);
  assert.match(nonconformity.data.folio, /^NC-\d{6}$/);
  const corrective = await request("/api/quality/corrective-actions", {
    method: "POST",
    body: { nonconformityId: nonconformity.data.id, action: "Ajustar parámetro y verificar primera pieza", ownerId: loginData.user.id, dueDate: "2026-08-02" },
  });
  assert.equal(corrective.response.status, 201);
  const correctiveClosed = await request("/api/quality/corrective-actions/" + corrective.data.id, {
    method: "PATCH", body: { status: "closed", verification: "Primera pieza dentro de especificación" },
  });
  assert.equal(correctiveClosed.data.status, "closed");
  const productionControl = await request("/api/production/control");
  assert.equal(productionControl.data.orders.some((entry) => entry.id === productionOrder.data.id), true);
  const qualityControl = await request("/api/quality/control");
  assert.equal(qualityControl.data.inspections.some((entry) => entry.id === qualityInspection.data.id), true);

  const equipment = await request("/api/maintenance/equipment", {
    method: "POST",
    body: { name: "Centro de maquinado CNC", resourceId: resource.data.id, category: "Máquina", manufacturer: "Abicorp Test", model: "CNC-01", serialNumber: "SN-001", areaId: area.data.area.id, physicalLocation: "Nave A", criticality: "critical", meterType: "hours", meterValue: 1250, acquisitionDate: "2025-01-15", downtimeCostPerHour: 1200 },
  });
  assert.equal(equipment.response.status, 201);
  assert.match(equipment.data.folio, /^EQU-\d{6}$/);
  const maintenanceSupplier = await request("/api/maintenance/suppliers", {
    method: "POST",
    body: { name: "Servicio CNC del Norte", specialty: "Husillos y control numérico", contactName: "María López", hourlyRate: 850 },
  });
  assert.equal(maintenanceSupplier.response.status, 201);
  assert.match(maintenanceSupplier.data.folio, /^PMV-\d{6}$/);
  const maintenancePlan = await request("/api/maintenance/plans", {
    method: "POST",
    body: { equipmentId: equipment.data.id, name: "Lubricación y revisión mensual", frequencyType: "days", frequencyValue: 30, nextDueDate: "2026-08-01", annualYear: 2026, isoReference: "PR-MTO-01", supplierId: maintenanceSupplier.data.id, estimatedHours: 2, instructions: "Lubricar guías y revisar niveles." },
  });
  assert.equal(maintenancePlan.response.status, 201);
  assert.match(maintenancePlan.data.folio, /^PMP-\d{6}$/);
  assert.equal(maintenancePlan.data.programmedDates > 0, true);
  const maintenanceRequest = await request("/api/maintenance/requests", {
    method: "POST",
    body: { equipmentId: equipment.data.id, requestType: "corrective", priority: "critical", failureDescription: "Ruido anormal en el husillo", downtimeRequired: true, notes: "Detener antes de inspeccionar" },
  });
  assert.equal(maintenanceRequest.response.status, 201);
  assert.match(maintenanceRequest.data.folio, /^SOL-\d{6}$/);
  const maintenanceOrder = await request("/api/maintenance/orders", {
    method: "POST",
    body: { requestId: maintenanceRequest.data.id, equipmentId: equipment.data.id, orderType: "corrective", priority: "critical", assignedResourceId: resource.data.id, technicianId: hrPerson.data.id, supplierId: maintenanceSupplier.data.id, externalCost: 300, scheduledStart: "2026-07-26T08:00", parts: [{ itemId: rawMaterial.data.id, quantity: 1 }] },
  });
  assert.equal(maintenanceOrder.response.status, 201);
  assert.match(maintenanceOrder.data.folio, /^OTM-\d{6}$/);
  assert.equal((await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", { method: "POST", body: { action: "approve" } })).data.status, "approved");
  assert.equal((await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", { method: "POST", body: { action: "start" } })).data.status, "in_progress");
  const partUsed = await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", {
    method: "POST",
    body: { action: "use_part", itemId: rawMaterial.data.id, quantity: 1, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id, notes: "Repuesto instalado" },
  });
  assert.equal(partUsed.response.status, 200);
  assert.equal((await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", { method: "POST", body: { action: "pause" } })).data.status, "paused");
  assert.equal((await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", { method: "POST", body: { action: "resume" } })).data.status, "in_progress");
  const maintenanceCompleted = await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", {
    method: "POST",
    body: { action: "complete", actualHours: 2.5, laborCost: 500, externalCost: 300, meterValue: 1252.5, failureFound: "Rodamiento con juego", rootCause: "Desgaste normal", workPerformed: "Cambio de rodamiento, lubricación y prueba funcional" },
  });
  assert.equal(maintenanceCompleted.data.status, "completed");
  const maintenanceClosed = await request("/api/maintenance/orders/" + maintenanceOrder.data.id + "/action", { method: "POST", body: { action: "close" } });
  assert.equal(maintenanceClosed.data.status, "closed");
  const maintenanceDetail = await request("/api/maintenance/orders/" + maintenanceOrder.data.id);
  assert.equal(maintenanceDetail.data.parts[0].used_quantity, 1);
  assert.equal(maintenanceDetail.data.downtimes[0].status, "closed");
  const equipmentHistory = await request("/api/maintenance/equipment/" + equipment.data.id + "/history");
  assert.equal(equipmentHistory.data.equipment.status, "operational");
  assert.equal(equipmentHistory.data.history.some((entry) => entry.event_type === "order_closed"), true);
  const maintenanceControl = await request("/api/maintenance/control");
  assert.equal(maintenanceControl.data.orders.some((entry) => entry.id === maintenanceOrder.data.id), true);
  assert.equal(maintenanceControl.data.annualSchedule.some((entry) => entry.plan_id === maintenancePlan.data.id), true);
  assert.equal(maintenanceControl.data.suppliers.some((entry) => entry.id === maintenanceSupplier.data.id), true);
  assert.equal(maintenanceControl.data.costs.external, 300);
  assert.equal(maintenanceControl.data.requests.find((entry) => entry.id === maintenanceRequest.data.id).order_id, maintenanceOrder.data.id);
  assert.equal(maintenanceControl.data.parts.find((entry) => entry.order_id === maintenanceOrder.data.id).used_quantity, 1);
  const annualProgramCsv = [
    "AÑO;FOLIO_EQUIPO;EQUIPO_NOMBRE;ACTIVIDAD;FRECUENCIA;CADA;PRIMERA_FECHA;HORAS_ESTIMADAS;REFERENCIA_ISO;FOLIO_PROVEEDOR;INSTRUCCIONES",
    `2027;${equipment.data.folio};Centro de maquinado CNC;Inspección eléctrica trimestral;MESES;3;2027-01-15;3;PR-MTO-02;${maintenanceSupplier.data.folio};Revisar tablero y conexiones`,
    `2027;${equipment.data.folio};Centro de maquinado CNC;Verificación de seguridad;SEMANAS;4;2027-01-08;1.5;PR-MTO-03;;Validar guardas y paro de emergencia`,
  ].join("\r\n");
  const annualPreview = await request("/api/maintenance/annual-program/preview", {
    method: "POST",
    body: { fileName: "programa-2027.csv", content: annualProgramCsv },
  });
  assert.equal(annualPreview.response.status, 200);
  assert.equal(annualPreview.data.validRows, 2);
  assert.equal(annualPreview.data.errors.length, 0);
  assert.equal(annualPreview.data.equipmentCount, 1);
  assert.equal(annualPreview.data.scheduleCount > 2, true);
  const annualImport = await request("/api/maintenance/annual-program/import", {
    method: "POST",
    body: { fileName: "programa-2027.csv", content: annualProgramCsv },
  });
  assert.equal(annualImport.response.status, 201);
  assert.match(annualImport.data.folio, /^PAM-\d{6}$/);
  assert.equal(annualImport.data.plansCreated, 2);
  const duplicateAnnualImport = await request("/api/maintenance/annual-program/import", {
    method: "POST",
    body: { fileName: "programa-2027.csv", content: annualProgramCsv },
  });
  assert.equal(duplicateAnnualImport.response.status, 409);
  const maintenanceAfterImport = await request("/api/maintenance/control");
  assert.equal(maintenanceAfterImport.data.programImports.some((entry) => entry.id === annualImport.data.id), true);
  assert.equal(maintenanceAfterImport.data.plans.filter((entry) => entry.import_id === annualImport.data.id).length, 2);

  const logisticsOrder = await request("/api/sales/documents/order", {
    method: "POST",
    body: { customerId: customer.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-25", expectedDate: "2026-07-30", notes: "Pedido para logística", lines: [{ itemId: item.data.id, quantity: 2, unitPrice: 125, discountRate: 0, taxRate: 16 }] },
  });
  assert.equal(logisticsOrder.response.status, 201);
  assert.equal((await request(`/api/sales/documents/${logisticsOrder.data.id}/action`, { method: "POST", body: { action: "confirm" } })).data.status, "confirmed");
  const carrier = await request("/api/logistics/carriers", {
    method: "POST",
    body: { name: "Transportes de prueba", contactName: "Operador Logístico", phone: "8112345678", serviceType: "local", vehicleType: "Camioneta" },
  });
  assert.equal(carrier.response.status, 201);
  assert.match(carrier.data.folio, /^TRP-\d{5}$/);
  const deliveryRoute = await request("/api/logistics/routes", {
    method: "POST",
    body: { name: "Ruta Norte", carrierId: carrier.data.id, routeDate: "2026-07-30", driverName: "Conductor Uno", vehiclePlate: "ABC-123", origin: "Monterrey", destination: "Apodaca" },
  });
  assert.equal(deliveryRoute.response.status, 201);
  assert.match(deliveryRoute.data.folio, /^RLE-\d{6}$/);
  const shipment = await request("/api/logistics/shipments", {
    method: "POST",
    body: { orderId: logisticsOrder.data.id, warehouseId: warehouse.data.id, scheduledDate: "2026-07-30", shippingAddress: "Parque Industrial Norte" },
  });
  assert.equal(shipment.response.status, 201);
  assert.match(shipment.data.folio, /^EMB-\d{6}$/);
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "start_picking" } })).data.status, "picking");
  const shipmentBeforePick = await request(`/api/logistics/shipments/${shipment.data.id}`);
  assert.equal(shipmentBeforePick.data.lines.length, 1);
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, {
    method: "POST",
    body: { action: "pick", lineId: shipmentBeforePick.data.lines[0].id, quantity: 2, locationId: sourceLocation.data.id, lotId: lot.data.id },
  })).response.status, 200);
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "complete_picking" } })).data.status, "picked");
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "pack", packageCount: 1, totalWeight: 4.5, trackingNumber: "GUIA-001" } })).data.status, "packed");
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "assign_route", routeId: deliveryRoute.data.id } })).data.status, "packed");
  assert.equal((await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "dispatch" } })).data.status, "in_transit");
  const evidence = await request("/api/logistics/evidence", { method: "POST", body: { shipmentId: shipment.data.id, evidenceType: "note", description: "Unidad recibida en caseta" } });
  assert.equal(evidence.response.status, 201);
  const confirmedShipment = await request(`/api/logistics/shipments/${shipment.data.id}/action`, { method: "POST", body: { action: "confirm", receiverName: "Cliente Receptor", notes: "Entrega completa" } });
  assert.equal(confirmedShipment.data.status, "delivered");
  assert.match(confirmedShipment.data.deliveryFolio, /^ENV-\d{6}$/);
  const logisticsControl = await request("/api/logistics/control");
  assert.equal(logisticsControl.data.shipments.find((entry) => entry.id === shipment.data.id).status, "delivered");
  assert.equal(logisticsControl.data.evidence.some((entry) => entry.shipment_id === shipment.data.id), true);

  const financeInvoice = await request("/api/sales/documents/invoice", {
    method: "POST",
    body: { sourceDocumentId: logisticsOrder.data.id, currencyId: mxn.id, exchangeRate: 1, issueDate: "2026-07-30", dueDate: "2026-08-15", paymentTermsDays: 15, fiscalReference: "FIN-001", notes: "Factura para finanzas" },
  });
  assert.equal(financeInvoice.response.status, 201);
  const financeOptionsInitial = await request("/api/finance/options");
  const receivable = financeOptionsInitial.data.receivables.find((entry) => entry.invoice_folio === financeInvoice.data.folio);
  assert.ok(receivable);
  const partialCollection = await request("/api/finance/collections", {
    method: "POST",
    body: { receivableId: receivable.id, amount: 100, collectionDate: "2026-07-30", paymentMethod: "transfer", bankAccount: "Banco principal", reference: "COBRO-1" },
  });
  assert.equal(partialCollection.data.status, "partial");
  const financeOptionsPartial = await request("/api/finance/options");
  const remainingReceivable = financeOptionsPartial.data.receivables.find((entry) => entry.id === receivable.id);
  const finalCollection = await request("/api/finance/collections", {
    method: "POST",
    body: { receivableId: receivable.id, amount: remainingReceivable.balance, collectionDate: "2026-07-31", paymentMethod: "transfer", reference: "COBRO-2" },
  });
  assert.equal(finalCollection.data.status, "paid");
  const costCenter = await request("/api/finance/cost-centers", {
    method: "POST",
    body: { name: "Operaciones generales", description: "Gastos operativos de prueba" },
  });
  assert.equal(costCenter.response.status, 201);
  assert.match(costCenter.data.folio, /^CC-\d{5}$/);
  const payable = await request("/api/finance/payables", {
    method: "POST",
    body: { supplierId: supplier.data.id, costCenterId: costCenter.data.id, currencyId: mxn.id, invoiceReference: "FAC-PRV-001", concept: "Servicio operativo", category: "General", amount: 500, issueDate: "2026-07-30", dueDate: "2026-08-10" },
  });
  assert.equal(payable.response.status, 201);
  assert.match(payable.data.folio, /^CXP-\d{6}$/);
  assert.equal((await request("/api/finance/payments", { method: "POST", body: { payableId: payable.data.id, amount: 200, paymentDate: "2026-07-30", paymentMethod: "transfer", reference: "PAGO-1" } })).data.status, "partial");
  assert.equal((await request("/api/finance/payments", { method: "POST", body: { payableId: payable.data.id, amount: 300, paymentDate: "2026-07-31", paymentMethod: "transfer", reference: "PAGO-2" } })).data.status, "paid");
  const budget = await request("/api/finance/budgets", {
    method: "POST",
    body: { costCenterId: costCenter.data.id, currencyId: mxn.id, fiscalYear: 2026, periodType: "annual", category: "General", amount: 1000 },
  });
  assert.equal(budget.response.status, 201);
  assert.equal((await request(`/api/finance/budgets/${budget.data.id}/action`, { method: "POST", body: { action: "approve" } })).data.status, "approved");
  const reconciliation = await request("/api/finance/reconciliations", {
    method: "POST",
    body: { accountName: "Banco principal", statementDate: "2026-07-31", statementBalance: -210, systemBalance: "", notes: "Corte de prueba" },
  });
  assert.equal(reconciliation.response.status, 201);
  assert.equal(reconciliation.data.difference, 0);
  assert.equal((await request(`/api/finance/reconciliations/${reconciliation.data.id}/action`, { method: "POST", body: { action: "reconcile" } })).data.status, "reconciled");
  const financeControl = await request("/api/finance/control");
  assert.equal(financeControl.data.receivables.find((entry) => entry.id === receivable.id).status, "paid");
  assert.equal(financeControl.data.payables.find((entry) => entry.id === payable.data.id).status, "paid");
  assert.equal(financeControl.data.budgets.find((entry) => entry.id === budget.data.id).committed_amount, 500);

  const alternateSupplier = await request("/api/masters/suppliers", {
    method: "POST",
    body: { legal_name: "Proveedor Alterno SA", trade_name: "Proveedor Alterno", tax_id: "PAL260101AA1", email: "ventas@alterno.local", phone: "8111111111", address: "Monterrey", currency_id: mxn.id, payment_terms_days: 30, lead_time_days: 5, is_active: true },
  });
  assert.equal(alternateSupplier.response.status, 201);
  const purchaseRequest = await request("/api/purchases/requests", {
    method: "POST",
    body: { costCenterId: costCenter.data.id, requiredDate: "2026-08-15", priority: "high", notes: "Material para programa de producción", lines: [{ itemId: rawMaterial.data.id, quantity: 5, description: "Materia prima aprobada" }] },
  });
  assert.equal(purchaseRequest.response.status, 201);
  assert.match(purchaseRequest.data.folio, /^SC-\d{6}$/);
  assert.equal((await request(`/api/purchases/requests/${purchaseRequest.data.id}/action`, { method: "POST", body: { action: "submit" } })).data.status, "submitted");
  assert.equal((await request(`/api/purchases/requests/${purchaseRequest.data.id}/action`, { method: "POST", body: { action: "approve" } })).data.status, "approved");
  const purchaseComparison = await request("/api/purchases/comparisons", {
    method: "POST",
    body: { requestId: purchaseRequest.data.id, notes: "Comparación de precio y plazo", offers: [
      { supplierId: supplier.data.id, currencyId: mxn.id, totalAmount: 116, leadTimeDays: 7, paymentTermsDays: 15 },
      { supplierId: alternateSupplier.data.id, currencyId: mxn.id, totalAmount: 125, leadTimeDays: 5, paymentTermsDays: 30 },
    ] },
  });
  assert.equal(purchaseComparison.response.status, 201);
  assert.match(purchaseComparison.data.folio, /^CP-\d{6}$/);
  assert.equal((await request(`/api/purchases/comparisons/${purchaseComparison.data.id}/select`, { method: "POST", body: { supplierId: supplier.data.id } })).data.status, "selected");
  const purchaseRequestDetail = await request(`/api/purchases/requests/${purchaseRequest.data.id}`);
  const purchaseOrder = await request("/api/purchases/orders", {
    method: "POST",
    body: { requestId: purchaseRequest.data.id, comparisonId: purchaseComparison.data.id, currencyId: mxn.id, issueDate: "2026-08-01", expectedDate: "2026-08-15", notes: "Orden desde comparación", lines: [{ requestLineId: purchaseRequestDetail.data.lines[0].id, unitPrice: 20, taxRate: 16 }] },
  });
  assert.equal(purchaseOrder.response.status, 201);
  assert.match(purchaseOrder.data.folio, /^OC-\d{6}$/);
  assert.equal(purchaseOrder.data.total, 116);
  assert.equal((await request(`/api/purchases/orders/${purchaseOrder.data.id}/action`, { method: "POST", body: { action: "approve" } })).data.status, "approved");
  const purchaseOrderDetail = await request(`/api/purchases/orders/${purchaseOrder.data.id}`);
  const purchaseReceipt = await request("/api/purchases/receipts", {
    method: "POST",
    body: { orderId: purchaseOrder.data.id, warehouseId: warehouse.data.id, locationId: sourceLocation.data.id, receiptDate: "2026-08-10", supplierReference: "REM-100", lines: [{ orderLineId: purchaseOrderDetail.data.lines[0].id, quantity: 4 }] },
  });
  assert.equal(purchaseReceipt.response.status, 201);
  assert.match(purchaseReceipt.data.folio, /^REC-\d{6}$/);
  const purchaseReceiptDetail = await request(`/api/purchases/receipts/${purchaseReceipt.data.id}`);
  const purchaseReturn = await request("/api/purchases/returns", {
    method: "POST",
    body: { receiptId: purchaseReceipt.data.id, returnDate: "2026-08-11", reason: "Material dañado", lines: [{ receiptLineId: purchaseReceiptDetail.data.lines[0].id, quantity: 1 }] },
  });
  assert.equal(purchaseReturn.response.status, 201);
  assert.match(purchaseReturn.data.folio, /^DCP-\d{6}$/);
  const supplierInvoice = await request("/api/purchases/invoices", {
    method: "POST",
    body: { orderId: purchaseOrder.data.id, supplierInvoiceReference: "FAC-COMPRA-100", issueDate: "2026-08-10", dueDate: "2026-08-25", subtotal: 100, taxTotal: 16, total: 116 },
  });
  assert.equal(supplierInvoice.response.status, 201);
  assert.match(supplierInvoice.data.folio, /^FCP-\d{6}$/);
  assert.match(supplierInvoice.data.payableFolio, /^CXP-\d{6}$/);
  const purchasesControl = await request("/api/purchases/control");
  assert.equal(purchasesControl.data.orders.find((entry) => entry.id === purchaseOrder.data.id).status, "partially_received");
  assert.equal(purchasesControl.data.receipts.some((entry) => entry.id === purchaseReceipt.data.id), true);
  assert.equal(purchasesControl.data.returns.some((entry) => entry.id === purchaseReturn.data.id), true);
  assert.equal(purchasesControl.data.invoices.find((entry) => entry.id === supplierInvoice.data.id).payable_folio, supplierInvoice.data.payableFolio);

  const approvalFlow = await request("/api/tasks/flows", {
    method: "POST",
    body: { name: "Aprobación administrativa", module: "finance", entityType: "presupuesto", description: "Revisión en dos niveles", steps: [
      { name: "Validación inicial", requiredLevel: 3, defaultAssigneeId: loginData.user.id },
      { name: "Autorización final", requiredLevel: 4, defaultAssigneeId: loginData.user.id },
    ] },
  });
  assert.equal(approvalFlow.response.status, 201);
  assert.match(approvalFlow.data.folio, /^FLU-\d{6}$/);
  const approvalTask = await request("/api/tasks", {
    method: "POST",
    body: { flowId: approvalFlow.data.id, title: "Aprobar presupuesto operativo", description: "Validar alcance y monto", module: "finance", entityType: "presupuesto", entityId: budget.data.folio, priority: "high", dueDate: "2026-08-05" },
  });
  assert.equal(approvalTask.response.status, 201);
  assert.match(approvalTask.data.folio, /^TAR-\d{6}$/);
  assert.equal((await request(`/api/tasks/${approvalTask.data.id}/comments`, { method: "POST", body: { comment: "Información revisada por finanzas" } })).response.status, 201);
  assert.equal((await request(`/api/tasks/${approvalTask.data.id}/action`, { method: "POST", body: { action: "started" } })).data.status, "in_progress");
  assert.equal((await request(`/api/tasks/${approvalTask.data.id}/action`, { method: "POST", body: { action: "submitted", comment: "Listo para decisión" } })).data.status, "submitted");
  const firstApproval = await request(`/api/tasks/${approvalTask.data.id}/action`, { method: "POST", body: { action: "approved", comment: "Primera etapa aprobada" } });
  assert.equal(firstApproval.data.status, "submitted");
  assert.equal(firstApproval.data.current_step, 2);
  const finalApproval = await request(`/api/tasks/${approvalTask.data.id}/action`, { method: "POST", body: { action: "approved", comment: "Autorización final" } });
  assert.equal(finalApproval.data.status, "approved");
  const reassignedTask = await request("/api/tasks", {
    method: "POST",
    body: { title: "Preparar reporte semanal", assignedTo: loginData.user.id, priority: "medium", dueDate: "2026-08-02", module: "general" },
  });
  assert.equal((await request(`/api/tasks/${reassignedTask.data.id}/action`, { method: "POST", body: { action: "reassigned", toUserId: user.data.user.id, comment: "Transferida al operador responsable" } })).data.assigned_to, user.data.user.id);
  const rejectedTask = await request("/api/tasks", {
    method: "POST",
    body: { flowId: approvalFlow.data.id, title: "Revisar solicitud incompleta", assignedTo: loginData.user.id, priority: "critical", dueDate: "2026-08-01", module: "finance" },
  });
  await request(`/api/tasks/${rejectedTask.data.id}/action`, { method: "POST", body: { action: "started" } });
  await request(`/api/tasks/${rejectedTask.data.id}/action`, { method: "POST", body: { action: "submitted" } });
  const rejectedDecision = await request(`/api/tasks/${rejectedTask.data.id}/action`, { method: "POST", body: { action: "rejected", comment: "Falta documentación de soporte" } });
  assert.equal(rejectedDecision.data.status, "rejected");
  const tasksControl = await request("/api/tasks/control");
  assert.equal(tasksControl.data.tasks.find((entry) => entry.id === approvalTask.data.id).status, "approved");
  assert.equal(tasksControl.data.comments.some((entry) => entry.task_id === approvalTask.data.id), true);
  assert.equal(tasksControl.data.reassignments.some((entry) => entry.task_id === reassignedTask.data.id), true);
  assert.equal(tasksControl.data.rejections.some((entry) => entry.task_id === rejectedTask.data.id), true);

  const folio = await request("/api/folios", {
    method: "POST",
    body: { documentType: "ORDEN_COMPRA", prefix: "OC-", currentValue: 0, padding: 5, branchId: branch.data.id, resetPeriod: "year", isActive: true },
  });
  assert.equal(folio.response.status, 201);
  const issued = await request(`/api/folios/${folio.data.id}/next`, { method: "POST", body: {} });
  assert.equal(issued.data.value, "OC-00001");

  const document = await request("/api/documents", {
    method: "POST",
    body: { originalName: "prueba.txt", mimeType: "text/plain", contentBase64: Buffer.from("archivo de prueba").toString("base64"), module: "core", entityType: "test", entityId: "1", description: "Prueba automatizada" },
  });
  assert.equal(document.response.status, 201);
  const download = await fetch(`${baseUrl}/api/documents/${document.data.id}/download`, { headers: { Cookie: cookie } });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "archivo de prueba");
  const documentDetail = await request(`/api/documents/${document.data.id}`);
  assert.equal(documentDetail.response.status, 200);
  assert.equal(documentDetail.data.document.version_number, 1);
  assert.equal(documentDetail.data.accessLog.some((entry) => entry.action === "download"), true);
  assert.equal(documentDetail.data.accessLog.some((entry) => entry.action === "consult"), true);
  const documentOptions = await request("/api/documents");
  const contractDocumentType = documentOptions.data.documentTypes.find((entry) => entry.code === "CONTRACT");
  const curpDocumentType = documentOptions.data.documentTypes.find((entry) => entry.code === "CURP");
  const officialIdDocumentType = documentOptions.data.documentTypes.find((entry) => entry.code === "OFFICIAL_ID");
  const medicalDocumentType = documentOptions.data.documentTypes.find((entry) => entry.code === "MEDICAL");
  const otherDocumentType = documentOptions.data.documentTypes.find((entry) => entry.code === "OTHER");
  assert.equal(curpDocumentType.allows_expiry_date, 0);
  assert.equal(contractDocumentType.allows_expiry_date, 0);
  assert.equal(officialIdDocumentType.allows_expiry_date, 1);
  assert.equal(medicalDocumentType.allows_expiry_date, 1);
  assert.equal(otherDocumentType.allows_expiry_date, 1);
  const rejectedCurpExpiry = await request("/api/documents", {
    method: "POST",
    body: { originalName: "curp-invalida.pdf", mimeType: "application/pdf",
      contentBase64: Buffer.from("curp con vencimiento").toString("base64"), module: "hr",
      entityType: "employee", entityId: String(hrPerson.data.id), employeeId: hrPerson.data.id,
      documentTypeId: curpDocumentType.id, expiryDate: "2027-01-01" },
  });
  assert.equal(rejectedCurpExpiry.response.status, 400);
  assert.match(rejectedCurpExpiry.data.error, /no maneja fecha de vencimiento/);
  const contractV1 = await request("/api/documents", {
    method: "POST",
    body: { originalName: "contrato-v1.pdf", mimeType: "application/pdf",
      contentBase64: Buffer.from("contrato uno").toString("base64"), module: "hr",
      entityType: "employee", entityId: String(hrPerson.data.id), employeeId: hrPerson.data.id,
      documentTypeId: contractDocumentType.id, issueDate: "2026-01-01", description: "Contrato inicial" },
  });
  assert.equal(contractV1.response.status, 201);
  const contractV2 = await request("/api/documents", {
    method: "POST",
    body: { originalName: "contrato-v2.pdf", mimeType: "application/pdf",
      contentBase64: Buffer.from("contrato dos").toString("base64"), module: "hr",
      entityType: "employee", entityId: String(hrPerson.data.id), employeeId: hrPerson.data.id,
      documentTypeId: contractDocumentType.id, issueDate: "2026-02-01", description: "Contrato actualizado" },
  });
  assert.equal(contractV2.response.status, 201);
  const versionedDocuments = await request("/api/documents");
  const firstContract = versionedDocuments.data.documents.find((entry) => entry.id === contractV1.data.id);
  const secondContract = versionedDocuments.data.documents.find((entry) => entry.id === contractV2.data.id);
  assert.equal(firstContract.is_current, 0);
  assert.equal(secondContract.is_current, 1);
  assert.equal(secondContract.version_number, 2);
  const employeeDocuments = await request("/api/documents?employeeId=" + hrPerson.data.id);
  assert.equal(employeeDocuments.response.status, 200);
  assert.equal(employeeDocuments.data.documents.every((entry) => entry.employee_id === hrPerson.data.id), true);
  assert.equal(employeeDocuments.data.documents.some((entry) => entry.id === document.data.id), false);
  assert.equal((await request("/api/documents?employeeId=no-valido")).response.status, 400);
  const retiredVersion = await request(`/api/documents/${contractV2.data.id}`, { method: "DELETE", body: {} });
  assert.equal(retiredVersion.response.status, 200);
  const documentsAfterRetirement = await request("/api/documents");
  assert.equal(documentsAfterRetirement.data.documents.some((entry) => entry.id === contractV2.data.id), false);
  assert.equal(documentsAfterRetirement.data.documents.find((entry) => entry.id === contractV1.data.id).is_current, 1);

  const notification = await request("/api/notifications", {
    method: "POST",
    body: { title: "Núcleo disponible", message: "La configuración fue completada.", type: "success", userIds: [loginData.user.id] },
  });
  assert.equal(notification.data.recipients, 1);
  const inbox = await request("/api/notifications");
  assert.equal(inbox.data.notifications[0].title, "Núcleo disponible");
  assert.equal(inbox.data.actionItems.some((item) => item.entityType === "hr_leave_request"
    && item.entityId === vacation.data.id && item.targetView === "hr_control"), true);
  const marked = await request(`/api/notifications/${inbox.data.notifications[0].id}/read`, { method: "PATCH", body: {} });
  assert.equal(marked.response.status, 200);
  const directApproval = await request(`/api/hr/leaves/${vacation.data.id}/action`, {
    method: "POST", body: { action: "approve", reason: "Autorización administrativa de prueba." },
  });
  assert.equal(directApproval.response.status, 200);
  assert.equal(directApproval.data.status, "approved");
  assert.equal(directApproval.data.administrativeOverride, true);
  const approvedWorkflow = app.db.prepare(`SELECT step_type, status, decided_by_user_id
    FROM hr_leave_workflow_steps WHERE leave_request_id = ? ORDER BY step_order`).all(vacation.data.id);
  assert.deepEqual(approvedWorkflow.map((step) => step.status), ["approved", "approved"]);
  assert.equal(approvedWorkflow.every((step) => step.decided_by_user_id === loginData.user.id), true);
  const inboxAfterApproval = await request("/api/notifications");
  assert.equal(inboxAfterApproval.data.actionItems.some((item) => item.entityId === vacation.data.id), false);

  const deactivatedPerson = await request(`/api/hr/people/${hrPerson.data.id}/action`, {
    method: "POST",
    body: { action: "deactivate", terminationDate: "2026-07-31", reason: "Fin de la relación laboral" },
  });
  assert.equal(deactivatedPerson.response.status, 200);
  assert.equal(deactivatedPerson.data.status, "inactive");
  assert.equal(deactivatedPerson.data.folio, hrPerson.data.folio);
  const controlAfterDeactivation = await request("/api/hr/control");
  assert.equal(controlAfterDeactivation.data.people.find((entry) => entry.id === hrPerson.data.id).status, "inactive");

  const audit = await request("/api/audit?limit=500");
  assert.equal(audit.response.status, 200);
  assert.equal(audit.data.logs.some((entry) => entry.action === "users.created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "auth.password_changed"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "folios.issued"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "documents.uploaded"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "masters.created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "price_lists.item_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "inventory.entry"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "inventory.count_completed"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "sales.quote_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "sales.delivery_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "production.order_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "quality.inspection_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "maintenance.order_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "maintenance.program_imported"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "logistics.shipment_confirm"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "finance.collection_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "finance.payment_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "tasks.flow_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "tasks.task_approved"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "purchases.order_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "purchases.receipt_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "purchases.invoice_created"), true);
  assert.equal(audit.data.logs.some((entry) => entry.action === "hr.person_deactivate"), true);

  async function request(path, options = {}) {
    const headers = { Cookie: cookie, Accept: "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if ((options.method ?? "GET") !== "GET") headers["X-CSRF-Token"] = csrf;
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    return { response, data: await response.json() };
  }
});

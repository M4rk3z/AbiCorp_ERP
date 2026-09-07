import { readFile } from "node:fs/promises";
import { basename, dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { audit, openDatabase, synchronizeManagedCompanyIdentity } from "./db/index.js";
import { expireDemoCompanies, openControlDatabase, resolveCompanyDatabase } from "./db/control.js";
import { catalogDefinitions } from "./core/catalogs.js";
import { masterDefinitions } from "./core/masters.js";
import * as inventory from "./core/inventory.js";
import * as sales from "./core/sales.js";
import * as production from "./core/production.js";
import * as quality from "./core/quality.js";
import * as maintenance from "./core/maintenance.js";
import * as logistics from "./core/logistics.js";
import * as finance from "./core/finance.js";
import * as tasks from "./core/tasks.js";
import * as purchases from "./core/purchases.js";
import * as safety from "./core/safety.js";
import * as hr from "./core/hr.js";
import * as hrImport from "./core/hr-import.js";
import * as hrPortal from "./core/hr-portal.js";
import * as hrSchedules from "./core/hr-schedules.js";
import * as hrCompliance from "./core/hr-compliance.js";
import * as payrollCfdi from "./core/payroll-cfdi.js";
import * as payrollPreparation from "./core/payroll-preparation.js";
import { createPrivateStorage, PrivateStorageError } from "./core/private-storage.js";
import {
  assertEmployeeAccess,
  canAccessEmployee,
  canAccessSensitiveDocument,
  filterHrControl,
  laborIdentityForUser,
  visibleEmployeeIds,
} from "./core/hr-identity.js";
import { effectiveModuleAccess, permissionsForUser } from "./core/access.js";
import {
  clearSessionCookie,
  createOpaqueToken,
  hashPassword,
  hashToken,
  parseCookies,
  sessionCookie,
  validatePassword,
  verifyPassword,
} from "./core/security.js";

const PUBLIC_DIR = resolve(fileURLToPath(new URL("../public", import.meta.url)));
const JSON_LIMIT = 12 * 1024 * 1024;
const CFDI_JSON_LIMIT = 17 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_EMPLOYEE_PHOTO_BYTES = 3 * 1024 * 1024;
const JSON_COMPRESSION_THRESHOLD = 4 * 1024;
const HR_CONTROL_CACHE_MS = 60 * 1000;

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function createApplication(options = {}) {
  const dataDir = resolve(options.dataDir ?? process.env.ERP_DATA_DIR ?? "./data");
  const registry = openControlDatabase({
    dataDir,
    databaseProvider: options.databaseProvider ?? process.env.DATABASE_PROVIDER,
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    controlUser: options.controlUser ?? process.env.ERP_CONTROL_USER ?? "admin",
    controlPassword: options.controlPassword ?? process.env.ERP_CONTROL_PASSWORD ?? "admin",
    legacyDatabasePath: resolve(dataDir, "abicorp-erp.db"),
    seedControlAdmin: false,
  });
  const tenants = new Map();

  function companies(activeOnly = true) {
    expireDemoCompanies(registry.db);
    return registry.db.prepare(`SELECT id, code, slug, legal_name, trade_name, database_file, status
      FROM companies ${activeOnly ? "WHERE status = 'active'" : ""} ORDER BY legal_name COLLATE NOCASE`).all();
  }

  function tenantFor(slug = "") {
    expireDemoCompanies(registry.db);
    const company = slug
      ? registry.db.prepare("SELECT * FROM companies WHERE slug = ? AND status = 'active'").get(slug)
      : companies(true)[0];
    if (!company) throw new HttpError(404, "La empresa seleccionada no está disponible.");
    const managedIdentity = {
      id: company.id,
      code: company.code,
      slug: company.slug,
      legalName: company.legal_name,
      tradeName: company.trade_name,
    };
    if (!tenants.has(company.id)) {
      const databasePath = resolveCompanyDatabase(dataDir, company.database_file);
      tenants.set(company.id, createTenantApplication({
        ...options,
        dataDir: dirname(databasePath),
        databasePath,
        databaseSchema: company.slug,
        company: managedIdentity,
      }));
    }
    const application = tenants.get(company.id);
    application.syncManagedCompany(managedIdentity);
    return { company, application };
  }

  function tenantForRequest(req, requestedSlug = "") {
    if (requestedSlug) return tenantFor(requestedSlug);
    const token = parseCookies(req.headers.cookie).erp_session;
    if (token) {
      const matches = companies(true)
        .map((company) => tenantFor(company.slug))
        .filter(({ application }) => application.hasActiveSessionToken(token));
      if (matches.length === 1) return matches[0];
    }
    return tenantFor();
  }

  async function automaticLogin(req, res) {
    const body = await readJson(req);
    const username = cleanText(body.username, 80);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) throw new HttpError(400, "Captura usuario y contraseña.");

    const availableTenants = companies(true).map((company) => tenantFor(company.slug));
    const matches = availableTenants.filter(({ application }) => application.matchesCredentials(username, password));
    if (matches.length > 1) {
      throw new HttpError(409, "Estas credenciales pertenecen a más de una empresa. Solicita al administrador un usuario único.");
    }
    if (!matches.length) {
      const matchingUsers = availableTenants.filter(({ application }) => application.hasUsername(username));
      const failureTargets = matchingUsers.length ? matchingUsers : [tenantFor()];
      for (const { application } of failureTargets) application.recordLoginFailure(username, requestIp(req));
      throw new HttpError(401, "Usuario o contraseña incorrectos.");
    }
    return matches[0].application.loginWithCredentials(req, res, body);
  }

  const initial = tenantFor();

  async function handle(req, res) {
    const url = new URL(req.url, "http://local.erp");
    setSecurityHeaders(res);
    setLocalDevelopmentCors(req, res);
    if (url.pathname === "/api/companies") {
      if ((req.method ?? "GET") === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      if ((req.method ?? "GET") !== "GET") return sendJson(res, 405, { error: "Método no permitido." });
      return sendJson(res, 200, {
        companies: companies(true).map((company) => ({
          id: company.id,
          code: company.code,
          slug: company.slug,
          legalName: company.legal_name,
          tradeName: company.trade_name,
        })),
      });
    }
    try {
      const portalCompany = url.pathname.startsWith("/api/portal/") ? url.searchParams.get("company") : "";
      const requestedSlug = String(req.headers["x-company-slug"] ?? portalCompany ?? "").trim().toLowerCase();
      if (url.pathname === "/api/auth/login" && (req.method ?? "GET") === "POST" && !requestedSlug) {
        return await automaticLogin(req, res);
      }
      return await tenantForRequest(req, requestedSlug).application.handle(req, res);
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message, details: error.details });
      throw error;
    }
  }

  return {
    handle,
    db: initial.application.db,
    dbPath: initial.application.dbPath,
    controlDbPath: registry.dbPath,
    close() {
      for (const tenant of tenants.values()) tenant.close();
      registry.db.close();
    },
  };
}

export function createTenantApplication(options = {}) {
  const config = {
    dataDir: resolve(options.dataDir ?? process.env.ERP_DATA_DIR ?? "./data"),
    databasePath: options.databasePath ? resolve(options.databasePath) : null,
    databaseProvider: options.databaseProvider ?? process.env.DATABASE_PROVIDER,
    databaseUrl: options.databaseUrl ?? process.env.DATABASE_URL,
    databaseSchema: options.databaseSchema ?? options.company?.slug ?? null,
    initialAdminUser: options.initialAdminUser ?? process.env.ERP_INITIAL_ADMIN_USER ?? "admin",
    initialAdminPassword: options.initialAdminPassword ?? process.env.ERP_INITIAL_ADMIN_PASSWORD ?? "Cambiar123!",
    seedAdmin: options.seedAdmin ?? true,
    company: options.company ?? null,
    sessionHours: Number(options.sessionHours ?? process.env.ERP_SESSION_HOURS ?? 8),
    privateStorageProvider: options.privateStorageProvider ?? process.env.ERP_PRIVATE_STORAGE_PROVIDER,
  };
  const { db, dbPath } = openDatabase(config);
  const privateStorage = options.privateStorage ?? createPrivateStorage({
    provider: config.privateStorageProvider,
    root: join(config.dataDir, "private"),
    isPostgres: String(config.databaseProvider ?? "").toLowerCase() === "postgres",
  });
  let lastCleanup = 0;
  let hrControlSnapshot = null;
  const hrControlViews = new Map();
  let managedCompanyId = synchronizeManagedCompanyIdentity(db, config.company);
  let managedCompanySignature = JSON.stringify(config.company || {});

  function syncManagedCompany(company) {
    if (!company?.legalName) return managedCompanyId;
    const nextSignature = JSON.stringify(company);
    if (nextSignature === managedCompanySignature) return managedCompanyId;
    config.company = { ...company };
    managedCompanyId = synchronizeManagedCompanyIdentity(db, config.company);
    managedCompanySignature = nextSignature;
    invalidateHrControlCache();
    return managedCompanyId;
  }

  function invalidateHrControlCache() {
    hrControlSnapshot = null;
    hrControlViews.clear();
  }

  function mutationAffectsHrControl(path, method) {
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

  async function handle(req, res) {
    res.abicorpRequest = req;
    setSecurityHeaders(res);
    setLocalDevelopmentCors(req, res);
    const url = new URL(req.url, "http://local.erp");
    try {
      if (url.pathname.startsWith("/api/")) {
        if (Date.now() - lastCleanup > 10 * 60 * 1000) {
          db.prepare("DELETE FROM sessions WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL").run();
          db.prepare("DELETE FROM hr_portal_sessions WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL").run();
          lastCleanup = Date.now();
        }
        await handleApi(req, res, url);
      } else if (url.pathname === "/control" || url.pathname.startsWith("/control/")) {
        throw new HttpError(404, "El Centro de Gestión no está disponible desde la aplicación operativa.");
      } else {
        await serveStatic(req, res, url.pathname);
      }
    } catch (error) {
      if (error instanceof HttpError || error instanceof inventory.InventoryError || error instanceof sales.SalesError || error instanceof production.ProductionError || error instanceof quality.QualityError || error instanceof maintenance.MaintenanceError || error instanceof logistics.LogisticsError || error instanceof finance.FinanceError || error instanceof tasks.TasksError || error instanceof purchases.PurchasesError || error instanceof safety.SafetyError || error instanceof hr.HrError || error instanceof hrImport.HrImportError || error instanceof hrPortal.HrPortalError || error instanceof hrSchedules.HrScheduleError || error instanceof payrollCfdi.PayrollCfdiError || error instanceof payrollPreparation.PayrollPreparationError || error instanceof PrivateStorageError) {
        return sendJson(res, error.status, { error: error.message, details: error.details });
      }
      console.error(error);
      sendJson(res, 500, { error: "Ocurrió un error interno." });
    }
  }

  async function handleApi(req, res, url) {
    const method = req.method ?? "GET";
    const path = url.pathname;
    if (mutationAffectsHrControl(path, method)) {
      // Se limpia antes y después: así una lectura concurrente nunca deja un
      // tablero viejo almacenado mientras termina una modificación.
      invalidateHrControlCache();
      res.once("finish", invalidateHrControlCache);
    }
    if (method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }
    if (path === "/api/health" && method === "GET")
      return sendJson(res, 200, { status: "ok", database: "connected", time: new Date().toISOString() });
    if (path === "/api/auth/login" && method === "POST") return login(req, res);
    if (path === "/api/portal/public" && method === "GET") return sendJson(res, 200, hrPortal.publicStatus(db));
    if (path === "/api/portal/login" && method === "POST") return portalLogin(req, res);
    if (path === "/api/portal/pin" && method === "POST") return portalChangePin(req, res);
    if (path.startsWith("/api/portal/")) return handlePortalApi(req, res, path, method);

    const context = authenticate(req);
    if (!context) throw new HttpError(401, "Debes iniciar sesión.");
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) verifyCsrf(req, context);

    if (path === "/api/auth/me" && method === "GET") return sendJson(res, 200, { user: context.user, csrfToken: context.csrfToken, company: config.company });
    if (path === "/api/auth/logout" && method === "POST") return logout(req, res, context);
    if (path === "/api/auth/change-password" && method === "POST") return changePassword(req, res, context);
    if (context.user.mustChangePassword) throw new HttpError(428, "Debes cambiar la contraseña inicial.");

    if (path === "/api/dashboard" && method === "GET") return dashboard(res, context);
    if (path === "/api/users" && method === "GET") return listUsers(res, context);
    if (path === "/api/users" && method === "POST") return createUser(req, res, context);
    const userMatch = path.match(/^\/api\/users\/(\d+)$/);
    if (userMatch && method === "PATCH") return updateUser(req, res, context, Number(userMatch[1]));
    if (path === "/api/roles" && method === "GET") return listRoles(res, context);
    const roleMatch = path.match(/^\/api\/roles\/(\d+)$/);
    if (roleMatch && method === "PATCH") return updateRole(req, res, context, Number(roleMatch[1]));
    const catalogMatch = path.match(/^\/api\/catalogs\/([a-z_]+)$/);
    if (catalogMatch && method === "GET") return listCatalog(res, context, catalogMatch[1]);
    if (catalogMatch && method === "POST") return createCatalogRecord(req, res, context, catalogMatch[1]);
    const catalogItemMatch = path.match(/^\/api\/catalogs\/([a-z_]+)\/(\d+)$/);
    if (catalogItemMatch && method === "PATCH") return updateCatalogRecord(req, res, context, catalogItemMatch[1], Number(catalogItemMatch[2]));
    if (path === "/api/masters/options" && method === "GET") return masterOptions(res, context);
    const masterMatch = path.match(/^\/api\/masters\/([a-z_]+)$/);
    if (masterMatch && method === "GET") return listMaster(res, context, masterMatch[1]);
    if (masterMatch && method === "POST") return createMasterRecord(req, res, context, masterMatch[1]);
    const masterItemMatch = path.match(/^\/api\/masters\/([a-z_]+)\/(\d+)$/);
    if (masterItemMatch && method === "PATCH") return updateMasterRecord(req, res, context, masterItemMatch[1], Number(masterItemMatch[2]));
    const priceListLinesMatch = path.match(/^\/api\/price-lists\/(\d+)\/items$/);
    if (priceListLinesMatch && method === "GET") return listPriceListItems(res, context, Number(priceListLinesMatch[1]));
    if (priceListLinesMatch && method === "POST") return createPriceListItem(req, res, context, Number(priceListLinesMatch[1]));
    const priceListLineMatch = path.match(/^\/api\/price-lists\/(\d+)\/items\/(\d+)$/);
    if (priceListLineMatch && method === "PATCH") return updatePriceListItem(req, res, context, Number(priceListLineMatch[1]), Number(priceListLineMatch[2]));
    if (priceListLineMatch && method === "DELETE") return deletePriceListItem(req, res, context, Number(priceListLineMatch[1]), Number(priceListLineMatch[2]));
    if (path === "/api/inventory/overview" && method === "GET") return inventoryOverview(res, context);
    if (path === "/api/inventory/options" && method === "GET") return inventoryOptions(res, context);
    if (path === "/api/inventory/balances" && method === "GET") return inventoryBalances(res, context);
    if (path === "/api/inventory/movements" && method === "GET") return inventoryMovements(res, context, url);
    if (path === "/api/inventory/entries" && method === "POST") return inventoryEntry(req, res, context);
    if (path === "/api/inventory/exits" && method === "POST") return inventoryExit(req, res, context);
    if (path === "/api/inventory/transfers" && method === "POST") return inventoryTransfer(req, res, context);
    if (path === "/api/inventory/adjustments" && method === "POST") return inventoryAdjustment(req, res, context);
    if (path === "/api/inventory/reservations" && method === "GET") return inventoryReservations(res, context);
    if (path === "/api/inventory/reservations" && method === "POST") return inventoryReservation(req, res, context);
    const reservationActionMatch = path.match(/^\/api\/inventory\/reservations\/(\d+)\/(release|consume)$/);
    if (reservationActionMatch && method === "POST") return inventoryReservationAction(req, res, context, Number(reservationActionMatch[1]), reservationActionMatch[2]);
    if (path === "/api/inventory/locations" && method === "GET") return inventoryLocations(res, context);
    if (path === "/api/inventory/locations" && method === "POST") return inventoryLocationCreate(req, res, context);
    const inventoryLocationMatch = path.match(/^\/api\/inventory\/locations\/(\d+)$/);
    if (inventoryLocationMatch && method === "PATCH") return inventoryLocationUpdate(req, res, context, Number(inventoryLocationMatch[1]));
    if (path === "/api/inventory/lots" && method === "GET") return inventoryLots(res, context);
    if (path === "/api/inventory/lots" && method === "POST") return inventoryLotCreate(req, res, context);
    const inventoryLotMatch = path.match(/^\/api\/inventory\/lots\/(\d+)$/);
    if (inventoryLotMatch && method === "PATCH") return inventoryLotUpdate(req, res, context, Number(inventoryLotMatch[1]));
    if (path === "/api/inventory/serials" && method === "GET") return inventorySerials(res, context);
    if (path === "/api/inventory/serials" && method === "POST") return inventorySerialCreate(req, res, context);
    const inventorySerialMatch = path.match(/^\/api\/inventory\/serials\/(\d+)$/);
    if (inventorySerialMatch && method === "PATCH") return inventorySerialUpdate(req, res, context, Number(inventorySerialMatch[1]));
    if (path === "/api/inventory/counts" && method === "GET") return inventoryCounts(res, context);
    if (path === "/api/inventory/counts" && method === "POST") return inventoryCountCreate(req, res, context);
    const inventoryCountMatch = path.match(/^\/api\/inventory\/counts\/(\d+)$/);
    if (inventoryCountMatch && method === "GET") return inventoryCountDetail(res, context, Number(inventoryCountMatch[1]));
    const inventoryCountLineMatch = path.match(/^\/api\/inventory\/counts\/(\d+)\/lines\/(\d+)$/);
    if (inventoryCountLineMatch && method === "PATCH") return inventoryCountLineUpdate(req, res, context, Number(inventoryCountLineMatch[1]), Number(inventoryCountLineMatch[2]));
    const inventoryCountCompleteMatch = path.match(/^\/api\/inventory\/counts\/(\d+)\/complete$/);
    if (inventoryCountCompleteMatch && method === "POST") return inventoryCountComplete(req, res, context, Number(inventoryCountCompleteMatch[1]));
    if (path === "/api/sales/options" && method === "GET") return salesOptions(res, context);
    if (path === "/api/sales/control" && method === "GET") return salesControl(res, context);
    if (path === "/api/sales/prospects" && method === "GET") return salesProspects(res, context);
    if (path === "/api/sales/prospects" && method === "POST") return salesProspectCreate(req, res, context);
    const salesProspectMatch = path.match(/^\/api\/sales\/prospects\/(\d+)$/);
    if (salesProspectMatch && method === "PATCH") return salesProspectUpdate(req, res, context, Number(salesProspectMatch[1]));
    const salesProspectConvertMatch = path.match(/^\/api\/sales\/prospects\/(\d+)\/convert$/);
    if (salesProspectConvertMatch && method === "POST") return salesProspectConvert(req, res, context, Number(salesProspectConvertMatch[1]));
    const salesDocumentsMatch = path.match(/^\/api\/sales\/documents\/(quote|order|delivery|return|invoice)$/);
    if (salesDocumentsMatch && method === "GET") return salesDocuments(res, context, salesDocumentsMatch[1]);
    if (salesDocumentsMatch && method === "POST") return salesDocumentCreate(req, res, context, salesDocumentsMatch[1]);
    const salesDocumentMatch = path.match(/^\/api\/sales\/documents\/(\d+)$/);
    if (salesDocumentMatch && method === "GET") return salesDocumentDetail(res, context, Number(salesDocumentMatch[1]));
    const salesDocumentActionMatch = path.match(/^\/api\/sales\/documents\/(\d+)\/action$/);
    if (salesDocumentActionMatch && method === "POST") return salesDocumentAction(req, res, context, Number(salesDocumentActionMatch[1]));
    if (path === "/api/production/options" && method === "GET") return productionOptions(res, context);
    if (path === "/api/production/control" && method === "GET") return productionControl(res, context);
    if (path === "/api/production/boms" && method === "POST") return productionBomCreate(req, res, context);
    if (path === "/api/production/routes" && method === "POST") return productionRouteCreate(req, res, context);
    if (path === "/api/production/demands" && method === "POST") return productionDemandCreate(req, res, context);
    if (path === "/api/production/orders" && method === "POST") return productionOrderCreate(req, res, context);
    const productionOrderMatch = path.match(/^\/api\/production\/orders\/(\d+)$/);
    if (productionOrderMatch && method === "GET") return productionOrderDetail(res, context, Number(productionOrderMatch[1]));
    const productionOrderActionMatch = path.match(/^\/api\/production\/orders\/(\d+)\/action$/);
    if (productionOrderActionMatch && method === "POST") return productionOrderAction(req, res, context, Number(productionOrderActionMatch[1]));
    if (path === "/api/quality/options" && method === "GET") return qualityOptions(res, context);
    if (path === "/api/quality/control" && method === "GET") return qualityControl(res, context);
    if (path === "/api/quality/plans" && method === "POST") return qualityPlanCreate(req, res, context);
    if (path === "/api/quality/inspections" && method === "POST") return qualityInspectionCreate(req, res, context);
    const qualityInspectionMatch = path.match(/^\/api\/quality\/inspections\/(\d+)$/);
    if (qualityInspectionMatch && method === "GET") return qualityInspectionDetail(res, context, Number(qualityInspectionMatch[1]));
    const qualityInspectionResultsMatch = path.match(/^\/api\/quality\/inspections\/(\d+)\/results$/);
    if (qualityInspectionResultsMatch && method === "POST") return qualityInspectionResults(req, res, context, Number(qualityInspectionResultsMatch[1]));
    const qualityInspectionActionMatch = path.match(/^\/api\/quality\/inspections\/(\d+)\/action$/);
    if (qualityInspectionActionMatch && method === "POST") return qualityInspectionAction(req, res, context, Number(qualityInspectionActionMatch[1]));
    if (path === "/api/quality/nonconformities" && method === "POST") return qualityNonconformityCreate(req, res, context);
    if (path === "/api/quality/corrective-actions" && method === "POST") return qualityCorrectiveActionCreate(req, res, context);
    const qualityCorrectiveActionMatch = path.match(/^\/api\/quality\/corrective-actions\/(\d+)$/);
    if (qualityCorrectiveActionMatch && method === "PATCH") return qualityCorrectiveActionUpdate(req, res, context, Number(qualityCorrectiveActionMatch[1]));
    if (path === "/api/maintenance/options" && method === "GET") return maintenanceOptions(res, context);
    if (path === "/api/maintenance/control" && method === "GET") return maintenanceControl(res, context);
    if (path === "/api/maintenance/equipment" && method === "POST") return maintenanceEquipmentCreate(req, res, context);
    if (path === "/api/maintenance/plans" && method === "POST") return maintenancePlanCreate(req, res, context);
    if (path === "/api/maintenance/annual-program/preview" && method === "POST") return maintenanceAnnualProgramPreview(req, res, context);
    if (path === "/api/maintenance/annual-program/import" && method === "POST") return maintenanceAnnualProgramImport(req, res, context);
    if (path === "/api/maintenance/suppliers" && method === "POST") return maintenanceSupplierCreate(req, res, context);
    if (path === "/api/maintenance/requests" && method === "POST") return maintenanceRequestCreate(req, res, context);
    if (path === "/api/maintenance/orders" && method === "POST") return maintenanceOrderCreate(req, res, context);
    const maintenanceEquipmentHistoryMatch = path.match(/^\/api\/maintenance\/equipment\/(\d+)\/history$/);
    if (maintenanceEquipmentHistoryMatch && method === "GET") return maintenanceEquipmentHistory(res, context, Number(maintenanceEquipmentHistoryMatch[1]));
    const maintenanceOrderMatch = path.match(/^\/api\/maintenance\/orders\/(\d+)$/);
    if (maintenanceOrderMatch && method === "GET") return maintenanceOrderDetail(res, context, Number(maintenanceOrderMatch[1]));
    const maintenanceOrderActionMatch = path.match(/^\/api\/maintenance\/orders\/(\d+)\/action$/);
    if (maintenanceOrderActionMatch && method === "POST") return maintenanceOrderAction(req, res, context, Number(maintenanceOrderActionMatch[1]));
    if (path === "/api/logistics/options" && method === "GET") return logisticsOptions(res, context);
    if (path === "/api/logistics/control" && method === "GET") return logisticsControl(res, context);
    if (path === "/api/logistics/carriers" && method === "POST") return logisticsCarrierCreate(req, res, context);
    if (path === "/api/logistics/routes" && method === "POST") return logisticsRouteCreate(req, res, context);
    if (path === "/api/logistics/shipments" && method === "POST") return logisticsShipmentCreate(req, res, context);
    if (path === "/api/logistics/evidence" && method === "POST") return logisticsEvidenceCreate(req, res, context);
    const logisticsShipmentMatch = path.match(/^\/api\/logistics\/shipments\/(\d+)$/);
    if (logisticsShipmentMatch && method === "GET") return logisticsShipmentDetail(res, context, Number(logisticsShipmentMatch[1]));
    const logisticsShipmentActionMatch = path.match(/^\/api\/logistics\/shipments\/(\d+)\/action$/);
    if (logisticsShipmentActionMatch && method === "POST") return logisticsShipmentAction(req, res, context, Number(logisticsShipmentActionMatch[1]));
    if (path === "/api/finance/options" && method === "GET") return financeOptions(res, context);
    if (path === "/api/finance/control" && method === "GET") return financeControl(res, context);
    if (path === "/api/finance/cost-centers" && method === "POST") return financeCostCenterCreate(req, res, context);
    if (path === "/api/finance/payables" && method === "POST") return financePayableCreate(req, res, context);
    if (path === "/api/finance/collections" && method === "POST") return financeCollectionCreate(req, res, context);
    if (path === "/api/finance/payments" && method === "POST") return financePaymentCreate(req, res, context);
    if (path === "/api/finance/budgets" && method === "POST") return financeBudgetCreate(req, res, context);
    const financeBudgetActionMatch = path.match(/^\/api\/finance\/budgets\/(\d+)\/action$/);
    if (financeBudgetActionMatch && method === "POST") return financeBudgetAction(req, res, context, Number(financeBudgetActionMatch[1]));
    if (path === "/api/finance/reconciliations" && method === "POST") return financeReconciliationCreate(req, res, context);
    const financeReconciliationActionMatch = path.match(/^\/api\/finance\/reconciliations\/(\d+)\/action$/);
    if (financeReconciliationActionMatch && method === "POST") return financeReconciliationAction(req, res, context, Number(financeReconciliationActionMatch[1]));
    if (path === "/api/tasks/options" && method === "GET") return tasksOptions(res, context);
    if (path === "/api/tasks/control" && method === "GET") return tasksControl(res, context);
    if (path === "/api/tasks/flows" && method === "POST") return tasksFlowCreate(req, res, context);
    const tasksFlowMatch = path.match(/^\/api\/tasks\/flows\/(\d+)$/);
    if (tasksFlowMatch && method === "GET") return tasksFlowDetail(res, context, Number(tasksFlowMatch[1]));
    if (path === "/api/tasks" && method === "POST") return taskCreate(req, res, context);
    const taskMatch = path.match(/^\/api\/tasks\/(\d+)$/);
    if (taskMatch && method === "GET") return taskDetail(res, context, Number(taskMatch[1]));
    const taskCommentMatch = path.match(/^\/api\/tasks\/(\d+)\/comments$/);
    if (taskCommentMatch && method === "POST") return taskCommentCreate(req, res, context, Number(taskCommentMatch[1]));
    const taskActionMatch = path.match(/^\/api\/tasks\/(\d+)\/action$/);
    if (taskActionMatch && method === "POST") return taskAction(req, res, context, Number(taskActionMatch[1]));
    if (path === "/api/purchases/options" && method === "GET") return purchasesOptions(res, context);
    if (path === "/api/purchases/control" && method === "GET") return purchasesControl(res, context);
    if (path === "/api/purchases/requests" && method === "POST") return purchaseRequestCreate(req, res, context);
    const purchaseRequestMatch = path.match(/^\/api\/purchases\/requests\/(\d+)$/);
    if (purchaseRequestMatch && method === "GET") return purchaseRequestDetail(res, context, Number(purchaseRequestMatch[1]));
    const purchaseRequestActionMatch = path.match(/^\/api\/purchases\/requests\/(\d+)\/action$/);
    if (purchaseRequestActionMatch && method === "POST") return purchaseRequestAction(req, res, context, Number(purchaseRequestActionMatch[1]));
    if (path === "/api/purchases/comparisons" && method === "POST") return purchaseComparisonCreate(req, res, context);
    const purchaseComparisonMatch = path.match(/^\/api\/purchases\/comparisons\/(\d+)$/);
    if (purchaseComparisonMatch && method === "GET") return purchaseComparisonDetail(res, context, Number(purchaseComparisonMatch[1]));
    const purchaseComparisonSelectMatch = path.match(/^\/api\/purchases\/comparisons\/(\d+)\/select$/);
    if (purchaseComparisonSelectMatch && method === "POST") return purchaseComparisonSelect(req, res, context, Number(purchaseComparisonSelectMatch[1]));
    if (path === "/api/purchases/orders" && method === "POST") return purchaseOrderCreate(req, res, context);
    const purchaseOrderMatch = path.match(/^\/api\/purchases\/orders\/(\d+)$/);
    if (purchaseOrderMatch && method === "GET") return purchaseOrderDetail(res, context, Number(purchaseOrderMatch[1]));
    const purchaseOrderActionMatch = path.match(/^\/api\/purchases\/orders\/(\d+)\/action$/);
    if (purchaseOrderActionMatch && method === "POST") return purchaseOrderAction(req, res, context, Number(purchaseOrderActionMatch[1]));
    if (path === "/api/purchases/receipts" && method === "POST") return purchaseReceiptCreate(req, res, context);
    const purchaseReceiptMatch = path.match(/^\/api\/purchases\/receipts\/(\d+)$/);
    if (purchaseReceiptMatch && method === "GET") return purchaseReceiptDetail(res, context, Number(purchaseReceiptMatch[1]));
    if (path === "/api/purchases/returns" && method === "POST") return purchaseReturnCreate(req, res, context);
    if (path === "/api/purchases/invoices" && method === "POST") return purchaseInvoiceCreate(req, res, context);
    if (path === "/api/safety/options" && method === "GET") return safetyOptions(res, context);
    if (path === "/api/safety/control" && method === "GET") return safetyControl(res, context);
    if (path === "/api/safety/incidents" && method === "POST") return safetyIncidentCreate(req, res, context);
    if (path === "/api/safety/incapacities" && method === "POST") return safetyIncapacityCreate(req, res, context);
    if (path === "/api/safety/risks" && method === "POST") return safetyRiskCreate(req, res, context);
    if (path === "/api/safety/compliance" && method === "POST") return safetyComplianceCreate(req, res, context);
    const safetyIncidentActionMatch = path.match(/^\/api\/safety\/incidents\/(\d+)\/action$/);
    if (safetyIncidentActionMatch && method === "POST") return safetyIncidentAction(req, res, context, Number(safetyIncidentActionMatch[1]));
    const safetyRiskActionMatch = path.match(/^\/api\/safety\/risks\/(\d+)\/action$/);
    if (safetyRiskActionMatch && method === "POST") return safetyRiskAction(req, res, context, Number(safetyRiskActionMatch[1]));
    const safetyComplianceActionMatch = path.match(/^\/api\/safety\/compliance\/(\d+)\/action$/);
    if (safetyComplianceActionMatch && method === "POST") return safetyComplianceAction(req, res, context, Number(safetyComplianceActionMatch[1]));
    if (path === "/api/hr/options" && method === "GET") return hrOptions(res, context);
    if (path === "/api/hr/structure" && method === "GET") return hrStructure(res, context);
    if (path === "/api/hr/structure/companies" && method === "POST") return hrCompanyCreate(req, res, context);
    const hrCompanyMatch = path.match(/^\/api\/hr\/structure\/companies\/(\d+)$/);
    if (hrCompanyMatch && method === "PATCH") return hrCompanyUpdate(req, res, context, Number(hrCompanyMatch[1]));
    if (path === "/api/hr/structure/work-centers" && method === "POST") return hrWorkCenterCreate(req, res, context);
    const hrWorkCenterStructureMatch = path.match(/^\/api\/hr\/structure\/work-centers\/(\d+)$/);
    if (hrWorkCenterStructureMatch && method === "PATCH") return hrWorkCenterUpdate(req, res, context, Number(hrWorkCenterStructureMatch[1]));
    if (path === "/api/hr/structure/departments" && method === "POST") return hrDepartmentCreate(req, res, context);
    const hrDepartmentStructureMatch = path.match(/^\/api\/hr\/structure\/departments\/(\d+)$/);
    if (hrDepartmentStructureMatch && method === "PATCH") return hrDepartmentUpdate(req, res, context, Number(hrDepartmentStructureMatch[1]));
    if (path === "/api/payroll/control" && method === "GET") return payrollControl(res, context, url.searchParams);
    if (path === "/api/payroll/periods" && method === "POST") return payrollPeriodCreate(req, res, context);
    if (path === "/api/payroll/preparation/generate" && method === "POST") return payrollPreparationGenerate(req, res, context);
    if (path === "/api/payroll/preparation/finalize" && method === "POST") return payrollPreparationFinalize(req, res, context);
    const payrollPreparationLineMatch = path.match(/^\/api\/payroll\/preparation\/lines\/(\d+)$/);
    if (payrollPreparationLineMatch && method === "PATCH")
      return payrollPreparationLineUpdate(req, res, context, Number(payrollPreparationLineMatch[1]));
    if (path === "/api/payroll/cfdi/receipts" && method === "POST") return payrollCfdiImport(req, res, context);
    const payrollCfdiMatch = path.match(/^\/api\/payroll\/cfdi\/receipts\/(\d+)$/);
    if (payrollCfdiMatch && method === "GET") return payrollCfdiDetail(res, context, Number(payrollCfdiMatch[1]));
    const payrollCfdiAssociationMatch = path.match(/^\/api\/payroll\/cfdi\/receipts\/(\d+)\/associate$/);
    if (payrollCfdiAssociationMatch && method === "PATCH")
      return payrollCfdiAssociate(req, res, context, Number(payrollCfdiAssociationMatch[1]));
    const payrollCfdiFileMatch = path.match(/^\/api\/payroll\/cfdi\/receipts\/(\d+)\/files\/(\d+)$/);
    if (payrollCfdiFileMatch && method === "GET")
      return payrollCfdiFileDownload(req, res, context, Number(payrollCfdiFileMatch[1]), Number(payrollCfdiFileMatch[2]));
    if (path === "/api/hr/control" && method === "GET") return hrControl(res, context);
    if (path === "/api/hr/compliance" && method === "GET") return hrComplianceControl(res, context);
    if (path === "/api/hr/compliance/grievances" && method === "POST") return hrGrievanceCreate(req, res, context);
    const hrGrievanceMatch = path.match(/^\/api\/hr\/compliance\/grievances\/(\d+)$/);
    if (hrGrievanceMatch && method === "GET")
      return hrGrievanceDetail(res, context, Number(hrGrievanceMatch[1]));
    const hrGrievanceEvidenceMatch = path.match(/^\/api\/hr\/compliance\/grievances\/(\d+)\/evidence$/);
    if (hrGrievanceEvidenceMatch && method === "POST")
      return hrGrievanceEvidenceCreate(req, res, context, Number(hrGrievanceEvidenceMatch[1]));
    const hrGrievanceActionMatch = path.match(/^\/api\/hr\/compliance\/grievances\/(\d+)\/action$/);
    if (hrGrievanceActionMatch && method === "POST")
      return hrGrievanceAction(req, res, context, Number(hrGrievanceActionMatch[1]));
    if (path === "/api/hr/people" && method === "POST") return hrPersonCreate(req, res, context);
    if (path === "/api/hr/people/import/template" && method === "GET") return hrPeopleImportTemplate(res, context);
    if (path === "/api/hr/people/import/preview" && method === "POST") return hrPeopleImportPreview(req, res, context);
    const hrPeopleImportCommitMatch = path.match(/^\/api\/hr\/people\/import-batches\/(\d+)\/commit$/);
    if (hrPeopleImportCommitMatch && method === "POST")
      return hrPeopleImportCommit(req, res, context, Number(hrPeopleImportCommitMatch[1]));
    const hrPersonMatch = path.match(/^\/api\/hr\/people\/(\d+)$/);
    if (hrPersonMatch && method === "PATCH") return hrPersonUpdate(req, res, context, Number(hrPersonMatch[1]));
    const hrPersonActionMatch = path.match(/^\/api\/hr\/people\/(\d+)\/action$/);
    if (hrPersonActionMatch && method === "POST") return hrPersonAction(req, res, context, Number(hrPersonActionMatch[1]));
    if (path === "/api/hr/job-positions" && method === "POST") return hrJobPositionCreate(req, res, context);
    const hrJobPositionMatch = path.match(/^\/api\/hr\/job-positions\/(\d+)$/);
    if (hrJobPositionMatch && method === "PATCH")
      return hrJobPositionUpdate(req, res, context, Number(hrJobPositionMatch[1]));
    if (path === "/api/hr/work-shifts" && method === "POST") return hrWorkShiftCreate(req, res, context);
    const hrWorkShiftMatch = path.match(/^\/api\/hr\/work-shifts\/(\d+)$/);
    if (hrWorkShiftMatch && method === "PATCH")
      return hrWorkShiftUpdate(req, res, context, Number(hrWorkShiftMatch[1]));
    if (path === "/api/hr/vacation-plans" && method === "POST") return hrVacationPlanCreate(req, res, context);
    const hrVacationPlanMatch = path.match(/^\/api\/hr\/vacation-plans\/(\d+)$/);
    if (hrVacationPlanMatch && method === "PATCH")
      return hrVacationPlanUpdate(req, res, context, Number(hrVacationPlanMatch[1]));
    const hrPhotoMatch = path.match(/^\/api\/hr\/people\/(\d+)\/photo$/);
    if (hrPhotoMatch && method === "GET") return hrPersonPhoto(res, context, Number(hrPhotoMatch[1]));
    if (path === "/api/hr/leaves/preview" && method === "POST") return hrLeavePreview(req, res, context);
    if (path === "/api/hr/leaves" && method === "POST") return hrLeaveCreate(req, res, context);
    if (path === "/api/hr/attendance" && method === "POST") return hrAttendanceCreate(req, res, context);
    if (path === "/api/hr/schedules" && method === "GET") return hrSchedulesControl(res, context, url);
    if (path === "/api/hr/schedule-periods" && method === "POST") return hrSchedulePeriodCreate(req, res, context);
    const hrScheduleDefaultsMatch = path.match(/^\/api\/hr\/schedule-periods\/(\d+)\/apply-default$/);
    if (hrScheduleDefaultsMatch && method === "POST") return hrScheduleApplyDefault(req, res, context, Number(hrScheduleDefaultsMatch[1]));
    const hrScheduleCopyMatch = path.match(/^\/api\/hr\/schedule-periods\/(\d+)\/copy-previous$/);
    if (hrScheduleCopyMatch && method === "POST") return hrScheduleCopyPrevious(req, res, context, Number(hrScheduleCopyMatch[1]));
    const hrScheduleImportMatch = path.match(/^\/api\/hr\/schedule-periods\/(\d+)\/import$/);
    if (hrScheduleImportMatch && method === "POST") return hrScheduleImport(req, res, context, Number(hrScheduleImportMatch[1]));
    const hrScheduleEntryMatch = path.match(/^\/api\/hr\/schedule-versions\/(\d+)\/entries$/);
    if (hrScheduleEntryMatch && method === "POST") return hrScheduleEntrySave(req, res, context, Number(hrScheduleEntryMatch[1]));
    const hrSchedulePublishMatch = path.match(/^\/api\/hr\/schedule-versions\/(\d+)\/publish$/);
    if (hrSchedulePublishMatch && method === "POST") return hrSchedulePublish(req, res, context, Number(hrSchedulePublishMatch[1]));
    if (path === "/api/hr/actual-shifts" && method === "POST") return hrActualShiftCapture(req, res, context);
    if (path === "/api/hr/actual-shifts/import" && method === "POST") return hrActualShiftImport(req, res, context);
    if (path === "/api/hr/schedule-corrections" && method === "POST") return hrScheduleCorrectionCreate(req, res, context);
    const hrScheduleCorrectionActionMatch = path.match(/^\/api\/hr\/schedule-corrections\/(\d+)\/action$/);
    if (hrScheduleCorrectionActionMatch && method === "POST") return hrScheduleCorrectionAction(req, res, context, Number(hrScheduleCorrectionActionMatch[1]));
    const hrLeaveActionMatch = path.match(/^\/api\/hr\/leaves\/(\d+)\/action$/);
    if (hrLeaveActionMatch && method === "POST") return hrLeaveAction(req, res, context, Number(hrLeaveActionMatch[1]));
    const hrLeavePrintMatch = path.match(/^\/api\/hr\/leaves\/(\d+)\/print$/);
    if (hrLeavePrintMatch && method === "POST") return hrLeavePrint(req, res, context, Number(hrLeavePrintMatch[1]));
    if (path === "/api/hr/portal" && method === "GET") return hrPortalAdministration(res, context);
    if (path === "/api/hr/portal/settings" && method === "GET") return hrPortalSettingsRead(res, context);
    if (path === "/api/hr/portal/settings" && method === "PATCH") return hrPortalSettingsUpdate(req, res, context);
    if (path === "/api/hr/policies" && method === "GET") return hrPoliciesRead(res, context);
    if (path === "/api/hr/holidays" && method === "POST") return hrHolidayCreate(req, res, context);
    const hrHolidayMatch = path.match(/^\/api\/hr\/holidays\/(\d+)$/);
    if (hrHolidayMatch && method === "DELETE") return hrHolidayDelete(req, res, context, Number(hrHolidayMatch[1]));
    const hrAbsenceLimitMatch = path.match(/^\/api\/hr\/absence-limits\/(\d+)$/);
    if (hrAbsenceLimitMatch && method === "PATCH")
      return hrAbsenceLimitUpdate(req, res, context, Number(hrAbsenceLimitMatch[1]));
    const hrPortalAccessMatch = path.match(/^\/api\/hr\/portal\/employees\/(\d+)$/);
    if (hrPortalAccessMatch && method === "GET") return hrPortalEmployeeRead(res, context, Number(hrPortalAccessMatch[1]));
    if (hrPortalAccessMatch && method === "PATCH") return hrPortalEmployeeUpdate(req, res, context, Number(hrPortalAccessMatch[1]));
    const hrPortalResetMatch = path.match(/^\/api\/hr\/portal\/employees\/(\d+)\/reset-pin$/);
    if (hrPortalResetMatch && method === "POST") return hrPortalEmployeeReset(req, res, context, Number(hrPortalResetMatch[1]));
    if (path === "/api/areas" && method === "GET") return listAreas(res, context);
    if (path === "/api/areas" && method === "POST") return createArea(req, res, context);
    const areaMatch = path.match(/^\/api\/areas\/(\d+)$/);
    if (areaMatch && method === "PATCH") return updateArea(req, res, context, Number(areaMatch[1]));
    if (path === "/api/audit" && method === "GET") return listAudit(res, context, url);
    if (path === "/api/folios" && method === "GET") return listFolios(res, context);
    if (path === "/api/folios" && method === "POST") return createFolio(req, res, context);
    const folioMatch = path.match(/^\/api\/folios\/(\d+)$/);
    if (folioMatch && method === "PATCH") return updateFolio(req, res, context, Number(folioMatch[1]));
    const folioNextMatch = path.match(/^\/api\/folios\/(\d+)\/next$/);
    if (folioNextMatch && method === "POST") return nextFolio(req, res, context, Number(folioNextMatch[1]));
    if (path === "/api/documents" && method === "GET") return listDocuments(res, context, url);
    if (path === "/api/documents" && method === "POST") return uploadDocument(req, res, context);
    const documentDownloadMatch = path.match(/^\/api\/documents\/(\d+)\/download$/);
    if (documentDownloadMatch && method === "GET") return downloadDocument(req, res, context, Number(documentDownloadMatch[1]));
    const documentMatch = path.match(/^\/api\/documents\/(\d+)$/);
    if (documentMatch && method === "GET") return getDocument(req, res, context, Number(documentMatch[1]));
    if (documentMatch && method === "DELETE") return deleteDocument(req, res, context, Number(documentMatch[1]));
    if (path === "/api/settings" && method === "GET") return getSettings(res, context);
    if (path === "/api/settings" && method === "PATCH") return updateSettings(req, res, context);
    if (path === "/api/notifications" && method === "GET") return listNotifications(res, context);
    if (path === "/api/notifications" && method === "POST") return createNotification(req, res, context);
    const notificationMatch = path.match(/^\/api\/notifications\/(\d+)\/read$/);
    if (notificationMatch && method === "PATCH") return readNotification(res, context, Number(notificationMatch[1]));
    throw new HttpError(404, "Ruta no encontrada.");
  }

  async function portalLogin(req, res) {
    const body = await readJson(req);
    const result = hrPortal.login(db, {
      employeeNumber: body.employeeNumber,
      pin: String(body.pin ?? ""),
      ip: requestIp(req),
      userAgent: req.headers["user-agent"] ?? "",
    });
    const maxAge = result.requiresPinChange ? 15 * 60 : Math.max(60, Math.round((new Date(`${result.expiresAt}Z`).getTime() - Date.now()) / 1000));
    res.setHeader("Set-Cookie", portalSessionCookie(result.token, maxAge));
    sendJson(res, 200, {
      requiresPinChange: result.requiresPinChange,
      employee: result.employee,
      csrfToken: result.csrfToken,
      expiresAt: result.expiresAt,
    });
  }

  async function portalChangePin(req, res) {
    const session = portalContext(req, "setup");
    verifyPortalCsrf(req, session);
    const body = await readJson(req);
    const result = hrPortal.changePin(db, session, String(body.newPin ?? ""), requestIp(req));
    const maxAge = Math.max(60, Math.round((new Date(String(result.expiresAt).replace(" ", "T") + "Z").getTime() - Date.now()) / 1000));
    res.setHeader("Set-Cookie", portalSessionCookie(parseCookies(req.headers.cookie).erp_portal_session, maxAge));
    sendJson(res, 200, { ok: true, expiresAt: result.expiresAt });
  }

  async function handlePortalApi(req, res, path, method) {
    const session = portalContext(req, "portal");
    if (!["GET", "HEAD", "OPTIONS"].includes(method)) verifyPortalCsrf(req, session);
    if (path === "/api/portal/me" && method === "GET")
      return sendJson(res, 200, { ...hrPortal.overview(db, session), csrfToken: session.csrf_token, company: config.company });
    if (path === "/api/portal/logout" && method === "POST") {
      hrPortal.logout(db, session, requestIp(req));
      res.setHeader("Set-Cookie", clearPortalSessionCookie());
      return sendJson(res, 200, { ok: true });
    }
    if (path === "/api/portal/team" && method === "GET")
      return sendJson(res, 200, hrPortal.teamOverview(db, session.employee_id));
    if (path === "/api/portal/requests" && method === "POST") return portalRequestCreate(req, res, session);
    const portalRequestMatch = path.match(/^\/api\/portal\/requests\/(\d+)$/);
    if (portalRequestMatch && method === "PATCH")
      return portalRequestUpdate(req, res, session, Number(portalRequestMatch[1]));
    const portalTeamRequestMatch = path.match(/^\/api\/portal\/team\/requests\/(\d+)\/action$/);
    if (portalTeamRequestMatch && method === "POST")
      return portalTeamRequestAction(req, res, session, Number(portalTeamRequestMatch[1]));
    if (path === "/api/portal/payroll/cfdi" && method === "GET") return portalPayrollCfdiList(res, session);
    const portalCfdiConfirmMatch = path.match(/^\/api\/portal\/payroll\/cfdi\/(\d+)\/confirm$/);
    if (portalCfdiConfirmMatch && method === "POST")
      return portalPayrollCfdiConfirm(req, res, session, Number(portalCfdiConfirmMatch[1]));
    const portalCfdiClarificationMatch = path.match(/^\/api\/portal\/payroll\/cfdi\/(\d+)\/clarifications$/);
    if (portalCfdiClarificationMatch && method === "POST")
      return portalPayrollCfdiClarification(req, res, session, Number(portalCfdiClarificationMatch[1]));
    const portalCfdiFileMatch = path.match(/^\/api\/portal\/payroll\/cfdi\/(\d+)\/files\/(\d+)$/);
    if (portalCfdiFileMatch && method === "GET")
      return portalPayrollCfdiFileDownload(req, res, session, Number(portalCfdiFileMatch[1]), Number(portalCfdiFileMatch[2]));
    if (path === "/api/portal/documents" && method === "GET") return portalDocuments(res, session);
    if (path === "/api/portal/documents" && method === "POST") return portalDocumentUpload(req, res, session);
    const documentMatch = path.match(/^\/api\/portal\/documents\/(\d+)\/download$/);
    if (documentMatch && method === "GET") return portalDocumentDownload(req, res, session, Number(documentMatch[1]));
    if (path === "/api/portal/notifications" && method === "GET")
      return sendJson(res, 200, { notifications: hrPortal.notifications(db, session.employee_id) });
    const notificationMatch = path.match(/^\/api\/portal\/notifications\/(\d+)\/read$/);
    if (notificationMatch && method === "PATCH") {
      hrPortal.markNotificationRead(db, session.employee_id, Number(notificationMatch[1]));
      return sendJson(res, 200, { ok: true });
    }
    throw new HttpError(404, "Ruta del portal no encontrada.");
  }

  async function portalRequestCreate(req, res, session) {
    if (!session.can_create_requests) throw new HttpError(403, "No tienes habilitada la creaci\u00f3n de solicitudes.");
    const body = await readJson(req);
    const result = hr.createLeave(db, { ...body, employeeId: session.employee_id }, null);
    db.prepare("UPDATE hr_leave_requests SET request_origin = 'portal' WHERE id = ?").run(result.id);
    hrPortal.notify(db, session.employee_id, "Solicitud recibida",
      `Tu solicitud ${result.folio} fue registrada y est\u00e1 pendiente de revisi\u00f3n.`, "success", "hr_leave_request", result.id);
    hrPortal.portalAudit(db, session.employee_id, "portal.request_created", "hr_leave_request", result.id,
      { folio: result.folio, leaveType: body.leaveType }, requestIp(req));
    sendJson(res, 201, result);
  }

  async function portalRequestUpdate(req, res, session, id) {
    if (!session.can_create_requests) throw new HttpError(403, "No tienes habilitada la edición de solicitudes.");
    const body = await readJson(req);
    let result;
    db.exec("BEGIN IMMEDIATE");
    try {
      result = hr.updatePortalLeave(db, id, session.employee_id, body);
      hrPortal.recordRequestReview(db, id, session.employee_id, "resubmitted", "Modificaciones enviadas por el colaborador.");
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const manager = db.prepare("SELECT manager_employee_id FROM hr_employee_profiles WHERE employee_id = ?").get(session.employee_id);
    if (manager?.manager_employee_id) hrPortal.notify(db, manager.manager_employee_id, "Solicitud corregida",
      `${result.folio} fue modificada y está lista para una nueva revisión.`, "action", "hr_leave_request", id);
    hrPortal.portalAudit(db, session.employee_id, "portal.request_resubmitted", "hr_leave_request", id,
      { folio: result.folio }, requestIp(req));
    sendJson(res, 200, result);
  }

  async function portalTeamRequestAction(req, res, session, id) {
    const body = await readJson(req);
    const request = db.prepare("SELECT employee_id, folio FROM hr_leave_requests WHERE id = ?").get(id);
    const result = hr.managerLeaveAction(db, id, session.employee_id, body);
    hrPortal.recordRequestReview(db, id, session.employee_id, body.action, body.reason);
    const messages = {
      approve: ["Autorización de área completada", `${request.folio} fue autorizada por tu Jefe de área y pasó a Recursos Humanos.`, "success"],
      reject: ["Solicitud rechazada", `Tu solicitud ${request.folio} fue rechazada: ${body.reason}`, "warning"],
      request_changes: ["Solicitud con observaciones", `Debes modificar ${request.folio}: ${body.reason}`, "action"],
    };
    hrPortal.notify(db, request.employee_id, ...messages[body.action], "hr_leave_request", id);
    hrPortal.portalAudit(db, session.employee_id, `portal.team_request_${body.action}`,
      "hr_leave_request", id, { reason: body.reason, employeeId: request.employee_id }, requestIp(req));
    sendJson(res, 200, result);
  }

  function portalPayrollCfdiList(res, session) {
    if (!session.can_view_cfdi) throw new HttpError(403, "No tienes habilitada la consulta de CFDI de n\u00f3mina.");
    sendJson(res, 200, { receipts: payrollCfdi.portalReceipts(db, session.employee_id) });
  }

  function portalPayrollCfdiConfirm(req, res, session, id) {
    if (!session.can_view_cfdi) throw new HttpError(403, "No tienes habilitada la consulta de CFDI de n\u00f3mina.");
    const receipt = payrollCfdi.confirmReceipt(db, id, session.employee_id, requestIp(req));
    sendJson(res, 200, { receipt });
  }

  async function portalPayrollCfdiClarification(req, res, session, id) {
    if (!session.can_view_cfdi) throw new HttpError(403, "No tienes habilitada la consulta de CFDI de n\u00f3mina.");
    const body = await readJson(req);
    const clarification = payrollCfdi.createClarification(db, id, session.employee_id, body.message, requestIp(req));
    sendJson(res, 201, { clarification });
  }

  async function portalPayrollCfdiFileDownload(req, res, session, receiptId, fileId) {
    if (!session.can_view_cfdi) throw new HttpError(403, "No tienes habilitada la consulta de CFDI de n\u00f3mina.");
    payrollCfdi.ownReceipt(db, receiptId, session.employee_id);
    const file = payrollCfdi.receiptFile(db, receiptId, fileId);
    const data = await readPrivateFile(file);
    payrollCfdi.recordAccess(db, { receiptId, fileId, employeeId: session.employee_id,
      action: "download", fileName: file.original_name, ip: requestIp(req) });
    sendPrivateFile(res, file, data);
  }

  function portalDocuments(res, session) {
    const rows = db.prepare(`SELECT d.id, d.original_name, d.mime_type, d.size_bytes, d.description,
      d.sensitivity, d.issue_date, d.expiry_date, d.version_number, d.created_at,
      dt.code AS document_type_code, dt.name AS document_type_name
      FROM documents d LEFT JOIN hr_document_types dt ON dt.id = d.document_type_id
      WHERE d.employee_id = ? AND d.deleted_at IS NULL AND d.is_current = 1 ORDER BY d.created_at DESC`).all(session.employee_id)
      .filter((row) => portalCanAccessDocument(session, row.sensitivity));
    sendJson(res, 200, { documents: rows });
  }

  async function portalDocumentUpload(req, res, session) {
    if (!session.can_upload_documents) throw new HttpError(403, "No tienes habilitada la carga de documentos.");
    const body = await readJson(req);
    const originalName = cleanText(body.originalName, 240);
    const description = cleanOptionalText(body.description, 500) ?? "Documento adjunto desde el portal";
    const documentType = db.prepare("SELECT * FROM hr_document_types WHERE id = ? AND is_active = 1")
      .get(Number(body.documentTypeId));
    if (!documentType || !["standard", "fiscal", "medical"].includes(documentType.sensitivity))
      throw new HttpError(400, "Selecciona un tipo documental permitido.");
    if (!portalCanAccessDocument(session, documentType.sensitivity))
      throw new HttpError(403, "No tienes autorizaci\u00f3n para esa clase de documento.");
    let bytes;
    try { bytes = Buffer.from(String(body.contentBase64 ?? ""), "base64"); }
    catch { throw new HttpError(400, "El archivo no tiene un formato v\u00e1lido."); }
    if (!originalName || !bytes.length) throw new HttpError(400, "Selecciona un archivo v\u00e1lido.");
    if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, "El archivo supera el l\u00edmite de 8 MB.");
    const issueDate = cleanOptionalDate(body.issueDate, "fecha de emisi\u00f3n");
    const expiryDate = cleanOptionalDate(body.expiryDate, "fecha de vencimiento");
    if (expiryDate && !documentType.allows_expiry_date)
      throw new HttpError(400, "Este tipo documental no maneja fecha de vencimiento.");
    const extension = extname(originalName).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
    const storedName = `${createOpaqueToken(18)}${extension}`;
    const mimeType = cleanText(body.mimeType, 120) || "application/octet-stream";
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const previous = db.prepare(`SELECT id, version_number FROM documents WHERE employee_id = ?
      AND document_type_id = ? AND is_current = 1 AND deleted_at IS NULL ORDER BY version_number DESC LIMIT 1`)
      .get(session.employee_id, documentType.id);
    let id;
    db.exec("BEGIN IMMEDIATE");
    try {
      if (previous) db.prepare("UPDATE documents SET is_current = 0 WHERE id = ?").run(previous.id);
      const result = db.prepare(`INSERT INTO documents
        (module, entity_type, entity_id, original_name, stored_name, mime_type, size_bytes, storage_path,
         checksum, description, content_data, sensitivity, employee_id, document_type_id, issue_date,
         expiry_date, version_number, replaces_document_id, is_current, uploaded_by_employee_id)
        VALUES ('hr_portal', 'employee', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
        .run(session.employee_id, originalName, storedName, mimeType, bytes.length, `database:${storedName}`,
          checksum, description, bytes, documentType.sensitivity, session.employee_id, documentType.id,
          issueDate, expiryDate, Number(previous?.version_number || 0) + 1, previous?.id || null, session.employee_id);
      id = Number(result.lastInsertRowid);
      if (body.requestId) {
        db.prepare(`UPDATE hr_leave_requests SET employee_attachment_id = ?
          WHERE id = ? AND employee_id = ?`).run(id, Number(body.requestId), session.employee_id);
        db.prepare(`INSERT OR IGNORE INTO hr_leave_request_documents (leave_request_id, document_id)
          SELECT id, ? FROM hr_leave_requests WHERE id = ? AND employee_id = ?`)
          .run(id, Number(body.requestId), session.employee_id);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    hrPortal.portalAudit(db, session.employee_id, "portal.document_uploaded", "document", id,
      { name: originalName, sensitivity: documentType.sensitivity }, requestIp(req));
    sendJson(res, 201, { id });
  }

  function portalDocumentDownload(req, res, session, id) {
    const document = db.prepare(`SELECT * FROM documents WHERE id = ? AND employee_id = ?
      AND deleted_at IS NULL AND is_current = 1`).get(id, session.employee_id);
    if (!document) throw new HttpError(404, "Documento no encontrado.");
    if (!portalCanAccessDocument(session, document.sensitivity)) throw new HttpError(403, "Documento no autorizado.");
    if (!document.content_data) throw new HttpError(410, "El archivo no est\u00e1 disponible en la base de datos.");
    hrPortal.portalAudit(db, session.employee_id, "portal.document_downloaded", "document", id,
      { name: document.original_name }, requestIp(req));
    db.prepare(`INSERT INTO hr_document_access_log
      (document_id, employee_id, user_id, action, document_name, sensitivity, ip_address)
      VALUES (?, ?, NULL, 'download', ?, ?, ?)`)
      .run(document.id, session.employee_id, document.original_name, document.sensitivity, requestIp(req));
    res.writeHead(200, {
      "Content-Type": document.mime_type,
      "Content-Length": document.content_data.length,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
      "Cache-Control": "private, no-store",
    });
    res.end(document.content_data);
  }

  function hrPortalAdministration(res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    sendJson(res, 200, {
      settings: hrPortal.portalSettings(db), employees: hrPortal.listEmployeeAccess(db),
      holidays: hrPortal.holidays(db), absenceLimits: hrPortal.absenceLimits(db),
    });
  }

  function hrPortalSettingsRead(res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    sendJson(res, 200, { settings: hrPortal.portalSettings(db) });
  }

  function hrPoliciesRead(res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    sendJson(res, 200, {
      settings: hrPortal.portalSettings(db),
      holidays: hrPortal.holidays(db),
      absenceLimits: hrPortal.absenceLimits(db),
    });
  }

  function hrPortalEmployeeRead(res, context, employeeId) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    assertEmployeeAccess(db, context.user.id, employeeId, HttpError);
    sendJson(res, 200, { access: hrPortal.employeeAccess(db, employeeId) });
  }

  async function hrPortalSettingsUpdate(req, res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    const settings = hrPortal.updatePortalSettings(db, await readJson(req), context.user.id);
    moduleAudit(req, context, "hr", "hr.portal_settings_updated", "Configuraci\u00f3n del portal actualizada", settings, {}, "hr_portal_settings");
    sendJson(res, 200, { settings });
  }

  async function hrHolidayCreate(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const holiday = hrPortal.createHoliday(db, await readJson(req), context.user.id);
    moduleAudit(req, context, "hr", "hr.holiday_created", "Día festivo agregado", holiday, {}, "hr_holiday");
    sendJson(res, 201, { holiday });
  }

  function hrHolidayDelete(req, res, context, id) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    hrPortal.deleteHoliday(db, id);
    moduleAudit(req, context, "hr", "hr.holiday_deleted", "Día festivo retirado", { id }, {}, "hr_holiday");
    sendJson(res, 200, { ok: true });
  }

  async function hrAbsenceLimitUpdate(req, res, context, departmentId) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const limit = hrPortal.saveAbsenceLimit(db, departmentId, await readJson(req), context.user.id);
    moduleAudit(req, context, "hr", "hr.absence_limit_updated", "Límite de ausencias actualizado", limit, {}, "hr_department_absence_limit");
    sendJson(res, 200, { limit });
  }

  async function hrPortalEmployeeUpdate(req, res, context, employeeId) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    assertEmployeeAccess(db, context.user.id, employeeId, HttpError);
    const access = hrPortal.configureEmployeeAccess(db, employeeId, await readJson(req), context.user.id);
    moduleAudit(req, context, "hr", "hr.portal_access_updated", "Acceso de colaborador al portal actualizado", { employeeId }, {}, "hr_employee_portal_access");
    sendJson(res, 200, { access });
  }

  async function hrPortalEmployeeReset(req, res, context, employeeId) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    assertEmployeeAccess(db, context.user.id, employeeId, HttpError);
    const access = hrPortal.resetEmployeePin(db, employeeId, context.user.id);
    moduleAudit(req, context, "hr", "hr.portal_pin_reset", "PIN del colaborador reiniciado", { employeeId }, {}, "hr_employee_portal_access");
    sendJson(res, 200, { access });
  }

  function portalContext(req, expectedType) {
    const session = hrPortal.authenticate(db, parseCookies(req.headers.cookie).erp_portal_session, expectedType);
    if (!session) throw new HttpError(401, "Debes iniciar sesi\u00f3n en el portal.");
    return session;
  }

  async function login(req, res, suppliedBody = null) {
    const body = suppliedBody ?? await readJson(req);
    const username = cleanText(body.username, 80);
    const password = typeof body.password === "string" ? body.password : "";
    if (!username || !password) throw new HttpError(400, "Captura usuario y contraseña.");
    const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
    const ip = requestIp(req);
    if (!user || user.status !== "active") {
      recordLoginFailure(username, ip);
      throw new HttpError(401, "Usuario o contraseña incorrectos.");
    }
    if (user.locked_until && new Date(`${user.locked_until}Z`).getTime() > Date.now())
      throw new HttpError(429, "La cuenta está bloqueada temporalmente. Intenta más tarde.");
    if (!verifyPassword(password, user.password_hash)) {
      recordLoginFailure(username, ip);
      throw new HttpError(401, "Usuario o contraseña incorrectos.");
    }
    const token = createOpaqueToken();
    const csrf = createOpaqueToken(24);
    const expires = new Date(Date.now() + config.sessionHours * 3600 * 1000).toISOString().replace("T", " ").replace("Z", "");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
      db.prepare(`INSERT INTO sessions (user_id, token_hash, csrf_token, ip_address, user_agent, expires_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(user.id, hashToken(token), csrf, ip, String(req.headers["user-agent"] ?? "").slice(0, 300), expires);
      audit(db, { userId: user.id, action: "auth.login", module: "auth", summary: "Inicio de sesión exitoso", ip });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    res.setHeader("Set-Cookie", sessionCookie(token, config.sessionHours * 3600));
    sendJson(res, 200, { user: loadUser(user.id), csrfToken: csrf, company: config.company });
  }

  function hasUsername(username) {
    return Boolean(db.prepare("SELECT 1 FROM users WHERE username = ?").get(username));
  }

  function matchesCredentials(username, password) {
    const user = db.prepare("SELECT password_hash, status FROM users WHERE username = ?").get(username);
    return Boolean(user && user.status === "active" && verifyPassword(password, user.password_hash));
  }

  function recordLoginFailure(username, ip) {
    const user = db.prepare("SELECT id, status, failed_login_count FROM users WHERE username = ?").get(username);
    if (!user || user.status !== "active") {
      audit(db, { action: "auth.login_failed", module: "auth", summary: `Acceso rechazado para ${username}`, ip });
      return;
    }
    const attempts = Number(user.failed_login_count) + 1;
    const lock = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString().replace("T", " ").replace("Z", "") : null;
    db.prepare("UPDATE users SET failed_login_count = ?, locked_until = ? WHERE id = ?").run(attempts >= 5 ? 0 : attempts, lock, user.id);
    audit(db, { userId: user.id, action: "auth.login_failed", module: "auth", summary: "Contraseña incorrecta", ip });
  }

  function hasActiveSessionToken(token) {
    return Boolean(db.prepare(`SELECT 1 FROM sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`).get(hashToken(token)));
  }

  function authenticate(req) {
    const token = parseCookies(req.headers.cookie).erp_session;
    if (!token) return null;
    const session = db.prepare(`SELECT id, user_id, csrf_token FROM sessions
      WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`).get(hashToken(token));
    if (!session) return null;
    const user = loadUser(session.user_id);
    if (!user || user.status !== "active") return null;
    db.prepare("UPDATE sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?").run(session.id);
    return { sessionId: session.id, csrfToken: session.csrf_token, user };
  }

  function loadUser(id) {
    const row = db.prepare(`SELECT id, username, full_name, email, status, must_change_password, last_login_at, created_at
      FROM users WHERE id = ?`).get(id);
    if (!row) return null;
    const roles = db.prepare(`SELECT r.id, r.code, r.name, r.level FROM roles r
      JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.level DESC`).all(id);
    const permissions = permissionsForUser(db, id);
    const areas = db.prepare(`SELECT a.id, a.code, a.name, ua.is_primary FROM areas a
      JOIN user_areas ua ON ua.area_id = a.id WHERE ua.user_id = ? ORDER BY ua.is_primary DESC, a.name`).all(id);
    return {
      id: row.id,
      username: row.username,
      fullName: row.full_name,
      email: row.email,
      status: row.status,
      mustChangePassword: Boolean(row.must_change_password),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      roles,
      permissions,
      moduleAccess: effectiveModuleAccess(db, id),
      laborIdentity: laborIdentityForUser(db, id),
      areas,
    };
  }

  function verifyCsrf(req, context) {
    const provided = String(req.headers["x-csrf-token"] ?? "");
    if (!provided || provided !== context.csrfToken) throw new HttpError(403, "La sesión de seguridad no es válida. Recarga la página.");
  }

  function verifyPortalCsrf(req, context) {
    const provided = String(req.headers["x-csrf-token"] ?? "");
    if (!provided || provided !== context.csrf_token)
      throw new HttpError(403, "La sesi\u00f3n de seguridad del portal no es v\u00e1lida. Recarga la p\u00e1gina.");
  }

  function requirePermission(context, permission) {
    if (!context.user.permissions.includes(permission)) throw new HttpError(403, "No tienes permiso para realizar esta acción.");
  }

  function requireAnyPermission(context, permissions) {
    if (!permissions.some((permission) => context.user.permissions.includes(permission)))
      throw new HttpError(403, "No tienes permiso para realizar esta acción.");
  }

  function requireHrAdministrator(context) {
    const identity = laborIdentityForUser(db, context.user.id);
    if (identity && (identity.identityType !== "manager" || identity.accessStatus !== "active"))
      throw new HttpError(403, "Operacion reservada al administrador de Recursos Humanos.");
  }

  function assertCfdiPermission(context, receipt = null) {
    const identity = laborIdentityForUser(db, context.user.id);
    if (!canAccessSensitiveDocument(identity, "cfdi"))
      throw new HttpError(403, "No tienes permiso para consultar CFDI de n\u00f3mina.");
    if (receipt?.employee_id && !canAccessEmployee(db, context.user.id, receipt.employee_id))
      throw new HttpError(403, "El CFDI pertenece a un trabajador fuera de tu alcance autorizado.");
    if (receipt && !receipt.employee_id && !context.user.permissions.includes("payroll.manage"))
      throw new HttpError(403, "La bandeja de CFDI no relacionados requiere permiso de gesti\u00f3n de n\u00f3mina.");
  }

  async function readPrivateFile(file) {
    if (file.storage_provider !== privateStorage.provider)
      throw new HttpError(503, "El proveedor configurado no corresponde al archivo solicitado.");
    const data = await privateStorage.get(file.storage_key);
    if (createHash("sha256").update(data).digest("hex") !== file.checksum)
      throw new HttpError(409, "La verificaci\u00f3n de integridad del archivo fall\u00f3.");
    return data;
  }

  function sendPrivateFile(res, file, data) {
    res.writeHead(200, {
      "Content-Type": file.mime_type,
      "Content-Length": data.length,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      "Cache-Control": "private, no-store",
    });
    res.end(data);
  }

  function logout(req, res, context) {
    db.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?").run(context.sessionId);
    audit(db, { userId: context.user.id, action: "auth.logout", module: "auth", summary: "Cierre de sesión", ip: requestIp(req) });
    res.setHeader("Set-Cookie", clearSessionCookie());
    sendJson(res, 200, { ok: true });
  }

  async function changePassword(req, res, context) {
    const body = await readJson(req);
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(context.user.id);
    if (!verifyPassword(String(body.currentPassword ?? ""), row.password_hash)) throw new HttpError(400, "La contraseña actual no es correcta.");
    const next = String(body.newPassword ?? "");
    const errors = validatePassword(next);
    if (errors.length) throw new HttpError(400, "La nueva contraseña no cumple los requisitos.", errors);
    if (verifyPassword(next, row.password_hash)) throw new HttpError(400, "La contraseña nueva debe ser diferente.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(hashPassword(next), context.user.id);
      db.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND id <> ?").run(context.user.id, context.sessionId);
      audit(db, { userId: context.user.id, action: "auth.password_changed", module: "auth", entityType: "user", entityId: context.user.id, summary: "Contraseña actualizada", ip: requestIp(req) });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    sendJson(res, 200, { user: loadUser(context.user.id) });
  }

  function dashboard(res, context) {
    requirePermission(context, "dashboard.view");
    const metrics = {
      users: db.prepare("SELECT COUNT(*) AS value FROM users WHERE status = 'active'").get().value,
      areas: db.prepare("SELECT COUNT(*) AS value FROM areas WHERE is_active = 1").get().value,
      activeSessions: db.prepare("SELECT COUNT(*) AS value FROM sessions WHERE revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP").get().value,
      eventsToday: db.prepare("SELECT COUNT(*) AS value FROM audit_logs WHERE date(created_at) = date('now')").get().value,
    };
    const recent = db.prepare(`SELECT a.id, a.action, a.module, a.summary, a.created_at, u.full_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT 8`).all();
    sendJson(res, 200, { metrics, recent });
  }

  function listUsers(res, context) {
    requirePermission(context, "users.view");
    const rows = db.prepare(`SELECT id, username, full_name, email, status, must_change_password, last_login_at, created_at
      FROM users ORDER BY full_name COLLATE NOCASE`).all();
    sendJson(res, 200, { users: rows.map((row) => ({
      id: row.id, username: row.username, fullName: row.full_name, email: row.email, status: row.status,
      mustChangePassword: Boolean(row.must_change_password), lastLoginAt: row.last_login_at, createdAt: row.created_at,
      roles: db.prepare(`SELECT r.id, r.code, r.name, r.level FROM roles r JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.level DESC`).all(row.id),
      areas: db.prepare(`SELECT a.id, a.code, a.name FROM areas a JOIN user_areas ua ON ua.area_id = a.id WHERE ua.user_id = ? ORDER BY a.name`).all(row.id),
    })) });
  }

  async function createUser(req, res, context) {
    requirePermission(context, "users.manage");
    const body = await readJson(req);
    const username = cleanText(body.username, 80);
    const fullName = cleanText(body.fullName, 140);
    const email = cleanOptionalText(body.email, 180)?.toLowerCase() ?? null;
    const password = String(body.password ?? "");
    const roleIds = cleanIds(body.roleIds);
    const areaIds = cleanIds(body.areaIds);
    if (!username || !/^[a-zA-Z0-9._-]{3,80}$/.test(username)) throw new HttpError(400, "El usuario debe tener entre 3 y 80 caracteres válidos.");
    if (!fullName) throw new HttpError(400, "Captura el nombre completo.");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "El correo no es válido.");
    const passwordErrors = validatePassword(password);
    if (passwordErrors.length) throw new HttpError(400, "La contraseña temporal no cumple los requisitos.", passwordErrors);
    if (!roleIds.length) throw new HttpError(400, "Selecciona al menos un rol.");
    try {
      db.exec("BEGIN IMMEDIATE");
      const result = db.prepare(`INSERT INTO users (username, full_name, email, password_hash, must_change_password)
        VALUES (?, ?, ?, ?, 1)`).run(username, fullName, email, hashPassword(password));
      const id = Number(result.lastInsertRowid);
      assignIds(db, "user_roles", "user_id", "role_id", id, roleIds);
      assignIds(db, "user_areas", "user_id", "area_id", id, areaIds);
      audit(db, { userId: context.user.id, action: "users.created", module: "users", entityType: "user", entityId: id, summary: `Usuario ${username} creado`, details: { roleIds, areaIds }, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 201, { user: loadUser(id) });
    } catch (error) {
      if (db.isTransaction) db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "El usuario o correo ya está registrado.");
      throw error;
    }
  }

  async function updateUser(req, res, context, id) {
    requirePermission(context, "users.manage");
    const existing = db.prepare("SELECT id, username FROM users WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Usuario no encontrado.");
    const body = await readJson(req);
    const fullName = cleanText(body.fullName, 140);
    const email = cleanOptionalText(body.email, 180)?.toLowerCase() ?? null;
    const status = String(body.status ?? "active");
    const roleIds = cleanIds(body.roleIds);
    const areaIds = cleanIds(body.areaIds);
    if (!fullName) throw new HttpError(400, "Captura el nombre completo.");
    if (!['active', 'blocked', 'inactive'].includes(status)) throw new HttpError(400, "Estado no válido.");
    if (email && !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, "El correo no es válido.");
    if (!roleIds.length) throw new HttpError(400, "Selecciona al menos un rol.");
    if (id === context.user.id && status !== "active") throw new HttpError(400, "No puedes bloquear tu propio usuario.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE users SET full_name = ?, email = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(fullName, email, status, id);
      db.prepare("DELETE FROM user_roles WHERE user_id = ?").run(id);
      db.prepare("DELETE FROM user_areas WHERE user_id = ?").run(id);
      assignIds(db, "user_roles", "user_id", "role_id", id, roleIds);
      assignIds(db, "user_areas", "user_id", "area_id", id, areaIds);
      if (status !== "active") db.prepare("UPDATE sessions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(id);
      audit(db, { userId: context.user.id, action: "users.updated", module: "users", entityType: "user", entityId: id, summary: `Usuario ${existing.username} actualizado`, details: { status, roleIds, areaIds }, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 200, { user: loadUser(id) });
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "El correo ya está registrado.");
      throw error;
    }
  }

  function listRoles(res, context) {
    requirePermission(context, "roles.view");
    const roles = db.prepare("SELECT id, code, name, level, description, is_system FROM roles ORDER BY level").all().map((role) => ({
      ...role,
      permissions: db.prepare(`SELECT p.id, p.code, p.module, p.action, p.description, p.min_level FROM permissions p
        JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ? ORDER BY p.module, p.action`).all(role.id),
      usersCount: db.prepare("SELECT COUNT(*) AS value FROM user_roles WHERE role_id = ?").get(role.id).value,
    }));
    const permissions = db.prepare("SELECT id, code, module, action, description, min_level FROM permissions ORDER BY min_level, module, action").all();
    sendJson(res, 200, { roles, permissions });
  }

  async function updateRole(req, res, context, id) {
    requirePermission(context, "roles.manage");
    const role = db.prepare("SELECT id, code, name, level FROM roles WHERE id = ?").get(id);
    if (!role) throw new HttpError(404, "Rol no encontrado.");
    if (["ADMIN", "PERSONALIZADO"].includes(role.code))
      throw new HttpError(400, "Este rol está protegido y sólo puede administrarse desde su servicio correspondiente.");
    const body = await readJson(req);
    const permissionIds = cleanIds(body.permissionIds);
    const available = db.prepare("SELECT id FROM permissions WHERE min_level <= ?").all(role.level).map((item) => item.id);
    const allowed = new Set(available);
    if (permissionIds.some((permissionId) => !allowed.has(permissionId)))
      throw new HttpError(400, `Un rol de nivel ${role.level} no puede recibir permisos de un nivel superior.`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("DELETE FROM role_permissions WHERE role_id = ?").run(id);
      const insert = db.prepare("INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)");
      for (const permissionId of permissionIds) insert.run(id, permissionId);
      audit(db, { userId: context.user.id, action: "roles.permissions_updated", module: "roles", entityType: "role", entityId: id, summary: `Permisos de ${role.name} actualizados`, details: { permissionIds }, ip: requestIp(req) });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    listRoles(res, context);
  }

  function catalogDefinition(type) {
    const definition = catalogDefinitions[type];
    if (!definition) throw new HttpError(404, "Catálogo no encontrado.");
    return definition;
  }

  function listCatalog(res, context, type) {
    const definition = catalogDefinition(type);
    requirePermission(context, `${definition.permission}.view`);
    sendJson(res, 200, { type, records: db.prepare(definition.select).all() });
  }

  async function createCatalogRecord(req, res, context, type) {
    const definition = catalogDefinition(type);
    requirePermission(context, `${definition.permission}.manage`);
    const body = await readJson(req);
    applyAutoPlaceholder(definition, body);
    const values = cleanCatalogValues(definition, body, false);
    const columns = Object.keys(values);
    const placeholders = columns.map(() => "?").join(", ");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (type === "currencies" && values.is_base === 1) db.prepare("UPDATE currencies SET is_base = 0").run();
      const result = db.prepare(`INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${placeholders})`).run(...columns.map((column) => values[column]));
      const id = Number(result.lastInsertRowid);
      const code = finalizeAutoCode(db, definition, id, values);
      audit(db, { userId: context.user.id, action: "catalogs.created", module: "catalogs", entityType: type, entityId: id, summary: `${definition.label} creado`, details: values, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 201, { id, code });
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, `Ya existe un registro con ese código o relación en ${definition.label.toLowerCase()}.`);
      if (String(error.message).includes("FOREIGN KEY constraint failed")) throw new HttpError(400, "La relación seleccionada no es válida.");
      throw error;
    }
  }

  async function updateCatalogRecord(req, res, context, type, id) {
    const definition = catalogDefinition(type);
    requirePermission(context, `${definition.permission}.manage`);
    const existing = db.prepare(`SELECT id FROM ${definition.table} WHERE id = ?`).get(id);
    if (!existing) throw new HttpError(404, `${definition.label} no encontrado.`);
    const values = cleanCatalogValues(definition, await readJson(req), true);
    if (definition.autoCode) delete values[definition.autoCode.field];
    const columns = Object.keys(values);
    if (!columns.length) throw new HttpError(400, "No hay cambios para guardar.");
    db.exec("BEGIN IMMEDIATE");
    try {
      if (type === "currencies" && values.is_base === 1) db.prepare("UPDATE currencies SET is_base = 0 WHERE id <> ?").run(id);
      db.prepare(`UPDATE ${definition.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...columns.map((column) => values[column]), id);
      audit(db, { userId: context.user.id, action: "catalogs.updated", module: "catalogs", entityType: type, entityId: id, summary: `${definition.label} actualizado`, details: values, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 200, { id });
    } catch (error) {
      db.exec("ROLLBACK");
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, `Ya existe un registro con ese código o relación en ${definition.label.toLowerCase()}.`);
      if (String(error.message).includes("FOREIGN KEY constraint failed")) throw new HttpError(400, "La relación seleccionada no es válida.");
      throw error;
    }
  }

  function masterDefinition(type) {
    const definition = masterDefinitions[type];
    if (!definition) throw new HttpError(404, "Módulo maestro no encontrado.");
    return definition;
  }

  function masterOptions(res, context) {
    requirePermission(context, "masters.view");
    sendJson(res, 200, {
      units: db.prepare("SELECT id, code, name, symbol FROM units_of_measure WHERE is_active = 1 ORDER BY name").all(),
      currencies: db.prepare("SELECT id, code, name, symbol FROM currencies WHERE is_active = 1 ORDER BY is_base DESC, code").all(),
      areas: db.prepare("SELECT id, code, name FROM areas WHERE is_active = 1 ORDER BY name").all(),
      employees: db.prepare("SELECT id, employee_number, full_name FROM employees WHERE status = 'active' ORDER BY full_name").all(),
      items: db.prepare("SELECT id, sku, name, item_type FROM items WHERE is_active = 1 ORDER BY name").all(),
    });
  }

  function listMaster(res, context, type) {
    const definition = masterDefinition(type);
    requirePermission(context, "masters.view");
    if (type === "employees") hr.syncVacationPlans(db);
    sendJson(res, 200, { type, records: db.prepare(definition.select).all() });
  }

  async function createMasterRecord(req, res, context, type) {
    const definition = masterDefinition(type);
    requirePermission(context, "masters.manage");
    if (definition.readOnly) throw new HttpError(405, "El personal se registra únicamente desde Recursos Humanos.");
    const body = await readJson(req);
    applyAutoPlaceholder(definition, body);
    const values = cleanCatalogValues(definition, body, false);
    validateMasterValues(type, values);
    const columns = Object.keys(values);
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = db.prepare(`INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
        .run(...columns.map((column) => values[column]));
      const id = Number(result.lastInsertRowid);
      const code = finalizeAutoCode(db, definition, id, values);
      audit(db, { userId: context.user.id, action: "masters.created", module: "masters", entityType: type, entityId: id, summary: `${definition.label} creado`, details: values, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 201, { id, code });
    } catch (error) {
      db.exec("ROLLBACK");
      handleMasterConstraint(error, definition);
    }
  }

  async function updateMasterRecord(req, res, context, type, id) {
    const definition = masterDefinition(type);
    requirePermission(context, "masters.manage");
    if (definition.readOnly) throw new HttpError(405, "El expediente de personal se administra desde Recursos Humanos.");
    if (!db.prepare(`SELECT id FROM ${definition.table} WHERE id = ?`).get(id)) throw new HttpError(404, `${definition.label} no encontrado.`);
    const values = cleanCatalogValues(definition, await readJson(req), true);
    if (definition.autoCode) delete values[definition.autoCode.field];
    validateMasterValues(type, values);
    const columns = Object.keys(values);
    if (!columns.length) throw new HttpError(400, "No hay cambios para guardar.");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE ${definition.table} SET ${columns.map((column) => `${column} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(...columns.map((column) => values[column]), id);
      audit(db, { userId: context.user.id, action: "masters.updated", module: "masters", entityType: type, entityId: id, summary: `${definition.label} actualizado`, details: values, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 200, { id });
    } catch (error) {
      db.exec("ROLLBACK");
      handleMasterConstraint(error, definition);
    }
  }

  function listPriceListItems(res, context, priceListId) {
    requirePermission(context, "masters.view");
    if (!db.prepare("SELECT id FROM price_lists WHERE id = ?").get(priceListId)) throw new HttpError(404, "Lista no encontrada.");
    const items = db.prepare(`SELECT pi.id, pi.price_list_id, pi.item_id, pi.price, pi.min_quantity,
      pi.valid_from, pi.valid_to, pi.created_at, pi.updated_at, i.sku, i.name, i.item_type
      FROM price_list_items pi JOIN items i ON i.id = pi.item_id
      WHERE pi.price_list_id = ? ORDER BY i.name, pi.min_quantity`).all(priceListId);
    sendJson(res, 200, { items });
  }

  async function createPriceListItem(req, res, context, priceListId) {
    requirePermission(context, "masters.manage");
    if (!db.prepare("SELECT id FROM price_lists WHERE id = ?").get(priceListId)) throw new HttpError(404, "Lista no encontrada.");
    const values = cleanPriceListItem(await readJson(req));
    try {
      const result = db.prepare(`INSERT INTO price_list_items (price_list_id, item_id, price, min_quantity, valid_from, valid_to)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .run(priceListId, values.itemId, values.price, values.minQuantity, values.validFrom, values.validTo);
      const id = Number(result.lastInsertRowid);
      audit(db, { userId: context.user.id, action: "price_lists.item_created", module: "masters", entityType: "price_list_item", entityId: id, summary: "Partida agregada a lista de precios", details: { priceListId, ...values }, ip: requestIp(req) });
      sendJson(res, 201, { id });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "Ese artículo y cantidad mínima ya existen en la lista.");
      if (String(error.message).includes("FOREIGN KEY constraint failed")) throw new HttpError(400, "El artículo seleccionado no es válido.");
      throw error;
    }
  }

  async function updatePriceListItem(req, res, context, priceListId, id) {
    requirePermission(context, "masters.manage");
    if (!db.prepare("SELECT id FROM price_list_items WHERE id = ? AND price_list_id = ?").get(id, priceListId)) throw new HttpError(404, "Partida no encontrada.");
    const values = cleanPriceListItem(await readJson(req));
    try {
      db.prepare(`UPDATE price_list_items SET item_id = ?, price = ?, min_quantity = ?, valid_from = ?, valid_to = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND price_list_id = ?`).run(values.itemId, values.price, values.minQuantity, values.validFrom, values.validTo, id, priceListId);
      audit(db, { userId: context.user.id, action: "price_lists.item_updated", module: "masters", entityType: "price_list_item", entityId: id, summary: "Partida de lista actualizada", details: { priceListId, ...values }, ip: requestIp(req) });
      sendJson(res, 200, { id });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "Ese artículo y cantidad mínima ya existen en la lista.");
      throw error;
    }
  }

  function deletePriceListItem(req, res, context, priceListId, id) {
    requirePermission(context, "masters.manage");
    const result = db.prepare("DELETE FROM price_list_items WHERE id = ? AND price_list_id = ?").run(id, priceListId);
    if (!result.changes) throw new HttpError(404, "Partida no encontrada.");
    audit(db, { userId: context.user.id, action: "price_lists.item_deleted", module: "masters", entityType: "price_list_item", entityId: id, summary: "Partida eliminada de lista de precios", details: { priceListId }, ip: requestIp(req) });
    sendJson(res, 200, { ok: true });
  }

  function inventoryOptions(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, inventory.inventoryOptions(db));
  }

  function inventoryOverview(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, {
      options: inventory.inventoryOptions(db),
      balances: inventory.listBalances(db),
      movements: inventory.listMovements(db),
    });
  }

  function inventoryBalances(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { balances: inventory.listBalances(db) });
  }

  function inventoryMovements(res, context, url) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { movements: inventory.listMovements(db, url.searchParams.get("type")) });
  }

  async function inventoryEntry(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.postEntry(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.entry", "Entrada de inventario registrada", result, body);
    sendJson(res, 201, result);
  }

  async function inventoryExit(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.postExit(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.exit", "Salida de inventario registrada", result, body);
    sendJson(res, 201, result);
  }

  async function inventoryTransfer(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.postTransfer(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.transfer", "Transferencia de inventario registrada", result, body);
    sendJson(res, 201, result);
  }

  async function inventoryAdjustment(req, res, context) {
    requirePermission(context, "inventory.adjust");
    const body = await readJson(req);
    const result = inventory.postAdjustment(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.adjustment", "Ajuste de inventario aprobado", result, body);
    sendJson(res, 201, result);
  }

  function inventoryReservations(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { reservations: inventory.listReservations(db) });
  }

  async function inventoryReservation(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.createReservation(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.reservation_created", "Reserva de inventario creada", result, body, "inventory_reservation");
    sendJson(res, 201, result);
  }

  function inventoryReservationAction(req, res, context, id, action) {
    requirePermission(context, "inventory.operate");
    const result = action === "release" ? inventory.releaseReservation(db, id) : inventory.consumeReservation(db, id, context.user.id);
    inventoryAudit(req, context, `inventory.reservation_${action}`, action === "release" ? "Reserva liberada" : "Reserva consumida", result, { id }, "inventory_reservation");
    sendJson(res, 200, result);
  }

  function inventoryLocations(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { locations: inventory.listLocations(db) });
  }

  async function inventoryLocationCreate(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.createLocation(db, body);
    inventoryAudit(req, context, "inventory.location_created", "Ubicación de inventario creada", result, body, "inventory_location");
    sendJson(res, 201, result);
  }

  async function inventoryLocationUpdate(req, res, context, id) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.updateLocation(db, id, body);
    inventoryAudit(req, context, "inventory.location_updated", "Ubicación de inventario actualizada", result, body, "inventory_location");
    sendJson(res, 200, result);
  }

  function inventoryLots(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { lots: inventory.listLots(db) });
  }

  async function inventoryLotCreate(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.createLot(db, body);
    inventoryAudit(req, context, "inventory.lot_created", "Lote de inventario creado", result, body, "inventory_lot");
    sendJson(res, 201, result);
  }

  async function inventoryLotUpdate(req, res, context, id) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.updateLot(db, id, body);
    inventoryAudit(req, context, "inventory.lot_updated", "Lote de inventario actualizado", result, body, "inventory_lot");
    sendJson(res, 200, result);
  }

  function inventorySerials(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { serials: inventory.listSerials(db) });
  }

  async function inventorySerialCreate(req, res, context) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.createSerial(db, body);
    inventoryAudit(req, context, "inventory.serial_created", "Serie de inventario creada", result, body, "inventory_serial");
    sendJson(res, 201, result);
  }

  async function inventorySerialUpdate(req, res, context, id) {
    requirePermission(context, "inventory.operate");
    const body = await readJson(req);
    const result = inventory.updateSerial(db, id, body);
    inventoryAudit(req, context, "inventory.serial_updated", "Serie de inventario actualizada", result, body, "inventory_serial");
    sendJson(res, 200, result);
  }

  function inventoryCounts(res, context) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, { counts: inventory.listCounts(db) });
  }

  async function inventoryCountCreate(req, res, context) {
    requirePermission(context, "inventory.count");
    const body = await readJson(req);
    const result = inventory.createCount(db, body, context.user.id);
    inventoryAudit(req, context, "inventory.count_created", "Conteo físico iniciado", result, body, "inventory_count");
    sendJson(res, 201, result);
  }

  function inventoryCountDetail(res, context, id) {
    requirePermission(context, "inventory.view");
    sendJson(res, 200, inventory.getCount(db, id));
  }

  async function inventoryCountLineUpdate(req, res, context, countId, lineId) {
    requirePermission(context, "inventory.count");
    const body = await readJson(req);
    const result = inventory.updateCountLine(db, countId, lineId, body);
    sendJson(res, 200, result);
  }

  function inventoryCountComplete(req, res, context, id) {
    requirePermission(context, "inventory.adjust");
    const result = inventory.completeCount(db, id, context.user.id);
    inventoryAudit(req, context, "inventory.count_completed", "Conteo físico cerrado y aplicado", result, { adjustments: result.adjustments }, "inventory_count");
    sendJson(res, 200, result);
  }

  function inventoryAudit(req, context, action, summary, result, details, entityType = "inventory_movement") {
    audit(db, {
      userId: context.user.id, action, module: "inventory", entityType, entityId: result.id,
      summary: result.folio ? `${summary}: ${result.folio}` : summary, details, ip: requestIp(req),
    });
  }

  function salesOptions(res, context) {
    requirePermission(context, "sales.view");
    sendJson(res, 200, sales.salesOptions(db));
  }

  function salesControl(res, context) {
    requirePermission(context, "sales.view");
    sendJson(res, 200, sales.salesControl(db));
  }

  function salesProspects(res, context) {
    requirePermission(context, "sales.view");
    sendJson(res, 200, { prospects: sales.listProspects(db) });
  }

  async function salesProspectCreate(req, res, context) {
    requirePermission(context, "sales.manage");
    const body = await readJson(req);
    const result = sales.createProspect(db, body, context.user.id);
    salesAudit(req, context, "sales.prospect_created", "Prospecto creado", result, body, "sales_prospect");
    sendJson(res, 201, result);
  }

  async function salesProspectUpdate(req, res, context, id) {
    requirePermission(context, "sales.manage");
    const body = await readJson(req);
    const result = sales.updateProspect(db, id, body);
    salesAudit(req, context, "sales.prospect_updated", "Prospecto actualizado", result, body, "sales_prospect");
    sendJson(res, 200, result);
  }

  function salesProspectConvert(req, res, context, id) {
    requirePermission(context, "sales.manage");
    const result = sales.convertProspect(db, id);
    salesAudit(req, context, "sales.prospect_converted", "Prospecto convertido en cliente", result, { customerId: result.customerId }, "sales_prospect");
    sendJson(res, 200, result);
  }

  function salesDocuments(res, context, type) {
    requirePermission(context, "sales.view");
    sendJson(res, 200, { type, documents: sales.listDocuments(db, type) });
  }

  async function salesDocumentCreate(req, res, context, type) {
    requirePermission(context, type === "invoice" ? "sales.approve" : ["delivery", "return"].includes(type) ? "sales.fulfill" : "sales.manage");
    const body = await readJson(req);
    const result = sales.createDocument(db, type, body, context.user.id);
    const label = { quote: "Cotización", order: "Pedido", delivery: "Entrega", return: "Devolución", invoice: "Factura" }[type];
    salesAudit(req, context, `sales.${type}_created`, `${label} creada`, result, body);
    sendJson(res, 201, result);
  }

  function salesDocumentDetail(res, context, id) {
    requirePermission(context, "sales.view");
    sendJson(res, 200, sales.getDocument(db, id));
  }

  async function salesDocumentAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action ?? "");
    requirePermission(context, ["accept", "confirm", "mark_paid"].includes(action) ? "sales.approve" : "sales.manage");
    const result = sales.updateDocumentStatus(db, id, action, context.user.id);
    salesAudit(req, context, `sales.document_${action}`, `Documento comercial actualizado a ${result.status}`, result, { action });
    if (result.production?.created?.length) {
      audit(db, { userId: context.user.id, action: "production.orders_from_sales", module: "production",
        entityType: "production_order", entityId: result.production.created[0].id,
        summary: `${result.production.created.length} orden(es) de trabajo generadas desde ${result.folio}`,
        details: { salesOrderId: id, salesOrderFolio: result.folio, workOrders: result.production.created }, ip: requestIp(req) });
    }
    if (result.production?.cancelled?.length) {
      audit(db, { userId: context.user.id, action: "production.orders_cancelled_from_sales", module: "production",
        entityType: "production_order", entityId: result.production.cancelled[0].id,
        summary: `${result.production.cancelled.length} orden(es) de trabajo canceladas con ${result.folio}`,
        details: { salesOrderId: id, salesOrderFolio: result.folio, workOrders: result.production.cancelled }, ip: requestIp(req) });
    }
    sendJson(res, 200, result);
  }

  function salesAudit(req, context, action, summary, result, details, entityType = "sales_document") {
    audit(db, { userId: context.user.id, action, module: "sales", entityType, entityId: result.id,
      summary: result.folio ? `${summary}: ${result.folio}` : summary, details, ip: requestIp(req) });
  }

  function productionOptions(res, context) {
    requirePermission(context, "production.view");
    sendJson(res, 200, production.options(db));
  }

  function productionControl(res, context) {
    requirePermission(context, "production.view");
    sendJson(res, 200, production.control(db));
  }

  async function productionBomCreate(req, res, context) {
    requirePermission(context, "production.manage");
    const body = await readJson(req);
    const result = production.createBom(db, body, context.user.id);
    moduleAudit(req, context, "production", "production.bom_created", "Lista de materiales creada", result, body, "production_bom");
    sendJson(res, 201, result);
  }

  async function productionRouteCreate(req, res, context) {
    requirePermission(context, "production.manage");
    const body = await readJson(req);
    const result = production.createRoute(db, body, context.user.id);
    moduleAudit(req, context, "production", "production.route_created", "Ruta de producción creada", result, body, "production_route");
    sendJson(res, 201, result);
  }

  async function productionDemandCreate(req, res, context) {
    requirePermission(context, "production.manage");
    const body = await readJson(req);
    const result = production.createDemand(db, body, context.user.id);
    moduleAudit(req, context, "production", "production.demand_created", "Demanda de producción creada", result, body, "production_demand");
    sendJson(res, 201, result);
  }

  async function productionOrderCreate(req, res, context) {
    requirePermission(context, "production.manage");
    const body = await readJson(req);
    const result = production.createOrder(db, body, context.user.id);
    moduleAudit(req, context, "production", "production.order_created", "Orden de producción creada", result, body, "production_order");
    sendJson(res, 201, result);
  }

  function productionOrderDetail(res, context, id) {
    requirePermission(context, "production.view");
    sendJson(res, 200, production.orderDetail(db, id));
  }

  async function productionOrderAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, action === "close" ? "production.close" : ["release", "cancel"].includes(action) ? "production.manage" : "production.execute");
    const result = production.orderAction(db, id, body, context.user.id);
    moduleAudit(req, context, "production", `production.order_${action}`, `Acción ${action} aplicada a producción`, result, body, "production_order");
    sendJson(res, 200, result);
  }

  function qualityOptions(res, context) {
    requirePermission(context, "quality.view");
    sendJson(res, 200, quality.options(db));
  }

  function qualityControl(res, context) {
    requirePermission(context, "quality.view");
    sendJson(res, 200, quality.control(db));
  }

  async function qualityPlanCreate(req, res, context) {
    requirePermission(context, "quality.manage");
    const body = await readJson(req);
    const result = quality.createPlan(db, body, context.user.id);
    moduleAudit(req, context, "quality", "quality.plan_created", "Plan de inspección creado", result, body, "quality_plan");
    sendJson(res, 201, result);
  }

  async function qualityInspectionCreate(req, res, context) {
    requirePermission(context, "quality.inspect");
    const body = await readJson(req);
    const result = quality.createInspection(db, body, context.user.id);
    moduleAudit(req, context, "quality", "quality.inspection_created", "Inspección creada", result, body, "quality_inspection");
    sendJson(res, 201, result);
  }

  function qualityInspectionDetail(res, context, id) {
    requirePermission(context, "quality.view");
    sendJson(res, 200, quality.inspectionDetail(db, id));
  }

  async function qualityInspectionResults(req, res, context, id) {
    requirePermission(context, "quality.inspect");
    const body = await readJson(req);
    const result = quality.recordResults(db, id, body, context.user.id);
    moduleAudit(req, context, "quality", "quality.results_recorded", "Resultados de inspección registrados", result, body, "quality_inspection");
    sendJson(res, 200, result);
  }

  async function qualityInspectionAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, action === "release" ? "quality.release" : "quality.inspect");
    const result = quality.inspectionAction(db, id, body, context.user.id);
    moduleAudit(req, context, "quality", `quality.inspection_${action}`, `Acción ${action} aplicada a inspección`, result, body, "quality_inspection");
    sendJson(res, 200, result);
  }

  async function qualityNonconformityCreate(req, res, context) {
    requirePermission(context, "quality.inspect");
    const body = await readJson(req);
    const result = quality.createNonconformity(db, body, context.user.id);
    moduleAudit(req, context, "quality", "quality.nonconformity_created", "No conformidad creada", result, body, "quality_nonconformity");
    sendJson(res, 201, result);
  }

  async function qualityCorrectiveActionCreate(req, res, context) {
    requirePermission(context, "quality.manage");
    const body = await readJson(req);
    const result = quality.createCorrectiveAction(db, body, context.user.id);
    moduleAudit(req, context, "quality", "quality.corrective_action_created", "Acción correctiva creada", result, body, "quality_corrective_action");
    sendJson(res, 201, result);
  }

  async function qualityCorrectiveActionUpdate(req, res, context, id) {
    requirePermission(context, "quality.manage");
    const body = await readJson(req);
    const result = quality.correctiveActionUpdate(db, id, body);
    moduleAudit(req, context, "quality", "quality.corrective_action_updated", "Acción correctiva actualizada", result, body, "quality_corrective_action");
    sendJson(res, 200, result);
  }

  function moduleAudit(req, context, module, action, summary, result, details, entityType) {
    audit(db, { userId: context.user.id, action, module, entityType, entityId: result.id,
      summary: result.folio ? `${summary}: ${result.folio}` : summary, details, ip: requestIp(req) });
  }

  function protectedHrAuditDetails(body, photoLabel) {
    const details = { ...body, photoBase64: body.photoBase64 ? photoLabel : "" };
    for (const key of ["baseSalary", "paymentMethod", "bankReference", "bloodType", "allergies",
      "conditions", "occupationalNotes"]) {
      if (Object.hasOwn(details, key)) details[key] = "[dato sensible restringido]";
    }
    return details;
  }

  function maintenanceOptions(res, context) {
    requirePermission(context, "maintenance.view");
    sendJson(res, 200, maintenance.options(db));
  }

  function maintenanceControl(res, context) {
    requirePermission(context, "maintenance.view");
    sendJson(res, 200, maintenance.control(db));
  }

  async function maintenanceEquipmentCreate(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.createEquipment(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.equipment_created", "Equipo registrado", result, body, "maintenance_equipment");
    sendJson(res, 201, result);
  }

  async function maintenancePlanCreate(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.createPlan(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.plan_created", "Plan preventivo creado", result, body, "maintenance_plan");
    sendJson(res, 201, result);
  }

  async function maintenanceAnnualProgramPreview(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    sendJson(res, 200, maintenance.previewAnnualProgram(db, body));
  }

  async function maintenanceAnnualProgramImport(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.importAnnualProgram(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.program_imported", "Programa anual cargado", result, { fileName: body.fileName, year: result.year, plansCreated: result.plansCreated }, "maintenance_program_import");
    sendJson(res, 201, result);
  }

  async function maintenanceSupplierCreate(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.createSupplier(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.supplier_created", "Proveedor de mantenimiento creado", result, body, "maintenance_supplier");
    sendJson(res, 201, result);
  }

  async function maintenanceRequestCreate(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.createRequest(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.request_created", "Solicitud de mantenimiento creada", result, body, "maintenance_request");
    sendJson(res, 201, result);
  }

  async function maintenanceOrderCreate(req, res, context) {
    requirePermission(context, "maintenance.manage");
    const body = await readJson(req);
    const result = maintenance.createOrder(db, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.order_created", "Orden de mantenimiento creada", result, body, "maintenance_order");
    sendJson(res, 201, result);
  }

  function maintenanceEquipmentHistory(res, context, id) {
    requirePermission(context, "maintenance.view");
    sendJson(res, 200, maintenance.equipmentHistory(db, id));
  }

  function maintenanceOrderDetail(res, context, id) {
    requirePermission(context, "maintenance.view");
    sendJson(res, 200, maintenance.orderDetail(db, id));
  }

  async function maintenanceOrderAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, action === "close" ? "maintenance.close" : ["approve", "cancel"].includes(action) ? "maintenance.manage" : "maintenance.execute");
    const result = maintenance.orderAction(db, id, body, context.user.id);
    moduleAudit(req, context, "maintenance", "maintenance.order_" + action, "Acción " + action + " aplicada a mantenimiento", result, body, "maintenance_order");
    sendJson(res, 200, result);
  }

  function logisticsOptions(res, context) {
    requirePermission(context, "logistics.view");
    sendJson(res, 200, logistics.options(db));
  }

  function logisticsControl(res, context) {
    requirePermission(context, "logistics.view");
    sendJson(res, 200, logistics.control(db));
  }

  async function logisticsCarrierCreate(req, res, context) {
    requirePermission(context, "logistics.manage");
    const body = await readJson(req);
    const result = logistics.createCarrier(db, body, context.user.id);
    moduleAudit(req, context, "logistics", "logistics.carrier_created", "Transportista registrado", result, body, "logistics_carrier");
    sendJson(res, 201, result);
  }

  async function logisticsRouteCreate(req, res, context) {
    requirePermission(context, "logistics.manage");
    const body = await readJson(req);
    const result = logistics.createRoute(db, body, context.user.id);
    moduleAudit(req, context, "logistics", "logistics.route_created", "Ruta de entrega creada", result, body, "logistics_route");
    sendJson(res, 201, result);
  }

  async function logisticsShipmentCreate(req, res, context) {
    requirePermission(context, "logistics.manage");
    const body = await readJson(req);
    const result = logistics.createShipment(db, body, context.user.id);
    moduleAudit(req, context, "logistics", "logistics.shipment_created", "Preparación de pedido iniciada", result, body, "logistics_shipment");
    sendJson(res, 201, result);
  }

  async function logisticsEvidenceCreate(req, res, context) {
    requirePermission(context, "logistics.execute");
    const body = await readJson(req);
    const result = logistics.addEvidence(db, body, context.user.id);
    moduleAudit(req, context, "logistics", "logistics.evidence_created", "Evidencia de entrega registrada", result, body, "logistics_evidence");
    sendJson(res, 201, result);
  }

  function logisticsShipmentDetail(res, context, id) {
    requirePermission(context, "logistics.view");
    sendJson(res, 200, logistics.shipmentDetail(db, id));
  }

  async function logisticsShipmentAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, action === "confirm" ? "logistics.confirm" : ["cancel", "assign_route"].includes(action) ? "logistics.manage" : "logistics.execute");
    const result = logistics.shipmentAction(db, id, body, context.user.id);
    moduleAudit(req, context, "logistics", "logistics.shipment_" + action, "Acción " + action + " aplicada al embarque", result, body, "logistics_shipment");
    sendJson(res, 200, result);
  }

  function financeOptions(res, context) {
    requirePermission(context, "finance.view");
    sendJson(res, 200, finance.options(db));
  }

  function financeControl(res, context) {
    requirePermission(context, "finance.view");
    sendJson(res, 200, finance.control(db));
  }

  async function financeCostCenterCreate(req, res, context) {
    requirePermission(context, "finance.manage");
    const body = await readJson(req);
    const result = finance.createCostCenter(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.cost_center_created", "Centro de costo creado", result, body, "finance_cost_center");
    sendJson(res, 201, result);
  }

  async function financePayableCreate(req, res, context) {
    requirePermission(context, "finance.manage");
    const body = await readJson(req);
    const result = finance.createPayable(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.payable_created", "Cuenta por pagar registrada", result, body, "finance_payable");
    sendJson(res, 201, result);
  }

  async function financeCollectionCreate(req, res, context) {
    requirePermission(context, "finance.operate");
    const body = await readJson(req);
    const result = finance.createCollection(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.collection_created", "Cobro registrado", result, body, "finance_collection");
    sendJson(res, 201, result);
  }

  async function financePaymentCreate(req, res, context) {
    requirePermission(context, "finance.operate");
    const body = await readJson(req);
    const result = finance.createPayment(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.payment_created", "Pago registrado", result, body, "finance_payment");
    sendJson(res, 201, result);
  }

  async function financeBudgetCreate(req, res, context) {
    requirePermission(context, "finance.manage");
    const body = await readJson(req);
    const result = finance.createBudget(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.budget_created", "Presupuesto creado", result, body, "finance_budget");
    sendJson(res, 201, result);
  }

  async function financeBudgetAction(req, res, context, id) {
    requirePermission(context, "finance.approve");
    const body = await readJson(req);
    const result = finance.budgetAction(db, id, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.budget_" + String(body.action || "action"), "Presupuesto actualizado", result, body, "finance_budget");
    sendJson(res, 200, result);
  }

  async function financeReconciliationCreate(req, res, context) {
    requirePermission(context, "finance.operate");
    const body = await readJson(req);
    const result = finance.createReconciliation(db, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.reconciliation_created", "Conciliación creada", result, body, "finance_reconciliation");
    sendJson(res, 201, result);
  }

  async function financeReconciliationAction(req, res, context, id) {
    requirePermission(context, "finance.approve");
    const body = await readJson(req);
    const result = finance.reconciliationAction(db, id, body, context.user.id);
    moduleAudit(req, context, "finance", "finance.reconciliation_closed", "Conciliación cerrada", result, body, "finance_reconciliation");
    sendJson(res, 200, result);
  }

  function tasksOptions(res, context) {
    requirePermission(context, "tasks.view");
    sendJson(res, 200, tasks.options(db));
  }

  function tasksControl(res, context) {
    requirePermission(context, "tasks.view");
    sendJson(res, 200, tasks.control(db, context.user.id));
  }

  async function tasksFlowCreate(req, res, context) {
    requirePermission(context, "tasks.manage");
    const body = await readJson(req);
    const result = tasks.createFlow(db, body, context.user.id);
    moduleAudit(req, context, "tasks", "tasks.flow_created", "Flujo de aprobación creado", result, body, "approval_flow");
    sendJson(res, 201, result);
  }

  function tasksFlowDetail(res, context, id) {
    requirePermission(context, "tasks.view");
    sendJson(res, 200, tasks.flowDetail(db, id));
  }

  async function taskCreate(req, res, context) {
    requirePermission(context, "tasks.manage");
    const body = await readJson(req);
    const result = tasks.createTask(db, body, context.user.id);
    moduleAudit(req, context, "tasks", "tasks.task_created", "Tarea creada", result, body, "workflow_task");
    sendJson(res, 201, result);
  }

  function taskDetail(res, context, id) {
    requirePermission(context, "tasks.view");
    sendJson(res, 200, tasks.taskDetail(db, id));
  }

  async function taskCommentCreate(req, res, context, id) {
    requirePermission(context, "tasks.operate");
    const body = await readJson(req);
    const result = tasks.addComment(db, id, body, context.user.id);
    moduleAudit(req, context, "tasks", "tasks.comment_created", "Comentario agregado a tarea", result, body, "workflow_task");
    sendJson(res, 201, result);
  }

  async function taskAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, ["approved", "rejected"].includes(action) ? "tasks.approve" : action === "cancelled" ? "tasks.manage" : "tasks.operate");
    const result = tasks.taskAction(db, id, body, context.user.id);
    moduleAudit(req, context, "tasks", "tasks.task_" + action, "Acción " + action + " aplicada a tarea", result, body, "workflow_task");
    sendJson(res, 200, result);
  }

  function purchasesOptions(res, context) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.options(db));
  }

  function purchasesControl(res, context) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.control(db));
  }

  async function purchaseRequestCreate(req, res, context) {
    requirePermission(context, "purchases.manage");
    const body = await readJson(req);
    const result = purchases.createRequest(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.request_created", "Solicitud de compra creada", result, body, "purchase_request");
    sendJson(res, 201, result);
  }

  function purchaseRequestDetail(res, context, id) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.requestDetail(db, id));
  }

  async function purchaseRequestAction(req, res, context, id) {
    const body = await readJson(req);
    const action = String(body.action || "");
    requirePermission(context, ["approve", "reject"].includes(action) ? "purchases.approve" : "purchases.manage");
    const result = purchases.requestAction(db, id, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.request_" + action, "Solicitud de compra actualizada", result, body, "purchase_request");
    sendJson(res, 200, result);
  }

  async function purchaseComparisonCreate(req, res, context) {
    requirePermission(context, "purchases.manage");
    const body = await readJson(req);
    const result = purchases.createComparison(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.comparison_created", "Comparación de proveedores creada", result, body, "purchase_comparison");
    sendJson(res, 201, result);
  }

  function purchaseComparisonDetail(res, context, id) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.comparisonDetail(db, id));
  }

  async function purchaseComparisonSelect(req, res, context, id) {
    requirePermission(context, "purchases.approve");
    const body = await readJson(req);
    const result = purchases.selectComparison(db, id, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.supplier_selected", "Proveedor seleccionado", result, body, "purchase_comparison");
    sendJson(res, 200, result);
  }

  async function purchaseOrderCreate(req, res, context) {
    requirePermission(context, "purchases.manage");
    const body = await readJson(req);
    const result = purchases.createOrder(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.order_created", "Orden de compra creada", result, body, "purchase_order");
    sendJson(res, 201, result);
  }

  function purchaseOrderDetail(res, context, id) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.orderDetail(db, id));
  }

  async function purchaseOrderAction(req, res, context, id) {
    requirePermission(context, "purchases.approve");
    const body = await readJson(req);
    const result = purchases.orderAction(db, id, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.order_" + String(body.action || "action"), "Orden de compra actualizada", result, body, "purchase_order");
    sendJson(res, 200, result);
  }

  async function purchaseReceiptCreate(req, res, context) {
    requirePermission(context, "purchases.receive");
    const body = await readJson(req);
    const result = purchases.createReceipt(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.receipt_created", "Recepción de compra registrada", result, body, "purchase_receipt");
    sendJson(res, 201, result);
  }

  function purchaseReceiptDetail(res, context, id) {
    requirePermission(context, "purchases.view");
    sendJson(res, 200, purchases.receiptDetail(db, id));
  }

  async function purchaseReturnCreate(req, res, context) {
    requirePermission(context, "purchases.receive");
    const body = await readJson(req);
    const result = purchases.createReturn(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.return_created", "Devolución a proveedor registrada", result, body, "purchase_return");
    sendJson(res, 201, result);
  }

  async function purchaseInvoiceCreate(req, res, context) {
    requirePermission(context, "purchases.receive");
    const body = await readJson(req);
    const result = purchases.createSupplierInvoice(db, body, context.user.id);
    moduleAudit(req, context, "purchases", "purchases.invoice_created", "Factura de proveedor registrada", result, body, "purchase_supplier_invoice");
    sendJson(res, 201, result);
  }

  function safetyOptions(res, context) {
    requirePermission(context, "safety.view");
    sendJson(res, 200, safety.options(db));
  }

  function safetyControl(res, context) {
    requirePermission(context, "safety.view");
    sendJson(res, 200, safety.control(db));
  }

  async function safetyIncidentCreate(req, res, context) {
    requirePermission(context, "safety.manage");
    const body = await readJson(req);
    const result = safety.createIncident(db, body, context.user.id);
    moduleAudit(req, context, "safety", "safety.incident_created", "Evento de seguridad registrado", result, body, "safety_incident");
    sendJson(res, 201, result);
  }

  async function safetyIncapacityCreate(req, res, context) {
    requirePermission(context, "safety.manage");
    const body = await readJson(req);
    const result = safety.createIncapacity(db, body, context.user.id);
    moduleAudit(req, context, "safety", "safety.incapacity_created", "Incapacidad vinculada a seguridad", result, body, "hr_leave_request");
    sendJson(res, 201, result);
  }

  async function safetyRiskCreate(req, res, context) {
    requirePermission(context, "safety.manage");
    const body = await readJson(req);
    const result = safety.createRisk(db, body, context.user.id);
    moduleAudit(req, context, "safety", "safety.risk_created", "Análisis de riesgo registrado", result, body, "safety_risk");
    sendJson(res, 201, result);
  }

  async function safetyComplianceCreate(req, res, context) {
    requirePermission(context, "safety.manage");
    const body = await readJson(req);
    const result = safety.createCompliance(db, body, context.user.id);
    moduleAudit(req, context, "safety", "safety.compliance_created", "Requisito normativo registrado", result, body, "safety_compliance");
    sendJson(res, 201, result);
  }

  async function safetyIncidentAction(req, res, context, id) {
    const body = await readJson(req);
    requirePermission(context, body.action === "close" ? "safety.approve" : "safety.operate");
    const result = safety.incidentAction(db, id, body, context.user.id);
    moduleAudit(req, context, "safety", `safety.incident_${body.action}`, "Evento de seguridad actualizado", result, body, "safety_incident");
    sendJson(res, 200, result);
  }

  async function safetyRiskAction(req, res, context, id) {
    const body = await readJson(req);
    requirePermission(context, body.action === "close" ? "safety.approve" : "safety.operate");
    const result = safety.riskAction(db, id, body);
    moduleAudit(req, context, "safety", `safety.risk_${body.action}`, "Riesgo actualizado", result, body, "safety_risk");
    sendJson(res, 200, result);
  }

  async function safetyComplianceAction(req, res, context, id) {
    requirePermission(context, "safety.approve");
    const body = await readJson(req);
    const result = safety.complianceAction(db, id, body);
    moduleAudit(req, context, "safety", `safety.compliance_${body.action}`, "Cumplimiento actualizado", result, body, "safety_compliance");
    sendJson(res, 200, result);
  }

  function hrOptions(res, context) {
    requirePermission(context, "hr.view");
    const result = hr.options(db, { managedCompanyId });
    const visible = visibleEmployeeIds(db, context.user.id);
    if (visible !== null) result.employees = result.employees.filter((row) => visible.has(Number(row.id)));
    result.laborIdentity = laborIdentityForUser(db, context.user.id);
    sendJson(res, 200, result);
  }

  function hrStructure(res, context) {
    requirePermission(context, "hr.view");
    sendJson(res, 200, { ...hr.organizationStructure(db, managedCompanyId), managedCompany: config.company });
  }

  async function hrCompanyCreate(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    if (managedCompanyId) throw new HttpError(409, "La empresa se define exclusivamente desde el Centro de Gestión.");
    const body = await readJson(req), result = hr.createCompany(db, body);
    moduleAudit(req, context, "hr", "hr.company_created", "Empresa laboral creada", result, body, "company");
    sendJson(res, 201, result);
  }

  async function hrCompanyUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    if (managedCompanyId) throw new HttpError(409, "La empresa se actualiza exclusivamente desde el Centro de Gestión.");
    const body = await readJson(req), result = hr.updateCompany(db, id, body);
    moduleAudit(req, context, "hr", "hr.company_updated", "Empresa laboral actualizada", result, body, "company");
    sendJson(res, 200, result);
  }

  async function hrWorkCenterCreate(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req), result = hr.createWorkCenter(db, body);
    moduleAudit(req, context, "hr", "hr.work_center_created", "Centro de trabajo creado", result, body, "hr_work_center");
    sendJson(res, 201, result);
  }

  async function hrWorkCenterUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req), result = hr.updateWorkCenter(db, id, body);
    moduleAudit(req, context, "hr", "hr.work_center_updated", "Centro de trabajo actualizado", result, body, "hr_work_center");
    sendJson(res, 200, result);
  }

  async function hrDepartmentCreate(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req), result = hr.createDepartment(db, body);
    moduleAudit(req, context, "hr", "hr.department_created", "Departamento creado", result, body, "hr_department");
    sendJson(res, 201, result);
  }

  async function hrDepartmentUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req), result = hr.updateDepartment(db, id, body);
    moduleAudit(req, context, "hr", "hr.department_updated", "Departamento actualizado", result, body, "hr_department");
    sendJson(res, 200, result);
  }

  function hrComplianceControl(res, context) {
    requirePermission(context, "hr.compliance.view");
    requireHrAdministrator(context);
    sendJson(res, 200, hrCompliance.control(db));
  }

  function hrGrievanceDetail(res, context, id) {
    requirePermission(context, "hr.compliance.view");
    requireHrAdministrator(context);
    sendJson(res, 200, hrCompliance.detail(db, id));
  }

  async function hrGrievanceCreate(req, res, context) {
    requirePermission(context, "hr.compliance.manage");
    requireHrAdministrator(context);
    const body = await readJson(req);
    const result = hrCompliance.createCase(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.grievance_created", "Caso confidencial registrado", result,
      { category: body.category, severity: body.severity, reporterType: body.reporterType,
        confidentiality: body.confidentiality }, "hr_grievance_case");
    sendJson(res, 201, result);
  }

  async function hrGrievanceEvidenceCreate(req, res, context, id) {
    requirePermission(context, "hr.compliance.manage");
    requireHrAdministrator(context);
    const body = await readJson(req);
    const result = hrCompliance.addEvidence(db, id, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.grievance_evidence_added", "Evidencia confidencial registrada", result,
      { evidenceType: body.evidenceType, sensitivity: body.sensitivity, hasDocument: Boolean(body.documentId) },
      "hr_grievance_evidence");
    sendJson(res, 201, result);
  }

  async function hrGrievanceAction(req, res, context, id) {
    const body = await readJson(req);
    const permission = ["resolve", "close", "reopen", "dismiss"].includes(body.action)
      ? "hr.grievances.resolve" : "hr.grievances.investigate";
    requirePermission(context, permission);
    requireHrAdministrator(context);
    const result = hrCompliance.action(db, id, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.grievance_action", "Caso confidencial actualizado", result,
      { action: body.action, nextStatus: result.status, investigatorAssigned: Boolean(body.investigatorUserId) },
      "hr_grievance_case");
    sendJson(res, 200, result);
  }

  function hrControl(res, context) {
    requirePermission(context, "hr.view");
    const now = Date.now();
    if (!hrControlSnapshot || hrControlSnapshot.expiresAt <= now) {
      hrControlSnapshot = {
        payload: hr.control(db),
        options: hr.options(db, { syncVacation: false, includeEmployees: false, managedCompanyId }),
        version: now,
        expiresAt: now + HR_CONTROL_CACHE_MS,
      };
      hrControlViews.clear();
    }
    const cachedView = hrControlViews.get(Number(context.user.id));
    if (cachedView?.snapshot === hrControlSnapshot) return sendJson(res, 200, cachedView.result);

    const payload = filterHrControl(db, context.user.id, hrControlSnapshot.payload);
    const options = { ...hrControlSnapshot.options };
    options.employees = payload.people.map((row) => ({
      id: row.id,
      employee_number: row.employee_number,
      full_name: row.full_name,
      area_id: row.area_id,
      status: row.status,
      company_id: row.company_id,
      work_center_id: row.work_center_id,
      department_id: row.department_id,
      employment_type: row.employment_type,
      vacation_balance: row.vacation_balance,
      vacation_debt: row.vacation_debt,
      vacation_available: row.vacation_available,
      vacation_cycle_year: row.vacation_cycle_year,
      vacation_plan_name: row.vacation_plan_name,
      vacation_plan_days: row.vacation_plan_days,
    }));
    const result = { ...payload, options, _controlVersion: hrControlSnapshot.version };
    hrControlViews.set(Number(context.user.id), { snapshot: hrControlSnapshot, result });
    sendJson(res, 200, result);
  }

  async function hrPersonCreate(req, res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    const body = await readJson(req);
    const photo = parseEmployeePhoto(body);
    const result = hr.createPerson(db, body, context.user.id);
    if (photo) {
      const filename = `employee-${result.id}.${photo.extension}`;
      db.prepare("UPDATE hr_employee_profiles SET photo_filename = ?, photo_mime = ?, photo_original_name = ?, photo_data = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?")
        .run(filename, photo.mime, photo.originalName, photo.bytes, result.id);
    }
    const auditBody = protectedHrAuditDetails(body, "[imagen guardada]");
    moduleAudit(req, context, "hr", "hr.person_created", "Expediente de personal creado", result, auditBody, "employee");
    sendJson(res, 201, result);
  }

  async function hrPeopleImportTemplate(res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    const data = await hrImport.employeeImportTemplate(db);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-carga-personal.xlsx"',
      "Content-Length": data.length,
      "Cache-Control": "private, no-store",
    });
    res.end(data);
  }

  async function hrPeopleImportPreview(req, res, context) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    const body = await readJson(req);
    const batch = await hrImport.previewEmployeeImport(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.people_import_preview", "Carga masiva de personal validada",
      { batchId: batch.id, totalRows: batch.totalRows, validRows: batch.validRows,
        warningRows: batch.warningRows, errorRows: batch.errorRows },
      { originalName: batch.originalName, format: batch.format }, "hr_employee_import_batch");
    sendJson(res, 201, { batch });
  }

  async function hrPeopleImportCommit(req, res, context, batchId) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    const body = await readJson(req);
    const batch = hrImport.commitEmployeeImport(db, batchId, context.user.id, {
      confirmWarnings: body.confirmWarnings === true,
    });
    moduleAudit(req, context, "hr", "hr.people_imported", "Carga masiva de personal confirmada",
      { batchId: batch.id, imported: batch.importedRows }, { originalName: batch.originalName },
      "hr_employee_import_batch");
    sendJson(res, 200, { batch });
  }

  async function hrPersonUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    assertEmployeeAccess(db, context.user.id, id, HttpError);
    const body = await readJson(req);
    const photo = parseEmployeePhoto(body);
    const result = hr.updatePerson(db, id, body, context.user.id);
    if (body.portalAccess) hrPortal.configureEmployeeAccess(db, id, body.portalAccess, context.user.id);
    if (photo) {
      const filename = `employee-${id}.${photo.extension}`;
      db.prepare("UPDATE hr_employee_profiles SET photo_filename = ?, photo_mime = ?, photo_original_name = ?, photo_data = ?, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?")
        .run(filename, photo.mime, photo.originalName, photo.bytes, id);
    } else if (body.removePhoto === true) {
      db.prepare("UPDATE hr_employee_profiles SET photo_filename = NULL, photo_mime = NULL, photo_original_name = NULL, photo_data = NULL, updated_at = CURRENT_TIMESTAMP WHERE employee_id = ?").run(id);
    }
    const auditBody = protectedHrAuditDetails(body, "[imagen actualizada]");
    moduleAudit(req, context, "hr", "hr.person_updated", "Expediente de personal actualizado", result, auditBody, "employee");
    sendJson(res, 200, result);
  }

  async function hrPersonAction(req, res, context, id) {
    requirePermission(context, "hr.manage");
    requireHrAdministrator(context);
    assertEmployeeAccess(db, context.user.id, id, HttpError);
    const body = await readJson(req);
    const result = hr.personAction(db, id, body, context.user.id);
    moduleAudit(req, context, "hr", `hr.person_${body.action}`, "Baja de trabajador registrada", result, body, "employee");
    sendJson(res, 200, result);
  }

  async function hrJobPositionCreate(req, res, context) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.createJobPosition(db, body);
    moduleAudit(req, context, "hr", "hr.job_position_created", "Puesto de personal creado", result, body, "hr_job_position");
    sendJson(res, 201, result);
  }

  async function hrJobPositionUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.updateJobPosition(db, id, body);
    moduleAudit(req, context, "hr", "hr.job_position_updated", "Puesto de personal actualizado", result, body, "hr_job_position");
    sendJson(res, 200, result);
  }

  async function hrWorkShiftCreate(req, res, context) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.createWorkShift(db, body);
    moduleAudit(req, context, "hr", "hr.work_shift_created", "Turno de personal creado", result, body, "hr_work_shift");
    sendJson(res, 201, result);
  }

  async function hrWorkShiftUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.updateWorkShift(db, id, body);
    moduleAudit(req, context, "hr", "hr.work_shift_updated", "Turno de personal actualizado", result, body, "hr_work_shift");
    sendJson(res, 200, result);
  }

  async function hrVacationPlanCreate(req, res, context) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.createVacationPlan(db, body);
    moduleAudit(req, context, "hr", "hr.vacation_plan_created", "Plan de vacaciones creado", result, body, "hr_vacation_plan");
    sendJson(res, 201, result);
  }

  async function hrVacationPlanUpdate(req, res, context, id) {
    requirePermission(context, "hr.manage");
    const body = await readJson(req);
    const result = hr.updateVacationPlan(db, id, body);
    moduleAudit(req, context, "hr", "hr.vacation_plan_updated", "Plan de vacaciones actualizado", result, body, "hr_vacation_plan");
    sendJson(res, 200, result);
  }

  async function hrPersonPhoto(res, context, id) {
    requirePermission(context, "hr.view");
    assertEmployeeAccess(db, context.user.id, id, HttpError);
    const profile = db.prepare("SELECT photo_filename, photo_mime, photo_data FROM hr_employee_profiles WHERE employee_id = ?").get(id);
    if (!profile?.photo_filename) throw new HttpError(404, "El trabajador no tiene fotografía.");
    let data = profile.photo_data;
    if (!data) {
      const filename = basename(profile.photo_filename);
      try {
        data = await readFile(join(config.dataDir, "hr-photos", filename));
      } catch (error) {
        if (error.code === "ENOENT") throw new HttpError(404, "La fotografía no está disponible.");
        throw error;
      }
    }
    res.writeHead(200, {
      "Content-Type": profile.photo_mime || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "private, max-age=300",
    });
    res.end(data);
  }

  function payrollControl(res, context, searchParams) {
    requirePermission(context, "payroll.view");
    const incidents = db.prepare(`SELECT i.*, l.folio, e.employee_number, e.full_name AS employee_name,
      (SELECT pp.status FROM payroll_preparation_incidents pi
       JOIN payroll_preparation_lines pl ON pl.id = pi.preparation_line_id
       JOIN payroll_preparations pp ON pp.id = pl.preparation_id
       WHERE pi.incident_id = i.id ORDER BY pp.id DESC LIMIT 1) AS preparation_status
      FROM hr_payroll_incidents i JOIN hr_leave_requests l ON l.id = i.leave_request_id
      JOIN employees e ON e.id = i.employee_id ORDER BY i.created_at DESC, i.id DESC`).all();
    const cfdi = payrollCfdi.control(db);
    const preparation = payrollPreparation.control(db, searchParams?.get("periodId"));
    sendJson(res, 200, {
      incidents,
      preparation,
      cfdi: { ...cfdi, storageProvider: privateStorage.provider },
      indicators: {
        pending: incidents.filter((row) => row.status === "pending").length,
        processed: incidents.filter((row) => row.status === "processed").length,
        included: incidents.filter((row) => row.preparation_status).length,
      },
    });
  }

  async function payrollPreparationGenerate(req, res, context) {
    requirePermission(context, "payroll.manage");
    const body = await readJson(req);
    const result = payrollPreparation.generate(db, body.periodId, context.user.id);
    moduleAudit(req, context, "payroll", "payroll.preparation_generated", "Prenómina calculada",
      { preparationId: result.preparation?.id, periodId: result.selectedPeriod?.id, employees: result.totals.employees },
      { periodId: body.periodId }, "payroll_preparation");
    sendJson(res, 200, result);
  }

  async function payrollPreparationLineUpdate(req, res, context, id) {
    requirePermission(context, "payroll.manage");
    const body = await readJson(req);
    const line = payrollPreparation.updateLine(db, id, body, context.user.id);
    moduleAudit(req, context, "payroll", "payroll.preparation_line_updated", "Línea de prenómina actualizada",
      { lineId: line.id, employeeId: line.employee_id, netPay: line.net_pay }, body, "payroll_preparation_line");
    sendJson(res, 200, { line });
  }

  async function payrollPreparationFinalize(req, res, context) {
    requirePermission(context, "payroll.approve");
    const body = await readJson(req);
    const result = payrollPreparation.finalize(db, body.preparationId, context.user.id);
    moduleAudit(req, context, "payroll", "payroll.preparation_finalized", "Prenómina finalizada",
      { preparationId: result.preparation?.id, periodId: result.selectedPeriod?.id, netPay: result.totals.netPay },
      {}, "payroll_preparation");
    sendJson(res, 200, result);
  }

  async function payrollPeriodCreate(req, res, context) {
    requirePermission(context, "payroll.manage");
    const body = await readJson(req);
    const period = payrollCfdi.createPeriod(db, body, context.user.id);
    moduleAudit(req, context, "payroll", "payroll.period_created", "Periodo de n\u00f3mina creado", period, body, "payroll_period");
    sendJson(res, 201, { period });
  }

  async function payrollCfdiImport(req, res, context) {
    requirePermission(context, "payroll.manage");
    assertCfdiPermission(context);
    const body = await readJson(req, CFDI_JSON_LIMIT);
    const receipt = await payrollCfdi.importReceipt(db, privateStorage, body, context.user.id,
      config.company?.slug || config.databaseSchema || "abicorp");
    moduleAudit(req, context, "payroll", "payroll.cfdi_imported", "CFDI de n\u00f3mina importado",
      { id: receipt.id, uuid: receipt.uuid, associationStatus: receipt.association_status },
      { periodId: body.periodId || null, hasPdf: Boolean(body.pdf) }, "payroll_cfdi_receipt");
    sendJson(res, 201, { receipt });
  }

  function payrollCfdiDetail(res, context, id) {
    requirePermission(context, "payroll.view");
    const receipt = payrollCfdi.receiptById(db, id);
    assertCfdiPermission(context, receipt);
    payrollCfdi.recordAccess(db, { receiptId: receipt.id, employeeId: receipt.employee_id,
      userId: context.user.id, action: "consult" });
    sendJson(res, 200, { receipt });
  }

  async function payrollCfdiAssociate(req, res, context, id) {
    requirePermission(context, "payroll.manage");
    assertCfdiPermission(context);
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const receipt = payrollCfdi.associateReceipt(db, id, body.employeeId, body.reason, context.user.id);
    moduleAudit(req, context, "payroll", "payroll.cfdi_associated", "CFDI asociado manualmente",
      { id: receipt.id, uuid: receipt.uuid, employeeId: receipt.employee_id }, body, "payroll_cfdi_receipt");
    sendJson(res, 200, { receipt });
  }

  async function payrollCfdiFileDownload(req, res, context, receiptId, fileId) {
    requirePermission(context, "payroll.view");
    const receipt = payrollCfdi.receiptById(db, receiptId);
    assertCfdiPermission(context, receipt);
    const file = payrollCfdi.receiptFile(db, receiptId, fileId);
    const data = await readPrivateFile(file);
    payrollCfdi.recordAccess(db, { receiptId, fileId, employeeId: receipt.employee_id,
      userId: context.user.id, action: "download", fileName: file.original_name, ip: requestIp(req) });
    sendPrivateFile(res, file, data);
  }

  async function hrLeavePreview(req, res, context) {
    requirePermission(context, "hr.view");
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    sendJson(res, 200, hr.previewLeave(db, body));
  }

  async function hrLeaveCreate(req, res, context) {
    requirePermission(context, "hr.operate");
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const result = hr.createLeave(db, body, context.user.id);
    db.prepare("UPDATE hr_leave_requests SET request_origin = 'hr_direct' WHERE id = ?").run(result.id);
    hrPortal.notify(db, Number(body.employeeId), "Ausencia registrada por Recursos Humanos",
      `Recursos Humanos registr\u00f3 ${result.folio} en tu historial.`, "info", "hr_leave_request", result.id, context.user.id);
    moduleAudit(req, context, "hr", "hr.leave_created", "Solicitud de ausencia creada", result, body, "hr_leave_request");
    sendJson(res, 201, { ...result, receipt: hr.leaveReceipt(db, result.id) });
  }

  function hrLeavePrint(req, res, context, id) {
    requirePermission(context, "hr.view");
    const leave = db.prepare("SELECT employee_id FROM hr_leave_requests WHERE id = ?").get(id);
    if (!leave) throw new HttpError(404, "Solicitud no encontrada.");
    assertEmployeeAccess(db, context.user.id, leave.employee_id, HttpError);
    const receipt = hr.recordLeavePrint(db, id, context.user.id, requestIp(req));
    moduleAudit(req, context, "hr", "hr.leave_receipt_printed", "Comprobante de ausencia emitido",
      { id, folio: receipt.request.folio }, { printCount: receipt.printCount }, "hr_leave_request");
    sendJson(res, 200, { receipt });
  }

  async function hrAttendanceCreate(req, res, context) {
    requirePermission(context, "hr.operate");
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const result = hr.createAttendance(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.attendance_created", "Entrada o salida registrada", result, body, "hr_attendance");
    sendJson(res, 201, result);
  }

  function hrSchedulesControl(res, context, url) {
    requirePermission(context, "hr.view");
    const payload = hrSchedules.control(db, url.searchParams.get("periodId"), url.searchParams.get("startDate"));
    const visible = visibleEmployeeIds(db, context.user.id);
    if (visible !== null) {
      payload.entries = payload.entries.filter((row) => visible.has(Number(row.employee_id)));
      payload.automaticEntries = payload.automaticEntries.filter((row) => visible.has(Number(row.employee_id)));
      payload.comparisons = payload.comparisons.filter((row) => visible.has(Number(row.employee_id)));
      payload.corrections = payload.corrections.filter((row) => visible.has(Number(row.employee_id)));
    }
    sendJson(res, 200, payload);
  }

  async function hrSchedulePeriodCreate(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req);
    const result = hrSchedules.createPeriod(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_period_created", "Periodo semanal creado", result, body, "hr_schedule_period");
    sendJson(res, 201, result);
  }

  function hrScheduleApplyDefault(req, res, context, periodId) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const result = hrSchedules.applyDefaultShifts(db, periodId, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_defaults_applied", "Turnos predeterminados aplicados", result, { periodId }, "hr_schedule_version");
    sendJson(res, 200, result);
  }

  function hrScheduleCopyPrevious(req, res, context, periodId) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const result = hrSchedules.copyPreviousWeek(db, periodId, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_previous_copied", "Semana anterior copiada", result, { periodId }, "hr_schedule_version");
    sendJson(res, 200, result);
  }

  async function hrScheduleImport(req, res, context, periodId) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req);
    const result = await hrSchedules.importSchedule(db, periodId, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_imported", "Horarios programados importados", result,
      { originalName: body.originalName, imported: result.imported, errorCount: result.errors.length }, "hr_schedule_import_batch");
    sendJson(res, 200, result);
  }

  async function hrScheduleEntrySave(req, res, context, versionId) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const result = hrSchedules.saveScheduledEntry(db, versionId, body);
    moduleAudit(req, context, "hr", "hr.schedule_entry_saved", "Horario programado guardado", result, body, "hr_scheduled_shift");
    sendJson(res, 200, result);
  }

  function hrSchedulePublish(req, res, context, versionId) {
    requirePermission(context, "hr.approve"); requireHrAdministrator(context);
    const result = hrSchedules.publishVersion(db, versionId, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_published", "Versión de horarios publicada", result, { versionId }, "hr_schedule_version");
    sendJson(res, 200, result);
  }

  async function hrActualShiftCapture(req, res, context) {
    requirePermission(context, "hr.operate");
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const result = hrSchedules.captureActual(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.actual_shift_captured", "Horario real capturado", result, body, "hr_actual_shift_version");
    sendJson(res, 201, result);
  }

  async function hrActualShiftImport(req, res, context) {
    requirePermission(context, "hr.manage"); requireHrAdministrator(context);
    const body = await readJson(req);
    const result = await hrSchedules.importActual(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.actual_shifts_imported", "Horarios reales importados", result,
      { originalName: body.originalName, imported: result.imported, errorCount: result.errors.length }, "hr_schedule_import_batch");
    sendJson(res, 200, result);
  }

  async function hrScheduleCorrectionCreate(req, res, context) {
    requirePermission(context, "hr.operate");
    const body = await readJson(req);
    assertEmployeeAccess(db, context.user.id, body.employeeId, HttpError);
    const result = hrSchedules.requestCorrection(db, body, context.user.id);
    moduleAudit(req, context, "hr", "hr.schedule_correction_requested", "Corrección de horario solicitada", result, body, "hr_schedule_correction");
    sendJson(res, 201, result);
  }

  async function hrScheduleCorrectionAction(req, res, context, id) {
    requirePermission(context, "hr.approve"); requireHrAdministrator(context);
    const body = await readJson(req);
    const correction = db.prepare("SELECT employee_id FROM hr_schedule_corrections WHERE id = ?").get(id);
    if (correction) assertEmployeeAccess(db, context.user.id, correction.employee_id, HttpError);
    const result = hrSchedules.correctionAction(db, id, body, context.user.id);
    moduleAudit(req, context, "hr", `hr.schedule_correction_${body.action}`, "Corrección de horario atendida", result, body, "hr_schedule_correction");
    sendJson(res, 200, result);
  }

  async function hrLeaveAction(req, res, context, id) {
    const body = await readJson(req);
    requirePermission(context, ["approve", "reject"].includes(body.action) ? "hr.approve" : "hr.operate");
    const leave = db.prepare("SELECT employee_id FROM hr_leave_requests WHERE id = ?").get(id);
    if (leave) assertEmployeeAccess(db, context.user.id, leave.employee_id, HttpError);
    const identity = laborIdentityForUser(db, context.user.id);
    if (["approve", "reject"].includes(body.action) && identity && identity.identityType !== "manager")
      throw new HttpError(403, "Solamente el Administrador RH puede aprobar o rechazar solicitudes.");
    const result = hr.leaveAction(db, id, body, context.user.id);
    const portalMessages = {
      approve: ["Solicitud aprobada", `Tu solicitud ${result.folio} fue aprobada.`],
      reject: ["Solicitud rechazada", `Tu solicitud ${result.folio} fue rechazada: ${body.reason || "Consulta a Recursos Humanos."}`],
      cancel: ["Solicitud cancelada", `La solicitud ${result.folio} fue cancelada.`],
      close: ["Solicitud cerrada", `La solicitud ${result.folio} fue cerrada.`],
    };
    if (portalMessages[body.action]) hrPortal.notify(db, leave.employee_id, ...portalMessages[body.action],
      body.action === "approve" ? "success" : body.action === "reject" ? "warning" : "info",
      "hr_leave_request", id, context.user.id);
    moduleAudit(req, context, "hr", `hr.leave_${body.action}`, "Solicitud de ausencia actualizada", result, body, "hr_leave_request");
    sendJson(res, 200, result);
  }

  function listAreas(res, context) {
    requireAnyPermission(context, ["areas.view", "hr.view"]);
    const areas = db.prepare(`SELECT a.id, a.code, a.name, a.description, a.is_active, a.created_at,
      COUNT(ua.user_id) AS users_count FROM areas a LEFT JOIN user_areas ua ON ua.area_id = a.id
      GROUP BY a.id ORDER BY a.name COLLATE NOCASE`).all();
    sendJson(res, 200, { areas });
  }

  async function createArea(req, res, context) {
    requireAnyPermission(context, ["areas.manage", "hr.approve"]);
    const body = await readJson(req);
    const code = cleanText(body.code, 30)?.toUpperCase();
    const name = cleanText(body.name, 120);
    const description = cleanOptionalText(body.description, 500) ?? "";
    if (!code || !/^[A-Z0-9_-]{2,30}$/.test(code) || !name) throw new HttpError(400, "Captura un código y nombre válidos.");
    try {
      const result = db.prepare("INSERT INTO areas (code, name, description) VALUES (?, ?, ?)").run(code, name, description);
      const id = Number(result.lastInsertRowid);
      audit(db, { userId: context.user.id, action: "areas.created", module: "areas", entityType: "area", entityId: id, summary: `Área ${name} creada`, ip: requestIp(req) });
      sendJson(res, 201, { area: db.prepare("SELECT * FROM areas WHERE id = ?").get(id), id, folio: code });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "El código de área ya existe.");
      throw error;
    }
  }

  async function updateArea(req, res, context, id) {
    requireAnyPermission(context, ["areas.manage", "hr.approve"]);
    const existing = db.prepare("SELECT * FROM areas WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Área no encontrada.");
    const body = await readJson(req);
    const name = cleanText(body.name, 120);
    const description = cleanOptionalText(body.description, 500) ?? "";
    const isActive = body.isActive === false ? 0 : 1;
    if (!name) throw new HttpError(400, "Captura el nombre del área.");
    db.prepare("UPDATE areas SET name = ?, description = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(name, description, isActive, id);
    audit(db, { userId: context.user.id, action: "areas.updated", module: "areas", entityType: "area", entityId: id, summary: `Área ${existing.code} actualizada`, ip: requestIp(req) });
    sendJson(res, 200, { area: db.prepare("SELECT * FROM areas WHERE id = ?").get(id), id, folio: existing.code });
  }

  function listAudit(res, context, url) {
    requirePermission(context, "audit.view");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const limit = Math.min(500, Math.max(10, Number(url.searchParams.get("limit") ?? 30)));
    const offset = (page - 1) * limit;
    const logs = db.prepare(`SELECT a.id, a.action, a.module, a.entity_type, a.entity_id, a.summary,
      a.details_json, a.ip_address, a.created_at, u.full_name, u.username
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ? OFFSET ?`).all(limit, offset);
    const total = db.prepare("SELECT COUNT(*) AS value FROM audit_logs").get().value;
    sendJson(res, 200, { logs, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }

  function listFolios(res, context) {
    requirePermission(context, "folios.view");
    const folios = db.prepare(`SELECT f.id, f.document_type, f.prefix, f.current_value, f.padding, f.branch_id,
      f.reset_period, f.last_reset_key, f.is_active, f.created_at, f.updated_at, b.name AS branch_name
      FROM folio_sequences f LEFT JOIN branches b ON b.id = f.branch_id ORDER BY f.document_type`).all();
    sendJson(res, 200, { folios: folios.map((folio) => ({ ...folio, preview: formatFolio(folio, folio.current_value + 1) })) });
  }

  async function createFolio(req, res, context) {
    requirePermission(context, "folios.manage");
    const values = cleanFolioValues(await readJson(req));
    try {
      const result = db.prepare(`INSERT INTO folio_sequences
        (document_type, prefix, current_value, padding, branch_id, reset_period, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(values.documentType, values.prefix, values.currentValue, values.padding, values.branchId, values.resetPeriod, values.isActive);
      const id = Number(result.lastInsertRowid);
      audit(db, { userId: context.user.id, action: "folios.created", module: "folios", entityType: "folio_sequence", entityId: id, summary: `Consecutivo ${values.documentType} creado`, details: values, ip: requestIp(req) });
      sendJson(res, 201, { id });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "Ya existe un consecutivo para ese documento y sucursal.");
      throw error;
    }
  }

  async function updateFolio(req, res, context, id) {
    requirePermission(context, "folios.manage");
    const existing = db.prepare("SELECT id FROM folio_sequences WHERE id = ?").get(id);
    if (!existing) throw new HttpError(404, "Consecutivo no encontrado.");
    const values = cleanFolioValues(await readJson(req));
    try {
      db.prepare(`UPDATE folio_sequences SET document_type = ?, prefix = ?, current_value = ?, padding = ?,
        branch_id = ?, reset_period = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .run(values.documentType, values.prefix, values.currentValue, values.padding, values.branchId, values.resetPeriod, values.isActive, id);
      audit(db, { userId: context.user.id, action: "folios.updated", module: "folios", entityType: "folio_sequence", entityId: id, summary: `Consecutivo ${values.documentType} actualizado`, details: values, ip: requestIp(req) });
      sendJson(res, 200, { id });
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, "Ya existe un consecutivo para ese documento y sucursal.");
      throw error;
    }
  }

  async function nextFolio(req, res, context, id) {
    requirePermission(context, "folios.manage");
    db.exec("BEGIN IMMEDIATE");
    try {
      const folio = db.prepare("SELECT * FROM folio_sequences WHERE id = ? AND is_active = 1").get(id);
      if (!folio) throw new HttpError(404, "Consecutivo activo no encontrado.");
      const resetKey = folioResetKey(folio.reset_period);
      let current = Number(folio.current_value);
      if (resetKey && folio.last_reset_key !== resetKey) current = 0;
      const next = current + 1;
      db.prepare("UPDATE folio_sequences SET current_value = ?, last_reset_key = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(next, resetKey, id);
      const value = formatFolio(folio, next);
      audit(db, { userId: context.user.id, action: "folios.issued", module: "folios", entityType: "folio_sequence", entityId: id, summary: `Folio ${value} emitido`, details: { value }, ip: requestIp(req) });
      db.exec("COMMIT");
      sendJson(res, 200, { value, currentValue: next });
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  function listDocuments(res, context, url) {
    requirePermission(context, "documents.view");
    const requestedEmployeeId = url?.searchParams?.get("employeeId");
    const employeeId = requestedEmployeeId == null || requestedEmployeeId === ""
      ? null : Number(requestedEmployeeId);
    if (employeeId != null && (!Number.isInteger(employeeId) || employeeId <= 0))
      throw new HttpError(400, "El colaborador solicitado no es válido.");
    if (employeeId != null) assertEmployeeAccess(db, context.user.id, employeeId, HttpError);
    const documents = db.prepare(`SELECT d.id, d.module, d.entity_type, d.entity_id, d.original_name, d.mime_type,
      d.size_bytes, d.description, d.sensitivity, d.employee_id, d.document_type_id, d.issue_date,
      d.expiry_date, d.version_number, d.replaces_document_id, d.is_current, d.created_at,
      u.full_name AS uploaded_by_name, e.employee_number, e.full_name AS employee_name,
      dt.code AS document_type_code, dt.name AS document_type_name
      FROM documents d
      LEFT JOIN users u ON u.id = d.uploaded_by
      LEFT JOIN employees e ON e.id = d.employee_id
      LEFT JOIN hr_document_types dt ON dt.id = d.document_type_id
      WHERE d.deleted_at IS NULL AND (? IS NULL OR d.employee_id = ?)
      ORDER BY d.id DESC LIMIT 200`).all(employeeId, employeeId);
    const identity = laborIdentityForUser(db, context.user.id);
    const allowedDocuments = documents.filter((document) =>
      (!document.employee_id || canAccessEmployee(db, context.user.id, document.employee_id))
      && canAccessSensitiveDocument(identity, document.sensitivity));
    const documentTypes = db.prepare(`SELECT id, code, name, sensitivity, required_for_active,
      requires_issue_date, requires_expiry_date, allows_expiry_date
      FROM hr_document_types WHERE is_active = 1 ORDER BY name`).all()
      .filter((type) => canAccessSensitiveDocument(identity, type.sensitivity));
    const employees = db.prepare(`SELECT id, employee_number, full_name FROM employees
      ORDER BY status = 'active' DESC, full_name`).all()
      .filter((employee) => canAccessEmployee(db, context.user.id, employee.id));
    sendJson(res, 200, { documents: allowedDocuments, documentTypes, employees });
  }

  async function uploadDocument(req, res, context) {
    requirePermission(context, "documents.manage");
    const body = await readJson(req);
    const originalName = basename(cleanText(body.originalName, 240));
    const module = cleanText(body.module, 50).toLowerCase();
    const description = cleanOptionalText(body.description, 500) ?? "";
    const entityType = cleanOptionalText(body.entityType, 80);
    const entityId = cleanOptionalText(body.entityId, 80);
    const employeeId = body.employeeId == null || body.employeeId === "" ? null : Number(body.employeeId);
    const documentTypeId = body.documentTypeId == null || body.documentTypeId === ""
      ? null : Number(body.documentTypeId);
    if (documentTypeId != null && !Number.isInteger(documentTypeId))
      throw new HttpError(400, "El tipo documental no es válido.");
    const documentType = documentTypeId == null ? null
      : db.prepare("SELECT * FROM hr_document_types WHERE id = ? AND is_active = 1").get(documentTypeId);
    if (documentTypeId != null && !documentType) throw new HttpError(400, "El tipo documental no existe o está inactivo.");
    const sensitivity = documentType?.sensitivity || String(body.sensitivity ?? "standard").trim().toLowerCase();
    const issueDate = cleanOptionalDate(body.issueDate, "fecha de emisión");
    const expiryDate = cleanOptionalDate(body.expiryDate, "fecha de vencimiento");
    const mimeType = cleanText(body.mimeType, 120) || "application/octet-stream";
    if (!["standard", "fiscal", "salary", "cfdi", "medical"].includes(sensitivity))
      throw new HttpError(400, "La clasificaci\u00f3n del documento no es v\u00e1lida.");
    if (employeeId && !Number.isInteger(employeeId)) throw new HttpError(400, "El trabajador del documento no es v\u00e1lido.");
    if (employeeId && !documentType) throw new HttpError(400, "Selecciona la clasificación del documento del trabajador.");
    if (documentType?.requires_issue_date && !issueDate)
      throw new HttpError(400, "La fecha de emisión es obligatoria para este tipo documental.");
    if (documentType?.requires_expiry_date && !expiryDate)
      throw new HttpError(400, "La fecha de vencimiento es obligatoria para este tipo documental.");
    if (expiryDate && documentType && !documentType.allows_expiry_date)
      throw new HttpError(400, "Este tipo documental no maneja fecha de vencimiento.");
    if (issueDate && expiryDate && expiryDate < issueDate)
      throw new HttpError(400, "La fecha de vencimiento no puede ser anterior a la emisión.");
    if (employeeId) assertEmployeeAccess(db, context.user.id, employeeId, HttpError);
    const identity = laborIdentityForUser(db, context.user.id);
    if (!canAccessSensitiveDocument(identity, sensitivity))
      throw new HttpError(403, "No tienes autorizaci\u00f3n para cargar esta clase de documento sensible.");
    if (!originalName || !module || !/^[a-z0-9_-]+$/.test(module)) throw new HttpError(400, "Captura un archivo y módulo válidos.");
    let bytes;
    try { bytes = Buffer.from(String(body.contentBase64 ?? ""), "base64"); }
    catch { throw new HttpError(400, "El archivo no tiene un formato válido."); }
    if (!bytes.length) throw new HttpError(400, "El archivo está vacío.");
    if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, "El archivo supera el límite de 8 MB.");
    const extension = extname(originalName).replace(/[^.a-zA-Z0-9]/g, "").slice(0, 12).toLowerCase();
    const storedName = `${createOpaqueToken(18)}${extension}`;
    const storagePath = `database:${storedName}`;
    const checksum = createHash("sha256").update(bytes).digest("hex");
    let id;
    db.exec("BEGIN IMMEDIATE");
    try {
      const previous = employeeId && documentTypeId ? db.prepare(`SELECT id, version_number FROM documents
        WHERE employee_id = ? AND document_type_id = ? AND is_current = 1 AND deleted_at IS NULL
        ORDER BY version_number DESC, id DESC LIMIT 1`).get(employeeId, documentTypeId) : null;
      const versionNumber = Number(previous?.version_number || 0) + 1;
      if (previous) db.prepare("UPDATE documents SET is_current = 0 WHERE id = ?").run(previous.id);
      const result = db.prepare(`INSERT INTO documents
        (module, entity_type, entity_id, original_name, stored_name, mime_type, size_bytes, storage_path, checksum,
         description, uploaded_by, content_data, sensitivity, employee_id, document_type_id, issue_date,
         expiry_date, version_number, replaces_document_id, is_current)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(module, entityType, entityId, originalName, storedName, mimeType, bytes.length, storagePath, checksum,
          description, context.user.id, bytes, sensitivity, employeeId, documentTypeId, issueDate,
          expiryDate, versionNumber, previous?.id || null);
      id = Number(result.lastInsertRowid);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(db, { userId: context.user.id, action: "documents.uploaded", module: "documents", entityType: "document", entityId: id, summary: `Documento ${originalName} cargado`, details: { module, entityType, entityId, sizeBytes: bytes.length }, ip: requestIp(req) });
    sendJson(res, 201, { id });
  }

  function getDocument(req, res, context, id) {
    requirePermission(context, "documents.view");
    const document = documentRecord(id);
    assertDocumentAccess(context, document);
    recordDocumentAccess(req, context, document, "consult");
    const { content_data: _content, storage_path: _storage, ...safeDocument } = document;
    const accessLog = context.user.permissions.includes("documents.manage") ? db.prepare(`SELECT l.id, l.action,
      l.document_name, l.sensitivity, l.ip_address, l.created_at, u.full_name AS user_name
      FROM hr_document_access_log l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.document_id = ? ORDER BY l.id DESC LIMIT 100`).all(id) : [];
    sendJson(res, 200, { document: safeDocument, accessLog });
  }

  async function downloadDocument(req, res, context, id) {
    requirePermission(context, "documents.view");
    const document = documentRecord(id);
    assertDocumentAccess(context, document);
    try {
      const data = document.content_data || await readFile(document.storage_path);
      recordDocumentAccess(req, context, document, "download");
      res.writeHead(200, {
        "Content-Type": document.mime_type,
        "Content-Length": data.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.original_name)}`,
        "Cache-Control": "private, no-store",
      });
      res.end(data);
    } catch (error) {
      if (error.code === "ENOENT") throw new HttpError(410, "El archivo físico ya no está disponible.");
      throw error;
    }
  }

  async function deleteDocument(req, res, context, id) {
    requirePermission(context, "documents.manage");
    const document = documentRecord(id);
    assertDocumentAccess(context, document);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(`UPDATE documents SET is_current = 0, deleted_at = CURRENT_TIMESTAMP, deleted_by = ?
        WHERE id = ?`).run(context.user.id, id);
      if (document.is_current && document.replaces_document_id)
        db.prepare("UPDATE documents SET is_current = 1 WHERE id = ? AND deleted_at IS NULL").run(document.replaces_document_id);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    audit(db, { userId: context.user.id, action: "documents.deleted", module: "documents", entityType: "document", entityId: id, summary: `Documento ${document.original_name} eliminado`, ip: requestIp(req) });
    sendJson(res, 200, { ok: true });
  }

  function documentRecord(id) {
    const document = db.prepare(`SELECT d.*, dt.code AS document_type_code, dt.name AS document_type_name,
      e.employee_number, e.full_name AS employee_name, u.full_name AS uploaded_by_name
      FROM documents d
      LEFT JOIN hr_document_types dt ON dt.id = d.document_type_id
      LEFT JOIN employees e ON e.id = d.employee_id
      LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.id = ? AND d.deleted_at IS NULL`).get(id);
    if (!document) throw new HttpError(404, "Documento no encontrado.");
    return document;
  }

  function assertDocumentAccess(context, document) {
    if (document.employee_id) assertEmployeeAccess(db, context.user.id, document.employee_id, HttpError);
    if (!canAccessSensitiveDocument(laborIdentityForUser(db, context.user.id), document.sensitivity))
      throw new HttpError(403, "No tienes autorización para consultar este documento sensible.");
  }

  function recordDocumentAccess(req, context, document, action) {
    db.prepare(`INSERT INTO hr_document_access_log
      (document_id, employee_id, user_id, action, document_name, sensitivity, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(document.id, document.employee_id, context.user.id, action, document.original_name,
        document.sensitivity, requestIp(req));
  }

  function getSettings(res, context) {
    requirePermission(context, "settings.view");
    const settings = Object.fromEntries(db.prepare("SELECT key, value, value_type, description, updated_at FROM app_settings ORDER BY key").all().map((row) => [row.key, row]));
    sendJson(res, 200, { settings, managedCompany: config.company });
  }

  async function updateSettings(req, res, context) {
    requirePermission(context, "settings.manage");
    const body = await readJson(req);
    if (Object.prototype.hasOwnProperty.call(body, "company_name"))
      throw new HttpError(409, "El nombre de la empresa se administra exclusivamente desde el Centro de Gestión.");
    const allowed = ["timezone", "session_hours"];
    const update = db.prepare("UPDATE app_settings SET value = ?, updated_by = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?");
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const key of allowed) {
        if (!(key in body)) continue;
        const value = cleanText(body[key], 120);
        if (!value) throw new HttpError(400, `El valor de ${key} no es válido.`);
        if (key === "session_hours" && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 72))
          throw new HttpError(400, "La sesión debe durar entre 1 y 72 horas.");
        update.run(value, context.user.id, key);
      }
      audit(db, { userId: context.user.id, action: "settings.updated", module: "settings", entityType: "settings", summary: "Configuración general actualizada", ip: requestIp(req) });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    getSettings(res, context);
  }

  function listNotifications(res, context) {
    requirePermission(context, "notifications.view");
    const notifications = db.prepare(`SELECT id, title, message, type, is_read, created_at, read_at
      FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30`).all(context.user.id);
    sendJson(res, 200, { notifications });
  }

  async function createNotification(req, res, context) {
    requirePermission(context, "notifications.manage");
    const body = await readJson(req);
    const title = cleanText(body.title, 140);
    const message = cleanText(body.message, 1000);
    const type = ["info", "success", "warning", "error"].includes(body.type) ? body.type : "info";
    let userIds = cleanIds(body.userIds);
    if (body.allActive === true) userIds = db.prepare("SELECT id FROM users WHERE status = 'active'").all().map((user) => user.id);
    if (!title || !message) throw new HttpError(400, "Captura título y mensaje.");
    if (!userIds.length) throw new HttpError(400, "Selecciona al menos un destinatario.");
    const validIds = new Set(db.prepare(`SELECT id FROM users WHERE status = 'active'`).all().map((user) => user.id));
    userIds = userIds.filter((id) => validIds.has(id));
    if (!userIds.length) throw new HttpError(400, "No hay destinatarios activos válidos.");
    db.exec("BEGIN IMMEDIATE");
    try {
      const insert = db.prepare("INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)");
      for (const userId of userIds) insert.run(userId, title, message, type);
      audit(db, { userId: context.user.id, action: "notifications.sent", module: "notifications", entityType: "notification", summary: `Notificación enviada a ${userIds.length} usuario(s)`, details: { title, type, userIds }, ip: requestIp(req) });
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    sendJson(res, 201, { recipients: userIds.length });
  }

  function readNotification(res, context, id) {
    const result = db.prepare(`UPDATE notifications SET is_read = 1, read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?`).run(id, context.user.id);
    if (!result.changes) throw new HttpError(404, "Notificación no encontrada.");
    sendJson(res, 200, { ok: true });
  }

  return {
    handle,
    db,
    dbPath,
    hasUsername,
    matchesCredentials,
    recordLoginFailure,
    hasActiveSessionToken,
    loginWithCredentials: (req, res, body) => login(req, res, body),
    syncManagedCompany,
    close: () => db.close(),
  };
}

function applyAutoPlaceholder(definition, body) {
  if (!definition.autoCode) return;
  body[definition.autoCode.field] = `AUTO_${createOpaqueToken(8).toUpperCase()}`;
}

function finalizeAutoCode(db, definition, id, values) {
  if (!definition.autoCode) return null;
  const { field, prefix, source, prefixes } = definition.autoCode;
  const selectedPrefix = prefix ?? prefixes?.[values[source]];
  if (!selectedPrefix) throw new HttpError(400, "No se pudo determinar el prefijo automático del registro.");
  const code = `${selectedPrefix}${String(id).padStart(5, "0")}`;
  db.prepare(`UPDATE ${definition.table} SET ${field} = ? WHERE id = ?`).run(code, id);
  values[field] = code;
  return code;
}

function cleanCatalogValues(definition, body, partial) {
  const values = {};
  for (const [field, rules] of Object.entries(definition.fields)) {
    const provided = Object.hasOwn(body, field);
    if (!provided && partial) continue;
    let value = provided ? body[field] : rules.default;
    if (["text", "code", "color", "email"].includes(rules.type)) {
      value = cleanText(value ?? "", rules.max ?? 500);
      if (rules.type === "code") value = value.toUpperCase();
      if (rules.type === "code" && value && !/^[A-Z0-9_-]+$/.test(value)) throw new HttpError(400, `El campo ${field} contiene caracteres no válidos.`);
      if (rules.type === "color" && !/^#[0-9A-Fa-f]{6}$/.test(value)) throw new HttpError(400, `El color de ${field} no es válido.`);
      if (rules.type === "email" && value && !/^\S+@\S+\.\S+$/.test(value)) throw new HttpError(400, `El correo de ${field} no es válido.`);
    } else if (rules.type === "boolean") {
      value = value === true || value === 1 || value === "1" ? 1 : 0;
    } else if (rules.type === "id" || rules.type === "integer") {
      value = Number(value);
      if (!Number.isInteger(value) || value < (rules.min ?? 1) || (rules.maxValue != null && value > rules.maxValue))
        throw new HttpError(400, `El valor de ${field} no es válido.`);
    } else if (rules.type === "nullable_id") {
      if (value === "" || value == null || Number(value) === 0) value = null;
      else {
        value = Number(value);
        if (!Number.isInteger(value) || value < 1) throw new HttpError(400, `El valor de ${field} no es válido.`);
      }
    } else if (rules.type === "number") {
      value = Number(value);
      if (!Number.isFinite(value) || value < (rules.min ?? Number.NEGATIVE_INFINITY) || (rules.maxValue != null && value > rules.maxValue)) throw new HttpError(400, `El valor de ${field} no es válido.`);
    } else if (rules.type === "enum") {
      value = String(value ?? rules.default ?? "");
      if (!rules.values.includes(value)) throw new HttpError(400, `El valor de ${field} no es válido.`);
    } else if (rules.type === "date") {
      value = value ? String(value) : null;
      if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, `La fecha de ${field} no es válida.`);
    }
    if (rules.required && (value === "" || value == null)) throw new HttpError(400, `El campo ${field} es obligatorio.`);
    values[field] = value;
  }
  return values;
}

function validateMasterValues(type, values) {
  if (type === "items" && values.max_stock > 0 && values.min_stock > values.max_stock)
    throw new HttpError(400, "La existencia mínima no puede superar la máxima.");
  if (type === "resources" && values.resource_type === "personnel" && !values.employee_id)
    throw new HttpError(400, "Un recurso de personal debe estar vinculado a un empleado.");
  if (values.valid_from && values.valid_to && values.valid_from > values.valid_to)
    throw new HttpError(400, "La fecha final no puede ser anterior a la fecha inicial.");
}

function handleMasterConstraint(error, definition) {
  if (error instanceof HttpError) throw error;
  if (String(error.message).includes("UNIQUE constraint failed")) throw new HttpError(409, `Ya existe un registro con ese código en ${definition.label.toLowerCase()}.`);
  if (String(error.message).includes("FOREIGN KEY constraint failed")) throw new HttpError(400, "Una de las relaciones seleccionadas no es válida.");
  throw error;
}

function cleanPriceListItem(body) {
  const itemId = Number(body.itemId);
  const price = Number(body.price);
  const minQuantity = Number(body.minQuantity ?? 1);
  const validFrom = body.validFrom ? String(body.validFrom) : null;
  const validTo = body.validTo ? String(body.validTo) : null;
  if (!Number.isInteger(itemId) || itemId < 1) throw new HttpError(400, "Selecciona un artículo válido.");
  if (!Number.isFinite(price) || price < 0) throw new HttpError(400, "El precio no es válido.");
  if (!Number.isFinite(minQuantity) || minQuantity <= 0) throw new HttpError(400, "La cantidad mínima debe ser mayor que cero.");
  if (validFrom && !/^\d{4}-\d{2}-\d{2}$/.test(validFrom)) throw new HttpError(400, "La fecha inicial no es válida.");
  if (validTo && !/^\d{4}-\d{2}-\d{2}$/.test(validTo)) throw new HttpError(400, "La fecha final no es válida.");
  if (validFrom && validTo && validFrom > validTo) throw new HttpError(400, "La fecha final no puede ser anterior a la inicial.");
  return { itemId, price, minQuantity, validFrom, validTo };
}

function cleanFolioValues(body) {
  const documentType = cleanText(body.documentType, 80).toUpperCase();
  const prefix = cleanText(body.prefix, 30).toUpperCase();
  const currentValue = Number(body.currentValue ?? 0);
  const padding = Number(body.padding ?? 6);
  const branchId = body.branchId ? Number(body.branchId) : null;
  const resetPeriod = ["none", "year", "month"].includes(body.resetPeriod) ? body.resetPeriod : "none";
  const isActive = body.isActive === false ? 0 : 1;
  if (!documentType || !/^[A-Z0-9_-]+$/.test(documentType)) throw new HttpError(400, "El tipo de documento no es válido.");
  if (prefix && !/^[A-Z0-9_/-]+$/.test(prefix)) throw new HttpError(400, "El prefijo no es válido.");
  if (!Number.isInteger(currentValue) || currentValue < 0) throw new HttpError(400, "El consecutivo actual no es válido.");
  if (!Number.isInteger(padding) || padding < 1 || padding > 12) throw new HttpError(400, "La longitud debe estar entre 1 y 12.");
  if (branchId != null && (!Number.isInteger(branchId) || branchId < 1)) throw new HttpError(400, "La sucursal no es válida.");
  return { documentType, prefix, currentValue, padding, branchId, resetPeriod, isActive };
}

function folioResetKey(period) {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  if (period === "year") return year;
  if (period === "month") return `${year}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  return null;
}

function formatFolio(folio, value) {
  return `${folio.prefix ?? ""}${String(value).padStart(Number(folio.padding), "0")}`;
}

function assignIds(db, table, ownerColumn, targetColumn, ownerId, ids) {
  const insert = db.prepare(`INSERT INTO ${table} (${ownerColumn}, ${targetColumn}) VALUES (?, ?)`);
  for (const id of ids) insert.run(ownerId, id);
}

async function readJson(req, limit = JSON_LIMIT) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, "La solicitud es demasiado grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "El contenido enviado no es JSON válido.");
  }
}

function sendJson(res, status, body) {
  if (res.headersSent) return;
  const data = Buffer.from(JSON.stringify(body));
  const acceptsGzip = /(?:^|,)\s*gzip\s*(?:,|$)/i.test(String(res.abicorpRequest?.headers?.["accept-encoding"] ?? ""));
  if (acceptsGzip && data.length >= JSON_COMPRESSION_THRESHOLD) {
    const compressed = gzipSync(data, { level: 6 });
    if (compressed.length < data.length) {
      const vary = String(res.getHeader("Vary") ?? "");
      res.setHeader("Vary", vary ? `${vary}, Accept-Encoding` : "Accept-Encoding");
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        "Content-Length": compressed.length,
      });
      return res.end(compressed);
    }
  }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

function portalSessionCookie(token, maxAgeSeconds) {
  return `erp_portal_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

function clearPortalSessionCookie() {
  return "erp_portal_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0";
}

function portalCanAccessDocument(session, sensitivity) {
  if (sensitivity === "salary") return Boolean(session.can_view_salary);
  if (sensitivity === "cfdi") return Boolean(session.can_view_cfdi);
  if (sensitivity === "medical") return Boolean(session.can_view_medical);
  return Boolean(session.can_view_file);
}

async function serveStatic(req, res, pathname) {
  if (!["GET", "HEAD"].includes(req.method ?? "GET")) throw new HttpError(405, "Método no permitido.");
  const requested = pathname === "/" ? "index.html" : pathname === "/portal" ? "portal.html" : pathname.slice(1);
  const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
  let filePath = join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) throw new HttpError(404, "Archivo no encontrado.");
  try {
    const data = await readFile(filePath);
    const mime = ({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".ico": "image/x-icon" })[extname(filePath)] ?? "application/octet-stream";
    const extension = extname(filePath);
    const cacheControl = [".html", ".js", ".css"].includes(extension) ? "no-cache" : "public, max-age=3600";
    res.writeHead(200, { "Content-Type": mime, "Content-Length": data.length, "Cache-Control": cacheControl });
    if (req.method === "HEAD") return res.end();
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT" && !extname(pathname)) {
      filePath = join(PUBLIC_DIR, "index.html");
      const data = await readFile(filePath);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": data.length, "Cache-Control": "no-cache" });
      return res.end(data);
    }
    if (error.code === "ENOENT") throw new HttpError(404, "Archivo no encontrado.");
    throw error;
  }
}

function setSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'");
}

function setLocalDevelopmentCors(req, res) {
  const origin = String(req.headers.origin ?? "");
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Company-Slug");
  res.setHeader("Vary", "Origin");
}

function requestIp(req) {
  return String(req.socket?.remoteAddress ?? "").slice(0, 80);
}

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, max);
}

function cleanOptionalText(value, max) {
  const clean = cleanText(value, max);
  return clean || null;
}

function cleanOptionalDate(value, label) {
  const clean = cleanText(value, 10);
  if (!clean) return null;
  const parsed = new Date(`${clean}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(clean) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== clean)
    throw new HttpError(400, `La ${label} no es válida.`);
  return clean;
}

function parseEmployeePhoto(body) {
  if (!body.photoBase64) return null;
  if (typeof body.photoBase64 !== "string") throw new HttpError(400, "La fotografía no es válida.");
  const mime = String(body.photoMime || "").toLowerCase();
  const extensions = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[mime];
  if (!extension) throw new HttpError(400, "La fotografía debe ser JPG, PNG o WebP.");
  const raw = body.photoBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  if (!raw || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new HttpError(400, "La fotografía no es válida.");
  const bytes = Buffer.from(raw, "base64");
  if (!bytes.length || bytes.length > MAX_EMPLOYEE_PHOTO_BYTES) throw new HttpError(413, "La fotografía no puede superar 3 MB.");
  const valid = mime === "image/png"
    ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mime === "image/jpeg"
      ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (!valid) throw new HttpError(400, "El contenido de la fotografía no coincide con su formato.");
  return {
    bytes,
    mime,
    extension,
    originalName: basename(cleanText(body.photoName, 200) || `foto.${extension}`),
  };
}

function cleanIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
}

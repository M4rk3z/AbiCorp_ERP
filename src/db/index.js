import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../core/security.js";
import { basePermissions, baseRoles, migrations } from "./schema.js";
import { PostgresDatabaseSync, isPostgresProvider } from "./postgres-sync.js";
import { postgresSchemaName } from "./postgres-sql.js";

export function openDatabase({
  dataDir,
  databasePath = null,
  databaseProvider = null,
  databaseUrl = null,
  databaseSchema = null,
  company = null,
  initialAdminUser,
  initialAdminPassword,
  seedAdmin = true,
}) {
  const usePostgres = isPostgresProvider({ databaseProvider });
  const dbPath = databasePath ? resolve(databasePath) : resolve(dataDir, "abicorp-erp.db");
  const schema = postgresSchemaName(databaseSchema ?? company?.slug ?? "abicorp");
  if (!usePostgres) mkdirSync(dirname(dbPath), { recursive: true });
  const db = usePostgres
    ? new PostgresDatabaseSync({ connectionString: databaseUrl ?? process.env.DATABASE_URL, schema })
    : new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  applyMigrations(db, { usePostgres });
  seedCore(db, { initialAdminUser, initialAdminPassword, seedAdmin });
  return { db, dbPath: usePostgres ? `postgres:${schema}` : dbPath };
}

export function synchronizeManagedCompanyIdentity(db, company) {
  const legalName = String(company?.legalName ?? company?.legal_name ?? "").trim();
  if (!legalName) return null;
  const tradeName = String(company?.tradeName ?? company?.trade_name ?? legalName).trim() || legalName;
  const code = String(company?.code ?? "").trim().toUpperCase();
  const stored = db.prepare("SELECT value FROM app_settings WHERE key = 'managed_company_id'").get();
  let record = stored?.value
    ? db.prepare("SELECT id, code FROM companies WHERE id = ?").get(Number(stored.value))
    : null;
  if (!record && code) record = db.prepare("SELECT id, code FROM companies WHERE UPPER(code) = ?").get(code);
  if (!record) record = db.prepare(`SELECT id, code FROM companies
    WHERE LOWER(legal_name) = LOWER(?) OR LOWER(trade_name) = LOWER(?) ORDER BY id LIMIT 1`)
    .get(legalName, tradeName);
  if (!record) {
    // Una base de empresa puede contener una identidad laboral previa con otro
    // nombre. Reutilizamos la que ya sostiene más relaciones para conservar IDs,
    // expedientes, centros y departamentos al adoptar el nombre del Gestor.
    record = db.prepare(`SELECT c.id, c.code,
      ((SELECT COUNT(*) FROM employees e WHERE e.company_id = c.id) +
       (SELECT COUNT(*) FROM hr_work_centers wc WHERE wc.company_id = c.id) +
       (SELECT COUNT(*) FROM hr_departments d WHERE d.company_id = c.id)) AS related_count
      FROM companies c ORDER BY related_count DESC, c.id LIMIT 1`).get();
  }
  if (!record) {
    let internalCode = code || "EMP-GESTOR";
    let suffix = 1;
    while (db.prepare("SELECT id FROM companies WHERE UPPER(code) = UPPER(?)").get(internalCode))
      internalCode = `${code || "EMP-GESTOR"}-${++suffix}`;
    const result = db.prepare(`INSERT INTO companies (code, legal_name, trade_name, tax_id, is_active)
      VALUES (?, ?, ?, '', 1)`).run(internalCode, legalName, tradeName);
    record = { id: Number(result.lastInsertRowid), code: internalCode };
  } else {
    db.prepare(`UPDATE companies SET legal_name = ?, trade_name = ?, is_active = 1,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(legalName, tradeName, record.id);
  }
  db.prepare(`INSERT INTO app_settings (key, value, value_type, description, updated_at)
    VALUES ('managed_company_id', ?, 'number', 'Empresa laboral vinculada al Centro de Gestión', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`)
    .run(String(record.id));
  db.prepare(`INSERT INTO app_settings (key, value, value_type, description, updated_at)
    VALUES ('company_name', ?, 'string', 'Nombre definido desde el Centro de Gestión', CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, description = excluded.description,
      updated_at = CURRENT_TIMESTAMP`).run(tradeName);
  return Number(record.id);
}

function applyMigrations(db, { usePostgres = false } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
  const record = db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)");
  for (const migration of migrations) {
    if (applied.get(migration.version)) continue;
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const statement of migration.statements) {
        if (usePostgres && /^\s*CREATE\s+TRIGGER\b/i.test(statement)) continue;
        db.exec(statement);
      }
      record.run(migration.version, migration.name);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (usePostgres) installPostgresFinanceTriggers(db);
}

function installPostgresFinanceTriggers(db) {
  db.exec(`
    CREATE OR REPLACE FUNCTION abicorp_sync_invoice_receivable()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW.document_type <> 'invoice' THEN
        RETURN NEW;
      END IF;
      INSERT INTO finance_receivables
        (folio, invoice_id, customer_id, currency_id, original_amount, paid_amount,
         issue_date, due_date, status, notes)
      VALUES
        ('CXC-' || LPAD(NEW.id::text, 6, '0'), NEW.id, NEW.customer_id, NEW.currency_id,
         NEW.total, CASE WHEN NEW.payment_status = 'paid' THEN NEW.total ELSE 0 END,
         NEW.issue_date, NEW.due_date,
         CASE WHEN NEW.status = 'cancelled' THEN 'cancelled'
              WHEN NEW.payment_status = 'paid' THEN 'paid' ELSE 'pending' END,
         'Generada automáticamente desde ' || NEW.folio)
      ON CONFLICT(invoice_id) DO UPDATE SET
        original_amount = EXCLUDED.original_amount,
        paid_amount = CASE WHEN NEW.payment_status = 'paid'
          THEN EXCLUDED.original_amount ELSE finance_receivables.paid_amount END,
        due_date = EXCLUDED.due_date,
        status = CASE
          WHEN NEW.status = 'cancelled' THEN 'cancelled'
          WHEN NEW.payment_status = 'paid' THEN 'paid'
          WHEN finance_receivables.paid_amount > 0 THEN 'partial'
          ELSE 'pending'
        END,
        updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$;
    DROP TRIGGER IF EXISTS trg_finance_invoice_receivable ON sales_documents;
    DROP TRIGGER IF EXISTS trg_finance_invoice_payment_status ON sales_documents;
    CREATE TRIGGER trg_finance_invoice_receivable
      AFTER UPDATE OF total, payment_status, status ON sales_documents
      FOR EACH ROW EXECUTE FUNCTION abicorp_sync_invoice_receivable();
  `);
}

function seedCore(db, { initialAdminUser, initialAdminPassword, seedAdmin }) {
  const insertRole = db.prepare(`INSERT OR IGNORE INTO roles (code, name, level, description, is_system)
    VALUES (?, ?, ?, ?, 1)`);
  const insertPermission = db.prepare(`INSERT OR IGNORE INTO permissions (code, module, action, description)
    VALUES (?, ?, ?, ?)`);
  const insertRolePermission = db.prepare(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id)
    SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
    WHERE r.code = ? AND p.code = ?`);

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const role of baseRoles) insertRole.run(...role);
    for (const permission of basePermissions) insertPermission.run(...permission);

    db.prepare("UPDATE permissions SET min_level = 1 WHERE action = 'view'").run();
    db.prepare("UPDATE permissions SET min_level = 2 WHERE code IN ('catalogs.manage', 'folios.manage', 'documents.manage', 'masters.manage', 'inventory.operate', 'inventory.count', 'sales.manage', 'sales.fulfill', 'production.manage', 'production.execute', 'quality.manage', 'quality.inspect', 'maintenance.manage', 'maintenance.execute', 'logistics.manage', 'logistics.execute', 'finance.manage', 'finance.operate', 'tasks.manage', 'tasks.operate', 'purchases.manage', 'purchases.receive', 'safety.manage', 'safety.operate', 'hr.manage', 'hr.operate', 'hr.compliance.manage', 'hr.grievances.investigate', 'payroll.manage', 'payroll.operate')").run();
    db.prepare("UPDATE permissions SET min_level = 3 WHERE module = 'workflow' OR code IN ('inventory.adjust', 'sales.approve', 'production.close', 'quality.release', 'maintenance.close', 'logistics.confirm', 'finance.approve', 'tasks.approve', 'purchases.approve', 'safety.approve', 'hr.approve', 'hr.grievances.resolve', 'payroll.approve')").run();
    db.prepare("UPDATE permissions SET min_level = 4 WHERE code IN ('users.manage', 'roles.manage', 'notifications.manage', 'settings.manage')").run();

    for (const permission of basePermissions) insertRolePermission.run("ADMIN", permission[0]);
    for (const code of ["dashboard.view", "users.view", "roles.view", "areas.view", "catalogs.view", "folios.view", "documents.view", "notifications.view", "audit.view", "settings.view", "workflow.validate", "workflow.approve", "workflow.close", "masters.view", "masters.manage", "inventory.view", "inventory.operate", "inventory.count", "inventory.adjust", "sales.view", "sales.manage", "sales.fulfill", "sales.approve", "production.view", "production.manage", "production.execute", "production.close", "quality.view", "quality.manage", "quality.inspect", "quality.release", "maintenance.view", "maintenance.manage", "maintenance.execute", "maintenance.close", "logistics.view", "logistics.manage", "logistics.execute", "logistics.confirm", "finance.view", "finance.manage", "finance.operate", "finance.approve", "tasks.view", "tasks.manage", "tasks.operate", "tasks.approve", "purchases.view", "purchases.manage", "purchases.approve", "purchases.receive", "safety.view", "safety.manage", "safety.operate", "safety.approve", "hr.view", "hr.manage", "hr.operate", "hr.approve"])
      insertRolePermission.run("SUPERVISOR", code);
    for (const code of ["dashboard.view", "areas.view", "catalogs.view", "folios.view", "documents.view", "documents.manage", "notifications.view", "masters.view", "masters.manage", "inventory.view", "inventory.operate", "inventory.count", "sales.view", "sales.manage", "sales.fulfill", "production.view", "production.manage", "production.execute", "quality.view", "quality.manage", "quality.inspect", "maintenance.view", "maintenance.manage", "maintenance.execute", "logistics.view", "logistics.manage", "logistics.execute", "finance.view", "finance.manage", "finance.operate", "tasks.view", "tasks.manage", "tasks.operate", "purchases.view", "purchases.manage", "purchases.receive", "safety.view", "safety.manage", "safety.operate", "hr.view", "hr.manage", "hr.operate"])
      insertRolePermission.run("OPERATIVO", code);
    for (const code of ["dashboard.view", "catalogs.view", "folios.view", "documents.view", "notifications.view", "masters.view", "inventory.view", "sales.view", "production.view", "quality.view", "maintenance.view", "logistics.view", "finance.view", "tasks.view", "purchases.view", "safety.view", "hr.view"])
      insertRolePermission.run("CONSULTA", code);

    const existingAdmin = seedAdmin
      ? db.prepare("SELECT id FROM users WHERE username = ?").get(initialAdminUser)
      : null;
    if (seedAdmin && !existingAdmin) {
      const user = db.prepare(`INSERT INTO users (username, full_name, email, password_hash, must_change_password)
        VALUES (?, 'Administrador del sistema', NULL, ?, 1)`)
        .run(initialAdminUser, hashPassword(initialAdminPassword));
      db.prepare(`INSERT INTO user_roles (user_id, role_id)
        SELECT ?, id FROM roles WHERE code = 'ADMIN'`).run(user.lastInsertRowid);
      db.prepare(`INSERT INTO audit_logs (user_id, action, module, entity_type, entity_id, summary)
        VALUES (?, 'system.seed', 'core', 'user', ?, 'Usuario administrador inicial creado')`)
        .run(user.lastInsertRowid, String(user.lastInsertRowid));
    }

    const setting = db.prepare(`INSERT OR IGNORE INTO app_settings (key, value, value_type, description)
      VALUES (?, ?, ?, ?)`);
    setting.run("company_name", "Abicorp", "string", "Nombre mostrado en la aplicación");
    setting.run("timezone", "America/Chicago", "string", "Zona horaria de operación");
    setting.run("session_hours", "8", "number", "Duración de una sesión");

    const unit = db.prepare(`INSERT OR IGNORE INTO units_of_measure (code, name, symbol, decimals) VALUES (?, ?, ?, ?)`);
    for (const row of [["PZA", "Pieza", "pza", 0], ["KG", "Kilogramo", "kg", 3], ["M", "Metro", "m", 3], ["L", "Litro", "L", 3], ["HR", "Hora", "h", 2]]) unit.run(...row);
    const currency = db.prepare(`INSERT OR IGNORE INTO currencies (code, name, symbol, exchange_rate, is_base) VALUES (?, ?, ?, ?, ?)`);
    currency.run("MXN", "Peso mexicano", "$", 1, 1);
    currency.run("USD", "Dólar estadounidense", "US$", 1, 0);
    const state = db.prepare(`INSERT OR IGNORE INTO document_states (code, name, description, color, sequence, is_terminal) VALUES (?, ?, ?, ?, ?, ?)`);
    const workflowStates = [
      ["BORRADOR", "Borrador", "Documento en preparación", "#68736d", 10, 0],
      ["REGISTRADO", "Registrado", "Documento registrado formalmente", "#3974a7", 20, 0],
      ["EN_REVISION", "En revisión", "Pendiente de validación", "#b47b28", 30, 0],
      ["APROBADO", "Aprobado", "Autorizado para continuar", "#278058", 40, 0],
      ["EN_EJECUCION", "En ejecución", "Operación en proceso", "#6554a3", 50, 0],
      ["TERMINADO", "Terminado", "Operación terminada", "#207a72", 60, 0],
      ["CERRADO", "Cerrado", "Documento cerrado", "#17231e", 70, 1],
      ["RECHAZADO", "Rechazado", "No autorizado", "#b54f4a", 80, 1],
      ["PAUSADO", "Pausado", "Operación temporalmente detenida", "#9a6b25", 90, 0],
      ["CANCELADO", "Cancelado", "Operación cancelada", "#8a4744", 100, 1],
      ["REABIERTO", "Reabierto", "Documento habilitado nuevamente", "#47758f", 110, 0],
    ];
    for (const row of workflowStates) state.run(...row);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function audit(db, { userId = null, action, module, entityType = null, entityId = null, summary, details = null, ip = null }) {
  db.prepare(`INSERT INTO audit_logs
    (user_id, action, module, entity_type, entity_id, summary, details_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(userId, action, module, entityType, entityId == null ? null : String(entityId), summary,
      details ? JSON.stringify(details) : null, ip);
}

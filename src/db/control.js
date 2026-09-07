import { mkdirSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../core/security.js";
import { PostgresDatabaseSync, isPostgresProvider } from "./postgres-sync.js";

export function openControlDatabase({
  dataDir,
  controlUser = "admin",
  controlPassword = "admin",
  legacyDatabasePath = null,
  seedControlAdmin = true,
  mustChangeControlPassword = false,
  databaseProvider = null,
  databaseUrl = null,
} = {}) {
  const usePostgres = isPostgresProvider({ databaseProvider });
  const root = resolve(dataDir ?? "./data");
  const dbPath = resolve(root, "abicorp-control.db");
  if (!usePostgres) {
    mkdirSync(dirname(dbPath), { recursive: true });
    mkdirSync(resolve(root, "companies"), { recursive: true });
  }
  const db = usePostgres
    ? new PostgresDatabaseSync({
        connectionString: databaseUrl ?? process.env.DATABASE_URL,
        schema: "control",
      })
    : new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS control_admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      full_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked')),
      must_change_password INTEGER NOT NULL DEFAULT 0 CHECK (must_change_password IN (0, 1)),
      failed_login_count INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS control_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      control_admin_id INTEGER NOT NULL REFERENCES control_admins(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      csrf_token TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      revoked_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      slug TEXT NOT NULL UNIQUE COLLATE NOCASE,
      legal_name TEXT NOT NULL,
      trade_name TEXT,
      database_file TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_modules (
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      module_key TEXT NOT NULL,
      max_level INTEGER NOT NULL DEFAULT 4 CHECK (max_level BETWEEN 1 AND 4),
      PRIMARY KEY (company_id, module_key)
    );
    CREATE TABLE IF NOT EXISTS company_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      tenant_user_id INTEGER NOT NULL,
      username TEXT NOT NULL COLLATE NOCASE,
      full_name TEXT NOT NULL,
      email TEXT,
      status TEXT NOT NULL,
      module_access_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (company_id, tenant_user_id),
      UNIQUE (company_id, username)
    );
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT NOT NULL,
      description TEXT,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom')),
      price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
      currency_code TEXT NOT NULL DEFAULT 'MXN',
      grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
      trial_days INTEGER NOT NULL DEFAULT 0 CHECK (trial_days BETWEEN 0 AND 365),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      created_by INTEGER REFERENCES control_admins(id),
      updated_by INTEGER REFERENCES control_admins(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company_id INTEGER NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL,
      plan_name TEXT NOT NULL,
      billing_cycle TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom')),
      recurring_amount REAL NOT NULL DEFAULT 0 CHECK (recurring_amount >= 0),
      currency_code TEXT NOT NULL DEFAULT 'MXN',
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('trial', 'active', 'past_due', 'suspended', 'canceled')),
      starts_on TEXT NOT NULL,
      next_billing_on TEXT,
      ends_on TEXT,
      grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 365),
      notes TEXT,
      suspended_at TEXT,
      canceled_at TEXT,
      created_by INTEGER REFERENCES control_admins(id),
      updated_by INTEGER REFERENCES control_admins(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subscription_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscription_id INTEGER NOT NULL REFERENCES company_subscriptions(id) ON DELETE RESTRICT,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      folio TEXT NOT NULL UNIQUE,
      concept TEXT NOT NULL,
      period_start TEXT,
      period_end TEXT,
      due_on TEXT NOT NULL,
      amount REAL NOT NULL CHECK (amount > 0),
      paid_amount REAL NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
      currency_code TEXT NOT NULL DEFAULT 'MXN',
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'partial', 'paid', 'overdue', 'void')),
      notes TEXT,
      voided_at TEXT,
      voided_by INTEGER REFERENCES control_admins(id),
      created_by INTEGER REFERENCES control_admins(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS subscription_collections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      charge_id INTEGER NOT NULL REFERENCES subscription_charges(id) ON DELETE CASCADE,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      amount REAL NOT NULL CHECK (amount > 0),
      collected_on TEXT NOT NULL,
      payment_method TEXT NOT NULL,
      reference TEXT,
      notes TEXT,
      recorded_by INTEGER REFERENCES control_admins(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS control_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      control_admin_id INTEGER REFERENCES control_admins(id),
      company_id INTEGER REFERENCES companies(id),
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      summary TEXT NOT NULL,
      details_json TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS company_storage_deletions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_file TEXT NOT NULL UNIQUE,
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_control_sessions_token ON control_sessions(token_hash, expires_at);
    CREATE INDEX IF NOT EXISTS idx_company_users_company ON company_users(company_id, status);
    CREATE INDEX IF NOT EXISTS idx_subscription_plans_status ON subscription_plans(status, name);
    CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON company_subscriptions(status, next_billing_on);
    CREATE INDEX IF NOT EXISTS idx_subscription_charges_company ON subscription_charges(company_id, status, due_on);
    CREATE INDEX IF NOT EXISTS idx_subscription_collections_charge ON subscription_collections(charge_id, collected_on);
  `);
  const subscriptionColumns = new Set(db.prepare("PRAGMA table_info(company_subscriptions)").all()
    .map((column) => String(column.name)));
  if (!subscriptionColumns.has("plan_id"))
    db.exec("ALTER TABLE company_subscriptions ADD COLUMN plan_id INTEGER REFERENCES subscription_plans(id) ON DELETE SET NULL");
  if (!subscriptionColumns.has("is_demo"))
    db.exec("ALTER TABLE company_subscriptions ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1))");
  if (!subscriptionColumns.has("demo_duration_hours"))
    db.exec("ALTER TABLE company_subscriptions ADD COLUMN demo_duration_hours INTEGER CHECK (demo_duration_hours IN (12, 24, 72))");
  if (!subscriptionColumns.has("demo_expires_at"))
    db.exec("ALTER TABLE company_subscriptions ADD COLUMN demo_expires_at TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_company_subscriptions_plan ON company_subscriptions(plan_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_company_subscriptions_demo_expiry ON company_subscriptions(is_demo, demo_expires_at)");
  const administrator = db.prepare("SELECT id FROM control_admins ORDER BY id LIMIT 1").get();
  if (seedControlAdmin && !administrator) {
    db.prepare(`INSERT INTO control_admins
      (username, full_name, password_hash, must_change_password)
      VALUES (?, 'Administrador del Centro de Gestión', ?, ?)`)
      .run(controlUser, hashPassword(controlPassword), mustChangeControlPassword ? 1 : 0);
  }

  const company = db.prepare("SELECT id FROM companies ORDER BY id LIMIT 1").get();
  if (!company) {
    const legacy = resolve(legacyDatabasePath ?? resolve(root, "abicorp-erp.db"));
    const result = db.prepare(`INSERT INTO companies
      (code, slug, legal_name, trade_name, database_file)
      VALUES ('ABICORP', 'abicorp', 'ABICORP', 'ABICORP', ?)`)
      .run(relative(root, legacy).split(sep).join("/"));
    return {
      db,
      dbPath: usePostgres ? "postgres:control" : dbPath,
      dataDir: root,
      initialCompanyId: Number(result.lastInsertRowid),
    };
  }
  return {
    db,
    dbPath: usePostgres ? "postgres:control" : dbPath,
    dataDir: root,
    initialCompanyId: Number(company.id),
  };
}

export function resolveCompanyDatabase(dataDir, databaseFile) {
  const root = resolve(dataDir);
  const resolved = resolve(root, String(databaseFile ?? ""));
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`))
    throw new Error("La ruta de datos de la empresa no es válida.");
  return resolved;
}

export function expireDemoCompanies(db) {
  const expired = db.prepare(`SELECT c.id, c.code, c.slug, c.legal_name, c.trade_name, c.database_file,
    s.id AS subscription_id, s.demo_expires_at
    FROM company_subscriptions s JOIN companies c ON c.id = s.company_id
    WHERE s.is_demo = 1 AND s.demo_expires_at IS NOT NULL
      AND s.demo_expires_at <= CURRENT_TIMESTAMP AND c.status = 'active'`).all();
  for (const company of expired) {
    db.prepare(`UPDATE company_subscriptions SET status = 'suspended', suspended_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(company.subscription_id);
    db.prepare("UPDATE companies SET status = 'inactive', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(company.id);
    db.prepare(`INSERT INTO control_audit_logs
      (company_id, action, entity_type, entity_id, summary, details_json)
      VALUES (?, 'control.demo_company_expired', 'company_subscription', ?, ?, ?)`)
      .run(company.id, String(company.subscription_id), `Demo ${company.trade_name || company.legal_name} vencida`,
        JSON.stringify({ expiredAt: company.demo_expires_at }));
  }
  return expired;
}

export function controlAudit(db, {
  controlAdminId = null,
  companyId = null,
  action,
  entityType = null,
  entityId = null,
  summary,
  details = null,
  ip = null,
}) {
  db.prepare(`INSERT INTO control_audit_logs
    (control_admin_id, company_id, action, entity_type, entity_id, summary, details_json, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(controlAdminId, companyId, action, entityType, entityId == null ? null : String(entityId),
      summary, details ? JSON.stringify(details) : null, ip);
}

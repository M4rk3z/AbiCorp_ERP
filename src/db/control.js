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
  `);
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

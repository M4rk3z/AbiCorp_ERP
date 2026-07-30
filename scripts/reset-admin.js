import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { hashPassword } from "../src/core/security.js";

const username = process.argv[2];
const password = process.argv[3];

if (!username || !password) {
  console.error("Uso: node scripts/reset-admin.js <usuario> <contraseña>");
  process.exit(1);
}

const databasePath = resolve(process.env.ERP_DATA_DIR ?? "./data", "abicorp-erp.db");
const db = new DatabaseSync(databasePath);
db.exec("PRAGMA foreign_keys = ON");
db.exec("BEGIN IMMEDIATE");

try {
  const administrator = db.prepare(`SELECT u.id FROM users u
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE r.code = 'ADMIN' ORDER BY u.id LIMIT 1`).get();
  if (!administrator) throw new Error("No existe una cuenta con rol Administrador.");

  db.prepare(`UPDATE users SET username = ?, password_hash = ?, status = 'active',
    must_change_password = 0, failed_login_count = 0, locked_until = NULL,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(username, hashPassword(password), administrator.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(administrator.id);
  db.prepare(`INSERT INTO audit_logs
    (user_id, action, module, entity_type, entity_id, summary)
    VALUES (?, 'auth.admin_reset', 'auth', 'user', ?, 'Credenciales administrativas restablecidas localmente')`)
    .run(administrator.id, String(administrator.id));
  db.exec("COMMIT");
  console.log(`Cuenta administrativa restablecida: ${username}`);
} catch (error) {
  db.exec("ROLLBACK");
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}

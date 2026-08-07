import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalDatabaseValue,
  postgresParameter,
  postgresSchemaName,
  translatePostgresSql,
} from "../src/db/postgres-sql.js";
import {
  POSTGRES_INITIAL_RESPONSE_BYTES,
  POSTGRES_MAX_RESPONSE_BYTES,
  postgresResponseBufferBytes,
  postgresTransactionState,
} from "../src/db/postgres-sync.js";
import { migrations } from "../src/db/schema.js";
import { masterDefinitions } from "../src/core/masters.js";

test("traduce parámetros y conserva signos dentro de textos", () => {
  assert.equal(
    translatePostgresSql("SELECT * FROM users WHERE username = ? AND note = '?'"),
    "SELECT * FROM users WHERE username = $1 AND note = '?'",
  );
});

test("traduce inserciones SQLite y devuelve la fila insertada", () => {
  assert.equal(
    translatePostgresSql(
      "INSERT OR IGNORE INTO roles (code, name) VALUES (?, ?)",
      { returning: true },
    ),
    "INSERT INTO roles (code, name) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *",
  );
});

test("traduce tipos y fechas usados por el esquema", () => {
  const sql = translatePostgresSql(
    "CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL COLLATE NOCASE, photo BLOB, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  assert.match(sql, /id BIGSERIAL PRIMARY KEY/);
  assert.match(sql, /username CITEXT NOT NULL/);
  assert.match(sql, /photo BYTEA/);
  assert.match(sql, /DEFAULT \(CURRENT_TIMESTAMP::text\)/);
});

test("traduce funciones de fecha y agregación usadas por los módulos", () => {
  assert.match(
    translatePostgresSql("SELECT CAST(strftime('%Y', p.issue_date) AS INTEGER) FROM payments p"),
    /TO_CHAR\(NULLIF\(\(p\.issue_date\)::text, ''\)::date, 'YYYY'\)/,
  );
  assert.match(
    translatePostgresSql("SELECT GROUP_CONCAT(s.sequence || '. ' || s.name, ' → ') FROM steps s"),
    /STRING_AGG/,
  );
  assert.match(
    translatePostgresSql("SELECT date(event_date) >= date('now', '-30 days')"),
    /INTERVAL '30 days'/,
  );
});

test("las listas de precios agrupan también la moneda para PostgreSQL", () => {
  assert.match(masterDefinitions.price_lists.select, /GROUP BY p\.id, c\.code/i);
});

test("normaliza esquemas multiempresa", () => {
  assert.equal(postgresSchemaName("Mi Empresa-01"), "tenant_mi_empresa_01");
  assert.equal(postgresSchemaName("control", ""), "control");
});

test("normaliza binarios de SQLite y PostgreSQL al mismo valor", () => {
  const sqliteValue = new Uint8Array([0, 1, 127, 255]);
  const postgresValue = Buffer.from([0, 1, 127, 255]);
  assert.ok(Buffer.isBuffer(postgresParameter(sqliteValue)));
  assert.deepEqual(
    canonicalDatabaseValue(sqliteValue),
    canonicalDatabaseValue(postgresValue),
  );
});

test("todas las migraciones tienen traducción PostgreSQL", () => {
  for (const migration of migrations) {
    for (const statement of migration.statements) {
      if (/^\s*CREATE\s+TRIGGER\b/i.test(statement)) continue;
      const translated = translatePostgresSql(statement);
      assert.doesNotMatch(
        translated,
        /AUTOINCREMENT|COLLATE\s+NOCASE|INSERT\s+OR\s+IGNORE|\bIFNULL\s*\(|strftime\s*\(|julianday\s*\(|printf\s*\(/i,
        `Migración ${migration.version}: ${migration.name}`,
      );
    }
  }
});

test("dimensiona progresivamente las respuestas PostgreSQL", () => {
  assert.equal(POSTGRES_INITIAL_RESPONSE_BYTES, 256 * 1024);
  assert.equal(postgresResponseBufferBytes(400 * 1024), 512 * 1024);
  assert.equal(
    postgresResponseBufferBytes(600 * 1024, 512 * 1024),
    1024 * 1024,
  );
  assert.throws(
    () => postgresResponseBufferBytes(POSTGRES_MAX_RESPONSE_BYTES),
    /exceeds the/,
  );
});

test("mantiene el estado de las transacciones PostgreSQL", () => {
  assert.equal(postgresTransactionState("BEGIN IMMEDIATE"), true);
  assert.equal(postgresTransactionState("COMMIT"), false);
  assert.equal(postgresTransactionState("ROLLBACK"), false);
  assert.equal(postgresTransactionState("SELECT 1"), null);
});

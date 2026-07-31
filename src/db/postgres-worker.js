import { parentPort, workerData } from "node:worker_threads";
import { Client, types } from "pg";
import { quoteIdentifier, translatePostgresSql } from "./postgres-sql.js";

const HEADER_BYTES = 8;
const RESPONSE_TOO_LARGE_CODE = "ABICORP_RESPONSE_TOO_LARGE";
const encoder = new TextEncoder();
const initBuffer = workerData.initBuffer;
const connectionString = workerData.connectionString;
const schema = workerData.schema;
let client;
let queue = Promise.resolve();

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));
for (const oid of [1082, 1083, 1114, 1184, 1266]) {
  types.setTypeParser(oid, (value) => value);
}

initialize().catch((error) => {
  respond(initBuffer, { ok: false, error: serializeError(error) });
});

async function initialize() {
  client = await connectWithRetry();
  await client.query("CREATE EXTENSION IF NOT EXISTS citext");
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdentifier(schema)}`);
  await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);
  respond(initBuffer, { ok: true });

  parentPort.on("message", (message) => {
    queue = queue.then(() => handle(message)).catch((error) => {
      respond(message.buffer, { ok: false, error: serializeError(error) });
    });
  });
}

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const candidate = new Client({
      connectionString,
      application_name: `abicorp-${schema}`,
      keepAlive: true,
      connectionTimeoutMillis: 20_000,
    });
    try {
      await candidate.connect();
      return candidate;
    } catch (error) {
      lastError = error;
      await candidate.end().catch(() => {});
      if (!["ECONNRESET", "ETIMEDOUT", "EPIPE"].includes(error?.code) || attempt === 3) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  throw lastError;
}

async function handle(message) {
  const { type, payload = {}, buffer } = message;
  if (type === "close") {
    await client.end();
    respond(buffer, { ok: true, value: null });
    parentPort.close();
    return;
  }

  if (type === "exec") {
    const source = String(payload.sql ?? "").trim();
    if (!source || /^PRAGMA\s+/i.test(source)) {
      respond(buffer, { ok: true, value: null });
      return;
    }
    const result = await client.query(translatePostgresSql(source));
    respond(buffer, { ok: true, value: summarize(result) });
    return;
  }

  if (!["all", "get", "run"].includes(type)) {
    throw new Error(`Operación PostgreSQL no reconocida: ${type}`);
  }

  const pragma = String(payload.sql ?? "").match(
    /^\s*PRAGMA\s+table_info\(\s*["']?([a-z_][a-z0-9_]*)["']?\s*\)\s*;?$/i,
  );
  let result;
  if (pragma) {
    result = await client.query(
      `SELECT ordinal_position - 1 AS cid, column_name AS name, data_type AS type,
        CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
        column_default AS dflt_value,
        CASE WHEN column_name IN (
          SELECT kcu.column_name
          FROM information_schema.table_constraints tc
          JOIN information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
           AND tc.constraint_schema = kcu.constraint_schema
          WHERE tc.constraint_type = 'PRIMARY KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = $1
        ) THEN 1 ELSE 0 END AS pk
      FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = $1
      ORDER BY ordinal_position`,
      [pragma[1]],
    );
  } else {
    result = await client.query(
      translatePostgresSql(payload.sql, { returning: type === "run" }),
      payload.params ?? [],
    );
  }

  const normalized = Array.isArray(result) ? result.at(-1) : result;
  if (type === "all") {
    respond(buffer, { ok: true, value: normalized?.rows ?? [] });
    return;
  }
  if (type === "get") {
    respond(buffer, { ok: true, value: normalized?.rows?.[0] });
    return;
  }
  const row = normalized?.rows?.[0];
  respond(buffer, {
    ok: true,
    value: {
      changes: Number(normalized?.rowCount ?? 0),
      lastInsertRowid: row?.id == null ? 0 : Number(row.id),
    },
  });
}

function summarize(result) {
  const results = Array.isArray(result) ? result : [result];
  return {
    changes: results.reduce((total, item) => total + Number(item?.rowCount ?? 0), 0),
  };
}

function serializeError(error) {
  return {
    name: error?.name ?? "Error",
    message: error?.message ?? String(error),
    code: error?.code,
    detail: error?.detail,
    hint: error?.hint,
    table: error?.table,
    column: error?.column,
    constraint: error?.constraint,
  };
}

function respond(buffer, value) {
  const header = new Int32Array(buffer, 0, 2);
  const target = new Uint8Array(buffer, HEADER_BYTES);
  let bytes = encoder.encode(JSON.stringify(value, jsonReplacer));
  if (bytes.length > target.length) {
    const requiredBytes = bytes.length;
    bytes = encoder.encode(JSON.stringify({
      ok: false,
      error: {
        name: "RangeError",
        code: RESPONSE_TOO_LARGE_CODE,
        requiredBytes,
        message: `La respuesta PostgreSQL supera el límite de ${target.length} bytes.`,
      },
    }));
  }
  target.set(bytes.subarray(0, target.length));
  Atomics.store(header, 1, Math.min(bytes.length, target.length));
  Atomics.store(header, 0, 1);
  Atomics.notify(header, 0);
}

function jsonReplacer(_key, value) {
  if (typeof value === "bigint") return Number(value);
  if (value?.type === "Buffer" && Array.isArray(value.data)) {
    return { __abicorpBuffer: Buffer.from(value.data).toString("base64") };
  }
  return value;
}

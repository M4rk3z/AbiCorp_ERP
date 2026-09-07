import { Worker } from "node:worker_threads";
import { postgresSchemaName } from "./postgres-sql.js";

export const POSTGRES_INITIAL_RESPONSE_BYTES = 256 * 1024;
export const POSTGRES_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const RESPONSE_TOO_LARGE_CODE = "ABICORP_RESPONSE_TOO_LARGE";
const HEADER_BYTES = 8;
const DEFAULT_TIMEOUT_MS = 240_000;
const decoder = new TextDecoder();

export class PostgresDatabaseSync {
  constructor({
    connectionString = process.env.DATABASE_URL,
    schema,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = {}) {
    if (!connectionString) throw new Error("Falta DATABASE_URL para conectar PostgreSQL.");
    this.schema = postgresSchemaName(schema, "");
    this.timeoutMs = timeoutMs;
    this.closed = false;
    this.isTransaction = false;
    const initBuffer = new SharedArrayBuffer(POSTGRES_INITIAL_RESPONSE_BYTES);
    this.worker = new Worker(new URL("./postgres-worker.js", import.meta.url), {
      workerData: {
        connectionString,
        schema: this.schema,
        initBuffer,
      },
    });
    this.#wait(initBuffer, "conectar PostgreSQL");
  }

  prepare(sql) {
    const database = this;
    return {
      all(...params) {
        return database.#request("all", { sql, params });
      },
      get(...params) {
        return database.#request("get", { sql, params });
      },
      run(...params) {
        return database.#request("run", { sql, params });
      },
    };
  }

  exec(sql) {
    const value = this.#request("exec", { sql });
    const transactionState = postgresTransactionState(sql);
    if (transactionState !== null) this.isTransaction = transactionState;
    return value;
  }

  transaction(callback) {
    if (typeof callback !== "function") throw new TypeError("La transacción requiere una función.");
    const database = this;
    return function postgresTransaction(...args) {
      database.exec("BEGIN");
      try {
        const value = callback(...args);
        database.exec("COMMIT");
        return value;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // Preserve the original transaction error.
        }
        throw error;
      }
    };
  }

  close() {
    if (this.closed) return;
    try {
      this.#request("close");
    } finally {
      this.closed = true;
      this.isTransaction = false;
      this.worker.unref();
    }
  }

  #request(type, payload = {}) {
    if (this.closed) throw new Error("La conexión PostgreSQL está cerrada.");
    const adaptive = ["all", "get"].includes(type);
    let bufferBytes = POSTGRES_INITIAL_RESPONSE_BYTES;
    while (true) {
      const buffer = new SharedArrayBuffer(bufferBytes);
      this.worker.postMessage({ type, payload, buffer });
      try {
        return this.#wait(buffer, type);
      } catch (error) {
        if (!adaptive || error?.code !== RESPONSE_TOO_LARGE_CODE) throw error;
        bufferBytes = postgresResponseBufferBytes(error.requiredBytes, bufferBytes);
      }
    }
  }

  #wait(buffer, operation) {
    const header = new Int32Array(buffer, 0, 2);
    const status = Atomics.wait(header, 0, 0, this.timeoutMs);
    if (status === "timed-out") {
      throw new Error(`Tiempo agotado al intentar ${operation}.`);
    }
    const length = Atomics.load(header, 1);
    const bytes = new Uint8Array(buffer, HEADER_BYTES, length);
    const response = JSON.parse(decoder.decode(bytes), jsonReviver);
    if (!response.ok) {
      const error = new Error(response.error?.message ?? "Falló la operación PostgreSQL.");
      Object.assign(error, response.error);
      throw error;
    }
    return response.value;
  }
}

export function postgresTransactionState(sql) {
  const statement = String(sql ?? "").trim();
  if (/^BEGIN(?:\s+IMMEDIATE)?\b/i.test(statement)) return true;
  if (/^(?:COMMIT|ROLLBACK)\b/i.test(statement)) return false;
  return null;
}

export function postgresResponseBufferBytes(
  requiredPayloadBytes,
  currentBytes = POSTGRES_INITIAL_RESPONSE_BYTES,
) {
  const required = Number(requiredPayloadBytes) + HEADER_BYTES;
  if (!Number.isSafeInteger(required) || required <= HEADER_BYTES) {
    throw new RangeError("PostgreSQL reported an invalid response size.");
  }
  if (required > POSTGRES_MAX_RESPONSE_BYTES) {
    throw new RangeError(
      `PostgreSQL response requires ${requiredPayloadBytes} bytes and exceeds the ${POSTGRES_MAX_RESPONSE_BYTES - HEADER_BYTES} byte limit.`,
    );
  }
  let nextBytes = Math.max(
    POSTGRES_INITIAL_RESPONSE_BYTES,
    Number(currentBytes) * 2,
  );
  while (nextBytes < required) nextBytes *= 2;
  return Math.min(nextBytes, POSTGRES_MAX_RESPONSE_BYTES);
}

export function isPostgresProvider(options = {}) {
  const configured = String(
    options.databaseProvider ??
    process.env.DATABASE_PROVIDER ??
    (process.env.DATABASE_URL ? "postgres" : "sqlite"),
  ).toLowerCase();
  if (configured === "sqlite") return false;
  if (["postgres", "postgresql", "pg"].includes(configured)) return true;
  return /^postgres(?:ql)?:\/\//i.test(
    String(options.databaseUrl ?? process.env.DATABASE_URL ?? ""),
  );
}

export function isTransientPostgresConnectionError(error) {
  const code = String(error?.code ?? "").toUpperCase();
  if (["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EHOSTUNREACH",
    "57P01", "57P02", "57P03"].includes(code) || code.startsWith("08")) return true;
  const message = String(error?.message ?? error ?? "").toLowerCase();
  return ["connection terminated unexpectedly", "connection terminated", "connection closed",
    "client has already been closed", "client is not queryable", "socket hang up"].some((text) => message.includes(text));
}

function jsonReviver(_key, value) {
  if (value?.__abicorpBuffer) return Buffer.from(value.__abicorpBuffer, "base64");
  if (value?.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  return value;
}

import { Worker } from "node:worker_threads";
import { postgresSchemaName } from "./postgres-sql.js";

const LARGE_RESPONSE_BYTES = 16 * 1024 * 1024;
const SMALL_RESPONSE_BYTES = 256 * 1024;
const HEADER_BYTES = 8;
const DEFAULT_TIMEOUT_MS = 120_000;

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
    const initBuffer = new SharedArrayBuffer(256 * 1024);
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
    return this.#request("exec", { sql });
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
      this.worker.unref();
    }
  }

  #request(type, payload = {}) {
    if (this.closed) throw new Error("La conexión PostgreSQL está cerrada.");
    const buffer = new SharedArrayBuffer(
      ["all", "get"].includes(type) ? LARGE_RESPONSE_BYTES : SMALL_RESPONSE_BYTES,
    );
    this.worker.postMessage({ type, payload, buffer });
    return this.#wait(buffer, type);
  }

  #wait(buffer, operation) {
    const header = new Int32Array(buffer, 0, 2);
    const status = Atomics.wait(header, 0, 0, this.timeoutMs);
    if (status === "timed-out") {
      throw new Error(`Tiempo agotado al intentar ${operation}.`);
    }
    const length = Atomics.load(header, 1);
    const bytes = new Uint8Array(buffer, HEADER_BYTES, length);
    const response = JSON.parse(new TextDecoder().decode(bytes), jsonReviver);
    if (!response.ok) {
      const error = new Error(response.error?.message ?? "Falló la operación PostgreSQL.");
      Object.assign(error, response.error);
      throw error;
    }
    return response.value;
  }
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

function jsonReviver(_key, value) {
  if (value?.__abicorpBuffer) return Buffer.from(value.__abicorpBuffer, "base64");
  if (value?.type === "Buffer" && Array.isArray(value.data)) return Buffer.from(value.data);
  return value;
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export function postgresSchemaName(value, prefix = "tenant") {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const schema = prefix ? `${prefix}_${normalized || "default"}` : normalized;
  if (!IDENTIFIER.test(schema)) throw new Error("El esquema PostgreSQL no es válido.");
  return schema;
}

export function quoteIdentifier(value) {
  const identifier = String(value ?? "");
  if (!IDENTIFIER.test(identifier)) throw new Error(`Identificador PostgreSQL no válido: ${identifier}`);
  return `"${identifier}"`;
}

export function postgresParameter(value) {
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return value;
}

export function canonicalDatabaseValue(value) {
  const normalized = postgresParameter(value);
  if (Buffer.isBuffer(normalized)) {
    return { buffer: normalized.toString("base64") };
  }
  if (typeof normalized === "bigint") return Number(normalized);
  return normalized;
}

export function translatePostgresSql(source, { returning = false } = {}) {
  const original = String(source ?? "").trim();
  if (!original) return "";
  if (/^PRAGMA\s+/i.test(original)) return original;

  let sql = original
    .replace(/^BEGIN\s+IMMEDIATE\b/i, "BEGIN")
    .replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, "BIGSERIAL PRIMARY KEY")
    .replace(
      /\bTEXT(?=(?:\s+(?:NOT\s+NULL|UNIQUE))*\s+COLLATE\s+NOCASE\b)/gi,
      "CITEXT",
    )
    .replace(/\bTEXT\s+NOT\s+NULL\s+COLLATE\s+NOCASE\b/gi, "CITEXT NOT NULL")
    .replace(/\bTEXT\s+COLLATE\s+NOCASE\b/gi, "CITEXT")
    .replace(/\s+COLLATE\s+NOCASE\b/gi, "")
    .replace(/\bAUTOINCREMENT\b/gi, "")
    .replace(/\bBLOB\b/gi, "BYTEA")
    .replace(/\bREAL\b/gi, "DOUBLE PRECISION")
    .replace(/\bINTEGER\b/gi, "BIGINT")
    .replace(/\bIFNULL\s*\(/gi, "COALESCE(");

  sql = translateDateFunctions(sql);
  sql = translateAggregateFunctions(sql);
  sql = sql.replace(
    /printf\(\s*'CXC-%06d'\s*,\s*([^\)]+)\)/gi,
    "'CXC-' || LPAD(($1)::text, 6, '0')",
  );
  sql = sql.replace(
    /printf\(\s*'%05d'\s*,\s*MIN\(\s*([a-z_][a-z0-9_.]*)\s*\)\s*\)/gi,
    "LPAD((MIN($1))::text, 5, '0')",
  );
  sql = sql.replace(/\bCURRENT_TIMESTAMP\b(?!\s*::)/gi, "(CURRENT_TIMESTAMP::text)");

  const ignoreInsert = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(sql);
  if (ignoreInsert) {
    sql = sql.replace(/^\s*INSERT\s+OR\s+IGNORE\b/i, "INSERT");
    if (!/\bON\s+CONFLICT\b/i.test(sql)) sql = appendClause(sql, "ON CONFLICT DO NOTHING");
  }

  if (returning && /^\s*INSERT\b/i.test(sql) && !/\bRETURNING\b/i.test(sql)) {
    sql = appendClause(sql, "RETURNING *");
  }

  return replaceQuestionParameters(sql);
}

function translateDateFunctions(sql) {
  let result = sql;
  result = result.replace(
    /date\(\s*'now'\s*,\s*'-([0-9]+)\s+days?'\s*\)/gi,
    "TO_CHAR(CURRENT_DATE - INTERVAL '$1 days', 'YYYY-MM-DD')",
  );
  result = result.replace(
    /date\(\s*([a-z_][a-z0-9_.]*)\s*,\s*'\+1\s+year'\s*\)/gi,
    "TO_CHAR(NULLIF(($1)::text, '')::date + INTERVAL '1 year', 'YYYY-MM-DD')",
  );
  result = result.replace(
    /CAST\(\s*julianday\(([^)]+)\)\s*-\s*julianday\(\s*date\(\s*'now'\s*\)\s*\)\s+AS\s+BIGINT\s*\)/gi,
    "(NULLIF(($1)::text, '')::date - CURRENT_DATE)",
  );
  result = result.replace(
    /strftime\(\s*'%Y'\s*,\s*COALESCE\(\s*([^,]+)\s*,\s*'now'\s*\)\s*\)/gi,
    "TO_CHAR(COALESCE(NULLIF(($1)::text, '')::date, CURRENT_DATE), 'YYYY')",
  );
  result = result.replace(
    /strftime\(\s*'(%Y|%m|%d|%Y-%m|%m-%d)'\s*,\s*'now'\s*\)/gi,
    (_, format) => `TO_CHAR(CURRENT_DATE, '${postgresDateFormat(format)}')`,
  );
  result = result.replace(
    /strftime\(\s*'(%Y|%m|%d|%Y-%m|%m-%d)'\s*,\s*([a-z_][a-z0-9_.]*)\s*\)/gi,
    (_, format, expression) =>
      `TO_CHAR(NULLIF((${expression})::text, '')::date, '${postgresDateFormat(format)}')`,
  );
  result = result.replace(
    /date\(\s*'now'\s*\)/gi,
    "TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')",
  );
  result = result.replace(
    /date\(\s*([a-z_][a-z0-9_.]*)\s*\)/gi,
    "TO_CHAR(NULLIF(($1)::text, '')::date, 'YYYY-MM-DD')",
  );
  result = result.replace(/\bMAX\(\s*0\s*,/gi, "GREATEST(0,");
  return result;
}

function postgresDateFormat(format) {
  return {
    "%Y": "YYYY",
    "%m": "MM",
    "%d": "DD",
    "%Y-%m": "YYYY-MM",
    "%m-%d": "MM-DD",
  }[format] ?? format;
}

function translateAggregateFunctions(sql) {
  let result = sql.replace(
    /GROUP_CONCAT\(\s*po\.folio\s*,\s*(', ')\s*\)(\s+FROM\s+production_orders\s+po\s+WHERE\s+po\.sales_order_id\s*=\s*o\.id)\s+ORDER\s+BY\s+po\.id/gi,
    "STRING_AGG((po.folio)::text, $1 ORDER BY po.id)$2",
  );
  result = result.replace(
    /GROUP_CONCAT\(\s*([^,()]+?)\s*,\s*('(?:[^']|'')*')\s*\)/gi,
    "STRING_AGG(($1)::text, $2)",
  );
  return result;
}

function appendClause(sql, clause) {
  const trimmed = sql.trimEnd();
  return trimmed.endsWith(";")
    ? `${trimmed.slice(0, -1).trimEnd()} ${clause};`
    : `${trimmed} ${clause}`;
}

function replaceQuestionParameters(sql) {
  let result = "";
  let parameter = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let dollarTag = "";

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];

    if (dollarTag) {
      if (sql.startsWith(dollarTag, index)) {
        result += dollarTag;
        index += dollarTag.length - 1;
        dollarTag = "";
      } else result += character;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && character === "$") {
      const match = sql.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
      if (match) {
        dollarTag = match[0];
        result += dollarTag;
        index += dollarTag.length - 1;
        continue;
      }
    }

    if (!doubleQuoted && character === "'") {
      result += character;
      if (singleQuoted && next === "'") {
        result += next;
        index += 1;
      } else singleQuoted = !singleQuoted;
      continue;
    }

    if (!singleQuoted && character === '"') {
      result += character;
      if (doubleQuoted && next === '"') {
        result += next;
        index += 1;
      } else doubleQuoted = !doubleQuoted;
      continue;
    }

    if (!singleQuoted && !doubleQuoted && character === "?") {
      parameter += 1;
      result += `$${parameter}`;
    } else result += character;
  }

  return result;
}

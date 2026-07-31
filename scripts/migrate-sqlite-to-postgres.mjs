import { createHash } from "node:crypto";
import {
  existsSync,
  readFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Client, types } from "pg";
import { openControlDatabase } from "../src/db/control.js";
import { openDatabase } from "../src/db/index.js";
import { migrations } from "../src/db/schema.js";
import {
  canonicalDatabaseValue,
  postgresParameter,
  postgresSchemaName,
  quoteIdentifier,
} from "../src/db/postgres-sql.js";

types.setTypeParser(20, (value) => Number(value));
types.setTypeParser(1700, (value) => Number(value));

const args = new Set(process.argv.slice(2));
const confirmed = args.has("--confirm");
const replaceExisting = args.has("--replace");
const sourceArgument = argumentValue("--source") ?? "./data";
const sourceDataDir = resolve(sourceArgument);
const configuredConnectionString = process.env.DATABASE_URL;
const controlPath = join(sourceDataDir, "abicorp-control.db");

if (!existsSync(controlPath)) {
  throw new Error(`No se encontró la base central: ${controlPath}`);
}

const plan = inspectSource(controlPath, sourceDataDir);
printPlan(plan);

if (!confirmed) {
  console.log("\nSimulación terminada. No se modificó PostgreSQL.");
  console.log("Para ejecutar la migración usa el mismo comando agregando --confirm.");
  process.exit(0);
}

if (!configuredConnectionString) {
  throw new Error("Falta DATABASE_URL con la External Database URL de Render.");
}
const connectionString = normalizeExternalDatabaseUrl(configuredConnectionString);

await initializeTarget(plan, connectionString);
const client = new Client({
  connectionString,
  application_name: "abicorp-sqlite-migration",
  keepAlive: true,
  connectionTimeoutMillis: 20_000,
});
await client.connect();

try {
  await client.query("BEGIN");
  await client.query(`
    CREATE TABLE IF NOT EXISTS control.postgres_migration_runs (
      id BIGSERIAL PRIMARY KEY,
      migrated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source_label TEXT NOT NULL,
      report JSONB NOT NULL
    )
  `);
  const previous = await client.query(
    "SELECT COUNT(*)::int AS value FROM control.postgres_migration_runs",
  );
  if (previous.rows[0].value > 0 && !replaceExisting) {
    throw new Error(
      "PostgreSQL ya tiene una migración registrada. Usa --replace únicamente si deseas sustituirla.",
    );
  }

  const reports = [];
  reports.push(await copyDatabase({
    client,
    sourcePath: plan.control.path,
    sourceDataDir,
    schema: "control",
    hydrateFiles: false,
  }));

  for (const company of plan.companies) {
    reports.push(await copyDatabase({
      client,
      sourcePath: company.path,
      sourceDataDir,
      schema: company.schema,
      hydrateFiles: true,
    }));
  }
  const logosStored = await hydrateLegacyCompanyLogos(
    client,
    plan.control.path,
    plan.companies,
  );

  const report = {
    source: basename(dirname(sourceDataDir)),
    migratedAt: new Date().toISOString(),
    databases: reports,
    totalRows: reports.reduce((total, item) => total + item.totalRows, 0),
    photosStored: reports.reduce((total, item) => total + item.photosStored, 0),
    documentsStored: reports.reduce((total, item) => total + item.documentsStored, 0),
    logosStored,
  };
  await client.query(
    "INSERT INTO control.postgres_migration_runs (source_label, report) VALUES ($1, $2::jsonb)",
    [basename(sourceDataDir), JSON.stringify(report)],
  );
  await client.query("COMMIT");

  console.log("\nMigración completada y verificada.");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}

function inspectSource(controlDatabasePath, dataDirectory) {
  const control = new DatabaseSync(controlDatabasePath, { readOnly: true });
  try {
    assertIntegrity(control, controlDatabasePath);
    const companyRows = control.prepare(
      "SELECT id, code, slug, legal_name, trade_name, database_file, status FROM companies ORDER BY id",
    ).all();
    if (!companyRows.length) throw new Error("La base central no contiene empresas.");

    const companies = companyRows.map((company) => {
      const path = resolveCompanyPath(dataDirectory, company.database_file);
      if (!existsSync(path)) {
        throw new Error(`No existe la base de ${company.slug}: ${path}`);
      }
      const database = new DatabaseSync(path, { readOnly: true });
      try {
        assertIntegrity(database, path);
        const summary = databaseSummary(database);
        return {
          ...company,
          path,
          schema: postgresSchemaName(company.slug),
          ...summary,
        };
      } finally {
        database.close();
      }
    });

    return {
      control: {
        path: controlDatabasePath,
        schema: "control",
        ...databaseSummary(control),
      },
      companies,
    };
  } finally {
    control.close();
  }
}

function databaseSummary(database) {
  const tables = tableNames(database);
  const order = dependencyOrder(database, tables);
  return {
    tables: tables.length,
    rows: tables.reduce(
      (total, table) =>
        total + Number(database.prepare(`SELECT COUNT(*) AS value FROM ${quoteIdentifier(table)}`).get().value),
      0,
    ),
    order,
  };
}

function printPlan(plan) {
  console.log("Plan de migración SQLite → PostgreSQL");
  console.log(`Central: ${plan.control.path}`);
  console.log(`  esquema control: ${plan.control.tables} tablas, ${plan.control.rows} registros`);
  for (const company of plan.companies) {
    console.log(`Empresa ${company.slug}: ${company.path}`);
    console.log(`  esquema ${company.schema}: ${company.tables} tablas, ${company.rows} registros`);
  }
}

async function initializeTarget(sourcePlan, databaseUrl) {
  const control = openControlDatabase({
    dataDir: sourceDataDir,
    databaseProvider: "postgres",
    databaseUrl,
    seedControlAdmin: false,
  });
  control.db.close();

  for (const company of sourcePlan.companies) {
    const opened = openDatabase({
      dataDir: dirname(company.path),
      databasePath: company.path,
      databaseProvider: "postgres",
      databaseUrl,
      databaseSchema: company.slug,
      company,
      initialAdminUser: "migration",
      initialAdminPassword: "MigrationOnly123!",
      seedAdmin: false,
    });
    opened.db.close();
  }
}

async function copyDatabase({
  client,
  sourcePath,
  sourceDataDir: dataDirectory,
  schema,
  hydrateFiles,
}) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    assertIntegrity(source, sourcePath);
    const tables = tableNames(source);
    const order = dependencyOrder(source, tables);
    await client.query(
      `SET LOCAL search_path TO ${quoteIdentifier(schema)}, public`,
    );
    const targetTables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE'",
      [schema],
    );
    const available = new Set(targetTables.rows.map((row) => row.table_name));
    const missing = tables.filter((table) => !available.has(table));
    if (missing.length) {
      throw new Error(`Faltan tablas en ${schema}: ${missing.join(", ")}`);
    }

    if (tables.length) {
      await client.query(
        `TRUNCATE TABLE ${tables.map(quoteIdentifier).join(", ")} RESTART IDENTITY CASCADE`,
      );
    }

    const tableReports = [];
    for (const table of order) {
      const sourceColumns = tableColumns(source, table);
      const targetColumnRows = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2`,
        [schema, table],
      );
      const targetColumns = new Set(targetColumnRows.rows.map((row) => row.column_name));
      const columns = sourceColumns.filter((column) => targetColumns.has(column.name));
      const ignoredColumns = sourceColumns
        .filter((column) => !targetColumns.has(column.name))
        .map((column) => column.name);
      if (!columns.length) {
        throw new Error(`No hay columnas compatibles para ${schema}.${table}.`);
      }
      const rows = source.prepare(selectSourceSql(table, columns)).all();
      if (rows.length) {
        const columnSql = columns.map((column) => quoteIdentifier(column.name)).join(", ");
        const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");
        const insertSql = `INSERT INTO ${quoteIdentifier(table)} (${columnSql}) VALUES (${placeholders})`;
        for (const row of rows) {
          await client.query(
            insertSql,
            columns.map((column) => postgresParameter(row[column.name])),
          );
        }
      }
      await resetSerialSequences(client, schema, table, columns);
      tableReports.push({
        ...await verifyTable(client, source, table, columns),
        ignoredColumns,
      });
    }
    await synchronizeMigrationVersions(client, source, tables);

    let photosStored = 0;
    let documentsStored = 0;
    if (hydrateFiles) {
      photosStored = await hydrateEmployeePhotos(client, source, sourcePath);
      documentsStored = await hydrateDocuments(client, source, sourcePath, dataDirectory);
    }

    return {
      schema,
      tables: tableReports.length,
      totalRows: tableReports.reduce((total, item) => total + item.rows, 0),
      photosStored,
      documentsStored,
      checksum: createHash("sha256")
        .update(tableReports.map((item) => `${item.table}:${item.hash}`).join("|"))
        .digest("hex"),
    };
  } finally {
    source.close();
  }
}

async function synchronizeMigrationVersions(client, source, tables) {
  if (!tables.includes("schema_migrations")) return;
  for (const migration of migrations) {
    await client.query(
      `INSERT INTO schema_migrations (version, name)
       VALUES ($1, $2)
       ON CONFLICT(version) DO UPDATE SET name = EXCLUDED.name`,
      [migration.version, migration.name],
    );
  }
}

async function verifyTable(client, source, table, columns) {
  const sourceRows = source.prepare(selectSourceSql(table, columns)).all();
  const target = await client.query(
    `SELECT ${columns.map((column) => quoteIdentifier(column.name)).join(", ")}
     FROM ${quoteIdentifier(table)}`,
  );
  const sourceCanonical = canonicalRows(sourceRows, columns);
  const targetCanonical = canonicalRows(target.rows, columns);
  if (sourceCanonical !== targetCanonical) {
    const sourceHash = createHash("sha256").update(sourceCanonical).digest("hex");
    const targetHash = createHash("sha256").update(targetCanonical).digest("hex");
    throw new Error(
      `La verificación de datos falló en ${table}: ` +
      `origen=${sourceRows.length}/${sourceHash}, destino=${target.rows.length}/${targetHash}.`,
    );
  }
  return {
    table,
    rows: sourceRows.length,
    hash: createHash("sha256").update(sourceCanonical).digest("hex"),
  };
}

async function resetSerialSequences(client, schema, table, columns) {
  for (const column of columns.filter((item) => item.pk && /INT/i.test(item.type))) {
    const sequence = await client.query(
      "SELECT pg_get_serial_sequence($1, $2) AS name",
      [`${schema}.${table}`, column.name],
    );
    if (!sequence.rows[0]?.name) continue;
    await client.query(
      `SELECT setval($1::regclass,
        COALESCE(MAX(${quoteIdentifier(column.name)}), 1),
        MAX(${quoteIdentifier(column.name)}) IS NOT NULL)
       FROM ${quoteIdentifier(table)}`,
      [sequence.rows[0].name],
    );
  }
}

async function hydrateEmployeePhotos(client, source, sourcePath) {
  if (!tableNames(source).includes("hr_employee_profiles")) return 0;
  const columns = new Set(tableColumns(source, "hr_employee_profiles").map((item) => item.name));
  const select = columns.has("photo_data")
    ? "SELECT employee_id, photo_filename, photo_data FROM hr_employee_profiles WHERE photo_filename IS NOT NULL"
    : "SELECT employee_id, photo_filename, NULL AS photo_data FROM hr_employee_profiles WHERE photo_filename IS NOT NULL";
  const rows = source.prepare(select).all();
  let stored = 0;
  for (const row of rows) {
    if (row.photo_data) {
      stored += 1;
      continue;
    }
    const filename = basename(String(row.photo_filename));
    const path = join(dirname(sourcePath), "hr-photos", filename);
    if (!existsSync(path)) continue;
    await client.query(
      "UPDATE hr_employee_profiles SET photo_data = $1 WHERE employee_id = $2",
      [readFileSync(path), row.employee_id],
    );
    stored += 1;
  }
  return stored;
}

async function hydrateDocuments(client, source, sourcePath, dataDirectory) {
  if (!tableNames(source).includes("documents")) return 0;
  const columns = new Set(tableColumns(source, "documents").map((item) => item.name));
  const select = columns.has("content_data")
    ? "SELECT id, stored_name, storage_path, content_data FROM documents"
    : "SELECT id, stored_name, storage_path, NULL AS content_data FROM documents";
  const rows = source.prepare(select).all();
  let stored = 0;
  for (const row of rows) {
    if (row.content_data) {
      stored += 1;
      continue;
    }
    const candidates = [
      row.storage_path,
      join(dirname(sourcePath), "documents", basename(String(row.stored_name))),
      join(dataDirectory, "documents", basename(String(row.stored_name))),
    ].filter(Boolean);
    const path = candidates.find((candidate) => existsSync(candidate));
    if (!path) continue;
    await client.query(
      "UPDATE documents SET content_data = $1, storage_path = $2 WHERE id = $3",
      [readFileSync(path), `database:${row.stored_name}`, row.id],
    );
    stored += 1;
  }
  return stored;
}

async function hydrateLegacyCompanyLogos(client, controlDatabasePath, companies) {
  const source = new DatabaseSync(controlDatabasePath, { readOnly: true });
  try {
    const columns = new Set(tableColumns(source, "companies").map((item) => item.name));
    if (!columns.has("logo_data") || !columns.has("logo_mime")) return 0;
    const rows = source.prepare(
      "SELECT id, logo_data, logo_mime FROM companies WHERE logo_data IS NOT NULL",
    ).all();
    let stored = 0;
    for (const row of rows) {
      const company = companies.find((item) => Number(item.id) === Number(row.id));
      if (!company || !row.logo_data) continue;
      await client.query(
        `SET LOCAL search_path TO ${quoteIdentifier(company.schema)}, public`,
      );
      await client.query(
        `INSERT INTO company_assets (asset_key, asset_data, mime_type, updated_at)
         VALUES ('company_logo', $1, $2, CURRENT_TIMESTAMP::text)
         ON CONFLICT(asset_key) DO UPDATE SET
           asset_data = EXCLUDED.asset_data,
           mime_type = EXCLUDED.mime_type,
           updated_at = CURRENT_TIMESTAMP::text`,
        [Buffer.from(row.logo_data), row.logo_mime || "image/png"],
      );
      stored += 1;
    }
    return stored;
  } finally {
    source.close();
  }
}

function tableNames(database) {
  return database.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  ).all().map((row) => row.name);
}

function tableColumns(database, table) {
  return database.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all();
}

function dependencyOrder(database, tables) {
  const available = new Set(tables);
  const dependencies = new Map(tables.map((table) => {
    const referenced = database.prepare(
      `PRAGMA foreign_key_list(${quoteIdentifier(table)})`,
    ).all().map((row) => row.table)
      .filter((dependency) => dependency !== table && available.has(dependency));
    return [table, new Set(referenced)];
  }));
  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size) {
    const ready = [...remaining].filter((table) =>
      [...dependencies.get(table)].every((dependency) => !remaining.has(dependency)));
    if (!ready.length) {
      throw new Error(`Se detectó una dependencia circular entre: ${[...remaining].join(", ")}`);
    }
    ready.sort();
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

function selectSourceSql(table, columns) {
  const primary = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  const order = primary.length
    ? ` ORDER BY ${primary.map((column) => quoteIdentifier(column.name)).join(", ")}`
    : "";
  return `SELECT ${columns.map((column) => quoteIdentifier(column.name)).join(", ")}
    FROM ${quoteIdentifier(table)}${order}`;
}

function canonicalRows(rows, columns) {
  return rows.map((row) => JSON.stringify(
    columns.map((column) => canonicalDatabaseValue(row[column.name])),
  )).sort().join("\n");
}

function assertIntegrity(database, path) {
  const result = Object.values(database.prepare("PRAGMA quick_check").get() ?? {})[0];
  if (result !== "ok") throw new Error(`SQLite quick_check falló para ${path}: ${result}`);
}

function resolveCompanyPath(dataDirectory, databaseFile) {
  const value = String(databaseFile ?? "");
  const path = isAbsolute(value) ? resolve(value) : resolve(dataDirectory, value);
  const root = resolve(dataDirectory);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error(`La base de empresa está fuera del respaldo: ${value}`);
  }
  return path;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function normalizeExternalDatabaseUrl(value) {
  const url = new URL(String(value));
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL no es una conexión PostgreSQL válida.");
  }
  if (!url.hostname.includes(".")) {
    throw new Error(
      "La URL parece ser Internal Database URL. Desde Windows debes copiar External Database URL.",
    );
  }
  if (!url.searchParams.has("sslmode")) url.searchParams.set("sslmode", "require");
  if (!url.searchParams.has("uselibpqcompat")) url.searchParams.set("uselibpqcompat", "true");
  if (!url.searchParams.has("connect_timeout")) url.searchParams.set("connect_timeout", "20");
  return url.toString();
}

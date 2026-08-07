import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL.");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  application_name: "abicorp-hr-identity-verification",
});

const requiredTables = [
  "hr_work_centers",
  "hr_departments",
  "hr_employee_fiscal_data",
  "hr_employee_personal_data",
  "hr_employee_labor_data",
  "hr_employee_compensation_private",
  "hr_employee_medical_private",
  "hr_employee_history",
  "hr_user_access",
  "hr_user_company_scopes",
  "hr_user_work_center_scopes",
  "hr_document_types",
  "hr_document_access_log",
];

try {
  await client.connect();
  const schemas = await client.query(`SELECT table_schema
    FROM information_schema.tables
    WHERE table_name = 'schema_migrations'
      AND (table_schema = 'control' OR table_schema LIKE 'tenant_%')
    ORDER BY table_schema`);
  const results = [];
  for (const { table_schema: schema } of schemas.rows) {
    const quoted = `"${schema.replaceAll('"', '""')}"`;
    const migration = await client.query(`SELECT MAX(version)::int AS latest,
      COUNT(*) FILTER (WHERE version = 26)::int AS identity_migration,
      COUNT(*) FILTER (WHERE version = 27)::int AS profile_correction,
      COUNT(*) FILTER (WHERE version = 28)::int AS digital_file_migration,
      COUNT(*) FILTER (WHERE version = 29)::int AS retention_migration
      FROM ${quoted}.schema_migrations`);
    const tables = await client.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = $1 AND table_name = ANY($2::text[]) ORDER BY table_name`, [schema, requiredTables]);
    results.push({ schema, latestMigration: migration.rows[0].latest,
      identityMigration: migration.rows[0].identity_migration === 1,
      profileCorrection: migration.rows[0].profile_correction === 1,
      digitalFileMigration: migration.rows[0].digital_file_migration === 1,
      retentionMigration: migration.rows[0].retention_migration === 1,
      identityTables: tables.rows.map((row) => row.table_name) });
  }
  const tenantResults = results.filter((item) => item.schema.startsWith("tenant_"));
  if (!tenantResults.length || tenantResults.some((item) => !item.identityMigration || !item.profileCorrection
    || !item.digitalFileMigration || !item.retentionMigration
    || item.identityTables.length !== requiredTables.length)) {
    console.log(JSON.stringify({ ok: false, schemas: results }));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify({ ok: true, schemas: results }));
  }
} finally {
  await client.end();
}

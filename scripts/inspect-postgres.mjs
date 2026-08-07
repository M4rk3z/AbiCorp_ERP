import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL.");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  application_name: "abicorp-database-inspection",
});

try {
  await client.connect();
  const version = await client.query(`SELECT
    current_setting('server_version_num') AS version_num,
    current_database() AS database_name`);
  const schemas = await client.query(`SELECT schemaname, count(*)::int AS tables
    FROM pg_tables
    WHERE schemaname = 'control' OR schemaname LIKE 'tenant_%'
    GROUP BY schemaname
    ORDER BY schemaname`);
  console.log(JSON.stringify({
    versionNumber: version.rows[0].version_num,
    database: version.rows[0].database_name,
    schemas: schemas.rows,
  }));
} finally {
  await client.end();
}

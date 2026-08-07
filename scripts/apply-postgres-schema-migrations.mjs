import pg from "pg";
import { openDatabase } from "../src/db/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Falta DATABASE_URL.");

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
  application_name: "abicorp-schema-migrations",
});

const applied = [];
try {
  await client.connect();
  const companies = await client.query(`SELECT slug FROM control.companies
    WHERE status = 'active' ORDER BY id`);
  for (const company of companies.rows) {
    const opened = openDatabase({
      dataDir: "./data",
      databaseProvider: "postgres",
      databaseUrl: connectionString,
      databaseSchema: company.slug,
      seedAdmin: false,
    });
    try {
      const migration = opened.db.prepare("SELECT MAX(version) AS latest FROM schema_migrations").get();
      applied.push({ schema: `tenant_${company.slug}`, latestMigration: Number(migration.latest) });
    } finally {
      opened.db.close();
    }
  }
  console.log(JSON.stringify({ ok: true, schemas: applied }));
} finally {
  await client.end();
}

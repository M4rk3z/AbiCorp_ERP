import { createHash } from "node:crypto";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const workspace = resolve(import.meta.dirname, "..");
const source = join(workspace, "data");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function timestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("");
  const time = [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("");
  return `${day}-${time}`;
}

function quickCheck(database) {
  return Object.values(database.prepare("PRAGMA quick_check").get() ?? {})[0];
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

if (!existsSync(source)) {
  throw new Error(`No existe el directorio de datos: ${source}`);
}

const backupRoot = join(
  workspace,
  "backups",
  `sqlite-pre-postgres-${timestamp()}`,
);
const destination = join(backupRoot, "data");
const sourceChecks = [];

for (const path of walk(source).filter((item) => item.endsWith(".db"))) {
  const database = new DatabaseSync(path);
  const checkpoint = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
  const integrity = quickCheck(database);
  database.close();

  if (integrity !== "ok") {
    throw new Error(`La comprobación de SQLite falló para ${path}: ${integrity}`);
  }

  sourceChecks.push({
    database: relative(workspace, path),
    checkpoint,
    quickCheck: integrity,
  });
}

if (existsSync(backupRoot)) {
  throw new Error(`El destino del respaldo ya existe: ${backupRoot}`);
}

mkdirSync(backupRoot, { recursive: true });
cpSync(source, destination, { recursive: true });

const sourceFiles = walk(source).sort();
const destinationFiles = walk(destination).sort();

if (sourceFiles.length !== destinationFiles.length) {
  throw new Error(
    `El número de archivos no coincide: origen=${sourceFiles.length}, respaldo=${destinationFiles.length}`,
  );
}

const verified = [];

for (const sourcePath of sourceFiles) {
  const relativePath = relative(source, sourcePath);
  const destinationPath = join(destination, relativePath);

  if (!existsSync(destinationPath)) {
    throw new Error(`Falta el archivo respaldado: ${relativePath}`);
  }

  const sourceSize = statSync(sourcePath).size;
  const destinationSize = statSync(destinationPath).size;
  const sourceHash = await sha256(sourcePath);
  const destinationHash = await sha256(destinationPath);

  if (sourceSize !== destinationSize || sourceHash !== destinationHash) {
    throw new Error(`La verificación SHA-256 falló para: ${relativePath}`);
  }

  verified.push({
    file: relativePath,
    bytes: sourceSize,
    sha256: sourceHash,
  });
}

const backupChecks = [];

for (const path of walk(destination).filter((item) => item.endsWith(".db"))) {
  const database = new DatabaseSync(path, { readOnly: true });
  const integrity = quickCheck(database);
  database.close();

  if (integrity !== "ok") {
    throw new Error(
      `La comprobación del respaldo SQLite falló para ${path}: ${integrity}`,
    );
  }

  backupChecks.push({
    database: relative(backupRoot, path),
    quickCheck: integrity,
  });
}

console.log(
  JSON.stringify(
    {
      ok: true,
      backupRoot,
      databaseCount: backupChecks.length,
      fileCount: verified.length,
      totalBytes: verified.reduce((total, item) => total + item.bytes, 0),
      sourceChecks,
      backupChecks,
      verified,
    },
    null,
    2,
  ),
);

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export class PrivateStorageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class FileSystemPrivateStorage {
  constructor(root) {
    this.provider = "filesystem";
    this.root = resolve(root);
  }

  async put(key, bytes) {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    try {
      await writeFile(path, bytes, { flag: "wx" });
    } catch (error) {
      if (error.code === "EEXIST") throw new PrivateStorageError(409, "La clave privada del archivo ya existe.");
      throw error;
    }
    return { provider: this.provider, key: normalizeKey(key), size: bytes.length };
  }

  async get(key) {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if (error.code === "ENOENT") throw new PrivateStorageError(410, "El archivo privado ya no est\u00e1 disponible.");
      throw error;
    }
  }

  async delete(key) {
    try {
      await unlink(this.pathFor(key));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }

  pathFor(key) {
    const safeKey = normalizeKey(key);
    const path = resolve(this.root, ...safeKey.split("/"));
    if (path !== this.root && !path.startsWith(`${this.root}${sep}`))
      throw new PrivateStorageError(400, "La clave privada del archivo no es v\u00e1lida.");
    return path;
  }
}

export class MemoryPrivateStorage {
  constructor() {
    this.provider = "memory";
    this.files = new Map();
  }

  async put(key, bytes) {
    const safeKey = normalizeKey(key);
    if (this.files.has(safeKey)) throw new PrivateStorageError(409, "La clave privada del archivo ya existe.");
    const data = Buffer.from(bytes);
    this.files.set(safeKey, data);
    return { provider: this.provider, key: safeKey, size: data.length };
  }

  async get(key) {
    const data = this.files.get(normalizeKey(key));
    if (!data) throw new PrivateStorageError(410, "El archivo privado ya no est\u00e1 disponible.");
    return Buffer.from(data);
  }

  async delete(key) {
    this.files.delete(normalizeKey(key));
  }
}

export class S3PrivateStorage {
  constructor({ bucket, region, endpoint = "", accessKeyId, secretAccessKey, forcePathStyle = false }) {
    this.provider = "s3";
    this.bucket = bucket;
    this.client = new S3Client({
      region,
      ...(endpoint ? { endpoint } : {}),
      forcePathStyle: Boolean(forcePathStyle),
      credentials: { accessKeyId, secretAccessKey },
      maxAttempts: 3,
    });
  }

  async put(key, bytes) {
    const safeKey = normalizeKey(key);
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket,
        Key: safeKey,
        Body: bytes,
        ContentType: "application/octet-stream",
        CacheControl: "private, no-store",
      }));
      return { provider: this.provider, key: safeKey, size: bytes.length };
    } catch (error) {
      throw storageFailure(error, "No fue posible guardar el archivo en el almacenamiento privado.");
    }
  }

  async get(key) {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }));
      if (!result.Body) throw new PrivateStorageError(410, "El archivo privado ya no est\u00e1 disponible.");
      return Buffer.from(await result.Body.transformToByteArray());
    } catch (error) {
      if (error instanceof PrivateStorageError) throw error;
      if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404)
        throw new PrivateStorageError(410, "El archivo privado ya no est\u00e1 disponible.");
      throw storageFailure(error, "No fue posible leer el archivo del almacenamiento privado.");
    }
  }

  async delete(key) {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: normalizeKey(key) }));
    } catch (error) {
      throw storageFailure(error, "No fue posible retirar el archivo incompleto del almacenamiento privado.");
    }
  }
}

class UnconfiguredPrivateStorage {
  constructor() {
    this.provider = "unconfigured";
  }

  async put() { throw unavailable(); }
  async get() { throw unavailable(); }
  async delete() {}
}

export function createPrivateStorage({ provider, root, isPostgres = false } = {}) {
  const selected = String(provider ?? "").trim().toLowerCase();
  if (selected === "filesystem" || (!selected && !isPostgres)) return new FileSystemPrivateStorage(root);
  if (selected === "s3") {
    const settings = {
      bucket: String(process.env.ERP_PRIVATE_STORAGE_BUCKET ?? "").trim(),
      region: String(process.env.ERP_PRIVATE_STORAGE_REGION ?? "auto").trim(),
      endpoint: String(process.env.ERP_PRIVATE_STORAGE_ENDPOINT ?? "").trim(),
      accessKeyId: String(process.env.ERP_PRIVATE_STORAGE_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: String(process.env.ERP_PRIVATE_STORAGE_SECRET_ACCESS_KEY ?? "").trim(),
      forcePathStyle: /^(1|true|yes)$/i.test(String(process.env.ERP_PRIVATE_STORAGE_FORCE_PATH_STYLE ?? "")),
    };
    if (settings.bucket && settings.region && settings.accessKeyId && settings.secretAccessKey)
      return new S3PrivateStorage(settings);
  }
  return new UnconfiguredPrivateStorage();
}

function normalizeKey(key) {
  const value = String(key ?? "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!value || value.includes("\0") || value.split("/").some((part) => !part || part === "." || part === ".."))
    throw new PrivateStorageError(400, "La clave privada del archivo no es v\u00e1lida.");
  return value;
}

function unavailable() {
  return new PrivateStorageError(503,
    "Configura un proveedor de almacenamiento privado antes de cargar o descargar CFDI de n\u00f3mina.");
}

function storageFailure(error, fallback) {
  if (error instanceof PrivateStorageError) return error;
  const status = Number(error?.$metadata?.httpStatusCode || 0);
  if (status === 401 || status === 403) return new PrivateStorageError(503,
    "Las credenciales del almacenamiento privado no tienen acceso al contenedor configurado.");
  return new PrivateStorageError(503, fallback);
}

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password, storedHash) {
  try {
    const [algorithm, salt, expectedHex] = String(storedHash).split("$");
    if (algorithm !== "scrypt" || !salt || !expectedHex) return false;
    const expected = Buffer.from(expectedHex, "hex");
    const actual = scryptSync(password, salt, expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function createOpaqueToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function validatePassword(password) {
  const errors = [];
  if (typeof password !== "string" || password.length < 10) errors.push("Debe tener al menos 10 caracteres.");
  if (!/[A-ZÁÉÍÓÚÑ]/.test(password)) errors.push("Debe incluir una mayúscula.");
  if (!/[a-záéíóúñ]/.test(password)) errors.push("Debe incluir una minúscula.");
  if (!/\d/.test(password)) errors.push("Debe incluir un número.");
  if (!/[^\p{L}\p{N}\s]/u.test(password)) errors.push("Debe incluir un símbolo.");
  return errors;
}

export function parseCookies(header = "") {
  return Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return index === -1
          ? [decodeURIComponent(part), ""]
          : [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );
}

export function sessionCookie(token, maxAgeSeconds) {
  return `erp_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookie() {
  return "erp_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0";
}

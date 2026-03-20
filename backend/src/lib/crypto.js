import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";

const ALGORITHM = "aes-256-gcm";
const VERSION_PREFIX = "enc:v1:";

function getKey() {
  const secret = config.encryptionSecret;
  if (!secret) {
    return null;
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptText(value) {
  if (!value) {
    return value;
  }

  const key = getKey();
  if (!key) {
    return value;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64")}`;
}

export function decryptText(value) {
  if (!value || typeof value !== "string") {
    return value;
  }
  if (!value.startsWith(VERSION_PREFIX)) {
    return value;
  }

  const key = getKey();
  if (!key) {
    return value;
  }

  const payload = Buffer.from(value.slice(VERSION_PREFIX.length), "base64");
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
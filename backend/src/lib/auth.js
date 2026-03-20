import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

// =====================
// PASSWORD
// =====================
export async function hashPassword(password) {
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// =====================
// TOKEN CONFIG
// =====================
const ACCESS_EXPIRES_IN =
  process.env.JWT_EXPIRES_IN || config.jwtExpiresIn || "15m";

const REFRESH_EXPIRES_IN =
  process.env.JWT_REFRESH_EXPIRES_IN || "7d";

const JWT_ISSUER = "leadflow-api";
const JWT_AUDIENCE = "leadflow-users";

// =====================
// ACCESS TOKEN
// =====================
export function signAccessToken(payload) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: ACCESS_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyAccessToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

// =====================
// REFRESH TOKEN
// =====================
export function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: REFRESH_EXPIRES_IN,
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, config.jwtSecret, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}

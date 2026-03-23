import dotenv from "dotenv";

dotenv.config();

// =====================
// REQUIRED ENV VARS
// =====================
const required = ["DATABASE_URL", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// =====================
// CONFIG OBJECT
// =====================
export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",

  port: Number(process.env.PORT || 8080),

  // =====================
  // DATABASE
  // =====================
  databaseUrl: process.env.DATABASE_URL,

  // =====================
  // AUTH
  // =====================
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "15m",
  jwtRefreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",

  // =====================
  // URLS
  // =====================
  frontendUrl:
    process.env.FRONTEND_URL ||
    (process.env.NODE_ENV !== "production"
      ? "http://localhost:5173"
      : ""),

  apiBaseUrl:
    process.env.API_BASE_URL ||
    process.env.VITE_API_URL ||
    "http://localhost:8080",

  appUrl: process.env.APP_URL || "",

  // =====================
  // EMAIL (SMTP)
  // =====================
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom:
    process.env.SMTP_FROM || "LeadFlow Pro <noreply@leadflow.pro>",

  // =====================
  // PAYMENTS (MOLLIE)
  // =====================
  mollieApiKey: process.env.MOLLIE_API_KEY || "",
  mollieWebhookUrl: process.env.MOLLIE_WEBHOOK_URL || "",

  // =====================
  // REDIS (QUEUE / JOBS)
  // =====================
  redisUrl: process.env.REDIS_URL || "",

  // =====================
  // LOGGING
  // =====================
  logLevel:
    process.env.LOG_LEVEL ||
    (process.env.NODE_ENV === "production" ? "info" : "debug"),

  // =====================
  // SECURITY
  // =====================
  totpIssuer: process.env.TOTP_ISSUER || "LeadFlow Pro",

  encryptionSecret:
    process.env.ENCRYPTION_KEY ||
    process.env.JWT_SECRET || "",
};

// =====================
// SAFETY CHECKS
// =====================
if (config.isProduction && !config.frontendUrl) {
  throw new Error("Missing FRONTEND_URL in production");
}

if (config.isProduction && !process.env.ENCRYPTION_KEY) {
  throw new Error("Missing ENCRYPTION_KEY in production");
}

// =====================
// FEATURE FLAGS
// =====================
export const hasSmtpConfig = Boolean(
  config.smtpHost && config.smtpUser && config.smtpPass
);

export const hasMollieConfig = Boolean(
  config.mollieApiKey && config.mollieWebhookUrl
);

export const hasRedis = Boolean(config.redisUrl);

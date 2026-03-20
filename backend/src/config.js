import dotenv from "dotenv";

dotenv.config();

const required = ["DATABASE_URL", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    // Keep startup strict for production safety.
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  frontendUrl:
    process.env.FRONTEND_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:5173"),
  apiBaseUrl: process.env.API_BASE_URL || process.env.VITE_API_URL || "http://localhost:8080",
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  smtpFrom: process.env.SMTP_FROM || "LeadFlow Pro <noreply@leadflow.pro>",
  mollieApiKey: process.env.MOLLIE_API_KEY || "",
  mollieWebhookUrl: process.env.MOLLIE_WEBHOOK_URL || "",
  redisUrl: process.env.REDIS_URL || "",
  logLevel: process.env.LOG_LEVEL || "info",
  totpIssuer: process.env.TOTP_ISSUER || "LeadFlow Pro",
  encryptionSecret: process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "",
};

if (config.nodeEnv === "production" && !config.frontendUrl) {
  throw new Error("Missing required environment variable in production: FRONTEND_URL");
}

if (config.nodeEnv === "production" && !process.env.ENCRYPTION_KEY) {
  throw new Error("Missing required environment variable in production: ENCRYPTION_KEY");
}

export const hasSmtpConfig = Boolean(config.smtpHost && config.smtpUser && config.smtpPass);
export const hasMollieConfig = Boolean(config.mollieApiKey && config.mollieWebhookUrl);
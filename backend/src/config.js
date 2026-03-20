export const config = {
  // environment
  nodeEnv: process.env.NODE_ENV || "development",

  // server
  port: Number(process.env.PORT || 8080),

  // frontend (CORS)
  frontendUrl: process.env.FRONTEND_URL || "",

  // security
  jwtSecret: process.env.JWT_SECRET || "change-this-in-production",

  // database (Prisma gebruikt deze direct, maar handig fallback)
  databaseUrl: process.env.DATABASE_URL || "",

  // optional app URL (voor emails / links / redirects)
  appUrl: process.env.APP_URL || "",

  // flags
  isProduction: process.env.NODE_ENV === "production",
};

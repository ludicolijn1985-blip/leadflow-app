export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  // frontend voor CORS
  frontendUrl: process.env.FRONTEND_URL ?? "",

  // security
  jwtSecret: process.env.JWT_SECRET ?? "change-this-in-production",

  // database (optioneel, Prisma gebruikt env direct)
  databaseUrl: process.env.DATABASE_URL ?? "",

  // extra (future proof)
  appUrl: process.env.APP_URL ?? "",
};

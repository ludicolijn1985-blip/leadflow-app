export const config = {
  nodeEnv: process.env.NODE_ENV ?? "development",

  frontendUrl: process.env.FRONTEND_URL ?? "",

  jwtSecret: process.env.JWT_SECRET ?? "change-this-in-production",

  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "15m",

  databaseUrl: process.env.DATABASE_URL ?? "",

  appUrl: process.env.APP_URL ?? "",
};

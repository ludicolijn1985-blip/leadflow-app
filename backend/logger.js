import pino from "pino";
import pinoHttp from "pino-http";

// basis logger
export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
});

// http logger middleware
export const httpLogger = pinoHttp({
  logger,
});

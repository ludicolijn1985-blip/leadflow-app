import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "../config.js";

export const logger = pino({
  level: config.logLevel,
  base: { service: "leadflow-pro-api" },
});

export const httpLogger = pinoHttp({ logger });
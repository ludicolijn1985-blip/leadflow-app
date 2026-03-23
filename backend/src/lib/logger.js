import pino from "pino";
import pinoHttp from "pino-http";
import { config } from "../config.js";

// =====================
// LOG LEVEL FIX
// =====================
const logLevel =
  process.env.LOG_LEVEL ||
  (config.nodeEnv === "production" ? "info" : "debug");

// =====================
// LOGGER INSTANCE
// =====================
export const logger = pino({
  level: logLevel,

  base: {
    service: "leadflow-pro-api",
  },

  timestamp: pino.stdTimeFunctions.isoTime,

  transport:
    config.nodeEnv !== "production"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
          },
        }
      : undefined,
});

// =====================
// HTTP LOGGER (EXPRESS)
// =====================
export const httpLogger = pinoHttp({
  logger,

  customLogLevel: function (res, err) {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },

  serializers: {
    req(req) {
      return {
        method: req.method,
        url: req.url,
        ip: req.ip,
      };
    },
    res(res) {
      return {
        statusCode: res.statusCode,
      };
    },
  },
});

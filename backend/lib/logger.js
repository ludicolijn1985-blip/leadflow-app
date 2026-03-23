<<<<<<< HEAD
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
=======
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
>>>>>>> 723ebace39b0a61ddbbb72d2eec8cdce0ff2745d

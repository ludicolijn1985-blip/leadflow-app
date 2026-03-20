import { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

// 🔥 voorkom meerdere instanties (belangrijk voor dev + serverless)
const globalForPrisma = globalThis;

// singleton pattern
export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: config.isProduction
      ? ["error"]
      : ["query", "info", "warn", "error"],
  });

// sla instance op in global (alleen buiten productie)
if (!config.isProduction) {
  globalForPrisma.prisma = prisma;
}

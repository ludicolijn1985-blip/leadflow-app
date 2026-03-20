import { prisma } from "./prisma.js";

export async function createAuditLog({ userId, action, entityType, entityId, metadata }) {
  if (!userId || !action || !entityType) {
    return;
  }

  await prisma.auditLog.create({
    data: {
      userId,
      action,
      entityType,
      entityId: entityId || null,
      metadata: metadata || undefined,
    },
  });
}
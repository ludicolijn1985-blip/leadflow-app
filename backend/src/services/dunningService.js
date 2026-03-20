import { prisma } from "../lib/prisma.js";
import { sendSystemEmail } from "./mailService.js";

const RETRY_OFFSETS_DAYS = [1, 3, 7];

export async function scheduleDunningRetry(subscriptionId) {
  const attempts = await prisma.dunningEvent.count({ where: { subscriptionId } });
  const attemptNumber = attempts + 1;
  const offsetDays = RETRY_OFFSETS_DAYS[Math.min(attemptNumber - 1, RETRY_OFFSETS_DAYS.length - 1)];
  const scheduledFor = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);

  return prisma.dunningEvent.create({
    data: {
      subscriptionId,
      attemptNumber,
      status: "scheduled",
      message: `Retry payment attempt ${attemptNumber}`,
      scheduledFor,
    },
  });
}

export async function resolveDunningEvents(subscriptionId) {
  return prisma.dunningEvent.updateMany({
    where: { subscriptionId, status: { in: ["scheduled", "sent"] } },
    data: { status: "resolved", processedAt: new Date() },
  });
}

export async function processDueDunningEvents(userId) {
  const now = new Date();
  const dueEvents = await prisma.dunningEvent.findMany({
    where: {
      status: "scheduled",
      scheduledFor: { lte: now },
      ...(userId ? { subscription: { userId } } : {}),
    },
    include: {
      subscription: {
        include: {
          user: { select: { id: true, email: true, name: true } },
        },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 100,
  });

  let processed = 0;
  let failed = 0;

  for (const event of dueEvents) {
    try {
      await sendSystemEmail({
        to: event.subscription.user.email,
        subject: `LeadFlow Pro payment retry attempt ${event.attemptNumber}`,
        html: `<p>Hello ${event.subscription.user.name},</p><p>Your payment for plan <strong>${event.subscription.plan}</strong> needs attention. Please update your billing method to keep your account active.</p>`,
      });

      await prisma.dunningEvent.update({
        where: { id: event.id },
        data: {
          status: "sent",
          processedAt: new Date(),
          message: `Retry reminder sent (attempt ${event.attemptNumber})`,
        },
      });

      if (event.attemptNumber === 1) {
        await prisma.subscription.update({ where: { id: event.subscriptionId }, data: { status: "pending" } });
      }

      if (event.attemptNumber >= RETRY_OFFSETS_DAYS.length) {
        await prisma.$transaction([
          prisma.subscription.update({ where: { id: event.subscriptionId }, data: { status: "canceled" } }),
          prisma.user.update({ where: { id: event.subscription.user.id }, data: { plan: "starter" } }),
        ]);
      }
      processed += 1;
    } catch {
      failed += 1;
      await prisma.dunningEvent.update({
        where: { id: event.id },
        data: { status: "failed", processedAt: new Date(), message: "Retry reminder failed" },
      });
    }
  }

  return { processed, failed };
}

export function getDunningStage(attemptNumber) {
  if (attemptNumber <= 1) {
    return "grace";
  }
  if (attemptNumber >= RETRY_OFFSETS_DAYS.length) {
    return "suspended";
  }
  return "warning";
}

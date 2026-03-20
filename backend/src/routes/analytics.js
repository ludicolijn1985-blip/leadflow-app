import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

function dateRangeFilter(req) {
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : null;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : null;

  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    return null;
  }

  if (!from && !to) {
    return undefined;
  }

  return {
    ...(from ? { gte: from } : {}),
    ...(to ? { lte: to } : {}),
  };
}

router.get("/funnel", async (req, res, next) => {
  try {
    const createdAt = dateRangeFilter(req);
    if (createdAt === null) {
      return res.status(400).json({ error: "Invalid from/to date filter" });
    }

    const whereBase = { userId: req.user.id, ...(createdAt ? { createdAt } : {}) };
    const [leadCreated, emailSent, emailOpened, replies] = await Promise.all([
      prisma.funnelEvent.count({ where: { ...whereBase, eventType: "lead_created" } }),
      prisma.funnelEvent.count({ where: { ...whereBase, eventType: "email_sent" } }),
      prisma.funnelEvent.count({ where: { ...whereBase, eventType: "email_opened" } }),
      prisma.funnelEvent.count({ where: { ...whereBase, eventType: "reply_received" } }),
    ]);

    const sourceRows = await prisma.funnelEvent.groupBy({
      by: ["source"],
      where: { ...whereBase, eventType: "reply_received" },
      _count: { _all: true },
      orderBy: { _count: { source: "desc" } },
    });

    const variantRows = await prisma.emailLog.groupBy({
      by: ["variantId"],
      where: { userId: req.user.id, variantId: { not: null }, ...(createdAt ? { sentAt: createdAt } : {}) },
      _count: { _all: true },
    });

    return res.json({
      funnel: { leadCreated, emailSent, emailOpened, replies },
      attribution: sourceRows.map((row) => ({ source: row.source || "unknown", replies: row._count._all })),
      variantAttribution: variantRows.map((row) => ({ variantId: row.variantId, sent: row._count._all })),
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
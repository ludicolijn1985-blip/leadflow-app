import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/summary", async (req, res, next) => {
  try {
    const [leadCount, emailsSent, replies, recentLeads, recentCampaigns] = await Promise.all([
      prisma.lead.count({ where: { userId: req.user.id } }),
      prisma.emailLog.count({ where: { userId: req.user.id } }),
      prisma.emailLog.count({ where: { userId: req.user.id, status: "replied" } }),
      prisma.lead.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.campaign.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: "desc" }, take: 6 }),
    ]);

    const conversion = emailsSent ? Number(((replies / emailsSent) * 100).toFixed(2)) : 0;
    const estimatedRevenue = replies * req.user.dealValue;

    return res.json({
      leadCount,
      emailsSent,
      replies,
      conversion,
      estimatedRevenue,
      recentLeads,
      recentCampaigns,
      dealValue: req.user.dealValue,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/deal-value", async (req, res, next) => {
  try {
    const value = Number(req.body.dealValue);
    if (!Number.isInteger(value) || value < 0 || value > 1000000) {
      return res.status(400).json({ error: "Invalid deal value" });
    }

    const updated = await prisma.user.update({ where: { id: req.user.id }, data: { dealValue: value } });
    return res.json({ dealValue: updated.dealValue });
  } catch (error) {
    return next(error);
  }
});

export default router;
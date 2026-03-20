import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

router.get("/summary", async (_req, res, next) => {
  try {
    const [totalUsers, totalLeads, totalCampaigns, totalEmailsSent, replies] = await Promise.all([
      prisma.user.count(),
      prisma.lead.count(),
      prisma.campaign.count(),
      prisma.emailLog.count(),
      prisma.emailLog.count({ where: { status: "replied" } }),
    ]);

    const conversion = totalEmailsSent ? Number(((replies / totalEmailsSent) * 100).toFixed(2)) : 0;

    const [latestUsers, latestCampaigns, users] = await Promise.all([
      prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 8 }),
      prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { user: true }, take: 8 }),
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { leads: true, campaigns: true, emailLogs: true },
          },
        },
      }),
    ]);

    return res.json({
      totals: { totalUsers, totalLeads, totalCampaigns, totalEmailsSent, conversion },
      latestUsers,
      latestCampaigns,
      users,
    });
  } catch (error) {
    return next(error);
  }
});

router.patch("/users/:id/plan", async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!["starter", "pro", "agency"].includes(plan)) {
      return res.status(400).json({ error: "Invalid plan" });
    }
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { plan } });
    return res.json(user);
  } catch (error) {
    return next(error);
  }
});

router.get("/worker-health", async (_req, res, next) => {
  try {
    const since = new Date(Date.now() - 1000 * 60 * 30);
    const [lastHeartbeat, completedJobs, failedJobs] = await Promise.all([
      prisma.jobLog.findFirst({
        where: { jobType: "worker-heartbeat" },
        orderBy: { createdAt: "desc" },
      }),
      prisma.jobLog.count({ where: { jobType: "campaign-send", status: "completed", createdAt: { gte: since } } }),
      prisma.jobLog.count({ where: { jobType: "campaign-send", status: "failed", createdAt: { gte: since } } }),
    ]);

    return res.json({
      workerOnline: Boolean(lastHeartbeat && Date.now() - new Date(lastHeartbeat.createdAt).getTime() < 1000 * 60 * 2),
      lastHeartbeatAt: lastHeartbeat?.createdAt || null,
      completedJobs30m: completedJobs,
      failedJobs30m: failedJobs,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
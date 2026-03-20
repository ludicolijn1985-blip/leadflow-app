import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { campaignCreateSchema, campaignFlowSchema, campaignVariantSchema, sendCampaignSchema, validate } from "../lib/validators.js";
import { enqueueCampaignSendJob } from "../services/queueService.js";

const router = Router();

router.get("/", async (req, res, next) => {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: req.user.id },
      include: {
        _count: { select: { campaignLeads: true, emailLogs: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return res.json(campaigns);
  } catch (error) {
    return next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const input = validate(campaignCreateSchema, req.body);
    const campaign = await prisma.campaign.create({
      data: {
        userId: req.user.id,
        name: input.name,
        subject: input.subject,
        bodyTemplate: input.bodyTemplate,
        campaignLeads: {
          create: input.leadIds.map((leadId) => ({ leadId })),
        },
      },
      include: { campaignLeads: true },
    });
    await prisma.funnelEvent.create({
      data: {
        userId: req.user.id,
        campaignId: campaign.id,
        eventType: "campaign_launched",
        source: "campaign-create",
      },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "campaign.created",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { leadCount: input.leadIds.length },
    });
    return res.status(201).json(campaign);
  } catch (error) {
    return next(error);
  }
});

router.post("/variants", async (req, res, next) => {
  try {
    const input = validate(campaignVariantSchema, req.body);
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, userId: req.user.id } });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    await prisma.$transaction([
      prisma.campaignVariant.deleteMany({ where: { campaignId: campaign.id } }),
      prisma.campaignVariant.createMany({
        data: input.variants.map((variant) => ({
          campaignId: campaign.id,
          label: variant.label,
          subject: variant.subject,
          bodyTemplate: variant.bodyTemplate,
          trafficPercent: variant.trafficPercent,
        })),
      }),
    ]);

    const variants = await prisma.campaignVariant.findMany({ where: { campaignId: campaign.id } });
    await createAuditLog({
      userId: req.user.id,
      action: "campaign.variants.updated",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { variants: variants.map((variant) => variant.label) },
    });
    return res.json(variants);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/variants", async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const variants = await prisma.campaignVariant.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } });
    return res.json(variants);
  } catch (error) {
    return next(error);
  }
});

router.post("/flow", async (req, res, next) => {
  try {
    const input = validate(campaignFlowSchema, req.body);
    const campaign = await prisma.campaign.findFirst({ where: { id: input.campaignId, userId: req.user.id } });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    await prisma.$transaction([
      prisma.campaignStep.deleteMany({ where: { campaignId: campaign.id } }),
      prisma.campaignStep.createMany({
        data: input.steps.map((step) => ({
          campaignId: campaign.id,
          nodeId: step.nodeId,
          stepType: step.stepType,
          delayHours: step.delayHours,
          config: step.config,
          positionX: step.positionX,
          positionY: step.positionY,
        })),
      }),
    ]);

    const steps = await prisma.campaignStep.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } });
    await createAuditLog({
      userId: req.user.id,
      action: "campaign.flow.updated",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { stepCount: steps.length },
    });
    return res.json(steps);
  } catch (error) {
    return next(error);
  }
});

router.get("/:id/flow", async (req, res, next) => {
  try {
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, userId: req.user.id } });
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    const steps = await prisma.campaignStep.findMany({ where: { campaignId: campaign.id }, orderBy: { createdAt: "asc" } });
    return res.json(steps);
  } catch (error) {
    return next(error);
  }
});

router.post("/send", async (req, res, next) => {
  try {
    const input = validate(sendCampaignSchema, req.body);
    const campaign = await prisma.campaign.findFirst({
      where: { id: input.campaignId, userId: req.user.id },
      include: {
        campaignLeads: {
          include: { lead: true },
        },
      },
    });

    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }

    const selectedLeads = campaign.campaignLeads
      .map((item) => item.lead)
      .filter((lead) => lead.email)
      .filter((lead) => (input.leadIds?.length ? input.leadIds.includes(lead.id) : true));

    for (const lead of selectedLeads) {
      await enqueueCampaignSendJob({ userId: req.user.id, campaignId: campaign.id, leadId: lead.id, followUp: Boolean(input.followUp) });
    }

    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "active" } });
    await createAuditLog({
      userId: req.user.id,
      action: "campaign.send.triggered",
      entityType: "campaign",
      entityId: campaign.id,
      metadata: { queuedLeads: selectedLeads.length },
    });

    return res.json({ sent: selectedLeads.length, queued: true });
  } catch (error) {
    return next(error);
  }
});

router.post("/:id/reply", async (req, res, next) => {
  try {
    const id = req.params.id;
    const log = await prisma.emailLog.findFirst({ where: { id, userId: req.user.id } });
    if (!log) {
      return res.status(404).json({ error: "Email log not found" });
    }

    const updated = await prisma.emailLog.update({
      where: { id },
      data: { status: "replied", repliedAt: new Date() },
    });

    await prisma.lead.update({ where: { id: updated.leadId }, data: { status: "replied" } });
    if (updated.variantId) {
      await prisma.campaignVariant.update({
        where: { id: updated.variantId },
        data: { replyCount: { increment: 1 } },
      });
    }
    await prisma.funnelEvent.create({
      data: {
        userId: req.user.id,
        campaignId: updated.campaignId,
        leadId: updated.leadId,
        eventType: "reply_received",
        source: "manual-reply",
      },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "email.reply.marked",
      entityType: "emailLog",
      entityId: updated.id,
    });

    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.get("/emails/logs", async (req, res, next) => {
  try {
    const logs = await prisma.emailLog.findMany({
      where: { userId: req.user.id },
      include: { campaign: true, lead: true },
      orderBy: { sentAt: "desc" },
      take: 100,
    });
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

export default router;
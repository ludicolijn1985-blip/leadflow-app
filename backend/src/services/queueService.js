import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";
import { sendCampaignToLead } from "./campaignService.js";

const redisConnection = config.redisUrl
  ? new IORedis(config.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    })
  : null;

const outboundQueue = redisConnection ? new Queue("outbound-email", { connection: redisConnection }) : null;

export async function enqueueCampaignSendJob(payload) {
  if (!outboundQueue) {
    logger.info("Redis queue disabled, processing campaign send inline");
    await processCampaignSendJob(payload);
    return { queued: false };
  }

  await outboundQueue.add("campaign-send", payload, {
    attempts: 3,
    removeOnComplete: 200,
    removeOnFail: 200,
  });
  return { queued: true };
}

export async function processCampaignSendJob(payload) {
  const { userId, campaignId, leadId } = payload;
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: campaignId, userId },
      include: { variants: true },
    });
    const lead = await prisma.lead.findFirst({ where: { id: leadId, userId } });
    if (!campaign || !lead?.email) {
      return;
    }

    await sendCampaignToLead({ userId, campaign, lead });
    await prisma.jobLog.create({
      data: {
        userId,
        jobType: "campaign-send",
        status: "completed",
        payload,
      },
    });
  } catch (error) {
    await prisma.jobLog.create({
      data: {
        userId,
        jobType: "campaign-send",
        status: "failed",
        payload,
        error: error instanceof Error ? error.message : "Unknown queue error",
      },
    });
    throw error;
  }
}

export function getQueueConnection() {
  return redisConnection;
}
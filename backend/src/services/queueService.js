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

const outboundQueue = redisConnection
  ? new Queue("outbound-email", {
      connection: redisConnection,
      defaultJobOptions: {
        attempts: 5,
        backoff: {
          type: "exponential",
          delay: 3000,
        },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    })
  : null;

// =====================
// ENQUEUE
// =====================
export async function enqueueCampaignSendJob(payload) {
  if (!outboundQueue) {
    logger.warn("⚠️ Redis disabled → running inline job");
    await processCampaignSendJob(payload);
    return { queued: false };
  }

  await outboundQueue.add("campaign-send", payload, {
    jobId: `${payload.campaignId}-${payload.leadId}`, // voorkomt duplicates
  });

  return { queued: true };
}

// =====================
// PROCESS JOB
// =====================
export async function processCampaignSendJob(payload) {
  const { userId, campaignId, leadId } = payload;

  try {
    const [campaign, lead] = await Promise.all([
      prisma.campaign.findFirst({
        where: { id: campaignId, userId },
        include: { variants: true },
      }),
      prisma.lead.findFirst({
        where: { id: leadId, userId },
      }),
    ]);

    if (!campaign || !lead?.email) {
      logger.warn("⚠️ Skipping job - missing campaign or email", payload);
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

    logger.info(`✅ Email sent → ${lead.email}`);
  } catch (error) {
    logger.error("❌ Job failed", error);

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

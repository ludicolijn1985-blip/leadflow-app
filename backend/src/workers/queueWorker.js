import { Worker } from "bullmq";
import { getQueueConnection, processCampaignSendJob } from "../services/queueService.js";
import { logger } from "../lib/logger.js";
import { prisma } from "../lib/prisma.js";

let worker = null;
let heartbeatTimer = null;

async function writeHeartbeat() {
  await prisma.jobLog.create({
    data: {
      jobType: "worker-heartbeat",
      status: "alive",
      payload: { ts: new Date().toISOString() },
    },
  });
}

export function startQueueWorker() {
  const connection = getQueueConnection();
  if (!connection) {
    logger.info("Queue worker not started because REDIS_URL is not configured");
    return;
  }

  worker = new Worker(
    "outbound-email",
    async (job) => {
      if (job.name === "campaign-send") {
        await processCampaignSendJob(job.data);
      }
    },
    { connection }
  );

  worker.on("completed", (job) => {
    logger.info({ jobId: job.id, name: job.name }, "Queue job completed");
  });

  worker.on("failed", (job, error) => {
    logger.error({ jobId: job?.id, error: error.message }, "Queue job failed");
  });

  void writeHeartbeat();
  heartbeatTimer = setInterval(() => {
    void writeHeartbeat();
  }, 60_000);

  const shutdown = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (worker) {
      await worker.close();
      worker = null;
    }
    await prisma.$disconnect();
    process.exit(0);
  };

  process.once("SIGTERM", () => {
    void shutdown();
  });
  process.once("SIGINT", () => {
    void shutdown();
  });
}
import { Worker } from "bullmq";
import { getQueueConnection, processCampaignSendJob } from "../services/queueService.js";
import { logger } from "../lib/logger.js";

const connection = getQueueConnection();

if (!connection) {
  logger.warn("⚠️ No Redis → worker disabled");
  process.exit(0);
}

const worker = new Worker(
  "outbound-email",
  async (job) => {
    await processCampaignSendJob(job.data);
  },
  {
    connection,
    concurrency: 5,
    limiter: {
      max: 20,
      duration: 1000,
    },
  }
);

worker.on("completed", (job) => {
  logger.info(`✅ Job completed: ${job.id}`);
});

worker.on("failed", (job, err) => {
  logger.error(`❌ Job failed: ${job?.id}`, err);
});

logger.info("🚀 Email worker started");
import { Router } from "express";
import { prisma } from "../lib/prisma.js";

const router = Router();

const onePixel = Buffer.from(
  "R0lGODlhAQABAIABAP///wAAACwAAAAAAQABAAACAkQBADs=",
  "base64"
);

router.get("/open/:trackingId.png", async (req, res) => {
  const { trackingId } = req.params;
  const log = await prisma.emailLog.findUnique({ where: { trackingId } });
  if (log && log.status === "sent") {
    const updates = [
      prisma.emailLog.update({ where: { id: log.id }, data: { status: "opened", openedAt: new Date() } }),
      prisma.funnelEvent.create({
        data: {
          userId: log.userId,
          campaignId: log.campaignId,
          leadId: log.leadId,
          eventType: "email_opened",
          source: "tracking-pixel",
        },
      }),
    ];

    if (log.variantId) {
      updates.push(prisma.campaignVariant.update({ where: { id: log.variantId }, data: { openCount: { increment: 1 } } }));
    }

    await prisma.$transaction(updates);
  }
  res.setHeader("Content-Type", "image/gif");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  return res.status(200).send(onePixel);
});

export default router;
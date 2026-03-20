import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { renderTemplate, sendLeadEmail } from "./mailService.js";

function pickVariant(variants) {
  if (!variants.length) {
    return null;
  }

  const totalWeight = variants.reduce((acc, variant) => acc + variant.trafficPercent, 0);
  if (!totalWeight) {
    const sorted = [...variants].sort((a, b) => a.sentCount - b.sentCount);
    return sorted[0];
  }

  let threshold = Math.random() * totalWeight;
  for (const variant of variants) {
    threshold -= variant.trafficPercent;
    if (threshold <= 0) {
      return variant;
    }
  }

  return variants[variants.length - 1];
}

export async function sendCampaignToLead({ userId, campaign, lead }) {
  const variant = pickVariant(campaign.variants || []);
  const templateSubject = variant ? variant.subject : campaign.subject;
  const templateBody = variant ? variant.bodyTemplate : campaign.bodyTemplate;
  const trackingId = randomUUID();
  const subject = renderTemplate(templateSubject, lead);
  const body = renderTemplate(templateBody, lead);
  const trackingPixel = `${config.apiBaseUrl}/api/tracking/open/${trackingId}.png`;
  const html = `<div>${body.replaceAll("\n", "<br/>")}</div><img src="${trackingPixel}" width="1" height="1" alt="" />`;

  const response = await sendLeadEmail({ to: lead.email, subject, html });

  const log = await prisma.emailLog.create({
    data: {
      userId,
      campaignId: campaign.id,
      leadId: lead.id,
      variantId: variant?.id || null,
      toEmail: lead.email,
      subject,
      body,
      status: "sent",
      trackingId,
      providerId: response.messageId || null,
    },
  });

  if (variant) {
    await prisma.campaignVariant.update({
      where: { id: variant.id },
      data: { sentCount: { increment: 1 } },
    });
  }

  await prisma.$transaction([
    prisma.lead.update({ where: { id: lead.id }, data: { status: "contacted" } }),
    prisma.funnelEvent.create({
      data: {
        userId,
        campaignId: campaign.id,
        leadId: lead.id,
        eventType: "email_sent",
        source: lead.source || "campaign",
      },
    }),
    prisma.usageRecord.create({
      data: {
        userId,
        metric: "emails_sent",
        quantity: 1,
        amountCents: 5,
        periodKey: new Date().toISOString().slice(0, 7),
      },
    }),
  ]);

  return log;
}

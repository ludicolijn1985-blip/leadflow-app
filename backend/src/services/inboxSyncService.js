import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "../lib/prisma.js";

function normalizeMessageId(value) {
  if (!value) {
    return "";
  }
  return String(value).replace(/[<>]/g, "").trim();
}

export async function syncMailboxReplies(userId, connection) {
  const client = new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: {
      user: connection.username,
      pass: connection.password,
    },
  });

  let detectedReplies = 0;
  await client.connect();
  try {
    const logs = await prisma.emailLog.findMany({
      where: { userId, providerId: { not: null }, status: { not: "replied" } },
      select: { id: true, leadId: true, campaignId: true, providerId: true },
    });
    const logsByProviderId = new Map(logs.map((log) => [normalizeMessageId(log.providerId), log]));
    const processedLogIds = new Set();

    const lock = await client.getMailboxLock("INBOX");
    try {
      const query = connection.lastSyncedAt ? { since: connection.lastSyncedAt } : { all: true };
      for await (const message of client.fetch(query, { envelope: true, source: true })) {
        const parsed = await simpleParser(message.source);
        const inReplyTo = normalizeMessageId(parsed.inReplyTo);
        if (!inReplyTo) {
          continue;
        }

        const matched = logsByProviderId.get(inReplyTo);
        if (!matched) {
          continue;
        }
        if (processedLogIds.has(matched.id)) {
          continue;
        }
        processedLogIds.add(matched.id);

        await prisma.$transaction([
          prisma.emailLog.update({
            where: { id: matched.id },
            data: { status: "replied", repliedAt: new Date() },
          }),
          prisma.lead.update({ where: { id: matched.leadId }, data: { status: "replied" } }),
          prisma.funnelEvent.create({
            data: {
              userId,
              campaignId: matched.campaignId,
              leadId: matched.leadId,
              eventType: "reply_received",
              source: "inbox-sync",
            },
          }),
        ]);
        detectedReplies += 1;
      }
    } finally {
      lock.release();
    }

    await prisma.mailboxConnection.update({
      where: { id: connection.id },
      data: { lastSyncedAt: new Date() },
    });
  } finally {
    await client.logout();
  }

  return { detectedReplies };
}
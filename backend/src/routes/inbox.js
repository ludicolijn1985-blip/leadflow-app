import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { mailboxSchema, validate } from "../lib/validators.js";
import { decryptText, encryptText } from "../lib/crypto.js";
import { syncMailboxReplies } from "../services/inboxSyncService.js";

const router = Router();

router.get("/status", async (req, res, next) => {
  try {
    const connection = await prisma.mailboxConnection.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    return res.json({
      connected: Boolean(connection),
      lastSyncedAt: connection?.lastSyncedAt || null,
      username: connection?.username || null,
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/connection", async (req, res, next) => {
  try {
    const connection = await prisma.mailboxConnection.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    if (!connection) {
      return res.json(null);
    }

    return res.json({
      id: connection.id,
      host: connection.host,
      port: connection.port,
      secure: connection.secure,
      username: connection.username,
      lastSyncedAt: connection.lastSyncedAt,
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/connection", async (req, res, next) => {
  try {
    const input = validate(mailboxSchema, req.body);
    const connection = await prisma.mailboxConnection.upsert({
      where: {
        userId_username: {
          userId: req.user.id,
          username: input.username,
        },
      },
      update: {
        host: input.host,
        port: input.port,
        secure: input.secure,
        password: encryptText(input.password),
      },
      create: {
        userId: req.user.id,
        host: input.host,
        port: input.port,
        secure: input.secure,
        username: input.username,
        password: encryptText(input.password),
      },
    });

    await createAuditLog({
      userId: req.user.id,
      action: "inbox.connection.saved",
      entityType: "mailboxConnection",
      entityId: connection.id,
    });
    return res.status(201).json({ id: connection.id, username: connection.username });
  } catch (error) {
    return next(error);
  }
});

router.post("/sync", async (req, res, next) => {
  try {
    const connection = await prisma.mailboxConnection.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    if (!connection) {
      return res.status(404).json({ error: "Mailbox is not connected" });
    }

    const result = await syncMailboxReplies(req.user.id, {
      ...connection,
      password: decryptText(connection.password),
    });
    await createAuditLog({
      userId: req.user.id,
      action: "inbox.synced",
      entityType: "mailboxConnection",
      entityId: connection.id,
      metadata: result,
    });
    return res.json({ ...result, lastSyncedAt: new Date().toISOString() });
  } catch (error) {
    return next(error);
  }
});

export default router;
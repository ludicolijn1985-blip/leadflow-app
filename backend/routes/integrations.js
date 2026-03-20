import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import { decryptText, encryptText } from "../lib/crypto.js";
import { crmSchema, validate } from "../lib/validators.js";
import { pushLeadToCRM } from "../services/crmService.js";

const router = Router();

router.get("/crm", async (req, res, next) => {
  try {
    const connections = await prisma.crmConnection.findMany({
      where: { userId: req.user.id, active: true },
      orderBy: { createdAt: "desc" },
    });
    return res.json(
      connections.map((item) => ({
        id: item.id,
        provider: item.provider,
        endpointUrl: item.endpointUrl,
        lastSyncAt: item.lastSyncAt,
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/crm", async (req, res, next) => {
  try {
    const input = validate(crmSchema, req.body);
    const connection = await prisma.crmConnection.upsert({
      where: {
        userId_provider: {
          userId: req.user.id,
          provider: input.provider,
        },
      },
      update: {
        accessToken: encryptText(input.accessToken),
        refreshToken: input.refreshToken ? encryptText(input.refreshToken) : null,
        endpointUrl: input.endpointUrl || null,
        active: true,
      },
      create: {
        userId: req.user.id,
        provider: input.provider,
        accessToken: encryptText(input.accessToken),
        refreshToken: input.refreshToken ? encryptText(input.refreshToken) : null,
        endpointUrl: input.endpointUrl || null,
      },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "crm.connection.saved",
      entityType: "crmConnection",
      entityId: connection.id,
      metadata: { provider: connection.provider },
    });
    return res.status(201).json({ id: connection.id, provider: connection.provider });
  } catch (error) {
    return next(error);
  }
});

router.post("/crm/sync", async (req, res, next) => {
  try {
    const { provider, leadIds } = req.body;
    if (!provider || !Array.isArray(leadIds) || !leadIds.length) {
      return res.status(400).json({ error: "provider and leadIds are required" });
    }

    const connection = await prisma.crmConnection.findFirst({
      where: { userId: req.user.id, provider, active: true },
    });
    if (!connection) {
      return res.status(404).json({ error: "CRM connection not found" });
    }

    const leads = await prisma.lead.findMany({
      where: { userId: req.user.id, id: { in: leadIds }, email: { not: null } },
    });

    let synced = 0;
    for (const lead of leads) {
      await pushLeadToCRM(
        {
          ...connection,
          accessToken: decryptText(connection.accessToken),
          refreshToken: connection.refreshToken ? decryptText(connection.refreshToken) : null,
        },
        lead
      );
      synced += 1;
    }

    await prisma.crmConnection.update({ where: { id: connection.id }, data: { lastSyncAt: new Date() } });
    await createAuditLog({
      userId: req.user.id,
      action: "crm.sync.completed",
      entityType: "crmConnection",
      entityId: connection.id,
      metadata: { provider: connection.provider, synced },
    });
    return res.json({ synced });
  } catch (error) {
    return next(error);
  }
});

router.delete("/crm/:provider", async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const connection = await prisma.crmConnection.findFirst({
      where: { userId: req.user.id, provider },
    });
    if (!connection) {
      return res.status(404).json({ error: "CRM connection not found" });
    }

    await prisma.crmConnection.update({ where: { id: connection.id }, data: { active: false } });
    await createAuditLog({
      userId: req.user.id,
      action: "crm.connection.disabled",
      entityType: "crmConnection",
      entityId: connection.id,
      metadata: { provider: connection.provider },
    });
    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

export default router;
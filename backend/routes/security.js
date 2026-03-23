import { Router } from "express";
import { authenticator } from "otplib";
import QRCode from "qrcode";
import { prisma } from "../lib/prisma.js";
import { config } from "../config.js";
import { createAuditLog } from "../lib/audit.js";
import { twoFactorVerifySchema, validate } from "../lib/validators.js";

const router = Router();

router.get("/2fa/setup", async (req, res, next) => {
  try {
    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(req.user.email, config.totpIssuer, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauth);
    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorSecret: secret, twoFactorEnabled: false },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "security.2fa.setup_initialized",
      entityType: "user",
      entityId: req.user.id,
    });
    return res.json({ qrDataUrl, secret });
  } catch (error) {
    return next(error);
  }
});

router.post("/2fa/enable", async (req, res, next) => {
  try {
    const input = validate(twoFactorVerifySchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.twoFactorSecret) {
      return res.status(400).json({ error: "2FA setup not initialized" });
    }

    const isValid = authenticator.verify({ token: input.token, secret: user.twoFactorSecret });
    if (!isValid) {
      return res.status(400).json({ error: "Invalid 2FA token" });
    }

    const recoveryCodes = Array.from({ length: 8 }, () => Math.random().toString(36).slice(2, 10));
    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorEnabled: true, twoFactorRecoveryCodes: recoveryCodes },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "security.2fa.enabled",
      entityType: "user",
      entityId: req.user.id,
    });
    return res.json({ enabled: true, recoveryCodes });
  } catch (error) {
    return next(error);
  }
});

router.post("/2fa/disable", async (req, res, next) => {
  try {
    const input = validate(twoFactorVerifySchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.twoFactorSecret || !user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA is not enabled" });
    }

    const isValid = authenticator.verify({ token: input.token, secret: user.twoFactorSecret });
    if (!isValid) {
      return res.status(400).json({ error: "Invalid 2FA token" });
    }

    await prisma.user.update({
      where: { id: req.user.id },
      data: { twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null },
    });
    await createAuditLog({
      userId: req.user.id,
      action: "security.2fa.disabled",
      entityType: "user",
      entityId: req.user.id,
    });
    return res.json({ enabled: false });
  } catch (error) {
    return next(error);
  }
});

router.get("/audit-logs", async (req, res, next) => {
  try {
    const take = Number(req.query.take || 200);
    const userId = typeof req.query.userId === "string" ? req.query.userId : req.user.id;
    const action = typeof req.query.action === "string" ? req.query.action : undefined;
    const where = {
      userId: req.user.role === "admin" ? userId : req.user.id,
      ...(action ? { action: { contains: action } } : {}),
    };

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Number.isFinite(take) ? Math.min(Math.max(take, 1), 500) : 200,
    });
    return res.json(logs);
  } catch (error) {
    return next(error);
  }
});

export default router;
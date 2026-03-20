import { Router } from "express";
import { authenticator } from "otplib";
import { Plan, UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  hashPassword,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from "../lib/auth.js";
import {
  loginSchema,
  registerSchema,
  twoFactorLoginSchema,
  validate,
} from "../lib/validators.js";
import { createMollieCustomer } from "../services/mollieService.js";
import { ensureDemoData } from "../services/demoService.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

// =====================
// SESSION HELPER
// =====================
function issueSession(user) {
  const token = signAccessToken({
    sub: user.id,
    role: user.role,
    email: user.email,
  });

  return {
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan,
      dealValue: user.dealValue,
      twoFactorEnabled: user.twoFactorEnabled,
    },
  };
}

// =====================
// REGISTER
// =====================
router.post("/register", async (req, res, next) => {
  try {
    const input = validate(registerSchema, req.body);

    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (existing) {
      return res.status(409).json({ error: "Email already in use" });
    }

    const mollieCustomerId = await createMollieCustomer({
      name: input.name,
      email: input.email,
    });

    const user = await prisma.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash: await hashPassword(input.password),
        plan: Plan.starter,
        mollieCustomerId,
      },
    });

    return res.status(201).json(issueSession(user));
  } catch (error) {
    return next(error);
  }
});

// =====================
// LOGIN
// =====================
router.post("/login", async (req, res, next) => {
  try {
    const input = validate(loginSchema, req.body);

    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await verifyPassword(
      input.password,
      user.passwordHash
    );

    if (!valid) {
      await createAuditLog({
        userId: user.id,
        action: "auth.login.failed",
        entityType: "user",
        entityId: user.id,
      });

      return res.status(401).json({ error: "Invalid credentials" });
    }

    // =====================
    // 2FA CHECK
    // =====================
    if (user.twoFactorEnabled) {
      const challengeToken = signAccessToken({
        sub: user.id,
        tfaPending: true,
        purpose: "login-2fa",
      });

      await createAuditLog({
        userId: user.id,
        action: "auth.login.challenge_issued",
        entityType: "user",
        entityId: user.id,
      });

      return res.json({
        twoFactorRequired: true,
        challengeToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          plan: user.plan,
          dealValue: user.dealValue,
          twoFactorEnabled: true,
        },
      });
    }

    // demo auto data
    if (user.email === "demo@leadflow.ai") {
      await ensureDemoData(user.id);
    }

    await createAuditLog({
      userId: user.id,
      action: "auth.login.success",
      entityType: "user",
      entityId: user.id,
    });

    return res.json(issueSession(user));
  } catch (error) {
    return next(error);
  }
});

// =====================
// 2FA LOGIN
// =====================
router.post("/login/2fa", async (req, res, next) => {
  try {
    const input = validate(twoFactorLoginSchema, req.body);

    const payload = verifyAccessToken(input.challengeToken);

    if (!payload?.sub || !payload.tfaPending) {
      return res.status(401).json({ error: "Invalid 2FA challenge" });
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
    });

    if (!user || !user.twoFactorSecret) {
      return res.status(400).json({ error: "2FA not enabled" });
    }

    let valid = false;
    let consumedRecoveryCode = null;

    // TOTP
    if (input.token) {
      valid = authenticator.verify({
        token: input.token,
        secret: user.twoFactorSecret,
      });
    }

    // Recovery code
    if (!valid && input.recoveryCode) {
      const codes = Array.isArray(user.twoFactorRecoveryCodes)
        ? user.twoFactorRecoveryCodes
        : [];

      const index = codes.findIndex(
        (c) => c === input.recoveryCode
      );

      if (index >= 0) {
        valid = true;
        consumedRecoveryCode = input.recoveryCode;

        codes.splice(index, 1);

        await prisma.user.update({
          where: { id: user.id },
          data: { twoFactorRecoveryCodes: codes },
        });
      }
    }

    if (!valid) {
      await createAuditLog({
        userId: user.id,
        action: "auth.login.2fa_failed",
        entityType: "user",
        entityId: user.id,
      });

      return res.status(401).json({ error: "Invalid 2FA token" });
    }

    if (user.email === "demo@leadflow.ai") {
      await ensureDemoData(user.id);
    }

    await createAuditLog({
      userId: user.id,
      action: "auth.login.2fa_success",
      entityType: "user",
      entityId: user.id,
      metadata: consumedRecoveryCode
        ? { method: "recovery_code" }
        : { method: "totp" },
    });

    return res.json(issueSession(user));
  } catch (error) {
    return next(error);
  }
});

// =====================
// DEMO USER
// =====================
router.post("/demo", async (_req, res, next) => {
  try {
    const demoEmail = "demo@leadflow.ai";
    const demoPassword = "demo123";

    let user = await prisma.user.findUnique({
      where: { email: demoEmail },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          name: "Demo User",
          email: demoEmail,
          passwordHash: await hashPassword(demoPassword),
          role: UserRole.user,
          plan: Plan.pro,
          dealValue: 1500,
        },
      });
    }

    await ensureDemoData(user.id);

    return res.json(issueSession(user));
  } catch (error) {
    return next(error);
  }
});

// =====================
// CURRENT USER
// =====================
router.get("/me", async (req, res) => {
  const header = req.headers.authorization;

  if (!header) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const token = header.split(" ")[1];
    const payload = verifyAccessToken(token);

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        plan: true,
        dealValue: true,
        twoFactorEnabled: true,
      },
    });

    return res.json({ user });
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
});

export default router;

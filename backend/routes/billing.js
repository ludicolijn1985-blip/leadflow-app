import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { billingUpgradeSchema, validate } from "../lib/validators.js";
import { PLAN_PRICING, createMolliePayment, getPayment } from "../services/mollieService.js";
import { getDunningStage, processDueDunningEvents, scheduleDunningRetry, resolveDunningEvents } from "../services/dunningService.js";
import { createAuditLog } from "../lib/audit.js";

const router = Router();

router.get("/plans", (_req, res) => {
  return res.json(PLAN_PRICING);
});

router.get("/subscriptions", async (req, res, next) => {
  try {
    const subscriptions = await prisma.subscription.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    return res.json(subscriptions);
  } catch (error) {
    return next(error);
  }
});

router.get("/usage-summary", async (req, res, next) => {
  try {
    const periodKey = new Date().toISOString().slice(0, 7);
    const rows = await prisma.usageRecord.groupBy({
      by: ["metric"],
      where: { userId: req.user.id, periodKey },
      _sum: { quantity: true, amountCents: true },
    });

    const metrics = rows.map((row) => ({
      metric: row.metric,
      quantity: row._sum.quantity || 0,
      amountCents: row._sum.amountCents || 0,
    }));

    const totalAmountCents = metrics.reduce((total, item) => total + item.amountCents, 0);
    return res.json({ periodKey, totalAmountCents, metrics });
  } catch (error) {
    return next(error);
  }
});

router.get("/dunning-events", async (req, res, next) => {
  try {
    const events = await prisma.dunningEvent.findMany({
      where: { subscription: { userId: req.user.id } },
      include: { subscription: { select: { id: true, plan: true, status: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return res.json(
      events.map((event) => ({
        ...event,
        stage: getDunningStage(event.attemptNumber),
      }))
    );
  } catch (error) {
    return next(error);
  }
});

router.post("/dunning/simulate-failure/:subscriptionId", async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({ where: { id: req.params.subscriptionId, userId: req.user.id } });
    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "pending" } });
    const event = await scheduleDunningRetry(subscription.id);
    return res.status(201).json({ event, stage: getDunningStage(event.attemptNumber) });
  } catch (error) {
    return next(error);
  }
});

router.post("/dunning/retry/:subscriptionId", async (req, res, next) => {
  try {
    const subscription = await prisma.subscription.findFirst({ where: { id: req.params.subscriptionId, userId: req.user.id } });
    if (!subscription) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    const event = await scheduleDunningRetry(subscription.id);
    await createAuditLog({
      userId: req.user.id,
      action: "billing.dunning.retry_scheduled",
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { attemptNumber: event.attemptNumber },
    });
    return res.status(201).json(event);
  } catch (error) {
    return next(error);
  }
});

router.post("/dunning/process", async (req, res, next) => {
  try {
    const result = await processDueDunningEvents(req.user.role === "admin" ? undefined : req.user.id);
    await createAuditLog({
      userId: req.user.id,
      action: "billing.dunning.processed",
      entityType: "dunningEvent",
      metadata: result,
    });
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

router.post("/upgrade", async (req, res, next) => {
  try {
    const input = validate(billingUpgradeSchema, req.body);
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user?.mollieCustomerId) {
      return res.status(400).json({ error: "Mollie customer missing for this account" });
    }

    const payment = await createMolliePayment({
      customerId: user.mollieCustomerId,
      plan: input.plan,
      userId: user.id,
      email: user.email,
    });

    const price = PLAN_PRICING[input.plan];
    await prisma.subscription.create({
      data: {
        userId: user.id,
        plan: input.plan,
        amountCents: price.amountCents,
        molliePaymentId: payment.id,
        mollieCustomerId: user.mollieCustomerId,
        checkoutUrl: payment.getCheckoutUrl(),
        status: "pending",
      },
    });

    return res.status(201).json({ checkoutUrl: payment.getCheckoutUrl(), paymentId: payment.id });
  } catch (error) {
    return next(error);
  }
});

router.post("/webhook", async (req, res, next) => {
  try {
    const paymentId = req.body.id;
    if (!paymentId) {
      return res.status(400).send("missing id");
    }

    const payment = await getPayment(paymentId);
    const subscription = await prisma.subscription.findUnique({ where: { molliePaymentId: payment.id } });
    if (!subscription) {
      return res.status(200).send("ok");
    }

    if (payment.isPaid()) {
      await prisma.$transaction([
        prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: "active", paidAt: new Date() },
        }),
        prisma.user.update({
          where: { id: subscription.userId },
          data: { plan: subscription.plan },
        }),
      ]);
      await resolveDunningEvents(subscription.id);
    }

    if (payment.isCanceled() || payment.status === "failed" || payment.status === "expired") {
      await prisma.subscription.update({ where: { id: subscription.id }, data: { status: "pending" } });
      await scheduleDunningRetry(subscription.id);
    }

    return res.status(200).send("ok");
  } catch (error) {
    return next(error);
  }
});

export default router;
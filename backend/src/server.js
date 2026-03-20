import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { httpLogger } from "./lib/logger.js";
import authRoutes from "./routes/auth.js";
import leadsRoutes from "./routes/leads.js";
import campaignsRoutes from "./routes/campaigns.js";
import dashboardRoutes from "./routes/dashboard.js";
import adminRoutes from "./routes/admin.js";
import billingRoutes from "./routes/billing.js";
import trackingRoutes from "./routes/tracking.js";
import inboxRoutes from "./routes/inbox.js";
import integrationsRoutes from "./routes/integrations.js";
import analyticsRoutes from "./routes/analytics.js";
import securityRoutes from "./routes/security.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { prisma } from "./lib/prisma.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);
app.set("trust proxy", 1);

const allowedOrigins = config.frontendUrl
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin(origin, callback) {
    // Allow server-to-server requests and health checks with no Origin header.
    if (!origin) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error("CORS origin not allowed"));
  },
  credentials: true,
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts, please try again later." },
});

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts, please try again later." },
});

const authFallbackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many authentication requests, please try again later." },
});

const trackingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tracking requests, please try again later." },
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(cors(corsOptions));
app.use(httpLogger);

app.use("/api/billing/webhook", express.urlencoded({ extended: false }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/metrics", async (_req, res, next) => {
  try {
    const [users, leads, campaigns, emails, jobsFailed] = await Promise.all([
      prisma.user.count(),
      prisma.lead.count(),
      prisma.campaign.count(),
      prisma.emailLog.count(),
      prisma.jobLog.count({ where: { status: "failed" } }),
    ]);
    return res.json({
      users,
      leads,
      campaigns,
      emails,
      jobsFailed,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return next(error);
  }
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/auth/register", registerLimiter);
app.use("/api/auth", authFallbackLimiter, authRoutes);
app.use("/api/tracking", trackingLimiter, trackingRoutes);
app.use("/api", apiLimiter);

app.use("/api/leads", requireAuth, leadsRoutes);
app.use("/api/campaigns", requireAuth, campaignsRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/billing", requireAuth, billingRoutes);
app.use("/api/inbox", requireAuth, inboxRoutes);
app.use("/api/integrations", requireAuth, integrationsRoutes);
app.use("/api/analytics", requireAuth, analyticsRoutes);
app.use("/api/security", requireAuth, securityRoutes);
app.use("/api/admin", requireAuth, requireRole("admin"), adminRoutes);

app.use((error, _req, res, _next) => {
  const status = error.statusCode || 500;
  const message = error.message || "Server error";
  if (config.nodeEnv !== "production") {
    // Useful for debugging local setups without exposing internals in prod.
    console.error(error);
  }
  res.status(status).json({ error: message });
});

app.listen(PORT, () => {
  console.log(`LeadFlow Pro API running on port ${PORT}`);
});
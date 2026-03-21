import { execSync } from "child_process";

// 🔥 FORCE PRISMA SYNC BIJ STARTUP
try {
  console.log("🚀 Running Prisma DB Push...");
  execSync(
    "npx prisma db push --schema=backend/prisma/schema.prisma",
    { stdio: "inherit" }
  );
  console.log("✅ Prisma DB synced");
} catch (e) {
  console.error("❌ Prisma push failed:", e.message);
}

import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";

// CONFIG + LIBS
import { config } from "./src/config.js";
import { httpLogger } from "./src/lib/logger.js";
import { prisma } from "./src/lib/prisma.js";

// ROUTES
import authRoutes from "./src/routes/auth.js";
import leadsRoutes from "./src/routes/leads.js";
import campaignsRoutes from "./src/routes/campaigns.js";
import dashboardRoutes from "./src/routes/dashboard.js";
import adminRoutes from "./src/routes/admin.js";
import billingRoutes from "./src/routes/billing.js";
import trackingRoutes from "./src/routes/tracking.js";
import inboxRoutes from "./src/routes/inbox.js";
import integrationsRoutes from "./src/routes/integrations.js";
import analyticsRoutes from "./src/routes/analytics.js";
import securityRoutes from "./src/routes/security.js";

// MIDDLEWARE
import { requireAuth, requireRole } from "./src/middleware/auth.js";

const app = express();
const PORT = Number(process.env.PORT || 8080);

app.set("trust proxy", 1);

// SECURITY + BASIC MIDDLEWARE
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(httpLogger);
app.use(express.json());

// (optioneel) rate limit
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 100,
  })
);

// ✅ HEALTHCHECK
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/", (_req, res) => {
  res.send("API running 🚀");
});

// =====================
// ROUTES
// =====================
app.use("/api/auth", authRoutes);
app.use("/api/leads", requireAuth, leadsRoutes);
app.use("/api/campaigns", requireAuth, campaignsRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);
app.use("/api/admin", requireAuth, requireRole("admin"), adminRoutes);
app.use("/api/billing", requireAuth, billingRoutes);
app.use("/api/tracking", trackingRoutes);
app.use("/api/inbox", requireAuth, inboxRoutes);
app.use("/api/integrations", requireAuth, integrationsRoutes);
app.use("/api/analytics", requireAuth, analyticsRoutes);
app.use("/api/security", requireAuth, securityRoutes);

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});

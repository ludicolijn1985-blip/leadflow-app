import { verifyAccessToken } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";

// =====================
// REQUIRE AUTH
// =====================
export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization;

    // 🔒 Check header
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = header.split(" ")[1];

    // 🔐 Verify JWT
    const payload = verifyAccessToken(token);

    if (!payload?.sub) {
      return res.status(401).json({ error: "Invalid token payload" });
    }

    // 👤 Fetch user (minimal select for performance)
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
        plan: true,
        name: true,
        dealValue: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    // 🧠 Attach to request
    req.user = user;

    return next();
  } catch (error) {
    // 🔥 Debug in dev only
    if (process.env.NODE_ENV !== "production") {
      console.error("Auth error:", error);
    }

    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// =====================
// REQUIRE ROLE
// =====================
export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (req.user.role !== role) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}

// =====================
// OPTIONAL: MULTI ROLE SUPPORT
// =====================
export function requireRoles(roles = []) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    return next();
  };
}

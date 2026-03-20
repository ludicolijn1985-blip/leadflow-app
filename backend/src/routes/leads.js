import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { createAuditLog } from "../lib/audit.js";
import {
  leadCreateSchema,
  leadUpdateSchema,
  scrapeSchema,
  validate,
} from "../lib/validators.js";
import { scrapeDirectoryLeads } from "../services/scraperService.js";

const router = Router();

// =====================
// GET LEADS (FILTER + PAGINATION READY)
// =====================
router.get("/", async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const where = {
      userId: req.user.id,
      ...(typeof status === "string" && status !== "all"
        ? { status }
        : {}),
    };

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: Number(limit),
      }),
      prisma.lead.count({ where }),
    ]);

    return res.json({
      data: leads,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    return next(error);
  }
});

// =====================
// CREATE LEAD
// =====================
router.post("/", async (req, res, next) => {
  try {
    const data = validate(leadCreateSchema, req.body);

    const lead = await prisma.lead.create({
      data: {
        userId: req.user.id,
        name: data.name,
        company: data.company,
        website: data.website || null,
        email: data.email || null,
        location: data.location || null,
        source: data.source || "manual",
        status: data.status || "new",
      },
    });

    await Promise.all([
      prisma.funnelEvent.create({
        data: {
          userId: req.user.id,
          leadId: lead.id,
          eventType: "lead_created",
          source: lead.source || "manual",
        },
      }),
      createAuditLog({
        userId: req.user.id,
        action: "lead.created",
        entityType: "lead",
        entityId: lead.id,
      }),
    ]);

    return res.status(201).json(lead);
  } catch (error) {
    return next(error);
  }
});

// =====================
// UPDATE LEAD
// =====================
router.patch("/:id", async (req, res, next) => {
  try {
    const data = validate(leadUpdateSchema, req.body);

    const existing = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: {
        ...data,
        website: data.website === "" ? null : data.website,
        email: data.email === "" ? null : data.email,
      },
    });

    await createAuditLog({
      userId: req.user.id,
      action: "lead.updated",
      entityType: "lead",
      entityId: lead.id,
    });

    return res.json(lead);
  } catch (error) {
    return next(error);
  }
});

// =====================
// DELETE LEAD
// =====================
router.delete("/:id", async (req, res, next) => {
  try {
    const existing = await prisma.lead.findFirst({
      where: {
        id: req.params.id,
        userId: req.user.id,
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await prisma.lead.delete({
      where: { id: req.params.id },
    });

    await createAuditLog({
      userId: req.user.id,
      action: "lead.deleted",
      entityType: "lead",
      entityId: req.params.id,
    });

    return res.status(204).send();
  } catch (error) {
    return next(error);
  }
});

// =====================
// BULK DELETE
// =====================
router.post("/bulk-delete", async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body.ids) ? req.body.ids : [];

    if (!ids.length) {
      return res.status(400).json({ error: "No IDs provided" });
    }

    const result = await prisma.lead.deleteMany({
      where: {
        userId: req.user.id,
        id: { in: ids },
      },
    });

    await createAuditLog({
      userId: req.user.id,
      action: "lead.bulk_deleted",
      entityType: "lead",
      metadata: { count: result.count },
    });

    return res.json({ deleted: result.count });
  } catch (error) {
    return next(error);
  }
});

// =====================
// SCRAPE LEADS (HIGH VALUE FEATURE)
// =====================
router.post("/scrape", async (req, res, next) => {
  try {
    const input = validate(scrapeSchema, req.body);

    const scraped = await scrapeDirectoryLeads(input);

    if (!scraped.length) {
      return res.status(200).json({ added: 0, leads: [] });
    }

    const created = await prisma.$transaction(
      scraped.map((item) =>
        prisma.lead.create({
          data: {
            userId: req.user.id,
            name: item.name,
            company: item.company,
            website: item.website || null,
            email: item.email || null,
            location: input.location,
            source: "directory-scrape",
          },
        })
      )
    );

    await Promise.all([
      prisma.funnelEvent.createMany({
        data: created.map((lead) => ({
          userId: req.user.id,
          leadId: lead.id,
          eventType: "lead_created",
          source: "directory-scrape",
        })),
      }),

      prisma.usageRecord.create({
        data: {
          userId: req.user.id,
          metric: "leads_scraped",
          quantity: created.length,
          amountCents: created.length * 20,
          periodKey: new Date().toISOString().slice(0, 7),
        },
      }),

      createAuditLog({
        userId: req.user.id,
        action: "lead.scraped",
        entityType: "lead",
        metadata: {
          keyword: input.keyword,
          location: input.location,
          added: created.length,
        },
      }),
    ]);

    return res.status(201).json({
      added: created.length,
      leads: created,
    });
  } catch (error) {
    return next(error);
  }
});

export default router;

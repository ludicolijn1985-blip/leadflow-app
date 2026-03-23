import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(6).max(128),
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(20),
  token: z.string().length(6).optional(),
  recoveryCode: z.string().min(6).max(32).optional(),
}).refine((value) => Boolean(value.token || value.recoveryCode), {
  message: "Provide a 2FA token or recovery code",
});

export const leadCreateSchema = z.object({
  name: z.string().min(1).max(120),
  company: z.string().min(1).max(120),
  website: z.string().url().optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  location: z.string().max(120).optional(),
  source: z.string().max(120).optional(),
  status: z.enum(["new", "contacted", "replied"]).optional(),
});

export const leadUpdateSchema = leadCreateSchema.partial();

export const campaignCreateSchema = z.object({
  name: z.string().min(2).max(120),
  subject: z.string().min(1).max(200),
  bodyTemplate: z.string().min(8).max(6000),
  leadIds: z.array(z.string().min(1)).min(1),
});

export const sendCampaignSchema = z.object({
  campaignId: z.string().min(1),
  leadIds: z.array(z.string().min(1)).optional(),
  followUp: z.boolean().optional().default(false),
});

export const campaignVariantSchema = z.object({
  campaignId: z.string().min(1),
  variants: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        subject: z.string().min(1).max(200),
        bodyTemplate: z.string().min(8).max(6000),
        trafficPercent: z.number().int().min(1).max(99),
      })
    )
    .length(2)
    .refine((variants) => variants.reduce((total, item) => total + item.trafficPercent, 0) === 100, {
      message: "Variant trafficPercent must add up to 100",
    }),
});

export const campaignFlowSchema = z.object({
  campaignId: z.string().min(1),
  steps: z.array(
    z.object({
      nodeId: z.string().min(1),
      stepType: z.string().min(1),
      delayHours: z.number().int().min(0).max(720),
      config: z.record(z.any()),
      positionX: z.number(),
      positionY: z.number(),
    })
  ),
});

export const scrapeSchema = z.object({
  keyword: z.string().min(2).max(80),
  location: z.string().min(2).max(80),
  maxResults: z.number().int().min(1).max(50).default(25),
});

export const billingUpgradeSchema = z.object({
  plan: z.enum(["starter", "pro", "agency"]),
});

export const mailboxSchema = z.object({
  host: z.string().min(2),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().optional().default(true),
  username: z.string().min(2),
  password: z.string().min(2),
});

export const crmSchema = z.object({
  provider: z.enum(["hubspot", "pipedrive", "salesforce"]),
  accessToken: z.string().min(8),
  refreshToken: z.string().optional(),
  endpointUrl: z.string().url().optional(),
});

export const twoFactorVerifySchema = z.object({
  token: z.string().min(6).max(6),
});

export function validate(schema, data) {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((item) => item.message);
    const error = new Error(issues.join(", "));
    error.statusCode = 400;
    throw error;
  }
  return parsed.data;
}
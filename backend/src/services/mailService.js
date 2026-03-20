import nodemailer from "nodemailer";
import { config, hasSmtpConfig } from "../config.js";

let transporter = null;

if (hasSmtpConfig) {
  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: {
      user: config.smtpUser,
      pass: config.smtpPass,
    },
  });
}

export function renderTemplate(template, lead) {
  return template
    .replaceAll("{name}", lead.name || "there")
    .replaceAll("{company}", lead.company || "your company");
}

export async function sendLeadEmail({ to, subject, html }) {
  if (!transporter) {
    const error = new Error("SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.");
    error.statusCode = 500;
    throw error;
  }

  return transporter.sendMail({
    from: config.smtpFrom,
    to,
    subject,
    html,
  });
}

export async function sendSystemEmail({ to, subject, html }) {
  return sendLeadEmail({ to, subject, html });
}
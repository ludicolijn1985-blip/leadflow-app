import createMollieClient from "@mollie/api-client";
import { config, hasMollieConfig } from "../config.js";

export const PLAN_PRICING = {
  starter: { amountCents: 4900, amount: "49.00", label: "Starter" },
  pro: { amountCents: 9900, amount: "99.00", label: "Pro" },
  agency: { amountCents: 19900, amount: "199.00", label: "Agency" },
};

const mollieClient = hasMollieConfig ? createMollieClient({ apiKey: config.mollieApiKey }) : null;

export function ensureMollieClient() {
  if (!mollieClient) {
    const error = new Error("Mollie is not configured. Set MOLLIE_API_KEY and MOLLIE_WEBHOOK_URL.");
    error.statusCode = 500;
    throw error;
  }
  return mollieClient;
}

export async function createMollieCustomer({ name, email }) {
  const client = ensureMollieClient();
  const customer = await client.customers.create({ name, email });
  return customer.id;
}

export async function createMolliePayment({ customerId, plan, userId, email }) {
  const client = ensureMollieClient();
  const price = PLAN_PRICING[plan];
  const payment = await client.payments.create({
    amount: { currency: "EUR", value: price.amount },
    description: `LeadFlow Pro ${price.label} Plan`,
    customerId,
    webhookUrl: config.mollieWebhookUrl,
    redirectUrl: `${config.frontendUrl}/billing?payment=success`,
    metadata: {
      userId,
      plan,
      email,
    },
  });
  return payment;
}

export async function getPayment(paymentId) {
  const client = ensureMollieClient();
  return client.payments.get(paymentId);
}
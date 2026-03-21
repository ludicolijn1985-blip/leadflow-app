import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { ensureDemoData } from "../backend/src/services/demoService.js";

const prisma = new PrismaClient();

async function upsertUser({ name, email, password, role, plan }) {
  const passwordHash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: {
      name,
      role,
      plan,
      passwordHash,
    },
    create: {
      name,
      email,
      role,
      plan,
      passwordHash,
      dealValue: 2000,
    },
  });
}

async function main() {
  const admin = await upsertUser({
    name: "LeadFlow Admin",
    email: "admin@leadflow.ai",
    password: "admin123",
    role: "admin",
    plan: "agency",
  });

  const demo = await upsertUser({
    name: "Demo User",
    email: "demo@leadflow.ai",
    password: "demo123",
    role: "user",
    plan: "pro",
  });

  await ensureDemoData(demo.id);
  console.log("Seed complete", { admin: admin.email, demo: demo.email });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
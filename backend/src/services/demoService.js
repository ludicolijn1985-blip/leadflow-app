import { prisma } from "../lib/prisma.js";

function buildDemoLeads() {
  return Array.from({ length: 25 }).map((_, index) => ({
    name: `Contact ${index + 1}`,
    company: `Demo Company ${index + 1}`,
    website: `https://demo-company-${index + 1}.com`,
    email: `hello${index + 1}@demo-company-${index + 1}.com`,
    location: "Amsterdam",
    source: "demo",
    status: "new",
  }));
}

export async function ensureDemoData(userId) {
  const [leadCount, campaignCount, emailCount, replyCount] = await Promise.all([
    prisma.lead.count({ where: { userId } }),
    prisma.campaign.count({ where: { userId } }),
    prisma.emailLog.count({ where: { userId } }),
    prisma.emailLog.count({ where: { userId, status: "replied" } }),
  ]);

  if (leadCount >= 25 && campaignCount >= 2 && emailCount >= 10 && replyCount >= 3) {
    return;
  }

  await prisma.emailLog.deleteMany({ where: { userId } });
  await prisma.campaignLead.deleteMany({ where: { campaign: { userId } } });
  await prisma.campaign.deleteMany({ where: { userId } });
  await prisma.lead.deleteMany({ where: { userId } });

  const leads = await prisma.$transaction(
    buildDemoLeads().map((lead) =>
      prisma.lead.create({
        data: {
          userId,
          ...lead,
        },
      })
    )
  );

  const first = leads.slice(0, 12);
  const second = leads.slice(12, 25);

  const campaignA = await prisma.campaign.create({
    data: {
      userId,
      name: "Local Growth Push",
      subject: "{company} visibility strategy",
      bodyTemplate: "Hi {name},\n\nI noticed {company} and wanted to share a process we use to increase qualified leads in 30 days.",
      status: "active",
      campaignLeads: {
        create: first.map((lead) => ({ leadId: lead.id })),
      },
    },
  });

  const campaignB = await prisma.campaign.create({
    data: {
      userId,
      name: "Agency Offer Follow-up",
      subject: "Quick follow-up for {company}",
      bodyTemplate: "Hi {name},\n\nFollowing up in case my previous message got buried. Happy to walk you through a simple lead flow setup.",
      status: "active",
      campaignLeads: {
        create: second.map((lead) => ({ leadId: lead.id })),
      },
    },
  });

  for (const lead of leads.slice(0, 10)) {
    const replied = [1, 4, 8].includes(Number(lead.name.split(" ")[1]));
    await prisma.emailLog.create({
      data: {
        userId,
        campaignId: replied ? campaignB.id : campaignA.id,
        leadId: lead.id,
        toEmail: lead.email,
        subject: `Intro for ${lead.company}`,
        body: `Hi ${lead.name}, quick intro for ${lead.company}`,
        status: replied ? "replied" : "sent",
        repliedAt: replied ? new Date() : null,
        trackingId: `${lead.id}-demo-track`,
      },
    });

    if (replied) {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "replied" } });
    } else {
      await prisma.lead.update({ where: { id: lead.id }, data: { status: "contacted" } });
    }
  }
}
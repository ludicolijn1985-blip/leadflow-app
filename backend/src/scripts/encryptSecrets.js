import { prisma } from "../lib/prisma.js";
import { encryptText } from "../lib/crypto.js";

function isEncrypted(value) {
  return typeof value === "string" && value.startsWith("enc:v1:");
}

async function main() {
  const [mailboxes, crmConnections] = await Promise.all([
    prisma.mailboxConnection.findMany({ select: { id: true, password: true } }),
    prisma.crmConnection.findMany({ select: { id: true, accessToken: true, refreshToken: true } }),
  ]);

  let mailboxUpdates = 0;
  let crmUpdates = 0;

  for (const mailbox of mailboxes) {
    if (!mailbox.password || isEncrypted(mailbox.password)) {
      continue;
    }
    await prisma.mailboxConnection.update({
      where: { id: mailbox.id },
      data: { password: encryptText(mailbox.password) },
    });
    mailboxUpdates += 1;
  }

  for (const crm of crmConnections) {
    const nextAccessToken = crm.accessToken && !isEncrypted(crm.accessToken) ? encryptText(crm.accessToken) : crm.accessToken;
    const nextRefreshToken = crm.refreshToken && !isEncrypted(crm.refreshToken) ? encryptText(crm.refreshToken) : crm.refreshToken;

    if (nextAccessToken === crm.accessToken && nextRefreshToken === crm.refreshToken) {
      continue;
    }

    await prisma.crmConnection.update({
      where: { id: crm.id },
      data: {
        accessToken: nextAccessToken,
        refreshToken: nextRefreshToken,
      },
    });
    crmUpdates += 1;
  }

  console.log(`Encrypted mailbox credentials: ${mailboxUpdates}`);
  console.log(`Encrypted CRM credentials: ${crmUpdates}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

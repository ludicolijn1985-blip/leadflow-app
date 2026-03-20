import axios from "axios";
import { chromium } from "playwright";

function normalizeWebsite(url) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://${url}`;
}

function extractEmailFromText(text) {
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const match = text.match(emailRegex);
  if (!match?.length) return null;
  const filtered = match.find((email) => !email.includes("example.com"));
  return filtered || match[0] || null;
}

export async function resolveBusinessEmail(website) {
  if (!website) return null;
  try {
    const target = normalizeWebsite(website);
    const response = await axios.get(target, { timeout: 9000 });
    return extractEmailFromText(response.data);
  } catch {
    return null;
  }
}

export async function scrapeDirectoryLeads({ keyword, location, maxResults }) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    const search = encodeURIComponent(`${keyword} ${location}`);
    await page.goto(`https://www.yell.com/ucs/UcsSearchAction.do?keywords=${search}&location=${encodeURIComponent(location)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    await page.waitForSelector(".businessCapsule", { timeout: 15000 });

    const rows = await page.$$eval(".businessCapsule", (items) =>
      items.map((item) => {
        const name = item.querySelector(".businessCapsule--name")?.textContent?.trim() || "";
        const website = item.querySelector("a.businessCapsule--ctaItem[data-tracking*=website]")?.getAttribute("href") || "";
        return {
          name,
          company: name,
          website,
        };
      })
    );

    const sliced = rows.filter((item) => item.name).slice(0, maxResults);
    const leads = [];

    for (const item of sliced) {
      const email = await resolveBusinessEmail(item.website);
      leads.push({
        name: item.name,
        company: item.company,
        website: item.website || null,
        email,
      });
    }

    return leads;
  } finally {
    await browser.close();
  }
}
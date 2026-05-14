import fs from "node:fs/promises";
import path from "node:path";

const LEADS_PATH = path.resolve(process.cwd(), "leads.json");

export async function appendLead(lead) {
  const record = {
    ...lead,
    timestamp: Date.now(),
  };

  let existing = [];
  try {
    const raw = await fs.readFile(LEADS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) existing = parsed;
  } catch {
    existing = [];
  }

  existing.push(record);
  await fs.writeFile(LEADS_PATH, JSON.stringify(existing, null, 2), "utf8");

  return record;
}

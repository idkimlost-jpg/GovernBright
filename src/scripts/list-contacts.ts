// Lists the latest enquiries from the landing page's contact form (npm run contacts;
// node dist/scripts/list-contacts.js in the container).
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { createPlatform } from "../services/index.js";
import { ContactService } from "../services/contact.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  const requests = await new ContactService(pool, createPlatform(config).mailer, config.CONTACT_EMAIL).list();
  if (!requests.length) process.stdout.write("No enquiries yet\n");
  for (const r of requests) {
    process.stdout.write(`\n${new Date(r.createdAt).toISOString()}  ${r.name}${r.company ? ` (${r.company})` : ""} <${r.email}>\n${r.message}\n`);
  }
} finally {
  await pool.end();
}

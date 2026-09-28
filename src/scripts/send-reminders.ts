// Sends the daily reminder digest. Schedule it once a day (cron, a scheduled container task, etc.).
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { appOrigin } from "../http/shared.js";
import { Notifier } from "../platform/notifier.js";
import { createPlatform } from "../services/index.js";
import { ReminderService } from "../services/reminders.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const { mailer, secrets } = createPlatform(config);
try {
  const result = await new ReminderService(pool, mailer, new Notifier(pool, secrets, appOrigin(config)), appOrigin(config)).send();
  process.stdout.write(`Sent ${result.sent} reminder digest(s)\n`);
} finally {
  await pool.end();
}

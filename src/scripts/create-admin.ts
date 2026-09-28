import { randomUUID } from "node:crypto";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { hashPassword } from "../services/auth.js";

const input = z.object({
  ADMIN_EMAIL: z.email(),
  ADMIN_PASSWORD: z.string().min(12).max(256),
  ADMIN_NAME: z.string().trim().min(2).max(200),
  ORGANIZATION_NAME: z.string().trim().min(2).max(200)
}).parse(process.env);
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const organizationId = randomUUID();
  const userId = randomUUID();
  await client.query("INSERT INTO organizations (id, name) VALUES ($1,$2)", [organizationId, input.ORGANIZATION_NAME]);
  await client.query(`INSERT INTO users (id, external_subject, email, display_name, password_hash) VALUES ($1,$2,$3,$4,$5)`,
    [userId, `local:${input.ADMIN_EMAIL.toLowerCase()}`, input.ADMIN_EMAIL.toLowerCase(), input.ADMIN_NAME, await hashPassword(input.ADMIN_PASSWORD)]);
  await client.query("INSERT INTO memberships (organization_id, user_id, role) VALUES ($1,$2,'owner')", [organizationId, userId]);
  await client.query("COMMIT");
  process.stdout.write(`Created owner ${input.ADMIN_EMAIL} for ${input.ORGANIZATION_NAME}\n`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

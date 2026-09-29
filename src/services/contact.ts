import type pg from "pg";
import { z } from "zod";
import type { Mailer } from "../platform/mailer.js";

export const contactInput = z.object({
  name: z.string().trim().min(1).max(200),
  company: z.string().trim().max(200).default(""),
  email: z.email().max(320),
  message: z.string().trim().min(1).max(5000),
  // Hidden from people; bots that fill every field reveal themselves here.
  website: z.string().max(500).default("")
});
export type ContactInput = z.infer<typeof contactInput>;
export type ContactRequest = { id: string; name: string; company: string; email: string; message: string; createdAt: string };

// Stores enquiries from the landing page and forwards each one to the operator's inbox.
export class ContactService {
  constructor(private readonly pool: pg.Pool, private readonly mailer: Mailer, private readonly contactEmail: string) {}

  async submit(input: ContactInput): Promise<void> {
    if (input.website) return;
    await this.pool.query(`INSERT INTO contact_requests (name, company, email, message) VALUES ($1,$2,$3,$4)`,
      [input.name, input.company, input.email, input.message]);
    const from = input.company ? `${input.name} (${input.company})` : input.name;
    void this.mailer.send({
      to: this.contactEmail,
      subject: `GovernBright enquiry from ${from}`,
      text: `${from} <${input.email}> wrote:\n\n${input.message}\n\nReply to ${input.email}.`
    }).catch(error => console.warn("Contact email failed", error instanceof Error ? error.message : error));
  }

  async list(limit = 50): Promise<ContactRequest[]> {
    const result = await this.pool.query<ContactRequest>(`SELECT id, name, company, email, message, created_at AS "createdAt"
      FROM contact_requests ORDER BY created_at DESC LIMIT $1`, [limit]);
    return result.rows;
  }
}

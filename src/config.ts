import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  APP_ORIGIN: z.string().url().optional(),
  // 32 random bytes, base64 encoded (openssl rand -base64 32). Encrypts stored integration secrets.
  APP_ENCRYPTION_KEY: z.string().refine(v => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded").optional(),
  SMTP_URL: z.string().url().optional(),
  // Set when running behind a load balancer or reverse proxy so rate limits and logs see the real
  // client address: "true" (trust all), a hop count like "1", or comma-separated proxy addresses.
  TRUST_PROXY: z.string().optional().transform(v => v === undefined || v === "" || v === "false" ? false : v === "true" ? true : /^\d+$/.test(v) ? Number(v) : v),
  MAIL_FROM: z.string().min(3).default("GovernBright <no-reply@governbright.local>")
}).superRefine((config, ctx) => {
  if (config.ALLOW_DEV_AUTH) {
    const hostname = config.APP_ORIGIN ? new URL(config.APP_ORIGIN).hostname : "";
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) ctx.addIssue({ code: "custom", path: ["ALLOW_DEV_AUTH"], message: "ALLOW_DEV_AUTH requires a localhost APP_ORIGIN" });
  }
  if (config.NODE_ENV !== "production") return;
  if (!config.APP_ORIGIN) ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "APP_ORIGIN is required in production" });
  if (!config.APP_ENCRYPTION_KEY) ctx.addIssue({ code: "custom", path: ["APP_ENCRYPTION_KEY"], message: "APP_ENCRYPTION_KEY is required in production" });
  if (config.ALLOW_DEV_AUTH) ctx.addIssue({ code: "custom", path: ["ALLOW_DEV_AUTH"], message: "ALLOW_DEV_AUTH must be false in production" });
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

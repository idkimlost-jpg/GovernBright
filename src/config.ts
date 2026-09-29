import { z } from "zod";

// Hosting dashboards make it easy to paste a value with surrounding quotes or spaces; ignore them.
const unquoted = (v: unknown) => typeof v === "string" ? v.trim().replace(/^(["'])(.*)\1$/, "$2") : v;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.preprocess(unquoted, z.string().url("DATABASE_URL must be a full database URL, such as postgresql://user:password@host/database")),
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  APP_ORIGIN: z.preprocess(unquoted, z.string().url("APP_ORIGIN must be the site's full address, starting with https://").optional()),
  // 32 random bytes, base64 encoded (openssl rand -base64 32). Encrypts stored integration secrets.
  APP_ENCRYPTION_KEY: z.preprocess(unquoted, z.string()
    .refine(v => Buffer.from(v, "base64").length === 32, "APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded (44 characters ending in =); create one with: openssl rand -base64 32")
    .optional()),
  SMTP_URL: z.preprocess(unquoted, z.string().url("SMTP_URL must be a full URL, such as smtp://user:password@smtp.example.com:587").optional()),
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
// On Render, RENDER_EXTERNAL_URL is the service's public address; it stands in for APP_ORIGIN
// until a custom domain is set.
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config =>
  schema.parse({ ...env, APP_ORIGIN: env.APP_ORIGIN || env.RENDER_EXTERNAL_URL });

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  APP_ORIGIN: z.string().url().optional()
}).superRefine((config, ctx) => {
  if (config.NODE_ENV !== "production") return;
  if (!config.APP_ORIGIN) ctx.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "APP_ORIGIN is required in production" });
  if (config.ALLOW_DEV_AUTH) ctx.addIssue({ code: "custom", path: ["ALLOW_DEV_AUTH"], message: "ALLOW_DEV_AUTH must be false in production" });
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

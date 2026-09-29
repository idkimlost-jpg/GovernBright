import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  ALLOW_DEV_AUTH: z.enum(["true", "false"]).default("false").transform(v => v === "true"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  APP_ORIGIN: z.string().url().optional(),
  TRUST_PROXY: z.string().default("false").transform(value => value === "true" ? true : value === "false" ? false : value)
}).superRefine((config, context) => {
  if (config.NODE_ENV === "production" && !config.APP_ORIGIN) {
    context.addIssue({ code: "custom", path: ["APP_ORIGIN"], message: "APP_ORIGIN is required in production" });
  }
  if (config.ALLOW_DEV_AUTH) {
    if (!config.APP_ORIGIN) {
      context.addIssue({ code: "custom", path: ["ALLOW_DEV_AUTH"], message: "Development authentication requires a localhost APP_ORIGIN" });
      return;
    }
    const hostname = new URL(config.APP_ORIGIN).hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(hostname)) {
      context.addIssue({ code: "custom", path: ["ALLOW_DEV_AUTH"], message: "Development authentication is only allowed on localhost" });
    }
  }
});

export type Config = z.infer<typeof schema>;
export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => schema.parse(env);

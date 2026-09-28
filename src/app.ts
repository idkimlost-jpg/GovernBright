import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import { registerRoutes, type Services } from "./http/routes.js";

// Trust the nearest `hops` proxies, like Express/proxy-addr hop counts.
const trustHops = (hops: number) => (_address: string, hop: number) => hop < hops;

export async function buildApp(config: Config, services: Services) {
  const app = Fastify({ logger: config.NODE_ENV === "test" ? false : { redact: ["req.headers.authorization", "req.headers.cookie"] }, requestIdHeader: false, genReqId: () => randomUUID(), trustProxy: typeof config.TRUST_PROXY === "number" ? trustHops(config.TRUST_PROXY) : config.TRUST_PROXY });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(cors, { origin: false });
  await registerRoutes(app, config, services);
  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "request failed");
    if (error instanceof ZodError) return reply.code(400).send({ error: "Invalid request", issues: error.issues });
    const known = error instanceof Error ? error : new Error("Unknown request failure");
    const status = "statusCode" in known && typeof known.statusCode === "number" ? known.statusCode : 500;
    const code = status < 500 && "code" in known && typeof known.code === "string" ? known.code : undefined;
    return reply.code(status).send({ error: status >= 500 ? "Internal server error" : known.message, code, correlationId: request.id });
  });
  return app;
}

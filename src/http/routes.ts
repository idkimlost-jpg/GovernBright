import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { AiSystemService } from "../services/ai-systems.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { resolveActor } from "./auth.js";
import type { AuthService } from "../services/auth.js";

const loginInput = z.object({ email: z.email().max(320), password: z.string().min(12).max(256), organizationId: z.uuid().optional() });
const assets = {
  html: fileURLToPath(new URL("../../public/index.html", import.meta.url)),
  js: fileURLToPath(new URL("../../public/app.js", import.meta.url)),
  css: fileURLToPath(new URL("../../public/styles.css", import.meta.url))
};
const sessionCookie = (config: Config) => ({ path: "/", httpOnly: true, sameSite: "strict" as const, secure: config.NODE_ENV === "production", maxAge: config.SESSION_TTL_HOURS * 3600 });
function requireSameOrigin(request: FastifyRequest, config: Config): void {
  if (!config.APP_ORIGIN || request.headers.origin === config.APP_ORIGIN) return;
  const error = new Error("Request origin is not allowed") as Error & { statusCode: number };
  error.statusCode = 403;
  throw error;
}

export async function registerRoutes(app: FastifyInstance, config: Config, service: AiSystemService, auth: AuthService): Promise<void> {
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(assets.html)));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(await readFile(assets.js)));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile(assets.css)));
  app.post("/api/v1/auth/login", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    requireSameOrigin(request, config);
    const input = loginInput.parse(request.body);
    const { token, actor } = await auth.login(input.email, input.password, input.organizationId);
    reply.setCookie("gb_session", token, sessionCookie(config));
    return { user: actor };
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireSameOrigin(request, config);
    if (request.cookies.gb_session) await auth.logout(request.cookies.gb_session);
    reply.clearCookie("gb_session", { path: "/" });
    return reply.code(204).send();
  });
  app.get("/api/v1/auth/me", async request => ({ user: await resolveActor(request, config, auth) }));
  app.get("/api/v1/ai-systems", async request => service.list(await resolveActor(request, config, auth)));
  app.get("/api/v1/ai-systems/:id", async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const item = await service.get(await resolveActor(request, config, auth), id);
    return item ?? reply.code(404).send({ error: "AI system not found" });
  });
  app.post("/api/v1/ai-systems", async (request, reply) => {
    requireSameOrigin(request, config);
    const item = await service.create(await resolveActor(request, config, auth), aiSystemInput.parse(request.body));
    return reply.code(201).send(item);
  });
}

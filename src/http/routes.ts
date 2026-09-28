import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { aiSystemInput } from "../services/ai-systems.js";
import { resolveActor } from "./auth.js";
import { memberInput, memberUpdate } from "../services/members.js";
import { toolRequestDecision, toolRequestInput } from "../services/tool-requests.js";
import { organizationSettingsInput } from "../services/organization.js";
import { registerAuthRoutes } from "./auth-routes.js";
import { registerSsoRoutes } from "./sso-routes.js";
import { registerGovernanceRoutes } from "./governance-routes.js";
import type { Services } from "./context.js";
import { idParams, requireSameOrigin } from "./shared.js";

export type { Services } from "./context.js";

const assets = {
  html: fileURLToPath(new URL("../../public/index.html", import.meta.url)),
  js: fileURLToPath(new URL("../../public/app.js", import.meta.url)),
  css: fileURLToPath(new URL("../../public/styles.css", import.meta.url))
};
export async function registerRoutes(app: FastifyInstance, config: Config, services: Services): Promise<void> {
  const { aiSystems: service, auth, toolRequests, members } = services;
  const actor = (request: FastifyRequest) => resolveActor(request, config, auth);
  app.get("/health", async () => ({ status: "ok" }));
  app.get("/", async (_request, reply) => reply.type("text/html; charset=utf-8").send(await readFile(assets.html)));
  app.get("/app.js", async (_request, reply) => reply.type("application/javascript; charset=utf-8").send(await readFile(assets.js)));
  app.get("/styles.css", async (_request, reply) => reply.type("text/css; charset=utf-8").send(await readFile(assets.css)));
  // Front-end modules; the name pattern keeps requests inside public/js.
  app.get("/js/:name", async (request, reply) => {
    const { name } = z.object({ name: z.string().regex(/^[a-z-]+\.js$/) }).parse(request.params);
    const file = await readFile(fileURLToPath(new URL(`../../public/js/${name}`, import.meta.url))).catch(() => null);
    return file ? reply.type("application/javascript; charset=utf-8").send(file) : reply.code(404).send({ error: "Not found" });
  });
  await registerAuthRoutes(app, config, services);
  await registerSsoRoutes(app, config, services);
  await registerGovernanceRoutes(app, config, services);
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

  app.get("/api/v1/tool-requests", async request => toolRequests.list(await actor(request)));
  app.post("/api/v1/tool-requests", async (request, reply) => {
    requireSameOrigin(request, config);
    const item = await toolRequests.create(await actor(request), toolRequestInput.parse(request.body));
    return reply.code(201).send(item);
  });
  app.patch("/api/v1/tool-requests/:id", async request => {
    requireSameOrigin(request, config);
    const { id } = idParams.parse(request.params);
    return toolRequests.decide(await actor(request), id, toolRequestDecision.parse(request.body));
  });

  app.get("/api/v1/organization", async request => services.organization.get(await actor(request)));
  app.patch("/api/v1/organization", async request => {
    requireSameOrigin(request, config);
    return services.organization.update(await actor(request), organizationSettingsInput.parse(request.body));
  });
  app.post("/api/v1/organization/slack/test", async request => {
    requireSameOrigin(request, config);
    return services.organization.testSlack(await actor(request));
  });

  app.get("/api/v1/members", async request => members.list(await actor(request)));
  app.post("/api/v1/members", async (request, reply) => {
    requireSameOrigin(request, config);
    const item = await members.add(await actor(request), memberInput.parse(request.body));
    return reply.code(201).send(item);
  });
  app.patch("/api/v1/members/:id", async request => {
    requireSameOrigin(request, config);
    const { id } = idParams.parse(request.params);
    return members.update(await actor(request), id, memberUpdate.parse(request.body));
  });
}

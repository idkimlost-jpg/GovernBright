import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { policyInput } from "../services/policies.js";
import { resolveActor } from "./auth.js";
import type { Services } from "./context.js";
import { idParams, requireSameOrigin } from "./shared.js";

export async function registerGovernanceRoutes(app: FastifyInstance, config: Config, services: Services): Promise<void> {
  const { policies } = services;
  const actor = (request: FastifyRequest) => resolveActor(request, config, services.auth);

  app.get("/api/v1/policy", async request => policies.current(await actor(request)));
  app.get("/api/v1/policy/history", async request => policies.history(await actor(request)));
  app.get("/api/v1/policy/status", async request => policies.status(await actor(request)));
  app.post("/api/v1/policy", async (request, reply) => {
    requireSameOrigin(request, config);
    return reply.code(201).send(await policies.publish(await actor(request), policyInput.parse(request.body)));
  });
  app.post("/api/v1/policy/:id/accept", async request => {
    requireSameOrigin(request, config);
    return policies.accept(await actor(request), idParams.parse(request.params).id);
  });
}

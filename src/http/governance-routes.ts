import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "../config.js";
import { policyInput } from "../services/policies.js";
import { assessmentInput } from "../services/assessments.js";
import { auditQuery, renderEvidenceHtml } from "../services/reports.js";
import { discoveryImport } from "../services/discovery.js";
import { z } from "zod";
import { resolveActor } from "./auth.js";
import type { Services } from "./context.js";
import { idParams, requireSameOrigin } from "./shared.js";

export async function registerGovernanceRoutes(app: FastifyInstance, config: Config, services: Services): Promise<void> {
  const { policies } = services;
  const actor = (request: FastifyRequest) => resolveActor(request, config, services.auth);

  app.get("/api/v1/assessments/framework", async request => { await actor(request); return services.assessments.framework(); });
  app.get("/api/v1/ai-systems/:id/assessments", async request => services.assessments.history(await actor(request), idParams.parse(request.params).id));
  app.post("/api/v1/ai-systems/:id/assessments", async (request, reply) => {
    requireSameOrigin(request, config);
    const assessment = await services.assessments.assess(await actor(request), idParams.parse(request.params).id, assessmentInput.parse(request.body));
    return reply.code(201).send(assessment);
  });

  app.get("/api/v1/reports/audit", async request => services.reports.auditLog(await actor(request), auditQuery.parse(request.query)));
  app.get("/api/v1/reports/audit.csv", async (request, reply) => {
    const csv = await services.reports.auditCsv(await actor(request), auditQuery.parse(request.query));
    return reply.type("text/csv; charset=utf-8").header("content-disposition", `attachment; filename="governbright-audit-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
  });
  app.get("/api/v1/reports/evidence", async request => services.reports.evidence(await actor(request)));
  app.get("/api/v1/reports/evidence.html", async (request, reply) =>
    reply.type("text/html; charset=utf-8").header("cache-control", "no-store").send(renderEvidenceHtml(await services.reports.evidence(await actor(request)))));

  app.get("/api/v1/catalog", async request => { await actor(request); return services.catalog.list(); });

  const toolKeyParams = z.object({ key: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120) });
  app.get("/api/v1/discovery", async request => services.discovery.list(await actor(request)));
  app.post("/api/v1/discovery/import", { bodyLimit: 12 * 1024 * 1024 }, async request => {
    requireSameOrigin(request, config);
    return services.discovery.import(await actor(request), discoveryImport.parse(request.body));
  });
  app.post("/api/v1/discovery/:key/register", async (request, reply) => {
    requireSameOrigin(request, config);
    return reply.code(201).send(await services.discovery.register(await actor(request), toolKeyParams.parse(request.params).key));
  });
  app.post("/api/v1/discovery/:key/ignore", async (request, reply) => {
    requireSameOrigin(request, config);
    await services.discovery.setIgnored(await actor(request), toolKeyParams.parse(request.params).key, z.object({ ignored: z.boolean().default(true) }).parse(request.body ?? {}).ignored);
    return reply.code(204).send();
  });

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

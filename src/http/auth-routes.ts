import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { resolveActor } from "./auth.js";
import type { Services } from "./context.js";
import { requireSameOrigin, startSession } from "./shared.js";

const loginInput = z.object({ email: z.email().max(320), password: z.string().min(12).max(256), organizationId: z.uuid().optional() });
const mfaInput = z.object({ challenge: z.string().min(20).max(200), code: z.string().trim().min(6).max(20) });
const resetRequest = z.object({ email: z.email().max(320) });
const resetConfirm = z.object({ token: z.string().min(20).max(200), password: z.string().min(12).max(256) });
const limited = (max: number) => ({ config: { rateLimit: { max, timeWindow: "1 minute" } } });

export async function registerAuthRoutes(app: FastifyInstance, config: Config, services: Services): Promise<void> {
  const { auth, mfa, passwordReset } = services;
  const actor = (request: Parameters<typeof resolveActor>[0]) => resolveActor(request, config, auth, { allowMfaSetup: true });

  app.post("/api/v1/auth/login", limited(10), async (request, reply) => {
    requireSameOrigin(request, config);
    const input = loginInput.parse(request.body);
    const result = await auth.login(input.email, input.password, input.organizationId);
    if (result.kind === "mfa") return { mfaRequired: true, challenge: result.challenge };
    return startSession(reply, config, result);
  });
  app.post("/api/v1/auth/mfa/verify", limited(10), async (request, reply) => {
    requireSameOrigin(request, config);
    const input = mfaInput.parse(request.body);
    return startSession(reply, config, await auth.completeMfa(input.challenge, input.code));
  });
  app.post("/api/v1/auth/logout", async (request, reply) => {
    requireSameOrigin(request, config);
    if (request.cookies.gb_session) await auth.logout(request.cookies.gb_session);
    reply.clearCookie("gb_session", { path: "/" });
    return reply.code(204).send();
  });
  app.get("/api/v1/auth/me", async request => ({ user: await actor(request) }));

  app.post("/api/v1/auth/password-reset", limited(5), async (request, reply) => {
    requireSameOrigin(request, config);
    await passwordReset.request(resetRequest.parse(request.body).email);
    return reply.code(202).send({ status: "If that account exists, a reset link is on its way." });
  });
  app.post("/api/v1/auth/password-reset/confirm", limited(10), async (request, reply) => {
    requireSameOrigin(request, config);
    const input = resetConfirm.parse(request.body);
    await passwordReset.confirm(input.token, input.password);
    return reply.code(204).send();
  });

  app.post("/api/v1/auth/mfa/setup", async request => {
    requireSameOrigin(request, config);
    return mfa.beginEnrollment(await actor(request));
  });
  app.post("/api/v1/auth/mfa/enable", async request => {
    requireSameOrigin(request, config);
    return mfa.confirmEnrollment(await actor(request), z.object({ code: z.string().trim().length(6) }).parse(request.body).code);
  });
  app.post("/api/v1/auth/mfa/disable", async (request, reply) => {
    requireSameOrigin(request, config);
    await mfa.disable(await actor(request), z.object({ password: z.string().min(1).max(256) }).parse(request.body).password);
    return reply.code(204).send();
  });
}

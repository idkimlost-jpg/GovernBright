import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { ssoConnectionInput } from "../services/sso.js";
import { resolveActor } from "./auth.js";
import type { Services } from "./context.js";
import { requireSameOrigin, sessionCookie } from "./shared.js";

const STATE_COOKIE = "gb_sso_state";
// error_description is ignored: anyone can put text in this URL, so only a short error code is shown.
const callbackQuery = z.object({ code: z.string().max(4000).optional(), state: z.string().max(200).optional(), error: z.string().max(200).optional() }).loose();

// The callback answers with a same-site page that navigates home, so the browser sends the
// new SameSite=Strict session cookie (it would not on a redirect chain started by the IdP).
function landing(reply: FastifyReply, path: string) {
  const escaped = path.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return reply.type("text/html; charset=utf-8").header("cache-control", "no-store")
    .send(`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${escaped}"><title>Signing in…</title><a href="${escaped}">Continue</a>`);
}

export async function registerSsoRoutes(app: FastifyInstance, config: Config, services: Services): Promise<void> {
  const { sso, auth } = services;
  const actor = (request: Parameters<typeof resolveActor>[0]) => resolveActor(request, config, auth);
  const stateCookie = { path: "/api/v1/auth/sso", httpOnly: true, sameSite: "lax" as const, secure: config.NODE_ENV === "production", maxAge: 600 };

  app.post("/api/v1/auth/sso/start", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async (request, reply) => {
    requireSameOrigin(request, config);
    const { email } = z.object({ email: z.email().max(320) }).parse(request.body);
    const { redirectUrl, state } = await sso.start(email);
    reply.setCookie(STATE_COOKIE, state, stateCookie);
    return { redirectUrl };
  });

  app.get("/api/v1/auth/sso/callback", async (request, reply) => {
    const query = callbackQuery.parse(request.query);
    reply.clearCookie(STATE_COOKIE, { path: stateCookie.path });
    const fail = (message: string) => landing(reply, `/?sso_error=${encodeURIComponent(message)}`);
    if (query.error) return fail(/^[a-z_]{1,60}$/.test(query.error) ? `Your identity provider declined the sign-in (${query.error})` : "Your identity provider declined the sign-in");
    // The state must match the cookie set when this browser started the sign-in (login CSRF protection).
    if (!query.code || !query.state || request.cookies[STATE_COOKIE] !== query.state) return fail("This sign-in could not be verified; start again");
    try {
      const session = await sso.complete(query.state, query.code);
      reply.setCookie("gb_session", session.token, sessionCookie(config));
      return landing(reply, "/");
    } catch (error) {
      request.log.warn({ err: error }, "SSO sign-in failed");
      return fail(error instanceof Error && "statusCode" in error ? error.message : "Single sign-on failed");
    }
  });

  app.get("/api/v1/sso", async request => ({ connection: await sso.getConnection(await actor(request)), redirectUri: sso.redirectUri }));
  app.put("/api/v1/sso", async request => {
    requireSameOrigin(request, config);
    return { connection: await sso.saveConnection(await actor(request), ssoConnectionInput.parse(request.body)) };
  });
  app.post("/api/v1/sso/domains/:domain/verify", async request => {
    requireSameOrigin(request, config);
    const { domain } = z.object({ domain: z.string().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/) }).parse(request.params);
    return { connection: await sso.verifyDomain(await actor(request), domain) };
  });
  app.delete("/api/v1/sso", async (request, reply) => {
    requireSameOrigin(request, config);
    await sso.deleteConnection(await actor(request));
    return reply.code(204).send();
  });
}

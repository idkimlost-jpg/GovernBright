import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import type { AuthenticatedSession } from "../services/auth.js";

export const idParams = z.object({ id: z.uuid() });

export const httpError = (statusCode: number, message: string) => Object.assign(new Error(message), { statusCode });

export const sessionCookie = (config: Config) => ({ path: "/", httpOnly: true, sameSite: "strict" as const, secure: config.NODE_ENV === "production", maxAge: config.SESSION_TTL_HOURS * 3600 });

export function startSession(reply: FastifyReply, config: Config, session: { token: string; actor: AuthenticatedSession }) {
  reply.setCookie("gb_session", session.token, sessionCookie(config));
  return { user: session.actor };
}

export function requireSameOrigin(request: FastifyRequest, config: Config): void {
  if (!config.APP_ORIGIN || request.headers.origin === config.APP_ORIGIN) return;
  throw httpError(403, "Request origin is not allowed");
}

export const appOrigin = (config: Config) => config.APP_ORIGIN ?? `http://localhost:${config.PORT}`;

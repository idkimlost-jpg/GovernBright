import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import { roles, type RequestActor } from "../domain/types.js";
import type { AuthService } from "../services/auth.js";

const uuid = z.uuid();
const role = z.enum(roles);

// Development-only adapter. Production must replace this with verified identity-provider
// tokens, then resolve active membership from the database. Client headers alone are never authorization.
// Members of an organization that requires MFA can only reach the routes that let them
// enroll (allowMfaSetup) until they have turned it on.
export async function resolveActor(request: FastifyRequest, config: Config, auth: AuthService, options: { allowMfaSetup?: boolean } = {}): Promise<RequestActor> {
  const correlationId = uuid.safeParse(request.id).success ? request.id : randomUUID();
  const token = request.cookies.gb_session;
  if (token) {
    const session = await auth.resolve(token, correlationId);
    if (session.mfaSetupRequired && !options.allowMfaSetup) {
      throw Object.assign(new Error("Your organization requires two-factor authentication. Set it up to continue."), { statusCode: 403, code: "mfa_setup_required" });
    }
    return session;
  }
  if (config.ALLOW_DEV_AUTH && config.NODE_ENV !== "production") {
    return {
      userId: uuid.parse(request.headers["x-dev-user-id"]),
      organizationId: uuid.parse(request.headers["x-dev-organization-id"]),
      role: role.parse(request.headers["x-dev-role"]),
      correlationId
    };
  }
  const error = new Error("Authentication required") as Error & { statusCode: number };
  error.statusCode = 401;
  throw error;
}

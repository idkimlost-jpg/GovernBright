import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { createHarness, databaseUrl, password, type Harness } from "./helpers.js";

type Pending = { claims: Record<string, unknown>; challenge: string; signWith?: KeyObject };

// A minimal OpenID provider: discovery, JWKS and a token endpoint that checks PKCE and the client secret.
async function fakeIdp() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rogue = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
  const codes = new Map<string, Pending>();
  const server: FastifyInstance = Fastify();
  let issuer = "";
  server.get("/.well-known/openid-configuration", async () => ({ issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, jwks_uri: `${issuer}/jwks` }));
  server.get("/jwks", async () => ({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" }] }));
  server.post("/token", async (request, reply) => {
    const body = new URLSearchParams(request.body as string);
    const pending = codes.get(body.get("code") ?? "");
    const verifierOk = pending && createHash("sha256").update(body.get("code_verifier") ?? "").digest("base64url") === pending.challenge;
    if (!pending || !verifierOk || body.get("client_secret") !== "idp-secret") return reply.code(400).send({ error: "invalid_grant" });
    codes.delete(body.get("code")!);
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iss: issuer, aud: "gb-client", iat: now, exp: now + 300, ...pending.claims })).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), pending.signWith ?? privateKey).toString("base64url");
    return { id_token: `${header}.${payload}.${signature}`, token_type: "Bearer" };
  });
  server.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string" }, (_req, body, done) => done(null, body));
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  issuer = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  // Stands in for the user signing in at the IdP: registers a code for the redirect's nonce and PKCE challenge.
  const authorize = (redirectUrl: string, claims: Record<string, unknown>, options: { nonce?: string; signWith?: KeyObject } = {}) => {
    const url = new URL(redirectUrl), code = randomUUID();
    codes.set(code, { claims: { nonce: options.nonce ?? url.searchParams.get("nonce"), ...claims }, challenge: url.searchParams.get("code_challenge")!, ...(options.signWith ? { signWith: options.signWith } : {}) });
    return { code, state: url.searchParams.get("state")! };
  };
  return { issuer: () => issuer, authorize, rogue, close: () => server.close() };
}

describe.skipIf(!databaseUrl)("PostgreSQL integration: single sign-on", () => {
  let h: Harness, idp: Awaited<ReturnType<typeof fakeIdp>>, app: FastifyInstance;
  const headers = () => ({ origin: h.config.APP_ORIGIN! });
  beforeAll(async () => { h = createHarness(); idp = await fakeIdp(); app = await buildApp(h.config, h.services); });
  afterAll(async () => { await app.close(); await idp.close(); await h.close(); });

  async function setUp(options: { autoProvisionRole?: string | null; enforce?: boolean } = {}) {
    const a = await h.organization("SSO");
    const domain = `sso-${randomUUID().slice(0, 8)}.test`;
    await h.services.sso.saveConnection(a.owner, { issuer: idp.issuer(), clientId: "gb-client", clientSecret: "idp-secret", domains: [domain], enforce: options.enforce ?? false, autoProvisionRole: (options.autoProvisionRole ?? null) as never });
    return { ...a, domain };
  }
  async function start(email: string) {
    const response = await app.inject({ method: "POST", url: "/api/v1/auth/sso/start", headers: headers(), payload: { email } });
    expect(response.statusCode).toBe(200);
    return { redirectUrl: response.json().redirectUrl as string, cookie: String(response.headers["set-cookie"]).split(";")[0]! };
  }
  const callback = (code: string, state: string, cookie: string) => app.inject({ method: "GET", url: `/api/v1/auth/sso/callback?code=${code}&state=${state}`, headers: { cookie } });
  const sessionCookie = (response: { headers: Record<string, unknown> }) => ([] as string[]).concat(response.headers["set-cookie"] as string[]).find(c => c.startsWith("gb_session="))?.split(";")[0];

  it("signs an existing member in with a verified ID token and links the identity", async () => {
    const a = await setUp();
    const email = `pat@${a.domain}`;
    await h.services.members.add(a.owner, { email, displayName: "Pat", role: "contributor", password });
    const { redirectUrl, cookie } = await start(email);
    expect(redirectUrl).toContain("code_challenge_method=S256");
    const { code, state } = idp.authorize(redirectUrl, { sub: "idp-user-1", email, email_verified: true });
    const response = await callback(code, state, cookie);
    expect(response.body).toContain('url=/"');
    const session = sessionCookie(response);
    expect(session).toBeDefined();
    const me = await app.inject({ method: "GET", url: "/api/v1/auth/me", headers: { cookie: session! } });
    expect(me.json().user).toMatchObject({ email, role: "contributor" });
    const identity = await h.pool.query("SELECT 1 FROM user_identities WHERE subject = 'idp-user-1' AND issuer = $1", [idp.issuer()]);
    expect(identity.rowCount).toBe(1);
    // The state is single use.
    const replay = await callback(code, state, cookie);
    expect(sessionCookie(replay)).toBeUndefined();
  });

  it("rejects a missing state cookie, a forged signature and a wrong nonce", async () => {
    const a = await setUp();
    const email = `sam@${a.domain}`;
    await h.services.members.add(a.owner, { email, displayName: "Sam", role: "reviewer", password });

    const first = await start(email);
    const noCookie = idp.authorize(first.redirectUrl, { sub: "s1", email, email_verified: true });
    expect((await callback(noCookie.code, noCookie.state, "gb_sso_state=someone-else")).body).toContain("sso_error");

    const second = await start(email);
    const forged = idp.authorize(second.redirectUrl, { sub: "s1", email, email_verified: true }, { signWith: idp.rogue });
    const forgedResponse = await callback(forged.code, forged.state, second.cookie);
    expect(sessionCookie(forgedResponse)).toBeUndefined();
    expect(decodeURIComponent(forgedResponse.body)).toContain("signature is invalid");

    const third = await start(email);
    const wrongNonce = idp.authorize(third.redirectUrl, { sub: "s1", email, email_verified: true }, { nonce: "not-the-nonce" });
    expect(decodeURIComponent((await callback(wrongNonce.code, wrongNonce.state, third.cookie)).body)).toContain("nonce");
  });

  it("only creates accounts when auto-provisioning is on", async () => {
    const closed = await setUp();
    const stranger = await start(`new@${closed.domain}`);
    const denied = idp.authorize(stranger.redirectUrl, { sub: "n1", email: `new@${closed.domain}`, email_verified: true });
    expect(decodeURIComponent((await callback(denied.code, denied.state, stranger.cookie)).body)).toContain("ask your administrator");

    const open = await setUp({ autoProvisionRole: "read_only" });
    const newcomer = await start(`new@${open.domain}`);
    const allowed = idp.authorize(newcomer.redirectUrl, { sub: "n2", email: `new@${open.domain}`, email_verified: true, name: "New Person" });
    expect(sessionCookie(await callback(allowed.code, allowed.state, newcomer.cookie))).toBeDefined();
    const members = await h.services.members.list(open.owner);
    expect(members.find(m => m.email === `new@${open.domain}`)).toMatchObject({ role: "read_only", displayName: "New Person" });
  });

  it("blocks password sign-in on enforced domains except for owners", async () => {
    const a = await setUp({ enforce: true });
    const email = `lee@${a.domain}`;
    await h.services.members.add(a.owner, { email, displayName: "Lee", role: "admin", password });
    await expect(h.services.auth.login(email, password)).rejects.toMatchObject({ statusCode: 403, code: "sso_required" });
    expect((await h.services.auth.login(a.ownerEmail, password)).kind).toBe("session");
  });

  it("keeps each email domain with a single organization and never returns the client secret", async () => {
    const a = await setUp();
    const b = await h.organization("Other");
    await expect(h.services.sso.saveConnection(b.owner, { issuer: idp.issuer(), clientId: "x", clientSecret: "y", domains: [a.domain], enforce: false, autoProvisionRole: null })).rejects.toMatchObject({ statusCode: 409 });
    const connection = await h.services.sso.getConnection(a.owner);
    expect(JSON.stringify(connection)).not.toContain("idp-secret");
    expect(connection).toMatchObject({ domains: [a.domain], redirectUri: "http://localhost:3000/api/v1/auth/sso/callback" });
  });
});

import { createHash, createPublicKey, randomBytes, verify, type JsonWebKey } from "node:crypto";
import { assertPublicUrl } from "./network.js";

export type OidcDiscovery = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
export type IdTokenClaims = { iss: string; sub: string; aud: string | string[]; exp: number; iat: number; nonce?: string; email?: string; email_verified?: boolean | string; name?: string };

export class OidcError extends Error {
  readonly statusCode = 401;
}

const FETCH_TIMEOUT_MS = 10_000;
const CLOCK_SKEW_SECONDS = 120;

async function fetchJson<T>(url: string, init: RequestInit | undefined, allowLoopback: boolean): Promise<T> {
  await assertPublicUrl(url, { allowLoopback }).catch(error => { throw Object.assign(new OidcError(error.message), { statusCode: 400 }); });
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const body = await response.json().catch(() => null) as T | null;
  if (!response.ok || !body) throw new OidcError(`Identity provider request failed (${response.status}) for ${new URL(url).host}`);
  return body;
}

export const base64url = (buffer: Buffer) => buffer.toString("base64url");
export const randomToken = () => base64url(randomBytes(32));
export const pkceChallenge = (verifier: string) => base64url(createHash("sha256").update(verifier).digest());

// Discovery documents and signing keys, cached per issuer; keys refetch when an unknown key ID appears.
export class OidcClient {
  private readonly discovery = new Map<string, { value: OidcDiscovery; at: number }>();
  private readonly jwks = new Map<string, JsonWebKey[]>();

  // allowLoopbackHttp lets tests run a local identity provider; production requires https.
  constructor(private readonly allowLoopbackHttp = false) {}


  async discover(issuer: string): Promise<OidcDiscovery> {
    const cached = this.discovery.get(issuer);
    if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.value;
    const value = await fetchJson<OidcDiscovery>(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, undefined, this.allowLoopbackHttp);
    if (value.issuer.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw new OidcError("Identity provider issuer does not match its discovery document");
    for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
      if (!value[key]) throw new OidcError(`Identity provider discovery document has no ${key}`);
    }
    // The browser is sent to the authorization endpoint, so it must be https outside local tests.
    if (!value.authorization_endpoint.startsWith("https://") && !(this.allowLoopbackHttp && isLoopback(value.authorization_endpoint))) {
      throw Object.assign(new OidcError("Identity provider authorization_endpoint must use https"), { statusCode: 400 });
    }
    this.discovery.set(issuer, { value, at: Date.now() });
    return value;
  }

  authorizationUrl(discovery: OidcDiscovery, params: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string; loginHint?: string }): string {
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: "code", scope: "openid email profile", client_id: params.clientId, redirect_uri: params.redirectUri,
      state: params.state, nonce: params.nonce, code_challenge: params.codeChallenge, code_challenge_method: "S256",
      ...(params.loginHint ? { login_hint: params.loginHint } : {})
    }).toString();
    return url.toString();
  }

  async exchangeCode(discovery: OidcDiscovery, params: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string }): Promise<string> {
    const body = new URLSearchParams({ grant_type: "authorization_code", code: params.code, redirect_uri: params.redirectUri, code_verifier: params.codeVerifier, client_id: params.clientId, client_secret: params.clientSecret });
    const tokens = await fetchJson<{ id_token?: string }>(discovery.token_endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body }, this.allowLoopbackHttp);
    if (!tokens.id_token) throw new OidcError("Identity provider did not return an ID token");
    return tokens.id_token;
  }

  // Verifies signature, issuer, audience, expiry and nonce of an ID token.
  async verifyIdToken(discovery: OidcDiscovery, idToken: string, expected: { clientId: string; nonce: string }): Promise<IdTokenClaims> {
    const [encodedHeader, encodedPayload, encodedSignature] = idToken.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) throw new OidcError("Malformed ID token");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString()) as { alg?: string; kid?: string };
    const key = await this.signingKey(discovery, header.kid);
    const data = Buffer.from(`${encodedHeader}.${encodedPayload}`), signature = Buffer.from(encodedSignature, "base64url");
    const publicKey = createPublicKey({ key, format: "jwk" });
    const valid = header.alg === "RS256" ? verify("RSA-SHA256", data, publicKey, signature)
      : header.alg === "ES256" ? verify("sha256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, signature)
      : false;
    if (!valid) throw new OidcError("ID token signature is invalid");

    const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString()) as IdTokenClaims;
    const now = Math.floor(Date.now() / 1000);
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (claims.iss !== discovery.issuer) throw new OidcError("ID token issuer is not trusted");
    if (!audiences.includes(expected.clientId)) throw new OidcError("ID token was issued for a different application");
    if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SECONDS < now) throw new OidcError("ID token has expired");
    if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SECONDS > now) throw new OidcError("ID token is not valid yet");
    if (claims.nonce !== expected.nonce) throw new OidcError("ID token nonce does not match this sign-in");
    if (!claims.sub) throw new OidcError("ID token has no subject");
    return claims;
  }

  private async signingKey(discovery: OidcDiscovery, kid: string | undefined): Promise<JsonWebKey> {
    const find = (keys: JsonWebKey[] | undefined) => keys?.find(k => (kid ? k.kid === kid : true) && k.use !== "enc");
    let key = find(this.jwks.get(discovery.jwks_uri));
    if (!key) {
      const fetched = await fetchJson<{ keys: JsonWebKey[] }>(discovery.jwks_uri, undefined, this.allowLoopbackHttp);
      this.jwks.set(discovery.jwks_uri, fetched.keys);
      key = find(fetched.keys);
    }
    if (!key) throw new OidcError("Identity provider signing key not found");
    return key;
  }
}

// Allows http:// only for local test identity providers.
function isLoopback(url: string | undefined): boolean {
  if (!url) return false;
  try { const { protocol, hostname } = new URL(url); return protocol === "http:" && (hostname === "127.0.0.1" || hostname === "localhost"); }
  catch { return false; }
}

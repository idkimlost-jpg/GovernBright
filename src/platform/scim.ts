// Minimal SCIM 2.0 (RFC 7643/7644) user client: create, find by userName, and set active.
type Fetch = typeof fetch;
const USER_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:User";
const PATCH_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export class ScimError extends Error {}

export class ScimClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly fetchImpl: Fetch = fetch) {}

  private async call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> | null }> {
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, "")}${path}`, {
      method, redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { authorization: `Bearer ${this.token}`, accept: "application/scim+json, application/json", ...(body ? { "content-type": "application/scim+json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, json };
  }

  async findByUserName(userName: string): Promise<string | null> {
    const filter = encodeURIComponent(`userName eq "${userName.replace(/"/g, '\\"')}"`);
    const { status, json } = await this.call("GET", `/Users?filter=${filter}`);
    if (status >= 400) throw new ScimError(`SCIM lookup failed with HTTP ${status}`);
    const resources = (json?.Resources ?? []) as Array<{ id?: string }>;
    return resources[0]?.id ?? null;
  }

  // Creates the user, or reactivates the existing one with the same userName. Returns the SCIM id.
  async ensureActive(user: { email: string; displayName: string }, knownId?: string | null): Promise<string> {
    if (knownId) { await this.setActive(knownId, true); return knownId; }
    const [givenName, ...rest] = user.displayName.split(" ");
    const { status, json } = await this.call("POST", "/Users", {
      schemas: [USER_SCHEMA], userName: user.email, displayName: user.displayName, active: true,
      name: { givenName: givenName || user.displayName, familyName: rest.join(" ") || givenName || user.displayName },
      emails: [{ value: user.email, type: "work", primary: true }]
    });
    if (status === 201 || status === 200) {
      if (typeof json?.id !== "string") throw new ScimError("SCIM create returned no id");
      return json.id;
    }
    if (status === 409) {
      const id = await this.findByUserName(user.email);
      if (!id) throw new ScimError("SCIM reported a conflict but the user was not found");
      await this.setActive(id, true);
      return id;
    }
    throw new ScimError(`SCIM create failed with HTTP ${status}${typeof json?.detail === "string" ? `: ${json.detail}` : ""}`);
  }

  async setActive(id: string, active: boolean): Promise<void> {
    const { status } = await this.call("PATCH", `/Users/${encodeURIComponent(id)}`, { schemas: [PATCH_SCHEMA], Operations: [{ op: "replace", path: "active", value: active }] });
    if (status === 404 && !active) return;
    if (status >= 400) throw new ScimError(`SCIM update failed with HTTP ${status}`);
  }
}

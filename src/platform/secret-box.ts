import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretsUnavailableError extends Error {
  readonly statusCode = 503;
  constructor() { super("Stored secrets are unavailable: APP_ENCRYPTION_KEY is not configured"); }
}

// Encrypts integration secrets (OIDC client secrets, TOTP seeds, Slack webhooks,
// SCIM tokens) at rest with AES-256-GCM. Sealed values look like "v1:<iv>:<tag>:<data>".
export class SecretBox {
  private readonly key: Buffer | null;

  constructor(base64Key: string | undefined) {
    this.key = base64Key ? Buffer.from(base64Key, "base64") : null;
    if (this.key && this.key.length !== 32) throw new Error("APP_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  }

  get available(): boolean { return this.key !== null; }

  seal(plaintext: string): string {
    const key = this.requireKey(), iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return ["v1", iv, cipher.getAuthTag(), data].map(p => typeof p === "string" ? p : p.toString("base64url")).join(":");
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split(":");
    if (version !== "v1" || !iv || !tag || !data) throw new Error("Unrecognized sealed secret");
    const decipher = createDecipheriv("aes-256-gcm", this.requireKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  }

  private requireKey(): Buffer {
    if (!this.key) throw new SecretsUnavailableError();
    return this.key;
  }
}

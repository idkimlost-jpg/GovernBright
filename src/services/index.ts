import type pg from "pg";
import type { Config } from "../config.js";
import type { Services } from "../http/context.js";
import { appOrigin } from "../http/shared.js";
import { LogMailer, SmtpMailer, type Mailer } from "../platform/mailer.js";
import { SecretBox } from "../platform/secret-box.js";
import { AiSystemService } from "./ai-systems.js";
import { AuthService } from "./auth.js";
import { MemberService } from "./members.js";
import { MfaService } from "./mfa.js";
import { OrganizationService } from "./organization.js";
import { PasswordResetService } from "./password-reset.js";
import { SsoService } from "./sso.js";
import { OidcClient } from "../platform/oidc.js";
import { ToolRequestService } from "./tool-requests.js";

export type Platform = { secrets: SecretBox; mailer: Mailer };

export function createPlatform(config: Config): Platform {
  return {
    secrets: new SecretBox(config.APP_ENCRYPTION_KEY),
    mailer: config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new LogMailer(config.NODE_ENV !== "production")
  };
}

export function createServices(config: Config, pool: pg.Pool, platform: Platform = createPlatform(config)): Services {
  const { secrets, mailer } = platform;
  const auth = new AuthService(pool, config.SESSION_TTL_HOURS, secrets);
  return {
    auth,
    aiSystems: new AiSystemService(pool),
    toolRequests: new ToolRequestService(pool),
    members: new MemberService(pool),
    mfa: new MfaService(pool, secrets),
    passwordReset: new PasswordResetService(pool, mailer, appOrigin(config)),
    organization: new OrganizationService(pool),
    sso: new SsoService(pool, secrets, auth, new OidcClient(config.NODE_ENV !== "production"), appOrigin(config))
  };
}

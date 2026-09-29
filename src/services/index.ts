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
import { SsoService, type ResolveTxt } from "./sso.js";
import { resolveTxt } from "node:dns/promises";
import { PolicyService } from "./policies.js";
import { AssessmentService } from "./assessments.js";
import { ReportService } from "./reports.js";
import { CatalogService } from "./catalog.js";
import { DiscoveryService } from "./discovery.js";
import { ProvisioningService } from "./provisioning.js";
import { OidcClient } from "../platform/oidc.js";
import { Notifier } from "../platform/notifier.js";
import { ToolRequestService } from "./tool-requests.js";

export type Platform = { secrets: SecretBox; mailer: Mailer; fetch?: typeof fetch; resolveTxt?: ResolveTxt };

export function createPlatform(config: Config): Platform {
  return {
    secrets: new SecretBox(config.APP_ENCRYPTION_KEY),
    mailer: config.SMTP_URL ? new SmtpMailer(config.SMTP_URL, config.MAIL_FROM) : new LogMailer(config.NODE_ENV !== "production")
  };
}

export function createServices(config: Config, pool: pg.Pool, platform: Platform = createPlatform(config)): Services {
  const { secrets, mailer } = platform;
  const notifier = new Notifier(pool, secrets, appOrigin(config), platform.fetch);
  const auth = new AuthService(pool, config.SESSION_TTL_HOURS, secrets);
  const policies = new PolicyService(pool, notifier);
  const catalog = new CatalogService(pool);
  const provisioning = new ProvisioningService(pool, secrets, config.NODE_ENV !== "production", platform.fetch);
  return {
    auth,
    aiSystems: new AiSystemService(pool),
    toolRequests: new ToolRequestService(pool, policies, notifier, provisioning),
    provisioning,
    policies,
    assessments: new AssessmentService(pool),
    reports: new ReportService(pool),
    catalog,
    discovery: new DiscoveryService(pool, catalog),
    members: new MemberService(pool, provisioning),
    mfa: new MfaService(pool, secrets),
    passwordReset: new PasswordResetService(pool, mailer, appOrigin(config)),
    organization: new OrganizationService(pool, secrets, notifier),
    sso: new SsoService(pool, secrets, auth, new OidcClient(config.NODE_ENV !== "production"), appOrigin(config), platform.resolveTxt ?? resolveTxt)
  };
}

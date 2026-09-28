import type { AiSystemService } from "../services/ai-systems.js";
import type { AuthService } from "../services/auth.js";
import type { MemberService } from "../services/members.js";
import type { MfaService } from "../services/mfa.js";
import type { OrganizationService } from "../services/organization.js";
import type { PasswordResetService } from "../services/password-reset.js";
import type { SsoService } from "../services/sso.js";
import type { PolicyService } from "../services/policies.js";
import type { AssessmentService } from "../services/assessments.js";
import type { ToolRequestService } from "../services/tool-requests.js";

export type Services = {
  aiSystems: AiSystemService;
  auth: AuthService;
  toolRequests: ToolRequestService;
  members: MemberService;
  mfa: MfaService;
  passwordReset: PasswordResetService;
  organization: OrganizationService;
  sso: SsoService;
  policies: PolicyService;
  assessments: AssessmentService;
};

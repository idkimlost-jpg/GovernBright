import type { AiSystemService } from "../services/ai-systems.js";
import type { AuthService } from "../services/auth.js";
import type { MemberService } from "../services/members.js";
import type { MfaService } from "../services/mfa.js";
import type { OrganizationService } from "../services/organization.js";
import type { PasswordResetService } from "../services/password-reset.js";
import type { ToolRequestService } from "../services/tool-requests.js";

export type Services = {
  aiSystems: AiSystemService;
  auth: AuthService;
  toolRequests: ToolRequestService;
  members: MemberService;
  mfa: MfaService;
  passwordReset: PasswordResetService;
  organization: OrganizationService;
};

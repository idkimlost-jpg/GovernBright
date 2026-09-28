export const roles = ["owner", "admin", "contributor", "reviewer", "read_only"] as const;
export type Role = (typeof roles)[number];

export type RequestActor = {
  userId: string;
  organizationId: string;
  role: Role;
  correlationId: string;
};

export type AiSystem = {
  id: string;
  organizationId: string;
  name: string;
  purpose: string;
  vendor: string;
  ownerName: string;
  riskTier: "low" | "moderate" | "high" | "prohibited";
  status: "draft" | "under_review" | "approved" | "retired";
  nextReviewAt: string | null;
  createdAt: string;
  updatedAt: string;
};


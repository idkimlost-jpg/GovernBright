// Risk questionnaire and control catalog. Each control lists the framework clauses it supports
// so an assessment doubles as compliance evidence. The mappings are indicative starting points
// for an organization's own legal review, not legal advice.

export type FrameworkReference = { framework: "EU AI Act" | "NIST AI RMF 1.0" | "GDPR" | "ISO/IEC 42001"; clause: string; title: string };
export type Control = { id: string; title: string; references: FrameworkReference[] };
export type Question = { id: string; prompt: string; weight: number; controls: string[] };

const eu = (clause: string, title: string): FrameworkReference => ({ framework: "EU AI Act", clause, title });
const nist = (clause: string, title: string): FrameworkReference => ({ framework: "NIST AI RMF 1.0", clause, title });
const gdpr = (clause: string, title: string): FrameworkReference => ({ framework: "GDPR", clause, title });
const iso = (clause: string, title: string): FrameworkReference => ({ framework: "ISO/IEC 42001", clause, title });

export const controls: Record<string, Control> = {
  "named-owner": { id: "named-owner", title: "Named business owner accountable for the system", references: [nist("GOVERN 2.1", "Roles and responsibilities are documented"), iso("Clause 5.3", "Roles, responsibilities and authorities")] },
  "inventory-review": { id: "inventory-review", title: "Keep the inventory entry current and review it at least annually", references: [nist("GOVERN 1.6", "Mechanisms are in place to inventory AI systems")] },
  "data-minimization": { id: "data-minimization", title: "Data minimization and retention limits", references: [gdpr("Art. 5(1)(c), 5(1)(e)", "Data minimisation and storage limitation"), iso("Annex A.7", "Data for AI systems")] },
  "privacy-review": { id: "privacy-review", title: "Privacy review or data protection impact assessment", references: [gdpr("Art. 35", "Data protection impact assessment"), nist("MEASURE 2.10", "Privacy risk is examined and documented")] },
  "human-review": { id: "human-review", title: "Human review before consequential decisions", references: [gdpr("Art. 22", "Automated individual decision-making"), eu("Art. 14", "Human oversight")] },
  "notice-and-appeal": { id: "notice-and-appeal", title: "Notice to affected people and a way to contest outcomes", references: [eu("Art. 86", "Right to explanation of individual decision-making"), eu("Art. 50", "Transparency obligations"), gdpr("Art. 22(3)", "Right to contest the decision")] },
  "vendor-review": { id: "vendor-review", title: "Vendor security and data-processing review", references: [nist("GOVERN 6.1", "Third-party AI risks are addressed"), gdpr("Art. 28", "Processor obligations"), iso("Annex A.10", "Third-party and customer relationships")] },
  "legal-review": { id: "legal-review", title: "Legal and regulatory classification review", references: [eu("Art. 6 and Annex III", "Classification of high-risk AI systems"), nist("GOVERN 1.1", "Legal and regulatory requirements are understood")] },
  "oversight-procedure": { id: "oversight-procedure", title: "Documented human-oversight procedure with assigned people", references: [eu("Art. 26(2)", "Deployers assign human oversight"), eu("Art. 14", "Human oversight"), nist("GOVERN 3.2", "Human-AI oversight roles are defined")] },
  "traceability": { id: "traceability", title: "Model documentation, logging and output traceability", references: [eu("Art. 12", "Record-keeping"), eu("Art. 26(6)", "Deployers keep logs"), nist("MEASURE 2.8", "Transparency and accountability risks are examined")] },
  "incident-playbook": { id: "incident-playbook", title: "AI incident response and reporting playbook", references: [eu("Art. 73", "Reporting of serious incidents"), eu("Art. 26(5)", "Deployer monitoring and informing the provider"), nist("MANAGE 4.3", "Incidents are communicated and tracked")] },
  "ongoing-monitoring": { id: "ongoing-monitoring", title: "Quarterly monitoring and executive sign-off", references: [nist("MANAGE 4.1", "Post-deployment monitoring is implemented"), eu("Art. 26(5)", "Deployers monitor operation"), iso("Clause 9.1", "Monitoring, measurement, analysis and evaluation")] },
  "prohibited-use": { id: "prohibited-use", title: "Stop: the use falls under a prohibited AI practice", references: [eu("Art. 5", "Prohibited AI practices")] }
};

export const questions: Question[] = [
  { id: "sensitiveData", prompt: "Does it process personal, confidential or regulated data?", weight: 18, controls: ["data-minimization", "privacy-review"] },
  { id: "customerImpact", prompt: "Can its output materially affect customers, employees or the public?", weight: 16, controls: ["human-review", "notice-and-appeal"] },
  { id: "automatedDecision", prompt: "Does it make or drive decisions without a person reviewing each one?", weight: 18, controls: ["human-review", "notice-and-appeal"] },
  { id: "externalAccess", prompt: "Is data sent to or hosted by an outside vendor?", weight: 10, controls: ["vendor-review"] },
  { id: "regulatedUse", prompt: "Is it used for hiring, credit, insurance, healthcare, education, law enforcement or another regulated area?", weight: 16, controls: ["legal-review"] },
  { id: "limitedOversight", prompt: "Is human oversight limited or unassigned?", weight: 10, controls: ["oversight-procedure"] },
  { id: "lowTransparency", prompt: "Is it hard to explain or trace how outputs are produced?", weight: 6, controls: ["traceability"] },
  { id: "weakIncidentPlan", prompt: "Is there no plan for handling harmful or wrong outputs?", weight: 6, controls: ["incident-playbook"] },
  { id: "prohibitedPractice", prompt: "Does it involve social scoring, manipulative techniques, emotion recognition at work or school, untargeted facial-image scraping, or another practice banned by EU AI Act Article 5?", weight: 0, controls: ["prohibited-use"] }
];

export type Tier = "low" | "moderate" | "high" | "prohibited";
export type Decision = "approved" | "conditional" | "prohibited";
export type AssessmentResult = { score: number; tier: Tier; decision: Decision; controls: Control[] };

export function evaluate(responses: Record<string, boolean>): AssessmentResult {
  const score = questions.reduce((sum, q) => sum + (responses[q.id] ? q.weight : 0), 0);
  const prohibited = responses.prohibitedPractice === true;
  const tier: Tier = prohibited || score >= 75 ? "prohibited" : score >= 50 ? "high" : score >= 25 ? "moderate" : "low";
  const decision: Decision = tier === "prohibited" ? "prohibited" : tier === "high" ? "conditional" : "approved";
  const ids = new Set(["named-owner", "inventory-review"]);
  for (const q of questions) if (responses[q.id]) q.controls.forEach(c => ids.add(c));
  if (score >= 50) ids.add("ongoing-monitoring");
  return { score, tier, decision, controls: [...ids].map(id => controls[id]!) };
}

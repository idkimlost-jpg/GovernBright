import { describe, expect, it } from "vitest";
import { controls, evaluate, questions } from "./assessment-framework.js";

const none = Object.fromEntries(questions.map(q => [q.id, false]));

describe("risk assessment framework", () => {
  it("approves a low-risk system with baseline controls", () => {
    const result = evaluate(none);
    expect(result).toMatchObject({ score: 0, tier: "low", decision: "approved" });
    expect(result.controls.map(c => c.id)).toEqual(["named-owner", "inventory-review"]);
  });

  it("makes high-risk systems conditional with monitoring and mapped references", () => {
    const result = evaluate({ ...none, sensitiveData: true, automatedDecision: true, customerImpact: true });
    expect(result).toMatchObject({ score: 52, tier: "high", decision: "conditional" });
    const ids = result.controls.map(c => c.id);
    expect(ids).toEqual(expect.arrayContaining(["privacy-review", "human-review", "notice-and-appeal", "ongoing-monitoring"]));
    expect(result.controls.find(c => c.id === "human-review")!.references.map(r => `${r.framework} ${r.clause}`)).toContain("EU AI Act Art. 14");
  });

  it("treats an Article 5 practice as prohibited regardless of score", () => {
    expect(evaluate({ ...none, prohibitedPractice: true })).toMatchObject({ tier: "prohibited", decision: "prohibited" });
  });

  it("gives every control at least one framework reference and every question known controls", () => {
    for (const control of Object.values(controls)) expect(control.references.length).toBeGreaterThan(0);
    for (const question of questions) for (const id of question.controls) expect(controls[id]).toBeDefined();
    expect(questions.reduce((sum, q) => sum + q.weight, 0)).toBe(100);
  });
});

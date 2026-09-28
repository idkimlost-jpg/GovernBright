import { describe, expect, it } from "vitest";
import { matchTool } from "./discovery.js";

const matchers = [
  { key: "chatgpt", name: "ChatGPT", domains: ["chatgpt.com", "openai.com"], keywords: ["openai", "chatgpt"] },
  { key: "claude", name: "Claude", domains: ["claude.ai"], keywords: ["anthropic"] }
];

describe("vendor matching", () => {
  it("matches domains, subdomains and keywords on word boundaries", () => {
    expect(matchTool("OPENAI *CHATGPT SUBSCR", matchers)?.key).toBe("chatgpt");
    expect(matchTool("https://platform.openai.com/login", matchers)?.key).toBe("chatgpt");
    expect(matchTool("ANTHROPIC, PBC", matchers)?.key).toBe("claude");
    expect(matchTool("claude.ai.evil.com", matchers)).toBeNull();
    expect(matchTool("notopenai.example", matchers)).toBeNull();
    expect(matchTool("Zoom Video", matchers)).toBeNull();
  });
});

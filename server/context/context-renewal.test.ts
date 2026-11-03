import { describe, expect, it } from "vitest";
import { classifyError } from "../drivers/retry.ts";
import { contextFullMessage, isContextFullText, pushRenewalStep, renewalPrompt, type RenewalStep } from "./context-renewal.ts";

describe("context renewal", () => {
  it("knows each engine's context-full words", () => {
    for (const said of [
      "Autocompact is thrashing: the context refilled to the limit within 3 turns of the previous compact, 3 times in a row.",
      'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 215000 tokens > 200000 maximum"}}',
      "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
      "context_length_exceeded",
    ]) expect(isContextFullText(said), said).toBe(true);
    expect(isContextFullText("The context of this ticket is long, so here is a summary.")).toBe(false);
  });

  it("words a second overflow plainly, with no command to type, and no transient or account cause", () => {
    const message = contextFullMessage("Claude");
    expect(message).not.toMatch(/\/clear|\/compact|thrash/i);
    expect(classifyError({ text: message })).toEqual({ transient: false, reason: "unknown" });
  });

  it("hands the fresh session the conversation and a bounded note of the steps already taken", () => {
    const steps: RenewalStep[] = [];
    for (let i = 0; i < 40; i++) pushRenewalStep(steps, { name: "Bash", summary: `nmap -p ${i} host ${"x".repeat(400)}`, ok: i % 2 === 0, output: "y".repeat(5_000) });
    const prompt = renewalPrompt({ base: "Earlier chat.\nCheck the ports", steps, lastText: "z".repeat(5_000) });
    expect(prompt.startsWith("Earlier chat.\nCheck the ports\n\n[Sagax note")).toBe(true);
    expect(prompt).toContain("nmap -p 39 host");
    expect(prompt).not.toContain("nmap -p 19 host");
    expect(prompt.length - "Earlier chat.\nCheck the ports\n\n".length).toBeLessThanOrEqual(6_000);
    expect(prompt.endsWith("]")).toBe(true);
  });
});

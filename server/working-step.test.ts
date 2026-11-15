import { describe, expect, it } from "vitest";
import { toolWorkingStep } from "./working-step.ts";

describe("toolWorkingStep (#4394)", () => {
  it("keeps the page a conversation's browser went to for its next steps", () => {
    const thread = "thread-4394-a";
    expect(toolWorkingStep({ name: "agent_browser_open", input: JSON.stringify({ url: "https://social.example/compose" }) }, thread))
      .toEqual({ key: "browse", detail: "social.example" });
    expect(toolWorkingStep({ name: "agent_browser_click", input: JSON.stringify({ selector: "@e4" }) }, thread)).toEqual({ key: "browse", detail: "social.example" });
    expect(toolWorkingStep({ name: "agent_browser_snapshot" }, thread)).toEqual({ key: "readPage", detail: "social.example" });
    // Another conversation's browser is its own.
    expect(toolWorkingStep({ name: "agent_browser_click" }, "thread-4394-b")).toEqual({ key: "browse" });
    // A step on another site moves it.
    toolWorkingStep({ name: "mcp__browser__agent_browser_open", input: JSON.stringify({ url: "https://www.news.example/" }) }, thread);
    expect(toolWorkingStep({ name: "agent_browser_click" }, thread)).toEqual({ key: "browse", detail: "news.example" });
  });
});

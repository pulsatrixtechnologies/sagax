import { describe, expect, it } from "vitest";
import { harnessAllowed, harnessPairs, keyProvidersOfDriver, offeredHarnesses, recommendedHarness, type HarnessSource } from "./harness-matrix.ts";

const works = (source: HarnessSource, place: "solo" | "organization" = "solo") => offeredHarnesses(source, place).map((pair) => pair.harness);

describe("the harness matrix (#4329, design section 1)", () => {
  it("keeps a Claude subscription on its own tool only, with the reason", () => {
    const source: HarnessSource = { kind: "subscription", vendor: "anthropic", driver: "claudeAgent" };
    expect(works(source)).toEqual(["claudeAgent"]);
    const pi = harnessPairs(source, "solo").find((pair) => pair.harness === "piAgent");
    expect(pi?.mark).toBe("no");
    expect(pi?.reason).toBeTruthy();
    expect(recommendedHarness(source, "solo")).toBe("claudeAgent");
  });

  it("marks the OpenAI and xAI subscriptions under pi as larger work, never offered", () => {
    expect(works({ kind: "subscription", vendor: "openai", driver: "codex" })).toEqual(["codex"]);
    expect(harnessPairs({ kind: "subscription", vendor: "openai", driver: "codex" }, "solo").map((pair) => [pair.harness, pair.mark]))
      .toEqual([["codex", "works"], ["piAgent", "larger"], ["opencodeGo", "larger"], ["openai-compat", "no"]]);
    expect(harnessPairs({ kind: "subscription", vendor: "xai", driver: "grokAgent" }, "solo").map((pair) => [pair.harness, pair.mark]))
      .toEqual([["grokAgent", "works"], ["piAgent", "larger"], ["opencodeGo", "no"], ["grok", "no"]]);
  });

  it("offers another tool's sign-in on that tool only", () => {
    expect(works({ kind: "subscription", vendor: "moonshot", driver: "kimiAgent" })).toEqual(["kimiAgent"]);
  });

  it("states the key pairs exactly, OpenCode by place", () => {
    expect(works({ kind: "key", vendor: "anthropic" }, "solo")).toEqual(["claudeAgent", "piAgent", "opencodeGo"]);
    expect(works({ kind: "key", vendor: "anthropic" }, "organization")).toEqual(["claudeAgent", "piAgent"]);
    expect(works({ kind: "key", vendor: "openai" }, "organization")).toEqual(["openai-compat", "codex", "piAgent"]);
    expect(works({ kind: "key", vendor: "xai" })).toEqual(["grok", "grokAgent", "piAgent"]);
    expect(works({ kind: "key", vendor: "google" }, "solo")).toEqual(["geminiAgent", "piAgent", "opencodeGo"]);
    // stated for a solo computer only: not claimed on an organization server
    expect(harnessPairs({ kind: "key", vendor: "google" }, "organization").some((pair) => pair.harness === "opencodeGo")).toBe(false);
    expect(works({ kind: "key", vendor: "openrouter" })).toEqual(["openai-compat", "piAgent", "hermesAgent"]);
    expect(works({ kind: "key", vendor: "mistral" })).toEqual(["mistral", "piAgent"]);
    expect(works({ kind: "key", vendor: "meta" })).toEqual(["meta"]);
    expect(works({ kind: "key", vendor: "opencode" })).toEqual(["opencodeGo", "piAgent"]);
    // a vendor the design does not state: no pair invented
    expect(harnessPairs({ kind: "key", vendor: "acme" }, "solo")).toEqual([]);
  });

  it("states addresses, Azure and this computer", () => {
    expect(works({ kind: "address", protocol: "openai" })).toEqual(["openai-compat", "piAgent"]);
    expect(harnessPairs({ kind: "address", protocol: "openai" }, "solo").find((pair) => pair.harness === "claudeAgent")?.mark).toBe("no");
    expect(harnessPairs({ kind: "address", protocol: "anthropic" }, "solo").find((pair) => pair.harness === "claudeAgent")?.mark).toBe("small");
    expect(works({ kind: "azure" })).toEqual(["openai-compat"]);
    expect(works({ kind: "computer" })).toEqual(["piAgent", "codex", "grokAgent", "kimiAgent", "qwenAgent", "droidAgent", "hermesAgent", "opencodeGo"]);
    expect(works({ kind: "computer", speaksAnthropic: true })).toContain("claudeAgent");
    expect(harnessPairs({ kind: "computer" }, "solo").find((pair) => pair.harness === "openai-compat")?.mark).toBe("small");
  });

  it("recommends built in for a key or a server, and the bot's engine for this computer", () => {
    expect(recommendedHarness({ kind: "key", vendor: "openai" }, "solo")).toBe("openai-compat");
    expect(recommendedHarness({ kind: "key", vendor: "google" }, "solo")).toBe("geminiAgent");
    expect(recommendedHarness({ kind: "address", protocol: "openai" }, "solo")).toBe("openai-compat");
    expect(recommendedHarness({ kind: "computer" }, "solo", "codex")).toBe("codex");
    expect(harnessAllowed({ kind: "key", vendor: "anthropic" }, "organization", "opencodeGo")).toBe(false);
  });

  it("keeps the key table the server's credential order reads", () => {
    expect(keyProvidersOfDriver("hermesAgent")).toEqual(["openrouter", "glm", "zai"]);
    expect(keyProvidersOfDriver("piAgent")[0]).toBe("anthropic");
    expect(keyProvidersOfDriver("nothing")).toEqual([]);
  });
});

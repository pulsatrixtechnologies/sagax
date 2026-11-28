import { describe, expect, it } from "vitest";
import { harnessAllowed, harnessPairs, keyProvidersOfDriver, offeredHarnesses, recommendedHarness, type HarnessSource } from "./harness-matrix.ts";

const works = (source: HarnessSource, place: "solo" | "organization" = "solo") => offeredHarnesses(source, place).map((pair) => pair.harness);

describe("the harness matrix (#4329, design section 1)", () => {
  it("#4410: offers a Claude account under its own tool, pi and OpenCode, with no added sentence", () => {
    const source: HarnessSource = { kind: "subscription", vendor: "anthropic", driver: "claudeAgent" };
    for (const place of ["solo", "organization"] as const) {
      expect(works(source, place)).toEqual(["claudeAgent", "piAgent", "opencodeGo"]);
      // the owner's answer 1: the pair carries no reason, notice or billing line
      expect(harnessPairs(source, place).find((pair) => pair.harness === "piAgent")).toEqual({ harness: "piAgent", role: "pi", mark: "works" });
      expect(harnessPairs(source, place).find((pair) => pair.harness === "opencodeGo")).toEqual({ harness: "opencodeGo", role: "opencode", mark: "works" });
    }
    expect(recommendedHarness(source, "solo")).toBe("claudeAgent");
  });

  it("#5524: offers an OpenAI/Codex account under its own tool, pi and OpenCode", () => {
    const source: HarnessSource = { kind: "subscription", vendor: "openai", driver: "codex" };
    for (const place of ["solo", "organization"] as const) {
      expect(works(source, place)).toEqual(["codex", "piAgent", "opencodeGo"]);
      expect(harnessPairs(source, place).find((pair) => pair.harness === "piAgent")).toEqual({ harness: "piAgent", role: "pi", mark: "works" });
      expect(harnessPairs(source, place).find((pair) => pair.harness === "opencodeGo")).toEqual({ harness: "opencodeGo", role: "opencode", mark: "works" });
    }
    expect(recommendedHarness(source, "solo")).toBe("codex");
    expect(harnessPairs(source, "solo").find((pair) => pair.harness === "openai-compat")).toEqual({ harness: "openai-compat", role: "builtin", mark: "no", reason: "A subscription is not an API key." });
  });

  it("#4410 / #5525: offers a Grok account under its own tool and pi; OpenCode has no sign-in", () => {
    const source: HarnessSource = { kind: "subscription", vendor: "xai", driver: "grokAgent" };
    for (const place of ["solo", "organization"] as const) {
      expect(works(source, place)).toEqual(["grokAgent", "piAgent"]);
      expect(harnessPairs(source, place).find((pair) => pair.harness === "piAgent")).toEqual({ harness: "piAgent", role: "pi", mark: "works" });
      expect(harnessPairs(source, place).find((pair) => pair.harness === "opencodeGo")).toEqual({
        harness: "opencodeGo", role: "opencode", mark: "no", reason: "OpenCode has no sign-in for it.",
      });
    }
    expect(recommendedHarness(source, "solo")).toBe("grokAgent");
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

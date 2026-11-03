// Plan names (2026-11-03): a raw plan id never reaches the screen
// ("Codex self_serve_business_prolite" was shown as is).
import { beforeEach, describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import { humanPlanName, planRows } from "./plan-usage";

beforeEach(() => setLocale("en"));

describe("humanPlanName", () => {
  it("maps the known plan ids to their names", () => {
    expect(humanPlanName("self_serve_business_prolite")).toBe("Business");
    expect(humanPlanName("plus")).toBe("Plus");
    expect(humanPlanName("pro")).toBe("Pro");
    expect(humanPlanName("prolite")).toBe("Pro Lite");
    expect(humanPlanName("enterprise_cbp_usage_based")).toBe("Enterprise");
    expect(humanPlanName("default_claude_max_20x")).toBe("Max 20x");
  });

  it("keeps a name already written for people", () => {
    expect(humanPlanName("SuperGrok Heavy")).toBe("SuperGrok Heavy");
    expect(humanPlanName("Pro")).toBe("Pro");
  });

  it("cleans and title-cases any other id, never leaving snake_case", () => {
    expect(humanPlanName("team_annual_v2")).toBe("Team Annual V2");
    expect(humanPlanName("some-new.plan")).toBe("Some New Plan");
    for (const id of ["self_serve_business_prolite", "team_annual_v2", "weird__id_"]) expect(humanPlanName(id)).not.toMatch(/_/);
  });

  it("has no name for no plan", () => {
    expect(humanPlanName(null)).toBeNull();
    expect(humanPlanName("  ")).toBeNull();
  });

  it("names the plan on every row the menu and the page draw", () => {
    const [row] = planRows({ providers: [{ id: "codex", name: "Codex", driver: "codex", plan: "self_serve_business_prolite", ok: true, error: null, state: "windows" }] });
    expect(row!.plan).toBe("Business");
  });
});

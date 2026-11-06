import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { scopeLabel } from "./MyToolGrants";

describe("scopeLabel (#2080)", () => {
  it("renders a human label without the raw scope", () => {
    setLocale("en");
    const label = scopeLabel("agents:write");
    expect(label).toBe("Agents · Write");
    expect(label).not.toContain("agents:write");
    expect(scopeLabel("memory:read")).toBe("Memory · Read");
  });
});

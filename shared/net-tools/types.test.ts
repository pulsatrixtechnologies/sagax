import { describe, expect, it } from "vitest";

import { isNetCheckName, netLanguage, netOverallVerdict, netSortFindings, type NetVerdict } from "./types.ts";

const of = (...severities: NetVerdict[]) => severities.map((severity) => ({ severity }));

describe("net-tools model", () => {
  it("the overall verdict is the worst finding, and unknown never counts as a failure", () => {
    expect(netOverallVerdict(of("pass", "warn", "info"))).toBe("warn");
    expect(netOverallVerdict(of("pass", "fail", "warn"))).toBe("fail");
    expect(netOverallVerdict(of("pass", "unknown"))).toBe("pass");
    expect(netOverallVerdict(of("unknown", "info"))).toBe("unknown");
    expect(netOverallVerdict(of("info"))).toBe("info");
    expect(netOverallVerdict(of("unknown", "warn"))).toBe("warn");
    expect(netOverallVerdict([])).toBe("unknown");
  });

  it("sorts findings worst first and keeps order within a severity", () => {
    const findings = [{ code: "a", severity: "pass" }, { code: "b", severity: "info" }, { code: "c", severity: "fail" }, { code: "d", severity: "unknown" }, { code: "e", severity: "warn" }, { code: "f", severity: "fail" }] as const;
    expect(netSortFindings(findings).map((finding) => finding.code)).toEqual(["c", "f", "e", "d", "b", "a"]);
  });

  it("maps a language setting to en, fr or pt-BR", () => {
    expect(netLanguage("fr")).toBe("fr");
    expect(netLanguage("fr-CA")).toBe("fr");
    expect(netLanguage("pt")).toBe("pt-BR");
    expect(netLanguage("pt-br")).toBe("pt-BR");
    expect(netLanguage("pt_PT")).toBe("pt-BR");
    expect(netLanguage("de")).toBe("en");
    expect(netLanguage("french")).toBe("en");
    expect(netLanguage(undefined)).toBe("en");
  });

  it("knows the check names", () => {
    expect(isNetCheckName("mail_auth_check")).toBe(true);
    expect(isNetCheckName("traceroute")).toBe(false);
    expect(isNetCheckName(undefined)).toBe(false);
  });
});

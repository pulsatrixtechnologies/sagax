import { describe, expect, it } from "vitest";
import { approvalPlain } from "../shared/approval-describe.ts";
import { serverApprovalWords } from "./approval-words.ts";

describe("serverApprovalWords", () => {
  it("words a gated shell command in plain French", () => {
    const words = serverApprovalWords("fr", {});
    const plain = approvalPlain({ botName: "Cryptic", tool: "sagax-environment__run_command", toolInput: "{\"command\":\"echo hi\"}", detail: "sagax-environment__run_command {\"command\":\"echo hi\"}" }, words);
    expect(plain.title).toBe("Autoriser Cryptic à lancer une commande sur ton ordinateur cloud ?");
    expect(plain.line).not.toMatch(/Sagax Environment/);
  });
  it("env overrides the setting; unknown or empty is English", () => {
    expect(serverApprovalWords("en", { SAGAX_APPROVAL_LOCALE: "fr-CA" }).locale).toBe("fr-ca");
    expect(serverApprovalWords("", {}).locale).toBe("en");
    expect(serverApprovalWords("xx", {}).locale).toBe("en");
  });
});

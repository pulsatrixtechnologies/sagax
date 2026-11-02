import { describe, expect, it } from "vitest";
import {
  customApprovalParams,
  effectiveApprovalPolicy,
  mcpAppApprovalForm,
  codexNamedApprovalParams,
} from "./approvals.ts";
import { extendShellExclusions } from "./shell-policy.ts";

describe("mcpAppApprovalForm", () => {
  it("accepts a schema-backed one-time app-access form", () => {
    const form = mcpAppApprovalForm({
      mode: "form",
      message: "Allow ChatGPT to use Fixture App?",
      _meta: { app_name: "Fixture App" },
      requestedSchema: {
        properties: {
          approval: { enum: ["approve-once", "always"] },
        },
        required: ["approval"],
      },
    });
    expect(form).toEqual({
      tool: "Fixture App",
      summary: "Allow ChatGPT to use Fixture App?",
      allowResult: { action: "accept", content: { approval: "approve-once" } },
    });
  });

  it("declines a form without an application identity", () => {
    expect(mcpAppApprovalForm({
      mode: "form",
      message: "Enter a secret",
      requestedSchema: {
        properties: { secret: { enum: ["once"] } },
        required: ["secret"],
      },
    })).toBeNull();
  });

  it("declines a form whose only choice is persistent", () => {
    expect(mcpAppApprovalForm({
      mode: "form",
      message: "Allow ChatGPT to use Fixture App?",
      _meta: { app_name: "Fixture App" },
      requestedSchema: {
        properties: { approval: { enum: ["always", "forever"] } },
        required: ["approval"],
      },
    })).toBeNull();
  });
});

describe("extendShellExclusions", () => {
  it("extends a legacy exclude list", () => {
    expect(extendShellExclusions({ exclude: ["USER_SECRET_*"] }, ["SAGAX_GATE_CONFIG_*", "ELECTRON_RUN_AS_NODE"]))
      .toEqual({ "shell_environment_policy.exclude": ["USER_SECRET_*", "SAGAX_GATE_CONFIG_*", "ELECTRON_RUN_AS_NODE"] });
  });

  it("extends a filters table without mixing list fields", () => {
    expect(extendShellExclusions(
      { filters: { "USER_SECRET_*": "exclude", "KEEP_*": "include" } },
      ["SAGAX_GATE_CONFIG_*"],
    )).toEqual({
      "shell_environment_policy.filters": {
        "USER_SECRET_*": "exclude",
        "KEEP_*": "include",
        "SAGAX_GATE_CONFIG_*": "exclude",
      },
    });
  });

  it("refuses a mixed exclude+filters policy", () => {
    expect(() => extendShellExclusions(
      { exclude: ["A_*"], filters: { "B_*": "exclude" } },
      ["C_*"],
    )).toThrow(/shell environment exclusions/);
  });
});

describe("effectiveApprovalPolicy and customApprovalParams", () => {
  it("keeps a granular approval policy shape", () => {
    expect(effectiveApprovalPolicy({
      granular: { mcp_elicitations: true, rules: false, sandbox_approval: true, request_permissions: false },
    })).toEqual({
      granular: { mcp_elicitations: true, rules: false, sandbox_approval: true, request_permissions: false },
    });
  });

  it("falls back to on-request for an unknown policy", () => {
    expect(effectiveApprovalPolicy("mystery")).toBe("on-request");
  });

  it("reasserts Custom profile approvals without a sticky sandbox", () => {
    expect(customApprovalParams({
      default_permissions: "team-profile",
      approval_policy: "never",
      approvals_reviewer: "user",
      sandbox_mode: "danger-full-access",
    })).toEqual({
      thread: { permissions: "team-profile", approvalPolicy: "never", approvalsReviewer: "user" },
      turn: { permissions: "team-profile", approvalPolicy: "never", approvalsReviewer: "user" },
      fallback: {
        thread: { approvalPolicy: "never", approvalsReviewer: "user", sandbox: "danger-full-access" },
        turn: { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } },
      },
    });
  });
});

describe("codexNamedApprovalParams", () => {
  it("maps full and ask modes to Codex thread and turn fields", () => {
    expect(codexNamedApprovalParams("full").thread).toMatchObject({
      approvalPolicy: "never",
      sandbox: "danger-full-access",
    });
    expect(codexNamedApprovalParams("ask").turn).toMatchObject({
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandboxPolicy: { type: "workspaceWrite" },
    });
  });
});

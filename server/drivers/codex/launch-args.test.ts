import { describe, expect, it } from "vitest";
import {
  GUEST_CONFINED_CODEX_ARGS,
  chatgptPlanCodexArgs,
  codexAccessLaunch,
  codexShellDisabled,
  managedCodexArgs,
  ownerKeyCodexArgs,
} from "./launch-args.ts";

describe("codexShellDisabled", () => {
  it("requires shell, unified_exec and view_image all false", () => {
    expect(codexShellDisabled({ features: { shell_tool: false, unified_exec: false, view_image: false } })).toBe(true);
    expect(codexShellDisabled({ features: { shell_tool: false, unified_exec: false, view_image: true } })).toBe(false);
    expect(codexShellDisabled({})).toBe(false);
    expect(codexShellDisabled(null)).toBe(false);
  });
});

describe("codexAccessLaunch", () => {
  it("sets CODEX_HOME for a subscription home without owner key", () => {
    const env: Record<string, string | undefined> = {};
    expect(codexAccessLaunch(env, { via: "subscription", identity: "synthetic-bot", codexHome: "/tmp/synthetic-codex-home" })).toEqual({ ownerKey: false });
    expect(env.CODEX_HOME).toBe("/tmp/synthetic-codex-home");
  });

  it("injects the owner key env for owner-key access", () => {
    const env: Record<string, string | undefined> = {};
    const result = codexAccessLaunch(env, {
      via: "owner-key",
      identity: "synthetic-owner",
      codexOwnerKey: true,
      environment: { SAGAX_OWNER_OPENAI_API_KEY: "sk-synthetic" },
    });
    expect(result).toEqual({ ownerKey: true });
    expect(env.SAGAX_OWNER_OPENAI_API_KEY).toBe("sk-synthetic");
  });

  it("returns no owner key when access is absent", () => {
    expect(codexAccessLaunch({}, undefined)).toEqual({ ownerKey: false });
  });
});

describe("provider argv helpers", () => {
  it("keeps plan, managed and owner-key argv shapes stable", () => {
    expect(chatgptPlanCodexArgs().join("\n")).toContain('model_provider="openai_chatgpt_plan"');
    expect(managedCodexArgs({ url: "https://company.example/v1", models: ["m1"] }).join("\n"))
      .toContain('model_providers.openmaus_company.base_url="https://company.example/v1"');
    expect(ownerKeyCodexArgs().join("\n")).toContain('model_provider="pulsa_owner"');
    expect(GUEST_CONFINED_CODEX_ARGS).toContain("features.shell_tool=false");
  });
});

// upstream #4063: a ChatGPT plan's token renewed while Codex works.
import { describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SPAWNED_PROXIES } from "../../proxy-paths.ts";
import { chatgptPlanCodexArgs } from "./launch-args.ts";
import { codexRenewsPlanToken, planTokenBridges, planTokenRenewal } from "./plan-token.ts";

const exec = promisify(execFile);
const request = (env: Record<string, string>) => exec(process.execPath, [SPAWNED_PROXIES.chatgptPlanToken], { env: { ...process.env, ...env } });

describe("Codex plan token renewal check", () => {
  it("knows the first Codex that renews its token", () => {
    expect(codexRenewsPlanToken("codex-cli 0.160.0")).toBe(false);
    expect(codexRenewsPlanToken("codex-cli 0.165.0")).toBe(true);
    expect(codexRenewsPlanToken("codex-cli 1.0.0")).toBe(true);
    expect(codexRenewsPlanToken("unknown")).toBe(false);
  });

  it("reads the version once, and again only after a snapshot saw another one", async () => {
    const readVersion = vi.fn(async () => ({ version: "codex-cli 0.164.0" }));
    const renewal = planTokenRenewal(readVersion);
    expect(await renewal.supported()).toBe(false);
    expect(await renewal.supported()).toBe(false);
    expect(readVersion).toHaveBeenCalledTimes(1);
    expect(renewal.noteVersion("codex-cli 0.165.0")).toBe(true);
    expect(await renewal.supported()).toBe(true);
    expect(renewal.noteVersion("codex-cli 0.164.0")).toBe(false);
    expect(await renewal.supported()).toBe(false);
    expect(readVersion).toHaveBeenCalledTimes(1);
  });

  it("shares a read in flight and asks again after a failed one", async () => {
    let answer!: (probe: { version: string } | { reason: string }) => void;
    const readVersion = vi.fn(() => new Promise<{ version: string } | { reason: string }>((resolve) => { answer = resolve; }));
    const renewal = planTokenRenewal(readVersion);
    const first = renewal.supported(), concurrent = renewal.supported();
    expect(readVersion).toHaveBeenCalledTimes(1);
    answer({ reason: "timed out" });
    expect(await Promise.all([first, concurrent])).toEqual([false, false]);
    const next = renewal.supported();
    expect(readVersion).toHaveBeenCalledTimes(2);
    answer({ version: "codex-cli 1.0.0" });
    expect(await next).toBe(true);
    expect(await renewal.supported()).toBe(true);
    expect(readVersion).toHaveBeenCalledTimes(2);
  });
});

describe("Codex plan token bridges", () => {
  it("keeps one bridge per account generation, so a warm process keeps its launch env", async () => {
    let token = "synthetic-A";
    const bridges = planTokenBridges(async () => token);
    try {
      const first = await bridges.env(1, () => {});
      expect(await bridges.env(1, () => {})).toEqual(first);
      expect((await request(first)).stdout).toBe("synthetic-A");
      token = "synthetic-B";
      expect((await request(first)).stdout, "the token renews behind the same bridge").toBe("synthetic-B");
      const next = await bridges.env(2, () => {});
      expect(next.SAGAX_CODEX_AUTH_SECRET).not.toBe(first.SAGAX_CODEX_AUTH_SECRET);
      await expect(request(first), "the previous account's bridge is closed").rejects.toThrow();
    } finally {
      bridges.close();
    }
  });

  it("hands out no token once the account changed", async () => {
    let current = true;
    const bridges = planTokenBridges(async () => "synthetic-token");
    try {
      const env = await bridges.env(1, () => { if (!current) throw new Error("This ChatGPT account changed."); });
      current = false;
      await expect(request(env)).rejects.toThrow();
    } finally {
      bridges.close();
    }
  });

  it("gives Codex the token command in place of a fixed token when it renews", () => {
    const fixed = chatgptPlanCodexArgs().join(" ");
    expect(fixed).toContain('env_key="SAGAX_CHATGPT_TOKEN"');
    expect(fixed).not.toContain("auth.command");
    const renewing = chatgptPlanCodexArgs(true).join(" ");
    expect(renewing).not.toContain("env_key");
    expect(renewing).toContain(`auth.command=${JSON.stringify(process.execPath)}`);
    expect(renewing).toContain(JSON.stringify(SPAWNED_PROXIES.chatgptPlanToken));
  });
});

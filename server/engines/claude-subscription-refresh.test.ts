import { afterEach, describe, expect, it, vi } from "vitest";

import type { SubscriptionAccess } from "../cloud-agents/subscription-access.ts";
import {
  CLAUDE_RENEW_MARGIN_MS,
  claudeSubscriptionHomeKey,
  ensureClaudeSubscriptionFresh,
  onClaudeSubscriptionRenew,
  onClaudeSubscriptionRenewed,
  resetClaudeSubscriptionRefreshForTests,
} from "./claude-subscription-refresh.ts";

const NOW = Date.parse("2026-10-30T12:00:00Z");
const token = (n: string) => `sk-ant-oat01-${n}${"x".repeat(24)}`;

afterEach(() => {
  resetClaudeSubscriptionRefreshForTests();
});

function access(over: Partial<SubscriptionAccess> & { accessToken?: string } = {}): SubscriptionAccess {
  return {
    provider: "anthropic",
    accessToken: over.accessToken ?? token("a"),
    expiresAt: over.expiresAt === undefined ? NOW + 8 * 3_600_000 : over.expiresAt,
  };
}

describe("ensureClaudeSubscriptionFresh", () => {
  it("skips the CLI when the access token still has margin", async () => {
    const renew = vi.fn(async () => {});
    const read = vi.fn(async () => access());
    const result = await ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      now: () => NOW,
      read,
      renew,
    });
    expect(result).toEqual({ ok: true, renewed: false, expiresAt: NOW + 8 * 3_600_000 });
    expect(renew).not.toHaveBeenCalled();
  });

  it("renews once under a single flight when the token is near expiry", async () => {
    let current = access({ expiresAt: NOW + 60_000 });
    const renew = vi.fn(async () => {
      current = access({ accessToken: token("b"), expiresAt: NOW + 3_600_000 });
    });
    const beforeRenew = vi.fn(async () => {});
    const onRenewed = vi.fn();
    const retired: string[] = [];
    const stop = onClaudeSubscriptionRenew((dir) => { retired.push(dir); });

    const first = ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      now: () => NOW,
      marginMs: CLAUDE_RENEW_MARGIN_MS,
      read: async () => current,
      renew,
      beforeRenew,
      onRenewed,
    });
    const second = ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      now: () => NOW,
      read: async () => current,
      renew,
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { ok: true, renewed: true, expiresAt: NOW + 3_600_000 },
      { ok: true, renewed: true, expiresAt: NOW + 3_600_000 },
    ]);
    expect(renew).toHaveBeenCalledTimes(1);
    expect(beforeRenew).toHaveBeenCalledTimes(1);
    expect(onRenewed).toHaveBeenCalledTimes(1);
    expect(retired).toEqual([claudeSubscriptionHomeKey("/data/principals/pr_a/claude")]);
    stop();
  });

  it("notifies renewed hooks after a usable grant is back", async () => {
    const renewed: string[] = [];
    const stop = onClaudeSubscriptionRenewed((dir) => { renewed.push(dir); });
    let current = access({ expiresAt: NOW + 1_000 });
    await ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      now: () => NOW,
      read: async () => current,
      renew: async () => { current = access({ accessToken: token("e"), expiresAt: NOW + 3_600_000 }); },
    });
    expect(renewed).toEqual([claudeSubscriptionHomeKey("/data/principals/pr_a/claude")]);
    stop();
  });

  it("force-renews after a failed turn even when the token still looks fresh", async () => {
    let current = access({ expiresAt: NOW + 3_600_000 });
    const renew = vi.fn(async () => {
      current = access({ accessToken: token("c"), expiresAt: NOW + 7_200_000 });
    });
    const result = await ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      force: true,
      now: () => NOW,
      read: async () => current,
      renew,
    });
    expect(result).toEqual({ ok: true, renewed: true, expiresAt: NOW + 7_200_000 });
    expect(renew).toHaveBeenCalledTimes(1);
  });

  it("reports missing when the CLI renew leaves no access token", async () => {
    const result = await ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      force: true,
      now: () => NOW,
      read: async () => null,
      renew: async () => {},
    });
    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("reports expired when the renew leaves only a past access token", async () => {
    const result = await ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      force: true,
      now: () => NOW,
      read: async () => access({ expiresAt: NOW - 1 }),
      renew: async () => {},
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("joins an in-flight renew then force-renews only when that pass did not", async () => {
    let current = access({ expiresAt: NOW + 60_000 });
    let renews = 0;
    const renew = vi.fn(async () => {
      renews += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      // First flight (near-expiry) refreshes; a waiter that asked force
      // must not start a second CLI renew once that already rotated.
      current = access({ accessToken: token("d"), expiresAt: NOW + 3_600_000 });
    });
    const near = ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      now: () => NOW,
      read: async () => current,
      renew,
    });
    const forced = ensureClaudeSubscriptionFresh({
      loginDir: "/data/principals/pr_a/claude",
      cli: "claude",
      environment: {},
      force: true,
      now: () => NOW,
      read: async () => current,
      renew,
    });
    await expect(Promise.all([near, forced])).resolves.toEqual([
      { ok: true, renewed: true, expiresAt: NOW + 3_600_000 },
      { ok: true, renewed: true, expiresAt: NOW + 3_600_000 },
    ]);
    expect(renews).toBe(1);
  });
});

// #3519: an ACP engine's one-shot call signs in as the bot's turn does.
import { describe, expect, it, vi } from "vitest";

import type { TurnAccessInput } from "../../contracts.ts";
import { applyAcpAccess } from "./apply-access.ts";
import { createInstanceText } from "./instance-text.ts";
import type { AcpConfig, AcpSupport } from "./types.ts";

const access: TurnAccessInput = { via: "subscription", identity: "subscription:p1", engineHome: "/data/principals/p1/grok" };
const support = {
  applyAccess: (env: Record<string, string | undefined>, given: TurnAccessInput) => { env.HOME = given.engineHome; },
} as Pick<AcpSupport, "applyAccess">;

describe("applyAcpAccess", () => {
  it("points the child at the payer's own home, and leaves the server's own without an access", () => {
    const env: Record<string, string | undefined> = { HOME: "/server" };
    applyAcpAccess(env, support, "grokAgent", undefined, undefined);
    expect(env.HOME).toBe("/server");
    applyAcpAccess(env, support, "grokAgent", access, undefined);
    expect(env.HOME).toBe("/data/principals/p1/grok");
  });

  it("is what the one-shot call uses before its sign-in check reads the environment", async () => {
    const seen: Array<string | undefined> = [];
    const isAuthenticated = vi.fn(async (env: Record<string, string | undefined>) => { seen.push(env.HOME); return false; });
    const text = createInstanceText({
      support: { ...support, requireAuthenticationBeforeSpawn: true, isAuthenticated, loginNote: "Sign in to Grok again." } as unknown as AcpSupport,
      config: { cli: "grok", fullAuto: false } as unknown as AcpConfig,
      instanceId: "grok",
      driverKind: "grokAgent",
      childEnv: () => ({ HOME: "/server" }),
      getModels: () => ({ default: "grok", options: [{ id: "grok" }] }),
      getStartupModelRefresh: () => null,
    });
    await expect(text.generateMemoryText("capture", { access })).rejects.toThrow("Sign in to Grok again.");
    await expect(text.reviewPermission("review", undefined, access)).rejects.toThrow("Sign in to Grok again.");
    await expect(text.generateMemoryText("capture")).rejects.toThrow("Sign in to Grok again.");
    expect(seen).toEqual(["/data/principals/p1/grok", "/data/principals/p1/grok", "/server"]);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { AUTH_KEY_PREFIX, SAGAX_TAILSCALE_TAG } from "../../shared/bot-tailscale.ts";
import { FakeTailscaleControl } from "./bot-tailscale-control.ts";
import { BotTailscaleError, BotTailscaleService, botTailscaleScope, type BotTailscaleServiceOptions } from "./bot-tailscale.ts";
import type { SandboxTailscaleExec } from "./bot-tailscale-sandbox.ts";

const KEY = Buffer.alloc(32, 7);
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function service(control = new FakeTailscaleControl(), sandboxExecFor?: BotTailscaleServiceOptions["sandboxExecFor"]) {
  const dir = mkdtempSync(join(tmpdir(), "sagax-bot-ts-"));
  dirs.push(dir);
  return {
    dir,
    control,
    svc: new BotTailscaleService(dir, {
      keySource: () => ({ kind: "key", key: KEY }),
      control,
      sandboxExecFor,
      listComputers: () => [{ id: "sandbox:ada", label: "Ada's computer", place: "sandbox" }],
    }),
  };
}

describe("BotTailscaleService", () => {
  it("stores an auth key sealed and never returns it", async () => {
    const { dir, svc } = service();
    const scope = botTailscaleScope(true, "pr_ada")!;
    const view = await svc.setup(scope, {
      mode: "authKey",
      authKey: `${AUTH_KEY_PREFIX}ABCDEFGHlive`,
    });
    expect(view.phase).toBe("ready");
    expect(view.credentials?.hint).toBe("live");
    expect(JSON.stringify(view)).not.toMatch(/ABCDEFGH|tskey-auth-/);
    const sealed = readFileSync(join(dir, "principals", "pr_ada", "bot-tailscale.enc"), "utf8");
    expect(sealed).not.toContain("ABCDEFGH");
  });

  it("joins with a fake control API and stays pending until approved in the sandbox", async () => {
    const control = new FakeTailscaleControl();
    let status = JSON.stringify({
      BackendState: "NeedsMachineAuth",
      Self: { HostName: "ada-s-computer", DNSName: "ada-s-computer.", TailscaleIPs: [] },
    });
    const exec: SandboxTailscaleExec = {
      async exec(input) {
        if (input.argv[1] === "up") return { exitCode: 0, stdout: "up\n", stderr: "" };
        if (input.argv[1] === "status") return { exitCode: 0, stdout: status, stderr: "" };
        if (input.argv[1] === "stop") return { exitCode: 0, stdout: "stopped\n", stderr: "" };
        return { exitCode: 1, stdout: "", stderr: "no" };
      },
    };
    const { svc } = service(control, async () => exec);
    const scope = botTailscaleScope(true, "pr_ada")!;
    await svc.setup(scope, {
      mode: "oauth",
      clientId: "cid-1234",
      clientSecret: "csec-5678",
      tags: [SAGAX_TAILSCALE_TAG],
    });
    const joining = await svc.join(scope, { computerId: "sandbox:ada", keyKind: "ephemeral" });
    expect(joining.phase).toBe("pending_approval");
    expect(joining.device?.name).toContain("ada");
    expect(joining.computer?.label).toBe("Ada's computer");
    expect(JSON.stringify(joining)).not.toMatch(/csec-5678|fake-token|tskey-auth-fake/);

    status = JSON.stringify({
      BackendState: "Running",
      Self: { HostName: "ada-s-computer", DNSName: "ada-s-computer.tailnet.ts.net.", TailscaleIPs: ["100.64.0.10", "fd7a:115c::a"] },
    });
    const connected = await svc.refresh(scope);
    expect(connected.phase).toBe("connected");
    expect(connected.device?.addresses).toEqual(["100.64.0.10", "fd7a:115c::a"]);

    const disconnected = await svc.disconnect(scope);
    expect(disconnected.phase).toBe("ready");
    expect(disconnected.device).toBeNull();
    expect(disconnected.credentials?.kind).toBe("oauth");
  });

  it("refuses a bad auth key and isolates people", async () => {
    const { svc } = service();
    const ada = botTailscaleScope(true, "pr_ada")!;
    const bob = botTailscaleScope(true, "pr_bob")!;
    await expect(svc.setup(ada, { mode: "authKey", authKey: "nope" }))
      .rejects.toBeInstanceOf(BotTailscaleError);
    await svc.setup(ada, { mode: "authKey", authKey: `${AUTH_KEY_PREFIX}AAAAAAAAada1` });
    expect((await svc.view(bob)).credentials).toBeNull();
    expect((await svc.view(ada)).credentials?.hint).toBe("ada1");
  });
});

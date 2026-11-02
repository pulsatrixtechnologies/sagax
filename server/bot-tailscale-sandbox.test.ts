import { describe, expect, it } from "vitest";

import {
  USERSPACE_PROXY_ENV,
  USERSPACE_TAILSCALED_ARGV,
  deviceViewFromStatus,
  joinEnv,
  joinSandboxTailnet,
  parseTailscaleStatusJson,
  sagaxTailscaleUpArgv,
  tailscaleUpArgv,
  type SandboxTailscaleExec,
} from "./bot-tailscale-sandbox.ts";

describe("bot-tailscale-sandbox", () => {
  it("keeps userspace networking and proxy env for DENY_HOSTS-safe joins", () => {
    expect(USERSPACE_TAILSCALED_ARGV).toContain("--tun=userspace-networking");
    expect(USERSPACE_TAILSCALED_ARGV.some((a) => a.includes("/workspace/.tailscale"))).toBe(true);
    expect(USERSPACE_PROXY_ENV.ALL_PROXY).toContain("socks5h://localhost:1055");
    expect(sagaxTailscaleUpArgv()).toEqual(["sagax-tailscale", "up"]);
    expect(tailscaleUpArgv({
      authKey: "tskey-auth-ABCDEFGHxxxx",
      hostname: "Ada Bot",
      tags: ["tag:sagax"],
    })).toEqual([
      "tailscale",
      "up",
      "--auth-key=tskey-auth-ABCDEFGHxxxx",
      "--hostname=ada-bot",
      "--advertise-tags=tag:sagax",
      "--accept-dns=false",
      "--accept-routes=false",
    ]);
    expect(joinEnv({ authKey: "tskey-auth-ABCDEFGHxxxx", hostname: "Ada" })).toEqual({
      SAGAX_TS_AUTHKEY: "tskey-auth-ABCDEFGHxxxx",
      SAGAX_TS_HOSTNAME: "ada",
      SAGAX_TS_TAGS: "tag:sagax",
    });
  });

  it("parses NeedsMachineAuth as waiting for admin approval", () => {
    const pending = parseTailscaleStatusJson(JSON.stringify({
      BackendState: "NeedsMachineAuth",
      Self: { HostName: "ada-bot", DNSName: "ada-bot.tailnet.ts.net.", TailscaleIPs: [] },
    }));
    expect(pending?.pendingApproval).toBe(true);
    expect(deviceViewFromStatus(pending!).name).toContain("ada-bot");

    const connected = parseTailscaleStatusJson(JSON.stringify({
      BackendState: "Running",
      Self: { HostName: "ada-bot", DNSName: "ada-bot.tailnet.ts.net.", TailscaleIPs: ["100.64.0.9"] },
    }));
    expect(connected?.pendingApproval).toBe(false);
    expect(connected?.addresses).toEqual(["100.64.0.9"]);
  });

  it("joins through sagax-tailscale up with SAGAX_* env only", async () => {
    const seen: Array<{ argv: string[]; env?: Record<string, string> }> = [];
    const exec: SandboxTailscaleExec = {
      async exec(input) {
        seen.push({ argv: input.argv, env: input.env });
        if (input.argv[0] === "sagax-tailscale" && input.argv[1] === "up") {
          return { exitCode: 0, stdout: "up\n", stderr: "" };
        }
        if (input.argv[0] === "sagax-tailscale" && input.argv[1] === "status") {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              BackendState: "NeedsMachineAuth",
              Self: { HostName: "ada-bot", DNSName: "ada-bot.", TailscaleIPs: [] },
            }),
            stderr: "",
          };
        }
        return { exitCode: 1, stdout: "", stderr: "unexpected" };
      },
    };
    const device = await joinSandboxTailnet(exec, {
      authKey: "tskey-auth-ABCDEFGHxxxx",
      hostname: "Ada Bot",
    });
    expect(device.pendingApproval).toBe(true);
    expect(seen[0]?.argv).toEqual(["sagax-tailscale", "up"]);
    expect(seen[0]?.env?.SAGAX_TS_AUTHKEY).toBe("tskey-auth-ABCDEFGHxxxx");
    expect(Object.keys(seen[0]?.env ?? {}).every((k) => k.startsWith("SAGAX_"))).toBe(true);
  });
});

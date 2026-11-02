// Join a person's sandbox (AKS or Docker) to their tailnet with userspace
// networking only. Never installs or runs Tailscale on the node. DENY_HOSTS
// egress rules stay for everything outside the tailnet: this module only
// starts tailscaled inside the sandbox and points sandbox traffic at its
// local SOCKS/HTTP proxies when connected.
import {
  SAGAX_TAILSCALE_TAG,
  tailscaleHostname,
  type BotTailscaleDeviceView,
} from "../shared/bot-tailscale.ts";

/** Userspace tailscaled flags (also encoded in deploy/sandbox/sagax-tailscale). */
export const USERSPACE_TAILSCALED_ARGV = [
  "tailscaled",
  "--tun=userspace-networking",
  "--outbound-http-proxy-listen=localhost:1054",
  "--socks5-server=localhost:1055",
  "--statedir=/workspace/.tailscale",
  "--socket=/run/tailscale/tailscaled.sock",
] as const;

/** Proxy env a sandbox shell should export so traffic can use the tailnet.
 * Kernel routes to 100.64/10 stay denied by DENY_HOSTS; apps use these proxies. */
export const USERSPACE_PROXY_ENV: Readonly<Record<string, string>> = {
  ALL_PROXY: "socks5h://localhost:1055/",
  HTTP_PROXY: "http://localhost:1054/",
  HTTPS_PROXY: "http://localhost:1054/",
  http_proxy: "http://localhost:1054/",
  https_proxy: "http://localhost:1054/",
};

/** Env keys the sandbox exec surface accepts (SAGAX_* only). */
export function joinEnv(input: {
  authKey: string;
  hostname: string;
  tags?: readonly string[];
}): Record<string, string> {
  return {
    SAGAX_TS_AUTHKEY: input.authKey,
    SAGAX_TS_HOSTNAME: tailscaleHostname(input.hostname),
    SAGAX_TS_TAGS: (input.tags?.length ? input.tags : [SAGAX_TAILSCALE_TAG]).join(","),
  };
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Minimal exec surface (UserSandboxManager.exec or a test double). */
export interface SandboxTailscaleExec {
  exec(input: { argv: string[]; env?: Record<string, string>; timeoutMs?: number }): Promise<SandboxExecResult>;
}

export interface JoinSandboxInput {
  authKey: string;
  hostname: string;
  tags?: readonly string[];
  /** When true, skip waiting for a live status (tests). */
  skipWait?: boolean;
}

export interface SandboxTailscaleStatus {
  backendState: string;
  hostname: string;
  addresses: string[];
  /** Tailscale reports NeedsLogin / NoState while waiting for approval or key. */
  pendingApproval: boolean;
  selfName: string;
}

/** argv for sagax-tailscale up (auth key travels in SAGAX_TS_AUTHKEY env). */
export function sagaxTailscaleUpArgv(): string[] {
  return ["sagax-tailscale", "up"];
}

/** @deprecated Prefer sagax-tailscale up with joinEnv. Kept for unit coverage of the flag shape. */
export function tailscaleUpArgv(input: {
  authKey: string;
  hostname: string;
  tags?: readonly string[];
}): string[] {
  const tags = (input.tags?.length ? input.tags : [SAGAX_TAILSCALE_TAG]).join(",");
  return [
    "tailscale",
    "up",
    `--auth-key=${input.authKey}`,
    `--hostname=${tailscaleHostname(input.hostname)}`,
    `--advertise-tags=${tags}`,
    "--accept-dns=false",
    "--accept-routes=false",
  ];
}

/** Parse `tailscale status --json` into a compact view. */
export function parseTailscaleStatusJson(raw: string): SandboxTailscaleStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const row = parsed as Record<string, unknown>;
  const backendState = typeof row.BackendState === "string" ? row.BackendState : "Unknown";
  const self = row.Self && typeof row.Self === "object" ? row.Self as Record<string, unknown> : null;
  const hostName = self && typeof self.HostName === "string" ? self.HostName : "";
  const dns = self && typeof self.DNSName === "string" ? self.DNSName.replace(/\.$/, "") : "";
  const addresses = self && Array.isArray(self.TailscaleIPs)
    ? self.TailscaleIPs.filter((a): a is string => typeof a === "string")
    : [];
  const selfName = dns || hostName || "device";
  // NeedsMachineAuth = waiting for admin approval on the tailnet.
  const pendingApproval = backendState === "NeedsMachineAuth"
    || (backendState !== "Running" && addresses.length === 0);
  return {
    backendState,
    hostname: hostName || selfName,
    addresses,
    pendingApproval,
    selfName,
  };
}

export function deviceViewFromStatus(status: SandboxTailscaleStatus): BotTailscaleDeviceView {
  return {
    name: status.selfName || status.hostname || "device",
    addresses: [...status.addresses],
    pendingApproval: status.pendingApproval || status.backendState === "NeedsMachineAuth",
  };
}

/**
 * Start userspace tailscaled (if needed) and bring the sandbox onto the
 * tailnet. Pure orchestration over an exec handle; does not touch the node.
 */
export async function joinSandboxTailnet(
  exec: SandboxTailscaleExec,
  input: JoinSandboxInput,
): Promise<BotTailscaleDeviceView> {
  const up = await exec.exec({
    argv: sagaxTailscaleUpArgv(),
    env: joinEnv({
      authKey: input.authKey,
      hostname: input.hostname,
      tags: input.tags,
    }),
    timeoutMs: 90_000,
  });
  // sagax-tailscale up exits 0 even when NeedsMachineAuth; non-zero is a hard failure.
  if (up.exitCode !== 0) {
    const hint = summarizeUpFailure(up.stderr || up.stdout);
    throw new Error(hint);
  }

  const statusRaw = await exec.exec({
    argv: ["sagax-tailscale", "status"],
    timeoutMs: 15_000,
  });
  if (statusRaw.stdout.trim() === "stopped") {
    return {
      name: tailscaleHostname(input.hostname),
      addresses: [],
      pendingApproval: true,
    };
  }
  const status = parseTailscaleStatusJson(statusRaw.stdout);
  if (!status) {
    return {
      name: tailscaleHostname(input.hostname),
      addresses: [],
      pendingApproval: true,
    };
  }
  return deviceViewFromStatus(status);
}

/** Stop the sandbox's Tailscale client (leave the tailnet). */
export async function leaveSandboxTailnet(exec: SandboxTailscaleExec): Promise<void> {
  await exec.exec({
    argv: ["sagax-tailscale", "stop"],
    timeoutMs: 30_000,
  });
}

/** Read current status; null when tailscaled is not running. */
export async function readSandboxTailnet(exec: SandboxTailscaleExec): Promise<BotTailscaleDeviceView | null> {
  const raw = await exec.exec({
    argv: ["sagax-tailscale", "status"],
    timeoutMs: 15_000,
  });
  if (raw.exitCode !== 0 || raw.stdout.trim() === "stopped") return null;
  const status = parseTailscaleStatusJson(raw.stdout);
  return status ? deviceViewFromStatus(status) : null;
}

function summarizeUpFailure(text: string): string {
  const t = text.toLowerCase();
  if (/invalid|expired|auth.?key/.test(t)) return "The auth key was refused. Paste a fresh tagged key or reconnect the OAuth client.";
  if (/tag|acl|policy/.test(t)) return "The tailnet policy does not allow this tag. An admin must own tag:sagax.";
  if (/permission|forbidden|access denied/.test(t)) return "Tailscale refused the join. Check the OAuth client's scopes and tags.";
  return "The sandbox could not join the tailnet. Try again, or check Tailscale's admin console.";
}

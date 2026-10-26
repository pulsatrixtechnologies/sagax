// The Kubernetes cluster wake (0.5.3): a call routed to Kubernetes that finds
// the provisioner unreachable posts the start webhook once for the whole
// process, waits for GET /healthz, then runs. Docker is never touched, the
// URL never leaves the waker, and without the variable nothing changes.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONTROL_PLANE_ENV, stripControlPlaneEnv } from "./config.ts";
import { json as sendJson, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createComputerStatusRoutes } from "./routes/computer-status.ts";
import { dispatchRoutes } from "./routes/table.ts";
import { createUserSandboxRoutes } from "./user-sandbox-routes.ts";
import {
  DEFAULT_WAKE_TIMEOUT_MS, POST_WINDOW_MS, SANDBOX_STARTING_CODE, SANDBOX_STARTING_RETRY_DELAY_MS, SANDBOX_STARTING_RETRY_MS, SandboxClusterWaker, provisionerNotReached, provisionerUnreachable, sandboxWakeSettingsFromEnv,
} from "./sandbox-k8s-wake.ts";
import type { SandboxExecOutput, SandboxStatus } from "./sandboxd-core.ts";
import { SandboxdRequestError, sandboxdHealth, type SandboxdClient } from "./user-sandbox-client.ts";
import { UserSandboxManager, userSandboxSettingsFromEnv, type ClusterWaitEvent } from "./user-sandbox-manager.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const SECRET_URL = "https://wake.example.invalid/webhooks?token=s3cr3t-T0KEN-value";
const SECRET_PARTS = ["s3cr3t-T0KEN-value", "wake.example.invalid", SECRET_URL];

function refused(): Error {
  return Object.assign(new Error("connect ECONNREFUSED 10.0.0.4:8791"), { code: "ECONNREFUSED" });
}

function starting(): Error {
  return new SandboxdRequestError(503, SANDBOX_STARTING_CODE, "the server environment is still starting");
}

function reset(): Error {
  return Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
}

const RUNNING: SandboxStatus = { state: "running" } as unknown as SandboxStatus;
const EXEC_OK: SandboxExecOutput = { exitCode: 0, stdout: "ok", stderr: "" } as unknown as SandboxExecOutput;

/** A provisioner that refuses connections while `cluster.up` is false.
 * `faults[method]`: errors thrown, one per call, before answering. */
function fakeProvisioner(cluster: { up: boolean }, calls: string[], name: string, faults: Record<string, Error[]> = {}): SandboxdClient {
  const gate = async <T>(method: string, value: T): Promise<T> => {
    calls.push(`${name}:${method}`);
    if (!cluster.up) throw refused();
    const fault = faults[method]?.shift();
    if (fault) throw fault;
    return value;
  };
  return {
    info: () => gate("info", { instance: "default", egress: "enforced", maxRunning: 3, idleMinutes: 15 }),
    status: () => gate("status", RUNNING),
    ensure: () => gate("ensure", RUNNING),
    stop: () => gate("stop", RUNNING),
    pause: () => gate("pause", RUNNING),
    resume: () => gate("resume", RUNNING),
    markUsed: () => gate("markUsed", RUNNING),
    stats: () => gate("stats", {} as never),
    remove: () => gate("remove", RUNNING),
    exec: () => gate("exec", EXEC_OK),
    desktopStream: () => gate("desktopStream", {} as never),
    stdioStream: () => gate("stdioStream", {} as never),
  };
}

let dir: string;
let clock = 0;
let logs: string[];
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "sandbox-wake-"));
  clock = 1_000_000;
  logs = [];
  errorSpy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
  warnSpy = vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(" ")); });
});

afterEach(() => {
  errorSpy.mockRestore();
  logSpy.mockRestore();
  warnSpy.mockRestore();
  rmSync(dir, { recursive: true, force: true });
});

interface Rig {
  manager: UserSandboxManager;
  waker: SandboxClusterWaker;
  cluster: { up: boolean };
  calls: string[];
  posts: { url: string; method: string }[];
  probes: () => number;
  waits: ClusterWaitEvent[];
  faults: Record<string, Error[]>;
}

/** `upAfterProbes`: the cluster answers from that many health probes after the first webhook POST. */
function rig(options: { route?: "docker" | "kubernetes"; upAfterProbes?: number; timeoutMs?: number; webhook?: "ok" | "500" | "throw"; hold?: Promise<void> } = {}): Rig {
  const cluster = { up: false };
  const calls: string[] = [];
  const posts: { url: string; method: string }[] = [];
  let probes = 0;
  let probesAfterPost = 0;
  const waits: ClusterWaitEvent[] = [];
  const faults: Record<string, Error[]> = {};
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    posts.push({ url: String(input), method: init?.method ?? "GET" });
    if (options.webhook === "throw") throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${SECRET_URL}`), { code: "ENOTFOUND" }) });
    return new Response("{}", { status: options.webhook === "500" ? 500 : 202 });
  }) as typeof fetch;
  const waker = new SandboxClusterWaker({
    settings: { url: new URL(SECRET_URL), timeoutMs: options.timeoutMs ?? DEFAULT_WAKE_TIMEOUT_MS },
    health: async () => {
      probes += 1;
      if (posts.length > 0) {
        probesAfterPost += 1;
        if (probesAfterPost >= (options.upAfterProbes ?? 3)) cluster.up = true;
      }
      return cluster.up;
    },
    fetchImpl,
    now: () => clock,
    sleep: async (ms) => { if (options.hold) await options.hold; clock += ms; },
  });
  const manager = new UserSandboxManager({
    client: fakeProvisioner({ up: true }, calls, "docker"),
    kubernetes: fakeProvisioner(cluster, calls, "kubernetes", faults),
    kubernetesWaker: waker,
    onClusterWait: (event) => waits.push(event),
    backendFor: () => options.route ?? "kubernetes",
    instance: "default",
    stateFile: join(dir, "deletions.json"),
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });
  return { manager, waker, cluster, calls, posts, probes: () => probes, waits, faults };
}

function expectNoSecret(texts: readonly string[]): void {
  for (const text of texts) for (const part of SECRET_PARTS) expect(text).not.toContain(part);
}

describe("sandboxWakeSettingsFromEnv", () => {
  it("is off without the variable, and defaults the timeout to 9 minutes", () => {
    expect(sandboxWakeSettingsFromEnv({})).toBeNull();
    expect(sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: "  " })).toBeNull();
    const settings = sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL });
    expect(settings?.timeoutMs).toBe(9 * 60_000);
    expect(sandboxWakeSettingsFromEnv({ SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "300000" })?.timeoutMs).toBe(300_000);
  });

  it("refuses http, credentials and a bad timeout without echoing the URL", () => {
    const bad = [
      { SAGAX_SANDBOX_K8S_WAKE_URL: "http://wake.example.invalid/webhooks?token=s3cr3t-T0KEN-value" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: "https://user:s3cr3t-T0KEN-value@wake.example.invalid/" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: "not a url s3cr3t-T0KEN-value" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "1000" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "3600000" },
      { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, SAGAX_SANDBOX_K8S_WAKE_TIMEOUT_MS: "8m" },
    ];
    for (const env of bad) {
      let message = "";
      try { sandboxWakeSettingsFromEnv(env); } catch (error) { message = (error as Error).message; }
      expect(message).toMatch(/^SAGAX_SANDBOX_K8S_WAKE_(URL|TIMEOUT_MS) must be/);
      expectNoSecret([message]);
    }
  });

  it("is read only with a Kubernetes provisioner", () => {
    const base = { SAGAX_SANDBOXD_URL: "http://sagax-sandboxd:8791", SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL };
    expect(userSandboxSettingsFromEnv(base)?.wake).toBeNull();
    const withK8s = userSandboxSettingsFromEnv({ ...base, SAGAX_SANDBOXD_K8S_URL: "https://sagax-sandboxd-k8s:8791", SAGAX_SANDBOXD_TLS_CA: "/etc/ca.pem" });
    expect(withK8s?.wake?.url.href).toBe(SECRET_URL);
  });

  it("never reaches an engine's environment", () => {
    expect(CONTROL_PLANE_ENV).toContain("SAGAX_SANDBOX_K8S_WAKE_URL");
    const env: Record<string, string | undefined> = { SAGAX_SANDBOX_K8S_WAKE_URL: SECRET_URL, PATH: "/bin" };
    stripControlPlaneEnv(env);
    expect(env).toEqual({ PATH: "/bin" });
  });
});

describe("provisionerUnreachable", () => {
  it("counts no answer and gateway errors, not a refusal from the provisioner", () => {
    expect(provisionerUnreachable(refused())).toBe(true);
    expect(provisionerUnreachable(new Error("the provisioner did not answer"))).toBe(true);
    expect(provisionerUnreachable(Object.assign(new TypeError("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(502, "error", "the provisioner answered 502"))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(503, "error", "the provisioner answered 503"))).toBe(true);
    expect(provisionerUnreachable(new SandboxdRequestError(503, "egress_policy", "egress"))).toBe(false);
    expect(provisionerUnreachable(new SandboxdRequestError(404, "error", "not found"))).toBe(false);
    expect(provisionerNotReached(refused())).toBe(true);
    expect(provisionerNotReached(new SandboxdRequestError(503, "error", "x"))).toBe(true);
    expect(provisionerNotReached(new SandboxdRequestError(502, "error", "x"))).toBe(false);
    expect(provisionerNotReached(new Error("the provisioner did not answer"))).toBe(false);
  });
});

describe("the cluster wake", () => {
  it("wakes an unreachable provisioner, waits for /healthz, then runs the call", async () => {
    const r = rig({ upAfterProbes: 3 });
    const startedAt = clock;
    const result = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(result.exitCode).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.posts[0]!.method).toBe("POST");
    expect(r.calls).toEqual(["kubernetes:exec"]);
    expect(clock).toBeGreaterThan(startedAt);
    expect(r.waits).toEqual([{ principalId: ALICE, botId: "bot1", phase: "waiting" }]);
    // Healthy now: the next call goes straight through, no probe, no POST.
    const probes = r.probes();
    await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(r.probes()).toBe(probes);
    expect(r.posts).toHaveLength(1);
    expectNoSecret(logs);
  });

  it("posts once for many concurrent calls, which all wait on the same wake", async () => {
    const r = rig({ upAfterProbes: 4 });
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => r.manager.exec(ALICE, { argv: ["true"] }, `bot${index % 3}`)));
    expect(results.every((result) => result.exitCode === 0)).toBe(true);
    expect(r.posts).toHaveLength(1);
    expect(r.waker.posts).toBe(1);
    expect(r.waits.filter((event) => event.phase === "waiting")).toHaveLength(12);
    expect(r.calls.filter((call) => call === "kubernetes:exec")).toHaveLength(12);
  });

  it("gives up after the timeout with a clear error, no URL, and the turn can be sent again", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 5 * 60_000 });
    const startedAt = clock;
    const error = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1").then(() => { throw new Error("expected a timeout"); }, (caught: unknown) => caught as Error & { code?: string });
    expect(error).toMatchObject({ code: "cluster_start_timeout" });
    expect(error.message).toMatch(/did not start in time/);
    expect(clock - startedAt).toBeGreaterThanOrEqual(5 * 60_000);
    expect(clock - startedAt).toBeLessThan(5 * 60_000 + 30_000);
    expect(r.waits.map((event) => event.phase)).toEqual(["waiting", "timeout"]);
    // A successful POST is not repeated during the same wake.
    expect(r.posts).toHaveLength(1);
    expect(r.calls).toEqual([]);
    expectNoSecret([error.message, String(error.stack), JSON.stringify(error), ...logs]);
    // Sent again later: a new wake, a new POST (the window has passed), and it runs.
    r.cluster.up = true;
    const again = await r.manager.exec(ALICE, { argv: ["true"] }, "bot1");
    expect(again.exitCode).toBe(0);
  });

  it("never posts more than once per window, even when a wake times out and another starts", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 30_000 });
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    expect(r.posts).toHaveLength(1);
    clock += POST_WINDOW_MS;
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    expect(r.posts).toHaveLength(2);
  });

  it("retries a failed webhook only once per window, and logs no part of the URL", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 5 * 60_000, webhook: "throw" });
    const error = await r.manager.exec(ALICE, { argv: ["true"] }).then(() => { throw new Error("expected a timeout"); }, (caught: unknown) => caught as Error);
    expect(r.posts.length).toBeGreaterThanOrEqual(2);
    expect(r.posts.length).toBeLessThanOrEqual(3);
    expect(logs.some((line) => line.includes("start webhook unreachable (ENOTFOUND)"))).toBe(true);
    expectNoSecret([error.message, ...logs]);
  });

  it("a status read never starts the cluster: the environment reads stopped", async () => {
    const r = rig();
    const view = await r.manager.status(ALICE, "bot1");
    expect(view).toMatchObject({ state: "stopped", error: "cluster_stopped" });
    expect(await r.manager.workspaceOverQuota(ALICE, "bot1")).toBe(false);
    expect(await r.manager.markUsed(ALICE, "bot1")).toBe(false);
    expect(r.posts).toHaveLength(0);
    expect(r.calls).toEqual([]);
    expect(r.waits).toEqual([]);
  });

  it("a status read during a wake answers at once that the environment is starting", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const r = rig({ upAfterProbes: 3, hold });
    const waking = r.manager.exec(ALICE, { argv: ["true"] });
    await vi.waitFor(() => expect(r.waker.starting).toBe(true));
    expect(await r.manager.status(ALICE)).toMatchObject({ state: "unavailable", error: "cluster_starting" });
    release();
    await waking;
    expect(r.posts).toHaveLength(1);
  });

  it("Start in the Computer tab wakes it", async () => {
    const r = rig({ upAfterProbes: 2 });
    const view = await r.manager.power(ALICE, "start");
    expect(view.state).toBe("running");
    expect(r.posts).toHaveLength(1);
  });

  it("sends a call refused before it reached the provisioner once more after the wake", async () => {
    const r = rig({ upAfterProbes: 2 });
    r.cluster.up = true;
    await r.manager.exec(ALICE, { argv: ["true"] });
    // The cluster stops behind a provisioner seen healthy a moment ago.
    r.cluster.up = false;
    const result = await r.manager.exec(ALICE, { argv: ["true"] });
    expect(result.exitCode).toBe(0);
    expect(r.posts).toHaveLength(1);
    expect(r.calls).toEqual(["kubernetes:exec", "kubernetes:exec", "kubernetes:exec"]);
  });

  // 2026-10-19 (GOX): the provisioner answered after a cold start, then the
  // first exec waited on a node pool scaling 0 -> 1 and the routine gave up.
  it("sends a call again while the provisioner says the environment is still starting, then runs it once", async () => {
    const r = rig();
    r.cluster.up = true;
    r.faults.exec = [starting(), starting(), starting()];
    const result = await r.manager.exec(ALICE, { argv: ["gh", "auth", "status"] });
    expect(result.exitCode).toBe(0);
    expect(r.calls).toEqual(["kubernetes:exec", "kubernetes:exec", "kubernetes:exec", "kubernetes:exec"]);
    expect(r.posts).toHaveLength(0);
    expect(r.waits.map((wait) => wait.phase)).toContain("waiting");
  });

  it("stops sending a still-starting call after its bound, with the provisioner's refusal", async () => {
    const r = rig();
    r.cluster.up = true;
    r.faults.exec = Array.from({ length: 500 }, () => starting());
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: SANDBOX_STARTING_CODE });
    const sent = r.calls.length;
    expect(sent).toBeGreaterThan(10);
    expect(sent).toBeLessThanOrEqual(SANDBOX_STARTING_RETRY_MS / SANDBOX_STARTING_RETRY_DELAY_MS + 1);
  });

  it("a status read cut by a reset is sent once more; a command cut by a reset is not (it may have run)", async () => {
    const r = rig();
    r.cluster.up = true;
    r.faults.status = [reset()];
    const view = await r.manager.power(ALICE, "start");
    expect(view.state).toBe("running");
    // the cut read, the one sent again, then the view's own read
    expect(r.calls.filter((call) => call === "kubernetes:status")).toHaveLength(3);
    r.faults.exec = [reset()];
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toBeTruthy();
    expect(r.calls.filter((call) => call === "kubernetes:exec")).toHaveLength(1);
  });

  it("prewake starts the cluster and the person's environment before a routine of a bot that used it, and never on Docker", async () => {
    const r = rig({ upAfterProbes: 2 });
    // never used by this bot: nothing is woken or created
    expect(await r.manager.prewake(ALICE, "bot-1")).toBe(false);
    expect(r.posts).toHaveLength(0);
    r.cluster.up = true;
    await r.manager.exec(ALICE, { argv: ["true"] }, "bot-1");
    r.cluster.up = false;
    r.waker.markUnreachable();
    clock += 10 * 60_000;
    expect(await r.manager.prewake(ALICE, "bot-1")).toBe(true);
    expect(r.posts).toHaveLength(1);
    expect(r.calls.at(-1)).toBe("kubernetes:ensure");
    // a prewake is not a use: a week later it stops
    clock += 8 * 24 * 3600_000;
    expect(await r.manager.prewake(ALICE, "bot-1")).toBe(false);
    const docker = rig({ route: "docker" });
    await docker.manager.exec(ALICE, { argv: ["true"] }, "bot-1");
    docker.calls.length = 0;
    expect(await docker.manager.prewake(ALICE, "bot-1")).toBe(false);
    expect(docker.calls).toEqual([]);
    expect(docker.posts).toHaveLength(0);
  });

  it("never touches the Docker route", async () => {
    const r = rig({ route: "docker" });
    await r.manager.exec(ALICE, { argv: ["true"] });
    await r.manager.status(ALICE);
    await r.manager.power(ALICE, "start");
    expect(r.calls.every((call) => call.startsWith("docker:"))).toBe(true);
    expect(r.posts).toHaveLength(0);
    expect(r.probes()).toBe(0);
    expect(r.waits).toEqual([]);
  });

  it("without the variable, an unreachable provisioner fails the call as before", async () => {
    const calls: string[] = [];
    const manager = new UserSandboxManager({
      client: fakeProvisioner({ up: true }, calls, "docker"),
      kubernetes: fakeProvisioner({ up: false }, calls, "kubernetes"),
      backendFor: () => "kubernetes",
      instance: "default",
      stateFile: join(dir, "deletions.json"),
    });
    await expect(manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "unreachable" });
    expect((await manager.status(ALICE)).state).toBe("unavailable");
    expect(calls).toEqual(["kubernetes:exec", "kubernetes:status", "kubernetes:info"]);
  });
});

/** The Computer tab's two status routes over a real manager: the web one
 * (/api/me/server-environment) and the phone's (/api/computer/status). */
async function statusRoutes(manager: UserSandboxManager) {
  const auth = { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s", principalId: ALICE } } as unknown as RequestAuth;
  const routes = [
    createUserSandboxRoutes({ manager: () => manager, organization: true }),
    createComputerStatusRoutes({ organization: () => true, sandbox: () => manager, local: {} as never, mayManageLocal: () => false }),
  ];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json: sendJson, readBody })) sendJson(res, 404, {});
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const read = async () => {
    const web = await (await fetch(`${base}/api/me/server-environment`)).text();
    const phone = await (await fetch(`${base}/api/computer/status`)).text();
    expectNoSecret([web, phone]);
    return { web: JSON.parse(web) as Record<string, unknown>, phone: JSON.parse(phone) as Record<string, unknown> };
  };
  return { read, close: () => new Promise<void>((done) => server.close(() => done())) };
}

describe("the Computer tab while the cluster wakes", () => {
  it("says waking, with since when, during the wake, and leaks nothing of the webhook", async () => {
    let release = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const r = rig({ upAfterProbes: 3, hold });
    const routes = await statusRoutes(r.manager);
    try {
      const startedAt = clock;
      const waking = r.manager.exec(ALICE, { argv: ["true"] });
      await vi.waitFor(() => expect(r.waker.starting).toBe(true));
      const { web, phone } = await routes.read();
      expect(web).toMatchObject({ configured: true, state: "unavailable", error: "cluster_starting", waking: { since: startedAt, elapsedMs: 0 } });
      expect(phone).toMatchObject({ kind: "org-sandbox", problem: "cluster_starting", waking: { since: startedAt, elapsedMs: 0 } });
      expect(Object.keys(web.waking as object).sort()).toEqual(["elapsedMs", "since"]);
      release();
      await waking;
      // Up again: the status answers, no waking.
      const after = await routes.read();
      expect(after.web).toMatchObject({ state: "running" });
      expect(after.web).not.toHaveProperty("waking");
      expect(after.phone).not.toHaveProperty("waking");
    } finally {
      await routes.close();
    }
  });

  it("has no waking field when nothing wakes: a warm cluster, or a stopped one only read", async () => {
    const warm = rig();
    warm.cluster.up = true;
    const stopped = rig();
    for (const r of [warm, stopped]) {
      const routes = await statusRoutes(r.manager);
      try {
        const { web, phone } = await routes.read();
        expect(web).not.toHaveProperty("waking");
        expect(phone).not.toHaveProperty("waking");
      } finally {
        await routes.close();
      }
    }
    expect((await stopped.manager.status(ALICE)).state).toBe("stopped");
  });

  it("stays starting while a just woken cluster settles, and stops saying so after the wake window", async () => {
    const r = rig({ upAfterProbes: 2, timeoutMs: 5 * 60_000 });
    const startedAt = clock;
    await r.manager.power(ALICE, "start");
    // The provisioner answered once, then fails again while the cluster settles.
    r.cluster.up = false;
    expect(await r.manager.status(ALICE)).toMatchObject({ state: "unavailable", error: "cluster_starting", waking: { since: startedAt } });
    clock = startedAt + 5 * 60_000;
    const late = await r.manager.status(ALICE);
    expect(late).not.toHaveProperty("waking");
    expect(late.error).not.toBe("cluster_starting");
  });

  it("drops waking once a wake timed out, and never says it on the Docker route", async () => {
    const r = rig({ upAfterProbes: Number.POSITIVE_INFINITY, timeoutMs: 30_000 });
    await expect(r.manager.exec(ALICE, { argv: ["true"] })).rejects.toMatchObject({ code: "cluster_start_timeout" });
    expect(await r.manager.status(ALICE)).not.toHaveProperty("waking");

    let release = () => {};
    const hold = new Promise<void>((resolve) => { release = resolve; });
    let route: "docker" | "kubernetes" = "kubernetes";
    const shared = rig({ upAfterProbes: 3, hold });
    const manager = new UserSandboxManager({
      client: fakeProvisioner({ up: false }, [], "docker"),
      kubernetes: fakeProvisioner(shared.cluster, [], "kubernetes"),
      kubernetesWaker: shared.waker,
      backendFor: () => route,
      instance: "default",
      stateFile: join(dir, "deletions-docker.json"),
      now: () => clock,
    });
    const waking = manager.exec(ALICE, { argv: ["true"] });
    await vi.waitFor(() => expect(shared.waker.starting).toBe(true));
    route = "docker";
    expect(await manager.status(ALICE)).not.toHaveProperty("waking");
    route = "kubernetes";
    release();
    await waking;
  });
});

describe("sandboxdHealth", () => {
  it("is true on 200 from /healthz and false when nothing answers", async () => {
    const server = createServer((req, res) => {
      res.writeHead(req.url === "/healthz" ? 200 : 404);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      expect(await sandboxdHealth(`http://127.0.0.1:${port}`)(2_000)).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    expect(await sandboxdHealth(`http://127.0.0.1:${port}`)(2_000)).toBe(false);
  });
});

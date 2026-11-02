import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { request as httpsRequest, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SandboxAudit, SandboxAuditEvent } from "./sandbox-audit.ts";
import { SANDBOXD_AUTH_HEADER, SANDBOXD_RUNS_AUTH_CONTEXT, SandboxdVerifier, signSandboxdRequest } from "./sandboxd-auth.ts";
import type { K8sClient, K8sResponse } from "./sandboxd-k8s/sandboxd-k8s-client.ts";
import { kubernetesSandboxConfigFromEnv } from "./sandboxd-k8s/sandboxd-k8s-spec.ts";
import { RunService, createRunsServer } from "./sandboxd-runs.ts";
import { RUN_ENDED_ANNOTATION, runsConfigFromEnv, type RunsConfig } from "./sandboxd-runs-spec.ts";
import { sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const REGISTRY = "registry.example.com/agents";
const RUN_IMAGE = `${REGISTRY}/sagax-run:0.1.0@sha256:${"ab".repeat(32)}`;
const OWNER_A = "a".repeat(32);
const OWNER_B = "b".repeat(32);
const RUNS_KEY = "1".repeat(64);
const SANDBOX_KEY = "2".repeat(64);
const TOKEN = "T0ken-".repeat(8);
const NS = "sandbox-runs";

type Obj = Record<string, unknown>;

function runsConfig(extra: Record<string, string> = {}): RunsConfig {
  const env: NodeJS.ProcessEnv = {
    SANDBOX_BACKEND: "kubernetes",
    SAGAX_SANDBOX_IMAGE: `${REGISTRY}/sagax-sandbox:0.1.0@sha256:${"cd".repeat(32)}`,
    SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
    SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted-disk",
    SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
    SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
    SAGAX_SANDBOXD_TLS_CERT: "/tls/tls.crt",
    SAGAX_SANDBOXD_TLS_KEY: "/tls/tls.key",
    SAGAX_RUNS_ENABLED: "1",
    SAGAX_RUNS_ALLOWED_IMAGES: RUN_IMAGE,
    SAGAX_RUNS_PERSPICAX_CIDRS: "10.20.30.40/32",
    SAGAX_RUNS_GITHUB_CIDRS: "140.82.112.0/20",
    SAGAX_RUNS_CONTROL_URL: "wss://control.example.com/api/v1/agents/runner",
    SAGAX_RUNS_TLS_CLIENT_CA: "/tls-runs/client-ca.pem",
    SAGAX_RUNS_TLS_CLIENT_CN: "perspicax",
    ...extra,
  };
  const sandbox = sandboxdConfigFromEnv(env);
  const { k8s, guards } = kubernetesSandboxConfigFromEnv(env, sandbox);
  return runsConfigFromEnv(env, { k8s, guards, sandbox })!;
}

function mergePatch(target: Obj, patch: Obj): void {
  for (const [field, value] of Object.entries(patch)) {
    if (value === null) { delete target[field]; continue; }
    if (value && typeof value === "object" && !Array.isArray(value) && target[field] && typeof target[field] === "object" && !Array.isArray(target[field])) {
      mergePatch(target[field] as Obj, value as Obj);
      continue;
    }
    target[field] = value;
  }
}

/** A namespaced object store that answers like the API server would for
 * the calls the run service makes. It records every request. */
function memoryCluster() {
  const objects = new Map<string, Obj>();
  const calls: { method: string; path: string }[] = [];
  let uid = 0;
  objects.set("/apis/storage.k8s.io/v1/storageclasses/encrypted-disk", { metadata: { name: "encrypted-disk", annotations: { "sagax.pulsatrix.com/encrypted": "true" } } });
  objects.set(`/api/v1/namespaces/${NS}`, { metadata: { name: NS } });
  objects.set(`/api/v1/namespaces/${NS}/resourcequotas/sagax-run-quota`, { spec: { hard: { pods: "12", "requests.cpu": "48", "requests.memory": "96Gi", "requests.storage": "240Gi" } } });
  const client: K8sClient = {
    async request(method, path, body): Promise<K8sResponse> {
      calls.push({ method, path });
      const url = new URL(path, "https://kubernetes.local");
      const pathname = url.pathname;
      if (method === "GET" && url.searchParams.has("labelSelector")) {
        const wanted = (url.searchParams.get("labelSelector") ?? "").split(",").map((pair) => pair.split("=") as [string, string]);
        const prefix = `${pathname}/`;
        const items = [...objects.entries()].filter(([stored, obj]) => {
          if (!stored.startsWith(prefix) || stored.slice(prefix.length).includes("/")) return false;
          const labels = ((obj.metadata as Obj | undefined)?.labels ?? {}) as Record<string, string>;
          return wanted.every(([key, value]) => labels[key] === value);
        }).map(([, obj]) => obj);
        return { status: 200, body: { items } };
      }
      if (method === "GET") {
        const found = objects.get(pathname);
        return found ? { status: 200, body: found } : { status: 404, body: {} };
      }
      if (method === "DELETE") {
        if (!objects.delete(pathname)) return { status: 404, body: {} };
        // the garbage collector: a Pod's owned Secret goes with it
        for (const [stored, obj] of objects) {
          const owners = ((obj.metadata as Obj | undefined)?.ownerReferences ?? []) as Obj[];
          if (owners.some((owner) => pathname.endsWith(`/pods/${String(owner.name)}`))) objects.delete(stored);
        }
        return { status: 200, body: {} };
      }
      if (method === "PATCH") {
        const found = objects.get(pathname);
        if (!found) return { status: 404, body: {} };
        mergePatch(found, (body ?? {}) as Obj);
        return { status: 200, body: found };
      }
      const spec = JSON.parse(JSON.stringify(body ?? {})) as Obj;
      const meta = spec.metadata as Obj;
      const target = `${pathname}/${String(meta.name)}`;
      if (objects.has(target)) return { status: 409, body: { message: "exists" } };
      meta.uid = `00000000-0000-4000-8000-${String(++uid).padStart(12, "0")}`;
      meta.creationTimestamp = new Date(Date.parse("2026-10-18T12:00:00Z")).toISOString();
      if (spec.kind === "Pod") spec.status = { phase: "Pending" };
      objects.set(target, spec);
      return { status: 201, body: spec };
    },
    async exec() { throw new Error("runs never exec"); },
    async execStream() { throw new Error("runs never exec"); },
    async metrics() { return null; },
  };
  return { client, objects, calls };
}

function memoryAudit(): SandboxAudit & { events: SandboxAuditEvent[] } {
  const events: SandboxAuditEvent[] = [];
  return { file: "/dev/null", events, record(event) { events.push(event); } };
}

const podPath = (id: string) => `/api/v1/namespaces/${NS}/pods/run-${id}`;
const pvcPath = (id: string) => `/api/v1/namespaces/${NS}/persistentvolumeclaims/run-${id}-ws`;
const netPath = (id: string) => `/apis/networking.k8s.io/v1/namespaces/${NS}/networkpolicies/run-${id}-net`;
const secretPath = (id: string) => `/api/v1/namespaces/${NS}/secrets/run-${id}-token`;

function body(id: string, owner = OWNER_A, extra: Obj = {}): Obj {
  return { id, envId: "envabcdef01", ownerKey: owner, image: RUN_IMAGE, token: TOKEN, egress: "restreint", ...extra };
}

describe("RunService", () => {
  it("creates policy, disk, Pod and owned token, in that order", async () => {
    const cluster = memoryCluster();
    const audit = memoryAudit();
    const service = new RunService(runsConfig(), cluster.client, audit);
    const result = await service.create(body("run00001"));
    expect(result.created).toBe(true);
    expect(result.run).toMatchObject({ id: "run00001", phase: "pending", pod: true, workspace: true, egress: "restreint" });
    const creates = cluster.calls.filter((call) => call.method === "POST").map((call) => call.path.split("/").pop());
    expect(creates).toEqual(["networkpolicies", "persistentvolumeclaims", "pods", "secrets"]);
    const secret = cluster.objects.get(secretPath("run00001"))!;
    expect(((secret.metadata as Obj).ownerReferences as Obj[])[0]).toMatchObject({ kind: "Pod", uid: (cluster.objects.get(podPath("run00001"))!.metadata as Obj).uid });
    // the token never reaches the audit line or the answer
    expect(JSON.stringify(audit.events)).not.toContain(TOKEN);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
    // nothing touched the person-sandbox namespace
    expect(cluster.calls.some((call) => call.path.includes("/namespaces/sandboxes/"))).toBe(false);
  });

  it("is idempotent for a live Pod and refuses another run's id", async () => {
    const cluster = memoryCluster();
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    await service.create(body("run00002"));
    const again = await service.create(body("run00002"));
    expect(again.created).toBe(false);
    await expect(service.create(body("run00002", OWNER_B))).rejects.toMatchObject({ status: 409, code: "conflict" });
  });

  it("caps runs per person and in total", async () => {
    const cluster = memoryCluster();
    const service = new RunService(runsConfig({ SAGAX_RUNS_MAX_PODS: "5", SAGAX_RUNS_MAX_PER_OWNER: "4" }), cluster.client, memoryAudit());
    await Promise.all(["runa0001", "runa0002", "runa0003", "runa0004"].map((id) => service.create(body(id))));
    await expect(service.create(body("runa0005"))).rejects.toMatchObject({ status: 429, code: "quota" });
    await service.create(body("runb0001", OWNER_B));
    await expect(service.create(body("runb0002", OWNER_B))).rejects.toMatchObject({ status: 429, code: "quota" });
    // an ended Pod no longer counts
    (cluster.objects.get(podPath("runa0001"))!.status as Obj).phase = "Succeeded";
    await service.create(body("runb0002", OWNER_B));
  });

  it("stops a run, keeps the disk for a follow-up, then reuses it", async () => {
    const cluster = memoryCluster();
    const service = new RunService(runsConfig(), cluster.client, memoryAudit(), { now: () => Date.parse("2026-10-18T13:00:00Z") });
    await service.create(body("run00003"));
    const stopped = await service.remove("run00003", { keepWorkspace: true });
    expect(stopped).toMatchObject({ phase: "stopped", pod: false, workspace: true, workspaceExpiresAt: "2026-10-19T13:00:00.000Z" });
    // Stop must kill the job Pod at once (grace 0): a non-zero grace left
    // sandbox work running after API success (Lot D / OpenMausBot 1d1559fb1).
    expect(cluster.calls.some((call) => call.method === "DELETE" && call.path.includes(`/pods/run-run00003`) && call.path.includes("gracePeriodSeconds=0"))).toBe(true);
    expect(cluster.objects.has(secretPath("run00003"))).toBe(false);
    // the collector has not removed the old token yet: the create must
    cluster.objects.set(secretPath("run00003"), { metadata: { name: "run-run00003-token", labels: {} }, data: { token: "b2xk" } });
    const follow = await service.create(body("run00003", OWNER_A, { egress: "aucun" }));
    expect(Buffer.from(String((cluster.objects.get(secretPath("run00003"))!.data as Obj).token), "base64").toString()).toBe(TOKEN);
    expect(follow.created).toBe(true);
    const claim = cluster.objects.get(pvcPath("run00003"))!;
    expect(((claim.metadata as Obj).annotations as Obj)[RUN_ENDED_ANNOTATION]).toBeUndefined();
    // the follow-up's policy follows its profile
    expect(JSON.stringify(cluster.objects.get(netPath("run00003")))).not.toContain("140.82.112.0/20");
    const removed = await service.remove("run00003", { keepWorkspace: false });
    expect(removed).toEqual({ id: "run00003", phase: "removed" });
    for (const path of [podPath("run00003"), pvcPath("run00003"), netPath("run00003"), secretPath("run00003")]) expect(cluster.objects.has(path)).toBe(false);
  });

  it("refuses a follow-up on a Pod that has ended until it is deleted", async () => {
    const cluster = memoryCluster();
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    await service.create(body("run00004"));
    (cluster.objects.get(podPath("run00004"))!.status as Obj).phase = "Failed";
    await expect(service.create(body("run00004"))).rejects.toMatchObject({ status: 409, code: "run_ended" });
  });

  it("refuses an unencrypted StorageClass before any disk exists", async () => {
    const cluster = memoryCluster();
    cluster.objects.set("/apis/storage.k8s.io/v1/storageclasses/encrypted-disk", { metadata: { name: "encrypted-disk" } });
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    await expect(service.create(body("run00005"))).rejects.toMatchObject({ code: "storage" });
    expect(cluster.objects.has(pvcPath("run00005"))).toBe(false);
    expect(cluster.objects.has(podPath("run00005"))).toBe(false);
  });

  it("removes the Pod when the token cannot be written", async () => {
    const cluster = memoryCluster();
    const original = cluster.client.request.bind(cluster.client);
    cluster.client.request = async (method, path, payload, type) => {
      if (method === "POST" && path.endsWith("/secrets")) return { status: 500, body: {} };
      return original(method, path, payload, type);
    };
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    await expect(service.create(body("run00006"))).rejects.toThrow();
    expect(cluster.objects.has(podPath("run00006"))).toBe(false);
  });

  it("sweeps per the retention rules", async () => {
    const cluster = memoryCluster();
    let now = Date.parse("2026-10-18T12:00:00Z");
    const service = new RunService(runsConfig(), cluster.client, memoryAudit(), { now: () => now });
    await service.create(body("run00007"));
    const pod = cluster.objects.get(podPath("run00007"))!;
    pod.status = { phase: "Succeeded", containerStatuses: [{ state: { terminated: { finishedAt: "2026-10-18T12:30:00Z", exitCode: 0 } } }] };
    now = Date.parse("2026-10-18T12:40:00Z");
    expect(await service.sweep()).toEqual([]);
    now = Date.parse("2026-10-18T12:46:00Z");
    await service.sweep();
    expect(cluster.objects.has(podPath("run00007"))).toBe(false);
    expect(cluster.objects.has(pvcPath("run00007"))).toBe(true);
    now = Date.parse("2026-10-19T12:31:00Z");
    await service.sweep();
    expect(cluster.objects.has(pvcPath("run00007"))).toBe(false);
    expect(cluster.objects.has(netPath("run00007"))).toBe(false);
  });

  it("reports readiness problems of the run namespace", async () => {
    const cluster = memoryCluster();
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    expect(await service.readinessProblems()).toEqual([]);
    cluster.objects.delete(`/api/v1/namespaces/${NS}/resourcequotas/sagax-run-quota`);
    expect(await service.readinessProblems()).toEqual(["run namespace: ResourceQuota is missing"]);
  });
});

function openssl(args: string[]): void {
  execFileSync("openssl", args, { stdio: "ignore" });
}

interface Pki { ca: Buffer; serverCert: Buffer; serverKey: Buffer; clientCert: Buffer; clientKey: Buffer; rogueCert: Buffer; rogueKey: Buffer }

function makePki(dir: string): Pki {
  const ec = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  openssl(["req", "-x509", ...ec, "-keyout", join(dir, "ca.key"), "-out", join(dir, "ca.pem"), "-days", "1", "-subj", "/CN=test-runs-ca"]);
  const issue = (name: string, cn: string, ext: string) => {
    openssl(["req", ...ec, "-keyout", join(dir, `${name}.key`), "-out", join(dir, `${name}.csr`), "-subj", `/CN=${cn}`]);
    writeFileSync(join(dir, `${name}.ext`), ext);
    openssl(["x509", "-req", "-in", join(dir, `${name}.csr`), "-CA", join(dir, "ca.pem"), "-CAkey", join(dir, "ca.key"), "-CAcreateserial", "-out", join(dir, `${name}.pem`), "-days", "1", "-extfile", join(dir, `${name}.ext`)]);
  };
  issue("server", "127.0.0.1", "subjectAltName=IP:127.0.0.1\nextendedKeyUsage=serverAuth\n");
  issue("client", "perspicax", "extendedKeyUsage=clientAuth\n");
  openssl(["req", "-x509", ...ec, "-keyout", join(dir, "rogue.key"), "-out", join(dir, "rogue.pem"), "-days", "1", "-subj", "/CN=perspicax"]);
  const read = (file: string) => readFileSync(join(dir, file));
  return { ca: read("ca.pem"), serverCert: read("server.pem"), serverKey: read("server.key"), clientCert: read("client.pem"), clientKey: read("client.key"), rogueCert: read("rogue.pem"), rogueKey: read("rogue.key") };
}

describe("run listener (mutual TLS and the run key)", () => {
  let pki: Pki;
  let server: Server;
  let port = 0;
  let cluster: ReturnType<typeof memoryCluster>;

  beforeAll(async () => {
    pki = makePki(mkdtempSync(join(tmpdir(), "sagax-runs-pki-")));
    cluster = memoryCluster();
    const service = new RunService(runsConfig(), cluster.client, memoryAudit());
    server = createRunsServer(service, new SandboxdVerifier(RUNS_KEY, Date.now, SANDBOXD_RUNS_AUTH_CONTEXT), { cert: pki.serverCert, key: pki.serverKey, clientCa: pki.ca }, { clientSubject: "perspicax" });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  function call(method: string, path: string, payload: string, options: { key?: string; context?: string; cert?: "client" | "rogue" | "none" } = {}): Promise<{ status: number; body: Obj }> {
    const which = options.cert ?? "client";
    const tls = which === "client" ? { cert: pki.clientCert, key: pki.clientKey } : which === "rogue" ? { cert: pki.rogueCert, key: pki.rogueKey } : {};
    const signature = signSandboxdRequest(options.key ?? RUNS_KEY, method, path, payload, Date.now(), options.context ?? SANDBOXD_RUNS_AUTH_CONTEXT);
    return new Promise((resolve, reject) => {
      const req = httpsRequest({
        host: "127.0.0.1", port, method, path, ca: pki.ca, ...tls,
        headers: { [SANDBOXD_AUTH_HEADER]: signature, "content-type": "application/json", "content-length": Buffer.byteLength(payload) },
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) as Obj : {} });
        });
      });
      req.on("error", reject);
      req.end(payload);
    });
  }

  it("serves a signed call over a verified client certificate", async () => {
    const created = await call("POST", "/v1/runs", JSON.stringify(body("runtls01")));
    expect(created.status).toBe(201);
    const listed = await call("GET", "/v1/runs", "");
    expect(listed.status).toBe(200);
    expect(listed.body).toMatchObject({ active: 1, maxPods: 12, maxPerOwner: 4 });
    const one = await call("GET", "/v1/runs/runtls01", "");
    expect(one.body).toMatchObject({ id: "runtls01", phase: "pending" });
    const stopped = await call("DELETE", "/v1/runs/runtls01?keepWorkspace=1", "");
    expect(stopped.body).toMatchObject({ phase: "stopped", workspace: true });
  });

  it("refuses a connection without a client certificate or with one the CA did not sign", async () => {
    await expect(call("GET", "/v1/runs", "", { cert: "none" })).rejects.toThrow();
    await expect(call("GET", "/v1/runs", "", { cert: "rogue" })).rejects.toThrow();
  });

  it("refuses the person-sandbox key and context", async () => {
    expect((await call("GET", "/v1/runs", "", { key: SANDBOX_KEY })).status).toBe(401);
    expect((await call("GET", "/v1/runs", "", { context: "sagax-sandboxd-v1" })).status).toBe(401);
  });

  it("serves no person-sandbox route", async () => {
    const response = await call("POST", `/v1/sandboxes/${"c".repeat(32)}/ensure`, "");
    expect(response.status).toBe(404);
    expect(cluster.calls.some((entry) => entry.path.includes("/namespaces/sandboxes/"))).toBe(false);
  });

  it("answers a refused spec with its code", async () => {
    const response = await call("POST", "/v1/runs", JSON.stringify({ ...body("runtls02"), command: ["sh"] }));
    expect(response).toMatchObject({ status: 400, body: { code: "bad_request" } });
  });
});

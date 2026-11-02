// Cloud agent runs on the Kubernetes provisioner (lot P1.3 of the cloud
// agents spec). One Pod per run, never a person's sandbox. Perspicax is the
// only caller: its own listener, its own key (`sagax-sandboxd-runs-key`,
// signatures under their own context) and a client certificate the TLS
// layer requires. This listener serves /v1/runs and nothing else; the
// person-sandbox listener does not serve /v1/runs.
//
//   POST   /v1/runs                      create (or return) a run Pod
//   GET    /v1/runs                      list, with the quota counts
//   GET    /v1/runs/<id>                 one run
//   DELETE /v1/runs/<id>[?keepWorkspace=1]  stop; keep or drop the disk
//
// A sweep removes ended Pods after 15 min, Pods stuck in Pending, Pods past
// the hard cap, and disks 24 h after their run ended (decision D4).
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpsServer, type Server } from "node:https";
import { constants as tlsConstants } from "node:crypto";
import type { TLSSocket } from "node:tls";

import type { SandboxAudit } from "./sandbox-audit.ts";
import { SANDBOXD_AUTH_HEADER, type SandboxdVerifier } from "./sandboxd-auth.ts";
import type { K8sClient } from "./sandboxd-k8s/sandboxd-k8s-client.ts";
import { quotaProblems, storageClassEncrypts } from "./sandboxd-k8s/sandboxd-k8s-spec.ts";
import {
  RUN_ENDED_ANNOTATION,
  RUN_ENV_LABEL,
  RUN_ID_LABEL,
  RUN_ID_RE,
  RUN_LABEL,
  RUN_OWNER_LABEL,
  RunsError,
  parseRunRequest,
  planRunSweep,
  runNames,
  runNetworkPolicy,
  runPod,
  runPodActive,
  runPodProblems,
  runPvc,
  runStatus,
  runTokenSecret,
  type RunRequest,
  type RunStatus,
  type RunsConfig,
  type SweepAction,
} from "./sandboxd-runs-spec.ts";
import { SANDBOX_INSTANCE_LABEL } from "./user-sandbox-spec.ts";

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === "object" ? value as Obj : {};
}

function labelsOf(obj: Obj | null): Record<string, string> {
  return asObj(asObj(obj?.metadata).labels) as Record<string, string>;
}

const MAX_BODY_BYTES = 64 * 1024;
const DELETE_WAIT_MS = 30_000;

export interface RunServiceOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Serializes creates, deletes and the sweep: one replica, one queue, so
 * two creates cannot both pass the quota check. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => {});
    return next;
  }
}

export class RunService {
  readonly config: RunsConfig;
  private readonly client: K8sClient;
  private readonly audit: SandboxAudit;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly queue = new Queue();
  private encryptionOk = false;

  constructor(config: RunsConfig, client: K8sClient, audit: SandboxAudit, options: RunServiceOptions = {}) {
    this.config = config;
    this.client = client;
    this.audit = audit;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); }));
  }

  private path(kind: "pods" | "persistentvolumeclaims" | "secrets" | "networkpolicies", name?: string): string {
    const ns = this.config.namespace;
    const base = kind === "networkpolicies" ? `/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies` : `/api/v1/namespaces/${ns}/${kind}`;
    return name ? `${base}/${name}` : base;
  }

  private async read(path: string): Promise<Obj | null> {
    const response = await this.client.request("GET", path);
    if (response.status === 404) return null;
    if (response.status !== 200) throw new Error(`kubernetes GET failed (${response.status})`);
    return asObj(response.body);
  }

  private async createObject(path: string, body: Obj): Promise<Obj> {
    const response = await this.client.request("POST", path, body);
    if (response.status === 200 || response.status === 201 || response.status === 202) return asObj(response.body);
    if (response.status === 403 && /exceeded quota/i.test(String(asObj(response.body).message ?? ""))) {
      throw new RunsError(429, "quota", "the run namespace quota is full");
    }
    throw new Error(`kubernetes create failed (${response.status})`);
  }

  private async deleteObject(path: string, wait: boolean, grace = 10): Promise<void> {
    const response = await this.client.request("DELETE", `${path}?gracePeriodSeconds=${grace}`);
    if (response.status !== 200 && response.status !== 202 && response.status !== 404) throw new Error(`kubernetes delete failed (${response.status})`);
    if (!wait) return;
    const deadline = this.now() + DELETE_WAIT_MS;
    while (await this.read(path)) {
      if (this.now() > deadline) throw new RunsError(503, "deleting", "a run object is still being removed");
      await this.sleep(250);
    }
  }

  private async merge(path: string, patch: Obj): Promise<void> {
    const response = await this.client.request("PATCH", path, patch, "application/merge-patch+json");
    if (response.status !== 200 && response.status !== 201) throw new Error(`kubernetes patch failed (${response.status})`);
  }

  private async list(kind: "pods" | "persistentvolumeclaims" | "networkpolicies"): Promise<Obj[]> {
    const selector = encodeURIComponent(`${RUN_LABEL}=1,${SANDBOX_INSTANCE_LABEL}=${this.config.instance}`);
    const response = await this.client.request("GET", `${this.path(kind)}?labelSelector=${selector}`);
    if (response.status !== 200) throw new Error(`kubernetes list failed (${response.status})`);
    return (asObj(response.body).items ?? []) as Obj[];
  }

  private sameRun(obj: Obj | null, request: Pick<RunRequest, "id" | "envId" | "ownerKey">): boolean {
    const labels = labelsOf(obj);
    return labels[RUN_LABEL] === "1" && labels[RUN_ID_LABEL] === request.id && labels[RUN_ENV_LABEL] === request.envId && labels[RUN_OWNER_LABEL] === request.ownerKey;
  }

  private async ensureEncrypted(): Promise<void> {
    if (!this.config.requireEncryption || this.encryptionOk) return;
    const storageClass = await this.read(`/apis/storage.k8s.io/v1/storageclasses/${this.config.storageClass}`);
    const encrypts = storageClass ? storageClassEncrypts({
      parameters: asObj(storageClass.parameters) as Record<string, string>,
      annotations: asObj(asObj(storageClass.metadata).annotations) as Record<string, string>,
    }) : false;
    if (!encrypts) {
      this.audit.record({ action: "run.storage.encrypt", outcome: "denied", detail: { storageClass: this.config.storageClass } });
      throw new RunsError(503, "storage", "the run StorageClass does not advertise encryption at rest");
    }
    this.encryptionOk = true;
  }

  auditDenied(reason: string): void {
    this.audit.record({ action: "run.auth", outcome: "denied", detail: { reason } });
  }

  /** Readiness of the run namespace: its quota exists (so does the
   * namespace) and caps pods, CPU, memory and storage. Empty means the run
   * listener may serve. The provisioner has no cluster-wide read. */
  async readinessProblems(): Promise<string[]> {
    const quota = await this.client.request("GET", `/api/v1/namespaces/${this.config.namespace}/resourcequotas/${this.config.quotaName}`);
    const body = asObj(quota.body);
    const hard = quota.status === 200 ? { ...(asObj(asObj(body.spec).hard) as Record<string, string>), ...(asObj(asObj(body.status).hard) as Record<string, string>) } : null;
    return quotaProblems(hard).map((problem) => `run namespace: ${problem}`);
  }

  async status(id: string): Promise<RunStatus> {
    if (!RUN_ID_RE.test(id)) throw new RunsError(404, "not_found", "no such run");
    const names = runNames(id);
    const [pod, pvc] = await Promise.all([this.read(this.path("pods", names.pod)), this.read(this.path("persistentvolumeclaims", names.volume))]);
    const owned = (obj: Obj | null) => obj && labelsOf(obj)[RUN_LABEL] === "1" && labelsOf(obj)[SANDBOX_INSTANCE_LABEL] === this.config.instance ? obj : null;
    const ownPod = owned(pod);
    const ownPvc = owned(pvc);
    if (!ownPod && !ownPvc) throw new RunsError(404, "not_found", "no such run");
    return runStatus(id, ownPod, ownPvc, this.config);
  }

  async listRuns(): Promise<{ runs: RunStatus[]; active: number; maxPods: number; maxPerOwner: number }> {
    const [pods, claims] = await Promise.all([this.list("pods"), this.list("persistentvolumeclaims")]);
    const byId = new Map<string, { pod: Obj | null; pvc: Obj | null }>();
    for (const pod of pods) {
      const id = labelsOf(pod)[RUN_ID_LABEL] ?? "";
      if (RUN_ID_RE.test(id)) byId.set(id, { pod, pvc: null });
    }
    for (const claim of claims) {
      const id = labelsOf(claim)[RUN_ID_LABEL] ?? "";
      if (!RUN_ID_RE.test(id)) continue;
      const entry = byId.get(id) ?? { pod: null, pvc: null };
      entry.pvc = claim;
      byId.set(id, entry);
    }
    const runs = [...byId.entries()].map(([id, entry]) => runStatus(id, entry.pod, entry.pvc, this.config));
    return { runs, active: pods.filter(runPodActive).length, maxPods: this.config.maxPods, maxPerOwner: this.config.maxPerOwner };
  }

  /** Create the run's policy, disk, Pod and token, in that order: the Pod
   * never exists without its NetworkPolicy. Repeating the call for a Pod
   * that is still alive returns it unchanged (a retry is safe). */
  async create(body: unknown): Promise<{ created: boolean; run: RunStatus }> {
    const request = parseRunRequest(body, this.config);
    return this.queue.run(async () => {
      const names = runNames(request.id);
      const existing = await this.read(this.path("pods", names.pod));
      if (existing) {
        if (!this.sameRun(existing, request)) throw new RunsError(409, "conflict", "another run holds this id");
        if (!runPodActive(existing)) throw new RunsError(409, "run_ended", "the run Pod has ended; delete it with keepWorkspace=1 before a follow-up");
        return { created: false, run: await this.status(request.id) };
      }
      const pods = await this.list("pods");
      const active = pods.filter(runPodActive);
      if (active.length >= this.config.maxPods) {
        this.audit.record({ action: "run.create", outcome: "denied", detail: { run: request.id, reason: "max_pods" } });
        throw new RunsError(429, "quota", `at most ${this.config.maxPods} runs at once`);
      }
      if (active.filter((pod) => labelsOf(pod)[RUN_OWNER_LABEL] === request.ownerKey).length >= this.config.maxPerOwner) {
        this.audit.record({ action: "run.create", outcome: "denied", detail: { run: request.id, reason: "max_per_owner" } });
        throw new RunsError(429, "quota", `at most ${this.config.maxPerOwner} runs at once per person`);
      }

      const pod = runPod(this.config, request);
      const problems = runPodProblems(pod, this.config, request.id);
      if (problems.length) {
        this.audit.record({ action: "run.create", outcome: "denied", detail: { run: request.id, problems: problems.length } });
        throw new RunsError(400, "spec_refused", `run spec refused: ${problems.join(", ")}`);
      }

      const policy = runNetworkPolicy(this.config, request);
      const currentPolicy = await this.read(this.path("networkpolicies", names.network));
      if (currentPolicy) {
        if (!this.sameRun(currentPolicy, request)) throw new RunsError(409, "conflict", "another run holds this id");
        await this.merge(this.path("networkpolicies", names.network), { metadata: { annotations: asObj(policy.metadata).annotations }, spec: policy.spec });
      } else {
        await this.createObject(this.path("networkpolicies"), policy);
      }

      const claim = await this.read(this.path("persistentvolumeclaims", names.volume));
      if (claim) {
        if (!this.sameRun(claim, request)) throw new RunsError(409, "conflict", "another run holds this id");
        if (asObj(claim.metadata).deletionTimestamp) throw new RunsError(409, "workspace_deleting", "the run workspace is being removed");
        await this.merge(this.path("persistentvolumeclaims", names.volume), { metadata: { annotations: { [RUN_ENDED_ANNOTATION]: null } } });
      } else {
        await this.ensureEncrypted();
        await this.createObject(this.path("persistentvolumeclaims"), runPvc(this.config, request));
      }

      // A stopped run's token goes with its Pod, but by the garbage
      // collector, later. Remove it now so the new Pod never mounts the
      // old token and the new Secret does not collide with it.
      await this.deleteObject(this.path("secrets", names.token), true, 0);
      const createdPod = await this.createObject(this.path("pods"), pod);
      let uid = String(asObj(createdPod.metadata).uid ?? "");
      if (!uid) uid = String(asObj((await this.read(this.path("pods", names.pod)))?.metadata).uid ?? "");
      try {
        await this.createObject(this.path("secrets"), runTokenSecret(this.config, request, uid));
      } catch (error) {
        await this.deleteObject(this.path("pods", names.pod), false, 0).catch(() => {});
        this.audit.record({ action: "run.create", outcome: "denied", detail: { run: request.id, reason: "token" } });
        throw error;
      }
      this.audit.record({
        action: "run.create",
        outcome: "ok",
        detail: {
          run: request.id,
          env: request.envId,
          egress: request.egress,
          cpuMillis: request.cpuMillis,
          memoryMiB: request.memoryMiB,
          diskGiB: request.diskGiB,
          maxDurationSec: request.maxDurationSec,
          workspace: claim ? "reused" : "new",
        },
      });
      return { created: true, run: await this.status(request.id) };
    });
  }

  /** Stop a run. The Pod goes at once (grace 0: Stop must not leave the
   * job's process tree running), and its token with it, by owner. The disk
   * stays when `keepWorkspace`, for a follow-up within the window. */
  async remove(id: string, options: { keepWorkspace: boolean }): Promise<RunStatus | { id: string; phase: "removed" }> {
    if (!RUN_ID_RE.test(id)) throw new RunsError(404, "not_found", "no such run");
    return this.queue.run(async () => {
      const current = await this.status(id);
      const names = runNames(id);
      // grace 0 matches person-sandbox stop (sandboxd-k8s): a 10s default
      // left HEL-style work running after API success (OpenMausBot 1d1559fb1).
      if (current.pod) await this.deleteObject(this.path("pods", names.pod), true, 0);
      if (options.keepWorkspace) {
        if (current.workspace) {
          await this.merge(this.path("persistentvolumeclaims", names.volume), { metadata: { annotations: { [RUN_ENDED_ANNOTATION]: new Date(this.now()).toISOString() } } });
        }
        this.audit.record({ action: "run.stop", outcome: "ok", detail: { run: id, workspace: "kept" } });
        return this.status(id);
      }
      await this.deleteObject(this.path("persistentvolumeclaims", names.volume), false);
      await this.deleteObject(this.path("networkpolicies", names.network), false);
      this.audit.record({ action: "run.stop", outcome: "ok", detail: { run: id, workspace: "removed" } });
      return { id, phase: "removed" };
    });
  }

  /** One pass of the retention rules. Returns what it did. */
  async sweep(): Promise<SweepAction[]> {
    return this.queue.run(async () => {
      const [pods, claims, policies] = await Promise.all([this.list("pods"), this.list("persistentvolumeclaims"), this.list("networkpolicies")]);
      const actions = planRunSweep({ pods, claims, policies }, this.now(), this.config);
      const claimIds = new Set(claims.map((claim) => labelsOf(claim)[RUN_ID_LABEL]));
      for (const action of actions) {
        const names = runNames(action.id);
        try {
          if (action.kind === "delete-pod") await this.deleteObject(this.path("pods", names.pod), false, 0);
          else if (action.kind === "mark-ended") {
            if (claimIds.has(action.id)) await this.merge(this.path("persistentvolumeclaims", names.volume), { metadata: { annotations: { [RUN_ENDED_ANNOTATION]: action.at } } });
          } else if (action.kind === "delete-workspace") await this.deleteObject(this.path("persistentvolumeclaims", names.volume), false);
          else await this.deleteObject(this.path("networkpolicies", names.network), false);
          if (action.kind !== "mark-ended") this.audit.record({ action: `run.sweep.${action.kind}`, outcome: "ok", detail: { run: action.id, ...("reason" in action ? { reason: action.reason } : {}) } });
        } catch (error) {
          console.error(`sandboxd: run sweep ${action.kind} failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return actions;
    });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RunsError(413, "too_large", "the request is too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** The client certificate the TLS layer verified, or null. A plain HTTP
 * socket, or a certificate the CA did not sign, has none. */
function verifiedPeer(req: IncomingMessage, subject: string): boolean {
  const socket = req.socket as Partial<TLSSocket>;
  if (socket.encrypted !== true || socket.authorized !== true || typeof socket.getPeerCertificate !== "function") return false;
  const cert = socket.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) return false;
  if (subject && cert.subject?.CN !== subject) return false;
  return true;
}

export function createRunsHandler(service: RunService, verifier: SandboxdVerifier, options: { clientSubject: string }) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? "GET";
    const rawPath = req.url ?? "/";
    try {
      if (method === "GET" && rawPath === "/healthz") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("ok");
        return;
      }
      if (rawPath !== "/v1/runs" && !rawPath.startsWith("/v1/runs/") && !rawPath.startsWith("/v1/runs?")) return send(res, 404, { error: "not found" });
      if (!verifiedPeer(req, options.clientSubject)) {
        service.auditDenied("mtls");
        return send(res, 401, { error: "a verified client certificate is required", code: "mtls_required" });
      }
      const body = await readBody(req);
      if (!verifier.verify(req.headers[SANDBOXD_AUTH_HEADER], method, rawPath, body)) {
        service.auditDenied("signature");
        return send(res, 401, { error: "unauthorized", code: "unauthorized" });
      }
      const url = new URL(rawPath, "http://sandboxd");
      if (url.pathname === "/v1/runs") {
        if (method === "GET") return send(res, 200, await service.listRuns());
        if (method === "POST") {
          let parsed: unknown;
          try { parsed = JSON.parse(body.toString("utf8")); } catch { return send(res, 400, { error: "invalid JSON", code: "bad_request" }); }
          const result = await service.create(parsed);
          return send(res, result.created ? 201 : 200, result);
        }
        return send(res, 405, { error: "method not allowed" });
      }
      const match = /^\/v1\/runs\/([a-z0-9]{8,40})$/.exec(url.pathname);
      if (!match) return send(res, 404, { error: "not found" });
      const id = match[1]!;
      if (method === "GET") return send(res, 200, await service.status(id));
      if (method === "DELETE") return send(res, 200, await service.remove(id, { keepWorkspace: url.searchParams.get("keepWorkspace") === "1" }));
      return send(res, 405, { error: "method not allowed" });
    } catch (error) {
      if (error instanceof RunsError) return send(res, error.status, { error: error.message, code: error.code });
      console.error(`sandboxd: ${method} ${rawPath.split("?")[0]} failed: ${error instanceof Error ? error.message : String(error)}`);
      return send(res, 500, { error: "the provisioner failed", code: "internal" });
    }
  };
}

export interface RunsServerTls {
  cert: Buffer;
  key: Buffer;
  clientCa: Buffer;
}

/** The run listener: TLS with a required, CA-verified client certificate.
 * There is no plain HTTP mode. */
export function createRunsServer(service: RunService, verifier: SandboxdVerifier, tls: RunsServerTls, options: { clientSubject: string }): Server {
  const server = createHttpsServer({
    cert: tls.cert,
    key: tls.key,
    ca: tls.clientCa,
    requestCert: true,
    rejectUnauthorized: true,
    minVersion: "TLSv1.2",
    // No session tickets: every connection presents its certificate, so the
    // name check never meets a resumed session without one.
    secureOptions: tlsConstants.SSL_OP_NO_TICKET,
  }, createRunsHandler(service, verifier, options));
  server.requestTimeout = 2 * 60_000;
  return server;
}

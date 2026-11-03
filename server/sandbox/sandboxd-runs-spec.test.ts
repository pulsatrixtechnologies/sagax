import { describe, expect, it } from "vitest";

import { kubernetesSandboxConfigFromEnv } from "../sandboxd-k8s/sandboxd-k8s-spec.ts";
import {
  RUN_CEILINGS,
  RUN_DEADLINE_MARGIN_SEC,
  RUN_ENDED_ANNOTATION,
  RUN_ID_LABEL,
  RUN_LABEL,
  RUN_PENDING_TIMEOUT_MS,
  RUN_TOKEN_DIR,
  RUN_WORKLOAD_SA,
  parseRunRequest,
  planRunSweep,
  runNetworkPolicy,
  runPod,
  runPodProblems,
  runPvc,
  runStatus,
  runTokenSecret,
  runsConfigFromEnv,
  type RunsConfig,
} from "./sandboxd-runs-spec.ts";
import { SANDBOX_LABEL, SANDBOX_USER_LABEL, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";

const REGISTRY = "registry.example.com/agents";
const RUN_IMAGE = `${REGISTRY}/sagax-run:0.1.0@sha256:${"ab".repeat(32)}`;
const SANDBOX_IMAGE = `${REGISTRY}/sagax-sandbox:0.1.0@sha256:${"cd".repeat(32)}`;
const OWNER = "0123456789abcdef0123456789abcdef";
const TOKEN = "t".repeat(48);

type Obj = Record<string, unknown>;

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SANDBOX_BACKEND: "kubernetes",
    SAGAX_SANDBOX_IMAGE: SANDBOX_IMAGE,
    SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
    SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted-disk",
    SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
    SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
    SAGAX_SANDBOXD_TLS_CERT: "/tls/tls.crt",
    SAGAX_SANDBOXD_TLS_KEY: "/tls/tls.key",
    SAGAX_RUNS_ENABLED: "1",
    SAGAX_RUNS_ALLOWED_IMAGES: RUN_IMAGE,
    SAGAX_RUNS_PERSPICAX_CIDRS: "10.20.30.40/32",
    SAGAX_RUNS_GITHUB_CIDRS: "140.82.112.0/20,192.30.252.0/22",
    SAGAX_RUNS_CONTROL_URL: "wss://control.example.com/api/v1/agents/runner",
    SAGAX_RUNS_TLS_CLIENT_CA: "/tls-runs/client-ca.pem",
    SAGAX_RUNS_TLS_CLIENT_CN: "perspicax",
    ...extra,
  };
}

function configFrom(env: NodeJS.ProcessEnv): RunsConfig | null {
  const sandbox = sandboxdConfigFromEnv(env);
  const { k8s, guards } = kubernetesSandboxConfigFromEnv(env, sandbox);
  return runsConfigFromEnv(env, { k8s, guards, sandbox });
}

function config(extra: Record<string, string> = {}): RunsConfig {
  const value = configFrom(baseEnv(extra));
  if (!value) throw new Error("runs should be enabled");
  return value;
}

function request(cfg: RunsConfig, overrides: Obj = {}) {
  return parseRunRequest({ id: "01jabcdefghjkmnpqrstvwxyz0", envId: "envabcdef01", ownerKey: OWNER, image: RUN_IMAGE, token: TOKEN, egress: "restreint", ...overrides }, cfg);
}

describe("runsConfigFromEnv", () => {
  it("is off unless SAGAX_RUNS_ENABLED", () => {
    expect(configFrom(baseEnv({ SAGAX_RUNS_ENABLED: "" }))).toBeNull();
    expect(configFrom(baseEnv({ SAGAX_RUNS_ENABLED: "0" }))).toBeNull();
  });

  it("applies the D3 and D4 defaults and the runs pool", () => {
    const cfg = config();
    expect(cfg.namespace).toBe("sandbox-runs");
    expect(cfg.defaults).toEqual({ cpuMillis: 4000, memoryMiB: 8192, diskGiB: 10, maxDurationSec: 4 * 3600 });
    expect(cfg.ceilings).toEqual(RUN_CEILINGS);
    expect(cfg.maxPods).toBe(12);
    expect(cfg.maxPerOwner).toBe(4);
    expect(cfg.podRetentionMs).toBe(15 * 60_000);
    expect(cfg.diskRetentionMs).toBe(24 * 3_600_000);
    expect(cfg.nodeSelector).toEqual({ "px.pool": "runs" });
    expect(cfg.tolerations).toEqual([
      { key: "px.run", operator: "Equal", value: "true", effect: "NoSchedule" },
      { key: "kubernetes.azure.com/scalesetpriority", operator: "Equal", value: "spot", effect: "NoSchedule" },
    ]);
    expect(cfg.listenPort).toBe(8792);
  });

  it("refuses mutual TLS off, a shared namespace, port or key file", () => {
    expect(() => configFrom(baseEnv({ SAGAX_SANDBOXD_TLS_INSECURE: "1" }))).toThrow(/mutual TLS/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_K8S_NAMESPACE: "sandboxes" }))).toThrow(/differ/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_LISTEN: "0.0.0.0:8791" }))).toThrow(/own port/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_KEY_FILE: "/run/sagax-sandboxd/key" }))).toThrow(/sandbox key/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_TLS_CLIENT_CA: "" }))).toThrow(/CLIENT_CA/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_TLS_CLIENT_CN: "" }))).toThrow(/CLIENT_CN/);
  });

  it("admits run images by digest from the controlled registry only", () => {
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_ALLOWED_IMAGES: "" }))).toThrow(/required/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_ALLOWED_IMAGES: `${REGISTRY}/sagax-run:0.1.0` }))).toThrow(/digest/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_ALLOWED_IMAGES: `other.example.com/sagax-run:0.1.0@sha256:${"ab".repeat(32)}` }))).toThrow(/registry/);
  });

  it("keeps runs on their own pool", () => {
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_K8S_NODE_SELECTOR: "" }))).toThrow(/own node pool/);
  });

  it("refuses egress ranges that are too wide, private for GitHub, or metadata", () => {
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_PERSPICAX_CIDRS: "" }))).toThrow(/required/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_PERSPICAX_CIDRS: "10.0.0.0/8" }))).toThrow(/wider/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_PERSPICAX_CIDRS: "10.20.30.0/24" }))).toThrow(/wider/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_PERSPICAX_CIDRS: "10.213.0.5/32" }))).toThrow(/overlaps/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_K8S_INTERNAL_CIDRS: "10.20.0.0/16" }))).toThrow(/overlaps/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_GITHUB_CIDRS: "20.0.0.0/16" }))).toThrow(/wider/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_PERSPICAX_CIDRS: "169.254.169.254/32" }))).toThrow(/overlaps/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_GITHUB_CIDRS: "10.1.0.0/20" }))).toThrow(/overlaps/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_GITHUB_CIDRS: "0.0.0.0/0" }))).toThrow(/wider/);
  });

  it("caps the ceilings at the spec maximum", () => {
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_MAX_CPU_MILLIS: "16000" }))).toThrow(/8000/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_MAX_DURATION_MIN: "1000" }))).toThrow(/720/);
    const small = config({ SAGAX_RUNS_MAX_MEMORY_MIB: "4096" });
    expect(small.defaults.memoryMiB).toBe(4096);
  });

  it("needs an https or wss control URL without credentials", () => {
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_CONTROL_URL: "http://control.example.com" }))).toThrow(/https or wss/);
    expect(() => configFrom(baseEnv({ SAGAX_RUNS_CONTROL_URL: "https://user:pass@control.example.com" }))).toThrow(/credentials/);
  });
});

describe("parseRunRequest", () => {
  const cfg = config();

  it("fills the defaults", () => {
    const run = request(cfg, { egress: "aucun" });
    expect(run).toMatchObject({ cpuMillis: 4000, memoryMiB: 8192, diskGiB: 10, maxDurationSec: 14400, egress: "aucun" });
  });

  it("refuses unknown fields, so no command, variable or volume can ride along", () => {
    expect(() => request(cfg, { command: ["sh"] })).toThrow(/unknown field/);
    expect(() => request(cfg, { env: { A: "1" } })).toThrow(/unknown field/);
  });

  it("refuses an image off the allowlist, even a digest-pinned one", () => {
    expect(() => request(cfg, { image: SANDBOX_IMAGE })).toThrow(/allowlist/);
  });

  it("refuses limits over the ceilings", () => {
    expect(() => request(cfg, { cpuMillis: 8001 })).toThrow(/cpuMillis/);
    expect(() => request(cfg, { memoryMiB: 16385 })).toThrow(/memoryMiB/);
    expect(() => request(cfg, { diskGiB: 21 })).toThrow(/diskGiB/);
    expect(() => request(cfg, { maxDurationSec: 12 * 3600 + 1 })).toThrow(/maxDurationSec/);
    expect(request(cfg, { cpuMillis: 8000, memoryMiB: 16384, diskGiB: 20, maxDurationSec: 12 * 3600 }).cpuMillis).toBe(8000);
  });

  it("refuses the defaut profile and restreint without GitHub ranges", () => {
    expect(() => request(cfg, { egress: "defaut" })).toThrow(/egress proxy/);
    expect(() => request(cfg, { egress: "open" })).toThrow(/aucun or restreint/);
    const noGithub = config({ SAGAX_RUNS_GITHUB_CIDRS: "" });
    expect(() => request(noGithub, { egress: "restreint" })).toThrow(/GITHUB/);
  });

  it("validates ids, owner and token", () => {
    expect(() => request(cfg, { id: "Run_1" })).toThrow(/id/);
    expect(() => request(cfg, { ownerKey: "nothex" })).toThrow(/ownerKey/);
    expect(() => request(cfg, { token: "short" })).toThrow(/token/);
  });
});

describe("run objects", () => {
  const cfg = config();
  const run = request(cfg);

  it("builds a Pod that passes its own isolation check", () => {
    const pod = runPod(cfg, run);
    expect(runPodProblems(pod, cfg, run.id)).toEqual([]);
    const spec = pod.spec as Obj;
    expect(spec.automountServiceAccountToken).toBe(false);
    expect(spec.serviceAccountName).toBe(RUN_WORKLOAD_SA);
    expect(spec.activeDeadlineSeconds).toBe(4 * 3600 + RUN_DEADLINE_MARGIN_SEC);
    expect(spec.nodeSelector).toEqual({ "px.pool": "runs" });
    const container = (spec.containers as Obj[])[0]!;
    expect(container.command).toBeUndefined();
    expect(container.ports).toBeUndefined();
    expect((container.resources as Obj).limits).toEqual({ cpu: "4000m", memory: "8192Mi", "ephemeral-storage": "2048Mi" });
    expect((container.securityContext as Obj).readOnlyRootFilesystem).toBe(true);
    const mounts = (container.volumeMounts as Obj[]).map((mount) => mount.mountPath);
    expect(mounts).toEqual(["/workspace", "/tmp", "/dev/shm", RUN_TOKEN_DIR]);
    // the token rides a Secret volume, never the Pod spec
    expect(JSON.stringify(pod)).not.toContain(TOKEN);
    const labels = (pod.metadata as Obj).labels as Record<string, string>;
    expect(labels[RUN_LABEL]).toBe("1");
    expect(labels[RUN_ID_LABEL]).toBe(run.id);
    expect(labels[SANDBOX_LABEL]).toBeUndefined();
    expect(labels[SANDBOX_USER_LABEL]).toBeUndefined();
  });

  it("flags a tampered Pod", () => {
    const pod = runPod(cfg, run);
    const spec = pod.spec as Obj;
    const container = (spec.containers as Obj[])[0]!;
    container.command = ["sh", "-c", "id"];
    container.ports = [{ containerPort: 22 }];
    container.image = SANDBOX_IMAGE;
    (container.securityContext as Obj).readOnlyRootFilesystem = false;
    spec.automountServiceAccountToken = true;
    spec.nodeSelector = {};
    delete spec.activeDeadlineSeconds;
    (spec.volumes as Obj[]).push({ name: "host", hostPath: { path: "/var/run/docker.sock" } });
    const problems = runPodProblems(pod, cfg, run.id);
    for (const expected of ["overrides the image entrypoint", "published ports", "image is not on the run allowlist", "writable root filesystem", "service account token mounted", "not on the runs node pool", "no hard deadline", "unexpected volume host", "container runtime socket"]) {
      expect(problems).toContain(expected);
    }
  });

  it("has no ingress and egress to DNS, Perspicax and GitHub only", () => {
    const policy = runNetworkPolicy(cfg, run);
    const spec = policy.spec as Obj;
    expect(spec.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(spec.ingress).toEqual([]);
    const egress = spec.egress as Obj[];
    expect(egress).toHaveLength(3);
    expect(JSON.stringify(egress[1])).toContain("10.20.30.40/32");
    expect(JSON.stringify(egress[2])).toContain("140.82.112.0/20");
    expect(JSON.stringify(spec)).not.toContain("0.0.0.0/0");
    for (const rule of egress.slice(1)) expect(rule.ports).toEqual([{ protocol: "TCP", port: 443 }]);
    const closed = runNetworkPolicy(cfg, { ...run, egress: "aucun" });
    expect((closed.spec as Obj).egress as Obj[]).toHaveLength(2);
    expect(JSON.stringify(closed)).not.toContain("140.82.112.0/20");
  });

  it("puts the disk on the encrypted class and the token in an owned Secret", () => {
    const pvc = runPvc(cfg, { ...run, diskGiB: 20 });
    expect((pvc.spec as Obj).storageClassName).toBe("encrypted-disk");
    expect(JSON.stringify(pvc)).toContain("\"storage\":\"20Gi\"");
    const secret = runTokenSecret(cfg, run, "0a1b2c3d-0000-4000-8000-000000000001");
    expect(secret.immutable).toBe(true);
    expect(((secret.metadata as Obj).ownerReferences as Obj[])[0]).toMatchObject({ kind: "Pod", name: `run-${run.id}` });
    expect(Buffer.from(String((secret.data as Obj).token), "base64").toString()).toBe(TOKEN);
  });
});

describe("runStatus", () => {
  const cfg = config();
  const id = "01jabcdefghjkmnpqrstvwxyz0";
  const meta = { labels: { [RUN_LABEL]: "1", [RUN_ID_LABEL]: id, "px.env": "envabcdef01" }, creationTimestamp: "2026-10-18T12:00:00Z" };

  it("maps deadline and eviction", () => {
    expect(runStatus(id, { metadata: meta, status: { phase: "Failed", reason: "DeadlineExceeded" } }, null, cfg)).toMatchObject({ phase: "failed", reason: "expired", envId: "envabcdef01" });
    expect(runStatus(id, { metadata: meta, status: { phase: "Failed", reason: "Evicted" } }, null, cfg).reason).toBe("evicted");
    expect(runStatus(id, { metadata: meta, status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", reason: "Unschedulable" }] } }, null, cfg)).toMatchObject({ phase: "pending", reason: "Unschedulable" });
  });

  it("names when a kept workspace expires", () => {
    const pvc = { metadata: { ...meta, annotations: { [RUN_ENDED_ANNOTATION]: "2026-10-18T13:00:00.000Z" } } };
    expect(runStatus(id, null, pvc, cfg)).toMatchObject({ phase: "stopped", workspace: true, pod: false, workspaceExpiresAt: "2026-10-19T13:00:00.000Z" });
  });
});

describe("planRunSweep", () => {
  const cfg = config();
  const now = Date.parse("2026-10-18T12:00:00Z");
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const labels = (id: string) => ({ [RUN_LABEL]: "1", [RUN_ID_LABEL]: id });
  const pod = (id: string, phase: string, created: number, finished?: number): Obj => ({
    metadata: { name: `run-${id}`, labels: labels(id), creationTimestamp: iso(created) },
    status: { phase, ...(finished !== undefined ? { containerStatuses: [{ state: { terminated: { finishedAt: iso(finished), exitCode: 0 } } }] } : {}) },
  });
  const claim = (id: string, ended?: number): Obj => ({ metadata: { name: `run-${id}-ws`, labels: labels(id), ...(ended !== undefined ? { annotations: { [RUN_ENDED_ANNOTATION]: iso(ended) } } : {}) } });
  const policy = (id: string): Obj => ({ metadata: { name: `run-${id}-net`, labels: labels(id) } });

  it("removes an ended Pod after 15 minutes and keeps its disk", () => {
    const fresh = planRunSweep({ pods: [pod("aaaaaaaa", "Succeeded", -3_600_000, -14 * 60_000)], claims: [claim("aaaaaaaa")], policies: [] }, now, cfg);
    expect(fresh).toEqual([]);
    const old = planRunSweep({ pods: [pod("aaaaaaaa", "Succeeded", -3_600_000, -15 * 60_000)], claims: [claim("aaaaaaaa")], policies: [] }, now, cfg);
    expect(old).toEqual([
      { kind: "delete-pod", id: "aaaaaaaa", reason: "retention" },
      { kind: "mark-ended", id: "aaaaaaaa", at: iso(-15 * 60_000) },
    ]);
  });

  it("removes the disk and policy 24 hours after the end", () => {
    expect(planRunSweep({ pods: [], claims: [claim("bbbbbbbb", -23 * 3_600_000)], policies: [policy("bbbbbbbb")] }, now, cfg)).toEqual([]);
    expect(planRunSweep({ pods: [], claims: [claim("bbbbbbbb", -24 * 3_600_000)], policies: [policy("bbbbbbbb")] }, now, cfg)).toEqual([
      { kind: "delete-workspace", id: "bbbbbbbb" },
      { kind: "delete-network", id: "bbbbbbbb" },
    ]);
  });

  it("starts the clock on an orphan disk and drops an orphan policy", () => {
    expect(planRunSweep({ pods: [], claims: [claim("cccccccc")], policies: [policy("dddddddd")] }, now, cfg)).toEqual([
      { kind: "mark-ended", id: "cccccccc", at: iso(0) },
      { kind: "delete-network", id: "dddddddd" },
    ]);
  });

  it("removes a Pod stuck in Pending and one past the hard cap", () => {
    expect(planRunSweep({ pods: [pod("eeeeeeee", "Pending", -RUN_PENDING_TIMEOUT_MS)], claims: [], policies: [] }, now, cfg)[0]).toEqual({ kind: "delete-pod", id: "eeeeeeee", reason: "pending-timeout" });
    const cap = (RUN_CEILINGS.maxDurationSec + RUN_DEADLINE_MARGIN_SEC) * 1000 + cfg.podRetentionMs;
    expect(planRunSweep({ pods: [pod("ffffffff", "Running", -cap)], claims: [], policies: [] }, now, cfg)[0]).toEqual({ kind: "delete-pod", id: "ffffffff", reason: "hard-cap" });
    expect(planRunSweep({ pods: [pod("ffffffff", "Running", -cap + 1000)], claims: [claim("ffffffff")], policies: [policy("ffffffff")] }, now, cfg)).toEqual([]);
  });
});

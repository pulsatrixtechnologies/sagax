// Pure Kubernetes objects for one cloud agent run: a Pod, a PVC, a
// NetworkPolicy and the Secret that holds the run token. A run is not a
// person's sandbox: it lives in its own namespace, on its own node pool,
// under its own quota, and is called by Perspicax only, with its own key and
// a client certificate (server/sandbox/sandboxd-runs.ts). No client and no cluster
// here, so the isolation rules are asserted in unit tests.
//
// What a run can ask for is closed: an image from the allowlist (pinned by
// digest), limits under ceilings, and an egress profile by name. It cannot
// name a command, an environment variable, a volume, a node or a network:
// those come from the provisioner's own configuration.
import { isAbsolute } from "node:path";

import {
  IMAGE_ANNOTATION,
  imageAdmissionProblems,
  parseNodeSelector,
  parseTolerations,
  type K8sGuards,
  type K8sSandboxConfig,
  type K8sToleration,
} from "../sandboxd-k8s/sandboxd-k8s-spec.ts";
import { DEFAULT_EGRESS_DENY, SANDBOX_INSTANCE_LABEL, SANDBOX_UID, SANDBOX_WORKSPACE, cidrContains, parseCidr, type SandboxdConfig } from "./user-sandbox-spec.ts";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export const RUN_ID_RE = /^[a-z0-9]{8,40}$/;
export const RUN_ENV_ID_RE = /^[a-z0-9]{8,40}$/;
export const RUN_OWNER_RE = /^[a-f0-9]{32}$/;
export const RUN_TOKEN_RE = /^[A-Za-z0-9_-]{32,512}$/;

/** Every run object carries this label; a person's sandbox never does. */
export const RUN_LABEL = "com.pulsatrix.sagax.run";
export const RUN_ID_LABEL = "px.run";
export const RUN_ENV_LABEL = "px.env";
export const RUN_OWNER_LABEL = "px.owner";
export const RUN_ENDED_ANNOTATION = "sagax.pulsatrix.com/run-ended-at";
export const RUN_EGRESS_ANNOTATION = "sagax.pulsatrix.com/run-egress";

/** A person's build cache disk (Rust target, sccache, pnpm store,
 * Playwright browsers). Not a run object: no RUN_LABEL, so the run sweep and
 * listRuns never see it. */
export const RUN_CACHE_LABEL = "com.pulsatrix.sagax.run-cache";
export const RUN_CACHE_SLOT_LABEL = "px.cache-slot";
/** On the run Pod: the cache disk it mounts (a disk is ReadWriteOnce). */
export const RUN_CACHE_CLAIM_LABEL = "px.cache";
export const RUN_CACHE_USED_ANNOTATION = "sagax.pulsatrix.com/cache-used-at";
export const RUN_CACHE_MOUNT = "/cache";
export const RUN_CACHE_STORAGE_CLASS_DEFAULT = "px-run-cache";

export const RUNS_NAMESPACE_DEFAULT = "sandbox-runs";
export const RUNS_QUOTA_NAME = "sagax-run-quota";
export const RUN_WORKLOAD_SA = "sagax-run-workload";
export const RUN_TOKEN_DIR = "/var/run/px-run";
export const RUNS_DEFAULT_PORT = 8792;
export const RUNS_DEFAULT_NODE_SELECTOR = "px.pool=runs";
export const RUNS_DEFAULT_TOLERATIONS = "px.run=true:NoSchedule,kubernetes.azure.com/scalesetpriority=spot:NoSchedule";

/** Decisions D3 and D4 of the cloud agents spec (2026-10-18). */
export const RUN_DEFAULTS = { cpuMillis: 4000, memoryMiB: 8192, diskGiB: 10, maxDurationSec: 4 * 3600 } as const;
export const RUN_CEILINGS = { cpuMillis: 8000, memoryMiB: 16384, diskGiB: 20, maxDurationSec: 12 * 3600 } as const;
const RUN_MINIMUMS = { cpuMillis: 250, memoryMiB: 512, diskGiB: 1, maxDurationSec: 60 } as const;
/** activeDeadlineSeconds = the run's max duration plus this, so the Pod
 * outlives the run by the idle window (15 min) and no longer. */
export const RUN_DEADLINE_MARGIN_SEC = 20 * 60;
/** A Pod still Pending after this is removed (no node, no image, no token). */
export const RUN_PENDING_TIMEOUT_MS = 15 * 60_000;
export const RUN_TMP_BYTES = 2 * GiB;
export const RUN_SHM_BYTES = 256 * MiB;

/** Ranges a run may never reach even when an operator lists them. */
const ALWAYS_DENIED: readonly string[] = ["0.0.0.0/8", "127.0.0.0/8", "168.63.129.16/32", "169.254.0.0/16", "224.0.0.0/4", "240.0.0.0/4"];

export type RunEgressProfile = "aucun" | "restreint";

export interface RunNames {
  pod: string;
  volume: string;
  network: string;
  token: string;
}

export function runNames(id: string): RunNames {
  if (!RUN_ID_RE.test(id)) throw new Error("invalid run id");
  return { pod: `run-${id}`, volume: `run-${id}-ws`, network: `run-${id}-net`, token: `run-${id}-token` };
}

/** D3: Rust agents take a lot of disk and must not be slow. One fast
 * disk per person and slot, kept between runs, so a build is incremental
 * instead of cold. The image cleans it at a threshold (deploy/run-dev). */
export interface RunBuildCache {
  storageClass: string;
  sizeGiB: number;
  /** Disks per person: at most one per concurrent run (ReadWriteOnce). */
  slots: number;
  /** A disk no run has used for this long is removed by the sweep. */
  retentionMs: number;
}

export interface RunsConfig {
  namespace: string;
  instance: string;
  storageClass: string;
  requireEncryption: boolean;
  quotaName: string;
  /** Exact `registry/name:tag@sha256:<digest>` references. */
  allowedImages: string[];
  nodeSelector: Record<string, string>;
  tolerations: K8sToleration[];
  /** Perspicax: the runner's control connection and the model proxy. */
  perspicaxCidrs: string[];
  /** GitHub, for the `restreint` profile (clone and fetch). Empty: refused. */
  githubCidrs: string[];
  egressPort: number;
  dns: { namespace: string; podLabels: Record<string, string>; port: number };
  controlUrl: string;
  defaults: { cpuMillis: number; memoryMiB: number; diskGiB: number; maxDurationSec: number };
  ceilings: { cpuMillis: number; memoryMiB: number; diskGiB: number; maxDurationSec: number };
  maxPods: number;
  maxPerOwner: number;
  podRetentionMs: number;
  diskRetentionMs: number;
  runtimeClass?: string;
  pullSecret?: string;
  /** Unset: runs build on their workspace disk, cold every time. */
  buildCache?: RunBuildCache;
  listenHost: string;
  listenPort: number;
  keyFile: string;
  clientCaPath: string;
  clientSubject: string;
}

const DNS_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function enabled(raw: string | undefined, name: string): boolean {
  const value = raw?.trim() ?? "";
  if (value === "" || /^(0|false|no|off)$/i.test(value)) return false;
  if (/^(1|true|yes|on)$/i.test(value)) return true;
  throw new Error(`${name} is not a recognized value`);
}

function boundedInt(raw: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function overlaps(a: string, b: string): boolean {
  return cidrContains(a, b) || cidrContains(b, a);
}

function cidrList(raw: string | undefined, name: string, options: { minBits: number; deny: readonly string[] }): string[] {
  const out: string[] = [];
  for (const entry of (raw ?? "").split(/[\s,]+/).filter(Boolean)) {
    const { bits } = parseCidr(entry);
    if (bits < options.minBits) throw new Error(`${name}: ${entry} is wider than /${options.minBits}`);
    const hit = options.deny.find((denied) => overlaps(denied, entry));
    if (hit) throw new Error(`${name}: ${entry} overlaps ${hit}, which a run may never reach`);
    out.push(entry);
  }
  return out;
}

/** Run settings. `SAGAX_RUNS_ENABLED` unset or false: null, and nothing of
 * this file is served. Any malformed value refuses the start. */
export function runsConfigFromEnv(
  env: NodeJS.ProcessEnv,
  base: { k8s: K8sSandboxConfig; guards: Pick<K8sGuards, "tlsInsecure">; sandbox: Pick<SandboxdConfig, "instance" | "listenPort" | "egressDeny" | "keyFile" | "subnetPool"> },
): RunsConfig | null {
  if (!enabled(env.SAGAX_RUNS_ENABLED, "SAGAX_RUNS_ENABLED")) return null;
  if (base.guards.tlsInsecure) throw new Error("runs require mutual TLS: SAGAX_SANDBOXD_TLS_INSECURE cannot be set with SAGAX_RUNS_ENABLED");
  const namespace = env.SAGAX_RUNS_K8S_NAMESPACE?.trim() || RUNS_NAMESPACE_DEFAULT;
  if (!DNS_NAME.test(namespace) || namespace.length > 63) throw new Error("SAGAX_RUNS_K8S_NAMESPACE must be a DNS label");
  if (namespace === base.k8s.namespace) throw new Error("SAGAX_RUNS_K8S_NAMESPACE must differ from the sandbox namespace (separate quota and policies)");
  const storageClass = env.SAGAX_RUNS_K8S_STORAGE_CLASS?.trim() || base.k8s.storageClass;
  if (!DNS_NAME.test(storageClass)) throw new Error("SAGAX_RUNS_K8S_STORAGE_CLASS is not a StorageClass name");
  const quotaName = env.SAGAX_RUNS_K8S_QUOTA_NAME?.trim() || RUNS_QUOTA_NAME;
  if (!DNS_NAME.test(quotaName)) throw new Error("SAGAX_RUNS_K8S_QUOTA_NAME is not a ResourceQuota name");

  const allowedImages = (env.SAGAX_RUNS_ALLOWED_IMAGES ?? "").split(/[\s,]+/).filter(Boolean);
  if (allowedImages.length === 0) throw new Error("SAGAX_RUNS_ALLOWED_IMAGES is required (run images, name:tag@sha256:<digest>)");
  for (const image of allowedImages) {
    const problems = imageAdmissionProblems(image, { registry: base.k8s.registry, requireDigest: true });
    if (problems.length) throw new Error(`SAGAX_RUNS_ALLOWED_IMAGES ${image} is not admitted: ${problems.join(", ")}`);
  }

  const nodeSelector = parseNodeSelector(env.SAGAX_RUNS_K8S_NODE_SELECTOR ?? RUNS_DEFAULT_NODE_SELECTOR);
  if (!nodeSelector) throw new Error("SAGAX_RUNS_K8S_NODE_SELECTOR cannot be empty: runs go to their own node pool");
  const tolerations = parseTolerations(env.SAGAX_RUNS_K8S_TOLERATION ?? RUNS_DEFAULT_TOLERATIONS) ?? [];

  // Perspicax by its exact addresses: a wider block could cover the pod
  // network, the services or the API server. Cluster ranges an operator
  // names in SAGAX_RUNS_K8S_INTERNAL_CIDRS are refused outright.
  const internal = cidrList(env.SAGAX_RUNS_K8S_INTERNAL_CIDRS, "SAGAX_RUNS_K8S_INTERNAL_CIDRS", { minBits: 0, deny: [] });
  const perspicaxCidrs = cidrList(env.SAGAX_RUNS_PERSPICAX_CIDRS, "SAGAX_RUNS_PERSPICAX_CIDRS", { minBits: 32, deny: [...ALWAYS_DENIED, base.sandbox.subnetPool, ...internal] });
  if (perspicaxCidrs.length === 0) throw new Error("SAGAX_RUNS_PERSPICAX_CIDRS is required (the addresses of Perspicax, each a /32)");
  // The git, api and web ranges of GitHub's meta list are /20 or narrower;
  // its actions and codespaces entries are wide cloud blocks and do not belong here.
  const githubCidrs = cidrList(env.SAGAX_RUNS_GITHUB_CIDRS, "SAGAX_RUNS_GITHUB_CIDRS", {
    minBits: 20,
    deny: [...new Set([...ALWAYS_DENIED, ...DEFAULT_EGRESS_DENY, ...base.sandbox.egressDeny, ...internal])],
  });
  const egressPort = boundedInt(env.SAGAX_RUNS_EGRESS_PORT, 443, "SAGAX_RUNS_EGRESS_PORT", 1, 65535);

  const controlUrl = env.SAGAX_RUNS_CONTROL_URL?.trim() ?? "";
  let control: URL;
  try { control = new URL(controlUrl); } catch { throw new Error("SAGAX_RUNS_CONTROL_URL is required (https URL of the Perspicax runner endpoint)"); }
  if (control.protocol !== "https:" && control.protocol !== "wss:") throw new Error("SAGAX_RUNS_CONTROL_URL must be https or wss");
  if (control.username || control.password) throw new Error("SAGAX_RUNS_CONTROL_URL cannot carry credentials");

  const ceilings = {
    cpuMillis: boundedInt(env.SAGAX_RUNS_MAX_CPU_MILLIS, RUN_CEILINGS.cpuMillis, "SAGAX_RUNS_MAX_CPU_MILLIS", RUN_MINIMUMS.cpuMillis, RUN_CEILINGS.cpuMillis),
    memoryMiB: boundedInt(env.SAGAX_RUNS_MAX_MEMORY_MIB, RUN_CEILINGS.memoryMiB, "SAGAX_RUNS_MAX_MEMORY_MIB", RUN_MINIMUMS.memoryMiB, RUN_CEILINGS.memoryMiB),
    diskGiB: boundedInt(env.SAGAX_RUNS_MAX_DISK_GIB, RUN_CEILINGS.diskGiB, "SAGAX_RUNS_MAX_DISK_GIB", RUN_MINIMUMS.diskGiB, RUN_CEILINGS.diskGiB),
    maxDurationSec: boundedInt(env.SAGAX_RUNS_MAX_DURATION_MIN, RUN_CEILINGS.maxDurationSec / 60, "SAGAX_RUNS_MAX_DURATION_MIN", 1, RUN_CEILINGS.maxDurationSec / 60) * 60,
  };
  const defaults = {
    cpuMillis: Math.min(RUN_DEFAULTS.cpuMillis, ceilings.cpuMillis),
    memoryMiB: Math.min(RUN_DEFAULTS.memoryMiB, ceilings.memoryMiB),
    diskGiB: Math.min(RUN_DEFAULTS.diskGiB, ceilings.diskGiB),
    maxDurationSec: Math.min(RUN_DEFAULTS.maxDurationSec, ceilings.maxDurationSec),
  };

  const listen = env.SAGAX_RUNS_LISTEN?.trim() || `0.0.0.0:${RUNS_DEFAULT_PORT}`;
  const listenMatch = /^([0-9.]+|\[[0-9a-f:]+\]|[a-z0-9.-]+):(\d{1,5})$/i.exec(listen);
  if (!listenMatch) throw new Error("SAGAX_RUNS_LISTEN must be host:port");
  const listenPort = Number(listenMatch[2]);
  if (listenPort < 1 || listenPort > 65535 || listenPort === base.sandbox.listenPort) throw new Error("SAGAX_RUNS_LISTEN must use its own port, not the sandbox port");

  const keyFile = env.SAGAX_RUNS_KEY_FILE?.trim() || "/run/sagax-sandboxd-runs/key";
  if (!isAbsolute(keyFile) || keyFile.includes("\0")) throw new Error("SAGAX_RUNS_KEY_FILE must be an absolute path");
  if (keyFile === base.sandbox.keyFile) throw new Error("SAGAX_RUNS_KEY_FILE must not be the sandbox key file");
  const clientCaPath = env.SAGAX_RUNS_TLS_CLIENT_CA?.trim() ?? "";
  if (!clientCaPath || !isAbsolute(clientCaPath)) throw new Error("SAGAX_RUNS_TLS_CLIENT_CA is required (the CA that signs the Perspicax client certificate)");
  // Required: the CA may sign other certificates; only this name may call.
  const clientSubject = env.SAGAX_RUNS_TLS_CLIENT_CN?.trim() ?? "";
  if (!/^[A-Za-z0-9 ._-]{1,64}$/.test(clientSubject)) throw new Error("SAGAX_RUNS_TLS_CLIENT_CN is required (the common name of the Perspicax client certificate)");

  const maxPerOwner = boundedInt(env.SAGAX_RUNS_MAX_PER_OWNER, 4, "SAGAX_RUNS_MAX_PER_OWNER", 1, 200);
  let buildCache: RunBuildCache | undefined;
  if (enabled(env.SAGAX_RUNS_CACHE_ENABLED, "SAGAX_RUNS_CACHE_ENABLED")) {
    const cacheClass = env.SAGAX_RUNS_CACHE_STORAGE_CLASS?.trim() || RUN_CACHE_STORAGE_CLASS_DEFAULT;
    if (!DNS_NAME.test(cacheClass)) throw new Error("SAGAX_RUNS_CACHE_STORAGE_CLASS is not a StorageClass name");
    buildCache = {
      storageClass: cacheClass,
      sizeGiB: boundedInt(env.SAGAX_RUNS_CACHE_GIB, 64, "SAGAX_RUNS_CACHE_GIB", 8, 1024),
      slots: boundedInt(env.SAGAX_RUNS_CACHE_SLOTS, maxPerOwner, "SAGAX_RUNS_CACHE_SLOTS", 1, maxPerOwner),
      retentionMs: boundedInt(env.SAGAX_RUNS_CACHE_RETENTION_DAYS, 14, "SAGAX_RUNS_CACHE_RETENTION_DAYS", 1, 90) * 86_400_000,
    };
  }

  return {
    namespace,
    instance: base.sandbox.instance,
    storageClass,
    requireEncryption: base.k8s.requireEncryption,
    quotaName,
    allowedImages,
    nodeSelector,
    tolerations,
    perspicaxCidrs,
    githubCidrs,
    egressPort,
    dns: { namespace: "kube-system", podLabels: { "k8s-app": "kube-dns" }, port: 53 },
    controlUrl: control.toString(),
    defaults,
    ceilings,
    maxPods: boundedInt(env.SAGAX_RUNS_MAX_PODS, 12, "SAGAX_RUNS_MAX_PODS", 1, 200),
    maxPerOwner,
    podRetentionMs: boundedInt(env.SAGAX_RUNS_POD_RETENTION_MIN, 15, "SAGAX_RUNS_POD_RETENTION_MIN", 1, 24 * 60) * 60_000,
    diskRetentionMs: boundedInt(env.SAGAX_RUNS_DISK_RETENTION_HOURS, 24, "SAGAX_RUNS_DISK_RETENTION_HOURS", 1, 24 * 30) * 3_600_000,
    ...(base.k8s.runtimeClass ? { runtimeClass: base.k8s.runtimeClass } : {}),
    ...(base.k8s.pullSecret ? { pullSecret: base.k8s.pullSecret } : {}),
    ...(buildCache ? { buildCache } : {}),
    listenHost: listenMatch[1]!.replace(/^\[|\]$/g, ""),
    listenPort,
    keyFile,
    clientCaPath,
    clientSubject,
  };
}

export class RunsError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface RunRequest {
  id: string;
  envId: string;
  ownerKey: string;
  image: string;
  /** Opaque run token (CA-11). Written to a Secret, never logged or echoed. */
  token: string;
  egress: RunEgressProfile;
  cpuMillis: number;
  memoryMiB: number;
  diskGiB: number;
  maxDurationSec: number;
}

const REQUEST_FIELDS = new Set(["id", "envId", "ownerKey", "image", "token", "egress", "cpuMillis", "memoryMiB", "diskGiB", "maxDurationSec"]);

function requestInt(value: unknown, name: string, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new RunsError(400, "bad_limits", `${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

/** The only shape a run create accepts. Unknown fields are refused, so a
 * caller cannot believe it set a command, a variable or a volume. */
export function parseRunRequest(body: unknown, config: RunsConfig): RunRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RunsError(400, "bad_request", "the body must be a JSON object");
  const input = body as Record<string, unknown>;
  const unknown = Object.keys(input).filter((field) => !REQUEST_FIELDS.has(field));
  if (unknown.length) throw new RunsError(400, "bad_request", `unknown field(s): ${unknown.slice(0, 5).join(", ")}`);
  const { id, envId, ownerKey, image, token, egress } = input;
  if (typeof id !== "string" || !RUN_ID_RE.test(id)) throw new RunsError(400, "bad_id", "id must be 8 to 40 lowercase letters or digits");
  if (typeof envId !== "string" || !RUN_ENV_ID_RE.test(envId)) throw new RunsError(400, "bad_env", "envId must be 8 to 40 lowercase letters or digits");
  if (typeof ownerKey !== "string" || !RUN_OWNER_RE.test(ownerKey)) throw new RunsError(400, "bad_owner", "ownerKey must be 32 lowercase hex characters");
  if (typeof token !== "string" || !RUN_TOKEN_RE.test(token)) throw new RunsError(400, "bad_token", "token must be 32 to 512 URL-safe characters");
  if (typeof image !== "string" || !config.allowedImages.includes(image)) throw new RunsError(400, "image_refused", "image is not on the run allowlist");
  if (egress === "defaut") throw new RunsError(400, "egress_unsupported", "the defaut egress profile is not available for runs yet (it needs the egress proxy)");
  if (egress !== "aucun" && egress !== "restreint") throw new RunsError(400, "bad_egress", "egress must be aucun or restreint");
  if (egress === "restreint" && config.githubCidrs.length === 0) throw new RunsError(400, "egress_unsupported", "the restreint profile needs SAGAX_RUNS_GITHUB_CIDRS on the provisioner");
  return {
    id,
    envId,
    ownerKey,
    image,
    token,
    egress,
    cpuMillis: requestInt(input.cpuMillis, "cpuMillis", config.defaults.cpuMillis, RUN_MINIMUMS.cpuMillis, config.ceilings.cpuMillis),
    memoryMiB: requestInt(input.memoryMiB, "memoryMiB", config.defaults.memoryMiB, RUN_MINIMUMS.memoryMiB, config.ceilings.memoryMiB),
    diskGiB: requestInt(input.diskGiB, "diskGiB", config.defaults.diskGiB, RUN_MINIMUMS.diskGiB, config.ceilings.diskGiB),
    maxDurationSec: requestInt(input.maxDurationSec, "maxDurationSec", config.defaults.maxDurationSec, RUN_MINIMUMS.maxDurationSec, config.ceilings.maxDurationSec),
  };
}

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === "object" ? value as Obj : {};
}

export function runLabels(config: Pick<RunsConfig, "instance">, request: Pick<RunRequest, "id" | "envId" | "ownerKey">): Record<string, string> {
  return {
    [RUN_LABEL]: "1",
    [SANDBOX_INSTANCE_LABEL]: config.instance,
    [RUN_ID_LABEL]: request.id,
    [RUN_ENV_LABEL]: request.envId,
    [RUN_OWNER_LABEL]: request.ownerKey,
  };
}

/** The Pod of one run. Its image's own entrypoint runs (the runner); the
 * request names no command. The only credential inside is the run token,
 * mounted read-only from a Secret. */
export function runPod(config: RunsConfig, request: RunRequest, cacheClaim?: string): Obj {
  const names = runNames(request.id);
  const cpu = `${request.cpuMillis}m`;
  const memory = `${request.memoryMiB}Mi`;
  const tmp = `${RUN_TMP_BYTES / MiB}Mi`;
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: names.pod,
      namespace: config.namespace,
      labels: { ...runLabels(config, request), ...(cacheClaim ? { [RUN_CACHE_CLAIM_LABEL]: cacheClaim } : {}) },
      annotations: { [IMAGE_ANNOTATION]: request.image, [RUN_EGRESS_ANNOTATION]: request.egress },
    },
    spec: {
      restartPolicy: "Never",
      terminationGracePeriodSeconds: 20,
      activeDeadlineSeconds: request.maxDurationSec + RUN_DEADLINE_MARGIN_SEC,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      serviceAccountName: RUN_WORKLOAD_SA,
      hostNetwork: false,
      hostPID: false,
      hostIPC: false,
      shareProcessNamespace: false,
      dnsPolicy: "ClusterFirst",
      ...(config.runtimeClass ? { runtimeClassName: config.runtimeClass } : {}),
      ...(config.pullSecret ? { imagePullSecrets: [{ name: config.pullSecret }] } : {}),
      nodeSelector: { ...config.nodeSelector },
      ...(config.tolerations.length ? { tolerations: config.tolerations.map((toleration) => ({ ...toleration })) } : {}),
      securityContext: {
        runAsNonRoot: true,
        runAsUser: SANDBOX_UID,
        runAsGroup: SANDBOX_UID,
        fsGroup: SANDBOX_UID,
        fsGroupChangePolicy: "OnRootMismatch",
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [{
        name: "runner",
        image: request.image,
        imagePullPolicy: "IfNotPresent",
        workingDir: SANDBOX_WORKSPACE,
        securityContext: {
          allowPrivilegeEscalation: false,
          readOnlyRootFilesystem: true,
          runAsNonRoot: true,
          runAsUser: SANDBOX_UID,
          capabilities: { drop: ["ALL"] },
          seccompProfile: { type: "RuntimeDefault" },
        },
        env: [
          { name: "HOME", value: SANDBOX_WORKSPACE },
          { name: "LANG", value: "C.UTF-8" },
          { name: "SAGAX_ENVIRONMENT", value: "cloud-run" },
          { name: "PX_RUN_ID", value: request.id },
          { name: "PX_ENV_ID", value: request.envId },
          { name: "PX_CONTROL_URL", value: config.controlUrl },
          { name: "PX_RUN_TOKEN_FILE", value: `${RUN_TOKEN_DIR}/token` },
          ...(cacheClaim ? [{ name: "PX_CACHE_DIR", value: RUN_CACHE_MOUNT }] : []),
        ],
        resources: {
          requests: { cpu, memory, "ephemeral-storage": tmp },
          limits: { cpu, memory, "ephemeral-storage": tmp },
        },
        volumeMounts: [
          { name: "workspace", mountPath: SANDBOX_WORKSPACE, readOnly: false },
          { name: "tmp", mountPath: "/tmp", readOnly: false },
          { name: "shm", mountPath: "/dev/shm", readOnly: false },
          { name: "run-token", mountPath: RUN_TOKEN_DIR, readOnly: true },
          ...(cacheClaim ? [{ name: "cache", mountPath: RUN_CACHE_MOUNT, readOnly: false }] : []),
        ],
      }],
      volumes: [
        { name: "workspace", persistentVolumeClaim: { claimName: names.volume } },
        { name: "tmp", emptyDir: { sizeLimit: tmp } },
        { name: "shm", emptyDir: { medium: "Memory", sizeLimit: `${RUN_SHM_BYTES / MiB}Mi` } },
        { name: "run-token", secret: { secretName: names.token, defaultMode: 0o440, items: [{ key: "token", path: "token" }] } },
        ...(cacheClaim ? [{ name: "cache", persistentVolumeClaim: { claimName: cacheClaim } }] : []),
      ],
    },
  };
}

const RUN_VOLUMES = new Set(["workspace", "tmp", "shm", "run-token", "cache"]);

/** Isolation of the Pod we send. A failure refuses the create. */
export function runPodProblems(pod: Obj, config: RunsConfig, id: string, cacheClaim?: string): string[] {
  const names = runNames(id);
  const problems: string[] = [];
  const meta = asObj(pod.metadata);
  const labels = asObj(meta.labels) as Record<string, string>;
  const spec = asObj(pod.spec);
  const podSec = asObj(spec.securityContext);
  const containers = Array.isArray(spec.containers) ? spec.containers as Obj[] : [];
  const container = asObj(containers[0]);
  const sec = asObj(container.securityContext);
  const caps = asObj(sec.capabilities);
  if (meta.name !== names.pod || meta.namespace !== config.namespace) problems.push("wrong name or namespace");
  if (labels[RUN_LABEL] !== "1" || labels[RUN_ID_LABEL] !== id) problems.push("run labels missing");
  if (Object.keys(labels).some((key) => key.startsWith("com.pulsatrix.sagax.sandbox") && key !== SANDBOX_INSTANCE_LABEL)) problems.push("carries a person sandbox label");
  if (containers.length !== 1) problems.push("not exactly one container");
  if (spec.initContainers || spec.ephemeralContainers) problems.push("extra containers");
  if (!config.allowedImages.includes(String(container.image ?? ""))) problems.push("image is not on the run allowlist");
  if (container.command || container.args) problems.push("overrides the image entrypoint");
  if (podSec.runAsNonRoot !== true || sec.runAsNonRoot !== true) problems.push("may run as root");
  if (podSec.runAsUser !== SANDBOX_UID || sec.runAsUser !== SANDBOX_UID) problems.push(`uid is not ${SANDBOX_UID}`);
  if (sec.allowPrivilegeEscalation !== false) problems.push("privilege escalation");
  if (sec.readOnlyRootFilesystem !== true) problems.push("writable root filesystem");
  if (sec.privileged === true) problems.push("privileged");
  const drop = Array.isArray(caps.drop) ? caps.drop.map(String) : [];
  if (!drop.includes("ALL")) problems.push("capabilities not dropped");
  if (Array.isArray(caps.add) && caps.add.length > 0) problems.push("adds capabilities");
  const seccomp = String(asObj(sec.seccompProfile).type || asObj(podSec.seccompProfile).type || "");
  if (seccomp !== "RuntimeDefault") problems.push("seccomp is not the runtime default");
  if (spec.hostNetwork === true || spec.hostPID === true || spec.hostIPC === true) problems.push("host namespace");
  if (spec.automountServiceAccountToken !== false) problems.push("service account token mounted");
  if (spec.serviceAccountName !== RUN_WORKLOAD_SA) problems.push("unexpected service account");
  if (spec.restartPolicy !== "Never") problems.push("restarts");
  const deadline = Number(spec.activeDeadlineSeconds);
  if (!Number.isInteger(deadline) || deadline <= 0 || deadline > config.ceilings.maxDurationSec + RUN_DEADLINE_MARGIN_SEC) problems.push("no hard deadline");
  const selector = asObj(spec.nodeSelector) as Record<string, string>;
  if (Object.entries(config.nodeSelector).some(([key, value]) => selector[key] !== value)) problems.push("not on the runs node pool");
  const resources = asObj(container.resources);
  const limits = asObj(resources.limits);
  const requests = asObj(resources.requests);
  if (!limits.cpu || !limits.memory || limits.cpu !== requests.cpu || limits.memory !== requests.memory || !limits["ephemeral-storage"]) problems.push("cpu, memory or disk limit missing");
  const ports = container.ports;
  if (Array.isArray(ports) && ports.length > 0) problems.push("published ports");
  const env = Array.isArray(container.env) ? container.env as Obj[] : [];
  if (env.some((entry) => entry.valueFrom !== undefined)) problems.push("environment read from another object");
  if (container.envFrom) problems.push("environment read from another object");
  const volumes = Array.isArray(spec.volumes) ? spec.volumes as Obj[] : [];
  for (const volume of volumes) {
    const name = String(volume.name ?? "");
    if (!RUN_VOLUMES.has(name)) problems.push(`unexpected volume ${name}`);
    if (volume.hostPath || volume.nfs || volume.iscsi || volume.projected || volume.csi) problems.push(`host or projected volume ${name}`);
    const claimName = volume.persistentVolumeClaim ? asObj(volume.persistentVolumeClaim).claimName : undefined;
    if (claimName !== undefined) {
      if (name === "cache" && cacheClaim && claimName === cacheClaim) {
        if (!String(claimName).startsWith(`run-cache-${labels[RUN_OWNER_LABEL] ?? "?"}-`)) problems.push("cache disk of another person");
      } else if (name !== "workspace" || claimName !== names.volume) problems.push("foreign volume claim");
    }
    if (volume.secret && asObj(volume.secret).secretName !== names.token) problems.push("foreign secret");
  }
  if (!volumes.some((volume) => asObj(volume.persistentVolumeClaim).claimName === names.volume)) problems.push("workspace volume missing");
  if (cacheClaim && !volumes.some((volume) => volume.name === "cache" && asObj(volume.persistentVolumeClaim).claimName === cacheClaim)) problems.push("cache volume missing");
  if (JSON.stringify(pod).includes("docker.sock") || JSON.stringify(pod).includes("containerd.sock")) problems.push("container runtime socket");
  return problems;
}

export function runPvc(config: RunsConfig, request: RunRequest): Obj {
  const names = runNames(request.id);
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: names.volume,
      namespace: config.namespace,
      labels: runLabels(config, request),
      annotations: { [IMAGE_ANNOTATION]: request.image },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: config.storageClass,
      resources: { requests: { storage: `${request.diskGiB}Gi` } },
    },
  };
}

/** The cache disk of one person and slot. The owner key is already an
 * opaque hash of the person; one disk is never mounted by two people. */
export function runCacheClaimName(ownerKey: string, slot: number): string {
  if (!RUN_OWNER_RE.test(ownerKey) || !Number.isInteger(slot) || slot < 0 || slot > 199) throw new Error("invalid cache owner or slot");
  return `run-cache-${ownerKey}-${slot}`;
}

export function runCachePvc(config: RunsConfig, ownerKey: string, slot: number, now: number): Obj {
  if (!config.buildCache) throw new Error("the build cache is off");
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: runCacheClaimName(ownerKey, slot),
      namespace: config.namespace,
      labels: { [RUN_CACHE_LABEL]: "1", [SANDBOX_INSTANCE_LABEL]: config.instance, [RUN_OWNER_LABEL]: ownerKey, [RUN_CACHE_SLOT_LABEL]: String(slot) },
      annotations: { [RUN_CACHE_USED_ANNOTATION]: new Date(now).toISOString() },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: config.buildCache.storageClass,
      resources: { requests: { storage: `${config.buildCache.sizeGiB}Gi` } },
    },
  };
}

/** Claims Pods still reference (a disk is ReadWriteOnce). */
function cacheClaimsHeld(pods: Obj[], activeOnly: boolean): Set<string> {
  const held = new Set<string>();
  for (const pod of pods) {
    if (activeOnly && !runPodActive(pod)) continue;
    const claim = (asObj(asObj(pod.metadata).labels) as Record<string, string>)[RUN_CACHE_CLAIM_LABEL];
    if (claim) held.add(claim);
  }
  return held;
}

/** Which cache disk a new run of this person mounts: the most recently used
 * free one (warmest target), else a new slot, else none (the run builds on
 * its workspace disk). */
export function chooseRunCache(claims: Obj[], pods: Obj[], ownerKey: string, config: Pick<RunsConfig, "buildCache">): { claim: string; slot: number; create: boolean } | null {
  const cache = config.buildCache;
  if (!cache) return null;
  const held = cacheClaimsHeld(pods, true);
  const taken = new Set<number>();
  const free: { claim: string; slot: number; used: number }[] = [];
  for (const claim of claims) {
    const meta = asObj(claim.metadata);
    const labels = asObj(meta.labels) as Record<string, string>;
    if (labels[RUN_OWNER_LABEL] !== ownerKey) continue;
    const slot = Number(labels[RUN_CACHE_SLOT_LABEL]);
    if (!Number.isInteger(slot) || slot < 0 || String(meta.name) !== runCacheClaimName(ownerKey, slot)) continue;
    taken.add(slot);
    if (meta.deletionTimestamp || slot >= cache.slots || held.has(String(meta.name))) continue;
    free.push({ claim: String(meta.name), slot, used: time(asObj(meta.annotations)[RUN_CACHE_USED_ANNOTATION]) ?? 0 });
  }
  free.sort((a, b) => b.used - a.used || a.slot - b.slot);
  if (free[0]) return { claim: free[0].claim, slot: free[0].slot, create: false };
  for (let slot = 0; slot < cache.slots; slot += 1) {
    if (!taken.has(slot)) return { claim: runCacheClaimName(ownerKey, slot), slot, create: true };
  }
  return null;
}

/** Cache disks no run used within the retention, and no Pod references. */
export function planCacheSweep(claims: Obj[], pods: Obj[], now: number, config: Pick<RunsConfig, "buildCache">): string[] {
  const cache = config.buildCache;
  if (!cache) return [];
  const held = cacheClaimsHeld(pods, false);
  const out: string[] = [];
  for (const claim of claims) {
    const meta = asObj(claim.metadata);
    const name = String(meta.name ?? "");
    if (!name.startsWith("run-cache-") || meta.deletionTimestamp || held.has(name)) continue;
    const used = time(asObj(meta.annotations)[RUN_CACHE_USED_ANNOTATION]);
    if (used !== null && now - used >= cache.retentionMs) out.push(name);
  }
  return out;
}

/** No ingress at all. Egress: the cluster DNS, Perspicax, and GitHub for
 * the `restreint` profile, on one TCP port. Nothing else, no IPv6, no
 * other Pod. */
export function runNetworkPolicy(config: RunsConfig, request: Pick<RunRequest, "id" | "envId" | "ownerKey" | "egress">): Obj {
  const names = runNames(request.id);
  const port = [{ protocol: "TCP", port: config.egressPort }];
  const egress: Obj[] = [
    {
      to: [{
        namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": config.dns.namespace } },
        podSelector: { matchLabels: { ...config.dns.podLabels } },
      }],
      ports: [{ protocol: "UDP", port: config.dns.port }, { protocol: "TCP", port: config.dns.port }],
    },
    { to: config.perspicaxCidrs.map((cidr) => ({ ipBlock: { cidr } })), ports: port },
  ];
  if (request.egress === "restreint") egress.push({ to: config.githubCidrs.map((cidr) => ({ ipBlock: { cidr } })), ports: port });
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: names.network,
      namespace: config.namespace,
      labels: runLabels(config, request),
      annotations: { [RUN_EGRESS_ANNOTATION]: request.egress },
    },
    spec: {
      podSelector: { matchLabels: { [RUN_ID_LABEL]: request.id, [RUN_LABEL]: "1" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress,
    },
  };
}

/** The run token. Owned by the Pod, so the garbage collector removes it
 * with the Pod; the provisioner never reads it back. */
export function runTokenSecret(config: RunsConfig, request: RunRequest, podUid: string): Obj {
  const names = runNames(request.id);
  if (!/^[a-f0-9-]{8,64}$/.test(podUid)) throw new Error("invalid pod uid");
  return {
    apiVersion: "v1",
    kind: "Secret",
    type: "Opaque",
    immutable: true,
    metadata: {
      name: names.token,
      namespace: config.namespace,
      labels: runLabels(config, request),
      ownerReferences: [{ apiVersion: "v1", kind: "Pod", name: names.pod, uid: podUid }],
    },
    data: { token: Buffer.from(request.token, "utf8").toString("base64") },
  };
}

export type RunPhase = "pending" | "running" | "succeeded" | "failed" | "stopped";

export interface RunStatus {
  id: string;
  envId?: string;
  phase: RunPhase;
  reason?: string;
  exitCode?: number;
  pod: boolean;
  workspace: boolean;
  egress?: string;
  createdAt?: string;
  startedAt?: string;
  finishedAt?: string;
  /** When the provisioner removes the workspace, once the Pod is gone. */
  workspaceExpiresAt?: string;
}

function terminated(pod: Obj): { finishedAt?: string; reason?: string; exitCode?: number } {
  const statuses = (asObj(pod.status).containerStatuses ?? []) as Obj[];
  const state = asObj(asObj(statuses[0]).state);
  const done = asObj(state.terminated);
  return {
    ...(done.finishedAt ? { finishedAt: String(done.finishedAt) } : {}),
    ...(done.reason ? { reason: String(done.reason) } : {}),
    ...(typeof done.exitCode === "number" ? { exitCode: done.exitCode } : {}),
  };
}

function pendingReason(pod: Obj): string | undefined {
  const status = asObj(pod.status);
  const statuses = (status.containerStatuses ?? []) as Obj[];
  const waiting = asObj(asObj(asObj(statuses[0]).state).waiting);
  if (waiting.reason) return String(waiting.reason);
  const conditions = (status.conditions ?? []) as Obj[];
  const scheduled = conditions.find((condition) => condition.type === "PodScheduled");
  if (scheduled && scheduled.status === "False" && scheduled.reason) return String(scheduled.reason);
  return undefined;
}

function podEnded(pod: Obj): boolean {
  const phase = String(asObj(pod.status).phase ?? "");
  return phase === "Succeeded" || phase === "Failed" || Boolean(asObj(pod.metadata).deletionTimestamp);
}

/** A Pod counts toward the run quotas until it ends. */
export function runPodActive(pod: Obj): boolean {
  return !podEnded(pod);
}

export function runStatus(id: string, pod: Obj | null, pvc: Obj | null, config: Pick<RunsConfig, "diskRetentionMs">): RunStatus {
  const source = pod ?? pvc ?? {};
  const meta = asObj(source.metadata);
  const labels = asObj(meta.labels) as Record<string, string>;
  const annotations = { ...(asObj(asObj(pvc?.metadata).annotations) as Record<string, string>), ...(asObj(asObj(pod?.metadata).annotations) as Record<string, string>) };
  const base = {
    id,
    ...(labels[RUN_ENV_LABEL] ? { envId: labels[RUN_ENV_LABEL] } : {}),
    pod: Boolean(pod),
    workspace: Boolean(pvc),
    ...(annotations[RUN_EGRESS_ANNOTATION] ? { egress: annotations[RUN_EGRESS_ANNOTATION] } : {}),
    ...(meta.creationTimestamp ? { createdAt: String(meta.creationTimestamp) } : {}),
  };
  const ended = asObj(asObj(pvc?.metadata).annotations)[RUN_ENDED_ANNOTATION];
  const expires = !pod && typeof ended === "string" && Number.isFinite(Date.parse(ended))
    ? { workspaceExpiresAt: new Date(Date.parse(ended) + config.diskRetentionMs).toISOString() }
    : {};
  if (!pod) return { ...base, phase: "stopped", ...expires };
  const status = asObj(pod.status);
  const started = status.startTime ? { startedAt: String(status.startTime) } : {};
  if (asObj(pod.metadata).deletionTimestamp) return { ...base, ...started, phase: "stopped", reason: "deleting" };
  const phase = String(status.phase ?? "");
  if (phase === "Running") return { ...base, ...started, phase: "running" };
  if (phase === "Succeeded" || phase === "Failed") {
    const done = terminated(pod);
    const podReason = String(status.reason ?? "");
    const reason = podReason === "DeadlineExceeded" ? "expired" : podReason === "Evicted" ? "evicted" : done.reason;
    return {
      ...base,
      ...started,
      phase: phase === "Succeeded" ? "succeeded" : "failed",
      ...(reason ? { reason } : {}),
      ...(done.exitCode !== undefined ? { exitCode: done.exitCode } : {}),
      ...(done.finishedAt ? { finishedAt: done.finishedAt } : {}),
    };
  }
  const reason = pendingReason(pod);
  return { ...base, ...started, phase: "pending", ...(reason ? { reason } : {}) };
}

export type SweepAction =
  | { kind: "delete-pod"; id: string; reason: "retention" | "pending-timeout" | "hard-cap" }
  | { kind: "mark-ended"; id: string; at: string }
  | { kind: "delete-workspace"; id: string }
  | { kind: "delete-network"; id: string }
  /** A build cache disk idle past its retention (planCacheSweep). */
  | { kind: "delete-cache"; claim: string };

function runIdOf(obj: Obj): string | null {
  const id = (asObj(asObj(obj.metadata).labels) as Record<string, string>)[RUN_ID_LABEL] ?? "";
  return RUN_ID_RE.test(id) ? id : null;
}

function time(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : null;
}

/** What the sweep does, from what it listed (D4: the Pod goes 15 min after
 * the end, the disk 24 h after). Pure, so the retention rules are tested
 * without a cluster. */
export function planRunSweep(objects: { pods: Obj[]; claims: Obj[]; policies: Obj[] }, now: number, config: Pick<RunsConfig, "podRetentionMs" | "diskRetentionMs" | "ceilings">): SweepAction[] {
  const actions: SweepAction[] = [];
  const livePods = new Set<string>();
  const hardCapMs = (config.ceilings.maxDurationSec + RUN_DEADLINE_MARGIN_SEC) * 1000 + config.podRetentionMs;
  for (const pod of objects.pods) {
    const id = runIdOf(pod);
    if (!id) continue;
    const meta = asObj(pod.metadata);
    if (meta.deletionTimestamp) continue;
    const status = asObj(pod.status);
    const phase = String(status.phase ?? "");
    const created = time(meta.creationTimestamp) ?? now;
    if (phase === "Succeeded" || phase === "Failed") {
      const finished = time(terminated(pod).finishedAt) ?? time(status.startTime) ?? created;
      if (now - finished >= config.podRetentionMs) {
        actions.push({ kind: "delete-pod", id, reason: "retention" });
        actions.push({ kind: "mark-ended", id, at: new Date(finished).toISOString() });
        continue;
      }
    } else if (phase === "Pending" || phase === "" || phase === "Unknown") {
      if (now - created >= RUN_PENDING_TIMEOUT_MS) {
        actions.push({ kind: "delete-pod", id, reason: "pending-timeout" });
        actions.push({ kind: "mark-ended", id, at: new Date(now).toISOString() });
        continue;
      }
    }
    if (now - created >= hardCapMs) {
      actions.push({ kind: "delete-pod", id, reason: "hard-cap" });
      actions.push({ kind: "mark-ended", id, at: new Date(now).toISOString() });
      continue;
    }
    livePods.add(id);
  }
  const deletedPods = new Set(actions.filter((action) => action.kind === "delete-pod").map((action) => action.id));
  const claims = new Set<string>();
  for (const claim of objects.claims) {
    const id = runIdOf(claim);
    if (!id) continue;
    claims.add(id);
    if (livePods.has(id) || deletedPods.has(id)) continue;
    const ended = time(asObj(asObj(claim.metadata).annotations)[RUN_ENDED_ANNOTATION]);
    if (ended === null) {
      actions.push({ kind: "mark-ended", id, at: new Date(now).toISOString() });
      continue;
    }
    if (now - ended >= config.diskRetentionMs) {
      actions.push({ kind: "delete-workspace", id });
      actions.push({ kind: "delete-network", id });
    }
  }
  const podsSeen = new Set(objects.pods.map(runIdOf).filter((id): id is string => Boolean(id)));
  for (const policy of objects.policies) {
    const id = runIdOf(policy);
    if (!id || podsSeen.has(id) || claims.has(id)) continue;
    actions.push({ kind: "delete-network", id });
  }
  return actions;
}

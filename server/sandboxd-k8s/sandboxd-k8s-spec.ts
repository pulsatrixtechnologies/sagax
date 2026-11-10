// Pure Kubernetes objects for one sandbox: a Pod, a PVC and a NetworkPolicy.
// No client and no cluster here, so the isolation rules are asserted in CI
// the same way the Docker spec is (server/sandbox/user-sandbox-spec.ts).
import { isAbsolute } from "node:path";

import { SANDBOX_INSTANCE_LABEL, SANDBOX_KEY_RE, SANDBOX_LABEL, SANDBOX_UID, SANDBOX_USER_LABEL, SANDBOX_WORKSPACE, cidrContains, parseCidr, sandboxLabels, sandboxNames, type SandboxdConfig } from "../sandbox/user-sandbox-spec.ts";

const MiB = 1024 * 1024;

export const SANDBOX_NAMESPACE_DEFAULT = "sandboxes";
export const SANDBOX_QUOTA_NAME = "sagax-sandbox-quota";
export const SANDBOX_DEFAULT_DENY_NAME = "sagax-default-deny";
export const SANDBOX_WORKLOAD_SA = "sagax-sandbox-workload";
export const PAUSED_ANNOTATION = "sagax.pulsatrix.com/paused";
export const IMAGE_ANNOTATION = "sagax.pulsatrix.com/image";
export const SUBNET_ANNOTATION = "sagax.pulsatrix.com/subnet";
export const ENCRYPTED_ANNOTATION = "sagax.pulsatrix.com/encrypted";
export const PIDS_ANNOTATION = "sagax.pulsatrix.com/pids-limit";

const DNS_NAME = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const IMAGE_REF = /^(?<repo>[a-z0-9][a-z0-9.-]*(?::[0-9]{1,5})?(?:\/[a-z0-9][a-z0-9._-]*[a-z0-9])+)(?::(?<tag>[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}))?(?:@sha256:(?<digest>[a-f0-9]{64}))?$/;

export function sandboxBackendFromEnv(env: NodeJS.ProcessEnv = process.env): "docker" | "kubernetes" {
  const raw = env.SANDBOX_BACKEND?.trim() || "docker";
  if (raw === "docker" || raw === "kubernetes") return raw;
  throw new Error("SANDBOX_BACKEND must be docker or kubernetes");
}

export interface K8sSandboxConfig {
  namespace: string;
  storageClass: string;
  /** Registry prefix the sandbox image must live under (host, or host/path). */
  registry: string;
  requireDigest: boolean;
  requireEncryption: boolean;
  runtimeClass?: string;
  pullSecret?: string;
  dnsNameservers: string[];
  quotaName: string;
  /** Labels a node must carry to run sandbox pods (a dedicated pool). */
  nodeSelector?: Record<string, string>;
  /** Taints of that pool the sandbox pods tolerate. */
  tolerations?: K8sToleration[];
  /** Per-person kernel isolation for the people it lists (see
   * dedicatedFromEnv). Absent: every pod keeps the shared spec. */
  dedicated?: K8sDedicatedConfig;
}

/** One node (so one kernel) per person, and user namespaces.
 * `hostUsers: false` maps uid 1000 in the container to an unprivileged
 * uid on the node; the required pod anti-affinity keeps two people's
 * sandboxes off the same node; the selector and tolerations pick the pool
 * built for it. Only the keys listed get it, so a cluster moves one
 * person at a time and moves back by removing a key. */
export interface K8sDedicatedConfig {
  /** `*` or the sandbox keys that get the options below. */
  keys: "*" | string[];
  /** `hostUsers: false` on the pod. */
  userNamespace: boolean;
  /** Required anti-affinity against every other sandbox pod, per node. */
  ownNode: boolean;
  /** Added to the shared selector for those people. */
  nodeSelector?: Record<string, string>;
  /** Added to the shared tolerations for those people. */
  tolerations?: K8sToleration[];
  /** CPU and memory for those people (the node is theirs). Absent: the
   * shared SAGAX_SANDBOX_CPUS / SAGAX_SANDBOX_MEMORY_MB sizes. */
  nanoCpus?: number;
  memoryBytes?: number;
  /** CPU request below the limit (SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST).
   * The limit stays nanoCpus, so the sandbox runs as fast; the smaller
   * request leaves room on its own node for a DaemonSet added later. */
  nanoCpuRequest?: number;
  /** The reserve Deployment the provisioner scales (warmNode.spare). */
  spare?: K8sSpareConfig;
}

export interface K8sSpareConfig {
  namespace: string;
  deployment: string;
  /** Reserve nodes at most. */
  max: number;
}

/** One reserve per active person, up to max; none when nobody is active.
 * With max 2: nobody active costs nothing, the first person's arrival
 * starts one reserve, a second at the same time starts the second, and
 * every later arrival still finds a warm node while two are held. */
export function spareReplicas(active: number, max: number): number {
  if (!Number.isFinite(active) || active <= 0) return 0;
  return Math.min(max, Math.floor(active));
}

export interface K8sToleration {
  key: string;
  operator: "Equal" | "Exists";
  value?: string;
  effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

const LABEL_NAME = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
const LABEL_PREFIX = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;
const TAINT_EFFECTS = ["NoSchedule", "PreferNoSchedule", "NoExecute"] as const;

/** A Kubernetes label or taint key: `name` or `prefix/name`. */
function labelKey(raw: string): boolean {
  const slash = raw.indexOf("/");
  if (slash === -1) return raw.length <= 63 && LABEL_NAME.test(raw);
  const prefix = raw.slice(0, slash);
  const name = raw.slice(slash + 1);
  return prefix.length > 0 && prefix.length <= 253 && LABEL_PREFIX.test(prefix) && name.length <= 63 && LABEL_NAME.test(name);
}

function labelValue(raw: string): boolean {
  return raw.length <= 63 && LABEL_NAME.test(raw);
}

/** `SAGAX_SANDBOX_K8S_NODE_SELECTOR`: `key=value[,key=value...]`, for
 * example `example.com/pool=sandboxes`. Empty or unset: no selector. Any
 * malformed pair refuses the start. */
export function parseNodeSelector(raw: string | undefined): Record<string, string> | undefined {
  const text = raw?.trim() ?? "";
  if (!text) return undefined;
  const out: Record<string, string> = {};
  for (const part of text.split(",")) {
    const pair = part.trim();
    const eq = pair.indexOf("=");
    const key = eq === -1 ? "" : pair.slice(0, eq);
    const value = eq === -1 ? "" : pair.slice(eq + 1);
    if (!labelKey(key) || !labelValue(value)) throw new Error("SAGAX_SANDBOX_K8S_NODE_SELECTOR must be key=value pairs separated by commas (Kubernetes label syntax)");
    if (key in out) throw new Error(`SAGAX_SANDBOX_K8S_NODE_SELECTOR names ${key} twice`);
    out[key] = value;
  }
  return out;
}

/** `SAGAX_SANDBOX_K8S_TOLERATION`: `key=value:Effect` (operator Equal) or
 * `key:Effect` (operator Exists), several separated by commas, for example
 * `example.com/sandboxes=true:NoSchedule`. Empty or unset: none. Any
 * malformed entry refuses the start. */
export function parseTolerations(raw: string | undefined): K8sToleration[] | undefined {
  const text = raw?.trim() ?? "";
  if (!text) return undefined;
  const out: K8sToleration[] = [];
  for (const part of text.split(",")) {
    const entry = part.trim();
    const colon = entry.lastIndexOf(":");
    const effect = colon === -1 ? "" : entry.slice(colon + 1);
    const head = colon === -1 ? "" : entry.slice(0, colon);
    const eq = head.indexOf("=");
    const key = eq === -1 ? head : head.slice(0, eq);
    const value = eq === -1 ? undefined : head.slice(eq + 1);
    if (!(TAINT_EFFECTS as readonly string[]).includes(effect) || !labelKey(key) || (value !== undefined && !labelValue(value))) {
      throw new Error("SAGAX_SANDBOX_K8S_TOLERATION must be key=value:Effect or key:Effect, separated by commas (Effect: NoSchedule, PreferNoSchedule or NoExecute)");
    }
    out.push(value === undefined
      ? { key, operator: "Exists", effect: effect as K8sToleration["effect"] }
      : { key, operator: "Equal", value, effect: effect as K8sToleration["effect"] });
  }
  return out;
}

/** `SAGAX_SANDBOX_K8S_DEDICATED_KEYS`: `*` or sandbox keys separated by
 * commas. Unset: `*` (everyone). Set but empty: nobody, which is the global
 * way back. A malformed key refuses the start. */
export function parseDedicatedKeys(raw: string | undefined): "*" | string[] {
  if (raw === undefined) return "*";
  const text = raw.trim();
  if (text === "*") return "*";
  const keys = text.split(",").map((part) => part.trim()).filter(Boolean);
  for (const key of keys) {
    if (!SANDBOX_KEY_RE.test(key)) throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_KEYS must be * or sandbox keys separated by commas");
  }
  return [...new Set(keys)];
}

/** The dedicated options, or undefined when neither is on. */
export function dedicatedFromEnv(env: NodeJS.ProcessEnv): K8sDedicatedConfig | undefined {
  const userNamespace = !namedFlag(env.SAGAX_SANDBOX_K8S_HOST_USERS, "SAGAX_SANDBOX_K8S_HOST_USERS", true);
  const ownNode = namedFlag(env.SAGAX_SANDBOX_K8S_DEDICATED_NODE, "SAGAX_SANDBOX_K8S_DEDICATED_NODE", false);
  if (!userNamespace && !ownNode) return undefined;
  const keys = parseDedicatedKeys(env.SAGAX_SANDBOX_K8S_DEDICATED_KEYS);
  const nodeSelector = parseNodeSelector(env.SAGAX_SANDBOX_K8S_DEDICATED_NODE_SELECTOR);
  const tolerations = parseTolerations(env.SAGAX_SANDBOX_K8S_DEDICATED_TOLERATION);
  if (ownNode && !nodeSelector) {
    throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_NODE needs SAGAX_SANDBOX_K8S_DEDICATED_NODE_SELECTOR (the label of the pool with one node per person)");
  }
  const cpus = env.SAGAX_SANDBOX_K8S_DEDICATED_CPUS?.trim();
  const memoryMb = env.SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB?.trim();
  let nanoCpus: number | undefined;
  let memoryBytes: number | undefined;
  if (cpus) {
    const value = Number(cpus);
    if (!Number.isFinite(value) || value <= 0 || value > 64) throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_CPUS must be a positive number up to 64");
    nanoCpus = Math.floor(value * 1e9);
  }
  const cpuRequest = env.SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST?.trim();
  let nanoCpuRequest: number | undefined;
  if (cpuRequest) {
    const value = Number(cpuRequest);
    if (!nanoCpus) throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST needs SAGAX_SANDBOX_K8S_DEDICATED_CPUS (the limit it stays under)");
    if (!Number.isFinite(value) || value <= 0 || Math.floor(value * 1e9) > nanoCpus) {
      throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST must be a positive number no higher than SAGAX_SANDBOX_K8S_DEDICATED_CPUS");
    }
    nanoCpuRequest = Math.floor(value * 1e9);
  }
  if (memoryMb) {
    const value = Number(memoryMb);
    if (!Number.isInteger(value) || value <= 0 || value > 65536) throw new Error("SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB must be a whole number of MiB up to 65536");
    memoryBytes = value * MiB;
  }
  const spareRaw = env.SAGAX_SANDBOX_K8S_SPARE?.trim();
  let spare: K8sSpareConfig | undefined;
  if (spareRaw) {
    const [spareNs, spareName, extra] = spareRaw.split("/");
    if (extra !== undefined || !spareNs || !spareName || !DNS_NAME.test(spareNs) || !DNS_NAME.test(spareName)) {
      throw new Error("SAGAX_SANDBOX_K8S_SPARE must be namespace/deployment");
    }
    const maxRaw = env.SAGAX_SANDBOX_K8S_SPARE_MAX?.trim() || "2";
    const max = Number(maxRaw);
    if (!Number.isInteger(max) || max < 0 || max > 64) throw new Error("SAGAX_SANDBOX_K8S_SPARE_MAX must be a whole number from 0 to 64");
    spare = { namespace: spareNs, deployment: spareName, max };
  }
  return {
    keys,
    userNamespace,
    ownNode,
    ...(spare ? { spare } : {}),
    ...(nodeSelector ? { nodeSelector } : {}),
    ...(tolerations ? { tolerations } : {}),
    ...(nanoCpus ? { nanoCpus } : {}),
    ...(nanoCpuRequest ? { nanoCpuRequest } : {}),
    ...(memoryBytes ? { memoryBytes } : {}),
  };
}

/** The dedicated options that apply to this person, if any. */
export function dedicatedFor(k8s: Pick<K8sSandboxConfig, "dedicated">, key: string): K8sDedicatedConfig | undefined {
  const dedicated = k8s.dedicated;
  if (!dedicated) return undefined;
  if (dedicated.keys === "*" || dedicated.keys.includes(key)) return dedicated;
  return undefined;
}

export const HOSTNAME_TOPOLOGY = "kubernetes.io/hostname";

export interface K8sGuards {
  /** Operator attestation that etcd encryption covers Secret resources. */
  secretsEncryptedAttested: boolean;
  /** Operator attestation that the CNI enforces NetworkPolicy. */
  networkPolicyAttested: boolean;
  tlsInsecure: boolean;
  tlsCertPath?: string;
  tlsKeyPath?: string;
  auditFile: string;
  auditShipUrl?: string;
}

function dnsLabel(value: string, name: string, max = 63): string {
  if (!DNS_NAME.test(value) || value.length > max) throw new Error(`${name} must be a DNS label (lowercase, at most ${max})`);
  return value;
}

function namedFlag(raw: string | undefined, name: string, fallback: boolean, extraTrue: readonly string[] = []): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = raw.trim();
  if (extraTrue.includes(value) || /^(1|true|yes|on)$/i.test(value)) return true;
  if (/^(0|false|no|off)$/i.test(value)) return false;
  throw new Error(`${name} is not a recognized value`);
}

/** Kubernetes settings. Read only when SANDBOX_BACKEND=kubernetes. */
export function kubernetesSandboxConfigFromEnv(env: NodeJS.ProcessEnv, sandbox: Pick<SandboxdConfig, "egressDeny" | "image">): { k8s: K8sSandboxConfig; guards: K8sGuards } {
  const namespace = dnsLabel(env.SAGAX_SANDBOX_K8S_NAMESPACE?.trim() || SANDBOX_NAMESPACE_DEFAULT, "SAGAX_SANDBOX_K8S_NAMESPACE");
  const storageClass = env.SAGAX_SANDBOX_K8S_STORAGE_CLASS?.trim() ?? "";
  if (!storageClass || !DNS_NAME.test(storageClass)) throw new Error("SAGAX_SANDBOX_K8S_STORAGE_CLASS is required (a StorageClass that encrypts volumes)");
  const registry = env.SAGAX_SANDBOX_K8S_REGISTRY?.trim() ?? "";
  if (!registry || /[A-Z\s]/.test(registry) || registry.endsWith("/")) throw new Error("SAGAX_SANDBOX_K8S_REGISTRY is required (lowercase host or host/path, no trailing slash)");
  const runtime = env.SAGAX_SANDBOX_K8S_RUNTIME_CLASS?.trim() || undefined;
  if (runtime && !DNS_NAME.test(runtime)) throw new Error("SAGAX_SANDBOX_K8S_RUNTIME_CLASS is not a RuntimeClass name");
  const pullSecret = env.SAGAX_SANDBOX_K8S_PULL_SECRET?.trim() || undefined;
  if (pullSecret && !DNS_NAME.test(pullSecret)) throw new Error("SAGAX_SANDBOX_K8S_PULL_SECRET is not a Secret name");
  const dnsNameservers = (env.SAGAX_SANDBOX_K8S_DNS?.trim() || "1.1.1.1,8.8.8.8").split(/[\s,]+/).filter(Boolean);
  if (dnsNameservers.length === 0 || dnsNameservers.length > 3) throw new Error("SAGAX_SANDBOX_K8S_DNS needs 1 to 3 IPv4 addresses");
  for (const address of dnsNameservers) {
    parseCidr(`${address}/32`);
    if (sandbox.egressDeny.some((cidr) => cidrContains(cidr, `${address}/32`))) {
      throw new Error(`SAGAX_SANDBOX_K8S_DNS ${address} is inside the egress deny list, so the sandbox could not resolve names`);
    }
  }
  const nodeSelector = parseNodeSelector(env.SAGAX_SANDBOX_K8S_NODE_SELECTOR);
  const tolerations = parseTolerations(env.SAGAX_SANDBOX_K8S_TOLERATION);
  const dedicated = dedicatedFromEnv(env);
  const quotaName = dnsLabel(env.SAGAX_SANDBOX_K8S_QUOTA_NAME?.trim() || SANDBOX_QUOTA_NAME, "SAGAX_SANDBOX_K8S_QUOTA_NAME");
  const requireDigest = namedFlag(env.SAGAX_SANDBOX_K8S_REQUIRE_SIGNED, "SAGAX_SANDBOX_K8S_REQUIRE_SIGNED", true);
  const imageProblems = imageAdmissionProblems(sandbox.image, { registry, requireDigest });
  if (imageProblems.length) throw new Error(`SAGAX_SANDBOX_IMAGE is not admitted: ${imageProblems.join(", ")}`);
  const tlsInsecure = namedFlag(env.SAGAX_SANDBOXD_TLS_INSECURE, "SAGAX_SANDBOXD_TLS_INSECURE", false);
  const tlsCertPath = env.SAGAX_SANDBOXD_TLS_CERT?.trim() || undefined;
  const tlsKeyPath = env.SAGAX_SANDBOXD_TLS_KEY?.trim() || undefined;
  if (!tlsInsecure && (!tlsCertPath || !tlsKeyPath)) {
    throw new Error("SAGAX_SANDBOXD_TLS_CERT and SAGAX_SANDBOXD_TLS_KEY are required when SANDBOX_BACKEND=kubernetes");
  }
  const auditFile = env.SAGAX_SANDBOX_AUDIT_LOG?.trim() || "/var/log/sagax/sandbox-audit.jsonl";
  if (auditFile.includes("\0") || !isAbsolute(auditFile)) throw new Error("SAGAX_SANDBOX_AUDIT_LOG must be an absolute path");
  const auditShipUrl = env.SAGAX_SANDBOX_AUDIT_SHIP_URL?.trim() || undefined;
  if (auditShipUrl && !auditShipUrl.startsWith("https://")) throw new Error("SAGAX_SANDBOX_AUDIT_SHIP_URL must be https");
  const secretsEncryptedAttested = namedFlag(env.SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED, "SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED", false);
  const networkPolicyAttested = namedFlag(env.SAGAX_SANDBOX_K8S_NETWORK_POLICY, "SAGAX_SANDBOX_K8S_NETWORK_POLICY", false, ["enforced"]);
  if (!secretsEncryptedAttested) throw new Error("SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED=true is required (etcd encryption for Secret resources)");
  if (!networkPolicyAttested) throw new Error("SAGAX_SANDBOX_K8S_NETWORK_POLICY=enforced is required (the CNI must enforce NetworkPolicy)");
  return {
    k8s: {
      namespace,
      storageClass,
      registry,
      requireDigest,
      requireEncryption: namedFlag(env.SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION, "SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION", true),
      ...(runtime ? { runtimeClass: runtime } : {}),
      ...(pullSecret ? { pullSecret } : {}),
      dnsNameservers,
      quotaName,
      ...(nodeSelector ? { nodeSelector } : {}),
      ...(tolerations ? { tolerations } : {}),
      ...(dedicated ? { dedicated } : {}),
    },
    guards: {
      secretsEncryptedAttested,
      networkPolicyAttested,
      tlsInsecure,
      ...(tlsCertPath ? { tlsCertPath } : {}),
      ...(tlsKeyPath ? { tlsKeyPath } : {}),
      auditFile,
      ...(auditShipUrl ? { auditShipUrl } : {}),
    },
  };
}

export interface ImageAdmission {
  registry: string;
  requireDigest: boolean;
}

/** Refuse anything that is not a tag in the controlled registry.
 * `latest`, a bare name (`sagax-sandbox:local`) and a missing digest (when
 * signatures are required) are refused. The digest is how a signed,
 * scanned image is pinned; cosign itself runs in the image workflow. */
export function imageAdmissionProblems(image: string, policy: ImageAdmission): string[] {
  const problems: string[] = [];
  const match = IMAGE_REF.exec(image);
  if (!match?.groups?.repo || !match.groups.tag) {
    problems.push("must be registry/name:tag or registry/name:tag@sha256:<64 hex>");
    return problems;
  }
  if (match.groups.tag === "latest") problems.push("tag latest is refused");
  const repo = match.groups.repo;
  if (repo !== policy.registry && !repo.startsWith(`${policy.registry}/`)) problems.push(`registry is not ${policy.registry}`);
  if (policy.requireDigest && !match.groups.digest) problems.push("digest pin is required (image@sha256:...)");
  return problems;
}

/** True when the StorageClass advertises encryption. Cloud parameters differ;
 * the portable switch is the annotation sagax.pulsatrix.com/encrypted=true,
 * which the operator sets after confirming the CSI driver encrypts. */
export function storageClassEncrypts(storageClass: { parameters?: Record<string, string | undefined>; annotations?: Record<string, string | undefined> }): boolean {
  const parameters = storageClass.parameters ?? {};
  const annotations = storageClass.annotations ?? {};
  if (annotations[ENCRYPTED_ANNOTATION] === "true") return true;
  const enabled = (value: string | undefined) => value === "true" || value === "True" || value === "1";
  if (enabled(parameters.encrypted) || enabled(parameters.encryption)) return true;
  if (parameters.diskEncryptionSetID || parameters.diskEncryptionSetId) return true;
  return false;
}

export function quantityBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error("quantity must be positive");
  if (bytes % MiB === 0) return `${bytes / MiB}Mi`;
  return `${Math.floor(bytes)}`;
}

/** A storage quantity ("2Gi", "2048Mi", "21474836480", "20G") in bytes,
 * or null when it is not one. */
export function quantityToBytes(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|k|M|G|T|P)?$/.exec(value.trim());
  if (!match) return null;
  const units: Record<string, number> = { Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5, k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15 };
  return Math.floor(Number(match[1]) * (match[2] ? units[match[2]]! : 1));
}

export function quantityCpu(nanoCpus: number): string {
  if (!Number.isFinite(nanoCpus) || nanoCpus <= 0) throw new Error("cpu must be positive");
  return `${Math.round(nanoCpus / 1e6)}m`;
}

type Obj = Record<string, unknown>;

function asObj(value: unknown): Obj {
  return value && typeof value === "object" ? value as Obj : {};
}

/** The Pod for one person. Built from the Docker spec SandboxService already
 * checked with assertSandboxIsolation(), then checked again as a Pod. */
export function podFromDockerSpec(spec: Obj, k8s: K8sSandboxConfig): Obj {
  const labels = asObj(spec.Labels) as Record<string, string>;
  const key = labels[SANDBOX_USER_LABEL] ?? "";
  if (!SANDBOX_KEY_RE.test(key)) throw new Error("sandbox pod is missing its person key");
  const names = sandboxNames(key);
  const host = asObj(spec.HostConfig);
  const dedicated = dedicatedFor(k8s, key);
  const memory = dedicated?.memoryBytes ?? Number(host.Memory);
  const nanoCpus = dedicated?.nanoCpus ?? Number(host.NanoCpus);
  const nodeSelector = k8s.nodeSelector || dedicated?.nodeSelector
    ? { ...k8s.nodeSelector, ...(dedicated ? dedicated.nodeSelector : {}) }
    : undefined;
  const tolerations = [...(k8s.tolerations ?? []), ...(dedicated?.tolerations ?? [])];
  const tmpfs = asObj(host.Tmpfs) as Record<string, string>;
  const tmpBytes = Number(/size=(\d+)/.exec(tmpfs["/tmp"] ?? "")?.[1] ?? 0);
  const shmBytes = Number(/size=(\d+)/.exec(tmpfs["/dev/shm"] ?? "")?.[1] ?? 0);
  const pids = Number(host.PidsLimit);
  const cpu = quantityCpu(nanoCpus);
  const cpuRequest = dedicated?.nanoCpuRequest ? quantityCpu(dedicated.nanoCpuRequest) : cpu;
  const memoryQ = quantityBytes(memory);
  const tmpQ = quantityBytes(Math.min(tmpBytes || MiB, memory));
  const shmQ = quantityBytes(Math.min(shmBytes || 8 * MiB, 128 * MiB, memory));
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: {
      name: names.container,
      namespace: k8s.namespace,
      labels,
      annotations: {
        [PIDS_ANNOTATION]: String(pids || 0),
        // Aggressive node scale-down never takes a node from under a person.
        ...(dedicated?.ownNode ? { "cluster-autoscaler.kubernetes.io/safe-to-evict": "false" } : {}),
      },
    },
    spec: {
      restartPolicy: "Never",
      terminationGracePeriodSeconds: 5,
      automountServiceAccountToken: false,
      enableServiceLinks: false,
      serviceAccountName: SANDBOX_WORKLOAD_SA,
      hostNetwork: false,
      hostPID: false,
      hostIPC: false,
      shareProcessNamespace: false,
      dnsPolicy: "None",
      // single-request-reopen: glibc sends the A and AAAA queries from one
      // UDP socket at the same instant; behind a NAT gateway (a dedicated
      // egress address for the sandbox pool) the second packet of that new
      // flow can be dropped and every lookup waits the 5 s resolver timeout.
      // A new socket for the second query costs nothing measurable.
      dnsConfig: { nameservers: k8s.dnsNameservers, searches: [], options: [{ name: "single-request-reopen" }] },
      ...(k8s.runtimeClass ? { runtimeClassName: k8s.runtimeClass } : {}),
      ...(k8s.pullSecret ? { imagePullSecrets: [{ name: k8s.pullSecret }] } : {}),
      // A dedicated node pool: its label selects it, its taint keeps every
      // other workload off it and these pods tolerate that taint.
      ...(nodeSelector ? { nodeSelector } : {}),
      ...(tolerations.length ? { tolerations: tolerations.map((toleration) => ({ ...toleration })) } : {}),
      // One kernel per person: no other sandbox pod on this node. The
      // label matches every person, so the scheduler gives each its own node.
      ...(dedicated?.ownNode ? {
        affinity: {
          podAntiAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: [{
              labelSelector: { matchExpressions: [{ key: SANDBOX_USER_LABEL, operator: "Exists" }] },
              topologyKey: HOSTNAME_TOPOLOGY,
            }],
          },
        },
      } : {}),
      // User namespace: uid 1000 here is an unprivileged uid on the node.
      ...(dedicated?.userNamespace ? { hostUsers: false } : {}),
      securityContext: {
        runAsNonRoot: true,
        runAsUser: SANDBOX_UID,
        runAsGroup: SANDBOX_UID,
        fsGroup: SANDBOX_UID,
        fsGroupChangePolicy: "OnRootMismatch",
        seccompProfile: { type: "RuntimeDefault" },
      },
      containers: [{
        name: "sandbox",
        image: String(spec.Image ?? ""),
        imagePullPolicy: "IfNotPresent",
        command: ["sleep", "infinity"],
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
          { name: "SAGAX_ENVIRONMENT", value: "user-sandbox" },
        ],
        resources: {
          requests: { cpu: cpuRequest, memory: memoryQ, "ephemeral-storage": tmpQ },
          limits: { cpu, memory: memoryQ, "ephemeral-storage": tmpQ },
        },
        volumeMounts: [
          { name: "workspace", mountPath: SANDBOX_WORKSPACE, readOnly: false },
          { name: "tmp", mountPath: "/tmp", readOnly: false },
          { name: "run", mountPath: "/run", readOnly: false },
          { name: "shm", mountPath: "/dev/shm", readOnly: false },
        ],
      }],
      volumes: [
        { name: "workspace", persistentVolumeClaim: { claimName: names.volume } },
        { name: "tmp", emptyDir: { medium: "Memory", sizeLimit: tmpQ } },
        { name: "run", emptyDir: { medium: "Memory", sizeLimit: "8Mi" } },
        { name: "shm", emptyDir: { medium: "Memory", sizeLimit: shmQ } },
      ],
    },
  };
}

/** True when the pod keeps every other sandbox pod off its node. */
export function podHasOwnNode(spec: Obj): boolean {
  const anti = asObj(asObj(spec.affinity).podAntiAffinity);
  const terms = Array.isArray(anti.requiredDuringSchedulingIgnoredDuringExecution) ? anti.requiredDuringSchedulingIgnoredDuringExecution as Obj[] : [];
  return terms.some((term) => {
    if (term.topologyKey !== HOSTNAME_TOPOLOGY) return false;
    const selector = asObj(term.labelSelector);
    if (selector.matchLabels && Object.keys(asObj(selector.matchLabels)).length > 0) return false;
    const expressions = Array.isArray(selector.matchExpressions) ? selector.matchExpressions as Obj[] : [];
    return expressions.length === 1 && expressions[0]?.key === SANDBOX_USER_LABEL && expressions[0]?.operator === "Exists";
  });
}

/** Restricted-style isolation for the Pod we send. A failure refuses the
 * create. With `k8s`, the dedicated options this person must have are
 * checked too. */
export function podIsolationProblems(pod: Obj, key: string, k8s?: Pick<K8sSandboxConfig, "dedicated">): string[] {
  const names = sandboxNames(key);
  const problems: string[] = [];
  const spec = asObj(pod.spec);
  const dedicated = k8s ? dedicatedFor(k8s, key) : undefined;
  if (dedicated?.userNamespace && spec.hostUsers !== false) problems.push("user namespace missing (hostUsers)");
  if (dedicated?.ownNode && !podHasOwnNode(spec)) problems.push("own node missing (pod anti-affinity)");
  if (dedicated?.ownNode && dedicated.nodeSelector) {
    const selector = asObj(spec.nodeSelector);
    if (Object.entries(dedicated.nodeSelector).some(([name, value]) => selector[name] !== value)) problems.push("dedicated pool selector missing");
  }
  const podSec = asObj(spec.securityContext);
  const containers = Array.isArray(spec.containers) ? spec.containers as Obj[] : [];
  const container = asObj(containers[0]);
  const sec = asObj(container.securityContext);
  const caps = asObj(sec.capabilities);
  if (containers.length !== 1) problems.push("not exactly one container");
  if (podSec.runAsNonRoot !== true || sec.runAsNonRoot !== true) problems.push("may run as root");
  if (podSec.runAsUser !== SANDBOX_UID || sec.runAsUser !== SANDBOX_UID) problems.push("uid is not 1000");
  if (sec.allowPrivilegeEscalation !== false) problems.push("privilege escalation");
  if (sec.readOnlyRootFilesystem !== true) problems.push("writable root filesystem");
  if (sec.privileged === true || podSec.privileged === true) problems.push("privileged");
  const drop = Array.isArray(caps.drop) ? caps.drop.map(String) : [];
  if (!drop.includes("ALL")) problems.push("capabilities not dropped");
  if (Array.isArray(caps.add) && caps.add.length > 0) problems.push("adds capabilities");
  const seccomp = String(asObj(sec.seccompProfile).type || asObj(podSec.seccompProfile).type || "");
  if (seccomp !== "RuntimeDefault" && seccomp !== "Localhost") problems.push("seccomp is not the runtime default");
  if (spec.hostNetwork === true || spec.hostPID === true || spec.hostIPC === true) problems.push("host namespace");
  if (spec.automountServiceAccountToken !== false) problems.push("service account token mounted");
  if (spec.serviceAccountName !== SANDBOX_WORKLOAD_SA) problems.push("unexpected service account");
  const resources = asObj(container.resources);
  const limits = asObj(resources.limits);
  const requests = asObj(resources.requests);
  const cpuRequestOk = limits.cpu === requests.cpu
    || (dedicated?.nanoCpuRequest !== undefined && requests.cpu === quantityCpu(dedicated.nanoCpuRequest));
  if (!limits.cpu || !limits.memory || !cpuRequestOk || limits.memory !== requests.memory) problems.push("cpu or memory limit missing");
  const volumes = Array.isArray(spec.volumes) ? spec.volumes as Obj[] : [];
  for (const volume of volumes) {
    if (volume.hostPath || volume.nfs || volume.iscsi) problems.push(`host volume ${String(volume.name ?? "")}`);
    const claim = asObj(volume.persistentVolumeClaim);
    if (volume.persistentVolumeClaim && claim.claimName !== names.volume) problems.push("foreign volume claim");
  }
  if (!volumes.some((volume) => asObj(volume.persistentVolumeClaim).claimName === names.volume)) problems.push("workspace volume missing");
  const mounts = Array.isArray(container.volumeMounts) ? container.volumeMounts as Obj[] : [];
  if (mounts.some((mount) => String(mount.mountPath) === "/var/run/docker.sock" || String(mount.mountPath).includes("containerd.sock"))) {
    problems.push("container runtime socket");
  }
  if (JSON.stringify(pod).includes("docker.sock")) problems.push("container runtime socket");
  const ports = container.ports;
  if (Array.isArray(ports) && ports.length > 0) problems.push("published ports");
  return problems;
}

export function pvcSpec(k8s: K8sSandboxConfig, key: string, storageBytes: number, image: string, labels: Record<string, string>): Obj {
  const names = sandboxNames(key);
  return {
    apiVersion: "v1",
    kind: "PersistentVolumeClaim",
    metadata: {
      name: names.volume,
      namespace: k8s.namespace,
      labels,
      annotations: { [IMAGE_ANNOTATION]: image },
    },
    spec: {
      accessModes: ["ReadWriteOnce"],
      storageClassName: k8s.storageClass,
      resources: { requests: { storage: quantityBytes(storageBytes) } },
    },
  };
}

/** Egress to public IPv4 only. Private, link-local, metadata and the other
 * deny CIDRs are exceptions on 0.0.0.0/0. Ingress is empty, so nothing
 * dials the sandbox. IPv6 is not allowed. */
export function sandboxNetworkPolicy(k8s: K8sSandboxConfig, key: string, subnet: string, deny: readonly string[], labels: Record<string, string>): Obj {
  const names = sandboxNames(key);
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: names.network,
      namespace: k8s.namespace,
      labels,
      annotations: { [SUBNET_ANNOTATION]: subnet },
    },
    spec: {
      podSelector: { matchLabels: { [SANDBOX_USER_LABEL]: key, [SANDBOX_LABEL]: "1" } },
      policyTypes: ["Ingress", "Egress"],
      ingress: [],
      egress: sandboxEgress(deny),
    },
  };
}

/** spec.egress of a person's policy: public IPv4 minus the deny list. */
export function sandboxEgress(deny: readonly string[]): Obj[] {
  return [{
    to: [{ ipBlock: { cidr: "0.0.0.0/0", ...(deny.length ? { except: [...deny] } : {}) } }],
  }];
}

/** Namespace backstop: any Pod that lost its own policy still has no ingress
 * and no egress. This selects the provisioner too. The operator applies
 * deploy/k8s/provisioner/networkpolicy-provisioner.yaml first so that pod keeps
 * egress to the API (443 and 6443) and ingress on 8791. */
export function defaultDenyNetworkPolicy(namespace: string, instance: string): Obj {
  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "NetworkPolicy",
    metadata: {
      name: SANDBOX_DEFAULT_DENY_NAME,
      namespace,
      labels: { [SANDBOX_LABEL]: "egress", [SANDBOX_INSTANCE_LABEL]: instance },
    },
    spec: {
      podSelector: {},
      policyTypes: ["Ingress", "Egress"],
    },
  };
}

export interface QuotaHard {
  pods?: string;
  memory?: string;
  cpu?: string;
  storage?: string;
}

export function quotaProblems(hard: Record<string, string> | null): string[] {
  if (!hard) return ["ResourceQuota is missing"];
  const problems: string[] = [];
  const pods = Number(hard["pods"] ?? hard["count/pods"] ?? "");
  if (!Number.isFinite(pods) || pods < 1) problems.push("ResourceQuota does not cap pods");
  const memory = hard["limits.memory"] || hard["requests.memory"];
  const cpu = hard["limits.cpu"] || hard["requests.cpu"];
  const storage = hard["requests.storage"];
  if (!memory) problems.push("ResourceQuota does not cap memory");
  if (!cpu) problems.push("ResourceQuota does not cap cpu");
  if (!storage) problems.push("ResourceQuota does not cap storage");
  return problems;
}

export interface ReadinessView {
  namespaceExists: boolean;
  storageClassFound: boolean;
  storageEncrypts: boolean;
  requireEncryption: boolean;
  quotaHard: Record<string, string> | null;
  imageProblems: string[];
  secretsEncryptedAttested: boolean;
  networkPolicyAttested: boolean;
  tlsReady: boolean;
  auditWritable: boolean;
}

/** Problems that keep the provisioner from serving. Empty means it may listen. */
export function kubernetesReadinessProblems(view: ReadinessView): string[] {
  const problems: string[] = [];
  if (!view.namespaceExists) problems.push("sandbox namespace is missing");
  if (!view.storageClassFound) problems.push("StorageClass is missing");
  else if (view.requireEncryption && !view.storageEncrypts) problems.push("StorageClass does not advertise encryption at rest");
  problems.push(...quotaProblems(view.quotaHard));
  if (view.imageProblems.length) problems.push(`image refused: ${view.imageProblems.join(", ")}`);
  if (!view.secretsEncryptedAttested) problems.push("Secret encryption at rest is not attested");
  if (!view.networkPolicyAttested) problems.push("NetworkPolicy enforcement is not attested");
  if (!view.tlsReady) problems.push("TLS certificate for the provisioner is missing");
  if (!view.auditWritable) problems.push("audit log is not writable");
  return problems;
}

/** metrics.k8s.io CPU quantity to CPUs (1 = one core). */
export function parseCpuQuantity(raw: string): number {
  const match = /^([0-9.]+)(n|u|m)?$/.exec(raw.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  if (match[2] === "n") return value / 1e9;
  if (match[2] === "u") return value / 1e6;
  if (match[2] === "m") return value / 1e3;
  return value;
}

/** metrics.k8s.io memory quantity to bytes. */
export function parseMemoryQuantity(raw: string): number {
  const match = /^([0-9.]+)(Ki|Mi|Gi|Ti|k|M|G)?$/.exec(raw.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2];
  if (unit === "Ki") return value * 1024;
  if (unit === "Mi") return value * 1024 * 1024;
  if (unit === "Gi") return value * 1024 * 1024 * 1024;
  if (unit === "Ti") return value * 1024 * 1024 * 1024 * 1024;
  if (unit === "k") return value * 1000;
  if (unit === "M") return value * 1000 * 1000;
  if (unit === "G") return value * 1000 * 1000 * 1000;
  return value;
}

/** The Kubernetes exec status document (channel 3). */
export function parseExecStatus(text: string): number | null {
  try {
    const body = JSON.parse(text) as { status?: string; details?: { causes?: { reason?: string; message?: string }[] } };
    if (body.status === "Success") return 0;
    const code = body.details?.causes?.find((cause) => cause.reason === "ExitCode")?.message;
    if (code && /^\d+$/.test(code)) return Number(code);
    if (body.status === "Failure") return 1;
  } catch {
    return null;
  }
  return null;
}

/** #3440: why the cluster did not run a command, from its exec status (the
 * v4 channel 3 frame), or null when the command itself answered (success or
 * its own exit code). A failure with no exit code is the cluster's own (the
 * node could not start the command, or its stream broke): parseExecStatus
 * reads it as exit 1, and its message was dropped, so every command of a
 * saturated environment answered "exit 1" with no output and no reason. */
export function execStatusFailure(text: string): string | null {
  let body: { status?: string; message?: string; reason?: string; details?: { causes?: { reason?: string; message?: string }[] } };
  try { body = JSON.parse(text) as typeof body; } catch { return "the environment sent an unreadable exec status"; }
  if (body.status === "Success") return null;
  if (body.details?.causes?.some((cause) => cause.reason === "ExitCode")) return null;
  if (body.status !== "Failure") return null;
  const message = typeof body.message === "string" ? body.message.trim().slice(0, 500) : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 80) : "";
  return message || reason || "the cluster refused the command without a reason";
}

export function sandboxKeyFromContainerName(name: string): string {
  const key = name.startsWith("sagax-user-") ? name.slice("sagax-user-".length) : "";
  if (!SANDBOX_KEY_RE.test(key)) throw new Error("invalid sandbox pod name");
  return key;
}

/** Labels copied onto Kubernetes objects. Same keys as Docker. */
export function k8sLabels(config: Pick<SandboxdConfig, "instance">, key: string): Record<string, string> {
  return sandboxLabels(config, key);
}

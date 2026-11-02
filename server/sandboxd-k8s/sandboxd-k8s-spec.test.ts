import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  quantityToBytes,
  dedicatedFor,
  dedicatedFromEnv,
  defaultDenyNetworkPolicy,
  imageAdmissionProblems,
  kubernetesReadinessProblems,
  kubernetesSandboxConfigFromEnv,
  parseCpuQuantity,
  parseDedicatedKeys,
  spareReplicas,
  parseExecStatus,
  parseMemoryQuantity,
  parseNodeSelector,
  parseTolerations,
  podFromDockerSpec,
  podIsolationProblems,
  pvcSpec,
  quantityBytes,
  quotaProblems,
  sandboxBackendFromEnv,
  sandboxNetworkPolicy,
  storageClassEncrypts,
  type K8sSandboxConfig,
} from "./sandboxd-k8s-spec.ts";
import { DEFAULT_EGRESS_DENY, sandboxContainerSpec, sandboxKeyForPrincipal, sandboxdConfigFromEnv } from "../user-sandbox-spec.ts";

const DIGEST = "ab".repeat(32);
const REGISTRY = "ghcr.io/pulsatrixtechnologies";
const IMAGE = `${REGISTRY}/sagax-sandbox:1.0.0@sha256:${DIGEST}`;
const key = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000aa");

function k8sConfig(): K8sSandboxConfig {
  return {
    namespace: "sandboxes",
    storageClass: "encrypted",
    registry: REGISTRY,
    requireDigest: true,
    requireEncryption: true,
    dnsNameservers: ["1.1.1.1", "8.8.8.8"],
    quotaName: "sagax-sandbox-quota",
  };
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SAGAX_SANDBOX_IMAGE: IMAGE,
    SAGAX_SANDBOX_K8S_STORAGE_CLASS: "encrypted",
    SAGAX_SANDBOX_K8S_REGISTRY: REGISTRY,
    SAGAX_SANDBOXD_TLS_INSECURE: "1",
    SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
    SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
    SAGAX_SANDBOX_AUDIT_LOG: "/var/log/sagax/sandbox-audit.jsonl",
    ...extra,
  };
}

describe("sandbox backend selection", () => {
  it("defaults to docker and accepts only the two names", () => {
    expect(sandboxBackendFromEnv({})).toBe("docker");
    expect(sandboxBackendFromEnv({ SANDBOX_BACKEND: "" })).toBe("docker");
    expect(sandboxBackendFromEnv({ SANDBOX_BACKEND: "docker" })).toBe("docker");
    expect(sandboxBackendFromEnv({ SANDBOX_BACKEND: "kubernetes" })).toBe("kubernetes");
    expect(() => sandboxBackendFromEnv({ SANDBOX_BACKEND: "Docker" })).toThrow(/docker or kubernetes/);
    expect(() => sandboxBackendFromEnv({ SANDBOX_BACKEND: "k3s" })).toThrow(/docker or kubernetes/);
  });
});

describe("image admission", () => {
  const policy = { registry: REGISTRY, requireDigest: true };

  it("admits a digest pin under the registry and refuses the rest", () => {
    expect(imageAdmissionProblems(IMAGE, policy)).toEqual([]);
    expect(imageAdmissionProblems(`${REGISTRY}/sagax-sandbox:1.0.0`, { ...policy, requireDigest: false })).toEqual([]);
    expect(imageAdmissionProblems(`${REGISTRY}/sagax-sandbox:latest@sha256:${DIGEST}`, policy)).toContain("tag latest is refused");
    expect(imageAdmissionProblems("sagax-sandbox:local", policy)[0]).toMatch(/registry\/name:tag/);
    expect(imageAdmissionProblems(`${REGISTRY}/sagax-sandbox:1.0.0`, policy)).toContain("digest pin is required (image@sha256:...)");
    expect(imageAdmissionProblems(`ghcr.io/other/sagax-sandbox:1.0.0@sha256:${DIGEST}`, policy).join(" ")).toMatch(/registry is not/);
    expect(imageAdmissionProblems(`ghcr.io/pulsatrixtechnologies-evil/sagax-sandbox:1.0.0@sha256:${DIGEST}`, policy).join(" ")).toMatch(/registry is not/);
  });
});

describe("storage encryption advertisement", () => {
  it("accepts the portable annotation and the common parameters", () => {
    expect(storageClassEncrypts({ parameters: { encrypted: "true" } })).toBe(true);
    expect(storageClassEncrypts({ parameters: { encryption: "True" } })).toBe(true);
    expect(storageClassEncrypts({ parameters: { diskEncryptionSetID: "des-1" } })).toBe(true);
    expect(storageClassEncrypts({ annotations: { "sagax.pulsatrix.com/encrypted": "true" } })).toBe(true);
    expect(storageClassEncrypts({ parameters: {}, annotations: {} })).toBe(false);
  });
});

describe("kubernetes config guards", () => {
  it("requires the attestations, a registry, and refuses a resolver inside the deny list", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const parsed = kubernetesSandboxConfigFromEnv(env(), sandbox);
    expect(parsed.k8s.namespace).toBe("sandboxes");
    expect(parsed.k8s.requireDigest).toBe(true);
    expect(parsed.guards.networkPolicyAttested).toBe(true);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "false" }), sandbox)).toThrow(/SECRETS_ENCRYPTED/);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_K8S_NETWORK_POLICY: "no" }), sandbox)).toThrow(/NETWORK_POLICY/);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_K8S_DNS: "10.1.1.1" }), sandbox)).toThrow(/egress deny/);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_AUDIT_SHIP_URL: "http://collector.example/in" }), sandbox)).toThrow(/https/);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOXD_TLS_INSECURE: "0" }), sandbox)).toThrow(/TLS_CERT/);
  });
});

describe("dedicated node pool", () => {
  it("parses a node selector and refuses a malformed one at start", () => {
    expect(parseNodeSelector(undefined)).toBeUndefined();
    expect(parseNodeSelector("  ")).toBeUndefined();
    expect(parseNodeSelector("example.com/pool=sandboxes")).toEqual({ "example.com/pool": "sandboxes" });
    expect(parseNodeSelector("example.com/pool=sandboxes, kubernetes.io/os=linux")).toEqual({
      "example.com/pool": "sandboxes",
      "kubernetes.io/os": "linux",
    });
    for (const bad of ["pool", "pool=", "=sandboxes", "Example.com/pool=x", "a/b/c=x", "pool=has space", "pool=x,pool=y", `pool=${"x".repeat(64)}`, "pool=x;rm"]) {
      expect(() => parseNodeSelector(bad), bad).toThrow(/NODE_SELECTOR/);
    }
  });

  it("parses tolerations with or without a value and refuses a malformed one at start", () => {
    expect(parseTolerations("")).toBeUndefined();
    expect(parseTolerations("example.com/sandboxes=true:NoSchedule")).toEqual([
      { key: "example.com/sandboxes", operator: "Equal", value: "true", effect: "NoSchedule" },
    ]);
    expect(parseTolerations("example.com/sandboxes:NoExecute,dedicated=sbx:PreferNoSchedule")).toEqual([
      { key: "example.com/sandboxes", operator: "Exists", effect: "NoExecute" },
      { key: "dedicated", operator: "Equal", value: "sbx", effect: "PreferNoSchedule" },
    ]);
    for (const bad of ["example.com/sandboxes=true", "example.com/sandboxes=true:NoSchedul", ":NoSchedule", "=true:NoSchedule", "key=a b:NoSchedule", "key=true:noschedule"]) {
      expect(() => parseTolerations(bad), bad).toThrow(/TOLERATION/);
    }
  });

  it("reads both from the environment and refuses to start on a bad value", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    expect(kubernetesSandboxConfigFromEnv(env(), sandbox).k8s.nodeSelector).toBeUndefined();
    const parsed = kubernetesSandboxConfigFromEnv(env({
      SAGAX_SANDBOX_K8S_NODE_SELECTOR: "example.com/pool=sandboxes",
      SAGAX_SANDBOX_K8S_TOLERATION: "example.com/sandboxes=true:NoSchedule",
    }), sandbox);
    expect(parsed.k8s.nodeSelector).toEqual({ "example.com/pool": "sandboxes" });
    expect(parsed.k8s.tolerations).toEqual([{ key: "example.com/sandboxes", operator: "Equal", value: "true", effect: "NoSchedule" }]);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_K8S_NODE_SELECTOR: "sandboxes" }), sandbox)).toThrow(/NODE_SELECTOR/);
    expect(() => kubernetesSandboxConfigFromEnv(env({ SAGAX_SANDBOX_K8S_TOLERATION: "sandboxes=true" }), sandbox)).toThrow(/TOLERATION/);
  });

  it("places the pod on the pool and keeps it restricted", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const spec = sandboxContainerSpec(sandbox, key);
    const plain = podFromDockerSpec(spec, k8sConfig()).spec as Record<string, unknown>;
    expect(plain.nodeSelector).toBeUndefined();
    expect(plain.tolerations).toBeUndefined();
    const pod = podFromDockerSpec(spec, {
      ...k8sConfig(),
      nodeSelector: { "example.com/pool": "sandboxes" },
      tolerations: [{ key: "example.com/sandboxes", operator: "Equal", value: "true", effect: "NoSchedule" }],
    });
    const placed = pod.spec as Record<string, unknown>;
    expect(placed.nodeSelector).toEqual({ "example.com/pool": "sandboxes" });
    expect(placed.tolerations).toEqual([{ key: "example.com/sandboxes", operator: "Equal", value: "true", effect: "NoSchedule" }]);
    expect(podIsolationProblems(pod, key)).toEqual([]);
  });
});

describe("one node and one user namespace per person", () => {
  const other = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000bb");
  const dedicatedEnv = {
    SAGAX_SANDBOX_K8S_HOST_USERS: "false",
    SAGAX_SANDBOX_K8S_DEDICATED_NODE: "1",
    SAGAX_SANDBOX_K8S_DEDICATED_NODE_SELECTOR: "example.com/isolation=dedicated",
    SAGAX_SANDBOX_K8S_DEDICATED_TOLERATION: "example.com/dedicated=true:NoSchedule",
    SAGAX_SANDBOX_K8S_NODE_SELECTOR: "example.com/pool=sandboxes",
    SAGAX_SANDBOX_K8S_TOLERATION: "example.com/sandboxes=true:NoSchedule",
  };

  it("is off unless asked, and reads the key list", () => {
    expect(dedicatedFromEnv({})).toBeUndefined();
    expect(dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "true" })).toBeUndefined();
    expect(parseDedicatedKeys(undefined)).toBe("*");
    expect(parseDedicatedKeys("*")).toBe("*");
    expect(parseDedicatedKeys("")).toEqual([]);
    expect(parseDedicatedKeys(` ${key}, ${other},${key} `)).toEqual([key, other]);
    expect(() => parseDedicatedKeys("not a key")).toThrow(/DEDICATED_KEYS/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "maybe" })).toThrow(/HOST_USERS/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_DEDICATED_NODE: "1" })).toThrow(/DEDICATED_NODE_SELECTOR/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_DEDICATED_CPUS: "0" })).toThrow(/DEDICATED_CPUS/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB: "1.5" })).toThrow(/DEDICATED_MEMORY_MB/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_SPARE: "only-a-name" })).toThrow(/SPARE must/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_SPARE: "ns/spare", SAGAX_SANDBOX_K8S_SPARE_MAX: "-1" })).toThrow(/SPARE_MAX/);
    expect(dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_SPARE: "ns/spare" })?.spare).toEqual({ namespace: "ns", deployment: "spare", max: 2 });
    expect([0, 1, 2, 3, 4].map((active) => spareReplicas(active, 2))).toEqual([0, 1, 2, 2, 2]);
    expect(spareReplicas(3, 0)).toBe(0);
    const userOnly = dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false" });
    expect(userOnly).toEqual({ keys: "*", userNamespace: true, ownNode: false });
  });

  it("gives a listed person a user namespace, an own node on the dedicated pool and its sizes", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const parsed = kubernetesSandboxConfigFromEnv(env({
      ...dedicatedEnv,
      SAGAX_SANDBOX_K8S_DEDICATED_KEYS: key,
      SAGAX_SANDBOX_K8S_DEDICATED_CPUS: "1.5",
      SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB: "3072",
    }), sandbox).k8s;
    expect(dedicatedFor(parsed, key)).toBeDefined();
    expect(dedicatedFor(parsed, other)).toBeUndefined();

    const pod = podFromDockerSpec(sandboxContainerSpec(sandbox, key), parsed);
    const spec = pod.spec as Record<string, any>;
    expect(spec.hostUsers).toBe(false);
    expect(spec.nodeSelector).toEqual({ "example.com/pool": "sandboxes", "example.com/isolation": "dedicated" });
    expect(spec.tolerations).toEqual([
      { key: "example.com/sandboxes", operator: "Equal", value: "true", effect: "NoSchedule" },
      { key: "example.com/dedicated", operator: "Equal", value: "true", effect: "NoSchedule" },
    ]);
    expect(spec.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution).toEqual([{
      labelSelector: { matchExpressions: [{ key: "com.pulsatrix.sagax.sandbox.user", operator: "Exists" }] },
      topologyKey: "kubernetes.io/hostname",
    }]);
    expect(spec.containers[0].resources).toEqual({
      requests: { cpu: "1500m", memory: "3072Mi", "ephemeral-storage": "512Mi" },
      limits: { cpu: "1500m", memory: "3072Mi", "ephemeral-storage": "512Mi" },
    });
    // Same restricted pod as before: the uid inside stays 1000.
    expect(spec.securityContext.runAsUser).toBe(1000);
    expect(podIsolationProblems(pod, key, parsed)).toEqual([]);

    // Someone not listed keeps the shared spec, unchanged.
    const shared = podFromDockerSpec(sandboxContainerSpec(sandbox, other), parsed).spec as Record<string, any>;
    expect(shared.hostUsers).toBeUndefined();
    expect(shared.affinity).toBeUndefined();
    expect(shared.nodeSelector).toEqual({ "example.com/pool": "sandboxes" });
    expect(shared.tolerations).toHaveLength(1);
    expect(shared.containers[0].resources.limits).toEqual({ cpu: "1000m", memory: "1536Mi", "ephemeral-storage": "512Mi" });
    expect(podIsolationProblems({ spec: shared }, other, parsed)).toEqual([]);
  });

  it("requests less CPU than the limit when DEDICATED_CPU_REQUEST is set, the limit unchanged", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const parsed = kubernetesSandboxConfigFromEnv(env({
      ...dedicatedEnv,
      SAGAX_SANDBOX_K8S_DEDICATED_KEYS: key,
      SAGAX_SANDBOX_K8S_DEDICATED_CPUS: "1.5",
      SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST: "1.3",
      SAGAX_SANDBOX_K8S_DEDICATED_MEMORY_MB: "3072",
    }), sandbox).k8s;
    const pod = podFromDockerSpec(sandboxContainerSpec(sandbox, key), parsed);
    const resources = (pod.spec as Record<string, any>).containers[0].resources;
    expect(resources.requests).toEqual({ cpu: "1300m", memory: "3072Mi", "ephemeral-storage": "512Mi" });
    expect(resources.limits).toEqual({ cpu: "1500m", memory: "3072Mi", "ephemeral-storage": "512Mi" });
    expect(podIsolationProblems(pod, key, parsed)).toEqual([]);
    // Memory stays request = limit, and any other CPU request is refused.
    const off = structuredClone(pod);
    (off.spec as Record<string, any>).containers[0].resources.requests.cpu = "100m";
    expect(podIsolationProblems(off, key, parsed)).toContain("cpu or memory limit missing");
    const mem = structuredClone(pod);
    (mem.spec as Record<string, any>).containers[0].resources.requests.memory = "1024Mi";
    expect(podIsolationProblems(mem, key, parsed)).toContain("cpu or memory limit missing");
    // Someone not listed keeps request = limit.
    const shared = podFromDockerSpec(sandboxContainerSpec(sandbox, other), parsed).spec as Record<string, any>;
    expect(shared.containers[0].resources.requests.cpu).toBe(shared.containers[0].resources.limits.cpu);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST: "1" })).toThrow(/needs SAGAX_SANDBOX_K8S_DEDICATED_CPUS/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_DEDICATED_CPUS: "1.5", SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST: "2" })).toThrow(/no higher than/);
    expect(() => dedicatedFromEnv({ SAGAX_SANDBOX_K8S_HOST_USERS: "false", SAGAX_SANDBOX_K8S_DEDICATED_CPUS: "1.5", SAGAX_SANDBOX_K8S_DEDICATED_CPU_REQUEST: "0" })).toThrow(/positive/);
  });

  it("refuses a listed person's pod that lost an option, and * covers everyone", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const parsed = kubernetesSandboxConfigFromEnv(env({ ...dedicatedEnv, SAGAX_SANDBOX_K8S_DEDICATED_KEYS: "*" }), sandbox).k8s;
    expect(dedicatedFor(parsed, other)).toBeDefined();
    const base = podFromDockerSpec(sandboxContainerSpec(sandbox, key), parsed);
    const weaken = (mutate: (spec: Record<string, any>) => void) => {
      const copy = structuredClone(base);
      mutate(copy.spec as Record<string, any>);
      return podIsolationProblems(copy, key, parsed);
    };
    expect(weaken((spec) => { delete spec.hostUsers; })).toContain("user namespace missing (hostUsers)");
    expect(weaken((spec) => { spec.hostUsers = true; })).toContain("user namespace missing (hostUsers)");
    expect(weaken((spec) => { delete spec.affinity; })).toContain("own node missing (pod anti-affinity)");
    expect(weaken((spec) => { spec.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].topologyKey = "topology.kubernetes.io/zone"; }))
      .toContain("own node missing (pod anti-affinity)");
    expect(weaken((spec) => { spec.affinity.podAntiAffinity.requiredDuringSchedulingIgnoredDuringExecution[0].labelSelector = { matchLabels: { [`com.pulsatrix.sagax.sandbox.user`]: key } }; }))
      .toContain("own node missing (pod anti-affinity)");
    expect(weaken((spec) => { delete spec.nodeSelector["example.com/isolation"]; })).toContain("dedicated pool selector missing");
    // Without the config the old check still passes the same pod.
    expect(podIsolationProblems(base, key)).toEqual([]);
  });

  it("an empty key list moves everyone back to the shared spec", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const parsed = kubernetesSandboxConfigFromEnv(env({ ...dedicatedEnv, SAGAX_SANDBOX_K8S_DEDICATED_KEYS: "" }), sandbox).k8s;
    const spec = podFromDockerSpec(sandboxContainerSpec(sandbox, key), parsed).spec as Record<string, any>;
    expect(spec.hostUsers).toBeUndefined();
    expect(spec.affinity).toBeUndefined();
    expect(spec.nodeSelector).toEqual({ "example.com/pool": "sandboxes" });
  });
});

describe("pod isolation", () => {
  it("builds a restricted pod and catches each weakening", () => {
    const sandbox = sandboxdConfigFromEnv(env());
    const spec = sandboxContainerSpec(sandbox, key);
    const pod = podFromDockerSpec(spec, k8sConfig());
    expect(podIsolationProblems(pod, key)).toEqual([]);
    const text = JSON.stringify(pod);
    expect(text).not.toContain("docker.sock");
    expect(text).toContain('"automountServiceAccountToken":false');
    const weaken = (edit: (body: Record<string, unknown>) => void) => {
      const copy = JSON.parse(JSON.stringify(pod)) as Record<string, unknown>;
      edit(copy);
      expect(podIsolationProblems(copy, key).length).toBeGreaterThan(0);
    };
    weaken((body) => { ((body.spec as { containers: { securityContext: { runAsUser: number } }[] }).containers[0]!.securityContext.runAsUser = 0); });
    weaken((body) => { ((body.spec as { hostNetwork: boolean }).hostNetwork = true); });
    weaken((body) => { ((body.spec as { automountServiceAccountToken: boolean }).automountServiceAccountToken = true); });
    weaken((body) => { ((body.spec as { volumes: Record<string, unknown>[] }).volumes.push({ name: "sock", hostPath: { path: "/var/run/docker.sock" } })); });
  });

  it("sizes the claim from the workspace quota", () => {
    const claim = pvcSpec(k8sConfig(), key, 2 * 1024 * 1024, IMAGE, { "sagax-user": key });
    expect((claim.spec as { resources: { requests: { storage: string } } }).resources.requests.storage).toBe("2Mi");
    expect(quantityBytes(1536 * 1024 * 1024)).toBe("1536Mi");
  });
});

describe("network policy", () => {
  it("denies private ranges and leaves ingress empty", () => {
    const policy = sandboxNetworkPolicy(k8sConfig(), key, "10.213.0.0/28", [...DEFAULT_EGRESS_DENY], { "sagax-user": key });
    const spec = policy.spec as { ingress: unknown[]; egress: { to: { ipBlock: { cidr: string; except: string[] } }[] }[]; policyTypes: string[] };
    expect(spec.policyTypes).toEqual(["Ingress", "Egress"]);
    expect(spec.ingress).toEqual([]);
    expect(spec.egress[0]!.to[0]!.ipBlock.cidr).toBe("0.0.0.0/0");
    expect(spec.egress[0]!.to[0]!.ipBlock.except).toEqual([...DEFAULT_EGRESS_DENY]);
    expect(JSON.stringify(policy)).not.toContain("::");
    const deny = defaultDenyNetworkPolicy("sandboxes", "default");
    expect((deny.spec as { podSelector: object; ingress?: unknown }).podSelector).toEqual({});
    expect((deny.spec as { ingress?: unknown }).ingress).toBeUndefined();
    expect((deny.metadata as { labels: Record<string, string> }).labels["com.pulsatrix.sagax.sandbox"]).toBe("egress");
  });
});

describe("readiness and quantities", () => {
  it("names each missing guard", () => {
    expect(quotaProblems(null)).toContain("ResourceQuota is missing");
    expect(quotaProblems({ pods: "4", "limits.memory": "8Gi", "limits.cpu": "4", "requests.storage": "20Gi" })).toEqual([]);
    expect(quotaProblems({ pods: "0", "limits.cpu": "1" })).toEqual(expect.arrayContaining([
      "ResourceQuota does not cap pods",
      "ResourceQuota does not cap memory",
      "ResourceQuota does not cap storage",
    ]));
    const ready = kubernetesReadinessProblems({
      namespaceExists: true,
      storageClassFound: true,
      storageEncrypts: true,
      requireEncryption: true,
      quotaHard: { pods: "4", "limits.memory": "8Gi", "limits.cpu": "4", "requests.storage": "20Gi" },
      imageProblems: [],
      secretsEncryptedAttested: true,
      networkPolicyAttested: true,
      tlsReady: true,
      auditWritable: true,
    });
    expect(ready).toEqual([]);
    expect(kubernetesReadinessProblems({
      namespaceExists: true,
      storageClassFound: true,
      storageEncrypts: false,
      requireEncryption: true,
      quotaHard: { pods: "4", "limits.memory": "8Gi", "limits.cpu": "4", "requests.storage": "20Gi" },
      imageProblems: [],
      secretsEncryptedAttested: false,
      networkPolicyAttested: false,
      tlsReady: false,
      auditWritable: false,
    }).join(" ")).toMatch(/encryption at rest/);
    expect(parseCpuQuantity("250m")).toBeCloseTo(0.25);
    expect(parseCpuQuantity("1")).toBe(1);
    expect(parseMemoryQuantity("2Mi")).toBe(2 * 1024 * 1024);
    expect(parseExecStatus('{"status":"Success"}')).toBe(0);
    expect(parseExecStatus('{"status":"Failure","details":{"causes":[{"reason":"ExitCode","message":"7"}]}}')).toBe(7);
    expect(parseExecStatus('{"status":"Failure"}')).toBe(1);
  });
});

describe("image scripts and manifests", () => {
  it("builds both architectures and never pushes", () => {
    const build = readFileSync(new URL("../../scripts/build-sandbox-image.sh", import.meta.url), "utf8");
    expect(build).toContain("linux/amd64,linux/arm64");
    expect(build).not.toMatch(/--push\b/);
    expect(build).toContain("SANDBOX_IMAGE_PUSH");
    const scan = readFileSync(new URL("../../scripts/scan-sandbox-image.sh", import.meta.url), "utf8");
    expect(scan).toContain("not scanned");
    const verify = readFileSync(new URL("../../scripts/verify-sandbox-image-signature.sh", import.meta.url), "utf8");
    expect(verify).toContain("did not verify a signature");
    const workflow = readFileSync(new URL("../../.github/workflows/sandbox-image.yml", import.meta.url), "utf8");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).not.toContain("push:");
    expect(workflow).toContain("did not verify a signature");
  });

  it("keeps the provisioner off cluster-admin and off the docker socket", () => {
    const rbac = readFileSync(new URL("../../deploy/k8s/provisioner/rbac.yaml", import.meta.url), "utf8");
    expect(rbac).not.toContain("cluster-admin");
    expect(rbac).toContain("storageclasses");
    expect(rbac).toContain("sagax-sandbox-workload");
    expect(rbac).toMatch(/resources: \["events"\]\r?\n\s+verbs: \["create"\]/);
    expect(rbac).toMatch(/resources: \["resourcequotas"\]\r?\n\s+verbs: \["get"\]/);
    // Only the verbs the backend uses: exec is get and create (the websocket
    // upgrade is a GET), no patch on Pods
    // or NetworkPolicies, no pods/log; the readiness check reads its namespace.
    expect(rbac).toMatch(/resources: \["pods\/exec"\]\r?\n\s+verbs: \["get", "create"\]/);
    expect(rbac).toMatch(/resources: \["pods"\]\r?\n\s+verbs: \["get", "list", "create", "delete"\]/);
    // patch: the denied API address follows a cluster restart.
    expect(rbac).toMatch(/resources: \["networkpolicies"\]\r?\n\s+verbs: \["get", "list", "create", "delete", "patch"\]/);
    expect(rbac).not.toContain("pods/log");
    expect(rbac).toMatch(/resourceNames: \["sandboxes"\]/);
    const deployment = readFileSync(new URL("../../deploy/k8s/provisioner/sandboxd-deployment.yaml", import.meta.url), "utf8");
    expect(deployment).not.toContain("docker.sock");
    expect(deployment).toContain("example.invalid/sagax:must-set");
    expect(deployment).toContain("type: ClusterIP");
    expect(deployment).toContain("SAGAX_SANDBOX_K8S_NODE_SELECTOR");
    expect(deployment).toContain("SAGAX_SANDBOX_K8S_TOLERATION");
    expect(deployment).toMatch(/runAsUser: 1001/);
    const namespace = readFileSync(new URL("../../deploy/k8s/provisioner/namespace.yaml", import.meta.url), "utf8");
    expect(namespace).toContain("restricted");
    const allow = readFileSync(new URL("../../deploy/k8s/provisioner/networkpolicy-provisioner.yaml", import.meta.url), "utf8");
    expect(allow).toContain("app: sagax-sandboxd");
    expect(allow).toContain("6443");
    expect(allow).toContain("k8s-app: kube-dns");
    expect(allow).toMatch(/protocol: UDP\r?\n\s+port: 53/);
  });
});

describe("quantityToBytes (2026-11-02)", () => {
  it("reads the storage quantities a claim carries", () => {
    expect(quantityToBytes("2Gi")).toBe(2 * 1024 ** 3);
    expect(quantityToBytes("2048Mi")).toBe(2 * 1024 ** 3);
    expect(quantityToBytes("20480Mi")).toBe(20 * 1024 ** 3);
    expect(quantityToBytes("21474836480")).toBe(20 * 1024 ** 3);
    expect(quantityToBytes("20G")).toBe(20e9);
    expect(quantityToBytes("lots")).toBeNull();
  });
});

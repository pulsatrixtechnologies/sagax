// The backend switch, the canary rule, and the sandbox-pool manifests
// agree with the cutover and SOC 2 runbooks. Parsing YAML here does not
// apply it.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse, parseAllDocuments } from "yaml";

import { sandboxBackendFor, sandboxCanaryBotIds, sandboxRouteFromEnv } from "./sandbox-route.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const POOL = join(ROOT, "deploy/k8s/sandboxes");

function yamlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...yamlFiles(path));
    else if (name.endsWith(".yaml") || name.endsWith(".yml")) found.push(path);
  }
  return found;
}

function documents(path: string): Record<string, unknown>[] {
  return parseAllDocuments(readFileSync(path, "utf8"))
    .filter((doc) => doc.contents != null)
    .map((doc) => doc.toJS() as Record<string, unknown>);
}

function text(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("sandbox backend switch", () => {
  it("keeps docker until a canary matches, and kubernetes on the provisioner is the real backend", () => {
    const route = sandboxRouteFromEnv({});
    expect(sandboxBackendFor(route, "pr_00000000-0000-4000-8000-000000000001", "bot-b")).toBe("docker");
    expect(sandboxBackendFor(sandboxRouteFromEnv({ SAGAX_SANDBOX_ROUTE: "kubernetes" }), "pr_00000000-0000-4000-8000-000000000001")).toBe("kubernetes");
    const provisioner = readFileSync(join(ROOT, "server/sandboxd.ts"), "utf8");
    expect(provisioner).toContain("startKubernetesProvisioner");
    expect(provisioner).not.toContain("assertSandboxBackendSupported");
    const spec = readFileSync(join(ROOT, "server/sandboxd-k8s/sandboxd-k8s-spec.ts"), "utf8");
    expect(spec).toContain('raw === "kubernetes"');
  });

  it("canaries one person's bots and lets an explicit docker route revert", () => {
    expect(sandboxCanaryBotIds({})).toEqual([]);
    expect(sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: "bot-a, bot-a, bot_b" })).toEqual(["bot-a", "bot_b"]);
    expect(() => sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: "has space" })).toThrow(/invalid id/);
    expect(() => sandboxCanaryBotIds({ SAGAX_SANDBOX_CANARY_BOTS: Array.from({ length: 33 }, (_, i) => `b${i}`).join(",") })).toThrow(/32/);
    const canary = sandboxRouteFromEnv({ SAGAX_SANDBOX_CANARY_BOTS: "bot-a" });
    expect(sandboxBackendFor(canary, "pr_00000000-0000-4000-8000-000000000001", "bot-a")).toBe("kubernetes");
    expect(sandboxBackendFor(canary, "pr_00000000-0000-4000-8000-000000000001", "bot-b")).toBe("docker");
    const forced = sandboxRouteFromEnv({ SAGAX_SANDBOX_ROUTE: "docker", SAGAX_SANDBOX_CANARY_BOTS: "bot-a" });
    expect(sandboxBackendFor(forced, "pr_00000000-0000-4000-8000-000000000001", "bot-a")).toBe("docker");
  });
});

describe("sandbox pool manifests", () => {
  const files = yamlFiles(POOL);

  it("parses every manifest and keeps secrets out of git", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const path of files) {
      const raw = readFileSync(path, "utf8");
      expect(raw, path).not.toMatch(/BEGIN [A-Z ]*PRIVATE KEY/);
      expect(raw, path).not.toMatch(/AccountKey|client-secret|password:/i);
      for (const doc of documents(path)) expect(doc, path).toBeTypeOf("object");
    }
  });

  it("ships the provisioner scaled to zero, probed on /healthz, backend kubernetes", () => {
    const docs = documents(join(POOL, "base/sandboxd.yaml"));
    const deploy = docs.find((doc) => doc.kind === "Deployment") as {
      spec: { replicas: number; template: { spec: { containers: { env: { name: string; value: string }[]; readinessProbe: { httpGet: { path: string } }; livenessProbe: { httpGet: { path: string } } }[] } } };
    };
    expect(deploy.spec.replicas).toBe(0);
    const container = deploy.spec.template.spec.containers[0]!;
    expect(container!.env.find((entry) => entry.name === "SANDBOX_BACKEND")!.value).toBe("kubernetes");
    expect(container!.readinessProbe.httpGet.path).toBe("/healthz");
    expect(container!.livenessProbe.httpGet.path).toBe("/healthz");
    const template = docs.find((doc) => doc.kind === "ConfigMap") as { data: { "pod.yaml": string } };
    expect(template.data["pod.yaml"]).toContain("runAsUser: 1000");
    expect(template.data["pod.yaml"]).toContain("drop: [\"ALL\"]");
    expect(template.data["pod.yaml"]).not.toMatch(/docker\.sock/);
    const role = documents(join(POOL, "base/rbac.yaml")).find((doc) => doc.kind === "Role") as { rules: { resources: string[] }[] };
    expect(role.rules.flatMap((rule) => rule.resources)).not.toContain("secrets");
  });

  it("warms weekdays in Toronto and scales a buffer from pending sandboxes", () => {
    const warm = documents(join(POOL, "base/keda.yaml"))[0] as {
      spec: { maxReplicaCount: number; triggers: { type: string; metadata: Record<string, string> }[] };
    };
    expect(warm.spec.maxReplicaCount).toBe(1);
    expect(warm.spec.triggers[0]!.metadata.timezone).toBe("America/Toronto");
    expect(warm.spec.triggers[0]!.metadata.start).toBe("30 7 * * 1-5");
    const pending = documents(join(POOL, "autoscaling/keda-pending-buffer.yaml")).find((doc) => doc.kind === "ScaledObject") as {
      spec: { triggers: { metadata: { query: string } }[] };
    };
    expect(pending.spec.triggers[0]!.metadata.query).toContain("Pending");
    expect(pending.spec.triggers[0]!.metadata.query).toContain("sagax-user-.+");
    const kustomization = readFileSync(join(POOL, "base/kustomization.yaml"), "utf8");
    expect(kustomization).toContain("keda-pending-buffer.yaml");
    expect(kustomization).not.toContain("keda-queue.yaml");
    expect(readFileSync(join(POOL, "autoscaling/keda-queue.yaml"), "utf8")).toContain("listName: sagax-sandbox-pending");
  });

  it("keeps Azure as an adapter and refuses both autoscalers in one overlay", () => {
    const overlay = parse(readFileSync(join(POOL, "adapters/azure/kustomization.yaml"), "utf8")) as { resources: string[]; patches: { path: string }[] };
    expect(overlay.resources).toContain("../../base");
    const applied = [...overlay.resources, ...overlay.patches.map((patch) => patch.path)];
    expect(applied).not.toContain("karpenter.yaml");
    expect(applied.some((path) => path.includes("cluster-autoscaler"))).toBe(false);
    expect(readFileSync(join(POOL, "adapters/azure/networkpolicy-ingress.yaml"), "utf8")).toContain("192.0.2.10/32");
    const portable = documents(join(POOL, "autoscaling/karpenter-nodepool.yaml"))[0] as {
      spec: { template: { spec: { nodeClassRef: { group: string }; taints: { key: string }[] } }; disruption: { consolidateAfter: string } };
    };
    expect(portable.spec.template.spec.nodeClassRef.group).toBe("karpenter.k8s.sagax.invalid");
    expect(portable.spec.disruption.consolidateAfter).toBe("10m");
    const azure = documents(join(POOL, "adapters/azure/karpenter.yaml"));
    const nodeClass = azure.find((doc) => doc.kind === "AKSNodeClass") as { apiVersion: string };
    const pool = azure.find((doc) => doc.kind === "NodePool") as {
      spec: { limits: { cpu: string }; template: { spec: { nodeClassRef: { group: string; kind: string } } }; disruption: { consolidateAfter: string } };
    };
    expect(nodeClass.apiVersion).toBe("karpenter.azure.com/v1beta1");
    expect(pool.spec.template.spec.nodeClassRef).toMatchObject({ group: "karpenter.azure.com", kind: "AKSNodeClass" });
    expect(pool.spec.limits.cpu).toBe("4");
    expect(pool.spec.disruption.consolidateAfter).toBe("10m");
    expect(portable.spec.template.spec.taints[0]!.key).toBe("sagax.io/pool");
    const azureCa = parse(readFileSync(join(POOL, "adapters/azure/cluster-autoscaler.values.yaml"), "utf8")) as { cloudProvider: string; autoscalingGroups: { maxSize: number }[] };
    const genericCa = parse(readFileSync(join(POOL, "autoscaling/cluster-autoscaler.values.yaml"), "utf8")) as { cloudProvider: string };
    expect(genericCa.cloudProvider).toBe("");
    expect(azureCa.cloudProvider).toBe("azure");
    expect(azureCa.autoscalingGroups[0]!.maxSize).toBe(1);
    const policy = readFileSync(join(POOL, "base/networkpolicy.yaml"), "utf8");
    expect(policy).toContain("169.254.0.0/16");
    expect(policy).toContain("168.63.129.16/32");
  });
});

describe("sandbox pool runbooks", () => {
  const alerts = [
    "SagaxSandboxdDown",
    "SagaxSandboxPendingTooLong",
    "SagaxSandboxPoolSaturated",
    "SagaxSandboxWarmNotReady",
    "SagaxSandboxdRestarting",
    "SagaxSandboxNodeNotReady",
    "SagaxSandboxVolumeNearFull",
    "SagaxSandboxBackupStale",
  ];

  it("points every alert at a section of the incident procedure", () => {
    const rules = readFileSync(join(POOL, "base/prometheus-rules.yaml"), "utf8");
    const incident = text("docs/ops/sandboxes/incident-response.md");
    for (const name of alerts) {
      expect(rules).toContain(`alert: ${name}`);
      expect(rules).toContain(`#${name.toLowerCase()}`);
      expect(incident).toContain(`## ${name}`);
    }
  });

  it("estimates downtime per cutover step and rolls back with SANDBOX_BACKEND=docker", () => {
    const cutover = text("docs/ops/sandboxes/cutover-rollback.md");
    expect(cutover).toContain("SAGAX_SANDBOX_ROUTE=docker");
    expect(cutover).toContain("SAGAX_SANDBOX_CANARY_BOTS");
    expect(cutover).toContain("SAGAX_SANDBOX_CANARY_PEOPLE");
    expect(cutover).toContain("SAGAX_SANDBOXD_TLS_CA");
    expect(cutover).toContain("SAGAX_SANDBOX_K8S_REGISTRY");
    expect(cutover).toContain("SAGAX_SANDBOX_K8S_WAKE_URL");
    expect(cutover).toContain("20–40 seconds");
    expect(cutover).toContain("1–5 minutes");
    expect(cutover).toContain("30–90 seconds");
    for (const step of ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11"]) {
      expect(cutover).toContain(`| ${step} |`);
    }
    expect(text("deploy/docker-compose.sandbox.yml")).toContain("SANDBOX_BACKEND: ${SANDBOX_BACKEND:-docker}");
  });

  it("maps each operating piece to a SOC 2 criterion and a record", () => {
    const map = text("docs/ops/sandboxes/soc2-evidence.md");
    for (const piece of [
      "change-management.md",
      "templates/change-record.md",
      "cutover-rollback.md",
      "keda-pending-buffer.yaml",
      "keda-queue.yaml",
      "base/keda.yaml",
      "base/sandboxd.yaml",
      "base/prometheus-rules.yaml",
      "incident-response.md",
      "base/velero-schedule.yaml",
      "backup-restore.md",
      "templates/drill-record.md",
      "access-review.md",
      "base/rbac.yaml",
      "base/networkpolicy.yaml",
    ]) {
      expect(map, piece).toContain(piece);
    }
    for (const control of ["CC6.1", "CC6.2", "CC6.3", "CC6.6", "CC7.2", "CC7.3", "CC7.4", "CC7.5", "CC8.1", "A1.1", "A1.2", "A1.3", "C1.1"]) {
      expect(map).toContain(control);
    }
    expect(text("docs/ops/sandboxes/change-management.md")).toContain("develop");
    expect(text("docs/ops/sandboxes/backup-restore.md")).toContain("sandboxes-drill");
    expect(text("docs/ops/sandboxes/access-review.md")).toContain("CC6.1");
  });
});

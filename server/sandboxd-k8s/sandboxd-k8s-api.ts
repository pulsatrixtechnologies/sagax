// DockerApi method table for the Kubernetes backend (#1383).
// kubernetesApi keeps the closures (exec abort, spare, host deny) and
// returns this table plus syncSpare and setHostDeny.
import type { Duplex } from "node:stream";

import { reportBackgroundError } from "../background-error.ts";
import type { SandboxAudit } from "../sandbox/sandbox-audit.ts";
import type { K8sClient } from "./sandboxd-k8s-client.ts";
import {
  PAUSED_ANNOTATION,
  SUBNET_ANNOTATION,
  dedicatedFor,
  imageAdmissionProblems,
  k8sLabels,
  podFromDockerSpec,
  podIsolationProblems,
  pvcSpec,
  quantityBytes,
  quantityToBytes,
  sandboxKeyFromContainerName,
  sandboxNetworkPolicy,
  type K8sSandboxConfig,
} from "./sandboxd-k8s-spec.ts";
import type { ContainerStats, ContainerSummary, DockerApi, ExecRequest, ExecResult, TtyExec, TtySize } from "../sandbox/sandboxd-docker.ts";
import {
  SANDBOX_KEY_RE,
  SANDBOX_LABEL,
  SANDBOX_USER_LABEL,
  sandboxNames,
  type SandboxdConfig,
} from "../sandbox/user-sandbox-spec.ts";

type Obj = Record<string, unknown>;

export interface KubeDockerApiParts {
  client: K8sClient;
  ns: string;
  k8s: K8sSandboxConfig;
  audit: SandboxAudit;
  sandbox: SandboxdConfig;
  podAndPvc: (containerName: string) => Promise<{ pod: Obj | null; pvc: Obj | null; key: string }>;
  toSummary: (containerName: string, pod: Obj | null, pvc: Obj | null) => ContainerSummary | null;
  listCollection: (path: string, labels: Record<string, string>) => Promise<Obj[]>;
  create: (path: string, body: Obj) => Promise<void>;
  read: (path: string) => Promise<Obj | null>;
  merge: (path: string, patch: Obj) => Promise<void>;
  remove: (path: string) => Promise<void>;
  waitRunning: (key: string) => Promise<void>;
  emit: (action: string, key: string) => void;
  cancelExecs: (pod: string) => number;
  trackExec: (pod: string) => AbortController;
  releaseExec: (pod: string, controller: AbortController) => void;
  ensureEncrypted: () => Promise<void>;
  ensureDefaultDeny: () => Promise<void>;
  denyNow: () => string[];
  syncSpare: () => Promise<void>;
  pvcPath: (name: string) => string;
  podPath: (name: string) => string;
  netPath: (name: string) => string;
  asObj: (value: unknown) => Obj;
  metaOf: (body: Obj) => { name: string; labels: Record<string, string>; annotations: Record<string, string> };
  withExecEnv: (command: string[], env: readonly string[], stdin: "null" | "keep" | Buffer) => { command: string[]; stdin?: Buffer };
}

/** The DockerApi surface. Closures stay in kubernetesApi. */
export function assembleKubeDockerApi(parts: KubeDockerApiParts): DockerApi {
  const {
    client,
    ns,
    k8s,
    audit,
    sandbox,
    podAndPvc,
    toSummary,
    listCollection,
    create,
    read,
    merge,
    remove,
    waitRunning,
    emit,
    cancelExecs,
    trackExec,
    releaseExec,
    ensureEncrypted,
    ensureDefaultDeny,
    denyNow,
    syncSpare,
    pvcPath,
    podPath,
    netPath,
    asObj,
    metaOf,
    withExecEnv,
  } = parts;
  const api: DockerApi = {
    async ping() {
      const response = await client.request("GET", `/api/v1/namespaces/${ns}`);
      return response.status === 200;
    },
    async imageExists(image: string) {
      const problems = imageAdmissionProblems(image, { registry: k8s.registry, requireDigest: k8s.requireDigest });
      if (problems.length) audit.record({ action: "image.admit", outcome: "denied", detail: { problems: problems.length } });
      return problems.length === 0;
    },
    async inspectContainer(name: string) {
      try {
        const { pod, pvc } = await podAndPvc(name);
        return toSummary(name, pod, pvc);
      } catch {
        return null;
      }
    },
    async listContainers(labels: Record<string, string>) {
      const pods = await listCollection(`/api/v1/namespaces/${ns}/pods`, labels);
      const byName = new Map<string, ContainerSummary>();
      for (const pod of pods) {
        const key = metaOf(pod).labels[SANDBOX_USER_LABEL] ?? "";
        if (!SANDBOX_KEY_RE.test(key)) continue;
        const name = sandboxNames(key).container;
        const summary = toSummary(name, pod, null);
        if (summary) byName.set(name, summary);
      }
      const claims = await listCollection(`/api/v1/namespaces/${ns}/persistentvolumeclaims`, labels);
      for (const claim of claims) {
        const key = metaOf(claim).labels[SANDBOX_USER_LABEL] ?? "";
        if (!SANDBOX_KEY_RE.test(key)) continue;
        const name = sandboxNames(key).container;
        if (byName.has(name)) {
          const paused = metaOf(claim).annotations[PAUSED_ANNOTATION] === "true";
          if (paused && byName.get(name)?.running !== true) byName.set(name, toSummary(name, null, claim)!);
          continue;
        }
        const summary = toSummary(name, null, claim);
        if (summary) byName.set(name, summary);
      }
      return [...byName.values()];
    },
    async createContainer(name: string, spec: Record<string, unknown>) {
      const key = sandboxKeyFromContainerName(name);
      const image = String(spec.Image ?? "");
      const imageProblems = imageAdmissionProblems(image, { registry: k8s.registry, requireDigest: k8s.requireDigest });
      if (imageProblems.length) {
        audit.record({ action: "image.admit", outcome: "denied", key, detail: { problems: imageProblems.length } });
        throw new Error(`image refused: ${imageProblems.join(", ")}`);
      }
      const pod = podFromDockerSpec(spec, k8s);
      const problems = podIsolationProblems(pod, key, k8s);
      if (problems.length) throw new Error(`sandbox spec refused: ${problems.join(", ")}`);
      await create(`/api/v1/namespaces/${ns}/pods`, pod);
      audit.record({ action: "sandbox.pod.create", outcome: "ok", key });
      void syncSpare().catch(reportBackgroundError);
    },
    async startContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      const claim = await read(pvcPath(names.volume));
      if (claim && metaOf(claim).annotations[PAUSED_ANNOTATION] === "true") throw new Error("the sandbox is paused");
      await waitRunning(key);
      emit("sandbox.pod.start", key);
    },
    async stopContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      // Abort in-flight exec websockets before deleting the Pod so Stop does
      // not report success while a sandbox job's process tree is still live.
      cancelExecs(names.container);
      if (await read(pvcPath(names.volume))) {
        await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: null } } });
      }
      await remove(podPath(names.container));
      emit("sandbox.pod.stop", key);
      void syncSpare().catch(reportBackgroundError);
    },
    async pauseContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      cancelExecs(names.container);
      await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: "true" } } });
      await remove(podPath(names.container));
      emit("sandbox.pod.pause", key);
      void syncSpare().catch(reportBackgroundError);
    },
    async unpauseContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      const names = sandboxNames(key);
      await merge(pvcPath(names.volume), { metadata: { annotations: { [PAUSED_ANNOTATION]: null } } });
      await waitRunning(key);
      emit("sandbox.pod.resume", key);
    },
    async containerStats(name: string): Promise<ContainerStats> {
      const limit = dedicatedFor(k8s, sandboxKeyFromContainerName(name))?.memoryBytes ?? sandbox.limits.memoryBytes;
      const metrics = await client.metrics(ns, name).catch(() => null);
      if (!metrics) return { cpus: 0, memoryBytes: 0, memoryLimitBytes: limit };
      return { cpus: metrics.cpu, memoryBytes: metrics.memoryBytes, memoryLimitBytes: limit };
    },
    async removeContainer(name: string) {
      const key = sandboxKeyFromContainerName(name);
      cancelExecs(name);
      await remove(podPath(name));
      emit("sandbox.pod.delete", key);
      void syncSpare().catch(reportBackgroundError);
    },
    async inspectNetwork(name: string) {
      const policy = await read(netPath(name));
      if (!policy) return null;
      const meta = metaOf(policy);
      const subnet = meta.annotations[SUBNET_ANNOTATION];
      return { labels: meta.labels, subnets: subnet ? [subnet] : [] };
    },
    async listNetworks(labels: Record<string, string>) {
      const policies = await listCollection(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, labels);
      return policies.map((policy) => {
        const meta = metaOf(policy);
        const subnet = meta.annotations[SUBNET_ANNOTATION];
        return { name: meta.name, subnets: subnet ? [subnet] : [] };
      });
    },
    async createNetwork(spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const key = labels[SANDBOX_USER_LABEL] ?? "";
      const ipam = asObj(spec.IPAM);
      const configs = (ipam.Config ?? []) as { Subnet?: string }[];
      const subnet = configs[0]?.Subnet ?? "";
      if (!SANDBOX_KEY_RE.test(key) || !subnet) throw new Error("sandbox network is missing its key or subnet");
      await create(`/apis/networking.k8s.io/v1/namespaces/${ns}/networkpolicies`, sandboxNetworkPolicy(k8s, key, subnet, denyNow(), labels));
      audit.record({ action: "sandbox.net.create", outcome: "ok", key });
    },
    async removeNetwork(name: string) {
      await remove(netPath(name));
    },
    async inspectVolume(name: string) {
      const claim = await read(pvcPath(name));
      if (!claim) return null;
      return { labels: metaOf(claim).labels };
    },
    async growVolume(name: string) {
      const claim = await read(pvcPath(name));
      if (!claim) return;
      const asked = quantityToBytes(String(asObj(asObj(asObj(claim.spec).resources).requests).storage ?? ""));
      const wanted = sandbox.limits.workspaceQuotaBytes;
      if (asked === null || asked >= wanted) return;
      let key = "";
      try { key = sandboxKeyFromContainerName(name.replace(/-workspace$/, "")); } catch { /* audit without a key */ }
      try {
        // The StorageClass allows expansion (allowVolumeExpansion); the CSI
        // driver grows the disk and the filesystem, online or at next attach.
        await merge(pvcPath(name), { spec: { resources: { requests: { storage: quantityBytes(wanted) } } } });
        audit.record({ action: "sandbox.pvc.grow", outcome: "ok", ...(key ? { key } : {}), detail: { from: asked, to: wanted } });
      } catch (error) {
        audit.record({ action: "sandbox.pvc.grow", outcome: "denied", ...(key ? { key } : {}), detail: { reason: error instanceof Error ? error.message.slice(0, 120) : "failed" } });
      }
    },
    async createVolume(spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const key = labels[SANDBOX_USER_LABEL] ?? "";
      if (!SANDBOX_KEY_RE.test(key)) throw new Error("sandbox volume is missing its person key");
      await ensureEncrypted();
      const owned = k8sLabels(sandbox, key);
      await create(`/api/v1/namespaces/${ns}/persistentvolumeclaims`, pvcSpec(k8s, key, sandbox.limits.workspaceQuotaBytes, sandbox.image, owned));
      audit.record({ action: "sandbox.pvc.create", outcome: "ok", key });
    },
    async removeVolume(name: string) {
      await remove(pvcPath(name));
    },
    async exec(name: string, request: ExecRequest, maxBytes: number, stdin?: Buffer): Promise<ExecResult> {
      const call = withExecEnv(request.Cmd, request.Env ?? [], stdin ?? "null");
      const controller = trackExec(name);
      let result: Awaited<ReturnType<K8sClient["exec"]>>;
      try {
        result = await client.exec(ns, name, call.command, call.stdin, controller.signal);
      } catch (error) {
        releaseExec(name, controller);
        if ((error as { name?: string }).name === "AbortError") {
          let key = "";
          try { key = sandboxKeyFromContainerName(name); } catch { /* name already checked by the caller */ }
          audit.record({ action: "sandbox.exec", outcome: "denied", ...(key ? { key } : {}), detail: { argv0: request.Cmd[0] ?? "", reason: "stopped" } });
          return { exitCode: 137, stdout: Buffer.alloc(0), stderr: Buffer.from("sagax: the sandbox job was stopped\n"), truncated: false };
        }
        throw error;
      }
      releaseExec(name, controller);
      let stdout = result.stdout;
      let stderr = result.stderr;
      let truncated = false;
      if (stdout.length > maxBytes) { truncated = true; stdout = stdout.subarray(0, maxBytes); }
      if (stderr.length > maxBytes) { truncated = true; stderr = stderr.subarray(0, maxBytes); }
      let key = "";
      try { key = sandboxKeyFromContainerName(name); } catch { /* name already checked by the caller */ }
      audit.record({ action: "sandbox.exec", outcome: "ok", ...(key ? { key } : {}), detail: { argv0: request.Cmd[0] ?? "", exit: result.exitCode ?? -1 } });
      return { exitCode: result.exitCode, stdout, stderr, truncated };
    },
    async execStream(name: string, request: ExecRequest): Promise<Duplex> {
      const call = withExecEnv(request.Cmd, request.Env ?? [], "keep");
      return client.execStream(ns, name, call.command, call.stdin);
    },
    async execTty(name: string, request: ExecRequest, size: TtySize): Promise<TtyExec> {
      if (!client.execTty) throw new Error("this Kubernetes client has no terminal exec");
      // A Kubernetes exec runs as the pod's own user in its own working
      // directory: the sandbox user and /workspace, as for every exec here.
      const tty = await client.execTty(ns, name, request.Cmd, size);
      let key = "";
      try { key = sandboxKeyFromContainerName(name); } catch { /* name already checked by the caller */ }
      audit.record({ action: "sandbox.tty", outcome: "ok", ...(key ? { key } : {}), detail: { argv0: request.Cmd[0] ?? "" } });
      return tty;
    },
    async runOnce(name: string, spec: Record<string, unknown>) {
      const labels = asObj(spec.Labels) as Record<string, string>;
      const host = asObj(spec.HostConfig);
      const capAdd = Array.isArray(host.CapAdd) ? host.CapAdd.map(String) : [];
      const helper = labels[SANDBOX_LABEL] === "egress-helper" && host.NetworkMode === "host" && capAdd.includes("NET_ADMIN");
      if (!helper) {
        audit.record({ action: "egress.helper", outcome: "denied", detail: { name } });
        throw new Error("kubernetes backend refuses one-shot containers");
      }
      await ensureDefaultDeny();
      audit.record({ action: "egress.policy.apply", outcome: "ok", detail: { instance: sandbox.instance } });
      return { exitCode: 0, output: "sagax-egress-ok\n" };
    },
  };
  return api;
}

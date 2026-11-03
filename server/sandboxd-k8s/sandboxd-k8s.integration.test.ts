// Opt-in. Skipped unless SAGAX_SANDBOX_K8S_INTEGRATION=1. scripts/sandbox-k8s-kind.sh
// starts a local kind cluster and deletes it. kind does not prove encryption,
// image signatures, a vulnerability scan, or NetworkPolicy enforcement.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createSandboxAudit } from "../sandbox/sandbox-audit.ts";
import { SandboxService } from "../sandbox/sandboxd-core.ts";
import { kubernetesClientFromEnv } from "./sandboxd-k8s-client.ts";
import { kubernetesApi } from "./sandboxd-k8s.ts";
import { kubernetesSandboxConfigFromEnv } from "./sandboxd-k8s-spec.ts";
import { sandboxKeyForPrincipal, sandboxNames, sandboxdConfigFromEnv } from "../sandbox/user-sandbox-spec.ts";

const enabled = process.env.SAGAX_SANDBOX_K8S_INTEGRATION === "1";

describe.skipIf(!enabled)("kubernetes sandbox against a cluster", () => {
  it("creates one pod and one claim, pauses, and removes them", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-k8s-int-"));
    const env = {
      ...process.env,
      SANDBOX_BACKEND: "kubernetes",
      SAGAX_SANDBOX_IMAGE: process.env.SAGAX_SANDBOX_IMAGE || "ghcr.io/pulsatrixtechnologies/sagax-sandbox:kind",
      SAGAX_SANDBOX_K8S_REGISTRY: process.env.SAGAX_SANDBOX_K8S_REGISTRY || "ghcr.io/pulsatrixtechnologies",
      SAGAX_SANDBOX_K8S_STORAGE_CLASS: process.env.SAGAX_SANDBOX_K8S_STORAGE_CLASS || "local-path",
      SAGAX_SANDBOX_K8S_REQUIRE_SIGNED: process.env.SAGAX_SANDBOX_K8S_REQUIRE_SIGNED || "0",
      SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION: process.env.SAGAX_SANDBOX_K8S_REQUIRE_ENCRYPTION || "false",
      SAGAX_SANDBOX_K8S_SECRETS_ENCRYPTED: "true",
      SAGAX_SANDBOX_K8S_NETWORK_POLICY: "enforced",
      SAGAX_SANDBOXD_TLS_INSECURE: "1",
      SAGAX_SANDBOX_AUDIT_LOG: join(dir, "audit.jsonl"),
      SAGAX_SANDBOX_K8S_USE_KUBECONFIG: "1",
    };
    const sandbox = sandboxdConfigFromEnv(env);
    const { k8s } = kubernetesSandboxConfigFromEnv(env, sandbox);
    const audit = createSandboxAudit({ file: env.SAGAX_SANDBOX_AUDIT_LOG });
    const client = kubernetesClientFromEnv(env);
    const api = kubernetesApi(sandbox, k8s, client, audit);
    const service = new SandboxService(api, sandbox);
    const key = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000k8");
    const names = sandboxNames(key);
    const namespace = k8s.namespace;
    try {
      expect(await service.installEgressPolicy()).toBe("enforced");
      expect((await service.ensure(key)).state).toBe("running");
      expect((await client.request("GET", `/api/v1/namespaces/${namespace}/pods/${names.container}`)).status).toBe(200);
      expect((await client.request("GET", `/api/v1/namespaces/${namespace}/persistentvolumeclaims/${names.volume}`)).status).toBe(200);
      expect((await service.pause(key)).state).toBe("paused");
      expect((await client.request("GET", `/api/v1/namespaces/${namespace}/pods/${names.container}`)).status).toBe(404);
      expect((await service.resume(key)).state).toBe("running");
      expect((await service.remove(key)).state).toBe("missing");
    } finally {
      await service.remove(key).catch(() => {});
    }
  }, 180_000);
});

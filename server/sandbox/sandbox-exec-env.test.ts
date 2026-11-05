// What a command in a person's server environment finds in its own
// environment (2026-10-17, leftovers of #694/#701): `run_command` can read
// /proc/self/environ, and any process of the sandbox user can read
// /proc/<pid>/environ of the others. Filtering command text cannot close
// that, so the rule is that no secret is ever in those environments:
// - run_command's exec carries no variable of its own;
// - the container (Docker) and the pod (Kubernetes) set only HOME, LANG,
//   PATH and SAGAX_ENVIRONMENT, mount no service account token and inject
//   no service links;
// - sagax-desktop turns the values Sagax hands it (VNC passwords, typed
//   text, an address) into unexported shell variables before Xvnc, openbox,
//   tint2 or Chromium start and run on.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SandboxService } from "./sandboxd-core.ts";
import { podFromDockerSpec, type K8sSandboxConfig } from "../sandboxd-k8s/sandboxd-k8s-spec.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { sandboxContainerSpec, sandboxKeyForPrincipal, sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";
import { callUserSandboxTool } from "./user-sandbox-tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const key = sandboxKeyForPrincipal("default", "pr_00000000-0000-4000-8000-0000000000ab");
const ALLOWED = new Set(["HOME", "LANG", "PATH", "SAGAX_ENVIRONMENT"]);
const k8s: K8sSandboxConfig = {
  namespace: "sandboxes",
  storageClass: "encrypted",
  registry: "ghcr.io/example",
  requireDigest: false,
  requireEncryption: true,
  dnsNameservers: ["1.1.1.1"],
  quotaName: "sagax-sandbox-quota",
};

describe("no secret in a sandbox command's environment", () => {
  it("run_command's exec adds no variable to the container's own", async () => {
    const docker = new FakeDocker();
    const service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }));
    await service.installEgressPolicy();
    await callUserSandboxTool("run_command", { command: "cat /proc/self/environ" }, {
      exec: (input) => service.exec(key, input),
      overQuota: async () => false,
    });
    const ran = docker.execs.find((entry) => entry.exec.Cmd.includes("cat /proc/self/environ"));
    expect(ran?.exec.Env).toEqual([]);
    expect(ran?.stdin).toBeUndefined();
  });

  it("the container and the pod set only HOME, LANG, PATH and SAGAX_ENVIRONMENT", () => {
    const spec = sandboxContainerSpec(sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }), key);
    const names = (spec.Env as string[]).map((entry) => entry.slice(0, entry.indexOf("=")));
    expect(names.every((name) => ALLOWED.has(name)), names.join(",")).toBe(true);
    const pod = podFromDockerSpec(spec, k8s) as { spec: { automountServiceAccountToken?: boolean; enableServiceLinks?: boolean; containers: { env?: { name: string }[]; envFrom?: unknown }[] } };
    expect(pod.spec.automountServiceAccountToken).toBe(false);
    expect(pod.spec.enableServiceLinks).toBe(false);
    for (const container of pod.spec.containers) {
      expect(container.envFrom).toBeUndefined();
      expect((container.env ?? []).every((entry) => ALLOWED.has(entry.name)), JSON.stringify(container.env)).toBe(true);
    }
  });

  it.skipIf(process.platform === "win32")("sagax-desktop keeps the values it is handed out of what it starts", () => {
    const script = readFileSync(join(ROOT, "deploy", "sandbox", "sagax-desktop"), "utf8");
    // the prelude up to the unset: what every command of the script runs first
    const end = script.indexOf("\n", script.indexOf("unset SAGAX_VNC_FULL"));
    expect(end).toBeGreaterThan(0);
    const prelude = script.slice(0, end);
    const run = spawnSync("bash", ["-c", `${prelude}\nprintf '%s|%s|%s|%s\\n' "$VNC_FULL" "$VNC_VIEW" "$TYPE_TEXT" "$OPEN_URL"; env`], {
      env: { PATH: process.env.PATH, SAGAX_VNC_FULL: "full-pw-1", SAGAX_VNC_VIEW: "view-pw-2", SAGAX_TEXT: "typed secret 3", SAGAX_URL: "https://example.com/?t=4" },
      encoding: "utf8",
    });
    expect(run.status, run.stderr).toBe(0);
    const [first, ...rest] = run.stdout.split("\n");
    // the script itself still has them...
    expect(first).toBe("full-pw-1|view-pw-2|typed secret 3|https://example.com/?t=4");
    // ...but a process it starts does not
    const childEnv = rest.join("\n");
    for (const value of ["full-pw-1", "view-pw-2", "typed secret 3", "t=4"]) expect(childEnv).not.toContain(value);
  });
});

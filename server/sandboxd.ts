import { createSandboxdHandler, createSandboxdUpgradeHandler } from "./sandbox/sandboxd-http.ts";
export { createSandboxdHandler, createSandboxdUpgradeHandler } from "./sandbox/sandboxd-http.ts";
// sagax-sandboxd: the sandbox provisioner. A separate, minimal service and
// the ONLY component that holds the Docker socket. Its API is narrow: ensure,
// stop, pause, resume, delete, exec, stats and status for sandboxes addressed by an opaque PERSON
// key (never a bot), over signed requests only the Sagax server can make
// (server/sandbox/sandboxd-auth.ts). It cannot build an arbitrary container: every
// create body comes from sandboxContainerSpec() and must pass
// assertSandboxIsolation().
//
// The live view of a person's desktop is one more signed call: an HTTP
// upgrade on /v1/sandboxes/<key>/desktop that becomes a byte stream to the
// VNC port inside that sandbox (createSandboxdUpgradeHandler).
//
//   node dist-server/sandboxd.js                    serve (compose service)
//   node dist-server/sandboxd.js --uninstall-egress remove the host egress rules
//
// SANDBOX_BACKEND=kubernetes (server/sandboxd-k8s/sandboxd-k8s.ts) serves the same API
// against the Kubernetes API and does not open the Docker socket. Unset, or
// docker, keeps the path below.
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { ensureSandboxdKey, sandboxdKeySource, SandboxdVerifier } from "./sandbox/sandboxd-auth.ts";
import { SandboxService } from "./sandbox/sandboxd-core.ts";
import { dockerApi } from "./sandbox/sandboxd-docker.ts";
import { sandboxBackendFromEnv } from "./sandboxd-k8s/sandboxd-k8s-spec.ts";
import { egressHelperSpec, egressUninstallScript, sandboxdConfigFromEnv } from "./sandbox/user-sandbox-spec.ts";
import { reportBackgroundError } from "./background-error.ts";

async function main(): Promise<void> {
  if (sandboxBackendFromEnv() === "kubernetes") {
    const { startKubernetesProvisioner } = await import("./sandboxd-k8s/sandboxd-k8s.ts");
    await startKubernetesProvisioner();
    return;
  }
  const config = sandboxdConfigFromEnv();
  const docker = dockerApi(config.dockerSocket);
  if (process.argv.includes("--uninstall-egress")) {
    const result = await docker.runOnce(`sagax-sandbox-egress-${config.instance}`, egressHelperSpec(config, egressUninstallScript(config)), 60_000);
    process.stdout.write(result.output);
    process.exit(result.exitCode === 0 ? 0 : 1);
  }
  if (!(await docker.ping())) throw new Error(`sandboxd: no Docker daemon at ${config.dockerSocket}`);
  ensureSandboxdKey(config.keyFile);
  const service = new SandboxService(docker, config);
  const egress = await service.installEgressPolicy();
  console.log(`sandboxd: instance ${config.instance}, egress policy ${egress}, at most ${config.maxRunning} running, idle stop ${config.idleStopMs / 60_000} min`);
  // Follows the key file, so a rotation needs no restart (sandboxd-auth.ts).
  const verifier = new SandboxdVerifier(sandboxdKeySource(config.keyFile));
  const server = createServer(createSandboxdHandler(service, verifier));
  server.on("upgrade", createSandboxdUpgradeHandler(service, verifier));
  server.requestTimeout = 16 * 60_000;
  server.listen(config.listenPort, config.listenHost);
  const sweep = setInterval(() => {
    void service.sweepIdle().then((stopped) => {
      if (stopped.length) console.log(`sandboxd: stopped ${stopped.length} idle environment(s)`);
    }, (error: unknown) => console.error(`sandboxd: idle sweep failed: ${error instanceof Error ? error.message : String(error)}`)).catch(reportBackgroundError);
    void service.hibernateIdle().then((hibernated) => {
      if (hibernated.length) console.log(`sandboxd: hibernated ${hibernated.length} unused environment(s)`);
    }, (error: unknown) => console.error(`sandboxd: hibernation sweep failed: ${error instanceof Error ? error.message : String(error)}`)).catch(reportBackgroundError);
  }, 60_000);
  sweep.unref();
  const shutdown = () => server.close(() => process.exit(0));
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

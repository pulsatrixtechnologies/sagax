// Local Docker smoke test for the per-person server environment
// (docs/user-sandbox.md). Starts the real provisioner (server/sandboxd.ts)
// against this machine's Docker, creates ONE temporary sandbox for a fake
// person, checks isolation from inside it, then deletes everything it made:
// the sandbox, its network and volume, the egress rules and the key file.
//
//   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:smoke-userenv .
//   node --experimental-strip-types scripts/smoke-user-sandbox.ts [--image <tag>]
//
// It only ever touches objects labelled with its own random instance.
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SandboxService } from "../server/sandbox/sandboxd-core.ts";
import { dockerApi } from "../server/sandbox/sandboxd-docker.ts";
import { readSandboxdKey } from "../server/sandbox/sandboxd-auth.ts";
import { sandboxdClient } from "../server/sandbox/user-sandbox-client.ts";
import { UserSandboxManager } from "../server/sandbox/user-sandbox-manager.ts";
import { callUserSandboxTool } from "../server/sandbox/user-sandbox-tools.ts";
import { SANDBOX_INSTANCE_LABEL, egressChain, sandboxNames, sandboxdConfigFromEnv } from "../server/sandbox/user-sandbox-spec.ts";

const argImage = process.argv.indexOf("--image");
const image = argImage > 0 ? process.argv[argImage + 1]! : "sagax-sandbox:smoke-userenv";
const instance = `smoke-${randomBytes(3).toString("hex")}`;
const pool = "10.213.240.0/20";
const socket = (() => {
  try {
    const host = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
    return host.startsWith("unix://") ? host.slice("unix://".length) : "/var/run/docker.sock";
  } catch { return "/var/run/docker.sock"; }
})();
const scratch = mkdtempSync(join(tmpdir(), "sagax-sandbox-smoke-"));
const keyFile = join(scratch, "key");
const RESERVED = new Set([18790, 5199, 8799]);

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? `  (${detail})` : ""}`);
  if (!ok) failures++;
};

async function freePort(): Promise<number> {
  for (;;) {
    const port = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const found = (probe.address() as { port: number }).port;
        probe.close(() => resolve(found));
      });
    });
    if (!RESERVED.has(port)) return port;
  }
}

const env = {
  ...process.env,
  SAGAX_SANDBOX_IMAGE: image,
  SAGAX_SANDBOX_INSTANCE: instance,
  SAGAX_SANDBOX_SUBNET_POOL: pool,
  SAGAX_SANDBOXD_KEY_FILE: keyFile,
  SAGAX_SANDBOXD_DOCKER_SOCKET: socket,
  SAGAX_SANDBOX_MEMORY_MB: "512",
  SAGAX_SANDBOX_IDLE_MINUTES: "15",
};

async function main(): Promise<void> {
  const port = await freePort();
  const provisioner = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/sandboxd.ts"], {
    env: { ...env, SAGAX_SANDBOXD_LISTEN: `127.0.0.1:${port}` },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const config = sandboxdConfigFromEnv(env);
  const docker = dockerApi(socket);
  try {
    let client = null as ReturnType<typeof sandboxdClient> | null;
    for (let attempt = 0; attempt < 120 && !client; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      try {
        const candidate = sandboxdClient(`http://127.0.0.1:${port}`, () => readSandboxdKey(keyFile));
        await candidate.info();
        client = candidate;
      } catch { /* not up yet */ }
    }
    if (!client) throw new Error("the provisioner did not start");
    const info = await client.info();
    check("egress policy enforced on this Docker host", info.egress === "enforced", info.egress);

    const manager = new UserSandboxManager({ client, instance, stateFile: join(scratch, "deletions.json"), graceMs: 0 });
    const person = "pr_5a0d0e00-0000-4000-8000-00000000c0de";
    const key = manager.keyFor(person);
    const names = sandboxNames(key);
    check("lazy: nothing exists before the first tool call", (await manager.status(person)).state === "missing");

    const run = async (command: string, timeoutSec = 30) => manager.exec(person, { argv: ["bash", "-lc", command], timeoutSec });
    const id = await run("id -u; id -g");
    check("runs as uid/gid 1000 (non-root)", id.stdout.trim() === "1000\n1000", id.stdout.trim().replace(/\n/g, "/"));
    check("container created on first call", (await manager.status(person)).state === "running");

    const caps = await run("grep -E '^(CapEff|NoNewPrivs|Seccomp):' /proc/self/status");
    check("no effective capabilities", /CapEff:\s+0+\b/.test(caps.stdout), caps.stdout.match(/CapEff:\s+\w+/)?.[0]);
    check("no_new_privs set", /NoNewPrivs:\s+1/.test(caps.stdout));
    check("seccomp filter active (default profile)", /Seccomp:\s+2/.test(caps.stdout));

    const rootfs = await run("touch /etc/sagax-smoke 2>&1; echo rc=$?");
    check("root filesystem is read-only", /rc=1/.test(rootfs.stdout) && /Read-only/.test(rootfs.stdout));
    const workspace = await run("echo hello > /workspace/a.txt && cat /workspace/a.txt");
    check("/workspace is writable and persistent", workspace.stdout.trim() === "hello");

    const socketCheck = await run("ls -la /var/run/docker.sock /run/docker.sock 2>&1 | head -2; mount | grep -c docker.sock || true");
    check("no Docker socket inside", /No such file/.test(socketCheck.stdout));

    const metadata = await run("curl -s -m 4 -o /dev/null -w '%{http_code}' http://169.254.169.254/ ; echo \" rc=$?\"", 15);
    check("cloud metadata 169.254.169.254 unreachable", !/^(200|30\d|40\d)/.test(metadata.stdout.trim()), metadata.stdout.trim());
    const gateway = await run("gw=$(awk '$2==\"00000000\"{print $3}' /proc/net/route | head -1); ip=$(printf '%d.%d.%d.%d' 0x${gw:6:2} 0x${gw:4:2} 0x${gw:2:2} 0x${gw:0:2}); echo gw=$ip; curl -s -m 4 -o /dev/null -w '%{http_code}' http://$ip:80/; echo \" rc=$?\"", 15);
    check("host gateway (Docker bridge) dropped, not merely closed", /rc=28/.test(gateway.stdout), gateway.stdout.trim().replace(/\n/g, " "));
    const lan = await run("curl -s -m 4 -o /dev/null -w '%{http_code}' http://192.168.65.1/; echo \" rc=$?\"", 15);
    check("private range (Docker Desktop host 192.168.65.1) dropped", /rc=28/.test(lan.stdout), lan.stdout.trim());
    const internet = await run("curl -s -m 15 -o /dev/null -w '%{http_code}' https://example.com/; echo \" rc=$?\"", 30);
    check("public internet reachable", /^(200|30\d)/.test(internet.stdout.trim()), internet.stdout.trim());

    const pids = await run("cat /sys/fs/cgroup/pids.max /sys/fs/cgroup/memory.max 2>/dev/null");
    check("pids and memory limits in the cgroup", pids.stdout.includes(String(config.limits.pidsLimit)) && pids.stdout.includes(String(512 * 1024 * 1024)), pids.stdout.trim().replace(/\n/g, " "));
    const inspected = JSON.parse(execFileSync("docker", ["inspect", names.container], { encoding: "utf8" }))[0];
    check("docker inspect: read-only, unprivileged, no binds, own network",
      inspected.HostConfig.ReadonlyRootfs === true && inspected.HostConfig.Privileged === false && (inspected.HostConfig.Binds ?? []).length === 0
      && Object.keys(inspected.NetworkSettings.Networks).join() === names.network);

    const tools = { exec: (input: Parameters<typeof manager.exec>[1]) => manager.exec(person, input), overQuota: () => manager.workspaceOverQuota(person) };
    const wrote = await callUserSandboxTool("write_file", { path: "notes/plan.txt", content: "line $(whoami)\n" }, tools);
    const read = await callUserSandboxTool("read_file", { path: "notes/plan.txt" }, tools);
    check("write_file/read_file round trip, content not shell-expanded", !wrote.isError && (read.content[0] as { text: string }).text === "line $(whoami)\n");
    const browse = await callUserSandboxTool("browse", { url: "https://example.com/" }, tools);
    check("browse renders a public page in the sandbox", !browse.isError && /Example Domain/.test((browse.content[0] as { text: string }).text));

    // Reuse: a second "bot" of the same person lands in the same container.
    const before = execFileSync("docker", ["inspect", "-f", "{{.Id}}", names.container], { encoding: "utf8" }).trim();
    await run("true");
    const after = execFileSync("docker", ["inspect", "-f", "{{.Id}}", names.container], { encoding: "utf8" }).trim();
    check("reused by every later call (same container)", before === after);

    await client.stop(key);
    check("stop", (await manager.status(person)).state === "stopped");
    const again = await run("cat /workspace/a.txt");
    check("starts on demand, /workspace kept", again.stdout.trim() === "hello");

    // Person signed out with no grace: deleted at the next sweep.
    await manager.personOut(person);
    await manager.sweepDeletions();
    const leftovers = execFileSync("docker", ["ps", "-a", "-q", "--filter", `label=${SANDBOX_INSTANCE_LABEL}=${instance}`], { encoding: "utf8" }).trim();
    const volumes = execFileSync("docker", ["volume", "ls", "-q", "--filter", `name=${names.volume}`], { encoding: "utf8" }).trim();
    const networks = execFileSync("docker", ["network", "ls", "-q", "--filter", `name=${names.network}`], { encoding: "utf8" }).trim();
    check("deleted after sign-out: no container, volume or network left", !leftovers && !volumes && !networks);
  } finally {
    provisioner.kill("SIGTERM");
    // Belt and braces: remove anything still labelled with this instance.
    const service = new SandboxService(docker, config);
    for (const row of await docker.listContainers({ [SANDBOX_INSTANCE_LABEL]: instance }).catch(() => [])) {
      const key = row.labels["com.pulsatrix.sagax.sandbox.user"];
      if (key) await service.remove(key).catch(() => {});
    }
    const uninstall = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", "server/sandboxd.ts", "--uninstall-egress"], { env, stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    uninstall.stdout.on("data", (chunk: Buffer) => { out += chunk.toString(); });
    await new Promise((resolve) => uninstall.on("exit", resolve));
    check(`egress rules removed (chain ${egressChain(instance)})`, out.includes("sagax-egress-removed"));
    rmSync(scratch, { recursive: true, force: true });
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});

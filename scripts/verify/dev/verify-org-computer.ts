// Real-Electron check of the Computer tab, Works on and the composer's place
// menu on an organization server, with a real server environment desktop:
// the real provisioner (server/sandboxd.ts) on this machine's Docker with a
// random instance label, a local organization server (fake Perspicax) that
// serves the built UI, and Electron signed in through the web sign-in. It
// takes screenshots and removes every sandbox object it made.
//
//   pnpm exec vite build
//   docker build -f deploy/sandbox/Dockerfile -t sagax-sandbox:local .
//   node --experimental-strip-types scripts/verify/dev/verify-org-computer.ts [--image <tag>] [--shots <dir>]
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SandboxService } from "../../../server/sandbox/sandboxd-core.ts";
import { dockerApi } from "../../../server/sandbox/sandboxd-docker.ts";
import { startFakeOidcProvider } from "../../../server/testing/fake-oidc-provider.ts";
import { freePortBlock } from "../../../server/testing/ports.ts";
import { SANDBOX_INSTANCE_LABEL, sandboxdConfigFromEnv } from "../../../server/sandbox/user-sandbox-spec.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const electron = createRequire(import.meta.url)("electron") as unknown as string;
const RESERVED = [18790, 5199, 8799];
const option = (name: string) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : undefined; };
const image = option("--image") ?? "sagax-sandbox:local";
const shots = option("--shots") ?? mkdtempSync(join(tmpdir(), "sagax-verify-org-computer-shots-"));
mkdirSync(shots, { recursive: true });
const instance = `verify-${randomBytes(3).toString("hex")}`;
const socket = (() => {
  try {
    const host = execFileSync("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
    return host.startsWith("unix://") ? host.slice("unix://".length) : "/var/run/docker.sock";
  } catch { return "/var/run/docker.sock"; }
})();
const scratch = mkdtempSync(join(tmpdir(), "sagax-verify-org-computer-"));
const keyFile = join(scratch, "sandboxd-key");
const sandboxEnv = {
  ...process.env,
  SAGAX_SANDBOX_IMAGE: image,
  SAGAX_SANDBOX_INSTANCE: instance,
  SAGAX_SANDBOX_SUBNET_POOL: "10.213.240.0/20",
  SAGAX_SANDBOXD_KEY_FILE: keyFile,
  SAGAX_SANDBOXD_DOCKER_SOCKET: socket,
};

const [sandboxdPort, port] = await Promise.all([freePortBlock([0]), freePortBlock([0, 1])]);
if ([sandboxdPort, port, port + 1].some((value) => RESERVED.includes(value))) throw new Error("reserved port, run again");
const children: ChildProcess[] = [];
let code = 1;
const idp = await startFakeOidcProvider({ user: { sub: "01J9VERIFYORGCOMPUTER00000", email: "ada@example.test", name: "Ada", preferred_username: "ada", role: "admin" } });
try {
  const sandboxd = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "server", "sandboxd.ts")], {
    cwd: ROOT, env: { ...sandboxEnv, SAGAX_SANDBOXD_LISTEN: `127.0.0.1:${sandboxdPort}` }, stdio: ["ignore", "inherit", "inherit"],
  });
  children.push(sandboxd);
  const origin = `http://127.0.0.1:${port}`;
  const home = mkdtempSync(join(tmpdir(), "sagax-verify-org-computer-home-"));
  mkdirSync(join(home, ".sagax"), { recursive: true });
  writeFileSync(join(home, ".sagax", "config.json"), "{}");
  let serverLog = "";
  const server = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? "", HOME: home, USERPROFILE: home, SAGAX_PORT: String(port), SAGAX_WEBHOOK_PORT: String(port + 1),
      SAGAX_STATIC_DIR: join(ROOT, "dist"), SAGAX_IDENTITY: "perspicax", SAGAX_PERSPICAX_ISSUER: idp.issuer, SAGAX_PUBLIC_URL: origin,
      SAGAX_SANDBOXD_URL: `http://127.0.0.1:${sandboxdPort}`, SAGAX_SANDBOXD_KEY_FILE: keyFile, SAGAX_SANDBOX_INSTANCE: instance,
      SAGAX_LOCAL_VM_TEST_NAMESPACE: instance,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(server);
  server.stdout!.on("data", (chunk) => (serverLog += chunk));
  server.stderr!.on("data", (chunk) => (serverLog += chunk));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`${origin}/api/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > deadline) throw new Error(`server never came up:\n${serverLog}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  console.log(`[verify] organization server ${origin}, sandboxd ${instance}, image ${image}, shots ${shots}`);
  const userData = mkdtempSync(join(tmpdir(), "sagax-verify-org-computer-ud-"));
  code = await new Promise<number>((resolve) => {
    const child = spawn(electron, [join(ROOT, "scripts", "verify", "dev", "verify-org-computer.electron.mjs"), `--user-data-dir=${userData}`], {
      env: { ...process.env, VERIFY_ORIGIN: origin, VERIFY_SHOTS: shots }, stdio: ["ignore", "inherit", "inherit"],
    });
    children.push(child);
    child.on("exit", (status) => resolve(status ?? 1));
  });
  if (code !== 0) console.log(serverLog.split("\n").slice(-40).join("\n"));
} finally {
  for (const child of children) child.kill("SIGTERM");
  await idp.close();
  const docker = dockerApi(socket);
  const service = new SandboxService(docker, sandboxdConfigFromEnv(sandboxEnv));
  for (const row of await docker.listContainers({ [SANDBOX_INSTANCE_LABEL]: instance }).catch(() => [])) {
    const key = row.labels["com.pulsatrix.sagax.sandbox.user"];
    if (key) await service.remove(key).catch(() => {});
  }
  const uninstall = spawn(process.execPath, ["--experimental-strip-types", "--no-warnings", join(ROOT, "server", "sandboxd.ts"), "--uninstall-egress"], { cwd: ROOT, env: sandboxEnv, stdio: "ignore" });
  await new Promise((resolve) => uninstall.on("exit", resolve));
  const left = execFileSync("docker", ["ps", "-a", "-q", "--filter", `label=${SANDBOX_INSTANCE_LABEL}=${instance}`], { encoding: "utf8" }).trim();
  console.log(left ? `[verify] FAIL: containers left: ${left}` : "[verify] no sandbox container left");
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(code);

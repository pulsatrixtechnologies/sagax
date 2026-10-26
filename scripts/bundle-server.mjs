// Bundle each harness-server entry point into a self-contained ESM file.
//
// Why this exists: the packaged app ships ZERO node_modules (see the files:
// exclusion in electron-builder.yml), so anything the server imports by bare
// specifier has to be inlined — `tsc` only transpiles, it leaves
// `import { z } from "zod"` verbatim and the packaged server dies at startup
// with ERR_MODULE_NOT_FOUND. That shipped once, in 0.1.24.
//
// Bundling every entry point rather than only index.ts is deliberate: the
// proxies are spawned as their own processes and today import nothing from
// node_modules, but nothing stops the next one from doing so, and the failure
// is invisible until a packaged build is actually launched.
//
// Entry points must keep their exact relative paths under dist-server — the
// server locates each proxy by path (server/index.ts:108,
// container-computer.ts:773, drivers/acp/core.ts:43), preferring the .ts in
// dev and falling back to the sibling .js in the packaged tree. outbase keeps
// drivers/ nested; import.meta.url still resolves to the same location, so
// that lookup is unaffected.
import { build } from "esbuild";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { markModuleScope } from "./mark-module-scope.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "server");

// yaml's Node export is CommonJS and contains dynamic requires that cannot run
// after it is inlined into our ESM-only packaged server. Its browser export is
// the same pure-JS parser without those Node shims, so resolve only this package
// to that entry while leaving every other dependency on the Node condition.
const yamlEsmPlugin = {
  name: "yaml-esm",
  setup(build) {
    build.onResolve({ filter: /^yaml$/ }, () => ({
      path: join(root, "node_modules", "yaml", "browser", "index.js"),
    }));
  },
};

// Some CommonJS dependencies (nodemailer, for the server's sign-in mail)
// require() Node built-ins at load time. esbuild's ESM output has no
// `require`, so its shim throws "Dynamic require of \"events\" is not
// supported" and the server dies at startup. Give the bundle a real one.
const requireBanner = {
  js: 'import { createRequire as __ombCreateRequire } from "node:module"; const require = __ombCreateRequire(import.meta.url);',
};

// Every file run as its own process. Keep in sync with the spawn sites above.
const ENTRY_POINTS = [
  "index.ts",
  // the packaged desktop's early port (desktop-entry.mjs imports it first)
  "early-listener.ts",
  "message-search.worker.ts",
  // WebP decode/scale off the main thread (server/webp-scale-worker.ts)
  "webp-scale.worker.ts",
  // the `openmausbot` command (serve/pair/sessions/status) for the npm
  // package, the container image and checkouts; pair-cli.ts stays as an alias
  "openmausbot.ts",
  "pair-cli.ts",
  "workspace-backup.worker.ts",
  // the container image's entry point (Dockerfile, deploy/podman): it spawns
  // index.js beside it and starts it again on RESTART_EXIT_CODE
  "server-launcher.ts",
  // The packaged smoke probe imports this manifest directly. Importing the
  // shared avatar contract widens TypeScript's inferred emit root to the repo,
  // so tsc may place its copy under dist-server/server/. Bundle an explicit
  // root sibling to keep the packaged runtime contract stable. The Linux
  // package smoke probe also imports local-computer.js directly.
  "proxy-paths.ts",
  "local-computer.ts",
  "local-computer-proxy.ts",
  // the hook helper Claude Code runs at PostToolUse/PreCompact/SessionStart/Stop
  "hooks/omb-hook.ts",
  "container-mcp.ts",
  "vps-container-mcp.ts",
  "permission-proxy.ts",
  "perspicax-mcp-bridge.ts",
  "mcp-gate.ts",
  "mcp-remote-proxy.ts",
  "harness-mcp-proxy.ts",
  "user-sandbox-proxy.ts",
  // the sandbox provisioner service (deploy/docker-compose.sandbox.yml)
  "sandboxd.ts",
  // the runner of a cloud agent run, entry point of the sagax-run image
  // (deploy/run/Dockerfile); at the root so the drivers' helpers resolve
  "sagax-runner.ts",
  "drivers/agents-proxy.ts",
  "drivers/dweb-proxy.ts",
  "drivers/phone-proxy.ts",
  "drivers/imessage-proxy.ts",
];

await build({
  entryPoints: ENTRY_POINTS.map((entry) => join(server, entry)),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outbase: server,
  outdir: join(root, "dist-server"),
  // Written after tsc, replacing its output for these entry points.
  allowOverwrite: true,
  logLevel: "info",
  plugins: [yamlEsmPlugin],
  banner: requireBanner,
});

// External MCP clients launch this as an independent stdio process. Keep its
// source under scripts for a pleasant checkout command (`pnpm mcp`), but ship
// the bundled output beside the packaged harness so release users do not need
// the repository, TypeScript, pnpm, or node_modules.
await build({
  entryPoints: [join(root, "scripts", "mcp-server.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: join(root, "dist-server", "mcp-server.js"),
  allowOverwrite: true,
  logLevel: "info",
});

// `openmausbot serve --tunnel` (server/tunnel.ts) spawns the connector guardian
// as its own process, so it has to exist as a file beside the server, not only
// as code inlined into the bundle that imports its neighbours. Bundled under
// its own name: the same code the desktop app runs from
// electron/managed-companion-guardian-main.mjs, so a fix lands in both.
await build({
  entryPoints: [join(root, "electron", "managed-companion-guardian-main.mjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: join(root, "dist-server", "tunnel-guardian.js"),
  allowOverwrite: true,
  logLevel: "info",
});

// `serve --tunnel` downloads cloudflared on first use by running the same
// pinned-digest script the release build uses, as its own process (it runs
// itself when executed directly, so it must never be inlined into another
// entry).
await build({
  entryPoints: [join(root, "scripts", "prepare-cloudflared.mjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: join(root, "dist-server", "prepare-cloudflared.js"),
  allowOverwrite: true,
  logLevel: "info",
});

// This distribution does not include the source-available enterprise layer.
// server/enterprise.ts boots the open-source edition when the directory is
// absent. Do not bundle that directory into an Apache package.
if (existsSync(join(root, "enterprise", "server", "index.ts")) || existsSync(join(root, "enterprise", "server", "index.js"))) {
  console.error("enterprise/ is not part of this distribution and must not be bundled");
  process.exit(1);
}

// The packaged desktop forks this bootstrap rather than index.js
// (electron/server-child-launch.mjs): it turns on Node's compile cache for the
// server process, then imports index.js beside it. Copied, not bundled:
// esbuild would inline index.js into it.
copyFileSync(join(root, "scripts", "desktop-server-entry.mjs"), join(root, "dist-server", "desktop-entry.mjs"));

// The model catalog snapshot (server/model-catalog/catalog.ts) is read from
// disk, not inlined: 1.5 MB of JSON has no place in index.js. The bundle looks
// for it under model-catalog/ beside itself. Its MIT notice is inside the file.
const catalogSnapshot = join(root, "dist-server", "model-catalog", "models-dev.snapshot.json");
mkdirSync(dirname(catalogSnapshot), { recursive: true });
copyFileSync(join(server, "model-catalog", "models-dev.snapshot.json"), catalogSnapshot);

// The sagax_help knowledge base (server/self-knowledge.ts), read from disk
// on the first question, like the catalog snapshot: never inlined.
// `pnpm build:server` regenerates it first (scripts/self-knowledge/generate.ts).
const knowledge = join(root, "dist-server", "self-knowledge", "knowledge.generated.json");
mkdirSync(dirname(knowledge), { recursive: true });
copyFileSync(join(server, "self-knowledge", "knowledge.generated.json"), knowledge);

// Pi loads this through its own jiti and supplies TypeBox. Inline our local
// policy module so the extension also works without the source checkout;
// keep the Pi-owned dependency external and retain the .ts loading contract.
const piMcpExtSrc = join(server, "drivers", "pi-mcp-extension.ts");
const piMcpExtDest = join(root, "dist-server", "drivers", "pi-mcp-extension.ts");
mkdirSync(dirname(piMcpExtDest), { recursive: true });
await build({ entryPoints: [piMcpExtSrc], outfile: piMcpExtDest, bundle: true,
  platform: "node", target: "node24", format: "esm", external: ["typebox"], });

// Port of OpenMausBot #2800: the packaged server must run as ES modules even
// when a package.json above the install folder says "commonjs".
markModuleScope(join(root, "dist-server"));

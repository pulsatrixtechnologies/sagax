// Assemble the published npm package, @pulsatrixtechnologies/sagax: the self-contained
// server bundle, the built UI, the bundled skills and the CLI, with a
// package.json of its own. `npm install -g @pulsatrixtechnologies/sagax` (or
// `npx @pulsatrixtechnologies/sagax`) then needs Node 24+ and nothing else, and installs
// one command, `sagax`. The unscoped names are not this project's: never
// publish or document them. The version is the Sagax release (forkVersion),
// the same X.Y.Z as the pulsa-vX.Y.Z tag that publishes it.
//
//   pnpm build:server && pnpm exec vite build && node scripts/build-npm-package.mjs
//   cd release/npm && npm pack --dry-run   # what would ship; CI publishes
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllowlist, scanPackage } from "./npm-package-terms.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release", "npm");
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
// server/npm-package.ts holds the same two names (npm-package.test.ts).
const NAME = "@pulsatrixtechnologies/sagax";
const BIN = "sagax";
// Provenance and trusted publishing compare this with the publishing
// repository, so it names the repository exactly as GitHub spells it.
const REPOSITORY = "https://github.com/pulsatrixtechnologies/Sagax";
const version = app.forkVersion;
// SemVer as npm reads it (server/npm-package.ts EXACT_VERSION): no leading
// zero in a number, nor in a numeric prerelease identifier.
const PRERELEASE_ID = "(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)";
const EXACT_VERSION = new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-${PRERELEASE_ID}(?:\\.${PRERELEASE_ID})*)?$`);
if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
  console.error(`package.json forkVersion must be X.Y.Z (got ${JSON.stringify(version)})`);
  process.exit(1);
}

/** The packages the server requires at runtime and the bundle cannot hold
 * (scripts/packaged-native-modules.test.mjs finds them in server/). */
const NATIVE_DEPENDENCIES = ["@duckdb/node-api", "@resvg/resvg-js"];
/** The app's own exact pin, so the package runs what the app was tested with. */
function pinned(name) {
  const range = app.dependencies?.[name];
  if (typeof range !== "string" || !EXACT_VERSION.test(range.replace(/^v/, ""))) {
    console.error(`package.json must pin ${name} to an exact version (got ${JSON.stringify(range)})`);
    process.exit(1);
  }
  return range;
}
for (const name of NATIVE_DEPENDENCIES) pinned(name);

for (const required of ["dist-server/index.js", "dist-server/openmausbot.js", "dist/index.html"]) {
  if (!existsSync(join(root, required))) {
    console.error(`missing ${required}: run \`pnpm build:server && pnpm exec vite build\` first`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "dist-server"), join(out, "dist-server"), { recursive: true });
cpSync(join(root, "dist"), join(out, "dist"), { recursive: true });
if (existsSync(join(root, "skills"))) cpSync(join(root, "skills"), join(out, "skills"), { recursive: true });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));
if (existsSync(join(root, "NOTICE"))) copyFileSync(join(root, "NOTICE"), join(out, "NOTICE"));

// The bin lives next to the bundle so serverEntry() finds index.js by path.
writeFileSync(join(out, "cli.js"), `#!/usr/bin/env node\nimport "./dist-server/openmausbot.js";\n`);

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: NAME,
      version,
      // The release people know, and the upstream base it builds on
      // (server/environment.ts releaseVersion reads forkVersion).
      forkVersion: version,
      baseVersion: app.baseVersion ?? app.version,
      description: "Run the Sagax server anywhere and pair your devices to it",
      license: "Apache-2.0",
      type: "module",
      bin: { [BIN]: "cli.js" },
      // Never bundled, so npm installs them beside the server: DuckDB (the
      // Data engine) and resvg (chart and image rendering) are native addons
      // npm picks per platform from their optional packages. The server
      // loads them through nativeRequire (server/data/engine.ts).
      dependencies: Object.fromEntries(NATIVE_DEPENDENCIES.map((name) => [name, pinned(name)])),
      files: ["cli.js", "dist-server", "dist", "skills", "LICENSE", "NOTICE", "README.md"],
      engines: { node: ">=24" },
      repository: { type: "git", url: `git+${REPOSITORY}.git` },
      homepage: `${REPOSITORY}#readme`,
      bugs: { url: `${REPOSITORY}/issues` },
      publishConfig: { access: "public", provenance: true, registry: "https://registry.npmjs.org/" },
      keywords: ["sagax", "agents", "self-hosted", "server"],
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(out, "README.md"),
  `# @pulsatrixtechnologies/sagax

Your own team of AI bots, with guided terminal setup. Requires Node 24+.

\`\`\`sh
npm install -g @pulsatrixtechnologies/sagax
sagax
\`\`\`

Or run \`npx @pulsatrixtechnologies/sagax\` without a global install. Use the same command
next time; \`sagax start\` is an alias for the bare command. Some of the
CLI's own messages still show the command's previous name: type \`sagax\`
wherever they do. This is the only npm package of this project; the
unscoped \`sagax\` package on npm is unrelated.

First launch: use arrow keys and Enter (numbered choices in plain terminals) to choose
ChatGPT/Codex, Claude Code, or an API service; sign in or paste a hidden API
key; choose a model and save. Setup asks before installing a missing Codex
or Claude CLI. The saved model applies only to new bots; existing bots and
conversations keep their settings.

One optional step connects your phone, defaulting to Skip for now. Choose
an explicitly approved managed public HTTPS endpoint protected by pairing,
existing Tailscale, or an HTTPS reverse proxy you already configured.
Managed access uses a separate Sagax account and asks permission for
the public endpoint and possible connector download. The pairing page and
basic server identity are public; chat and settings require pairing.
Tailscale must already be installed and signed in on both devices.

After the HTTPS connection is checked, scan the QR with your phone. When
you pair an Android phone the QR is an app link, so scan it inside the
Sagax app; the web address is printed beside it if you would rather
use a browser. On iPhone or iPad, scan with Camera for Safari, or use the
app's own scanner. Choose Connect on the phone; scanning alone is not a
completed pairing. Codes
are private, single-use, and expire after five minutes. Guided phone
access permits chat and approvals, not settings or pairing administration.
Localhost and a bare LAN address cannot connect your phone to this server.

Later launches reuse your saved choices and open Sagax on this computer.
Keep the terminal open: this is a foreground server, not a background
service. Ctrl-C stops the server without deleting saved work. Automatic
browser opening uses only the local address; it is skipped for SSH and
headless sessions, and can be disabled with \`--no-open\`.

\`\`\`sh
sagax setup          # reconfigure AI and optional phone access; not a reset
sagax --no-open      # do not open a browser
sagax --local        # ignore saved remote access for this launch
sagax --no-pair      # suppress phone prompts and invitations
sagax pair           # another phone while the HTTPS server is running
sagax sessions       # list devices; sessions revoke ID signs one out
sagax serve          # no onboarding prompts; explicit remote flags for services
\`\`\`

Stop an existing server before reconfiguring or changing access mode.
\`--local\` preserves your saved choice for next time. \`--no-pair\` does not
turn off saved remote access; use \`--local\` for that on a new launch.
With a custom \`--data-dir\` or \`--port\`, keep using those options when
starting and pairing.

API services include OpenAI, OpenRouter, Groq, and compatible
endpoints.
API connections currently support chat only. Setup asks before a short,
potentially billable API test; native setup confirms sign-in, with model
access checked when you send a message. API billing is separate from
ChatGPT/Claude subscriptions. New API keys in config.json and managed
account credentials in tunnel-account.json are plaintext, not encrypted,
with owner-only permissions (0600 on Unix). Keep these files private.

Ctrl-C before saving AI setup leaves its pending OMB changes unapplied.
During the later phone step, it keeps the AI setup already saved and exits
without starting a server. Completed installs and sign-ins remain; run
\`sagax setup\` to continue without deleting your data.

For a service, use \`serve --tunnel\` after \`login\` for managed HTTPS,
\`serve --tailscale\` for your tailnet, or your own reverse proxy. The
\`login\` command signs in to a Sagax account, not an AI provider;
it does not start the tunnel itself.

[Setup guide](${REPOSITORY}/blob/main/docs/cli-onboarding.md)
· [Hosting guide](${REPOSITORY}/blob/main/docs/self-hosting.md)
`,
);
// Nothing packed may name the company, a person or the reference design,
// except the third-party names listed with a reason in the allowlist.
const terms = scanPackage(out, loadAllowlist(join(root, "scripts", "npm-package-allowlist.json")));
if (terms.blocked.length) {
  for (const hit of terms.blocked.slice(0, 50)) {
    console.error(`${hit.file}: ${hit.term} in ...${hit.context.replace(/\s+/g, " ")}...`);
  }
  console.error(`npm package refused: ${terms.blocked.length} forbidden term(s); fix the source or justify them in scripts/npm-package-allowlist.json`);
  process.exit(1);
}
console.log(`npm package assembled at ${out} (${NAME}@${version}); term scan clean, ${terms.allowed.length} allowlisted interop name(s)`);

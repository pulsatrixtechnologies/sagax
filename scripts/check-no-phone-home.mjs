#!/usr/bin/env node
// Fails when a built bundle (dist, dist-server) or a runtime Electron file
// names a host Sagax must never contact: the original OpenMausBot services,
// PostHog analytics (or a PostHog project key) or the upstream author's
// GitHub. Explicit allowlist below; electron/upstream-hosts.mjs is the
// runtime block for the same hosts.
//
// Apple Push Notification service is listed too, with one exception: the
// server's APNs host table (server/push/config.ts APNS_HOSTS) in the server
// bundle. Pushes to phones are sent by the server only; the desktop
// renderer (dist) and the Electron shell never name or call APNs.
//
//   node scripts/check-no-phone-home.mjs [--require-bundles]
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FORBIDDEN = [
  { name: "OpenMausBot service host", pattern: /(?:[a-z0-9-]+\.)*openmausbot\.(?:com|ai|app|dev)\b/gi },
  { name: "PostHog", pattern: /posthog/gi },
  { name: "PostHog project key", pattern: /\bphc_[A-Za-z0-9]{20,}/g },
  { name: "upstream author's GitHub", pattern: /milind-soni/gi },
  { name: "Apple Push Notification service", pattern: /\bapi(?:\.sandbox)?\.push\.apple\.com\b/gi },
];

/** Each rule: the match text, the text around it (200 characters each
 * side) and the file (relative, forward slashes). Keep it short and
 * specific; every entry is a reviewed exception. */
export const ALLOWED = [
  {
    why: "reverse-DNS app and helper identifiers (appId com.openmausbot.app), not hosts",
    test: (match) => /^com\.openmausbot\.app$/i.test(match),
  },
  {
    why: "the block list itself (electron/upstream-hosts.mjs)",
    test: (match, around) =>
      /BLOCKED_DOMAINS = Object\.freeze\(\[/.test(around) && around.includes(`"${match}`),
  },
  {
    why: "the block list itself (electron/upstream-hosts.mjs)",
    test: (match, around) => /^milind-soni$/i.test(match) && /BLOCKED_GITHUB_OWNERS = Object\.freeze\(\["milind-soni"\]\)/.test(around),
  },
  {
    why: "Grok import's toolkit slug map (shared/grok-import.ts): the word PostHog as a slug, no host",
    test: (match, around) => /^posthog$/i.test(match) && /sentry:\s*["`]sentry["`],\s*posthog:\s*["`]posthog["`]/.test(around),
  },
  {
    // Server side only: the push hub of an organization server (server/push/)
    // sends to the person's own phones, and only when SAGAX_APNS_* is set.
    // The same text in dist/ (the desktop renderer) or electron/ fails.
    why: "APNs hosts of the server's push module (server/push/config.ts APNS_HOSTS), dist-server only",
    test: (match, around, file = "") =>
      /^api(?:\.sandbox)?\.push\.apple\.com$/i.test(match) &&
      file.replaceAll("\\", "/").startsWith("dist-server/") &&
      /APNS_HOSTS\d*\s*=\s*Object\.freeze\(\{\s*production: "api\.push\.apple\.com",\s*sandbox: "api\.sandbox\.push\.apple\.com",?\s*\}\)/.test(around),
  },
  {
    // sagax_help knowledge (server/self-knowledge/): generated documentation
    // prose that names the hosts and projects Sagax blocks. It is data the
    // bot reads, never a URL the app fetches or a client of these hosts.
    why: "generated sagax_help knowledge text (documentation prose, never fetched), dist-server only",
    test: (match, around, file = "") =>
      file.replaceAll("\\", "/") === "dist-server/self-knowledge/knowledge.generated.json",
  },
];

const SKIP_FILE = /(?:\.test\.|\.node-test\.|\.electron\.test\.|\.d\.mts$|\.map$|\.png$|\.jpe?g$|\.webp$|\.gif$|\.ico$|\.icns$|\.woff2?$|\.ttf$|\.otf$|\.mp3$|\.wav$|\.glb$|\.zip$|\.wasm$)/i;

function* walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* walk(path);
    } else if (entry.isFile() && !SKIP_FILE.test(entry.name)) {
      yield path;
    }
  }
}

export function scanText(text, file) {
  const findings = [];
  for (const { name, pattern } of FORBIDDEN) {
    pattern.lastIndex = 0;
    for (const found of text.matchAll(pattern)) {
      const at = found.index ?? 0;
      const around = text.slice(Math.max(0, at - 200), at + found[0].length + 200);
      if (ALLOWED.some((rule) => rule.test(found[0], around, file))) continue;
      const line = text.slice(0, at).split("\n").length;
      findings.push({ file, line, name, match: found[0], context: text.slice(Math.max(0, at - 60), at + found[0].length + 60).replace(/\s+/g, " ") });
    }
  }
  return findings;
}

/** The directories the packaged app ships that this check reads. */
export function scanTargets(root = ROOT) {
  return [
    { dir: join(root, "dist"), bundle: true },
    { dir: join(root, "dist-server"), bundle: true },
    { dir: join(root, "electron"), bundle: false },
  ];
}

export function scan({ root = ROOT, requireBundles = false } = {}) {
  const findings = [];
  const missing = [];
  let files = 0;
  for (const { dir, bundle } of scanTargets(root)) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      if (bundle) missing.push(relative(root, dir));
      continue;
    }
    for (const file of walk(dir)) {
      if (!bundle && !/\.(?:mjs|cjs|js|json|plist)$/.test(file)) continue;
      files++;
      findings.push(...scanText(readFileSync(file, "utf8"), relative(root, file)));
    }
  }
  if (requireBundles && missing.length) throw new Error(`build output missing: ${missing.join(", ")} (run pnpm build && pnpm build:server)`);
  return { findings, missing, files };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { findings, missing, files } = scan({ requireBundles: process.argv.includes("--require-bundles") });
  if (missing.length) console.warn(`not built, skipped: ${missing.join(", ")}`);
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}:${f.line}: ${f.name} "${f.match}" … ${f.context}`);
    console.error(`\n${findings.length} forbidden host reference(s). Remove them, or add a reviewed rule to ALLOWED in scripts/check-no-phone-home.mjs.`);
    process.exit(1);
  }
  console.log(`no phone-home hosts in ${files} files`);
}

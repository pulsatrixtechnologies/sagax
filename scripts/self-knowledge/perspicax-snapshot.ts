// Writes server/self-knowledge/perspicax.snapshot.json: Perspicax's part
// of the sagax_help knowledge base, read from a Perspicax repository at a
// release tag (the latest v* by default): the console's menu and Settings
// pages, their French and English labels, their address and the role that
// sees them. Nothing else: Perspicax is a private repository and Sagax a
// public one, so no doc, release note or code comment of Perspicax is
// copied here; how-tos about its console are written in guides.ts.
//
//   node --experimental-strip-types scripts/self-knowledge/perspicax-snapshot.ts --repo ../Perspicax [--ref v1.8.40]
//
// Rerun at each Perspicax release (then scripts/self-knowledge/generate.ts).
// A bot reaches the live catalog of its organization through api_list.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { KnowledgeSection, PerspicaxSnapshot } from "../../server/self-knowledge-types.ts";
import { scrub } from "./markdown.ts";
import { PERSPICAX_SNAPSHOT_FILE } from "./build.ts";

const arg = (name: string) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const repo = arg("--repo");
const ref = arg("--ref");
if (!repo) {
  console.error("usage: perspicax-snapshot.ts --repo <Perspicax checkout> [--ref origin/main]");
  process.exit(2);
}
const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const tag = ref ?? git("tag", "--list", "v*", "--sort=-v:refname").split("\n")[0].trim();
const show = (path: string) => git("show", `${tag}:${path}`);

const ROLE_WORDS: Record<string, string> = {
  employee: "every person of the organization", manager: "managers and admins", admin: "admins only",
};

/** `"key": "value",` lines of the console's message tables. */
function messages(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of show(path).matchAll(/^\s*"([\w.-]+)":\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) out[match[1]] = JSON.parse(`"${match[2]}"`);
  return out;
}

const fr = messages("console/src/lib/messages.fr.ts");
const en = messages("console/src/lib/messages.en.ts");
const both = (key: string) => {
  const english = en[key] ?? key;
  const french = fr[key];
  return french && french !== english ? `${english} (${french})` : english;
};

const sections: KnowledgeSection[] = [];

// The console's menu: NAV in console/src/lib/nav.ts.
const nav = show("console/src/lib/nav.ts");
const routeInfo = new Map<string, { label: string; group: string; role: string; advanced: boolean; sagax: boolean }>();
let group = "";
for (const line of nav.split("\n")) {
  const head = /^\s*label: "([\w.]+)",\s*$/.exec(line);
  if (head) group = both(head[1]);
  const item = /\{ to: "([^"]+)", label: "([\w.]+)",.*?min: "(\w+)"(.*)\}/.exec(line);
  if (!item) continue;
  const [, to, labelKey, role, rest] = item;
  if (routeInfo.has(to)) continue;
  const only = /only: "(\w+)"/.exec(rest)?.[1];
  routeInfo.set(to, { label: both(labelKey), group, role: only ? `${only}s only` : ROLE_WORDS[role] ?? role, advanced: /advanced: true/.test(rest), sagax: /sagax: true/.test(rest) });
}

const consoleWhere = (to: string, info?: { label: string; group: string }) =>
  `Perspicax console${info ? ` > ${info.group ? `${info.group} > ` : ""}${info.label}` : ""} (${to})`;

for (const [to, info] of routeInfo) {
  sections.push({
    id: `px:console:${to}`,
    kind: "perspicax",
    title: `Perspicax console: ${info.label}`,
    where: consoleWhere(to, info),
    access: `${info.role}${info.sagax ? "; shown while a Sagax server is linked" : ""}${info.advanced ? "; Mode avancé only" : ""}`,
    text: `${info.label}: a page of the Perspicax console menu, under ${info.group || "the top of the menu"}, at ${to}.`,
    source: "Perspicax console/src/lib/nav.ts",
  });
}

// The Settings window: console/src/lib/settings-pages.ts.
const settings = show("console/src/lib/settings-pages.ts");
for (const match of settings.matchAll(/id: "([\w.]+)",\s*group: "(\w+)",\s*label: "([\w.]+)",[\s\S]*?kw: "([^"]*)"([^}]*)\}/g)) {
  const [, id, groupId, labelKey, kw, rest] = match;
  const admin = /admin: true/.test(rest) || groupId === "organisation";
  sections.push({
    id: `px:settings:${id}`,
    kind: "perspicax",
    title: `Perspicax settings: ${both(labelKey)}`,
    where: `Perspicax console > account menu > Réglages (Settings) > ${groupId === "organisation" ? "Organisation" : "Personnel"} > ${both(labelKey)} (?settings=${id})`,
    access: admin ? "admins only" : "each person, their own",
    keywords: kw,
    text: `Settings page ${both(labelKey)} of the Perspicax console. Holds: ${kw.split(" ").join(", ")}.`,
    source: "Perspicax console/src/lib/settings-pages.ts",
  });
}

const cargo = show("Cargo.toml");
const version = /^version = "([^"]+)"/m.exec(cargo)?.[1] ?? tag.replace(/^v/, "");
const commit = git("rev-parse", "--short=8", `${tag}^{commit}`).trim();
const date = git("show", "-s", "--format=%cs", `${tag}^{commit}`).trim();
const byId = new Map<string, KnowledgeSection>();
for (const section of sections) if (!byId.has(section.id)) byId.set(section.id, scrub(section));
const snapshot: PerspicaxSnapshot = { version, commit, date, sections: [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) };
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
writeFileSync(join(root, PERSPICAX_SNAPSHOT_FILE), `{\n  "version": ${JSON.stringify(version)},\n  "commit": ${JSON.stringify(commit)},\n  "date": ${JSON.stringify(date)},\n  "sections": [\n${snapshot.sections.map((section) => `    ${JSON.stringify(section)}`).join(",\n")}\n  ]\n}\n`);
console.log(`${PERSPICAX_SNAPSHOT_FILE}: Perspicax ${version} (${commit}, ${date}), ${snapshot.sections.length} sections.`);

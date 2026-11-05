// #2024: a pi kit on the server. SAGAX_PI_KIT_DIR names a read-only folder an
// operator mounts (docs/custom-engines.md, "A pi kit"):
//   extensions/*.ts   pi extensions, each loaded with an explicit `-e`
//                     (pi still loads an explicit `-e` under --no-extensions)
//   settings.json     merged into the pi home's settings.json
//   APPEND_SYSTEM.md  a template: {{USER_NAME}} {{CW_MEMBER}} {{TIMEZONE}}
//                     {{LANG_NAME}} {{USER_ORG}} {{MAX_PARALLEL}} come from
//                     the person's identity; a line naming an unknown one
//                     is dropped
//   tools/            copied as is, for the extensions that read it
//   packages.txt      pi package sources, one a line ("#" starts a comment),
//                     loaded with `-e` too; the image can preinstall them
//                     (Dockerfile PI_KIT_PACKAGES, SAGAX_PI_PACKAGES_DIR)
// The kit is copied into the turn's pi home (PI_CODING_AGENT_DIR), so each
// person's home carries it; host tools stay withheld as they are without it.
// Sagax holds no kit content: the folder is the operator's.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export const PI_KIT_DIR_ENV = "SAGAX_PI_KIT_DIR";
export const PI_PACKAGES_DIR_ENV = "SAGAX_PI_PACKAGES_DIR";

export const PI_KIT_VARIABLES = ["USER_NAME", "CW_MEMBER", "TIMEZONE", "LANG_NAME", "USER_ORG", "MAX_PARALLEL"] as const;
export type PiKitVariable = (typeof PI_KIT_VARIABLES)[number];
export type PiKitIdentity = Partial<Record<PiKitVariable, string>>;

/** The kit folder named by SAGAX_PI_KIT_DIR, when it is a folder. */
export function piKitDir(env: Record<string, string | undefined>): string | null {
  const dir = env[PI_KIT_DIR_ENV]?.trim();
  if (!dir) return null;
  try {
    return statSync(dir).isDirectory() ? resolve(dir) : null;
  } catch {
    return null;
  }
}

const VARIABLE = /\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}/g;

/** The template with every known variable filled in. A line that names a
 * variable with no value (or one the kit invented) is dropped whole, so the
 * prompt never carries a bare placeholder. */
export function renderPiKitTemplate(template: string, identity: PiKitIdentity): string {
  const values = new Map<string, string>();
  for (const name of PI_KIT_VARIABLES) {
    const value = identity[name]?.replace(/[\r\n]+/g, " ").trim();
    if (value) values.set(name, value);
  }
  const lines: string[] = [];
  for (const line of template.split(/\r?\n/)) {
    let unknown = false;
    const next = line.replace(VARIABLE, (_match, name: string) => {
      const value = values.get(name);
      if (value === undefined) unknown = true;
      return value ?? "";
    });
    if (!unknown) lines.push(next);
  }
  return lines.join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The kit's settings over the home's: an object merges key by key, any
 * other value (an array included) is the kit's. */
export function mergePiSettings(base: Record<string, unknown>, kit: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(kit)) {
    const previous = out[key];
    out[key] = isRecord(previous) && isRecord(value) ? mergePiSettings(previous, value) : value;
  }
  return out;
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The package sources of packages.txt, in order, without comments. */
export function readPiKitPackages(kitDir: string): string[] {
  const path = join(kitDir, "packages.txt");
  if (!existsSync(path)) return [];
  const out: string[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (line && !out.includes(line)) out.push(line);
  }
  return out;
}

/** The npm package name of `npm:<name>[@version]` (scoped names kept). */
export function npmPackageName(source: string): string | null {
  if (!source.startsWith("npm:")) return null;
  const spec = source.slice(4).trim();
  if (!spec) return null;
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at > 0 ? spec.slice(0, at) : spec;
}

/** What `-e` loads for one packages.txt line: a package the image
 * preinstalled under SAGAX_PI_PACKAGES_DIR as its folder, a relative path
 * from the kit folder, anything else as pi reads the source itself. */
export function piKitPackageArg(source: string, kitDir: string, env: Record<string, string | undefined>): string {
  const name = npmPackageName(source);
  const root = env[PI_PACKAGES_DIR_ENV]?.trim();
  if (name && root) {
    const dir = join(root, name);
    if (existsSync(dir)) return dir;
  }
  if (source.startsWith("./") || source.startsWith("../")) return resolve(kitDir, source);
  if (isAbsolute(source)) return source;
  return source;
}

export interface PiKitInstall {
  /** The `-e` arguments, in order: the kit's extensions, then its packages. */
  args: string[];
}

/** Copy the kit into a pi home and return the `-e` arguments that load it.
 * Every turn copies again, so a kit updated in place reaches the next turn,
 * and the identity in APPEND_SYSTEM.md is always the turn's own person. */
export function installPiKit(kitDir: string, home: string, identity: PiKitIdentity, env: Record<string, string | undefined> = process.env): PiKitInstall {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const args: string[] = [];

  const extensions = join(kitDir, "extensions");
  if (existsSync(extensions) && statSync(extensions).isDirectory()) {
    const target = join(home, "extensions");
    cpSync(extensions, target, { recursive: true, force: true });
    for (const name of readdirSync(extensions).sort()) {
      if (!/\.(ts|js|mjs)$/.test(name)) continue;
      if (!statSync(join(extensions, name)).isFile()) continue;
      args.push("-e", join(target, name));
    }
  }

  const tools = join(kitDir, "tools");
  if (existsSync(tools) && statSync(tools).isDirectory()) cpSync(tools, join(home, "tools"), { recursive: true, force: true });

  const packages = readPiKitPackages(kitDir);
  if (existsSync(join(kitDir, "packages.txt"))) cpSync(join(kitDir, "packages.txt"), join(home, "packages.txt"), { force: true });
  for (const source of packages) args.push("-e", piKitPackageArg(source, kitDir, env));

  const kitSettings = readJsonObject(join(kitDir, "settings.json"));
  if (kitSettings) {
    const path = join(home, "settings.json");
    const exists = existsSync(path);
    const base = exists ? readJsonObject(path) : {};
    // a settings file pi or the person broke is left alone
    if (base) writeFileSync(path, `${JSON.stringify(mergePiSettings(base, kitSettings), null, 2)}\n`, { mode: 0o600 });
  }

  const template = join(kitDir, "APPEND_SYSTEM.md");
  if (existsSync(template)) {
    writeFileSync(join(home, "APPEND_SYSTEM.md"), renderPiKitTemplate(readFileSync(template, "utf8"), identity), { mode: 0o600 });
  }
  return { args };
}

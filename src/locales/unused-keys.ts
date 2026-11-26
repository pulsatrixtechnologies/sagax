// Keys of en.json that no shipped source reads, as a literal or as a
// template on an ancestor (`prefix.${...}`, "prefix." + ...), and that the
// iPad shell does not copy either.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src", "server", "electron", "shared", "companion", "scripts"];

export function unreadLocaleKeys(repo: string): string[] {
  const en = JSON.parse(readFileSync(join(repo, "src/locales/en.json"), "utf8")) as Record<string, string>;
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  // A key is a dotted name, so the scan looks for one right after a quote
  // without pairing quotes: `data-x=""` and a `t("…")` nested in a template
  // string desync any pairing and hid keys that are read.
  const literal = /["'`](?=([\w][\w.-]{0,199})["'`])/g;
  const template = /`([A-Za-z0-9_.]+)\$\{/g;
  const plus = /["']([A-Za-z0-9_.]+)["']\s*\+/g;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "locales" || name === "dist" || name === "release" || name === "unused-keys.ts") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(tsx?|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) files.push(path);
    }
  };
  for (const dir of ROOTS) {
    try { walk(join(repo, dir)); } catch { /* a checkout without that tree */ }
  }
  for (const path of files) {
    const code = readFileSync(path, "utf8");
    for (const match of code.matchAll(literal)) {
      literals.add(match[1]!);
    }
    for (const match of code.matchAll(template)) prefixes.add(match[1]!);
    for (const match of code.matchAll(plus)) prefixes.add(match[1]!);
  }
  // The iPad shell copies desktop labels by key (ios/parity/desktop-wording.json,
  // checked by ios-desktop-wording.test.ts): a key named there is read, even
  // when no desktop surface shows it any more.
  try {
    const ipad = JSON.parse(readFileSync(join(repo, "ios/parity/desktop-wording.json"), "utf8")) as Record<string, string>;
    for (const [label, key] of Object.entries(ipad)) if (label !== "//") literals.add(key);
  } catch { /* a checkout without the phone */ }
  const unread: string[] = [];
  for (const key of Object.keys(en)) {
    if (literals.has(key)) continue;
    let covered = false;
    const parts = key.split(".");
    for (let i = 1; i < parts.length; i += 1) {
      const parent = `${parts.slice(0, i).join(".")}.`;
      if (prefixes.has(parent) || literals.has(parent)) { covered = true; break; }
    }
    if (!covered) unread.push(key);
  }
  unread.sort();
  return unread;
}

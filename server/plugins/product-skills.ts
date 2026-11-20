// D-20261119-087 (#5105): the marketplace has one plugin of skills ranged by
// product, and a bot sees only the skills of the products its Perspicax
// connection serves it. A product skill names its product and the api_list
// ids it needs in its SKILL.md frontmatter (`metadata.product`,
// `metadata.apis`, ids separated by spaces); a skill without a product is the
// platform's and always stays.
//
// The one place this applies is the selection of a bot's plugin folders
// (server/index-leaves/scopedPluginFolders.ts): a folder holding a product
// skill the bot is not served is given as a copy without that skill's folder
// (server/plugins/plugin-folder-copy.ts). Every engine reads its skills from
// that selection: Claude's `--plugin-dir`, the skills index, skills_list and
// workspace_read of the others, the native skill links of file engines and
// the copy in the person's environment. `installed` on such a folder keeps
// the installed folder, which names the install (capability keys, the
// plugin's MCP servers, the bot's Plugins list).
//
// What the bot is served is the api_list Sagax already reads for it
// (PerspicaxMcp.servedApis, the same read as the product names, no call of
// its own), less the products the person turned off for this bot (#4359,
// shared/bot-products.ts). No card, no setting: a product given or taken
// away shows or hides its skills at the bot's next turn.
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { BOT_PRODUCT_ID, botProductsOff, normalProductId } from "../../shared/bot-products.ts";
import { readSkillMetadata } from "../../shared/skill-md.ts";
import { pluginFolderCopy } from "./plugin-folder-copy.ts";

/** Where the copies without the skills a bot is not served live. */
export function servedSkillsCopiesDir(dataDir: string): string {
  return join(dataDir, "engine-policies", "plugin-skills");
}

/** What a product skill declares: its product and the API ids it needs. */
export interface SkillProduct {
  product: string;
  apis: string[];
}

/** A SKILL.md's product, or null for a platform skill (no `metadata.product`). */
export function skillProductOf(raw: string): SkillProduct | null {
  const metadata = readSkillMetadata(raw);
  const product = normalProductId(metadata.product ?? "");
  if (!product) return null;
  const apis = [...new Set((metadata.apis ?? "").split(/[\s,[\]"']+/).map(normalProductId).filter((id) => BOT_PRODUCT_ID.test(id)))];
  return { product, apis };
}

/** What api_list listed for a bot: every API id and the families (`group`). */
export interface ListedApis {
  ids: Iterable<string>;
  groups: ReadonlyMap<string, readonly string[]>;
}

/** The ids a bot is served: every API id listed and every family with a
 * member listed, less the products the person turned off for this bot (a
 * family whose every listed member is off is off too). */
export function servedProductIds(listed: ListedApis, off: ReadonlySet<string>): Set<string> {
  const served = new Set<string>();
  for (const raw of listed.ids) {
    const id = normalProductId(raw);
    if (id && !off.has(id)) served.add(id);
  }
  for (const [raw, members] of listed.groups) {
    const group = normalProductId(raw);
    if (group && !off.has(group) && members.some((member) => served.has(normalProductId(member)))) served.add(group);
  }
  return served;
}

/** The ids one bot is served, or null when Sagax does not know them (no
 * api_list read for it yet): the bot's folders then stay as installed. */
export function botServedProducts(listed: ListedApis | undefined, bot: { products?: Record<string, boolean> } | null | undefined): Set<string> | null {
  return listed ? servedProductIds(listed, botProductsOff(bot)) : null;
}

/** A product skill is served when every API it names is; one that names no
 * API, when its product id itself is served. */
export function productSkillServed(skill: SkillProduct, served: ReadonlySet<string>): boolean {
  return skill.apis.length ? skill.apis.every((id) => served.has(id)) : served.has(skill.product);
}

/** The frontmatter sits at the top: a SKILL.md is read this far. */
const SKILL_HEAD_BYTES = 64 * 1024;
const PRODUCTS_KEPT = 4096;
/** Each SKILL.md read once per size and change time. */
const products = new Map<string, { stamp: string; product: SkillProduct | null }>();

function productOfSkillFile(file: string): SkillProduct | null {
  let stat: ReturnType<typeof lstatSync>;
  try { stat = lstatSync(file); } catch { return null; }
  if (!stat.isFile()) return null;
  const stamp = `${stat.size}\0${stat.mtimeMs}`;
  const known = products.get(file);
  if (known?.stamp === stamp) return known.product;
  let product: SkillProduct | null = null;
  let fd: number | undefined;
  try {
    fd = openSync(file, "r");
    const buffer = Buffer.alloc(Math.min(stat.size, SKILL_HEAD_BYTES));
    const read = readSync(fd, buffer, 0, buffer.length, 0);
    product = skillProductOf(buffer.subarray(0, read).toString("utf8"));
  } catch {
    product = null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  products.delete(file);
  products.set(file, { stamp, product });
  while (products.size > PRODUCTS_KEPT) products.delete(products.keys().next().value!);
  return product;
}

/** The skill folders (`skills/<name>/`) of one plugin whose product this bot
 * is not served, sorted. A link is never followed. */
export function hiddenProductSkills(pluginDir: string, served: ReadonlySet<string>): string[] {
  let names: string[];
  try { names = readdirSync(join(pluginDir, "skills")); } catch { return []; }
  const hidden: string[] = [];
  for (const name of names) {
    const dir = join(pluginDir, "skills", name);
    try { if (!lstatSync(dir).isDirectory()) continue; } catch { continue; }
    const product = productOfSkillFile(join(dir, "SKILL.md"));
    if (product && !productSkillServed(product, served)) hidden.push(name);
  }
  return hidden.sort();
}

/** A copy is checked against the installed folder at most this often. */
const COPY_RECHECK_MS = 5_000;
const COPIES_KEPT = 256;
const copies = new Map<string, { dir: string; at: number }>();

function servedSkillsCopy(installed: string, hidden: readonly string[], root: string): string {
  const signature = JSON.stringify(["served-skills", resolve(installed), hidden]);
  const known = copies.get(signature);
  if (known && Date.now() - known.at < COPY_RECHECK_MS && existsSync(known.dir)) return known.dir;
  const dir = pluginFolderCopy(installed, root, signature, { skip: hidden.map((name) => join("skills", name)) });
  if (dir === installed) {
    console.warn(`[plugins] ${basename(installed)}: its skills could not be matched to the bot's products for this turn (no copy)`);
    return dir;
  }
  copies.delete(signature);
  copies.set(signature, { dir, at: Date.now() });
  while (copies.size > COPIES_KEPT) copies.delete(copies.keys().next().value!);
  return dir;
}

/** A bot's plugin folders as it is served them: a folder holding a product
 * skill the bot is not served becomes a copy without that skill, with
 * `installed` naming the installed folder. `served` null leaves every folder
 * as installed. */
export function withServedProductSkills<T extends { dir: string }>(folders: readonly T[], served: ReadonlySet<string> | null, copiesRoot: string): Array<T & { installed?: string }> {
  if (!served) return [...folders];
  return folders.map((folder) => {
    const hidden = hiddenProductSkills(folder.dir, served);
    if (!hidden.length) return folder;
    const dir = servedSkillsCopy(folder.dir, hidden, copiesRoot);
    return dir === folder.dir ? folder : { ...folder, dir, installed: folder.dir };
  });
}

/** The installed folder of a selected plugin folder (its copy names it). */
export function installedPluginDir(folder: { dir: string; installed?: string }): string {
  return folder.installed ?? folder.dir;
}

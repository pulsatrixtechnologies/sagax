// Public share links for bot templates (2026-10-16, parity with Grok Bot's
// "Share a link to the template" / "Turn off the public link").
//
// A template is the preset file Share preset already writes (package format
// v2, kind library: server/package-export.ts createLibraryPackageExport),
// frozen when the link is made. The link serves it read only to anyone who
// has it, without a session:
//
//   GET /share/template/<token>        a read-only card (HTML, no script)
//   GET /share/template/<token>.json   the template, for "Import from link"
//
// What never travels, whatever the template held: starter notes (memory, the
// presets' and bots' `seed`), connections (an address may carry a key), and
// anything redactPackageSecrets finds. The exporter already leaves out model
// choices, computers, approval levels and connected apps.
//
// The token is `<id>.<mac>`: a random 128-bit id and an HMAC-SHA256 (192
// bits kept) of it under a key that never leaves the server
// (template-links.key, 0600). Revoking deletes the record: the same token
// then answers 404 like any made-up one, and a new link for the same
// template gets a new id. Records live in template-links.json (0600).
//
// Updating a template (2026-10-21, parity with "Update the template") freezes
// the current defaults again under the SAME link: the address people already
// have keeps working and now opens the new version (updatedAt says when).
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { writeFileAtomic } from "./atomic.ts";
import { parsePackageDocument, redactPackageSecrets, type PackageDocument } from "../shared/package-format.ts";

export const TEMPLATE_LINK_PREFIX = "/share/template/";
const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{32})$/;
const MAX_LINKS = 200;

export interface TemplateLinkRecord {
  id: string;
  name: string;
  createdAt: number;
  /** When the template behind the link was last frozen again. */
  updatedAt?: number;
  /** Who made it (a principal id on an organization server). */
  createdBy?: string;
  document: PackageDocument;
}

/** What the owner's list shows: never the document. */
export interface TemplateLinkSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt?: number;
  path: string;
}

/** The template as the public sees it: no starter notes, no connections,
 * secrets redacted, parsed again by the one package parser. Pure. */
export function publicTemplateDocument(document: PackageDocument): PackageDocument {
  const copy = JSON.parse(JSON.stringify(document)) as PackageDocument;
  const pkg = copy.package as PackageDocument["package"] & { connections?: unknown };
  for (const preset of pkg.presets ?? []) delete (preset as { seed?: unknown }).seed;
  for (const agent of pkg.agents ?? []) delete (agent as { seed?: unknown }).seed;
  delete pkg.connections;
  return parsePackageDocument(redactPackageSecrets(copy).document, { trust: "file" });
}

export class TemplateLinks {
  private readonly file: string;
  private readonly key: Buffer;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, "template-links.json");
    const keyFile = join(dataDir, "template-links.key");
    if (!existsSync(keyFile)) writeFileSync(keyFile, randomBytes(32), { mode: 0o600 });
    this.key = readFileSync(keyFile);
  }

  private mac(id: string): string {
    return createHmac("sha256", this.key).update(`sagax-template-link:v1:${id}`).digest("base64url").slice(0, 32);
  }

  token(id: string): string {
    return `${id}.${this.mac(id)}`;
  }

  path(id: string): string {
    return `${TEMPLATE_LINK_PREFIX}${this.token(id)}`;
  }

  /** The id a token names, when its signature holds; null otherwise. */
  verify(token: string): string | null {
    const match = TOKEN.exec(token);
    if (!match) return null;
    const expected = Buffer.from(this.mac(match[1]!));
    const given = Buffer.from(match[2]!);
    return given.length === expected.length && timingSafeEqual(given, expected) ? match[1]! : null;
  }

  private load(): TemplateLinkRecord[] {
    if (!existsSync(this.file)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.file, "utf8")) as { version?: unknown; links?: unknown };
      if (raw.version !== 1 || !Array.isArray(raw.links)) return [];
      return raw.links.flatMap((entry) => {
        const link = entry as Partial<TemplateLinkRecord>;
        if (typeof link.id !== "string" || typeof link.name !== "string" || typeof link.createdAt !== "number") return [];
        try {
          return [{
            id: link.id, name: link.name, createdAt: link.createdAt,
            ...(typeof link.updatedAt === "number" ? { updatedAt: link.updatedAt } : {}),
            ...(typeof link.createdBy === "string" ? { createdBy: link.createdBy } : {}),
            document: publicTemplateDocument(link.document as PackageDocument),
          }];
        } catch {
          return [];
        }
      });
    } catch {
      return [];
    }
  }

  private save(links: TemplateLinkRecord[]): void {
    writeFileAtomic(this.file, JSON.stringify({ version: 1, links }, null, 2), { mode: 0o600 });
  }

  /** Freeze a template behind a new link. */
  create(document: PackageDocument, options: { createdBy?: string; now?: number } = {}): TemplateLinkRecord {
    const links = this.load();
    if (links.length >= MAX_LINKS) throw new Error(`Turn off an older link first (at most ${MAX_LINKS}).`);
    const record: TemplateLinkRecord = {
      id: randomBytes(16).toString("base64url"),
      name: document.package.name,
      createdAt: options.now ?? Date.now(),
      ...(options.createdBy ? { createdBy: options.createdBy } : {}),
      document: publicTemplateDocument(document),
    };
    this.save([...links, record]);
    return record;
  }

  /** The links one person may see: theirs, or all of them (`createdBy` undefined). */
  list(createdBy?: string): TemplateLinkSummary[] {
    return this.load()
      .filter((link) => createdBy === undefined || link.createdBy?.toLowerCase() === createdBy.toLowerCase())
      .map((link) => ({ id: link.id, name: link.name, createdAt: link.createdAt, ...(link.updatedAt ? { updatedAt: link.updatedAt } : {}), path: this.path(link.id) }));
  }

  /** Freeze a new version of the template behind the same link (same id,
   * same token). Null when the link is gone. */
  update(id: string, document: PackageDocument, options: { now?: number } = {}): TemplateLinkRecord | null {
    const links = this.load();
    const index = links.findIndex((link) => link.id === id);
    if (index === -1) return null;
    const record: TemplateLinkRecord = {
      ...links[index]!,
      name: document.package.name,
      updatedAt: options.now ?? Date.now(),
      document: publicTemplateDocument(document),
    };
    links[index] = record;
    this.save(links);
    return record;
  }

  get(id: string): TemplateLinkRecord | null {
    return this.load().find((link) => link.id === id) ?? null;
  }

  /** The template a public token opens, or null (bad signature, revoked). */
  open(token: string): TemplateLinkRecord | null {
    const id = this.verify(token);
    return id ? this.get(id) : null;
  }

  /** Turn the link off. True when there was one. */
  revoke(id: string): boolean {
    const links = this.load();
    const next = links.filter((link) => link.id !== id);
    if (next.length === links.length) return false;
    this.save(next);
    return true;
  }
}

// ── the public card ─────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
}

const CARD_COPY = {
  en: {
    kicker: "Sagax bot template",
    skills: "Skills",
    none: "None",
    by: "Shared by",
    release: "Version",
    howTitle: "Use this template",
    how: "In Sagax, open Browse bots, then Templates, then Import, and paste this page's address.",
    never: "Starter notes, connected apps, keys and model choices are never part of a shared template.",
  },
  fr: {
    kicker: "Modèle de bot Sagax",
    skills: "Compétences",
    none: "Aucune",
    by: "Partagé par",
    release: "Version",
    howTitle: "Utiliser ce modèle",
    how: "Dans Sagax, ouvrez Parcourir les bots, puis Modèles, puis Importer, et collez l'adresse de cette page.",
    never: "Les notes de départ, les apps connectées, les clés et les choix de modèle ne font jamais partie d'un modèle partagé.",
  },
} as const;

/** What the owner's details view shows of a template: its title,
 * description and skills, never its persona text. Pure. */
export function templateDetails(document: PackageDocument): { title: string; description: string; skills: string[]; release: string } {
  const pkg = document.package;
  const preset = pkg.presets?.[0];
  return {
    title: preset?.name ?? pkg.name,
    description: preset?.description || preset?.bot.description || pkg.tagline || "",
    skills: [...(preset?.skills ?? [])],
    release: pkg.release,
  };
}

/** The language of the card, from Accept-Language: French or English. */
export function cardLanguage(acceptLanguage: string | undefined): "fr" | "en" {
  const first = (acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase() ?? "";
  return first.startsWith("fr") ? "fr" : "en";
}

/** The read-only card: escaped text, the template's own picture as a data
 * URL when it has one, no script. Pure. */
export function templateCardHtml(document: PackageDocument, language: "fr" | "en"): string {
  const copy = CARD_COPY[language];
  const pkg = document.package;
  const preset = pkg.presets?.[0];
  const title = preset?.name ?? pkg.name;
  const description = preset?.description || preset?.bot.description || pkg.tagline || "";
  const skills = preset?.skills ?? [];
  const avatar = preset?.bot.appearance?.avatar;
  const picture = avatar && /^image\/(png|jpeg|webp)$/.test(avatar.mime) && /^[A-Za-z0-9+/=]+$/.test(avatar.data)
    ? `<img class="avatar" alt="" src="data:${avatar.mime};base64,${avatar.data}">`
    : `<div class="avatar placeholder" aria-hidden="true">${escapeHtml(title.slice(0, 1).toUpperCase())}</div>`;
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)} · Sagax</title>
<style>
:root { color-scheme: light dark; --bg: #f6f5f2; --card: #ffffff; --ink: #1d1c1a; --muted: #6b6862; --line: #e4e1db; --chip: #efede8; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --card: #1f1e1c; --ink: #f1efe9; --muted: #a39f97; --line: #34322e; --chip: #2a2926; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
main { max-width: 560px; margin: 0 auto; padding: 48px 16px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 28px; }
.head { display: flex; gap: 16px; align-items: center; }
.avatar { width: 64px; height: 64px; border-radius: 16px; object-fit: cover; flex: none; }
.placeholder { display: flex; align-items: center; justify-content: center; background: var(--chip); font-size: 26px; font-weight: 600; }
.kicker { color: var(--muted); font-size: 12px; letter-spacing: .02em; text-transform: uppercase; }
h1 { margin: 2px 0 0; font-size: 22px; line-height: 1.25; }
p { margin: 16px 0 0; }
dl { margin: 20px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; font-size: 13.5px; }
dt { color: var(--muted); }
dd { margin: 0; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { background: var(--chip); border-radius: 999px; padding: 2px 10px; font-size: 12.5px; }
h2 { margin: 24px 0 0; font-size: 14px; }
.note { color: var(--muted); font-size: 12.5px; }
</style>
</head>
<body>
<main>
<article class="card">
<div class="head">${picture}<div><div class="kicker">${escapeHtml(copy.kicker)}</div><h1>${escapeHtml(title)}</h1></div></div>
${description ? `<p>${escapeHtml(description)}</p>` : ""}
<dl>
<dt>${escapeHtml(copy.skills)}</dt><dd>${skills.length ? `<div class="chips">${skills.map((skill) => `<span class="chip">${escapeHtml(skill)}</span>`).join("")}</div>` : escapeHtml(copy.none)}</dd>
<dt>${escapeHtml(copy.by)}</dt><dd>${escapeHtml(pkg.author.name)}</dd>
<dt>${escapeHtml(copy.release)}</dt><dd>${escapeHtml(pkg.release)}</dd>
</dl>
<h2>${escapeHtml(copy.howTitle)}</h2>
<p class="note">${escapeHtml(copy.how)}</p>
<p class="note">${escapeHtml(copy.never)}</p>
</article>
</main>
</body>
</html>`;
}

// Markdown and MDX into short knowledge sections (sagax_help). Pure text
// work: no I/O.
import type { KnowledgeKind, KnowledgeSection } from "../../server/self-knowledge-types.ts";

/** At most this many characters of one section's text are kept: the search
 * picks its best sentences, never the whole text. */
export const SECTION_TEXT_MAX = 3000;

export function slug(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

/** Markdown to plain prose: no fences of code longer than a line, no HTML,
 * no images, no MDX imports or JSX tags, links kept as their words. */
export function plainText(markdown: string): string {
  return markdown
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/```[\s\S]*?```/g, (block) => {
      const lines = block.split("\n").slice(1, -1).filter((line) => line.trim());
      return lines.length === 1 ? ` \`${lines[0].trim()}\` ` : " ";
    })
    .replace(/^\s*(import|export)\s.*$/gm, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<\/?[A-Za-z][^>]*>/g, " ")
    .replace(/^\s*[-*+]\s+/gm, "- ")
    .replace(/^\s*\|?[-: |]+\|?\s*$/gm, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** Example tags that name a real customer in a doc (`client:Acme`,
 * `client: "Acme"`, `company=Acme`) lose the name: no customer data in the
 * base. */
const CUSTOMER_TAG = /\b([Cc]lients?|[Cc]ompany|[Cc]ompanies|[Cc]ustomers?)(:["'`]?|:\s+(?=["'`]?[A-Z])["'`]?|=["'`]?)(?!<name>)[A-Za-z0-9][\w.-]*/g;
/** A tag the scrub missed; the generator refuses the base then. */
export const CUSTOMER_TAG_LEFT = /\b(?:[Cc]lient|[Cc]ompany|[Cc]ustomer)(?::["'`]?|:\s+["'`]?(?=[A-Z])|=["'`]?)(?!<name>)[A-Za-z0-9][\w.-]*/;

export function scrub<T extends { title: string; text: string; keywords?: string }>(section: T): T {
  const clean = (text: string) => text.replace(CUSTOMER_TAG, "$1$2<name>");
  return { ...section, title: clean(section.title), text: clean(section.text), ...(section.keywords ? { keywords: clean(section.keywords) } : {}) };
}

export function clip(text: string, max = SECTION_TEXT_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return (stop > max * 0.6 ? cut.slice(0, stop + 1) : cut).trim();
}

interface Heading { level: number; title: string; body: string }

/** Splits a document at its headings of `levels` (2 means ##). The text
 * before the first heading belongs to the document's title. */
export function splitHeadings(markdown: string, maxLevel: number): { title: string; intro: string; parts: Heading[] } {
  const lines = markdown.replace(/^---\n[\s\S]*?\n---\n/, (front) => {
    const title = /^title:\s*(.+)$/m.exec(front)?.[1]?.replace(/^["']|["']$/g, "");
    const description = /^description:\s*(.+)$/m.exec(front)?.[1]?.replace(/^["']|["']$/g, "");
    return `${title ? `# ${title}\n` : ""}${description ? `${description}\n` : ""}`;
  }).split("\n");
  let title = "";
  const intro: string[] = [];
  const parts: Heading[] = [];
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})\s+(.+?)\s*#*$/.exec(line);
    if (heading && heading[1].length === 1 && !title) { title = heading[2]; continue; }
    if (heading && heading[1].length >= 2 && heading[1].length <= maxLevel) {
      parts.push({ level: heading[1].length, title: heading[2], body: "" });
      continue;
    }
    if (parts.length) parts[parts.length - 1].body += `${line}\n`;
    else intro.push(line);
  }
  return { title, intro: intro.join("\n"), parts };
}

export interface DocInput {
  path: string;
  markdown: string;
  kind: KnowledgeKind;
  /** Section id prefix, `doc` by default. */
  prefix?: string;
  /** Deepest heading that starts a section (2: ##, 3: ###). */
  maxLevel?: number;
  /** Title of the document when it has no # heading. */
  fallbackTitle?: string;
  where?: string;
  access?: string;
}

/** One section per heading (and one for the intro), text clipped. Empty
 * sections are dropped. */
export function docSections(input: DocInput): KnowledgeSection[] {
  const { title, intro, parts } = splitHeadings(input.markdown, input.maxLevel ?? 2);
  const docTitle = title || input.fallbackTitle || input.path;
  const prefix = input.prefix ?? "doc";
  const out: KnowledgeSection[] = [];
  const seen = new Map<string, number>();
  const push = (heading: string, body: string) => {
    const text = clip(plainText(body));
    if (text.length < 40) return;
    let id = `${prefix}:${input.path}#${slug(heading) || "intro"}`;
    const count = seen.get(id) ?? 0;
    seen.set(id, count + 1);
    if (count) id += `-${count + 1}`;
    out.push({
      id,
      kind: input.kind,
      title: heading === docTitle ? docTitle : `${docTitle}: ${heading}`,
      ...(input.where ? { where: input.where } : {}),
      ...(input.access ? { access: input.access } : {}),
      text,
      source: input.path,
    });
  };
  push(docTitle, intro);
  for (const part of parts) push(part.title, part.body);
  return out;
}

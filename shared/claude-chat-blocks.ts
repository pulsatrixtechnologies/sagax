/**
 * Claude harness chat blocks: the Agent SDK `Artifact` tool (a published
 * page with a real URL) and Claude.ai `<antArtifact>` tags that leak into
 * assistant text. Both are untrusted model output. The chat already has
 * equivalents for markdown, ```chart, ```widget, ```email and AskUserQuestion;
 * this module only rewrites what the harness actually emits into those
 * fences or into a small page card. Invented URLs are dropped.
 */

export const ARTIFACT_TOOL = "Artifact";
/** The native artifact family (Claude Code 2.1.288+, CLAUDE_CODE_ARTIFACT). */
export const ARTIFACT_TOOLS: readonly string[] = ["Artifact", "ArtifactData", "ArtifactComments"];
/** The calls of the family that only read: Approve for me runs them unasked. */
export const ARTIFACT_READ_ACTIONS: ReadonlySet<string> = new Set(["list", "read", "get", "query"]);
export const ARTIFACT_HTML_MAX = 200_000;
export const ARTIFACT_TITLE_MAX = 200;

export function isArtifactTool(name: string | undefined): boolean {
  return (name ?? "").trim() === ARTIFACT_TOOL;
}

/** Any tool of the native artifact family. */
export function isArtifactFamilyTool(name: string | undefined): boolean {
  return ARTIFACT_TOOLS.includes((name ?? "").trim());
}

/** A claude.ai artifact link (claude.ai/artifact/<id> or
 * claude.ai/code/artifact/<uuid>): its canonical https URL, or null. */
export function claudeArtifactUrl(value: string | undefined): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  if (url.hostname !== "claude.ai" && url.hostname !== "www.claude.ai") return null;
  const match = /^\/(code\/)?artifact\/([A-Za-z0-9-]{8,64})\/?$/.exec(url.pathname);
  if (!match) return null;
  return `https://claude.ai/${match[1] ?? ""}artifact/${match[2]}`;
}

/** The CLI's words when an artifact belongs to another claude.ai account:
 * its "who made this" consent question, which a print session never
 * forwards to the permission tool (2.1.288 to 2.1.318). */
const CONSENT_REFUSAL = /couldn['\u2019]t check who made this artifact|let claude read it\?|localDisplayOnly/i;

export function isArtifactConsentRefusal(text: string | undefined): boolean {
  return Boolean(text && CONSENT_REFUSAL.test(text));
}

/**
 * Chat message that asks the bot to republish a foreign claude.ai page
 * (#2018 Lot 1). Quebec French: the bot cannot Artifact-read that URL; it
 * publishes from workspace HTML (or a paste) and returns the new URL so
 * references can be updated.
 */
export function claudeArtifactCopyPrompt(url: string): string {
  return `Publie une copie de ${url} depuis ton compte avec claude_artifact. Tu ne peux pas lire cette page (autre compte claude.ai) : publie depuis un fichier HTML de ton workspace (ou un collage), puis donne la nouvelle URL pour mettre à jour les références.`;
}

/**
 * Tool-result guidance when `claude_artifact` hits `other_account` (catalog
 * language: English). Same Lot 1 contract as {@link claudeArtifactCopyPrompt}.
 */
export function claudeArtifactOtherAccountGuidance(account?: string): string {
  const who = account ? ` (the person's Claude account is ${account})` : "";
  return `This artifact belongs to another claude.ai account${who}: you cannot Artifact-read that page. Publish a new copy from an HTML file in your workspace (or a paste) with claude_artifact { tool: "Artifact", input: { action: "publish", ... }, file or html }, then return the new URL so references can be updated.`;
}

/** A wrong-account card: the artifact the engine could not open, and the
 * claude.ai account the engine is signed in to (when known). */
export interface ArtifactConsentBlock {
  url: string;
  account?: string;
}

export function formatArtifactConsentFence(block: ArtifactConsentBlock): string {
  const body: Record<string, string> = { blocked: "other_account", url: block.url };
  if (block.account) body.account = block.account;
  return ["```artifact", JSON.stringify(body), "```"].join("\n");
}

export function parseArtifactConsent(code: string): ArtifactConsentBlock | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(code.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.blocked !== "other_account") return null;
  const url = claudeArtifactUrl(typeof record.url === "string" ? record.url : undefined);
  if (!url) return null;
  const account = typeof record.account === "string" && /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(record.account.trim()) ? record.account.trim() : undefined;
  return { url, ...(account ? { account } : {}) };
}

/** A published page the person can open. `path` is the local file the
 * harness wrote; it never becomes a link. `html` is inlined by the driver
 * when that file is a small HTML/SVG document. */
export interface ArtifactPage {
  title: string;
  url?: string;
  icon?: string;
  path?: string;
  html?: string;
  /** the engine's account owns it (false: shared with it by someone else) */
  owned?: boolean;
}

const CHART_TYPES = new Set(["bar", "line", "area", "pie", "scatter"]);

/** https URLs, plus http on loopback. Userinfo is refused. */
export function isSafeHttpUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return Boolean(url.hostname);
  if (url.protocol === "http:") {
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  }
  return false;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object" && typeof (block as { text?: unknown }).text === "string") {
          return (block as { text: string }).text;
        }
        return "";
      })
      .join("");
  }
  if (content && typeof content === "object" && typeof (content as { text?: unknown }).text === "string") {
    return (content as { text: string }).text;
  }
  return "";
}

/** The published page from an Artifact tool_result, or null for a list
 * action, a failed publish, or a payload without a real URL. */
export function parseArtifactPublish(content: unknown): ArtifactPage | null {
  // Claude Code's structured result (the message's `tool_use_result`) is an
  // object; the tool_result block itself is prose ("Published … at <url>").
  let parsed: unknown = content && typeof content === "object" && !Array.isArray(content) && typeof (content as { text?: unknown }).text !== "string"
    ? content : undefined;
  if (parsed === undefined) {
    const text = toolResultText(content).trim();
    if (!text.startsWith("{")) return null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (Array.isArray(record.artifacts)) return null;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!isSafeHttpUrl(url)) return null;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, ARTIFACT_TITLE_MAX) : "";
  const icon = typeof record.icon === "string" ? record.icon.trim().slice(0, 32) : "";
  const path = typeof record.path === "string" ? record.path.trim() : "";
  return {
    title: title || "Page",
    url,
    ...(icon ? { icon } : {}),
    ...(path ? { path } : {}),
    ...(typeof record.owned === "boolean" ? { owned: record.owned } : {}),
  };
}

/** JSON in a ```artifact fence: a title and an optional real URL. HTML in
 * that fence stays a widget (parseArtifactPage returns null). Chart-shaped
 * JSON is refused so a mis-tagged ```artifact does not become a page card. */
export function parseArtifactPage(code: string): ArtifactPage | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.type === "string" && CHART_TYPES.has(record.type)) return null;
  if (Array.isArray(record.labels) && Array.isArray(record.series)) return null;
  if (Array.isArray(record.artifacts)) return null;
  if (record.blocked !== undefined) return null;
  const title = typeof record.title === "string" ? record.title.trim().slice(0, ARTIFACT_TITLE_MAX) : "";
  const url = typeof record.url === "string" && isSafeHttpUrl(record.url.trim()) ? record.url.trim() : undefined;
  const icon = typeof record.icon === "string" ? record.icon.trim().slice(0, 32) : undefined;
  if (!title && !url) return null;
  return {
    title: title || "Page", ...(url ? { url } : {}), ...(icon ? { icon } : {}),
    ...(typeof record.owned === "boolean" ? { owned: record.owned } : {}),
  };
}

/** The markdown the driver inserts when Artifact publishes. Host paths stay
 * out of the transcript; optional HTML rides a sibling ```widget fence. */
export function formatArtifactFence(page: ArtifactPage): string {
  const body: Record<string, string | boolean> = { title: page.title };
  if (typeof page.owned === "boolean") body.owned = page.owned;
  if (page.url) body.url = page.url;
  if (page.icon) body.icon = page.icon;
  const lines = ["```artifact", JSON.stringify(body), "```"];
  if (page.html) lines.push("", "```widget", page.html.replace(/\n$/, ""), "```");
  return lines.join("\n");
}

const FENCE_BLOCK =
  /(^|\n)((?: {0,3}>[ \t]?)* {0,3})(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n(?: {0,3}>[ \t]?)* {0,3}\3[ \t]*(?=\n|$)|$)/g;

const ANT_ARTIFACT = /<antArtifact\b([^>]*)>([\s\S]*?)<\/antArtifact>/gi;
const ANT_ARTIFACT_OPEN = /<antArtifact\b[^>]*>/i;
const ATTR = /([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)"/g;

function fenceAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR.exec(raw)) !== null) {
    out[match[1]!.toLowerCase()] = match[2]!;
  }
  return out;
}

function fenced(lang: string, body: string): string {
  const text = body.replace(/^\n/, "").replace(/\n$/, "");
  return `\`\`\`${lang}\n${text}\n\`\`\``;
}

function langFromMime(type: string): string | null {
  if (type === "text/javascript" || type === "application/javascript") return "javascript";
  if (type === "text/typescript" || type === "application/typescript") return "typescript";
  if (type === "application/json" || type === "text/json") return "json";
  if (type === "text/css") return "css";
  if (type === "text/x-python" || type === "text/python") return "python";
  if (type.startsWith("text/x-")) return type.slice("text/x-".length);
  return null;
}

function looksLikeChart(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed.startsWith("{")) return false;
  try {
    const parsed = JSON.parse(trimmed) as { type?: unknown };
    return typeof parsed.type === "string" && CHART_TYPES.has(parsed.type);
  } catch {
    return false;
  }
}

/** Turn one Claude.ai artifact tag into the Sagax fence the renderer already
 * knows. React/JSX stays a code fence: the widget sandbox has no network
 * and cannot load React. */
export function antArtifactToMarkdown(attributeSource: string, body: string): string {
  const attrs = fenceAttrs(attributeSource);
  const type = (attrs.type ?? "").trim().toLowerCase();
  const language = (attrs.language ?? "").trim();
  const trimmed = body.replace(/^\n/, "").replace(/\n$/, "");
  if (type === "application/vnd.sagax.cw+json") return fenced("cw", trimmed);
  if (type === "application/vnd.ant.mermaid" || type === "text/mermaid") return fenced("mermaid", trimmed);
  if (type === "text/markdown") return trimmed;
  if (type.includes("chart") || looksLikeChart(trimmed)) return fenced("chart", trimmed);
  if (type === "text/html" || type === "image/svg+xml" || type === "application/vnd.ant.html") {
    return fenced("widget", trimmed);
  }
  if (type === "application/vnd.ant.react" || type.includes("react")) {
    return fenced(language || "jsx", trimmed);
  }
  if (type === "application/vnd.ant.code") return fenced(language || langFromMime(type) || "text", trimmed);
  if (type.startsWith("text/") && type !== "text/plain") {
    return fenced(language || langFromMime(type) || "text", trimmed);
  }
  if (/^\s*</.test(trimmed)) return fenced("widget", trimmed);
  return fenced(language || "text", trimmed);
}

/** Rewrite complete `<antArtifact>` tags into fences. An unclosed tag (the
 * model is still streaming) is dropped so raw XML never flashes in the
 * bubble. Fenced code that documents the tag is left alone. */
export function liftClaudeChatBlocks(text: string): string {
  const parts: string[] = [];
  const protectedText = text.replace(FENCE_BLOCK, (match) => {
    const token = `\u0000OMB_FENCE_${parts.length}\u0000`;
    parts.push(match);
    return token;
  });
  let lifted = protectedText.replace(ANT_ARTIFACT, (_match, attrs: string, body: string) => `\n\n${antArtifactToMarkdown(attrs, body)}\n\n`);
  const unclosed = ANT_ARTIFACT_OPEN.exec(lifted);
  if (unclosed && !/<\/antArtifact>/i.test(lifted.slice(unclosed.index))) {
    lifted = lifted.slice(0, unclosed.index);
  }
  ANT_ARTIFACT_OPEN.lastIndex = 0;
  // NUL tokens cannot appear in model markdown; they mark protected fences.
  // eslint-disable-next-line no-control-regex -- intentional fence placeholders
  return lifted.replace(/\u0000OMB_FENCE_(\d+)\u0000/g, (_match, index: string) => parts[Number(index)] ?? "");
}

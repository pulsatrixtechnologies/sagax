// Reads the xAI Bot Marketplace (https://x.ai/bot/marketplace) for Browse
// Bots (shared/xai-marketplace.ts, docs/xai-marketplace.md). The pages are
// public and rendered on the server: the list page streams every bot's card
// (name, creator, description, categories, colour, shape, share id) in its
// Next.js flight data, and a bot's page streams its memories, skills,
// routines and apps the same way. No sign-in: a page that asks for one, or
// refuses the request, is reported as blocked.
//
// Only https://x.ai (or www) is fetched, redirects must stay there, 20 s and
// 4 MB per page. What a page says is data: it is cut to size, stripped of
// control characters and never run. Both reads are kept for
// XAI_MARKETPLACE_TTL_MS; a refresh reads again, and a refresh that fails
// keeps the earlier copy and says so (stale).
import {
  isXaiMarketplaceSlug,
  XAI_MARKETPLACE_LABEL,
  XAI_MARKETPLACE_TTL_MS,
  XAI_MARKETPLACE_URL,
  xaiMarketplaceBotUrl,
  xaiMarketplaceCategory,
  xaiMarketplaceLook,
  type XaiMarketplaceBot,
  type XaiMarketplaceBotAnswer,
  type XaiMarketplaceEntry,
  type XaiMarketplaceErrorCode,
  type XaiMarketplaceList,
} from "../../shared/xai-marketplace.ts";

type Fetcher = typeof fetch;

const HOSTS = new Set(["x.ai", "www.x.ai"]);
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const MAX_BOTS = 500;
const MAX_DETAILS_KEPT = 200;
const SHARE_ID = /^[A-Za-z0-9_-]{21}$/;

const ERROR_TEXT: Record<XaiMarketplaceErrorCode, string> = {
  xai_unreachable: "The xAI Bot Marketplace could not be reached. Try again in a moment.",
  xai_format: "The xAI Bot Marketplace changed its page, and Sagax cannot read its bots yet.",
  xai_not_found: "That bot is no longer on the xAI Bot Marketplace.",
  xai_blocked: "x.ai refused to show the marketplace to Sagax (it asked for a sign-in or blocked the request).",
};

export class XaiMarketplaceError extends Error {
  readonly code: XaiMarketplaceErrorCode;
  readonly status: number;
  constructor(code: XaiMarketplaceErrorCode, message = ERROR_TEXT[code]) {
    super(message);
    this.name = "XaiMarketplaceError";
    this.code = code;
    this.status = code === "xai_not_found" ? 404 : 502;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Page text as a short plain value: control characters out, cut to size. */
function text(value: unknown, max: number): string {
  // eslint-disable-next-line no-control-regex
  return typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, max) : "";
}
const line = (value: unknown, max: number) => text(value, max).replace(/\s+/g, " ");

/** The Next.js flight data the page streams in `self.__next_f.push([1,"…"])` scripts, decoded and joined. */
export function flightData(html: string): string {
  const marker = "self.__next_f.push([1,";
  const parts: string[] = [];
  for (let at = html.indexOf(marker); at >= 0; at = html.indexOf(marker, at + marker.length)) {
    const start = at + marker.length;
    if (html[start] !== '"') continue;
    let end = start + 1;
    while (end < html.length && html[end] !== '"') end += html[end] === "\\" ? 2 : 1;
    try {
      const chunk: unknown = JSON.parse(html.slice(start, end + 1));
      if (typeof chunk === "string") parts.push(chunk);
    } catch {
      // not a plain string chunk
    }
  }
  return parts.join("");
}

/** The JSON object or array that starts at `start`, or null. */
function jsonAt(data: string, start: number, maxChars = 1_000_000): unknown {
  const open = data[start];
  if (open !== "{" && open !== "[") return null;
  let depth = 0;
  let quoted = false;
  for (let i = start; i < data.length && i - start < maxChars; i += 1) {
    const c = data[i];
    if (quoted) {
      if (c === "\\") i += 1;
      else if (c === '"') quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === "{" || c === "[") depth += 1;
    else if ((c === "}" || c === "]") && --depth === 0) {
      try {
        return JSON.parse(data.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** A long text the flight data moved to a row of its own (`"$6b"` → `6b:T<hex bytes>,<text>`). */
function textRow(data: string, ref: string): string | null {
  const match = new RegExp(`(?:^|\\n|[\\]}"])${ref}:T([0-9a-f]+),`).exec(data);
  if (!match) return null;
  const bytes = Number.parseInt(match[1]!, 16);
  if (!Number.isFinite(bytes) || bytes > 256_000) return null;
  const rest = Buffer.from(data.slice(match.index + match[0].length, match.index + match[0].length + bytes + 16), "utf8");
  return rest.subarray(0, bytes).toString("utf8");
}

/** A string field, following a `$<id>` reference to its text row. */
function field(data: string, value: unknown): unknown {
  if (typeof value === "string" && /^\$[0-9a-f]+$/.test(value)) return textRow(data, value.slice(1)) ?? "";
  return value;
}

/** A card record as the page streams it, or null when it is not one. */
function entryOf(data: string, value: unknown): XaiMarketplaceEntry | null {
  if (!isRecord(value)) return null;
  const slug = typeof value.id === "string" ? value.id : "";
  const name = line(value.name, 100);
  if (!isXaiMarketplaceSlug(slug) || !name || typeof value.creatorName !== "string") return null;
  const share = typeof value.addHref === "string" ? /^\/bot\/([A-Za-z0-9_-]+)$/.exec(value.addHref)?.[1] : undefined;
  const description = text(field(data, value.description), 2_000) || text(field(data, value.summary), 2_000);
  return {
    slug,
    name,
    creator: line(value.creatorName, 100),
    description,
    categories: Array.isArray(value.categories) ? value.categories.map((category) => line(category, 60)).filter(Boolean).slice(0, 10) : [],
    color: line(value.color, 20).toLowerCase(),
    shape: line(value.shape, 20).toLowerCase(),
    ...(share && SHARE_ID.test(share) ? { shareId: share } : {}),
    url: xaiMarketplaceBotUrl(slug),
  };
}

/** Every record in the flight data that starts with `{"id":"…","name":` (the cards). */
function records(data: string): unknown[] {
  const out: unknown[] = [];
  for (let at = data.indexOf('{"id":"'); at >= 0; at = data.indexOf('{"id":"', at + 7)) {
    const head = data.slice(at, at + 200);
    if (!/^\{"id":"[a-z0-9-]+","name":"/.test(head)) continue;
    const value = jsonAt(data, at, 512_000);
    if (value) out.push(value);
  }
  return out;
}

/** The catalog order the page declares for search engines (JSON-LD ItemList "#catalog"). */
function catalogOrder(html: string): string[] {
  for (const match of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let value: unknown;
    try { value = JSON.parse(match[1]!); } catch { continue; }
    const graph = isRecord(value) && Array.isArray(value["@graph"]) ? value["@graph"] : [];
    for (const node of graph) {
      if (!isRecord(node) || typeof node["@id"] !== "string" || !node["@id"].endsWith("#catalog") || !Array.isArray(node.itemListElement)) continue;
      return node.itemListElement.flatMap((item) => {
        const url = isRecord(item) && typeof item.url === "string" ? item.url : "";
        const slug = /\/bot\/marketplace\/bots\/([a-z0-9-]+)$/.exec(url)?.[1];
        return slug ? [slug] : [];
      });
    }
  }
  return [];
}

/** The marketplace list page: every bot once, in the page's catalogue order. */
export function parseXaiMarketplaceList(html: string): XaiMarketplaceEntry[] {
  const data = flightData(html);
  const bySlug = new Map<string, XaiMarketplaceEntry>();
  for (const record of records(data)) {
    const entry = entryOf(data, record);
    if (!entry) continue;
    const known = bySlug.get(entry.slug);
    // The featured row repeats a bot with fewer fields: keep the fullest.
    if (!known || (!known.shareId && entry.shareId) || (!known.description && entry.description)) bySlug.set(entry.slug, { ...known, ...entry });
    if (bySlug.size >= MAX_BOTS) break;
  }
  if (!bySlug.size) throw new XaiMarketplaceError("xai_format");
  const order = catalogOrder(html);
  const rank = new Map(order.map((slug, index) => [slug, index]));
  return [...bySlug.values()].sort((a, b) => (rank.get(a.slug) ?? order.length) - (rank.get(b.slug) ?? order.length));
}

/** One bot's page: its card plus memories, skills, routines and apps. */
export function parseXaiMarketplaceBot(html: string, slug: string): XaiMarketplaceBot {
  const data = flightData(html);
  const candidates = records(data).filter((value) => isRecord(value) && value.id === slug);
  const record = candidates.find((value) => isRecord(value) && Array.isArray(value.memories)) ?? candidates[0];
  const entry = entryOf(data, record);
  if (!entry || !isRecord(record)) throw new XaiMarketplaceError("xai_format");
  const list = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord).slice(0, 100) : []);
  return {
    ...entry,
    instructions: text(field(data, record.instructions), 64_000),
    memories: list(record.memories).map((memory) => text(field(data, memory.description ?? memory.content), 8_000)).filter(Boolean),
    skills: list(record.skills).flatMap((skill) => {
      const name = line(skill.name, 100);
      return name ? [{ name, description: text(field(data, skill.description ?? skill.content), 4_000) }] : [];
    }),
    routines: list(record.routines).flatMap((routine) => {
      const name = line(routine.name, 100);
      return name ? [{ name, summary: text(field(data, routine.summary ?? routine.description), 2_000) }] : [];
    }),
    integrations: list(record.integrations).flatMap((integration) => {
      const name = line(integration.name, 100);
      return name ? [{ name, description: line(field(data, integration.description), 240) }] : [];
    }),
  };
}

async function readCapped(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_PAGE_BYTES) throw new XaiMarketplaceError("xai_format", "That x.ai page is larger than Sagax reads.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_PAGE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new XaiMarketplaceError("xai_format", "That x.ai page is larger than Sagax reads.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** A page of x.ai: only https://x.ai (or www) and redirects that stay there. */
export async function fetchXaiPage(url: string, fetcher: Fetcher = fetch): Promise<string> {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let target = new URL(url);
  try {
    for (let hop = 0; ; hop += 1) {
      if (target.protocol !== "https:" || !HOSTS.has(target.hostname) || target.username || target.password || target.port) {
        // A sign-in page or anything else off x.ai.
        throw new XaiMarketplaceError("xai_blocked");
      }
      const response = await fetcher(target.toString(), { headers: { accept: "text/html" }, redirect: "manual", signal });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || hop >= MAX_REDIRECTS) throw new XaiMarketplaceError("xai_unreachable");
        target = new URL(location, target);
        continue;
      }
      if (response.status === 404 || response.status === 410) throw new XaiMarketplaceError("xai_not_found");
      if (response.status === 401 || response.status === 403 || response.status === 429) throw new XaiMarketplaceError("xai_blocked");
      if (!response.ok) throw new XaiMarketplaceError("xai_unreachable");
      return await readCapped(response);
    }
  } catch (error) {
    if (error instanceof XaiMarketplaceError) throw error;
    // Network failure, DNS, timeout, a reset: the source is out of reach.
    throw new XaiMarketplaceError("xai_unreachable");
  }
}

interface Kept<T> { at: number; value: T }

/** The marketplace, read on demand and kept for a few hours. */
export class XaiMarketplaceSource {
  private readonly fetcher: Fetcher;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private list: Kept<XaiMarketplaceEntry[]> | null = null;
  private listLoad: Promise<Kept<XaiMarketplaceEntry[]>> | null = null;
  private readonly bots = new Map<string, Kept<XaiMarketplaceBot>>();
  private readonly botLoads = new Map<string, Promise<Kept<XaiMarketplaceBot>>>();

  constructor(options: { fetcher?: Fetcher; now?: () => number; ttlMs?: number } = {}) {
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? XAI_MARKETPLACE_TTL_MS;
  }

  private fresh<T>(kept: Kept<T> | null | undefined): kept is Kept<T> {
    return Boolean(kept) && this.now() - kept!.at < this.ttlMs;
  }

  async listBots(options: { refresh?: boolean } = {}): Promise<XaiMarketplaceList> {
    const answer = (kept: Kept<XaiMarketplaceEntry[]>, stale?: XaiMarketplaceErrorCode): XaiMarketplaceList =>
      ({
        label: XAI_MARKETPLACE_LABEL,
        url: XAI_MARKETPLACE_URL,
        fetchedAt: kept.at,
        bots: kept.value.map((entry) => ({ ...entry, look: xaiMarketplaceLook(entry), category: xaiMarketplaceCategory(entry.categories) })),
        ...(stale ? { stale: { code: stale } } : {}),
      });
    if (!options.refresh && this.fresh(this.list)) return answer(this.list);
    this.listLoad ??= (async () => {
      const value = parseXaiMarketplaceList(await fetchXaiPage(XAI_MARKETPLACE_URL, this.fetcher));
      return { at: this.now(), value };
    })().finally(() => { this.listLoad = null; });
    try {
      this.list = await this.listLoad;
      return answer(this.list);
    } catch (error) {
      if (this.list && error instanceof XaiMarketplaceError) return answer(this.list, error.code);
      throw error;
    }
  }

  async bot(slug: string, options: { refresh?: boolean } = {}): Promise<XaiMarketplaceBotAnswer> {
    if (!isXaiMarketplaceSlug(slug)) throw new XaiMarketplaceError("xai_not_found");
    const kept = this.bots.get(slug);
    if (!options.refresh && this.fresh(kept)) return { fetchedAt: kept.at, bot: kept.value };
    let load = this.botLoads.get(slug);
    if (!load) {
      load = (async () => {
        const value = parseXaiMarketplaceBot(await fetchXaiPage(xaiMarketplaceBotUrl(slug), this.fetcher), slug);
        return { at: this.now(), value };
      })().finally(() => { this.botLoads.delete(slug); });
      this.botLoads.set(slug, load);
    }
    try {
      const next = await load;
      this.bots.delete(slug);
      this.bots.set(slug, next);
      while (this.bots.size > MAX_DETAILS_KEPT) this.bots.delete(this.bots.keys().next().value!);
      return { fetchedAt: next.at, bot: next.value };
    } catch (error) {
      if (kept && error instanceof XaiMarketplaceError && error.code !== "xai_not_found") return { fetchedAt: kept.at, bot: kept.value, stale: { code: error.code } };
      throw error;
    }
  }
}

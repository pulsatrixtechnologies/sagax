// The bot panel's Computer row thumbnail (2026-11-06: the desktop picture
// is a screenshot of the bot's own computer, and switching the row to the
// user's own computer shows that computer). One small, recent picture per bot and per
// computer, so switching the row to another computer shows that computer at
// once and never the previous one.
//
// Sources, all existing captures:
//   - the screen poller of a turn (server/index-leaves/startScreenPoller.ts):
//     every frame the bot's computer sends while it works, keyed by the
//     turn's computer resource (thumbnailComputerForResource);
//   - the desktop app of the person (PUT /api/bots/:id/computer/thumbnail,
//     server/routes/computer-thumbnail.ts): a low resolution capture of their
//     own computer, kept for that person only.
//
// Kept in memory: the newest capture of each computer, the full frame for the
// larger preview and a copy scaled to THUMBNAIL_WIDTH for the row.
import { rasterSize, resvgScale, type ScaleRenderer } from "../models/model-image.ts";

/** Width of the served thumbnail (the row draws it at 46 px, 2x and 3x screens). */
export const THUMBNAIL_WIDTH = 160;

/** Which computer a thumbnail belongs to: the place, with the person's
 * computer id when the place is one of their named computers. */
export const THUMBNAIL_COMPUTER = /^(?:local|vm|cloud)(?::[\w.-]{1,80})?$/;

export type ThumbnailMime = "image/png" | "image/jpeg" | "image/webp";

export interface ComputerThumbnail {
  computer: string;
  /** When the capture was taken (ms since epoch). */
  at: number;
  mime: ThumbnailMime;
  /** The capture as taken. */
  full: Buffer;
  /** THUMBNAIL_WIDTH wide; the capture itself when it could not be scaled. */
  thumb: Buffer;
  thumbMime: ThumbnailMime;
}

/** The thumbnail computer a turn's computer resource stands for. */
export function thumbnailComputerForResource(resource: string | undefined): string | null {
  if (!resource) return null;
  if (resource === "computer:host") return "local";
  if (resource.startsWith("computer:vm:")) return "vm";
  if (resource.startsWith("computer:box:") || resource.startsWith("computer:box-bot:") || resource.startsWith("computer:vps:")) return "cloud";
  return null;
}

export function thumbnailMime(value: unknown): ThumbnailMime | null {
  const mime = typeof value === "string" ? value.trim().toLowerCase() : "";
  return mime === "image/png" || mime === "image/jpeg" || mime === "image/webp" ? mime : null;
}

/** A data URL's picture, or null when it is not a PNG, JPEG or WebP. */
export function decodeImageDataUrl(value: unknown): { mime: ThumbnailMime; bytes: Buffer } | null {
  if (typeof value !== "string") return null;
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value.trim());
  if (!match) return null;
  const bytes = Buffer.from(match[2]!, "base64");
  return bytes.length > 0 && rasterSize(bytes) ? { mime: match[1] as ThumbnailMime, bytes } : null;
}

const key = (botId: string, computer: string, viewer: string) => `${botId}\u0000${computer}\u0000${viewer}`;

export class ComputerThumbnails {
  private readonly items = new Map<string, ComputerThumbnail>();
  private readonly pending = new Map<string, Promise<void>>();

  private readonly options: { render?: ScaleRenderer; now?: () => number };

  constructor(options: { render?: ScaleRenderer; now?: () => number } = {}) {
    this.options = options;
  }

  /** Keep `bytes` as the newest capture of this computer. `viewer` is the
   * person it belongs to ("" for a capture any viewer of the bot may see). */
  async record(botId: string, computer: string, input: { bytes: Buffer; mime: ThumbnailMime }, viewer = "", at?: number): Promise<ComputerThumbnail | null> {
    if (!THUMBNAIL_COMPUTER.test(computer) || input.bytes.length === 0) return null;
    const id = key(botId, computer, viewer);
    // One scale at a time per computer: a slower older frame never wins.
    const previous = this.pending.get(id) ?? Promise.resolve();
    let result: ComputerThumbnail | null = null;
    const next = previous.then(async () => {
      const taken = at ?? this.options.now?.() ?? Date.now();
      const current = this.items.get(id);
      if (current && current.at > taken) return;
      const scaled = await this.scale(input.bytes, input.mime);
      result = { computer, at: taken, mime: input.mime, full: input.bytes, thumb: scaled.bytes, thumbMime: scaled.mime };
      this.items.set(id, result);
    }).catch(() => undefined);
    this.pending.set(id, next);
    await next;
    if (this.pending.get(id) === next) this.pending.delete(id);
    return result;
  }

  /** The newest capture of `computer` this viewer may see: their own first,
   * and the bot's shared one when `shared` allows it, the newest winning. "auto" is the newest
   * capture of any computer. */
  get(botId: string, computer: string, viewer = "", shared = true): ComputerThumbnail | null {
    const scopes = viewer ? (shared ? [viewer, ""] : [viewer]) : (shared ? [""] : []);
    let best: ComputerThumbnail | null = null;
    for (const [id, item] of this.items) {
      const [bot, itemComputer, itemViewer] = id.split("\u0000");
      if (bot !== botId || !scopes.includes(itemViewer!)) continue;
      if (computer !== "auto" && itemComputer !== computer) continue;
      if (!best || item.at > best.at) best = item;
    }
    return best;
  }

  forget(botId: string): void {
    for (const id of this.items.keys()) if (id.startsWith(`${botId}\u0000`)) this.items.delete(id);
  }

  private async scale(bytes: Buffer, mime: ThumbnailMime): Promise<{ bytes: Buffer; mime: ThumbnailMime }> {
    const size = rasterSize(bytes);
    if (!size || size.width <= THUMBNAIL_WIDTH || mime === "image/webp") return { bytes, mime };
    const width = THUMBNAIL_WIDTH;
    const height = Math.max(1, Math.round(size.height * (width / size.width)));
    try {
      const render = this.options.render ?? resvgScale;
      const out = await render(bytes, mime, { width, height });
      return out.length > 0 ? { bytes: out, mime: "image/png" } : { bytes, mime };
    } catch {
      return { bytes, mime };
    }
  }
}

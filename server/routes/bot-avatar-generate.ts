import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, Store } from "../store.ts";
import type { WireBot } from "../../shared/wire.ts";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar.ts";
import { BANNER_FOCUS_CENTER, BANNER_ZOOM_MIN } from "../../shared/bot-banner.ts";
import { avatarGenerationRequestSchema, avatarGenerationStateMatches, snapshotAvatarGenerationState, generateAvatarImage } from "../media/avatar-image.ts";
import type { ImageLanguage } from "../media/image-words.ts";
import { saveImage, deleteAttachment } from "../attachments/attachments.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotAvatarGenerateRouteDeps {
  store: Pick<Store, "bot" | "patchBot">;
  ownerOrAdminOf: (auth: RequestAuth, bot: BotRecord) => boolean;
  requesterPrincipal: (auth: RequestAuth) => string | null;
  orgAvatarImageConfig: (principalId: string | null) => Promise<Parameters<typeof generateAvatarImage>[0] | null>;
  /** #5223: the refusal in the asking person's language. */
  orgXaiRefusal: (kind: "image", language?: ImageLanguage) => Record<string, unknown>;
  /** The asking person's language for a refusal (#5223). */
  personLanguage?: (principalId: string | null) => ImageLanguage;
  wireBot: (bot: BotRecord) => WireBot;
  broadcast: (frame: { kind: "bot"; bot: WireBot }) => void;
}

type BannerGenerationState = Pick<BotRecord, "bannerUrl">;

function snapshotBannerGenerationState(bot: BannerGenerationState): BannerGenerationState {
  return { bannerUrl: bot.bannerUrl };
}

function bannerGenerationStateMatches(initial: BannerGenerationState, current: BannerGenerationState): boolean {
  return current.bannerUrl === initial.bannerUrl;
}

export function createBotAvatarGenerateRoutes(deps: BotAvatarGenerateRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const { store, ownerOrAdminOf, requesterPrincipal, orgAvatarImageConfig, orgXaiRefusal, personLanguage, wireBot, broadcast } = deps;
    const avatarMatch = path.match(/^\/api\/bots\/([\w-]+)\/avatar\/generate$/);
    const bannerMatch = path.match(/^\/api\/bots\/([\w-]+)\/banner\/generate$/);
    const m = avatarMatch ?? bannerMatch;
    const purpose = bannerMatch ? "banner" as const : "avatar" as const;
    if (m && method === "POST") {
      const existing = store.bot(m[1]);
      if (!existing) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      // A chat-scoped session (a phone) generates only for a bot it owns or
      // may edit; admins and the owner at this computer for any.
      if (!ownerOrAdminOf(auth, existing)) {
        json(res, 403, {
          error: purpose === "banner"
            ? "forbidden: only the bot owner or an admin can change its banner"
            : "forbidden: only the bot owner or an admin can change its picture",
          code: purpose === "banner" ? "bot_banner_owner_only" : "bot_picture_owner_only",
        });
        return;
      }
      // Generation is slow and both desktop and companion clients may edit or
      // delete this bot while it is in flight. Snapshot the fields this
      // request owns before the first await so a late result cannot win.
      const initialAvatar = purpose === "avatar" ? snapshotAvatarGenerationState(existing) : null;
      const initialBanner = purpose === "banner" ? snapshotBannerGenerationState(existing) : null;
      // 2026-10-16: on the organization's xAI key only for the person asking.
      const principalId = requesterPrincipal(auth);
      const imageCfg = await orgAvatarImageConfig(principalId);
      if (!imageCfg) {
        json(res, 403, orgXaiRefusal("image", personLanguage?.(principalId)));
        return;
      }
      const parsed = avatarGenerationRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) {
        json(res, 400, { error: `prompt must be at most 400 characters` });
        return;
      }
      const generated = await generateAvatarImage(imageCfg, existing, parsed.data.prompt, fetch, undefined, purpose);
      const current = store.bot(existing.id);
      if (!current) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      if (purpose === "avatar" && initialAvatar && !avatarGenerationStateMatches(initialAvatar, current)) {
        json(res, 409, { error: "avatar changed while generation was in progress" });
        return;
      }
      if (purpose === "banner" && initialBanner && !bannerGenerationStateMatches(initialBanner, current)) {
        json(res, 409, { error: "banner changed while generation was in progress" });
        return;
      }
      const saved = saveImage(generated.bytes, generated.mime);
      const storedUrl = botAvatarUrlFromStoredPath(saved.path);
      if (!storedUrl) throw Object.assign(new Error(purpose === "banner" ? "Could not store the generated banner" : "Could not store the generated avatar"), { status: 500 });
      const bot = purpose === "banner"
        ? store.patchBot(current.id, {
            bannerUrl: storedUrl,
            bannerPreset: undefined,
            bannerZoom: BANNER_ZOOM_MIN,
            bannerFocusX: BANNER_FOCUS_CENTER,
            bannerFocusY: BANNER_FOCUS_CENTER,
          })
        : store.patchBot(current.id, {
            avatarUrl: storedUrl,
            avatarCrop: initialAvatar?.avatarCrop && initialAvatar.avatarCrop !== "mascot"
              ? initialAvatar.avatarCrop
              : "circle",
          });
      if (!bot) {
        // There are no awaits between the refreshed lookup and this patch, but
        // keep the attachment invariant explicit if the store ever changes.
        deleteAttachment(saved.path);
        json(res, 404, { error: "no such bot" });
        return;
      }
      const visible = wireBot(bot);
      broadcast({ kind: "bot", bot: visible });
      json(res, 201, purpose === "banner" ? { bannerUrl: storedUrl, bot: visible } : { avatarUrl: storedUrl, bot: visible });
      return;
    }
    return PASS;
  };
}

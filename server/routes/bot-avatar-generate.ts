import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, Store } from "../store.ts";
import type { WireBot } from "../../shared/wire.ts";
import { botAvatarUrlFromStoredPath } from "../../shared/bot-avatar.ts";
import { avatarGenerationRequestSchema, avatarGenerationStateMatches, snapshotAvatarGenerationState, generateAvatarImage } from "../media/avatar-image.ts";
import { saveImage, deleteAttachment } from "../attachments/attachments.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotAvatarGenerateRouteDeps {
  store: Pick<Store, "bot" | "patchBot">;
  ownerOrAdminOf: (auth: RequestAuth, bot: BotRecord) => boolean;
  requesterPrincipal: (auth: RequestAuth) => string | null;
  orgAvatarImageConfig: (principalId: string | null) => Parameters<typeof generateAvatarImage>[0] | null;
  orgXaiRefusal: (kind: "image") => Record<string, unknown>;
  wireBot: (bot: BotRecord) => WireBot;
  broadcast: (frame: { kind: "bot"; bot: WireBot }) => void;
}

export function createBotAvatarGenerateRoutes(deps: BotAvatarGenerateRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const { store, ownerOrAdminOf, requesterPrincipal, orgAvatarImageConfig, orgXaiRefusal, wireBot, broadcast } = deps;
    const m = path.match(/^\/api\/bots\/([\w-]+)\/avatar\/generate$/);
    if (m && method === "POST") {
      const existing = store.bot(m[1]);
      if (!existing) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      // A chat-scoped session (a phone) generates only for a bot it owns or
      // may edit; admins and the owner at this computer for any.
      if (!ownerOrAdminOf(auth, existing)) {
        json(res, 403, { error: "forbidden: only the bot owner or an admin can change its picture", code: "bot_picture_owner_only" });
        return;
      }
      // Generation is slow and both desktop and companion clients may edit or
      // delete this bot while it is in flight. Snapshot the two fields this
      // request owns before the first await so a late result cannot win.
      const initialAvatar = snapshotAvatarGenerationState(existing);
      // 2026-10-16: on the organization's xAI key only for the person asking.
      const imageCfg = orgAvatarImageConfig(requesterPrincipal(auth));
      if (!imageCfg) {
        json(res, 403, orgXaiRefusal("image"));
        return;
      }
      const parsed = avatarGenerationRequestSchema.safeParse(await readBody(req));
      if (!parsed.success) {
        json(res, 400, { error: `prompt must be at most 400 characters` });
        return;
      }
      const generated = await generateAvatarImage(imageCfg, existing, parsed.data.prompt);
      const current = store.bot(existing.id);
      if (!current) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      if (!avatarGenerationStateMatches(initialAvatar, current)) {
        json(res, 409, { error: "avatar changed while generation was in progress" });
        return;
      }
      const saved = saveImage(generated.bytes, generated.mime);
      const avatarUrl = botAvatarUrlFromStoredPath(saved.path);
      if (!avatarUrl) throw Object.assign(new Error("Could not store the generated avatar"), { status: 500 });
      const avatarCrop = initialAvatar.avatarCrop && initialAvatar.avatarCrop !== "mascot"
        ? initialAvatar.avatarCrop
        : "circle";
      const bot = store.patchBot(current.id, { avatarUrl, avatarCrop });
      if (!bot) {
        // There are no awaits between the refreshed lookup and this patch, but
        // keep the attachment invariant explicit if the store ever changes.
        deleteAttachment(saved.path);
        json(res, 404, { error: "no such bot" });
        return;
      }
      const visible = wireBot(bot);
      broadcast({ kind: "bot", bot: visible });
      json(res, 201, { avatarUrl, bot: visible });
      return;
    }
    return PASS;
  };
}

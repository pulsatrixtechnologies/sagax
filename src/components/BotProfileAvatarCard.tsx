// The bot's avatar at the top of the bot panel and of the bot's profile page.
// It plays the bot's moves as they happen (mascotMotion from the store) and
// opens the bot's profile page when clicked (#2126); on the profile page
// itself a click opens the mascot picker under the mascot
// (floating-bots/MascotPickerPopover).
// A right click opens the bot panel's "..." menu where the pointer is. In
// the New bot dialog the bot is a draft the store does not hold yet, so the
// click opens the same mascot picker under the draft's avatar.
// A picture dropped on the avatar, or pasted while it has focus, becomes the
// bot's picture through the same upload as the Appearance pane (25 MB).
// A shape mascot drawn large here (88 px and up) is turned by hand, as on the
// open-bot-avatar site's stage (#5384, floating-bots/use-mascot-turn.tsx): a
// drag turns it, a press that barely moved is still the click.
import { useRef, useState } from "react";

import { avatarImageFrom, dragMayCarryImage } from "@/lib/avatar-input";
import { cn } from "@/lib/cn";

import type { Bot } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { t } from "@/lib/i18n";
import { agentStateForBot, type MausMotion, type MausState } from "@/lib/mascot";
import { BotAvatar } from "./Avatar";
import { MascotPickerPopover } from "./floating-bots/MascotPickerPopover";
import { MascotGlassCaustic, MascotTurnReset, turnCursor, useMascotTurn } from "./floating-bots/use-mascot-turn";
import { ShapeStageContext } from "./shape-stage";
import { completeMascotLook, withEngineLook, type MascotLook } from "../../shared/mascot-look";
import { useAvatarSources, type AvatarPatch } from "./appearance/AvatarSources";

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
  onContextMenu,
  size = 144,
  onOpen,
  fillBox = false,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
  /** A right click on the mascot (the bot panel opens the bot's "..." menu
   * there). The pencil badge is gone (2026-10-14): a click on the mascot
   * opens the editor, and the "..." menu has Edit bot. */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  /** The mascot's size: 92 in the bot panel (#2196, Grok Bot parity); 144 on
   * the profile page; the bot wizard's Identity step draws it at 104. */
  size?: number;
  /** What a click does instead of opening the profile page (the profile
   * page goes to its Appearance section). */
  onOpen?: () => void;
  /** Draw the mascot as large as its box, as the reference does in its
   * panel (#4151: a 64px mark that fills its box, BotAvatar fillBox). */
  fillBox?: boolean;
}) {
  const dispatch = useStoreDispatch();
  const { draft } = useBotEditor();
  const [draftOpen, setDraftOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const avatarRef = useRef<HTMLButtonElement>(null);
  const sources = useAvatarSources(bot, onPatch);
  // only the large mascot is turned (the engine's live size, ShapeMascot LIVE_MIN); a picture never is
  const wearsPicture = (bot.avatarCrop ?? "mascot") !== "mascot" && Boolean(bot.avatarUrl);
  const turn = useMascotTurn({
    look: size >= 88 ? bot.mascotLook : null,
    picture: wearsPicture || size < 88,
    onMood: (mood) => onPatch({ mascotLook: withEngineLook(completeMascotLook(bot.mascotLook), { mood }) as MascotLook }),
  });
  const open = () => {
    if (draft) setDraftOpen((value) => !value);
    else if (onOpen) onOpen();
    else dispatch({ type: "openPersonaEditor", botId: bot.id });
  };

  return (
    <div className="relative">
      {/* room above for a move's jump and effects: the panel scrolls, so anything past its top is cut by a straight edge.
          pt-5 from 80px up (panel 92, wizard 104, profile 144) so a jump clears the box. */}
      <div className={cn("flex justify-center pb-0", size >= 80 ? "pt-5" : "pt-3")}>
        <span
          className="relative inline-flex"
          data-mascot-turn={turn.enabled ? (turn.dragging ? "dragging" : "") : undefined}
          // Escape on the avatar or its Reset view button, the draft's picker open: once the mascot has nothing to
          // cancel the key closes the picker alone, never the window around it (the picker's own Escape, #5369)
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || !(draft && draftOpen)) return;
            event.preventDefault();
            setDraftOpen(false);
          }}
        >
        <button
          ref={avatarRef}
          type="button"
          aria-label={t("botPanel.avatar.edit")}
          aria-expanded={draft ? draftOpen : undefined}
          data-avatar-edit=""
          onClick={open}
          {...turn.handlers}
          aria-description={turn.enabled ? t("mascotStage.hint") : undefined}
          onContextMenu={onContextMenu}
          onDragOver={(event) => {
            if (sources.busy || !dragMayCarryImage(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropping(true);
          }}
          onDragLeave={() => setDropping(false)}
          onDrop={(event) => {
            setDropping(false);
            const file = avatarImageFrom(event.dataTransfer);
            if (!file) return;
            // preventDefault tells the chat's window drop target (ComposerAttachments) it is taken
            event.preventDefault();
            void sources.upload(file);
          }}
          onPaste={(event) => {
            const file = avatarImageFrom(event.clipboardData);
            if (!file) return;
            // the chat's own drop and paste targets must not also take it
            event.preventDefault();
            event.stopPropagation();
            void sources.upload(file);
          }}
          title={t("botPanel.avatar.dropOrPaste")}
          data-avatar-dropping={dropping ? "" : undefined}
          className={cn("relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent", turnCursor(turn), dropping && "ring-2 ring-accent")}
        >
          <ShapeStageContext.Provider value={turn.stage}>
          <MascotGlassCaustic turn={turn} bot={bot} state={agentStateForBot(bot)} />
          <BotAvatar
            bot={bot}
            state={activeState}
            size={size}
            fillBox={fillBox}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
          </ShapeStageContext.Provider>
        </button>
        <MascotTurnReset turn={turn} className="-right-3 top-0" />
        </span>
      </div>
      {sources.error && <p role="alert" className="-mt-1 pb-2 text-center text-[11.5px] text-danger">{sources.error}</p>}
      {draft && draftOpen && (
        <MascotPickerPopover
          bot={bot}
          anchorRef={avatarRef}
          onPatch={onPatch}
          onClose={() => setDraftOpen(false)}
          onUseMascot={(bot.avatarCrop ?? "mascot") !== "mascot" ? () => onPatch({ avatarCrop: "mascot" }) : undefined}
        />
      )}
    </div>
  );
}

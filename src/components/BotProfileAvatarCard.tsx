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
// A shape mascot is turned by hand here, as on the open-bot-avatar site's
// stage (#5384, floating-bots/use-mascot-turn.tsx): a drag turns it, a press
// that barely moved is still the click. The bot panel's own avatar is drawn
// under the live size (64 px, filled to its box): at rest it stays the still
// image it was, and moves only while it is turned (shape-stage.ts, `small`).
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
import { LIVE_MIN } from "./ShapeMascot";
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
  /** The mascot's size: 64 in the bot panel, filled to its box (#4151); 144 on
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
  // a picture is never turned
  const wearsPicture = (bot.avatarCrop ?? "mascot") !== "mascot" && Boolean(bot.avatarUrl);
  const turn = useMascotTurn({
    look: bot.mascotLook,
    picture: wearsPicture,
    small: size < LIVE_MIN,
    onMood: (mood) => onPatch({ mascotLook: withEngineLook(completeMascotLook(bot.mascotLook), { mood }) as MascotLook }),
  });
  const poking = useRef(false);
  const open = (event: React.MouseEvent<HTMLButtonElement>) => {
    // the poke below, coming back up: it is the drawing's click, not a second one on the avatar
    if (poking.current) return;
    if (draft) setDraftOpen((value) => !value);
    else if (onOpen) onOpen();
    else dispatch({ type: "openPersonaEditor", botId: bot.id });
    // A click pokes the mascot, as it did when the pointer landed on the drawing (a shape winks, ShapeMascot):
    // the pointer lands on the button now, so the button hands its click on to the drawing.
    const drawn = event.currentTarget.querySelector("[data-shape]");
    if (!drawn) return;
    poking.current = true;
    try { drawn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); } finally { poking.current = false; }
  };

  return (
    <div className="relative">
      {/* room above for a move's jump and effects: the panel scrolls, so anything past its top is cut by a straight edge.
          pt-5 from 80px up (wizard 104, profile 144; the panel's 64 is under it) so a jump clears the box. */}
      <div className={cn("flex justify-center pb-0", size >= 80 ? "pt-5" : "pt-3")}>
        <span
          className="relative inline-flex"
          data-mascot-turn={turn.enabled ? (turn.dragging ? "dragging" : "") : undefined}
          // Escape on a turned-by-hand avatar or its Reset view button, the draft's picker open: once the mascot has
          // nothing to cancel the key closes the picker alone, never the window around it (the picker's own Escape,
          // #5369). A character that is not turned keeps the key where it went before.
          onKeyDown={(event) => {
            if (!turn.enabled || event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing || !(draft && draftOpen)) return;
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
          // The pointer never lands on the drawing (pointer-events is inherited): a moving drawing rewrites its
          // nodes on every frame, and a press whose node is gone at the release is no click for the browser.
          // The button's own layer over its whole box takes the pointer instead, corners included: the box is
          // round, and the drawing's corners were part of what a press reached.
          className={cn("relative rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent [&>*]:pointer-events-none after:absolute after:inset-0 after:content-['']", turnCursor(turn), dropping && "ring-2 ring-accent")}
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

// The bot's avatar at the top of the bot panel and of the persona editor's
// Overview. It plays the bot's moves as they happen (mascotMotion from the
// store) and opens the persona editor on Appearance when clicked, where the
// character, its look and the picture sources live (appearance/AppearancePane).
// A right click opens the bot panel's "..." menu where the pointer is. In
// the New bot dialog the bot is a draft the store does not hold yet, so the
// click shows the same Appearance pane under the avatar instead.
// A picture dropped on the avatar, or pasted while it has focus, becomes the
// bot's picture through the same upload as the Appearance pane (25 MB).
import { useState } from "react";

import { avatarImageFrom, dragMayCarryImage } from "@/lib/avatar-input";
import { cn } from "@/lib/cn";

import { useStore, type Bot } from "@/state/store";
import { useBotEditor } from "./bot-settings/BotEditorContext";
import { t } from "@/lib/i18n";
import { type MausMotion, type MausState } from "@/lib/mascot";
import { BotAvatar } from "./Avatar";
import { AppearancePane } from "./appearance/AppearancePane";
import { useAvatarSources, type AvatarPatch } from "./appearance/AvatarSources";

export function BotProfileAvatarCard({
  bot,
  activeState,
  mascotMotion,
  onPatch,
  onContextMenu,
}: {
  bot: Bot;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  onPatch: (patch: AvatarPatch) => void;
  /** A right click on the mascot (the bot panel opens the bot's "..." menu
   * there). The pencil badge is gone (2026-10-14): a click on the mascot
   * opens the editor, and the "..." menu has Edit bot. */
  onContextMenu?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { dispatch } = useStore();
  const { draft } = useBotEditor();
  const [draftOpen, setDraftOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const sources = useAvatarSources(bot, onPatch);
  const open = () => {
    if (draft) setDraftOpen((value) => !value);
    else dispatch({ type: "openPersonaEditor", botId: bot.id, section: "appearance" });
  };

  return (
    <div className="relative">
      {/* room above for a move's jump and effects: the panel scrolls, so anything past its top is cut by a straight edge */}
      <div className="flex justify-center pb-0 pt-5">
        <button
          type="button"
          aria-label={t("botPanel.avatar.edit")}
          aria-expanded={draft ? draftOpen : undefined}
          aria-haspopup={draft ? undefined : "dialog"}
          data-avatar-edit=""
          onClick={open}
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
          className={cn("rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent", dropping && "ring-2 ring-accent")}
        >
          <BotAvatar
            bot={bot}
            state={activeState}
            size={144}
            motion={mascotMotion?.kind ?? "none"}
            motionKey={mascotMotion?.nonce ?? 0}
          />
        </button>
      </div>
      {sources.error && <p role="alert" className="-mt-1 pb-2 text-center text-[11.5px] text-danger">{sources.error}</p>}
      {draft && draftOpen && (
        <div data-avatar-appearance="" className="pb-2">
          <AppearancePane bot={bot} onPatch={onPatch} />
        </div>
      )}
    </div>
  );
}

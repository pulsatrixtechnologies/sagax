// Identity: avatar, name, title, and the short blurb every roster and the
// phone show. Long standing instructions belong in Soul (SoulSection) —
// this section only keeps the "View full" dialog for the blurb itself.
// Moved out of SettingsPanel.tsx (its header, avatar card, Name, Title,
// and Instructions block) with only the label and helper text changed.
// New bot shows it in two parts (2026-10-14): "main" on the one page (avatar,
// name with one random name button, description) and "more" under More
// options (the label and the full description dialog).
import { useState } from "react";
import { BookOpen, Dices } from "lucide-react";

import { useStore, type Bot } from "@/state/store";
import type { MausMotion, MausState } from "@/lib/mascot";
import { cn } from "@/lib/cn";
import { BOT_PROFILE_LIMITS } from "../../../shared/bot-profile";
import { BotProfileAvatarCard } from "../BotProfileAvatarCard";
import { BotInstructionsDialog } from "../BotInstructionsDialog";
import { Field, inputCls } from "./field";
import type { BotPatch } from "./useBotSettingsDerived";
import { useBotEditor } from "./BotEditorContext";
import { PackageProvenance } from "./PackageProvenance";
import { randomBotName } from "@/lib/random-bot-name";
import { t } from "@/lib/i18n";

export function IdentitySection({
  bot,
  patch,
  activeState,
  mascotMotion,
  namePlaceholder,
  showAvatar = true,
  part = "all",
}: {
  bot: Bot;
  patch: (patch: BotPatch) => void;
  activeState: MausState;
  mascotMotion: { kind: Exclude<MausMotion, "none">; nonce: number } | null;
  namePlaceholder?: string;
  /** The bot panel shows the avatar card at its top, above the tabs. */
  showAvatar?: boolean;
  /** Which fields: all of them, the New bot page's own ("main"), or the
   * ones it keeps under More options ("more"). */
  part?: "all" | "main" | "more";
}) {
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const { draft } = useBotEditor();
  const { state, dispatch } = useStore();
  const main = part !== "more";
  const more = part !== "main";

  return (
    <div className="flex flex-col gap-4">
      {main && showAvatar && <BotProfileAvatarCard bot={bot} activeState={activeState} mascotMotion={mascotMotion} onPatch={patch} />}
      {main && <PackageProvenance bot={bot} />}

      {main && <div>
        <div className="mb-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label htmlFor={`bot-name-${bot.id}`} className="text-[13px] text-ink-secondary">{t("botPanel.identity.name")}</label>
          {draft && <button
            type="button"
            data-random-name=""
            aria-label={t("newBot.randomName")}
            title={t("newBot.randomName")}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-ink-secondary hover:bg-control hover:text-ink"
            onClick={() => patch({ name: randomBotName(Math.random() < 0.5 ? "female" : "male", bot.name, state.bots.map(existing => existing.name)) })}
          ><Dices size={14} aria-hidden="true" /></button>}
        </div>
        <input
          id={`bot-name-${bot.id}`}
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.name}
          value={bot.name}
          placeholder={namePlaceholder}
          onChange={(e) => patch({ name: e.target.value })}
        />
      </div>}
      {more && <Field label={t("botPanel.identity.label")}>
        <input
          className={inputCls}
          maxLength={BOT_PROFILE_LIMITS.title}
          placeholder={t("botPanel.identity.labelPlaceholder")}
          value={bot.title}
          onChange={(e) => patch({ title: e.target.value })}
        />
      </Field>}
      {part === "more" && <div>
        <button
          type="button"
          onClick={() => setInstructionsOpen(true)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"
        >
          <BookOpen size={12} /> {t("botPanel.identity.viewFull")}
        </button>
      </div>}
      {main && <div className="block">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <label htmlFor={`bot-instructions-${bot.id}`} className="text-[13px] text-ink-secondary">
            {t("botPanel.identity.description")}
          </label>
          {part === "all" && <button
            type="button"
            onClick={() => setInstructionsOpen(true)}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] font-medium text-accent-text hover:bg-accent/10"
          >
            <BookOpen size={12} /> {t("botPanel.identity.viewFull")}
          </button>}
        </div>
        <textarea
          id={`bot-instructions-${bot.id}`}
          className={cn(inputCls, "min-h-[72px] resize-y leading-relaxed")}
          maxLength={BOT_PROFILE_LIMITS.description}
          placeholder={t("botPanel.identity.blurbPlaceholder")}
          aria-label={t("botPanel.identity.blurb")}
          value={bot.description}
          onChange={(e) => patch({ description: e.target.value })}
        />
        <div className="mt-1.5 flex items-start justify-between gap-3 text-[11px] text-ink-secondary">
          <span>{t("botPanel.identity.blurbHelp")}</span>
          {/* The cap only matters when someone is near it; a counter under a
              one-line field otherwise reads as an invitation to fill it. */}
          {bot.description.length > 3_000 && (
            <span className="shrink-0 tabular-nums">
              {bot.description.length.toLocaleString()} / {BOT_PROFILE_LIMITS.description.toLocaleString()}
            </span>
          )}
        </div>
      </div>}

      {instructionsOpen && (
        <BotInstructionsDialog
          bot={bot}
          onClose={() => setInstructionsOpen(false)}
          onPanelClose={() => {
            setInstructionsOpen(false);
            dispatch({ type: "toggleSettings", open: false });
            dispatch({ type: "toggleComputer", open: false });
          }}
        />
      )}
    </div>
  );
}

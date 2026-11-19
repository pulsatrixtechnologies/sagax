// Soul: the bot's standing instructions (SOUL.md). What it is lives behind
// the field's info button, so the editor is the first thing on the page.
// #1329: the bot's "do not finish until" condition sits under them.
// The bot's profile page (plain surface, #2313): one card labelled
// Personality in grey above it, the editor inside on one filled surface.
import { t } from "@/lib/i18n";
import type { Bot } from "@/state/store";
import { SoulField } from "../SoulField";
import { useSettingsSurface } from "../SettingsPrimitives";
import { useBotEditor } from "./BotEditorContext";
import { FinishUntilSettings } from "./FinishUntilSettings";
import { PaneSection } from "./PaneSection";
import type { BotPatch } from "./useBotSettingsDerived";

/** The large modal's editor fill (BotPageModal) less the Do not finish until card, at least the editor's own minimum. */
const SOUL_FILL = "[--bot-modal-fill:calc(100dvh-640px)]";

export function SoulSection({ bot, patch, onOpenRules }: { bot: Bot; patch: (patch: BotPatch) => void; onOpenRules?: () => void }) {
  const { draft } = useBotEditor();
  const plain = useSettingsSurface() === "plain";
  if (plain) {
    return (
      <>
        {/* the editor leaves room for the "Do not finish until" card under it: its Save row shows whole */}
        <div className={draft ? undefined : SOUL_FILL}>
          <PaneSection title={t("botSettings.nav.soul")} data-soul-section="">
            <SoulField bot={bot} onPatch={patch} onOpenRules={onOpenRules} />
          </PaneSection>
        </div>
        {!draft && <FinishUntilSettings bot={bot} />}
      </>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <SoulField bot={bot} onPatch={patch} onOpenRules={onOpenRules} />
      {!draft && <FinishUntilSettings bot={bot} />}
    </div>
  );
}

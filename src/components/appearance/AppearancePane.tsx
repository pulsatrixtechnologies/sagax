// The persona editor's Appearance category: how the bot looks everywhere it
// appears: a preview band over four tabs (Mascot, Shape, Color, Skin), one
// grid at a time (floating-bots/MascotLookEditor.tsx, loaded lazily with
// this pane). The Mascot tab shows the mascot gallery, or, while the bot
// wears a picture (dropped or pasted on its avatar, AvatarSources.tsx), a
// line that says so with Use the mascot; Reset (the green owl back) and
// Randomize sit at the right of the tab row. No source bar: the page is
// the mascot choice only (the owner 2026-11-12, #4076). Clicking the bot's
// avatar opens the persona editor here (BotProfileAvatarCard); the New bot
// dialog shows the same pane under its draft's avatar. The pane is a size
// container: the preview band lays out in a row when the pane is wide
// enough, stacked otherwise, whatever the window's width.
import { lazy, Suspense } from "react";

import { useStore, type Bot } from "@/state/store";
import { t } from "@/lib/i18n";
import type { AvatarPatch } from "./AvatarSources";

// The character registry, its thumbnails and the skin cards: fetched only when the pane shows them.
const MascotLookEditor = lazy(() => import("../floating-bots/MascotLookEditor"));

export function AppearancePane({ bot, onPatch }: { bot: Bot; onPatch: (patch: AvatarPatch) => void }) {
  const { dispatch } = useStore();
  const crop = bot.avatarCrop ?? "mascot";

  const resetMascot = () =>
    onPatch({ avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: "cursor", mascotSkin: "none", mascotLook: { character: "owl" } });

  // Reset sits at the right of the Mascot / Shape / Color / Skin tab row:
  // nothing of the Appearance shows outside its tabs (JC 2026-11-06).
  const reset = (
    <button
      type="button"
      onClick={resetMascot}
      data-appearance-reset=""
      className="rounded-lg border border-hairline-weak px-3 py-1.5 text-[13px] leading-4 text-ink-secondary hover:bg-control hover:text-ink"
    >
      {t("botPanel.avatar.reset")}
    </button>
  );
  // While a picture is the bot's avatar, the Mascot tab says so in place of the gallery.
  const pictureInUse =
    crop !== "mascot" ? (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] text-ink-secondary" data-appearance-picture="">
        <span className="min-w-0 flex-1">{t("appearance.pictureInUse")}</span>
        <button type="button" onClick={() => onPatch({ avatarCrop: "mascot" })} className="rounded-lg bg-control px-3 py-1.5 text-ink hover:bg-raised-hover">
          {t("botPanel.avatar.useMascot")}
        </button>
      </div>
    ) : undefined;

  return (
    <div className="@container" data-appearance-pane="">
      <Suspense fallback={<div className="h-[440px]" />}>
        <MascotLookEditor
          bot={bot}
          onPatch={onPatch}
          // a wing move also plays on the bot's avatars across the app
          onOwlMove={(kind) => dispatch({ type: "playMascotMotion", botId: bot.id, kind })}
          hero={crop === "mascot"}
          picturePanel={pictureInUse}
          tabActions={reset}
        />
      </Suspense>
    </div>
  );
}

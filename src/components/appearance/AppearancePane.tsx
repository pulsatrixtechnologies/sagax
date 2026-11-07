// The persona editor's Appearance category: how the bot looks everywhere it
// appears: a preview band over four tabs (Mascot, Shape, Color, Skin), one
// grid at a time (floating-bots/MascotLookEditor.tsx, loaded lazily with
// this pane). The Mascot tab's tool row opens on a segmented control that
// picks the source (Mascot, Generate, Upload: the picture sources,
// AvatarSources.tsx, show in that tab in place of the gallery); Reset (the
// green owl back) and Randomize sit at the right of the tab row. Clicking the
// bot's avatar opens the persona editor here (BotProfileAvatarCard); the New
// bot dialog shows the same pane under its draft's avatar. The pane is a
// size container: the preview band lays out in a row when the pane is wide
// enough, stacked otherwise, whatever the window's width.
import { lazy, Suspense, useState } from "react";

import { useStore, type Bot } from "@/state/store";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { AvatarImageGenerator } from "../AvatarImageGenerator";
import { nextTab } from "../floating-bots/editor-tabs";
import { AvatarUploadPanel, useAvatarSources, type AvatarPatch } from "./AvatarSources";

// The character registry, its thumbnails and the skin cards: fetched only when the pane shows them.
const MascotLookEditor = lazy(() => import("../floating-bots/MascotLookEditor"));

export const APPEARANCE_MODES = ["mascot", "generate", "upload"] as const;
export type AppearanceMode = (typeof APPEARANCE_MODES)[number];

const MODE_LABEL = {
  mascot: "appearance.mode.mascot",
  generate: "botPanel.avatar.generate",
  upload: "botPanel.avatar.upload",
} satisfies Record<AppearanceMode, LocaleKey>;

/** The source a pane opens on: a custom picture opens on Upload, where its zoom and framing live. */
export function initialAppearanceMode(bot: Pick<Bot, "avatarCrop" | "avatarUrl">): AppearanceMode {
  return (bot.avatarCrop ?? "mascot") !== "mascot" && bot.avatarUrl ? "upload" : "mascot";
}

export function AppearancePane({ bot, onPatch }: { bot: Bot; onPatch: (patch: AvatarPatch) => void }) {
  const { dispatch } = useStore();
  const [mode, setMode] = useState<AppearanceMode>(() => initialAppearanceMode(bot));
  const sources = useAvatarSources(bot, onPatch);
  const crop = bot.avatarCrop ?? "mascot";

  const resetMascot = () =>
    onPatch({ avatarCrop: "mascot", color: "green", mascotExpression: null, mascotBody: "cursor", mascotSkin: "none", mascotLook: { character: "owl" } });

  // The source switch opens the Mascot tab's tool row and Reset sits at the
  // right of the Mascot / Shape / Color / Skin tab row: nothing of the
  // Appearance shows outside its tabs (JC 2026-11-06).
  const modeSwitch = (
    <div role="tablist" aria-label={t("appearance.modes")} className="inline-flex shrink-0 gap-0.5 rounded-lg bg-inset p-0.5" data-appearance-modes="">
      {APPEARANCE_MODES.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`appearance-mode-${id}`}
          aria-selected={mode === id}
          aria-controls="appearance-mode-panel"
          tabIndex={mode === id ? 0 : -1}
          data-appearance-mode={id}
          onClick={() => setMode(id)}
          onKeyDown={(event) => {
            const next = nextTab(APPEARANCE_MODES, mode, event.key);
            if (next == null) return;
            event.preventDefault();
            setMode(next);
            event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-appearance-mode="${next}"]`)?.focus();
          }}
          className={cn(
            "rounded-md px-3 py-1.5 text-[13px] leading-4 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent",
            mode === id ? "bg-control text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
          )}
        >
          {t(MODE_LABEL[id])}
        </button>
      ))}
    </div>
  );
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
  // The Mascot tab shows the gallery for the mascot source, else the picture source (or the picture in use).
  const sourcePanel =
    mode === "generate" ? (
      <AvatarImageGenerator
        botLabel={bot.title || bot.name}
        disabled={sources.uploading}
        generating={sources.generating}
        onGenerate={sources.generate}
      />
    ) : mode === "upload" ? (
      <AvatarUploadPanel
        bot={bot}
        busy={sources.busy}
        uploading={sources.uploading}
        onUpload={sources.upload}
        onRemove={sources.removeImage}
        onPatch={onPatch}
      />
    ) : crop !== "mascot" ? (
      <div className="flex flex-wrap items-center gap-3 rounded-lg bg-raised/60 px-3 py-2 text-[12.5px] text-ink-secondary" data-appearance-picture="">
        <span className="min-w-0 flex-1">{t("appearance.pictureInUse")}</span>
        <button type="button" onClick={() => onPatch({ avatarCrop: "mascot" })} className="rounded-lg bg-control px-3 py-1.5 text-ink hover:bg-raised-hover">
          {t("botPanel.avatar.useMascot")}
        </button>
      </div>
    ) : undefined;

  return (
    <div className="@container" data-appearance-pane="">
      <div id="appearance-mode-panel" role="tabpanel" aria-labelledby={`appearance-mode-${mode}`}>
        <Suspense fallback={<div className="h-[440px]" />}>
          <MascotLookEditor
            bot={bot}
            disabled={sources.busy}
            onPatch={onPatch}
            // a wing move also plays on the bot's avatars across the app
            onOwlMove={(kind) => dispatch({ type: "playMascotMotion", botId: bot.id, kind })}
            hero={crop === "mascot"}
            sources={modeSwitch}
            sourcePanel={sourcePanel}
            tabActions={reset}
          />
        </Suspense>
      </div>

      {sources.error && <div role="alert" className="mt-3 text-[12px] text-danger">{sources.error}</div>}
    </div>
  );
}

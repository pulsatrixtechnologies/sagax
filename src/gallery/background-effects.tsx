/** Isolated gallery for screenshots and the ad hoc perf check of the
 * background effects behind the conversation (BackgroundEffectLayer.tsx). Not
 * shipped in the app. ?effect=<id>&palette=<id>&intensity=<low|medium|high>
 * &skin=<id>&lang=<code>; ?view=settings shows the Settings section alone.
 * The page is laid out as the chat pane: the transcript scroller (positioned,
 * over the canvas) and a composer pill in a dock. */
import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { BackgroundEffectLayer } from "../components/BackgroundEffectLayer";
import { BackgroundEffectsPicker } from "../components/settings/BackgroundEffectsPicker";
import { SettingsGroup } from "../components/SettingsPrimitives";
import { isBackgroundEffectId, isIntensity, isPaletteId } from "../lib/background-effects";
import { readBackgroundEffectPrefs, setBackgroundEffect, setBackgroundIntensity, setBackgroundPalette } from "../lib/background-effect-preferences";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const effectParam = params.get("effect");
if (isBackgroundEffectId(effectParam)) setBackgroundEffect(effectParam);
const paletteParam = params.get("palette");
if (isPaletteId(paletteParam)) setBackgroundPalette(readBackgroundEffectPrefs().effect, paletteParam);
const intensityParam = params.get("intensity");
if (isIntensity(intensityParam)) setBackgroundIntensity(intensityParam);
const settingsView = params.get("view") === "settings";

const turns = [
  { user: true, text: "Peux-tu faire le point sur les billets ouverts de la semaine ?" },
  { user: false, text: "Voici le point : 14 billets ouverts, dont 3 en attente du client et 2 à facturer. Le plus ancien date de lundi (imprimante du 2e étage). Veux-tu que je relance les clients en attente ?" },
  { user: true, text: "Oui, relance les trois." },
  { user: false, text: "C'est fait : trois courriels de relance envoyés, avec le numéro du billet en objet. Je t'avertis dès qu'une réponse arrive." },
];

function Gallery() {
  const pane = useRef<HTMLDivElement>(null);
  const effect = readBackgroundEffectPrefs().effect;
  return (
    <main className="app-glow relative isolate flex h-screen min-w-0 flex-col bg-app text-ink">
      <div className="content-card-body flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1" data-gallery-pane="">
          <BackgroundEffectLayer paneRef={pane} effect={effect === "none" ? null : effect} />
          <div ref={pane} className="relative h-full overflow-y-auto px-5" data-gallery-scroller="">
            <div className="mx-auto flex w-full max-w-[960px] flex-col gap-3 pb-40 pt-14">
              {turns.map((turn, k) => turn.user
                ? <div key={k} className="max-w-[70%] self-end rounded-[18px] bg-bubble-user px-3.5 py-2 text-[14px] text-ink">{turn.text}</div>
                : <p key={k} className="max-w-[80%] self-start text-[14px] leading-relaxed text-ink" data-gallery-bot="">{turn.text}</p>)}
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] px-5 pb-5">
            <div className="pointer-events-auto mx-auto flex max-w-[760px] items-center rounded-[22px] border-[0.5px] border-border bg-composer px-4 py-3">
              <textarea data-gallery-composer="" rows={1} placeholder="Écris à ton bot" className="w-full resize-none bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-tertiary" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function SettingsView() {
  return (
    <main className="min-h-screen bg-app p-6 text-ink">
      <div className="mx-auto flex max-w-[680px] flex-col gap-6">
        <SettingsGroup title={t("settings.backgroundEffects.title")} groupId="backgroundEffects">
          <BackgroundEffectsPicker />
        </SettingsGroup>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {settingsView ? <SettingsView /> : <Gallery />}
  </StrictMode>,
);

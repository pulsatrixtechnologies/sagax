/** Isolated gallery for screenshots of the skin families (SkinPicker.tsx,
 * src/lib/skin-families.ts). Not shipped in the app.
 * ?view=settings (default): Settings > Appearance > Skin alone, in the
 * document's skin (&skin=<id>, &auto=1 for Auto, &unlocked=1 for Hibou 98).
 * ?view=board: every family, every variant, each scheme it has: a sidebar,
 * a conversation and a settings card, drawn in that skin's own context.
 * &lang=<code> (fr by default). */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SkinPicker } from "../components/SkinPicker";
import { CompactRow, PillSelect, SettingsGroup } from "../components/SettingsPrimitives";
import { SKIN_FAMILIES, schemesOf, variantSkin, writeSkinAuto, type SkinScheme } from "../lib/skin-families";
import { setLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
if (params.has("auto")) writeSkinAuto(params.get("auto") === "1");
if (params.get("unlocked") === "1") localStorage.setItem("omb.retro98.unlocked", "1");
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "settings";

function SettingsView() {
  return (
    <main className="min-h-screen bg-app p-6 text-ink" data-gallery-settings="">
      <div className="mx-auto flex max-w-[680px] flex-col gap-6">
        <SettingsGroup title={t("settings.skin.title")} groupId="skin">
          <SkinPicker />
        </SettingsGroup>
      </div>
    </main>
  );
}

const ROWS = ["Répartition", "Facturation", "Sauvegardes", "Sécurité"];

/** One skin, drawn as the app is: the rail, a conversation, a settings card. */
function Cell({ skin, label }: { skin: SkinId; label: string }) {
  return (
    <figure data-skin={skin} data-board-cell={skin} className="flex flex-col overflow-hidden rounded-xl bg-app text-ink ring-1 ring-hairline" style={{ fontFamily: "var(--font-sans)" }}>
      <figcaption className="flex items-center justify-between bg-panel px-3 py-1.5 text-[12px] text-ink-secondary">
        <span className="text-ink">{label}</span>
        <span>{skin}</span>
      </figcaption>
      <div className="flex h-[230px] min-w-0">
        <aside className="flex w-[118px] shrink-0 flex-col gap-0.5 bg-sidebar p-1.5">
          {ROWS.map((row, index) => (
            <div key={row} className={index === 0 ? "rounded-lg bg-sidebar-selected px-2 py-1.5" : "rounded-lg px-2 py-1.5"}>
              <div className="truncate text-[12px] font-medium" style={{ color: "var(--color-sidebar-ink)" }}>{row}</div>
              <div className="truncate text-[11px]" style={{ color: "var(--color-sidebar-ink-secondary)" }}>Dernier message</div>
            </div>
          ))}
        </aside>
        <section className="app-glow flex min-w-0 flex-1 flex-col gap-2 bg-app p-2.5">
          <div className="max-w-[78%] self-end rounded-[16px] bg-bubble-user px-2.5 py-1.5 text-[12px]">Relance les trois clients.</div>
          <p className="max-w-[90%] text-[12px] leading-[17px] text-ink">C'est fait : trois relances envoyées. <span className="text-accent-text">Voir les billets</span></p>
          <div className="rounded-lg bg-card p-2 text-[11px] text-ink-secondary ring-1 ring-hairline">Billet exemple · <span className="text-success">Résolu</span></div>
          <div className="mt-auto flex items-center gap-2 rounded-[18px] bg-composer px-3 py-1.5 ring-1 ring-hairline">
            <span className="flex-1 text-[12px] text-ink-tertiary">Écrivez à votre bot</span>
            <span className="flex size-[20px] items-center justify-center rounded-full bg-accent text-[11px] text-accent-ink">↑</span>
          </div>
        </section>
      </div>
      <div className="border-t border-hairline bg-panel">
        <CompactRow label="Police">
          <PillSelect value="skin" ariaLabel="Police" onChange={() => undefined} options={[{ value: "skin", label: "Celle du thème" }]} />
        </CompactRow>
      </div>
    </figure>
  );
}

function Board() {
  const schemeName = (scheme: SkinScheme) => t(`settings.skin.mode.${scheme}`);
  return (
    <main className="min-h-screen bg-app p-6 text-ink" data-gallery-board="">
      <div className="flex flex-col gap-8">
        {SKIN_FAMILIES.map((family) => (
          <section key={family.id} className="flex flex-col gap-3">
            <h2 className="text-[18px] font-semibold">{family.name}</h2>
            <p className="-mt-2 text-[13px] text-ink-secondary">{t(`settings.skin.family.${family.id}.tagline`)}</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-4">
              {family.variants.flatMap((variant) =>
                schemesOf(variant).map((scheme) => (
                  <Cell key={`${variant.id}-${scheme}`} skin={variantSkin(variant, scheme)} label={`${t(`settings.skin.variant.${variant.id}`)} · ${schemeName(scheme)}`} />
                )),
              )}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>{view === "board" ? <Board /> : <SettingsView />}</StrictMode>,
);

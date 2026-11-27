/** Isolated gallery for headless screenshots of citing a page passage in the
 * main composer (#5464 R4): outline + ask-in-place with Cite, and the cite
 * strip on `[data-surface=composer]`. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ArrowUp, MessageSquareQuote, Mic } from "lucide-react";

import { COMPOSER_PILL } from "../components/Composer.tsx-parts/ComposerEditor";
import { ComposerPageCiteStrip } from "../components/PageComposerParts";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin();
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");

const quote = params.get("lang") === "fr"
  ? "Le volume a augmente de 12 % en septembre."
  : "Volume rose by 12% in September.";
const title = params.get("lang") === "fr" ? "Rapport Q3" : "Q3 report";
const placeholder = params.get("lang") === "fr" ? "Pose ta question sur ce passage" : "Ask about this passage";

function Gallery() {
  return (
    <div data-gallery="page-cite" className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex w-[720px] flex-col gap-6">
        <section data-shot="ask" className="relative overflow-hidden rounded-2xl border border-hairline/40 bg-elevated" style={{ height: 280 }}>
          <div className="absolute inset-0 bg-canvas p-6 text-[14px] leading-6 text-ink-secondary">
            <p className="mb-2 font-medium text-ink">{title}</p>
            <p>{params.get("lang") === "fr" ? "Avant le passage. " : "Before the passage. "}
              <mark className="rounded bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-ink">{quote}</mark>
              {params.get("lang") === "fr" ? " Apres le passage." : " After the passage."}
            </p>
          </div>
          <div
            data-page-selection-outline=""
            aria-hidden="true"
            className="pointer-events-none absolute box-border border-[color:color-mix(in_srgb,var(--color-accent)_90%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
            style={{ left: 48, top: 72, width: 360, height: 28, borderStyle: "solid", borderWidth: 1.5, borderRadius: 8, borderTopLeftRadius: 0 }}
          >
            <span data-page-selection-tag="" className="absolute left-[-1.5px] whitespace-nowrap rounded-t-[6px] bg-accent px-2 text-[11px] font-medium leading-[18px] text-accent-ink" style={{ bottom: "calc(100% + 1.5px)" }}>
              {t("pages.selection.tag")}
            </span>
          </div>
          <div
            data-page-selection-composer="ready"
            role="group"
            aria-label={t("pages.selection.composer", { name: "Scout" })}
            className="page-selection-composer pointer-events-auto absolute box-border flex min-h-11 flex-wrap items-end gap-2 rounded-[18px] border-[0.5px] border-hairline/70 bg-elevated p-2 text-[14px] text-ink shadow-[0_2px_6px_rgb(28_28_28/0.1),0_10px_24px_rgb(28_28_28/0.1)]"
            style={{ left: 48, top: 112, width: 360 }}
          >
            <span className="flex size-7 shrink-0 items-center justify-center self-end rounded-full bg-accent/20 text-[11px] font-semibold text-accent-text">S</span>
            <textarea
              readOnly
              rows={1}
              value=""
              aria-label={t("pages.selection.composer", { name: "Scout" })}
              placeholder={placeholder}
              className="box-border max-h-32 min-h-7 min-w-0 flex-1 resize-none overflow-y-auto rounded-[14px] bg-transparent px-1 py-1 text-[14px] leading-5 text-ink placeholder:text-ink-secondary focus:outline-none"
            />
            <button type="button" data-page-selection-cite="" aria-label={t("pages.selection.cite")} title={t("pages.selection.cite")}
              className="flex size-7 shrink-0 items-center justify-center rounded-full text-accent-text hover:bg-accent/15">
              <MessageSquareQuote size={15} aria-hidden="true" />
            </button>
            <button type="button" data-page-selection-send="" aria-label={t("chat.send")} disabled
              className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent !text-white opacity-40">
              <ArrowUp size={17} aria-hidden="true" />
            </button>
          </div>
        </section>

        <section data-shot="composer" className="rounded-2xl border border-hairline/40 bg-panel p-4">
          <div data-surface="composer" className={COMPOSER_PILL}>
            <ComposerPageCiteStrip
              cite={{ pageId: "p1", title, selection: { kind: "text", quote, prefix: "", suffix: "", path: "body > p", tag: "p" } }}
              onClear={() => undefined}
            />
            <div className="flex items-end gap-1">
              <textarea
                readOnly
                rows={1}
                value=""
                placeholder={t("composer.placeholder.bot", { name: "Scout" })}
                className="block max-h-[7.5rem] min-h-6 w-full flex-1 resize-none overflow-y-auto bg-transparent chat-input-text px-1 py-1.5 placeholder:text-ink-secondary focus:outline-none"
              />
              <span className="flex size-7 items-center justify-center rounded-full bg-ink/[0.06] text-ink-secondary" aria-hidden="true">
                <Mic size={16} />
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

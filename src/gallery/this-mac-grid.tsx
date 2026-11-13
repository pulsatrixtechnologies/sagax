/** Headless gallery for Plugins > Installed > This Mac next to a neighbouring section (2026-11-06).
 * ?skin=<id>&lang=<code>&width=. Synthetic data only. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { MacAppsInstalledSection } from "../components/plugins/MacAppsView";
import { PLUGINS } from "../components/plugins/plugins-style";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1480);

const neighbours = ["GitHub", "Slack", "Linear", "Notion"];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ width, padding: 32 }} data-gallery-ready="1">
      <section data-plugins-installed>
        <h3 className={PLUGINS.label}>Installed</h3>
        <ul className={`${PLUGINS.grid} mt-1`}>
          {neighbours.map((name) => (
            <li key={name}>
              <div className="-mx-3 flex w-[calc(100%+24px)] items-center gap-3 rounded-2xl px-3 py-3 text-left">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary">{name[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className={PLUGINS.rowName}>{name}</span>
                  <span className={PLUGINS.rowSub}>Connected</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <MacAppsInstalledSection status={{ available: true, onThisMac: true, apps: [] } as never} onOpen={() => {}} />
    </div>
  </StrictMode>,
);

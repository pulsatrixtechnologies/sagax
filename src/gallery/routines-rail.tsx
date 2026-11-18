/** Headless gallery for the Routines calendar rail (fold button beside the month header). Synthetic data only.
 * ?skin=<id>&lang=<code>&width=&height= */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { CalendarSidebar } from "../components/routines/CalendarSidebar";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.34", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const width = Number(params.get("width") ?? 1440);
const height = Number(params.get("height") ?? 700);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex h-full justify-end bg-app" style={{ width, height }} data-gallery-ready="1">
      <CalendarSidebar anchor={Date.now()} onSelectDate={() => {}} routines={[]} runs={[]} bots={[]} onOpenRoutine={() => {}} onCollapse={() => {}} />
    </div>
  </StrictMode>,
);

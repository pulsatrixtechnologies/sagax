/** The app's error screen (PageBoundary) inside a frame, as a page card shows
 * it (QA 0.8.66 F11). ?skin=<id>&lang=en|fr on the outer page; the frame gets
 * no ?lang= and must still speak the outer page's language. ?frame=1 is the
 * framed side: a child that throws while rendering. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { PageBoundary } from "../components/PageBoundary";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../lib/i18n";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin();
applySkin(skin);
document.body.style.background = "var(--color-panel)";
document.body.style.color = "var(--color-ink)";

function Throws(): never {
  throw new TypeError("runs is not iterable");
}

const framed = params.get("frame") === "1";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {framed ? (
      <PageBoundary><Throws /></PageBoundary>
    ) : (
      <div style={{ padding: 24 }}>
        <iframe data-page-boundary-frame title="frame" src={`./page-boundary.html?frame=1&skin=${skin}`} style={{ width: 640, height: 360, border: "1px solid var(--color-hairline)", borderRadius: 16 }} />
      </div>
    )}
  </StrictMode>,
);

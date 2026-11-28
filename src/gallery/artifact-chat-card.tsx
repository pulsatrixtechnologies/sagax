/** Isolated gallery for headless screenshots of the artifact chat card
 * after save_artifact. Not shipped. ?lang=<code>&skin=<id>&width=<px> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SagaxArtifactChatCard } from "../components/artifacts/SagaxArtifactChatCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.175", __BASE_VERSION__: "0.26.0" });
const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "fr";
await loadLocale(lang);
const width = Number(params.get("width") ?? 720);

const title = lang === "fr" ? "Tableau des ventes" : "Sales dashboard";
const message = {
  id: "m1",
  at: 1,
  role: "bot",
  kind: "text",
  text: `Artifact saved: ${title}`,
  artifactCard: { artifactId: "art_aaaaaaaaaaaa", title, rev: 2 },
} as Message;

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/bots/b1/artifacts/art_aaaaaaaaaaaa")) {
    return new Response(
      JSON.stringify({
        artifact: {
          id: "art_aaaaaaaaaaaa",
          botId: "b1",
          title,
          rev: 2,
          favorite: false,
          popped: false,
          createdAt: 1,
          updatedAt: 2,
          refresh: { state: "idle", failures: 0 },
          html: "<p>Sales</p>",
        },
        versions: [{ rev: 1, at: 1, title, html: "<p>Old</p>" }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return realFetch(input, init);
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div data-gallery-sample="" className="flex min-h-[420px] items-start justify-center bg-app p-8 text-ink" style={{ width }}>
      <div className="w-full max-w-[480px] rounded-2xl border border-hairline/40 bg-panel p-4 shadow-sm">
        <p className="mb-3 text-[12.5px] text-ink-secondary">
          {lang === "fr" ? "Le bot a enregistré un artefact." : "The bot saved an artifact."}
        </p>
        <SagaxArtifactChatCard message={message} botId="b1" />
      </div>
    </div>
  </StrictMode>,
);

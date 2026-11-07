/** Isolated gallery for headless screenshots of file names in a bot message
 * (#file-links): a file the bot wrote is a link, an unknown name stays code.
 * The thread's file list and the desktop bridge are stand-ins: nothing on
 * this computer is opened. Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const THREAD = "t-gallery";
const FILES = [
  { id: "f1", messageId: "m-tool", source: "written", path: "~/Desktop/pelican-a-velo.html", name: "pelican-a-velo.html", at: 10, size: 4096, available: false },
  { id: "f2", messageId: "m-tool", source: "written", path: "/Users/demo/projets/notes/rapport.md", name: "rapport.md", at: 9, size: 812, available: true },
];
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (String(input).startsWith(`/api/threads/${THREAD}/files`)) {
    return new Response(JSON.stringify({ files: FILES }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};
const opened: string[] = [];
(window as unknown as { ogb: unknown; __opened: string[] }).__opened = opened;
(window as unknown as { ogb: unknown }).ogb = {
  platform: "darwin",
  openLocalFile: async (path: string) => { opened.push(path); return "opened"; },
  revealInFolder: async (path: string) => { opened.push(`reveal:${path}`); return "shown"; },
  localFilesExist: async (paths: string[]) => paths.map((path) => (path.startsWith("~/Desktop/") ? path.replace("~", "/Users/demo") : path.startsWith("/Users/demo/") ? path : null)),
};

const TEXT = params.get("lang") === "en"
  ? "I created the file `pelican-a-velo.html` on your desktop, and updated `rapport.md`. I did not touch `autre.html`."
  : "J'ai créé le fichier `pelican-a-velo.html` sur ton bureau et mis à jour `rapport.md`. Je n'ai pas touché à `autre.html`.";

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div data-shot="message" className="mx-auto max-w-[720px] rounded-2xl bg-card px-5 py-4 text-[14px] leading-relaxed">
        <ChatMarkdown text={TEXT} message={{ threadId: THREAD, messageId: "m-text" }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);

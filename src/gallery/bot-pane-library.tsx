/** Isolated gallery for screenshots of the bot panel's Details > Suggestions
 * card and the library's hover preview (reference design). The capture
 * script answers /api itself (the overview's setup steps and the files).
 * Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SuggestionsSection } from "../components/bot-settings/SuggestionsSection";
import { FilesBrowser } from "../components/bot-settings/FilesSection";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import type { ThreadFile } from "../lib/chat-files";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const bot = {
  id: "gallery-bot", threadId: "t1", name: "Atlas", title: "Research", description: "", notifications: true, color: "blue", unread: false,
  modelSelection: { instanceId: "x", model: "x" }, messages: [],
  tasks: [{ threadId: "t2", title: "Quarterly invoices", createdAt: NOW, activity: "waiting-on-you" }],
} as unknown as Bot;

const files: ThreadFile[] = [
  { id: "img", messageId: "m1", source: "upload", path: "skyline.png", name: "skyline.png", mime: "image/png", at: NOW - 3_600_000, size: 284_000, available: true },
  { id: "txt", messageId: "m2", source: "bot", path: "notes.md", name: "notes.md", mime: "text/markdown", at: NOW - 7_200_000, size: 1_900, available: true },
  { id: "pdf", messageId: "m3", source: "bot", path: "report.pdf", name: "report.pdf", mime: "application/pdf", at: NOW - 9_000_000, size: 512_000, available: true },
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[380px] border-r border-hairline/40 bg-panel text-ink">
        <div className="flex flex-col gap-6 px-4 pb-6 pt-4">
          <SuggestionsSection bot={bot} routineCount={0} />
          <FilesBrowser threadId="t1" files={files} error={false} onRetry={() => {}} onJump={() => {}} initialView="list" />
        </div>
      </aside>
    </StoreProvider>
  </StrictMode>,
);

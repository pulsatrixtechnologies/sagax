/** Isolated gallery for headless screenshots of the bot folder Files panel
 * (WorkspaceFilesSection): core files with Every turn, folders, a binary
 * row, Upload and New. Fixture data only. Not shipped in the app.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceFilesSection } from "../components/bot-settings/WorkspaceFilesSection";
import { loadLocale } from "../lib/i18n";
import type { WorkspaceListing } from "../lib/workspace-files";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const NOW = Date.now();
const bot = {
  id: "gallery-bot",
  threadId: "t1",
  name: "Atlas",
  title: "Research",
  description: "",
  notifications: true,
  color: "blue",
  unread: false,
  modelSelection: { instanceId: "x", model: "x" },
  messages: [],
} as unknown as Bot;

const listing: WorkspaceListing = {
  workspacePath: "/tmp/gallery-bot/workspace",
  now: NOW,
  forgottenAfterDays: 30,
  uploadMaxBytes: 250 * 1024 * 1024,
  budgets: {
    rules: { maxLines: 100, maxBytes: 12_000 },
    memory: { maxLines: 200, maxBytes: 32_000 },
    soul: { maxBytes: 8_000 },
  },
  rulesTemplate: "# Rules\n",
  soul: {
    path: "SOUL.md",
    kind: "file",
    bytes: 420,
    modifiedAt: NOW - 86_400_000,
    load: "every-turn",
    editable: true,
    markdown: true,
    forgotten: false,
    virtual: "soul",
  },
  truncated: false,
  entries: [
    {
      path: "MEMORY.md",
      kind: "file",
      bytes: 1_024,
      modifiedAt: NOW - 3_600_000,
      load: "every-turn",
      editable: true,
      markdown: true,
      forgotten: false,
    },
    {
      path: "RULES.md",
      kind: "file",
      bytes: 880,
      modifiedAt: NOW - 7_200_000,
      load: "every-turn",
      editable: true,
      markdown: true,
      forgotten: false,
      budget: { maxLines: 100, maxBytes: 12_000, lines: 24, bytes: 880, over: false },
    },
    { path: "docs", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    {
      path: "docs/guide.md",
      kind: "file",
      bytes: 2_048,
      modifiedAt: NOW - 86_400_000,
      load: "on-demand",
      editable: true,
      markdown: true,
      forgotten: false,
    },
    { path: "inbox", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    {
      path: "inbox/photo.png",
      kind: "file",
      bytes: 48_000,
      modifiedAt: NOW - 1_800_000,
      load: "never",
      editable: false,
      markdown: false,
      forgotten: false,
    },
    {
      path: "inbox/notes.bin",
      kind: "file",
      bytes: 512,
      modifiedAt: NOW - 900_000,
      load: "never",
      editable: false,
      markdown: false,
      forgotten: false,
    },
    { path: "memory", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    { path: "rules", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
    { path: "skills", kind: "dir", bytes: 0, load: "never", editable: false, markdown: false, forgotten: false },
  ],
};

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <aside data-gallery-panel="" className="min-h-screen w-[420px] border-r border-hairline/40 bg-panel px-4 py-4 text-ink">
        <WorkspaceFilesSection
          bot={bot}
          active={false}
          onOpenSection={() => {}}
          initial={listing}
          initialExpanded={["docs", "inbox"]}
        />
      </aside>
    </StoreProvider>
  </StrictMode>,
);

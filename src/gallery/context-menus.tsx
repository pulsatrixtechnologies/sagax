/** Isolated gallery for Playwright screenshots of the context menus outside
 * the sidebar: the thread menu, the conversation's "..." menu and the
 * section menu. Not shipped in the app. ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThreadMenu } from "../components/ThreadMenu";
import { ExportTranscriptMenu } from "../components/ExportTranscriptMenu";
import { OrgSectionMenuItems, orgSectionMenuItems } from "../components/OrgSectionMenu";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const noop = () => {};
const messages = [{ id: "m1", role: "user", text: "Hello", at: 1 }] as unknown as Message[];

function Gallery() {
  const items = orgSectionMenuItems({ named: true, canMoveUp: true, canMoveDown: true, anyExpanded: true });
  return (
    <div className="min-h-dvh bg-app p-6">
      <ThreadMenu
        task={{ threadId: "t1", title: "Weekly report", link: "https://example.com/pr/1" }}
        folders={[{ id: "work", name: "Research" }]}
        actions={{ onRename: noop, onDelete: noop, onPin: noop, onArchive: noop, onSnooze: noop, onMove: noop, onCopyLink: noop, onRegenerateTitle: noop, onRemoveLink: noop }}
        position={{ left: 24, top: 24 }}
        onClose={noop}
      />
      <div data-section-menu-sample className="fixed left-[280px] top-6 flex w-[220px] flex-col gap-0.5 rounded-xl border-[0.5px] border-border popover-surface bg-elevated p-1.5">
        <OrgSectionMenuItems items={items} actions={{ onRename: noop, onMoveUp: noop, onMoveDown: noop, onCollapseAll: noop, onExpandAll: noop, onDelete: noop }} />
      </div>
      <div className="fixed right-6 top-6">
        <ExportTranscriptMenu title="Scout" messages={messages} botName="Scout" onExportBot={noop} onToggleInspector={noop} data={{ label: "Open the Data window", onOpen: noop }} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);

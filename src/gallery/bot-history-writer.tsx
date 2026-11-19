/** Isolated gallery for the bot's History (#4940): a change the person made
 * in the app and one an AI client made by MCP in their name. ?before=1 drops
 * the rows' writer, which is what the History drew before (every change read
 * as the person's own). Synthetic data only. Not shipped in the app.
 * ?skin=<id>&lang=<code>&before=1 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { loadLocale } from "../lib/i18n";
import { HistorySection, type HistoryRow } from "../components/bot-settings/HistorySection";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.98", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const before = params.get("before") === "1";

const NOW = Date.now();
const M = 60_000;
const rows: HistoryRow[] = ([
  { id: "h3", at: NOW - 7 * M, actor: "user", via: "api", field: "soul", summary: "", before: "Dispatch rules\nDecisions of the day", after: "Dispatch rules\nDecisions of the day\nPlugin references", writer: { kind: "agent" as const, via: "mcp", name: "Ada", client: "Claude Code" } },
  { id: "h2", at: NOW - 14 * M, actor: "user", via: "api", field: "description", summary: "", before: "Dispatch", after: "Ticket dispatch", writer: { kind: "person" as const, via: "app", name: "Ada" } },
  { id: "h1", at: NOW - 40 * M, actor: "user", via: "api", field: "soul", summary: "", before: "Dispatch rules", after: "Dispatch rules\nDecisions of the day", writer: { kind: "agent" as const, via: "mcp", name: "Ada", client: "Codex" } },
] satisfies HistoryRow[]).map((row): HistoryRow => (before ? { ...row, writer: undefined } : row));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div data-history-gallery className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[560px]">
        <HistorySection bot={{ id: "dispatch" }} rows={rows} onRestore={() => undefined} />
      </div>
    </div>
  </StrictMode>,
);

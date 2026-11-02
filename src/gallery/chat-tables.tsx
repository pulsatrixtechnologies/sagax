/** Isolated gallery for headless screenshots of rich tables in chat bubbles.
 * Reproduces the two readability cases: a wide Disk Saver routines table
 * (cron + long script path, toolbar row count, horizontal overflow) and a
 * peer/forwarded bubble with a Field / Value / Confidence table.
 * ?skin=midnight|daylight&mode=after|before. Before draws the washed peer
 * surface and the pre-fix table layout (no scroll cue, anywhere-wrap,
 * ungrammatical "1 rows"). Synthetic data only. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { loadLocale } from "../lib/i18n";
import { applySkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
const skin: SkinId = skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : "midnight";
applySkin(skin);
await loadLocale(params.get("lang") ?? "en");
const before = params.get("mode") === "before";

const DISK_SAVER = `### Disk Saver routines (1 of 1)

| Name | Schedule | Script | Status |
| --- | --- | --- | --- |
| Nightly cleanup | \`20 8 * * *\` | \`/Users/workspace/bots/disk-saver/scripts/cleanup-orphaned-caches.sh\` | Armed |
`;

const PEER_FIELDS = `Here is what I found:

| Field | Value | Confidence |
| --- | --- | --- |
| Host | lab-node-04 | High |
| Disk free | 12 GB | High |
| Last backup | 2026-03-18 | Medium |
| Owner | ops-bot | High |
| Cron | \`0 3 * * 1\` | High |
| Path | \`/var/lib/sagax/disk-saver/state.json\` | High |
| Retries | 3 | High |
| Window | 02:00-04:00 ET | Medium |
| Alert | mail | Low |
| Notes | keep last 7 runs | Medium |
`;

function PeerLabel({ name }: { name: string }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 pl-0.5" data-testid="peer-label">
      <span className="flex size-4 items-center justify-center rounded-full bg-raised text-[9px] font-medium text-ink">Q</span>
      <span className="text-[11px] font-medium text-ink-secondary">{name}</span>
      <span className="text-[11px] text-ink-tertiary">· asked</span>
    </div>
  );
}

/** Pre-fix table chrome: no own panel surface, ungrammatical count, cells
 * that wrap anywhere inside a full-width table with no scroll fade. */
function LegacyTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="group/table my-2 min-w-0 overflow-hidden rounded-lg border border-hairline/40">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline/30 bg-raised/25 px-2 py-1 text-[11px] text-ink-secondary">
        <span className="me-auto tabular-nums">1 rows</span>
        <span>CSV</span>
        <span>Markdown</span>
      </div>
      <div className="overflow-hidden">
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr>
              {headers.map((cell) => (
                <th key={cell} className="sticky top-0 border-b border-hairline/50 bg-card px-2.5 py-1.5 text-start font-semibold whitespace-nowrap">
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index} className="border-b border-hairline/20">
                {row.map((cell, column) => (
                  <td key={column} className="px-2.5 py-1.5 align-top break-words [overflow-wrap:anywhere]">
                    {cell.startsWith("`") ? <code className="rounded bg-inset px-1 py-px text-[12px] break-all">{cell.slice(1, -1)}</code> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Column({ title, who }: { title: string; who: "bot" | "peer" }) {
  const bubbleCls = before && who === "peer"
    ? "w-full max-w-[420px] rounded-[18px] bg-raised px-3 py-[7px] text-[13px] leading-5 text-ink-secondary ring-1 ring-inset ring-hairline/40"
    : "w-full max-w-[420px] rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink";
  return (
    <div className="flex w-[460px] flex-col gap-2 bg-app p-4 text-ink" data-gallery-column={title}>
      <div className="text-[11px] text-ink-secondary">{title}</div>
      <div className="flex flex-col items-start">
        {who === "peer" && <PeerLabel name="Quasar" />}
        <div className={bubbleCls} data-chat-bubble data-who={who}>
          {before ? (
            who === "bot" ? (
              <>
                <h3 className="mb-1 text-[13px] font-semibold">Disk Saver routines (1 of 1)</h3>
                <LegacyTable
                  headers={["Name", "Schedule", "Script", "Status"]}
                  rows={[["Nightly cleanup", "`20 8 * * *`", "`/Users/workspace/bots/disk-saver/scripts/cleanup-orphaned-caches.sh`", "Armed"]]}
                />
              </>
            ) : (
              <>
                <p className="mb-1">Here is what I found:</p>
                <LegacyTable
                  headers={["Field", "Value", "Confidence"]}
                  rows={[
                    ["Host", "lab-node-04", "High"],
                    ["Disk free", "12 GB", "High"],
                    ["Last backup", "2026-03-18", "Medium"],
                    ["Owner", "ops-bot", "High"],
                    ["Cron", "`0 3 * * 1`", "High"],
                    ["Path", "`/var/lib/sagax/disk-saver/state.json`", "High"],
                    ["Retries", "3", "High"],
                    ["Window", "02:00-04:00 ET", "Medium"],
                    ["Alert", "mail", "Low"],
                    ["Notes", "keep last 7 runs", "Medium"],
                  ]}
                />
              </>
            )
          ) : (
            <ChatMarkdown text={who === "bot" ? DISK_SAVER : PEER_FIELDS} />
          )}
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex flex-wrap items-start gap-0 bg-app" data-gallery data-skin={skin}>
      <Column title={`${skin} · Disk Saver routines`} who="bot" />
      <Column title={`${skin} · peer Field / Value / Confidence`} who="peer" />
    </div>
  </StrictMode>,
);

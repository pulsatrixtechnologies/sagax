import { useId, useState } from "react";
import { ArrowUpRight, ChartNoAxesCombined, ChevronRight, Table2 } from "lucide-react";
import { useStore, type Message } from "@/state/store";
import { t } from "@/lib/i18n";
import { dataWindowEnabled } from "@/lib/feature-flags";
import { openDataWindow } from "@/lib/data-window";
import { InlineDataChart } from "./data/InlineDataChart";

/** The query is a receipt of what ran, not the viewer's mutable SQL draft. */
export function DataResultChip({ message }: { message: Message }) {
  const { state } = useStore();
  const [expanded, setExpanded] = useState(false);
  const queryId = useId();
  const result = message.dataResult;
  if (!result) return null;
  const chart = result.kind === "chart";
  const Icon = chart ? ChartNoAxesCombined : Table2;
  const companion = window.ogb?.remoteClient?.active === true;
  const owner = state.bots.find((bot) => bot.id === result.botId);
  // The result opens in its bot's Data window (experimental): off, there is
  // nowhere to open it.
  const windowOn = dataWindowEnabled(state.config);
  const available = !companion && windowOn && owner !== undefined;
  return (
    <div data-data-result={result.cardId} className="max-w-full overflow-hidden rounded-xl border border-hairline/40 bg-panel text-sm">
      <div className="flex items-center gap-3 px-3 py-2">
        <Icon size={16} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
        {result.sql ? <button type="button" aria-expanded={expanded} aria-controls={queryId}
          onClick={() => setExpanded(!expanded)} className="flex min-w-0 items-center gap-1.5 rounded text-left text-ink hover:text-accent focus-visible:outline-accent">
          <span className="truncate" title={result.title}>{result.title}</span>
          <ChevronRight size={13} className={`shrink-0 text-ink-tertiary ${expanded ? "rotate-90" : ""}`} aria-hidden="true" />
        </button> : <span className="min-w-0 truncate text-ink" title={result.title}>{result.title}</span>}
        <button
          type="button"
          disabled={!available}
          title={companion ? t("data.openInWorkspace") : !windowOn ? t("dataWindow.off") : undefined}
          onClick={() => {
            if (owner) void openDataWindow({ botId: owner.id, title: t("dataWindow.title", { name: owner.name }), cardId: result.cardId });
          }}
          className={`ml-auto flex shrink-0 items-center gap-1 text-xs hover:underline disabled:opacity-40 ${chart ? "text-ink-tertiary hover:text-accent" : "text-accent"}`}
        >
          {t("data.openResult")}<ArrowUpRight size={13} aria-hidden="true" />
        </button>
      </div>
      {result.sql && expanded && <div id={queryId} className="border-t border-hairline/40 px-3 py-2">
        <div className="mb-1 text-[11px] font-medium text-ink-secondary">{t("data.card.sql")}</div>
        <pre dir="ltr" className="max-h-64 overflow-auto rounded-lg bg-inset p-2.5 font-mono text-xs whitespace-pre-wrap break-words text-ink"><code>{result.sql}</code></pre>
      </div>}
      {chart && <InlineDataChart botId={result.botId} cardId={result.cardId} title={result.title} />}
    </div>
  );
}

// A routine started when something changes in a product (#4250, S4): which
// watched resources. Shared by the trigger popover and the routine editor so
// the two never differ, like GithubTriggerFields. The resources the viewer
// can watch come from Perspicax (GET /api/bots/:id/watchable-resources) and
// are offered as chips, every one of them (a search field above many, the
// list scrolls, like the run-as picker); a template's `{...}` part is filled
// in the field.
// Nothing is saved here: the parent builds the schedule with
// productScheduleFromDraft and sends it with its own Apply/Save.
import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { usePerspicaxOrg } from "@/lib/perspicax-org";
import { api } from "@/state/store";
import { cleanProductEventSchedule, type RoutineProductEventSchedule } from "../../../shared/routine-product-event";
import { PANEL_INPUT, PanelRow, PanelRows } from "./PanelRows";
import { RUN_AS_SEARCH_AFTER } from "./RunAsField";

export interface ProductDraft {
  /** One watched URI per line. */
  resources: string;
}

export interface WatchableResource {
  uri: string;
  name?: string;
  template?: true;
}

export function productDraftFrom(schedule: { type: string; source?: unknown; resources?: string[] } | undefined): ProductDraft {
  if (schedule?.type === "event" && schedule.source === "perspicax") return { resources: (schedule.resources ?? []).join("\n") };
  return { resources: "" };
}

/** Whether to offer "When something changes in a product": only a server
 * linked to Perspicax receives those events (a solo server never would, so
 * the choice is hidden there), and a routine that already has this trigger
 * keeps it in the list. */
export function productTriggerOffered(linked: boolean, schedule: { type: string; source?: unknown } | undefined): boolean {
  return linked || (schedule?.type === "event" && schedule.source === "perspicax");
}

/** productTriggerOffered with the server's own word (GET /api/org). */
export function useProductTriggerOffered(schedule: { type: string; source?: unknown } | undefined): boolean {
  return productTriggerOffered(usePerspicaxOrg() !== null, schedule);
}

function draftUris(draft: ProductDraft): string[] {
  return draft.resources.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
}

/** The schedule, or the reason it cannot be saved (shown as is). */
export function productScheduleFromDraft(draft: ProductDraft): { schedule: RoutineProductEventSchedule } | { error: string } {
  try {
    return { schedule: cleanProductEventSchedule({ resources: draftUris(draft) }) };
  } catch {
    return { error: t("routineTrigger.product.invalid") };
  }
}

/** The answer when it is the route's, else none. */
export function watchableFrom(response: unknown): WatchableResource[] {
  if (!response || typeof response !== "object" || Array.isArray(response)) return [];
  const { available, resources } = response as { available?: unknown; resources?: unknown };
  if (available !== true || !Array.isArray(resources)) return [];
  return resources.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const { uri, name, template } = entry as Record<string, unknown>;
    if (typeof uri !== "string" || !uri.toLowerCase().startsWith("perspicax://")) return [];
    return [{ uri, ...(typeof name === "string" && name.trim() ? { name: name.trim() } : {}), ...(template === true ? { template: true as const } : {}) }];
  });
}

/** Null while loading; [] when Perspicax lists nothing or cannot be read. */
export function useWatchableResources(botId: string | undefined): WatchableResource[] | null {
  const [loaded, setLoaded] = useState<{ botId: string; resources: WatchableResource[] } | null>(null);
  useEffect(() => {
    if (!botId) return;
    const controller = new AbortController();
    void api(`/api/bots/${encodeURIComponent(botId)}/watchable-resources`, { signal: controller.signal, timeoutMs: 20_000 })
      .then((response: unknown) => { if (!controller.signal.aborted) setLoaded({ botId, resources: watchableFrom(response) }); })
      .catch(() => { if (!controller.signal.aborted) setLoaded({ botId, resources: [] }); });
    return () => controller.abort();
  }, [botId]);
  return botId && loaded?.botId === botId ? loaded.resources : null;
}

/** The entries matching `query` (name or URI), resources before templates,
 * every one of them: nothing is left out of the list. */
export function watchableRows(watchable: readonly WatchableResource[], query: string): { resources: WatchableResource[]; templates: WatchableResource[] } {
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle
    ? watchable.filter((entry) => entry.uri.toLocaleLowerCase().includes(needle) || Boolean(entry.name?.toLocaleLowerCase().includes(needle)))
    : watchable;
  return { resources: shown.filter((entry) => !entry.template), templates: shown.filter((entry) => entry.template) };
}

const CHIP = "min-h-7 max-w-full whitespace-normal break-words rounded-full px-2.5 py-1 text-left text-[12.5px] leading-[18px]";

function WatchableChips({ entries, chosen, onAdd }: { entries: WatchableResource[]; chosen: string[]; onAdd: (uri: string) => void }) {
  return <div className="flex flex-wrap gap-1.5">
    {entries.map((entry) => {
      const on = chosen.includes(entry.uri);
      return <button key={entry.uri} type="button" data-product-watchable={entry.uri} aria-pressed={on} title={entry.uri} onClick={() => onAdd(entry.uri)}
        className={cn(CHIP, on ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>
        {entry.name ?? entry.uri}
      </button>;
    })}
  </div>;
}

export function ProductTriggerFields({ draft, onChange, botId }: { draft: ProductDraft; onChange: (next: ProductDraft) => void; botId?: string }) {
  const watchable = useWatchableResources(botId);
  const [query, setQuery] = useState("");
  const rows = useMemo(() => watchableRows(watchable ?? [], query), [watchable, query]);
  const chosen = draftUris(draft);
  const add = (uri: string) => {
    if (chosen.includes(uri)) return;
    onChange({ resources: [...chosen, uri].join("\n") });
  };
  const count = watchable?.length ?? 0;
  return <div data-product-trigger="" className="space-y-2">
    <PanelRows>
      <PanelRow label={t("routineTrigger.product.resources")} hint={t("routineTrigger.product.resourcesHint")} below={<div className="space-y-2">
        <textarea
          data-product-resources=""
          aria-label={t("routineTrigger.product.resources")}
          value={draft.resources}
          spellCheck={false}
          rows={Math.min(5, Math.max(2, chosen.length + 1))}
          onChange={(event) => onChange({ resources: event.target.value })}
          placeholder="perspicax://cw/boards/12/open"
          className={cn(PANEL_INPUT, "w-full resize-y py-1.5 font-mono text-[12px] leading-5")}
        />
        {count > 0 && <div data-product-watchable-list="" className="space-y-1.5">
          <div className="text-[11.5px] leading-4 text-ink-tertiary">{t("routineTrigger.product.suggestedCount", { count })}</div>
          {count > RUN_AS_SEARCH_AFTER && <input data-product-search="" type="search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={t("routineTrigger.product.search")} aria-label={t("routineTrigger.product.search")} maxLength={200}
            className="h-7 w-full min-w-0 rounded-md bg-inset px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:ring-2 focus:ring-accent/50" />}
          <div data-product-watchable-scroll="" className="max-h-64 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
            {rows.resources.length > 0 && <WatchableChips entries={rows.resources} chosen={chosen} onAdd={add} />}
            {rows.templates.length > 0 && <div className="space-y-1">
              <div className="text-[11.5px] leading-4 text-ink-tertiary">{t("routineTrigger.product.templates")}</div>
              <WatchableChips entries={rows.templates} chosen={chosen} onAdd={add} />
            </div>}
            {!rows.resources.length && !rows.templates.length && <p className="text-[11.5px] leading-4 text-ink-secondary">{t("routineTrigger.product.noMatch")}</p>}
          </div>
        </div>}
      </div>} />
    </PanelRows>
  </div>;
}

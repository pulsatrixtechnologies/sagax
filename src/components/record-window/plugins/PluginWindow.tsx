// The record window of a record of another plugin (M-20261127-141,
// M-20261127-146): the frame's head, foot and box are RecordCard's for every
// kind (M-20261127-101); this gives the body and the tabs across the window,
// under the head, out of what scrolls (M-20261127-134). A tab with nothing in
// it where nothing can be added is hidden (M-20261127-143).
//
// While the console says whether it serves the kind, and when it serves
// nothing more than the card (or refuses the kind's main section), the frame
// draws its own view of the card (its facts, its people, its dates, its
// notes): the window never fills a part the console did not send.
import { useEffect, useId, useState, type ReactNode } from "react";
import { RecordWindowTabs, type RecordTab } from "@/components/record-window/RecordBlocks";
import type { RecordWindowLayout } from "@/components/RecordCard";
import { t } from "@/lib/i18n";
import { recordWindowType } from "@/lib/record-window-layout";
import { recordKey, recordMarkdown, type RecordCard as Card, type RecordRef } from "../../../../shared/record-cards";
import { BACKUP_WINDOW } from "./BackupWindow";
import { CONVERSATION_WINDOW } from "./ConversationWindow";
import { FOLDER_WINDOW } from "./FolderWindow";
import { PAGE_WINDOW } from "./PageWindow";
import type { PluginContext } from "./PluginParts";
import { pluginWindowOf, type PluginWindowKind } from "./plugin-windows";
import { POST_WINDOW } from "./PostWindow";
import { THREAT_WINDOW } from "./ThreatWindow";
import { usePluginDetail } from "./usePluginDetail";

/** One window of another plugin: its tabs, what each reads, and its body. */
export interface PluginWindowSpec {
  /** the tab open first */
  first: string;
  /** the sections read when the window opens (the tabs' counts, the first tab) */
  open: readonly string[];
  /** the kind's main section: refused, the window is the frame's own view of the card */
  core: string;
  /** the sections a tab reads */
  reads: Readonly<Record<string, readonly string[]>>;
  /** the tabs, their counts and whether the person can add to them (none: the window has no tabs) */
  tabs: (ctx: PluginContext) => RecordTab<string>[];
  /** whether a tab lays its own sides out (each scrolling on its own); else it scrolls as one */
  sides?: (tab: string) => boolean;
  body: (ctx: PluginContext, tab: string, setTab: (tab: string) => void) => ReactNode;
}

const SPECS: Record<PluginWindowKind, PluginWindowSpec> = {
  threat: THREAT_WINDOW,
  backup: BACKUP_WINDOW,
  page: PAGE_WINDOW,
  conversation: CONVERSATION_WINDOW,
  post: POST_WINDOW,
  folder: FOLDER_WINDOW,
};

const SCROLL = "record-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain";

/** The layout of a plugin's record window, or undefined for a record that has none (or no card yet). */
export function usePluginWindow({ record, label, card, now, ask, compose, back, forward, onChanged }: {
  record: RecordRef;
  label: string;
  card: Card | null;
  now: number;
  /** a request handed to a bot in the chat */
  ask?: (text: string) => void;
  /** the record put in the composer, for the person's own question */
  compose?: () => void;
  /** back to the record this one replaced (the Finder's ‹) */
  back?: () => void;
  /** on to the record left by back (the Finder's ›) */
  forward?: () => void;
  onChanged: () => void;
}): { layout?: RecordWindowLayout; refresh?: () => void } {
  const kind = pluginWindowOf(record);
  const detail = usePluginDetail(record, Boolean(kind && card), onChanged);
  const spec = kind ? SPECS[kind] : undefined;
  const key = recordKey(record);
  const [chosen, setChosen] = useState<{ key: string; tab: string } | null>(null);
  const tab = chosen?.key === key ? chosen.tab : spec?.first ?? "";
  const setTab = (next: string) => setChosen({ key, tab: next });
  const id = useId();
  const want = detail?.want;
  const served = detail?.served;
  useEffect(() => { if (want && spec) want(spec.open); }, [want, spec, served]);
  useEffect(() => { if (want && spec) want(spec.reads[tab] ?? []); }, [want, spec, tab, served]);
  if (!kind || !spec || !card || !detail) return {};
  // the frame's own view of the card until the console serves more, or when it serves no more
  if (detail.served !== true || detail.section(spec.core).refused) return { refresh: detail.refresh };
  const ctx: PluginContext = { card, detail, type: recordWindowType(record), now, link: recordMarkdown(label, record), ask, compose, back, forward };
  const tabs = spec.tabs(ctx);
  const panel = `${id}-panel-${tab}`;
  const body = spec.body(ctx, tab, setTab);
  const sides = spec.sides?.(tab) ?? false;
  return {
    layout: {
      ...(tabs.length ? { tabs: <RecordWindowTabs tabs={tabs} tab={tab} onTab={setTab} label={t("recordWindow.plugin.tabs")} idPrefix={id} className="border-b-0" /> } : {}),
      body: (
        <div role={tabs.length ? "tabpanel" : undefined} id={tabs.length ? panel : undefined} aria-labelledby={tabs.length ? `${id}-tab-${tab}` : undefined}
          className={sides ? "flex min-h-0 flex-1 flex-col" : SCROLL} data-record-plugin={kind} data-record-plugin-tab={tab}>
          {body}
        </div>
      ),
    },
    refresh: detail.refresh,
  };
}

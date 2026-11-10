// Live updates of the reader's bar (2026-10-28, server/pages/page-live.ts): who
// has the page open, and a nudge to read the annotations again when someone
// changes them. Only for a reader who may annotate (the stream answers 404
// to anyone else); the browser reconnects a dropped stream by itself.
import { useEffect, useState } from "react";

import { DATA_LIVE_EVENT, parseDataEvent } from "./capabilities";

export interface LivePerson {
  id: string;
  name: string;
}

/** A presence event's people, checked: at most 50, names cut. Pure. */
export function parsePresence(data: unknown): LivePerson[] | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as { people?: unknown }).people)) return null;
  return ((data as { people: unknown[] }).people)
    .filter((entry): entry is LivePerson => Boolean(entry) && typeof (entry as LivePerson).id === "string" && typeof (entry as LivePerson).name === "string")
    .slice(0, 50)
    .map((entry) => ({ id: entry.id, name: entry.name.slice(0, 80) }));
}

/** The others who have the page open: never the reader themself. Pure. */
export function othersHere(people: readonly LivePerson[], me: string | undefined): LivePerson[] {
  const mine = me?.toLowerCase();
  return people.filter((person) => person.id.toLowerCase() !== mine);
}

export function usePageLive(pageId: string | undefined): { people: LivePerson[]; changes: number } {
  const [people, setPeople] = useState<LivePerson[]>([]);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!pageId || typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/pages/${encodeURIComponent(pageId)}/live`);
    source.addEventListener("presence", (event) => {
      try {
        const next = parsePresence(JSON.parse((event as MessageEvent<string>).data));
        if (next) setPeople(next);
      } catch { /* a bad frame changes nothing */ }
    });
    source.addEventListener("threads", () => setChanges((n) => n + 1));
    // the page's shared state changed (#1544): src/page-reader/state.ts reads it again
    source.addEventListener("state", () => window.dispatchEvent(new Event("sagax-live-state")));
    // a data source the page reads changed (#3413): the wrapper's broker tells the page
    source.addEventListener("data", (event) => {
      try {
        const name = parseDataEvent(JSON.parse((event as MessageEvent<string>).data));
        if (name) window.dispatchEvent(new CustomEvent(DATA_LIVE_EVENT, { detail: { name } }));
      } catch { /* a bad frame changes nothing */ }
    });
    return () => source.close();
  }, [pageId]);
  return { people, changes };
}

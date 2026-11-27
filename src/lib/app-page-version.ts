// Version stepper and "Updated" flash for a live chat app (show_html),
// ported from the OMB PageTools idea without their publish/pin surface.
import { useEffect, useRef, useState } from "react";

import type { AppHistoryEntry, AppPayload } from "../../shared/app";

const FLASH_MS = 2_500;

/** Oldest and newest revision numbers a payload still keeps. */
export function appVersions(app: AppPayload): { first: number; last: number } {
  const last = app.rev ?? 0;
  return { first: Math.max(0, last - (app.history?.length ?? 0)), last };
}

/** Which history entry (or the live page) a given rev maps to. */
export function appAtRev(app: AppPayload, rev: number): { html: string; title?: string } {
  const { first, last } = appVersions(app);
  const clamped = Math.min(last, Math.max(first, rev));
  if (clamped === last) {
    return { html: app.html, ...(app.title ? { title: app.title } : {}) };
  }
  const entry: AppHistoryEntry | undefined = app.history?.[clamped - first];
  if (!entry) return { html: app.html, ...(app.title ? { title: app.title } : {}) };
  return { html: entry.html, ...(entry.title ? { title: entry.title } : app.title ? { title: app.title } : {}) };
}

/** Viewing rev (null = latest) and a short "Updated" flash when rev grows. */
export function useAppPageVersion(app: AppPayload): {
  rev: number;
  first: number;
  last: number;
  latest: boolean;
  flash: boolean;
  show(rev: number | null): void;
  page: { html: string; title?: string };
} {
  const { first, last } = appVersions(app);
  const [viewing, setViewing] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);
  const seen = useRef(last);
  useEffect(() => {
    const grew = last > seen.current;
    seen.current = last;
    if (!grew) return undefined;
    setViewing(null);
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(timer);
  }, [last]);
  const rev = viewing === null ? last : Math.min(last, Math.max(first, viewing));
  return {
    rev,
    first,
    last,
    latest: rev === last,
    flash,
    show: (next) => setViewing(next === null || next >= last ? null : next),
    page: appAtRev(app, rev),
  };
}

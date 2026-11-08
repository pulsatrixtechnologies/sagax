// A routine started by GitHub (I3): which events and which repository. Shared
// by the trigger popover and the routine editor so the two never differ
// (2026-11-07, QA C2 point 8). Nothing is saved here: the parent builds the
// schedule with githubScheduleFromDraft and sends it with its own Apply/Save.
import { useState } from "react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { githubEventLabel } from "@/lib/github-event-label";
import { ROUTINE_GITHUB_DEFAULT_EVENTS, type RoutineGithubEventSchedule } from "../../../shared/routine-github";
import { TRIGGER_SOURCES } from "../../../shared/trigger-sources";
import { PANEL_INPUT, PanelRow, PanelRows } from "./PanelRows";

export interface GithubDraft {
  events: string[];
  repo: string;
}

export function githubDraftFrom(schedule: { type: string; source?: unknown; events?: string[]; filters?: { repo?: string[] } } | undefined): GithubDraft {
  if (schedule?.type === "event" && schedule.source === "github") return { events: [...(schedule.events ?? [])], repo: schedule.filters?.repo?.join(", ") ?? "" };
  return { events: ["issue.opened"], repo: "" };
}

export function githubScheduleFromDraft(draft: GithubDraft): RoutineGithubEventSchedule {
  const repos = Array.from(new Set(draft.repo.split(/[,\s]+/).map((value) => value.trim()).filter(Boolean)));
  return { type: "event", source: "github", events: draft.events, ...(repos.length ? { filters: { repo: repos } } : {}) };
}

export function GithubTriggerFields({ draft, onChange }: { draft: GithubDraft; onChange: (next: GithubDraft) => void }) {
  const all = TRIGGER_SOURCES.github.events as readonly string[];
  const first: readonly string[] = ROUTINE_GITHUB_DEFAULT_EVENTS;
  const [more, setMore] = useState(false);
  const shown = more ? all : all.filter((kind) => first.includes(kind) || draft.events.includes(kind));
  const toggle = (kind: string) => onChange({ ...draft, events: draft.events.includes(kind) ? draft.events.filter((value) => value !== kind) : [...draft.events, kind] });
  return <div data-github-trigger="" className="space-y-2">
    <PanelRows>
      <PanelRow label={t("routineTrigger.github.events")} hint={t("routineTrigger.github.eventsHint")} below={<div className="flex flex-wrap gap-1.5">
        {shown.map((kind) => {
          const on = draft.events.includes(kind);
          return <button key={kind} type="button" data-github-event={kind} aria-pressed={on} onClick={() => toggle(kind)} className={cn("h-7 rounded-full px-2.5 text-[12.5px]", on ? "bg-accent text-accent-ink" : "bg-inset text-ink-secondary hover:bg-raised hover:text-ink")}>{githubEventLabel(kind)}</button>;
        })}
        {!more && shown.length < all.length && <button type="button" onClick={() => setMore(true)} className="h-7 rounded-full px-2.5 text-[12.5px] text-accent-text hover:bg-hover">{t("routineTrigger.github.more")}</button>}
      </div>} />
      <PanelRow label={t("routineTrigger.github.repo")}>
        <input data-github-repo aria-label={t("routineTrigger.github.repo")} value={draft.repo} spellCheck={false} onChange={(event) => onChange({ ...draft, repo: event.target.value })} placeholder={t("routineTrigger.github.repoPlaceholder")} className={cn(PANEL_INPUT, "w-[180px]")} />
      </PanelRow>
    </PanelRows>
  </div>;
}

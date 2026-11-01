// People's custom labels (server/routes/person-labels.ts), the people
// counterpart of a bot's label: GET /api/people/labels once per page load,
// then each `person.label` frame patches the one that changed. Keyed by
// principal id, lowercased. A label is shown with the bot label's tag
// (src/components/LabelTag.tsx) and edited with the bot panel's inline field.
import { useEffect, useSyncExternalStore } from "react";

import { normalizePersonLabel } from "../../shared/person-label";
import { readableError } from "@/lib/plain-error";

// Plain fetch, not the store's api(): the store imports this module for the
// `person.label` frame.
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { "content-type": "application/json" }, ...init });
  const body = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(readableError(body.error ?? `${res.status} ${res.statusText}`));
  return body;
}

let labels: ReadonlyMap<string, string> = new Map();
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

const key = (principalId: string) => principalId.trim().toLowerCase();

function publish(next: ReadonlyMap<string, string>): void {
  labels = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Ask the server once (again with `force`). A failure keeps what is known. */
export function loadPersonLabels(force = false): Promise<void> {
  if (force) pending = null;
  pending ??= request<{ labels?: Record<string, unknown> }>("/api/people/labels")
    .then((body) => {
      const next = new Map<string, string>();
      for (const [id, value] of Object.entries(body.labels ?? {})) {
        if (typeof value === "string" && value.trim()) next.set(key(id), value.trim());
      }
      // A frame that arrived while the list was on its way wins over it.
      publish(new Map([...next, ...[...labels].filter(([id]) => !next.has(id))]));
    }, () => {});
  return pending;
}

/** A `person.label` frame, or the answer of a save. */
export function applyPersonLabel(principalId: string, label: string | null | undefined): void {
  const id = key(principalId);
  if (!id) return;
  const text = typeof label === "string" ? label.trim() : "";
  if ((labels.get(id) ?? "") === text) return;
  const next = new Map(labels);
  if (text) next.set(id, text);
  else next.delete(id);
  publish(next);
}

/** This person's custom tag from the store, "" when they have none.
 * Not human-label's display-name helper (name/login/email candidates). */
export function personLabel(principalId: string | null | undefined): string {
  return principalId ? labels.get(key(principalId)) ?? "" : "";
}

export function usePersonLabel(principalId: string | null | undefined): string {
  const label = useSyncExternalStore(subscribe, () => personLabel(principalId), () => personLabel(principalId));
  useEffect(() => { void loadPersonLabels(); }, []);
  return label;
}

/** Save a label (blank clears it) and show it at once from the answer. */
export async function savePersonLabel(principalId: string, label: string): Promise<void> {
  const normalized = normalizePersonLabel(label);
  if (!normalized.ok) throw new Error(normalized.code);
  const saved = await request<{ principalId: string; label: string | null }>(`/api/people/${encodeURIComponent(principalId)}/label`, {
    method: "PUT",
    body: JSON.stringify({ label: normalized.label }),
  });
  applyPersonLabel(saved.principalId ?? principalId, saved.label);
}

/** Who may change a person's label, as the server decides it
 * (server/routes/person-labels.ts): the person, an organization admin, a
 * manager of one of their teams. */
export function canEditPersonLabel(input: {
  personId: string;
  viewerId: string | null | undefined;
  viewerAdmin: boolean;
  managedTeamIds?: readonly string[];
  personTeamIds?: readonly string[];
}): boolean {
  if (input.viewerId && key(input.viewerId) === key(input.personId)) return true;
  if (input.viewerAdmin) return true;
  const managed = new Set(input.managedTeamIds ?? []);
  return (input.personTeamIds ?? []).some((team) => managed.has(team));
}

/** Test seam: start over. */
export function resetPersonLabelsForTests(next: Record<string, string> = {}): void {
  pending = Promise.resolve();
  publish(new Map(Object.entries(next).map(([id, label]) => [key(id), label])));
}

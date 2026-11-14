// the GitHub plugin's page in Connect apps (2026-10-28): the one list of
// credentials beside the GitHub account (server/routes/github-credentials.ts)
// and each marketplace's pick of one in Sources. The list is shared by the
// GitHub section and the marketplace rows through one small store, loaded
// once and refreshed after each change. A server restarting behind its proxy
// is asked again before anything shows; a failure shows as a plain line.
// Nothing here ever holds a token the server sent: the server never sends one.
import { useEffect, useSyncExternalStore } from "react";

import type { GithubCredentialPublic, MarketplaceCredentialView } from "../../shared/github-credentials";
import { readableError, retryTransient } from "@/lib/plain-error";
import { api } from "@/state/store";

export type { GithubCredentialPublic, MarketplaceCredentialView };

export interface GithubCredentialsView {
  credentials: GithubCredentialPublic[];
  /** an organization admin: may change the organization's credentials */
  canManageOrg: boolean;
  /** the organization's GitHub OAuth App is set: Connect GitHub runs the device flow */
  deviceFlow: boolean;
  /** #4155: the saved list does not open on this server; adding a credential again starts a new one */
  unreadable?: "sealed";
}

export type GithubCredentialChange =
  | { op: "add"; label: string; token: string; scope?: "mine" | "org" }
  | { op: "remove"; id: string }
  | { op: "rename"; id: string; label: string }
  | { op: "replace"; id: string; token: string };

const PATH = "/api/me/github/credentials";

let current: GithubCredentialsView | null = null;
let failed: string | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

export function loadGithubCredentials(force = false): Promise<void> {
  if (loading && !force) return loading;
  loading = retryTransient(() => api<GithubCredentialsView>(PATH))
    .then((view) => { current = view; failed = null; })
    .catch((error: unknown) => { failed = readableError(error); })
    .finally(() => { loading = null; emit(); });
  return loading;
}

/** One change; the list as the server keeps it afterwards. */
export async function changeGithubCredential(change: GithubCredentialChange): Promise<void> {
  current = await api<GithubCredentialsView>(PATH, { method: "POST", body: JSON.stringify(change) });
  failed = null;
  emit();
}

/** Tests and the gallery set the list without a server. */
export function setGithubCredentialsForTest(view: GithubCredentialsView | null): void {
  current = view;
  failed = null;
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The list (null while it loads) and the error of its last load. `load`
 * false: only what is already loaded (a screen with nothing to pick). */
export function useGithubCredentials(load = true): { view: GithubCredentialsView | null; error: string | null } {
  const view = useSyncExternalStore(subscribe, () => current, () => current);
  const error = useSyncExternalStore(subscribe, () => failed, () => failed);
  useEffect(() => {
    if (load && !current && !loading) void loadGithubCredentials();
  }, [load]);
  return { view, error };
}

/** The choices a marketplace row offers: Automatic, then the viewer's own
 * credentials, then the organization's; a pick of someone else's stays
 * listed so the row shows what it uses. */
export function credentialOptions(view: GithubCredentialsView | null, chosen?: MarketplaceCredentialView["chosen"]): Array<{ id: string; label: string; owner: "mine" | "org" | "other" }> {
  const options: Array<{ id: string; label: string; owner: "mine" | "org" | "other" }> = (view?.credentials ?? [])
    .map((entry) => ({ id: entry.id, label: entry.label, owner: entry.owner }));
  if (chosen && !options.some((option) => option.id === chosen.id)) options.push({ id: chosen.id, label: chosen.label, owner: chosen.owner });
  return options;
}

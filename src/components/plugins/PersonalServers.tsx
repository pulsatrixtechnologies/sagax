// Plugins > Me > Installed: the person's own MCP servers (organization
// server, 2026-11-06). One row each, like an installed plugin: name, where
// it runs, its state, Sign in when it waits for one, and the "..." menu
// (Edit, Sign in / Sign out, Turn on / off, Remove). "+ Add" opens the same
// flows as under Organization (Add an MCP server, Paste config), each one
// adding a server of the person's own. No admin needed: they are theirs.
import { useState, type ReactNode } from "react";
import { LogIn, LogOut, Pencil, Power, Server } from "lucide-react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { readableError } from "@/lib/plain-error";
import {
  disconnectPersonalServer, removePersonalServer, setPersonalServerEnabled, startPersonalServerSignIn,
  type MyConnections, type PersonalServer,
} from "@/lib/my-connections";
import { PersonalImportForm, PersonalServerForm, stateLabel, useMyConnections } from "../settings/MyConnectionsSettings";
import { EntryMenu, type EntryActions } from "./InstalledView";
import { PluginStatusLabel } from "./PluginParts";
import { PLUGINS } from "./plugins-style";

type Form = { kind: "add" } | { kind: "import" } | { kind: "edit"; name: string } | null;

/** an OAuth sign-in under way: read again until it lands */
const signingIn = (data: { servers: PersonalServer[] }) => data.servers.some((server) => server.kind === "remote" && server.authPending);
const waitsForSignIn = (server: PersonalServer) => server.kind === "remote" && server.auth === "oauth" && server.authState !== "connected";

export interface PersonalMcp {
  rows: Array<{ key: string; node: ReactNode }>;
  forms: ReactNode;
  startAdd: () => void;
  startImport: () => void;
  refresh: () => Promise<void>;
  busy: boolean;
}

/** `active`: the Me scope on an organization server (the /api/me routes).
 * `initial`: what was already read (tests, a preloaded view). */
export function usePersonalMcp(active: boolean, initial?: MyConnections): PersonalMcp {
  const { data, error: loadError, refresh } = useMyConnections(initial, signingIn, active);
  const [form, setForm] = useState<Form>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (failure) {
      setError(readableError(failure));
    } finally {
      setBusy(null);
    }
  };
  const signIn = (name: string) => run(`signin:${name}`, async () => {
    const started = await startPersonalServerSignIn(name);
    await openExternalLink(started.authorizationUrl);
  });
  const servers = active ? data?.servers ?? [] : [];
  const done = async () => { setForm(null); await refresh(); };

  const rows = servers.map((server) => {
    const oauth = server.kind === "remote" && server.auth === "oauth";
    const actions: EntryActions = {
      links: [
        { id: "edit", label: t("myConnections.servers.edit"), icon: <Pencil size={14} />, run: () => setForm({ kind: "edit", name: server.name }) },
        ...(oauth && server.authState === "connected"
          ? [{ id: "signout", label: t("myConnections.servers.signOut"), icon: <LogOut size={14} />, run: () => void run(`out:${server.name}`, () => disconnectPersonalServer(server.name)) }]
          : oauth ? [{ id: "signin", label: t("myConnections.servers.signIn"), icon: <LogIn size={14} />, run: () => void signIn(server.name) }] : []),
        { id: "toggle", label: server.enabled ? t("myConnections.servers.turnOff") : t("myConnections.servers.turnOn"), icon: <Power size={14} />,
          run: () => void run(`toggle:${server.name}`, () => setPersonalServerEnabled(server.name, !server.enabled)) },
      ],
      remove: () => void run(`rm:${server.name}`, () => removePersonalServer(server.name)),
    };
    const status = !server.enabled ? "off" : server.authState === "connected" || server.authState === "ready" ? "connected" : "needs_auth";
    return {
      key: server.name,
      node: (
        <div className="group flex items-center gap-2 py-[11px]" data-installed-entry={`personal:${server.name}`} data-personal-server={server.name}>
          <button type="button" onClick={() => setForm({ kind: "edit", name: server.name })} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left"
            aria-label={t("connectApps.openAria", { name: server.name })}>
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-card text-ink-secondary"><Server size={18} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className={PLUGINS.rowName}>{server.name}</span>
              <span className={PLUGINS.rowSub}>
                {server.kind === "remote" ? server.domain : t("myConnections.servers.runsInEnvironment", { command: server.command })}
                {/* "connected" is the status on the right already */}
                {server.authState !== "connected" && <>{" · "}{stateLabel(server)}</>}
              </span>
              {server.kind === "remote" && server.authError && <span className="block truncate text-[11.5px] text-danger">{server.authError}</span>}
            </span>
            {!(server.enabled && waitsForSignIn(server)) && <PluginStatusLabel status={status} className="text-[13px] font-normal" />}
          </button>
          {server.enabled && waitsForSignIn(server) && (
            <button type="button" className="ui-button shrink-0" data-personal-sign-in={server.name} disabled={busy !== null} onClick={() => void signIn(server.name)}>{t("myConnections.servers.signIn")}</button>
          )}
          <EntryMenu name={server.name} actions={actions} updateWaiting={false} hoverOnly />
        </div>
      ),
    };
  });

  const editing = form?.kind === "edit" ? servers.find((server) => server.name === form.name) : undefined;
  const forms = active ? (
    <>
      {(error ?? loadError) && <p role="alert" className="mb-3 text-[12px] text-danger">{error ?? loadError}</p>}
      {form?.kind === "import" && <PersonalImportForm onDone={done} onCancel={() => setForm(null)} />}
      {data && form?.kind === "add" && <PersonalServerForm data={data} onDone={done} onCancel={() => setForm(null)} />}
      {data && editing && <PersonalServerForm key={editing.name} data={data} editing={editing} onDone={done} onCancel={() => setForm(null)} />}
    </>
  ) : null;

  return {
    rows,
    forms,
    startAdd: () => setForm({ kind: "add" }),
    startImport: () => setForm((current) => current?.kind === "import" ? null : { kind: "import" }),
    refresh,
    busy: busy !== null,
  };
}

// A person's own connections on an organization server (it was Settings >
// Mes connexions, then Connect apps > Manage > Your connections). Their
// GitHub account ("Connecter GitHub": a code to type at GitHub, or a
// token), the one GitHub source of every use (GithubAccountSection), is on
// the GitHub plugin's page since 2026-10-29; their own MCP servers, listed
// in Plugins > Me > Installed like every other entry since 2026-11-06
// (plugins/PersonalServers.tsx), added from the same "+ Add" menu as the
// organization's (an address with no sign-in, a token, OAuth through this
// server, or their GitHub account; or a command that runs in their server
// environment; or a pasted config). The forms live here. Only for them:
// no other person's bot turn ever gets these
// (server/routes/person-connections.ts). The person manages them with no
// admin (the Sagax permission `apps.ownIntegrations`).
import { ChevronRight } from "lucide-react";
import { copyText } from "@/lib/copy-text";
import { useCallback, useEffect, useRef, useState } from "react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import { readableError, retryTransient } from "@/lib/plain-error";
import {
  addPersonalServer, connectGithubToken, disconnectGithub, GITHUB_MCP_URL, githubUnreadable, importPersonalServers, loadMyConnections, parseArgsLine,
  parseEnvLines, startGithubDevice, suggestServerName, updatePersonalServer,
  type MyConnections, type NewPersonalServer, type PersonalServer,
} from "@/lib/my-connections";
import { PillSelect } from "../SettingsPrimitives";
import { useSavedKeysUnreadable } from "../SavedKeysReset";

const message = readableError;
const inputClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";

/** GET /api/me/connections, asked again every two seconds while `waiting`
 * says a code or a sign-in is pending. A server restarting behind its proxy
 * (a bare 502) is asked again before anything shows. */
export function useMyConnections(initial: MyConnections | undefined, waiting: (data: MyConnections) => boolean, active = true) {
  const [data, setData] = useState<MyConnections | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await retryTransient(loadMyConnections));
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  const preloaded = useRef(Boolean(initial));
  useEffect(() => {
    if (preloaded.current) { preloaded.current = false; return; }
    if (active) void refresh();
  }, [refresh, active]);
  const pending = active && data ? waiting(data) : false;
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => { void refresh(); }, 2_000);
    return () => clearInterval(timer);
  }, [pending, refresh]);
  return { data, error, refresh };
}

function Loading({ error }: { error: string | null }) {
  return error
    ? <p role="alert" className="text-[12.5px] text-danger">{error}</p>
    : <p className="text-[12.5px] text-ink-secondary">{t("myConnections.loading")}</p>;
}

/** the GitHub plugin's page in Connect apps: the person's own GitHub connection,
 * inside GithubAccountSection. Connect GitHub is everyone's, with no admin
 * step (owner, 2026-10-28): always GitHub's link plus a code (owner 2026-11-08),
 * a pasted token only under Advanced. */
export function MyGithubConnection({ initial }: { initial?: MyConnections }) {
  const { data, error, refresh } = useMyConnections(initial, (value) => value.github.state === "pending");
  if (!data) return <Loading error={error} />;
  return (
    <div className="flex flex-col gap-3" data-my-github>
      <GithubCard data={data} onChanged={refresh} />
    </div>
  );
}

/** The GitHub connection row's account line in Connect apps > Sources:
 * connected as, reconnect when the token was refused, or not connected.
 * Nothing while it reads. */
export function MyGithubSummary({ initial }: { initial?: MyConnections }) {
  const { data } = useMyConnections(initial, () => false);
  if (!data) return null;
  if (data.github.state === "connected") return <>{t("myConnections.github.connectedAs", { login: data.github.login })}</>;
  // #4155: a saved account this launch cannot read is never a plain "not connected".
  if (githubUnreadable(data.github)) return <>{t("myConnections.github.unreadableSummary")}</>;
  if (data.github.state === "error" && data.github.login) {
    return <>{t("myConnections.github.reconnectAs", { login: data.github.login })}</>;
  }
  return <>{t("myConnections.github.notConnected")}</>;
}

function GithubCard({ data, onChanged }: { data: MyConnections; onChanged: () => Promise<void> }) {
  const github = data.github;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // the device flow that could not start (disabled, refused, unreachable):
  // said above Try again, the token under Advanced as the fallback
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  // #4155: no key on the server this launch. The account is kept and comes back with the key; connecting
  // could not be saved either, so no Connect is offered. When that key is this desktop's own (its saved keys
  // could not be read: only ever true on this app's local page, never on an organization server's page), the
  // one action is the existing Reset saved keys: this card names it and the Apps panel's notice above holds it
  // (SavedKeysResetNotice), so the same button is never drawn twice in one window.
  const savedKeysUnreadable = useSavedKeysUnreadable();
  const run = async (work: () => Promise<unknown>, device = false) => {
    setBusy(true);
    setError(null);
    setDeviceError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      (device ? setDeviceError : setError)(message(failure));
    } finally {
      setBusy(false);
    }
  };
  if (github.state === "error" && github.code === "store_unavailable") {
    return (
      <div className="flex flex-col gap-2.5 text-[13px]" data-github-state={github.state}>
        <p role="alert" className="text-[12px] text-danger" data-github-auth-error>
          {t(savedKeysUnreadable ? "myConnections.github.savedKeysUnreadable" : "myConnections.github.storeUnavailable")}
        </p>
      </div>
    );
  }
  return (
      <div className="flex flex-col gap-2.5 text-[13px]" data-github-state={github.state}>
        {github.state === "connected" && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink">{t("myConnections.github.connectedAs", { login: github.login })}</span>
            <button type="button" className="ui-button" disabled={busy} onClick={() => void run(disconnectGithub)}>{t("myConnections.github.disconnect")}</button>
          </div>
        )}
        {github.state === "connected" && github.orgAccessUrl && (
          <div><button type="button" className="ui-button" data-github-org-access onClick={() => void openExternalLink(github.orgAccessUrl!)}>{t("myConnections.github.orgAccess")}</button></div>
        )}
        {github.state === "connected" && github.fineGrained && (
          <p role="status" className="text-[12px] leading-relaxed text-warning" data-github-fine-grained>{t("myConnections.github.fineGrained", { login: github.login })}</p>
        )}
        {github.state === "pending" && (
          <div className="flex flex-col gap-2" data-github-code>
            <span className="text-ink-secondary">{t("myConnections.github.typeCode")}</span>
            <div className="flex flex-wrap items-center gap-3">
              <code className="rounded-lg bg-inset px-3 py-1.5 font-mono text-[18px] tracking-widest text-ink">{github.userCode}</code>
              <button type="button" className="ui-button" onClick={() => void copyText(github.userCode)}>{t("myConnections.github.copyCode")}</button>
              <button type="button" className="ui-button" onClick={() => void openExternalLink(github.verificationUri)}>{t("myConnections.github.openGithub")}</button>
            </div>
            <span className="text-[12px] text-ink-secondary">{t("myConnections.github.waiting")}</span>
          </div>
        )}
        {(github.state === "none" || github.state === "error") && (
          <>
            {github.state === "error" && <p role="alert" className="text-[12px] text-danger" data-github-auth-error>{github.code === "store_sealed" ? t("myConnections.github.storeSealed") : github.error}</p>}
            {github.state === "error" && github.login && (
              <p className="text-[12px] text-ink-secondary" data-github-reconnect-hint>{t("myConnections.github.reconnectHint", { login: github.login })}</p>
            )}
            {deviceError && <p role="alert" className="text-[12px] text-danger" data-github-device-error>{deviceError}</p>}
            {(deviceError || (github.state === "error" && !github.login)) && (
              <p className="text-[12px] leading-relaxed text-ink-secondary" data-github-fallback-hint>{t("myConnections.github.fallbackHint")}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {/* owner 2026-11-08: every GitHub connection is GitHub's link plus
                  a code, whatever the server has (Sagax's built-in OAuth App,
                  server/github/builtin-client.ts); a token is never first,
                  only under Advanced. */}
              <button type="button" className="ui-button ui-button-primary" disabled={busy} data-github-connect="device"
                onClick={() => void run(startGithubDevice, true)}>
                {github.state === "error" && github.login
                  ? t("myConnections.github.reconnect")
                  : deviceError || github.state === "error" ? t("myConnections.github.retry") : t("myConnections.github.connect")}
              </button>
              {github.state === "error" && github.login && (
                <button type="button" className="ui-button" disabled={busy} data-github-disconnect-dead onClick={() => void run(disconnectGithub)}>{t("myConnections.github.disconnect")}</button>
              )}
            </div>
          </>
        )}
        {github.state !== "connected" && (
          <div className="flex flex-col gap-2" data-github-advanced>
            <button
              type="button"
              className="inline-flex w-fit items-center gap-1 text-[12px] font-medium text-ink-secondary hover:text-ink"
              aria-expanded={tokenOpen}
              data-github-advanced-toggle
              onClick={() => setTokenOpen((open) => !open)}
            >
              <ChevronRight aria-hidden="true" size={12} className={tokenOpen ? "rotate-90 transition-transform" : "transition-transform"} />
              {t("myConnections.github.advanced")}
            </button>
            {tokenOpen && (
              <form
                className="flex flex-col gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await connectGithubToken(token);
                    setToken("");
                    setTokenOpen(false);
                  });
                }}
              >
                <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder="github_pat_..." aria-label={t("myConnections.github.tokenLabel")} className={inputClass} />
                <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.github.tokenHint")}</p>
                <div><button type="submit" className="ui-button ui-button-primary" disabled={busy || !token.trim()}>{t("myConnections.github.saveToken")}</button></div>
              </form>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
  );
}

export function stateLabel(server: PersonalServer): string {
  switch (server.authState) {
    case "connected": return t("myConnections.state.connected");
    case "ready": return t("myConnections.state.ready");
    case "needs_sign_in": return t("myConnections.state.needsSignIn");
    case "needs_github": return t("myConnections.state.needsGithub");
    case "needs_token": return t("myConnections.state.needsToken");
    case "expired": return t("myConnections.state.expired");
    case "no_environment": return t("myConnections.state.noEnvironment");
    default: return t("myConnections.state.error");
  }
}

type Auth = "none" | "token" | "oauth" | "github";

/** Plugins > Me > Add an MCP server, or Edit on one of the person's own
 * rows: a remote address (no sign-in, a token, OAuth, their GitHub account)
 * or a command in their server environment. Editing never shows the token
 * or the variables: left empty, they are kept. */
export function PersonalServerForm({ data, editing, onDone, onCancel }: { data: MyConnections; editing?: PersonalServer; onDone: () => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<"remote" | "stdio">(editing?.kind ?? "remote");
  const [name, setName] = useState(editing?.name ?? "");
  const named = useRef(Boolean(editing));
  const [url, setUrl] = useState(editing?.kind === "remote" ? editing.url : "");
  const [auth, setAuth] = useState<Auth>(editing?.kind === "remote" ? editing.auth : "oauth");
  const [token, setToken] = useState("");
  const [command, setCommand] = useState(editing?.kind === "stdio" ? editing.command : "");
  const [args, setArgs] = useState(editing?.kind === "stdio" ? editing.args.join(" ") : "");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keepsToken = editing?.kind === "remote" && editing.auth === "token" && editing.tokenConfigured;
  const keepsEnv = editing?.kind === "stdio" && editing.envKeys.length > 0;

  const githubPreset = () => {
    setKind("remote");
    setUrl(GITHUB_MCP_URL);
    setAuth("github");
    if (!named.current) setName("github");
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const finalName = name.trim() || suggestServerName(kind === "remote" ? url : command);
      let body: NewPersonalServer;
      if (kind === "remote") {
        body = { name: finalName, url: url.trim(), auth, ...(auth === "token" && token.trim() ? { token: token.trim() } : {}) };
      } else {
        const parsed = parseEnvLines(env);
        if (!parsed.ok) throw new Error(t("myConnections.add.badEnv", { line: parsed.line }));
        body = { name: finalName, command: command.trim(), args: parseArgsLine(args), env: parsed.env };
      }
      if (editing) await updatePersonalServer(editing.name, body);
      else await addPersonalServer(body);
      await onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="mb-4 flex flex-col gap-2.5 rounded-2xl border border-hairline/60 bg-card p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); void submit(); }}
      data-add-personal-server={editing ? undefined : ""} data-edit-personal-server={editing?.name}>
      <div className="text-[14px] font-medium text-ink">{editing ? t("myConnections.edit.title", { name: editing.name }) : t("connectApps.manage.addServer")}</div>
      <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.servers.subtitle")}</p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={kind === "remote" ? "ui-button ui-button-primary" : "ui-button"} onClick={() => setKind("remote")}>{t("myConnections.add.remote")}</button>
        <button type="button" className={kind === "stdio" ? "ui-button ui-button-primary" : "ui-button"} disabled={!data.sandbox} onClick={() => setKind("stdio")}>{t("myConnections.add.command")}</button>
        {!editing && <button type="button" className="ui-button" onClick={githubPreset}>{t("myConnections.add.githubPreset")}</button>}
      </div>
      <input value={name} onChange={(event) => { named.current = true; setName(event.target.value); }} placeholder={t("myConnections.add.namePlaceholder")} aria-label={t("myConnections.add.name")} className={inputClass} />
      {kind === "remote" ? (
        <>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" aria-label={t("myConnections.add.url")} className={inputClass} />
          <div className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
            {t("myConnections.add.auth")}
            <PillSelect<Auth> value={auth} onChange={setAuth} ariaLabel={t("myConnections.add.auth")} options={[
              { value: "oauth", label: t("myConnections.auth.oauth") },
              { value: "token", label: t("myConnections.auth.token") },
              { value: "github", label: t("myConnections.auth.github") },
              { value: "none", label: t("myConnections.auth.none") },
            ]} />
          </div>
          {auth === "token" && <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={keepsToken ? t("myConnections.edit.tokenKept") : t("myConnections.add.tokenPlaceholder")} aria-label={t("myConnections.auth.token")} className={inputClass} />}
          {auth === "oauth" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.add.oauthHint")}</p>}
          {auth === "github" && data.github.state !== "connected" && <p className="text-[12px] leading-relaxed text-ink-secondary" data-github-auth-hint>{t("myConnections.add.githubHint")}</p>}
        </>
      ) : (
        <>
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" aria-label={t("myConnections.add.commandLabel")} className={inputClass} />
          <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @modelcontextprotocol/server-github" aria-label={t("myConnections.add.args")} className={inputClass} />
          <textarea value={env} onChange={(event) => setEnv(event.target.value)} rows={2} placeholder={keepsEnv ? t("myConnections.edit.envKept", { keys: editing.envKeys.join(", ") }) : "GITHUB_PERSONAL_ACCESS_TOKEN=..."} aria-label={t("myConnections.add.env")} className={inputClass} />
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.add.commandHint")}</p>
        </>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="ui-button ui-button-primary" disabled={busy || (kind === "remote" ? !url.trim() : !command.trim())}>{editing ? t("myConnections.edit.save") : t("myConnections.add.save")}</button>
        <button type="button" className="ui-button" onClick={onCancel}>{t("myConnections.add.cancel")}</button>
      </div>
    </form>
  );
}

/** Plugins > Me > Add > Paste config: the block the organization's import
 * reads (mcpServers, a bare map, one entry, an address, a command line),
 * every server added as the person's own. */
export function PersonalImportForm({ onDone, onCancel }: { onDone: () => Promise<void>; onCancel: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await importPersonalServers(text);
      setText("");
      await onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mb-4 rounded-2xl border border-hairline/60 bg-card p-4 sm:p-5" data-import-personal-servers>
      <div className="text-[14px] font-medium text-ink">{t("mcp.import")}</div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.import.hint")}</p>
      <textarea
        autoFocus
        aria-label={t("mcp.import")}
        value={text}
        onChange={(event) => setText(event.target.value)}
        spellCheck={false}
        rows={8}
        placeholder={'{\n  "mcpServers": {\n    "notes": { "command": "npx", "args": ["-y", "@example/notes-mcp"], "env": { "NOTES_TOKEN": "…" } },\n    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }\n  }\n}'}
        className="mt-3 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
      />
      {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button type="button" disabled={busy} onClick={onCancel} className="rounded-lg px-3 py-2 text-[12.5px] text-ink-secondary hover:text-ink">{t("common.cancel")}</button>
        <button type="button" disabled={busy || !text.trim()} onClick={() => void submit()} className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">{t("mcp.importAction")}</button>
      </div>
    </div>
  );
}

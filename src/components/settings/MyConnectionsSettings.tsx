// Connect apps > Manage > Your connections (organization server only; it
// was Settings > Mes connexions): the person's own
// GitHub account ("Connecter GitHub": a code to type at GitHub, or a token)
// and their own MCP servers ("Ajouter un serveur MCP": an address with no
// sign-in, a token, OAuth through this server, or their GitHub account; or
// a command that runs in their server environment). Only for them: no other
// person's bot turn ever gets these (server/routes/person-connections.ts).
// When an admin manages them (Perspicax `sagax_integrations: off`), the
// section is read-only under a short notice: what the person has stays
// saved and is not usable, and only a sign-in again to one of their
// servers is offered.
import { copyText } from "@/lib/copy-text";
import { useCallback, useEffect, useRef, useState } from "react";

import { openExternalLink } from "@/lib/app-links";
import { t } from "@/lib/i18n";
import {
  addPersonalServer, connectGithubToken, disconnectGithub, disconnectPersonalServer, GITHUB_MCP_URL, loadMyConnections, parseArgsLine,
  parseEnvLines, removePersonalServer, setPersonalServerEnabled, startGithubDevice, startPersonalServerSignIn, suggestServerName,
  type MyConnections, type PersonalServer,
} from "@/lib/my-connections";
import { Card, Switch } from "../SettingsPrimitives";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const inputClass = "w-full rounded-lg border border-border bg-ink/[0.03] px-2.5 py-1.5 text-[13px] text-ink placeholder:text-ink-secondary focus:border-border-strong focus:outline-none";

export function MyConnectionsSettings({ initial }: { initial?: MyConnections }) {
  const [data, setData] = useState<MyConnections | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setData(await loadMyConnections());
      setError(null);
    } catch (failure) {
      setError(message(failure));
    }
  }, []);
  const preloaded = useRef(Boolean(initial));
  useEffect(() => {
    if (preloaded.current) { preloaded.current = false; return; }
    void refresh();
  }, [refresh]);
  // While a GitHub code or a sign-in waits, ask again every two seconds.
  const waiting = data?.github.state === "pending" || data?.servers.some((server) => server.kind === "remote" && server.authPending);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => { void refresh(); }, 2_000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  if (!data) {
    return error
      ? <p role="alert" className="text-[12.5px] text-danger">{error}</p>
      : <p className="text-[12.5px] text-ink-secondary">{t("myConnections.loading")}</p>;
  }
  return (
    <div className="flex flex-col gap-4" data-my-connections>
      <p className="text-[13px] leading-relaxed text-ink-secondary">{t("myConnections.intro")}</p>
      {data.managedByAdmin && <IntegrationsManagedNotice />}
      <GithubCard data={data} onChanged={refresh} />
      <ServersCard data={data} onChanged={refresh} />
    </div>
  );
}

/** Perspicax `sagax_integrations: off`: one short line, no admin prompt
 * otherwise. Shared with the bot panel's Library. */
export function IntegrationsManagedNotice() {
  return (
    <p role="note" className="rounded-lg bg-inset px-3 py-2 text-[12.5px] leading-relaxed text-ink-secondary" data-integrations-managed>
      {t("integrations.managedByAdmin")}
    </p>
  );
}

function GithubCard({ data, onChanged }: { data: MyConnections; onChanged: () => Promise<void> }) {
  const github = data.github;
  const locked = data.managedByAdmin === true;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [token, setToken] = useState("");
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card cardId="myConnections.github" title={t("myConnections.github.title")} subtitle={t("myConnections.github.subtitle")}>
      <div className="flex flex-col gap-2.5 text-[13px]" data-github-state={github.state}>
        {github.state === "connected" && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-ink">{t("myConnections.github.connectedAs", { login: github.login })}</span>
            {!locked && <button type="button" className="ui-button" disabled={busy} onClick={() => void run(disconnectGithub)}>{t("myConnections.github.disconnect")}</button>}
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
        {locked && github.state !== "connected" && <p className="text-[12px] text-ink-secondary">{t("myConnections.github.notConnected")}</p>}
        {!locked && (github.state === "none" || github.state === "error") && (
          <>
            {github.state === "error" && <p role="alert" className="text-[12px] text-danger">{github.error}</p>}
            <div className="flex flex-wrap gap-2">
              {github.deviceFlow && (
                <button type="button" className="ui-button ui-button-primary" disabled={busy} onClick={() => void run(startGithubDevice)}>{t("myConnections.github.connect")}</button>
              )}
              <button type="button" className="ui-button" disabled={busy} onClick={() => setTokenOpen((open) => !open)}>{t("myConnections.github.useToken")}</button>
            </div>
            {!github.deviceFlow && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.github.noDeviceFlow")}</p>}
          </>
        )}
        {!locked && tokenOpen && github.state !== "connected" && (
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
        <p className="text-[12px] leading-relaxed text-ink-secondary">{data.sandbox ? t("myConnections.github.usesEnvironment") : t("myConnections.github.uses")}</p>
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}

function stateLabel(server: PersonalServer): string {
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

function ServersCard({ data, onChanged }: { data: MyConnections; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const locked = data.managedByAdmin === true;
  const run = async (key: string, work: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
      await onChanged();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(null);
    }
  };
  const signIn = (name: string) => run(`signin:${name}`, async () => {
    const started = await startPersonalServerSignIn(name);
    await openExternalLink(started.authorizationUrl);
  });
  return (
    <Card cardId="myConnections.servers" title={t("myConnections.servers.title")} subtitle={t("myConnections.servers.subtitle")}>
      <div className="flex flex-col gap-3 text-[13px]">
        {data.servers.length === 0 && <p className="rounded-lg bg-inset px-3 py-2 text-[12px] text-ink-secondary">{t("myConnections.servers.empty")}</p>}
        {data.servers.length > 0 && (
          <div className="divide-y divide-hairline/40 overflow-hidden rounded-lg border border-hairline/40">
            {data.servers.map((server) => (
              <div key={server.name} className="flex items-center gap-3 px-3 py-2.5" data-personal-server={server.name}>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[12.5px] text-ink">{server.name}</div>
                  <div className="mt-0.5 truncate text-[11.5px] text-ink-secondary">
                    {server.kind === "remote" ? server.domain : t("myConnections.servers.runsInEnvironment", { command: server.command })}
                    {" · "}{stateLabel(server)}
                  </div>
                  {server.kind === "remote" && server.authError && <div className="mt-0.5 text-[11.5px] text-danger">{server.authError}</div>}
                </div>
                {server.kind === "remote" && server.auth === "oauth" && server.authState !== "connected" && (
                  <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void signIn(server.name)}>{t("myConnections.servers.signIn")}</button>
                )}
                {!locked && server.kind === "remote" && server.auth === "oauth" && server.authState === "connected" && (
                  <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run(`out:${server.name}`, () => disconnectPersonalServer(server.name))}>{t("myConnections.servers.signOut")}</button>
                )}
                {!locked && (
                  <>
                    <Switch checked={server.enabled} disabled={busy !== null} aria-label={t("myConnections.servers.enabled", { name: server.name })} onClick={() => void run(`toggle:${server.name}`, () => setPersonalServerEnabled(server.name, !server.enabled))} />
                    <button type="button" className="ui-button" disabled={busy !== null} onClick={() => void run(`rm:${server.name}`, () => removePersonalServer(server.name))}>{t("myConnections.servers.remove")}</button>
                  </>
                )}
                {locked && !server.enabled && <span className="text-[11.5px] text-ink-secondary">{t("myConnections.servers.off")}</span>}
              </div>
            ))}
          </div>
        )}
        {locked ? null : adding
          ? <AddServerForm data={data} onDone={async () => { setAdding(false); await onChanged(); }} onCancel={() => setAdding(false)} />
          : <div><button type="button" className="ui-button ui-button-primary" onClick={() => setAdding(true)}>{t("myConnections.servers.add")}</button></div>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      </div>
    </Card>
  );
}

type Auth = "none" | "token" | "oauth" | "github";

function AddServerForm({ data, onDone, onCancel }: { data: MyConnections; onDone: () => Promise<void>; onCancel: () => void }) {
  const [kind, setKind] = useState<"remote" | "stdio">("remote");
  const [name, setName] = useState("");
  const named = useRef(false);
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<Auth>("oauth");
  const [token, setToken] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const githubPreset = () => {
    setKind("remote");
    setUrl(GITHUB_MCP_URL);
    setAuth(data.github.state === "connected" ? "github" : "token");
    if (!named.current) setName("github");
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const finalName = name.trim() || suggestServerName(kind === "remote" ? url : command);
      if (kind === "remote") {
        await addPersonalServer({ name: finalName, url: url.trim(), auth, ...(auth === "token" ? { token: token.trim() } : {}) });
      } else {
        const parsed = parseEnvLines(env);
        if (!parsed.ok) throw new Error(t("myConnections.add.badEnv", { line: parsed.line }));
        await addPersonalServer({ name: finalName, command: command.trim(), args: parseArgsLine(args), env: parsed.env });
      }
      await onDone();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex flex-col gap-2.5 rounded-lg bg-inset p-3" onSubmit={(event) => { event.preventDefault(); void submit(); }} data-add-personal-server>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={kind === "remote" ? "ui-button ui-button-primary" : "ui-button"} onClick={() => setKind("remote")}>{t("myConnections.add.remote")}</button>
        <button type="button" className={kind === "stdio" ? "ui-button ui-button-primary" : "ui-button"} disabled={!data.sandbox} onClick={() => setKind("stdio")}>{t("myConnections.add.command")}</button>
        <button type="button" className="ui-button" onClick={githubPreset}>{t("myConnections.add.githubPreset")}</button>
      </div>
      <input value={name} onChange={(event) => { named.current = true; setName(event.target.value); }} placeholder={t("myConnections.add.namePlaceholder")} aria-label={t("myConnections.add.name")} className={inputClass} />
      {kind === "remote" ? (
        <>
          <input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/mcp" aria-label={t("myConnections.add.url")} className={inputClass} />
          <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
            {t("myConnections.add.auth")}
            <select value={auth} onChange={(event) => setAuth(event.target.value as Auth)} className="rounded-lg border border-border bg-transparent px-2 py-1 text-[12.5px] text-ink">
              <option value="oauth">{t("myConnections.auth.oauth")}</option>
              <option value="token">{t("myConnections.auth.token")}</option>
              <option value="github" disabled={data.github.state !== "connected"}>{t("myConnections.auth.github")}</option>
              <option value="none">{t("myConnections.auth.none")}</option>
            </select>
          </label>
          {auth === "token" && <input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} placeholder={t("myConnections.add.tokenPlaceholder")} aria-label={t("myConnections.auth.token")} className={inputClass} />}
          {auth === "oauth" && <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.add.oauthHint")}</p>}
        </>
      ) : (
        <>
          <input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="npx" aria-label={t("myConnections.add.commandLabel")} className={inputClass} />
          <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="-y @modelcontextprotocol/server-github" aria-label={t("myConnections.add.args")} className={inputClass} />
          <textarea value={env} onChange={(event) => setEnv(event.target.value)} rows={2} placeholder="GITHUB_PERSONAL_ACCESS_TOKEN=..." aria-label={t("myConnections.add.env")} className={inputClass} />
          <p className="text-[12px] leading-relaxed text-ink-secondary">{t("myConnections.add.commandHint")}</p>
        </>
      )}
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" className="ui-button ui-button-primary" disabled={busy || (kind === "remote" ? !url.trim() : !command.trim())}>{t("myConnections.add.save")}</button>
        <button type="button" className="ui-button" onClick={onCancel}>{t("myConnections.add.cancel")}</button>
      </div>
    </form>
  );
}

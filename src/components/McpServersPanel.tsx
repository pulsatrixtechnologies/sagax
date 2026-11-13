import { useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { McpResultBudgetField } from "./McpResultBudgetField";
import {
  isRemoteMcpListing,
  probeFailureLabel,
  refusedKeys,
  type ClientDraft,
  type McpServerListing,
  type RemoteMcpListing,
  type ReservedMcpListing,
} from "./mcpServersModel";
import { type McpServers } from "./useMcpServers";

export { ClaudeCodeSwitches, ClaudeMcpSwitch } from "./ClaudeCodeSwitches";

export {
  isRemoteMcpListing,
  parseMcpArguments,
  parseMcpEnvironment,
  parseMcpHeaders,
  probeFailureLabel,
  probeToolsLabel,
  refusedKeys,
  signedInToolsCheck,
  type McpAccountListing,
  type McpAuthState,
  type McpServerListing,
  type ProbeResult,
  type ReservedMcpListing,
} from "./mcpServersModel";

export { useMcpServers, type McpServers } from "./useMcpServers";

export function WhopAction({ mcp }: { mcp: McpServers }) {
  const { servers, busy, signingIn, whopServer, whopConnected, whopLoading, waiting, restricted, policy, load, connectWhop, cancelWhop } = mcp;
  const whopWaiting = Boolean(whopServer && waiting[whopServer.name]);
  const pending = busy !== null || signingIn !== null || whopLoading;
  if ((whopWaiting || whopLoading) && whopServer) {
    return <button type="button" onClick={() => cancelWhop(whopServer.name)} className="ui-button min-w-[76px]">{t("mcp.auth.cancel")}</button>;
  }
  if (whopConnected) return null;
  const blocked = servers !== null && (Boolean(whopServer?.managedBy) || (restricted && !policy?.mcp.allowlist.length));
  return (
    <button
      type="button"
      aria-label={t("whop.connect")}
      disabled={pending || blocked}
      title={blocked && policy ? t("policy.managedBy", { organization: policy.organizationName }) : undefined}
      onClick={() => void (servers === null ? load() : connectWhop())}
      className="ui-button min-w-[76px] disabled:opacity-40"
    >
      {pending ? <Loader2 size={13} className="mx-auto animate-spin" /> : servers === null ? t("connectors.action.retry") : t("connectors.action.connect")}
    </button>
  );
}

/** Under Whop's row, only while it matters: the sign-in in flight, the
 * client id form a server without registration needs, or the error. */
export function WhopBelow({ mcp }: { mcp: McpServers }) {
  const { probe, oauthError, error, waiting, busy, whopServer, whopLoading, clientDraft, setClientDraft, signIn } = mcp;
  const result = whopServer && probe[whopServer.name];
  const whopError = whopServer && oauthError[whopServer.name];
  const failed = error || whopError || (result && !result.ok ? result.error : null);
  const whopWaiting = Boolean(whopServer && waiting[whopServer.name]);
  if (!whopWaiting && !whopLoading && !failed && !(whopServer && clientDraft[whopServer.name])) return null;
  return (
    <div className="ml-[52px]">
      {(whopWaiting || whopLoading) && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-lg bg-raised px-3 py-2 text-[12px] text-ink-secondary">
          <Loader2 size={13} className="shrink-0 animate-spin" /> {t(whopLoading ? "whop.loadingTools" : "mcp.oauth.waiting")}
        </div>
      )}
      {whopServer && clientDraft[whopServer.name] && (
        <McpClientForm
          draft={clientDraft[whopServer.name]!}
          disabled={busy !== null}
          onChange={(next) => setClientDraft((current) => ({ ...current, [whopServer.name]: next }))}
          onCancel={() => setClientDraft((current) => {
            const next = { ...current };
            delete next[whopServer.name];
            return next;
          })}
          onSubmit={() => void signIn(whopServer)}
        />
      )}
      {failed && !whopWaiting && !whopLoading && <p role="alert" className="mt-2 text-[12px] text-danger">{typeof failed === "string" ? failed : t(failed.key, failed.params)}</p>}
    </div>
  );
}

/** Paste a config block (the shape Claude Code, Cursor and Claude Desktop
 * write) to add several servers at once. */
export function McpImportForm({ mcp }: { mcp: McpServers }) {
  const { importOpen, importText, setImportText, setImportOpen, busy, importServers } = mcp;
  return (
    <>
        {importOpen && (
          <div className="mt-4 rounded-2xl border border-hairline/60 bg-card p-4 sm:p-5">
            <div className="text-[14px] font-medium text-ink">{t("mcp.import")}</div>
            <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("mcp.importHint")}</p>
            <textarea
              autoFocus
              aria-label={t("mcp.import")}
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              spellCheck={false}
              rows={8}
              placeholder={'{\n  "mcpServers": {\n    "notes": { "command": "npx", "args": ["-y", "@example/notes-mcp"], "env": { "NOTES_TOKEN": "…" } },\n    "docs": { "type": "http", "url": "https://mcp.example.com/mcp", "headers": { "Authorization": "Bearer …" } }\n  }\n}'}
              className="mt-3 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] leading-relaxed text-ink outline-none focus:border-accent"
            />
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy === "import"}
                onClick={() => {
                  setImportOpen(false);
                  setImportText("");
                }}
                className="rounded-lg px-3 py-2 text-[12.5px] text-ink-secondary hover:text-ink"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={busy !== null || !importText.trim()}
                onClick={() => void importServers()}
                className="rounded-lg bg-accent px-3 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-40"
              >
                {t("mcp.importAction")}
              </button>
            </div>
          </div>
        )}

    </>
  );
}

/** The add / edit form of one server: a command or an address, with its
 * environment or headers. Values saved before are never shown again. */
export function McpServerEditor({ mcp }: { mcp: McpServers }) {
  const { editing, draft, setDraft, busy, closeEditor, save, fixingKeys } = mcp;
  if (editing && editing !== "new" && fixingKeys) return <McpFixKeysEditor mcp={mcp} />;
  return (
    <>
        {editing && (
          <div className="mt-4 rounded-2xl border border-hairline/60 bg-card p-4 sm:p-5">
            <div className="text-[14px] font-medium text-ink">{editing === "new" ? t("mcp.editorNew") : t("mcp.editorEdit", { name: editing })}</div>
            {editing === "new" && (
              <div className="mt-3 inline-flex rounded-lg bg-raised p-0.5" role="radiogroup" aria-label={t("mcp.field.type")}>
                {(["stdio", "remote"] as const).map((transport) => (
                  <button
                    key={transport}
                    type="button"
                    role="radio"
                    aria-checked={draft.transport === transport}
                    onClick={() => setDraft((current) => ({ ...current, transport }))}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors",
                      draft.transport === transport ? "bg-card text-ink shadow-sm" : "text-ink-secondary hover:text-ink",
                    )}
                  >
                    {t(transport === "stdio" ? "mcp.transport.stdio" : "mcp.transport.remote")}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.name")}</span>
                <input
                  autoFocus={editing === "new"}
                  disabled={editing !== "new"}
                  value={draft.name}
                  maxLength={32}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value.toLowerCase() }))}
                  placeholder="github"
                  className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent disabled:opacity-60"
                />
              </label>
              {draft.transport === "remote" ? (
                <>
                  <label className="block">
                    <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.url")}</span>
                    <input
                      autoFocus={editing !== "new"}
                      value={draft.url}
                      onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))}
                      placeholder="https://mcp.example.com/mcp"
                      className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.type")}</span>
                    <select
                      value={draft.type}
                      onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value === "sse" ? "sse" : "http" }))}
                      className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent"
                    >
                      <option value="http">{t("mcp.type.http")}</option>
                      <option value="sse">{t("mcp.type.sse")}</option>
                    </select>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.headers")}</span>
                    <textarea
                      value={draft.headers}
                      onChange={(event) => setDraft((current) => ({ ...current, headers: event.target.value }))}
                      placeholder="Authorization: Bearer …"
                      rows={4}
                      className="mt-1.5 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                    />
                    <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("mcp.headersHint")}</span>
                  </label>
                </>
              ) : (
                <>
              <label className="block">
                <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.command")}</span>
                <input
                  autoFocus={editing !== "new"}
                  value={draft.command}
                  onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
                  placeholder="npx"
                  className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 text-[13px] text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.args")}</span>
                <textarea
                  value={draft.args}
                  onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))}
                  placeholder={"-y\n@modelcontextprotocol/server-github"}
                  rows={5}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                />
              </label>
              <label className="block">
                <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.env")}</span>
                <textarea
                  value={draft.env}
                  onChange={(event) => setDraft((current) => ({ ...current, env: event.target.value }))}
                  placeholder="GITHUB_TOKEN=…"
                  rows={5}
                  className="mt-1.5 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
                />
                {editing !== "new" && <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("mcp.envHint")}</span>}
              </label>
                </>
              )}
              <McpResultBudgetField value={draft.resultBudget} onChange={(resultBudget) => setDraft((current) => ({ ...current, resultBudget }))} />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={closeEditor} className="rounded-lg px-3 py-2 text-[12.5px] text-ink-secondary hover:bg-raised" data-mcp-editor-cancel>{t("mcp.cancel")}</button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void save()}
                className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-50"
              >
                {busy === "save" && <Loader2 size={13} className="animate-spin" />} {t("mcp.save")}
              </button>
            </div>
          </div>
        )}

    </>
  );
}

/** Saved servers whose name Sagax now reserves: never mounted, said here
 * with a rename (to a free name, saved off) or a removal. */
export function McpReservedServers({ mcp }: { mcp: McpServers }) {
  const { reserved, busy, renameReserved, remove } = mcp;
  if (!reserved.length) return null;
  return (
    <div className="mt-3 flex flex-col gap-2" data-mcp-reserved>
      {reserved.map((server) => (
        <McpReservedRow key={server.name} server={server} disabled={busy !== null} renaming={busy === `rename:${server.name}`}
          onRename={(to) => void renameReserved(server, to)} onRemove={() => void remove(server)} />
      ))}
    </div>
  );
}

function McpReservedRow({ server, disabled, renaming, onRename, onRemove }: {
  server: ReservedMcpListing;
  disabled: boolean;
  renaming: boolean;
  onRename: (to: string) => void;
  onRemove: () => void;
}) {
  const [to, setTo] = useState(server.suggestedName ?? "");
  return (
    <div role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[12px] text-ink">
      <div className="font-medium">{t("mcp.reserved.title", { name: server.name })}</div>
      <p className="mt-1 leading-relaxed text-ink-secondary">{t("mcp.reserved.body")}</p>
      <form
        className="mt-2 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onRename(to);
        }}
      >
        <input
          value={to}
          onChange={(event) => setTo(event.target.value.toLowerCase())}
          aria-label={t("mcp.reserved.newName", { name: server.name })}
          maxLength={32}
          spellCheck={false}
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-2 py-1.5 font-mono text-[12px] text-ink"
        />
        <button type="submit" disabled={disabled || !to.trim()} className="ui-button inline-flex items-center gap-1.5 text-[12px]">
          {renaming && <Loader2 size={12} className="animate-spin" />} {t("mcp.reserved.rename")}
        </button>
        <button type="button" disabled={disabled} onClick={onRemove} className="rounded-lg px-2.5 py-1.5 text-[12px] text-danger hover:bg-danger/10">
          {t("mcp.reserved.remove")}
        </button>
      </form>
    </div>
  );
}

/** Fix the keys: only the values of the headers the server refused, typed
 * again like passwords and never shown back. A server sent no header gets
 * the header lines, to add the key it asks for. Save tests again. */
function McpFixKeysEditor({ mcp }: { mcp: McpServers }) {
  const { editing, draft, setDraft, busy, closeEditor, save, servers, keyValues, setKeyValues } = mcp;
  const server = servers?.find((entry) => entry.name === editing);
  const names = server && isRemoteMcpListing(server) ? server.headerKeys : [];
  return (
    <div data-mcp-editor="fix-keys" className="mt-4 rounded-2xl border border-hairline/60 bg-card p-4 sm:p-5">
      <div className="text-[14px] font-medium text-ink">{t("mcp.fixKeys.title", { name: editing ?? "" })}</div>
      <p className="mt-1.5 text-[12px] leading-relaxed text-ink-secondary">{t("mcp.fixKeys.hint")}</p>
      <div className="mt-4 space-y-3">
        {names.length ? names.map((name) => (
          <label key={name} className="block">
            <span className="block font-mono text-[12px] font-medium text-ink-secondary">{name}</span>
            <input
              type="password"
              aria-label={name}
              autoComplete="new-password"
              spellCheck={false}
              autoFocus={name === names[0]}
              value={keyValues[name] ?? ""}
              placeholder={t("mcp.fixKeys.placeholder")}
              onChange={(event) => setKeyValues((current) => ({ ...current, [name]: event.target.value }))}
              className="mt-1.5 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
            />
          </label>
        )) : (
          <label className="block">
            <span className="text-[12px] font-medium text-ink-secondary">{t("mcp.field.headers")}</span>
            <textarea
              autoFocus
              value={draft.headers}
              onChange={(event) => setDraft((current) => ({ ...current, headers: event.target.value }))}
              placeholder="Authorization: Bearer …"
              rows={3}
              className="mt-1.5 w-full resize-y rounded-lg border border-hairline/60 bg-raised px-3 py-2.5 font-mono text-[12px] text-ink outline-none focus:border-accent"
            />
            <span className="mt-1.5 block text-[11px] text-ink-secondary">{t("mcp.headersHint")}</span>
          </label>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={closeEditor} className="rounded-lg px-3 py-2 text-[12.5px] text-ink-secondary hover:bg-raised" data-mcp-editor-cancel>{t("mcp.cancel")}</button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void save()}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12.5px] font-medium text-accent-ink disabled:opacity-50"
        >
          {busy === "save" && <Loader2 size={13} className="animate-spin" />} {t("mcp.save")}
        </button>
      </div>
    </div>
  );
}

/** Under a server whose test refused the keys: what to check, by header name
 * only, and Fix the keys. */
export function McpKeysRefused({ mcp, server }: { mcp: McpServers; server: McpServerListing }) {
  const result = mcp.probe[server.name];
  if (!result || !refusedKeys(server, result) || mcp.editing === server.name) return null;
  return (
    <div role="alert" data-mcp-keys-refused className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">
      <span className="min-w-0 flex-1">{probeFailureLabel(server, result)}</span>
      <button type="button" disabled={mcp.busy !== null} onClick={() => mcp.startFixKeys(server)} className="ui-button shrink-0 text-[12px] disabled:opacity-40">
        {t("mcp.check.fixKeys")}
      </button>
    </div>
  );
}

/** The panel's last error or confirmation about MCP servers. */
export function McpMessages({ mcp }: { mcp: McpServers }) {
  const { error, notice } = mcp;
  return (
    <>
        {error && <div role="alert" className="mt-3 rounded-lg bg-danger/10 px-3 py-2 text-[12px] text-danger">{typeof error === "string" ? error : t(error.key, error.params)}</div>}
        {notice && <div role="status" className="mt-3 rounded-lg bg-success/10 px-3 py-2 text-[12px] text-success">{t(notice.key, {
          ...notice.params,
          ...(notice.stateKey ? { state: t(notice.stateKey) } : {}),
        })}</div>}

    </>
  );
}

/** One line under a remote server: whether bots can reach it signed in. */
export function McpAuthLine({ server }: { server: RemoteMcpListing & { managedBy?: string } }) {
  const issuer = server.authIssuer ?? new URL(server.url).host;
  if (!server.auth || server.auth === "none") return null;
  if (server.auth === "connected") {
    return (
      <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-success">
        <CheckCircle2 size={12} className="shrink-0" /> <span className="truncate">{t("mcp.oauth.connectedWith", { issuer })}</span>
      </div>
    );
  }
  if (server.auth === "error") {
    return (
      <div className="mt-1.5 text-[11.5px] text-danger">
        <span className="font-medium">{t("mcp.oauth.error")}</span>{server.authError ? `. ${server.authError}` : ""}
      </div>
    );
  }
  return (
    <div className="mt-1.5 text-[11.5px] text-ink-secondary">
      <span className="rounded-full bg-raised px-2 py-0.5 text-[10.5px] font-medium text-ink">{t(server.auth === "expired" ? "mcp.oauth.expired" : "mcp.oauth.required")}</span>{" "}
      {server.auth === "expired" ? t("mcp.oauth.expiredHint") : t("mcp.oauth.requiredWith", { issuer })}
      {server.authError && <span className="mt-1 block text-danger">{server.authError}</span>}
    </div>
  );
}

/** For a provider without dynamic registration: the client the user made
 * there, and the redirect URI they must give it. `inCard`: it sits in a
 * section's card already (a plugin's Accounts), so it draws no box of its own
 * (#4154: one container). */
export function McpClientForm({ draft, disabled, onChange, onCancel, onSubmit, inCard }: {
  inCard?: boolean;
  draft: ClientDraft;
  disabled: boolean;
  onChange: (next: ClientDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className={inCard ? "border-t-[0.5px] border-ink/10 py-3" : "mt-3 rounded-xl border border-hairline/60 bg-raised/35 p-3.5"} data-mcp-client-form>
      <div className="text-[12.5px] font-medium text-ink">{t("mcp.oauth.clientTitle")}</div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-secondary">{t("mcp.oauth.clientHint")}</p>
      <label className="mt-3 block">
        <span className="text-[11.5px] font-medium text-ink-secondary">{t("mcp.oauth.redirectUri")}</span>
        <input readOnly value={draft.redirectUri} onFocus={(event) => event.currentTarget.select()} className="mt-1 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
      </label>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11.5px] font-medium text-ink-secondary">{t("mcp.oauth.clientId")}</span>
          <input autoFocus value={draft.clientId} onChange={(event) => onChange({ ...draft, clientId: event.target.value })} spellCheck={false} className="mt-1 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
        </label>
        <label className="block">
          <span className="text-[11.5px] font-medium text-ink-secondary">{t("mcp.oauth.clientSecret")}</span>
          <input type="password" autoComplete="off" value={draft.clientSecret} onChange={(event) => onChange({ ...draft, clientSecret: event.target.value })} spellCheck={false} className="mt-1 w-full rounded-lg border border-hairline/60 bg-raised px-3 py-2 font-mono text-[12px] text-ink outline-none focus:border-accent" />
        </label>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="ui-button text-[12px]">{t("mcp.cancel")}</button>
        <button type="button" disabled={disabled || !draft.clientId.trim()} onClick={onSubmit} className="ui-button ui-button-primary flex items-center gap-1.5 text-[12px] font-medium">
          <KeyRound size={13} /> {t("mcp.oauth.signIn")}
        </button>
      </div>
    </div>
  );
}


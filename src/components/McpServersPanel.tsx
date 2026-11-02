import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";

import { cn } from "@/lib/cn";
import { claudeUserMcpEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { updateMcpServers } from "@/lib/mcp-servers";
import { api, useStore, type ConfigStatus } from "@/state/store";

import { Switch } from "./SettingsPrimitives";
import { McpResultBudgetField, resultBudgetDraft, withResultBudget, type McpMessage, type McpResultBudgetDraft, type McpResultBudgetListing } from "./McpResultBudgetField";
import { WHOP_MCP_URL, isWhopServer, whopServerName } from "@/lib/whop-integration";
import { readableError } from "@/lib/plain-error";

/** A server this computer starts (a command) or one reached at a URL —
 * the two shapes the server stores. Secrets arrive as names only. */
interface StdioMcpListing extends McpResultBudgetListing {
  name: string;
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
}
interface RemoteMcpListing extends McpResultBudgetListing {
  name: string;
  type: "http" | "sse";
  url: string;
  headerKeys: string[];
  enabled: boolean;
  /** OAuth sign-in state; absent when the server has not been asked yet. */
  auth?: McpAuthState;
  authError?: string;
  /** "needed": the server offers no dynamic registration, so a client ID
   * registered with the provider must be entered before signing in. */
  authClient?: "dynamic" | "manual" | "needed";
  authIssuer?: string;
  authPending?: boolean;
  /** every saved sign-in, the default account first */
  accounts?: McpAccountListing[];
}
export interface McpAccountListing {
  /** "default", or the server's id for an account added after it */
  id: string;
  label?: string;
  auth: McpAuthState;
  authError?: string;
  authPending?: boolean;
}
export type McpAuthState = "none" | "required" | "connected" | "expired" | "error";
/** managedBy: the enrolled organisation has not approved this server, so it
 * stays configured but never reaches bots. */
export type McpServerListing = (StdioMcpListing | RemoteMcpListing) & {
  managedBy?: string;
  /** tools no bot sees (Plugins > the server > Tools) */
  disabledTools?: string[];
  /** where the server came from: absent when added by hand */
  source?: string;
  /** reads the person's GitHub account (the GitHub plugin's token
   * placeholder, server/github-mcp-token.ts): whether it is connected */
  github?: "connected" | "missing";
  /** Lot B: installation = shared config; person = only-me (never send header values into shared). */
  scope?: "installation" | "person";
};

/** A saved server whose name Sagax now reserves (`mcp`, `__`, `sagax-`...):
 * never mounted until it is renamed or removed (server/mcp-registry.ts
 * reservedMcpServers). */
export interface ReservedMcpListing {
  name: string;
  suggestedName?: string;
}

export function isRemoteMcpListing(server: McpServerListing): server is RemoteMcpListing {
  return "url" in server;
}

type McpTransport = "stdio" | "remote";

interface McpDraft extends McpResultBudgetDraft {
  name: string;
  transport: McpTransport;
  command: string;
  args: string;
  env: string;
  type: "http" | "sse";
  url: string;
  headers: string;
}

export interface ProbeResult {
  ok: boolean;
  tools?: Array<{ name: string; description?: string }>;
  /** how many tools the server advertised, when `tools` shows only the first */
  total?: number;
  /** tools Grok registers under another name or cannot register (server/mcp-probe.ts) */
  engineNames?: { grok: { renamed: Array<{ upstream: string; registered: string; reason: string }>; unregistrable: Array<{ upstream: string; reason: string }> } };
  error?: string;
}

/** After a sign-in, list the server's tools once. A failure is one plain
 * line that keeps the test's own reason (a timeout, an HTTP status), which is
 * already safe to show; the card's Connect button is the retry. */
export async function signedInToolsCheck(
  name: string,
  request: (path: string, init?: RequestInit) => Promise<ProbeResult>,
  signal: AbortSignal,
): Promise<ProbeResult> {
  let tested: ProbeResult;
  try {
    tested = await request(`/api/mcp/servers/${name}/test`, { method: "POST", signal });
  } catch (cause) {
    if (signal.aborted) throw cause;
    tested = { ok: false, error: readableError(cause) };
  }
  if (tested.ok) return tested;
  // A proxy's "504 Gateway Timeout" or a browser's "Failed to fetch" has no
  // closing period; add one so the reason does not run into the next sentence.
  const reason = (tested.error ?? "").trim();
  return { ...tested, error: t("whop.testFailed", { reason: reason && !/[.!?]$/.test(reason) ? `${reason}.` : reason }) };
}

/** How long the panel waits for the browser to come back from a sign-in:
 * the server forgets the pending flow after ten minutes too. */
const SIGN_IN_WAIT_MS = 10 * 60_000;
const SIGN_IN_POLL_MS = 2_000;

/** The system browser in the desktop app; a new tab on the web. The tab is
 * opened blank first so the provider never gets a handle on this window. */
async function openSignInPage(url: string): Promise<boolean> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return true;
  }
  const opened = window.open("", "_blank");
  if (!opened) return false;
  opened.opener = null;
  opened.location.replace(url);
  return true;
}

interface ClientDraft {
  redirectUri: string;
  clientId: string;
  clientSecret: string;
}

const EMPTY_DRAFT: McpDraft = { name: "", transport: "stdio", command: "", args: "", env: "", type: "http", url: "", headers: "", resultBudget: "" };
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;

export function parseMcpArguments(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function parseMcpEnvironment(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; env: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const env: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const equals = line.indexOf("=");
    if (equals <= 0) return { ok: false, error: { key: "mcp.env.useKeyValue", params: { line } } };
    const key = line.slice(0, equals).trim();
    const secret = line.slice(equals + 1);
    if (!ENV_NAME.test(key)) return { ok: false, error: { key: "mcp.env.invalidName", params: { key } } };
    if (Object.hasOwn(env, key)) return { ok: false, error: { key: "mcp.env.duplicate", params: { key } } };
    env[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, env };
}

/** `Name: value` per line, the way headers are written everywhere. A blank
 * value beside a saved header keeps the saved value, as with env above. */
export function parseMcpHeaders(
  value: string,
  savedKeys: readonly string[] = [],
): { ok: true; headers: Record<string, string | true> } | { ok: false; error: McpMessage } {
  const saved = new Set(savedKeys);
  const headers: Record<string, string | true> = {};
  for (const original of value.split(/\r?\n/)) {
    const line = original.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) return { ok: false, error: { key: "mcp.headers.useColon", params: { line } } };
    const key = line.slice(0, colon).trim();
    const secret = line.slice(colon + 1).trim();
    if (!HEADER_NAME.test(key)) return { ok: false, error: { key: "mcp.headers.invalidName", params: { key } } };
    if (Object.hasOwn(headers, key)) return { ok: false, error: { key: "mcp.headers.duplicate", params: { key } } };
    headers[key] = secret === "" && saved.has(key) ? true : secret;
  }
  return { ok: true, headers };
}

export function probeToolsLabel(tools: ProbeResult["tools"], total?: number): string {
  if (!tools?.length) return t("mcp.probe.noTools");
  // A big server (Whop lists 425) sends its first hundred names only.
  const count = Math.max(total ?? 0, tools.length);
  const names = tools.map((tool) => tool.name).join(", ") + (count > tools.length ? ", …" : "");
  return count === 1
    ? t("mcp.probe.toolsOne", { names })
    : t("mcp.probe.toolsMany", { count, names });
}

function draftFor(server: McpServerListing): McpDraft {
  // Values are intentionally never returned by the server. A blank value
  // beside an existing key is a write-only “keep saved value” placeholder.
  if (isRemoteMcpListing(server)) {
    return {
      ...EMPTY_DRAFT,
      name: server.name,
      transport: "remote",
      type: server.type,
      url: server.url,
      headers: server.headerKeys.map((key) => `${key}: `).join("\n"),
      resultBudget: resultBudgetDraft(server),
    };
  }
  return {
    ...EMPTY_DRAFT,
    name: server.name,
    command: server.command,
    args: server.args.join("\n"),
    env: server.envKeys.map((key) => `${key}=`).join("\n"),
    resultBudget: resultBudgetDraft(server),
  };
}

/** The MCP servers of this installation and everything the Plugins panel
 * does with them: add, edit, paste a config, test, sign in and out, switch a
 * server or one of its tools, remove, and Whop's own connect flow. */
export function useMcpServers() {
  const { state: store, dispatch } = useStore();
  // While enrolled with custom servers off, only approved servers can be added.
  const policy = store.config?.managedPolicy;
  const restricted = Boolean(policy && !policy.mcp.allowCustom);
  const [servers, setServers] = useState<McpServerListing[] | null>(null);
  const [reserved, setReserved] = useState<ReservedMcpListing[]>([]);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [draft, setDraft] = useState<McpDraft>(EMPTY_DRAFT);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | McpMessage | null>(null);
  const [notice, setNotice] = useState<(McpMessage & { stateKey?: LocaleKey }) | null>(null);
  const [probe, setProbe] = useState<Record<string, ProbeResult>>({});
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const loadGeneration = useRef(0);
  const [oauthError, setOauthError] = useState<Record<string, string | McpMessage>>({});
  const [waiting, setWaiting] = useState<Record<string, boolean>>({});
  const [clientDraft, setClientDraft] = useState<Record<string, ClientDraft>>({});
  const waiters = useRef(new Map<string, { timer: ReturnType<typeof setInterval>; until: number }>());
  /** The server whose sign-in this panel is waiting on, if any: other row
   * actions wait for it. */
  const signingIn = Object.keys(waiting).find((name) => waiting[name]) ?? null;
  const mounted = useRef(true);
  const whopServer = servers?.find((server) => isRemoteMcpListing(server) && isWhopServer(server));
  const whopConnected = Boolean(whopServer?.enabled && isRemoteMcpListing(whopServer) && whopServer.auth === "connected");
  /** Whop is switched on only once its sign-in landed and its tools listed:
   * the names whose sign-in should finish that way, and the running check. */
  const enableAfterSignIn = useRef(new Set<string>());
  const whopCheck = useRef<AbortController | null>(null);
  const [whopLoading, setWhopLoading] = useState(false);
  const afterSignIn = useRef<(name: string) => Promise<void>>(async () => {});

  // Paste-to-add: the same block Claude Code, Cursor and Claude Desktop
  // write. The server applies the form's rules and adds them switched off.
  const importServers = async () => {
    if (!importText.trim()) return;
    const generation = ++loadGeneration.current;
    setBusy("import");
    setError(null);
    setNotice(null);
    try {
      const result = await api("/api/mcp/servers/import", {
        method: "POST",
        body: JSON.stringify({ json: importText }),
      });
      updateMcpServers(result.servers ?? []);
      if (generation !== loadGeneration.current) return;
      setServers(result.servers ?? []);
      setNotice({ key: "mcp.imported", params: { names: (result.added ?? []).join(", ") } });
      setImportText("");
      setImportOpen(false);
    } catch (cause) {
      if (generation === loadGeneration.current) setError(readableError(cause));
    } finally {
      if (generation === loadGeneration.current) setBusy(null);
    }
  };

  const load = useCallback((reprobe = false) => {
    const generation = ++loadGeneration.current;
    setBusy("load");
    setError(null);
    return api(reprobe ? "/api/mcp/servers?reprobe=1" : "/api/mcp/servers")
      .then((result) => {
        if (generation === loadGeneration.current) {
          setServers(result.servers ?? []);
          setReserved(result.reserved ?? []);
          updateMcpServers(result.servers ?? []);
        }
      })
      .catch((cause) => {
        if (generation === loadGeneration.current) setError(readableError(cause));
      })
      .finally(() => {
        if (generation === loadGeneration.current) setBusy(null);
      });
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const pending = waiters.current;
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
      for (const { timer } of pending.values()) clearInterval(timer);
      pending.clear();
    };
  }, [load]);

  const stopWaiting = useCallback((name: string) => {
    const waiter = waiters.current.get(name);
    if (waiter) clearInterval(waiter.timer);
    waiters.current.delete(name);
    setWaiting((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
  }, []);

  /** Refresh the list once, quietly: the row flips when the sign-in lands. */
  const reloadQuietly = useCallback(async () => {
    try {
      const result = await api("/api/mcp/servers");
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
    } catch {
      // the next poll or a manual refresh tries again
    }
  }, []);

  /** Poll one server's sign-in state until it connects, fails or times out. */
  const waitForSignIn = useCallback((name: string, account?: string) => {
    const existing = waiters.current.get(name);
    if (existing) clearInterval(existing.timer);
    setWaiting((current) => ({ ...current, [name]: true }));
    const until = Date.now() + SIGN_IN_WAIT_MS;
    const timer = setInterval(() => {
      void (async () => {
        if (Date.now() > until) {
          stopWaiting(name);
          enableAfterSignIn.current.delete(name);
          setOauthError((current) => ({ ...current, [name]: { key: "mcp.oauth.timedOut" } }));
          return;
        }
        try {
          const status = await api(`/api/mcp/servers/${encodeURIComponent(name)}/oauth/status${account ? `?account=${encodeURIComponent(account)}` : ""}`);
          if (status.auth === "connected") {
            stopWaiting(name);
            if (enableAfterSignIn.current.has(name)) {
              await reloadQuietly();
              await afterSignIn.current(name);
              return;
            }
            setNotice({ key: "mcp.oauth.done", params: { name } });
            await reloadQuietly();
          } else if (!status.pending) {
            stopWaiting(name);
            enableAfterSignIn.current.delete(name);
            if (status.authError) setOauthError((current) => ({ ...current, [name]: String(status.authError) }));
            await reloadQuietly();
          }
        } catch {
          // transient: keep polling until the deadline
        }
      })();
    }, SIGN_IN_POLL_MS);
    waiters.current.set(name, { timer, until });
  }, [reloadQuietly, stopWaiting]);

  // The callback page tells same-origin windows the outcome at once.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel("pulsa-mcp-oauth");
    channel.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: unknown; name?: unknown } | null;
      if (data?.type !== "mcp-oauth" || typeof data.name !== "string") return;
      if (waiters.current.has(data.name)) void reloadQuietly();
    };
    return () => channel.close();
  }, [reloadQuietly]);

  /** Sign in to a server: its default account, one saved account again
   * (`account.id`), or another account to add (`account.label`). */
  const signIn = async (server: McpServerListing, account?: { id?: string; label?: string }) => {
    const name = server.name;
    const client = clientDraft[name];
    setBusy(`oauth:${name}`);
    setOauthError((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });
    setNotice(null);
    try {
      const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/oauth/start`, {
        method: "POST",
        body: JSON.stringify({
          ...(client?.clientId.trim() ? { clientId: client.clientId.trim(), ...(client.clientSecret.trim() ? { clientSecret: client.clientSecret.trim() } : {}) } : {}),
          ...(account?.id ? { account: account.id } : {}),
          ...(account?.label ? { newAccount: { label: account.label } } : {}),
        }),
      });
      if (typeof result.authorizationUrl !== "string") throw new Error(t("mcp.oauth.error"));
      if (!(await openSignInPage(result.authorizationUrl))) {
        enableAfterSignIn.current.delete(name);
        setOauthError((current) => ({ ...current, [name]: { key: "mcp.oauth.popupBlocked" } }));
        return;
      }
      setClientDraft((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      waitForSignIn(name, typeof result.account === "string" ? result.account : account?.id);
    } catch (cause) {
      const detail = cause as Error & { body?: { code?: unknown; redirectUri?: unknown } };
      if (detail.body?.code === "client_required" && typeof detail.body.redirectUri === "string") {
        const redirectUri = detail.body.redirectUri;
        setClientDraft((current) => ({ ...current, [name]: { redirectUri, clientId: current[name]?.clientId ?? "", clientSecret: current[name]?.clientSecret ?? "" } }));
        return;
      }
      enableAfterSignIn.current.delete(name);
      setOauthError((current) => ({ ...current, [name]: readableError(cause) }));
    } finally {
      setBusy(null);
    }
  };

  /** Sign out of the default account, or remove another saved one. */
  const signOut = async (server: McpServerListing, account?: string) => {
    const name = server.name;
    const other = account !== undefined && account !== "default";
    setBusy(`oauth:${name}`);
    stopWaiting(name);
    loadGeneration.current += 1;
    if (!other) {
      setProbe((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
    try {
      // Whop goes off with its sign-in: it is on only while connected.
      if (!other && isRemoteMcpListing(server) && isWhopServer(server) && server.enabled) {
        const paused = await api(`/api/mcp/servers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
        setServers(paused.servers ?? []);
        updateMcpServers(paused.servers ?? []);
      }
      const result = await api(`/api/mcp/servers/${encodeURIComponent(name)}/oauth/disconnect`, { method: "POST", body: JSON.stringify(other ? { account } : {}) });
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      setNotice({ key: "mcp.oauth.disconnected", params: { name } });
    } catch (cause) {
      setOauthError((current) => ({ ...current, [name]: readableError(cause) }));
    } finally {
      setBusy(null);
    }
  };

  const closeEditor = () => {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
  };

  /** The request body for the draft, or the message that stops it. Its Result
   * size limit is checked and added by withResultBudget (save, below). */
  const draftBody = (
    existing: McpServerListing | undefined,
  ): { ok: true; body: Record<string, unknown> } | { ok: false; error: McpMessage } => {
    const name = draft.name.trim();
    if (draft.transport === "remote") {
      const url = draft.url.trim();
      if (!name || !/^https?:\/\//i.test(url)) return { ok: false, error: { key: "mcp.err.nameAndUrl" } };
      const parsed = parseMcpHeaders(draft.headers, existing && isRemoteMcpListing(existing) ? existing.headerKeys : []);
      if (!parsed.ok) return parsed;
      // Lot B: person-scoped rows keep header names in shared config with
      // blank values; the key lives under Settings > Connections. The server
      // refuses non-empty or ambiguous personal headers if any slip through.
      const headers = existing?.scope === "person"
        ? Object.fromEntries(Object.keys(parsed.headers).map((key) => [key, ""]))
        : parsed.headers;
      return { ok: true, body: { type: draft.type, url, headers } };
    }
    const command = draft.command.trim();
    if (!name || !command) return { ok: false, error: { key: "mcp.err.nameAndCommand" } };
    const parsed = parseMcpEnvironment(draft.env, existing && !isRemoteMcpListing(existing) ? existing.envKeys : []);
    if (!parsed.ok) return parsed;
    return { ok: true, body: { command, args: parseMcpArguments(draft.args), env: parsed.env } };
  };

  const save = async () => {
    const name = draft.name.trim();
    const existing = editing === "new" ? undefined : servers?.find((server) => server.name === editing);
    const prepared = withResultBudget(draft.resultBudget, () => draftBody(existing));
    if (!prepared.ok) {
      setError(prepared.error);
      return;
    }
    setBusy("save");
    loadGeneration.current += 1;
    setError(null);
    setNotice(null);
    try {
      const result = await api(
        editing === "new" ? "/api/mcp/servers" : `/api/mcp/servers/${encodeURIComponent(name)}`,
        {
          method: editing === "new" ? "POST" : "PUT",
          body: JSON.stringify({
            ...(editing === "new" ? { name } : {}),
            ...prepared.body,
            ...(existing ? { enabled: existing.enabled } : {}),
          }),
        },
      );
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      const saved = (result.servers as McpServerListing[] | undefined)?.find((server) => server.name === name);
      const needsSignIn = saved && isRemoteMcpListing(saved) && (saved.auth === "required" || saved.auth === "expired");
      setNotice({ key: needsSignIn && editing === "new" ? "mcp.oauth.addedNeedsSignIn" : editing === "new" ? "mcp.saved" : "mcp.updated", params: { name } });
      closeEditor();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (server: McpServerListing) => {
    setBusy(`toggle:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    try {
      const result = await api(`/api/mcp/servers/${server.name}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      setNotice({
        key: "mcp.toggled",
        params: { name: server.name },
        stateKey: server.enabled ? "mcp.state.off" : "mcp.state.on",
      });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  const test = async (server: McpServerListing) => {
    setBusy(`test:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    setProbe((current) => {
      const next = { ...current };
      delete next[server.name];
      return next;
    });
    try {
      const result: ProbeResult = await api(`/api/mcp/servers/${server.name}/test`, { method: "POST" });
      setProbe((current) => ({ ...current, [server.name]: result }));
    } catch (cause) {
      setProbe((current) => ({
        ...current,
        [server.name]: { ok: false, error: readableError(cause) },
      }));
    } finally {
      setBusy(null);
    }
  };

  // Whop's card (an app tile): add the official server switched off, sign in
  // with this server's own MCP sign-in (server/mcp-oauth.ts), list its tools
  // once, and only then switch it on.
  afterSignIn.current = async (name: string) => {
    if (!enableAfterSignIn.current.delete(name)) return;
    const controller = new AbortController();
    whopCheck.current = controller;
    setWhopLoading(true);
    try {
      const tested = await signedInToolsCheck(name, api, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      setProbe((current) => ({ ...current, [name]: tested }));
      if (!tested.ok) return;
      const enabled = await api(`/api/mcp/servers/${name}`, { method: "PATCH", body: JSON.stringify({ enabled: true }) });
      if (!mounted.current) return;
      setServers(enabled.servers ?? []);
      updateMcpServers(enabled.servers ?? []);
      setNotice({ key: "whop.connected" });
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted) setError(readableError(cause));
    } finally {
      if (whopCheck.current === controller) whopCheck.current = null;
      if (mounted.current) setWhopLoading(false);
    }
  };

  const connectWhop = async () => {
    if (!servers || busy !== null || signingIn !== null) return;
    setError(null);
    setNotice(null);
    const existing = servers.find((server) => isRemoteMcpListing(server) && isWhopServer(server));
    if (existing) {
      setProbe((current) => {
        const next = { ...current };
        delete next[existing.name];
        return next;
      });
      enableAfterSignIn.current.add(existing.name);
      if (isRemoteMcpListing(existing) && existing.auth === "connected") { await afterSignIn.current(existing.name); return; }
      await signIn(existing);
      return;
    }
    setBusy("whop");
    loadGeneration.current += 1;
    let added: McpServerListing | undefined;
    try {
      const name = whopServerName(servers);
      const result = await api("/api/mcp/servers", { method: "POST", body: JSON.stringify({ name, type: "http", url: WHOP_MCP_URL, enabled: false }) });
      if (!mounted.current) return;
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
      added = result.servers?.find((server: McpServerListing) => server.name === name && isRemoteMcpListing(server) && isWhopServer(server));
      if (!added) throw new Error(t("whop.setupFailed"));
    } catch (cause) {
      if (mounted.current) setError(readableError(cause));
    } finally { if (mounted.current) setBusy(null); }
    if (added && mounted.current) {
      enableAfterSignIn.current.add(added.name);
      await signIn(added);
    }
  };

  const cancelWhop = (name: string) => {
    enableAfterSignIn.current.delete(name);
    whopCheck.current?.abort();
    stopWaiting(name);
  };

  const remove = async (server: Pick<McpServerListing, "name">) => {
    if (!window.confirm(t("mcp.removeConfirm", { name: server.name }))) return;
    setBusy(`delete:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    try {
      const result = await api(`/api/mcp/servers/${server.name}`, { method: "DELETE" });
      setServers(result.servers ?? []);
      setReserved(result.reserved ?? []);
      updateMcpServers(result.servers ?? []);
      setProbe((current) => {
        const next = { ...current };
        delete next[server.name];
        return next;
      });
      if (editing === server.name) closeEditor();
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  /** A saved server whose name is now reserved, renamed: it comes back off. */
  const renameReserved = async (server: ReservedMcpListing, to: string) => {
    const next = to.trim();
    if (!next) return;
    setBusy(`rename:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    setNotice(null);
    try {
      const result = await api(`/api/mcp/servers/${server.name}/rename`, {
        method: "POST",
        body: JSON.stringify({ to: next }),
      });
      setServers(result.servers ?? []);
      setReserved(result.reserved ?? []);
      updateMcpServers(result.servers ?? []);
      setNotice({ key: "mcp.reserved.renamed", params: { from: server.name, to: next } });
    } catch (cause) {
      setError(readableError(cause));
    } finally {
      setBusy(null);
    }
  };

  /** The tools switched off for every bot (Plugins > the server > Tools). */
  const setDisabledTools = async (server: McpServerListing, disabledTools: string[]) => {
    setBusy(`tools:${server.name}`);
    loadGeneration.current += 1;
    setError(null);
    // Show the switch where it was put at once; the answer confirms it.
    setServers((current) => current?.map((entry) => entry.name === server.name ? { ...entry, disabledTools } : entry) ?? current);
    try {
      const result = await api(`/api/mcp/servers/${server.name}`, {
        method: "PATCH",
        body: JSON.stringify({ disabledTools }),
      });
      setServers(result.servers ?? []);
      updateMcpServers(result.servers ?? []);
    } catch (cause) {
      setError(readableError(cause));
      void reloadQuietly();
    } finally {
      setBusy(null);
    }
  };

  const startAdd = () => {
    setEditing("new");
    setDraft(EMPTY_DRAFT);
    setError(null);
    setNotice(null);
  };
  const startEdit = (server: McpServerListing) => {
    setEditing(server.name);
    setDraft(draftFor(server));
    setError(null);
    setNotice(null);
  };
  const toggleImport = () => {
    setImportOpen((open) => !open);
    setError(null);
    setNotice(null);
  };
  const forgetClientDraft = (name: string) => setClientDraft((current) => {
    const next = { ...current };
    delete next[name];
    return next;
  });

  return {
    store, dispatch, servers, reserved, renameReserved, policy, restricted, editing, draft, setDraft, busy, error, notice, probe, importOpen, setImportOpen, importText, setImportText,
    oauthError, waiting, signingIn, clientDraft, setClientDraft, forgetClientDraft, load, signIn, signOut, save, toggle, test, remove,
    importServers, closeEditor, setDisabledTools, startAdd, startEdit, toggleImport,
    whopServer, whopConnected, whopLoading, connectWhop, cancelWhop,
  };
}

export type McpServers = ReturnType<typeof useMcpServers>;

/** Whop's button on its Connect apps row (a row like every other app's):
 * Connect, Cancel while its sign-in waits, nothing once connected (the row
 * opens its page, where Disconnect is). */
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
  const { editing, draft, setDraft, busy, closeEditor, save } = mcp;
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
              <button type="button" onClick={closeEditor} className="rounded-lg px-3 py-2 text-[12.5px] text-ink-secondary hover:bg-raised">{t("mcp.cancel")}</button>
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
 * there, and the redirect URI they must give it. */
export function McpClientForm({ draft, disabled, onChange, onCancel, onSubmit }: {
  draft: ClientDraft;
  disabled: boolean;
  onChange: (next: ClientDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="mt-3 rounded-xl border border-hairline/60 bg-raised/35 p-3.5">
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

/** The one Claude-only setting on this page, in the words a person would
 * use. Claude bots normally see just the servers listed here; this switch
 * also gives them the MCP servers and connectors of this machine's own
 * Claude Code setup — what Codex bots already do with their config. Saved
 * on the workspace; the next message picks it up. */
export function ClaudeMcpSwitch() {
  const { state, dispatch } = useStore();
  const enabled = claudeUserMcpEnabled(state.config);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const toggle = async () => {
    if (saving) return;
    setSaving(true);
    setFailed(false);
    try {
      const config: ConfigStatus = await api("/api/config", {
        method: "PATCH",
        body: JSON.stringify({ features: { claudeUserMcp: !enabled } }),
      });
      dispatch({ type: "configStatus", config });
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-4 flex items-start justify-between gap-4 rounded-2xl border border-hairline/50 bg-card px-4 py-4 sm:px-5">
      <div className="min-w-0">
        <div className="text-[14px] font-medium text-ink">{t("mcp.claude.title")}</div>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-secondary">{t("mcp.claude.desc")}</p>
        {failed && <p role="alert" className="mt-1 text-[12px] text-danger">{t("mcp.claude.error")}</p>}
      </div>
      <Switch
        checked={enabled}
        aria-label={t("mcp.claude.aria")}
        disabled={saving}
        onClick={() => void toggle()}
        className="mt-0.5 shrink-0 disabled:cursor-wait disabled:opacity-50"
      />
    </div>
  );
}

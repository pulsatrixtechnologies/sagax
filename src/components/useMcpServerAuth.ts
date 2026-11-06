import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { updateMcpServers } from "@/lib/mcp-servers";
import { api } from "@/state/store";
import { readableError } from "@/lib/plain-error";
import { WHOP_MCP_URL, isWhopServer, whopServerName } from "@/lib/whop-integration";
import type { McpMessage } from "./McpResultBudgetField";
import {
  SIGN_IN_POLL_MS,
  SIGN_IN_WAIT_MS,
  isRemoteMcpListing,
  openSignInPage,
  signedInToolsCheck,
  type ClientDraft,
  type McpServerListing,
  type ProbeResult,
} from "./mcpServersModel";

export function useMcpServerAuth(args: {
  servers: McpServerListing[] | null;
  setServers: Dispatch<SetStateAction<McpServerListing[] | null>>;
  busy: string | null;
  setBusy: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | McpMessage | null>>;
  setNotice: Dispatch<SetStateAction<(McpMessage & { stateKey?: LocaleKey }) | null>>;
  setProbe: Dispatch<SetStateAction<Record<string, ProbeResult>>>;
  loadGeneration: MutableRefObject<number>;
  mounted: MutableRefObject<boolean>;
}) {
  const { servers, setServers, busy, setBusy, setError, setNotice, setProbe, loadGeneration, mounted } = args;
  const [oauthError, setOauthError] = useState<Record<string, string | McpMessage>>({});
  const [waiting, setWaiting] = useState<Record<string, boolean>>({});
  const [clientDraft, setClientDraft] = useState<Record<string, ClientDraft>>({});
  const waiters = useRef(new Map<string, { timer: ReturnType<typeof setInterval>; until: number }>());
  /** The server whose sign-in this panel is waiting on, if any: other row
   * actions wait for it. */
  const signingIn = Object.keys(waiting).find((name) => waiting[name]) ?? null;
  const whopServer = servers?.find((server) => isRemoteMcpListing(server) && isWhopServer(server));
  const whopConnected = Boolean(whopServer?.enabled && isRemoteMcpListing(whopServer) && whopServer.auth === "connected");
  /** Whop is switched on only once its sign-in landed and its tools listed:
   * the names whose sign-in should finish that way, and the running check. */
  const enableAfterSignIn = useRef(new Set<string>());
  const whopCheck = useRef<AbortController | null>(null);
  const [whopLoading, setWhopLoading] = useState(false);
  const afterSignIn = useRef<(name: string) => Promise<void>>(async () => {});

  useEffect(() => {
    const pending = waiters.current;
    return () => {
      for (const { timer } of pending.values()) clearInterval(timer);
      pending.clear();
    };
  }, []);

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

  // Whop's card (an app tile): add the official server switched off, sign in
  // with this server's own MCP sign-in (server/mcp/mcp-oauth.ts), list its tools
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


  const forgetClientDraft = (name: string) => setClientDraft((current) => {
    const next = { ...current };
    delete next[name];
    return next;
  });

  return {
    oauthError, waiting, signingIn, clientDraft, setClientDraft, forgetClientDraft,
    stopWaiting, reloadQuietly, waitForSignIn, signIn, signOut,
    whopServer, whopConnected, whopLoading, connectWhop, cancelWhop,
  };
}

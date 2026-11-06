import { useCallback, useEffect, useRef, useState } from "react";

import { useConfirm } from "@/components/ConfirmProvider";
import { t } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { updateMcpServers } from "@/lib/mcp-servers";
import { api, useStore } from "@/state/store";
import { readableError } from "@/lib/plain-error";
import { withResultBudget, type McpMessage } from "./McpResultBudgetField";
import {
  EMPTY_DRAFT,
  draftFor,
  isRemoteMcpListing,
  parseMcpArguments,
  parseMcpEnvironment,
  parseMcpHeaders,
  type McpDraft,
  type McpServerListing,
  type ProbeResult,
  type ReservedMcpListing,
} from "./mcpServersModel";
import { useMcpServerAuth } from "./useMcpServerAuth";

/** The MCP servers of this installation and everything the Plugins panel
 * does with them: add, edit, paste a config, test, sign in and out, switch a
 * server or one of its tools, remove, and Whop's own connect flow. */
export function useMcpServers() {
  const confirm = useConfirm();
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
  const mounted = useRef(true);

  const auth = useMcpServerAuth({
    servers, setServers, busy, setBusy, setError, setNotice, setProbe, loadGeneration, mounted,
  });
  const {
    oauthError, waiting, signingIn, clientDraft, setClientDraft, forgetClientDraft,
    reloadQuietly, signIn, signOut, whopServer, whopConnected, whopLoading, connectWhop, cancelWhop,
  } = auth;

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
    const apply = (result: { servers?: McpServerListing[]; reserved?: ReservedMcpListing[] }) => {
      if (generation !== loadGeneration.current) return;
      setServers(result.servers ?? []);
      setReserved(result.reserved ?? []);
      updateMcpServers(result.servers ?? []);
    };
    // The list at once, the sign-in probes after (#2273): a first look
    // after a start no longer holds the panel for the slowest server.
    return api(reprobe ? "/api/mcp/servers?reprobe=1" : "/api/mcp/servers?probe=background")
      .then(async (result) => {
        apply(result);
        if (generation === loadGeneration.current) setBusy(null);
        if (result.probing === true && generation === loadGeneration.current) apply(await api("/api/mcp/servers"));
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
    return () => {
      mounted.current = false;
      loadGeneration.current += 1;
    };
  }, [load]);

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

  const remove = async (server: Pick<McpServerListing, "name">) => {
    if (!(await confirm({ title: t("mcp.removeConfirm", { name: server.name }), confirmLabel: t("common.confirmRemove"), tone: "danger" }))) return;
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
  return {
    store, dispatch, servers, reserved, renameReserved, policy, restricted, editing, draft, setDraft, busy, error, notice, probe, importOpen, setImportOpen, importText, setImportText,
    oauthError, waiting, signingIn, clientDraft, setClientDraft, forgetClientDraft, load, signIn, signOut, save, toggle, test, remove,
    importServers, closeEditor, setDisabledTools, startAdd, startEdit, toggleImport,
    whopServer, whopConnected, whopLoading, connectWhop, cancelWhop,
  };
}

export type McpServers = ReturnType<typeof useMcpServers>;

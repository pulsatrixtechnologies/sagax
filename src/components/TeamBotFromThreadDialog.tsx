// "Create a Team Bot from this conversation" (thread menu, 2026-10-16; parity
// with Grok Bot's team bot from a conversation, with or without its memory).
//
// 1. The draft: name, role, description and instructions, written by the
//    conversation's own bot model from the conversation
//    (POST /api/bots/:id/team-bot-draft, server/team-bot-draft.ts); editable.
// 2. What carries over (JC 2026-10-21: a copy, never the private memory):
//    the source bot's persona (the instructions start from it), its rules,
//    its plugins and connectors (one box each, ticked) and its team, whose
//    shared memory the copy then reads. Never this conversation, other
//    conversations or the bot's own memory, which is its owner's.
// 3. Create: the ordinary POST /api/bots, then the instructions and the
//    team, the rules (/api/bots/:id/rules), the connectors and the plugins
//    (/api/bots/:id/plugins/install).
// 4. Publish: the existing Team Bot path. On an organization server the new
//    bot's Sharing opens (grants through Perspicax); on this computer alone,
//    the new bot opens. The app adds no multi-person view of its own.
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, ShieldCheck, Sparkles, UsersRound, X } from "lucide-react";

import { activeLocale, t } from "@/lib/i18n";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { closeTeamBotFromThread, setTeamBotSources, useTeamBotFromThreadRequest, type TeamBotFromThreadRequest } from "@/lib/teambot-from-thread";
import { viewerCanCreateBots } from "@/lib/viewer";
import { api, useStore, type Bot } from "@/state/store";

export interface TeamBotDraft { name: string; title: string; description: string; instructions: string; source: "model" | "excerpt" }
interface DraftAnswer { draft: TeamBotDraft }
interface SourcePlugin {
  key: string;
  name: string;
  marketplace: string;
  enabled: boolean;
  config?: { fields: Array<{ key: string; sensitive: boolean }>; values: Record<string, string | number | boolean> };
}
interface RuleSetWire { id: string; name: string | null; enabled: boolean; text: string; hash: string }

/** The dialog's starting choices: plugins, connectors and rules ticked.
 * There is no memory choice: a copy never takes the bot's own memory. Pure. */
export function initialCarryChoices(input: { plugins: readonly SourcePlugin[]; connectors: readonly string[] }) {
  return {
    plugins: new Set(input.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.key)),
    connectors: new Set(input.connectors),
    rules: true,
  };
}

/** The instructions the copy starts from: the source bot's persona when it
 * has one, else the draft written from the conversation. Pure. */
export function startingInstructions(sourceSoul: string | undefined, drafted: string): string {
  return sourceSoul?.trim() ? sourceSoul : drafted;
}

/** The non-secret configuration that follows a plugin. A secret field is
 * never stored here and never copied. Null when there is nothing to send. Pure. */
export function pluginConfigCarry(plugin: { config?: { fields: readonly { key: string; sensitive: boolean }[]; values: Readonly<Record<string, string | number | boolean>> } }): Record<string, string | number | boolean> | null {
  const config = plugin.config;
  if (!config) return null;
  const values: Record<string, string | number | boolean> = {};
  for (const field of config.fields) {
    if (field.sensitive) continue;
    const value = config.values[field.key];
    if (value === undefined || value === "") continue;
    values[field.key] = value;
  }
  return Object.keys(values).length ? values : null;
}

/** The rule writes that make the copy's rules the source's: a set the copy
 * already has (same id) gets its text and switch, another is added. Pure. */
export function ruleCopies(source: readonly RuleSetWire[], target: readonly RuleSetWire[]) {
  return source.filter((set) => set.text.trim()).map((set) => {
    const same = target.find((candidate) => candidate.id === set.id);
    return same
      ? { kind: "update" as const, id: same.id, text: set.text, hash: same.hash, enabled: set.enabled, changeSwitch: same.enabled !== set.enabled }
      : { kind: "add" as const, name: set.name ?? set.id, text: set.text, enabled: set.enabled };
  });
}

function TeamBotFromThreadDialog({ request, onClose }: { request: TeamBotFromThreadRequest; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const source = state.bots.find((bot) => bot.id === request.botId);
  const { servers } = useMcpServers();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [plugins, setPlugins] = useState<SourcePlugin[] | null>(null);
  const [form, setForm] = useState<TeamBotDraft | null>(null);
  const [choices, setChoices] = useState(() => initialCarryChoices({ plugins: [], connectors: [] }));
  const [drafted, setDrafted] = useState("");
  const [stage, setStage] = useState<"drafting" | "ready" | "creating" | "done">("drafting");
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [created, setCreated] = useState<Bot | null>(null);
  const organization = Boolean(state.config?.viewer?.principalId);
  const connectors = useMemo(
    () => (source && servers ? mcpServersForBot(servers, source.mcpServers).map((server) => server.name) : []),
    [source, servers],
  );

  useEffect(() => {
    let cancelled = false;
    const language = activeLocale().startsWith("fr") ? "fr" : "en";
    Promise.all([
      api<DraftAnswer>(`/api/bots/${request.botId}/team-bot-draft`, { method: "POST", body: JSON.stringify({ threadId: request.threadId, language }), timeoutMs: 60_000 }),
      api<{ plugins: SourcePlugin[] }>(`/api/bots/${request.botId}/plugins`).then((listing) => listing.plugins).catch(() => [] as SourcePlugin[]),
    ]).then(([draft, installed]) => {
      if (cancelled) return;
      setDrafted(draft.draft.instructions);
      setForm({ ...draft.draft, instructions: startingInstructions(source?.soul, draft.draft.instructions) });
      setPlugins(installed);
      setChoices((current) => ({ ...initialCarryChoices({ plugins: installed, connectors: [] }), connectors: current.connectors }));
      setStage("ready");
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    });
    return () => { cancelled = true; };
  }, [request.botId, request.threadId]);

  // Connectors arrive with the server list: ticked, like plugins.
  useEffect(() => {
    setChoices((current) => ({ ...current, connectors: new Set(connectors) }));
  }, [connectors]);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => { if (opener?.isConnected) opener.focus(); };
  }, []);

  const toggle = (key: "plugins" | "connectors", value: string) => setChoices((current) => {
    const next = new Set(current[key]);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return { ...current, [key]: next };
  });

  const create = async () => {
    if (!form || !source || stage !== "ready") return;
    setStage("creating");
    setError("");
    const notes: string[] = [];
    let bot: Bot | null = null;
    try {
      const response = await api<{ bot: Bot }>("/api/bots", {
        method: "POST",
        body: JSON.stringify({
          name: form.name.trim(), title: form.title.trim(), description: form.description.trim(),
          modelSelection: source.modelSelection, requireAvailableModel: true, useDefaults: false,
        }),
      });
      bot = response.bot;
      // the same team: its shared memory follows the copy
      const patched = await api<{ bot: Bot }>(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ soul: form.instructions, ...(source.section ? { section: source.section } : {}) }) });
      bot = { ...bot, ...patched.bot };
    } catch (cause) {
      if (bot) await api(`/api/bots/${bot.id}`, { method: "DELETE" }).catch(() => undefined);
      setError(cause instanceof Error ? cause.message : String(cause));
      setStage("ready");
      return;
    }
    // From here the bot exists: what does not carry over is said, not undone.
    const chosenConnectors = connectors.filter((name) => choices.connectors.has(name));
    if (chosenConnectors.length !== connectors.length || source.mcpServers != null) {
      try {
        await api(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ mcpServers: chosenConnectors }) });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.connectors", { reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    for (const plugin of (plugins ?? []).filter((entry) => choices.plugins.has(entry.key))) {
      try {
        await api(`/api/bots/${bot.id}/plugins/install`, { method: "POST", body: JSON.stringify({ marketplace: plugin.marketplace, plugin: plugin.name }), timeoutMs: 120_000 });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.plugin", { name: plugin.name, reason: cause instanceof Error ? cause.message : String(cause) }));
        continue;
      }
      const values = pluginConfigCarry(plugin);
      if (!values) continue;
      try {
        await api(`/api/bots/${bot.id}/plugins/${encodeURIComponent(plugin.key)}/config`, { method: "PUT", body: JSON.stringify({ values }) });
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.config", { name: plugin.name, reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    if (choices.rules) {
      try {
        const [from, to] = await Promise.all([
          api<{ sets: RuleSetWire[] }>(`/api/bots/${request.botId}/rules`),
          api<{ sets: RuleSetWire[] }>(`/api/bots/${bot.id}/rules`),
        ]);
        for (const copy of ruleCopies(from.sets, to.sets)) {
          if (copy.kind === "update") {
            await api(`/api/bots/${bot.id}/rules/sets/${copy.id}/text`, { method: "PUT", body: JSON.stringify({ text: copy.text, expectedHash: copy.hash }) });
            if (copy.changeSwitch) await api(`/api/bots/${bot.id}/rules/sets/${copy.id}`, { method: "PATCH", body: JSON.stringify({ enabled: copy.enabled }) });
          } else {
            const added = await api<{ set: RuleSetWire }>(`/api/bots/${bot.id}/rules/sets`, { method: "POST", body: JSON.stringify({ name: copy.name, text: copy.text }) });
            if (!copy.enabled) await api(`/api/bots/${bot.id}/rules/sets/${added.set.id}`, { method: "PATCH", body: JSON.stringify({ enabled: false }) });
          }
        }
      } catch (cause) {
        notes.push(t("teamBotFromThread.warn.rules", { reason: cause instanceof Error ? cause.message : String(cause) }));
      }
    }
    dispatch({ type: "botAdded", bot });
    setCreated(bot);
    setWarnings(notes);
    setStage("done");
  };

  const publish = () => {
    if (!created) return;
    onClose();
    // The existing Team Bot path: Sharing (Perspicax grants) on an
    // organization server; the bot itself on this computer alone.
    if (organization) dispatch({ type: "toggleSettings", open: true, botId: created.id, section: "sharing" });
    else dispatch({ type: "select", id: created.id });
  };

  const sourceName = source?.name ?? "";
  const field = "mt-1 w-full rounded-lg border border-hairline/50 bg-inset px-3 py-2 text-[13.5px] text-ink disabled:opacity-60";
  const busy = stage === "creating";
  const canCreate = viewerCanCreateBots(state.config);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/55 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="teambot-thread-title" tabIndex={-1} data-teambot-from-thread
        className="flex max-h-[90vh] w-full max-w-[600px] flex-col overflow-hidden rounded-2xl border border-hairline/50 bg-panel text-ink shadow-2xl outline-none"
        onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.stopPropagation(); onClose(); } }}>
        <header className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
          <div>
            <h2 id="teambot-thread-title" className="flex items-center gap-2 text-[17px] font-semibold"><UsersRound size={17} aria-hidden="true" />{t("teamBotFromThread.title")}</h2>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{t("teamBotFromThread.intro", { title: request.title || t("teamBotFromThread.untitled") })}</p>
          </div>
          <button type="button" aria-label={t("common.cancel")} disabled={busy} onClick={onClose} className="rounded-lg p-1.5 text-ink-secondary hover:bg-raised"><X size={18} /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 pt-2">
          {!canCreate && <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-[12.5px] text-warning">{t("teamBotFromThread.cannotCreate")}</p>}
          {stage === "done" && created ? (
            <div data-teambot-created>
              <p className="flex items-center gap-2 text-[13.5px] font-medium"><Check size={16} className="text-success" />{t("teamBotFromThread.created", { name: created.name })}</p>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-secondary">{organization ? t("teamBotFromThread.publishHint") : t("teamBotFromThread.publishHintSolo")}</p>
              {warnings.length > 0 && (
                <ul className="mt-3 list-disc rounded-xl border border-hairline px-4 py-3 pl-8 text-[12.5px] text-ink-secondary">
                  {warnings.map((line) => <li key={line}>{line}</li>)}
                </ul>
              )}
            </div>
          ) : !form ? (
            !error && <div className="flex items-center gap-2 py-6 text-[13px] text-ink-secondary"><Loader2 size={15} className="animate-spin" />{t("teamBotFromThread.drafting")}</div>
          ) : (
            <fieldset disabled={busy} className="space-y-3">
              {form.source === "model" && <p className="flex items-center gap-1.5 text-[12px] text-ink-secondary"><Sparkles size={13} aria-hidden="true" />{t("teamBotFromThread.draftedBy", { name: source?.name ?? "" })}</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.name")}
                  <input value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} className={field} />
                </label>
                <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.role")}
                  <input value={form.title} maxLength={120} onChange={(event) => setForm({ ...form, title: event.target.value })} className={field} />
                </label>
              </div>
              <label className="block text-[12.5px] text-ink-secondary">{t("teamBotFromThread.description")}
                <input value={form.description} maxLength={300} onChange={(event) => setForm({ ...form, description: event.target.value })} className={field} />
              </label>
              <label className="block text-[12.5px] text-ink-secondary">{source?.soul?.trim() ? t("teamBotFromThread.persona", { name: sourceName }) : t("teamBotFromThread.instructions")}
                {source?.soul?.trim() && drafted.trim() && form.instructions !== drafted && (
                  <button type="button" data-teambot-use-draft onClick={() => setForm({ ...form, instructions: drafted })} className="ml-2 text-[12px] text-accent hover:underline">{t("teamBotFromThread.useDraft")}</button>
                )}
                <textarea value={form.instructions} rows={7} maxLength={8000} onChange={(event) => setForm({ ...form, instructions: event.target.value })} className={`${field} font-mono text-[12.5px]`} />
              </label>

              <div data-teambot-carry-plugins>
                <div className="text-[12.5px] font-medium text-ink">{t("teamBotFromThread.plugins")}</div>
                {plugins && plugins.length === 0 && connectors.length === 0 && <p className="mt-1 text-[12px] text-ink-secondary">{t("teamBotFromThread.noPlugins")}</p>}
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {(plugins ?? []).map((plugin) => (
                    <label key={plugin.key} className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" className="size-3.5 accent-accent" checked={choices.plugins.has(plugin.key)} onChange={() => toggle("plugins", plugin.key)} />
                      {plugin.name}
                    </label>
                  ))}
                  {connectors.map((name) => (
                    <label key={`mcp:${name}`} className="flex items-center gap-1.5 text-[12.5px]">
                      <input type="checkbox" className="size-3.5 accent-accent" checked={choices.connectors.has(name)} onChange={() => toggle("connectors", name)} />
                      {name}
                    </label>
                  ))}
                </div>
              </div>

              <div data-teambot-carry-rules className="flex flex-col gap-1 rounded-xl border border-hairline/50 px-4 py-3">
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" data-teambot-carry-rules-box className="size-3.5 accent-accent" checked={choices.rules} onChange={(event) => setChoices({ ...choices, rules: event.target.checked })} />
                  {t("teamBotFromThread.rules", { name: sourceName })}
                </label>
                {source?.section && <p className="text-[12px] text-ink-secondary">{t("teamBotFromThread.teamMemory", { team: source.section })}</p>}
                <p data-teambot-private-memory className="text-[12px] text-ink-secondary">{t("teamBotFromThread.privateMemory", { name: sourceName })}</p>
              </div>
              <p className="flex items-start gap-2 text-[12px] leading-relaxed text-ink-secondary">
                <ShieldCheck size={14} className="mt-0.5 shrink-0 text-success" />
                <span>{t("teamBotFromThread.never")}</span>
              </p>
            </fieldset>
          )}
        </div>

        {error && <p role="alert" className="mx-6 mb-2 rounded-lg bg-danger/10 px-3 py-2 text-[12.5px] text-danger">{error}</p>}
        <footer className="flex justify-end gap-2 border-t border-hairline/35 px-6 py-3">
          {stage === "done" ? (
            <>
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("teamShare.done")}</button>
              <button type="button" data-teambot-publish onClick={publish} className="rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink">
                {organization ? t("teamBotFromThread.publish") : t("teamBotFromThread.open")}
              </button>
            </>
          ) : (
            <>
              <button type="button" disabled={busy} onClick={onClose} className="rounded-lg px-3 py-2 text-[13px] text-ink-secondary hover:bg-raised">{t("common.cancel")}</button>
              <button type="button" data-teambot-create disabled={busy || stage !== "ready" || !form?.name.trim() || !canCreate} onClick={() => void create()}
                className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-[13px] font-medium text-accent-ink disabled:opacity-40">
                {busy && <Loader2 size={14} className="animate-spin" />}
                {busy ? t("teamBotFromThread.creating") : t("teamBotFromThread.create")}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** Mounted once (App): keeps the menus' list of bots current and shows the
 * dialog a thread menu asked for. */
export function TeamBotFromThreadHost() {
  const { state } = useStore();
  const request = useTeamBotFromThreadRequest();
  const canCreate = viewerCanCreateBots(state.config);
  useEffect(() => {
    setTeamBotSources(canCreate ? state.bots.filter((bot) => !bot.hidden).map((bot) => bot.id) : []);
  }, [state.bots, canCreate]);
  if (!request) return null;
  return <TeamBotFromThreadDialog key={`${request.botId}:${request.threadId}`} request={request} onClose={closeTeamBotFromThread} />;
}

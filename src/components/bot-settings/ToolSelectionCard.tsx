import { useEffect, useRef, useState } from "react";
import { ChevronRight, X } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Bot } from "@/state/store";
import { allowsTool, narrowsNativeTools, parseToolScope } from "../../../shared/tool-scope";
import { TOOL_SCOPE_SUPPORT } from "../../../shared/tool-scope-support";
import { readableName } from "../../../shared/readable-name";
import { mcpServersForBot, useMcpServers } from "@/lib/mcp-servers";
import { useBotEditor } from "./BotEditorContext";
import { PILL, PLAIN_FIELD, PRIMARY_PILL, Switch, SwitchRow } from "../SettingsPrimitives";
import { inputCls } from "./field";
import { PaneSection, usePaneRows } from "./PaneSection";
import { readableError } from "@/lib/plain-error";

type Draft = { custom: boolean; onlyListed: boolean; allow: string; deny: string };
const lines = (text: string) => text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
const uniq = (list: string[]) => [...new Set(list)];

/** A group of tools: the engine's own ("native") or one MCP server. */
type Group = { ns: string; label: string; mounted: boolean };
const wildcard = (ns: string) => `${ns}:*`;
const inGroup = (ns: string) => (selector: string) => selector.startsWith(`${ns}:`) && selector.slice(ns.length + 1) !== "*"
  && (ns !== "native" || !selector.startsWith("mcp:"));
const serverOf = (selector: string) => selector.startsWith("mcp:") ? selector.slice(4, selector.indexOf(":", 4)) : undefined;
/** "read_notes" reads "Read notes"; the raw name stays in the Advanced fold. */
export const toolLabel = (name: string) => {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
};
const identity = (selector: string) => selector.startsWith("mcp:")
  ? { kind: "mcp" as const, server: serverOf(selector)!, name: selector.slice(selector.indexOf(":", 4) + 1) }
  : { kind: "native" as const, name: selector.slice(7) };

/** Direct, acknowledged saves: rejected restrictions must not appear saved
 * in the optimistic update queue. AccessSection keys this editor by bot ID.
 * #2092: a readable list (one switch per group, an expander per tool); the
 * raw selectors stay behind Advanced. Same `toolScope` model and PATCH. */
export function ToolSelectionCard({ bot, engineKind }: { bot: Bot; engineKind?: string }) {
  const { request } = useBotEditor();
  const { servers } = useMcpServers();
  const saved = parseToolScope(bot.toolScope);
  const scope = saved.ok ? saved.scope : undefined;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const fields = draft ?? {
    custom: bot.toolScope !== undefined, onlyListed: scope?.allow !== undefined,
    allow: scope?.allow?.join("\n") ?? "", deny: scope?.deny?.join("\n") ?? "",
  };
  const proposed = fields.custom ? {
    ...(fields.onlyListed ? { allow: lines(fields.allow) } : {}), deny: lines(fields.deny),
  } : undefined;
  const parsed = parseToolScope(proposed);
  const support = TOOL_SCOPE_SUPPORT[engineKind as keyof typeof TOOL_SCOPE_SUPPORT];
  const restricted = fields.custom && (fields.onlyListed || lines(fields.deny).length > 0);
  const unavailable = restricted && support !== "native-and-mcp"
    && (support !== "mcp" || narrowsNativeTools(proposed));
  const change = (patch: Partial<Draft>) => { setDraft({ ...fields, ...patch }); setError(null); };
  const disabled = saving || !!bot.busy;

  const allow = fields.custom && fields.onlyListed ? lines(fields.allow) : undefined;
  const deny = fields.custom ? lines(fields.deny) : [];
  /** Writes lists back; a plain deny list with nothing in it is "all tools". */
  const apply = (nextAllow: string[] | undefined, nextDeny: string[]) => {
    const all = nextAllow === undefined && nextDeny.length === 0;
    change({ custom: !all, onlyListed: nextAllow !== undefined, allow: (nextAllow ?? []).join("\n"), deny: uniq(nextDeny).join("\n") });
  };
  const groupOn = (ns: string) => allow ? allow.includes(wildcard(ns)) && !deny.includes(wildcard(ns)) : !deny.includes(wildcard(ns));
  const setGroup = (ns: string, on: boolean) => {
    const w = wildcard(ns); const mine = inGroup(ns);
    if (on) apply(allow ? uniq([...allow.filter(s => !mine(s)), w]) : undefined, deny.filter(s => s !== w));
    else if (allow) apply(allow.filter(s => s !== w && !mine(s)), deny.filter(s => !mine(s)));
    else apply(undefined, [...deny.filter(s => !mine(s)), w]);
  };
  const allowed = (selector: string) => proposed ? allowsTool(proposed, identity(selector)) : true;
  const setTool = (selector: string, ns: string, on: boolean) => {
    if (on) apply(allow && !groupOn(ns) ? uniq([...allow, selector]) : allow, deny.filter(s => s !== selector));
    else apply(allow?.filter(s => s !== selector), [...deny, selector]);
  };
  const removeTool = (selector: string) => apply(allow?.filter(s => s !== selector), deny.filter(s => s !== selector));
  const addTool = (ns: string) => {
    const name = adding.trim();
    if (!name || name.includes("*")) return;
    const selector = `${ns}:${name}`;
    if (groupOn(ns)) apply(allow, [...deny, selector]);
    else if (allow) apply(uniq([...allow, selector]), deny.filter(s => s !== selector));
    setAdding("");
  };

  const mountedServers = servers ? mcpServersForBot(servers, bot.mcpServers).map(server => server.name) : [];
  const named = uniq([...(allow ?? []), ...deny].map(serverOf).filter((name): name is string => !!name));
  const groups: Group[] = [
    { ns: "native", label: t("botAccess.tools.native"), mounted: true },
    ...uniq([...mountedServers, ...named]).map(name => ({ ns: `mcp:${name}`, label: readableName(name), mounted: mountedServers.includes(name) })),
  ];

  const save = async () => {
    if (!draft || bot.busy || pending.current || !parsed.ok) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      await request(`/api/bots/${bot.id}`, { method: "PATCH", body: JSON.stringify({ toolScope: parsed.scope ?? null }) });
      if (alive.current) setDraft(null);
    } catch (cause) {
      if (alive.current) setError(readableError(cause));
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  // The bot's profile page (#2313): reference rows, filled fields and
  // pills, nothing outlined or underlined.
  const rows = usePaneRows();
  const { plain } = rows;
  const field = plain ? PLAIN_FIELD : inputCls;
  const example = engineKind === "piAgent" ? "native:read\nnative:edit\nnative:write"
    : engineKind === "grokAgent" ? "native:read_file\nnative:search_replace\nnative:write"
      : support === "mcp" ? "native:*\nmcp:mail:read_notes" : "native:ask_user\nmcp:mail:read_notes";

  return <PaneSection title={t("botAccess.tools.title")} help={t("botAccess.tools.description")}>
    {!saved.ok && <p role="alert" className="mb-2 text-[12px] text-danger">{t("botAccess.tools.corrupt")}</p>}
    {saved.ok && scope?.allow?.length === 0 && <p role="status" className="mb-2 text-[12px] text-ink-secondary">{t("botAccess.tools.none")}</p>}
    <div data-tool-groups className={cn(rows.bleed, "-mt-1", rows.list)}>
      {groups.map(group => {
        const on = groupOn(group.ns);
        const mine = inGroup(group.ns);
        const exceptions = uniq([...(allow ?? []).filter(mine), ...deny.filter(mine)]);
        const expanded = open === group.ns;
        const status = !group.mounted ? t("botAccess.tools.notMounted")
          : exceptions.length ? t("botAccess.tools.exceptions", { count: exceptions.length })
            : on ? t("botAccess.tools.groupAll") : t("botAccess.tools.groupOff");
        return <div key={group.ns} data-tool-group={group.ns}>
          <div className={cn("flex min-h-[44px] items-center gap-2 py-2", rows.row)}>
            <button type="button" aria-expanded={expanded} aria-label={t("botAccess.tools.expand", { name: group.label })}
              onClick={() => { setOpen(expanded ? null : group.ns); setAdding(""); }}
              className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <ChevronRight size={14} aria-hidden="true" className={cn("shrink-0 text-ink-secondary transition-transform motion-reduce:transition-none", expanded && "rotate-90")} />
              <span className="min-w-0">
                <span className={cn("block truncate text-ink", rows.title)}>{group.label}</span>
                <span className={cn("block truncate text-ink-secondary", rows.note)}>{status}</span>
              </span>
            </button>
            <Switch checked={on} disabled={disabled} aria-label={t("botAccess.tools.groupAria", { name: group.label })}
              onClick={() => setGroup(group.ns, !on)} className="disabled:cursor-not-allowed" />
          </div>
          {expanded && <div className={cn("flex flex-col gap-1 pb-3", plain ? "pl-[38px] pr-4" : "pl-9 pr-3.5")}>
            {exceptions.map(selector => {
              const name = selector.slice(group.ns.length + 1);
              const ok = allowed(selector);
              return <div key={selector} data-tool-row={selector} className="flex min-h-[32px] items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink" title={selector}>{toolLabel(name)}</span>
                <span className="text-[11.5px] text-ink-secondary">{t(ok ? "botAccess.tools.allowed" : "botAccess.tools.blocked")}</span>
                <Switch checked={ok} disabled={disabled} aria-label={t("botAccess.tools.toolAria", { name: toolLabel(name) })}
                  onClick={() => setTool(selector, group.ns, !ok)} className="disabled:cursor-not-allowed" />
                <button type="button" disabled={disabled} onClick={() => removeTool(selector)}
                  aria-label={t("botAccess.tools.remove", { name: toolLabel(name) })}
                  className="grid size-6 place-items-center rounded-md text-ink-secondary hover:bg-hover disabled:opacity-50"><X size={12} aria-hidden="true" /></button>
              </div>;
            })}
            {!exceptions.length && <p className="text-[12px] text-ink-secondary">{t(on ? "botAccess.tools.noException" : "botAccess.tools.noneAllowed")}</p>}
            {on || allow ? <form className="mt-1 flex items-center gap-2" onSubmit={(event) => { event.preventDefault(); addTool(group.ns); }}>
              <input aria-label={t("botAccess.tools.toolName")} placeholder={t("botAccess.tools.toolName")} disabled={disabled} spellCheck={false}
                value={adding} onChange={event => setAdding(event.target.value)} className={cn(field, "min-w-0 flex-1")} />
              <button type="submit" disabled={disabled || !adding.trim() || adding.includes("*")} className={plain ? cn(PILL, "shrink-0") : "shrink-0 text-[12.5px] text-accent disabled:opacity-50"}>
                {t(on ? "botAccess.tools.block" : "botAccess.tools.allowOne")}
              </button>
            </form> : <p className="text-[12px] text-ink-secondary">{t("botAccess.tools.turnOnHint")}</p>}
          </div>}
        </div>;
      })}
    </div>
    <details data-tool-advanced className="group/adv mt-3">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] text-ink-secondary [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} aria-hidden="true" className="transition-transform group-open/adv:rotate-90 motion-reduce:transition-none" />
        {t("botAccess.tools.advanced")}
      </summary>
      <fieldset disabled={disabled} className="mt-3 flex flex-col gap-3">
        <SwitchRow label={t("botAccess.tools.onlyListed")} checked={fields.custom && fields.onlyListed}
          onChange={(next) => change({ custom: true, onlyListed: next })} />
        <label className="text-[13px] text-ink-secondary">{t("botAccess.tools.allow")}
          <textarea aria-label={t("botAccess.tools.allow")} disabled={!fields.custom || !fields.onlyListed} rows={3} spellCheck={false}
            className={cn(field, "mt-1 font-mono text-[12px] disabled:opacity-50")} placeholder={example} value={fields.allow} onChange={event => change({ allow: event.target.value })} />
        </label>
        {fields.custom && fields.onlyListed && lines(fields.allow).length === 0 && <p className="text-[12px] text-ink-secondary">{t("botAccess.tools.emptyHint")}</p>}
        <label className="text-[13px] text-ink-secondary">{t("botAccess.tools.exclude")}
          <textarea aria-label={t("botAccess.tools.exclude")} rows={2} spellCheck={false} className={cn(field, "mt-1 font-mono text-[12px]")}
            placeholder="mcp:mail:send" value={fields.deny} onChange={event => change({ custom: true, deny: event.target.value })} />
        </label>
        <p className="text-[12px] text-ink-secondary">{t("botAccess.tools.syntax")}</p>
        {engineKind === "grokAgent" && <p className="text-[12px] text-ink-secondary">{t("botAccess.tools.grok")}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {fields.custom && <button type="button" onClick={() => change({ custom: false, onlyListed: false, allow: "", deny: "" })}
            className={plain ? PILL : "text-[12.5px] text-accent"}>{t("botAccess.tools.all")}</button>}
          <a href="https://github.com/pulsatrixtechnologies/sagax/blob/main/docs/tool-selection.md" target="_blank" rel="noreferrer" className={plain ? PILL : "text-[12px] text-ink-secondary underline"}>{t("botAccess.tools.examples")}</a>
        </div>
      </fieldset>
    </details>
    {unavailable && <p role="alert" className="mt-2 text-[12px] text-danger">
      {t(support === "mcp" ? "botAccess.tools.nativeUnsupported" : "botAccess.tools.unsupported")}
    </p>}
    {!parsed.ok && <p role="alert" className="mt-2 text-[12px] text-danger">{parsed.error}</p>}
    {error && <p role="alert" className="mt-2 text-[12px] text-danger">{error}</p>}
    {bot.busy && <p className="mt-2 text-[12px] text-ink-secondary">{t("botAccess.tools.busy")}</p>}
    {draft && <div className="mt-3">
      <button type="button" disabled={disabled || !parsed.ok} onClick={() => void save()} className={plain ? PILL : PRIMARY_PILL}>
        {t(saving ? "botAccess.tools.saving" : "botAccess.tools.save")}
      </button>
    </div>}
  </PaneSection>;
}

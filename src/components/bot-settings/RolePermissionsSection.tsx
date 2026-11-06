// Details > Permissions (2026-11-05, JC): the bot panel's Roles tab is gone.
// What stays is the missing permission alert: ONE row, shown only when the
// bot was refused at least once in the last seven days. The row says what
// the role cannot do ("Dispatch Agent ne peut pas modifier les billets"),
// its state in grey, and "Envoyer à l'admin" (a Sagax message to the
// organization admins, never a ConnectWise write). Nothing is lost: the
// roles graph of the seven days and each edge's history sit behind the
// row's disclosure. Role names only; a profile id shows in a tooltip at most.
import { useEffect, useId, useMemo, useState } from "react";
import { ChevronDown, Send, ShieldAlert } from "lucide-react";
import { activeLocale, documentLanguage, t } from "@/lib/i18n";
import { api } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import { useShowThreads } from "@/lib/thread-preferences";
import { readableError } from "@/lib/plain-error";
import { cn } from "@/lib/cn";
import { stepToolName } from "@/lib/step-label";
import { roleLabel } from "../RoleChip";
import { permissionText } from "@/lib/role-permission";
import { GROUPED_CARD, GROUPED_ROW } from "@/lib/grouped-card";
import { ROLE_GRAPH_WINDOW_MS, type MissingPermission, type RoleGraphEdge, type RoleGraphNode, type RolesTabBody } from "../../../shared/role-graph";
import type { CwOperation, CwPermission } from "../../../shared/perspicax-roles";

const ET = "America/New_York";

function intlLocale(): string {
  const lang = documentLanguage(activeLocale());
  return lang.startsWith("fr") ? "fr-CA" : lang;
}

/** "5 nov. 13:10" in Eastern time. */
export function easternTime(at: number): string {
  try {
    const date = new Intl.DateTimeFormat(intlLocale(), { timeZone: ET, month: "short", day: "numeric" }).format(new Date(at));
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: ET, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "00";
    return `${date} ${part("hour")}:${part("minute")}`;
  } catch {
    return new Date(at).toISOString();
  }
}

const toolName = (name: string) => (name ? stepToolName({ name }) : "");

function nodeLabel(node: { slug: string; name: string }): string {
  return roleLabel(node);
}

interface Placed extends RoleGraphNode { x: number; y: number; w: number }

const W = 320;
const H = 230;
const NODE_H = 26;

/** Nodes on a circle ("Moi" first, at the top); one node sits in the middle. */
export function placeNodes(nodes: readonly RoleGraphNode[]): Placed[] {
  const n = nodes.length;
  const rx = n <= 2 ? 95 : 108;
  const ry = n <= 2 ? 0 : 78;
  return nodes.map((node, index) => {
    const label = nodeLabel(node);
    const w = Math.min(130, Math.max(54, label.length * 6.6 + 34));
    if (n === 1) return { ...node, x: W / 2, y: H / 2, w };
    const angle = n === 2 ? Math.PI * index : -Math.PI / 2 + (2 * Math.PI * index) / n;
    return { ...node, x: W / 2 + rx * Math.cos(angle), y: H / 2 + ry * Math.sin(angle), w };
  });
}

/** Where the segment from the centre of `a` toward `b` leaves `a`'s box. */
function edgeOf(a: Placed, b: { x: number; y: number }, pad = 4): { x: number; y: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return { x: a.x, y: a.y };
  const sx = dx ? (a.w / 2 + pad) / Math.abs(dx) : Infinity;
  const sy = dy ? (NODE_H / 2 + pad) / Math.abs(dy) : Infinity;
  const s = Math.min(sx, sy, 1);
  return { x: a.x + dx * s, y: a.y + dy * s };
}

function edgePath(from: Placed, to: Placed, bend: number): { d: string; mx: number; my: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  // a bend to the left of the direction keeps A→B and B→A apart
  const cx = (from.x + to.x) / 2 - (dy / len) * bend;
  const cy = (from.y + to.y) / 2 + (dx / len) * bend;
  const start = edgeOf(from, { x: cx, y: cy });
  const end = edgeOf(to, { x: cx, y: cy }, 7);
  const mx = 0.25 * start.x + 0.5 * cx + 0.25 * end.x;
  const my = 0.25 * start.y + 0.5 * cy + 0.25 * end.y;
  return { d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`, mx, my };
}

const edgeId = (edge: RoleGraphEdge) => `${edge.from}→${edge.to}`;

export function RolesGraph({ graph, selected, onSelect }: { graph: Pick<RolesTabBody, "nodes" | "edges">; selected: string | null; onSelect: (id: string | null) => void }) {
  const marker = useId().replace(/:/g, "");
  const placed = useMemo(() => placeNodes(graph.nodes), [graph.nodes]);
  const bySlug = new Map(placed.map((node) => [node.slug, node]));
  // the view fits the nodes (a triangle leaves no empty band below)
  const top = Math.max(0, Math.min(...placed.map((node) => node.y)) - NODE_H / 2 - 24);
  const bottom = Math.min(H, Math.max(...placed.map((node) => node.y)) + NODE_H / 2 + 24);
  return (
    <svg viewBox={`0 ${top.toFixed(1)} ${W} ${(bottom - top).toFixed(1)}`} role="group" aria-label={t("roles.tab.graphAria")} data-roles-graph="" className="h-auto w-full select-none">
      <defs>
        {(["idle", "on"] as const).map((state) => (
          <marker key={state} id={`${marker}-${state}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" className={state === "on" ? "fill-accent" : "fill-ink-tertiary"} />
          </marker>
        ))}
      </defs>
      {graph.edges.map((edge) => {
        const from = bySlug.get(edge.from);
        const to = bySlug.get(edge.to);
        if (!from || !to) return null;
        const id = edgeId(edge);
        const on = selected === id;
        const { d, mx, my } = edgePath(from, to, graph.edges.some((other) => other.from === edge.to && other.to === edge.from) ? 22 : 10);
        const label = t("roles.tab.edgeAria", { from: nodeLabel(from), to: nodeLabel(to), count: String(edge.count) });
        return (
          <g key={id} role="button" tabIndex={0} aria-pressed={on} aria-label={label} data-role-edge={id}
            onClick={() => onSelect(on ? null : id)}
            onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(on ? null : id); } }}
            className="cursor-pointer outline-none [&:focus-visible_.edge-line]:stroke-accent">
            <title>{label}</title>
            <path d={d} fill="none" stroke="transparent" strokeWidth={14} />
            <path d={d} fill="none" strokeWidth={on ? 2.2 : 1.4} markerEnd={`url(#${marker}-${on ? "on" : "idle"})`} className={cn("edge-line", on ? "stroke-accent" : "stroke-ink-tertiary")} />
            <circle cx={mx} cy={my} r={9} className={cn(on ? "fill-accent" : "fill-elevated", "stroke-hairline")} strokeWidth={1} />
            <text x={mx} y={my} dy="0.35em" textAnchor="middle" className={cn("text-[10px] font-medium", on ? "fill-accent-ink" : "fill-ink-secondary")}>{edge.count}</text>
          </g>
        );
      })}
      {placed.map((node) => {
        const label = nodeLabel(node);
        const tip = `${label} · ${t("roles.tab.calls", { count: String(node.calls) })}${node.id ? ` · ${node.id}` : ""}`;
        return (
          <g key={node.slug || "me"} data-role-node={node.slug || "me"}>
            <title>{tip}</title>
            <rect x={node.x - node.w / 2} y={node.y - NODE_H / 2} width={node.w} height={NODE_H} rx={NODE_H / 2}
              className={node.slug ? "fill-elevated stroke-hairline" : "fill-elevated stroke-accent-border"} strokeWidth={1} />
            <text x={node.x} y={node.y} dy="0.35em" textAnchor="middle" className="fill-ink text-[11.5px] font-medium">{label.length > 18 ? `${label.slice(0, 17)}…` : label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function reasonText(reason: string | undefined): string {
  switch (reason) {
    case "routine": return t("roles.tab.reason.routine");
    case "person": return t("roles.tab.reason.person");
    case "switch": return t("roles.tab.reason.switch");
    case "fallback": return t("roles.tab.reason.fallback");
    case "rule": return t("roles.tab.reason.rule");
    case "default": return t("roles.tab.reason.default");
    default: return t("roles.tab.reason.journal");
  }
}

function EdgeHistory({ edge, names, onOpenThread }: { edge: RoleGraphEdge; names: Map<string, string>; onOpenThread?: (threadId: string) => void }) {
  return (
    <section data-role-edge-history="" className="flex flex-col gap-1.5 rounded-xl border border-hairline-weak p-3">
      <h3 className="text-[12.5px] font-medium text-ink">{t("roles.tab.historyTitle", { from: names.get(edge.from) ?? "", to: names.get(edge.to) ?? "" })}</h3>
      {edge.history.length === 0 && <p className="text-[12px] text-ink-tertiary">{t("roles.tab.historyEmpty")}</p>}
      <ul className="flex flex-col divide-y divide-hairline-weak">
        {edge.history.map((event, index) => (
          <li key={`${event.at}-${index}`} className="flex flex-col gap-0.5 py-1.5 text-[12px]">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-ink">{reasonText(event.reason)}</span>
              <time className="shrink-0 tabular-nums text-ink-tertiary" dateTime={new Date(event.at).toISOString()}>{easternTime(event.at)}</time>
            </div>
            {event.refusedTool && <span className="text-ink-secondary">{t("roles.tab.refusedTool", { tool: toolName(event.refusedTool) })}</span>}
            {!event.refusedTool && event.tool && <span className="text-ink-secondary">{t("roles.tab.firstTool", { tool: toolName(event.tool) })}</span>}
            {event.threadId && onOpenThread && (
              <button type="button" data-role-thread={event.threadId} className="self-start text-accent-text underline-offset-2 hover:underline"
                onClick={() => onOpenThread(event.threadId!)}>
                {t("roles.tab.openThread")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// What a refused permission is about, in words: "les billets", else the
// security role function ConnectWise names ("Holiday Lists").
const OBJECTS: Record<string, "tickets" | "time" | "schedule" | "companies" | "contacts" | "projects" | "agreements" | "configurations" | "invoices"> = {
  "service/tickets": "tickets",
  "time/entries": "time",
  "schedule/entries": "schedule",
  "company/companies": "companies",
  "company/contacts": "contacts",
  "project/projects": "projects",
  "finance/agreements": "agreements",
  "company/configurations": "configurations",
  "finance/invoices": "invoices",
};

function permissionObject(permission: CwPermission): string {
  const path = permission.path.replace(/\./g, "/").replace(/^\/+/, "").toLowerCase();
  const known = Object.entries(OBJECTS).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  if (known) return t(`roles.object.${known[1]}`);
  return permission.func || permission.path;
}

function operationVerb(operation: CwOperation): string {
  return t(operation === "Inquire" ? "roles.verb.inquire" : operation === "Add" ? "roles.verb.add" : operation === "Edit" ? "roles.verb.edit" : "roles.verb.delete");
}

/** "Dispatch Agent ne peut pas modifier les billets". */
export function refusalLabel(entry: Pick<MissingPermission, "role" | "permission">): string {
  return t("roles.refusal.label", { role: roleLabel(entry.role), verb: operationVerb(entry.permission.operation), object: permissionObject(entry.permission) });
}

/** "refusé 1 fois, dernier 5 nov. 13:10". */
export function refusalState(entry: Pick<MissingPermission, "count" | "lastAt">): string {
  return t(entry.count === 1 ? "roles.refusal.state.one" : "roles.refusal.state.other", { count: String(entry.count), when: easternTime(entry.lastAt) });
}

/** The refusals of the last seven days, newest first. */
export function recentRefusals(missing: readonly MissingPermission[], now: number): MissingPermission[] {
  return missing.filter((entry) => entry.lastAt >= now - ROLE_GRAPH_WINDOW_MS).sort((a, b) => b.lastAt - a.lastAt);
}

function RefusalEntry({ entry }: { entry: MissingPermission }) {
  return (
    <li data-missing-permission={entry.id} title={permissionText(entry.permission)} className="flex flex-col gap-0.5 py-2 text-[12.5px]">
      <span className="text-ink">{refusalLabel(entry)}</span>
      <span className="text-ink-tertiary">{refusalState(entry)}{entry.sentAt ? ` · ${t("roles.missing.sent", { when: easternTime(entry.sentAt) })}` : ""}</span>
      <span className="text-ink-tertiary">
        {entry.member ? t("roles.missing.fixMember", { member: entry.member }) : t("roles.missing.fixRole", { role: roleLabel(entry.role) })}
      </span>
    </li>
  );
}

/** The row itself, store-free: `onOpenThread` opens an edge's conversation. */
export function RolePermissionsView({ botId, body, now = Date.now(), open, onOpenThread }: { botId: string; body: RolesTabBody | null; now?: number; open?: boolean; onOpenThread?: (threadId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = useMemo(() => new Map((body?.nodes ?? []).map((node) => [node.slug, nodeLabel(node)])), [body]);
  const refusals = useMemo(() => recentRefusals(body?.missing ?? [], now).map((entry) => (sent[entry.id] ? { ...entry, sentAt: sent[entry.id] } : entry)), [body, now, sent]);
  // no recent refusal: no row, no section
  if (!body || refusals.length === 0) return null;
  const latest = refusals[0]!;
  const unsent = refusals.filter((entry) => !entry.sentAt);
  const lastSent = Math.max(0, ...refusals.map((entry) => entry.sentAt ?? 0));
  const others = refusals.length - 1;
  const edge = body.edges.find((candidate) => edgeId(candidate) === selected) ?? null;
  const send = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      for (const entry of unsent) {
        const answer = await api<{ sentAt: number }>(`/api/bots/${encodeURIComponent(botId)}/roles/missing/send`, { method: "POST", body: JSON.stringify({ id: entry.id }) });
        const at = typeof answer.sentAt === "number" ? answer.sentAt : Date.now();
        setSent((before) => ({ ...before, [entry.id]: at }));
      }
    })()
      .catch((cause: unknown) => setError(readableError(cause)))
      .finally(() => setBusy(false));
  };
  return (
    <section data-bot-settings-section="permissions" className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <ShieldAlert size={16} aria-hidden="true" className="text-ink-secondary" />
        <h2 className="min-w-0 flex-1 text-[13px] font-normal leading-[18px] text-ink-secondary">{t("roles.permissions.title")}</h2>
      </div>
      <div className={GROUPED_CARD}>
        <div data-missing-permission-row={latest.id} className={cn("flex flex-col gap-2", GROUPED_ROW)}>
          <div className="flex items-start gap-2.5">
            <div className="min-w-0 flex-1" title={permissionText(latest.permission)}>
              <span data-missing-label="" className="block text-[13px] font-medium leading-[18px] text-ink">{refusalLabel(latest)}</span>
              <span data-missing-state="" className="block text-[12.5px] leading-[18px] text-ink-tertiary">
                {refusalState(latest)}
                {others > 0 ? ` · ${t(others === 1 ? "roles.refusal.others.one" : "roles.refusal.others.other", { count: String(others) })}` : ""}
              </span>
            </div>
            {unsent.length === 0
              ? <span data-missing-sent="" className="shrink-0 pt-0.5 text-[12px] text-ink-tertiary">{t("roles.missing.sent", { when: easternTime(lastSent) })}</span>
              : (
                <button type="button" data-missing-send="" disabled={busy} onClick={send}
                  className="ui-button h-[28px] shrink-0 gap-1.5 px-[11px] text-[12.5px] leading-[18px] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                  <Send size={13} aria-hidden="true" />
                  {t("roles.missing.send")}
                </button>
              )}
          </div>
          {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
          <details data-missing-details="" open={open} className="group/roles flex flex-col">
            <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded text-[12.5px] text-ink-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 [&::-webkit-details-marker]:hidden">
              {t("roles.permissions.more")}
              <ChevronDown size={13} aria-hidden="true" className="transition-transform group-open/roles:rotate-180 motion-reduce:transition-none" />
            </summary>
            <div className="mt-2 flex flex-col gap-3">
              <ul data-missing-list="" className="flex flex-col divide-y divide-hairline-weak">
                {refusals.map((entry) => <RefusalEntry key={entry.id} entry={entry} />)}
              </ul>
              {body.nodes.length > 1 || body.edges.length > 0 ? (
                <div data-roles-graph-block="" className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[12.5px] font-medium text-ink">{t("roles.tab.title")}</h3>
                    <span className="text-[11.5px] text-ink-tertiary">{t("roles.tab.window")}</span>
                  </div>
                  <RolesGraph graph={body} selected={selected} onSelect={setSelected} />
                  {body.edges.length > 0 && !edge && <p className="text-[11.5px] text-ink-tertiary">{t("roles.tab.pickEdge")}</p>}
                  {edge && <EdgeHistory edge={edge} names={names} {...(onOpenThread ? { onOpenThread } : {})} />}
                </div>
              ) : null}
            </div>
          </details>
        </div>
      </div>
    </section>
  );
}

/** Details > Permissions: reads the bot's roles once; nothing shows while
 * it loads, on a failure, or when nothing was refused lately. */
export function RolePermissionsSection({ botId }: { botId: string }) {
  const dispatch = useStoreDispatch();
  const [body, setBody] = useState<RolesTabBody | null>(null);
  useEffect(() => {
    let alive = true;
    setBody(null);
    void api<RolesTabBody>(`/api/bots/${encodeURIComponent(botId)}/roles`)
      .then((answer) => { if (alive) setBody({ nodes: answer.nodes ?? [], edges: answer.edges ?? [], missing: answer.missing ?? [], journal: answer.journal === "perspicax" ? "perspicax" : "local" }); })
      .catch(() => { if (alive) setBody(null); });
    return () => { alive = false; };
  }, [botId]);
  // unified chat (Show threads off, JC's mode): everything lives in the
  // bot's one chat, so the edge history never links to another thread
  const showThreads = useShowThreads();
  const openThread = (threadId: string) => {
    dispatch({ type: "switchTask", botId, threadId });
    dispatch({ type: "revealThread", threadId });
  };
  return <RolePermissionsView botId={botId} body={body} {...(showThreads ? { onOpenThread: openThread } : {})} />;
}

// Visible roles, batch 5 (2026-11-05): the bot panel's "Rôles" tab.
// A small graph of the roles this person's bot used in the last seven days
// ("Moi" included) and the transitions between them with their count; a
// click on an edge lists its history. Below, "Permissions manquantes": what
// a role was refused, the ConnectWise permission an administrator would
// fix, and "Envoyer à l'admin" (a Sagax message, never a ConnectWise write).
// Role names only; a profile id shows in a tooltip at most.
import { useEffect, useId, useMemo, useState } from "react";
import { Send } from "lucide-react";
import { activeLocale, documentLanguage, t } from "@/lib/i18n";
import { api } from "@/state/store";
import { useStoreDispatch } from "@/state/store-selector";
import { readableError } from "@/lib/plain-error";
import { cn } from "@/lib/cn";
import { stepToolName } from "@/lib/step-label";
import { roleLabel } from "../RoleChip";
import { permissionArea, operationLabel } from "@/lib/role-permission";
import type { MissingPermission, RoleGraphEdge, RoleGraphNode, RolesTabBody } from "../../../shared/role-graph";

const ET = "America/New_York";

function intlLocale(): string {
  const lang = documentLanguage(activeLocale());
  return lang.startsWith("fr") ? "fr-CA" : lang;
}

/** "5 nov., 14 h 03" in Eastern time. */
export function easternTime(at: number): string {
  try {
    return new Intl.DateTimeFormat(intlLocale(), { timeZone: ET, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
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

function MissingRow({ botId, entry, onSent }: { botId: string; entry: MissingPermission; onSent: (sentAt: number) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = () => {
    setBusy(true);
    setError(null);
    void api<{ sentAt: number }>(`/api/bots/${encodeURIComponent(botId)}/roles/missing/send`, { method: "POST", body: JSON.stringify({ id: entry.id }) })
      .then((body) => onSent(typeof body.sentAt === "number" ? body.sentAt : Date.now()))
      .catch((cause: unknown) => setError(readableError(cause)))
      .finally(() => setBusy(false));
  };
  const role = roleLabel(entry.role);
  return (
    <li data-missing-permission={entry.id} className="flex flex-col gap-1 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium text-ink">{permissionArea(entry.permission)}</p>
          <p className="text-[12px] text-ink-secondary">
            {entry.permission.path && <code className="mr-1 rounded bg-elevated px-1 py-px text-[11px]">{entry.permission.path}</code>}
            {operationLabel(entry.permission.operation)}
          </p>
        </div>
        {entry.sentAt
          ? <span data-missing-sent="" className="shrink-0 text-[12px] text-ink-tertiary">{t("roles.missing.sent", { when: easternTime(entry.sentAt) })}</span>
          : (
            <button type="button" data-missing-send={entry.id} disabled={busy} onClick={send}
              className="flex shrink-0 items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[12px] text-ink hover:bg-elevated-hover disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-accent">
              <Send size={12} aria-hidden="true" />
              {t("roles.missing.send")}
            </button>
          )}
      </div>
      <p className="text-[12px] text-ink-secondary">
        {entry.member ? t("roles.missing.fixMember", { member: entry.member }) : t("roles.missing.fixRole", { role })}
      </p>
      <p className="text-[11.5px] text-ink-tertiary">
        {t("roles.missing.seen", { count: String(entry.count), when: easternTime(entry.lastAt) })}
      </p>
      {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
    </li>
  );
}

/** The tab itself, store-free: `onOpenThread` opens an edge's conversation. */
export function RolesTabView({ botId, body, error, onOpenThread }: { botId: string; body: RolesTabBody | null; error?: string | null; onOpenThread?: (threadId: string) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, number>>({});
  const names = useMemo(() => new Map((body?.nodes ?? []).map((node) => [node.slug, nodeLabel(node)])), [body]);
  if (error) return <p role="alert" className="px-4 pt-2 text-[12.5px] text-danger">{error}</p>;
  if (!body) return <p className="px-4 pt-2 text-[12.5px] text-ink-tertiary">{t("roles.tab.loading")}</p>;
  const edge = body.edges.find((candidate) => edgeId(candidate) === selected) ?? null;
  // grouped by role
  const missingByRole = new Map<string, MissingPermission[]>();
  for (const entry of body.missing) {
    const list = missingByRole.get(entry.role.slug) ?? [];
    list.push(sent[entry.id] ? { ...entry, sentAt: sent[entry.id] } : entry);
    missingByRole.set(entry.role.slug, list);
  }
  return (
    <div data-roles-tab="" className="flex flex-col gap-5 px-4 pb-6 pt-2">
      <section className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-medium text-ink">{t("roles.tab.title")}</h2>
          <span className="text-[11.5px] text-ink-tertiary">{t("roles.tab.window")}</span>
        </div>
        {body.edges.length === 0 && body.nodes.length <= 1
          ? <p className="text-[12.5px] text-ink-tertiary">{t("roles.tab.empty")}</p>
          : <RolesGraph graph={body} selected={selected} onSelect={setSelected} />}
        {body.journal === "local" && <p data-roles-local="" className="text-[11.5px] text-ink-tertiary">{t("roles.tab.localOnly")}</p>}
        {body.edges.length > 0 && !edge && <p className="text-[11.5px] text-ink-tertiary">{t("roles.tab.pickEdge")}</p>}
        {edge && <EdgeHistory edge={edge} names={names} {...(onOpenThread ? { onOpenThread } : {})} />}
      </section>
      <section className="flex flex-col gap-1" data-missing-list="">
        <h2 className="text-[13px] font-medium text-ink">{t("roles.missing.title")}</h2>
        {body.missing.length === 0 && <p className="text-[12.5px] text-ink-tertiary">{t("roles.missing.none")}</p>}
        {[...missingByRole.entries()].map(([slug, list]) => (
          <div key={slug || "me"} data-missing-role={slug || "me"} className="flex flex-col">
            <h3 className="pt-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{roleLabel(list[0]!.role)}</h3>
            <ul className="flex flex-col divide-y divide-hairline-weak">
              {list.map((entry) => <MissingRow key={entry.id} botId={botId} entry={entry} onSent={(at) => setSent((before) => ({ ...before, [entry.id]: at }))} />)}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

export function RolesTab({ botId }: { botId: string }) {
  const dispatch = useStoreDispatch();
  const [body, setBody] = useState<RolesTabBody | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setBody(null);
    setError(null);
    void api<RolesTabBody>(`/api/bots/${encodeURIComponent(botId)}/roles`)
      .then((answer) => { if (alive) setBody({ nodes: answer.nodes ?? [], edges: answer.edges ?? [], missing: answer.missing ?? [], journal: answer.journal === "perspicax" ? "perspicax" : "local" }); })
      .catch((cause: unknown) => { if (alive) setError(readableError(cause)); });
    return () => { alive = false; };
  }, [botId]);
  const openThread = (threadId: string) => {
    dispatch({ type: "switchTask", botId, threadId });
    dispatch({ type: "revealThread", threadId });
  };
  return <RolesTabView botId={botId} body={body} error={error} onOpenThread={openThread} />;
}

/** Isolated gallery for headless captures of the visible roles
 * (2026-11-05): the role chip on Perspicax steps, "why this role", the
 * "Agit comme" card, the banners of a refused write and a lapsed role.
 * Batches 3-5 add their views here. Not shipped in the app.
 * ?skin=pulsatrix|pulsatrix-light&lang=<code>&view=thread */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ToolActivity } from "../components/ToolActivity";
import { RoleTransitionCard } from "../components/RoleTransitionCard";
import { RoleNoticeRow } from "../components/RoleNoticeRow";
import { RolePicker, type HeldRolesAnswer } from "../components/RolePicker";
import { pickRole } from "../lib/role-pick";
import { RoutineActAsField } from "../components/routines/RoutineActAsField";
import { PanelRows } from "../components/routines/PanelRows";
import type { RoutineReadinessControl } from "../components/routines/RoutineReadiness";
import type { HeldRole } from "../../shared/perspicax-roles";
import { routineRoleCoverageAnswer } from "../../shared/routine-role-coverage";
import { RolesTabView } from "../components/bot-settings/RolesTab";
import type { RolesTabBody } from "../../shared/role-graph";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
export const view = params.get("view") ?? "thread";

type Tool = NonNullable<Message["tool"]>;
const desk = { slug: "service-desk", name: "Service Desk" };
const person = "Alex Martin";
const steps: Tool[] = [
  { name: "mcp__perspicax__cw_psa_find_tickets", product: "ConnectWise", ok: true, durationMs: 1_400, input: JSON.stringify({ conditions: "board/id=1 and closedFlag=false" }), role: { ...desk, reason: "routine" } },
  { name: "mcp__perspicax__cw_psa_find_schedule_entries", product: "ConnectWise", ok: true, durationMs: 900, role: { ...desk, reason: "routine" } },
  { name: "mcp__perspicax__cw_psa_query", product: "ConnectWise", ok: true, durationMs: 2_100, input: JSON.stringify({ resource: "schedule/holidayLists" }), role: { slug: "", name: "", reason: "fallback", refusedTool: "cw_psa_query", previous: desk, person } },
  { name: "mcp__perspicax__cw_psa_book_schedule_entry", product: "ConnectWise", ok: true, durationMs: 1_100, role: { ...desk, reason: "routine", previous: { slug: "", name: "" } } },
];
const card = (answered?: "continue" | "stay" | "always"): Message => ({
  id: answered ? "card-answered" : "card", role: "bot", kind: "options", at: 0, text: "",
  card: {
    title: "", subtitle: "", options: ["Continuer", "Rester en Service Desk", "Toujours ainsi pour ce bot"],
    ...(answered ? { answered: answered === "stay" ? "Rester en Service Desk" : "Continuer" } : {}),
    roleTransition: { botId: "nova", botName: "Nova", person, from: desk, to: { slug: "", name: "" }, reason: "fallback", refusedTool: "cw_psa_query", path: "schedule/holidayLists", canAlways: true, ...(answered ? { choice: answered } : {}) },
  },
} as Message);

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{title}</h2>
      {children}
    </section>
  );
}

function OpenWhy() {
  // the third step's chip, opened, as the person sees "why this role"
  useEffect(() => {
    const button = document.querySelector<HTMLButtonElement>("[data-open-why] [data-role-chip] button");
    if (button && button.getAttribute("aria-expanded") !== "true") button.click();
  });
  return <div data-open-why=""><ToolActivity tool={steps[2]!} /></div>;
}

function Thread() {
  return (
    <>
      <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">Fais la passe du matin du tableau 1</div>
      <Section title="Étapes et rôles">
        <ToolActivity tool={steps[0]!} />
        <ToolActivity tool={steps[1]!} />
        <OpenWhy />
        <RoleTransitionCard message={card()} threadId="t" />
        <ToolActivity tool={steps[3]!} />
      </Section>
      <Section title="Carte répondue">
        <RoleTransitionCard message={card("stay")} threadId="t" />
      </Section>
      <Section title="Bannières">
        <RoleNoticeRow botName="Nova" notice={{ kind: "write_refused", role: desk, tool: "cw_psa_log_time", target: "cw_member:nova", permission: { path: "time/entries", module: "Time & Expense", func: "Time Entry", operation: "Add" } }} />
        <RoleNoticeRow botName="Nova" notice={{ kind: "lapsed", role: desk, tool: "cw_psa_find_tickets" }} />
      </Section>
    </>
  );
}

const held: HeldRolesAnswer = {
  available: true,
  current: "",
  roles: [
    { slug: "service-desk", name: "Service Desk", readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true, routines_run: true } },
    { slug: "dispatch", name: "Dispatch", readOnly: true, explicitOnly: false, reachable: true, can: { read: true, write: false } },
    { slug: "full-access", name: "Full Access", readOnly: false, explicitOnly: true, reachable: true, can: { read: true, write: true, routines_run: true, approvals_answer: true, flow: true, sagax: true } },
  ],
};

/** Batch 3: the composer's role picker, open, above a composer-like pill;
 * below it, the chip once Service Desk is picked for the next message. */
function Picker() {
  pickRole("nova", "picked", "service-desk");
  return (
    <>
      <div className="self-end rounded-[18px] bg-bubble-user px-3 py-2 text-[13px] text-ink">Ferme les billets réglés du tableau 1</div>
      <Section title="Sélecteur de rôle (ouvert)">
        <div className="h-[330px]" />
        <div className="flex min-h-11 items-center gap-2 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5">
          <RolePicker botId="nova" threadId="open" initialOpen organization load={async () => held} />
          <span className="text-[14px] text-ink-tertiary">Message à Nova</span>
        </div>
      </Section>
      <Section title="Rôle choisi pour le prochain message">
        <div className="flex min-h-11 items-center gap-2 rounded-[22px] border-[0.5px] border-border bg-composer px-2 py-1.5">
          <RolePicker botId="nova" threadId="picked" organization load={async () => held} />
          <span className="text-[14px] text-ink-tertiary">Message à Nova</span>
        </div>
      </Section>
    </>
  );
}

// Batch 4: the routine editor's "Au nom de" field and its coverage preview.
const heldRoles: HeldRole[] = [
  { slug: "reader", name: "Lecture", readOnly: true, explicitOnly: false, reachable: true, can: { read: true, write: false } },
  { ...desk, readOnly: false, explicitOnly: false, reachable: true, can: { read: true, write: true, flow: true } },
  { slug: "full-access", name: "Full Access", readOnly: false, explicitOnly: true, reachable: true, can: { read: true, write: true, routines_run: true, approvals_answer: true, flow: true, sagax: true } },
];
const coverageOf = (refusals: Parameters<typeof routineRoleCoverageAnswer>[0]["refusals"] = [], mandate = ["schedule_create", "status_change", "client_note"]) => ({
  answer: routineRoleCoverageAnswer({ held: heldRoles, mandate, serverProfiles: ["service-desk", "full-access"], refusals, recipe: "morning-pass" }),
});
const tested: RoutineReadinessControl = {
  id: "r1", check: async () => {},
  answer: { ok: true, checkedAt: Date.UTC(2026, 10, 5, 13, 30), checks: [
    { kind: "perspicax", ok: true, code: "ready", line: "" },
    { kind: "flow", ok: true, code: "ready", line: "", params: { kind: "flow" } },
  ] } as RoutineReadinessControl["answer"],
};
const idle: RoutineReadinessControl = { id: "r1", check: async () => {} };

function RoutineRoles() {
  return (
    <>
      <Section title="Au nom de : couverture complète">
        <PanelRows data-gallery-act-as="ok"><RoutineActAsField coverage={coverageOf()} value="service-desk" onChange={() => {}} readiness={tested} /></PanelRows>
      </Section>
      <Section title="Au nom de : couverture partielle">
        <PanelRows data-gallery-act-as="partial"><RoutineActAsField coverage={coverageOf([{ role: "reader", path: "schedule/holidayLists", operation: "Inquire" }], ["schedule_create", "status_change", "custom_step"])} value="reader" onChange={() => {}} readiness={idle} /></PanelRows>
      </Section>
      <Section title="Non choisi : suggestion">
        <PanelRows data-gallery-act-as="suggested"><RoutineActAsField coverage={coverageOf()} value={undefined} onChange={() => {}} /></PanelRows>
      </Section>
    </>
  );
}

// batch 5: the bot panel's Roles tab (?view=tab), first edge opened
const AT = Date.UTC(2026, 10, 5, 19, 3);
const tabBody: RolesTabBody = {
  journal: "perspicax",
  nodes: [
    { slug: "", name: "", calls: 14 },
    { slug: "service-desk", name: "Service Desk", id: "prof-desk", calls: 41 },
    { slug: "full-access", name: "Full Access", id: "prof-full", calls: 6 },
  ],
  edges: [
    { from: "service-desk", to: "", count: 4, history: [
      { at: AT, source: "both", threadId: "th-1", reason: "fallback", refusedTool: "cw_psa_query" },
      { at: AT - 26 * 3_600_000, source: "both", threadId: "th-2", reason: "rule", refusedTool: "cw_psa_query" },
      { at: AT - 50 * 3_600_000, source: "perspicax", tool: "cw_psa_find_schedule_entries" },
    ] },
    { from: "", to: "service-desk", count: 3, history: [] },
    { from: "service-desk", to: "full-access", count: 1, history: [{ at: AT - 4 * 3_600_000, source: "sagax", threadId: "th-3", reason: "switch" }] },
  ],
  missing: [
    { id: "r1", role: desk, permission: { module: "Time & Expense", func: "Time Entry", path: "time/entries", operation: "Add" }, kind: "write", member: "nova", tools: ["cw_psa_log_time"], lastAt: AT - 600_000, count: 3 },
    { id: "r2", role: desk, permission: { module: "Service Desk", func: "Holiday Lists", path: "schedule/holidayLists", operation: "Inquire" }, kind: "read", member: "nova", tools: ["cw_psa_query"], lastAt: AT, count: 4, sentAt: AT + 120_000 },
    { id: "r3", role: { slug: "full-access", name: "Full Access" }, permission: { module: "Companies", func: "Company Maintenance", path: "company/companies", operation: "Edit" }, kind: "write", tools: ["cw_psa_write"], lastAt: AT - 7_200_000, count: 1 },
  ],
};

function OpenFirstEdge() {
  useEffect(() => {
    const edge = document.querySelector<SVGGElement>("[data-role-edge]");
    if (edge && edge.getAttribute("aria-pressed") !== "true") edge.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }, []);
  return null;
}

function Tab() {
  return (
    <div className="w-[380px] self-center rounded-2xl border border-hairline bg-panel">
      <RolesTabView botId="nova" body={tabBody} onOpenThread={() => {}} />
      <OpenFirstEdge />
    </div>
  );
}

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-5" data-gallery={view}>
        {view === "picker" ? <Picker /> : view === "routine" ? <RoutineRoles /> : view === "tab" ? <Tab /> : <Thread />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

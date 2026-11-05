/** Isolated gallery for headless captures of Perspicax roles after #2032/#2033
 * (2026-11-05): no role in the chat. The role lives on Pulsatrix Flow routines
 * ("Au nom de") and on the bot's Roles tab. Not shipped in the app.
 * ?skin=pulsatrix|pulsatrix-light&lang=<code>&view=routine|tab */
import { StrictMode, useEffect, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { RoutineActAsField } from "../components/routines/RoutineActAsField";
import { PanelRows } from "../components/routines/PanelRows";
import type { RoutineReadinessControl } from "../components/routines/RoutineReadiness";
import type { HeldRole } from "../../shared/perspicax-roles";
import { routineRoleCoverageAnswer } from "../../shared/routine-role-coverage";
import { RolesTabView } from "../components/bot-settings/RolesTab";
import type { RolesTabBody } from "../../shared/role-graph";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
export const view = params.get("view") ?? "routine";

const desk = { slug: "service-desk", name: "Service Desk" };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{title}</h2>
      {children}
    </section>
  );
}

// Flow routine editor: "Au nom de" field and its coverage preview.
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
      <Section title="Sans recette Flow : aucun champ">
        <PanelRows data-gallery-act-as="none">
          <RoutineActAsField
            coverage={{ answer: routineRoleCoverageAnswer({ held: heldRoles, mandate: [], serverProfiles: [], refusals: [], recipe: undefined }) }}
            value={undefined}
            onChange={() => {}}
          />
        </PanelRows>
      </Section>
    </>
  );
}

// Bot panel Roles tab (?view=tab)
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
        {view === "tab" ? <Tab /> : <RoutineRoles />}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

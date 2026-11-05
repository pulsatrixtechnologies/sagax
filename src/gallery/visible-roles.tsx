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

function Gallery() {
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-xl flex-col gap-5" data-gallery={view}>
        <Thread />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

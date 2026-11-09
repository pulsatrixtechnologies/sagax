// Dev gallery for the approval cards (chat card + composer panel), like
// src/gallery/mascot-catalog.html. Served by Vite in dev at /src/gallery/approval-cards.html;
// not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ApprovalCard } from "@/components/ApprovalCard";
import { PendingApprovalBox, pendingApprovals } from "@/components/PendingApproval";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const BOT = { id: "preview-bot", name: "Quasar", color: "green", soul: "" } as unknown as Bot;

const scheduleInput = {
  conditions: "member/identifier='amartin' and dateStart >= [2026-10-02T04:00:00Z] and dateStart < [2026-10-04T04:00:00Z]",
  fields: "id,dateStart,dateEnd,member/identifier,objectId,type/name,status/name",
  orderBy: "dateStart asc",
  pageSize: 100,
};
const writeInput = { resource: "time/entries", operation: "create", body: { chargeToType: "ServiceTicket", chargeToId: 287826, member: { identifier: "amartin" }, timeStart: "2026-10-02T13:00:00Z", timeEnd: "2026-10-02T14:00:00Z", notes: "Suivi" } };

function card(id: string, tool: string, input: unknown): Message {
  const json = JSON.stringify(input);
  return {
    id,
    role: "bot",
    kind: "options",
    at: 1,
    card: {
      title: "Approval needed",
      subtitle: json.length > 200 ? `${json.slice(0, 199)}…` : json,
      toolInput: JSON.stringify(input),
      options: ["Allow", "Deny"],
      requestId: `req-${id}`,
      tool,
      allowSession: true,
    } as Message["card"],
  } as Message;
}

const MESSAGES = [
  card("a", "mcp__perspicax_example_flow__acme_desk_query_schedule", scheduleInput),
  card("b", "mcp__perspicax_example_flow__acme_desk_write", writeInput),
  card("c", "mcp__claude_ai_Acme_Desk__acme_desk__query", { resource: "service/tickets", conditions: "status/name='Nouveau'", pageSize: 25 }),
  memoryCard(),
];

/** #2641: a memory write goes through the same card and offers Always allow. */
function memoryCard(): Message {
  const base = card("m", "mcp__perspicax__memory_save", { topic: "preferences", content: "Weekly report goes out Friday at 4 pm, short list, no table." });
  return { ...base, card: { ...base.card!, ownerRule: { tool: "mcp__perspicax__memory_save", scope: {}, description: "Save memories with Perspicax" } } } as Message;
}
const settledCard = card("d", "mcp__perspicax_example_flow__acme_desk_action", { action: "delete", resource: "time/entries", id: 991 });
const ruleCard = card("e", "mcp__perspicax_example_flow__acme_desk_query", { resource: "company/companies", pageSize: 25 });
// Receipt of an "Always allow" answer: its details read « Toujours permis » in French
const SETTLED = [
  { ...settledCard, card: { ...settledCard.card!, answered: "allow" } } as Message,
  { ...ruleCard, card: { ...ruleCard.card!, answered: "allow", ruleSaved: { id: "rule_1", behavior: "allow", description: "View companies in Acme Desk (companies)" } } } as Message,
];

function Preview() {
  const approvals = pendingApprovals(MESSAGES);
  return (
    <div className="min-h-screen bg-app p-8 text-ink">
      <div className="mx-auto flex max-w-[840px] flex-col gap-4">
        {MESSAGES.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
        <div className="mt-6">
          <PendingApprovalBox approvals={approvals} threadId="t" botFor={() => BOT} onCancelTurn={() => {}} />
        </div>
        <div className="mt-2 text-[12px] text-ink-secondary">Settled:</div>
        {SETTLED.map((message) => <ApprovalCard key={message.id} bot={BOT} message={message} />)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DesktopCapabilitiesProvider>
      <StoreProvider>
        <Preview />
      </StoreProvider>
    </DesktopCapabilitiesProvider>
  </StrictMode>,
);

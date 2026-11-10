// Dev gallery for every card that waits for the person (#3471): each kind
// with its one quiet skip at the end of its top row, then folded as skipped
// and as expired, beside the conforming neighbour (the compact approval card
// of #3414). The pinned card over the composer holds them one at a time.
// Served by Vite in dev at /src/gallery/waiting-cards.html; not part of the
// packaged app. ?lang=fr|en&skin=<id>&kind=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { ApprovalCard } from "@/components/ApprovalCard";
import { AttentionCard } from "@/components/AttentionCard";
import { OptionCard } from "@/components/OptionCard";
import { PendingApprovalBox, pendingApprovals } from "@/components/PendingApproval";
import { ProactiveChoiceCard } from "@/components/ProactiveChoiceCard";
import { QuestionCard } from "@/components/QuestionCard";
import { PinnedWaitingCard, usePinnedWaiting } from "@/components/Composer.tsx-parts/PinnedWaitingCard";
import { pendingRequests } from "@/lib/pending-question";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, type Bot, type Message } from "@/state/store";
import type { PersonAttentionCard } from "../../shared/person-attention";
import "../styles.css";

const params = new URLSearchParams(location.search);
const FR = params.get("lang") !== "en";
await loadLocale(FR ? "fr" : "en");
applySkin((params.get("skin") ?? "pulsatrix") as SkinId);
const ONLY = params.get("kind");

const BOT = { id: "preview-bot", name: "Atlas", color: "green", soul: "", threadId: "t", messages: [], tasks: [] } as unknown as Bot;

const NEIGHBOUR = {
  id: "neighbour", role: "bot", kind: "options", at: 1,
  card: {
    title: "Schedule routine",
    subtitle: FR
      ? "Chaque jour de semaine à 9 h, revoir les billets ouverts et publier un court résumé.\n\nS'exécute sur : cet ordinateur · 30 min max"
      : "Every weekday at 9:00, review the open tickets and post a short summary.\n\nRuns on: this computer · 30 min max",
    options: FR ? ["Planifier", "Annuler"] : ["Schedule", "Cancel"],
    requestId: "neighbour",
    tool: "schedule_routine",
    routineRequest: {
      version: 1, requestId: "neighbour", botId: "preview-bot", threadId: "t", createdAt: 1,
      operation: { action: "create", routine: { name: FR ? "Revue des billets" : "Ticket review", instructions: "Review the open tickets.", schedule: { type: "daily", time: "09:00", weekdays: [1, 2, 3, 4, 5] }, runOn: "maus", durationMinutes: 30 } },
    },
  },
} as unknown as Message;

function approval(id: string, more: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id, role: "bot", kind: "options", at: 1,
    card: { title: "Approval needed", subtitle: "ls ~/reports", toolInput: JSON.stringify({ command: "ls ~/reports" }), options: ["Allow", "Deny"], requestId: `req-${id}`, tool: "Bash", allowSession: true, ...more },
  } as unknown as Message;
}

function question(id: string, options: string[], more: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id, role: "bot", kind: "options", at: 2,
    card: {
      title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question",
      questionRequest: { version: 1, questions: [{ question: options.length ? (FR ? "Je mets en pause les deux webhooks ?" : "Do I pause the two webhooks?") : (FR ? "Pour combien de temps je les mets en pause ?" : "For how long do I pause them?"), options: options.map((label) => ({ label })) }] },
      ...more,
    },
  } as unknown as Message;
}

const proposal = (more: Partial<NonNullable<Message["card"]>> = {}): Message => ({
  id: "proposal", role: "bot", kind: "options", at: 3,
  card: { title: FR ? "Répondre au courriel du fournisseur sur la livraison" : "Reply to the supplier's mail about the delivery", subtitle: FR ? "Suggestion du jour. Je m'en occupe ?" : "Today's suggestion. Shall I handle it?", options: FR ? ["Fais-le", "Pas maintenant"] : ["Do it", "Not now"], proactiveProposal: { id: "pp-1" }, ...more },
}) as unknown as Message;

const CHOICE: NonNullable<Message["card"]> = {
  title: FR ? "Recevoir les alertes de répartition ?" : "Receive Dispatch alerts?",
  subtitle: FR ? "Billets sans technicien assigné (toutes les heures). Sur Atlas, seulement si tu dis oui." : "Tickets with no technician assigned (every hour). On Atlas, only if you say yes.",
  options: FR ? ["Oui", "Pas maintenant"] : ["Yes", "Not now"],
  proactiveProposal: { id: "pp-choice" },
  proactiveChoice: { domain: "dispatch", label: FR ? "Répartition" : "Dispatch", botName: "Atlas", watches: [{ id: "unassigned", label: FR ? "Billets sans technicien assigné" : "Tickets with no technician assigned", cadence: FR ? "toutes les heures" : "every hour", on: true, tools: [] }] },
} as NonNullable<Message["card"]>;

function attention(kind: "handoff" | "routine", more: Partial<PersonAttentionCard> = {}): PersonAttentionCard {
  return {
    kind: "question", botId: "preview-bot", botName: "Atlas", threadId: `${kind}-work`, sourceMessageId: "s1",
    ...(kind === "routine" ? { routineName: FR ? "Vérification du matin" : "Morning check", routineRunId: "run-1" } : { threadTitle: FR ? "Travail confié" : "Handed-over work", openedBy: { botId: "nova", name: "Nova" } }),
    items: [{ text: kind === "routine" ? (FR ? "Je ferme le billet de la sauvegarde qui a réussi cette nuit ?" : "Do I close the ticket of the backup that worked last night?") : (FR ? "Quel site je traite en premier ?" : "Which site do I handle first?") }],
    ...more,
  };
}

const noop = () => {};
const noopAsync = async () => {};

function Pair({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  if (ONLY && ONLY !== id) return null;
  return (
    <section data-variant={id} className="grid grid-cols-2 gap-6 p-4">
      <div className="flex flex-col items-start gap-2">
        <div className="text-[11px] text-ink-tertiary">{FR ? "Voisine conforme : carte d'approbation (#3414)" : "Conforming neighbour: approval card (#3414)"}</div>
        <ApprovalCard bot={{ name: "Atlas" }} message={NEIGHBOUR} />
      </div>
      <div className="flex flex-col items-start gap-2">
        <div className="text-[11px] text-ink-tertiary">{label}</div>
        {children}
      </div>
    </section>
  );
}

function Pinned({ messages }: { messages: Message[] }) {
  const approvals = pendingApprovals(messages.filter((message) => message.card?.tool));
  const questions = messages.filter((message) => message.card?.questionRequest);
  const pinned = usePinnedWaiting(approvals, questions, pendingRequests(messages), []);
  return <div className="w-full max-w-[600px]"><PinnedWaitingCard pinned={pinned} threadId="t" bot={BOT} botFor={() => BOT} nameFor={() => "Atlas"} onCancelTurn={noop} /></div>;
}

const routineRow = (more: Partial<PersonAttentionCard> = {}): Message => ({ id: "routine-row", role: "bot", kind: "text", at: 4, text: "", attention: attention("routine", more) }) as unknown as Message;

function Preview() {
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex max-w-[1240px] flex-col">
        <Pair id="approval" label={FR ? "Approbation, en attente" : "Approval, waiting"}>
          <div className="w-full max-w-[600px]"><PendingApprovalBox approvals={pendingApprovals([approval("a")])} threadId="t" botFor={() => BOT} onCancelTurn={noop} /></div>
        </Pair>
        <Pair id="approval-folded" label={FR ? "Approbation, passée puis expirée" : "Approval, skipped then expired"}>
          <ApprovalCard bot={BOT} message={approval("a2", { answered: "skipped", skipped: true })} />
          <ApprovalCard bot={BOT} message={approval("a3", { expired: true })} />
        </Pair>
        <Pair id="choice" label={FR ? "Question à choix" : "Choice question"}>
          <QuestionCard threadId="t" bot={BOT} message={question("c", FR ? ["Oui, mets-les en pause", "Non, garde-les actifs"] : ["Yes, pause them", "No, keep them on"])} />
        </Pair>
        <Pair id="free-text" label={FR ? "Question à réponse libre" : "Free-text question"}>
          <QuestionCard threadId="t" bot={BOT} message={question("f", [])} />
        </Pair>
        <Pair id="question-folded" label={FR ? "Question, passée puis expirée" : "Question, skipped then expired"}>
          <QuestionCard threadId="t" bot={BOT} message={question("c2", ["A", "B"], { answered: "skipped", skipped: true })} />
          <QuestionCard threadId="t" bot={BOT} message={question("f2", [], { expired: true })} />
        </Pair>
        <Pair id="handoff" label={FR ? "Question d'un travail confié" : "Question from handed-over work"}>
          <div className="w-full max-w-[600px]"><AttentionCard card={attention("handoff")} bot={BOT} onReply={noopAsync} onSkip={noopAsync} /></div>
        </Pair>
        <Pair id="routine" label={FR ? "Question laissée par une routine" : "Question left by a routine run"}>
          <div className="w-full max-w-[600px]"><AttentionCard card={attention("routine")} bot={BOT} onReply={noopAsync} onSkip={noopAsync} /></div>
        </Pair>
        <Pair id="words-folded" label={FR ? "Question en mots, passée puis expirée" : "Question in words, skipped then expired"}>
          <div className="flex w-full max-w-[600px] flex-col gap-2">
            <AttentionCard card={attention("handoff", { handledAt: 2, closed: "skipped" })} bot={BOT} onReply={noopAsync} />
            <AttentionCard card={attention("routine", { handledAt: 2, closed: "expired" })} bot={BOT} onReply={noopAsync} />
          </div>
        </Pair>
        <Pair id="proposal" label={FR ? "Proposition" : "Proposal"}>
          <OptionCard botId="preview-bot" threadId="t" message={proposal()} />
        </Pair>
        <Pair id="proposal-choice" label={FR ? "Carte de choix d'un domaine" : "Watch domain choice card"}>
          <ProactiveChoiceCard card={CHOICE} onAnswer={noop} onNever={noopAsync} onSkip={noop} />
        </Pair>
        <Pair id="proposal-folded" label={FR ? "Proposition, passée puis expirée" : "Proposal, skipped then expired"}>
          <OptionCard botId="preview-bot" threadId="t" message={proposal({ answered: "skipped", skipped: true, options: [] })} />
          <ProactiveChoiceCard card={{ ...CHOICE, expired: true }} onAnswer={noop} onNever={noopAsync} />
        </Pair>
        <Pair id="pinned" label={FR ? "Carte épinglée sur le compositeur, 1 de 3" : "Pinned over the composer, 1 of 3"}>
          <Pinned messages={[routineRow(), question("pq", FR ? ["Oui", "Non"] : ["Yes", "No"]), approval("pa")]} />
        </Pair>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <DesktopCapabilitiesProvider>
        <Preview />
      </DesktopCapabilitiesProvider>
    </StoreProvider>
  </StrictMode>,
);

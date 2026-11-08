// Dev gallery for every interactive question (the bot's ask, AskUserQuestion,
// a flat ask_person card, a widget choice), each under a bot bubble the way a
// chat shows it. Served by Vite in dev at /src/gallery/question-cards.html;
// not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { OptionCard } from "@/components/OptionCard";
import { ChatStaleBanner } from "@/components/ChatErrorBanner";
import { QuestionCard } from "@/components/QuestionCard";
import { WidgetMessage } from "@/components/widget/WidgetMessage";
import { loadLocale } from "@/lib/i18n";
import { teamMemorySettled } from "@/lib/team-memory-settled";
import { applySkin, type SkinId } from "@/lib/skins";
import { CHAT_BUBBLE_WIDTH_CLASS } from "@/lib/chat-bubble-width";
import { StoreProvider, type Message } from "@/state/store";
import { WIDGET_SAMPLES } from "../../shared/widget-samples";
import { parseWidgetInput } from "../../shared/widget";
import type { AskQuestion } from "../../shared/ask-question";
import { offerCard } from "../../server/feedback/flow";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "midnight") as SkinId);

const WEBHOOKS: AskQuestion = {
  question: "Je mets en pause mes deux webhooks ?",
  options: [{ label: "Oui, mets-les en pause" }, { label: "Non, garde-les actifs" }],
};

function ask(id: string, questions: AskQuestion[], more: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id, role: "bot", kind: "options", at: 1,
    card: { title: "", subtitle: "", options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions }, ...more },
  } as Message;
}

function flat(id: string, more: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id, role: "bot", kind: "options", at: 1,
    card: { title: "Je mets en pause mes deux webhooks ?", subtitle: "", options: ["Oui, mets-les en pause", "Non, garde-les actifs"], requestId: `req-${id}`, ...more },
  } as Message;
}

// Answered here, settled elsewhere (409): the optimistic local answer, then
// the server's real outcome merged on top the way the reducer does it.
function settledElsewhere(id: string, outcome: string): Message {
  const settled = teamMemorySettled({ status: 409, body: { code: "team_memory_settled", outcome, settledBy: "Dana" } });
  return ask(id, [WEBHOOKS], { answered: "answer", answeredText: "Oui, mets-les en pause", ...settled?.card });
}

const widget = parseWidgetInput(WIDGET_SAMPLES.dinnerChoice);

function Bubble({ children }: { children: ReactNode }) {
  return <div className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Row({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section data-variant={id} className="flex flex-col items-start gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      <Bubble>
        <p>J'ai trouvé deux webhooks actifs sur ce compte : « Billets entrants » et « Facturation ».</p>
        <p className="mt-2">Ils envoient encore des appels toutes les cinq minutes.</p>
      </Bubble>
      {children}
    </section>
  );
}

function Preview() {
  const bot = { name: "Quasar" };
  const lang = params.get("lang") === "en" ? "en" : "fr";
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col">
        <Row id="feedback-offer" label="Offre de signalement (Feedback, #2618)">
          <OptionCard botId="preview-bot" threadId="t" message={{ id: "fb", role: "bot", kind: "options", at: 1, card: { ...offerCard(lang, lang === "fr" ? "ça marche toujours pas, le bouton Enregistrer ne fait rien" : "it still doesn't work, the Save button does nothing"), requestId: "fb-offer", requestType: "question" } } as Message} />
        </Row>
        <Row id="ask-single" label="AskUserQuestion, un choix">
          <QuestionCard threadId="t" bot={bot} message={ask("a", [WEBHOOKS])} />
        </Row>
        <Row id="ask-answered" label="AskUserQuestion, répondue">
          <QuestionCard threadId="t" bot={bot} message={ask("b", [WEBHOOKS], { answered: "answer", answeredText: "Oui, mets-les en pause" })} />
        </Row>
        <Row id="ask-409-allow" label="Réglée ailleurs (409), acceptée par quelqu'un d'autre">
          <QuestionCard threadId="t" bot={bot} message={settledElsewhere("h409a", "allowed-once")} />
        </Row>
        <Row id="ask-409-gone" label="Réglée ailleurs (409), entrée disparue">
          <QuestionCard threadId="t" bot={bot} message={settledElsewhere("h409g", "unavailable")} />
        </Row>
        <section data-variant="chat-offline" className="flex flex-col items-start gap-2 p-4">
          <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">Chat hors ligne (navigateur hors ligne seulement)</div>
          <ChatStaleBanner />
        </section>
        <Row id="ask-multi" label="Choix multiples">
          <QuestionCard threadId="t" bot={bot} message={ask("c", [{ question: "Quels webhooks je mets en pause ?", multiSelect: true, options: [{ label: "Billets entrants" }, { label: "Facturation" }, { label: "Alertes RMM" }] }])} />
        </Row>
        <Row id="ask-free" label="Réponse libre">
          <QuestionCard threadId="t" bot={bot} message={ask("d", [{ question: "Pour combien de temps je les mets en pause ?", options: [] }])} />
        </Row>
        <Row id="ask-set" label="Plusieurs questions">
          <QuestionCard threadId="t" bot={bot} message={ask("e", [{ ...WEBHOOKS, header: "Webhooks" }, { question: "Je préviens Wren ?", header: "Wren", options: [{ label: "Oui" }, { label: "Non" }] }])} />
        </Row>
        <Row id="page-target" label="Cible de publication (#2048)">
          <QuestionCard
            threadId="t"
            bot={{ id: "preview-bot", name: "Quasar" }}
            message={ask("pt", [{
              question: "Where should I publish this?",
              custom: false,
              options: [
                { id: "sagax_page", label: "Sagax page", description: "Shareable link the person publishes; others can open it outside Sagax.", icon: "file-text" },
                { id: "sagax_artifact", label: "Sagax artifact", description: "Kept inside Sagax for this person; can refresh itself, no public link.", icon: "layout-dashboard" },
                { id: "claude_artifact", label: "Claude artifact", description: "Official claude.ai artifact through the person's own Claude account.", icon: "sparkles" },
              ],
            }], {
              pageTargetChoice: {
                version: 1,
                targets: [
                  { id: "sagax_page", tool: "propose_page", name: "Sagax page", icon: "file-text" },
                  { id: "sagax_artifact", tool: "save_artifact", name: "Sagax artifact", icon: "layout-dashboard" },
                  { id: "claude_artifact", tool: "claude_artifact", name: "Claude artifact", icon: "sparkles" },
                ],
              },
            })}
          />
        </Row>
        <Row id="person-single" label="ask_person (carte simple)">
          <OptionCard botId="preview-bot" threadId="t" message={flat("f")} />
        </Row>
        <Row id="person-answered" label="ask_person, répondue">
          <OptionCard botId="preview-bot" threadId="t" message={flat("g", { answered: "Non, garde-les actifs", answeredText: "Non, garde-les actifs" })} />
        </Row>
        <Row id="suggestion-card" label="Suggestion du jour (#2694, avis)">
          <OptionCard botId="preview-bot" threadId="t" message={{ id: "s", role: "bot", kind: "options", at: 1, card: { title: "Répondre à Carla pour le contrat à signer", subtitle: "Suggestion du jour, gratuite. D'après Outlook / read_mail, 2026-11-08. Je m'en occupe ?", options: ["Fais-le", "Pas maintenant"], proactiveProposal: { id: "pp-s" } } } as Message} />
        </Row>
        <Row id="suggestion-card-less" label="Suggestion du jour, répondue avec « Moins de ça »">
          <OptionCard botId="preview-bot" threadId="t" message={{ id: "s2", role: "bot", kind: "options", at: 1, card: { title: "Relancer Paul pour la facture", subtitle: "Suggestion du jour, gratuite. Je m'en occupe ?", options: ["Fais-le", "Pas maintenant"], proactiveProposal: { id: "pp-s2" }, answered: "Pas maintenant", answeredText: "Pas maintenant", feedback: "less" } } as Message} />
        </Row>
        {widget.ok && (
          <Row id="widget-choice" label="Widget à choix">
            <WidgetMessage botId="preview-bot" threadId="t" message={{ id: "w", role: "bot", kind: "widget", at: 1, text: "", widget: { v: 1, root: widget.value } } as Message} />
          </Row>
        )}
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

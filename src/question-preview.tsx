// Dev gallery for every interactive question (the bot's ask, AskUserQuestion,
// a flat ask_person card, a widget choice), each under a bot bubble the way a
// chat shows it. Served by Vite in dev at /dev/previews/question-preview.html;
// not part of the packaged app. ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { OptionCard } from "@/components/OptionCard";
import { QuestionCard } from "@/components/QuestionCard";
import { WidgetMessage } from "@/components/widget/WidgetMessage";
import { setLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { CHAT_BUBBLE_WIDTH_CLASS } from "@/lib/chat-bubble-width";
import { StoreProvider, type Message } from "@/state/store";
import { WIDGET_SAMPLES } from "../shared/widget-samples";
import { parseWidgetInput } from "../shared/widget";
import type { AskQuestion } from "../shared/ask-question";
import "./styles.css";

const params = new URLSearchParams(location.search);
setLocale(params.get("lang") ?? "fr");
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
  const bot = { name: "Cryptic" };
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col">
        <Row id="ask-single" label="AskUserQuestion, un choix">
          <QuestionCard threadId="t" bot={bot} message={ask("a", [WEBHOOKS])} />
        </Row>
        <Row id="ask-answered" label="AskUserQuestion, répondue">
          <QuestionCard threadId="t" bot={bot} message={ask("b", [WEBHOOKS], { answered: "answer", answeredText: "Oui, mets-les en pause" })} />
        </Row>
        <Row id="ask-multi" label="Choix multiples">
          <QuestionCard threadId="t" bot={bot} message={ask("c", [{ question: "Quels webhooks je mets en pause ?", multiSelect: true, options: [{ label: "Billets entrants" }, { label: "Facturation" }, { label: "Alertes RMM" }] }])} />
        </Row>
        <Row id="ask-free" label="Réponse libre">
          <QuestionCard threadId="t" bot={bot} message={ask("d", [{ question: "Pour combien de temps je les mets en pause ?", options: [] }])} />
        </Row>
        <Row id="ask-set" label="Plusieurs questions">
          <QuestionCard threadId="t" bot={bot} message={ask("e", [{ ...WEBHOOKS, header: "Webhooks" }, { question: "Je préviens Melonie ?", header: "Melonie", options: [{ label: "Oui" }, { label: "Non" }] }])} />
        </Row>
        <Row id="person-single" label="ask_person (carte simple)">
          <OptionCard botId="preview-bot" threadId="t" message={flat("f")} />
        </Row>
        <Row id="person-answered" label="ask_person, répondue">
          <OptionCard botId="preview-bot" threadId="t" message={flat("g", { answered: "Non, garde-les actifs", answeredText: "Non, garde-les actifs" })} />
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

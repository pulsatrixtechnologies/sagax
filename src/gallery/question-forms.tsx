// #4490: dev gallery of the cards a bot writes as a form or a checklist,
// beside the badly made cards they replace (one block of text asking seven
// things, a list of drafts in prose). Served by Vite in dev at
// /src/gallery/question-forms.html; not part of the packaged app.
// ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QuestionCard } from "@/components/QuestionCard";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { CHAT_BUBBLE_WIDTH_CLASS } from "@/lib/chat-bubble-width";
import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { formatQuestionAnswers, type AskQuestion } from "../../shared/ask-question";
import { parseAskChoiceInput } from "../../shared/options-card";
import { BAD_DRAFTS_CARD, BAD_TIME_CARD, GOOD_DRAFTS_CARD, GOOD_TIME_CARD } from "../../shared/card-rules.fixtures";
import "../styles.css";

const params = new URLSearchParams(location.search);
const FR = params.get("lang") !== "en";
await loadLocale(FR ? "fr" : "en");
applySkin((params.get("skin") ?? "pulsatrix") as SkinId);

// what the bot writes is in the person's language: the French cards are
// the same fixtures, in French
const TIME_FR = {
  title: "Entrées de temps à confirmer (routine Feuille de temps du soir)",
  question: "Sept entrées tirées du calendrier d'aujourd'hui. Confirme chacune.",
  questions: [
    { question: "Standup avec l'équipe acme, 9 h à 9 h 15", kind: "choice", options: ["Fait", "Pas fait", "Déplacer à demain"] },
    { question: "Revue de design avec Ada, 10 h : combien de temps ?", kind: "duration" },
    { question: "Appel sur la migration Nimbus : quel billet ?", kind: "text" },
    { question: "Appel sur la migration Nimbus : combien de temps ?", kind: "duration" },
    { question: "Reçu de taxi de mardi : code de dépense", kind: "choice", options: ["Déplacement", "Repas", "Bureau"] },
    { question: "Résumé hebdo par courriel : facturable ?", kind: "yes_no" },
    { question: "Vérification des sauvegardes : déplacer à vendredi ?", kind: "yes_no", optional: true },
  ],
};
const DRAFTS_FR = {
  title: "Publications de ce soir (routine Publications du soir)",
  question: "Six brouillons sont prêts. Décoche ceux que tu ne veux pas publier.",
  items: [
    { label: "Notes de version Nimbus 2.4", detail: "Nimbus 2.4 est sorti : synchro plus rapide, barre latérale plus calme et trois correctifs tirés de vos rapports. Merci pour chaque bogue envoyé." },
    { label: "Fil sur la rencontre acme", detail: "Jeudi prochain, on est à la rencontre acme. Venez nous voir : démo du mode hors ligne et autocollants." },
    { label: "Réponse sur le mode hors ligne", detail: "Oui : le mode hors ligne garde tes 30 derniers jours et synchronise au retour en ligne." },
    { label: "Clip de la nouvelle barre latérale", detail: "Quinze secondes de la nouvelle barre latérale : glisser pour réordonner, épingler l'essentiel.", checked: false },
    { label: "Merci aux testeurs bêta", detail: "Deux cents d'entre vous ont testé la 2.4 avant tout le monde. Merci, ça paraît." },
    { label: "Rappel de maintenance", detail: "Vendredi de 22 h à 23 h, la synchro fait une pause pour une mise à niveau. Rien à faire de ton côté." },
  ],
  actions: ["Publier la sélection", "Sauter ce soir"],
};
const BAD_TIME_FR = [
  "J'ai préparé les entrées de ce soir à partir de ton calendrier et de ta boîte. Pour chaque ligne, dis-moi quoi faire :",
  "1. Standup avec l'équipe acme, 9 h à 9 h 15 : fait, pas fait ou déplacé à demain ?",
  "2. Revue de design avec Ada, 10 h : pas d'heure de fin. Combien de temps ?",
  "3. Appel sur la migration Nimbus : sur quel billet, et pour combien de temps ?",
  "4. Reçu de taxi de mardi : quel code de dépense ?",
  "5. Résumé hebdo par courriel : facturable, et pour combien de temps ?",
  "6. Dîner-conférence : fait ou pas fait ?",
  "7. Vérification des sauvegardes : déplacer à vendredi ?",
  "Réponds avec une ligne par élément.",
].join("\n");
const BAD_DRAFTS_FR = [
  "Six brouillons sont prêts pour ce soir :",
  "1. Notes de version Nimbus 2.4, avec les trois correctifs",
  "2. Fil sur la rencontre acme la semaine prochaine",
  "3. Réponse à la question sur le mode hors ligne",
  "4. Court clip de la nouvelle barre latérale",
  "5. Publication de remerciement aux testeurs bêta",
  "6. Rappel de la fenêtre de maintenance de vendredi",
  "Tout est coché. Publier la sélection les envoie. Sauter ce soir n'envoie rien.",
].join("\n");

function rows(input: unknown): AskQuestion[] {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error(`gallery fixture refused: ${parsed.ok ? "no rows" : parsed.error}`);
  return parsed.value.questions;
}

const time = FR ? TIME_FR : GOOD_TIME_CARD;
const drafts = FR ? DRAFTS_FR : GOOD_DRAFTS_CARD;
const TIME = rows(time);
const DRAFTS = rows(drafts);
const KINDS = rows({
  question: FR ? "Un rang par type de réponse." : "One row per kind of answer.",
  questions: [
    { question: FR ? "Quelle salle ?" : "Which room?", kind: "choice", options: FR ? ["Nord", "Sud", "Ouest"] : ["North", "South", "West"] },
    { question: FR ? "Quels équipements ?" : "Which equipment?", kind: "multi", options: FR ? ["Écran", "Caméra", "Tableau"] : ["Screen", "Camera", "Whiteboard"] },
    { question: FR ? "Repas inclus ?" : "Lunch included?", kind: "yes_no" },
    { question: FR ? "Durée prévue" : "Planned length", kind: "duration" },
    { question: FR ? "Heure de début" : "Start time", kind: "time" },
    { question: FR ? "Date" : "Date", kind: "date" },
    { question: FR ? "Nombre d'invités" : "Guests", kind: "number" },
    { question: FR ? "Nom de la rencontre" : "Meeting name", kind: "text" },
    { question: FR ? "Notes pour l'équipe" : "Notes for the team", kind: "long_text", optional: true },
  ],
});

// #4967: a follow-up row with `when` stays hidden until the option that
// triggers it is picked; same card as `f-when` in ios/App/FormCardsPreview.json
const WHEN = rows({
  question: FR ? "Choisis la durée. On la demande seulement si tu l'entres toi-même." : "Pick how long it lasted. The length is asked only when you enter it yourself.",
  questions: [
    { question: FR ? "Revue de design avec Ada : combien de temps ?" : "Design review with Ada: how long?", header: FR ? "Durée" : "Duration", kind: "choice", options: FR ? [{ label: "Selon l'horaire", description: "Durée du calendrier" }, { label: "Je l'entre", description: "À saisir ci-dessous" }, { label: "Ne pas facturer", description: "Aucune entrée" }] : [{ label: "As scheduled", description: "Calendar length" }, { label: "Enter it", description: "Type it below" }, { label: "Do not bill", description: "No entry" }] },
    { question: FR ? "Durée réelle" : "Real length", kind: "duration", when: { question: FR ? "Durée" : "Duration", option: FR ? "Je l'entre" : "Enter it" } },
    { question: FR ? "Facturable ?" : "Billable?", kind: "yes_no" },
  ],
});

function card(id: string, questions: AskQuestion[], title: string, subtitle: string, more: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id, role: "bot", kind: "options", at: 1,
    card: { title, subtitle, options: [], requestId: `req-${id}`, requestType: "question", questionRequest: { version: 1, questions }, ...more },
  } as Message;
}

const TIME_ANSWER = formatQuestionAnswers(TIME, [[TIME[0]!.options[0]!.label], ["90 min"], ["4512"], ["45 min"], [TIME[4]!.options[0]!.label], ["yes"], []]);
const DRAFTS_ANSWER = formatQuestionAnswers(DRAFTS, [DRAFTS[0]!.options.filter((_, index) => index !== 3 && index !== 1).map((option) => option.label)], drafts.actions[0]);

/** The reference app's question card, built from its own measured styles
 * (app.asar, read only, #4490): bubble surface 12px padding, 16px corners,
 * 10px gap; the prompt 14/20 semibold; flat rows 7px padding, 16px corners,
 * 4px gap; a 24px key with 8px corners, a hairline and 12/16 medium type,
 * the picked key in the accent fill; the label 14/20; Submit a filled pill,
 * 8px by 16px, 14/20 medium. Colours are this skin's tokens (the reference's
 * own palette is not ours to copy). */
function ReferenceCard({ prompt, options, picked = [], multi = false }: { prompt: string; options: string[]; picked?: string[]; multi?: boolean }) {
  return (
    <div data-reference-card="" className="flex w-full flex-col gap-[10px] rounded-[16px] bg-card p-3 text-ink">
      <p className="m-0 text-[14px] font-semibold leading-5">{prompt}</p>
      <div className="flex flex-col gap-px">
        {options.map((label, index) => {
          const on = picked.includes(label);
          return (
            <div key={label} className="flex items-start gap-1 rounded-[16px] p-[7px]">
              <span className={`inline-flex size-6 shrink-0 items-center justify-center rounded-[8px] border-[0.5px] text-[12px] font-medium leading-4 ${on ? "border-ink/20 bg-accent text-accent-ink" : "border-ink/15 bg-ink/[0.06] text-ink-secondary"}`}>{String.fromCharCode(65 + index)}</span>
              <span className="px-1.5 pt-0.5 text-[14px] leading-5">{label}</span>
            </div>
          );
        })}
      </div>
      {multi && (
        <div className="flex justify-end">
          <span className="rounded-full bg-ink px-4 py-2 text-[14px] font-medium leading-5 text-app">Submit</span>
        </div>
      )}
    </div>
  );
}

function SideBySide({ id, label, reference, ours }: { id: string; label: string; reference: ReactNode; ours: ReactNode }) {
  return (
    <section data-gallery-sample={id} className="flex flex-col gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="grid grid-cols-2 items-start gap-4">
        <div className="flex flex-col gap-1"><div className="text-[11px] text-ink-tertiary">{FR ? "Référence (styles mesurés)" : "Reference (measured styles)"}</div>{reference}</div>
        <div className="flex flex-col gap-1"><div className="text-[11px] text-ink-tertiary">Sagax</div>{ours}</div>
      </div>
    </section>
  );
}

function Bubble({ children }: { children: ReactNode }) {
  return <div className={`rounded-[18px] bg-card px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Sample({ id, label, lead, children }: { id: string; label: string; lead: string; children: ReactNode }) {
  return (
    <section data-gallery-sample={id} className="flex flex-col items-start gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      <Bubble><p>{lead}</p></Bubble>
      <div className="w-full">{children}</div>
    </section>
  );
}

function Preview() {
  const bot = { name: "Nimbus" };
  const timeLead = FR ? "Voici les entrées de temps de ce soir." : "Here are tonight's time entries.";
  const draftsLead = FR ? "Les publications de ce soir sont prêtes." : "Tonight's posts are ready.";
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto flex max-w-[1180px] flex-col">
        <SideBySide
          id="side-by-side-single"
          label={FR ? "Une question, côte à côte" : "One question, side by side"}
          reference={<ReferenceCard prompt={FR ? "Quelle salle ?" : "Which room?"} options={FR ? ["Nord", "Sud", "Ouest"] : ["North", "South", "West"]} picked={[FR ? "Sud" : "South"]} />}
          ours={<QuestionCard threadId="t" bot={bot} message={card("sbs1", [{ question: FR ? "Quelle salle ?" : "Which room?", options: (FR ? ["Nord", "Sud", "Ouest"] : ["North", "South", "West"]).map((label) => ({ label })) }], "", "")} />}
        />
        <SideBySide
          id="side-by-side-form"
          label={FR ? "Plusieurs choses à décider, côte à côte" : "Several things to decide, side by side"}
          reference={<div className="flex flex-col gap-2">
            <ReferenceCard prompt={TIME[0]!.question} options={TIME[0]!.options.map((option) => option.label)} />
            <ReferenceCard prompt={TIME[4]!.question} options={TIME[4]!.options.map((option) => option.label)} multi />
          </div>}
          ours={<QuestionCard threadId="t" bot={bot} message={card("sbs2", [TIME[0]!, TIME[1]!, TIME[4]!, TIME[5]!], time.title, time.question)} />}
        />
      </div>
      <div className="mx-auto flex max-w-[760px] flex-col">
        <Sample id="before-time" label={FR ? "Avant : sept questions dans un texte" : "Before: seven questions in one text"} lead={timeLead}>
          <QuestionCard threadId="t" bot={bot} message={card("bt", [{ question: FR ? BAD_TIME_FR : BAD_TIME_CARD.question, options: [] }], "", "")} />
        </Sample>
        <Sample id="before-drafts" label={FR ? "Avant : une liste en prose" : "Before: a list in prose"} lead={draftsLead}>
          <QuestionCard threadId="t" bot={bot} message={card("bd", [{ question: FR ? BAD_DRAFTS_FR : BAD_DRAFTS_CARD.question, options: [] }], "", "")} />
        </Sample>
        <Sample id="time-form" label={FR ? "Après : un formulaire, un rang par ligne" : "After: one form, a row per line"} lead={timeLead}>
          <QuestionCard threadId="t" bot={bot} message={card("tf", TIME, time.title, time.question)} />
        </Sample>
        <Sample id="drafts-checklist" label={FR ? "Après : une liste à cocher et ses boutons" : "After: a checklist and its buttons"} lead={draftsLead}>
          <QuestionCard threadId="t" bot={bot} message={card("dc", DRAFTS, drafts.title, drafts.question)} />
        </Sample>
        <Sample id="control-kinds" label={FR ? "Chaque type de contrôle" : "Each control kind"} lead={FR ? "Il me manque quelques détails pour réserver la salle." : "I need a few details to book the room."}>
          <QuestionCard threadId="t" bot={bot} message={card("ck", KINDS, FR ? "Réservation de salle" : "Room booking", FR ? "Un rang par type de réponse." : "One row per kind of answer.")} />
        </Sample>
        <Sample id="when-follow-up" label={FR ? "Suivi conditionnel : caché tant que l'option n'est pas choisie" : "Conditional follow-up: hidden until its option is picked"} lead={FR ? "Voici l'entrée de temps à confirmer." : "Here is the time entry to confirm."}>
          <QuestionCard threadId="t" bot={bot} message={card("wf", WHEN, FR ? "Entrée de temps à confirmer" : "Time entry to confirm", FR ? "Choisis la durée. On la demande seulement si tu l'entres toi-même." : "Pick how long it lasted. The length is asked only when you enter it yourself.")} />
        </Sample>
        <Sample id="time-settled" label={FR ? "Formulaire répondu" : "Form answered"} lead={timeLead}>
          <QuestionCard threadId="t" bot={bot} message={card("ts", TIME, time.title, time.question, { answered: "answer", answeredText: TIME_ANSWER })} />
        </Sample>
        <Sample id="drafts-settled" label={FR ? "Liste répondue" : "Checklist answered"} lead={draftsLead}>
          <QuestionCard threadId="t" bot={bot} message={card("ds", DRAFTS, drafts.title, drafts.question, { answered: "answer", answeredText: DRAFTS_ANSWER })} />
        </Sample>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* no Sagax server here: a store that keeps the cards and drops what they send */}
    <BotEditorStore value={{ state: {}, dispatch: () => {} } as unknown as ReturnType<typeof useStore>}>
      <Preview />
    </BotEditorStore>
  </StrictMode>,
);

// Dev gallery for a question card's structured facts (ask_choice `facts`):
// Marc's new-ticket card without the table (before, and what an older client
// draws), the same card with it (after), and an ordinary question card beside
// them as the conforming neighbour. Served by Vite in dev at
// /src/gallery/ask-facts.html; not part of the packaged app.
// ?lang=fr|en&skin=<id>
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { DesktopCapabilitiesProvider } from "@/components/DesktopCapabilities";
import { QuestionCard } from "@/components/QuestionCard";
import { loadLocale } from "@/lib/i18n";
import { applySkin, type SkinId } from "@/lib/skins";
import { StoreProvider, type Message } from "@/state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
await loadLocale(params.get("lang") ?? "fr");
applySkin((params.get("skin") ?? "pulsatrix") as SkinId);

const SENTENCE = "Nouveau billet #300769 : Client : Sherweb. Demande : « Auberge Godefroy - Potential - 1894992 - Sign-In from Unauthorized Location [Alliance:#1894992/] ». Site : Main. Priorité : 3 : Moyenne (Medium). Déjà touché par : personne (dernier geste 2026-11-19 07:39). Je ne l'ai pas placé : je n'ai trouvé aucune règle pour le placer.";
const CHOICES = ["Le placer demain 8 h", "Le placer aujourd'hui", "Le laisser sans plage", "Me demander plus tard"].map((label) => ({ label }));
const FACTS = [
  { label: "Billet", value: "#300769", record: { product: "connectwise", kind: "ticket", id: "300769" } },
  { label: "Client", value: "Sherweb" },
  { label: "Demande", value: "Auberge Godefroy - Potential - 1894992 - Sign-In from Unauthorized Location [Alliance:#1894992/]" },
  { label: "Site", value: "Main" },
  { label: "Priorité", value: "3 : Moyenne (Medium)" },
  { label: "Déjà touché par", value: "personne (dernier geste 2026-11-19 07:39)" },
];
const at = new Date(2026, 10, 19, 9, 14).getTime();

function card(id: string, withFacts: boolean): Message {
  return {
    id, role: "bot", kind: "options", at,
    card: {
      title: "Nouveau billet #300769 sans plage", subtitle: SENTENCE, options: [], requestId: `req-${id}`, requestType: "question", askKey: "ticket-300769", noHold: true, factsAt: at,
      ...(withFacts ? { facts: FACTS } : {}),
      questionRequest: { version: 1, questions: [{ question: SENTENCE, options: CHOICES }] },
    },
  } as unknown as Message;
}
const neighbour = {
  id: "n", role: "bot", kind: "options", at,
  card: {
    title: "", subtitle: "", options: [], requestId: "req-n", requestType: "question",
    questionRequest: { version: 1, questions: [{ question: "Je mets en pause mes deux webhooks ?", options: [{ label: "Oui, mets-les en pause" }, { label: "Non, garde-les actifs" }] }] },
  },
} as unknown as Message;

function Col({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section data-variant={id} className="flex min-w-0 flex-col items-start gap-2 p-4">
      <div className="text-[11px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      {children}
    </section>
  );
}

function Preview() {
  const bot = { name: "Marc" };
  return (
    <div className="min-h-screen bg-app text-ink">
      <div className="mx-auto grid max-w-[1500px] grid-cols-3">
        <Col id="neighbour" label="Carte de question normale (voisine conforme)">
          <QuestionCard threadId="t" bot={bot} message={neighbour} />
        </Col>
        <Col id="before" label="Avant : sans faits (ancien client)">
          <QuestionCard threadId="t" bot={bot} message={card("before", false)} />
        </Col>
        <Col id="after" label="Après : avec faits">
          <QuestionCard threadId="t" bot={bot} message={card("after", true)} />
        </Col>
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

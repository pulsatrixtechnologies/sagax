/** Isolated gallery for headless screenshots of the phone call and purchase
 * cards (src/components/OutboundCard.tsx, parité R13). Not shipped in the app.
 * ?lang=<code>&skin=<id>&only=<call|purchase|conversation> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OutboundCard } from "../components/OutboundCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const row = (n: number, outbound: OutboundCardData): Message => ({ id: `m${n}`, role: "bot", kind: "text", text: "", outbound } as unknown as Message);
const CARDS: Message[] = [
  row(1, { kind: "call", id: "call_0000000000000001", status: "pending", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous de mardi à 10 h. Merci de rappeler au besoin.", language: "fr", callback: "+1 438 555 0199" }),
  row(2, { kind: "call", id: "call_0000000000000002", status: "done", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous.", via: "Chef" }),
  row(3, { kind: "purchase", id: "pay_0000000000000003", status: "pending", botName: "Rocket", merchant: "Boutique Exemple", amount: "45.20", currency: "CAD", cardLabel: "visa •••• 4242", items: [{ name: "Câble USB-C", quantity: 2, price: "10.00" }, { name: "Chargeur 65 W", quantity: 1, price: "25.20" }] }),
  row(4, { kind: "purchase", id: "pay_0000000000000004", status: "done", botName: "Rocket", merchant: "Air Exemple", amount: "812.40", currency: "CAD", cardLabel: "visa •••• 4242", orderRef: "XK7Q2P", mismatchTotal: "830.10", declared: true, flights: [{ from: "YUL", to: "YVR", date: "2026-11-02", flight: "AC 301" }, { from: "YVR", to: "YUL", date: "2026-11-09", flight: "AC 308" }] }),
  // 2026-10-29: approved by the Full level, then followed to the door
  row(5, { kind: "purchase", id: "pay_0000000000000005", status: "approved", botName: "Rocket", merchant: "Boutique Audio", amount: "189.99", currency: "CAD", cardLabel: "visa •••• 4242", via: "Full access", items: [{ name: "Casque sans fil, réduction de bruit", quantity: 1, price: "189.99" }] }),
  row(6, { kind: "purchase", id: "pay_0000000000000006", status: "done", botName: "Rocket", merchant: "Boutique Audio", amount: "189.99", currency: "CAD", cardLabel: "visa •••• 4242", orderRef: "BA-20931", declared: true, items: [{ name: "Casque sans fil, réduction de bruit", quantity: 1, price: "189.99" }], tracking: { step: "in_transit", carrier: "Postes Canada", number: "LM123456789CA", url: "https://suivi.example.com/LM123456789CA", eta: "2026-11-02", updatedAt: 1798000000000 } }),
  row(7, { kind: "purchase", id: "pay_0000000000000007", status: "done", botName: "Rocket", merchant: "Boutique Exemple", amount: "45.20", currency: "CAD", cardLabel: "visa •••• 4242", orderRef: "A-1", declared: true, tracking: { step: "exception", carrier: "UPS", number: "1Z999AA10123456784", note: "Retenu au dépôt, adresse à confirmer", updatedAt: 1798000000000 } }),
];

// Conversation calls (place_phone_call mode conversation): the approval, the
// call under way, and its results (completed with the transcript open,
// voicemail, no answer).
const conversation = {
  kind: "call" as const, botName: "Rocket", destination: "+1 514 555 0142", mode: "conversation" as const, language: "fr" as const, maxMinutes: 5,
  objective: "Prendre rendez-vous pour l'entretien de la thermopompe la semaine prochaine, idéalement en matinée.",
  script: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex.",
};
const liveStartedAt = 1798000000000 - 67_000;
// Tiny silent WAV so the recording player has a playable src in the gallery.
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

const CONVERSATION: { message: Message; transcriptOpen?: boolean }[] = [
  { message: row(11, { ...conversation, id: "call_0000000000000011", status: "pending", calleeName: "Thermopompes Québec", instructions: "Rester bref et poli. Proposer mardi ou mercredi entre 8 h et 11 h. Ne donner aucune information de paiement.", voicemail: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex au sujet de l'entretien de la thermopompe. Alex vous rappellera." }) },
  { message: row(12, {
    ...conversation, id: "call_0000000000000012", status: "done", phase: "dialing", liveStartedAt, calleeName: "Thermopompes Québec", via: "Chef",
  }) },
  { message: row(17, {
    ...conversation, id: "call_0000000000000017", status: "done", phase: "in_call", liveStartedAt, calleeName: "Marie Tremblay",
    liveTranscript: [
      { speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex.", at: liveStartedAt + 5_000 },
      { speaker: "callee", text: "Oui, bonjour.", at: liveStartedAt + 12_000 },
    ],
    liveEvents: [{ kind: "dtmf", detail: "1", at: liveStartedAt + 18_000 }],
  }) },
  { message: row(18, {
    ...conversation, id: "call_0000000000000018", status: "done", phase: "on_hold", liveStartedAt, calleeName: "Marie Tremblay",
    liveTranscript: [{ speaker: "bot", text: "Je vous mets en attente un instant.", at: liveStartedAt + 20_000 }],
    liveEvents: [{ kind: "hold", detail: "hold", at: liveStartedAt + 21_000 }],
  }) },
  { message: row(19, {
    ...conversation, id: "call_0000000000000019", status: "done", phase: "transferred", liveStartedAt, calleeName: "Marie Tremblay",
    liveEvents: [{ kind: "transfer", detail: "+1 514 555 0199", at: liveStartedAt + 40_000 }],
  }) },
  { message: row(13, { ...conversation, id: "call_0000000000000013", status: "done", calleeName: "Thermopompes Québec", phase: "ended", recordingUrl: SILENT_WAV, result: {
    outcome: "completed", endedBy: "goal", durationSec: 247, endedAt: 1798000000000,
    points: ["Rendez-vous fixé mardi 4 novembre à 9 h.", "Le technicien prévoit environ une heure sur place.", "Le prix de l'entretien annuel est de 149 $ avant taxes."],
    commitments: ["Laisser l'accès au sous-sol libre le matin du rendez-vous.", "La compagnie envoie une confirmation par texto lundi."],
    transcript: [
      { speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex. J'aimerais prendre rendez-vous pour l'entretien d'une thermopompe." },
      { speaker: "callee", text: "Oui, bonjour. J'ai de la place mardi à 9 h, est-ce que ça irait?" },
      { speaker: "bot", text: "Mardi à 9 h, c'est parfait. Combien de temps faut-il prévoir?" },
      { speaker: "callee", text: "Environ une heure. C'est 149 $ avant taxes, et on envoie une confirmation par texto lundi." },
      { speaker: "bot", text: "Merci beaucoup, bonne journée!" },
    ],
  } }), transcriptOpen: true },
  { message: row(14, { ...conversation, id: "call_0000000000000014", status: "done", result: {
    outcome: "voicemail", durationSec: 21, endedAt: 1798000000000, points: ["Message laissé dans la boîte vocale de la compagnie."], commitments: [], transcriptExpired: true,
  } }) },
  { message: row(15, { ...conversation, id: "call_0000000000000015", status: "done", result: {
    outcome: "no-answer", durationSec: 0, endedAt: 1798000000000, points: [], commitments: [],
  } }) },
  { message: row(16, { ...conversation, id: "call_0000000000000016", status: "done", result: {
    outcome: "completed", endedBy: "stop-request", doNotCallAgain: true, durationSec: 34, endedAt: 1798000000000,
    points: ["L'interlocuteur ne souhaite pas recevoir d'appels d'un assistant IA."], commitments: [],
    transcript: [{ speaker: "bot", text: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex." }, { speaker: "callee", text: "Non merci, ne rappelez plus." }],
  } }) },
];

const only = params.get("only");
const shown = [
  ...(only === "conversation" ? [] : CARDS.filter((message) => !only || message.outbound?.kind === only).map((message) => ({ message, transcriptOpen: false }))),
  ...(only && only !== "conversation" ? [] : CONVERSATION),
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
      {shown.map(({ message, transcriptOpen }) => <OutboundCard key={message.id} message={message} transcriptOpen={transcriptOpen} />)}
    </main>
  </StrictMode>,
);

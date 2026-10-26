/** Isolated gallery for headless screenshots of the phone call and purchase
 * cards (src/components/OutboundCard.tsx, parité R13). Not shipped in the app.
 * ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { OutboundCard } from "../components/OutboundCard";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const row = (n: number, outbound: OutboundCardData): Message => ({ id: `m${n}`, role: "bot", kind: "text", text: "", outbound } as unknown as Message);
const CARDS: Message[] = [
  row(1, { kind: "call", id: "call_0000000000000001", status: "pending", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous de mardi à 10 h. Merci de rappeler au besoin.", language: "fr", callback: "+1 438 555 0199" }),
  row(2, { kind: "call", id: "call_0000000000000002", status: "done", botName: "Rocket", destination: "+1 514 555 0142", from: "+1 438 555 0100", purpose: "Confirmer le rendez-vous de mardi.", script: "Jean confirme le rendez-vous.", via: "Chef" }),
  row(3, { kind: "purchase", id: "pay_0000000000000003", status: "pending", botName: "Rocket", merchant: "Boutique Exemple", amount: "45.20", currency: "CAD", cardLabel: "visa •••• 4242", items: [{ name: "Câble USB-C", quantity: 2, price: "10.00" }, { name: "Chargeur 65 W", quantity: 1, price: "25.20" }] }),
  row(4, { kind: "purchase", id: "pay_0000000000000004", status: "done", botName: "Rocket", merchant: "Air Exemple", amount: "812.40", currency: "CAD", cardLabel: "visa •••• 4242", orderRef: "XK7Q2P", mismatchTotal: "830.10", declared: true, flights: [{ from: "YUL", to: "YVR", date: "2026-11-02", flight: "AC 301" }, { from: "YVR", to: "YUL", date: "2026-11-09", flight: "AC 308" }] }),
];

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
      {CARDS.map((message) => <OutboundCard key={message.id} message={message} />)}
    </main>
  </StrictMode>,
);

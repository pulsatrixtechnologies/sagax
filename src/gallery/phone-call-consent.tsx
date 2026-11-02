/** Isolated gallery for the one-time phone-call consent AskCard.
 * Not shipped. ?lang=<code>&skin=<id>&state=pending|accepted|declined */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PhoneCallConsentCard } from "../components/PhoneCallConsentCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import { PHONE_CALL_CONSENT_VERSION } from "../../shared/phone-call-consent";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const state = params.get("state") ?? "pending";

const consent = {
  requestId: "pcc_gallery000001",
  botId: "bot-rocket",
  threadId: "thread-1",
  status: state === "accepted" ? "accepted" as const : state === "declined" ? "declined" as const : "pending" as const,
  version: PHONE_CALL_CONSENT_VERSION,
  ...(state === "accepted" ? { acceptedAt: 1_700_000_000_000 } : {}),
};

const message = {
  id: "consent-m1",
  role: "bot",
  kind: "options",
  at: 0,
  text: "Phone calls need your consent once before a bot may place them.",
  from: { botId: "bot-rocket", name: "Rocket", color: "violet" },
  card: {
    requestId: consent.requestId,
    title: "Allow phone calls for your bots",
    options: ["Accept", "Decline"],
    phoneCallConsent: consent,
    ...(state !== "pending" ? { answered: true } : {}),
  },
} as unknown as Message;

const store = {
  state: { bots: [{ id: "bot-rocket", name: "Rocket", color: "violet" }] },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
        <div className="mx-auto max-w-[560px]" data-gallery-card>
          <PhoneCallConsentCard botId="bot-rocket" botName="Rocket" threadId="thread-1" message={message} />
        </div>
      </main>
    </BotEditorStore>
  </StrictMode>,
);

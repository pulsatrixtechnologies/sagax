/** Isolated gallery for the meeting join consent AskCard (#3367 Always allow).
 * Not shipped. ?lang=<code>&skin=<id>&state=pending|joining|org-off */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MeetingCard } from "../components/MeetingCard";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const state = params.get("state") ?? "pending";
const orgOff = state === "org-off";

const meeting = {
  requestId: "meet_gallery000001",
  botId: "bot-rocket",
  threadId: "thread-1",
  provider: "google-meet" as const,
  url: "https://meet.google.com/abc-defg-hij",
  code: "abc-defg-hij",
  displayName: "Rocket (transcription)",
  reason: "Weekly sync with the Northwind team",
  supported: true,
  status: state === "joining" ? "joining" as const : "pending" as const,
};

const ownerRule = {
  tool: "sagax:meeting",
  scope: { provider: "google-meet" },
  description: "Join Google Meet meetings as a notetaker",
};

const message = {
  id: "meet-m1",
  role: "bot",
  kind: "options",
  at: 0,
  text: "Rocket wants to join a Google Meet meeting to take notes",
  from: { botId: "bot-rocket", name: "Rocket", color: "violet" },
  card: {
    requestId: meeting.requestId,
    title: "Rocket wants to join a Google Meet meeting to take notes",
    subtitle: meeting.reason,
    options: ["Rejoindre et prendre des notes", "Pas cette fois"],
    tool: "join_meeting",
    ownerRule,
    meetingRequest: meeting,
    ...(state === "joining" ? { answered: "allow" } : {}),
  },
} as unknown as Message;

if (orgOff) {
  const { noteOrgAlwaysAllowOff } = await import("../lib/org-approval-policy");
  noteOrgAlwaysAllowOff();
}

const store = {
  state: { bots: [{ id: "bot-rocket", name: "Rocket", color: "violet" }] },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <main className="min-h-screen bg-canvas p-6 text-ink" data-gallery-panel>
        <div className="mx-auto max-w-[560px]" data-gallery-card data-shot="meeting-card">
          <MeetingCard botId="bot-rocket" botName="Rocket" threadId="thread-1" message={message} />
        </div>
      </main>
    </BotEditorStore>
  </StrictMode>,
);

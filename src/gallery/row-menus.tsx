/** Isolated gallery for Playwright screenshots of the cards' three dots
 * menus (#4183): the goal card's menu, a message's "..." menu and the call
 * card's menu, a team section's menu, each opened by the capture script. Not shipped in the app.
 * ?skin=<id>&lang=<code>; &sample=team shows a team section of the team
 * map, whose three dots menu the script opens. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Pencil, Pin } from "lucide-react";
import { GoalRunCard } from "../components/GoalRunCard";
import { MessageHoverActions, MessageMenuItem } from "../components/MessageHoverActions";
import { VoiceCallCard } from "../components/VoiceCallCard";
import { TeamCanvas } from "../components/TeamCanvas";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, type Bot, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const noop = () => {};
const goal = {
  id: "goal-run-card", role: "bot", kind: "goal.run", at: 1,
  goalRun: { runId: "run-1", goal: "Draft and polish the launch note", status: "working", coordinatorBotId: "bot-1", coordinatorName: "Sprout", turnCount: 2, maxTurns: 12, detail: "Luna reads the second draft.", startedAt: Date.UTC(2026, 9, 16, 14, 0) },
} as unknown as Message;

const bot = (id: string, name: string, color: string, title: string): Bot => ({
  id, threadId: `${id}-thread`, name, title, description: "", color, notifications: true, unread: false, busy: false, messages: [],
  modelSelection: { instanceId: "test", model: "test" }, tasks: [{ threadId: `${id}-thread`, title: "Chat", createdAt: 1 }],
} as unknown as Bot);
const sections = [{ key: "support", name: "Support", chiefs: [bot("atlas", "Atlas", "blue", "Dispatch")], members: [bot("boreas", "Boreas", "green", "Billing")] }];

function Gallery() {
  if (params.get("sample") === "team") {
    return (
      <div className="flex h-dvh bg-app text-ink">
        <TeamCanvas sections={sections} canManage onMove={async () => {}} onInstructions={noop} onMemory={noop} onEditTeam={noop} onDeleteTeam={noop} isEmpty={() => false} />
      </div>
    );
  }
  return (
    <div className="flex min-h-dvh flex-col gap-10 bg-app p-6 text-ink">
      <div data-sample="goal" className="w-[560px]"><GoalRunCard message={goal} onStop={noop} onRunAgain={noop} /></div>
      <div data-sample="message" className="flex w-[560px] justify-end">
        <MessageHoverActions side="bot" onReply={noop} copy="Hi" requestId="msg_123" react={{ mine: [], onPick: noop }}>
          <MessageMenuItem label="Edit message" icon={<Pencil size={16} />} onSelect={noop} />
          <MessageMenuItem label="Pin message" icon={<Pin size={16} />} onSelect={noop} />
        </MessageHoverActions>
      </div>
      <div data-sample="call" className="w-[560px]"><VoiceCallCard threadId="t1" botName="Scout" callId="call-1" messages={[]} forceOpen /></div>
    </div>
  );
}

const value = { state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };

createRoot(document.getElementById("root")!).render(<StrictMode><BotEditorStore value={value}><Gallery /></BotEditorStore></StrictMode>);

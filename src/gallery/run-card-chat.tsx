/** The real ChatView with a long run, to look at the "This run" card above the
 * composer (scripts/capture/run-card-chat.mjs). Synthetic store, no server.
 * ?skin=<id>&lang=en|fr&busy=1 (the bot is still working) */
import { StrictMode, useMemo, useReducer } from "react";
import { createRoot } from "react-dom/client";

import { ChatView } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, initialState, reducer, type Action, type AppState, type Bot, type InstanceInfo, type Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const fr = lang === "fr";
const at = Date.UTC(2026, 9, 31, 13, 0);

const text = (id: string, role: Message["role"], body: string, minute: number, parentId?: string): Message =>
  ({ id, role, kind: "text", text: body, at: at + minute * 60_000, parentId }) as Message;
const step = (n: number, summary: string): Message =>
  ({ id: `s${n}`, role: "bot", kind: "activity", at: at + (3 + n) * 60_000, parentId: n === 0 ? "ask" : `s${n - 1}`, tool: { name: "Bash", summary, ok: true } }) as Message;
const commands = [
  "pnpm install --frozen-lockfile", "pnpm typecheck", "pnpm lint", "pnpm test src/lib", "git add -A", "git commit -m update",
  "pnpm build", "node scripts/report.mjs --month 10", "node scripts/report.mjs --month 11", "git push origin work", "pnpm test src/ui", "pnpm check:terms",
  "node scripts/pack.mjs", "node scripts/upload.mjs", "pnpm verify", "git status",
];
const paragraph = fr
  ? "Le rapport est prêt. Les billets fermés montent de 12 % sur le mois, les délais de première réponse baissent de 9 minutes, et la file des demandes en attente est passée de 41 à 17. Je garde le détail par client dans la page jointe, avec une section pour les écarts à surveiller la semaine prochaine."
  : "The report is ready. Closed tickets are up 12% over the month, first response time dropped by 9 minutes, and the waiting queue went from 41 to 17. The per client detail is in the attached page, with a section on the gaps to watch next week.";
const messages: Message[] = [
  text("ask", "user", fr ? "Prépare et publie le rapport du mois." : "Prepare and publish this month's report.", 1),
  ...commands.map((summary, n) => step(n, summary)),
  text("done", "bot", `${paragraph}\n\n${paragraph}`, 30, "s15"),
];
const scout: Bot = {
  id: "scout", threadId: "scout-thread", name: "Scout", title: "", description: "", color: "green",
  notifications: true, unread: false, busy: params.get("busy") === "1", messages, activeLeafId: "done",
  modelSelection: { instanceId: "gallery", model: "m" },
} as Bot;
const start: AppState = {
  ...initialState,
  connected: true,
  selectedId: "scout",
  bots: [scout],
  instances: [{ instanceId: "gallery", driverKind: "codex", displayName: "Gallery", snapshot: { state: "available" }, models: { options: [{ id: "m", label: "Gallery model" }] } } as unknown as InstanceInfo],
};
function galleryReducer(state: AppState, action: Action): AppState {
  try { return reducer(state, action); } catch { return state; }
}
function Gallery() {
  const [state, dispatch] = useReducer(galleryReducer, start);
  const value = useMemo(() => ({ state, dispatch, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }), [state]);
  const bot = state.bots.find((entry) => entry.id === "scout")!;
  return (
    <BotEditorStore value={value as never}>
      <div className="flex h-dvh w-full overflow-hidden bg-app"><ChatView bot={bot} /></div>
    </BotEditorStore>
  );
}
createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);

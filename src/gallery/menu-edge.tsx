/** Isolated gallery for Playwright screenshots of menus opened at the
 * window's right edge with long names (#4183): the bot panel's Computer
 * "..." menu listing a computer with a long name, and the conversation
 * menu's Move to folder page with long folder names. Each menu sizes to its
 * labels and keeps itself in the window with its measured size. Not shipped
 * in the app. ?skin=<id>&lang=<code>&case=computer|move */
import { StrictMode, useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmProvider } from "../components/ConfirmProvider";
import { ComputerCard } from "../components/bot-settings/ComputerCard";
import { ThreadMenu } from "../components/ThreadMenu";
import type { BotComputerHostView } from "../../shared/bot-computer-host";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
const lang = params.get("lang") ?? "en";
await loadLocale(lang);
const which = params.get("case") ?? "computer";

const host = (hostId: string, name: string, online: boolean): BotComputerHostView => ({
  hostId, name, os: "windows", online, botComputer: true, tags: [], shellOnly: false, access: "full", modes: {}, vm: null,
} as unknown as BotComputerHostView);
const hosts = [host("h1", "Accounting workstation on the second floor, reception side", true), host("h2", "Build server", true)];
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
window.fetch = async (input: RequestInfo | URL) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.includes("/host-computer")) return json({ hostId: null, hosts });
  if (url.includes("/api/host-computers")) return json({ hosts });
  return json({});
};

const bot = { id: "bot-orla", name: "Orla", color: "violet", threadId: "thread-main", messages: [], tasks: [], browser: true, computer: "cloud", modelSelection: { instanceId: "i", model: "m" } } as unknown as Bot;
const store = {
  state: { bots: [bot], instances: [], groups: [], routines: [], config: { features: { browser: true }, browserEngine: { kind: "engine" }, browserProfiles: [], box: { configured: true, included: true } }, computerControl: {} },
  dispatch: () => {},
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

/** The bot panel, docked at the window's right edge, its Computer "..." open. */
function ComputerAtEdge() {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => box.current?.querySelector<HTMLButtonElement>("[data-computer-card-more]")?.click(), 400);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex h-dvh justify-end bg-canvas">
      <div ref={box} data-gallery-panel className="h-full w-[308px] border-l-[0.5px] border-hairline-weak bg-panel px-4 pt-4 text-ink">
        <ComputerCard bot={bot} onPatch={() => {}} />
      </div>
    </div>
  );
}

const folders = [
  { id: "f1", name: "Quarterly supplier invoices and purchase orders" },
  { id: "f2", name: "Onboarding of the new accounting team" },
  { id: "f3", name: "Notes" },
];

/** The conversation menu opened near the window's right edge, on Move to folder. */
function MoveAtEdge() {
  return (
    <div className="h-dvh bg-canvas">
      <ThreadMenu task={{ threadId: "t1", title: "Monthly report" }} folders={folders} initialPage="move"
        position={{ left: window.innerWidth - 60, top: 60 }} onClose={() => {}}
        actions={{ onRename: () => {}, onDelete: () => {}, onMove: () => {} }} />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><ConfirmProvider><BotEditorStore value={store}>
    <div data-gallery-sample={which}>{which === "move" ? <MoveAtEdge /> : <ComputerAtEdge />}</div>
  </BotEditorStore></ConfirmProvider></StrictMode>,
);

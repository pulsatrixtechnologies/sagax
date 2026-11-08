/** Gallery for screenshots of bot computers (#2726, #2727): the bot panel's
 * Computer menu and the chat bar's picker with a marked host, the host row
 * with its tags and ⋯ menu, and a bot thread on a mock "FS-01" (the
 * isolated / as-is question, the quiet shell step, the provisioning state).
 * Every call is mocked; no real host. Not shipped.
 * ?skin=<id>&lang=<code>&view=card|picker|row|thread */
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Monitor, Server } from "lucide-react";
import { ComputerCard } from "../components/bot-settings/ComputerCard";
import { ScreenPicker, type ScreenPickerItem } from "../components/computer/OrgComputerTab";
import { UnattendedHostsSection } from "../components/remote-session/UnattendedHostsSection";
import { QuestionCard } from "../components/QuestionCard";
import { ToolActivity } from "../components/ToolActivity";
import { CHAT_BUBBLE_WIDTH_CLASS } from "../lib/chat-bubble-width";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { StoreProvider, type Bot, type Message } from "../state/store";
import type { BotComputerHostView } from "../../shared/bot-computer-host";
import type { UnattendedHostRow } from "../../shared/remote-unattended-host";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const view = params.get("view") ?? "card";

const FS01 = `h_${"a".repeat(32)}`;
const STUDIO = `h_${"b".repeat(32)}`;
const NOW = Date.now();

const hostViews: BotComputerHostView[] = [
  { hostId: FS01, name: "FS-01", os: "linux", online: true, botComputer: true, tags: ["nas", "unraid"], shellOnly: true, access: "always", modes: { "bot-1": "isolated" }, vm: { engine: "libvirt", state: "provisioning", name: "sagax-scout", step: "Creating the disk", updatedAt: NOW } },
  { hostId: STUDIO, name: "Studio-Mac", os: "macos", online: false, botComputer: true, tags: ["gpu"], shellOnly: false, access: "ask", modes: {}, vm: null },
];
const rows: UnattendedHostRow[] = [
  { hostId: FS01, hostname: "FS-01", org: "Example", scope: "full-control", installedBy: null, enrolledAt: "2026-11-01T14:00:00Z", expiresAt: "2027-11-01T14:00:00Z", lastSeenAt: new Date(NOW - 20_000).toISOString(), revokedAt: null, state: "enrolled" } as UnattendedHostRow,
  { hostId: STUDIO, hostname: "Studio-Mac", org: "Example", scope: "full-control", installedBy: null, enrolledAt: "2026-11-02T14:00:00Z", expiresAt: "2027-11-02T14:00:00Z", lastSeenAt: "2026-11-05T21:10:00Z", revokedAt: null, state: "enrolled" } as UnattendedHostRow,
];

// Every request answers from the mock: the bot's host choice, the hosts.
const realFetch = window.fetch.bind(window);
window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/host-computer") && url.includes("/api/bots/")) return reply({ hostId: FS01, hosts: hostViews });
  if (url.includes("/api/host-computers")) return reply({ hosts: hostViews });
  return realFetch(input, init);
}) as typeof window.fetch;

const bot = { id: "bot-1", name: "Scout", title: "", description: "", messages: [], tasks: [], threadId: "t1", busy: false, computer: "cloud" } as never as Bot;

function Frame({ width, children }: { width: number; children: ReactNode }) {
  return <div data-gallery-frame="" style={{ width }} className="min-h-[560px] bg-app p-4 text-ink">{children}</div>;
}

function Card() {
  return (
    <aside data-gallery-panel="" className="min-h-[560px] w-[380px] border-r border-hairline/40 bg-panel px-4 pb-6 pt-4 text-ink">
      <ComputerCard bot={bot} onPatch={() => {}} />
    </aside>
  );
}

function Picker() {
  const items: ScreenPickerItem[] = [
    { key: "server", label: t("orgComputer.choice.cloud"), icon: Server, dot: "online" },
    ...hostViews.map((host): ScreenPickerItem => ({ key: `bothost:${host.hostId}`, label: host.name, technical: host.name, icon: host.shellOnly ? Server : Monitor, here: host.hostId === FS01, dot: host.online ? "online" : "offline" })),
  ];
  const [chosen, setChosen] = useState(`bothost:${FS01}`);
  return <Frame width={420}><ScreenPicker items={items} chosen={chosen} onPick={setChosen} /></Frame>;
}

function Row() {
  return (
    <Frame width={980}>
      <UnattendedHostsSection state={{ hosts: rows, available: true, loading: false, reload: () => {} }} />
    </Frame>
  );
}

function ask(): Message {
  return {
    id: "q1", role: "bot", kind: "options", at: 1,
    card: {
      title: "", subtitle: "", options: [], requestId: "req-q1", requestType: "question",
      questionRequest: { version: 1, questions: [{ header: "FS-01", question: "Comment je travaille sur FS-01 ?", options: [
        { label: t("hostComputer.mode.isolated"), description: "Je crée une VM Linux légère sur cet hôte et je travaille seulement dedans." },
        { label: t("hostComputer.mode.asIs"), description: "Je travaille directement sur l'hôte, avec sa propre règle d'accès." },
      ] }] },
    },
  } as Message;
}

function Bubble({ me, children }: { me?: boolean; children: ReactNode }) {
  return <div className={`${me ? "self-end bg-selected" : "self-start bg-card"} rounded-[18px] px-3 py-[7px] text-[13px] leading-5 text-ink ${CHAT_BUBBLE_WIDTH_CLASS.fit}`}>{children}</div>;
}

function Thread() {
  const shell = { name: "host_computer", ok: true, durationMs: 900, input: JSON.stringify({ action: "exec", command: "df -h /mnt/user" }), output: JSON.stringify({ where: "FS-01", exitCode: 0, stdout: "Filesystem  Size  Used Avail Use% Mounted on\nshfs        22T   14T  8.1T  63% /mnt/user\n" }) };
  const provision = { name: "host_computer", input: JSON.stringify({ action: "vm_provision" }) };
  return (
    <div className="min-h-[760px] bg-app text-ink">
      <div className="mx-auto flex max-w-[720px] flex-col gap-3 p-4">
        <Bubble me>Vérifie l'espace libre sur FS-01.</Bubble>
        <ToolActivity tool={shell} />
        <Bubble>FS-01 a 8,1 To de libre sur /mnt/user (63 % utilisé).</Bubble>
        <Bubble me>Travaille sur FS-01 à partir de maintenant.</Bubble>
        <div data-gallery-question="" className="flex flex-col items-start gap-2">
          <QuestionCard threadId="t1" bot={{ name: "Scout" }} message={ask()} />
        </div>
        <Bubble>Je prépare un environnement isolé sur FS-01.</Bubble>
        <div data-gallery-provision=""><ToolActivity tool={provision} live /></div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      {view === "picker" ? <Picker /> : view === "row" ? <Row /> : view === "thread" ? <Thread /> : <Card />}
    </StoreProvider>
  </StrictMode>,
);

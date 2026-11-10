/** Isolated gallery for Playwright screenshots of the dev context pods over
 * a chat laid out like ChatView (floating header, centered 960px
 * transcript, composer dock). Sample transcript, no server. Not shipped in
 * the app.
 * ?skin=<id>&lang=<code>&pods=on|off&overlay=1&context=high&hub=1
 * (hub=1: connectors this conversation called through call_connector, #3357) */
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { MoreHorizontal } from "lucide-react";
import { DevPods, DevPodsToggle } from "../components/dev-pods/DevPods";
import { DEFAULT_PREFS, resetDevPodPrefsForTest } from "../components/dev-pods/prefs";
import { CIRCLE_BUTTON } from "../lib/circle-button";
import { loadLocale } from "../lib/i18n";
import { updateMcpServers } from "../lib/mcp-servers";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Bot, Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
resetDevPodPrefsForTest({ ...DEFAULT_PREFS, enabled: params.get("pods") !== "off" });
const SERVERS = [
  { name: "github", enabled: true },
  { name: "linear", enabled: true },
  { name: "notion", enabled: true },
  { name: "slack", enabled: true },
];
updateMcpServers(SERVERS);
let opened = false;

let seq = 0;
const tool = (name: string, summary: string, output = ""): Message => ({ id: `m${++seq}`, role: "bot", kind: "activity", at: seq, tool: { name, ok: true, summary, output } });
const say = (role: Message["role"], text: string, extra: Partial<Message> = {}): Message => ({ id: `m${++seq}`, role, kind: "text", text, at: seq, ...extra });

const messages: Message[] = [
  say("user", "La connexion SSO échoue sur la page de connexion. Peux-tu corriger et ouvrir une PR?"),
  tool("Read", "src/lib/auth/sso.ts"),
  tool("Bash", "git switch -c fix/sso-callback", "Switched to a new branch 'fix/sso-callback'"),
  tool("Edit", "src/lib/auth/sso.ts"),
  say("bot", "Le rappel SSO comparait l'état avant de décoder l'URL. Correctif :\n```ts\nconst state = decodeURIComponent(params.get(\"state\") ?? \"\");\nif (state !== expected) throw new SsoStateError();\n```"),
  tool("Bash", "pnpm test src/lib/auth", "Tests 14 passed"),
  tool("Bash", "git commit -am \"fix(auth) : décoder l'état SSO avant la comparaison\"", "[fix/sso-callback 4e1c9a2] fix(auth) : décoder l'état SSO avant la comparaison"),
  tool("Bash", "gh pr create --title \"fix(auth) : état SSO décodé\"", "https://github.com/acme/portal/pull/318"),
  say("bot", "C'est fait. La PR est ouverte : https://github.com/acme/portal/pull/318 . Les 14 tests d'authentification passent.", {
    attachments: [{ kind: "file", path: "/api/files/demo/rapport-sso.md", mime: "text/markdown", name: "rapport-sso.md" }],
  }),
];

// Two background tasks of this conversation, one with its result posted.
messages.push(say("bot", "Sous-tâche A terminée : 3 fichiers vérifiés.", { parallelTask: { threadId: "bg-a", title: "Sous-tâche de test A", requestMessageId: "m1", role: "result" } } as Partial<Message>));
const now = Date.now();
const high = params.get("context") === "high";
const hub = params.get("hub") === "1"
  ? [
    { provider: "grok-com", name: "Gmail", calls: 4, errors: 0, warm: 3, input: 480, output: 48, at: now - 20_000, last: "ok" },
    { provider: "chatgpt-apps", name: "Drive", calls: 2, errors: 1, warm: 1, input: 0, output: 0, at: now - 5_000, last: "error" },
  ]
  : undefined;

const bot = {
  id: "dev", threadId: "gallery", name: "Dev", title: "", description: "", color: "blue", notifications: true, unread: false, busy: false,
  messages, modelSelection: { instanceId: "x", model: "m" }, computer: "cloud", cwd: "/Users/me/Repository/acme/portal",
  tasks: [
    { threadId: "gallery", title: "SSO", createdAt: 1, busy: false, activity: "idle",
      usage: { input: 1, output: 1, costUsd: null, turns: 4, context: {
        tokens: high ? 830_000 : 130_000, window: 1_000_000,
        buckets: { messages: 42, messageBytes: high ? 2_900_000 : 210_000, tools: 112_810, memory: 19_285, skills: 31_000, agents: 9_400, prompt: 84_812 },
      } },
      connectors: { at: now, connectors: [
        { name: "Gmail", source: "claude", state: "connected" },
        { name: "Google Calendar", source: "claude", state: "connected" },
        { name: "Microsoft 365", source: "claude", state: "reconnect" },
        { name: "grok.com", source: "grok", state: "connected" },
        { name: "atelier", source: "perspicax", state: "connected" },
        { name: "notes-mcp", source: "personal", state: "connected" },
        { name: "calendar-sync", source: "personal", state: "reconnect" },
        { name: "github", source: "server", state: "connected" },
        { name: "twilio-docs", source: "server", state: "connected" },
        { name: "code-review", source: "plugin", state: "connected" },
      ], ...(hub ? { hub } : {}) } },
    { threadId: "bg-a", title: "Sous-tâche de test A", createdAt: 2, busy: false, activity: "idle",
      parallelOf: { threadId: "gallery", messageId: "m1", at: now - 65_000, outcome: "done", reportedAt: now - 60_000 } },
    { threadId: "bg-b", title: "Sous-tâche de test B", createdAt: 3, busy: false, activity: "idle",
      parallelOf: { threadId: "gallery", messageId: "m1", at: now - 65_000, outcome: "done", reportedAt: now - 58_000 } },
    { threadId: "bg-c", title: "Audit des dépendances", createdAt: 4, busy: true, activity: "working", turnStartedAt: now - 42_000,
      parallelOf: { threadId: "gallery", messageId: "m1", at: now - 42_000 } },
  ],
} as unknown as Bot;

function Bubble({ message }: { message: Message }) {
  if (message.kind === "activity") {
    return <div className="flex justify-start"><span className="ui-pill text-[12.5px] text-ink-secondary">{message.tool?.name} · {message.tool?.summary}</span></div>;
  }
  const mine = message.role === "user";
  return (
    <div className={mine ? "flex justify-end" : "flex justify-start"}>
      <div className={mine ? "w-fit max-w-[min(80%,560px)] rounded-[18px] bg-bubble-user px-3.5 py-2 text-[14px] text-ink" : "max-w-[min(94%,780px)] whitespace-pre-wrap text-[14px] leading-6 text-ink"}>{message.text}</div>
    </div>
  );
}

function Chat() {
  const dock = useRef<HTMLDivElement>(null);
  const [dockHeight, setDockHeight] = useState(96);
  useEffect(() => {
    if (dock.current) setDockHeight(dock.current.offsetHeight);
    // the 404 of the gallery's server would empty the primed list
    window.setTimeout(() => updateMcpServers(SERVERS), 600);
    // StrictMode runs this twice in development: open the stack once.
    if (params.get("overlay") === "1" && !opened) {
      opened = true;
      window.setTimeout(() => document.querySelector<HTMLButtonElement>("[data-dev-pods-toggle]")?.click(), 1200);
    }
  }, []);
  return (
    <main className="app-glow relative isolate flex h-screen min-w-0 flex-1 flex-col bg-app">
      <div className="content-topbar absolute inset-x-0 top-0 z-[3] flex min-h-[52px] items-center justify-end px-5 py-2.5">
        <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
          <span className="flex items-center gap-2 rounded-full border-[0.5px] border-hairline-weak bg-elevated py-[7.5px] pl-[7.5px] pr-[13.5px] text-[14px] font-medium text-ink">
            <span className="size-6 rounded-full bg-accent" /> Dev
          </span>
        </div>
        <div data-chathead-controls className="flex shrink-0 items-center gap-2">
          <button type="button" className={CIRCLE_BUTTON}><MoreHorizontal size={18} strokeWidth={1.75} /></button>
          <DevPodsToggle bot={bot} />
        </div>
      </div>
      <div className="content-card-body flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div className="h-full overflow-y-auto px-5">
            <div data-transcript="" className="mx-auto flex w-full max-w-[960px] flex-col gap-3 pt-14" style={{ paddingBottom: dockHeight }}>
              {messages.map((message) => <Bubble key={message.id} message={message} />)}
            </div>
          </div>
          <DevPods bot={bot} messages={messages} composerHeight={dockHeight} computerStart={undefined} dispatch={() => {}} />
          <div ref={dock} className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] px-5 pb-4">
            <div className="pointer-events-auto mx-auto h-[72px] max-w-[960px] rounded-[26px] border border-hairline-weak bg-composer" />
          </div>
        </div>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex h-screen bg-app text-ink"><Chat /></div>
  </StrictMode>,
);

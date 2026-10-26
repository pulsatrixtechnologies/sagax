/** Isolated gallery for headless screenshots of the composer's approval
 * card. Not shipped in the app.
 * ?lang=<code>&skin=<id>&card=command|send|candidate
 * Every answer is recorded in window.__decisions (and every rule save in
 * window.__rules) so a headless run can check what one click sent. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PendingApprovalBox, type Pending } from "../components/PendingApproval";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");
const which = params.get("card") ?? "command";

declare global {
  interface Window { __decisions: unknown[]; __rules: unknown[] }
}
window.__decisions = [];
window.__rules = [];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.includes("/api/auth/session")) return new Response(JSON.stringify({}), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/custom-rules")) {
    window.__rules.push(JSON.parse(String(init?.body ?? "{}")));
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input, init);
};

const store = {
  state: {},
  dispatch: (action: unknown) => { window.__decisions.push(action); },
  flushBotPatches: async () => null,
} as unknown as ReturnType<typeof useStore>;

const bot = { id: "bot-katarina", name: "Katarina", color: "violet" } as unknown as Bot;

const COMMAND = "ls /workspace/sagax-plugins/ 2>/dev/null; echo CLAUDECODE=$CLAUDECODE; ls ~/.pulsatrix-flow | head";
const cards: Record<string, { card: NonNullable<Message["card"]>; tool: string }> = {
  command: {
    tool: "mcp__sagax-environment__run_command",
    card: {
      requestId: "req-1",
      tool: "mcp__sagax-environment__run_command",
      mcpTool: "mcp__sagax-environment__run_command",
      title: "",
      subtitle: COMMAND,
      toolInput: JSON.stringify({ command: COMMAND }),
      options: ["Allow", "Deny"],
      held: "The provider requires your approval for this action.",
      heldCode: "approval.held.native",
      ownerRule: { tool: "mcp__sagax-environment__run_command", scope: { call: "x" }, description: "Run a command on your cloud computer (ls, echo, head)", from: "origin" },
      customRuleCandidate: { when: "run a command on the cloud computer", risks: ["irreversible"] as never },
    } as unknown as NonNullable<Message["card"]>,
  },
  send: {
    tool: "mcp__perspicax__outlook_send_mail",
    card: {
      requestId: "req-2",
      tool: "mcp__perspicax__outlook_send_mail",
      mcpTool: "mcp__perspicax__outlook_send_mail",
      title: "",
      subtitle: "",
      toolInput: JSON.stringify({ to: ["client@example.com"], subject: "Suivi du billet", body: "Bonjour, voici le suivi." }),
      options: ["Allow", "Deny"],
      held: "This sends something on your behalf, so it always asks first.",
      heldCode: "approval.held.outbound",
      ownerRule: { tool: "mcp__perspicax__outlook_send_mail", scope: { to: "client@example.com" }, description: "Send an email (client@example.com)", destructive: "external-message" },
    } as unknown as NonNullable<Message["card"]>,
  },
};

// card=app: a click in one app of the person's own computer, whose Always
// allow keeps that app (parité R10, ligne 80)
cards.app = {
  tool: "mcp__computer__click",
  card: {
    requestId: "req-3",
    tool: "mcp__computer__click",
    mcpTool: "mcp__computer__click",
    title: "",
    subtitle: "",
    toolInput: JSON.stringify({ pid: 812, window_id: 2, element_index: 14 }),
    options: ["Allow", "Deny"],
    ownerRule: { tool: "computer_app", scope: { app: "Safari" }, description: "Utiliser Safari sur cet ordinateur (voir, cliquer et saisir du texte)" },
  } as unknown as NonNullable<Message["card"]>,
};

// card=candidate: the command card without an owner rule, whose Always allow
// saves the server's proposed custom rule in one click
if (which === "candidate") cards.candidate = { ...cards.command!, card: { ...cards.command!.card, ownerRule: undefined } };
const chosen = cards[which] ?? cards.command!;
const message = { id: "m1", role: "bot", kind: "options", at: 0, text: "", card: chosen.card } as unknown as Message;
const pending: Pending = {
  message,
  requestId: chosen.card.requestId!,
  tool: chosen.tool,
  detail: chosen.card.subtitle,
  held: chosen.card.held,
  heldCode: chosen.card.heldCode,
  threadId: "thread-cryptic-katarina",
  askedBy: "Cryptic",
};

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto max-w-[760px]">
        <div className="mb-3 rounded-2xl bg-card px-4 py-3 text-[14px]">Katarina : je regarde ce qui est installé dans ton ordinateur cloud.</div>
        <PendingApprovalBox approvals={[pending]} threadId="thread-main" botFor={() => bot} onCancelTurn={() => window.__decisions.push({ type: "cancelTurn" })} />
        <div className="h-12 rounded-[22px] border-[0.5px] border-border bg-composer px-4 py-3 text-[14px] text-ink-secondary">Écris à Katarina</div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BotEditorStore value={store}>
      <Gallery />
    </BotEditorStore>
  </StrictMode>,
);

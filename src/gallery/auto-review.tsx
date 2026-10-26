/** Isolated gallery for headless screenshots of the model reviewer of
 * custom rules (examen automatique, lot A1): cards it approved, refused or
 * left to the person, with the rule and its reason, and the rules list.
 * Not shipped in the app. ?lang=<code>&skin=<id> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalCard } from "../components/ApprovalCard";
import { CustomRulesCard } from "../components/bot-settings/CustomRulesCard";
import { setLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
setLocale(params.get("lang") ?? "fr");

const bot = { id: "bot-katarina", name: "Katarina", color: "violet", approvalMode: "ask" } as unknown as Bot;
const RULES = [
  { id: "r1", ownerId: "jc", botId: null, when: "toucher aux factures du client Acme", behavior: "deny", riskScope: [], enabled: true, createdAt: 1, updatedAt: 1, compiled: { recognized: false } },
  { id: "r2", ownerId: "jc", botId: "bot-katarina", when: "tout ce qui touche au projet Sagax", behavior: "allow", riskScope: [], enabled: true, createdAt: 2, updatedAt: 2, compiled: { recognized: false } },
  { id: "r3", ownerId: "jc", botId: "bot-katarina", when: "la lecture de fichiers dans ~/Documents", behavior: "allow", riskScope: [], enabled: true, createdAt: 3, updatedAt: 3, compiled: { recognized: true } },
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("/api/auth/session")) return json({});
  if (url.includes("/api/custom-rules")) return json({ rules: RULES, orgPolicy: { alwaysAllow: true } });
  return realFetch(input, init);
};

const store = { state: { bots: [bot] }, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;

const card = (id: string, extra: Record<string, unknown>) => ({
  id, role: "bot", kind: "options", at: 0, text: "", from: { botId: bot.id },
  card: {
    requestId: `req-${id}`, requestType: "permission", tool: "mcp__acme__update_ticket", mcpTool: "mcp__acme__update_ticket",
    title: "Approval needed", subtitle: "Mettre à jour le billet 12", options: ["Allow", "Deny"],
    toolInput: JSON.stringify({ ticket: 12, project: "Sagax", status: "En cours" }), ...extra,
  },
}) as unknown as Message;

const approved = card("a", {
  answered: "allow", answeredBy: { kind: "worker", via: "auto-review" },
  customRule: { id: "r2", when: "tout ce qui touche au projet Sagax", behavior: "allow", botId: bot.id, outcome: "approved", reviewer: "model", reason: "Le billet 12 fait partie du projet Sagax." },
});
const denied = card("d", {
  subtitle: "Modifier la facture 7", toolInput: JSON.stringify({ invoice: 7, client: "Acme" }),
  answered: "deny", answeredBy: { kind: "worker", via: "auto-review" },
  customRule: { id: "r1", when: "toucher aux factures du client Acme", behavior: "deny", botId: null, outcome: "denied", reviewer: "model", reason: "C'est une facture du client Acme." },
});

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col gap-4">
        <div data-shot="cards" className="flex flex-col gap-2">
          <ApprovalCard bot={bot} message={approved} threadId="t1" />
          <ApprovalCard bot={bot} message={denied} threadId="t1" />
        </div>
        <div data-shot="rules" className="rounded-2xl bg-card p-4"><CustomRulesCard bot={bot} /></div>
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

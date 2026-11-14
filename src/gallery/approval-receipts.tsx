/** Isolated gallery for headless screenshots of answered tool approvals and
 * of the held line of a read-only tool's card (#4200). Not shipped in the app.
 * ?lang=<code>&skin=<id>&held=read|outbound */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApprovalCard } from "../components/ApprovalCard";
import { PendingApprovalBox, type Pending } from "../components/PendingApproval";
import { loadLocale } from "../lib/i18n";
import { mcpAllowKey } from "../lib/approval-describe";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { BotEditorStore, type Bot, type Message, type useStore } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const heldKey = params.get("held") === "outbound" ? "approval.held.outbound" : "approval.held.read";

const store = { state: {}, dispatch: () => {}, flushBotPatches: async () => null } as unknown as ReturnType<typeof useStore>;
const bot = { id: "bot-ottoline", name: "Ottoline", color: "violet" } as unknown as Bot;
const TOOL = "mcp__desk__view_schedule";
const base = {
  title: "", options: [], requestType: "permission", tool: TOOL, mcpTool: TOOL,
  toolInput: JSON.stringify({ member: "dispatch", date: "2026-11-13" }),
} as const;
const receipt = (id: string, card: Record<string, unknown>) =>
  ({ id, role: "bot", kind: "options", at: 0, text: "", card: { ...base, requestId: id, ...card } }) as unknown as Message;
const rows = [
  receipt("always", { answered: "allow", customRuleSaved: { id: "rule-1", when: "reading with `mcp__desk__view_schedule`" } }),
  receipt("once", { answered: "allow" }),
  receipt("denied", { answered: "deny" }),
];
const open = { ...receipt("open", { options: ["Allow", "Deny"], heldCode: heldKey }) };
const pending: Pending = { message: open, requestId: "open", tool: TOOL, detail: "", heldCode: heldKey, threadId: "thread-main", askedBy: "Ottoline", allowKey: mcpAllowKey(TOOL) };

function Gallery() {
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div className="mx-auto flex max-w-[760px] flex-col gap-2" data-shot="approval-receipts">
        {rows.map((message) => <ApprovalCard key={message.id} bot={bot} message={message} />)}
        <PendingApprovalBox approvals={[pending]} threadId="thread-main" botFor={() => bot} onCancelTurn={() => {}} />
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

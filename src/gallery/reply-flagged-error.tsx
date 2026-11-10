/** Isolated gallery for headless screenshots of a bot reply whose turn the
 * engine flagged as an error after it answered (2026-10-29): the reply, with
 * its table, and the failed row that only repeated it. Before, that row was a
 * red card holding the reply as flat text cut at 600 characters; after, the
 * row is not drawn (shared/failure-dedup.ts) and the reply stands. A real
 * failure with no reply keeps its card and its Retry. Not shipped in the app.
 * ?skin=<id>&lang=<code>&mode=after|before */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChatMarkdown } from "../components/ChatMarkdown";
import { ErrorRow } from "../components/ChatView";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { Message } from "../state/store";
import { failedTurnCause, failedTurnTool } from "../../shared/failed-turn";
import { repeatedFailureIds } from "../../shared/failure-dedup";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const before = params.get("mode") === "before";

const reply = `Everyone answered. Five bots synced their rules and their memory index.

| Bot | RULES.md | MEMORY.md | Status |
|---|---|---|---|
| Alpha | updated | updated | ok |
| Beta | updated | already current | ok |
| Gamma | updated | updated | ok |
| Delta | already current | updated | ok |
| Epsilon | updated | updated | ok |

Nothing else is waiting on you. The next sync runs tomorrow morning.`;

const MESSAGES: Message[] = [
  { id: "u1", role: "user", kind: "text", at: 1, text: "Sync the team's rules." },
  { id: "r1", role: "bot", kind: "text", at: 2, text: reply },
  // the engine flagged the turn after it answered: its reply, stored as the cause
  { id: "e1", role: "bot", kind: "activity", at: 3, tool: failedTurnTool(reply) },
  { id: "u2", role: "user", kind: "text", at: 4, text: "And the weekly summary?" },
  // a real failure, no reply: its card stays
  { id: "e2", role: "bot", kind: "activity", at: 5, tool: failedTurnTool("Claude is overloaded right now (HTTP 529). This is usually temporary, so try again in a few minutes.") },
] as Message[];

function Row({ message }: { message: Message }) {
  if (message.role === "user") {
    return <div className="flex justify-end"><div className="w-fit max-w-[78%] rounded-[18px] bg-bubble-user px-3 py-[7px] text-[13px] leading-5 text-ink">{message.text}</div></div>;
  }
  if (message.kind === "text") {
    return (
      <div className="flex flex-col items-start">
        <div className="w-fit max-w-[94%] rounded-[18px] bg-bubble-bot px-3 py-[7px] text-[13px] leading-5 text-ink" data-chat-bubble data-who="bot">
          <ChatMarkdown text={message.text ?? ""} />
        </div>
      </div>
    );
  }
  const cause = failedTurnCause(message.tool!.name) ?? "";
  return <ErrorRow message={cause} onRetry={() => {}} />;
}

function Gallery() {
  const hidden = before ? new Set<string>() : repeatedFailureIds(MESSAGES, "bot");
  return (
    <div className="min-h-screen bg-canvas p-6 text-ink">
      <div data-shot="thread" className="mx-auto flex max-w-[760px] flex-col gap-3 rounded-2xl bg-app p-5">
        {MESSAGES.filter((message) => !hidden.has(message.id)).map((message) => <Row key={message.id} message={message} />)}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gallery />
  </StrictMode>,
);

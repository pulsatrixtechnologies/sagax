/** Isolated gallery for headless screenshots of run-sheet step labels
 * (V10): short runCommand targets without UUIDs or full server paths, and
 * folded tool searches. Synthetic data only. Not shipped.
 * ?skin=<id>&lang=<code> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ActivityRun } from "../components/ActivityRun";
import { ToolActivity } from "../components/ToolActivity";
import { ActivityStepGroups } from "../components/task/ActivityStepGroups";
import { loadLocale } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { BotActivityStep } from "../../shared/bot-activity";
import type { Message } from "../state/store";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");

const NOW = Date.UTC(2026, 10, 1, 14, 0);
const BOT_DIR = "/data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const PLUGIN_DIR = `${BOT_DIR}/sagax-plugins`;

const step = (id: string, name: string, ok: boolean | undefined, input: Record<string, unknown>, at: number, where: "server" | "computer" = "server"): BotActivityStep => ({
  id,
  name,
  at,
  where,
  ...(ok === undefined ? {} : { ok }),
  input: JSON.stringify(input),
  summary: typeof input.command === "string" ? input.command : typeof input.query === "string" ? input.query : undefined,
});

const sheetSteps: BotActivityStep[] = [
  step("s1", "search_tool", true, { query: "perspicax tickets" }, NOW + 1_000),
  step("s2", "use_tool", true, { tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }, NOW + 2_000),
  step("s3", "search_tool", true, { query: "remote session" }, NOW + 3_000),
  step("s4", "use_tool", true, { tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }, NOW + 4_000),
  step("s5", "use_tool", true, { tool_name: "perspicax__acme_desk__query", tool_input: { resource: "service.tickets" } }, NOW + 5_000),
  step("s6", "ToolSearch", true, { query: "select:Bash" }, NOW + 6_000),
  step("s7", "Bash", true, { command: `ls ${PLUGIN_DIR}` }, NOW + 7_000),
  step("s8", "Bash", true, { command: `python ${BOT_DIR}/workspace/scripts/check_health.py --bot a1b2c3d4-e5f6-7890-abcd-ef1234567890` }, NOW + 8_000),
  step("s9", "Bash", true, { command: "git status\n--porcelain" }, NOW + 9_000),
];

const toMessage = (entry: BotActivityStep, index: number): Message => ({
  id: entry.id,
  role: "bot",
  kind: "activity",
  at: entry.at || NOW + index * 1_000,
  tool: {
    name: entry.name,
    ok: entry.ok,
    input: entry.input,
    summary: entry.summary,
  },
} as Message);

const exchangeMessages = sheetSteps.map(toMessage);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-6 text-ink" data-shot="step-labels">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8">
        <section data-shot="run-sheet" className="rounded-2xl border border-hairline/50 bg-panel p-4 shadow-sm">
          <h1 className="mb-1 text-[15px] font-medium">Run sheet steps</h1>
          <p className="mb-3 text-[12px] text-ink-secondary">ActivityStepGroups: short command targets, folded tool searches.</p>
          <ActivityStepGroups steps={sheetSteps} />
        </section>
        <section data-shot="exchange" className="rounded-2xl border border-hairline/50 bg-panel p-4 shadow-sm">
          <h1 className="mb-1 text-[15px] font-medium">Routine run exchange</h1>
          <p className="mb-3 text-[12px] text-ink-secondary">Same labels as the chat: ActivityRun + ToolActivity.</p>
          <ActivityRun
            messages={exchangeMessages}
            elapsedMs={12_000}
            renderStep={(message) => <ToolActivity tool={message.tool!} defaultOpen={false} />}
          />
        </section>
      </div>
    </div>
  </StrictMode>,
);

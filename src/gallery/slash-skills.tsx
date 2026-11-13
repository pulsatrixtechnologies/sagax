/** Isolated gallery for Playwright screenshots of the composer's "/" menu
 * with the bot's own commands (skills) listed. Not shipped in the app.
 * ?skin=<id>&lang=<code>&q=<typed after the slash>&mode=after|before
 * `before` builds the menu without the bot's skills, as origin/main did. */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerCommandMenu } from "../components/ComposerCommandMenu";
import { composerCommandMenu, type ComposerSlashCommand } from "../lib/composer-commands";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import type { HarnessCommand } from "../../shared/harness-commands";
import { TEACH_TASK_OFFERED } from "../../shared/teach-task";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");
const query = params.get("q") ?? "";
const before = params.get("mode") === "before";

const sagax: ComposerSlashCommand[] = [
  ...(TEACH_TASK_OFFERED ? [{ id: "learn" as const, label: "/learn", description: t("composer.command.learnDesc") }] : []),
  { id: "setup", label: "/setup", description: t("composer.command.setupDesc") },
];
const engine: HarnessCommand[] = [
  { name: "compact", description: "Free up context", group: "engine", argumentHint: "<instructions>" },
  { name: "context", description: "Show context usage", group: "engine" },
];
const skills = [
  { name: "presentation", description: "Give your name and say hello" },
  { name: "weekly-report", description: "Summarize this week's work as three bullets" },
];

function Gallery() {
  const items = composerCommandMenu(sagax, engine, query, before ? [] : skills);
  return (
    <div className="flex min-h-screen items-end bg-app p-6">
      <div className="relative h-[26rem] w-[30rem]">
        <div className="absolute inset-x-0 bottom-0 rounded-[22px] border border-border bg-composer px-4 py-3 chat-input-text">/{query}</div>
        <div className="absolute inset-x-0 bottom-14">
          <ComposerCommandMenu items={items} highlight={0} loading={false} onPick={() => {}} onHighlight={() => {}} className="!static !mb-0" />
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<StrictMode><Gallery /></StrictMode>);

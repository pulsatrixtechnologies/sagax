/** Isolated gallery for person-UI skill list + editor (view, edit, review
 * changes). Synthetic data only. ?skin=&lang=&view=list|editor|review */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { SkillEditorPage } from "../components/bot-settings/SkillEditorPage";
import { BotEditorContext } from "../components/bot-settings/BotEditorContext";
import { PaneEmpty, PaneSection } from "../components/bot-settings/PaneSection";
import { Switch } from "../components/SettingsPrimitives";
import { skillSourceLabel } from "../lib/skills-ui";
import { loadLocale, t } from "../lib/i18n";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { cn } from "../lib/cn";
import "../styles.css";

Object.assign(globalThis, { __APP_VERSION__: "0.8.24", __BASE_VERSION__: "0.26.0" });

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "en");
const view = params.get("view") ?? "list";
const width = Number(params.get("width") ?? 420);
const height = Number(params.get("height") ?? 720);

const SKILL_MD = `---
name: order-audit
description: Audit every order against the ledger.
---

# Order audit

Check every line item. Flag mismatches plainly.
`;

const REVIEWED_MD = `---
name: order-audit
description: Audit every order against the ledger.
---

# Order audit

Check every line item.
`;

const skills = [
  {
    name: "order-audit",
    description: "Audit every order against the ledger.",
    enabled: false,
    source: "learn:inbox/alex/order-audit.SKILL.md",
    warnings: ["stored SKILL.md changed after review - enablement is blocked"],
    origin: "private" as const,
  },
  {
    name: "connectwise-time-entry-checklist",
    description: "Checklist before posting ConnectWise time.",
    enabled: true,
    source: "local-import",
    warnings: [] as string[],
    origin: "me" as const,
    assignedBots: [{ id: "atlas", name: "Atlas" }, { id: "scout", name: "Scout" }],
  },
];

const editorPayload = {
  name: "order-audit",
  text: SKILL_MD,
  description: "Audit every order against the ledger.",
  source: "learn:inbox/alex/order-audit.SKILL.md",
  enabled: false,
  changedAfterReview: view === "review",
  reviewedText: view === "review" ? REVIEWED_MD : null,
  warnings: ["stored SKILL.md changed after review - enablement is blocked"],
  files: [
    { path: "README.md", bytes: 32, kind: "text" as const },
    { path: "refs/example.txt", bytes: 12, kind: "text" as const },
  ],
  editable: true,
  origin: "private" as const,
};

/** Skill history (#2610): a bot revision after a correction, the person's
 * own edit, and the bot's first draft. */
const HOUR = 3_600_000;
const HISTORY = [
  { id: "v3", at: Date.now() - 2 * HOUR, by: "bot", gist: "Flag mismatches plainly, after the person corrected the wording.", before: REVIEWED_MD, after: SKILL_MD },
  { id: "v2", at: Date.now() - 26 * HOUR, by: "person", gist: "", before: REVIEWED_MD.replace("Check every line item.", "Check the totals."), after: REVIEWED_MD },
  { id: "v1", at: Date.now() - 50 * HOUR, by: "bot", gist: "", before: null, after: REVIEWED_MD.replace("Check every line item.", "Check the totals.") },
];

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method === "GET" && path.endsWith("/history")) return { versions: HISTORY };
  if (method === "GET" && path.includes("/skills/order-audit") && !path.includes("/files")) {
    return editorPayload;
  }
  if (method === "GET" && path.includes("/files")) {
    return { text: "# Supporting file\n\nFixture notes.\n", kind: "text" };
  }
  if (method === "PUT" || method === "POST") return { ok: true };
  return {};
}

function ListFixture() {
  return (
    <div className="flex flex-col gap-3 px-3.5 py-4" data-gallery-ready="" data-gallery-view="list">
      <PaneSection title={t("botPanel.skills.title")} help={t("botPanel.skills.whenRelevant")}>
        <button type="button" className="flex items-center gap-1 self-start rounded-lg px-1 py-1 text-[12.5px] font-medium text-accent-text">
          {t("botPanel.skills.manageInConnectApps")}
        </button>
        {skills.length === 0 ? (
          <PaneEmpty>{t("botPanel.skills.empty")}</PaneEmpty>
        ) : (
          <div className="-mx-3.5 mt-3 divide-y divide-hairline/40 border-t border-hairline/40">
            {skills.map((skill) => (
              <div key={skill.name} className="px-3.5 py-2.5" data-skill-row={skill.name}>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-left">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <div className="truncate font-mono text-[12.5px] text-ink">{skill.name}</div>
                      <span className="shrink-0 rounded bg-control px-1 py-px font-mono text-[9.5px] uppercase tracking-wide text-ink-secondary">
                        {skill.origin === "private" ? t("botPanel.skills.originPrivate") : t("botPanel.skills.originShared")}
                      </span>
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[11.5px] text-ink-secondary">{skill.description}</div>
                  </div>
                  <Switch checked={skill.enabled} aria-label={skill.name} onClick={() => {}} />
                </div>
                {skill.source && (
                  <details className="mt-1 text-[10.5px] text-ink-secondary" open={skill.name === "order-audit"} data-skill-source={skill.name}>
                    <summary className="cursor-pointer select-none">
                      {t("botPanel.skills.sourceLabel", { label: skillSourceLabel(skill.source) })}
                    </summary>
                    <p className="mt-0.5 break-all font-mono text-[10px]">{skill.source}</p>
                  </details>
                )}
                {"assignedBots" in skill && skill.assignedBots && (
                  <div className="mt-1 text-[10.5px] text-ink-secondary">
                    {t("botPanel.skills.sharedWith", { bots: skill.assignedBots.map((entry) => entry.name).join(", ") })}
                  </div>
                )}
                {skill.warnings.some((warning) => warning.includes("changed after review")) && (
                  <div className="mt-1 text-[10.5px] text-warning" data-skill-warning={skill.name}>
                    <span>{t("botPanel.skills.changedAfterReview")}</span>
                    {" · "}
                    <span className="font-medium text-accent-text">{t("botPanel.skills.reviewChanges")}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </PaneSection>
    </div>
  );
}

function Gallery() {
  if (view === "list") return <ListFixture />;
  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-app")} data-gallery-ready="" data-gallery-view={view}>
      <BotEditorContext.Provider value={{ request: request as never }}>
        <SkillEditorPage
          botId="atlas"
          target={{ name: "order-audit", origin: "private", startEditing: view === "edit" }}
          onClose={() => {}}
          onSaved={() => {}}
        />
      </BotEditorContext.Provider>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div style={{ width, height }} className="bg-app text-ink" data-gallery-skill-editor="">
      <Gallery />
    </div>
  </StrictMode>,
);

// Auto-enter review mode after the editor payload loads.
if (view === "review") {
  const start = Date.now();
  const tick = () => {
    const button = document.querySelector<HTMLButtonElement>("[data-skill-review-changes]");
    if (button) {
      button.click();
      return;
    }
    if (Date.now() - start < 5_000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

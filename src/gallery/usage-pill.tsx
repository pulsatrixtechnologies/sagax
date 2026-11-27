/** Isolated gallery for headless screenshots of the usage pill (#5406,
 * M-20261126-095, M-20261126-096, M-20261126-099, M-20261126-108): every
 * shape in four situations (the real UsagePill), and the pill under a message
 * box with its detail open (the real ComposerMeterView and
 * UsageAccountsDetail) for 1, 3 and 10 accounts. Mocked accounts only, with
 * invented names, and a mocked limit report (the server's verdict, #5421):
 * an account at 100% of its week is blocked, except `state=extra` (Extra
 * Usage still free). `state=local`: every account blocked, a local model
 * free. No server. Not shipped in the app.
 * ?skin=<id>&lang=<code>&view=shapes|detail&accounts=<1|3|10>&state=free|blocked|extra|local&folds=open&shape=<shape> */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ComposerMeterView } from "../components/ComposerMeter";
import { MENU_ROW } from "../components/menu-look";
import { UsagePill } from "../components/UsagePill";
import { loadLocale, t } from "../lib/i18n";
import type { EngineLimit } from "../../shared/limit-reset";
import type { PlanRow, PlanWindow } from "../lib/plan-usage";
import { applySkin, readSkin, SKIN_IDS, type SkinId } from "../lib/skins";
import { servingAccounts, usagePill, type UsageAccount } from "../lib/usage-pill";
import { parseUsagePillShape, USAGE_PILL_SHAPES } from "../lib/usage-pill-preferences";
import "../styles.css";

const params = new URLSearchParams(location.search);
const skinParam = params.get("skin") as SkinId | null;
applySkin(skinParam && (SKIN_IDS as readonly string[]).includes(skinParam) ? skinParam : readSkin());
await loadLocale(params.get("lang") ?? "fr");

const H = 3_600_000;
const NOW = Date.parse("2026-11-26T19:00:00Z");
const iso = (at: number) => new Date(at).toISOString();
const win = (used: number | null, inHours = 50): PlanWindow => ({ available: used !== null, remainingPercent: used === null ? null : 100 - used, usedPercent: used, resetsAt: used === null ? null : iso(NOW + inHours * H) });
const row = (id: string, name: string, driver: string, plan: string | null, fiveHour: number | null, weekly: number, back = 50): PlanRow => ({
  id, name, driver, plan, state: "windows", access: "subscription", instanceId: id, instanceIds: [id], message: null,
  fiveHour: win(fiveHour, 3), weekly: win(weekly, back), extra: [], models: [],
});

const TEN: PlanRow[] = [
  row("bots", "ada.bots@acme.test", "claude", null, 12, 41),
  row("four", "nimbus-4@acme.test", "claude", null, 0, 18),
  row("codex", "ada@acme.test", "codex", "Business", null, 55),
  row("five", "nimbus-5@acme.test", "claude", null, 22, 9),
  row("seven", "nimbus-7@acme.test", "claude", null, 3, 12),
  row("codex-3", "nimbus-3@acme.test", "codex", "Plus", null, 30),
  row("eight", "nimbus-8@acme.test", "claude", null, 40, 35),
  row("own", "ada@acme.test", "claude", null, 23, 100, 55),
  row("six", "nimbus-6@acme.test", "claude", null, 80, 100, 59),
  row("codex-2", "nimbus-2@acme.test", "codex", "Plus", null, 100, 120 + 29 / 60),
];
const THREE: PlanRow[] = [TEN[0]!, TEN[1]!, TEN[2]!];
const THREE_BLOCKED: PlanRow[] = [row("bots", "ada.bots@acme.test", "claude", null, 12, 100, 55), row("own", "ada@acme.test", "claude", null, 23, 100, 59), row("codex", "ada@acme.test", "codex", "Business", null, 100, 120 + 29 / 60)];
const count = params.get("accounts") ?? "3";
const state = params.get("state") ?? "free";
const blocked = state === "blocked" || state === "local";
const rows = state === "extra" ? [row("bots", "ada.bots@acme.test", "claude", null, 12, 100, 55)]
  : count === "10" ? TEN : count === "1" ? (blocked ? [THREE_BLOCKED[0]!] : [TEN[0]!]) : blocked ? THREE_BLOCKED : THREE;
/** The mocked limit report: a week at 100% blocks, unless Extra Usage still has room. */
const limitsOf = (list: PlanRow[]): EngineLimit[] => list.map((entry) => ({
  engine: entry.id, name: entry.name, driver: entry.driver as EngineLimit["driver"], window: "weekly", usedPercent: entry.weekly.usedPercent,
  resetsAt: entry.weekly.resetsAt ? Date.parse(entry.weekly.resetsAt) : null, blocked: state !== "extra" && (entry.weekly.usedPercent ?? 0) >= 100,
}));
const accountsOf = (list: PlanRow[]) => servingAccounts({
  rows: list, serves: [...list.map((entry) => entry.id), ...(state === "local" ? ["local"] : [])], engine: "bots", limits: limitsOf(list),
  engineName: (engine) => (engine === "local" ? "Ollama" : engine), now: NOW,
});

/** The mock-up's four situations, as sums: all is well, 3 accounts full of 10,
 * everything blocked, a conversation that is nearly full; then #5421's two: a
 * week at 100% that Extra Usage still serves, and every account blocked with
 * a local model free. */
const sum = (weekly: number, fiveHour: number, over: Partial<UsageAccount> = {}): UsageAccount[] => [{
  id: "sum", name: "sum", plan: null, fiveHour, weekly, hours: 5, serving: true, blocked: false, backAt: null, driver: "claude", ...over,
}];
const held = { blocked: true, backAt: NOW + 55 * H };
const SITUATIONS = [
  { accounts: sum(22, 12), context: 34 },
  { accounts: [...sum(44, 20), ...sum(44, 20, { id: "second", serving: false })], context: 60 },
  { accounts: sum(100, 12, held), context: 34 },
  { accounts: sum(30, 15), context: 92 },
  { accounts: sum(100, 12), context: 34 },
  { accounts: [...sum(100, 12, { ...held, serving: false }), { id: "engine:local", name: "Ollama", plan: null, fiveHour: null, weekly: null, hours: 5, serving: true, blocked: false, backAt: null, driver: "" }], context: 34 },
];

function Shapes() {
  return (
    <div data-gallery-sample="shapes" className="inline-flex flex-col gap-3 rounded-2xl border border-hairline/60 bg-panel p-5">
      {USAGE_PILL_SHAPES.map((shape) => (
        <div key={shape} data-gallery-shape={shape} className="grid grid-cols-[150px_repeat(6,max-content)] items-center gap-x-5">
          <span className="text-[13px] text-ink">{t(`settings.usagePill.shape.${shape}`)}</span>
          {SITUATIONS.map((situation, index) => (
            <span key={index} className="flex h-6 items-center rounded-full border border-hairline/40 px-2 text-[12px] leading-4 text-ink-secondary">
              <UsagePill shape={shape} values={usagePill({ accounts: situation.accounts, context: situation.context, now: NOW })} />
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Detail() {
  const accounts = accountsOf(rows);
  return (
    <div data-gallery-sample="detail" className="w-[720px] pt-[330px]">
      <div className="h-11 rounded-full bg-composer" />
      <div data-composer-under-row="" className="@container/composer relative z-[1] w-full">
        <div className="flex min-h-7 items-center gap-2 px-2 pt-1">
          <span className="text-[12px] text-ink-secondary">Auto</span>
          <span className="ml-auto flex min-w-0 items-center">
            <ComposerMeterView
              initialOpen="usage"
              initialFolds={params.get("folds") === "open" ? { moreFree: true, limited: true } : undefined}
              now={NOW}
              shape={parseUsagePillShape(params.get("shape"))}
              context={{ percent: 42, detail: t("chat.usage.contextOfWindow", { tokens: "84k", percent: "42", window: "200k" }) }}
              usage={{ accounts, favorite: { id: "bots", onToggle: () => undefined } }}
              contextActions={<button type="button" className={MENU_ROW}>{t("contextWarning.compactNow")}</button>}
              usageActions={() => (
                <>
                  <button type="button" role="menuitem" className={MENU_ROW}>{t("chat.limit.continueAt", { time: "21 h" })}</button>
                  <button type="button" role="menuitem" className={MENU_ROW}>{t("sendBlock.switchEngine")}</button>
                  <button type="button" role="menuitem" className={MENU_ROW}>{t("chat.notice.weekly.more")}</button>
                </>
              )}
            />
          </span>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="min-h-screen bg-app p-8 text-ink">{params.get("view") === "detail" ? <Detail /> : <Shapes />}</div>
  </StrictMode>,
);

// Compose "Create new Bot" dispatches `{ type: "newBot" }` and closes: instant
// create, no NewBotDialog, no Start from, no Browse templates.
// Templates live in Plugins → Bot templates (the catalogue titled Browse
// Bots). Plugins is the sidebar foot's round apps-grid button, named
// "Connect apps" until 0.8.52 (UX reference 8.0 bis). The sidebar has no
// Browse Bots button.
// NewBotDialog stays on Team map → manage a named team → New Bot.
// Unassigned (`data-team-key=""`) has no New Bot: TeamDialog.managing is
// Boolean(section) && !rename, and an empty key is falsy.

import { jsLiteral } from "./js-literal.mjs";
import { clickAccessible, dismissOverlays } from "./ui-click.ts";

export type CatalogFlow = {
  click: (name: string) => Promise<unknown>;
  flag: (assignment: string) => Promise<unknown>;
  snapshot: () => Promise<string>;
};

export type NewBotFlow = {
  click: (name: string) => Promise<unknown>;
  evaluate: (js: string) => Promise<unknown>;
  snapshot: () => Promise<string>;
};

async function until(probe: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`${what} did not appear within ${timeoutMs}ms`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** Import and Share a team sit on the Templates section, on the catalogue
 * home and on View all. */
export function catalogTemplateTools(snap: string): boolean {
  return snap.includes("Import") && snap.includes("Share a team");
}

/** The sidebar foot's round apps-grid button (FootConnectApps). */
export const PLUGINS_BUTTON = "Plugins";

/** View all or a bot detail. The hosted home is heading "Browse Bots", and
 * its Back returns to Plugins, so that Back is not a step to click. */
export function nestedTemplatesCatalog(snap: string): boolean {
  return snap.includes('button "Back"')
    && !snap.includes('heading "Browse Bots"')
    && (snap.includes("Browse Bots") || snap.includes('heading "Templates"'));
}

/** Open Plugins, then Bot templates. Import / Share a team are on that
 * catalogue's Templates section. A catalogue already open on a detail walks
 * Back until those tools show; the home's own Back is left alone. */
export async function openTemplatesCatalog(flow: CatalogFlow): Promise<void> {
  await flow.flag("features.templates=true");
  if (catalogTemplateTools(await flow.snapshot())) return;
  const snap = await flow.snapshot();
  const inWindow = snap.includes('button "Bot templates"')
    || snap.includes('heading "Browse Bots"')
    || nestedTemplatesCatalog(snap);
  if (!inWindow) await flow.click(PLUGINS_BUTTON);
  await until(async () => {
    const next = await flow.snapshot();
    if (catalogTemplateTools(next)) return true;
    if (nestedTemplatesCatalog(next)) {
      await flow.click("Back");
      return false;
    }
    if (next.includes('button "Bot templates"')) await flow.click("Bot templates");
    return false;
  }, 12_000, "Browse Bots template tools");
}

/** New Bot's first row (newBot.startingRole): a pill menu since #596, no
 * native select. */
export const START_FROM = "Start from";

/** The open New Bot form. From a team it is a view in the team's detail
 * panel (`data-new-bot-form`, TeamDialog since 0.8.27), elsewhere a dialog. */
export const NEW_BOT_ROOT_JS = `(document.querySelector("[data-new-bot-form]") || [...document.querySelectorAll("[role=dialog]")].at(-1))`;

/** The team editor's root: the detail panel (`data-team-dialog`, 0.8.27), or
 * a dialog. */
const TEAM_EDITOR_ROOT_JS = `(document.querySelector("[data-team-dialog]") || [...document.querySelectorAll("[role=dialog]")].at(-1))`;

/** Open Start from if it is closed, then pick the option with this label.
 * True once picked; poll it, the first call only opens the menu. */
export function chooseStartFromJs(label: string): string {
  return `(() => {
    const dialog = ${NEW_BOT_ROOT_JS};
    const pill = dialog?.querySelector('button[aria-label="${START_FROM}"]');
    if (!pill || pill.disabled) return false;
    const list = document.querySelector('[role=listbox][aria-label="${START_FROM}"]');
    if (!list) { pill.click(); return false; }
    const option = [...list.querySelectorAll("[role=option]")].find((item) => item.textContent.trim() === ${jsLiteral(label)});
    option?.click();
    return Boolean(option);
  })()`;
}

/** The group headings of the open Start from menu, opening it if needed. */
export function startFromGroupsJs(): string {
  return `(() => {
    const dialog = ${NEW_BOT_ROOT_JS};
    const list = document.querySelector('[role=listbox][aria-label="${START_FROM}"]');
    if (!list) { dialog?.querySelector('button[aria-label="${START_FROM}"]')?.click(); return null; }
    return [...list.querySelectorAll("[data-pill-group]")].map((heading) => heading.textContent.trim()).join(" | ");
  })()`;
}

/** NewBotDialog with Start from: Team map, a named team, New Bot. */
export async function openNewBotDialog(flow: NewBotFlow): Promise<void> {
  const hasStartingRole = async () => (await flow.snapshot()).includes(START_FROM);
  const createBotReady = async () => Boolean(await flow.evaluate(`Boolean([...(${NEW_BOT_ROOT_JS}?.querySelectorAll("button") ?? [])].find((button) => (button.textContent || "").trim() === "Create bot"))`));
  if (await hasStartingRole() && await createBotReady()) return;
  await dismissOverlays(flow, (snap) => snap.includes(START_FROM) && snap.includes("Create bot"));
  const click = (name: string) => clickAccessible(flow, name);

  const hasNewBot = async () => {
    const snap = await flow.snapshot();
    return snap.includes("New Bot") && (snap.includes("Add or remove bots") || snap.includes("Add bots") || snap.includes("Existing bots"));
  };
  if (await hasNewBot()) {
    await click("New Bot");
    await until(hasStartingRole, 12_000, "New Bot dialog");
    return;
  }

  const onTeamMap = async () => Boolean(await flow.evaluate(`Boolean(document.querySelector("[data-team-key]"))`));
  if (!(await onTeamMap())) {
    // Team map sits in the account menu's Tools submenu (#1064), as the
    // other team smokes reach it (team-computers-ui, team-canvas-ui).
    await click("You");
    await click("Tools");
    await click("Team map");
    await until(onTeamMap, 12_000, "Team map");
  }

  const namedTeam = async () => (await flow.evaluate(`([...document.querySelectorAll("[data-team-key]")].map((el) => el.getAttribute("data-team-key")).find(Boolean) || "")`)) as string;
  let team = await namedTeam();
  if (!team) {
    await flow.evaluate(`(() => {
      const summary = document.querySelector('summary[aria-label="Add to team map"]');
      if (!summary) throw new Error("Add to team map is missing");
      const details = summary.parentElement;
      if (details && !("open" in details && details.open)) summary.click();
      return true;
    })()`);
    await until(async () => (await flow.snapshot()).includes("Create team"), 10_000, "Create team");
    await click("Create team");
    await until(async () => Boolean(await flow.evaluate(`Boolean(${TEAM_EDITOR_ROOT_JS}?.querySelector("input"))`)), 10_000, "Team name");
    await flow.evaluate(`(() => {
      const input = ${TEAM_EDITOR_ROOT_JS}?.querySelector("input");
      if (!(input instanceof HTMLInputElement)) throw new Error("Team name is missing");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "Desk");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return input.value;
    })()`);
    await click("Create team");
    await until(async () => Boolean(await flow.evaluate(`Boolean(document.querySelector('[data-team-key="Desk"]'))`)), 12_000, "Desk team");
    team = "Desk";
  }

  await flow.evaluate(`(() => {
    const summary = document.querySelector(${JSON.stringify(`[data-team-key="${team}"] summary`)})
      || document.querySelector('summary[aria-label^="Manage "]');
    if (!summary) throw new Error("no named team to manage");
    const details = summary.parentElement;
    if (details && !("open" in details && details.open)) summary.click();
    return true;
  })()`);
  const move = `Move bots to ${team}`;
  await until(async () => (await flow.snapshot()).includes(move), 10_000, move);
  await click(move);
  await until(async () => (await flow.snapshot()).includes("New Bot"), 10_000, "New Bot");
  await click("New Bot");
  await until(hasStartingRole, 12_000, "New Bot dialog");
}

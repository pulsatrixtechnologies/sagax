// #2175: Settings keep one card level (docs/design/ux-reference-grokbot-cursor.md
// 2.5, AGENTS.md "Settings layout: one card level"): a page is grey section
// headings over flat cards of rows, never a card drawn inside another card.
// A collapsible section (Advanced) is a heading with a disclosure whose
// content unfolds as sibling sections, not a card holding cards.
//
// The shared primitives mark their surfaces with `data-settings-surface`; the
// class test below also catches a card drawn by hand (rounded + card border or
// elevated background), as the headless scan over the galleries does.

const CARD = /(^|\s)rounded-(?:xl|2xl|\[14px\]|\[16px\])(\s|$)/;
const SURFACE = /(^|\s)(?:border-border|bg-elevated|border-hairline)(\s|$)/;
const FLOATING = /(^|\s)(?:absolute|fixed)(\s|$)/;
const NOT_A_CARD = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "IMG", "SUMMARY"]);

/** A card surface: a shared primitive's surface, or an element styled as one
 * (rounded with the card border or background). Controls, images and floating
 * layers (popovers, overlays) are not cards. Hidden content is skipped: a fold
 * is opened with `openFolds` before the check. */
export function isCardSurface(node: Element): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (NOT_A_CARD.has(node.tagName)) return false;
  const className = typeof node.className === "string" ? node.className : "";
  const marked = node.hasAttribute("data-settings-surface");
  if (!marked && !(CARD.test(className) && SURFACE.test(className))) return false;
  if (FLOATING.test(className)) return false;
  if (node.hidden || node.closest("[hidden]")) return false;
  return true;
}

export function describeSurface(node: Element): string {
  const attrs = [...node.attributes].filter((attr) => attr.name.startsWith("data-") || attr.name === "id").map((attr) => `${attr.name}="${attr.value}"`).join(" ");
  const text = (node.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return `<${node.tagName.toLowerCase()} ${attrs}> class="${(node.className as string).slice(0, 90)}" text="${text}"`;
}

/** Every card surface under `root` that sits inside another card surface. */
export function nestedSurfaces(root: Element): Array<{ outer: string; inner: string }> {
  const out: Array<{ outer: string; inner: string }> = [];
  for (const node of root.querySelectorAll("*")) {
    if (!isCardSurface(node)) continue;
    let parent = node.parentElement;
    while (parent && parent !== root) {
      if (isCardSurface(parent)) { out.push({ outer: describeSurface(parent), inner: describeSurface(node) }); break; }
      parent = parent.parentElement;
    }
  }
  return out;
}

/** Opens one round of folds under `root`: every closed `<details>` and every
 * collapsed disclosure (`aria-expanded="false"` with `aria-controls`) outside
 * the navigation. Returns how many it opened; call until it returns 0. */
export function openFolds(root: Element, click: (button: HTMLElement) => void = (button) => button.click()): number {
  let opened = 0;
  for (const details of root.querySelectorAll<HTMLDetailsElement>("details:not([open])")) { details.open = true; opened += 1; }
  for (const button of root.querySelectorAll<HTMLElement>('[aria-expanded="false"][aria-controls]')) {
    const target = root.ownerDocument.getElementById(button.getAttribute("aria-controls") ?? "");
    if (!target || target.getAttribute("role")) continue;
    if (button.closest("nav")) continue;
    click(button);
    opened += 1;
  }
  return opened;
}

/** The shared rows of Settings (`DescribedRow`, `CompactRow`, `SettingRow`,
 * `FieldRow`, `LinkRow`, `SwitchRow`) carry `data-settings-rowkind`. */
const SHARED_ROW = "[data-settings-rowkind]";

function insideCard(node: Element, root: Element): boolean {
  let parent = node.parentElement;
  while (parent && parent !== root) {
    if (isCardSurface(parent)) return true;
    parent = parent.parentElement;
  }
  return false;
}

/** Rows drawn off the reference (JC 2026-11-07, Developer in Experimental): a
 * shared row standing outside any card (a fold row left loose on the page,
 * indented under a heading), and a switch that is not in a shared row (a row
 * made by hand). Every row of a settings page is a shared row in a card
 * (docs/design/ux-reference-grokbot-cursor.md 2.5, AGENTS.md "Settings
 * layout"). Hidden content is skipped: open the folds first. */
export function rowsOffReference(root: Element): string[] {
  const out: string[] = [];
  for (const row of root.querySelectorAll(SHARED_ROW)) {
    if (row.closest("[hidden]")) continue;
    if (!insideCard(row, root)) out.push(`row outside a card: ${describeSurface(row)}`);
  }
  for (const control of root.querySelectorAll('[role="switch"]')) {
    if (control.closest("[hidden]")) continue;
    // a switch in a row's `below` slot is a hand-drawn row nested under it
    const owner = control.closest(`${SHARED_ROW}, [data-settings-below]`);
    if (!owner || owner.hasAttribute("data-settings-below")) out.push(`switch outside a shared row: ${describeSurface(control.parentElement ?? control)}`);
  }
  out.push(...mixedIconRows(root));
  return out;
}

/** One page, one row style (JC 2026-11-07, Context pods in Experimental): on a
 * page either every shared row carries an icon tile (Providers) or none does
 * (General). A lone tile among plain rows is drawn off the reference. */
export function mixedIconRows(root: Element): string[] {
  const withIcon: Element[] = [];
  const without: Element[] = [];
  for (const row of root.querySelectorAll(SHARED_ROW)) {
    if (row.closest("[hidden]")) continue;
    // a row nested in another row's below slot belongs to that row's body
    if (row.parentElement?.closest("[data-settings-below]")) continue;
    (row.querySelector(":scope [data-settings-icon]") && row.querySelector("[data-settings-icon]")?.closest(SHARED_ROW) === row ? withIcon : without).push(row);
  }
  if (!withIcon.length || !without.length) return [];
  const minority = withIcon.length <= without.length ? withIcon : without;
  const kind = minority === withIcon ? "an icon tile among rows without" : "no icon tile among rows with";
  return minority.map((row) => `mixed row style, ${kind}: ${describeSurface(row)}`);
}

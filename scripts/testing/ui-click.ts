// Headless agent-browser refuses a click whose hit-test lands on a covering
// pane (`div.min-h-0.flex-1`). These helpers click the real node by
// accessible name, and close catalog/settings overlays so the sidebar is
// hittable again.
import { jsLiteral } from "./js-literal.mjs";

/** The chat header's bot pill (chat.openPanelAria): it opens the bot panel. */
export function openPanelAria(name: string): string {
  return `Open ${name}'s panel`;
}

export function clickByAccessibleNameJs(name: string): string {
  return `(() => {
    const name = ${jsLiteral(name)};
    const visible = (el) => {
      if (!(el instanceof Element) || el.closest("[disabled], [aria-disabled='true']")) return false;
      if (el instanceof HTMLButtonElement && el.disabled) return false;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const match = (el) => {
      if (!visible(el)) return false;
      const label = (el.getAttribute("aria-label") || "").trim();
      const text = (el.textContent || "").replace(/\\s+/g, " ").trim();
      return label === name || text === name;
    };
    const pick = (root) => {
      const found = [...root.querySelectorAll("button, [role=button], [aria-label], a")].filter(match);
      return found[found.length - 1] || null;
    };
    const catalog = document.querySelector("[data-bot-catalog-modal]");
    const dialogs = [...document.querySelectorAll("[role=dialog]")];
    const top = catalog || dialogs[dialogs.length - 1];
    const el = (top && pick(top)) || pick(document);
    if (!el) return false;
    el.click();
    return true;
  })()`;
}

/** Settings > a page, by its entry in the left nav. A page name can also be a
 * section heading elsewhere (General has an Appearance section), so a click
 * by accessible name is ambiguous. False until the lazy Settings chunk paints. */
export function openSettingsPageJs(page: string): string {
  return `(() => {
    const entry = [...document.querySelectorAll('[role="dialog"] nav button')].find((button) => button.textContent.trim() === ${jsLiteral(page)});
    entry?.click();
    return Boolean(entry);
  })()`;
}

/** The bot panel's bot menu (Edit bot, Rename, Archive...). The reference
 * look keeps no "..." in the panel's header (UX reference 2.3, 0.8.52): the
 * menu is a right click on the mascot or the name, so this sends that right
 * click to the open panel's name. False until the panel paints. */
export function openBotMenuJs(): string {
  return `(() => {
    const target = document.querySelector("aside[data-panel-bot] [data-bot-name-title]");
    if (!target) return false;
    if (document.querySelector("[data-bot-actions-menu]")) return true;
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    return Boolean(document.querySelector("[data-bot-actions-menu]"));
  })()`;
}

/** Plugins' own close button, in its frame's header (PluginsPanelFrame,
 * data-tour="apps-close"). Its accessible name is just "Close", like the
 * close of any other dialog on screen, so a click by name can hit the wrong
 * one (#3910). False while Plugins is not open. */
export function closePluginsJs(): string {
  return `(() => {
    const close = document.querySelector("[data-plugins-page] [data-tour='apps-close']");
    close?.click();
    return Boolean(close);
  })()`;
}

export function overlaysOpenJs(): string {
  return `Boolean(document.querySelector("[data-bot-catalog-modal], [role=dialog]"))`;
}

export function dismissTopOverlayJs(): string {
  return `(() => {
    const catalog = document.querySelector("[data-bot-catalog-modal]");
    if (catalog) {
      const close = catalog.querySelector("[aria-label='Close']");
      if (close) { close.click(); return "catalog"; }
    }
    const dialogs = [...document.querySelectorAll("[role=dialog]")];
    const top = dialogs[dialogs.length - 1];
    if (!top) return null;
    const close = top.querySelector("[aria-label='Close'], [aria-label='Close settings']")
      || [...top.querySelectorAll("button")].find((button) => /^(Close|Cancel|Done)$/.test((button.textContent || "").trim()));
    if (close) { close.click(); return "dialog"; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return "escape";
  })()`;
}

export async function clickAccessible(flow: {
  click: (name: string) => Promise<unknown>;
  evaluate: (js: string) => Promise<unknown>;
}, name: string): Promise<void> {
  if (await flow.evaluate(clickByAccessibleNameJs(name))) return;
  await flow.click(name);
}

export async function dismissOverlays(flow: {
  evaluate: (js: string) => Promise<unknown>;
  snapshot: () => Promise<string>;
}, keepIf: (snap: string) => boolean = () => false): Promise<void> {
  const deadline = Date.now() + 12_000;
  for (;;) {
    const snap = await flow.snapshot();
    if (keepIf(snap)) return;
    if (!(await flow.evaluate(overlaysOpenJs()))) return;
    if (Date.now() > deadline) throw new Error("overlays did not close within 12000ms");
    await flow.evaluate(dismissTopOverlayJs());
  }
}

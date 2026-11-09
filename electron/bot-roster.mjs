// The bots' roster and global shortcut chords. The page (the brain) sends the
// roster (the visible bots, in order); the main process maps Cmd+Shift+N to
// the Nth bot. Pure and covered by node:test (electron/bot-roster.node-test.mjs).

/** Most bots with a global shortcut (1 to 9). */
export const MAX_HOTKEY_BOTS = 9;
const MAX_NAME = 60;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** What the page may send, checked: at most nine bots, text capped, no id shown. */
export function normalizeRoster(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (out.length >= MAX_HOTKEY_BOTS) break;
    if (!item || typeof item !== "object") continue;
    const id = typeof item.id === "string" && item.id.length > 0 && item.id.length <= 200 ? item.id : "";
    const name = typeof item.name === "string" ? item.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME) : "";
    if (!id || !name) continue;
    const unread = Number.isFinite(item.unread) ? Math.max(0, Math.min(99, Math.floor(item.unread))) : item.unread === true ? 1 : 0;
    out.push({
      id,
      name,
      color: typeof item.color === "string" && HEX.test(item.color) ? item.color : "#8E8E93",
      working: item.working === true,
      unread,
    });
  }
  return out;
}

/** The chords Settings offers for the bots' global shortcuts (the number is the slot). */
export const HOTKEY_MODIFIERS = Object.freeze({
  "cmd-shift": "CommandOrControl+Shift",
  "cmd-alt": "CommandOrControl+Alt",
  "ctrl-alt": "Control+Alt",
});
export const DEFAULT_HOTKEY_MODIFIER = "cmd-shift";

/** What the page may ask of the shortcuts, checked: on by default, a known chord. */
export function normalizeBotHotkeyConfig(value) {
  const record = value && typeof value === "object" ? value : {};
  return {
    enabled: record.enabled !== false,
    modifier: Object.hasOwn(HOTKEY_MODIFIERS, record.modifier) ? record.modifier : DEFAULT_HOTKEY_MODIFIER,
  };
}

/** macOS reserves Cmd+Shift+3, 4 and 5 for screenshots: a bot never takes them. */
export function slotAccelerator(slot, platform = process.platform, modifier = DEFAULT_HOTKEY_MODIFIER) {
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_HOTKEY_BOTS) return null;
  const key = Object.hasOwn(HOTKEY_MODIFIERS, modifier) ? modifier : DEFAULT_HOTKEY_MODIFIER;
  if (platform === "darwin" && key === "cmd-shift" && slot >= 3 && slot <= 5) return null;
  return `${HOTKEY_MODIFIERS[key]}+${slot}`;
}

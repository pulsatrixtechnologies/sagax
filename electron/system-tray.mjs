// The system tray: Windows notification area (Open / Quit) and the macOS menu
// bar (the bots' list: a dot in the bot's mascot color, "working" and unread
// state, Cmd+Shift+N to open one). The page (the brain) sends the roster; this
// module only turns it into a menu. The menu model is pure and covered by
// node:test (electron/system-tray.node-test.mjs).

/** Most bots the menu lists (one global shortcut each, 1 to 9). */
export const MAX_TRAY_BOTS = 9;
const MAX_NAME = 60;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** What the page may send, checked: at most nine bots, text capped, no id shown. */
export function normalizeRoster(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (out.length >= MAX_TRAY_BOTS) break;
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
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_TRAY_BOTS) return null;
  const key = Object.hasOwn(HOTKEY_MODIFIERS, modifier) ? modifier : DEFAULT_HOTKEY_MODIFIER;
  if (platform === "darwin" && key === "cmd-shift" && slot >= 3 && slot <= 5) return null;
  return `${HOTKEY_MODIFIERS[key]}+${slot}`;
}

/** English defaults; the page sends the person's language (normalizeTrayLabels). */
export const DEFAULT_TRAY_LABELS = Object.freeze({
  bots: "Bots",
  botsUnread: "Bots ({count} unread)",
  working: "working",
  unread: "unread",
  unreadMany: "{count} unread",
  open: "Open Sagax",
  quit: "Quit Sagax",
  tooltipUnread: "Sagax ({count} unread)",
  tooltipWorking: "Sagax ({count} working)",
});

/** The menu's words, checked: known keys only, short text, defaults for the rest. */
export function normalizeTrayLabels(value) {
  const out = { ...DEFAULT_TRAY_LABELS };
  if (value && typeof value === "object") {
    for (const key of Object.keys(DEFAULT_TRAY_LABELS)) {
      const text = value[key];
      if (typeof text === "string" && text.trim() && text.length <= 80) out[key] = text.replace(/[\r\n]+/g, " ").trim();
    }
  }
  return out;
}

const fill = (text, count) => text.replace("{count}", String(count));

/** The menu line's text: the name, then its state. */
export function rosterLabel(bot, labels = DEFAULT_TRAY_LABELS) {
  const state = bot.working ? labels.working : bot.unread > 0 ? (bot.unread > 1 ? fill(labels.unreadMany, bot.unread) : labels.unread) : "";
  return state ? `${bot.name} (${state})` : bot.name;
}

/**
 * The tray menu as an Electron template.
 * @param {{ roster: ReturnType<typeof normalizeRoster>, labels?: typeof DEFAULT_TRAY_LABELS, hotkeys?: { enabled: boolean, modifier: string } | null, platform?: string, icon?: (bot: object) => unknown, onOpenBot: (id: string) => void, onShow: () => void, onQuit: () => void }} input
 */
export function buildTrayMenuTemplate({ roster, platform = process.platform, icon, onOpenBot, onShow, onQuit, labels = DEFAULT_TRAY_LABELS, hotkeys = null }) {
  const items = [];
  const bots = normalizeRoster(roster);
  const unreadTotal = bots.reduce((sum, bot) => sum + bot.unread, 0);
  if (bots.length > 0) {
    items.push({ label: unreadTotal > 0 ? fill(labels.botsUnread, unreadTotal) : labels.bots, enabled: false });
    bots.forEach((bot, index) => {
      const accelerator = platform === "darwin" && hotkeys?.enabled !== false ? slotAccelerator(index + 1, platform, hotkeys?.modifier) : null;
      const image = icon?.(bot);
      items.push({
        label: rosterLabel(bot, labels),
        ...(image ? { icon: image } : {}),
        // shown beside the name; the global shortcut itself is registered by mascot-hotkey.mjs
        ...(accelerator ? { accelerator, registerAccelerator: false } : {}),
        click: () => onOpenBot(bot.id),
      });
    });
    items.push({ type: "separator" });
  }
  items.push({ label: labels.open, click: onShow });
  items.push({ type: "separator" });
  items.push({ label: labels.quit, click: onQuit });
  return items;
}

/**
 * A 16 px (drawn at `scale` x) round dot in the bot's mascot color, as the
 * BGRA bitmap nativeImage.createFromBitmap reads. A working bot gets a white
 * center. Anti-aliased by coverage of the edge.
 */
export function statusDotBitmap(color, { working = false, size = 16, scale = 2 } = {}) {
  const hex = HEX.test(String(color)) ? String(color) : "#8E8E93";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const px = size * scale;
  const buffer = Buffer.alloc(px * px * 4);
  const mid = (px - 1) / 2;
  const outer = px / 2 - 1.5 * scale;
  const inner = outer * 0.4;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      const d = Math.hypot(x - mid, y - mid);
      const alpha = Math.max(0, Math.min(1, outer - d + 0.5));
      const core = working ? Math.max(0, Math.min(1, inner - d + 0.5)) : 0;
      const at = (y * px + x) * 4;
      buffer[at] = Math.round(b + (255 - b) * core);
      buffer[at + 1] = Math.round(g + (255 - g) * core);
      buffer[at + 2] = Math.round(r + (255 - r) * core);
      buffer[at + 3] = Math.round(alpha * 255);
    }
  }
  return { buffer, width: px, height: px, scaleFactor: scale };
}

/**
 * The macOS menu bar icon: a template image (black on transparent, drawn by
 * the system in the bar's light or dark and in its highlight) when the
 * monochrome mark is there, else the colored app icon, small.
 */
export function macTrayImage(nativeImage, iconPath, templatePath) {
  if (templatePath) {
    try {
      const image = nativeImage.createFromPath(templatePath);
      if (image && !image.isEmpty()) {
        // trayTemplate@2x.png sits beside the 1x mark; createFromPath reads one file
        const retinaPath = templatePath.replace(/\.png$/i, "@2x.png");
        if (retinaPath !== templatePath && typeof image.addRepresentation === "function") {
          try {
            const retina = nativeImage.createFromPath(retinaPath);
            const size = retina && !retina.isEmpty() && typeof retina.getSize === "function" ? retina.getSize() : null;
            if (size && size.width > 0 && size.height > 0 && typeof retina.toPNG === "function") {
              image.addRepresentation({
                scaleFactor: 2,
                width: size.width / 2,
                height: size.height / 2,
                buffer: retina.toPNG(),
              });
            }
          } catch {
            /* the 1x mark is enough */
          }
        }
        image.setTemplateImage(true);
        return image;
      }
    } catch {
      /* the colored icon below */
    }
  }
  return nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 });
}

// Retain the Windows notification-area identity across app restarts.
export function createSystemTray({ Tray, Menu, nativeImage, iconPath, getWindow, onQuit, platform = process.platform, onOpenBot = () => {}, templatePath = null }) {
  const mac = platform === "darwin";
  const tray = mac
    ? new Tray(macTrayImage(nativeImage, iconPath, templatePath))
    : new Tray(nativeImage.createFromPath(iconPath).resize({ width: 20, height: 20 }),
      "889af657-21b5-4ec9-b5d0-cb798cbdfd30");
  let roster = [];
  let labels = DEFAULT_TRAY_LABELS;
  let hotkeys = null;
  const dots = new Map();
  const dotFor = (bot) => {
    if (typeof nativeImage.createFromBitmap !== "function") return undefined;
    const key = `${bot.color}:${bot.working}`;
    if (!dots.has(key)) {
      const { buffer, width, height, scaleFactor } = statusDotBitmap(bot.color, { working: bot.working });
      dots.set(key, nativeImage.createFromBitmap(buffer, { width, height, scaleFactor }));
    }
    return dots.get(key);
  };
  let hidden = false;
  const show = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return false;
    hidden = false;
    win.setSkipTaskbar(false);
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    return true;
  };
  tray.setToolTip("Sagax");
  const rebuild = () => {
    tray.setContextMenu(Menu.buildFromTemplate(buildTrayMenuTemplate({
      roster, platform, labels, hotkeys, icon: dotFor, onOpenBot, onShow: show, onQuit,
    })));
  };
  rebuild();
  // macOS opens the menu on a click; Windows opens the window.
  if (!mac) {
    tray.on("click", show);
    tray.on("double-click", show);
  }
  return {
    show,
    /** The page's bots: the menu lists them (macOS and Windows). Returns the checked roster. */
    setRoster(value) {
      roster = normalizeRoster(value);
      rebuild();
      const unread = roster.reduce((sum, bot) => sum + bot.unread, 0);
      const working = roster.filter((bot) => bot.working).length;
      tray.setToolTip(unread > 0 ? fill(labels.tooltipUnread, unread) : working > 0 ? fill(labels.tooltipWorking, working) : "Sagax");
      return roster;
    },
    /** The person's language for the menu (the page sends it with the roster). */
    setLabels(value) {
      labels = normalizeTrayLabels(value);
      this.setRoster(roster);
      return labels;
    },
    /** The shortcuts shown beside the names follow the setting. */
    setHotkeys(value) {
      hotkeys = normalizeBotHotkeyConfig(value);
      rebuild();
    },
    hide(win) { hidden = true; win.setSkipTaskbar(true); win.hide(); },
    isHidden() { return hidden; },
    windowShown(win) { hidden = false; win.setSkipTaskbar(false); },
    /** The person's custom app icon (Windows notification area). */
    setIcon(image) {
      if (mac || tray.isDestroyed() || !image || image.isEmpty?.()) return;
      tray.setImage(image.resize({ width: 20, height: 20 }));
    },
    destroy() { if (!tray.isDestroyed()) tray.destroy(); },
  };
}

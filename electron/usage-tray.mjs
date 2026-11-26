// The usage icon of the macOS menu bar and of the Windows notification area
// (#5407): two bars, the week and the short session window, every account
// together. macOS shows the figure beside the icon; Windows cannot write
// text beside a notification icon, so the figure and the short detail go in
// the tooltip. A click opens the usage detail (main.mjs).
//
// The figures are not computed here: the page hands over one small value,
// `{ week, session, text }` (src/lib/menu-bar-usage.ts), and this file only
// draws it. Electron-free (Tray and nativeImage are passed in), so the
// drawing, the text and the life cycle are tested with plain fakes.
import zlib from "node:zlib";

const MAX_TEXT = 24;
const MAX_TOOLTIP = 120; // Windows cuts a notification tooltip at 127 characters

function percent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

function line(value, max) {
  if (typeof value !== "string") return "";
  // one printable line (a tooltip keeps its line breaks)
  const kept = [...value].filter((char) => char === "\n" || char.charCodeAt(0) >= 0x20).join("").trim();
  return [...kept].slice(0, max).join("");
}

/** The value the page hands over, made safe: percents from 0 to 100 or null
 * (no account reports that window), the figure beside the icon, and the
 * short detail of the tooltip. Anything else reads as "no figure". */
export function normalizeUsageValues(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    week: percent(source.week),
    session: percent(source.session),
    text: line(source.text, MAX_TEXT).replace(/\n/g, " "),
    tooltip: line(source.tooltip, MAX_TOOLTIP),
  };
}

// ── drawing ──────────────────────────────────────────────────────────────

/** Coverage of a rounded rectangle at one point (inside or not). */
function inRoundedRect(px, py, { x, y, w, h, r }) {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const radius = Math.min(r, w / 2, h / 2);
  const cx = px < x + radius ? x + radius : px > x + w - radius ? x + w - radius : px;
  const cy = py < y + radius ? y + radius : py > y + h - radius ? y + h - radius : py;
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

const SAMPLES = 4;

/** Shapes (in points, drawn in order, straight alpha) to RGBA pixels at one
 * scale factor, 4x4 samples per pixel for the round ends. */
function rasterize(width, height, scale, shapes) {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const rgba = Buffer.alloc(w * h * 4);
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const shape of shapes) {
        let hit = 0;
        for (let sy = 0; sy < SAMPLES; sy += 1) {
          for (let sx = 0; sx < SAMPLES; sx += 1) {
            if (inRoundedRect((px + (sx + 0.5) / SAMPLES) / scale, (py + (sy + 0.5) / SAMPLES) / scale, shape)) hit += 1;
          }
        }
        if (hit === 0) continue;
        const [sr, sg, sb, sa] = shape.color;
        const alpha = (sa * hit) / (SAMPLES * SAMPLES);
        const out = alpha + a * (1 - alpha);
        r = (sr * alpha + r * a * (1 - alpha)) / out;
        g = (sg * alpha + g * a * (1 - alpha)) / out;
        b = (sb * alpha + b * a * (1 - alpha)) / out;
        a = out;
      }
      const at = (py * w + px) * 4;
      rgba[at] = Math.round(r);
      rgba[at + 1] = Math.round(g);
      rgba[at + 2] = Math.round(b);
      rgba[at + 3] = Math.round(a * 255);
    }
  }
  return { width: w, height: h, rgba };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, tail]);
}

/** RGBA pixels (straight alpha) as a PNG file. */
export function encodePng({ width, height, rgba }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// macOS: a template image (black, the alpha carries the drawing), so the
// menu bar tints it for its light or dark look by itself.
const MAC_TRACK = [0, 0, 0, 0.3];
const MAC_FILL = [0, 0, 0, 1];
// Windows: the notification area is dark or light whatever the app's own
// theme, so the colours are ones that read on both.
const WIN_TRACK = [138, 140, 147, 0.5];
const WIN_OK = [74, 144, 226, 1];
const WIN_WARN = [217, 164, 65, 1];
const WIN_FULL = [232, 119, 106, 1];

function winColor(used) {
  return used >= 100 ? WIN_FULL : used >= 75 ? WIN_WARN : WIN_OK;
}

/** The icon's size in points and its shapes: on macOS two bars lying down
 * (week above, session below), on Windows two bars standing (week at the
 * left, session at the right). A window nobody reports keeps its empty
 * track. */
export function usageIconShapes({ week, session }, platform) {
  const values = [percent(week), percent(session)];
  const shapes = [];
  if (platform === "darwin") {
    const size = { width: 24, height: 16 };
    values.forEach((used, index) => {
      const bar = { x: 1, y: 3 + index * 6, w: 22, h: 4, r: 2 };
      shapes.push({ ...bar, color: MAC_TRACK });
      // never thinner than its round ends, so 1% still shows
      if (used) shapes.push({ ...bar, w: Math.max(bar.h, (bar.w * used) / 100), color: MAC_FILL });
    });
    return { ...size, shapes };
  }
  const size = { width: 16, height: 16 };
  values.forEach((used, index) => {
    const bar = { x: 2 + index * 7, y: 1, w: 5, h: 14, r: 1.5 };
    shapes.push({ ...bar, color: WIN_TRACK });
    if (used) {
      const tall = Math.max(3, (bar.h * used) / 100);
      shapes.push({ ...bar, y: bar.y + bar.h - tall, h: tall, color: winColor(used) });
    }
  });
  return { ...size, shapes };
}

/** The scale the Windows icon is drawn at: the display's own (1.5 at 150 %),
 * between 1 and 4, 1 when unknown. */
function windowsScale(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(4, Math.max(1, value)) : 1;
}

/** The icon as PNG files, one per scale factor (1x and 2x). */
export function drawUsageIcon(values, platform, scales = [1, 2]) {
  const { width, height, shapes } = usageIconShapes(values, platform);
  return scales.map((scale) => ({ scale, width, height, png: encodePng(rasterize(width, height, scale, shapes)) }));
}

// ── life cycle ───────────────────────────────────────────────────────────

/** Only the macOS menu bar and the Windows notification area. */
export function usageTraySupported(platform) {
  return platform === "darwin" || platform === "win32";
}

/**
 * The icon's life: nothing exists while the setting is off; turned on, the
 * icon appears and the page is asked for its figures now, then at each click
 * and each `refresh()` (the window came back to the front, the account on
 * screen changed). This file keeps no timer: the page hands fresh figures
 * over at the app's background cadence (src/lib/menu-bar-usage.ts). The icon
 * is redrawn only when a figure changed. Off again or on quit, it is gone.
 */
export function createUsageTray({
  Tray,
  nativeImage,
  platform = process.platform,
  appName = "Sagax",
  onClick = () => {},
  requestFigures = () => {},
  displayScale = () => 1,
  log = () => {},
}) {
  let tray = null;
  let enabled = false;
  let disposed = false;
  let shown = null; // what the icon shows now, as one string
  let shownIcon = null; // the bars drawn now

  const scaleNow = () => {
    if (platform !== "win32") return 1;
    try { return windowsScale(displayScale()); } catch { return 1; }
  };

  const image = (values) => {
    if (platform === "win32") {
      // Electron's Windows tray builds its icon from the image's 1x bitmap
      // alone (NativeImage::GetHICON, Electron 44): a 2x representation is
      // never read. So the one bitmap is drawn at the display's own scale
      // (16 px at 100 %, 24 at 150 %, 32 at 200 %).
      const [only] = drawUsageIcon(values, platform, [scaleNow()]);
      return nativeImage.createFromBuffer(only.png, { scaleFactor: 1 });
    }
    const [first, ...rest] = drawUsageIcon(values, platform);
    const icon = nativeImage.createFromBuffer(first.png, { width: first.width, height: first.height, scaleFactor: first.scale });
    for (const next of rest) icon.addRepresentation({ scaleFactor: next.scale, width: next.width * next.scale, height: next.height * next.scale, buffer: next.png });
    if (platform === "darwin") icon.setTemplateImage(true);
    return icon;
  };

  const show = (values) => {
    if (!tray) return;
    const iconKey = `${values.week}|${values.session}|${scaleNow()}`;
    const key = `${JSON.stringify(values)}|${iconKey}`;
    if (key === shown) return;
    shown = key;
    try {
      if (iconKey !== shownIcon) tray.setImage(image(values));
      shownIcon = iconKey;
      if (platform === "darwin") tray.setTitle(values.text, { fontType: "monospacedDigit" });
      tray.setToolTip(values.tooltip || values.text ? `${appName} · ${values.tooltip || values.text}` : appName);
    } catch (error) {
      log(`usage tray: update failed: ${error?.message ?? error}`);
    }
  };

  const remove = () => {
    if (tray) {
      try { tray.destroy(); } catch { /* already gone */ }
    }
    tray = null;
    shown = null;
    shownIcon = null;
  };

  const ask = () => {
    try { requestFigures(); } catch { /* no page yet: it hands its figures over when it loads */ }
  };

  return {
    /** Settings > Appearance: the switch. Safe to call again with the same value. */
    setEnabled(on) {
      if (disposed) return;
      enabled = on === true && usageTraySupported(platform);
      if (!enabled) {
        remove();
        return;
      }
      if (tray) return;
      const empty = normalizeUsageValues(null);
      try {
        tray = new Tray(image(empty));
        tray.setIgnoreDoubleClickEvents?.(true);
        tray.on("click", () => {
          onClick();
          ask();
        });
      } catch (error) {
        log(`usage tray: not created: ${error?.message ?? error}`);
        remove();
        return;
      }
      // the tray was built with the empty bars: only its text is left to set
      shownIcon = `${empty.week}|${empty.session}|${scaleNow()}`;
      show(empty);
      ask();
    },
    /** The page's figures. Ignored while the setting is off. */
    update(values) {
      if (!enabled || !tray) return;
      show(normalizeUsageValues(values));
    },
    /** Ask the page again now (the window came back to the front, the
     * account on screen changed). */
    refresh() {
      if (enabled && tray) ask();
    },
    isShown: () => tray !== null,
    /** Quit: the icon goes, for good. */
    dispose() {
      disposed = true;
      enabled = false;
      remove();
    },
  };
}

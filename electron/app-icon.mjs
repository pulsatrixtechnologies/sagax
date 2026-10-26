// The person's custom app icon (Settings > Appearance > App icon). The page
// draws every icon through the system template (shared/app-icon-template.ts)
// and sends the finished PNGs; this module only checks them, keeps them in
// userData, and puts them on the Dock (macOS) or the windows and taskbar
// (Windows, Linux). It never touches the signed .app bundle, so Finder and
// Launchpad keep the bundle's icon: macOS reads that from the bundle on disk.
import fs from "node:fs";
import path from "node:path";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Sizes the page may send: the macOS master, Linux's, and the .ico set. */
export const APP_ICON_SIZES = Object.freeze([16, 20, 24, 32, 40, 48, 64, 256, 512, 1024]);
const MAX_PNG_BYTES = 4 * 1024 * 1024;
const ID = /^[a-z0-9][a-z0-9:._-]{0,63}$/;

/** The pixel size of a PNG buffer, or null when it is not a square PNG. */
export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.length > MAX_PNG_BYTES) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE) || buffer.toString("latin1", 12, 16) !== "IHDR") return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width === height && width > 0 ? width : null;
}

/** Turn the page's request into checked buffers, or throw. */
export function parseAppIconRequest(value) {
  if (!value || typeof value !== "object") throw new Error("app icon: expected an object");
  const id = typeof value.id === "string" && ID.test(value.id) ? value.id : null;
  if (!id) throw new Error("app icon: invalid id");
  if (!Array.isArray(value.images) || value.images.length === 0 || value.images.length > APP_ICON_SIZES.length) throw new Error("app icon: invalid images");
  const images = new Map();
  for (const entry of value.images) {
    if (!entry || typeof entry.png !== "string" || !entry.png.startsWith("data:image/png;base64,")) throw new Error("app icon: images must be PNG data URLs");
    const buffer = Buffer.from(entry.png.slice("data:image/png;base64,".length), "base64");
    const size = pngSize(buffer);
    if (!size || !APP_ICON_SIZES.includes(size) || entry.size !== size || images.has(size)) throw new Error("app icon: unexpected image size");
    images.set(size, buffer);
  }
  return { id, images: [...images].sort((a, b) => a[0] - b[0]).map(([size, png]) => ({ size, png })) };
}

/**
 * A Windows .ico holding PNG-compressed entries (Vista and later read them;
 * Electron's nativeImage loads every size from it, so the taskbar, the
 * window caption and Alt+Tab each pick the sharpest one).
 */
export function buildIco(images) {
  const entries = [...images].sort((a, b) => a.size - b.size);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const at = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)]);
}

/** Where the icon lives: `<userData>/app-icon/`. */
export function createAppIconStore(userData, { fsImpl = fs, now = () => Date.now() } = {}) {
  const dir = path.join(userData, "app-icon");
  const manifest = path.join(dir, "app-icon.json");
  const file = (name) => path.join(dir, name);
  const read = () => {
    try {
      const value = JSON.parse(fsImpl.readFileSync(manifest, "utf8"));
      if (!value || typeof value.id !== "string" || !ID.test(value.id) || !Array.isArray(value.files)) return null;
      const files = value.files.filter((name) => typeof name === "string" && /^icon-\d+\.(png|ico)$/.test(name) && fsImpl.existsSync(file(name)));
      if (!files.length) return null;
      return { id: value.id, updatedAt: Number(value.updatedAt) || 0, files };
    } catch {
      return null;
    }
  };
  return {
    dir,
    /** The saved choice, or null for the default icon. */
    load() {
      const saved = read();
      if (!saved) return null;
      const largest = saved.files.filter((name) => name.endsWith(".png")).sort((a, b) => Number(b.match(/\d+/)[0]) - Number(a.match(/\d+/)[0]))[0];
      return {
        id: saved.id,
        updatedAt: saved.updatedAt,
        png: largest ? file(largest) : null,
        ico: saved.files.includes("icon-0.ico") ? file("icon-0.ico") : null,
      };
    },
    /** Replace the saved icon. Writes the files, then the manifest last. */
    save({ id, images }, { ico = false } = {}) {
      fsImpl.mkdirSync(dir, { recursive: true });
      for (const name of fsImpl.readdirSync(dir)) if (/^icon-\d+\.(png|ico)$/.test(name)) fsImpl.rmSync(file(name), { force: true });
      const files = [];
      for (const { size, png } of images) {
        fsImpl.writeFileSync(file(`icon-${size}.png`), png);
        files.push(`icon-${size}.png`);
      }
      if (ico) {
        fsImpl.writeFileSync(file("icon-0.ico"), buildIco(images));
        files.push("icon-0.ico");
      }
      fsImpl.writeFileSync(manifest, JSON.stringify({ id, updatedAt: now(), files }));
      return this.load();
    },
    clear() {
      fsImpl.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Put an icon on screen. `saved` null restores the default. macOS sets the
 * Dock tile (null hands it back to the bundle's own icon, Liquid Glass
 * included); Windows and Linux set every window, so the taskbar follows,
 * and the notification-area icon (`tray`) when there is one.
 */
export function applyAppIcon(saved, { platform, app, windows, nativeImage, defaultIconPath, defaultDockIcon = null, tray = null }) {
  if (platform === "darwin") {
    if (!app?.dock) return "none";
    if (saved?.png) app.dock.setIcon(nativeImage.createFromPath(saved.png));
    // null gives the Dock back the bundle icon. An unpackaged run without a
    // compiled bundle icon shows the flat PNG it had before.
    else app.dock.setIcon(defaultDockIcon ?? null);
    return "dock";
  }
  const image = windowIconImage(saved, platform, nativeImage, defaultIconPath);
  for (const win of windows) if (win && !win.isDestroyed?.()) win.setIcon(image);
  if (tray) tray.setIcon(image);
  return "windows";
}

/**
 * The image Windows and Linux windows (and the tray) wear. Windows reads the
 * .ico; when that file cannot be decoded (Electron then hands back an empty
 * image, and setIcon(empty) silently keeps the old icon) the largest PNG
 * stands in, and the app's own icon is the last resort.
 */
export function windowIconImage(saved, platform, nativeImage, defaultIconPath) {
  const candidates = platform === "win32" ? [saved?.ico, saved?.png] : [saved?.png];
  for (const source of candidates) {
    if (!source) continue;
    const image = nativeImage.createFromPath(source);
    if (!image?.isEmpty?.()) return image;
  }
  return nativeImage.createFromPath(defaultIconPath);
}

/** The icon path new windows open with (Windows, Linux). */
export function windowIconPath(saved, platform, defaultIconPath) {
  if (!saved) return defaultIconPath;
  if (platform === "win32") return saved.ico ?? saved.png ?? defaultIconPath;
  return saved.png ?? defaultIconPath;
}

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { applyAppIcon, buildIco, createAppIconStore, parseAppIconRequest, pngSize, windowIconImage, windowIconPath } from "./app-icon.mjs";

/** A real (tiny, flat) square PNG of `size` pixels. */
function png(size) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buffer) => {
    let c = 0xffffffff;
    for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const raw = Buffer.alloc((size * 4 + 1) * size);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const dataUrl = (buffer) => `data:image/png;base64,${buffer.toString("base64")}`;

test("accepts square PNGs of the template sizes only", () => {
  assert.equal(pngSize(png(1024)), 1024);
  assert.equal(pngSize(Buffer.from("not a png")), null);
  const parsed = parseAppIconRequest({ id: "owl:gold", images: [{ size: 32, png: dataUrl(png(32)) }, { size: 16, png: dataUrl(png(16)) }] });
  assert.deepEqual(parsed.images.map((image) => image.size), [16, 32]);
  for (const bad of [
    null,
    { id: "../../etc", images: [{ size: 16, png: dataUrl(png(16)) }] },
    { id: "owl", images: [] },
    { id: "owl", images: [{ size: 17, png: dataUrl(png(17)) }] },
    { id: "owl", images: [{ size: 32, png: dataUrl(png(16)) }] },
    { id: "owl", images: [{ size: 16, png: "data:image/svg+xml;base64,PHN2Zy8+" }] },
    { id: "owl", images: [{ size: 16, png: dataUrl(png(16)) }, { size: 16, png: dataUrl(png(16)) }] },
  ]) assert.throws(() => parseAppIconRequest(bad));
});

test("writes a Windows .ico with every size, 256 recorded as 0", () => {
  const images = [256, 16, 48].map((size) => ({ size, png: png(size) }));
  const ico = buildIco(images);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  const sizes = [0, 1, 2].map((index) => ico.readUInt8(6 + index * 16));
  assert.deepEqual(sizes, [16, 48, 0]);
  const last = 6 + 2 * 16;
  const offset = ico.readUInt32LE(last + 12);
  assert.equal(pngSize(ico.subarray(offset, offset + ico.readUInt32LE(last + 8))), 256);
});

test("persists the choice in userData and restores it after a restart", () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "sagax-app-icon-"));
  try {
    const store = createAppIconStore(userData, { now: () => 42 });
    assert.equal(store.load(), null);
    const saved = store.save({ id: "owl:gold", images: [{ size: 1024, png: png(1024) }] });
    assert.equal(saved.id, "owl:gold");
    assert.equal(saved.png, path.join(userData, "app-icon", "icon-1024.png"));
    assert.equal(saved.ico, null);
    // a new process reads the same files
    const restored = createAppIconStore(userData).load();
    assert.deepEqual(restored, { ...saved });
    // a Windows save keeps the PNGs and an .ico; the old files go
    const win = store.save({ id: "upload", images: [16, 32, 256].map((size) => ({ size, png: png(size) })) }, { ico: true });
    assert.equal(win.png, path.join(userData, "app-icon", "icon-256.png"));
    assert.equal(win.ico, path.join(userData, "app-icon", "icon-0.ico"));
    assert.equal(fs.existsSync(path.join(userData, "app-icon", "icon-1024.png")), false);
    store.clear();
    assert.equal(createAppIconStore(userData).load(), null);
    // a damaged manifest means the default icon, never a crash
    fs.mkdirSync(path.join(userData, "app-icon"), { recursive: true });
    fs.writeFileSync(path.join(userData, "app-icon", "app-icon.json"), "{");
    assert.equal(store.load(), null);
  } finally {
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

function fakes() {
  const calls = [];
  const nativeImage = { createFromPath: (file) => ({ file }) };
  const app = { dock: { setIcon: (image) => calls.push(["dock", image]) } };
  const window = (destroyed = false) => ({ isDestroyed: () => destroyed, setIcon: (image) => calls.push(["window", image]) });
  return { calls, nativeImage, app, window };
}

test("macOS sets the Dock tile and hands it back to the bundle on reset", () => {
  const { calls, nativeImage, app, window } = fakes();
  const saved = { id: "owl", png: "/u/app-icon/icon-1024.png", ico: null };
  assert.equal(applyAppIcon(saved, { platform: "darwin", app, windows: [window()], nativeImage, defaultIconPath: "/default.png" }), "dock");
  applyAppIcon(null, { platform: "darwin", app, windows: [], nativeImage, defaultIconPath: "/default.png" });
  applyAppIcon(null, { platform: "darwin", app, windows: [], nativeImage, defaultIconPath: "/default.png", defaultDockIcon: "/default.png" });
  assert.deepEqual(calls, [["dock", { file: "/u/app-icon/icon-1024.png" }], ["dock", null], ["dock", "/default.png"]]);
});

test("Windows sets every live window from the .ico; Linux from the PNG", () => {
  const { calls, nativeImage, app, window } = fakes();
  const saved = { id: "owl", png: "/u/icon-256.png", ico: "/u/icon-0.ico" };
  assert.equal(applyAppIcon(saved, { platform: "win32", app, windows: [window(), window(true)], nativeImage, defaultIconPath: "/default.png" }), "windows");
  applyAppIcon(saved, { platform: "linux", app, windows: [window()], nativeImage, defaultIconPath: "/default.png" });
  applyAppIcon(null, { platform: "win32", app, windows: [window()], nativeImage, defaultIconPath: "/default.png" });
  assert.deepEqual(calls, [["window", { file: "/u/icon-0.ico" }], ["window", { file: "/u/icon-256.png" }], ["window", { file: "/default.png" }]]);
  assert.equal(windowIconPath(saved, "win32", "/d"), "/u/icon-0.ico");
  assert.equal(windowIconPath(saved, "linux", "/d"), "/u/icon-256.png");
  assert.equal(windowIconPath(null, "win32", "/d"), "/d");
});

test("Windows falls back to the PNG when the .ico cannot be decoded, and updates the tray", () => {
  const set = [];
  const nativeImage = { createFromPath: (file) => ({ file, isEmpty: () => file.endsWith(".ico") }) };
  const win = { isDestroyed: () => false, setIcon: (image) => set.push(["window", image.file]) };
  const tray = { setIcon: (image) => set.push(["tray", image.file]) };
  const saved = { id: "owl", png: "/u/icon-256.png", ico: "/u/icon-0.ico" };
  applyAppIcon(saved, { platform: "win32", app: {}, windows: [win], nativeImage, defaultIconPath: "/default.png", tray });
  assert.deepEqual(set, [["window", "/u/icon-256.png"], ["tray", "/u/icon-256.png"]]);
  assert.equal(windowIconImage({ id: "x", png: null, ico: "/u/icon-0.ico" }, "win32", nativeImage, "/default.png").file, "/default.png");
});

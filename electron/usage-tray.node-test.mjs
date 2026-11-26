import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import zlib from "node:zlib";

import { createUsageTray, drawUsageIcon, normalizeUsageValues, usageIconShapes, usageTraySupported } from "./usage-tray.mjs";

/** A PNG back to its size and RGBA pixels (8-bit RGBA, filter 0 rows only:
 * what encodePng writes). */
function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let at = 8;
  let width = 0;
  let height = 0;
  const data = [];
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      assert.equal(body[8], 8);
      assert.equal(body[9], 6);
    }
    if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const rows = zlib.inflateSync(Buffer.concat(data));
  const pixel = (x, y) => {
    assert.equal(rows[y * (width * 4 + 1)], 0);
    const start = y * (width * 4 + 1) + 1 + x * 4;
    return [...rows.subarray(start, start + 4)];
  };
  return { width, height, pixel };
}

function fakes(platform = "darwin", scale = { value: 1 }) {
  const trays = [];
  const asked = [];
  const clicks = [];
  class Tray {
    constructor(image) {
      this.image = image;
      this.images = [image];
      this.titles = [];
      this.tooltips = [];
      this.handlers = new Map();
      this.destroyed = false;
      trays.push(this);
    }
    setImage(image) { this.image = image; this.images.push(image); }
    setTitle(title, options) { this.titles.push([title, options]); }
    setToolTip(text) { this.tooltips.push(text); }
    setIgnoreDoubleClickEvents() {}
    on(event, handler) { this.handlers.set(event, handler); }
    destroy() { this.destroyed = true; }
  }
  const nativeImage = {
    createFromBuffer: (png, options) => {
      const image = { representations: [{ scaleFactor: options.scaleFactor, png }], template: false };
      image.addRepresentation = (next) => image.representations.push({ scaleFactor: next.scaleFactor, png: next.buffer });
      image.setTemplateImage = (on) => { image.template = on; };
      return image;
    },
  };
  const tray = createUsageTray({
    Tray,
    nativeImage,
    platform,
    onClick: () => clicks.push("click"),
    requestFigures: () => asked.push("ask"),
    displayScale: () => scale.value,
  });
  return { tray, trays, asked, clicks };
}

test("only the macOS menu bar and the Windows notification area get the icon", () => {
  assert.equal(usageTraySupported("darwin"), true);
  assert.equal(usageTraySupported("win32"), true);
  assert.equal(usageTraySupported("linux"), false);
  const linux = fakes("linux");
  linux.tray.setEnabled(true);
  assert.equal(linux.trays.length, 0);
  assert.equal(linux.asked.length, 0);
});

test("the page's value is made safe: percents from 0 to 100, one short line of text", () => {
  assert.deepEqual(normalizeUsageValues({ week: 44.4, session: 120, text: "44 %", tooltip: "week 44 %, 5 h 100 %" }), { week: 44, session: 100, text: "44 %", tooltip: "week 44 %, 5 h 100 %" });
  assert.deepEqual(normalizeUsageValues({ week: "44", session: Number.NaN, text: 12 }), { week: null, session: null, text: "", tooltip: "" });
  assert.deepEqual(normalizeUsageValues(null), { week: null, session: null, text: "", tooltip: "" });
  assert.equal(normalizeUsageValues({ text: `4\n4 %${"x".repeat(80)}` }).text.length, 24);
  assert.equal(normalizeUsageValues({ tooltip: "y".repeat(400) }).tooltip.length, 120);
});

test("macOS: two bars lying down, black with the alpha as the drawing, at 1x and 2x", () => {
  const [one, two] = drawUsageIcon({ week: 50, session: 0 }, "darwin");
  const small = decodePng(one.png);
  const large = decodePng(two.png);
  assert.deepEqual([small.width, small.height], [24, 16]);
  assert.deepEqual([large.width, large.height], [48, 32]);
  // the week bar (above): filled at the left, only its track at the right
  assert.deepEqual(small.pixel(6, 5), [0, 0, 0, 255]);
  const track = small.pixel(18, 5);
  assert.deepEqual(track.slice(0, 3), [0, 0, 0]);
  assert.ok(track[3] > 40 && track[3] < 120, `track alpha ${track[3]}`);
  // the session bar (below) at 0%: its track only
  assert.equal(small.pixel(6, 11)[3], track[3]);
  // between and around the bars: nothing
  assert.equal(small.pixel(12, 8)[3], 0);
  assert.equal(small.pixel(12, 0)[3], 0);
  // every pixel is black: a template image
  for (let y = 0; y < large.height; y += 1) {
    for (let x = 0; x < large.width; x += 1) assert.deepEqual(large.pixel(x, y).slice(0, 3), [0, 0, 0]);
  }
});

test("Windows: two bars standing in 16 by 16, coloured by how full they are", () => {
  const [one, two] = drawUsageIcon({ week: 44, session: 100 }, "win32");
  const small = decodePng(one.png);
  assert.deepEqual([small.width, small.height], [16, 16]);
  assert.deepEqual([decodePng(two.png).width, decodePng(two.png).height], [32, 32]);
  // week at the left, 44%: filled at the foot, track at the head
  assert.deepEqual(small.pixel(4, 13), [74, 144, 226, 255]);
  assert.ok(small.pixel(4, 3)[3] < 255 && small.pixel(4, 3)[3] > 0);
  // session at the right, at its limit: full height, the limit's colour
  assert.deepEqual(small.pixel(11, 3), [232, 119, 106, 255]);
  const warn = usageIconShapes({ week: 80, session: null }, "win32").shapes;
  assert.deepEqual(warn[1].color, [217, 164, 65, 1]);
  // a window nobody reports keeps its empty track: one shape, no fill
  assert.equal(warn.length, 3);
});

test("off: no icon, nothing asked; on: the icon, the figures asked now, at a click and at a refresh, never on a timer", () => {
  const { tray, trays, asked } = fakes();
  tray.update({ week: 10, session: 10, text: "10 %" });
  tray.refresh();
  assert.equal(trays.length, 0);
  assert.equal(asked.length, 0);
  tray.setEnabled(false);
  assert.equal(trays.length, 0);

  tray.setEnabled(true);
  assert.equal(trays.length, 1);
  assert.equal(tray.isShown(), true);
  assert.equal(asked.length, 1);
  // the window came back to the front, or the account on screen changed
  tray.refresh();
  assert.equal(asked.length, 2);
  trays[0].handlers.get("click")();
  assert.equal(asked.length, 3);
  // turned on twice: still one icon, nothing asked again
  tray.setEnabled(true);
  assert.equal(trays.length, 1);
  assert.equal(asked.length, 3);

  tray.setEnabled(false);
  assert.equal(trays[0].destroyed, true);
  assert.equal(tray.isShown(), false);
  tray.refresh();
  assert.equal(asked.length, 3);
  tray.update({ week: 10, session: 10, text: "10 %" });
  assert.equal(trays[0].images.length, 1);
});

test("macOS: a template image, the figure beside the icon, redrawn only when a figure changes", () => {
  const { tray, trays } = fakes("darwin");
  tray.setEnabled(true);
  const icon = trays[0];
  assert.equal(icon.image.template, true);
  assert.deepEqual(icon.image.representations.map((entry) => entry.scaleFactor), [1, 2]);
  assert.deepEqual(icon.titles.at(-1), ["", { fontType: "monospacedDigit" }]);
  assert.equal(icon.tooltips.at(-1), "Sagax");

  tray.update({ week: 44, session: 20, text: "44 %", tooltip: "week 44 %, 5 h 20 %" });
  assert.equal(icon.images.length, 2);
  assert.deepEqual(icon.titles.at(-1), ["44 %", { fontType: "monospacedDigit" }]);
  assert.equal(icon.tooltips.at(-1), "Sagax · week 44 %, 5 h 20 %");

  // the same figures again: nothing is touched
  const before = [icon.images.length, icon.titles.length, icon.tooltips.length];
  tray.update({ week: 44, session: 20, text: "44 %", tooltip: "week 44 %, 5 h 20 %" });
  assert.deepEqual([icon.images.length, icon.titles.length, icon.tooltips.length], before);

  // only the text changed: the title follows, the image stays
  tray.update({ week: 44, session: 20, text: "45 %", tooltip: "week 44 %, 5 h 20 %" });
  assert.equal(icon.images.length, 2);
  assert.deepEqual(icon.titles.at(-1), ["45 %", { fontType: "monospacedDigit" }]);

  tray.update({ week: 60, session: 20, text: "60 %" });
  assert.equal(icon.images.length, 3);
  assert.equal(icon.tooltips.at(-1), "Sagax · 60 %");
});

test("Windows: the icon alone, the figure and the detail in the tooltip", () => {
  const { tray, trays } = fakes("win32");
  tray.setEnabled(true);
  const icon = trays[0];
  assert.equal(icon.image.template, false);
  tray.update({ week: 44, session: 20, text: "44 %", tooltip: "week 44 %, 5 h 20 %" });
  assert.deepEqual(icon.titles, []);
  assert.equal(icon.tooltips.at(-1), "Sagax · week 44 %, 5 h 20 %");
});

test("a click opens the detail; quitting removes the icon for good", () => {
  const { tray, trays, asked, clicks } = fakes();
  tray.setEnabled(true);
  trays[0].handlers.get("click")();
  assert.deepEqual(clicks, ["click"]);
  tray.dispose();
  assert.equal(trays[0].destroyed, true);
  tray.setEnabled(true);
  tray.refresh();
  assert.equal(trays.length, 1);
  assert.equal(asked.length, 2);
});

test("the module keeps no timer of its own: the page's background cadence hands the figures over", () => {
  const source = readFileSync(new URL("./usage-tray.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /setInterval|setTimeout/);
});

test("Windows: one bitmap, drawn at the display's scale, since the tray reads the 1x bitmap alone", () => {
  // Electron's Windows tray never reads a 2x representation of an image made
  // from a buffer: the one representation carries the pixels for the display.
  const size = (image) => {
    assert.deepEqual(image.representations.map((entry) => entry.scaleFactor), [1]);
    const { width, height } = decodePng(image.representations[0].png);
    return [width, height];
  };
  for (const [factor, pixels] of [[1, 16], [1.25, 20], [1.5, 24], [2, 32], [9, 64], [Number.NaN, 16]]) {
    const { tray, trays } = fakes("win32", { value: factor });
    tray.setEnabled(true);
    assert.deepEqual(size(trays[0].image), [pixels, pixels], `scale ${factor}`);
    tray.update({ week: 44, session: 100, text: "44 %" });
    assert.deepEqual(size(trays[0].image), [pixels, pixels], `scale ${factor}, figures`);
  }
  // the 32 px image is the same drawing as the 2x file
  const two = fakes("win32", { value: 2 });
  two.tray.setEnabled(true);
  two.tray.update({ week: 44, session: 100, text: "44 %" });
  assert.deepEqual(two.trays[0].image.representations[0].png, drawUsageIcon({ week: 44, session: 100 }, "win32")[1].png);

  // the display's scale changed: the same figures are drawn again, larger
  const scale = { value: 1 };
  const { tray, trays } = fakes("win32", scale);
  tray.setEnabled(true);
  tray.update({ week: 44, session: 20, text: "44 %" });
  assert.deepEqual(size(trays[0].image), [16, 16]);
  const drawn = trays[0].images.length;
  tray.update({ week: 44, session: 20, text: "44 %" });
  assert.equal(trays[0].images.length, drawn);
  scale.value = 2;
  tray.update({ week: 44, session: 20, text: "44 %" });
  assert.equal(trays[0].images.length, drawn + 1);
  assert.deepEqual(size(trays[0].image), [32, 32]);
});

test("a shell that cannot make the icon stays without one", () => {
  const logged = [];
  const tray = createUsageTray({
    Tray: class { constructor() { throw new Error("no status area"); } },
    nativeImage: { createFromBuffer: () => ({ addRepresentation() {}, setTemplateImage() {} }) },
    platform: "win32",
    log: (line) => logged.push(line),
  });
  tray.setEnabled(true);
  assert.equal(tray.isShown(), false);
  assert.match(logged[0], /no status area/);
});

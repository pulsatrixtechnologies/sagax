// The desktop half of the mascot comparison: renders the same pages as the
// phone's DEBUG `MascotGalleryView` (launch arg `-mascotGallery <page>`) from
// the real desktop components (`BotAvatar`, so the same dispatcher), as
// static HTML, still (no animation). `ios/parity/mascot-gallery.sh` runs it
// and screenshots each page with headless Chrome at the iPhone 17 Pro size.
//
// Vitest only collects `src/**/*.test.ts`, so the script copies this file
// there for the run: `MASCOT_GALLERY_OUT=<dir> npx vitest run src/zz-mascot-gallery.test.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it } from "vitest";
import { BotAvatar } from "@/components/Avatar";
import { OwlAvatar } from "@/components/OwlAvatar";
import { loadAllBakedStills } from "@/components/shape-stills";
import { MASCOT_SKIN_IDS } from "../shared/mascot-skins";
import { OBJECT_SHAPE_BY_ID } from "../shared/shape-avatar-presets";
import ghost from "../third_party/open-bot-avatar/gallery/ghost.json" with { type: "json" };
import { MASCOT_SHAPES, SHAPE_SKINS, TROMBI_SKINS, type MascotLook } from "../shared/mascot-look";

const root = process.cwd();
const css = [
  readFileSync(join(root, "src/components/shape-mascot.css"), "utf8"),
  readFileSync(join(root, "src/components/retro-assistant/trombi.css"), "utf8"),
].join("\n");

type Look = MascotLook | undefined;
const avatar = (look: Look, color: string, size: number, skin = "none", state = "idle") =>
  h(BotAvatar, { bot: { name: "x", color, mascotLook: look, mascotSkin: skin } as never, size, animated: false, state } as never);

const row = (title: string, items: ReactNode[]) =>
  h("div", { className: "row" }, h("div", { className: "label" }, title), h("div", { className: "items" }, ...items));

function page(name: string): ReactNode[] {
  if (name === "shape") {
    return [
      ...SHAPE_SKINS.map((skin) => row(skin, MASCOT_SHAPES.map((shape) => avatar({ character: "shape", shape, skins: { shape: skin } }, "purple", 36)))),
      row("sizes, colours", [
        avatar({ character: "shape" }, "red", 24),
        avatar({ character: "shape" }, "red", 42),
        avatar({ character: "shape" }, "red", 85),
        avatar({ character: "shape", shape: "cloud", skins: { shape: "glossy" } }, "blue", 85),
      ]),
      row(
        "moods: thinking, working, happy, sleeping",
        ["thinking", "working", "happy", "sleeping"].map((state) => avatar({ character: "shape", shape: "squircle" }, "teal", 60, "none", state)),
      ),
    ];
  }
  if (name === "shape-set") {
    // the phone's `shape-set` page: every shape once, the skins on the star, the engine's moods
    const colors = ["tomato", "jade", "violet", "honey", "cobalt", "white", "black", "teal"];
    const skins = (list: readonly (typeof SHAPE_SKINS)[number][]) => list.map((skin) => avatar({ character: "shape", shape: "star", skins: { shape: skin } }, "purple", 44));
    return [
      h("div", { className: "grid" }, ...MASCOT_SHAPES.map((shape, i) => avatar({ character: "shape", shape }, colors[i % colors.length]!, 40))),
      row("skins", skins(SHAPE_SKINS.slice(0, 7))),
      row("skins", skins(SHAPE_SKINS.slice(7))),
      row("moods: idle, thinking, happy; 24, 85", [
        avatar({ character: "shape", shape: "brain" }, "teal", 60),
        avatar({ character: "shape", shape: "brain" }, "teal", 60, "none", "thinking"),
        avatar({ character: "shape", shape: "brain" }, "teal", 60, "none", "happy"),
        avatar({ character: "shape" }, "red", 24),
        avatar({ character: "shape", shape: "cloud", skins: { shape: "glossy" } }, "blue", 85),
      ]),
    ];
  }
  if (name === "shape-skins") {
    // the phone's `shape-skins` page: each premium skin's layers on our shapes and a gallery one
    return SHAPE_SKINS.slice(4).map((skin) =>
      row(skin, [
        ...(["circle", "star", "gem", "brain"] as const).map((shape) => avatar({ character: "shape", shape, skins: { shape: skin } }, "purple", 36)),
        avatar({ character: "shape", shape: "cloud", skins: { shape: skin } }, "teal", 36),
        avatar({ character: "shape", shape: "circle", skins: { shape: skin } }, "purple", 60),
      ]),
    );
  }
  if (name === "shape-own") {
    // the phone's `shape-own` page: a pasted definition and an own drawing, in skins and moods (#4159)
    const pasted = { ...ghost, id: "my-ghost", name: "My ghost" } as never;
    const own = { ...OBJECT_SHAPE_BY_ID.cup, id: "my-own-mascot", name: "My own" } as never;
    return ([["pasted", "pumpkin", pasted], ["own drawing", "circle", own]] as const).flatMap(([label, shape, avatarDef]) => [
      row(`${label}: plain, neon, gold, outline, chrome`, (["plain", "neon", "gold", "outline", "chrome"] as const).map((skin) =>
        avatar({ character: "shape", shape, skins: { shape: skin }, avatarDef }, "purple", 44))),
      row(`${label}: idle, thinking, happy; 24, 85`, [
        avatar({ character: "shape", shape, avatarDef }, "teal", 60),
        avatar({ character: "shape", shape, avatarDef }, "teal", 60, "none", "thinking"),
        avatar({ character: "shape", shape, avatarDef }, "teal", 60, "none", "happy"),
        avatar({ character: "shape", shape, avatarDef }, "red", 24),
        avatar({ character: "shape", shape, skins: { shape: "glossy" }, avatarDef }, "blue", 85),
      ]),
    ]);
  }
  if (name === "trombi") {
    return [
      ...TROMBI_SKINS.map((skin) => row(skin, [24, 42, 85].map((size) => avatar({ character: "trombi", skins: { trombi: skin } }, "green", size)))),
      row(
        "poses: idle, think, celebrate, sleep",
        ["idle", "working", "happy", "sleeping"].map((state) => avatar({ character: "trombi" }, "green", 85, "none", state)),
      ),
    ];
  }
  if (name === "group") {
    return [
      row("owl wings open (still), alert, sleepy", [
        h(OwlAvatar, { color: "green", size: 85, animated: false, wings: 1 }),
        h(OwlAvatar, { color: "red", size: 85, animated: false, state: "alert" }),
        h(OwlAvatar, { color: "purple", size: 85, animated: false, state: "sleepy" }),
      ]),
    ];
  }
  return MASCOT_SKIN_IDS.map((skin) =>
    row(skin, [
      avatar(undefined, "green", 24, skin),
      avatar(undefined, "green", 42, skin),
      avatar(undefined, "blue", 42, skin),
      avatar(undefined, "black", 42, skin),
      avatar(undefined, "white", 42, skin),
      avatar(undefined, "green", 85, skin),
    ]),
  );
}

it("renders the mascot gallery pages", async () => {
  const out = process.env.MASCOT_GALLERY_OUT;
  if (!out) return;
  // a page draws the shapes once their stills are loaded
  await loadAllBakedStills();
  for (const name of ["owl", "shape", "shape-set", "shape-skins", "shape-own", "trombi", "group"]) {
    const body = renderToStaticMarkup(h("main", null, h("div", { className: "title" }, `desktop · ${name}`), ...page(name)));
    const html = `<!doctype html><meta charset="utf-8"><style>
      html,body{margin:0;background:#141414;width:402px;height:874px;overflow:hidden}
      main{padding:60px 16px 0;display:flex;flex-direction:column;gap:10px;font-family:-apple-system,system-ui}
      .title{color:#fff;font-size:13px;font-weight:600}
      .row{display:flex;flex-direction:column;gap:4px}
      .label{color:rgba(255,255,255,.6);font-size:11px}
      .items{display:flex;align-items:flex-end;gap:8px}
      .grid{display:grid;grid-template-columns:repeat(8,44px);gap:6px;justify-items:center;align-items:center}
      .inline-flex{display:inline-flex}.shrink-0{flex-shrink:0}.relative{position:relative}.items-center{align-items:center}.block{display:block}.h-\\[84\\%\\]{height:84%}.w-\\[84\\%\\]{width:84%}.select-none{user-select:none}.items-end{align-items:flex-end}.justify-center{justify-content:center}
      *{animation:none!important}
      ${css}
    </style>${body}`;
    writeFileSync(join(out, `desktop-${name}.html`), html);
  }
});

// @vitest-environment happy-dom
// JC (2026-11-06, again 2026-11-07): a bot's title goes UNDER its name,
// never "Name · Title" on one line, even when the name was stored with the
// title glued on (Grok Bot stores "Heron · Chief of Staff" as the name).
// And the profile banner never uses light-dark(): the build rewrites it
// into variables the skins never define, so the banner went transparent.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";

import { BotNameTitleStack } from "./BotNameTitleStack";
import { splitBotNameTitle } from "./bot-name-title";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const here = dirname(fileURLToPath(import.meta.url));
let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

function render(name: string, title?: string) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(BotNameTitleStack, { name, title })));
  const stack = host.querySelector("[data-bot-name-title]")!;
  const titleLine = stack.querySelector("[data-bot-title-line]");
  const nameText = (stack.textContent ?? "").replace(titleLine?.textContent ?? "", "").trim();
  return { stack, nameText, titleText: titleLine?.textContent?.trim() ?? "" };
}

describe("bot name and title, stacked (#2394)", () => {
  it("shows the title on its own line under the name", () => {
    const { nameText, titleText } = render("Osprey", "Chief of Staff");
    expect(nameText).toBe("Osprey");
    expect(titleText).toBe("Chief of Staff");
  });

  it("never renders \"Name · Title\" on one line, even for a name stored with its title", () => {
    const { stack, nameText, titleText } = render("Heron · Chief of Staff");
    expect(nameText).toBe("Heron");
    expect(titleText).toBe("Chief of Staff");
    expect(stack.textContent).not.toMatch(/Heron\s*·\s*Chief/);
  });

  it("a set title wins over the glued one", () => {
    expect(splitBotNameTitle("Heron · Chief of Staff", "Coordinator")).toEqual({ name: "Heron", title: "Coordinator", merged: true });
    expect(splitBotNameTitle("Scout", "Research")).toEqual({ name: "Scout", title: "Research", merged: false });
  });

  it("no surface composes \"name · title\" for a bot header", () => {
    const sources = [
      readFileSync(join(here, "BotNameTitleStack.tsx"), "utf8"),
      readFileSync(join(here, "..", "bot-profile", "BotProfilePage.tsx-parts", "BotProfileHeader.tsx"), "utf8"),
    ];
    for (const source of sources) expect(source).not.toMatch(/\{\s*(?:bot\.)?name\s*\}\s*·\s*\{\s*(?:bot\.)?title/);
  });

  it("the profile banner CSS never uses light-dark()", () => {
    const css = readFileSync(join(here, "..", "..", "styles.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/light-dark\(/);
  });
});

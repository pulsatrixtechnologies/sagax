// @vitest-environment happy-dom
// The presence tail: the bot's activity line while it works, typing once the
// thread's answer text streams, gone once the reply settles.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PHRASE_HOLD_MS } from "./BotActivityIndicator";
import { TurnPresence } from "./TurnPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bot = { name: "Pepper", color: "blue" as const };
const seed = "bot:thread:1";

let host: HTMLDivElement;
let root: Root;

function render(props: Record<string, unknown>) {
  act(() => root.render(createElement(TurnPresence, { bot, visible: true, seed, ...props })));
}

const phrase = () => host.querySelector("[data-presence-phrase]")?.textContent;
const mode = () => host.querySelector("[data-bot-activity]")?.getAttribute("data-bot-activity");

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("TurnPresence", () => {
  it("thinks with its own phrases on a plain thinking step", () => {
    render({ phrases: ["Thinking"], phase: "chat.activity.thinking" });
    expect(mode()).toBe("thinking");
    expect(phrase()).toBe("Thinking it over");
  });

  it("starts a tool step at its plain label and keeps a single phrase steady", () => {
    render({ phrases: ["Running the test suite"], phase: "spoken" });
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS * 10));
    expect(phrase()).toBe("Running the test suite");
  });

  it("types while answer text streams", () => {
    render({ typing: true });
    expect(mode()).toBe("typing");
    expect(phrase()).toBe("Typing…");
  });

  it("leaves at once when the reply hands over, after a fade otherwise", () => {
    render({ answering: true });
    render({ visible: false, answering: true });
    expect(host.querySelector(".turn-presence")).toBeNull();
    render({ visible: true, answering: false });
    render({ visible: false });
    expect(host.querySelector(".turn-mascot-out")).not.toBeNull();
    act(() => void vi.advanceTimersByTime(280));
    expect(host.querySelector(".turn-presence")).toBeNull();
  });

  it("counts elapsed time from the turn's start and keeps ticking", () => {
    const since = Date.now() - 13_000;
    render({ since });
    expect(host.querySelector(".turn-presence .tabular-nums")?.textContent).toBe("13s");
    act(() => void vi.advanceTimersByTime(2_000));
    expect(host.querySelector(".turn-presence .tabular-nums")?.textContent).toBe("15s");
  });

  it("hides the elapsed readout once the reply is settling", () => {
    render({ since: Date.now() - 13_000, answering: true });
    expect(host.querySelector(".tabular-nums")).toBeNull();
  });

  it("still takes a plain label, as the sidebar-era callers pass", () => {
    const markup = renderToStaticMarkup(createElement(TurnPresence, { bot, visible: true, label: "Running a command" }));
    expect(markup).toContain("Running a command");
    expect(markup).toContain("thinking-shimmer");
  });
});

describe("thinking shimmer box", () => {
  const css = readFileSync("src/styles.css", "utf8");

  it("pads the phrase and its sheen past ascenders, descenders and arabic marks without moving the layout", () => {
    const rule = css.match(/\.thinking-shimmer \{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/padding: 0\.35em 0\.12em/);
    expect(rule).toMatch(/margin: -0\.35em -0\.12em/);
    const copy = css.match(/\.thinking-sheen > span::before \{[^}]*\}/)?.[0] ?? "";
    expect(copy).toMatch(/padding: 0\.35em 0\.12em/);
    expect(copy).toContain("content: attr(data-text) / \"\"");
  });

  it("moves the sheen by transform alone, in steps, so a turn does not redraw the page every display frame", () => {
    for (const name of ["sheen-band", "sheen-letters"]) {
      const frames = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? "";
      const properties = [...frames.matchAll(/([a-z-]+):/g)].map((match) => match[1]);
      expect(new Set(properties)).toEqual(new Set(["transform", "animation-timing-function"]));
      expect(frames).toMatch(/steps\(\d+/);
    }
  });

  it("keeps the phrase's text to one copy for screen readers, selection and tests", () => {
    render({ label: "Running a command", since: null });
    const phraseNode = host.querySelector("[data-presence-phrase]")!;
    expect(phraseNode.textContent).toBe("Running a command");
    expect(phraseNode.querySelector(".thinking-sheen")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("stills the wave and the sheen under both reduced-motion switches", () => {
    expect(css).toContain(':root[data-reduced-motion="true"] .bot-activity-wave > span { animation: none; }');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.bot-activity-wave > span \{ animation: none; \}/);
    expect(css).toContain(".thinking-sheen { display: none; }");
  });
});

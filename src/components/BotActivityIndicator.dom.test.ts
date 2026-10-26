// @vitest-environment happy-dom
// The bot's activity line: dots and a rotating phrase while it thinks, its
// mascot and "Typing…" while answer text arrives, still under reduced motion,
// one stable status line for screen readers.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { phraseAt } from "@/lib/live-activity";
import { BotActivityIndicator, PHRASE_HOLD_MS, THINKING_PHASE, botActivityColor } from "./BotActivityIndicator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THINKING = ["Thinking it over", "Working it out", "Pulling it together", "Checking the details"];
const bot = { name: "Pepper", color: "orange" as const };
const seed = "bot:thread:1";

let host: HTMLDivElement;
let root: Root;

function render(props: Record<string, unknown> = {}) {
  act(() => root.render(createElement(BotActivityIndicator, { bot, mode: "thinking", seed, ...props })));
}

const phrase = () => host.querySelector("[data-presence-phrase]")?.textContent;
const status = () => host.querySelector('[role="status"]');

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
  vi.useRealTimers();
});

describe("thinking", () => {
  it("shows three waving dots in the bot's colour and a phrase from the list", () => {
    render();
    const dots = host.querySelector("[data-presence-dots]");
    expect(dots?.children).toHaveLength(3);
    expect(dots?.className).toContain("bot-activity-wave");
    expect(dots?.getAttribute("aria-hidden")).toBe("true");
    expect(host.querySelector("[data-presence-mascot]")).toBeNull();
    expect(THINKING).toContain(phrase());
    expect(phrase()).toBe("Thinking it over");
    expect(host.querySelector("[data-presence-phrase]")?.className).toContain("thinking-shimmer");
    const color = (status() as HTMLElement).style.getPropertyValue("--bot-activity-color");
    expect(color).toBe(botActivityColor("orange"));
  });

  it("shows no elapsed time, even after a while", () => {
    render();
    act(() => void vi.advanceTimersByTime(5_000));
    expect(host.querySelector(".tabular-nums")).toBeNull();
    expect(status()?.textContent).not.toMatch(/\d+\s*s\b/);
  });

  it("rotates the phrase every few seconds and stops its timer on unmount", () => {
    render();
    const step = `${seed}|${THINKING_PHASE}`;
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS - 1));
    expect(phrase()).toBe("Thinking it over");
    act(() => void vi.advanceTimersByTime(1));
    expect(phrase()).toBe(phraseAt(THINKING, step, 1));
    expect(phrase()).not.toBe("Thinking it over");
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS));
    expect(phrase()).toBe(phraseAt(THINKING, step, 2));
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(host);
  });

  it("keeps its phrase across a re-render", () => {
    render();
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS));
    const shown = phrase();
    render();
    expect(phrase()).toBe(shown);
  });

  it("keeps a tool step's own label and starts a new step at its first phrase", () => {
    render({ phrases: ["Searching the web", "Looking it up"], phase: "web" });
    expect(phrase()).toBe("Searching the web");
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS));
    expect(phrase()).toBe("Looking it up");
    render({ phase: THINKING_PHASE });
    expect(phrase()).toBe("Thinking it over");
  });

  it("falls back to the accent for a colourless bot", () => {
    expect(botActivityColor("white")).toBeNull();
    expect(botActivityColor(undefined)).toBeNull();
    render({ bot: { name: "Pepper", color: "white" } });
    expect((status() as HTMLElement).style.getPropertyValue("--bot-activity-color")).toBe("var(--color-accent)");
  });
});

describe("typing", () => {
  it("shows the bot's mascot and Typing…", () => {
    render({ mode: "typing" });
    expect(host.querySelector("[data-presence-dots]")).toBeNull();
    const mascot = host.querySelector("[data-presence-mascot]");
    expect(mascot).not.toBeNull();
    expect(mascot?.getAttribute("aria-hidden")).toBe("true");
    expect(phrase()).toBe("Typing…");
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS * 3));
    expect(phrase()).toBe("Typing…");
  });
});

describe("reduced motion", () => {
  it("draws still dots, no sheen and the first phrase only", () => {
    document.documentElement.dataset.reducedMotion = "true";
    render();
    expect(host.querySelector("[data-presence-dots]")?.className).not.toContain("bot-activity-wave");
    expect(host.querySelector("[data-presence-phrase]")?.className).not.toContain("thinking-shimmer");
    expect(host.querySelector("[data-presence-phrase]")?.className).not.toContain("animate-shimmer");
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS * 4));
    expect(phrase()).toBe("Thinking it over");
  });
});

describe("screen readers", () => {
  it("hear one stable line, never the rotating phrase", () => {
    render();
    const region = status();
    expect(region?.getAttribute("aria-live")).toBe("polite");
    expect(region?.querySelector(".sr-only")?.textContent).toBe("Pepper is thinking");
    act(() => void vi.advanceTimersByTime(PHRASE_HOLD_MS));
    expect(region?.querySelector(".sr-only")?.textContent).toBe("Pepper is thinking");
    expect(host.querySelector("[data-presence-phrase]")?.closest('[aria-hidden="true"]')).not.toBeNull();
    render({ mode: "typing" });
    expect(status()?.querySelector(".sr-only")?.textContent).toBe("Pepper is typing");
  });
});

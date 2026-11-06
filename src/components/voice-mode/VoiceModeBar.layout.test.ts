// The voice call pill: compact and centered at the top of the chat column
// (ChatView's banner stack, under the name chip); Settings or Transcript
// expand it into a card over the thread. These tests pin its states:
// collapsed, transcript, settings, and narrow.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  vi.stubGlobal("window", { setInterval: () => 0, clearInterval: () => {} });
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
});

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return { ...original, useStore: () => ({ state: original.initialState, dispatch: () => {} }) };
});

import type { Bot } from "@/state/store";
import type { VoiceCall } from "@/lib/voice-mode/call";
import type { CallPhase, CallState } from "@/lib/voice-mode/call-machine";
import { readFileSync } from "node:fs";
import { VoiceModeBar, type VoiceModeBarProps } from "./VoiceModeBar";

const bot = {
  id: "quasar", threadId: "quasar-main", name: "Quasar", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
} as unknown as Bot;
const call = { analysers: { mic: null, bot: null }, enrolled: false, endpointMs: 850, modelsReady: true } as unknown as VoiceCall;

function render(phase: CallPhase, extra: Partial<VoiceModeBarProps> = {}, muted = false): string {
  const state: CallState = { phase, muted, botBusy: false, botAudible: phase === "speaking", ducked: false, duplex: false, backgroundWork: false };
  return renderToStaticMarkup(createElement(VoiceModeBar, {
    bot, call, state, heard: "", note: null, refusal: null, transcript: [], onRetry: () => {}, onEnd: () => {}, ...extra,
  }));
}

/** The class list of the first element carrying `attribute`. */
function classOf(html: string, attribute: string): string {
  const match = new RegExp(`<[^>]*\\b${attribute}(?![\\w-])[^>]*>`).exec(html);
  expect(match, attribute).not.toBeNull();
  return /class="([^"]*)"/.exec(match![0])?.[1] ?? "";
}

describe("the voice call pill", () => {
  it("collapsed: avatar, dotted waveform, then Settings, Transcript, Mic and a red End, in every call state", () => {
    const states: Array<[CallPhase, string]> = [
      ["connecting", "Connecting"], ["listening", "Listening"], ["hearing", "Listening to you"], ["thinking", "Thinking"],
      ["speaking", "Speaking"], ["interrupted", "Interrupted"], ["held", "On hold"],
    ];
    for (const [phase, label] of states) {
      const html = render(phase);
      expect(html).toContain(`data-voice-phase="${phase}"`);
      expect(html).toContain('data-voice-panel="none"');
      // the state is spoken (live region) and in the avatar's tooltip, not printed
      expect(html).toMatch(new RegExp(`data-voice-status[^>]*>${label}<`));
      expect(classOf(html, "data-voice-status")).toContain("sr-only");
      expect(html).toContain(`title="Quasar · 0:00 · ${label}"`);
      const order = ["data-voice-avatar", "data-voice-waveform", "data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end"].map((a) => html.indexOf(`${a}="true"`));
      expect(order.every((index) => index > 0), `${phase} controls ${order}`).toBe(true);
      expect(order, `${phase} order`).toEqual([...order].sort((a, b) => a - b));
      // the reference has no hold or timer in the pill
      expect(html).not.toContain("data-voice-hold");
      expect(html).not.toContain("data-voice-timer");
      expect(html).not.toContain("data-voice-card");
    }
    expect(render("speaking", {}, true)).toMatch(/data-voice-status[^>]*>Muted</);
  });

  it("collapsed: a centered rounded pill of the reference's size (64px row, 12px padding, 40px avatar and buttons, 18px icons), the End button red", () => {
    const html = render("listening");
    const pill = classOf(html, "data-voice-pill");
    // a pill: every corner is half the 64px row
    expect(pill).toContain("rounded-t-[32px]");
    expect(pill).toContain("rounded-b-[32px]");
    expect(pill).toContain("mx-auto");
    expect(pill).toContain("max-w-[420px]");
    expect(pill).toContain("@container/callpill");
    const row = classOf(html, "data-voice-pill-row");
    expect(row).toContain("h-16");
    expect(row).toContain("px-3");
    expect(row).toContain("gap-2");
    expect(html).toMatch(/data-voice-avatar[^>]*><span[^>]*style="width:40px;height:40px/);
    for (const control of ["data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end"]) {
      const button = new RegExp(`<button[^>]*\\b${control}(?![\\w-])[^>]*>(<svg[^>]*>)`).exec(html);
      expect(classOf(html, control), control).toContain("size-10");
      expect(button?.[1], control).toMatch(/width="18" height="18"/);
    }
    expect(classOf(html, "data-voice-end")).toContain("bg-danger");
    // the waveform: 4px dots, 32px tall
    expect(html).toMatch(/<canvas class="block h-8 w-full text-ink"/);
    const source = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");
    expect(source).toContain("const RADIUS = 2; // a dot is 4px wide");
    expect(source).toMatch(/context\.arc\(offset \+ i \* COLUMN, middle \+ row \* ROW, RADIUS,/);
  });

  it("narrow: the waveform gives way first, the controls never shrink", () => {
    const html = render("speaking");
    const wave = classOf(html, "data-voice-waveform");
    expect(wave).toMatch(/(^| )hidden( |$)/);
    // 4 round 40px controls, the 40px avatar, gaps and padding take 264px
    expect(wave).toContain("@[21rem]/callpill:block");
    expect(wave).toContain("min-w-0");
    expect(wave).toContain("flex-1");
    expect(classOf(html, "data-voice-controls")).toContain("shrink-0");
    for (const control of ["data-voice-gear", "data-voice-transcript-toggle", "data-voice-mute", "data-voice-end"]) {
      expect(classOf(html, control), control).toContain("shrink-0");
    }
  });

  it("an alert opens the card below the pill row, scrollable", () => {
    const html = render("listening", { note: "The microphone is busy" });
    expect(html).toContain('data-voice-panel="alert"');
    expect(html.indexOf("data-voice-controls")).toBeLessThan(html.indexOf("data-voice-card"));
    expect(classOf(html, "data-voice-callbar-panels")).toMatch(/max-h-\[min\(55vh,360px\)\].*overflow-y-auto/);
    expect(classOf(html, "data-voice-pill")).toContain("rounded-b-[22px]");
    expect(classOf(html, "data-voice-pill")).toContain("rounded-t-[32px]");
  });
});

describe("the pill's expanded card", () => {
  const transcript = [
    { id: "1", who: "you" as const, text: "Testing testing testing" },
    { id: "2", who: "bot" as const, text: "T'es bien en ligne. Tout roule de ton bord?" },
  ];

  it("transcript: the person's lines on the right, the bot's on the left, the button active, timer and state in the header", () => {
    const html = render("listening", { transcript, defaultPanel: "transcript" });
    expect(html).toContain('data-voice-panel="transcript"');
    expect(classOf(html, "data-voice-pill")).toContain("rounded-b-[22px]");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-voice-transcript-toggle/);
    expect(classOf(html, "data-voice-transcript-toggle")).toContain("bg-ink");
    expect(html).toMatch(/data-voice-line="you"[^>]*>Testing testing testing</);
    expect(html).toMatch(/data-voice-line="bot"[^>]*>T&#x27;es bien en ligne\. Tout roule de ton bord\?</);
    expect(classOf(html, 'data-voice-line="you"')).toContain("self-end");
    expect(classOf(html, 'data-voice-line="bot"')).toContain("self-start");
    expect(html).toMatch(/data-voice-timer[^>]*>0:00 · Listening</);
    // a hairline divides the pill row from the card, which scrolls
    expect(classOf(html, "data-voice-card")).toContain("border-t");
    expect(html.indexOf("data-voice-controls")).toBeLessThan(html.indexOf("data-voice-card"));
  });

  it("transcript: the words being said show as a live bubble on the speaker's side", () => {
    const hearing = render("hearing", { transcript, heard: "and one more", defaultPanel: "transcript" });
    expect(classOf(hearing, 'data-voice-line="live"')).toContain("self-end");
    const speaking = render("speaking", { transcript, caption: "Oui, je t'entends.", defaultPanel: "transcript" });
    expect(classOf(speaking, 'data-voice-line="live"')).toContain("self-start");
    expect(render("listening", { defaultPanel: "transcript" })).toContain("Nothing said yet.");
  });

  it("settings: Voice, Speed and Language rows, the gear ringed, hold inside the card", () => {
    const html = render("listening", { defaultPanel: "settings" });
    expect(html).toContain('data-voice-panel="settings"');
    expect(classOf(html, "data-voice-gear")).toContain("ring-2");
    expect(html).toMatch(/aria-expanded="true"[^>]*data-voice-gear/);
    const rows = ["voice", "speed", "language"].map((list) => html.indexOf(`data-voice-list="${list}"`));
    expect(rows.every((index) => index > 0)).toBe(true);
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    expect(html).toContain(">Voice<");
    expect(html).toContain(">Speed<");
    expect(html).toContain(">Language<");
    expect(html).toContain("data-voice-hold");
    expect(render("held", { defaultPanel: "settings" })).toMatch(/aria-pressed="true"[^>]*data-voice-hold/);
  });

  it("closes on Escape (an open list first) and on a click outside", () => {
    const source = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/if \(event\.key !== "Escape"\) return;[\s\S]*if \(list\) return setList\(null\);[\s\S]*setPanel\(null\)/);
    expect(source).toMatch(/!pill\.current\.contains\(event\.target\)\)[\s\S]*setPanel\(null\)/);
  });
});

describe("the card's motion", () => {
  const source = readFileSync(new URL("./VoiceModeBar.tsx", import.meta.url), "utf8");
  const motion = readFileSync(new URL("../MenuMotion.tsx", import.meta.url), "utf8");

  it("the card sits in a clipping reveal shell under the row (a 0fr to 1fr grid row and opacity, none when motion is reduced)", () => {
    const html = render("listening", { defaultPanel: "transcript", transcript: [{ id: "1", who: "you", text: "Hi" }] });
    const shell = classOf(html, "data-voice-card-motion");
    expect(shell).toContain("overflow-hidden");
    expect(shell).toContain("reveal-shell");
    expect(shell).not.toContain("transition-[height");
    expect(html).toContain('data-reveal="open"');
    expect(motion).toMatch(/export const REVEAL_MOTION_MS = MOTION_MS\.moderate;/);
    // shell, then the card, then its scroller: the row is outside it and never moves
    const order = ["data-voice-pill-row", "data-voice-card-motion", "data-voice-card=", "data-voice-callbar-panels", 'data-voice-card-body="transcript"'].map((a) => html.indexOf(a));
    expect(order.every((index) => index > 0), String(order)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // the pill's corners move only between finite radii, with the card
    const pill = classOf(html, "data-voice-pill");
    expect(pill).toContain("transition-[border-radius]");
    expect(pill).toContain("duration-moderate");
    expect(pill).toContain("ease-out-quint");
    expect(pill).not.toContain("rounded-full");
  });

  it("reveals the card with no height written from script; the transcript is on its last line before it shows", () => {
    expect(source).toContain('useReveal(expanded, cardKey, panel === "transcript" ? toLastLine : toTop)');
    expect(motion).not.toMatch(/style\.height|offsetHeight/);
    expect(motion).toMatch(/if \(open && \(!previous\.open \|\| previous\.key !== contentKey\)\) before\.current\?\.\(\);/);
    // following the conversation happens before paint too
    expect(source).toMatch(/useLayoutEffect\(\(\) => \{\s*if \(transcriptOpen\) toLastLine\(\);/);
  });

  it("Settings to Transcript cross-fades in place: the old panel fades out over the new one, out of reach", () => {
    expect(source).toMatch(/setLeaving\(panel && lastPanel && !reducedMotion\(\) \? lastPanel : null\)/);
    expect(source).toMatch(/<div aria-hidden inert className="animate-card-fade-out pointer-events-none absolute inset-x-0 top-0[^"]*" data-voice-card-leaving=\{leaving\}>/);
    expect(source).toContain('className={leaving ? "animate-card-fade-in" : undefined}');
    const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(css).toContain("--animate-card-fade-in: card-fade-in var(--transition-duration-moderate) var(--ease-out-quint) both;");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.animate-caret[^}]*\.animate-card-fade-in, \.animate-card-fade-out \{ animation: none; \}/);
    expect(css).toContain(':root[data-reduced-motion="true"] .animate-card-fade-out,');
  });

  it("closed, nothing of the card is drawn", () => {
    const html = render("listening");
    expect(html).not.toContain("data-voice-card-motion");
    expect(html).not.toContain("data-voice-card-leaving");
  });
});

describe("where the bar lives", () => {
  it("ChatView puts it first in the banner stack, under the name chip; the overlay draws no call any more", () => {
    const chat = [
      readFileSync(new URL("../ChatView.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../ChatView.tsx-parts/ChatViewBanners.tsx", import.meta.url), "utf8"),
      readFileSync(new URL("../ChatView.tsx-parts/ChatViewShell.tsx", import.meta.url), "utf8"),
    ].join("\n");
    // Only a confidential thread's classification band (#683, a marking at
    // the very top of the conversation) may come before the pill.
    expect(chat).toMatch(/<div className="chat-banners[^"]*">\s*(?:\{confidential && <ConfidentialBanner position="top"[^>]*\/>\}\s*)?\{\/\*[\s\S]*?\*\/\}\s*<VoiceCallDock bot=\{bot\} \/>/);
    const view = readFileSync(new URL("../CallView.tsx", import.meta.url), "utf8");
    const overlay = view.slice(view.indexOf("export function CallOverlay"), view.indexOf("export function VoiceCallDock"));
    expect(overlay).not.toContain("<LiveCall");
    // 2026-11-02: a call is a realtime voice session, never the dictation plus text to speech overlay
    expect(overlay).toContain("return null;");
    expect(overlay).not.toContain("<Call ");
    // the collapsed pill keeps its own small row; the card hangs over the thread
    const dock = view.slice(view.indexOf("export function VoiceCallDock"));
    expect(dock).toMatch(/className="animate-call-dock-in relative z-20 mb-2 h-16 px-3" data-voice-call-dock/);
    expect(dock).toContain('className="pointer-events-none absolute inset-x-3 top-0"');
  });

  it("on the desktop the pill is the whole call: no folded row, no chevron, no full-column stage (0.4.9 had them)", () => {
    const view = readFileSync(new URL("../CallView.tsx", import.meta.url), "utf8");
    const dock = view.slice(view.indexOf("export function VoiceCallDock"));
    expect(dock).toContain("<LiveCall bot={bot} />");
    expect(dock).not.toContain("data-voice-stage");
    expect(dock).not.toContain("absolute inset-0");
    expect(dock).not.toMatch(/collapsed|onExpand|onCollapse/);
    for (const phase of ["listening", "speaking"] as const) {
      const html = render(phase);
      for (const gone of ["data-voice-stage", "data-voice-collapsed", "data-voice-expand", "data-voice-collapse"]) {
        expect(html, `${phase} ${gone}`).not.toContain(gone);
      }
    }
  });
});

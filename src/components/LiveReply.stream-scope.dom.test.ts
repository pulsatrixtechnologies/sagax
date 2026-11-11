// @vitest-environment happy-dom
// #3624: a bot streaming in a conversation that is not on screen does not
// render the open conversation's live reply or its working line. Counted in
// renders per delta, never in milliseconds.
import { act, createElement, Profiler } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { StreamingPreview } from "@/state/store";
import { LiveReply } from "./LiveReply";
import { TurnPresence } from "./TurnPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN = "th_open";
const ELSEWHERE = "th_elsewhere";

let host: HTMLDivElement;
let root: Root;
const renders = { reply: 0, presence: 0 };
// one element, drawn again under each new stream: only a subscription can render it
const chat = createElement(
  "div",
  null,
  createElement(Profiler, { id: "reply", onRender: () => { renders.reply += 1; } }, createElement(LiveReply, { threadId: OPEN, botId: "b1" })),
  createElement(Profiler, { id: "presence", onRender: () => { renders.presence += 1; } },
    createElement(TurnPresence, { bot: { name: "Wren", color: "orange" }, visible: true, streamThreadId: OPEN, seed: "s" })),
);
const draw = (streaming: Record<string, string>) => act(() => root.render(createElement(StreamingPreview, { streaming }, chat)));

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renders.reply = 0;
  renders.presence = 0;
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

// #3696: past the working line's short form, so the bubble draws it
const PLAN = "Voici le plan.\n\n- un";

describe("the open conversation's live parts and other bots' streams (#3624)", () => {
  it("renders nothing of the open chat for another conversation's deltas", () => {
    draw({ [OPEN]: PLAN });
    const after = { ...renders };
    let elsewhere = "";
    for (let delta = 0; delta < 30; delta++) {
      elsewhere += "more words ";
      draw({ [OPEN]: PLAN, [ELSEWHERE]: elsewhere });
    }
    expect(renders.reply - after.reply).toBe(0);
    expect(renders.presence - after.presence).toBe(0);
    expect(host.querySelector("[data-live-reply]")?.textContent).toContain("Voici le plan.");
  });

  it("draws each delta of its own conversation once, and the working line not at all", () => {
    draw({ [OPEN]: PLAN });
    const after = { ...renders };
    let text = PLAN;
    for (let delta = 0; delta < 10; delta++) {
      text += " le plan";
      draw({ [OPEN]: text });
    }
    expect(renders.reply - after.reply).toBe(10);
    // the line under the bubble only needs to know words are there
    expect(renders.presence - after.presence).toBe(0);
    expect(host.querySelector("[data-live-reply]")?.textContent).toContain("un le plan le plan");
  });
});

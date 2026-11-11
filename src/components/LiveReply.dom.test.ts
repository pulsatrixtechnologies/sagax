// @vitest-environment happy-dom
// A reply drawn as it is written (LiveReply): the deltas a streaming engine
// sends (the fake Claude CLI's text_delta frames, merged per frame by the
// store's buffer) grow the bubble when "Show replies as they are written" is
// on; off, nothing shows until the settled reply arrives; half-written
// Markdown (an open code fence, a table missing its last cell) never breaks
// the bubble.
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setStreamReplies, STREAM_REPLIES_KEY } from "@/lib/stream-replies-preference";
import { createStreamDeltaBuffer, StreamingPreview } from "@/state/store";
import { LiveReply } from "./LiveReply";
import { TurnPresence } from "./TurnPresence";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const THREAD = "th_live";
/** What the fake CLI streams, one text_delta each. */
const DELTAS = [
  "Voici ", "le plan.\n\n", "| Étape | Durée |\n", "|---|---|\n", "| Tests | 2 h", " |\n\n",
  "```ts\n", "const x = 1;\n", "\nconst y", " = 2;\n", "```\n\n", "- un\n", "- deux",
];

let host: HTMLDivElement;
let root: Root;
let streaming: Record<string, string> = {};

function draw(extra?: Partial<ComponentProps<typeof LiveReply>>) {
  act(() => root.render(createElement(StreamingPreview, { streaming },
    createElement(LiveReply, { threadId: THREAD, botId: "b1", ...extra }),
    createElement(TurnPresence, { bot: { name: "Wren", color: "orange" }, visible: true, streamThreadId: THREAD, seed: "s" }),
  )));
}

/** Feed the deltas through the store's per-frame buffer, flushing after each. */
function* stream(): Generator<string> {
  const buffer = createStreamDeltaBuffer((entries) => {
    for (const [threadId, delta] of entries) streaming = { ...streaming, [threadId]: (streaming[threadId] ?? "") + delta.text };
  });
  for (const delta of DELTAS) {
    buffer.push(THREAD, "assistant_text", delta);
    buffer.flush();
    yield streaming[THREAD]!;
  }
  buffer.dispose();
}

const bubble = () => host.querySelector("[data-live-reply]");

beforeEach(() => {
  localStorage.removeItem(STREAM_REPLIES_KEY);
  streaming = {};
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("LiveReply", () => {
  it("is on by default and grows with every delta, partial Markdown included", () => {
    const lengths: number[] = [];
    let opened = false;
    for (const text of stream()) {
      draw();
      // #3696: the first short words are written in the working line; the
      // bubble opens once the text grows past it, and then stays
      if (!bubble()) {
        expect(opened).toBe(false);
        expect(host.querySelector("[data-presence-phrase]")?.textContent).toContain(text.trim());
        continue;
      }
      opened = true;
      lengths.push(bubble()!.textContent!.length);
      // the words are on screen: no "Typing…" line under them
      expect(host.querySelector(".turn-presence")).toBeNull();
    }
    expect(opened).toBe(true);
    // it grew, frame after frame
    expect(lengths.at(-1)).toBeGreaterThan(lengths[0]!);
    expect(new Set(lengths).size).toBeGreaterThan(DELTAS.length / 3);
    const html = bubble()!.innerHTML;
    expect(html).toContain("<table");
    expect(html).toContain("<li");
    expect(bubble()!.textContent).toContain("const y = 2;");
  });

  it("keeps an open code fence readable as code", () => {
    streaming = { [THREAD]: "Le code :\n\n```python\ndef f():\n    return" };
    draw();
    expect(bubble()!.querySelector("pre, code")).not.toBeNull();
    expect(bubble()!.textContent).toContain("def f():");
    expect(bubble()!.textContent).not.toContain("```");
  });

  it("shows nothing when the setting is off: the reply comes whole", () => {
    setStreamReplies(false);
    for (const _text of stream()) {
      draw();
      expect(bubble()).toBeNull();
    }
    // the working line stays instead
    expect(host.querySelector(".turn-presence")).not.toBeNull();
  });

  it("follows a change made elsewhere (another window, a bot) live", () => {
    streaming = { [THREAD]: "Bonjour.\n\nVoici le plan de la semaine." };
    draw();
    expect(bubble()).not.toBeNull();
    act(() => {
      localStorage.setItem(STREAM_REPLIES_KEY, "off");
      window.dispatchEvent(new StorageEvent("storage", { key: STREAM_REPLIES_KEY }));
    });
    expect(bubble()).toBeNull();
  });

  it("marks the reply as drawn live, and draws nothing on a call or without text", () => {
    const shownRef = { current: false };
    draw({ shownRef });
    expect(shownRef.current).toBe(false);
    // #3696: a short text is in the working line, not a bubble
    streaming = { [THREAD]: "Oui." };
    draw({ shownRef });
    expect(shownRef.current).toBe(false);
    expect(bubble()).toBeNull();
    streaming = { [THREAD]: "Oui.\n\n- le billet 1042\n- le billet 1040" };
    draw({ shownRef });
    expect(shownRef.current).toBe(true);
    draw({ hidden: true });
    expect(bubble()).toBeNull();
    streaming = { [THREAD]: "<SYSTEM_MESSAGE>internal" };
    draw();
    expect(bubble()).toBeNull();
  });
});

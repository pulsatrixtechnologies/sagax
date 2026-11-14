// @vitest-environment happy-dom
// A conversation call (place_phone_call mode conversation): the approval card
// with its objective, limit and opening line; the live card once placed; the
// result once it ended. The one-way message card stays as it was.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";
import { formatCallDuration, isLiveConversationCall, OutboundCard, outcomeLabel } from "./OutboundCard";

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return { ...actual, api: vi.fn(async () => ({})) };
});

import { api } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  setLocale("en");
  vi.mocked(api).mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

function mount(outbound: OutboundCardData, transcriptOpen = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const message = { id: "m1", role: "bot", kind: "text", text: "", at: 1, outbound } as unknown as Message;
  act(() => root!.render(createElement(OutboundCard, { message, transcriptOpen })));
  return host;
}

const base: OutboundCardData = {
  kind: "call", id: "call_0123456789abcdef", status: "pending", botName: "Rocket", destination: "+1 514 555 0142",
  mode: "conversation", language: "fr", maxMinutes: 5, objective: "Book the yearly service",
  script: "Bonjour, ici Rocket, un assistant IA qui appelle au nom d'Alex.",
  instructions: "Stay brief.", voicemail: "Alex will call back.",
};

describe("OutboundCard, conversation call", () => {
  it("asks with the objective, the limit, the language and the opening line, details folded", () => {
    const host = mount({ ...base, calleeName: "Marie" });
    const text = host.textContent ?? "";
    expect(text).toContain("Conversation call");
    expect(text).toContain("Call Marie? +1 514 555 0142");
    expect(text).toContain("Book the yearly service");
    expect(text).toContain("5 min max · In French");
    expect(text).toContain("un assistant IA qui appelle au nom d'Alex");
    expect(text).toContain("always opens by saying it is an AI assistant");
    expect(text).not.toContain("Stay brief.");
    expect(host.querySelector("[data-outbound-no]")?.textContent).toContain("Cancel");
    const yes = host.querySelector<HTMLButtonElement>("[data-outbound-yes]")!;
    expect(yes.disabled).toBe(true);
    act(() => host.querySelector<HTMLButtonElement>("[data-outbound-details]")!.click());
    expect(host.textContent).toContain("Stay brief.");
    expect(host.textContent).toContain("Alex will call back.");
    act(() => host.querySelector<HTMLInputElement>("[data-outbound-confirm]")!.click());
    expect(yes.disabled).toBe(false);
    expect(text).not.toContain("call_0123456789abcdef");
  });

  it("offers Always call this number once the number is confirmed, and sends always (#2091)", async () => {
    vi.mocked(api).mockResolvedValue({} as never);
    const host = mount(base);
    const always = host.querySelector<HTMLButtonElement>("[data-outbound-always]")!;
    expect(always.textContent).toContain("Always call this number");
    expect(always.disabled).toBe(true);
    act(() => host.querySelector<HTMLInputElement>("[data-outbound-confirm]")!.click());
    expect(always.disabled).toBe(false);
    await act(async () => { always.click(); });
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/api/me/phone-calls/call_0123456789abcdef/answer",
      expect.objectContaining({ body: JSON.stringify({ decision: "always", confirmed: true, confirmedTo: "+1 514 555 0142" }) }),
    );
  });

  it("shows the live phase chip, waiting line and End call while it has no result", () => {
    expect(isLiveConversationCall({ ...base, status: "done" })).toBe(true);
    const host = mount({
      ...base, status: "done", phase: "dialing", liveStartedAt: Date.now() - 5_000, calleeName: "Marie",
    });
    expect(host.querySelector("[data-outbound-phase-chip]")?.textContent).toContain("Dialing");
    expect(host.textContent).toContain("Waiting for them to pick up");
    expect(host.textContent).toContain("Phone call");
    expect(host.querySelector("[data-outbound-hangup]")?.textContent).toContain("End call");
    expect(host.querySelector("[data-outbound-yes]")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-outbound-hangup]")!.click());
    expect(api).toHaveBeenCalledWith("/api/me/phone-calls/call_0123456789abcdef/hangup", expect.objectContaining({ method: "POST" }));
  });

  it("streams the live transcript and a DTMF event while in call", () => {
    const started = Date.now() - 30_000;
    const host = mount({
      ...base, status: "done", phase: "in_call", liveStartedAt: started, calleeName: "Marie",
      liveTranscript: [
        { speaker: "bot", text: "Hello there", at: started + 1_000 },
        { speaker: "callee", text: "Hi", at: started + 2_000 },
      ],
      liveEvents: [{ kind: "dtmf", detail: "9", at: started + 3_000 }],
    });
    expect(host.querySelector("[data-outbound-phase-chip]")?.textContent).toContain("In call");
    expect(host.querySelector("[data-outbound-live-transcript]")?.textContent).toContain("Hello there");
    expect(host.querySelector("[data-outbound-live-event='dtmf']")?.textContent).toContain("Pressed 9");
  });

  it("shows the result: outcome, duration, points, commitments, transcript behind a toggle", () => {
    const host = mount({ ...base, status: "done", result: {
      outcome: "completed", endedBy: "goal", durationSec: 247, endedAt: 1,
      points: ["Tuesday 9 am"], commitments: [],
      transcript: [{ speaker: "bot", text: "Hello" }, { speaker: "callee", text: "<b>Hi</b> **there**" }], truncated: true,
    } });
    const text = host.textContent ?? "";
    expect(host.querySelector("[data-outbound-phase-chip]")?.textContent).toBe("Call completed · objective reached");
    expect(host.querySelector("[data-outbound-duration]")?.textContent).toBe("4:07");
    expect(text).toContain("Tuesday 9 am");
    expect(host.querySelector("[data-outbound-commitments]")).toBeNull();
    expect(host.querySelector("[data-outbound-transcript]")).toBeNull();
    act(() => host.querySelector<HTMLButtonElement>("[data-outbound-transcript-toggle]")!.click());
    const transcript = host.querySelector("[data-outbound-transcript]")!;
    expect(transcript.textContent).toContain("Other party <b>Hi</b> **there**");
    expect(transcript.querySelector("b")).toBeNull();
    expect(transcript.textContent).toContain("only the first part is kept");
  });

  it("shows the recording player chrome when recordingUrl is set", () => {
    const host = mount({
      ...base, status: "done", recordingUrl: "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA",
      result: {
        outcome: "completed", endedBy: "goal", durationSec: 12, endedAt: 1,
        points: [], commitments: [],
        transcript: [{ speaker: "bot", text: "Bye" }],
      },
    });
    expect(host.querySelector("[data-recording-player]")).toBeTruthy();
    expect(host.querySelector("[data-outbound-speed]")?.textContent).toContain("1x");
  });

  describe("#4304", () => {
    const ended = { ...base, status: "done" as const, phase: "ended" as const, result: {
      outcome: "completed" as const, endedBy: "hang-up" as const, durationSec: 16, endedAt: 1,
      points: ["The outcome is unclear"], commitments: [],
      transcript: [{ speaker: "bot" as const, text: "Tuesday or Wednesday?" }, { speaker: "callee" as const, text: "Okay" }],
    } };
    const count = (text: string, part: string) => text.split(part).length - 1;

    it("says the number once and the state once on an ended call", () => {
      const host = mount(ended);
      const text = host.textContent ?? "";
      expect(count(text, "+1 514 555 0142")).toBe(1);
      expect(text).not.toContain("Call ended");
      expect(text).not.toMatch(/\bEnded\b/);
      expect(host.querySelectorAll("[data-outbound-phase-chip]")).toHaveLength(1);
      expect(count(text, "Call completed")).toBe(1);
      expect(count(text, "0:16")).toBe(1);
    });

    it("shows no player at all when the call has no recording, and keeps Copy transcript", () => {
      const host = mount(ended);
      expect(host.querySelector("[data-recording-player]")).toBeNull();
      expect(host.querySelector("audio")).toBeNull();
      expect(host.querySelector("[data-outbound-copy-transcript]")).toBeTruthy();
    });

    it("hides a recording player whose audio cannot load", () => {
      const host = mount({ ...ended, recordingUrl: "/api/me/phone-calls/call_0123456789abcdef/recording" });
      const audio = host.querySelector("audio")!;
      act(() => { audio.dispatchEvent(new Event("error")); });
      expect(host.querySelector("[data-recording-player]")).toBeNull();
    });

    it("offers no End call and no running timer once the call ended, before its result", () => {
      const host = mount({ ...base, status: "done", phase: "ended", liveStartedAt: Date.now() - 16_000 });
      expect(host.querySelector("[data-outbound-hangup]")).toBeNull();
      expect(host.querySelector("[data-outbound-live-timer]")).toBeNull();
      expect(host.querySelector("[data-outbound-phase-chip]")?.textContent).toBe("Ended");
    });

    it("offers no End call while the allowed call is not placed yet (#4304)", () => {
      expect(isLiveConversationCall({ ...base, status: "approved" })).toBe(true);
      const host = mount({ ...base, status: "approved" });
      expect(host.querySelector("[data-outbound-hangup]")).toBeNull();
    });

    it("a failed End call reads as one plain sentence, never the server's words", async () => {
      vi.mocked(api).mockRejectedValueOnce(new Error("Could not hang up: the connection is not mounted in this turn."));
      const host = mount({ ...base, status: "done", phase: "in_call", liveStartedAt: Date.now() - 5_000 });
      await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-hangup]")!.click(); });
      const alert = host.querySelector("[role=alert]")?.textContent ?? "";
      expect(alert).toBe("The call could not be ended. Try again in a moment.");
      expect(alert).not.toMatch(/mounted|turn/);
    });
  });

  it("says when the transcript expired and when the person asked not to be called again", () => {
    const host = mount({ ...base, status: "done", result: {
      outcome: "completed", endedBy: "stop-request", doNotCallAgain: true, durationSec: 30, endedAt: 1,
      points: [], commitments: ["Remove the number"], transcriptExpired: true,
    } });
    expect(host.textContent).toContain("Transcript expired (30 days)");
    expect(host.querySelector("[data-outbound-transcript-toggle]")).toBeNull();
    expect(host.querySelector("[data-outbound-dnc]")?.textContent).toContain("Rocket will not call this number again");
    expect(host.querySelector("[data-outbound-commitments]")?.textContent).toContain("Remove the number");
  });

  it("reads in French and survives an outcome from a newer server", () => {
    setLocale("fr");
    const host = mount({ ...base, status: "done", result: { outcome: "no-answer", durationSec: 0, endedAt: 1, points: [], commitments: [] } });
    expect(host.textContent).toContain("Pas de réponse");
    expect(outcomeLabel({ outcome: "transferred" as never, endedBy: "elsewhere" as never, durationSec: 0, endedAt: 1, points: [], commitments: [] })).toBe("Appel terminé");
  });

  it("formats the duration as m:ss", () => {
    expect(formatCallDuration(0)).toBe("0:00");
    expect(formatCallDuration(65)).toBe("1:05");
    expect(formatCallDuration(Number.NaN)).toBe("0:00");
  });

  it("leaves the one-way message card as it was", () => {
    const { mode: _mode, objective: _objective, maxMinutes: _max, instructions: _i, voicemail: _v, ...oneWay } = base;
    const host = mount({ ...oneWay, purpose: "Confirm Tuesday", script: "Tuesday is confirmed." });
    const text = host.textContent ?? "";
    expect(text).toContain("Phone call");
    expect(text).toContain("What Rocket will say");
    // #4193 changed it on purpose: an older card still waiting says the call
    // is a conversation, never "says the message twice"
    expect(text).toContain("then talks with the person");
    expect(text).not.toContain("says the message twice");
    expect(text).toContain("Don't call");
    expect(text).not.toContain("Conversation call");
    act(() => root?.unmount());
    const done = mount({ ...oneWay, status: "done" });
    expect(done.textContent).toContain("Call placed.");
  });
});

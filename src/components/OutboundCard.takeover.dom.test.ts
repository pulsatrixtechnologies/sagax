// @vitest-environment happy-dom
// Live call card lot 4: the person takes the call over. Take over shows only
// with a number of their own to ring and while the bot is in call; it asks
// first, exactly as the reference dialog; then the card follows the take over
// (transferring, on the call, back in call) and the ended state reads
// "Transferred to you · <duration>".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Message } from "@/state/store";
import type { OutboundCard as OutboundCardData } from "../../shared/wire";
import { ConfirmProvider } from "./ConfirmProvider";
import { OutboundCard, outcomeLabel } from "./OutboundCard";

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return { ...actual, api: vi.fn(async () => ({})) };
});

import { api, ApiError } from "@/state/store";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
beforeEach(() => {
  setLocale("en");
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({} as never);
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  setLocale("en");
});

function mount(outbound: OutboundCardData) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const message = { id: "m1", role: "bot", kind: "text", text: "", at: 1, outbound } as unknown as Message;
  act(() => root!.render(createElement(ConfirmProvider, null, createElement(OutboundCard, { message }))));
  return host;
}

const NOW = Date.now();
const inCall: OutboundCardData = {
  kind: "call", id: "call_0123456789abcdef", status: "done", botName: "Rocket", destination: "+1 514 555 0142",
  mode: "conversation", language: "fr", maxMinutes: 5, objective: "Book the yearly service", calleeName: "Marie",
  phase: "in_call", liveStartedAt: NOW - 60_000, liveAnsweredAt: NOW - 50_000, takeOverTo: "+1 514 ••• •• 77",
  liveTranscript: [{ speaker: "callee", text: "Can I talk to Alex?", at: NOW - 10_000 }],
};

const dialog = () => document.querySelector<HTMLElement>("[role=alertdialog]");

describe("OutboundCard, Take over", () => {
  it("sits left of End call, asks with the reference words, and calls the route only after Take Over", async () => {
    const host = mount(inCall);
    const buttons = [...host.querySelectorAll("footer button")].map((button) => button.textContent);
    expect(buttons).toEqual(["Take over", "End call"]);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!.click(); });
    expect(dialog()?.textContent).toContain("Take over this call?");
    expect(dialog()?.textContent).toContain("Rocket will transfer the call to +1 514 ••• •• 77 immediately");
    const pills = [...dialog()!.querySelectorAll("button")].map((button) => button.textContent);
    expect(pills).toEqual(["Cancel", "Take Over"]);
    // Cancel is focused first: a stray Enter never transfers
    expect(document.activeElement?.textContent).toBe("Cancel");
    await act(async () => { [...dialog()!.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!.click(); });
    expect(api).not.toHaveBeenCalled();
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!.click(); });
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>("[data-confirm-action]")!.click(); });
    expect(api).toHaveBeenCalledWith("/api/me/phone-calls/call_0123456789abcdef/takeover", expect.objectContaining({ method: "POST" }));
  });

  it("reads in French as the owner asked", async () => {
    setLocale("fr");
    const host = mount(inCall);
    expect(host.querySelector("[data-outbound-takeover]")?.textContent).toBe("Prendre l'appel");
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!.click(); });
    expect(dialog()?.textContent).toContain("Prendre l'appel ?");
    expect(dialog()?.textContent).toContain("Rocket va transférer l'appel au +1 514 ••• •• 77 tout de suite.");
    expect([...dialog()!.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Annuler", "Prendre l'appel"]);
  });

  it("is hidden, never greyed, with no number of the person's own or before the call is answered", () => {
    const none = mount({ ...inCall, takeOverTo: undefined });
    expect(none.querySelector("[data-outbound-takeover]")).toBeNull();
    expect(none.querySelector("[data-outbound-hangup]")).not.toBeNull();
    act(() => root?.unmount());
    const ringing = mount({ ...inCall, phase: "ringing", liveAnsweredAt: undefined });
    expect(ringing.querySelector("[data-outbound-takeover]")).toBeNull();
  });

  it("transferring: the chip and a busy button; on the call: the timer runs on, the line says so, no Take over", () => {
    const transferring = mount({ ...inCall, phase: "transferred", takeOver: { state: "transferring", at: NOW - 2_000 } });
    expect(transferring.querySelector("[data-outbound-phase-chip]")?.textContent).toBe("Transferring…");
    const busy = transferring.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toBe("Transferring…");
    act(() => root?.unmount());
    const answered = mount({
      ...inCall, phase: "transferred", takeOver: { state: "answered", at: NOW - 30_000 },
      liveTranscript: [...inCall.liveTranscript!, { speaker: "system", text: "You're on the call.", at: NOW - 5_000 }],
    });
    expect(answered.querySelector("[data-outbound-phase-chip]")?.textContent).toBe("Transferred to you");
    expect(answered.querySelector("[data-outbound-live-timer]")).not.toBeNull();
    expect(answered.textContent).toContain("You're on the call.");
    const sys = answered.querySelector("[data-outbound-live-system]");
    expect(sys?.textContent).toBe("You're on the call.");
    expect(sys?.className).toContain("italic");
    expect(answered.textContent).not.toContain("Live transcript:");
    expect(answered.querySelector("[data-outbound-takeover]")).toBeNull();
    expect(answered.querySelector("[data-outbound-hangup]")).not.toBeNull();
  });

  it("nobody answered: back in call with the system line, Take over offered again", () => {
    const host = mount({
      ...inCall,
      liveTranscript: [...inCall.liveTranscript!, { speaker: "system", text: "Transfer not answered, Rocket resumed the call.", at: NOW - 1_000 }],
    });
    expect(host.querySelector("[data-outbound-phase-chip]")?.textContent).toBe("In call");
    expect(host.textContent).toContain("Transfer not answered, Rocket resumed the call.");
    expect(host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")?.disabled).toBe(false);
  });

  it("a refusal shows one plain line on the card and leaves the call to the bot", async () => {
    vi.mocked(api).mockRejectedValueOnce(new ApiError("Twilio said 502", 502, { code: "takeover_failed" }));
    const host = mount(inCall);
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!.click(); });
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>("[data-confirm-action]")!.click(); });
    const alert = host.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toBe("The call could not be transferred. The bot stays on the call.");
    expect(alert).not.toMatch(/Twilio|502/);
    expect(host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")?.disabled).toBe(false);
    vi.mocked(api).mockRejectedValueOnce(new ApiError("x", 409, { code: "no_take_over_number" }));
    await act(async () => { host.querySelector<HTMLButtonElement>("[data-outbound-takeover]")!.click(); });
    await act(async () => { dialog()!.querySelector<HTMLButtonElement>("[data-confirm-action]")!.click(); });
    expect(host.querySelector("[role=alert]")?.textContent).toContain("No verified number of yours");
  });

  it("the ended card reads Transferred to you · <duration>", () => {
    const result = { outcome: "completed" as const, endedBy: "transfer" as const, durationSec: 95, endedAt: NOW, points: [], commitments: [] };
    expect(outcomeLabel(result)).toBe("Transferred to you · 1:35");
    const host = mount({ ...inCall, phase: "ended", result });
    expect(host.querySelector("[data-outbound-outcome]")?.textContent).toBe("Transferred to you · 1:35");
    expect(host.querySelector("[data-outbound-duration]")).toBeNull();
    expect(host.querySelector("[data-outbound-takeover]")).toBeNull();
    setLocale("fr");
    expect(outcomeLabel(result)).toBe("Transféré vers toi · 1:35");
  });
});

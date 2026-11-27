// @vitest-environment happy-dom
// #3367: the meeting join card offers Always allow for that provider.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";

const fixture = vi.hoisted(() => ({ dispatch: vi.fn(), alwaysAllow: true }));
vi.mock("@/state/store", async (original) => ({
  ...await original<typeof import("@/state/store")>(),
  useStore: () => ({ dispatch: fixture.dispatch }),
  api: vi.fn(),
}));
vi.mock("@/lib/org-approval-policy", () => ({
  useOrgApprovalPolicy: () => ({ alwaysAllow: fixture.alwaysAllow, orgRules: 0 }),
  noteOrgAlwaysAllowOff: () => {},
}));
vi.mock("@/lib/perspicax-org", () => ({ usePerspicaxOrg: () => null }));

import { setLocale } from "@/lib/i18n";
import { MeetingCard } from "./MeetingCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ownerRule = {
  tool: "sagax:meeting",
  scope: { provider: "google-meet" },
  description: "Join Google Meet meetings as a notetaker",
};

function message(extra: Partial<NonNullable<Message["card"]>> = {}): Message {
  return {
    id: "m-meet",
    at: 1,
    role: "bot",
    kind: "options",
    card: {
      title: "Ada wants to join a Google Meet meeting to take notes",
      subtitle: "Weekly sync",
      options: ["Rejoindre et prendre des notes", "Pas cette fois"],
      requestId: "req-meet",
      tool: "join_meeting",
      ownerRule,
      meetingRequest: {
        requestId: "req-meet",
        botId: "bot-1",
        threadId: "thread-1",
        provider: "google-meet",
        url: "https://meet.google.com/abc-defg-hij",
        code: "abc-defg-hij",
        displayName: "Ada (transcription)",
        reason: "Weekly sync",
        supported: true,
        status: "pending",
      },
      ...extra,
    },
  };
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  setLocale("en");
  fixture.alwaysAllow = true;
  fixture.dispatch.mockReset();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function mount(extra: Partial<NonNullable<Message["card"]>> = {}) {
  act(() => root.render(createElement(MeetingCard, {
    botId: "bot-1",
    botName: "Ada",
    threadId: "thread-1",
    message: message(extra),
  })));
}

describe("MeetingCard Always allow (#3367)", () => {
  it("offers Always allow with Join and Not this time when the card carries ownerRule", () => {
    mount();
    const labels = [...host.querySelectorAll("button")].map((button) => button.textContent);
    expect(labels).toEqual(["Join and take notes", "Not this time", "Always allow"]);
    expect(host.querySelector("[data-always-allow]")).not.toBeNull();
    expect(host.querySelector('[data-owner-rule="allow"]')).not.toBeNull();
  });

  it("Always allow saves the owner rule with the join in one decideRequest", () => {
    mount();
    act(() => {
      host.querySelector<HTMLButtonElement>("[data-always-allow]")!.click();
    });
    expect(fixture.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: "decideRequest",
      threadId: "thread-1",
      requestId: "req-meet",
      behavior: "allow",
      rule: "allow",
    }));
  });

  it("offers no Always allow when the organization turned it off", () => {
    fixture.alwaysAllow = false;
    mount();
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).not.toContain("Always allow");
    expect(host.querySelector("[data-org-always-allow-off]")).not.toBeNull();
  });

  it("offers no Always allow without ownerRule", () => {
    mount({ ownerRule: undefined });
    expect([...host.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Join and take notes",
      "Not this time",
    ]);
    expect(host.querySelector("[data-always-allow]")).toBeNull();
  });
});

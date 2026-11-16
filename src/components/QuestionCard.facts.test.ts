// @vitest-environment happy-dom
// #4438: a card says since when its facts were read when nothing re-checks
// them, keeps a tool's raw error under Details, and once a server card's
// choice is done at once, says what happened in one line.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@/lib/i18n";
import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { cardFactsAt, QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();
const QUESTION = "Sweep ended with problems on its last run.\n\nThe routine could not read a saved result: it was no longer available.";

function mount(card: Partial<NonNullable<Message["card"]>>, at = Date.now()) {
  const message = {
    id: "m1", role: "bot", kind: "options", at,
    card: {
      title: "Sweep needs a fix", subtitle: QUESTION, options: [], requestId: "req-1", requestType: "question",
      questionRequest: { version: 1, questions: [{ question: QUESTION, options: [{ label: "Run a check" }, { label: "Open the routine" }] }] },
      ...card,
    },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Watch" }, message }) })));
}

const button = (label: string) => Array.from(host.querySelectorAll("button")).find((element) => element.textContent === label);

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  dispatch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a card's facts (#4438)", () => {
  it("a bot's keyed card says since when its facts were read; the server's own card and an unkeyed one do not", () => {
    expect(cardFactsAt({ askKey: "timesheet-46" }, 1_000)).toBe(1_000);
    expect(cardFactsAt({ askKey: "timesheet-46", factsAt: 2_000 }, 1_000)).toBe(2_000);
    expect(cardFactsAt({ askKey: "routine-problem:r1" }, 1_000)).toBeUndefined();
    expect(cardFactsAt({ askKey: "voice-line" }, 1_000)).toBeUndefined();
    expect(cardFactsAt({}, 1_000)).toBeUndefined();
    mount({ askKey: "timesheet-46" });
    expect(host.querySelector("[data-facts-as-of]")?.textContent).toMatch(/^Facts as of /);
    act(() => root.unmount());
    root = createRoot(host);
    mount({ askKey: "routine-problem:r1" });
    expect(host.querySelector("[data-facts-as-of]")).toBeNull();
  });

  it("the raw error stays folded under Details", () => {
    mount({ askKey: "routine-problem:r1", technicalDetails: "handle res_0123 is unknown, expired, or not yours (handle_unknown)" });
    expect(host.textContent).not.toContain("handle_unknown");
    // the shared technical details fold of the approval cards, not a second one
    expect(host.querySelectorAll("[data-technical-details]")).toHaveLength(1);
    act(() => button(t("approval.details.show"))!.click());
    expect(host.textContent).toContain("handle_unknown");
    act(() => button(t("approval.details.hide"))!.click());
    expect(host.textContent).not.toContain("handle_unknown");
  });

  it("an answered fix card says what the server did, in one line", () => {
    mount({ askKey: "routine-problem:r1", answered: "answer", answeredText: "Open the routine", answerNote: "The routine's page is open." });
    expect(host.textContent).toContain("The routine's page is open.");
  });

  it("a card closed because its matter is settled says why, not 'Expired, no answer'", () => {
    mount({ askKey: "timesheet-46", expired: true, options: [], answerNote: "Already approved on Nov 16" });
    expect(host.textContent).toContain("Already approved on Nov 16");
    expect(host.textContent).not.toContain(t("waitingCard.expired"));
    act(() => root.unmount());
    root = createRoot(host);
    mount({ askKey: "timesheet-46", expired: true, options: [] });
    expect(host.textContent).toContain(t("waitingCard.expired"));
  });
});

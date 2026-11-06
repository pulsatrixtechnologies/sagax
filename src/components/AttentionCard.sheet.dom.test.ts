// @vitest-environment happy-dom
// The hand-off question card (2026-11-06, the maintainer: the bare textarea
// and grey "Send answer" "felt cheap like a form"): one QuestionSheet, the
// bot's head with where the work came from, one-tap rows for the answers the
// question lists, a composer-like field in words, folded once answered.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { attentionChoices, type PersonAttentionCard } from "../../shared/person-attention";
import { AttentionCard } from "./AttentionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Do we open the ConnectWise ticket to document the audit (create, archive only, or nothing for now)?";

function card(text = QUESTION, extra: Partial<PersonAttentionCard> = {}): PersonAttentionCard {
  return {
    kind: "question", botId: "atlas", botName: "Atlas", threadId: "atlas-work", threadTitle: "@Nova · work", sourceMessageId: "src-1",
    openedBy: { botId: "nova", name: "Nova" },
    items: [{ text }],
    ...extra,
  };
}

let host: HTMLDivElement;
let root: Root;

function mount(value: PersonAttentionCard, onReply?: (text: string) => Promise<void>) {
  act(() => root.render(createElement(AttentionCard, { card: value, onReply })));
}

async function flush() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("attentionChoices", () => {
  it("reads the closing parenthesised list, in English and French", () => {
    expect(attentionChoices(card())).toEqual(["create", "archive only", "nothing for now"]);
    expect(attentionChoices(card("On crée le billet pour documenter (créer, archiver seulement, ou rien pour l'instant) ?")))
      .toEqual(["créer", "archiver seulement", "rien pour l'instant"]);
  });

  it("reads a closing list after a colon only with an or", () => {
    expect(attentionChoices(card("Next step: create, archive or skip?"))).toEqual(["create", "archive", "skip"]);
    expect(attentionChoices(card("Note: see the ticket, then tell me?"))).toEqual([]);
  });

  it("prefers the bot's own list and finds none in a plain question", () => {
    expect(attentionChoices(card(QUESTION, { choices: ["Yes", "No"] }))).toEqual(["Yes", "No"]);
    expect(attentionChoices(card("Which day suits the client?"))).toEqual([]);
    expect(attentionChoices(card("Pick a day (Thursday at the earliest)."))).toEqual([]);
  });
});

describe("AttentionCard in one conversation", () => {
  it("draws the shared question sheet with the bot's head and provenance, never a bare outlined textarea", () => {
    mount(card(), async () => {});
    const sheet = host.querySelector("[data-question-sheet]");
    expect(sheet).not.toBeNull();
    expect(sheet!.className).toContain("bg-card");
    expect(sheet!.className).not.toMatch(/\bborder\b/);
    expect(host.querySelector("[data-attention-bot]")?.textContent).toBe("Atlas");
    expect(host.querySelector("[data-attention-provenance]")?.textContent).toContain("From work Nova handed over");
    expect(host.querySelector("[data-attention-bubble]")).toBeNull();
    const field = host.querySelector("textarea")!;
    expect(field.getAttribute("rows")).toBe("1");
    expect(field.className).toContain("resize-none");
    expect(field.className).not.toContain("resize-y");
    expect(host.textContent).not.toContain("Send answer");
  });

  it("shows one row per choice and sends the picked one in a tap, then folds", async () => {
    const onReply = vi.fn(async () => {});
    mount(card(), onReply);
    const rows = [...host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")];
    expect(rows.map((row) => row.textContent)).toEqual(["ACreate", "BArchive only", "CNothing for now"]);
    expect(host.querySelector("textarea")?.getAttribute("placeholder")).toBe("Or answer in your own words");
    act(() => rows[1]!.click());
    await flush();
    expect(onReply).toHaveBeenCalledWith("archive only");
    expect(host.querySelector("[data-ask-card]")?.getAttribute("data-ask-card")).toBe("settled");
    expect(host.querySelector("textarea")).toBeNull();
    const after = [...host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")];
    expect(after[1]!.getAttribute("aria-checked")).toBe("true");
    expect(after.every((row) => row.disabled)).toBe(true);
    expect(host.querySelector("[data-attention-answered]")?.textContent).toContain("Answer sent");
  });

  it("sends an answer in words on Enter and keeps it on the folded card", async () => {
    const onReply = vi.fn(async () => {});
    mount(card("Which day suits the client?"), onReply);
    expect(host.querySelectorAll("[data-ask-choice]").length).toBe(0);
    const field = host.querySelector("textarea")!;
    expect(field.getAttribute("placeholder")).toBe("Your answer");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(field, "Thursday morning");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    await flush();
    expect(onReply).toHaveBeenCalledWith("Thursday morning");
    expect(host.querySelector("[data-attention-answered]")?.textContent).toContain("Thursday morning");
  });

  it("goes back to answerable with the error when the answer fails", async () => {
    mount(card(), async () => { throw new Error("offline"); });
    act(() => host.querySelector<HTMLButtonElement>("[data-ask-choice]")!.click());
    await flush();
    expect(host.querySelector("[role=alert]")).not.toBeNull();
    expect(host.querySelector("[data-ask-card]")?.getAttribute("data-ask-card")).toBe("pending");
  });

  it("is folded when the person already handled it", () => {
    mount(card(QUESTION, { handledAt: 1 }), async () => {});
    expect(host.querySelector("[data-ask-card]")?.getAttribute("data-ask-card")).toBe("settled");
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("keeps the bot's bubble and its grey line with threads shown", () => {
    mount(card());
    expect(host.querySelector("[data-attention-bubble]")).not.toBeNull();
    expect(host.querySelector("[data-question-sheet]")).toBeNull();
  });
});

// @vitest-environment happy-dom
// #3457 (lot 6 of #3408): the choice card in the compact look of the
// approval card. An icon, the title, one or two plain lines, « Oui » and
// « Pas maintenant », the row « Ne plus proposer », and folded details with
// each watch's switch and the read-only tools it uses, by label. A switch
// turned off in the details is not turned on by the yes.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadLocale, t } from "@/lib/i18n";
import type { OptionCardData } from "@/state/store";
import { ProactiveChoiceCard } from "./ProactiveChoiceCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CARD: OptionCardData = {
  title: "Receive dispatch alerts?",
  subtitle: "Tickets with no one assigned (every hour). On Atlas, only if you say yes.",
  options: ["Yes", "Not now"],
  proactiveProposal: { id: "pp-1" },
  proactiveChoice: {
    domain: "svc-dispatch",
    label: "Dispatch",
    botName: "Atlas",
    watches: [
      { id: "unassigned-tickets", label: "Tickets with no one assigned", cadence: "every hour", on: true, tools: ["cw_psa_find_tickets"] },
      { id: "overdue-schedule", label: "Schedule entries past due", cadence: "every day at 8:00", on: true, tools: ["cw_psa_find_schedule_entries"] },
      { id: "quiet-board", label: "A board with nothing moving", cadence: "every week", on: false, tools: [] },
    ],
  },
};

let root: Root | null = null;
let host: HTMLDivElement;
const answers: Array<{ accept: boolean; watches: string[] }> = [];
const nevers: number[] = [];

async function render(card: OptionCardData = CARD) {
  await act(async () => {
    root!.render(createElement(ProactiveChoiceCard, {
      card,
      onAnswer: (accept: boolean, watches: string[]) => { answers.push({ accept, watches }); },
      onNever: async () => { nevers.push(1); },
    }));
  });
}

const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label);
const click = (node: HTMLElement | undefined) => act(async () => { node!.click(); });

beforeEach(async () => {
  await loadLocale("en");
  answers.length = 0;
  nevers.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("the choice card (#3457)", () => {
  it("is the compact card: title, plain lines, Yes, Not now and only « Never suggest again »", async () => {
    await render();
    const card = host.querySelector<HTMLElement>("[data-proactive-choice]")!;
    expect(card).toBeTruthy();
    expect(card.querySelector("[data-approval-title]")?.textContent).toBe(CARD.title);
    expect(card.querySelector("[data-approval-summary]")?.textContent).toContain("Tickets with no one assigned");
    expect(button("Yes")).toBeTruthy();
    expect(button("Not now")).toBeTruthy();
    expect(button(t("suggestionFeedback.never"))).toBeTruthy();
    // no thumbs and no "Less of this" on a choice card
    expect(host.querySelector(`[aria-label="${t("suggestionFeedback.up")}"]`)).toBeNull();
    expect(button(t("suggestionFeedback.less"))).toBeUndefined();
  });

  it("folds its details: each watch with its switch and the read-only tools by label, never an id", async () => {
    await render();
    expect(host.querySelector("[data-choice-watch]")).toBeNull();
    await click(button(t("proactiveChoice.details.show")));
    const rows = [...host.querySelectorAll<HTMLElement>("[data-choice-watch]")];
    expect(rows.map((row) => row.querySelector("[data-choice-watch-label]")?.textContent)).toEqual(CARD.proactiveChoice!.watches.map((watch) => watch.label));
    const switches = rows.map((row) => row.querySelector<HTMLButtonElement>('[role="switch"]')!);
    expect(switches.map((node) => node.getAttribute("aria-checked"))).toEqual(["true", "true", "false"]);
    const text = host.textContent ?? "";
    for (const id of ["unassigned-tickets", "overdue-schedule", "quiet-board", "cw_psa_find_tickets", "cw_psa_find_schedule_entries", "svc-dispatch"]) {
      expect(text).not.toContain(id);
    }
    expect(rows[0]!.querySelector("[data-choice-watch-tools]")?.textContent).toMatch(/tickets/i);
  });

  it("a switch turned off in the details is not turned on by the yes", async () => {
    await render();
    await click(button(t("proactiveChoice.details.show")));
    const second = host.querySelectorAll<HTMLElement>("[data-choice-watch]")[1]!;
    await click(second.querySelector<HTMLButtonElement>('[role="switch"]')!);
    await click(button("Yes"));
    expect(answers).toEqual([{ accept: true, watches: ["unassigned-tickets"] }]);
  });

  it("a switch turned on in the details goes with the yes", async () => {
    await render();
    await click(button(t("proactiveChoice.details.show")));
    const third = host.querySelectorAll<HTMLElement>("[data-choice-watch]")[2]!;
    await click(third.querySelector<HTMLButtonElement>('[role="switch"]')!);
    await click(button("Yes"));
    expect(answers).toEqual([{ accept: true, watches: ["unassigned-tickets", "overdue-schedule", "quiet-board"] }]);
  });

  it("the yes cannot be sent with every watch off", async () => {
    await render({ ...CARD, proactiveChoice: { ...CARD.proactiveChoice!, watches: [{ ...CARD.proactiveChoice!.watches[0]!, on: false }] } });
    expect(button("Yes")?.disabled).toBe(true);
  });

  it("« Not now » and « Never suggest again » answer the card", async () => {
    await render();
    await click(button("Not now"));
    expect(answers).toEqual([{ accept: false, watches: ["unassigned-tickets", "overdue-schedule"] }]);
    await click(button(t("suggestionFeedback.never")));
    expect(nevers).toEqual([1]);
  });

  it("answered, it folds to one quiet line that names the domain", async () => {
    await render({ ...CARD, answered: "Yes", answeredText: "Yes" });
    expect(host.querySelector("[data-proactive-choice]")).toBeNull();
    const row = host.querySelector<HTMLElement>('[data-testid="proactive-choice-receipt"]')!;
    expect(row.textContent).toContain("Yes");
    expect(row.textContent).toContain("Dispatch");
    expect(button("Yes")).toBeUndefined();
  });
});

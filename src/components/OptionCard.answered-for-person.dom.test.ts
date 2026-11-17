// @vitest-environment happy-dom
// #4558: a card the server answered for the person (their "always" answer
// for a routine's question, or Full access) stays in the conversation with
// the answer marked and says by what: never a silent answer. The "always"
// one leads to the routine's settings, where the choice is removed.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { loadLocale } from "@/lib/i18n";
import { OptionCard, shouldHideOnboardingCard } from "./OptionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();
beforeAll(async () => { await loadLocale("fr"); });
beforeEach(() => { host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host); dispatch.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

/** The card exactly as server/widgets/chat-widgets.ts writes it. */
function serverCard(extra: Record<string, unknown>): Message {
  return {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "Ta question", subtitle: "Fermer le billet 1014 ?", options: ["Oui", "Non"], requestType: "question", answered: "answer", answeredText: "Oui", autoApplied: true, ...extra },
  } as unknown as Message;
}

function mount(message: Message) {
  const store = { state: { bots: [] }, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(OptionCard, { botId: "b1", threadId: "t1", message }) })));
}

describe("a card answered for the person stays visible (#4558)", () => {
  it("the \"always\" answer: shown, marked, named, with a way to the routine's settings", () => {
    const message = serverCard({ standingAnswer: { routineId: "r1" } });
    expect(shouldHideOnboardingCard(message, [message])).toBe(false);
    mount(message);
    expect(host.textContent).toContain("Fermer le billet 1014 ?");
    expect(host.textContent).toContain("Ta réponse « toujours » pour cette routine : Oui.");
    act(() => host.querySelector<HTMLButtonElement>("[data-standing-answer-settings]")!.click());
    expect(dispatch).toHaveBeenCalledWith({ type: "openRoutine", botId: "b1", routineId: "r1" });
  });

  it("the Full access answer: shown, marked, named", () => {
    const message = serverCard({});
    expect(shouldHideOnboardingCard(message, [message])).toBe(false);
    mount(message);
    expect(host.textContent).toContain("Fermer le billet 1014 ?");
    expect(host.textContent).toContain("Répondu pour toi par Accès complet : Oui.");
  });
});

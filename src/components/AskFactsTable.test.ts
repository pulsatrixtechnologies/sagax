// @vitest-environment happy-dom
// ask_choice `facts`: a card draws its structured facts as a compact two
// column table above its sentence; a card without them is drawn as before.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const QUESTION = "Nouveau billet #300769 : Client : Sherweb. Je ne l'ai pas placé : je n'ai trouvé aucune règle pour le placer. Demande : « Auberge Godefroy - Potential - 1894992 - Sign-In from Unauthorized Location [Alliance:#1894992/] ». Site : Main. Priorité : 3.";
const FACTS = [
  { label: "Billet", value: "#300769", record: { product: "connectwise", kind: "ticket", id: "300769" } },
  { label: "Client", value: "Sherweb" },
  { label: "Demande", value: "Auberge Godefroy - Potential - 1894992 - Sign-In from Unauthorized Location [Alliance:#1894992/]" },
];

function mount(card: Record<string, unknown>) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: Date.now(),
    card: {
      title: "Nouveau billet #300769 sans plage", subtitle: QUESTION, options: [], requestId: "req-1", requestType: "question", askKey: "ticket-300769",
      questionRequest: { version: 1, questions: [{ question: QUESTION, options: [{ label: "Placer demain" }, { label: "Laisser" }] }] },
      ...card,
    },
  } as unknown as Message;
  const store = { state: {}, dispatch: vi.fn() } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Marc" }, message }) })));
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a question card's facts table", () => {
  it("draws one row per fact, the label beside its value, above the sentence", () => {
    mount({ facts: FACTS });
    const table = host.querySelector("[data-ask-facts]")!;
    expect(table.tagName).toBe("DL");
    expect(Array.from(table.querySelectorAll("dt")).map((node) => node.textContent)).toEqual(["Billet", "Client", "Demande"]);
    expect(table.querySelectorAll("dd")[1]!.textContent).toBe("Sherweb");
    // the long value is whole: it wraps, it is never cut
    expect(table.querySelectorAll("dd")[2]!.textContent).toContain("[Alliance:#1894992/]");
    const sentence = Array.from(host.querySelectorAll("*")).find((node) => node.children.length === 0 && node.textContent?.includes("je n'ai trouvé aucune règle"))!;
    expect(table.compareDocumentPosition(sentence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // the sentence stays, for a client that ignores the field
    expect(host.textContent).toContain("je n'ai trouvé aucune règle");
  });

  it("a ticket number stays a record chip, a plain value stays text", () => {
    mount({ facts: FACTS });
    const rows = host.querySelectorAll("[data-ask-facts] dd");
    expect(rows[0]!.querySelector("button")?.textContent).toContain("#300769");
    expect(rows[1]!.querySelector("button")).toBeNull();
  });

  it("a card without facts is drawn as before: no table", () => {
    mount({});
    expect(host.querySelector("[data-ask-facts]")).toBeNull();
    expect(host.textContent).toContain("Laisser");
  });
});

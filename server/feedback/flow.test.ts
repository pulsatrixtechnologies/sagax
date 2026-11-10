import { describe, expect, it } from "vitest";
import { isCancelOption, isSendOption, feedbackAnswers, feedbackLanguage, isVague, nextFeedbackStep, openFeedbackStep, parseKind, type FlowMessage } from "./flow.ts";

function bot(step: FlowMessage["feedback"], message: Omit<FlowMessage, "role" | "feedback">): FlowMessage {
  return { role: "bot", feedback: step, ...message };
}
const user = (text: string): FlowMessage => ({ role: "user", kind: "text", text });

describe("feedback flow (#3299: at most one question)", () => {
  it("asks one question when nothing says what went wrong, and never a second", () => {
    const first = nextFeedbackStep("en", { said: "" }, "r1");
    expect(first.kind).toBe("ask");
    if (first.kind !== "ask") return;
    expect(first.marker).toEqual({ step: "detail", reportId: "r1" });
    const thread: FlowMessage[] = [bot(first.marker, first.message), user("ok")];
    const answers = feedbackAnswers(thread, "r1", "");
    expect(answers).toMatchObject({ said: "", detail: "ok", asked: true });
    expect(nextFeedbackStep("en", answers, "r1").kind).toBe("preview");
  });

  it("asks nothing when the words or the chat's error say what went wrong", () => {
    expect(nextFeedbackStep("en", { said: "the routine list never loads at all" }, "r2").kind).toBe("preview");
    expect(nextFeedbackStep("fr", { said: "" }, "r2", "Provider returned 529 overloaded").kind).toBe("preview");
    expect(nextFeedbackStep("fr", { said: "bug" }, "r2").kind).toBe("ask");
  });

  it("reads the open step, keeps details added at the preview and ignores another report's messages", () => {
    const thread: FlowMessage[] = [
      bot({ step: "detail", reportId: "old" }, { kind: "text", text: "x" }), user("old answer"),
      bot({ step: "status", reportId: "old" }, { kind: "text", text: "sent" }),
      bot({ step: "preview", reportId: "new" }, { kind: "options", text: "?" }), user("It started after the update"),
      bot({ step: "preview", reportId: "new" }, { kind: "options", text: "?" }),
    ];
    expect(openFeedbackStep(thread)?.reportId).toBe("new");
    expect(feedbackAnswers(thread, "new", "words")).toEqual({ said: "words", extra: ["It started after the update"] });
  });

  it("parses a kind from free words, and detects vague answers and language", () => {
    expect(parseKind("Un bogue")).toBe("bug");
    expect(parseKind("j'ai une idée")).toBe("idea");
    expect(parseKind("How do I do this?")).toBe("question");
    expect(parseKind("")).toBeUndefined();
    expect(isVague("je sais pas")).toBe(true);
    expect(isVague("Le bouton Enregistrer ne fait rien")).toBe(false);
    expect(feedbackLanguage("Ça marche pas quand je clique")).toBe("fr");
    expect(feedbackLanguage("It does not work when I click")).toBe("en");
  });
});

describe("free confirmations", () => {
  it("recognizes loose send and cancel phrases but not long sentences", () => {
    for (const text of ["Oui, envoie-le", "go", "envoie", "send it", "Yes, send"]) expect(isSendOption(text, true)).toBe(true);
    for (const text of ["non", "ne l'envoie pas", "annule"]) { expect(isSendOption(text, true)).toBe(false); expect(isCancelOption(text, true)).toBe(true); }
    expect(isSendOption("Oui mais il faut aussi mentionner que le bouton est gris sur mobile quand on revient", true)).toBe(false);
    expect(isSendOption("go", false)).toBe(false);
  });
});

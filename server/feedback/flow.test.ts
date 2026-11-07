import { describe, expect, it } from "vitest";
import { feedbackAnswers, feedbackLanguage, isVague, nextFeedbackStep, openFeedbackStep, parseKind, type FlowMessage } from "./flow.ts";

function bot(step: FlowMessage["feedback"], message: Omit<FlowMessage, "role" | "feedback">): FlowMessage {
  return { role: "bot", feedback: step, ...message };
}
const user = (text: string): FlowMessage => ({ role: "user", kind: "text", text });

describe("feedback flow", () => {
  it("asks the kind first, then steps, expected, actual and impact for a bug", () => {
    const first = nextFeedbackStep("en", { followups: [] }, "r1");
    expect(first.kind).toBe("ask");
    if (first.kind !== "ask") return;
    expect(first.marker.step).toBe("kind");
    expect(first.message.kind).toBe("options");
    const thread: FlowMessage[] = [bot(first.marker, first.message), user("A bug")];
    const answers = feedbackAnswers(thread, "r1");
    expect(answers.kind).toBe("bug");
    const order: string[] = [];
    let current = thread;
    for (const reply of ["Open settings, click Save", "It saves the change", "Nothing happens, spinner forever", "Blocking"]) {
      const next = nextFeedbackStep("en", feedbackAnswers(current, "r1"), "r1");
      if (next.kind !== "ask") throw new Error("expected a question");
      order.push(next.marker.field ?? next.marker.step);
      current = [...current, bot(next.marker, next.message), user(reply)];
    }
    expect(order).toEqual(["steps", "expected", "actual", "impact"]);
    expect(nextFeedbackStep("en", feedbackAnswers(current, "r1"), "r1").kind).toBe("preview");
  });

  it("asks one to three follow-ups only when answers are vague", () => {
    const vague = { kind: "bug" as const, steps: "idk", expected: "ok", actual: "?", impact: "Minor", followups: [] };
    const first = nextFeedbackStep("fr", vague, "r2");
    expect(first.kind).toBe("ask");
    if (first.kind !== "ask") return;
    expect(first.marker.step).toBe("followup");
    const three = { ...vague, followups: [{ field: "steps", question: "a", answer: "b" }, { field: "expected", question: "a", answer: "b" }, { field: "actual", question: "a", answer: "b" }] };
    expect(nextFeedbackStep("fr", three, "r2").kind).toBe("preview");
    const clear = { kind: "bug" as const, steps: "Ouvrir les réglages puis cliquer Enregistrer", expected: "Le changement est gardé", actual: "Rien ne se passe, la roue tourne", impact: "Bloquant", followups: [] };
    expect(nextFeedbackStep("fr", clear, "r2").kind).toBe("preview");
  });

  it("asks only a description and impact for an idea, and only the question for a question", () => {
    const idea = nextFeedbackStep("en", { kind: "idea", followups: [] }, "r3");
    expect(idea.kind === "ask" && idea.marker.step).toBe("describe");
    const ideaDone = nextFeedbackStep("en", { kind: "idea", describe: "Let me pin a conversation to the top of the list", followups: [] }, "r3");
    expect(ideaDone.kind === "ask" && ideaDone.marker.step).toBe("impact");
    expect(nextFeedbackStep("en", { kind: "question", describe: "How do I share a bot with my team?", followups: [] }, "r3").kind).toBe("preview");
  });

  it("reads the open step and ignores another report's messages", () => {
    const thread: FlowMessage[] = [
      bot({ step: "kind", reportId: "old" }, { kind: "text", text: "x" }), user("A bug"),
      bot({ step: "status", reportId: "old" }, { kind: "text", text: "sent" }),
      bot({ step: "describe", reportId: "new" }, { kind: "text", text: "?" }),
    ];
    expect(openFeedbackStep(thread)?.reportId).toBe("new");
    expect(feedbackAnswers(thread, "new").kind).toBeUndefined();
  });

  it("parses a kind from the card or from free words, and detects vague answers and language", () => {
    expect(parseKind("Un bogue")).toBe("bug");
    expect(parseKind("j'ai une idée")).toBe("idea");
    expect(parseKind("How do I do this?")).toBe("question");
    expect(isVague("je sais pas")).toBe(true);
    expect(isVague("Le bouton Enregistrer ne fait rien")).toBe(false);
    expect(feedbackLanguage("Ça marche pas quand je clique")).toBe("fr");
    expect(feedbackLanguage("It does not work when I click")).toBe("en");
  });
});

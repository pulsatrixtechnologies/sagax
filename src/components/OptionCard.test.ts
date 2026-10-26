import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OptionCard, canDismissOptionCard, shouldHideOnboardingCard } from "./OptionCard";
import { t } from "@/lib/i18n";
import { StoreProvider, type Message } from "@/state/store";

const msg = (partial: Partial<Message> & Pick<Message, "id" | "kind">): Message => ({
  role: "bot",
  at: 1,
  ...partial,
});

describe("shouldHideOnboardingCard", () => {
  const quiz = msg({
    id: "quiz",
    kind: "options",
    card: {
      title: "What do you mostly want help with?",
      subtitle: "Pick whatever's closest; we can always expand from there.",
      options: ["Work & projects"],
    },
  });
  const greeting = msg({ id: "hi", kind: "text", text: "Hey — I'm Echo." });
  const user = msg({ id: "u1", role: "user", kind: "text", text: "Hi bro" });

  it("keeps the quiz until the person talks", () => {
    expect(shouldHideOnboardingCard(quiz, [greeting, quiz])).toBe(false);
  });

  it("hides once a later user message is on the path", () => {
    expect(shouldHideOnboardingCard(quiz, [greeting, quiz, user])).toBe(true);
  });

  it("hides an answered or dismissed quiz even with no later user message", () => {
    expect(
      shouldHideOnboardingCard({ ...quiz, card: { ...quiz.card!, answered: "Work & projects" } }, [greeting, quiz]),
    ).toBe(true);
    expect(
      shouldHideOnboardingCard({ ...quiz, card: { ...quiz.card!, dismissed: true } }, [greeting, quiz]),
    ).toBe(true);
  });

  it("never hides a live permission or question card", () => {
    const ask = msg({
      id: "ask",
      kind: "options",
      card: {
        title: "Approval needed",
        subtitle: "run rm",
        options: ["Allow", "Deny"],
        requestId: "req-1",
        tool: "Bash",
      },
    });
    expect(shouldHideOnboardingCard(ask, [greeting, quiz, user, ask])).toBe(false);
    const question = msg({
      id: "q",
      kind: "options",
      card: {
        title: "Your bot has a question",
        subtitle: "which file?",
        options: [],
        requestId: "req-2",
      },
    });
    expect(shouldHideOnboardingCard(question, [user, question])).toBe(false);
  });
});

describe("OptionCard", () => {
  it("names its icon-only dismiss button", () => {
    const card = msg({ id: "quiz", kind: "options", card: { title: "Pick one", subtitle: "", options: ["A thing"] } });
    const markup = renderToStaticMarkup(createElement(StoreProvider, null, createElement(OptionCard, { botId: "atlas", message: card })));
    expect(markup).toContain(`aria-label="${t("onboarding.card.dismiss")}"`);
    // the field opens from the "Other" row, after the card's own rows
    expect(markup).toContain(">Other<");
    expect(markup).toContain('aria-keyshortcuts="B"');
  });

  const render = (card: Message["card"]) => renderToStaticMarkup(
    createElement(StoreProvider, null, createElement(OptionCard, { botId: "atlas", message: msg({ id: "ask", kind: "options", card }) })),
  );

  it("waits in the shared question card: bold title, the bubble's fill, lettered rows", () => {
    const markup = render({ title: "Pick a region", subtitle: "Where should the bucket live?", options: ["us-east-1", "eu-west-1"], requestId: "r1" });
    expect(markup).toContain('data-ask-card="pending"');
    expect(markup).toContain("rounded-2xl bg-card p-4");
    expect(markup).not.toContain("text-accent-text");
    expect(markup).toMatch(/font-semibold[^"]*"><bdi dir="auto">Pick a region</);
    expect(markup).toMatch(/size-\[22px\][^>]*>A</);
    expect(markup).toContain("eu-west-1");
  });

  it("keeps an answered live ask, the pick marked and the rest dimmed", () => {
    const markup = render({ title: "Pick a region", subtitle: "Where?", options: ["us-east-1", "eu-west-1"], requestId: "r1", answered: "eu-west-1" });
    expect(markup).toContain('data-ask-card="settled"');
    expect(markup).toMatch(/aria-checked="true"[^]*eu-west-1/);
    expect(markup).toMatch(/opacity-45[^]*us-east-1/);
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain(">Other<");
  });

  it("says a live ask nobody answered was closed, not answered", () => {
    const markup = render({ title: "Pick a region", subtitle: "Where?", options: ["us-east-1"], requestId: "r1", answered: "unavailable" });
    expect(markup).toContain(t("question.status.closed"));
    expect(markup).not.toContain(t("question.status.answered"));
  });
});

describe("canDismissOptionCard", () => {
  it("does not let an unresolved live question be silently dismissed", () => {
    expect(canDismissOptionCard({
      title: "Your bot has a question",
      subtitle: "which file?",
      options: [],
      requestId: "req-1",
      requestType: "question",
    })).toBe(false);
  });

  it("keeps approval and settled-card dismissal behavior", () => {
    expect(canDismissOptionCard({
      title: "Approval needed", subtitle: "run command", options: ["Allow", "Deny"], requestId: "req-2", tool: "Bash",
    })).toBe(true);
    expect(canDismissOptionCard({
      title: "Question", subtitle: "answered", options: [], requestId: "req-3", requestType: "question", answered: "answer",
    })).toBe(true);
  });
});

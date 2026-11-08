import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { RunLog, runLogLabel } from "./RunLog";
import { runLogText, timelineEvents, type TimelineEvent } from "@/lib/taskTimeline";
import { ANSWER_NOT_DELIVERED, RESTART_TURN_NOTE, TURN_CUT_BY_RESTART } from "../../shared/restart-words";

const render = (events: TimelineEvent[]) => renderToStaticMarkup(createElement(RunLog, { events }));

describe("Run log", () => {
  it("shows an honest empty state without a copy control", () => {
    const html = render([]);
    expect(html).toContain("No recorded activity");
    expect(html).not.toContain("Copy redacted run log");
  });

  it("renders commands, failure and pending states without fabricating output", () => {
    const html = render(timelineEvents([
      { id: "a", at: 1, role: "bot", kind: "activity", tool: { name: "Bash", summary: "pnpm control:omb doctor", ok: true } },
      { id: "b", at: 2, role: "bot", kind: "activity", tool: { name: "Bash", summary: "pnpm control:omb ui click --name Missing", ok: false } },
      { id: "c", at: 3, role: "bot", kind: "activity", tool: { name: "Read" } },
    ]));
    expect(html).toContain("pnpm control:omb doctor");
    expect(html).toContain("Completed");
    expect(html).toContain("Failed");
    expect(html).toContain("No result");
    expect(html).not.toContain("animate-spin");
    expect(html).toContain("Commands may be shortened");
    expect(html).toContain('aria-label="Copy redacted run log"');
    expect(html).not.toContain("tests passed");
  });

  it("retains the live indicator only for the active tool turn", () => {
    const html = render(timelineEvents([{ id: "live", at: 100, role: "bot", kind: "activity", tool: { name: "Bash" } }], { busy: true, turnStartedAt: 90 }));
    expect(html).toContain("In progress");
    expect(html).toContain("animate-spin");
  });

  it("translates unverified status in active locale", () => {
    try {
      setLocale("fr");
      const html = render(timelineEvents([{ id: "c", at: 3, role: "bot", kind: "activity", tool: { name: "Read" } }]));
      expect(html).toContain("Aucun résultat");
    } finally {
      setLocale("en");
    }
  });

  it("keeps long histories bounded and wraps command text", () => {
    const events: TimelineEvent[] = Array.from({ length: 205 }, (_, i) => ({ id: `${i}`, at: i, label: `item-${i}`, state: "complete", kind: "tool", command: `echo item-${i}` }));
    const html = render(events);
    expect(html).toContain("latest 200 entries");
    expect(html).not.toContain("echo item-0<");
    expect(html).toContain("echo item-204");
    expect(html).toContain("whitespace-pre-wrap break-all");
    expect(html.match(/<li /g)).toHaveLength(200);
  });

  it("shows and copies restart lines in the app's language", () => {
    setLocale("fr");
    try {
      const events = timelineEvents([
        { id: "a", at: 1, role: "bot", kind: "activity", tool: { name: TURN_CUT_BY_RESTART, ok: false } },
        { id: "b", at: 2, role: "bot", kind: "activity", tool: { name: RESTART_TURN_NOTE } },
        { id: "c", at: 3, role: "bot", kind: "activity", tool: { name: ANSWER_NOT_DELIVERED, ok: false } },
      ]);
      const html = render(events);
      const copied = runLogText(events, runLogLabel);
      for (const shown of [html, copied]) {
        expect(shown).toContain("Sagax a redémarré");
        expect(shown).toContain("Impossible de livrer cette réponse");
        expect(shown).not.toContain("Sagax restarted");
        expect(shown).not.toContain("Couldn&#x27;t deliver");
        expect(shown).not.toContain("Couldn't deliver");
      }
    } finally {
      setLocale("en");
    }
  });
});

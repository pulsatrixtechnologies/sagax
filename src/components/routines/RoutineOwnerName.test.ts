// A routine always acts in its owner's name (JC, 2026-10-08): no consent,
// no "Reconnect my routines", no switch. A routine the server paused (its
// person is out or lost the right to run the bot) shows one neutral line; an
// old card from a missing, ended or revoked delegation shows nothing.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { Routine } from "@/lib/routines";
import { AccessCard, accessCardLines } from "../AccessCard";
import { RoutineList, routineSuspendedText } from "./RoutineList";

const OWNER = "pr_00000000-0000-4000-8000-0000000000a0";
const BOB = "pr_00000000-0000-4000-8000-0000000000b0";

describe("the paused routine line", () => {
  const card = {
    reason: "routine_delegation" as const, engine: "", botId: "bot-1", ownerPrincipalId: OWNER,
    runAsPrincipalId: BOB, runAsName: "Bob", routineId: "r1", routineName: "Dispatch matin TN",
  };

  it("shows nothing for an old delegation card, to anyone", () => {
    for (const suspendReason of ["delegation_missing", "delegation_ended", "delegation_revoked"] as const) {
      for (const viewer of [{ principalId: BOB, admin: false }, { principalId: OWNER, admin: true }]) {
        expect(accessCardLines({ ...card, suspendReason }, viewer)).toBeNull();
        expect(renderToStaticMarkup(createElement(AccessCard, { access: { ...card, suspendReason }, viewer }))).toBe("");
      }
    }
  });

  it("says once, neutrally, why the server paused it: no card, no key, no button", () => {
    const out = { ...card, suspendReason: "person_out" as const };
    expect(accessCardLines(out, { principalId: BOB, admin: false })).toEqual({
      text: "The routine \"Dispatch matin TN\" is paused. Perspicax signed this person out.",
      plain: true,
    });
    expect(accessCardLines({ ...card, suspendReason: "no_right" }, { principalId: OWNER, admin: false })?.text)
      .toBe("The routine \"Dispatch matin TN\" is paused. This person can no longer run this bot's routines.");
    const markup = renderToStaticMarkup(createElement(AccessCard, { access: out, viewer: { principalId: BOB, admin: false } }));
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("<svg");
    expect(markup).not.toContain("bg-warning");
    expect(markup).not.toMatch(/Reconnect|never allowed|act in/);
  });

  it("says it in French", () => {
    setLocale("fr");
    try {
      expect(accessCardLines({ ...card, suspendReason: "person_out" }, { principalId: BOB, admin: false })?.text)
        .toBe("La routine « Dispatch matin TN » est en pause. Perspicax a déconnecté cette personne.");
    } finally {
      setLocale("en");
    }
  });
});

describe("the routine list", () => {
  const routine = {
    id: "r1", name: "Hourly report", prompt: "p", target: "bot", botId: "bot-1", runOn: "maus", enabled: true,
    schedule: { type: "cron", expression: "0 * * * *", timeZone: "UTC" }, durationMinutes: 30, nextRunAt: null, createdAt: 1, updatedAt: 1,
    runAs: { principalId: BOB, name: "Bob" },
  } as unknown as Routine;

  it("says who a routine runs as, with no delegation banner for the person it runs as", () => {
    const markup = renderToStaticMarkup(createElement(RoutineList, { routines: [routine], runs: [], onOpen: () => {}, viewerPrincipalId: BOB }));
    expect(markup).toContain("Runs as Bob");
    expect(markup).toContain("Every hour at :00 · UTC");
    expect(markup).not.toContain("data-routine-delegation-banner");
    expect(markup).not.toMatch(/allow them to act in your name|Allow my routines/);
  });

  it("says why the server paused one", () => {
    const paused = { ...routine, suspended: { reason: "person_out", at: 5 } } as Routine;
    expect(renderToStaticMarkup(createElement(RoutineList, { routines: [paused], runs: [], onOpen: () => {} }))).toContain("Paused: person signed out");
    expect(routineSuspendedText("no_right")).toBe("Paused: no longer allowed to run this bot");
  });
});

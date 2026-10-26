import { afterEach, describe, expect, it } from "vitest";

import { setLocale } from "./i18n";
import { teamMemorySettled } from "./team-memory-settled";

const refusal = (body: Record<string, unknown>, status = 409) => Object.assign(new Error(String(body.error ?? "")), { status, body });

afterEach(() => setLocale("en"));

describe("teamMemorySettled", () => {
  it("reads an already accepted card: the card shows accepted, the person reads who", () => {
    const settled = teamMemorySettled(refusal({ code: "team_memory_settled", outcome: "allowed-once", settledBy: "Dana" }));
    expect(settled).toEqual({ text: "Dana already accepted this team memory entry.", card: { answered: "allow" } });
  });

  it("reads an already declined or deleted card, without a name", () => {
    const settled = teamMemorySettled(refusal({ code: "team_memory_settled", outcome: "rejected" }));
    expect(settled).toEqual({ text: "Someone else already declined or deleted this team memory entry.", card: { answered: "deny" } });
  });

  it("reads an entry that is gone", () => {
    expect(teamMemorySettled(refusal({ code: "team_memory_settled", outcome: "unavailable" }))?.card).toEqual({ answered: "unavailable", dismissed: true });
  });

  it("speaks the person's language", () => {
    setLocale("fr");
    expect(teamMemorySettled(refusal({ code: "team_memory_settled", outcome: "allowed-once", settledBy: "Dana" }))?.text)
      .toBe("Dana a déjà accepté cette entrée de la mémoire d'équipe.");
  });

  it("leaves every other error alone", () => {
    expect(teamMemorySettled(new Error("offline"))).toBeNull();
    expect(teamMemorySettled(refusal({ code: "team_memory_settled", outcome: "allowed-once" }, 403))).toBeNull();
    expect(teamMemorySettled(refusal({ error: "busy" }))).toBeNull();
    expect(teamMemorySettled(null)).toBeNull();
  });
});

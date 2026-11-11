import { describe, expect, it } from "vitest";

import {
  ANSWER_NOT_DELIVERED,
  CUT_TWICE,
  outwardSentence,
  PARALLEL_NOT_STARTED,
  RESTART_TURN_NOTE,
  TURN_CUT_BY_RESTART,
  TURN_NOT_RESUMED,
  TURN_RESUME_FAILED_PREFIX,
  restartSentenceIn,
  restartSentenceKey,
} from "./restart-words.ts";

describe("restart words", () => {
  it("recognizes every line a restart leaves", () => {
    expect(restartSentenceKey(TURN_CUT_BY_RESTART)).toEqual({ key: "restart.cut" });
    expect(restartSentenceKey(`${TURN_RESUME_FAILED_PREFIX}engine gone`)).toEqual({ key: "restart.resumeFailed", detail: "engine gone" });
    expect(restartSentenceKey(TURN_NOT_RESUMED)).toEqual({ key: "restart.notResumed" });
    expect(restartSentenceKey(RESTART_TURN_NOTE)).toEqual({ key: "restart.turnNote" });
    expect(restartSentenceKey(PARALLEL_NOT_STARTED)).toEqual({ key: "parallel.notStarted" });
    expect(restartSentenceKey(ANSWER_NOT_DELIVERED)).toEqual({ key: "answer.notDelivered" });
    expect(restartSentenceKey("something else")).toBeNull();
  });

  it("says them in French for a French reader and leaves English alone", () => {
    expect(restartSentenceIn("fr-CA", TURN_CUT_BY_RESTART)).toBe("tour interrompu : Sagax a redémarré");
    expect(restartSentenceIn("fr", `${TURN_RESUME_FAILED_PREFIX}engine gone`)).toBe("tour interrompu : Sagax a redémarré et la reprise a échoué : engine gone");
    expect(restartSentenceIn("en", TURN_CUT_BY_RESTART)).toBe(TURN_CUT_BY_RESTART);
    expect(restartSentenceIn("fr", "no engine")).toBe("no engine");
  });

  // #3217: the line of a cut turn that already acted outward, and the one of
  // a turn cut twice, are restart lines too, so a reader's language says them.
  it("recognizes a cut turn that acted outward, with what it did, and a turn cut twice", () => {
    const line = outwardSentence([{ kind: "email", label: "GMAIL_SEND_EMAIL" }, { kind: "pushed", label: "git push" }], 2);
    expect(line).toBe("Interrupted by a Sagax restart after it already sent an email (GMAIL_SEND_EMAIL), pushed (git push) and 2 more; not resumed, so nothing is done twice.");
    expect(restartSentenceKey(line)).toEqual({ key: "restart.outward", more: 2,
      actions: [{ kind: "email", label: "GMAIL_SEND_EMAIL" }, { kind: "pushed", label: "git push" }] });
    expect(restartSentenceKey(CUT_TWICE)).toEqual({ key: "restart.cutTwice" });
    expect(restartSentenceKey("Interrupted by a Sagax restart after it already left")).toBeNull();
  });

  it("says the outward line in French, the actions too", () => {
    const line = outwardSentence([{ kind: "message", label: "SLACK_SEND_MESSAGE" }], 0);
    expect(restartSentenceIn("fr-CA", line)).toBe(
      "interrompu par un redémarrage de Sagax après avoir déjà envoyé un message (SLACK_SEND_MESSAGE) ; pas repris, pour que rien ne soit fait deux fois.");
    expect(restartSentenceIn("en", line)).toBe(line);
  });
});

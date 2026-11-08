import { describe, expect, it } from "vitest";

import {
  ANSWER_NOT_DELIVERED,
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
});

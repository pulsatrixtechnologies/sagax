import { describe, expect, it, vi } from "vitest";

import { notificationInterrupts } from "../notify.ts";
import { createNotifyAccess } from "./notifyAccess.ts";

// #3719: an access card (sign in, a key, a payer) leaves its audience
// something only they can do. It is a needs-you, so it still reaches them
// when the turn was not theirs (a routine run, a hand-off), while a plain
// failure of such a turn stays silent.
describe("notifyAccess routes an access card as a needs-you (#3719)", () => {
  it("a routine turn's access refusal interrupts its audience", () => {
    const notify = vi.fn();
    const host = {
      DATA_DIR: "/nowhere",
      IDENTITY: { kind: "solo" },
      store: { bot: () => ({ id: "b1", name: "Nova" }), isConfidentialThread: () => false, taskByThread: () => null },
      appendProblem: () => Promise.resolve(),
      reportBackgroundError: vi.fn(),
      redactSecretsInText: (text: string) => text,
      notify,
    };
    const failed = { kind: "turn-failed", botId: "b1", botName: "Nova", threadId: "t1", title: "Nova couldn't start", body: "Sign in again" };
    createNotifyAccess(() => host)(failed, { botId: "b1", ownerPrincipalId: "p1", reason: "no_access" });
    expect(notify).toHaveBeenCalledTimes(1);
    const sent = notify.mock.calls[0]![0];
    expect(sent).toMatchObject({ kind: "needs-you", title: "Nova couldn't start", body: "Sign in again" });
    expect(notificationInterrupts(sent)).toBe(true);
    expect(notificationInterrupts(failed as never)).toBe(false);
  });

  it("#4233: a fix card with a backup answering meanwhile rings but writes no refused turn", () => {
    const notify = vi.fn();
    const appendProblem = vi.fn(() => Promise.resolve());
    const host = {
      DATA_DIR: "/nowhere",
      IDENTITY: { kind: "solo" },
      store: { bot: () => ({ id: "b1", name: "Nova" }), isConfidentialThread: () => false, taskByThread: () => null },
      appendProblem,
      reportBackgroundError: vi.fn(),
      redactSecretsInText: (text: string) => text,
      notify,
    };
    const note = { kind: "routine-deferred", botId: "b1", botName: "Nova", threadId: "t1", title: "Reconnect Claude", body: "Codex runs meanwhile" };
    createNotifyAccess(() => host)(note, { botId: "b1", ownerPrincipalId: "p1", reason: "no_access", cause: "sign_in_expired", meanwhile: "Codex" });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(appendProblem).not.toHaveBeenCalled();
    createNotifyAccess(() => host)(note, { botId: "b1", ownerPrincipalId: "p1", reason: "no_access", cause: "sign_in_expired" });
    expect(appendProblem).toHaveBeenCalledTimes(1);
  });
});

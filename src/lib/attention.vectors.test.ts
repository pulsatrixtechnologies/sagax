// #4250 (S2): the desktop obeys the one attention policy. The same cases as
// the server (shared/attention-policy.vectors.json): the server's verdict
// goes on the wire as the frame's `notify` flag, and this computer's own
// path (buildNativeNotificationPayload, then messageAttention) shows a
// banner exactly when the policy says ring. Presence is the desktop's part:
// the person looking at that conversation in a focused window ("seen" on
// the server is the proof that one did).
import { describe, expect, it } from "vitest";

import { decideAttention } from "../../shared/attention-policy";
import { attentionVectors, vectorInput } from "../../shared/attention-policy-vectors";
import { messageAttention } from "./attention";
import { buildNativeNotificationPayload } from "./native-notification-payload";

const settings = { sound: true, persistent: false, badge: true, nudgeSound: true, nudgeShake: true } as Parameters<typeof messageAttention>[0]["settings"];
const allTypes = { bots: true, people: true, groups: true, approvals: true };

describe("the desktop follows the one attention policy (shared vectors)", () => {
  for (const vector of attentionVectors.cases) {
    it(vector.name, () => {
      // the server's verdict, before any client is asked
      const server = decideAttention(vectorInput(vector.input, { presence: false }));
      const wireNotify = server.verdict === "ring" ? undefined : false;
      const looking = vector.input.looking === true || vector.input.seen === true;
      const focus = { windowFocused: looking, activeThreadId: looking ? "thread-1" : null };
      const payload = buildNativeNotificationPayload({
        kind: vector.input.kind, senderName: "Scout", body: "words", threadId: "thread-1", botId: vector.input.botId,
        ...focus, platform: "darwin", typeSettings: allTypes, ...(wireNotify === false ? { notify: false } : {}),
      });
      const shown = payload.show && messageAttention({ kind: vector.input.kind, threadId: "thread-1", ...focus, settings }).show;
      expect(shown).toBe(vector.expected.verdict === "ring");
    });
  }
});

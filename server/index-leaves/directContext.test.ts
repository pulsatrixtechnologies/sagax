import { describe, expect, it } from "vitest";
import { isContextMessage } from "../context/delta-context.ts";
import { transcriptText } from "../messages/replies.ts";
import { createDirectContext } from "./directContext.ts";

// #4236: a bot row of a handed call is stored as plain text every client
// shows; only what the model reads carries the untrusted markers.
describe("directContext: a call row's caller words (#4236)", () => {
  const host = {
    isContextMessage,
    peerLineText: () => "",
    store: { messagesFor: () => [] },
    transcriptText,
    cfg: {},
  };
  const directContext = createDirectContext(() => host);
  const bot = { id: "bot_abc", name: "Helper" };

  it("reads a call row with caller data inside the markers, and leaves its stored text as is", () => {
    const row = { id: "m1", at: 1, role: "bot", kind: "text", via: "call", callerData: true, text: "Call received from Other.\n\nQuel est le statut?" };
    const [entry] = directContext(bot, "t1", [row]);
    expect(entry).toMatchObject({ id: "m1", role: "assistant", text: 'Call received from Other.\n\n<<<UNTRUSTED source="call">>>\nQuel est le statut?\n<<<END UNTRUSTED>>>' });
    expect(row.text).toBe("Call received from Other.\n\nQuel est le statut?");
  });

  it("leaves a call row without caller data, and a person's own words, as written", () => {
    const passed = { id: "m2", at: 2, role: "bot", kind: "text", via: "call", text: "Call passed to Helper." };
    const own = { id: "m3", at: 3, role: "user", kind: "text", via: "call", callerData: true, text: "Hi.\n\nThere." };
    expect(directContext(bot, "t1", [passed, own]).map((entry: { text: string }) => entry.text)).toEqual(["Call passed to Helper.", "Hi.\n\nThere."]);
  });
});

import { describe, expect, it } from "vitest";
import type { Message } from "./store.ts";
import { videoSourceMessage } from "./video-source.ts";

const line = (id: string, at: number, person = "alice"): Message => ({ id, at, role: "user", kind: "text", text: id, sender: { id: person, name: person } });
describe("video input belongs to the current request", () => {
  const messages = [line("old", 1), line("source", 2), line("other-person", 3, "bob"), line("queued", 5)];
  it("pins direct requests and excludes later queued messages and other room members", () => {
    expect(videoSourceMessage({ messages, startedAt: 4, principalId: "alice", routine: false })?.id).toBe("source");
    expect(videoSourceMessage({ messages, messageId: "source", startedAt: 6, principalId: "alice", routine: false })?.id).toBe("source");
    expect(videoSourceMessage({ messages, messageId: "other-person", startedAt: 6, principalId: "alice", routine: false })).toBeUndefined();
  });
  it("does not inherit an old attached image for routine or peer work", () => {
    expect(videoSourceMessage({ messages, startedAt: 6, routine: true })).toBeUndefined();
    expect(videoSourceMessage({ messages: [{ ...line("peer", 1), peerAsk: { botId: "peer", name: "Peer" } }], startedAt: 6, routine: false })).toBeUndefined();
  });
});

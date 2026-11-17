import { describe, expect, it } from "vitest";

import { createReplayPendingProactive } from "./replayPendingProactive.ts";

describe("replayPendingProactive sealed rows", () => {
  it("offers a sealed event once when the file still matches the row", () => {
    const offered: Array<{ key: string }> = [];
    const event = { botId: "nova", source: "mail", key: "mail-1", label: "Email", detail: "SECRET" };
    const host = {
      proactivePending: {
        take: () => [
          { botId: "nova", key: "mail-1", ref: { kind: "sealed", id: "a".repeat(32) } },
          { botId: "nova", key: "other", ref: { kind: "sealed", id: "b".repeat(32) } },
          { botId: "nova", key: "missing", ref: { kind: "sealed", id: "c".repeat(32) } },
        ],
        readSealed: (id: string) => {
          if (id === "a".repeat(32)) return event;
          if (id === "b".repeat(32)) return { ...event, key: "nope" };
          return null;
        },
      },
      proactiveWaker: { replayPending: (_rows: unknown, offer: () => void) => offer() },
      offerProactive: (row: { key: string }) => offered.push(row),
    };
    createReplayPendingProactive(() => host)();
    expect(offered).toEqual([event]);
  });
});

// Avatar from a drop or a paste (src/lib/avatar-input.ts), the 25 MB limit,
// and the export; the reset of a bot's history (src/lib/bot-history-reset.ts)
// and the link to a bot (src/lib/thread-refs.ts botRefUrl).
import { describe, expect, it, vi } from "vitest";

import { AVATAR_INPUT_MAX_BYTES, avatarFileProblem, avatarImageFrom, dragMayCarryImage } from "./avatar-input";
import { historyResetThreads } from "./bot-history-reset";
import { botRefUrl, parseBotRefUrl } from "./thread-refs";

const file = (type: string, size = 10) => new File([new Uint8Array(size)], "x", { type });
const transfer = (files: File[], items: Array<{ kind: string; type: string; getAsFile: () => File | null }> = []) =>
  ({ files: files as unknown as FileList, items: items as unknown as DataTransferItemList, types: files.length ? ["Files"] : [] });

describe("avatar input", () => {
  it("takes the first picture of a drop, or of a pasted item, and nothing else", () => {
    const png = file("image/png");
    expect(avatarImageFrom(transfer([file("text/plain"), png]))).toBe(png);
    const pasted = file("image/jpeg");
    expect(avatarImageFrom(transfer([], [{ kind: "string", type: "text/plain", getAsFile: () => null }, { kind: "file", type: "image/jpeg", getAsFile: () => pasted }]))).toBe(pasted);
    expect(avatarImageFrom(transfer([file("application/pdf")]))).toBeNull();
    expect(avatarImageFrom(null)).toBeNull();
  });

  it("accepts a drag that may carry a file, and refuses one that carries text only", () => {
    expect(dragMayCarryImage({ types: ["Files"], items: [] as unknown as DataTransferItemList })).toBe(true);
    expect(dragMayCarryImage({ types: ["text/plain"], items: [] as unknown as DataTransferItemList })).toBe(false);
  });

  it("allows up to 25 MB of PNG, JPEG, GIF or WebP", () => {
    expect(AVATAR_INPUT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(avatarFileProblem({ type: "image/webp", size: AVATAR_INPUT_MAX_BYTES })).toBeNull();
    expect(avatarFileProblem({ type: "image/webp", size: AVATAR_INPUT_MAX_BYTES + 1 })).toBe("size");
    expect(avatarFileProblem({ type: "image/svg+xml", size: 10 })).toBe("type");
  });

  it("exports the current picture named after the bot, and fails loudly when it cannot be read", async () => {
    const { exportAvatarImage } = await import("./avatar-input");
    const failing = vi.fn(async () => new Response("", { status: 404 }));
    await expect(exportAvatarImage("/api/attachments/a.png", "Sky", failing as unknown as typeof fetch)).rejects.toThrow();
  });
});

describe("reset a bot's history", () => {
  it("archives the open conversations, never routine runs, confidential, hidden, bot-to-bot or archived ones", () => {
    const bot = {
      id: "atlas",
      threadId: "t1",
      tasks: [
        { threadId: "t1", title: "a", createdAt: 1 },
        { threadId: "t2", title: "b", createdAt: 2, routineRunId: "r" },
        { threadId: "t3", title: "c", createdAt: 3, confidential: true as const },
        { threadId: "t4", title: "d", createdAt: 4, archivedAt: 5 },
        { threadId: "t5", title: "e", createdAt: 6 },
        { threadId: "t6", title: "client", createdAt: 7, hidden: true as const },
        { threadId: "t7", title: "work", createdAt: 8, openedBy: { botId: "other", name: "Other" } },
        { threadId: "t8", title: "incidents", createdAt: 9, openedBy: { botId: "atlas", name: "Atlas" } },
      ],
    };
    expect(historyResetThreads(bot as never)).toEqual(["t1", "t5", "t8"]);
    expect(historyResetThreads({ threadId: "only" } as never)).toEqual(["only"]);
  });
});

describe("link to a bot", () => {
  it("is the canonical bot link the app opens", () => {
    expect(botRefUrl("bot-1")).toBe("openmausbot://bot/bot-1");
    expect(parseBotRefUrl(botRefUrl("bot-1"))).toEqual({ botId: "bot-1" });
  });
});

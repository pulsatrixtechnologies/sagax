import { describe, expect, it, vi } from "vitest";

import type { Message } from "../store.ts";
import {
  artifactChatCardRef,
  artifactChatCardText,
  findArtifactChatCard,
  placeArtifactChatCard,
  type ArtifactChatCardStore,
} from "./artifact-chat-card.ts";

function fakeStore(seed: Message[] = []) {
  const rows = [...seed];
  let next = 1;
  const store: ArtifactChatCardStore = {
    messagesFor: () => rows,
    appendMessage: vi.fn((_threadId, message) => {
      const full = { ...message, id: `m${next++}`, at: 1 } as Message;
      rows.push(full);
      return full;
    }),
    patchMessage: vi.fn((_threadId, messageId, patch) => {
      const index = rows.findIndex((row) => row.id === messageId);
      if (index < 0) return null;
      rows[index] = { ...rows[index], ...patch };
      return rows[index];
    }),
  };
  return { store, rows };
}

describe("placeArtifactChatCard", () => {
  it("appends a card on the first save", () => {
    const { store, rows } = fakeStore();
    const message = placeArtifactChatCard(store, "t1", { id: "art_aaaaaaaaaaaa", title: "CPU", rev: 1 }, true);
    expect(message.artifactCard).toEqual({ artifactId: "art_aaaaaaaaaaaa", title: "CPU", rev: 1 });
    expect(message.text).toBe("Artifact saved: CPU");
    expect(rows).toHaveLength(1);
    expect(store.appendMessage).toHaveBeenCalledOnce();
    expect(store.patchMessage).not.toHaveBeenCalled();
  });

  it("patches the same card on a later update instead of appending a second one", () => {
    const { store, rows } = fakeStore();
    placeArtifactChatCard(store, "t1", { id: "art_aaaaaaaaaaaa", title: "CPU", rev: 1 }, true);
    const patched = placeArtifactChatCard(store, "t1", { id: "art_aaaaaaaaaaaa", title: "CPU live", rev: 3 }, false);
    expect(rows).toHaveLength(1);
    expect(patched.artifactCard).toEqual({ artifactId: "art_aaaaaaaaaaaa", title: "CPU live", rev: 3 });
    expect(patched.text).toBe("Artifact updated: CPU live (v3)");
    expect(store.appendMessage).toHaveBeenCalledOnce();
    expect(store.patchMessage).toHaveBeenCalledOnce();
  });

  it("finds only a bot row that already carries that artifact id", () => {
    const messages: Message[] = [
      { id: "u1", at: 1, role: "user", kind: "text", text: "hi" },
      { id: "b1", at: 2, role: "bot", kind: "text", text: "other", artifactCard: { artifactId: "art_bbbbbbbbbbbb", title: "Other", rev: 1 } },
      { id: "b2", at: 3, role: "bot", kind: "text", text: "mine", artifactCard: { artifactId: "art_aaaaaaaaaaaa", title: "CPU", rev: 1 } },
    ];
    expect(findArtifactChatCard(messages, "art_aaaaaaaaaaaa")?.id).toBe("b2");
    expect(findArtifactChatCard(messages, "art_missing_____")).toBeUndefined();
    expect(artifactChatCardRef({ id: "art_aaaaaaaaaaaa", title: "CPU", rev: 2 })).toEqual({
      artifactId: "art_aaaaaaaaaaaa",
      title: "CPU",
      rev: 2,
    });
    expect(artifactChatCardText("CPU", 1, true)).toContain("saved");
  });
});

// Place or patch the chat card for a saved artifact (R7, #5462). One card
// per artifact id in the conversation: a later update_artifact enriches the
// existing row instead of appending a second card.
import type { Artifact } from "../../shared/artifacts.ts";
import type { Message } from "../store.ts";

export type ArtifactChatCardStore = {
  messagesFor(threadId: string): readonly Message[];
  appendMessage(threadId: string, message: Omit<Message, "id" | "at"> & { at?: number }): Message;
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): Message | null;
};

export type ArtifactChatCardRef = { artifactId: string; title: string; rev: number };

/** Find the existing bot row that already carries this artifact's card. */
export function findArtifactChatCard(
  messages: readonly Message[],
  artifactId: string,
): Message | undefined {
  return messages.find(
    (message) => message.role === "bot" && message.artifactCard?.artifactId === artifactId,
  );
}

export function artifactChatCardText(title: string, rev: number, created: boolean): string {
  return created
    ? `Artifact saved: ${title}`
    : `Artifact updated: ${title} (v${rev})`;
}

export function artifactChatCardRef(artifact: Pick<Artifact, "id" | "title" | "rev">): ArtifactChatCardRef {
  return { artifactId: artifact.id, title: artifact.title, rev: artifact.rev };
}

/** Append a new card, or patch title/rev on the one already in this thread. */
export function placeArtifactChatCard(
  store: ArtifactChatCardStore,
  threadId: string,
  artifact: Pick<Artifact, "id" | "title" | "rev">,
  created: boolean,
): Message {
  const ref = artifactChatCardRef(artifact);
  const existing = findArtifactChatCard(store.messagesFor(threadId), artifact.id);
  const text = artifactChatCardText(artifact.title, artifact.rev, created && !existing);
  if (existing) {
    return store.patchMessage(threadId, existing.id, { text, artifactCard: ref }) ?? existing;
  }
  return store.appendMessage(threadId, {
    role: "bot",
    kind: "text",
    text,
    artifactCard: ref,
  });
}

/**
 * A claude.ai artifact was published (#2018): seen in a Claude stream
 * (server/drivers/claude/stream-content.ts) or made by the claude_artifact
 * tool. Listeners (server/index.ts) drop the summary cache of that url and
 * track the person's own artifacts for the comments routine.
 */
export interface ArtifactPublishedEvent {
  url: string;
  title?: string;
  /** the engine's account owns it */
  owned?: boolean;
  botId?: string;
  threadId?: string;
  /** a principal already known by the caller (the claude_artifact tool) */
  principalId?: string;
}

type Listener = (event: ArtifactPublishedEvent) => void;
const listeners = new Set<Listener>();

export function onArtifactPublished(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function noteArtifactPublished(event: ArtifactPublishedEvent): void {
  for (const listener of listeners) {
    try { listener(event); } catch { /* a listener never breaks a stream */ }
  }
}

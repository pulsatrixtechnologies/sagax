
export interface RecallPassage {
  source: "memory" | "conversation";
  label: string;
  at?: number;
  snippet: string;
  /** A conversation passage's thread (#4407): its words ride the turn that
   * recalls it, so that conversation's session carries this thread. */
  threadId?: string;
}

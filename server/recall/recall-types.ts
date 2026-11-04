
export interface RecallPassage {
  source: "memory" | "conversation";
  label: string;
  at?: number;
  snippet: string;
}

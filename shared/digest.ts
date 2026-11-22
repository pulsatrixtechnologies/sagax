// Observed per-turn evidence, shared by server and companion renderers.
export type HookCoverage = "full" | "preview" | "none";

export interface DigestFiles {
  changed: string[];
  added: string[];
  deleted: string[];
  /** How many paths were cut from the lists above to stay within bounds. */
  truncated?: number;
}

export interface DigestTool {
  name: string;
  count: number;
  failed: number;
  /** One redacted one-line sample of the tool's input (the existing chip summary). */
  sample?: string;
}

export interface TurnDigest {
  turnId: string;
  botId: string;
  threadId: string;
  at: number;
  durationMs: number;
  tools: DigestTool[];
  /** Total observed calls, including tool names omitted from the list. */
  toolCalls?: number;
  /** Tools beyond the busiest MAX_TOOLS, dropped from `tools`. */
  toolsDropped?: number;
  files?: DigestFiles;
  memory: Array<{ path: string; kind: "created" | "updated" | "deleted" }>;
  memoryDropped?: number;
  /** First sentence of the terminal assistant text, at most REPLY_CHARS. */
  reply: string;
  usage?: { input: number; output: number; cachedInput?: number; costUsd?: number | null };
  hookCoverage: HookCoverage;
  /** Organization server (2026-10-01): which credentials the turn ran with,
   * never a secret: the payer's own subscription or key, the bot owner's
   * (their own turn, the bot's routines), or the organization's key. */
  access?: DigestAccess;
}

export interface DigestAccess {
  via: "subscription" | "owner-key" | "speaker-key" | "server" | "org-key";
  payer: "speaker" | "owner" | "organization";
  payerPrincipalId?: string;
  /** The bot's routine (or a hop one started): the owner's credentials. */
  routine?: true;
  /** #5180: which of the four forms served. Absent on rows from before it. */
  form?: "personal-account" | "org-account" | "personal-key" | "org-key";
}

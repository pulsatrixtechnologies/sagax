// The qualification task corpus. Synthetic and versioned: every prompt is
// invented text, there are no keys, people, or customer data in it. Changing a
// task, its parameters or its expectation changes CORPUS_VERSION, because a
// Grok Bot run is only comparable to a Sagax run of the same version.
//
// The executable side of each `kind` lives in scenarios.ts; this file is the
// data a person also reads (corpus-v1.md is generated from it).

export const CORPUS_VERSION = "1";

export const CATEGORIES = [
  "reply", "busy", "delegation", "routine", "files", "pages", "failover", "cancel", "reconnect", "restart", "concurrent",
] as const;
export type Category = (typeof CATEGORIES)[number];

export interface TaskDefinition {
  id: string;
  category: Category;
  title: string;
  /** Scenario factory in scenarios.ts. */
  kind: string;
  params: Record<string, unknown>;
  /** What the person sees when it works. The same words guide the manual Grok Bot run. */
  expect: string;
  /** How to do it by hand in Grok Bot. null when Grok Bot has no equivalent (skip and say so). */
  manual: string | null;
  /** Latency joins p50/p95 (no deliberate hold in the scenario). */
  timed: boolean;
  /** The scenario injects a fault only a fake engine can produce (limit, restart, held tool). */
  needsFakeEngine: boolean;
  /** Counts toward the restart recovery metric. */
  restart?: boolean;
}

const LONG = "Synthetic filler sentence about a quarterly planning meeting that never happened. ".repeat(260);

export const CORPUS: readonly TaskDefinition[] = [
  // ---- single replies ----
  { id: "reply-01", category: "reply", title: "Short English question", kind: "reply", params: { prompt: "What is the capital of a made-up country called Zorvania?", style: "stream" },
    expect: "One reply, streamed, no second reply.", manual: "Send the prompt in a new conversation. Start the stopwatch on Send; note first visible text and the end of the reply.", timed: true, needsFakeEngine: false },
  { id: "reply-02", category: "reply", title: "Short French question with accents", kind: "reply", params: { prompt: "Résume en une phrase pourquoi l'été à Québec est très court. Réponds en français.", style: "echo" },
    expect: "One reply, accents intact.", manual: "Same as reply-01 with this French prompt.", timed: true, needsFakeEngine: false },
  { id: "reply-03", category: "reply", title: "Long prompt (about 20 KB)", kind: "reply", params: { prompt: LONG, style: "echo" },
    expect: "One reply, the whole prompt accepted.", manual: "Paste the filler sentence 260 times, then send.", timed: true, needsFakeEngine: false },
  { id: "reply-04", category: "reply", title: "Emoji, right to left and CJK text", kind: "reply", params: { prompt: "Echo this: 🙂 שלום עולם 你好世界 ✓ done", style: "echo" },
    expect: "One reply, no mangled characters.", manual: "Send the text as is.", timed: true, needsFakeEngine: false },
  { id: "reply-05", category: "reply", title: "Turn with three tool calls", kind: "reply", params: { prompt: "List three synthetic files, then say done.", style: "stream", tools: 3 },
    expect: "Three tool rows, one final reply.", manual: "Ask for a task that uses three tools (list files three times). Count tool rows and replies.", timed: true, needsFakeEngine: true },
  { id: "reply-06", category: "reply", title: "Two turns in one conversation", kind: "sequence", params: { prompts: ["First synthetic question about gardening.", "Second synthetic question about composting."] },
    expect: "Each question answered once, in order.", manual: "Send the first, wait for the end, send the second. Stopwatch the second.", timed: true, needsFakeEngine: false },

  // ---- busy sends ----
  { id: "busy-01", category: "busy", title: "One message sent while the bot works", kind: "busy", params: { extra: 1 },
    expect: "Both messages are answered (folded into the turn or queued), none lost, none answered twice.", manual: "Send a message that takes about 30 seconds, then a second one 5 seconds later.", timed: false, needsFakeEngine: true },
  { id: "busy-02", category: "busy", title: "Three messages sent while the bot works", kind: "busy", params: { extra: 3 },
    expect: "All four messages answered once.", manual: "As busy-01 with three follow-ups, 3 seconds apart.", timed: false, needsFakeEngine: true },
  { id: "busy-03", category: "busy", title: "Bot-routed busy send", kind: "busy", params: { extra: 1, routeWhileBusy: true },
    expect: "The second message is routed by the bot, answered once.", manual: null, timed: false, needsFakeEngine: true },
  { id: "busy-04", category: "busy", title: "Second conversation while the first works", kind: "busy-parallel", params: {},
    expect: "The second conversation answers without waiting for the first.", manual: "Open a second conversation with the same bot while the first is busy and send there.", timed: false, needsFakeEngine: true },

  // ---- delegation ----
  { id: "delegation-01", category: "delegation", title: "Chief hands work to one teammate", kind: "delegate", params: { shape: "single" },
    expect: "The teammate answers once, the chief reports once, every assignment ends in a terminal state.", manual: "Ask the primary bot to have one teammate do a small task and report back.", timed: true, needsFakeEngine: true },
  { id: "delegation-02", category: "delegation", title: "Chief hands work to two teammates", kind: "delegate", params: { shape: "fan" },
    expect: "Both answer once, the chief reports once with both results.", manual: "As delegation-01 with two teammates.", timed: true, needsFakeEngine: true },
  { id: "delegation-03", category: "delegation", title: "Chief, lead and specialist chain", kind: "delegate", params: { shape: "chain" },
    expect: "Work passes down and the results come back up, once each.", manual: "Ask the primary bot to delegate to a lead who delegates to a specialist.", timed: true, needsFakeEngine: true },

  // ---- routines ----
  { id: "routine-01", category: "routine", title: "Routine run now", kind: "routine", params: { runs: 1 },
    expect: "One run, completed, its result in the results thread.", manual: "Create a routine with a short prompt and press Run now.", timed: true, needsFakeEngine: false },
  { id: "routine-02", category: "routine", title: "Routine run twice in a row", kind: "routine", params: { runs: 2 },
    expect: "Two distinct runs, each completed once.", manual: "Press Run now twice, waiting for the first to finish.", timed: true, needsFakeEngine: false },
  { id: "routine-03", category: "routine", title: "Scheduled one-time routine", kind: "routine", params: { scheduledInMs: 4000 },
    expect: "Runs once at its time, without a click.", manual: "Schedule a one-time routine 2 minutes ahead; note the start delay.", timed: false, needsFakeEngine: false },

  // ---- files ----
  { id: "files-01", category: "files", title: "Chunked upload and download", kind: "upload", params: { chunks: 3 },
    expect: "The committed file downloads byte for byte.", manual: "Attach a 3 MB synthetic file, send, then download it from the conversation.", timed: false, needsFakeEngine: false },
  { id: "files-02", category: "files", title: "Upload resumed with a replayed chunk and commit", kind: "upload", params: { chunks: 3, replay: true },
    expect: "Offsets are honoured, replays are harmless, bytes are exact.", manual: null, timed: false, needsFakeEngine: false },
  { id: "files-03", category: "files", title: "File attached to a message and answered", kind: "upload", params: { chunks: 2, attach: true },
    expect: "The bot reply arrives once and the file is listed in the thread.", manual: "Attach a small file and ask a question about it.", timed: true, needsFakeEngine: false },

  // ---- pages ----
  { id: "pages-01", category: "pages", title: "Bot proposes a page", kind: "page", params: { publish: false },
    expect: "A draft page with version 1 exists, once.", manual: "Ask the bot to create a one-page HTML report.", timed: false, needsFakeEngine: true },
  { id: "pages-02", category: "pages", title: "Page proposed then published by the person", kind: "page", params: { publish: true },
    expect: "The page publishes with a link, once.", manual: "As pages-01, then publish it.", timed: false, needsFakeEngine: true },

  // ---- provider limit and failover ----
  { id: "failover-01", category: "failover", title: "Primary engine at its usage limit", kind: "failover", params: { goBack: false },
    expect: "The request continues on the backup engine: one user message, one reply, no error text.", manual: "Needs an account at its limit; record n/a unless you can reach one safely.", timed: false, needsFakeEngine: true },
  { id: "failover-02", category: "failover", title: "Limit reset returns to the primary", kind: "failover", params: { goBack: true },
    expect: "After the reset the next turn runs on the primary again.", manual: null, timed: false, needsFakeEngine: true },

  // ---- cancel ----
  { id: "cancel-01", category: "cancel", title: "Stop during a tool call", kind: "cancel", params: { variant: "tool" },
    expect: "The bot stops, is idle within seconds, and shows no final reply for the stopped turn.", manual: "Start a long task, press Stop while a tool runs.", timed: false, needsFakeEngine: true },
  { id: "cancel-02", category: "cancel", title: "Stop then send again", kind: "cancel", params: { variant: "resend" },
    expect: "The next message is answered once.", manual: "After Stop, send a new message and check one reply.", timed: false, needsFakeEngine: true },
  { id: "cancel-03", category: "cancel", title: "Stop with a message queued behind the turn", kind: "cancel", params: { variant: "queued" },
    expect: "The bot ends idle and nothing runs by surprise afterwards.", manual: "Send two messages quickly, then Stop.", timed: false, needsFakeEngine: true },

  // ---- reconnect ----
  { id: "reconnect-01", category: "reconnect", title: "Event stream dropped mid-turn, resumed with its cursor", kind: "reconnect", params: { variant: "cursor" },
    expect: "The client sees the final reply, by replay or by reloading the thread, with no duplicate.", manual: "Start a long turn, turn Wi-Fi off for 10 seconds, then on. Check the reply appears once.", timed: false, needsFakeEngine: true },
  { id: "reconnect-02", category: "reconnect", title: "Reconnect with an unknown cursor", kind: "reconnect", params: { variant: "stale" },
    expect: "The server says it could not replay (resumed false) and the thread reload is complete.", manual: null, timed: false, needsFakeEngine: true },

  // ---- restart during a tool call ----
  { id: "restart-01", category: "restart", title: "Graceful server restart during a tool call", kind: "restart", params: { signal: "SIGTERM" },
    expect: "No stuck state: the accepted message is answered or the thread says it was interrupted.", manual: "Restart the Grok Bot service while a tool runs, if you can.", timed: false, needsFakeEngine: true, restart: true },
  { id: "restart-02", category: "restart", title: "Crash (SIGKILL) during a tool call", kind: "restart", params: { signal: "SIGKILL" },
    expect: "Same, after an unclean stop.", manual: "Kill the Grok Bot process while a tool runs, if you can.", timed: false, needsFakeEngine: true, restart: true },
  { id: "restart-03", category: "restart", title: "Crash with a message queued behind the turn", kind: "restart", params: { signal: "SIGKILL", queued: true },
    expect: "The queued message is neither lost nor run twice.", manual: null, timed: false, needsFakeEngine: true, restart: true },

  { id: "restart-04", category: "restart", title: "Graceful restart with a message queued behind the turn", kind: "restart", params: { signal: "SIGTERM", queued: true },
    expect: "The turn resumes once and the queued message is answered or run, not dropped.", manual: null, timed: false, needsFakeEngine: true, restart: true },

  // ---- concurrent sends ----
  { id: "concurrent-01", category: "concurrent", title: "Six bots messaged at the same moment", kind: "concurrent", params: { bots: 6, sends: 1 },
    expect: "Six replies, one each.", manual: "Message six bots within two seconds.", timed: true, needsFakeEngine: false },
  { id: "concurrent-02", category: "concurrent", title: "Eight rapid sends to one conversation", kind: "concurrent", params: { bots: 1, sends: 8 },
    expect: "Every message answered once.", manual: "Send eight short messages, one per second, to one bot.", timed: false, needsFakeEngine: true },
  { id: "concurrent-03", category: "concurrent", title: "Three bots, three sends each", kind: "concurrent", params: { bots: 3, sends: 3 },
    expect: "Nine messages answered once each, no cross-talk between bots.", manual: "Three bots, three messages each, interleaved.", timed: false, needsFakeEngine: true },
] as const;

export const CORPUS_IDS = CORPUS.map((task) => task.id);

/** The human-readable corpus, generated so the Grok Bot protocol cannot drift from the code. */
export function renderCorpusMarkdown(): string {
  const lines = [
    `# Qualification corpus v${CORPUS_VERSION}`,
    "",
    "Generated from `scripts/qualification/corpus.ts` by `--emit-corpus`. Do not edit by hand.",
    "",
    "Every prompt is synthetic. A task is one row; the manual column is what to do in Grok Bot.",
    "",
    "| Id | Category | Task | What must happen | Manual steps (Grok Bot) |",
    "|---|---|---|---|---|",
  ];
  for (const task of CORPUS) {
    lines.push(`| ${task.id} | ${task.category} | ${task.title} | ${task.expect} | ${task.manual ?? "No equivalent. Record skipped with the reason."} |`);
  }
  lines.push("");
  return lines.join("\n");
}

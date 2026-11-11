// 2026-11-02 (production): Grok 1.0.x moves a prompt of about 100 KB or
// more to a file under its own session folder on the Sagax server
// (.../.grok/sessions/<cwd>/<session>/prompts/prompt_0.txt) and sends the
// model an excerpt with "Lines of that file not in this message: user query
// line 415. Read only those lines from that file". Every offloaded prompt
// seen in production was 100,116 bytes or more; the line left out was the long
// "Historical excerpts" line of the conversation's earlier context.
//
// On an organization turn Grok has no file tools on the server, so the bot
// tried to read that file with its server environment's tools (another
// machine), and was refused. Sagax keeps the request under the limit itself.
//
// #3510 (production, 0.8.86): the opening prompt of a conversation reached
// about 104,000 characters and was cut by about 20 KB in the middle of its
// longest lines, which are whole sections (the work style, the rules). The
// bot read half sentences ("the middle of the message was cut"), lost rules
// such as "do arithmetic inline", and spent steps reading its own session
// back. Nothing is cut in the middle any more: an opening prompt over the
// target leaves out whole sections, least important first, then the
// earlier-context line, then the remaining sections but the rules, and says
// which ones and which tool returns each. What still cannot fit is logged
// with the bytes it passes the limit by. The person's request is never touched.

/** Grok's offload starts at about 100 KB (smallest offloaded: 100,116
 * bytes). The margin covers what Grok adds around the request. */
export const GROK_PROMPT_BYTE_LIMIT = 96_000;

/** What an opening prompt aims for: the engine's limit less a tenth, so a
 * long request, a recall or a grown section still fits whole. */
export function promptFitTarget(limit: number): number {
  return Math.floor(limit * 0.9);
}

/** The marker that starts the person's latest message in a turn's text. */
const LATEST_MESSAGE = "[Now reply to the user's latest message:]";
/** The line of the folded earlier context (server/context/compaction-summary.ts). */
const HISTORY_HEADER = "Historical excerpts in chronological order";

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/** What stands in for the earlier-context line when it goes out whole. */
export const HISTORY_LEFT_OUT_NOTE =
  "[Earlier messages of this conversation are left out of this request to keep it under the engine's size limit; find one with session_search and read it with session_read when the request needs it.]";

/** Sections an opening prompt can leave out, least important first, each with
 * the tool that returns it when one does (none: left out with no lookup). */
export const OPENING_DROP_ORDER: ReadonlyArray<{ id: string; label: string; find?: string }> = [
  { id: "memes", label: "Memes" },
  { id: "feedback", label: "Feedback" },
  { id: "recent", label: "Recent work", find: "session_search" },
  { id: "stream", label: "Earlier topics", find: "session_search" },
  { id: "docs", label: "Documents index", find: "workspace_read" },
  { id: "skills", label: "Skills index", find: "skills_list" },
  { id: "availability", label: "Team availability", find: "list_bots" },
  { id: "reactions", label: "Reactions" },
  { id: "images", label: "Images" },
  { id: "learn", label: "Skill authoring" },
  { id: "routine", label: "Routines" },
  { id: "browser", label: "Browser" },
  { id: "data", label: "Data" },
];

/** What an opening prompt still over the target leaves out next, after the
 * earlier-context line: the remaining sections, least important first. A
 * section in neither list goes before these, from the end of the prompt. */
export const OPENING_LAST_RESORT_ORDER: ReadonlyArray<{ id: string; label: string; find?: string }> = [
  { id: "rich-output", label: "Rich output" },
  { id: "proactive", label: "Proactive" },
  { id: "proactive-ask", label: "Proactive alerts" },
  { id: "threads", label: "Threads" },
  { id: "dev-pods", label: "Coding view" },
  { id: "team-computer", label: "Team computer" },
  { id: "computer", label: "Computer" },
  { id: "shell", label: "Long-running commands" },
  { id: "files", label: "File locations" },
  { id: "workplace", label: "Workspace" },
  { id: "section-context", label: "Section context" },
  { id: "outstanding", label: "Outstanding teammate work", find: "list_bots" },
  { id: "coordination", label: "Team", find: "list_bots" },
  { id: "peer-contact", label: "Peer contact" },
  { id: "group-memory", label: "Group memory" },
  { id: "team-memory", label: "Team memory" },
  { id: "playbooks", label: "Playbooks", find: "skills_list" },
  { id: "claude-ai", label: "Connectors" },
  { id: "perspicax", label: "Perspicax" },
  { id: "host-tools", label: "Host tools" },
  { id: "mcp", label: "MCP servers" },
  { id: "profile", label: "Profile changes" },
  { id: "user-profile", label: "About the user" },
  { id: "recall", label: "Recall" },
  { id: "memory", label: "Memory" },
  { id: "skill-instructions", label: "Skill instructions", find: "skills_list" },
  { id: "files-cwd", label: "Working folder" },
  { id: "reach", label: "Reach" },
  { id: "voice-call", label: "Phone call" },
  { id: "mentions", label: "Mentions" },
  { id: "plan", label: "Surface" },
  { id: "routine-execution", label: "Routine execution" },
  { id: "goal", label: "Goal" },
  { id: "tools", label: "Tools" },
  { id: "model", label: "Model" },
  { id: "credential", label: "Credentials" },
];

/** Never left out: the security policy and the rules a bot obeys (identity,
 * standing instructions, RULES.md, work style, approval level, setup, the
 * trust rules of a webhook, an assignment or an AI client). The person's
 * request is the turn's text, never a section. */
export const OPENING_KEPT: ReadonlySet<string> = new Set([
  "misuse-policy", "run-yourself", "verify-first", "persona", "soul", "rules", "finish-until", "work-style",
  "approval-level", "setup", "webhook", "assignment", "ai-client",
]);

const labelOf = (id: string) => [...OPENING_DROP_ORDER, ...OPENING_LAST_RESORT_ORDER].find((entry) => entry.id === id);

/** The line that says which sections an opening prompt left out, the tool
 * that returns each one that has one, and that the others have no lookup. */
export function leftOutNote(ids: readonly string[]): string {
  if (!ids.length) return "";
  const rows = ids.map((id) => labelOf(id) ?? { id, label: id, find: undefined });
  const finds = new Map<string, string[]>();
  for (const row of rows) if (row.find) finds.set(row.find, [...(finds.get(row.find) ?? []), row.label]);
  const unfound = rows.filter((row) => !row.find).map((row) => row.label);
  const lookups = [...finds].map(([tool, labels]) => `${labels.join(", ")} with ${tool}`);
  return `\n\nLeft out of this message to keep it under the engine's size limit: ${rows.map((row) => row.label).join(", ")}.`
    + (lookups.length ? ` When a request needs one, look up ${lookups.join("; ")}.` : "")
    + (unfound.length ? ` ${unfound.join(", ")}: left out with no lookup.` : "");
}

/** The opening system block and the turn's text under `target` bytes
 * together, by whole sections only: first OPENING_DROP_ORDER, then the
 * earlier-context line of the text, then every other section but
 * OPENING_KEPT, least important first. `compose` builds the block without
 * the given sections; `present` names the sections the block holds (in
 * prompt order). `over` is how many bytes the result still passes the
 * target by (0 when it fits). Unchanged when it fits or no target is given. */
export function fitOpeningSystem(input: {
  compose: (leftOut: ReadonlySet<string>) => string;
  present: ReadonlySet<string>;
  text: string;
  target: number | undefined;
}): { system: string; text: string; leftOut: string[]; historyLeftOut: boolean; over: number } {
  const full = input.compose(new Set());
  const total = (system: string, text: string) => bytes(system) + 2 + bytes(text);
  if (!input.target || total(full, input.text) <= input.target) return { system: full, text: input.text, leftOut: [], historyLeftOut: false, over: 0 };
  const target = input.target;
  const leftOut = new Set<string>();
  let system = full;
  let text = input.text;
  let historyLeftOut = false;
  const fits = () => total(system, text) <= target;
  const leave = (id: string) => {
    leftOut.add(id);
    system = input.compose(leftOut) + leftOutNote([...leftOut]);
  };
  for (const entry of OPENING_DROP_ORDER) {
    if (fits()) break;
    if (input.present.has(entry.id)) leave(entry.id);
  }
  if (!fits()) {
    const withoutHistory = leaveOutHistory(text);
    if (withoutHistory.cut) { text = withoutHistory.text; historyLeftOut = true; }
  }
  const listed = new Set([...OPENING_DROP_ORDER, ...OPENING_LAST_RESORT_ORDER].map((entry) => entry.id));
  const unlisted = [...input.present].filter((id) => !listed.has(id) && !OPENING_KEPT.has(id)).reverse();
  for (const id of [...unlisted, ...OPENING_LAST_RESORT_ORDER.map((entry) => entry.id)]) {
    if (fits()) break;
    if (input.present.has(id) && !leftOut.has(id)) leave(id);
  }
  return { system, text, leftOut: [...leftOut], historyLeftOut, over: Math.max(0, total(system, text) - target) };
}

/** `text` with its earlier-context line (before the latest message) left out
 * whole, replaced by a note that says where to find it. */
function leaveOutHistory(text: string): { text: string; cut: number } {
  const lines = text.split("\n");
  const latest = lines.findIndex((line) => line.includes(LATEST_MESSAGE));
  const protectedFrom = latest >= 0 ? latest : lines.length;
  const history = lines.findIndex((line, index) => index < protectedFrom && line.includes(HISTORY_HEADER));
  if (history < 0) return { text, cut: 0 };
  const cut = bytes(lines[history]!);
  lines[history] = HISTORY_LEFT_OUT_NOTE;
  return { text: lines.join("\n"), cut };
}

/** `text` under `limit` bytes when the earlier-context line can go: that line
 * goes out whole, with a note that says where to find it, never a part of it
 * and never any other line. Unchanged when it already fits, no limit is
 * given, or it holds no earlier-context line before the latest message. */
export function fitPromptBytes(text: string, limit: number | undefined): { text: string; cut: number } {
  if (!limit || bytes(text) <= limit) return { text, cut: 0 };
  return leaveOutHistory(text);
}

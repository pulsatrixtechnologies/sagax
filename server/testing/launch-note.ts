// The volatile half of a bot's instructions rides in a new Claude session's
// first user message (claude.ts withVolatileNote, launch wording) so the
// system prompt file stays the same while memory and recent work change.
// Fakes fold it back into "the system prompt" they record and drop it from
// "the prompt", so a test reads both as the model receives them (port of
// OpenMausBot #3164).
const LAUNCH_NOTE = /^<system-reminder>\nThis part of your instructions changes from turn to turn, so it arrives here instead of in the system prompt\. It replaces any earlier copy:\n\n([\s\S]*?)\n<\/system-reminder>(?:\n\n)?/;

export function splitLaunchNote<T>(prompt: T): { note: string | null; prompt: T } {
  const message = (prompt as { message?: { content?: unknown } } | null)?.message;
  const content = message?.content;
  const strip = (text: string) => {
    const match = LAUNCH_NOTE.exec(text);
    return match ? { note: match[1]!, text: text.slice(match[0].length) } : null;
  };
  if (typeof content === "string") {
    const split = strip(content);
    if (split) return { note: split.note, prompt: { ...prompt, message: { ...message, content: split.text } } as T };
  } else if (Array.isArray(content)) {
    const at = content.findIndex((block: { type?: unknown; text?: unknown }) => block?.type === "text" && typeof block.text === "string");
    const split = at >= 0 ? strip(String(content[at].text)) : null;
    if (split) {
      const next = content.map((block, i) => (i === at ? { ...block, text: split.text } : block)).filter((_block, i) => i !== at || split.text);
      return { note: split.note, prompt: { ...prompt, message: { ...message, content: next } } as T };
    }
  }
  return { note: null, prompt };
}

/** The volatile half a user message carries, in the launch or the
 * mid-session wording, if any. */
export function volatileNoteIn(prompt: unknown): string | null {
  const text = JSON.stringify(prompt);
  const parsed = /<system-reminder>\\nThis part of your instructions (?:changes from turn to turn|changed since this session started)[^:]*:\\n\\n([\s\S]*?)\\n<\/system-reminder>/.exec(text);
  return parsed ? (JSON.parse(`"${parsed[1]}"`) as string) : null;
}

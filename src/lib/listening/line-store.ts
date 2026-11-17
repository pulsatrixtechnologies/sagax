// Listening to a conversation (#4100): the live transcript a card shows.
// Final lines (the ones the server keeps, idempotent by seq) and, on the
// device that listens, the line being spoken in each channel: grey until its
// words are final, then replaced by the final line. Other devices see final
// lines only (from the server). Pure: every change returns a new view.
import type { ListeningLine, ListeningSpeaker } from "../../../shared/listening";

export type ListeningChannelId = "microphone" | "computer";

export interface ListeningView {
  /** final lines, oldest first, one per seq */
  lines: ListeningLine[];
  /** the line being spoken, per channel: its words so far */
  partial: Partial<Record<ListeningChannelId, string>>;
  speakers: ListeningSpeaker[];
}

/** A line as the card draws it. */
export interface ListeningShownLine {
  key: string;
  speaker: string;
  text: string;
  /** being spoken: drawn in the secondary grey */
  live: boolean;
}

export const EMPTY_LISTENING_VIEW: ListeningView = { lines: [], partial: {}, speakers: [] };

/** The words being spoken in one channel (empty clears it). */
export function withPartial(view: ListeningView, channel: ListeningChannelId, text: string): ListeningView {
  const words = text.trim();
  if ((view.partial[channel] ?? "") === words) return view;
  const partial = { ...view.partial };
  if (words) partial[channel] = words;
  else delete partial[channel];
  return { ...view, partial };
}

/** Final lines (and the speakers they name) join: a seq already shown is
 * skipped; `channel` names the channel whose spoken line they replace. */
export function withFinal(view: ListeningView, lines: readonly ListeningLine[], speakers: readonly ListeningSpeaker[] = [], channel?: ListeningChannelId): ListeningView {
  const seqs = new Set(view.lines.map((line) => line.seq));
  const added = lines.filter((line) => line.text.trim() && !seqs.has(line.seq));
  let known = view.speakers;
  for (const speaker of speakers) {
    const at = known.findIndex((entry) => entry.key === speaker.key);
    if (at < 0) known = [...known, speaker];
    else if (known[at]!.label !== speaker.label) known = known.map((entry, i) => (i === at ? speaker : entry));
  }
  const partial = channel ? withPartial(view, channel, "").partial : view.partial;
  if (!added.length && known === view.speakers && partial === view.partial) return view;
  const merged = added.length ? [...view.lines, ...added].sort((a, b) => a.seq - b.seq) : view.lines;
  return { lines: merged, partial, speakers: known };
}

/** The lines the card draws: finals under their speaker's label, then the
 * line being spoken in each channel. `liveSpeaker` names who is speaking in
 * a channel before their line is final (the channel's latest speaker). */
export function shownLines(view: ListeningView, liveSpeaker: (channel: ListeningChannelId) => string): ListeningShownLine[] {
  const label = (key: string) => view.speakers.find((speaker) => speaker.key === key)?.label ?? key;
  const out: ListeningShownLine[] = view.lines.map((line) => ({ key: `seq-${line.seq}`, speaker: label(line.speaker), text: line.text, live: false }));
  for (const channel of ["microphone", "computer"] as const) {
    const text = view.partial[channel];
    if (text) out.push({ key: `live-${channel}`, speaker: liveSpeaker(channel), text, live: true });
  }
  return out;
}

/** The newest line under the card's title: the line being spoken, else the
 * newest final one. */
export function newestLine(shown: readonly ListeningShownLine[]): ListeningShownLine | null {
  return shown.at(-1) ?? null;
}

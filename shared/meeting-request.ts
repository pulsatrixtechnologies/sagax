// The consent card of a meeting the bot asked to join as a notetaker
// (join_meeting), and the live state it shows once the person approved.
import type { MeetingProvider } from "./meeting-links.ts";

export type MeetingStatus =
  /** Waiting for the person's approval on the card. */
  | "pending"
  /** Opening the link and filling the guest name. */
  | "joining"
  /** In the waiting room: a host must let the bot in. */
  | "waiting"
  /** Admitted; posting the consent announcement in the meeting chat. */
  | "announcing"
  /** Announcement posted: audio is captured and transcribed. */
  | "recording"
  /** Leaving and writing the summary. */
  | "ending"
  | "ended"
  | "declined"
  | "failed";

export const MEETING_LIVE_STATUSES: ReadonlySet<MeetingStatus> = new Set(["joining", "waiting", "announcing", "recording", "ending"]);

export interface MeetingRequestCardData {
  requestId: string;
  botId: string;
  threadId: string;
  provider: MeetingProvider;
  url: string;
  code: string;
  /** The name shown in the meeting: "<bot> (transcription)". */
  displayName: string;
  /** Why the bot asks (a calendar event, the person's request). */
  reason: string;
  /** False for a provider whose join flow does not ship yet: the card
   * explains and offers no join. */
  supported: boolean;
  status: MeetingStatus;
  /** Why it failed or ended, in plain words (English; the card shows a
   * localized line per status and this detail under it). */
  detail?: string;
  /** The last transcript lines, newest last, for the live card. */
  transcriptTail?: string[];
  /** Transcribed segments so far. */
  segments?: number;
  /** "participant": a participant objected in the meeting chat and the
   * bot left at once, dropping the audio not yet transcribed. */
  endReason?: "participant";
  startedAt?: number;
  recordingAt?: number;
  endedAt?: number;
}

/** What every meeting route answers while Settings > Developer > Experimental >
 * Meeting notetaker is off (HTTP 403). */
export const MEETINGS_DISABLED = {
  code: "meetings_disabled",
  error: "The meeting notetaker is off. Turn it on in Settings > Developer > Experimental.",
} as const;

/** The card's two answers, in both languages. */
export const MEETING_APPROVE_LABELS = ["Rejoindre et prendre des notes", "Join and take notes"] as const;
export const MEETING_DECLINE_LABELS = ["Pas cette fois", "Not this time"] as const;

/** Map a label on the card to allow/deny: anything else is a deny. */
export function meetingRequestBehavior(answer: string): "allow" | "deny" {
  const normalized = answer.trim().toLowerCase();
  return MEETING_APPROVE_LABELS.some((label) => label.toLowerCase() === normalized) ? "allow" : "deny";
}

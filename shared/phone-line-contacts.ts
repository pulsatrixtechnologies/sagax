// Phone-line SMS contacts for Perspicax Voice (#2194): persona and summary
// rules the owner (or their bot) sets for allowlisted numbers. Pure: no disk.
// The number lives on Perspicax's SMS allowlist; Sagax only stores how to reply.

import { normalizePhone } from "./allowed-recipients.ts";

export const PHONE_LINE_CONTACT_TOOL = "phone_line_contact";
export const PHONE_CONTACT_LIMITS = { persona: 1_000, label: 80, maxPerPerson: 40 } as const;

export type PhoneContactLanguage = "fr" | "en";

export interface PhoneLineContact {
  /** E.164. */
  number: string;
  /** Short label for the owner (never shown to the contact unless the persona says so). */
  label?: string;
  /** How the bot replies to this contact. Lives in the owner's profile, never in the repo. */
  persona: string;
  language: PhoneContactLanguage;
  /** When true, the bot must never reveal the owner's name or the bot's name. */
  hideOwnerName: boolean;
  /** When true, after each exchange the owner gets a one-line summary in their chat. */
  summarizeToOwner: boolean;
}

export interface PhoneLineContactSettings {
  /** When true, an SMS with no known sender kind (or that only reached triggers
   * as unknown) also posts a one-line notice in the owner's unified chat. */
  noticeUnknown: boolean;
}

const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  let text = "";
  for (const char of value.replace(INVISIBLE, "")) {
    const code = char.codePointAt(0) ?? 0;
    text += code >= 32 && code !== 127 ? char : " ";
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length > max ? "" : text;
}

/** Parse one contact row from a tool call. A string is the refusal. */
export function parsePhoneLineContact(args: unknown): PhoneLineContact | string {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  if (!row) return "phone_line_contact needs number and persona.";
  const number = typeof row.number === "string" ? normalizePhone(row.number) : null;
  if (!number) return "number must be a phone number, such as +1 514 555 0142.";
  const persona = clean(row.persona, PHONE_CONTACT_LIMITS.persona);
  if (!persona) return `persona: how the bot replies to this contact, at most ${PHONE_CONTACT_LIMITS.persona} characters.`;
  const label = row.label === undefined || row.label === null || row.label === ""
    ? undefined
    : clean(row.label, PHONE_CONTACT_LIMITS.label);
  if (row.label !== undefined && row.label !== null && row.label !== "" && !label) {
    return `label: at most ${PHONE_CONTACT_LIMITS.label} characters.`;
  }
  const language = row.language === "en" || row.language === "fr" ? row.language : "fr";
  return {
    number,
    persona,
    language,
    hideOwnerName: row.hide_owner_name === true || row.hideOwnerName === true,
    summarizeToOwner: row.summarize_to_owner !== false && row.summarizeToOwner !== false,
    ...(label ? { label } : {}),
  };
}

/** Closed wording injected into a trigger run for an allowlisted contact. */
export function phoneContactDirective(contact: PhoneLineContact): Record<string, string> {
  return {
    contactPersona: contact.persona,
    contactLanguage: contact.language,
    contactHideOwnerName: contact.hideOwnerName ? "yes" : "no",
    contactSummarizeToOwner: contact.summarizeToOwner ? "yes" : "no",
    ...(contact.label ? { contactLabel: contact.label } : {}),
  };
}

/** Guidance lines appended to the fenced telephony event for an allowlisted contact. */
export function phoneContactGuidance(contact: PhoneLineContact): string {
  return [
    "Allowlisted contact persona (follow when you reply by SMS to this sender):",
    `Persona: ${contact.persona}`,
    `Reply language: ${contact.language}`,
    `Never reveal the owner's or bot's name: ${contact.hideOwnerName ? "yes" : "no"}`,
    ...(contact.label ? [`Contact label (owner only): ${contact.label}`] : []),
  ].join("\n");
}

/** One-line notice in the owner's unified chat after an allowlisted exchange. */
export function phoneContactOwnerNotice(input: { label?: string; from: string; text: string }): string {
  const who = input.label?.trim() || input.from;
  const body = input.text.replace(/\s+/g, " ").trim().slice(0, 200);
  return `SMS from ${who}: ${body || "(empty)"}`;
}

/** One-line notice for an SMS with no allowlisted persona (owner setting). */
export function phoneUnknownOwnerNotice(input: { from: string; text: string }): string {
  const body = input.text.replace(/\s+/g, " ").trim().slice(0, 200);
  return `Unknown SMS from ${input.from}: ${body || "(empty)"}`;
}

/** Parse the phone_line_contact tool args into an action, or a refusal string. */
export function parsePhoneLineContactAction(args: unknown):
  | { action: "list" }
  | { action: "remove"; number: string }
  | { action: "notice_unknown"; noticeUnknown: boolean }
  | { action: "set"; contact: PhoneLineContact }
  | string {
  const row = args && typeof args === "object" && !Array.isArray(args) ? args as Record<string, unknown> : null;
  if (!row) return "phone_line_contact needs number and persona, or action list/remove.";
  const action = typeof row.action === "string" ? row.action.trim().toLowerCase() : "set";
  if (action === "list") return { action: "list" };
  if (action === "remove") {
    const number = typeof row.number === "string" ? normalizePhone(row.number) : null;
    if (!number) return "remove needs number, such as +1 514 555 0142.";
    return { action: "remove", number };
  }
  if (row.notice_unknown !== undefined || row.noticeUnknown !== undefined) {
    if (row.number === undefined || row.number === null || row.number === "") {
      return { action: "notice_unknown", noticeUnknown: row.notice_unknown === true || row.noticeUnknown === true };
    }
  }
  if (action !== "set") return "action: set (default), remove, or list.";
  const contact = parsePhoneLineContact(row);
  if (typeof contact === "string") return contact;
  return { action: "set", contact };
}

export const PHONE_LINE_CONTACT_TOOL_SPEC = {
  name: PHONE_LINE_CONTACT_TOOL,
  description:
    "Configure how this bot replies to an allowlisted SMS contact on the person's Perspicax Voice line (#2194). The number must already be on the person's SMS allowlist in Perspicax; this tool only stores the persona and summary rules in the person's Sagax profile. Pass number and persona. Optional: label, language (fr or en), hide_owner_name (never reveal the owner's or bot's name), summarize_to_owner (default true: one line in the owner's unified chat after each exchange). action remove deletes the contact. The contact's texts still wake Bot phone triggers; the persona is handed to that run as directives. Never a separate phone thread.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["set", "remove", "list"], description: "set (default), remove, or list." },
      number: { type: "string", description: "The contact's number, such as +1 514 555 0142." },
      persona: { type: "string", description: "How the bot replies to this contact (tone, language, what it may look up)." },
      label: { type: "string", description: "Short label for the owner." },
      language: { type: "string", enum: ["fr", "en"] },
      hide_owner_name: { type: "boolean" },
      summarize_to_owner: { type: "boolean" },
      notice_unknown: { type: "boolean", description: "With action set and no number: whether unknown senders also post a notice in the owner's chat." },
    },
  },
} as const;

// One-time acceptable-use consent before a bot may place phone calls for
// the person. Sagax wording (never third-party legal text). Pure.

export const PHONE_CALL_CONSENT_VERSION = 1 as const;

/** English source lines shown on the consent card (fr is localized in the UI). */
export const PHONE_CALL_CONSENT_POINTS_EN = [
  "Only lawful calls to people who agreed to hear from you or your organization.",
  "No marketing blasts, no mass dialing, no emergency numbers (911 and the like).",
  "You are responsible for how your bots use your phone line.",
] as const;

export const PHONE_CALL_CONSENT_APPROVE = ["Accept", "Accepter"] as const;
export const PHONE_CALL_CONSENT_DECLINE = ["Decline", "Refuser"] as const;

export type PhoneCallConsentStatus = "pending" | "accepted" | "declined";

export interface PhoneCallConsentCardData {
  requestId: string;
  botId: string;
  threadId: string;
  status: PhoneCallConsentStatus;
  /** Consent wording version the card records. */
  version: typeof PHONE_CALL_CONSENT_VERSION;
  /** epoch ms when the person accepted (absent while pending or declined). */
  acceptedAt?: number;
}

export function phoneCallConsentBehavior(answer: string): "allow" | "deny" {
  const normalized = answer.trim().toLowerCase();
  return PHONE_CALL_CONSENT_APPROVE.some((label) => label.toLowerCase() === normalized) ? "allow" : "deny";
}

export function phoneCallConsentAllowsCalls(record: { acceptedAt?: number; version?: number } | null | undefined): boolean {
  return Boolean(record?.acceptedAt && record.version === PHONE_CALL_CONSENT_VERSION);
}

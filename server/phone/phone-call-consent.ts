// Per-person phone-call acceptable-use consent. One file under
// principals/<id>/phone-call-consent.json (mode 0600). The person Accepts
// once; any of their bots may then place calls under org Ask/Deny and the
// existing outbound gates. Decline leaves calls off until they Accept.
import { existsSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  PHONE_CALL_CONSENT_VERSION,
  phoneCallConsentAllowsCalls,
  type PhoneCallConsentCardData,
} from "../../shared/phone-call-consent.ts";
import { writeFileAtomic } from "../atomic.ts";
import { personSettingsPrincipal } from "../people/person-settings.ts";

export const PHONE_CALL_CONSENT_FILE = "phone-call-consent.json";

export interface PhoneCallConsentRecord {
  version: typeof PHONE_CALL_CONSENT_VERSION;
  /** epoch ms when Accept was recorded. */
  acceptedAt: number;
  /** Which bot showed the card that was accepted (audit only). */
  botId?: string;
}

export class PhoneCallConsentStore {
  private readonly dataDir: string;
  private readonly now: () => number;

  constructor(dataDir: string, now: () => number = Date.now) {
    this.dataDir = dataDir;
    this.now = now;
  }

  private path(principalId: string): string | null {
    const id = personSettingsPrincipal(principalId);
    return id ? join(this.dataDir, "principals", id, PHONE_CALL_CONSENT_FILE) : null;
  }

  get(principalId: string): PhoneCallConsentRecord | null {
    const path = this.path(principalId);
    if (!path) return null;
    try {
      if (!existsSync(path) || lstatSync(path).isSymbolicLink()) return null;
      const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<PhoneCallConsentRecord>;
      if (!phoneCallConsentAllowsCalls(raw)) return null;
      return {
        version: PHONE_CALL_CONSENT_VERSION,
        acceptedAt: Number(raw.acceptedAt),
        ...(typeof raw.botId === "string" && raw.botId.trim() ? { botId: raw.botId.trim().slice(0, 128) } : {}),
      };
    } catch {
      return null;
    }
  }

  allows(principalId: string): boolean {
    return phoneCallConsentAllowsCalls(this.get(principalId));
  }

  accept(principalId: string, botId?: string): PhoneCallConsentRecord {
    const path = this.path(principalId);
    if (!path) throw new Error("no_person");
    const existing = this.get(principalId);
    if (existing) return existing;
    const record: PhoneCallConsentRecord = {
      version: PHONE_CALL_CONSENT_VERSION,
      acceptedAt: this.now(),
      ...(botId?.trim() ? { botId: botId.trim().slice(0, 128) } : {}),
    };
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw new Error("symlink");
    writeFileAtomic(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return record;
  }

  /** Build the pending consent card payload for the conversation. */
  pendingCard(input: { requestId: string; botId: string; threadId: string }): PhoneCallConsentCardData {
    return {
      requestId: input.requestId,
      botId: input.botId,
      threadId: input.threadId,
      status: "pending",
      version: PHONE_CALL_CONSENT_VERSION,
    };
  }
}

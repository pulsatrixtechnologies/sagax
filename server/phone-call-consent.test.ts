import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PHONE_CALL_CONSENT_VERSION, phoneCallConsentBehavior } from "../shared/phone-call-consent.ts";
import { PhoneCallConsentStore } from "./phone-call-consent.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function store(now = () => 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), "phone-consent-"));
  dirs.push(dir);
  return { dir, consent: new PhoneCallConsentStore(dir, now) };
}

describe("phoneCallConsentBehavior", () => {
  it("maps Accept and Accepter to allow, everything else to deny", () => {
    expect(phoneCallConsentBehavior("Accept")).toBe("allow");
    expect(phoneCallConsentBehavior("Accepter")).toBe("allow");
    expect(phoneCallConsentBehavior("accept")).toBe("allow");
    expect(phoneCallConsentBehavior("Decline")).toBe("deny");
    expect(phoneCallConsentBehavior("Refuser")).toBe("deny");
    expect(phoneCallConsentBehavior("maybe")).toBe("deny");
  });
});

describe("PhoneCallConsentStore", () => {
  it("starts without consent and accepts once per person", () => {
    const { dir, consent } = store();
    expect(consent.allows("jean")).toBe(false);
    expect(consent.get("jean")).toBeNull();
    const record = consent.accept("jean", "bot-a");
    expect(record).toEqual({ version: PHONE_CALL_CONSENT_VERSION, acceptedAt: 1_700_000_000_000, botId: "bot-a" });
    expect(consent.allows("jean")).toBe(true);
    expect(consent.accept("jean", "bot-b")).toEqual(record);
    const saved = JSON.parse(readFileSync(join(dir, "principals", "jean", "phone-call-consent.json"), "utf8"));
    expect(saved.acceptedAt).toBe(1_700_000_000_000);
    expect(consent.allows("alex")).toBe(false);
  });

  it("builds a pending consent card payload", () => {
    const { consent } = store();
    expect(consent.pendingCard({ requestId: "pcc_1", botId: "bot-a", threadId: "t-1" })).toEqual({
      requestId: "pcc_1",
      botId: "bot-a",
      threadId: "t-1",
      status: "pending",
      version: PHONE_CALL_CONSENT_VERSION,
    });
  });
});

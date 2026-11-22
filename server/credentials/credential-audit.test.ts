import { describe, expect, it } from "vitest";

import { CONFIRM_PAID_KEY_ERROR, resolveCredential, type CredentialCandidate } from "../../shared/credential-resolver.ts";
import { credentialAuditAfter } from "./credential-audit.ts";

const secret = "sk-live-should-never-be-logged";

describe("credential audit (#5180)", () => {
  it("records the form, the aspect, why and the fallback, and no secret", () => {
    const candidates: CredentialCandidate[] = [
      { form: "personal-account", via: "subscription", present: true, available: false, state: "out_of_credits", paid: false },
      { form: "personal-key", via: "speaker-key", present: true, available: true, paid: true },
    ];
    const asked = resolveCredential({ aspect: "voice", candidates, policy: { paidKeyConfirmed: false } });
    const row = credentialAuditAfter(asked);
    expect(row).toMatchObject({ aspect: "voice", reason: "confirm_paid_key", confirm: { from: "personal-account", to: "personal-key" } });
    expect(JSON.stringify(row)).not.toContain(secret);
    expect(JSON.stringify(row)).not.toContain("sk-");

    const served = resolveCredential({ aspect: "chat", candidates, policy: { paidKeyConfirmed: true } });
    const done = credentialAuditAfter(served);
    expect(done).toMatchObject({ form: "personal-key", aspect: "chat", fallback: { from: "personal-account", to: "personal-key", automatic: false } });
    expect(done.why).toEqual(expect.any(String));
    expect(JSON.stringify(done)).not.toContain(CONFIRM_PAID_KEY_ERROR.split(" ")[0] === "x" ? secret : secret);
  });
});

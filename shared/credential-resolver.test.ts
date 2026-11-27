import { describe, expect, it } from "vitest";

import {
  ACT_AS_PERSONAL_ERROR,
  CONFIRM_PAID_KEY_ERROR,
  PERSONAL_KEYS_OFF_ERROR,
  credentialFormText,
  formOfAccessVia,
  personalKeysEnabled,
  resolveCredential,
  type CredentialAspect,
  type CredentialCandidate,
  type CredentialForm,
} from "./credential-resolver.ts";

const ASPECTS: CredentialAspect[] = ["chat", "engine", "connector", "voice"];
const ENGINES = ["claudeAgent", "piAgent", "opencodeGo"] as const;

function candidate(form: CredentialForm, patch: Partial<CredentialCandidate> = {}): CredentialCandidate {
  return { form, via: form, present: true, available: true, ...patch };
}

/** The order callers pass today. This test does not sort it. */
const CURRENT_ORDER: CredentialForm[] = ["personal-account", "personal-key", "org-account", "org-key"];

describe("resolveCredential (#5180)", () => {
  it("keeps the caller's order and does not invent a different winner", () => {
    const reversed = [...CURRENT_ORDER].reverse().map((form) => candidate(form));
    expect(resolveCredential({ aspect: "chat", candidates: reversed }).form).toBe("org-key");
    expect(resolveCredential({ aspect: "chat", candidates: CURRENT_ORDER.map((form) => candidate(form)) }).form).toBe("personal-account");
  });

  it("lets each of the four forms serve chat, engines, connectors and voice", () => {
    for (const aspect of ASPECTS) {
      for (const engine of aspect === "engine" ? ENGINES : [undefined]) {
        for (const form of ["personal-account", "org-account", "personal-key", "org-key"] as const) {
          const decision = resolveCredential({
            aspect,
            ...(engine ? { engine } : {}),
            candidates: [candidate(form, { provider: engine })],
          });
          expect(decision).toMatchObject({ ok: true, form, aspect });
        }
      }
    }
  });

  it("refuses a personal credential under Act as unless that person allowed it", () => {
    const candidates = [candidate("personal-account"), candidate("personal-key"), candidate("org-key")];
    const refused = resolveCredential({
      aspect: "chat",
      candidates: [candidate("personal-key")],
      policy: { actingAs: "service-desk" },
    });
    expect(refused).toMatchObject({ ok: false, reason: "act_as_personal_refused", error: ACT_AS_PERSONAL_ERROR });
    expect(JSON.stringify(refused)).not.toMatch(/sk-|xai-|api[_-]?key/i);

    const roleKey = resolveCredential({ aspect: "engine", engine: "claudeAgent", candidates, policy: { actingAs: "service-desk" } });
    expect(roleKey).toMatchObject({ ok: true, form: "org-key" });

    const allowed = resolveCredential({
      aspect: "voice",
      candidates,
      policy: { actingAs: "service-desk", allowPersonalWhenActingAs: true },
    });
    expect(allowed).toMatchObject({ ok: true, form: "personal-account" });

    const own = resolveCredential({ aspect: "connector", candidates, policy: { actingAs: "" } });
    expect(own).toMatchObject({ ok: true, form: "personal-account" });
  });

  it("asks before a fallback lands on a paid API key, and moves account to account by itself", () => {
    const expiredAccount = candidate("personal-account", { available: false, state: "expired" });
    const toPersonalKey = resolveCredential({
      aspect: "engine",
      engine: "piAgent",
      candidates: [expiredAccount, candidate("personal-key")],
    });
    expect(toPersonalKey).toMatchObject({
      ok: false,
      reason: "confirm_paid_key",
      error: CONFIRM_PAID_KEY_ERROR,
      confirm: { from: "personal-account", to: "personal-key", form: "personal-key" },
    });

    const toOrgKey = resolveCredential({
      aspect: "voice",
      candidates: [candidate("personal-account", { available: false, state: "out_of_credits" }), candidate("org-key")],
    });
    expect(toOrgKey).toMatchObject({ ok: false, reason: "confirm_paid_key", confirm: { to: "org-key" } });

    const confirmed = resolveCredential({
      aspect: "chat",
      candidates: [expiredAccount, candidate("personal-key")],
      policy: { paidKeyConfirmed: true },
    });
    expect(confirmed).toMatchObject({
      ok: true,
      form: "personal-key",
      fallback: { from: "personal-account", to: "personal-key", automatic: false },
    });

    const accountToAccount = resolveCredential({
      aspect: "engine",
      engine: "claudeAgent",
      candidates: [
        candidate("personal-account", { via: "subscription:a", available: false, state: "expired" }),
        candidate("personal-account", { via: "subscription:b" }),
      ],
    });
    expect(accountToAccount).toMatchObject({
      ok: true,
      form: "personal-account",
      via: "subscription:b",
      fallback: { from: "personal-account", to: "personal-account", automatic: true },
    });

    const confirmedOverAccount = resolveCredential({
      aspect: "voice",
      candidates: [candidate("personal-account"), candidate("org-key")],
      policy: { paidKeyConfirmed: true },
    });
    expect(confirmedOverAccount).toMatchObject({
      ok: true,
      form: "org-key",
      fallback: { from: "personal-account", to: "org-key", automatic: false },
    });

    const onlyKey = resolveCredential({ aspect: "voice", candidates: [candidate("personal-key")] });
    expect(onlyKey).toMatchObject({ ok: true, form: "personal-key" });
    expect(onlyKey).not.toHaveProperty("fallback");
  });

  it("leaves personal keys on unless the organization turned them off", () => {
    expect(personalKeysEnabled(undefined)).toBe(true);
    expect(personalKeysEnabled({})).toBe(true);
    expect(personalKeysEnabled({ personalKeysEnabled: false })).toBe(false);

    const on = resolveCredential({
      aspect: "connector",
      candidates: [candidate("personal-key"), candidate("org-key")],
    });
    expect(on).toMatchObject({ ok: true, form: "personal-key" });

    const off = resolveCredential({
      aspect: "engine",
      engine: "opencodeGo",
      candidates: [candidate("personal-key"), candidate("org-key")],
      policy: { personalKeysEnabled: false },
    });
    expect(off).toMatchObject({ ok: true, form: "org-key" });

    const onlyPersonal = resolveCredential({
      aspect: "chat",
      candidates: [candidate("personal-key")],
      policy: { personalKeysEnabled: false },
    });
    expect(onlyPersonal).toMatchObject({ ok: false, reason: "personal_keys_disabled", error: PERSONAL_KEYS_OFF_ERROR });

    const accountStays = resolveCredential({
      aspect: "voice",
      candidates: [candidate("personal-account"), candidate("personal-key")],
      policy: { personalKeysEnabled: false },
    });
    expect(accountStays).toMatchObject({ ok: true, form: "personal-account" });
  });

  it("names the form in words and never a secret", () => {
    expect(credentialFormText("personal-account")).toBe("Personal account");
    expect(credentialFormText("org-key")).toBe("Organization API key");
    expect(formOfAccessVia("subscription")).toBe("personal-account");
    expect(formOfAccessVia("speaker-key")).toBe("personal-key");
    expect(formOfAccessVia("org-account")).toBe("org-account");
    expect(formOfAccessVia("org-key")).toBe("org-key");
    expect(formOfAccessVia("server")).toBeNull();
    const decision = resolveCredential({
      aspect: "voice",
      candidates: [candidate("personal-key", { via: "voice-key" })],
    });
    expect(JSON.stringify(decision)).not.toMatch(/sk-|xai-|Bearer |token/i);
  });
});

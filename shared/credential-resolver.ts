// One decision for the four credential forms (#5180). Callers pass
// candidates in the order they already resolve (engine-credentials.ts,
// voice-mode.ts, the account strategy in account-switch-host.ts). This
// function does not reorder them. The proposed merged order is written in
// docs/credential-order.md and is not applied here.
//
// A personal form is a personal account (a subscription sign-in) or a
// personal API key. An organization form is an organization account or an
// organization API key. Moving onto a paid API key
// from a form that was present and could not serve asks first. A move from
// one account or subscription onto another proceeds.

export const CREDENTIAL_FORMS = ["personal-account", "org-account", "personal-key", "org-key"] as const;
export type CredentialForm = (typeof CREDENTIAL_FORMS)[number];

export const CREDENTIAL_ASPECTS = ["chat", "engine", "connector", "voice"] as const;
export type CredentialAspect = (typeof CREDENTIAL_ASPECTS)[number];

/** Why a present form cannot serve. Never a secret, never a key value. */
export type CredentialState = "missing" | "expired" | "out_of_credits" | "refused" | "disabled" | "not_allowed";

export interface CredentialCandidate {
  form: CredentialForm;
  /** The existing via or source name (subscription, org-key, grok-account). */
  via: string;
  /** Configured. An absent form is not a candidate: the next form is primary. */
  present: boolean;
  /** Present and usable for this turn. */
  available: boolean;
  state?: CredentialState;
  /** An API key billed per use. Accounts and subscriptions are not. */
  paid?: boolean;
  /** Engine or provider name. Never a secret. */
  provider?: string;
}

export interface CredentialPolicy {
  /** A role slug. Absent or "" is the person themselves, not Act as. */
  actingAs?: string;
  /** Per person. Absent or false: Act as may not use a personal credential. */
  allowPersonalWhenActingAs?: boolean;
  /** Organization switch. Absent means on. False: personal API keys are off. */
  personalKeysEnabled?: boolean;
  /** The person confirmed a move onto a paid API key for this turn. */
  paidKeyConfirmed?: boolean;
  /** Which aspect asked. Recorded on the decision. */
  aspect?: CredentialAspect;
}

export interface CredentialFallback {
  from: CredentialForm;
  to: CredentialForm;
  /** True when the move stayed on an account or subscription. */
  automatic: boolean;
}

export interface PaidKeyConfirm {
  from: CredentialForm;
  to: CredentialForm;
  form: CredentialForm;
  via: string;
  aspect: CredentialAspect;
}

export type CredentialDecision =
  | {
    ok: true;
    form: CredentialForm;
    via: string;
    provider?: string;
    aspect: CredentialAspect;
    why: string;
    fallback?: CredentialFallback;
  }
  | {
    ok: false;
    reason: "act_as_personal_refused" | "no_credentials" | "personal_keys_disabled";
    error: string;
    aspect: CredentialAspect;
    why: string;
  }
  | {
    ok: false;
    reason: "confirm_paid_key";
    error: string;
    aspect: CredentialAspect;
    why: string;
    confirm: PaidKeyConfirm;
  };

export const ACT_AS_PERSONAL_ERROR = "Acting as a role cannot use this person's account or API key unless they allowed it. They can allow it in their settings. The organization credential can still serve.";

export const CONFIRM_PAID_KEY_ERROR = "Continuing would use a paid API key. Confirm that charge before this turn uses it.";

export const PERSONAL_KEYS_OFF_ERROR = "Personal API keys are turned off for this organization.";

export function isCredentialForm(value: unknown): value is CredentialForm {
  return typeof value === "string" && (CREDENTIAL_FORMS as readonly string[]).includes(value);
}

export function personalCredential(form: CredentialForm): boolean {
  return form === "personal-account" || form === "personal-key";
}

/** A paid API key. An account or subscription is not one, whatever its plan. */
export function paidApiKey(candidate: Pick<CredentialCandidate, "form" | "paid">): boolean {
  if (candidate.paid === false) return false;
  if (candidate.paid === true) return candidate.form === "personal-key" || candidate.form === "org-key";
  return candidate.form === "personal-key" || candidate.form === "org-key";
}

export function actingAsRole(policy: CredentialPolicy | undefined): string {
  return policy?.actingAs?.trim() ?? "";
}

/** Act as may use a personal credential only with this person's consent. */
export function personalCredentialAllowed(policy: CredentialPolicy | undefined): boolean {
  if (!actingAsRole(policy)) return true;
  return policy?.allowPersonalWhenActingAs === true;
}

/** Personal API keys inside an organization are on unless an admin turned them off. */
export function personalKeysEnabled(policy: CredentialPolicy | undefined): boolean {
  return policy?.personalKeysEnabled !== false;
}

/** The form an engine via already names. Solo `server` is not one of the four. */
export function formOfAccessVia(via: string | undefined): CredentialForm | null {
  if (via === "subscription") return "personal-account";
  if (via === "owner-key" || via === "speaker-key") return "personal-key";
  if (via === "org-account") return "org-account";
  if (via === "org-key") return "org-key";
  return null;
}

const FORM_LABEL_KEY = {
  "personal-account": "turnAccess.form.personalAccount",
  "org-account": "turnAccess.form.orgAccount",
  "personal-key": "turnAccess.form.personalKey",
  "org-key": "turnAccess.form.orgKey",
} as const;

export function credentialFormLabelKey(form: CredentialForm): (typeof FORM_LABEL_KEY)[CredentialForm] {
  return FORM_LABEL_KEY[form];
}

/** English words for a log or a chip before a locale pack has the key. */
export function credentialFormText(form: CredentialForm): string {
  if (form === "personal-account") return "Personal account";
  if (form === "org-account") return "Organization account";
  if (form === "personal-key") return "Personal API key";
  return "Organization API key";
}

function eligible(candidate: CredentialCandidate, policy: CredentialPolicy | undefined): { ok: true } | { ok: false; why: string; actAs: boolean; keysOff: boolean } {
  if (candidate.form === "personal-key" && !personalKeysEnabled(policy)) {
    return { ok: false, why: "personal API keys are off for this organization", actAs: false, keysOff: true };
  }
  if (personalCredential(candidate.form) && !personalCredentialAllowed(policy)) {
    return { ok: false, why: "Act as is not allowed to use a personal credential", actAs: true, keysOff: false };
  }
  return { ok: true };
}

/**
 * Pick the first candidate the policy still allows, in the caller's order.
 * A present form that cannot serve makes the next form a fallback. A fallback
 * onto a paid API key waits for confirmation. A fallback onto an account or
 * subscription proceeds. No candidate is reordered.
 */
export function resolveCredential(input: {
  aspect: CredentialAspect;
  engine?: string;
  candidates: readonly CredentialCandidate[];
  policy?: CredentialPolicy;
}): CredentialDecision {
  const aspect = input.aspect;
  const engine = input.engine ? ` for ${input.engine}` : "";
  // A confirmation means this turn may use the paid key. The account that
  // prompted it can still look available (the vendor refused it on the
  // previous try), so the confirmed key wins until the confirmation expires.
  if (input.policy?.paidKeyConfirmed === true) {
    const paid = input.candidates.find((candidate) => candidate.present && candidate.available && eligible(candidate, input.policy).ok && paidApiKey(candidate));
    const earlier = paid ? input.candidates.find((candidate) => candidate.present && candidate !== paid && input.candidates.indexOf(candidate) < input.candidates.indexOf(paid)) : undefined;
    if (paid && earlier) {
      return {
        ok: true,
        form: paid.form,
        via: paid.via,
        ...(paid.provider ? { provider: paid.provider } : {}),
        aspect,
        why: `${earlier.form} did not serve${engine}, and the paid API key was confirmed`,
        fallback: { from: earlier.form, to: paid.form, automatic: false },
      };
    }
  }
  let blockedEarlier: CredentialForm | undefined;
  let sawActAsBlock = false;
  let sawKeysOff = false;
  for (const candidate of input.candidates) {
    if (!candidate.present) continue;
    const gate = eligible(candidate, input.policy);
    if (!gate.ok) {
      if (gate.actAs) sawActAsBlock = true;
      if (gate.keysOff) sawKeysOff = true;
      continue;
    }
    if (!candidate.available) {
      blockedEarlier ??= candidate.form;
      continue;
    }
    // A policy skip is not a fallback. A fallback is an eligible form that
    // was configured and could not serve.
    const fallback: CredentialFallback | undefined = blockedEarlier
      ? { from: blockedEarlier, to: candidate.form, automatic: blockedEarlier === candidate.form || !paidApiKey(candidate) }
      : undefined;
    if (fallback && !fallback.automatic && input.policy?.paidKeyConfirmed !== true) {
      return {
        ok: false,
        reason: "confirm_paid_key",
        error: CONFIRM_PAID_KEY_ERROR,
        aspect,
        why: `a ${fallback.from} could not serve${engine}, and the next form is a paid API key (${candidate.form})`,
        confirm: { from: fallback.from, to: candidate.form, form: candidate.form, via: candidate.via, aspect },
      };
    }
    const why = fallback
      ? fallback.automatic
        ? `${fallback.from} could not serve${engine}, so ${candidate.form} serves without asking`
        : `${fallback.from} could not serve${engine}, and the paid API key was confirmed`
      : `${candidate.form} serves${engine}`;
    return {
      ok: true,
      form: candidate.form,
      via: candidate.via,
      ...(candidate.provider ? { provider: candidate.provider } : {}),
      aspect,
      why,
      ...(fallback ? { fallback } : {}),
    };
  }
  if (sawActAsBlock) {
    return { ok: false, reason: "act_as_personal_refused", error: ACT_AS_PERSONAL_ERROR, aspect, why: `Act as blocked a personal credential${engine} and nothing else serves` };
  }
  if (sawKeysOff) {
    return { ok: false, reason: "personal_keys_disabled", error: PERSONAL_KEYS_OFF_ERROR, aspect, why: `personal API keys are off${engine} and nothing else serves` };
  }
  return { ok: false, reason: "no_credentials", error: `No credential serves this ${aspect}.`, aspect, why: `no form serves${engine}` };
}

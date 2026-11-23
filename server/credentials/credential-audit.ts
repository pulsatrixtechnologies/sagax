// One audit row per credential decision (#5180). The row names the form,
// the aspect, why, and a fallback. It never carries a key, a token, or a
// secret field.
import { appendAdminAction } from "../activity/admin-activity.ts";
import type { CredentialDecision } from "../../shared/credential-resolver.ts";

/** The fields written for one decision. No key, token, or secret. */
export function credentialAuditAfter(decision: CredentialDecision): Record<string, unknown> {
  return decision.ok
    ? {
      aspect: decision.aspect,
      form: decision.form,
      via: decision.via,
      why: decision.why,
      ...(decision.provider ? { provider: decision.provider } : {}),
      ...(decision.fallback ? { fallback: decision.fallback } : {}),
    }
    : {
      aspect: decision.aspect,
      reason: decision.reason,
      why: decision.why,
      ...(decision.reason === "confirm_paid_key" ? { confirm: { from: decision.confirm.from, to: decision.confirm.to, form: decision.confirm.form, aspect: decision.confirm.aspect } } : {}),
    };
}

export function auditCredentialDecision(dataDir: string, input: {
  threadId?: string;
  botId?: string;
  decision: CredentialDecision;
  payerPrincipalId?: string;
}): void {
  const decision = input.decision;
  const after = credentialAuditAfter(decision);
  appendAdminAction(dataDir, {
    category: "engine",
    action: "credential.resolve",
    target: { kind: "turn", ...(input.threadId ? { id: input.threadId } : {}), ...(input.botId ? { name: input.botId } : {}) },
    changed: ["form", "aspect", "why"],
    after,
    actor: input.payerPrincipalId
      ? { kind: "person", principalId: input.payerPrincipalId, via: "sagax" }
      : { kind: "cli" },
  });
}

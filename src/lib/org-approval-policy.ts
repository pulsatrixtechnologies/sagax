// The organization's approval policy as the app shows it (2026-10-21,
// server/custom-rules-org.ts): whether "Toujours permettre" is on, and how
// many organization rules apply. Asked once a minute at most; until the
// answer comes (or when it fails) the cards keep Always allow, and the
// server refuses it anyway when the organization turned it off.
import { useEffect, useState } from "react";

import { api } from "@/state/store";

export interface OrgApprovalPolicyView {
  alwaysAllow: boolean;
  orgRules: number;
}

const FRESH_MS = 60_000;
const DEFAULT: OrgApprovalPolicyView = { alwaysAllow: true, orgRules: 0 };

let cached: { at: number; value: OrgApprovalPolicyView } | null = null;
let inflight: Promise<OrgApprovalPolicyView> | null = null;

export function loadOrgApprovalPolicy(force = false): Promise<OrgApprovalPolicyView> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return Promise.resolve(cached.value);
  inflight ??= api<Partial<OrgApprovalPolicyView>>("/api/custom-rules/policy")
    .then((body) => {
      const value = { alwaysAllow: body.alwaysAllow !== false, orgRules: Number(body.orgRules) || 0 };
      cached = { at: Date.now(), value };
      return value;
    })
    .catch(() => cached?.value ?? DEFAULT)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** A server answer said Always allow is off: remember it at once. */
export function noteOrgAlwaysAllowOff(): void {
  cached = { at: Date.now(), value: { ...(cached?.value ?? DEFAULT), alwaysAllow: false } };
}

export function useOrgApprovalPolicy(): OrgApprovalPolicyView {
  const [value, setValue] = useState<OrgApprovalPolicyView>(cached?.value ?? DEFAULT);
  useEffect(() => {
    let alive = true;
    void loadOrgApprovalPolicy().then((next) => {
      if (alive) setValue(next);
    });
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

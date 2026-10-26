// Where one Sagax server keeps the install-time unattended consent records,
// one per host (the "Sagax Remote Control" persistent service). A record is
// written when the service is enrolled (by an admin / org-signed token) and
// revoked from the Remote Sessions page. The file is 0600; it holds no tunnel
// address and no key, only the fact a key is bound. Loi 25: the record is the
// organization's own consent trail; it is pruned once revoked or long expired.
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  parseUnattendedConsent,
  revokeUnattendedConsent,
  type UnattendedConsent,
  type UnattendedConsentInput,
} from "../shared/remote-session-consent.ts";

const FILE = "remote-unattended-consent.json";
/** Keep a revoked or expired record this long for the audit, then drop it. */
const KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export function createUnattendedConsentStore(deps: { dataDir: string; now?: () => number }) {
  const now = deps.now ?? (() => Date.now());
  const file = path.join(deps.dataDir, FILE);
  let byHost = new Map<string, UnattendedConsent>();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { consents?: UnattendedConsent[] };
    if (Array.isArray(parsed.consents)) {
      for (const row of parsed.consents) {
        if (row && typeof row.hostKey === "string") byHost.set(row.hostKey, row);
      }
    }
  } catch {
    byHost = new Map();
  }

  const persist = () => {
    mkdirSync(deps.dataDir, { recursive: true });
    writeFileSync(file, JSON.stringify({ consents: [...byHost.values()] }), { mode: 0o600 });
    try { chmodSync(file, 0o600); } catch { /* windows */ }
  };

  const prune = () => {
    const cutoff = now() - KEEP_MS;
    let changed = false;
    for (const [key, row] of byHost) {
      const dead = row.revokedAt ? Date.parse(row.revokedAt) : (Date.parse(row.expiresAt) < cutoff ? Date.parse(row.expiresAt) : NaN);
      if (Number.isFinite(dead) && dead < cutoff) { byHost.delete(key); changed = true; }
    }
    if (changed) persist();
  };
  prune();

  return {
    /** Record consent at install. Returns the stored record, or null when the
     * input is incomplete (no host, org or installer: never a silent install). */
    grant(input: UnattendedConsentInput): UnattendedConsent | null {
      const consent = parseUnattendedConsent(input, now());
      if (!consent) return null;
      byHost.set(consent.hostKey, consent);
      persist();
      return consent;
    },
    get(hostKey: string): UnattendedConsent | null {
      return byHost.get(hostKey) ?? null;
    },
    list(): UnattendedConsent[] {
      return [...byHost.values()];
    },
    /** Revoke from the page: mark the record revoked (kept for the audit) and
     * return it, so the caller can propagate the stop to the host and Perspicax.
     * Null when nothing is enrolled for that host. */
    revoke(hostKey: string): UnattendedConsent | null {
      const current = byHost.get(hostKey);
      if (!current) return null;
      const revoked = revokeUnattendedConsent(current, now());
      byHost.set(hostKey, revoked);
      persist();
      return revoked;
    },
  };
}

export type UnattendedConsentStore = ReturnType<typeof createUnattendedConsentStore>;

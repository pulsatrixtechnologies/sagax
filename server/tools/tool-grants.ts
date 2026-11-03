// B2: who may use which tool scope beyond the defaults (docs/tool-policy.md).
// A grant names a subject (a bot or a person), a scope from the tool policy
// (`<area>:<tier>`), who granted it and when it ends. Revoking keeps the row
// for the audit trail. Stored as one JSON file in the data directory.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic } from "../atomic.ts";

export type GrantSubject = { kind: "bot" | "user"; id: string };
export interface ToolGrant {
  id: string;
  subject: GrantSubject;
  scope: string;
  grantedBy: string;
  grantedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  revokedBy?: string;
}

const SCOPE = /^[a-z0-9-]+:(read|write|admin)$/;

/** An unreadable file starts with no grants: closed, never open. */
function load(file: string): ToolGrant[] {
  if (!existsSync(file)) return [];
  try {
    const grants = (JSON.parse(readFileSync(file, "utf8")) as { grants?: unknown }).grants;
    return Array.isArray(grants) ? (grants as ToolGrant[]) : [];
  } catch (error) {
    console.error(`[tool-grants] ${file} unreadable, starting with no grants: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

export class ToolGrantStore {
  private grants: ToolGrant[];
  private readonly file: string | null;
  private readonly now: () => number;
  constructor(file: string | null, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    this.grants = file ? load(file) : [];
  }
  static inDataDir(dataDir: string): ToolGrantStore { return new ToolGrantStore(join(dataDir, "tool-grants.json")); }

  private save(): void {
    if (this.file) writeFileAtomic(this.file, `${JSON.stringify({ grants: this.grants }, null, 2)}\n`, { mode: 0o600 });
  }

  grant(subject: GrantSubject, scope: string, grantedBy: string, expiresAt?: number): ToolGrant {
    if (!SCOPE.test(scope)) throw new Error(`invalid scope ${scope}`);
    const row: ToolGrant = { id: `tg_${this.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, subject, scope, grantedBy, grantedAt: this.now(), ...(expiresAt ? { expiresAt } : {}) };
    this.grants.push(row);
    this.save();
    return row;
  }

  revoke(id: string, revokedBy: string): boolean {
    const row = this.grants.find((g) => g.id === id && g.revokedAt === undefined);
    if (!row) return false;
    row.revokedAt = this.now();
    row.revokedBy = revokedBy;
    this.save();
    return true;
  }

  active(subject?: GrantSubject): ToolGrant[] {
    const at = this.now();
    return this.grants.filter((g) => g.revokedAt === undefined && (g.expiresAt === undefined || g.expiresAt > at)
      && (!subject || (g.subject.kind === subject.kind && g.subject.id === subject.id)));
  }

  /** All rows, revoked and expired ones too (the review page). */
  all(): readonly ToolGrant[] { return this.grants; }

  /** A grant of this scope, or of the same area at a higher tier, covers it. */
  holds(subject: GrantSubject, scope: string): boolean {
    const [area, tier] = scope.split(":");
    const rank = { read: 0, write: 1, admin: 2 } as Record<string, number>;
    return this.active(subject).some((g) => {
      const [gArea, gTier] = g.scope.split(":");
      return gArea === area && rank[gTier!]! >= rank[tier!]!;
    });
  }
}

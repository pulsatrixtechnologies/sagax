// Which bots may use an enrolled host, and who the owner shared it with
// (#2957). Two kinds of entries in one file per server, written atomically:
//   - bot scope: {hostId, principalId, botIds} where the absence of an entry
//     means "All bots" (the default, never stored);
//   - share: {hostId, owner, kind person|team, targetId}, idempotent.
// Host ids stay opaque. Person isolation: a share is readable by its owner
// (to manage it) and by its target (to reach the host); nobody else sees it.
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.ts";
import { UNATTENDED_HOST_ID } from "../../shared/remote-unattended-host.ts";

const id = z.string().trim().min(1).max(200);
const scopeSchema = z.object({
  hostId: z.string().regex(UNATTENDED_HOST_ID),
  principalId: id,
  botIds: z.array(z.string().trim().min(1).max(200)).max(200),
  setAt: z.number().finite().nonnegative(),
}).strict();
const shareSchema = z.object({
  hostId: z.string().regex(UNATTENDED_HOST_ID),
  owner: id,
  kind: z.enum(["person", "team"]),
  targetId: id,
  sharedAt: z.number().finite().nonnegative(),
}).strict();
const fileSchema = z.object({
  version: z.literal(1),
  scopes: z.array(scopeSchema).max(5_000),
  shares: z.array(shareSchema).max(20_000),
}).strict();
type Scope = z.infer<typeof scopeSchema>;
type Share = z.infer<typeof shareSchema>;

export type HostShareKind = Share["kind"];
export interface HostShareTarget { kind: HostShareKind; id: string }
export interface SharedHostRef { hostId: string; owner: string }

const person = (value: string) => value.trim().toLowerCase();
const sameTarget = (share: Share, target: HostShareTarget) =>
  share.kind === target.kind && (target.kind === "person" ? person(share.targetId) === person(target.id) : share.targetId === target.id.trim());

export class RemoteHostSharing {
  private scopes: Scope[] = [];
  private shares: Share[] = [];
  private readonly file: string;
  private readonly now: () => number;
  constructor(file: string, now: () => number = Date.now) {
    this.file = file;
    this.now = now;
    try {
      if (!existsSync(file)) return;
      const stat = lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4_000_000) return;
      const parsed = fileSchema.parse(JSON.parse(readFileSync(file, "utf8")));
      this.scopes = parsed.scopes;
      this.shares = parsed.shares;
    } catch {
      // A damaged file reads as "All bots, no share" for every host.
      this.scopes = [];
      this.shares = [];
    }
  }

  // ---- bot scope -------------------------------------------------------

  /** The bots allowed on one host for this person: null = all bots. */
  botScope(principalId: string, hostId: string): string[] | null {
    const who = person(principalId);
    return this.scopes.find((entry) => entry.hostId === hostId && person(entry.principalId) === who)?.botIds ?? null;
  }

  /** Every stored scope of the person, by host id (hosts left out = all bots). */
  botScopes(principalId: string): Map<string, string[]> {
    const who = person(principalId);
    return new Map(this.scopes.filter((entry) => person(entry.principalId) === who).map((entry) => [entry.hostId, [...entry.botIds]]));
  }

  /** null or an empty list resets the host to "All bots". */
  setBotScope(principalId: string, hostId: string, botIds: string[] | null): string[] | null {
    const who = person(principalId);
    const rest = this.scopes.filter((entry) => !(entry.hostId === hostId && person(entry.principalId) === who));
    const ids = [...new Set((botIds ?? []).map((bot) => bot.trim()).filter(Boolean))];
    this.scopes = ids.length ? [...rest, scopeSchema.parse({ hostId, principalId: who, botIds: ids, setAt: this.now() })] : rest;
    this.save();
    return ids.length ? ids : null;
  }

  /** True when this bot may use the host for this person (no scope = every bot). */
  botAllowed(principalId: string, hostId: string, botId: string | null | undefined): boolean {
    const scope = this.botScope(principalId, hostId);
    if (!scope) return true;
    const bot = typeof botId === "string" ? botId.trim() : "";
    return Boolean(bot) && scope.includes(bot);
  }

  // ---- shares ----------------------------------------------------------

  /** Shares the owner made for one host. */
  sharesOf(owner: string, hostId: string): HostShareTarget[] {
    const who = person(owner);
    return this.shares
      .filter((share) => share.hostId === hostId && person(share.owner) === who)
      .map((share) => ({ kind: share.kind, id: share.targetId }));
  }

  /** Every share of the owner, by host id. */
  sharesByOwner(owner: string): Map<string, HostShareTarget[]> {
    const who = person(owner);
    const out = new Map<string, HostShareTarget[]>();
    for (const share of this.shares) {
      if (person(share.owner) !== who) continue;
      const list = out.get(share.hostId) ?? [];
      list.push({ kind: share.kind, id: share.targetId });
      out.set(share.hostId, list);
    }
    return out;
  }

  /** Idempotent: sharing twice with the same target keeps one entry. */
  share(owner: string, hostId: string, target: HostShareTarget): HostShareTarget[] {
    const who = person(owner);
    const exists = this.shares.some((share) => share.hostId === hostId && person(share.owner) === who && sameTarget(share, target));
    if (!exists) {
      const targetId = target.kind === "person" ? person(target.id) : target.id.trim();
      this.shares = [...this.shares, shareSchema.parse({ hostId, owner: who, kind: target.kind, targetId, sharedAt: this.now() })];
      this.save();
    }
    return this.sharesOf(owner, hostId);
  }

  unshare(owner: string, hostId: string, target: HostShareTarget): HostShareTarget[] {
    const who = person(owner);
    const before = this.shares.length;
    this.shares = this.shares.filter((share) => !(share.hostId === hostId && person(share.owner) === who && sameTarget(share, target)));
    if (this.shares.length !== before) this.save();
    return this.sharesOf(owner, hostId);
  }

  /** Drops every share of one host (the host was revoked). */
  forget(owner: string, hostId: string): void {
    const who = person(owner);
    const before = this.shares.length + this.scopes.length;
    this.shares = this.shares.filter((share) => !(share.hostId === hostId && person(share.owner) === who));
    this.scopes = this.scopes.filter((entry) => !(entry.hostId === hostId && person(entry.principalId) === who));
    if (this.shares.length + this.scopes.length !== before) this.save();
  }

  /** Hosts reaching this person through a share: directly, or through one of
   * the teams given. The person's own shares (owner = self) are left out. */
  sharedWith(principalId: string, teamIds: readonly string[] = []): SharedHostRef[] {
    const who = person(principalId);
    const teams = new Set(teamIds.map((team) => team.trim()).filter(Boolean));
    const seen = new Set<string>();
    const out: SharedHostRef[] = [];
    for (const share of this.shares) {
      if (person(share.owner) === who) continue;
      const hit = share.kind === "person" ? person(share.targetId) === who : teams.has(share.targetId);
      if (!hit) continue;
      const key = `${share.owner}\n${share.hostId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ hostId: share.hostId, owner: share.owner });
    }
    return out;
  }

  private save(): void {
    writeFileAtomic(this.file, `${JSON.stringify({ version: 1, scopes: this.scopes, shares: this.shares }, null, 2)}\n`);
  }
}

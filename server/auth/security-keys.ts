// Security keys and passkeys (WebAuthn) for sensitive approvals: each
// person's registered keys, the classes they chose (shared/step-up.ts), and
// the short-lived ceremonies that register a key or sign a step-up.
//
// On disk: security-keys.json (mode 0600), one entry per person. A key is
// its credential id, its public key and its signature counter, plus the RP
// ID (the address) it was made on; never a secret.
//
// A ceremony is held in memory only:
//   - created by the signed-in person (`beginRegistration`,
//     `beginAssertion`), with a random id and challenge (32 bytes each),
//     the RP ID and the origins it may answer from, and for a step-up the
//     grants it will authorize, each computed by the server from the live
//     card or change (never from the client's words);
//   - completed once (`complete`): the browser's answer is verified by
//     @simplewebauthn/server against that challenge, RP ID and origins, and
//     against one of this person's keys for that RP ID;
//   - a verified step-up authorizes each of its grants once
//     (`consume`), for the same person, within a short time. Any mismatch
//     (another person, another card, a changed card) burns the ceremony.
// Expired ceremonies are dropped. A restart drops them all. How a ceremony
// ended is kept a short while (`status`), for the desktop app, whose key
// runs in the system browser and which only learns the end by asking.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";

import { writeFileAtomic } from "../atomic.ts";
import {
  STEP_UP_CLASSES,
  isStepUpClass,
  requiredClasses,
  type SecurityKeyView,
  type StepUpClass,
  type StepUpFailure,
} from "../../shared/step-up.ts";

/** How long a ceremony waits for the key, from its start. */
export const CEREMONY_TTL_MS = 2 * 60_000;
/** How long a verified step-up may be used, from its verification. */
export const STEP_UP_USE_MS = 60_000;
const MAX_KEYS_PER_PERSON = 20;
const MAX_CEREMONIES_PER_PERSON = 8;
const MAX_CEREMONIES = 2_000;
const MAX_NAME = 80;

const credentialSchema = z.object({
  id: z.string().min(1).max(1_400),
  publicKey: z.string().min(1).max(4_000),
  counter: z.number().int().min(0),
  transports: z.array(z.string().max(40)).max(10).optional(),
  rpId: z.string().min(1).max(253),
  name: z.string().max(MAX_NAME),
  createdAt: z.number(),
  lastUsedAt: z.number().optional(),
  deviceType: z.enum(["singleDevice", "multiDevice"]).optional(),
  backedUp: z.boolean().optional(),
});

const personSchema = z.object({
  /** WebAuthn user handle: random, never the person's id or email. */
  userHandle: z.string().min(1).max(200),
  credentials: z.array(credentialSchema).max(MAX_KEYS_PER_PERSON),
  classes: z.array(z.enum(STEP_UP_CLASSES)),
});

const fileSchema = z.object({
  version: z.literal(1),
  people: z.record(z.string(), personSchema),
});

type StoredCredential = z.infer<typeof credentialSchema>;
type PersonEntry = z.infer<typeof personSchema>;

export class SecurityKeyStore {
  private data: z.infer<typeof fileSchema> = { version: 1, people: {} };
  /** The file exists but could not be read: every chosen class refuses
   * (whose choice it was is unknown) and nothing is written over it. */
  unreadable = false;

  private readonly file: string;

  /** The file changed outside this server since it last wrote it (the
   * documented recovery: an operator removing a person's entry by hand).
   * Read once at start; the caller audits it. */
  editedOutside = false;
  /** The file (and its digest) is gone though this server had saved keys:
   * a person's keys removed wholesale outside Sagax. */
  removedOutside = false;

  constructor(file: string) {
    this.file = file;
    this.load();
  }

  private digestFile(): string {
    return `${this.file}.sha256`;
  }

  /** Written once keys were saved: its presence without the file says the
   * file was removed. */
  private usedMarker(): string {
    return join(dirname(this.file), ".security-keys-used");
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.file, "utf8");
    } catch {
      if (existsSync(this.digestFile()) || existsSync(this.usedMarker())) this.removedOutside = true;
      return;
    }
    try {
      this.data = fileSchema.parse(JSON.parse(raw));
      let recorded: string | undefined;
      try {
        recorded = readFileSync(this.digestFile(), "utf8").trim();
      } catch {
        recorded = undefined;
      }
      const actual = createHash("sha256").update(raw).digest("hex");
      if (recorded !== undefined && recorded !== actual) this.editedOutside = true;
    } catch {
      this.unreadable = true;
      console.error("[security-keys] security-keys.json could not be read; sensitive approvals are refused until it is repaired.");
    }
  }

  private save(): void {
    if (this.unreadable) throw Object.assign(new Error("Saved security keys could not be read. Repair security-keys.json first."), { status: 503 });
    mkdirSync(dirname(this.file), { recursive: true });
    const text = JSON.stringify(this.data, null, 2);
    writeFileAtomic(this.file, text, { mode: 0o600 });
    writeFileAtomic(this.digestFile(), createHash("sha256").update(text).digest("hex"), { mode: 0o600 });
    if (!existsSync(this.usedMarker())) writeFileAtomic(this.usedMarker(), "security keys were saved here\n", { mode: 0o600 });
  }

  private entry(person: string): PersonEntry | undefined {
    return this.data.people[person];
  }

  private ensure(person: string): PersonEntry {
    const found = this.data.people[person];
    if (found) return found;
    const created: PersonEntry = { userHandle: randomBytes(32).toString("base64url"), credentials: [], classes: [] };
    this.data.people[person] = created;
    return created;
  }

  userHandle(person: string): string {
    const found = this.entry(person);
    if (found) return found.userHandle;
    const created = this.ensure(person);
    this.save();
    return created.userHandle;
  }

  credentials(person: string): StoredCredential[] {
    return (this.entry(person)?.credentials ?? []).map((credential) => ({ ...credential }));
  }

  classes(person: string): StepUpClass[] {
    return [...(this.entry(person)?.classes ?? [])];
  }

  /** Every class anyone on this server chose. */
  anyClasses(): StepUpClass[] {
    const all = new Set<StepUpClass>();
    for (const entry of Object.values(this.data.people)) for (const name of entry.classes) all.add(name);
    return STEP_UP_CLASSES.filter((name) => all.has(name));
  }

  /** The counter this key last signed with. */
  counter(person: string, id: string): number | undefined {
    return this.entry(person)?.credentials.find((candidate) => candidate.id === id)?.counter;
  }

  addCredential(person: string, credential: StoredCredential): void {
    const entry = this.ensure(person);
    if (entry.credentials.some((existing) => existing.id === credential.id)) {
      throw Object.assign(new Error("This key is already registered."), { status: 409 });
    }
    // A credential id is unique across people too: never two owners.
    for (const other of Object.values(this.data.people)) {
      if (other.credentials.some((existing) => existing.id === credential.id)) {
        throw Object.assign(new Error("This key is already registered."), { status: 409 });
      }
    }
    if (entry.credentials.length >= MAX_KEYS_PER_PERSON) {
      throw Object.assign(new Error(`At most ${MAX_KEYS_PER_PERSON} keys per person.`), { status: 409 });
    }
    entry.credentials.push(credential);
    this.save();
  }

  /** Rename one key (#1545): its name only, never what it signs with. */
  renameCredential(person: string, id: string, name: string): boolean {
    const credential = this.entry(person)?.credentials.find((candidate) => candidate.id === id);
    if (!credential) return false;
    credential.name = name.trim().slice(0, 80) || credential.name;
    this.save();
    return true;
  }

  /** Remove one key. The last key takes the chosen classes with it: the
   * step-up that removed it was the person's own. */
  removeCredential(person: string, id: string): boolean {
    const entry = this.entry(person);
    if (!entry) return false;
    const before = entry.credentials.length;
    entry.credentials = entry.credentials.filter((credential) => credential.id !== id);
    if (entry.credentials.length === before) return false;
    if (!entry.credentials.length) entry.classes = [];
    this.save();
    return true;
  }

  setClasses(person: string, classes: readonly StepUpClass[]): void {
    const entry = this.ensure(person);
    entry.classes = STEP_UP_CLASSES.filter((name) => classes.includes(name));
    this.save();
  }

  touch(person: string, id: string, counter: number, at: number): void {
    const credential = this.entry(person)?.credentials.find((candidate) => candidate.id === id);
    if (!credential) return;
    // never backwards: two answers verified at once keep the higher one
    credential.counter = Math.max(credential.counter, counter);
    credential.lastUsedAt = at;
    this.save();
  }
}

export type CeremonyKind = "register" | "assert";

interface Ceremony {
  id: string;
  kind: CeremonyKind;
  person: string;
  rpId: string;
  origins: string[];
  challenge: string;
  createdAt: number;
  options: Record<string, unknown>;
  /** What the page shows while it waits for the key: the card's title or
   * the change, and what it does. */
  label: string;
  summary?: string;
  /** register: the name the key will carry. */
  name?: string;
  /** assert: what it authorizes, each once. */
  grants: string[];
  used: Set<string>;
  verifiedAt?: number;
}

export interface CeremonyStart {
  ceremonyId: string;
  /** PublicKeyCredentialCreationOptionsJSON or ...RequestOptionsJSON. */
  options: Record<string, unknown>;
  expiresAt: number;
}

export type ConsumeResult = { ok: true } | { ok: false; reason: StepUpFailure };

export interface SecurityKeysOptions {
  store: SecurityKeyStore;
  /** A key was added (audited by the caller). */
  onRegistered?: (person: string, key: SecurityKeyView) => void;
  rpName?: string;
  now?: () => number;
}

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The digest a grant names: the server hashes the content, the ceremony
 * keeps only the digest. */
export function grantDigest(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("base64url");
}

export function viewOf(credential: StoredCredential): SecurityKeyView {
  return {
    id: credential.id,
    name: credential.name,
    createdAt: credential.createdAt,
    rpId: credential.rpId,
    ...(credential.lastUsedAt ? { lastUsedAt: credential.lastUsedAt } : {}),
    ...(credential.deviceType ? { deviceType: credential.deviceType } : {}),
    ...(credential.backedUp !== undefined ? { backedUp: credential.backedUp } : {}),
  };
}

export class SecurityKeys {
  readonly store: SecurityKeyStore;
  private readonly rpName: string;
  private readonly now: () => number;
  private readonly onRegistered?: (person: string, key: SecurityKeyView) => void;
  private readonly ceremonies = new Map<string, Ceremony>();
  /** How spent ceremonies ended, by id, until CEREMONY_TTL_MS after their
   * end: what `status` answers once the ceremony itself is gone. */
  private readonly outcomes = new Map<string, { ok: boolean; at: number }>();
  /** Changes a verified step-up already authorized for a path that cannot
   * carry one (the desktop's trusted approval channel), by person and key.
   * Each used once, within STEP_UP_USE_MS. */
  private readonly allowances = new Map<string, { person: string; key: string; until: number }>();

  constructor(options: SecurityKeysOptions) {
    this.store = options.store;
    this.rpName = options.rpName ?? "Sagax";
    this.now = options.now ?? Date.now;
    this.onRegistered = options.onRegistered;
  }

  /** The classes this person chose that a call in `classes` falls in.
   * Unreadable keys: every class of the call (fail closed). */
  required(person: string | null, classes: readonly StepUpClass[], fallback?: string | null): StepUpClass[] {
    if (!classes.length) return [];
    if (this.store.unreadable) return [...classes];
    // Nobody is answering as a person (a bot acting for its person, a
    // service): the bot owner's choice applies, and with no owner known,
    // anyone's on this server. Such a caller cannot sign, so it is refused.
    const who = person ?? fallback ?? null;
    if (who) return requiredClasses(this.store.classes(who), classes);
    return requiredClasses(this.store.anyClasses(), classes);
  }

  /** Leave a one-time allowance for exactly this change; its random id is
   * what the request that applies the change carries. */
  allow(person: string, key: string): string {
    const now = this.now();
    for (const [id, entry] of this.allowances) if (entry.until < now) this.allowances.delete(id);
    const id = randomBytes(32).toString("base64url");
    this.allowances.set(id, { person, key, until: now + STEP_UP_USE_MS });
    return id;
  }

  /** Use an allowance once: the same person, the same change, in time. Any
   * attempt spends it. */
  takeAllowance(id: unknown, person: string, key: string): boolean {
    if (typeof id !== "string" || !id) return false;
    const entry = this.allowances.get(id);
    this.allowances.delete(id);
    return Boolean(entry && entry.person === person && entry.key === key && this.now() <= entry.until);
  }

  keys(person: string): SecurityKeyView[] {
    return this.store.credentials(person).map(viewOf);
  }

  hasKey(person: string, rpId?: string | null): boolean {
    return this.store.credentials(person).some((credential) => rpId === undefined || credential.rpId === rpId);
  }

  private prune(): void {
    const now = this.now();
    for (const [id, ceremony] of this.ceremonies) {
      const end = ceremony.verifiedAt !== undefined ? ceremony.verifiedAt + STEP_UP_USE_MS : ceremony.createdAt + CEREMONY_TTL_MS;
      if (now > end) this.ceremonies.delete(id);
    }
    for (const [id, outcome] of this.outcomes) if (now > outcome.at + CEREMONY_TTL_MS) this.outcomes.delete(id);
  }

  /** Where a ceremony is: still waiting for its key, done (a key added or a
   * step-up verified), failed, or unknown (expired, never started, or a
   * restart). The id is the only authorization, as for its page. */
  status(id: string): "waiting" | "done" | "failed" | "expired" {
    this.prune();
    const ceremony = this.ceremonies.get(id);
    if (ceremony) return ceremony.verifiedAt !== undefined ? "done" : "waiting";
    const outcome = this.outcomes.get(id);
    if (outcome) return outcome.ok ? "done" : "failed";
    return "expired";
  }

  private admit(person: string): void {
    this.prune();
    const mine = [...this.ceremonies.values()].filter((ceremony) => ceremony.person === person);
    // the oldest of this person's ceremonies gives way, never another's
    if (mine.length >= MAX_CEREMONIES_PER_PERSON) {
      mine.sort((a, b) => a.createdAt - b.createdAt);
      for (const old of mine.slice(0, mine.length - MAX_CEREMONIES_PER_PERSON + 1)) this.ceremonies.delete(old.id);
    }
    if (this.ceremonies.size >= MAX_CEREMONIES) {
      throw Object.assign(new Error("Too many security key requests are waiting. Try again in a minute."), { status: 429 });
    }
  }

  async beginRegistration(person: string, input: { rpId: string; origins: string[]; name: string; userName: string; label: string }): Promise<CeremonyStart> {
    if (this.store.unreadable) throw Object.assign(new Error("Saved security keys could not be read. Repair security-keys.json first."), { status: 503 });
    this.admit(person);
    const existing = this.store.credentials(person);
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: input.rpId,
      userName: input.userName.slice(0, 64) || "Sagax",
      userID: Buffer.from(this.store.userHandle(person), "base64url"),
      attestationType: "none",
      // the same authenticator twice adds nothing
      excludeCredentials: existing.filter((credential) => credential.rpId === input.rpId)
        .map((credential) => ({ id: credential.id, ...(credential.transports ? { transports: credential.transports } : {}) })),
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      timeout: CEREMONY_TTL_MS,
    });
    const id = randomBytes(32).toString("base64url");
    const ceremony: Ceremony = {
      id, kind: "register", person, rpId: input.rpId, origins: input.origins,
      challenge: options.challenge, createdAt: this.now(), options: options as unknown as Record<string, unknown>,
      label: input.label, name: input.name.trim().slice(0, MAX_NAME) || "Security key", grants: [], used: new Set(),
    };
    this.ceremonies.set(id, ceremony);
    return { ceremonyId: id, options: ceremony.options, expiresAt: ceremony.createdAt + CEREMONY_TTL_MS };
  }

  /** A step-up for these grants, signed by one of this person's keys made
   * on this RP ID. None there: refused (`no_key`), never skipped. */
  async beginAssertion(person: string, input: { rpId: string; origins: string[]; grants: string[]; label: string; summary?: string }): Promise<CeremonyStart | { error: "no_key" }> {
    if (this.store.unreadable) throw Object.assign(new Error("Saved security keys could not be read. Repair security-keys.json first."), { status: 503 });
    const credentials = this.store.credentials(person).filter((credential) => credential.rpId === input.rpId);
    if (!credentials.length) return { error: "no_key" };
    this.admit(person);
    const options = await generateAuthenticationOptions({
      rpID: input.rpId,
      allowCredentials: credentials.map((credential) => ({ id: credential.id, ...(credential.transports ? { transports: credential.transports } : {}) })),
      userVerification: "required",
      timeout: CEREMONY_TTL_MS,
    });
    const id = randomBytes(32).toString("base64url");
    const ceremony: Ceremony = {
      id, kind: "assert", person, rpId: input.rpId, origins: input.origins,
      challenge: options.challenge, createdAt: this.now(), options: options as unknown as Record<string, unknown>,
      label: input.label, ...(input.summary ? { summary: input.summary } : {}), grants: [...new Set(input.grants)], used: new Set(),
    };
    this.ceremonies.set(id, ceremony);
    return { ceremonyId: id, options: ceremony.options, expiresAt: ceremony.createdAt + CEREMONY_TTL_MS };
  }

  /** What the ceremony page needs: its kind, options and label. Only while
   * the ceremony still waits for its key. */
  pending(id: string): { kind: CeremonyKind; options: Record<string, unknown>; label: string; summary?: string; digest: string; rpId: string } | null {
    this.prune();
    const ceremony = this.ceremonies.get(id);
    if (!ceremony || ceremony.verifiedAt !== undefined) return null;
    return {
      kind: ceremony.kind, options: ceremony.options, label: ceremony.label,
      ...(ceremony.summary ? { summary: ceremony.summary } : {}),
      // a short fingerprint of what the key signs
      digest: (ceremony.grants[0] ?? ceremony.challenge).slice(0, 8),
      rpId: ceremony.rpId,
    };
  }

  /** Verify the browser's answer once. The ceremony is spent whatever the
   * outcome: a failed answer starts over. */
  async complete(id: string, response: unknown): Promise<{ ok: true; kind: CeremonyKind } | { ok: false; status: number; error: string }> {
    const held = this.ceremonies.has(id) && this.ceremonies.get(id)!.verifiedAt === undefined;
    const result = await this.completeOnce(id, response);
    if (held) {
      if (this.outcomes.size >= MAX_CEREMONIES) this.outcomes.delete(this.outcomes.keys().next().value!);
      // a verified answer is never undone by a second one that lost the race
      if (!this.outcomes.get(id)?.ok) this.outcomes.set(id, { ok: result.ok, at: this.now() });
    }
    return result;
  }

  private async completeOnce(id: string, response: unknown): Promise<{ ok: true; kind: CeremonyKind } | { ok: false; status: number; error: string }> {
    this.prune();
    const ceremony = this.ceremonies.get(id);
    if (!ceremony || ceremony.verifiedAt !== undefined) return { ok: false, status: 404, error: "This security key request has expired. Start again." };
    if (!response || typeof response !== "object" || Array.isArray(response)) {
      this.ceremonies.delete(id);
      return { ok: false, status: 400, error: "The security key's answer could not be read." };
    }
    const origins = ceremony.origins;
    if (ceremony.kind === "register") {
      this.ceremonies.delete(id);
      try {
        const verified = await verifyRegistrationResponse({
          response: response as Parameters<typeof verifyRegistrationResponse>[0]["response"],
          expectedChallenge: ceremony.challenge,
          expectedOrigin: origins,
          expectedRPID: ceremony.rpId,
          requireUserVerification: true,
        });
        if (!verified.verified) return { ok: false, status: 400, error: "The security key could not be verified." };
        const info = verified.registrationInfo;
        this.store.addCredential(ceremony.person, {
          id: info.credential.id,
          publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
          counter: info.credential.counter,
          ...(info.credential.transports?.length ? { transports: info.credential.transports.slice(0, 10) } : {}),
          rpId: ceremony.rpId,
          name: ceremony.name ?? "Security key",
          createdAt: this.now(),
          deviceType: info.credentialDeviceType,
          backedUp: info.credentialBackedUp,
        });
        const added = this.store.credentials(ceremony.person).find((candidate) => candidate.id === info.credential.id);
        if (added) this.onRegistered?.(ceremony.person, viewOf(added));
        return { ok: true, kind: "register" };
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 409 || status === 503) return { ok: false, status, error: (error as Error).message };
        return { ok: false, status: 400, error: "The security key could not be verified." };
      }
    }
    const credentialId = typeof (response as { id?: unknown }).id === "string" ? (response as { id: string }).id : "";
    const credential = this.store.credentials(ceremony.person).find((candidate) => candidate.rpId === ceremony.rpId && sameText(candidate.id, credentialId));
    if (!credential) {
      this.ceremonies.delete(id);
      return { ok: false, status: 400, error: "This key is not one of yours for this address." };
    }
    try {
      const verified = await verifyAuthenticationResponse({
        response: response as Parameters<typeof verifyAuthenticationResponse>[0]["response"],
        expectedChallenge: ceremony.challenge,
        expectedOrigin: origins,
        expectedRPID: ceremony.rpId,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
          counter: credential.counter,
          ...(credential.transports ? { transports: credential.transports } : {}),
        },
        requireUserVerification: true,
      });
      if (!verified.verified) {
        this.ceremonies.delete(id);
        return { ok: false, status: 400, error: "The security key could not be verified." };
      }
      // Another answer from this key may have been verified while this one
      // was: its counter must still be ahead of the stored one (a clone, or
      // the same answer twice, is not).
      const newCounter = verified.authenticationInfo.newCounter;
      const stored = this.store.counter(ceremony.person, credential.id) ?? 0;
      if ((newCounter > 0 || stored > 0) && newCounter <= stored) {
        this.ceremonies.delete(id);
        return { ok: false, status: 400, error: "The security key could not be verified." };
      }
      const at = this.now();
      this.store.touch(ceremony.person, credential.id, newCounter, at);
      ceremony.verifiedAt = at;
      return { ok: true, kind: "assert" };
    } catch {
      this.ceremonies.delete(id);
      return { ok: false, status: 400, error: "The security key could not be verified." };
    }
  }

  /** Use one grant of a verified step-up. Each grant once; the ceremony
   * goes when every grant is used, or on any mismatch. */
  consume(id: unknown, person: string | null, grant: string): ConsumeResult {
    if (this.store.unreadable) return { ok: false, reason: "unreadable" };
    if (typeof id !== "string" || !id) return { ok: false, reason: "missing" };
    const ceremony = this.ceremonies.get(id);
    if (!ceremony || ceremony.kind !== "assert") return { ok: false, reason: "missing" };
    const now = this.now();
    if (ceremony.verifiedAt === undefined) {
      if (now > ceremony.createdAt + CEREMONY_TTL_MS) {
        this.ceremonies.delete(id);
        return { ok: false, reason: "expired" };
      }
      return { ok: false, reason: "not-verified" };
    }
    if (now > ceremony.verifiedAt + STEP_UP_USE_MS) {
      this.ceremonies.delete(id);
      return { ok: false, reason: "expired" };
    }
    if (!person || !sameText(ceremony.person, person)) {
      this.ceremonies.delete(id);
      return { ok: false, reason: "wrong-person" };
    }
    if (ceremony.used.has(grant)) return { ok: false, reason: "used" };
    if (!ceremony.grants.includes(grant)) {
      this.ceremonies.delete(id);
      return { ok: false, reason: "wrong-target" };
    }
    ceremony.used.add(grant);
    if (ceremony.grants.every((candidate) => ceremony.used.has(candidate))) this.ceremonies.delete(id);
    return { ok: true };
  }

  /** For tests and the settings page: whether a ceremony is still held. */
  holds(id: string): boolean {
    this.prune();
    return this.ceremonies.has(id);
  }

  setClasses(person: string, classes: readonly unknown[]): StepUpClass[] {
    const picked = STEP_UP_CLASSES.filter((name) => classes.some((value) => isStepUpClass(value) && value === name));
    this.store.setClasses(person, picked);
    return picked;
  }
}

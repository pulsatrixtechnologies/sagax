# Organisation collaborative, tranche 1: identités

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chaque personne devient un principal stable (`pr_<uuid>`), chaque session en porte un, et une organisation exige une adresse de serveur.

**Architecture:** Un nouveau registre `server/auth/principals.ts` (fichier `principals.json` dans `DATA_DIR`) remplace les emails et `"local-owner"` comme clé d'identité. Une migration pure (`server/people/identity-migration.ts`) réécrit une fois les ids stockés. Les sessions gagnent `principalId`: la connexion par email le résout, un code d'appairage hérite du principal qui l'a créé. `channelViewerId` rend le principal, ou un id anonyme qui ne voit aucun channel. Les rôles d'organisation comparent l'id du principal au propriétaire et son email aux listes `cfg.signIn`.

**Tech Stack:** TypeScript strict, Node 24 `--experimental-strip-types`, Vitest, Zod, React 19 + Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-09-28-collaborative-org-design.md`, section « Identité: le principal » et tranche 1.

## Global Constraints

- Id de principal: `pr_` + `randomUUID()`. Jamais réutilisé, jamais dérivé de l'email.
- `kind`: `"human"` ou `"guest"`. Un seul principal `local: true` par serveur.
- La liste `cfg.signIn` (`admins`, `members`) reste en emails.
- Les ids stockés comparés sans casse avant la migration (`trim().toLowerCase()`); après, un id `pr_…` est comparé tel quel.
- Une session sans principal ne voit aucun channel qui a des `humanIds`.
- Nouvelle organisation: `host` doit être `{ kind: "server", url }` avec une URL `https://`, `http://` d'hôte Tailscale (`*.ts.net`), ou `http://localhost` / `http://127.0.0.1` pour un serveur Docker local dont l'opérateur gère l'exposition. Une organisation existante `this-computer` reste lisible.
- Écriture de fichier: `writeFileAtomic` de `server/atomic.ts`, comme `sessions.ts`.
- Texte d'interface nouveau: anglais dans `en.json`, français (Québec) dans `fr.json`, puis `node scripts/generate-locale.mjs fr --accept`. Pas de tiret cadratin ni de en-dash.
- Tests: `npx vitest run <fichier>`; typecheck `pnpm -s typecheck`.

## Review Focus

1. Email changé chez le control plane: la même personne revient avec un autre email mais le même `controlPlaneUserId`. Elle doit retrouver son principal et ses bots. Test en Task 1.
2. Double migration: redémarrer le serveur ne doit rien réécrire une deuxième fois ni créer de doublon de principal. Test en Task 2.
3. Code d'appairage créé par l'opérateur local: le téléphone appairé doit rester le propriétaire (voir ses bots, approuver). Test en Task 3.
4. Vieille session d'appairage sans principal (créée avant cette tranche): elle garde l'accès de l'opérateur local, parce qu'avant cette tranche seul un admin pouvait créer un code. La migration lui attribue le principal local. Test en Task 2.
5. Une session anonyme (principal absent, cas d'erreur) ne doit ni voir un channel ni répondre à une approbation. Test en Task 5.

---

### Task 1: Registre des principals

**Files:**
- Create: `server/auth/principals.ts`
- Test: `server/auth/principals.test.ts`

**Interfaces:**
- Produces:
  - `interface Principal { id: string; kind: "human" | "guest"; email?: string; controlPlaneUserId?: string; local?: boolean; createdAt: number }`
  - `class PrincipalRegistry { constructor(options: { path: string; now?: () => number; newId?: () => string }); byId(id: string): Principal | null; byEmail(email: string): Principal | null; forAccount(input: { email: string; controlPlaneUserId?: string }): Principal; localOperator(email?: string): Principal; setEmail(id: string, email: string): Principal | null; list(): Principal[] }`
  - `function isPrincipalId(value: string): boolean` (vrai pour `pr_` suivi d'un uuid)

- [ ] **Step 1: Write the failing test**

```ts
// server/auth/principals.test.ts
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isPrincipalId, PrincipalRegistry } from "./principals.ts";

function registry() {
  const dir = mkdtempSync(join(tmpdir(), "principals-"));
  let n = 0;
  const path = join(dir, "principals.json");
  return { path, reg: new PrincipalRegistry({ path, now: () => 1000, newId: () => `pr_00000000-0000-4000-8000-00000000000${n++}` }) };
}

describe("principal registry", () => {
  it("creates one principal per account and finds it again", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "Morgan@example.com", controlPlaneUserId: "cp_1" });
    expect(a).toMatchObject({ kind: "human", email: "morgan@example.com", controlPlaneUserId: "cp_1" });
    expect(reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_1" }).id).toBe(a.id);
    expect(reg.list()).toHaveLength(1);
  });

  it("keeps the principal when the account email changes", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "old@example.com", controlPlaneUserId: "cp_1" });
    const b = reg.forAccount({ email: "new@example.com", controlPlaneUserId: "cp_1" });
    expect(b.id).toBe(a.id);
    expect(b.email).toBe("new@example.com");
    expect(reg.byEmail("old@example.com")).toBeNull();
  });

  it("links an email-only principal to its account on first sign-in", () => {
    const { reg } = registry();
    const a = reg.forAccount({ email: "morgan@example.com" });
    const b = reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_9" });
    expect(b.id).toBe(a.id);
    expect(b.controlPlaneUserId).toBe("cp_9");
  });

  it("has exactly one local operator and gives it the profile email", () => {
    const { reg } = registry();
    const a = reg.localOperator();
    const b = reg.localOperator("owner@example.com");
    expect(b.id).toBe(a.id);
    expect(b).toMatchObject({ local: true, email: "owner@example.com" });
    expect(reg.list().filter((p) => p.local)).toHaveLength(1);
  });

  it("persists across instances", () => {
    const { path, reg } = registry();
    const a = reg.forAccount({ email: "morgan@example.com", controlPlaneUserId: "cp_1" });
    const again = new PrincipalRegistry({ path });
    expect(again.byId(a.id)).toMatchObject({ email: "morgan@example.com" });
    expect(JSON.parse(readFileSync(path, "utf8")).version).toBe(1);
  });

  it("recognizes principal ids", () => {
    expect(isPrincipalId("pr_00000000-0000-4000-8000-000000000000")).toBe(true);
    expect(isPrincipalId("morgan@example.com")).toBe(false);
    expect(isPrincipalId("local-owner")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/principals.test.ts`
Expected: FAIL, `Cannot find module './principals.ts'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/auth/principals.ts
// A person, by a stable id. Emails change and "local-owner" was never a
// person; ownership, channel membership and grants key on `pr_<uuid>`.
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "./atomic.ts";

const principalSchema = z.object({
  id: z.string().regex(/^pr_[0-9a-f-]{36}$/),
  kind: z.enum(["human", "guest"]),
  email: z.string().max(320).optional(),
  controlPlaneUserId: z.string().max(256).optional(),
  local: z.boolean().optional(),
  createdAt: z.number(),
});
const fileSchema = z.object({ version: z.literal(1), principals: z.array(principalSchema) });

export type Principal = z.infer<typeof principalSchema>;

export function isPrincipalId(value: string): boolean {
  return /^pr_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
}

const emailKey = (email: string) => email.trim().toLowerCase();

export class PrincipalRegistry {
  private readonly path: string;
  private readonly now: () => number;
  private readonly newId: () => string;
  private principals: Principal[] = [];

  constructor(options: { path: string; now?: () => number; newId?: () => string }) {
    this.path = options.path;
    this.now = options.now ?? Date.now;
    this.newId = options.newId ?? (() => `pr_${randomUUID()}`);
    if (existsSync(this.path)) {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(this.path, "utf8")));
      if (parsed.success) this.principals = parsed.data.principals;
    }
  }

  list(): Principal[] {
    return this.principals.map((p) => ({ ...p }));
  }

  byId(id: string): Principal | null {
    return this.principals.find((p) => p.id === id) ?? null;
  }

  byEmail(email: string): Principal | null {
    const key = emailKey(email);
    return key ? this.principals.find((p) => p.email === key) ?? null : null;
  }

  /** The person behind a verified sign-in. The control-plane account wins
   * over the email, so a changed address keeps its principal. */
  forAccount(input: { email: string; controlPlaneUserId?: string }): Principal {
    const email = emailKey(input.email);
    const account = input.controlPlaneUserId?.trim();
    let found = account ? this.principals.find((p) => p.controlPlaneUserId === account) : undefined;
    found ??= email ? this.principals.find((p) => p.email === email && (!p.controlPlaneUserId || !account)) : undefined;
    if (found) {
      let changed = false;
      if (email && found.email !== email) { found.email = email; changed = true; }
      if (account && !found.controlPlaneUserId) { found.controlPlaneUserId = account; changed = true; }
      if (changed) this.persist();
      return { ...found };
    }
    const created: Principal = {
      id: this.newId(),
      kind: "human",
      ...(email ? { email } : {}),
      ...(account ? { controlPlaneUserId: account } : {}),
      createdAt: this.now(),
    };
    this.principals.push(created);
    this.persist();
    return { ...created };
  }

  /** The person at this computer. There is one; a profile email is an
   * attribute of it, never a second person. */
  localOperator(email?: string): Principal {
    let local = this.principals.find((p) => p.local);
    if (!local) {
      local = { id: this.newId(), kind: "human", local: true, createdAt: this.now() };
      this.principals.push(local);
      if (email) local.email = emailKey(email);
      this.persist();
    } else if (email && local.email !== emailKey(email)) {
      local.email = emailKey(email);
      this.persist();
    }
    return { ...local };
  }

  setEmail(id: string, email: string): Principal | null {
    const found = this.principals.find((p) => p.id === id);
    if (!found) return null;
    const key = emailKey(email);
    if (key) found.email = key;
    else delete found.email;
    this.persist();
    return { ...found };
  }

  private persist(): void {
    writeFileAtomic(this.path, JSON.stringify({ version: 1, principals: this.principals }, null, 2));
  }
}
```

`writeFileAtomic(path: string, data: string, options?: { mode?: number })` is exported by `server/atomic.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/auth/principals.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add server/auth/principals.ts server/auth/principals.test.ts
git commit -m "feat: add a principal registry keyed by stable ids"
```

---

### Task 2: Migration des ids stockés

**Files:**
- Create: `server/people/identity-migration.ts`
- Test: `server/people/identity-migration.test.ts`

**Interfaces:**
- Consumes: `PrincipalRegistry`, `isPrincipalId` (Task 1).
- Produces:
  - `function principalIdFor(raw: string, registry: PrincipalRegistry): string`: `pr_…` inchangé; `"local-owner"` ou vide donne le principal local; un email donne `registry.forAccount({ email }).id`; toute autre chaîne est laissée telle quelle.
  - `function migrateIdentityRefs(input: { org: { ownerUserId: string } | null; groups: { id: string; humanIds?: string[] }[]; bots: { id: string; ownerUserId?: string; directGrants?: string[] }[]; sessions: { id: string; email?: string; userId?: string; principalId?: string }[]; registry: PrincipalRegistry }): { orgOwner?: string; groups: { id: string; humanIds: string[] }[]; bots: { id: string; ownerUserId?: string; directGrants?: string[] }[]; sessions: { id: string; principalId: string }[] }`: ne liste que ce qui change.

- [ ] **Step 1: Write the failing test**

```ts
// server/people/identity-migration.test.ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { migrateIdentityRefs, principalIdFor } from "./identity-migration.ts";
import { PrincipalRegistry } from "./principals.ts";

const fresh = () => new PrincipalRegistry({ path: join(mkdtempSync(join(tmpdir(), "mig-")), "principals.json") });

describe("identity migration", () => {
  it("maps emails and local-owner to principals and leaves principal ids alone", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    expect(principalIdFor("local-owner", registry)).toBe(local.id);
    expect(principalIdFor("OWNER@example.com", registry)).toBe(local.id);
    const morgan = principalIdFor("morgan@example.com", registry);
    expect(morgan).toMatch(/^pr_/);
    expect(principalIdFor(morgan, registry)).toBe(morgan);
  });

  it("rewrites org owner, humanIds, bot owners, grants and pairing sessions once", () => {
    const registry = fresh();
    const local = registry.localOperator("owner@example.com");
    const input = {
      org: { ownerUserId: "owner@example.com" },
      groups: [{ id: "g1", humanIds: ["owner@example.com", "morgan@example.com"] }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: "local-owner", directGrants: ["morgan@example.com"] }, { id: "b2" }],
      sessions: [{ id: "s-phone" }, { id: "s-morgan", email: "morgan@example.com", userId: "cp_7" }],
      registry,
    };
    const out = migrateIdentityRefs(input);
    const morgan = registry.byEmail("morgan@example.com")!.id;
    expect(out.orgOwner).toBe(local.id);
    expect(out.groups).toEqual([{ id: "g1", humanIds: [local.id, morgan] }]);
    expect(out.bots).toEqual([{ id: "b1", ownerUserId: local.id, directGrants: [morgan] }]);
    expect(out.sessions).toEqual([{ id: "s-phone", principalId: local.id }, { id: "s-morgan", principalId: morgan }]);
    expect(registry.byId(morgan)?.controlPlaneUserId).toBe("cp_7");

    // Applying the result and running again changes nothing.
    const again = migrateIdentityRefs({
      org: { ownerUserId: out.orgOwner! },
      groups: [{ id: "g1", humanIds: out.groups[0]!.humanIds }, { id: "g2" }],
      bots: [{ id: "b1", ownerUserId: local.id, directGrants: [morgan] }, { id: "b2" }],
      sessions: [{ id: "s-phone", principalId: local.id }, { id: "s-morgan", email: "morgan@example.com", principalId: morgan }],
      registry,
    });
    expect(again).toEqual({ groups: [], bots: [], sessions: [] });
    expect(registry.list()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/people/identity-migration.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// server/people/identity-migration.ts
// One-time rewrite of stored person references (emails, "local-owner") to
// principal ids. Pure over its inputs apart from the registry, which creates
// principals as it meets new emails. Running it twice changes nothing.
import { isPrincipalId, type PrincipalRegistry } from "./principals.ts";

export function principalIdFor(raw: string, registry: PrincipalRegistry): string {
  const value = raw.trim();
  if (isPrincipalId(value)) return value;
  const key = value.toLowerCase();
  if (!key || key === "local-owner") return registry.localOperator().id;
  const local = registry.list().find((p) => p.local);
  if (local?.email && local.email === key) return local.id;
  if (key.includes("@")) return registry.forAccount({ email: key }).id;
  return value;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function migrateIdentityRefs(input: {
  org: { ownerUserId: string } | null;
  groups: { id: string; humanIds?: string[] }[];
  bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
  sessions: { id: string; email?: string; userId?: string; principalId?: string }[];
  registry: PrincipalRegistry;
}) {
  const { registry } = input;
  const map = (raw: string) => principalIdFor(raw, registry);
  const result: {
    orgOwner?: string;
    groups: { id: string; humanIds: string[] }[];
    bots: { id: string; ownerUserId?: string; directGrants?: string[] }[];
    sessions: { id: string; principalId: string }[];
  } = { groups: [], bots: [], sessions: [] };

  if (input.org) {
    const owner = map(input.org.ownerUserId);
    if (owner !== input.org.ownerUserId) result.orgOwner = owner;
  }
  for (const group of input.groups) {
    if (!group.humanIds?.length) continue;
    const next = [...new Set(group.humanIds.map(map))];
    if (!sameList(next, group.humanIds)) result.groups.push({ id: group.id, humanIds: next });
  }
  for (const bot of input.bots) {
    const owner = bot.ownerUserId ? map(bot.ownerUserId) : undefined;
    const grants = bot.directGrants ? [...new Set(bot.directGrants.map(map))] : undefined;
    const ownerChanged = owner !== bot.ownerUserId;
    const grantsChanged = grants !== undefined && !sameList(grants, bot.directGrants!);
    if (ownerChanged || grantsChanged) {
      result.bots.push({ id: bot.id, ...(owner ? { ownerUserId: owner } : {}), ...(grants ? { directGrants: grants } : {}) });
    }
  }
  for (const session of input.sessions) {
    if (session.principalId) continue;
    const email = session.email?.trim();
    const userId = session.userId?.trim();
    // Before principals, only an admin could mint a pairing code, so a
    // session with no account is the operator's own device.
    const principalId = email
      ? registry.forAccount({ email, controlPlaneUserId: userId && !userId.startsWith("portal:") ? userId : undefined }).id
      : registry.localOperator().id;
    result.sessions.push({ id: session.id, principalId });
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/people/identity-migration.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/people/identity-migration.ts server/people/identity-migration.test.ts
git commit -m "feat: migrate stored person references to principal ids"
```

---

### Task 3: Sessions liées à un principal

**Files:**
- Modify: `server/auth/sessions.ts` (`sessionSchema` ~l.64, `PairingCode` ~l.110, `openPairing` ~l.308, `exchange` ~l.373, `issue`/`issueAccount` ~l.420, new `setPrincipal`)
- Test: `server/auth/sessions.test.ts` (append a `describe`)

**Interfaces:**
- Produces:
  - `SessionRecord.principalId?: string` (Zod: `z.string().max(64).optional()`).
  - `openPairing(input: { scopes?: Scope[]; label?: string; ttlMs?: number; principalId?: string })`: the pairing remembers `principalId`; `exchange` copies it into the new session.
  - `issue(input: { label: string; scopes: Scope[]; userId?: string; email?: string; principalId?: string })`.
  - `setPrincipal(sessionId: string, principalId: string): boolean`: used by the boot migration; persists.

- [ ] **Step 1: Write the failing test**

Append to `server/auth/sessions.test.ts`. The file's `beforeEach` builds a fresh `SessionRegistry` in the module-level `registry` variable on a temp path; the tests below use it.

```ts
describe("sessions carry a principal", () => {
  it("gives a paired device the principal that minted the code", () => {
    const sessions = registry;
    const opened = sessions.openPairing({ label: "Phone", principalId: "pr_11111111-1111-4111-8111-111111111111" });
    const paired = sessions.exchange({ code: opened.code, label: "", source: "test" });
    expect(paired.ok).toBe(true);
    const token = paired.ok ? paired.token : "";
    expect(sessions.authenticate(token)?.principalId).toBe("pr_11111111-1111-4111-8111-111111111111");
  });

  it("stores the principal of an account sign-in", () => {
    const sessions = registry;
    const issued = sessions.issue({ label: "Mac", scopes: ["client"], email: "morgan@example.com", userId: "cp_1", principalId: "pr_22222222-2222-4222-8222-222222222222" });
    expect(sessions.authenticate(issued.token)?.principalId).toBe("pr_22222222-2222-4222-8222-222222222222");
  });

  it("lets the boot migration attach a principal to an older session", () => {
    const sessions = registry;
    const opened = sessions.openPairing({ label: "Old phone" });
    const paired = sessions.exchange({ code: opened.code, label: "", source: "test" });
    const token = paired.ok ? paired.token : "";
    const id = sessions.authenticate(token)!.id;
    expect(sessions.setPrincipal(id, "pr_33333333-3333-4333-8333-333333333333")).toBe(true);
    expect(sessions.authenticate(token)?.principalId).toBe("pr_33333333-3333-4333-8333-333333333333");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/auth/sessions.test.ts -t "sessions carry a principal"`
Expected: FAIL (`principalId` undefined, `setPrincipal` is not a function).

- [ ] **Step 3: Implement**

In `server/auth/sessions.ts`:

```ts
// sessionSchema, after `email`:
  /** The person this session acts as (server/auth/principals.ts). */
  principalId: z.string().max(64).optional(),
```

```ts
// interface PairingCode, add:
  /** Who minted the code; the paired device acts as them. */
  principalId?: string;
```

In `openPairing`, widen the input type with `principalId?: string` and add to the `pairing` object literal:

```ts
      ...(input.principalId ? { principalId: input.principalId } : {}),
```

In `exchange`, add to the `record` literal (after `expiresAt`):

```ts
      ...(pairing.principalId ? { principalId: pairing.principalId } : {}),
```

Widen `issue`'s input with `principalId?: string`. Open `issueAccount` (`grep -n "issueAccount" server/auth/sessions.ts`), widen its input the same way, and copy `principalId` into the record it builds, next to `userId` and `email`.

Add the method after `revoke`:

```ts
  /** Boot migration only: attach the person an older session acts as. */
  setPrincipal(sessionId: string, principalId: string): boolean {
    const found = this.sessions.find((s) => s.id === sessionId);
    if (!found) return false;
    found.principalId = principalId;
    this.persist();
    return true;
  }
```

Add `principalId?: string` to `PublicSession` and to `publicSession()` if that function exists (`grep -n "function publicSession" server/auth/sessions.ts`), so the UI can show who a device acts as.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/auth/sessions.test.ts server/remote-support/remote-sessions.test.ts`
Expected: PASS, with no regressions in the existing tests.

- [ ] **Step 5: Commit**

```bash
git add server/auth/sessions.ts server/auth/sessions.test.ts
git commit -m "feat: bind sessions and pairing codes to a principal"
```

---

### Task 4: Rôles d'organisation par principal, serveur obligatoire

**Files:**
- Modify: `server/org/org-directory.ts` (`roleOf`), `server/org/org-record.ts` (`createOrg`), `server/org/org-routes.ts` (`OrgRouteDeps`, `parseHost`, every `roleOf` call, `orgPeople`)
- Test: `server/org/org-directory.test.ts`, `server/org/org-record.test.ts`, `server/org/org-routes.test.ts`

**Interfaces:**
- Consumes: `isPrincipalId` (Task 1).
- Produces:
  - `roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string; email?: string }): OrgRole | null`. The owner is matched by `userId` (a principal id, or a legacy email). Admins and members are matched by `email` when given, otherwise by `userId` (legacy).
  - `createOrg` throws `"a server address is required"` unless `host.kind === "server"` with a valid URL (`https://…`, or `http://` whose host ends in `.ts.net` or is `localhost` / `127.0.0.1`).
  - `OrgRouteDeps.actorEmail: (auth: RequestAuth) => string | undefined`.

- [ ] **Step 1: Write the failing tests**

Add to `server/org/org-directory.test.ts`:

```ts
import { roleOf } from "./org-directory.ts";

describe("roles by principal", () => {
  const lists = { ownerUserId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", admins: ["ana@example.com"], members: ["morgan@example.com", "@client.com"] };
  it("finds the owner by principal id and others by email", () => {
    expect(roleOf({ ...lists, userId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toBe("owner");
    expect(roleOf({ ...lists, userId: "pr_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "Ana@example.com" })).toBe("admin");
    expect(roleOf({ ...lists, userId: "pr_cccccccc-cccc-4ccc-8ccc-cccccccccccc", email: "morgan@example.com" })).toBe("member");
    expect(roleOf({ ...lists, userId: "pr_dddddddd-dddd-4ddd-8ddd-dddddddddddd", email: "stranger@example.com" })).toBeNull();
  });
  it("never makes someone owner because of their email", () => {
    expect(roleOf({ ...lists, ownerUserId: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", userId: "pr_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", email: "pr_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toBeNull();
  });
});
```

The `@client.com` domain entry stays literal-only here (`roleOf` does not expand domains; sign-in does). This test pins that behavior.

In `server/org/org-record.test.ts`, change the existing "records the creator" test to use `host: { kind: "server", url: "https://sagax.example.com" }` and expect that host. Then add:

```ts
  it("requires a server address for a new organization", () => {
    expect(() => createOrg({ name: "Acme", ownerUserId: "pr_x", host: { kind: "this-computer" } })).toThrow(/server address/);
    expect(() => createOrg({ name: "Acme", ownerUserId: "pr_x", host: { kind: "server", url: "http://10.0.0.5:8799" } })).toThrow(/server address/);
    expect(createOrg({ name: "Acme", ownerUserId: "pr_x", host: { kind: "server", url: "http://localhost:8080" } }).host)
      .toEqual({ kind: "server", url: "http://localhost:8080" });
    expect(createOrg({ name: "Acme", ownerUserId: "pr_x", host: { kind: "server", url: "http://host.tail1234.ts.net:8799" } }).host)
      .toEqual({ kind: "server", url: "http://host.tail1234.ts.net:8799" });
  });
  it("keeps the principal id as given", () => {
    expect(createOrg({ name: "Acme", ownerUserId: "pr_00000000-0000-4000-8000-000000000000", host: { kind: "server", url: "https://a.b" } }).ownerUserId)
      .toBe("pr_00000000-0000-4000-8000-000000000000");
  });
```

In `server/org/org-routes.test.ts`, update every `createOrgRoute` / `createOrgRoutes` fixture that uses `this-computer` to the `https://sagax.example.com` server host. Wherever deps are built, add `actorEmail: () => "<the email the test's actor had>"`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run server/org/org-directory.test.ts server/org/org-record.test.ts server/org/org-routes.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Implement**

`server/org/org-directory.ts`, replace `roleOf`:

```ts
export function roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string; email?: string }): OrgRole | null {
  const userId = actorKey(input.userId);
  if (!userId) return null;
  if (userId === actorKey(input.ownerUserId)) return "owner";
  // Lists are sign-in emails. A principal is matched by its email; a legacy
  // email-shaped id still matches itself until the migration has run.
  const key = input.email !== undefined ? actorKey(input.email) : userId;
  if (!key) return null;
  if (input.admins.some((id) => actorKey(id) === key)) return "admin";
  if (input.members.some((id) => actorKey(id) === key)) return "member";
  return null;
}
```

`server/org/org-record.ts`, replace `createOrg`:

```ts
export function serverAddressOk(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (parsed.protocol !== "http:") return false;
    // Tailscale names, or a local Docker server whose exposure the operator manages.
    return parsed.hostname.endsWith(".ts.net") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  // Org mode needs a coordination server everyone signs in to. This
  // computer can be it, through its tunnel, Tailscale or domain address.
  if (input.host.kind !== "server" || !serverAddressOk(input.host.url)) throw new Error("a server address is required");
  const owner = input.ownerUserId.trim();
  return { name, ownerUserId: isPrincipalId(owner) ? owner : owner.toLowerCase(), host: { kind: "server", url: input.host.url.trim() } };
}
```

Add `import { isPrincipalId } from "./principals.ts";` at the top of `org-record.ts`.

`server/org/org-routes.ts`:
- Add `actorEmail: (auth: RequestAuth) => string | undefined;` to `OrgRouteDeps`.
- Add a `email?: string` parameter to `issueInviteRoute` and `revokeInviteRoute`. Pass it through to `roleOf` as `email: input.email`. In `createOrgRoutes`, call both with `email: deps.actorEmail(auth)`.
- `orgPeople`: owners are principal ids and lists are emails. Keep the loop, but call `roleOf` with `email: id` for list entries and without `email` for the owner, so each entry resolves to its own role.
- `acceptInviteRoute` keeps comparing emails (the invite is bound to an email). The route passes `userId: deps.actorEmail(auth) ?? body.userId`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/org/org-directory.test.ts server/org/org-record.test.ts server/org/org-routes.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/org/org-directory.ts server/org/org-record.ts server/org/org-routes.ts server/org/org-*.test.ts
git commit -m "feat: resolve org roles by principal and require a server address"
```

---

### Task 5: Visibilité des channels par principal

**Files:**
- Modify: `server/rooms/channel-visibility.ts` (`channelViewerId`)
- Test: `server/rooms/channel-visibility.test.ts`

**Interfaces:**
- Produces: `channelViewerId(auth: { kind: string; session?: { id?: string; email?: string; userId?: string; principalId?: string } }): string | undefined`. For a session it returns the `principalId`, otherwise `anon:<session.id>`, which never matches `humanIds`. For any other auth kind it returns `undefined` (the local operator, unchanged).

- [ ] **Step 1: Write the failing test**

```ts
describe("viewer id by principal", () => {
  it("uses the session principal", () => {
    expect(channelViewerId({ kind: "session", session: { id: "s1", email: "z@example.com", principalId: "pr_11111111-1111-4111-8111-111111111111" } }))
      .toBe("pr_11111111-1111-4111-8111-111111111111");
  });
  it("gives a session without a principal an id that sees no channel", () => {
    const viewer = channelViewerId({ kind: "session", session: { id: "s9" } });
    expect(viewer).toBe("anon:s9");
    expect(seesChannel({ humanIds: ["pr_11111111-1111-4111-8111-111111111111"] }, viewer)).toBe(false);
    expect(seesBotForViewer({ viewerId: viewer, ownerUserId: "pr_11111111-1111-4111-8111-111111111111", directGrants: [], inChannels: [] })).toBe(false);
  });
  it("leaves the local operator unfiltered", () => {
    expect(channelViewerId({ kind: "loopback" })).toBeUndefined();
  });
});
```

Import `channelViewerId`, `seesChannel` and `seesBotForViewer` from `./channel-visibility.ts` if the file does not already.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/rooms/channel-visibility.test.ts -t "viewer id by principal"`
Expected: FAIL (the session without email returns `undefined` today).

- [ ] **Step 3: Implement**

Replace `channelViewerId` in `server/rooms/channel-visibility.ts`:

```ts
/** A signed-in viewer is their principal. A session that somehow has none
 * gets an id no channel lists, so it sees nothing rather than everything.
 * Loopback (the operator at this computer) has no viewer id and is not
 * filtered. */
export function channelViewerId(auth: {
  kind: string;
  session?: { id?: string; email?: string; userId?: string; principalId?: string };
}): string | undefined {
  if (auth.kind !== "session") return undefined;
  const principal = auth.session?.principalId?.trim();
  if (principal) return principal;
  return `anon:${auth.session?.id ?? "unknown"}`;
}
```

Existing tests that expected an email as the viewer id: update their fixture sessions to carry a `principalId`, and their `humanIds` to that id. Keep what each test asserts.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/rooms/channel-visibility.test.ts server/approvals/approval-audience.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/rooms/channel-visibility.ts server/rooms/channel-visibility.test.ts
git commit -m "fix: sessions without a principal see no org channel"
```

---

### Task 6: Brancher les principals dans le serveur

**Files:**
- Modify: `server/index.ts`
- Test: `server/org/org-identity.e2e.test.ts` (new; model it on an existing `*.e2e.test.ts` that boots the server, e.g. `server/org/org-library.e2e.test.ts`: read how it starts the harness on a temp `DATA_DIR` and authenticates)

**Interfaces:**
- Consumes: Tasks 1 to 5.
- Produces: a module-level `principals: PrincipalRegistry` in `index.ts`, plus these helpers.

```ts
function localPrincipalId(): string { return principals.localOperator(cfg.profile?.email).id; }
function actorPrincipalId(auth: RequestAuth): string {
  if (auth.kind === "session") return channelViewerId(auth) ?? "";
  if (auth.kind === "loopback" && auth.trust === "service") return "";
  return localPrincipalId();
}
function actorEmail(auth: RequestAuth): string | undefined {
  if (auth.kind === "session") return auth.session.email?.trim().toLowerCase() || undefined;
  return cfg.profile?.email?.trim().toLowerCase() || undefined;
}
```

- [ ] **Step 1: Write the failing e2e test**

Boot the harness on a temp `DATA_DIR`. Seed `config.json` with a profile email `owner@example.com`, then:
1. `POST /api/org` over loopback with `host: { kind: "this-computer" }`. Expect 400 with `/server address/`.
2. `POST /api/org` with `host: { kind: "server", url: "https://sagax.example.com" }`. Expect 200, and `org.ownerUserId` matches `/^pr_/`.
3. `POST /api/auth/pairing` over loopback (the pairing-code route), exchange the code on `POST /api/pair`, then `GET /api/org` with the session cookie. Expect 200. Then `GET /api/sessions` (or the route that lists sessions; `grep -n '"/api/sessions"' server/index.ts`) and expect the new session to carry the same `principalId` as the org owner.
4. Restart the harness on the same `DATA_DIR`. `principals.json` still has exactly one `local: true` entry, and the org owner is unchanged.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/org/org-identity.e2e.test.ts`
Expected: FAIL (step 1 returns 200 today).

- [ ] **Step 3: Implement in `server/index.ts`**

1. **Registry and boot migration.** Next to the session registry construction (`grep -n "new SessionRegistry" server/index.ts`), build the registry and run the migration once, after `store` and `sessions` exist and before routes serve. Use a flag in config (`cfg.identityMigratedAt`) to skip the org and store rewrite on later boots. Session migration is cheap and runs every boot for sessions that still lack a principal.

```ts
const principals = new PrincipalRegistry({ path: join(DATA_DIR, "principals.json") });
principals.localOperator(cfg.profile?.email);
{
  const migrated = migrateIdentityRefs({
    org: cfg.org ?? null,
    groups: store.groups,
    bots: store.bots,
    sessions: sessions.listRecordsForMigration(),
    registry: principals,
  });
  if (migrated.orgOwner && cfg.org) { cfg.org = { ...cfg.org, ownerUserId: migrated.orgOwner }; saveConfig({ org: cfg.org }); }
  for (const g of migrated.groups) store.patchGroup(g.id, { humanIds: g.humanIds });
  for (const b of migrated.bots) store.patchBot(b.id, { ...(b.ownerUserId ? { ownerUserId: b.ownerUserId } : {}), ...(b.directGrants ? { directGrants: b.directGrants } : {}) });
  for (const s of migrated.sessions) sessions.setPrincipal(s.id, s.principalId);
}
```

Add `listRecordsForMigration(): { id: string; email?: string; userId?: string; principalId?: string }[]` to `SessionRegistry` in `server/auth/sessions.ts`. It returns `this.sessions.map(({ id, email, userId, principalId }) => ({ id, email, userId, principalId }))`. Add a one-line test for it in `server/auth/sessions.test.ts`.

`store.patchGroup` accepts `humanIds` (`store.ts:1178`). `applyHumanIds` (`server/rooms/channel-membership.ts:27`) passes ids through unchanged, so `pr_` ids need no change there.

2. **Identity helpers.** Add `localPrincipalId`, `actorPrincipalId` and `actorEmail` (see Interfaces) near `channelActorId`. Then replace:
   - `channelActorId(auth)` body: `return actorPrincipalId(auth);`
   - `creatingBotOwnerId`: `return actorPrincipalId(auth);` (no lowercasing: principal ids are already lowercase and exact).
   - every `(cfg.profile?.email ?? "local-owner").trim()` and `.toLowerCase()` variant: `localPrincipalId()`. There are 7 sites; `grep -n '"local-owner"' server/index.ts` lists them.
   - `approvalOwnerName(ownerUserId)`: if `ownerUserId === localPrincipalId()` and a profile name exists, return the name. Otherwise return `principals.byId(ownerUserId)?.email ?? ownerUserId`.
   - `createOrgRoutes({ actorId: ... })`: `actorId: actorPrincipalId, actorEmail,`.

3. **Sign-in.** In the `/api/auth/email/verify` handler, before `sessions.issue(...)`:

```ts
const principal = principals.forAccount({ email: verified.email, controlPlaneUserId: verified.userId });
```

   Then pass `principalId: principal.id` to `sessions.issue`.

4. **Pairing.** In the pairing-code route (`sessions.openPairing(` around line 14089), pass `principalId: actorPrincipalId(auth) || undefined`.

5. **Profile email.** In the config PATCH (`ownerUserIdAfterProfileEmail` around line 21788), replace the `nextOrg` owner rewrite with `principals.localOperator(patch.profile.email)`. The principal keeps its id, so the org owner no longer needs rewriting. Remove the now-unused `nextOrg` branch and the `ownerUserIdAfterProfileEmail` import, if nothing else uses them (`grep -n ownerUserIdAfterProfileEmail server/`). Keep the function in `org-directory.ts` only if a test still imports it; otherwise delete the function and its test.

6. **Directory emails.** `personKey(session)` (line ~747) hashes the email. Make it `session.principalId ?? <existing hash>` so sender attribution follows the principal.

- [ ] **Step 4: Run tests**

Run: `npx vitest run server/org/org-identity.e2e.test.ts server/org/org-routes.test.ts server/rooms/channel-visibility.test.ts server/auth/sessions.test.ts`
Then: `pnpm -s typecheck`
Then run the whole server suite and compare with the pre-change failure list, saved before starting via `npx vitest run server > /tmp/server-before.txt`: `npx vitest run server`
Expected: the new e2e test passes, with no new failures.

- [ ] **Step 5: Commit**

```bash
git add server/index.ts server/auth/sessions.ts server/auth/sessions.test.ts server/org/org-identity.e2e.test.ts
git commit -m "feat: key org ownership, channels and approvals on principals"
```

---

### Task 7: Créer une organisation avec une adresse de serveur

**Files:**
- Modify: `src/components/OrganizationSettings.tsx` (create form, ~l.110-140)
- Modify: `src/locales/en.json`, `src/locales/fr.json`, `src/locales/source-hashes.json` (via the script)
- Test: `src/components/OrganizationSettings.test.ts` (create it if missing, with `renderToStaticMarkup` like `src/components/SettingsPrimitives.test.ts`)

**Interfaces:**
- Consumes: `POST /api/org` now rejects anything but `{ kind: "server", url }`.
- Produces: a server-address field in the create form, prefilled from the app's public address when the server exposes one. Find it with `grep -rn "publicUrl\|remoteAddress" src/state src/lib | head`. If none is exposed to the client, leave the field empty.

- [ ] **Step 1: Write the failing test**

```ts
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { OrgCreateForm, orgHostFromInput } from "./OrganizationSettings";

describe("organization create form", () => {
  it("asks for the server address everyone signs in to", () => {
    const markup = renderToStaticMarkup(createElement(OrgCreateForm, { initialAddress: "", onCreate: async () => undefined }));
    expect(markup).toContain('name="org-server-address"');
  });
  it("accepts https, Tailscale and local Docker addresses only", () => {
    expect(orgHostFromInput("http://localhost:8080")).toEqual({ kind: "server", url: "http://localhost:8080" });
    expect(orgHostFromInput("https://sagax.example.com")).toEqual({ kind: "server", url: "https://sagax.example.com" });
    expect(orgHostFromInput("http://host.tail1234.ts.net:8799")).toEqual({ kind: "server", url: "http://host.tail1234.ts.net:8799" });
    expect(orgHostFromInput("http://10.0.0.5")).toBeNull();
    expect(orgHostFromInput("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/components/OrganizationSettings.test.ts`
Expected: FAIL (`OrgCreateForm` / `orgHostFromInput` not exported).

- [ ] **Step 3: Implement**

Extract the create form (name input and create button, currently inline around l.110-140) into an exported `OrgCreateForm({ initialAddress, onCreate })` in the same file. Add a second input, `name="org-server-address"`, labeled `t("org.serverAddress")`, with help text `t("org.serverAddressHelp")`. The create button is disabled until `orgHostFromInput(address)` is non-null. `onCreate(name, host)` posts `{ name, host }`. Export:

```ts
export function orgHostFromInput(value: string): { kind: "server"; url: string } | null {
  const url = value.trim();
  try {
    const parsed = new URL(url);
    const localOrTailnet = parsed.hostname.endsWith(".ts.net") || parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && localOrTailnet)) return { kind: "server", url };
  } catch { /* not a URL */ }
  return null;
}
```

Style the input like the other inputs in this file.

Strings:

| key | en | fr |
|---|---|---|
| `org.serverAddress` | `Server address` | `Adresse du serveur` |
| `org.serverAddressHelp` | `Everyone in the organization signs in to this server. Use its https address, its Tailscale name, or http://localhost for a local Docker server.` | `Tout le monde dans l'organisation se connecte à ce serveur. Utilise son adresse https, son nom Tailscale, ou http://localhost pour un serveur Docker local.` |

Then run `node scripts/generate-locale.mjs fr --accept` and `pnpm -s i18n:check`.

For an existing org whose host is `this-computer`, the settings screen shows a notice `t("org.needsServerAddress")`. en: `This organization has no server address yet. People outside this computer cannot join until it has one.` fr: `Cette organisation n'a pas encore d'adresse de serveur. Les personnes hors de ce poste ne peuvent pas la rejoindre avant.` No migration action.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/components/OrganizationSettings.test.ts && pnpm -s typecheck && pnpm -s i18n:check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/OrganizationSettings.tsx src/components/OrganizationSettings.test.ts src/locales/en.json src/locales/fr.json src/locales/source-hashes.json
git commit -m "feat: ask for the server address when creating an organization"
```

---

## Serveur de développement

Le serveur de coordination tourne dans Docker sur le Mac de l'opérateur: `docker compose up -d --build` à la racine (`compose.yaml`, projet `pulsa`, image construite depuis ce repo, jamais depuis l'image d'Sagax). Il écoute sur `127.0.0.1:8080`. L'opérateur gère lui-même l'exposition (proxy, tunnel ou Tailscale). Les tests de bout en bout de la Task 6 n'en dépendent pas: ils démarrent le harness directement sur un `DATA_DIR` temporaire.

## Hors tranche (noté pour la suite)

- Déployer le control plane du fork et changer l'adresse par défaut. C'est une action Pulsatrix (compte Cloudflare). La variable `SAGAX_CONTROL_PLANE_URL` existe déjà et suffit pour pointer un serveur vers le nouveau control plane.
- Séparer le rôle d'organisation du scope `admin` du serveur: tranche 2.

# Organisation, canaux et bots partagés

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Morgan rejoint l'organisation, voit ses canaux, et fait travailler les bots qu'on y a posés, sans approuver à la place du propriétaire.

**Architecture:** On étend le `Group` actuel. `memberIds` reste les bots. `humanIds` ajoute les gens. L'annuaire réutilise `config.signIn` (admins, members) plus un enregistrement d'organisation et des invitations. L'hôte de la flotte garde les transcripts. À la tranche 3, une machine personnelle s'enregistre comme worker et reçoit le tour. La colonne Discord n'apparaît que lorsqu'une organisation existe. Sans organisation, la barre latérale actuelle reste, pour les bots d'avant.

**Tech Stack:** TypeScript strict, Vitest, serveur `server/*.ts`, React dans `src/components`, schémas Zod déjà utilisés par `server/config.ts` et `server/bot-visibility.ts`.

**Spec:** `docs/superpowers/specs/2026-09-27-org-channels-design.md`. Le plan s'appuie sur la spec. L'exécutant lit les deux.

## Global Constraints

- Invitation: usage unique, révocable, valable 7 jours (`INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`).
- Rôles: `owner`, `admin`, `member`. Un seul owner, le créateur.
- `humanIds` ne se mélange pas à `memberIds`. Un groupe `dm` ne reçoit pas d'humains.
- Jusqu'à la tranche 3, tout bot a `host: { kind: "fleet" }`.
- Le transcript d'un canal est toujours écrit sur l'hôte de la flotte.
- L'approbation est livrée seulement au propriétaire, sur la machine qui exécute. Pas de bouton pour les autres.
- Un worker éteint ne fait pas basculer le tour sur l'hôte.
- La connexion entreprise (modèles, licence) reste une carte séparée.
- Le verrou de tour du canal (`busyBotId`) ne change pas.
- Pas de copie du bot sur le disque de l'invité.
- Français (Québec) pour le texte d'interface nouveau. Termes techniques en English. Pas de tiret cadratin ni de en-dash.

## Review Focus

Ces cinq cas sont ceux qu'un oubli laisserait passer. Chaque ligne a son test dans la tâche qui possède le code.

1. Un jeton d'invitation déjà accepté, présenté une seconde fois, doit répondre `used` et ne pas créer une deuxième adhésion. Tâche 1.
2. Un admin qui n'est pas le propriétaire du bot ne peut pas l'écrire dans `memberIds`. Tâche 5.
3. Un worker éteint met le message en file et ne lance pas le tour sur l'hôte. Tâche 10.
4. Un member du canal ne reçoit pas la carte d'approbation. Tâche 12.
5. Un groupe `dm` refuse `humanIds`. Tâche 5.

---

### Task 1: Règles pures d'invitation et de rôle

**Files:**
- Create: `server/org/org-directory.ts`
- Test: `server/org/org-directory.test.ts`

**Interfaces:**
- Consumes: rien
- Produces:
  - `export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000`
  - `export type OrgRole = "owner" | "admin" | "member"`
  - `export interface OrgInvite { token: string; email: string; createdAt: number; expiresAt: number; usedAt?: number; revokedAt?: number }`
  - `export function inviteStatus(invite: OrgInvite, now: number): "open" | "expired" | "used" | "revoked"`
  - `export function acceptInvite(invite: OrgInvite, now: number): { ok: true; invite: OrgInvite } | { ok: false; status: "expired" | "used" | "revoked" }`
  - `export function roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string }): OrgRole | null`

`used` gagne sur `expired`. `revoked` gagne sur les deux. `now === expiresAt` est `expired`. `acceptInvite` en succès pose `usedAt` et ne change pas le token.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS, acceptInvite, inviteStatus, roleOf, type OrgInvite } from "./org-directory.ts";

const invite = (over: Partial<OrgInvite> = {}): OrgInvite => ({
  token: "tok",
  email: "morgan@example.test",
  createdAt: 0,
  expiresAt: INVITE_TTL_MS,
  ...over,
});

describe("inviteStatus", () => {
  it("treats the exact expiry instant as expired", () => {
    expect(inviteStatus(invite(), INVITE_TTL_MS)).toBe("expired");
  });
  it("reports used even after expiry", () => {
    expect(inviteStatus(invite({ usedAt: 10 }), INVITE_TTL_MS + 1)).toBe("used");
  });
  it("reports revoked above used and expired", () => {
    expect(inviteStatus(invite({ usedAt: 10, revokedAt: 11 }), 12)).toBe("revoked");
  });
});

describe("acceptInvite", () => {
  it("marks a token used once and refuses the second presentation", () => {
    const first = acceptInvite(invite(), 1_000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = acceptInvite(first.invite, 2_000);
    expect(second).toEqual({ ok: false, status: "used" });
  });
});

describe("roleOf", () => {
  it("gives the creator owner and keeps admins distinct from members", () => {
    const lists = { ownerUserId: "owner", admins: ["owner", "ada@example.test"], members: ["morgan@example.test"] };
    expect(roleOf({ ...lists, userId: "owner" })).toBe("owner");
    expect(roleOf({ ...lists, userId: "ada@example.test" })).toBe("admin");
    expect(roleOf({ ...lists, userId: "morgan@example.test" })).toBe("member");
    expect(roleOf({ ...lists, userId: "stranger" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/org/org-directory.test.ts`
Expected: FAIL, cannot find module `./org-directory.ts`

- [ ] **Step 3: Write minimal implementation**

```ts
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type OrgRole = "owner" | "admin" | "member";
export interface OrgInvite {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
}
export function inviteStatus(invite: OrgInvite, now: number): "open" | "expired" | "used" | "revoked" {
  if (invite.revokedAt !== undefined) return "revoked";
  if (invite.usedAt !== undefined) return "used";
  if (now >= invite.expiresAt) return "expired";
  return "open";
}
export function acceptInvite(invite: OrgInvite, now: number) {
  const status = inviteStatus(invite, now);
  if (status !== "open") return { ok: false as const, status };
  return { ok: true as const, invite: { ...invite, usedAt: now } };
}
export function roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string }): OrgRole | null {
  if (input.userId === input.ownerUserId) return "owner";
  if (input.admins.includes(input.userId)) return "admin";
  if (input.members.includes(input.userId)) return "member";
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/org/org-directory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/org/org-directory.ts server/org/org-directory.test.ts
git commit -m "feat: add org invite and role rules"
```

### Task 2: Enregistrement de l'organisation sur l'hôte

**Files:**
- Create: `server/org/org-record.ts`
- Test: `server/org/org-record.test.ts`
- Modify: `server/config.ts` (le bloc `signIn` existant, autour de la ligne 360)

**Interfaces:**
- Consumes: `OrgRole`, `OrgInvite`, `INVITE_TTL_MS`, `roleOf` from `server/org/org-directory.ts`
- Produces:
  - `export interface OrgRecord { name: string; host: { kind: "this-computer" } | { kind: "server"; url: string }; ownerUserId: string }`
  - `export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord`
  - `export function issueInvite(input: { email: string; now: number; token: string }): OrgInvite`
  - `export function memberListsAfterAccept(input: { members: string[]; email: string }): { members: string[]; alreadyMember: boolean }`

`createOrg` refuse un nom vide. `issueInvite` pose `expiresAt = now + INVITE_TTL_MS`. `memberListsAfterAccept` ne duplique pas un email déjà dans `members`. Les admins existants de `config.signIn` ne sont pas réécrits par cette fonction.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { INVITE_TTL_MS } from "./org-directory.ts";
import { createOrg, issueInvite, memberListsAfterAccept } from "./org-record.ts";

describe("org record", () => {
  it("records the creator as the only owner on this computer", () => {
    expect(createOrg({ name: "Example", ownerUserId: "owner", host: { kind: "this-computer" } })).toEqual({
      name: "Example",
      ownerUserId: "owner",
      host: { kind: "this-computer" },
    });
  });
  it("rejects a blank name", () => {
    expect(() => createOrg({ name: "  ", ownerUserId: "owner", host: { kind: "this-computer" } })).toThrow(/name/);
  });
  it("issues a single-use invite that expires in 7 days", () => {
    expect(issueInvite({ email: "morgan@example.test", now: 50, token: "tok" }).expiresAt).toBe(50 + INVITE_TTL_MS);
  });
  it("returns an existing member without a second row", () => {
    expect(memberListsAfterAccept({ members: ["morgan@example.test"], email: "morgan@example.test" })).toEqual({
      members: ["morgan@example.test"],
      alreadyMember: true,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/org/org-record.test.ts`
Expected: FAIL, module missing

- [ ] **Step 3: Write minimal implementation**

```ts
import { INVITE_TTL_MS, type OrgInvite } from "./org-directory.ts";

export interface OrgRecord {
  name: string;
  host: { kind: "this-computer" } | { kind: "server"; url: string };
  ownerUserId: string;
}

export function createOrg(input: { name: string; ownerUserId: string; host: OrgRecord["host"] }): OrgRecord {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  return { name, ownerUserId: input.ownerUserId, host: input.host };
}

export function issueInvite(input: { email: string; now: number; token: string }): OrgInvite {
  return {
    token: input.token,
    email: input.email.trim().toLowerCase(),
    createdAt: input.now,
    expiresAt: input.now + INVITE_TTL_MS,
  };
}

export function memberListsAfterAccept(input: { members: string[]; email: string }) {
  const email = input.email.trim().toLowerCase();
  if (input.members.includes(email)) return { members: input.members, alreadyMember: true };
  return { members: [...input.members, email], alreadyMember: false };
}
```

La liste persistée reste `config.signIn.members`. Pas de second tableau de membres.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/org/org-record.test.ts server/org/org-directory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/org/org-record.ts server/org/org-record.test.ts
git commit -m "feat: record the fleet organization and its invites"
```

### Task 3: Routes créer, inviter, accepter

**Files:**
- Create: `server/org/org-routes.ts`
- Test: `server/org/org-routes.test.ts`
- Modify: `server/index.ts` (monter les routes à côté des routes `/api/config` existantes)

**Interfaces:**
- Consumes: `createOrg`, `issueInvite`, `memberListsAfterAccept`, `acceptInvite`, `roleOf`
- Produces:
  - `POST /api/org` body `{ name, host }` → `{ org: OrgRecord }`
  - `POST /api/org/invites` body `{ email }` → `{ invite: { token, email, expiresAt } }` réservé à `owner` et `admin`
  - `POST /api/org/invites/:token/accept` body `{ userId }` → `{ status: "joined" | "already-member" | "expired" | "used" | "revoked" }`

Un second `POST /api/org` répond 409. Un member qui appelle `POST /api/org/invites` répond 403.

- [ ] **Step 1: Write the failing test**

Le test instancie les handlers avec un faux store en mémoire `{ org: null, invites: [], signIn: { admins: [], members: [] } }` et appelle les fonctions exportées `createOrgRoute`, `issueInviteRoute`, `acceptInviteRoute` plutôt que le serveur HTTP complet.

```ts
it("joins once and reports already-member the second time", () => {
  const state = emptyOrgState();
  createOrgRoute(state, { name: "Example", ownerUserId: "owner", host: { kind: "this-computer" } });
  const issued = issueInviteRoute(state, { actorId: "owner", email: "morgan@example.test", now: 1, token: "tok" });
  expect(issued.status).toBe(200);
  expect(acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 2 }).body.status).toBe("joined");
  expect(acceptInviteRoute(state, { token: "tok", userId: "morgan@example.test", now: 3 }).body.status).toBe("used");
});
```

Ajouter un cas 403: `actorId` est un member déjà accepté, `issueInviteRoute` retourne `{ status: 403 }`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/org/org-routes.test.ts`
Expected: FAIL, handlers missing

- [ ] **Step 3: Write minimal implementation**

Les handlers mutent le state passé. `acceptInviteRoute` appelle `acceptInvite` puis `memberListsAfterAccept`. Si `alreadyMember` est vrai avant consommation du jeton, répondre `already-member` sans poser `usedAt` seulement lorsque l'email est déjà member et le jeton est encore `open`. Si le jeton est déjà `used`, répondre `used`.

Monter les trois chemins dans `server/index.ts` en déléguant à ces handlers. Ne pas ouvrir de nouveau système de session: le `userId` accepté est l'email, la même clé que `signIn.members`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/org/org-routes.test.ts server/org/org-record.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/org/org-routes.ts server/org/org-routes.test.ts server/index.ts
git commit -m "feat: add org create and invite routes"
```

### Task 4: Écran d'organisation vide, puis avec des membres

**Files:**
- Create: `src/components/OrgDirectory.tsx`
- Test: `src/components/OrgDirectory.test.ts`
- Modify: `src/components/OrganizationSettings.tsx` (rendre `OrgDirectory` au-dessus de la carte entreprise existante)

**Interfaces:**
- Consumes: `OrgRecord`, `OrgRole`
- Produces: `export function OrgDirectory({ org, people, onCreate, onInvite }: { org: { name: string } | null; people: { id: string; role: OrgRole }[]; onCreate: (name: string) => void; onInvite: (email: string) => void })`

Sans org, le rendu contient un champ nom et un bouton dont le libellé est `Créer l'organisation`. Avec org, le nom s'affiche et la liste des gens aussi. La carte entreprise déjà dans `OrganizationSettings.tsx` reste montée sous ce bloc.

- [ ] **Step 1: Write the failing test**

```ts
it("offers creation when there is no organization", () => {
  const html = renderToStaticMarkup(createElement(OrgDirectory, { org: null, people: [], onCreate() {}, onInvite() {} }));
  expect(html).toContain("Créer l'organisation");
});
it("lists members once the organization exists", () => {
  const html = renderToStaticMarkup(createElement(OrgDirectory, {
    org: { name: "Example" },
    people: [{ id: "morgan@example.test", role: "member" }],
    onCreate() {},
    onInvite() {},
  }));
  expect(html).toContain("Example");
  expect(html).toContain("morgan@example.test");
  expect(html).not.toContain("Créer l'organisation");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/OrgDirectory.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Composant présentatif. Pas d'appel réseau dans le fichier. `OrganizationSettings.tsx` charge `GET /api/org` et passe les callbacks vers les routes de la tâche 3. Si `GET /api/org` répond 404, passer `org: null`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/OrgDirectory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/OrgDirectory.tsx src/components/OrgDirectory.test.ts src/components/OrganizationSettings.tsx
git commit -m "feat: show the organization directory above the enterprise card"
```

### Task 5: Humains d'un canal, à part des bots

**Files:**
- Modify: `shared/wire.ts` (type du groupe)
- Modify: `server/store.ts` (`GroupRecord`, `patchGroup`)
- Modify: `src/state/store.tsx` (`Group`)
- Create: `server/channel-membership.ts`
- Test: `server/channel-membership.test.ts`

**Interfaces:**
- Consumes: `OrgRole`
- Produces:
  - `humanIds?: string[]` sur le groupe, absent sur un `dm`
  - `export function canPlaceBot(input: { actorId: string; ownerUserId: string }): boolean`
  - `export function canEditHumans(role: OrgRole): boolean`
  - `export function applyHumanIds(input: { dm?: boolean; humanIds: string[] }): { ok: true; humanIds: string[] } | { ok: false; error: "dm-has-no-humans" }`

`canPlaceBot` est vrai seulement si `actorId === ownerUserId`. Un admin n'est pas une exception. `canEditHumans` est vrai pour `owner` et `admin`.

- [ ] **Step 1: Write the failing test**

```ts
it("refuses a human list on a bot-to-bot dm", () => {
  expect(applyHumanIds({ dm: true, humanIds: ["morgan@example.test"] })).toEqual({ ok: false, error: "dm-has-no-humans" });
});
it("lets only the bot owner place it", () => {
  expect(canPlaceBot({ actorId: "ada@example.test", ownerUserId: "owner" })).toBe(false);
  expect(canPlaceBot({ actorId: "owner", ownerUserId: "owner" })).toBe(true);
});
it("lets an admin edit people and stops a member", () => {
  expect(canEditHumans("admin")).toBe(true);
  expect(canEditHumans("member")).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/channel-membership.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Ajouter `humanIds` au schéma du groupe dans `shared/wire.ts`, à `GroupRecord`, et à l'interface `Group` du client. `patchGroup` refuse la clé `humanIds` quand `group.dm` est vrai, avec l'erreur `dm-has-no-humans`. La route qui ajoute un bot à `memberIds` appelle `canPlaceBot` et répond 403 sinon. La route qui écrit `humanIds` appelle `canEditHumans` et répond 403 pour un member.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/channel-membership.test.ts server/store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add shared/wire.ts server/store.ts server/channel-membership.ts server/channel-membership.test.ts src/state/store.tsx
git commit -m "feat: keep channel humans apart from bot members"
```

### Task 6: Visibilité des canaux et de Direct

**Files:**
- Create: `server/channel-visibility.ts`
- Test: `server/channel-visibility.test.ts`

**Interfaces:**
- Consumes: `humanIds` de la tâche 5
- Produces:
  - `export function canSeeChannel(input: { humanIds: string[]; viewerId: string }): boolean`
  - `export function canSeeDirectBot(input: { ownerUserId: string; viewerId: string; directGrants: string[] }): boolean`

`directGrants` est la liste des `userId` à qui le propriétaire a ouvert un 1:1. Le propriétaire se voit toujours. Un autre se voit seulement s'il est dans `directGrants`. Un canal se voit seulement si `viewerId` est dans `humanIds`.

- [ ] **Step 1: Write the failing test**

```ts
it("hides a channel from someone who was not added", () => {
  expect(canSeeChannel({ humanIds: ["owner"], viewerId: "morgan@example.test" })).toBe(false);
  expect(canSeeChannel({ humanIds: ["owner", "morgan@example.test"], viewerId: "morgan@example.test" })).toBe(true);
});
it("shows another person's bot in Direct only after a grant", () => {
  expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "morgan@example.test", directGrants: [] })).toBe(false);
  expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "morgan@example.test", directGrants: ["morgan@example.test"] })).toBe(true);
  expect(canSeeDirectBot({ ownerUserId: "owner", viewerId: "owner", directGrants: [] })).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/channel-visibility.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Fonctions pures, sans store. Le filtre de `GET /api/groups` pour une session member applique `canSeeChannel`. Le filtre de la zone Direct applique `canSeeDirectBot`. Une session locale sans `userId` (l'opérateur sur la machine avant les membres) continue de tout voir, comme `SEES_EVERYTHING` dans `server/bot-visibility.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/channel-visibility.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/channel-visibility.ts server/channel-visibility.test.ts
git commit -m "feat: filter channels and direct bots by membership"
```

### Task 7: Accord direct

**Files:**
- Create: `server/direct-grants.ts`
- Test: `server/direct-grants.test.ts`

**Interfaces:**
- Consumes: `canPlaceBot` n'est pas réutilisé. Produit sa propre règle.
- Produces:
  - `export interface DirectGrant { botId: string; userId: string }`
  - `export function grantDirect(input: { actorId: string; ownerUserId: string; botId: string; userId: string; grants: DirectGrant[] }): { ok: true; grants: DirectGrant[] } | { ok: false; error: "not-owner" }`

Seul `actorId === ownerUserId` ajoute. Un deuxième appel avec la même paire ne duplique pas.

- [ ] **Step 1: Write the failing test**

```ts
it("lets the owner open a direct and refuses anyone else", () => {
  const opened = grantDirect({ actorId: "owner", ownerUserId: "owner", botId: "aurora", userId: "morgan@example.test", grants: [] });
  expect(opened.ok).toBe(true);
  expect(grantDirect({ actorId: "ada@example.test", ownerUserId: "owner", botId: "aurora", userId: "morgan@example.test", grants: [] })).toEqual({
    ok: false,
    error: "not-owner",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/direct-grants.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Persister les grants à côté du bot (`bot.directGrants: string[]` des userId). `POST /api/bots/:id/direct-grants` body `{ userId }` appelle `grantDirect`. 403 et `{ error: "not-owner" }` sinon.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/direct-grants.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/direct-grants.ts server/direct-grants.test.ts
git commit -m "feat: let a bot owner open a direct to one person"
```

### Task 8: Colonne Discord

**Files:**
- Create: `src/components/OrgSidebar.tsx`
- Test: `src/components/OrgSidebar.test.ts`
- Modify: `src/components/Sidebar.tsx` (si une org est chargée, rendre `OrgSidebar` à la place du roster actuel)

**Interfaces:**
- Consumes: `canSeeChannel`, `canSeeDirectBot` (le serveur a déjà filtré; le composant affiche ce qu'il reçoit)
- Produces: `export function OrgSidebar({ orgName, channels, directs }: { orgName: string; channels: { id: string; name: string; preview: string }[]; directs: { id: string; name: string }[] })`

Le rendu contient `orgName`, chaque nom de canal, le titre `Direct`, et les noms des bots directs. Il ne contient pas la liste de tous les bots de la flotte.

- [ ] **Step 1: Write the failing test**

```ts
it("lists channels and direct bots under the organization", () => {
  const html = renderToStaticMarkup(createElement(OrgSidebar, {
    orgName: "Example",
    channels: [{ id: "c1", name: "administration", preview: "Parfait." }],
    directs: [{ id: "b1", name: "Ara" }],
  }));
  expect(html).toContain("Example");
  expect(html).toContain("administration");
  expect(html).toContain("Direct");
  expect(html).toContain("Ara");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/OrgSidebar.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`Sidebar.tsx` garde son roster quand `GET /api/org` est 404. Sinon il monte `OrgSidebar`. Cliquer un canal dispatch `select` avec l'id du groupe, le chemin déjà utilisé par `GroupListItem`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/OrgSidebar.test.ts src/components/SidebarBotListItem.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/OrgSidebar.tsx src/components/OrgSidebar.test.ts src/components/Sidebar.tsx
git commit -m "feat: switch the sidebar to organization channels"
```

### Task 9: Panneau des membres du canal

**Files:**
- Create: `src/components/ChannelMembers.tsx`
- Test: `src/components/ChannelMembers.test.ts`

**Interfaces:**
- Consumes: `canPlaceBot`, `canEditHumans` pour désactiver les contrôles, pas pour décider côté serveur
- Produces: `export function ChannelMembers(props: { humans: { id: string }[]; bots: { id: string; name: string }[]; canAddHuman: boolean; canAddBot: boolean })`

Si `canAddBot` est faux, aucun bouton d'ajout de bot. Si `canAddHuman` est faux, aucun bouton d'ajout de personne. Les deux listes sont rendues sous des titres `Gens` et `Bots`.

- [ ] **Step 1: Write the failing test**

```ts
it("hides add controls from a member who cannot edit", () => {
  const html = renderToStaticMarkup(createElement(ChannelMembers, {
    humans: [{ id: "morgan@example.test" }],
    bots: [{ id: "aurora", name: "Aurora" }],
    canAddHuman: false,
    canAddBot: false,
  }));
  expect(html).toContain("Aurora");
  expect(html).toContain("morgan@example.test");
  expect(html).not.toContain("Ajouter");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/ChannelMembers.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Le bouton `Ajouter` n'est rendu que pour la liste dont le booléen est vrai. Le clic appelle les routes de la tâche 5. Le composant lui-même reste présentatif dans le test.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/ChannelMembers.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ChannelMembers.tsx src/components/ChannelMembers.test.ts
git commit -m "feat: list channel humans and bots separately"
```

### Task 10: Destination d'un tour

**Files:**
- Create: `server/turn-route.ts`
- Test: `server/turn-route.test.ts`

**Interfaces:**
- Consumes: rien des tâches précédentes, à part le fait qu'un bot a maintenant un hôte
- Produces:
  - `export type BotHost = { kind: "fleet" } | { kind: "machine"; userId: string; deviceId: string }`
  - `export function turnDestination(input: { host: BotHost; workerOnline: boolean }): { kind: "fleet" } | { kind: "worker"; deviceId: string } | { kind: "queued" }`

`fleet` retourne toujours `{ kind: "fleet" }`, que `workerOnline` soit vrai ou faux. `machine` et `workerOnline: true` retourne `{ kind: "worker", deviceId }`. `machine` et `workerOnline: false` retourne `{ kind: "queued" }`. Jamais `{ kind: "fleet" }` dans ce dernier cas.

- [ ] **Step 1: Write the failing test**

```ts
it("queues a message when the chosen machine is offline", () => {
  expect(turnDestination({
    host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
    workerOnline: false,
  })).toEqual({ kind: "queued" });
});
it("keeps a fleet bot on the fleet host", () => {
  expect(turnDestination({ host: { kind: "fleet" }, workerOnline: false })).toEqual({ kind: "fleet" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/turn-route.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Fonction pure. Le champ bot `host` est ajouté au record avec défaut `{ kind: "fleet" }` pour tout bot déjà sur disque.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/turn-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/turn-route.ts server/turn-route.test.ts
git commit -m "feat: route a bot turn to its chosen host"
```

### Task 11: Worker enregistré et file d'attente

**Files:**
- Create: `server/workers.ts`
- Test: `server/workers.test.ts`

**Interfaces:**
- Consumes: `turnDestination`, `BotHost`
- Produces:
  - `export interface Worker { deviceId: string; userId: string; online: boolean }`
  - `export function registerWorker(workers: Worker[], worker: Worker): Worker[]`
  - `export function queueTurn(input: { destination: ReturnType<typeof turnDestination>; messageId: string; queued: string[] }): { queued: string[]; started: boolean }`

`registerWorker` remplace l'entrée de même `deviceId`. `queueTurn` avec `queued` destination ajoute `messageId` et `started: false`. Avec `fleet` ou `worker`, `started: true` et la file inchangée.

- [ ] **Step 1: Write the failing test**

```ts
it("does not start a turn for an offline machine", () => {
  const destination = turnDestination({
    host: { kind: "machine", userId: "morgan@example.test", deviceId: "laptop" },
    workerOnline: false,
  });
  expect(queueTurn({ destination, messageId: "m1", queued: [] })).toEqual({ queued: ["m1"], started: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/workers.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`POST /api/workers` body `{ deviceId }` enregistre le worker pour le `userId` de la session. Le démarrage de tour du canal appelle `turnDestination` puis `queueTurn`. Sur `started: false`, le message est déjà dans le transcript et le canal reçoit l'état `machine-offline`. Aucun appel au runner local dans cette branche.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/workers.test.ts server/turn-route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/workers.ts server/workers.test.ts
git commit -m "feat: queue channel turns while a worker is offline"
```

### Task 12: Approbation réservée au propriétaire

**Files:**
- Create: `server/approval-audience.ts`
- Test: `server/approval-audience.test.ts`
- Modify: le point qui émet la carte d'approbation d'un tour de canal (chercher `PendingApproval` côté serveur, le module qui notifie la session)

**Interfaces:**
- Consumes: `ownerUserId` du bot, `deviceId` du worker quand `host.kind === "machine"`
- Produces:
  - `export function approvalAudience(input: { ownerUserId: string; host: BotHost }): { userId: string; deviceId: string | null }`

`deviceId` est `null` pour `fleet` (la session du propriétaire sur l'hôte). Pour `machine`, c'est `host.deviceId`. Les `humanIds` du canal ne sont pas un paramètre: les autres membres ne sont pas une audience.

- [ ] **Step 1: Write the failing test**

```ts
it("sends the card to the owner session on the executing machine", () => {
  expect(approvalAudience({
    ownerUserId: "owner",
    host: { kind: "machine", userId: "owner", deviceId: "studio" },
  })).toEqual({ userId: "owner", deviceId: "studio" });
});
it("does not take channel members as an audience", () => {
  const audience = approvalAudience({ ownerUserId: "owner", host: { kind: "fleet" } });
  expect(audience.userId).toBe("owner");
  expect(Object.keys(audience)).toEqual(["userId", "deviceId"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/approval-audience.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Avant d'émettre la carte, filtrer les sessions dont `userId` n'est pas `audience.userId`. Pour un hôte `machine`, garder la session dont `deviceId` correspond. Le client des autres membres reçoit l'état `waiting-on-owner` et le nom du propriétaire, sans le payload d'approbation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/approval-audience.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/approval-audience.ts server/approval-audience.test.ts
git commit -m "feat: deliver channel approvals only to the bot owner"
```

### Task 13: Échecs de tour et rendu d'attente

**Files:**
- Modify: `server/workers.ts`
- Test: `server/workers.test.ts` (ajouter les cas)
- Create: `src/components/OwnerWait.tsx`
- Test: `src/components/OwnerWait.test.ts`

**Interfaces:**
- Consumes: `queueTurn`, `approvalAudience`
- Produces:
  - `export function failTurn(input: { queued: string[]; messageId: string; partial: string }): { queued: string[]; status: "failed"; partial: string }`
  - `export function OwnerWait({ ownerName }: { ownerName: string })`

`failTurn` retire `messageId` de la file, retourne `status: "failed"`, et renvoie `partial` tel quel. `OwnerWait` affiche `En attente de {ownerName}` et ne contient pas de bouton `Approuver`.

- [ ] **Step 1: Write the failing test**

```ts
it("keeps partial text and marks the turn failed when the worker drops", () => {
  expect(failTurn({ queued: ["m1"], messageId: "m1", partial: "début" })).toEqual({
    queued: [],
    status: "failed",
    partial: "début",
  });
});
```

```ts
it("shows the wait without an approve button", () => {
  const html = renderToStaticMarkup(createElement(OwnerWait, { ownerName: "Alex" }));
  expect(html).toContain("En attente de Alex");
  expect(html).not.toContain("Approuver");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run server/workers.test.ts src/components/OwnerWait.test.ts`
Expected: FAIL on `failTurn` and `OwnerWait`

- [ ] **Step 3: Write minimal implementation**

Quand le socket du worker se ferme pendant un tour, appeler `failTurn` et écrire le statut sur le message du canal. Retirer un humain de `humanIds` ou un bot de `memberIds` pendant un tour appelle la même fonction. `OwnerWait` est ce que le canal rend pour `waiting-on-owner`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run server/workers.test.ts server/turn-route.test.ts server/approval-audience.test.ts server/channel-membership.test.ts src/components/OwnerWait.test.ts src/components/OrgSidebar.test.ts src/components/OrgDirectory.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/workers.ts server/workers.test.ts src/components/OwnerWait.tsx src/components/OwnerWait.test.ts
git commit -m "feat: fail a dropped worker turn without approving it"
```

## Self-review

Couverture de la spec:

- Objets, rôles, invitation 7 jours, usage unique: tâches 1 à 3.
- Écran d'organisation au-dessus de la carte entreprise: tâche 4.
- `humanIds` / `memberIds` / refus `dm`: tâche 5.
- Visibilité canal et Direct: tâche 6.
- Accord direct: tâche 7.
- Colonne Discord, roster conservé sans org: tâche 8.
- Panneau gens et bots: tâche 9.
- Hôte `fleet` ou machine, pas de repli: tâches 10 et 11.
- Approbation propriétaire seulement: tâche 12.
- Worker coupé, texte gardé, attente sans bouton: tâche 13.
- Verrou `busyBotId`: non modifié, cité dans les contraintes. Le second message attend parce que le runner actuel ne démarre pas un second tour. Aucune tâche ne le réécrit.

Hors spec, donc hors tâches: copie du bot, approbation par un member, fusion de la connexion entreprise, redesign du panneau Computer.

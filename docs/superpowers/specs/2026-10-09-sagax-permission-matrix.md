# Sagax permission matrix (organization mode)

Date: 2026-10-09. Owner: Owner. Status: implemented in `feat/permission-matrix`
(Sagax) and `feat/sagax-permission-matrix` (Perspicax).

Owner: "I need to have a full permission matrix editor per profile on Perspicax
for Sagax. I keep getting 'Admin required' for things I should be able to
whitelist per user profiles."

## 1. The model

- Every "admin only" decision a person meets on a Sagax server linked to
  Perspicax is one named permission, a stable dotted key
  (`<group>.<name>`), listed once in `shared/permissions.ts`.
- Perspicax holds, per profile, which keys the profile grants (tri-state per
  key: granted, refused, or the catalogue's member default). A person's
  effective permissions are the union over the profiles they hold, computed
  by Perspicax and sent in the directory (`permissions` on each person). An
  organization admin holds every key.
- Sagax enforces them with one helper, `can(principal, key)`: the operator
  and an admin may everything; an `adminOnly` key is an admin's only; anyone
  else needs the key in their list.
- When Perspicax sends no list (an older Perspicax, a person it does not
  list yet, before it read the catalogue of this server), the person holds
  the **member defaults**: exactly what a plain member could do on
  2026-10-09 after PR #213 ("basic built-in tools never wait for an admin").
  Nothing regresses.
- The person sheet still narrows on top, whatever the profiles grant:
  `sagax_bots: use` takes every key about owning bots, `sagax_integrations:
  off` takes `apps.ownIntegrations` (and keeps pausing the person's own
  connections, as before).
- A refusal says which permission is missing:
  `403 { "error": "forbidden", "permission": "bots.approvalLevel", "message": "..." }`.
  The app words it "Your profile does not include <label>. Ask an admin to add
  it in Perspicax." instead of "Admin required".
- The session payload (`GET /api/config` `viewer.permissions`,
  `viewer.permissionsSource`) carries the effective keys; the app hides or
  disables what the profile does not include.

## 2. Audit: every gate that answered "admin required" (base `4d379d9a6`)

How a member is refused today, three layers:

1. **Route scope** (`server/request-auth.ts:304` `CLIENT_ALLOW`,
   `:597` `requiredScope`): every route not listed needs the `admin` scope;
   a member's session holds `client` only. Answer:
   `403 forbidden: this session lacks the admin scope`.
2. **Handler checks** on client routes: `orgAdminCaller`
   (`server/index.ts:21449`), owner checks, `memberBotFieldViolation`
   (bot fields), `computerOwner`, `botCreationAllowed`
   (`server/index.ts:21958`), the person sheet (`personBotsReadOnly`
   `:21967`, `integrationsLocked` `:22000`).
3. **Client**: `viewer.capabilities` (`shared/viewer-capabilities.ts:72`),
   `role === "member"` checks, `useOwnerOrAdmin`, and the strings that tell a
   member to ask an admin (`access.engineMissing.owner`,
   `bots.readOnly.notice`, `connectApps.skill.readOnlyOwner`,
   `groupPanel.folderAdminOnly`, `canViewUsage`, ...).

## 3. The catalogue (26 keys)

Default = what a plain member holds when Perspicax sends nothing (today's
behaviour). Gates are at base `4d379d9a6`; "route" means the admin-scope
route list `PERMISSION_ROUTES` (`server/request-auth.ts`) now opens it to a
person holding the key.

### bots (7)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `bots.create` | Create and own bots: create, bring from a solo Sagax, rename, instruct, change the model of, delete their bots | `server/index.ts:21958` `botCreationAllowed`, `:21967` `personBotsReadOnly` (POST /api/bots, /api/org/import, Browse Bots import `server/routes/bot-catalog.ts`, internal create-bot, team setup, delete) | yes | no |
| `bots.approvalLevel` | Choose Ask or Auto on their bots | `server/index.ts:30644` `memberBotFieldViolation` (`approvalMode`, `autoApprove`, `acknowledgeLocalAuto`) | no | no |
| `bots.fullAccess` | Turn on Full access on their bots (while the organization allows it) | `server/index.ts:21411` `orgFullAccessRefusalFor`, `:30638` `MEMBER_BOT_FULL_ACCESS` | yes | no |
| `bots.behaviour` | Change memory, voice notes and fallback of their bots | `server/index.ts:30644` (`memoryEnabled`, `memoryUpkeep`, `voiceNotes`, `fallback`, `parkDirectMessages`) | no | no |
| `bots.computer` | Choose where their bots work | `server/index.ts:30644` (`computer`, `cloudBackend`, `autoStartVps`, `browser`, `browserProfile`) | no | no |
| `bots.tools` | Choose the tools of their bots | `server/index.ts:30644` (`toolScope`, `mcpServers`, `composio`, `connectorTools`, `connectorScopes`, `outbound`, `peers`, `approvePeerComms`, `acknowledgePeerScope`) | no | no |
| `bots.catalogFeature` | Feature bots in Browse Bots | `server/routes/bot-catalog.ts:188` `catalog_feature_admin` | no | no |

A preset at creation (`server/index.ts:30193`) and the Primary Bot fields
stay outside the member's bot fields: no key opens them.

### sharing (2)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `sharing.grants` | Share their bots with people and teams | `server/bot-grants.ts:140`, `server/direct-grants.ts:95` (owner rule; `sagax_bots: use` refuses) | yes | no |
| `sharing.visibility` | Choose who sees their bots (visibility, sidebar section) | `server/index.ts:30193` (create), `:30644` (PATCH `visibility`, `section`) | no | no |

### engines (1)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `engines.manage` | Manage the server's engines: install, update, sign in, rename, refresh | route: `/api/instances/*` writes are admin scope (`server/index.ts:33817`); member view `:33596`; client `access.engineMissing.owner` (`src/components/AccessCard.tsx:56`) | no | no |

An engine's program path (`cli`) and Claude configuration folder
(`configDir`) stay `host.shell`, and so do `/api/cli-test` and
`/api/cli-candidates` (they run a program).

### apps (3)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `apps.ownIntegrations` | Manage their own plugins, skills and MCP servers | `server/index.ts:22000` `integrationsLocked` (`sagax_integrations`) | yes | no |
| `apps.serverPlugins` | Add plugins to the server | `server/routes/plugins.ts:85`, `server/index.ts:20810` (`computerOwner`) | no | no |
| `apps.marketplaces` | Manage plugin marketplaces | route `/api/marketplaces*` (admin scope), `server/routes/marketplaces.ts:43`, `server/index.ts:20691` | no | no |

On an organization server a plugin or marketplace never adds an MCP server
that runs a command on the host (it is skipped, as before); the server's own
MCP servers (`/api/mcp/servers`, `server/index.ts:33968`) are `host.shell`.

### skills (1)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `skills.library` | Change the skills library | route `/api/skills-library*` (admin scope); `server/index.ts:31435`; client `connectApps.skill.readOnlyOwner` (`src/components/PluginsPanel.tsx:416`) | no | no |

### folders (2)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `folders.botWorkingFolder` | Set the working folder of their bots | `server/index.ts:30193` (create), `:30644` (`cwd`) | no | no |
| `folders.roomWorkingFolder` | Set the working folder of their groups | `server/index.ts:29659` `clientGroupPatchViolation`; client `groupPanel.folderAdminOnly` (`src/components/GroupView.tsx:968`) | no | no |

### routines (4)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `routines.runAsAnyone` | Choose anyone a routine runs as | `server/index.ts:10939` (`admin: orgAdminCaller`), `server/routines/routine-run-as.ts:127` `run_as_not_allowed` | no | no |
| `routines.runNowAny` | Run any routine now | `server/index.ts:11003` `mayRunRoutineNow`, `:28098` `run_now_not_allowed` | no | no |
| `routines.viewTeam` | See their teams' routines (added 2026-10-09, routine scope) | new: `GET /api/routines?scope=team` and `DELETE /api/routine-runs?scope=team` (`server/routines/routine-scope.ts`, 403 `routine_scope_not_allowed`); client scope control "My teams" (`src/components/routines/RoutineScopeBar.tsx`) | no | no |
| `routines.viewAll` | See every routine of the organization (added 2026-10-09, routine scope) | new: `GET /api/routines?scope=all`, Clear logs over every run with `DELETE /api/routine-runs?scope=all`; client scope control "Everyone" | no | no |

Team managers keep reaching their teams' people (run as, labels) without a
key, as before.

The two view keys (2026-10-09, the owner: "give any user the possibility to view
the automation schedule at large; admins see all of them") are read side
only. `mine` (what the caller saw before: the routines of the bots and rooms
they see, by the private-threads rule) is always allowed; `team` adds the
routines whose bot owner or run-as person shares a team with the caller, or
whose bot is shared with one of the caller's teams; `all` is every routine.
An admin holds both. A routine outside `mine` comes without its
instructions, attachments, threads or run outputs (`redacted: true`), and
`canRun` / `canEdit` stay false unless the existing write gates
(`routines.runNowAny`, the bot's `run` level, the path visibility) already
let the caller act on it. Clear logs clears the caller's own runs, or every
run in scope with `routines.viewAll`. An older Perspicax that sends neither
key leaves everyone on `mine`, as before.

### people (3)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `people.labelAnyone` | Change anyone's label | `server/index.ts:21085`, `server/routes/person-labels.ts` `person_label_forbidden` | no | no |
| `people.activityLog` | Read the admin activity log | route `/api/admin-activity(.csv)` (admin scope, `server/index.ts:33513`); client `src/components/SettingsModal.tsx:1026` | no | no |
| `people.manage` | Manage other people | `server/org/org-person-connections.ts:139`, `server/interim-attach-routes.ts:76`, `server/org/org-bot-force.ts:50`, console routes `people/{principal}/*` | no | **yes** |

### usage (1)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `usage.view` | See usage and spend | route `/api/usage(.csv)` (admin scope, `server/routes/usage.ts:29`); `shared/viewer-capabilities.ts:72` `viewUsage`; client `src/lib/viewer.ts:63` `canViewUsage` | no | no |

### backup (1), host (1), server (2)

| Key | Label | Today's gate | Default | adminOnly |
|---|---|---|---|---|
| `backup.workspace` | Back up and restore the server | `/api/workspace-backup/*` (admin scope), `manageBackups` | no | **yes** |
| `host.shell` | Run commands on the server | `server/engine-access.ts:136` `memberBotAdminApproval` (a member bot's host-level tools wait for an admin), `server/index.ts:7838` (answering those cards), `:30495` command rules, `:30531` always-allow, `/api/mcp/servers*` `:33968`, engine `cli`/`configDir`, `/api/cli-test`, installation computers (`/api/computers/*` `:33029`, `/api/local-computer*`) | no | **yes** |
| `server.settings` | Change the server's settings | every other admin-scope route: `PUT /api/config`, keys, mail (`server/mail/mail-routes.ts:94`), webhooks (`server/index.ts:28261`), `PATCH /api/org/settings` (`server/perspicax-org-routes.ts:209`), budgets | no | **yes** |
| `server.link` | Link the server | the link file, sign-in list, invites, interim attach window | no | **yes** |

### Summary

| Group | Keys | Member default | adminOnly |
|---|---|---|---|
| bots | 7 | `bots.create`, `bots.fullAccess` | none |
| sharing | 2 | `sharing.grants` | none |
| engines | 1 | none | none |
| apps | 3 | `apps.ownIntegrations` | none |
| skills | 1 | none | none |
| folders | 2 | none | none |
| routines | 4 | none | none |
| people | 3 | none | `people.manage` |
| usage | 1 | none | none |
| backup | 1 | none | `backup.workspace` |
| host | 1 | none | `host.shell` |
| server | 2 | none | `server.settings`, `server.link` |
| **total** | **28** (plus 5 `clients` keys) | 4 keys | 5 keys |

## 4. Why each adminOnly key stays hard-coded

Five keys, each a real security boundary; no profile grants them, whatever
Perspicax sends (Sagax drops them from a non-admin's list):

- `host.shell`: runs programs on the server's own machine, outside the
  person's sandbox: a member bot's server-level commands (PR #213 kept them
  for an admin), saved command rules, the server's own MCP servers (a stdio
  server is a command), an engine's program path, the installation's
  computers. One grant would be a shell on the host for everyone the
  profile reaches.
- `people.manage`: reaches other people's accounts and data (disable, reset
  access, revoke connections, attach interim people, force on their bots).
- `backup.workspace`: a backup holds everyone's conversations and files; a
  restore replaces them.
- `server.settings`: security and payment settings for everyone
  (configuration, keys, mail, webhooks, the organization's Full access and
  marketplace policies).
- `server.link`: decides who can reach the server at all.

The console's own routes (`/api/org/admin/*`, Perspicax role checks) are
unchanged: they are Perspicax admin and manager tools, not Sagax member
permissions.

## 5. Contract with Perspicax

- `GET /api/org/admin/capabilities` (`api: 3`) adds `permissionsVersion`,
  `permissionGroups` and `permissions` (the catalogue rows with English and
  French labels, descriptions, `memberDefault`, `adminOnly`,
  `adminOnlyReason`). Perspicax reads and caches it per linked server.
- Directory (`GET /api/v1/pulsabot/directory`): each person may carry
  `permissions: string[] | null` (effective keys; every key for an admin;
  absent or null: Sagax uses the member defaults); each profile may carry
  `sagax_permissions: string[] | null` (what it grants, for display). Unknown
  keys are ignored with one log line each, never fatal.
- `GET /api/org/admin/people/{principal}` adds
  `permissions: { source, effective, narrowedBy }`.

## 6. Enforcement in Sagax

- `shared/permissions.ts`: the catalogue, `can`, `normalizePermissions`,
  `BOT_FIELD_PERMISSIONS`, `permissionRefusal`, `permissionCatalogue`.
- `server/org/org-permissions.ts`: `effectivePermissions` (admin, Perspicax
  list or defaults, person sheet narrowing).
- `server/perspicax-link.ts`: the directory schema and `permissionsOf`.
- `server/request-auth.ts`: `PERMISSION_ROUTES` and `routePermission`; the
  gate asks `permits(session, key)` before refusing an admin-scope route.
- `server/index.ts`: `principalPermissions`, `callerPermissions`,
  `callerCan`, `sessionPermits`, and each gate of section 3.
- App: `src/lib/viewer.ts` `viewerCan`, `src/lib/permissions.ts`
  (`permissionMissingText`, the `api()` error mapping in
  `src/state/store.tsx`), bot fields (`src/lib/bot-capabilities.ts`), group
  folder, skills library, engines settings, sharing, run now, activity log,
  Browse Bots feature.

## 7. Tests

- `shared/permissions.test.ts`: catalogue invariants, `can`, normalization.
- `server/org/org-permissions.test.ts`: effective permissions.
- `server/request-auth.test.ts`: permission routes and the gate.
- `server/perspicax-link.test.ts`: the directory field.
- `server/org/org-admin-routes.test.ts`, `server/org/org-admin-console.e2e.test.ts`:
  catalogue in capabilities, person permissions.
- `server/org/org-permissions.e2e.test.ts` (PM-1 to PM-5): defaults, a route gate
  (`usage.view`), field gates (`bots.approvalLevel`,
  `folders.botWorkingFolder`), `bots.create` and `sharing.grants`,
  `engines.manage` without `host.shell`, stray keys ignored; member without
  the key gets 403 with the key, member with it passes, admin passes.

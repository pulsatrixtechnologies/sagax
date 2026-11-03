# Tool policy (securable tool layer)

Every HTTP route the server answers has one row in `server/tool-policy.generated.ts`. The types and the matcher are in `server/tools/tool-policy.ts`.

| field | meaning |
|---|---|
| `method`, `kind`, `route` | The guard the handler matches: an exact path, a prefix or a regex source, and its method (`ANY` when the handler has no method guard). |
| `tier` | `read`, `write` or `admin`. |
| `readOnly` | `true` only for a GET that deletes nothing. |
| `scope` | `<area>:<tier>`, the grant a caller needs. |
| `defaultEnabled` | Whether agent tools may use the route without a grant that names it. It is never `true` for admin. |
| `destructive`, `billing` | Billing stays admin. Destructive rows are admin except the personal provider routes below. |

Default classification (`classifyRoute`):
- **read:** GET.
- **admin:** DELETE, a deletion verb (`delete`, `remove`, `wipe`, `purge`, `reset`, `revoke`, `archive`), org, admin, billing, usage, fleet, engines, keys, credentials, roles, members, import and export.
- **write:** everything else, including a route with no method guard.

The personal provider routes (`/api/me/providers` and the older
`/api/me/voice-keys` alias) are the person's own environment. Their handlers
derive the owner from authentication and never accept another person's id.
Their reads and writes, including removing their key or endpoint, are enabled
without an admin grant. The normal approval rules still apply to bot writes.

A request that matches no row is treated as **write**, off by default (`UNKNOWN_ROUTE_POLICY`).

## Adding a route

`scripts/tool-policy/tool-policy-coverage.test.ts` fails when a route has no row, and when a row's route is gone. It runs in the vitest shards (`vite.config.ts` includes `scripts/**/*.test.ts`). To fix it:

1. Run `node scripts/tool-policy/generate.ts`. Reviewed rows are kept; new routes get the default classification.
2. Review the new rows (tier, scope, defaultEnabled) and commit them.

The route list comes from the server sources (`scripts/tool-policy/route-inventory.ts`). Sagax routes are code, not a registry. `server/auth/request-auth.ts` is left out because its path rules are the auth gate, not routes.

Status: B1 declares the policy only and nothing enforces it yet. B2 adds grants and the guard (docs/agent-api.md).

## Grants and the guard (B2)

`server/tools/tool-grants.ts` stores grants in `<data>/tool-grants.json`. Each grant has a subject (a bot or a user), a scope, who granted it, an optional expiry and a revocation. A grant at a higher tier covers the lower tiers of the same area.

`server/tools/tool-guard.ts` makes one decision per agent tool call:

1. A default-enabled read or write is allowed.
2. Anything else needs a grant for the caller.
3. A bot's call also needs a grant for the person its turn speaks for, so a bot never reaches past its speaker.

Writes still raise the approval card. The decision is recorded on every agent-api audit row as `guard`, `guardAllow`, `guardMode`, `scope` and `readOnly`.

`SAGAX_TOOL_GUARD` sets the mode:
- `shadow` (default): audits the decision and changes nothing.
- `enforce`: refuses with `not_granted`.
- `off`: skips the guard.

In shadow mode the audit shows what enforcing would refuse. Today that is `create_agent`, which is admin tier and has no grants yet.

## Grants routes (B3a)
Admin scope only (gate + handler). Policy rows are `tool-grants:admin`, never default-enabled, so no agent tool can grant itself anything.
- `GET /api/tool-grants[?kind=bot|user&id=…]`: every row (active, expired, revoked) with `state`.
- `POST /api/tool-grants` `{subject:{kind,id}, scope:"<area>:<tier>", expiresAt?}`: a bot must exist; admin-tier grants need an expiry within 30 days.
- `POST /api/tool-grants/<id>/revoke`: keeps the row. Both writes go to the admin activity log (category `rights`).

Per bot (2026-10-15, the bot editor's Permissions page; `server/routes/bot-runtime-settings.ts`): the bot's owner (with `bots.tools` on an organization server) or an admin.
- `GET /api/bots/<id>/tool-grants`: that bot's rows only, with `state` and `mayGrantAdmin`.
- `POST /api/bots/<id>/tool-grants` `{scope, expiresAt?}`: the subject is the bot in the path. 2026-10-26: the owner grants every tier, admin included, for a scope that stays in their own environment; a scope whose area reaches past it (`shared/grant-reach.ts` `ORG_REACH_AREAS`: org, members, people, teams, admin, config, engines, keys, workers, fleet, billing, usage, tool-grants...) stays an admin's (403 `org_scope_admin_only`). An admin-tier grant ends within 30 days. The GET answers `mayGrantAdmin: true` and, for a member, `adminOnlyAreas`.
- `POST /api/bots/<id>/tool-grants/<grantId>/revoke`: only a grant of that bot (another bot's or a person's is 404). Both writes are audited as above.
Their policy rows are `tool-grants:admin`, never default-enabled. An admin still reviews every person's grants in Settings > General > Advanced ("People's tool access", shown only when some exist).

A person's own grants (2026-10-26, `server/routes/my-tool-grants.ts`, Settings > "Mes accès aux outils"): the subject is always the signed-in person (`{kind: "user", id: <their principal>}`), the grant the guard checks as the speaker of their bots' turns.
- `GET /api/me/tool-grants`: their rows with `state`, `mayGrantAdmin` and `adminOnlyAreas`.
- `POST /api/me/tool-grants` `{scope, expiresAt?}`: no admin needed for a scope of their own environment, any tier; past it, 403 `org_scope_admin_only` (an admin keeps `/api/tool-grants`). An admin-tier grant ends within 30 days.
- `POST /api/me/tool-grants/<id>/revoke`: their own grant only (anyone else's, or a bot's, is 404).
No person (a local service, a bot's act session, an AI client): 403. Policy rows `tool-grants:admin`, never default-enabled, so no agent grants itself or its speaker anything. Every write goes to the admin activity log (category `rights`).

The guard's mode stays `shadow` by default. The Journal (Approvals > Journal, `docs/approval-levels.md`) shows each agent tool call with the guard's verdict, including what enforcing would refuse.

## B2.1: guard before the card
An `agents__<tool>` (or `mcp__agents__<tool>`) permission request is checked before the card or Full access answers it: the bot's grant, then the grant of the person its turn speaks for. Audit rows (`agents.<tool>`, admin activity): `card` (pre_card, with guard decision and `speakerPrincipalId`), then `declined`/`expired` when nobody approves; an approved call is audited by the call itself (now with `speakerPrincipalId`). Enforce: `refused` and denied without a card. Shadow (default): recorded only.

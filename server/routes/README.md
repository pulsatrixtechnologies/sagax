# server/routes

New HTTP routes go here as modules. Do not add route `if` blocks to `server/index.ts`.
`scripts/testing/index-route-ratchet.test.ts` fails when `index.ts` gains a path guard. When you move a route out,
lower its number in that test.

- A route module exports a factory with explicit dependencies, `createXRoutes(deps): RouteHandler`
  (same shape as `server/backup/workspace-backup-http.ts`). It never imports `server/index.ts`.
- `index.ts` builds it next to its other wiring (one import, one `ROUTES.push(createXRoutes({...}))`);
  a module that needs no dependencies is listed in `ROUTES` in `table.ts` directly.
- A handler returns `PASS` when the request is not its own; returning anything else means it answered.
  Inside one module, keep a literal path ahead of a pattern that would also match it.
- Authenticated handlers register in `ROUTES` and run right after the auth gate.
  Public / pre-gate handlers register in `PRE_AUTH_ROUTES` (before `resolveRequestAuth`) or
  `PRE_AUTH_AFTER_RESOLVE` (after resolve, before the session refusal). Pre-auth `auth` may be null.
- Scope rules stay keyed by path in `server/auth/request-auth.ts`.
- `RouteContext` carries `req`, `res`, `url`, `path`, `method`, `auth`, `json`, `readBody`; the rest is `deps`.
- Type-only imports must be `import type` (or an inline `type`): the server runs on type stripping, so
  a bare type import passes `tsc` and crashes at boot.

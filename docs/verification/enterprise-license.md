# Edition loading

This distribution does not include the source-available `enterprise/`
directory, and Sagax needs no license key. With that directory absent,
`server/enterprise.ts` reports `{"edition":"oss"}` with every gated feature
on: `admin` (Settings → Installations), `billing` (sell prices),
`budgets` (the monthly spend limit) and `whitelabel` (`brand.json`). A key set
anyway unlocks nothing more.

## Sub-features

- A checkout, npm package, Docker image, and packaged desktop ship without
  `enterprise/`. `SAGAX_ENTERPRISE_DIR`, when set, is the only place looked at,
  and a missing directory stays the open-source edition.
- A feature is never a permission: the request's scope and the route's own
  checks still decide who may use it (a chat-only device gets 403 from
  `/api/fleet`).
- The seam stays for a layer installed from outside this tree. A present layer
  alone decides the features: what its key grants, and none while it grants
  nothing (no key, a refused key, a broken layer, or past the grace period).
  The hosted workspace features (portal membership, hosted Slack,
  shared-workspace Full access) need that layer's bridge and its own `admin`
  grant; the open-source edition's `admin` never stands in for it.
- With a layer, from 30 days before its key expires: `expiresInDays` on
  `/api/edition` and a warning in the startup log. The dates reach admin
  sessions only: a member's `/api/edition` leaves out `expiresInDays`,
  `graceEndsAt` and the notice, and the config the app reads carries no date.
  The app shows no license notice.
- For 7 days after it expires the layer's features keep working, with a
  notice and `graceEndsAt` on `/api/edition`. Then they stop, without a
  restart. The key format and signature check are the layer's.

## Driving it

```sh
pnpm exec vitest run server/enterprise.test.ts server/brand.test.ts server/spend.test.ts
pnpm exec vitest run server/license-expiry-api.test.ts
```

`server/enterprise.test.ts` checks the open-source edition when the directory
is absent, including a key that was set anyway, and loads temporary stand-in
`register()` layers to prove the seam: grants, refusals, expiry, and a bridge
that never runs on the open-source edition's features. It does not vendor the
removed layer. `server/brand.test.ts` and `server/spend.test.ts` apply a
`brand.json` and enforce a cap with the default gate, no layer and no key.
`server/license-expiry-api.test.ts` boots the fixture with no layer, then with
a stand-in layer whose key expires soon, is in its grace period, or is far
from expiry. `server/index.test.ts` ("opens Installations on the open-source
edition") checks `/api/fleet` on a running server for the owner and for a
chat-only device. The Docker and open-source CI jobs boot with a non-genuine
key and expect `edition: oss` plus `no enterprise layer exists`.

## Gotchas

- Run on 2026-11-01 for the open-source edition with every feature on, and on
  2026-09-23 for the layer's key expiry, against disposable fixtures only:
  stand-in layers, throwaway keys and a temporary home. No real license key,
  hosted tenant or cloud Admin was involved; this is not production
  qualification.
- The cloud Admin's own license check (`verifyLicenseKey` called directly) has
  no grace period; only the OMB server's `register()` path does.

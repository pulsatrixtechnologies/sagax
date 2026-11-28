# Fixture phone session (M-1 to M-4)

Issue [#5534](https://github.com/pulsatrixtechnologies/sagax/issues/5534)
covers the mobile conversation path of parent
[#2643](https://github.com/pulsatrixtechnologies/sagax/issues/2643) on a
**simulated** phone session. Slot A of
[owner-device-runs.md](owner-device-runs.md) stays the owner's real device;
this recipe is the local automation that proves the same four sub-cases
through pairing, companion headers, the fake engine and SSE, without a
phone, a carrier or a person's data.

Related surfaces: [phone-web-app.md](phone-web-app.md),
[chat-ui.md](chat-ui.md), [ios-local-vm.md](ios-local-vm.md),
[approval-notifications.md](approval-notifications.md),
[routines.md](routines.md).

## Command

```sh
node --experimental-strip-types scripts/qa/fixture-phone-session.ts
pnpm exec vitest run scripts/qa/fixture-phone-session.test.ts
```

Optional report path:

```sh
node --experimental-strip-types scripts/qa/fixture-phone-session.ts \
  --out /tmp/fixture-phone-session.json
```

The harness starts `launchVerificationServer` (fake Claude only, disposable
home and ports), opens `POST /api/auth/pairing` then `POST /api/auth/pair`,
and drives every phone call with:

- `Authorization: Bearer <token>`
- `x-openmausbot-companion: 1`
- `x-openmausbot-companion-device: fixture-phone`

It writes a JSON report under tmp (or `--out`), prints a short summary, and
exits non-zero when any sub-case fails. Ctrl-C is not required: the fixture
closes itself.

## What each sub-case proves

| Sub-case | Local proof |
| --- | --- |
| M-1 | Phone session sends one request and receives exactly one complete fake-engine reply; no loss, no duplicate. |
| M-2 | Scripted `ask_choice` card; the phone answers the chosen option (respond or card settle), never as free text alone. |
| M-3 | A person-started routine with `postResults` completes; the SSE `done` notification names the main chat (`resultsThreadId`) and that thread holds the `routine.run` receipt for the run, not the hidden execution thread. |
| M-4 | A long scripted reply is present in the phone thread payload, is the newest row (anchor), and carries its `https://example.test/...` link. No real scroll UI. |

## What this does not prove

- Physical install, banners, touch targets or screen size: those stay Slot A
  on the owner's device ([owner-device-runs.md](owner-device-runs.md)).
- APNs, Notification Service Extension, or Watch layout
  ([approval-notifications.md](approval-notifications.md)).
- A real provider account, inbox, desktop or network beyond loopback.

## Evidence

The report JSON keeps fixture URL, data directory, log path, device id and
per-case `ok` / `detail` / `evidence`. Pairing tokens stay out of the report.
The Vitest file fails when any sub-case fails, so a regression cannot quiet
the schedule row.

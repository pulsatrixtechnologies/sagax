# Credential order

Status: in force. Sagax #5180. The four forms each serve every aspect in
the map `shared/credential-matrix.ts` (`docs/credential-matrix.md`).

## The four forms

- Personal account: the person's own subscription sign-in.
- Organization account: the organization's Grok sign-in (`org-account`, #5200).
- Personal API key: a key that belongs to the person.
- Organization API key: a key that belongs to the organization.

## Order

One idea. Each resolver writes it. This file does not sort candidates.

1. Explicit pick, when the person named an account or a key for this turn.
2. Personal account.
3. Personal API key.
4. Organization account.
5. Organization API key.

Engines (`resolveEngineAccess`, `server/engines/engine-credentials.ts`):
the payer's subscription, then the payer's key, then `org-account` on a
Grok engine, then `org-key`.

Voice, realtime, speech, and a phone line (`resolveVoiceKeys`,
`server/voice/voice-mode.ts`): the connected Grok account, the person's
voice key, the person's Perspicax key, the organization account, the
organization key. A phone line (`phoneLine`) keeps that full list for the
line's owner, so a dead account falls back onto that person's own keys
and then the organization (D-20261127-029). The in-app voice still asks
before it spends a paid key.

Images (`chatImageCredentials`, `server/media/chat-image.ts`): the same
account-then-key order at each level.

`shared/credential-resolver.ts` applies policy on top of the caller's
order. It does not sort candidates.

## Policy that is in force

These are decided and implemented. They are not a second order:

- Act as may use a personal account or a personal API key only when that
  person turned the consent on. The default is off. Otherwise the turn is
  refused with a clear error, unless an organization form can serve.
- A fallback from one account or subscription onto another proceeds.
  A fallback onto a paid API key (personal or organization) waits for a
  confirmation the turn can show and `POST /api/me/credential-confirm` can
  answer. A phone line has no confirm step, so it keeps the keys in the
  list instead of waiting.
- Personal API keys inside an organization are on unless an admin turns
  them off.

## One map, not a second resolver

The organization account is a source the engines, the voice, images and
account connectors already read. Do not add another order beside the
functions named above. Live surfaces stay where they are: turn access for
text, `GET /api/bots/<id>/voice/status` for voice. The matrix is the one
place that says which form serves which aspect.

# PROPOSED: one credential order

Status: **PROPOSED**. Awaiting owner approval. This document does not change
the order the server uses today.

Sagax #5180 asked for one order across the four credential forms. The owner
(JC, 2026-11-22) said not to change the runtime order yet, and to write the
merged rule here first.

## The four forms

- Personal account: the person's own subscription sign-in.
- Organization account: an organization subscription sign-in.
- Personal API key: a key that belongs to the person.
- Organization API key: a key that belongs to the organization.

Each form is allowed to serve chat, engines (Claude, pi, OpenCode), connectors,
and voice. No form is reserved for one aspect.

## Proposed order

One list, first match wins. This merges the order Sagax already uses with
Perspicax #2012:

1. Explicit pick. The person named the account or the key for this turn.
2. Personal account.
3. Personal API key.
4. Organization or team key.

At organization scale the same idea is: the organization account, then the
organization key. Where that account sits beside the personal forms is part
of this proposal and is not decided here.

## What the server does today

The runtime order is unchanged. Engines still resolve in
`server/engines/engine-credentials.ts`: the payer's subscription, then the
payer's key, then the organization key. Voice still resolves in
`server/voice/voice-mode.ts`: the connected Grok account, then the person's
voice key, then the person's Perspicax key, then the organization key.
Account-to-account choice stays in `server/usage/account-switch-host.ts`
(#5014, #5031). This proposal does not replace that ranking.

`shared/credential-resolver.ts` applies policy on top of whatever order the
caller already passed. It does not sort candidates.

## Policy that is in force

These are decided and implemented. They are not part of the order proposal:

- Act as may use a personal account or a personal API key only when that
  person turned the consent on. The default is off. Otherwise the turn is
  refused with a clear error, unless an organization form can serve.
- A fallback from one account or subscription onto another proceeds.
  A fallback onto a paid API key (personal or organization) waits for a
  confirmation the turn can show and `POST /api/me/credential-confirm` can
  answer.
- Personal API keys inside an organization are on unless an admin turns
  them off.

## Not in this change

An organization account sign-in is not a source the engines read today (the
server's own sign-in was retired). Adding that source would change which
form wins, so it waits with this order.

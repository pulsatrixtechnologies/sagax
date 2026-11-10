# Connector live check, at each release

Issue #3355, lot L12 of #3286 (a bot on any engine calls any connector of the
person). Design: `docs/design/connectors-across-engines.md`, section 6.4. The
connector matrix (`pnpm test:connector-matrix`) proves the same outcomes on
fakes at every pull request; this check proves them once per release on real
sign-ins and real engines, in about five minutes.

Script: `scripts/verify/release/connectors-live.mjs`.

## What it does

It drives the server the way the QA person does, through the server's own API
as that person: for each QA bot and each provider it opens a fresh
conversation at Ask, sends

> List your connectors. Then read `<read>` through `<connector>` and answer
> with the first item.

and reads the thread's events until the turn ends. A cell is green when the
thread holds one call to that connector (a `call_connector` row through the
hub, or the engine's own native row where the engine mounts the connector,
marked "native"), the call answered a result that is not empty, no approval
card was shown, and the account the call went through is the one the plan
names. The time is from the message to the end of the turn.

Once per provider it then sends `Send <send> through <connector>.` in a fresh
conversation at Ask. The cell is green when the card was shown, the script
answered Deny, and the call's row says it did not run.

Every call, card and refusal stays in the QA bot's own chat, as for any turn:
the check opens its conversations there, titled "Connector live check".

The person's settings decide, as always: the check adds no rule and changes
no level of the bot; each conversation it opens is at Ask, the level the
design checks. Pick a send whose target is the QA person's own address: an
Always allow or Full access rule the person saved for that connector answers
without a card, the cell then turns red ("no card was shown"), and the send
has run.

## Before

- One QA person with Claude and Grok signed in, and ChatGPT through Codex,
  each with one harmless connector that has a read tool.
- One QA bot per engine family, owned by that person: Claude, Grok CLI,
  Codex, one API engine, and pi or a local model.
- That person's paired session token in `SAGAX_LIVE_TOKEN` (sent as a bearer,
  never printed). A self-hosted server on this machine needs none.

## The plan

A JSON file, kept outside the repository (it names the QA person's
connectors):

```json
{
  "bots": [
    { "name": "QA Claude", "engine": "Claude" },
    { "name": "QA Grok", "engine": "Grok CLI" },
    { "name": "QA Codex", "engine": "Codex" },
    { "name": "QA API", "engine": "API engine" },
    { "name": "QA Local", "engine": "pi" }
  ],
  "providers": [
    { "provider": "claude-ai", "label": "claude.ai", "connector": "<a connector>", "account": "Claude",
      "read": "<a fixed harmless thing>", "send": "<a send to the QA person's own address>" },
    { "provider": "grok-com", "label": "grok.com", "connector": "<a connector>", "account": "Grok (personal account)",
      "read": "<a fixed harmless thing>", "send": "<a send to the QA person's own address>" },
    { "provider": "chatgpt-apps", "label": "ChatGPT apps", "connector": "<a connector>",
      "read": "<a fixed harmless thing>", "send": "<a send to the QA person's own address>" }
  ],
  "timeoutMs": 180000
}
```

`name` is the bot's name or id. `engine` is the row's label (default: the
bot's engine instance). `account` is optional: when given, a call through the
hub must name that account. `send` is optional per provider, and `sendBot`
picks the bot that sends (default: the first bot).

## Run

```sh
SAGAX_LIVE_TOKEN=... node scripts/verify/release/connectors-live.mjs \
  --plan ~/qa/connectors-live.json --server <origin> \
  --doc --notes docs/releases/X.Y.Z.md --issue-repo <owner>/<repo>
```

- `--doc` writes the grid below, between the markers.
- `--notes` writes it into the release notes, between the same markers.
- `--out <file>` writes it to a file of its own.
- `--issue-repo` opens one issue with the grid when a cell is red.
- The exit code is 0 when every cell is green, 1 when one is red (the release
  announcement waits for the fix), 2 when the check could not run.

`--fake` runs the same check against a local server on the fake engines
(Claude, Grok CLI through the ACP fake, Codex, an OpenAI compatible engine on
a local stub) and the test connector host, with no account. It is the proof of
the script itself, run beside the matrix:
`scripts/verify/release/connectors-live.test.ts` is in
`pnpm test:connector-matrix`. It also checks that a denied send never reached
the host.

Between releases, the server's own counters per engine and provider (part P7
of the design) show a break the day it lands.

## Last run

<!-- connectors-live:begin -->
Not run on real sign-ins yet: the first release after L12 writes its grid here.
<!-- connectors-live:end -->

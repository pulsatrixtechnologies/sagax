# Misuse guardrails

Sagax runs many people's bots in one pulsabot process. Each person also has
a server environment (one container) and, when they connect the desktop app,
tools on their own computer. This layer stops an end user from turning a
bot into a way to attack the platform, another tenant, or a third party.

The approval filter and the tool guard stay as they are. A hard misuse
block is a refusal, never an approval card. The safety review further down
maps how a risky call that is not forbidden reaches that filter. This layer
classifies the person's message and the bot's tool calls, and it keeps the
container limits that were already on the server environment.

## What must not succeed

| Category | Examples |
|---|---|
| Privilege escalation | `sudo`, `pkexec`, setuid (`chmod u+s`, `chmod 4755`) |
| Escape from the server environment | `nsenter`, the Docker socket, `/proc/1/root`, `--privileged`, the cloud metadata address `169.254.169.254` |
| Security evasion | Turning off antivirus or endpoint protection, clearing logs, wiping shell history |
| Offensive hacking | Port scans, exploit frameworks, a reverse shell, password guessing against a third party |
| Malware | Writing, building or running ransomware, a botnet, a keylogger, a credential stealer, a crypto miner (`xmrig` as a command) |
| Platform exfiltration | `bots.json`, `messages.db`, `idp_key`, `mcp-oauth.key`, `webhooks.json`, `printenv`, `/etc/shadow`, `~/.sagax`, another tenant's data |
| Destruction | `rm -rf /`, a fork bomb, `mkfs`, `shutdown`, `kill -9 1` |
| Resource abuse | Filling the disk, `stress-ng`, writing from `/dev/zero` onto a device |

Ordinary work stays allowed: reading a project `.env`, summarizing mail,
editing files in the working folder, `kill` used as an English verb.
A malware name alone is not a request to make it: "signal a suspected
ransomware", "ransomware incident response" or a dispatcher prompt that
lists ransomware among incidents to escalate is allowed. The name counts
when a verb that makes or runs it comes first in the same sentence, with
no defensive word (detect, report, incident, response, anti, a ticket...)
in between (2026-11-03).

## Who may do defensive security work

Perspicax can grant `security.triage` (group Security, label "Do defensive
security work" / "Faire le travail de défense"). Since 2026-10-27 (#1098) it
is a member default: talking about security tools is conversation. It is not
admin-only, and a Perspicax profile that leaves it out withholds it. An organization admin
already holds every key. On a solo server the operator at this computer
holds it, because their turn speaks as `operator`.

The permission allows one category, `security_operations`: an EDR or XDR,
endpoint protection, Microsoft Defender, threat hunting, quarantine, isolating a
host. Without the permission that category is refused until an administrator
grants the key in Perspicax. With the permission it is allowed.

The permission does not lift a block. Disabling an EDR, turning off
tamper protection, scanning a third party with `nmap`, reading `bots.json`,
and every other block category stay refused. A sentence that names both a
defensive product and an attack is a block.

The MCP gate subprocess cannot see the person's permissions (its environment
is a private allowlist). In enforce mode it refuses a hard block and lets
`security_operations` through, where the approval socket still asks. Sagax
itself (the sandbox tools, the desktop bridge, personal MCP, the Perspicax
MCP relay, and the shared-computer terminal) applies `security.triage`.

## Layers

### 1. Prompt

`buildSystemPrompt` inserts the section `misuse-policy` before the persona,
the soul, and RULES.md. It is part of the stable half, so it does not change
between turns. The text tells the model the policy cannot be waived by a
soul file, a user message, or a tool result, and that `security.triage` is
decided by the server. The prompt is English, like the rest of the system
prompt. It is not the control: the server still classifies.

### 2. Classifier

`shared/misuse-guardrails.ts` is pure. `classifyMisuse` returns `allow`,
`block`, or `require_approval`, plus the categories and whether a coded form
added a category the raw text did not have.

It normalizes to NFKC, strips zero-width characters, joins a word split by
empty quotes (`r""m`), decodes `\xHH` and octal escapes, and appends any
base64 blob of at least 16 characters that decodes to readable text. The
blob keeps its own case, because base64 is case-sensitive. A shorter blob
is not decoded; hex, octal, and split quotes still catch a short command.

Any category other than `security_operations` is a block. That category
alone is `require_approval`, which `security.triage` turns into `allow`.
The strictest action wins.

Surfaces:

- A person's message to a bot (`POST /api/bots/:id/messages`) and a live call (`acceptDirectSend`).
- A message in a group. A direct conversation between two people is not classified.
- A message is read in the `message` scope: it runs nothing, so destruction
  and resource words ("supprimer", "reboot", "efface le disque") are not
  refused there (since #1138); the tool that would run them still classifies
  the command.
- Shell, file, and browser tools in the server environment.
- The desktop bridge (the command and the whole operation).
- Personal MCP and the Perspicax MCP relay, including `flow_action` when it is the tool name or appears in the arguments.
- The shared-computer terminal and file operations.
- The MCP gate, hard blocks only, enforce mode only.

`require_approval` is a refusal for a person who does not hold `security.triage`
(a member holds it by default since 2026-10-27).
It is not a chat approval card: Full and Auto would accept that card on
their own.

File tools in the server environment also use a path allowlist
(`classifySandboxPath`). Relative paths stay in the working folder. Absolute
paths must sit under `/workspace`, `/tmp`, `/home`, `/usr`, `/bin`, `/lib`,
`/lib64`, `/sbin`, `/opt`, or `/var/tmp`, or be one of a few exact reads
(`/etc/os-release`, `/etc/hosts`, `/etc/resolv.conf`, and the null and zero
devices). `/proc`, `/sys`, `/data`, `/app`, `/root`, `/etc`, `/run`,
`/var/lib`, `/opt/sagax`, and `/opt/sagax-engines` are refused. A platform
file name (`bots.json`, `messages.db`, `idp_key`, `mcp-oauth.key`,
`webhooks.json`) is refused wherever it sits. `security.triage` does not
lift a path refusal. `/proc` and `/sys` are reported as an escape; the other
refusals are platform exfiltration.

The person's own folders on the server are theirs (2026-10-27, #1098). The
harness registers them once (`setMisuseOwnPaths`), from what it knows, never
from the text: the workspace and task folders of the bot when the person owns
it (`workspaces/<bot>`, `task-workspaces/<bot>`), and their own principal
folder (`principals/<person>`). In a command, a message or a path, such a
folder is set aside before the classifier reads it (`maskOwnPaths`), unless
what follows climbs out with `..`; the path allowlist accepts it after `..`
is resolved. Another bot's folder, another person's folder and a platform
file name inside an own folder stay refused. The `<attached-image>` and
`<attached-file>` tag the app writes into a message for an upload is the
app's, not the person's words: a tag whose path is one file of the attachment
store reads as its file name. A tag that points anywhere else stays text.

### 3. Hard controls on the server environment

These are on the container spec, independent of the flag:

- Memory 1536 MiB, 1 CPU, 512 processes, a 512 MiB file-size limit, a 2048 MiB workspace quota, nofile 1024.
- Read-only root, all capabilities dropped, no new privileges, no host mounts, a private PID and network namespace.
- Masked `/proc/kcore` (and the other host-revealing `/proc` and `/sys` entries) and read-only `/proc/sys`. `sandboxIsolationProblems` fails the spec if those are missing.
- Egress deny includes `169.254.0.0/16` (cloud metadata), loopback, and the private ranges. Public internet stays open.
- A shell command is stopped after at most 600 seconds.

The path allowlist and the command classifier follow the flag below, so
shadow mode does not start refusing reads that were allowed before.

### 4. Audit, alert, lockout

The mode is `SAGAX_MISUSE_GUARDRAILS`: `off`, `shadow`, or `enforce`. An
unknown value is `shadow`. The default is `shadow`, so a deploy of this
build records attempts and refuses nothing until an operator sets `enforce`.

| Mode | Person | Activity log | Admin alert |
|---|---|---|---|
| off | unchanged | none | none |
| shadow | unchanged | `misuse.shadow`, or `misuse.lockout` on the fifth attempt | none |
| enforce | 403 `misuse_blocked` or `misuse_approval_required`; 429 `misuse_locked` | `misuse.block`, `misuse.approval`, `misuse.lockout` | one `admin-action` notification, admins only |

Five block or approval attempts in ten minutes lock that person for fifteen
minutes. The key is the principal id, then the thread id, then `anonymous`.
While locked, another classified attempt is refused. An ordinary message
still goes through. Shadow counts the same window and writes
`misuse.lockout` without refusing.

Each row is category `security` in the admin activity log. The excerpt is
the request text, collapsed and cut at 160 characters. The log's own
redaction still applies to secret-shaped field names.

What the person reads is Québec French, with no anglicism (the product name
Perspicax is the exception):

- Block: "Cette demande est refusée par la politique de sécurité. …"
- Approval: "Cette demande exige une autorisation de sécurité. Un administrateur peut l'accorder dans Perspicax au rôle prévu pour le travail de défense."
- Lockout: "Trop de demandes refusées en peu de temps. Patientez avant de réessayer."

## Tests

`shared/misuse-guardrails.test.ts` is the red-team suite (French, English,
base64, split quotes, hex, octal, zero-width characters, jailbreaks, the
triage permission, paths, the MCP gate). `server/safety/misuse-guardrails.test.ts`
covers the flag, the lockout, the alert, and the container limits.
`shared/safety-review.test.ts` and `server/safety/safety-review.test.ts` cover the
safer path, the explicit card, final denial, untrusted wrapping, and
outbound drafts. None of these files boot the server, so CI runs them with
the unit shards.

```
pnpm exec vitest run shared/misuse-guardrails.test.ts server/safety/misuse-guardrails.test.ts
```

## Safety review

The same flag, `SAGAX_MISUSE_GUARDRAILS`, drives a second decision for
risky tool calls (shell, MCP, computer use, routine writes). Shadow, the
default, writes `safety.shadow` and changes nothing. Enforce applies the
decision. Off does neither.

The authoritative review is the deterministic classifier in
`shared/safety-review.ts`. When the engine exposes `reviewPermission`,
enforce may ask that isolated reviewer to tighten a call the review holds
(a safer path or a card). It cannot weaken either. A call the review leaves
to the approval mode does not wait for the reviewer. The
permission-card path does not wait for that reviewer: the card is
synchronous. The sandbox, desktop, personal MCP, Perspicax, and shared
computer paths do.

| Situation | What happens in enforce |
|---|---|
| Hard misuse block | 403 refusal (`misuse_blocked`). Never a card. `security.triage` does not lift it. |
| `security_operations` without `security.triage` | The message path keeps the existing approval refusal. On a tool, the safety review asks for an explicit card. With the permission, the call may run, after the prompt and credential checks. |
| Prompt secrecy, minting access, scraping a token, turning the guardrail off | Refusal. No card. |
| Read-only tool | Auto-approved, including in Ask (`safety-read`). A Sagax gate card stays a person's choice: the gate already runs its own read-only list without asking. |
| Any other write or known tool (a Sagax tool, a connector read the list does not name, a file write, `propose_routine`, a command) | Not held by the review (2026-10-27, #1098): the person's approval mode answers it, Ask, Auto, Full or their Allow rules, as for any card. No row in shadow. |
| Call in the person's own environment (their server environment, their Local VM or computer, one of Sagax's own person-scoped tools) | Not held and not approved by the review: their approval mode answers it. A destructive git operation there is theirs too. A send, untrusted content and an unknown kind keep their review. |
| Unknown kind, destructive git outside the own environment | Below Full access: a safer path is returned once, then the next attempt is a native approval card that Auto and a saved Allow rule do not accept (`safety-hold`, checked before those). At Full access (#1905, 2026-11-02): neither the safer path nor the card; the person chose that level for their own bot (`shared/safety-review.ts` code `full_access`, read from the server's one Full access decision, `server/approvals/full-access-gate.ts`). |
| Denial or expiry of that card | Final for that fingerprint. A destructive git intent, a prompt disclosure, or a credential grab is also final across rewording, splitting, and encoding. |
| Outbound mail or message | Below Full access: the first attempt tells the bot to write a draft the person sends; the next attempt is the existing "Send on your behalf?" card, including when outbound policy is allow. Denial seals that message only. A different later message still asks. At Full access the send runs (#1905: `send_to_bot`, a send by its name, was held under Full); an organization or personal Refuse or Ask first rule and the allowed recipients still decide. |
| Routine write | Its own routine card and the person's approval mode answer it, as any other write (#1098). |
| Untrusted tool result, page, file, or other bot's message | Wrapped in `<<<UNTRUSTED>>>` markers. The model is told those markers are data. A consequential action taken from them (send, delete, spend, credentials, a new target) needs the person's confirmation below Full access; at Full access it runs, under the same rules as any other call. |
| `security_operations` without `security.triage`, at any level | Still the explicit card: the permission is the administrator's to give, and no approval level grants it. |

People's direct conversations are not classified.

How this sits next to the pieces that already existed:

- Tool guard (`SAGAX_TOOL_GUARD`, default shadow) answers whether this bot and this speaker may call the route at all. It is unchanged.
- Agent card guard runs before the approval card for `agents__` tools only. A missing grant is still a refusal, not a safety card.
- Approval modes ask, auto, and full still answer ordinary cards, writes in the person's own environment included. They do not answer a safety hold (a send, destructive git outside the own environment, untrusted content, an unknown kind). The payment card and the classes a person protects with a security key keep their own card.
- Perspicax `security.triage` is only for defensive security work. Admins hold every key. It is a member default (2026-10-27), withheld when a profile leaves it out. It does not turn a hard block into a card.
- The MCP gate still cannot see the person's permission. It blocks hard misuse categories in enforce, and it now carries the safety note (a safer path or a refusal) back to the model. A gate card is still one the person accepts.

The reviewer is best-effort. A hard block never becomes a card. An explicit accept is not overridden, except by a later hard block.

## Residual risk

The classifier is a pattern list. A novel wording can miss it, and a novel
wording of ordinary work can hit it. Shadow mode is how an operator sees
the second kind before enforce mode starts refusing. The prompt can be
ignored by a model; the server classification and the container limits are
what hold. The desktop bridge runs on the person's own computer, so a
command that passes the classifier still runs there with that person's
rights. The container limits do not apply to that computer. The safety
review has the same pattern limit. A generic write with no class key can
be reworded into a new fingerprint. A base64 blob shorter than 16
characters is not decoded. The model reviewer cannot weaken the classifier.
An accepted permission card admits that call once, so the tool execution
that follows is not asked a second time.

# In-chat terminal: destinations

Sagax has one interactive terminal: the one in the conversation. There is no
terminal button or menu entry. The bot proposes it as a card when it is
useful (the person wants to connect to a machine, to debug live, or a step
needs their own typing); the person approves it, and an xterm opens in the
thread. Credentials and connection strings never reach the client.

## Destinations

A **destination** (`TerminalResource`) is a place a person may open the
terminal on. Two kinds (`scope`):

| Provider | Scope | What it is | Who may open it |
|----------|-------|------------|-----------------|
| `sandbox` | personal | The person's cloud computer (their server environment: Docker or, on a hosted organization server, Kubernetes through the provisioner) | The person, for their own bot (an admin: from any bot) |
| `local-vm` | personal | Organization: the Local VM on the person's computer, through their Sagax app. Solo: this server's Local VM of the bot | Same |
| `desktop` | personal | "Cet ordinateur". Organization: the person's computer through their Sagax app, when their Where bots work is their computer or the bot works there. Solo: this computer, only when the server is the Sagax app on it | Same |
| `ssh`, `unraid` | server | A host of the server from `config.json` (`terminalShell.hosts[]`, `terminalShell.unraidSshAlias`, `SAGAX_UNRAID_SSH_ALIAS`, `vps.sshAlias`) | Organization admins (a solo server's operator) |
| `test` | server | Vitest echo shell (`SAGAX_TERMINAL_TEST=1`) | Same |

A personal destination has the single id `mine`: it always means the
environment of the person who lists or opens it, so a card answered by
someone else opens THEIR environment under THEIR rights, never the owner's.

## The bot's tools

- `list_terminal_resources`: what this person may open here, and the default
  (where the bot works now).
- `offer_shell_terminal { reason, provider?, resource_id? }`: stages the card.
  Without a destination, the card proposes where the bot works (its
  Workspace, or the place Auto chose this turn); else the person's cloud
  computer, Local VM, computer, in that order.

Both are member-scope tools (`server/member-tool-scope.ts`): the list is
already filtered for the person and the card only stages a request.

## The card

The card shows the bot's destination and, when there is more than one, a
**Destination** menu with every other destination this person may open.
The allow sends the pick (`terminalDestination`) and the widget's size
(`terminalSize`). The server opens the pick only when the card offered it
AND the registry allows it for the person answering
(`server/terminal-resources/registry.ts`, `terminalResourceAllowed`); a
refusal leaves the card open.

## The widget

The terminal takes the whole width of the conversation column and refits its
grid when the column changes (`src/lib/chat-bubble-width.ts`, fit addon). Its
font stack leads with the bundled Symbols Nerd Font Mono, limited to the icon
ranges, so prompt themes (Powerlevel10k, Oh My Posh, Starship) draw their
icons (`src/components/terminal/terminal-font.ts`, license in
`third_party/nerd-fonts-symbols`).

**Detach** moves the same terminal (same xterm, same WebSocket, no new
connection) into a floating window (`src/lib/floating-windows.ts`,
`src/components/floating/`): several at once, stacked, focus on click, each
closes on its own and brings the terminal back to its chat row. The session
(`src/components/terminal/terminal-session.ts`) lives while the chat row or
its window holds it, and ends a moment after both let go. Terminal windows
are not reopened after a restart (the shell session is gone); their position
and size are remembered per session.

## How each destination runs

| Destination | Path |
|-------------|------|
| `sandbox` | The provisioner's `/v1/sandboxes/<key>/tty` upgrade (signed, size in the URL): `docker exec` with a TTY (`sandboxd-docker.ts execTty`) or the Kubernetes exec API with `tty=true` and its resize channel (`server/sandboxd-k8s/sandboxd-k8s-client.ts execTty`), as the sandbox user in `/workspace`. Keystrokes and resizes are framed (`server/sandbox/sandbox-tty-frames.ts`). |
| `local-vm`, `desktop` (organization) | A bridge operation (`terminal_open`, `vm_terminal_open`) with a one-time ticket; the app connects back (`GET /api/desktop-bridge/<id>/terminal/<ticket>`, session cookie + bridge secret, same person) and runs the shell (`electron/desktop-terminal.mjs`): the login shell, or `docker exec -it -u cua` into the Local VM (`electron/local-vm.mjs terminalCommand`, which holds the VM against its idle stop). |
| `local-vm`, `desktop` (solo), `ssh`, `unraid` | A local PTY from the system's `script` command (`electron/script-pty.mjs`): `docker exec -it -u cua`, the login shell, `ssh -tt`. |

The widget sends keystrokes as binary WebSocket frames and its size as a
text frame `{"type":"resize","cols":..,"rows":..}`; every destination
follows the size.

## Security and audit

- Approval card required; nothing runs before the allow. The bot cannot type
  unless the person turns on bot input.
- The person's rights are checked on list, on offer, and again at open.
- WebSocket attach uses the authenticated upgrade path (voice mode, desktop
  viewer). Closing the widget ends the session; 15 minute idle close; 3 live
  sessions per person.
- `terminal-sessions.jsonl` (DATA_DIR): `session.requested`,
  `session.destination` (the person changed the destination),
  `session.refused`, `session.denied`, `session.opened`, `session.ended`,
  each with the person, bot, conversation and destination. A terminal on
  the person's computer is also in their Computer tab's activity
  (`desktop-bridge-audit.jsonl`); the Kubernetes provisioner audits
  `sandbox.tty`.

# Bring your own MCP servers

Open **Plugins → MCP servers → Add server** to give your bots tools from an
MCP server you trust. A server is one of two things:

- **Run a command** — a local stdio server. Add the executable, put each
  argument on its own line, and add any environment variables as `KEY=value`.
- **Connect to a URL** — a remote server. Paste its address and, if it needs
  a token, add it as a header (`Authorization: Bearer …`, one header per
  line). Most servers speak **Streamable HTTP**; pick **SSE** only for an
  older server that documents the `/sse` endpoint.

Sagax saves a new server switched off. Use **Test** to start the command
(or connect to the address), complete the MCP handshake, and see the tools it
advertises. Then turn it on. It becomes available to compatible bots on their
next task; no app restart is needed.

Tokens for URL servers go in headers, never in the address.

### Whop

In Plugins, find **Whop** alongside Gmail, Slack and the other apps and click **Connect**. The built-in card
uses Whop's official hosted MCP endpoint and opens Whop's browser sign-in;
no API key or local CLI is needed. After successful
sign-in and tool discovery it enables the connection. A cancelled or failed
first setup remains off and can be retried without adding another server.

Open **Bot access** on the Whop card to reach each bot's existing Access
settings. Bots set to use every enabled MCP server inherit the connection;
bots with an explicit selection must include its server name. The next task
uses the selection. Whop also appears in the **Connected** filter. **Disconnect** disables the connection and signs out;
the saved entry remains available to reconnect. Existing custom Whop entries
at the official HTTP endpoint are recognized rather than replaced.

Whop currently requests admin access across businesses your Whop account can
manage, and its own consequential-action confirmations still apply. See the
[official Whop MCP documentation](https://github.com/whopio/whop-mcp-server).
This is an optional connected tool.

### Servers that need a sign-in (OAuth)

Many hosted servers (Linear, Notion, Sentry, GitHub and others) answer
`401` until you sign in. When you add a URL server, or open the list,
Sagax asks the server whether it needs a sign-in and shows the answer on
its row: **Sign-in required**, **Connected**, **Sign-in expired**, or
**Sign-in unavailable** with the reason.

Click **Sign in**. Sagax opens the provider's page in your browser; after
you approve, the browser comes back to this app at
`http://127.0.0.1:<port>/api/mcp-oauth/callback`, shows "Sign-in complete. You
can close this tab.", and the row flips to **Connected** within a few seconds.
**Disconnect** revokes the tokens at the provider (when it offers revocation)
and forgets them here. Then turn the server on as usual.

How it works, following the MCP authorization spec (2025-06-18 and
2025-11-25):

- **Discovery.** The server's `401` names its Protected Resource Metadata
  (RFC 9728) in `WWW-Authenticate`; otherwise Sagax tries
  `/.well-known/oauth-protected-resource` on the server's origin. The
  authorization server's metadata comes from RFC 8414
  (`/.well-known/oauth-authorization-server`), with OpenID Connect discovery
  as the fallback. Metadata that describes another origin, or a server
  without PKCE `S256`, is refused.
- **Client.** When the provider offers Dynamic Client Registration
  (RFC 7591), Sagax registers itself as a public client. When it does not
  (GitHub, for example), the row asks for a **client ID** (and an optional
  secret) of an OAuth app you create with the provider, and shows the
  redirect URI to give that app.
- **Sign-in.** Authorization code with PKCE `S256` and the `resource`
  parameter (RFC 8707). The `state` is random, bound to one pending sign-in,
  valid for 10 minutes and usable once.
- **Tokens.** Stored encrypted (AES-256-GCM) in `mcp-oauth.enc` beside
  `config.json`, never in it, and never logged or returned by the API. In the
  desktop app the key lives in the OS-encrypted credential store; a headless
  server keeps a `0600` key file (`mcp-oauth.key`) in its data folder.
  Tokens are refreshed before each turn when they expire within a minute, and
  after the server refuses one. A refused refresh marks the server
  **Sign-in expired**.
- **Engines.** Each turn, a signed-in server reaches the engine with
  `Authorization: Bearer <token>` (replacing any `Authorization` header you
  typed for it): Claude Code through its MCP config file, Codex through
  `bearer_token_env_var`, ACP agents (Cursor, Grok, Kimi and others that
  advertise the `http` or `sse` transport) through the headers of the ACP
  session's MCP servers. Servers a Cursor or Codex CLI loads from its own
  config file (`~/.cursor/mcp.json`, `~/.codex/config.toml`) are signed in
  by that CLI, not by Sagax; add them here instead to sign in once.

Limits: a turn that outlives its access token (commonly one hour) is not
refreshed mid-turn; the next turn is. When you use Sagax from another
computer, the callback goes to the server's public address (Settings,
custom domain or `SAGAX_PUBLIC_URL`) if one is set, otherwise to
`127.0.0.1`, which only works in a browser on the server's own machine.
Changing a server's address, or removing it, forgets its sign-in.

### Example: give your bots web search

A good first URL server is You.com's search server, because the free profile
needs no token at all. Add a URL server with the address

```
https://api.you.com/mcp?profile=free
```

leave the headers empty, and press **Test** — the handshake completes and the
server advertises `you-search` (web search) and `you-discover` (a directory of
other MCP servers). The free profile is read-only and rate-limited to 100
searches a day; there is no key, so none is stored. Turn the server on and
every compatible bot can search the web on its next task — `you-search` results
arrive like any other tool result, through the approval cards.

If the free limits are too small, [you.com/platform](https://you.com/platform)
issues an API key with a higher quota and the `you-contents` tool for
full-page extraction. Add the same address without `?profile=free` and one
header line, `Authorization: Bearer <your key>` — the key is kept write-only
like every other header value. `you-research` (multi-step cited reports) is
served by its own dedicated server, `https://api.you.com/mcp/research` — add
it the same way, with the same header.

### Import and choose tools per bot

**Paste config** accepts an `mcpServers` JSON block, a server-name map, or a
single named entry — commands and URL servers alike, in the shape Claude Code,
Cursor and Claude Desktop write. Import is all-or-nothing, refuses existing
names, and adds servers switched off—even if the pasted config says enabled.
It does not install, execute or connect to them. Test explicitly, then enable
the servers you trust.

Open a bot’s **Tools → Access → MCP servers** to narrow the enabled global
servers offered to it. Existing bots keep all enabled global servers until you
choose a subset; switching them all off means none. **Use every enabled server**
restores the default, including future additions. Stop all of that bot’s running
turns before changing this selection; the next direct or channel turn gets the
new list. The list does not filter project-local `.mcp.json` files and is not a
shell sandbox. Individual tool approvals depend on the engine and approval mode.

### Servers with hundreds of tools

Some servers offer more tools than a model can usefully read at once: Whop's
lists 425. Claude Code, and Codex signed in with its own account, look tools
up as they need them, so they get every server whole, as before. Other
engines would read every tool's description on every message, and the
API-model engines stop at 128 tools. So for bots on API models, on Pi, and on
Codex with a ChatGPT plan, a big URL server shows up as three tools: one that
searches its tools, one that reads a tool's exact inputs, and one that runs a
tool by name. The search tool says what the server covers, area by area.

A server counts as big when it has more than 40 tools, or more than about
100,000 characters of tool descriptions (roughly where Claude Code starts
searching on its own). Smaller servers are listed as they always were. There
is nothing to configure. A bot's tool selection still holds: it can find and
run only the tools you chose for it, and an approval card names the tool
being run, never the search. A big URL server also gets 30 seconds to start
on a bot's turn, like the Test button gives it; command servers keep eight.

Known limits:

- **Codex with a ChatGPT plan, on Approve for me, asks about every call.**
  Codex lets a server's read-only tools run without asking, but here every
  tool runs through the one tool that runs them all, which cannot carry each
  tool's own read-only hint. Each Whop call shows a card, naming the tool.
- **Command servers are not searched yet.** Only URL servers are. A command
  server with hundreds of tools is still listed whole. When a turn on an
  API model adds up to more tools than its provider takes in one request
  (128 for xAI Grok and OpenAI), the bot keeps its computer, its browser and
  Sagax's own tools listed first, then the other servers in their order, and
  reaches the rest through two tools of its own: `tool_search` finds a tool
  by what it does and `tool_call` runs it, with the usual approval card
  naming that tool. The turn never fails for the number of tools.

### Which engines reach which servers

| Server | Claude Code bots | Codex bots | ACP bots (Cursor, Grok, Kimi, …) | API-model bots |
| --- | --- | --- | --- | --- |
| Command (stdio) | yes, through the result gate | yes | yes | yes |
| URL, Streamable HTTP | yes | yes | yes | yes |
| URL, SSE | yes | yes | yes | yes |

Every engine except Claude Code reaches URL servers through Sagax's own
connector, the same one **Test** uses, so a server that passes Test works in
chat too. Some servers refuse any handshake field they do not know, and the
engines' own MCP clients add such fields: a bot connecting by itself got "Tool
not found" for every tool of a server that passed Test. Claude Code still
connects by itself, since its handshake has only fields the MCP spec defines.

Through the connector, a server's own error for a call (a missing argument,
an unknown id) reaches the bot with its code and words, so it can fix the
call; the server's address and header values are removed from it first, and
connection failures stay generic. A tool call may take as long as the
engine allows (the connector adds no deadline of its own, except for the
tool search used by bots that cannot search tools themselves, two minutes).
An HTTP 401 tells the bot to send the message again (a sign-in is refreshed
when a message starts) and, if that fails, to sign in again or check the
server's header values in Plugins → MCP servers.

## What a Claude bot sees, and the "Also use my Claude Code MCP servers" switch

A bot on the Claude engine gets the tools and instructions its owner gave it:
the servers above, its integrations (computer, browser, agents, phone), and
its own project's `<cwd>/.mcp.json`. By default it does **not** inherit this
machine's Claude Code setup — the MCP servers and claude.ai connectors in your
user or local Claude config, your skills and agents, your hooks, and your
personal `~/.claude/CLAUDE.md`. Those were being mounted into every turn of
every bot (one measured desktop added 407 tools, ~10k tokens per model call)
and were reachable by the bot. Codex bots, by contrast, have always read the
MCP servers in `~/.codex/config.toml`, which is why the two engines looked
different.

If you want Claude bots to see your own Claude Code MCP servers too, switch on
**Also use my Claude Code MCP servers** at the top of Plugins → MCP servers.
With it on, every Claude bot also loads the servers and connectors from your
Claude Code config on every message; skills, hooks and the personal
`CLAUDE.md` still stay out. More tools means more tokens per message, so keep
it off unless you need those servers — the recommended way to give a bot a
server is still this page or the bot project's `.mcp.json`.

The switch drops the CLI flag `--strict-mcp-config` (Claude Code 1.0.60+)
while keeping `--setting-sources project` (1.0.122+). The environment variable
`SAGAX_CLAUDE_INHERIT_USER_CONFIG=1` on the Sagax process remains the full
escape hatch back to the old launch: it restores everything, for every Claude
bot, until you remove it. The harness also picks the session's compaction
window with `--autocompact` (2.1.122+). Sagax reads `claude --version`
whenever it lists engines (app load, the Engines page, after an update) and
only passes each flag to a CLI that accepts it, so an older CLI keeps working
— without the controls it predates — and the Engines page shows an update
notice with the exact command. `claude update` clears it.

## When your organization manages MCP servers

If this computer is connected to an organization (Settings → Organization)
and its Admin turns off custom MCP servers, only servers whose name or address
is on the organization's approved list reach bots. Other configured servers
stay in your list, marked **Managed by** your organization, but bots do not
get them, and the "Also use my Claude Code MCP servers" switch has no effect.
**Paste config** is off, and **Add server** accepts only approved servers.
Nothing is written to `config.json`; disconnecting the organization restores
the list as you configured it. With no organization connection, none of this
applies.

Address entries are HTTPS only. The host is compared label by label, where
`*` stands for one or more whole labels (`https://*.example.com/mcp` matches
`https://a.example.com/mcp`, never `https://evil.test/x.example.com/mcp`),
and the path separately, where `*` matches anything.

Limits: a personal **Codex** engine also loads MCP servers from your own
`~/.codex/config.toml`, which Sagax does not filter. An organization that
must block those can allow only company models, or leave personal Codex off
its engine list. Company Codex uses its own separate home, without your
`config.toml`.

## Advanced: edit the file

The same registry lives in `~/.sagax/config.json`:

```json
{
  "mcpServers": {
    "notes": {
      "command": "npx",
      "args": ["-y", "@example/notes-mcp"],
      "env": { "NOTES_TOKEN": "…" }
    },
    "docs": {
      "type": "http",
      "url": "https://mcp.example.com/mcp",
      "headers": { "Authorization": "Bearer …" }
    },
    "corp": {
      "type": "http",
      "url": "https://mcp.corp.example/mcp",
      "oauth": { "clientId": "…", "clientSecret": "…", "scopes": ["api://corp-mcp/read", "offline_access"] }
    }
  },
  "features": { "claudeUserMcp": false }
}
```

`type` is `http` (Streamable HTTP, the default) or `sse`. If you edit the file
by hand, restart Sagax. Every bot whose engine can mount custom MCP
servers gets the enabled tools on its next task.

## Rules that keep this safe

- **Permission cards by default.** Custom servers are never pre-approved:
  on Claude their tools route through the permission broker into Allow/Deny
  cards; on Codex they keep the on-request approval policy; ACP engines
  relay the agent's own permission asks. Built-ins stay pre-quieted — only
  *your* servers ask.
- **Reserved names are refused** (`computer`, `agents`,
  `browser`, `phone`, `dweb`, `ogb`, …) so a custom entry can never shadow
  a built-in tool surface. Names are lowercase letters/digits/`_`/`-`, max
  32 chars, starting with a letter.
- **Environment names are checked.** `SAGAX_*` and `OGB_*` are refused:
  Codex hands MCP children their variables from one shared environment,
  and those names carry Sagax's own routing and bearers.
  `ELECTRON_RUN_AS_NODE` is accepted as `1` only, the value Sagax's own
  proxies use, so a server bundled inside an Electron app (its binary as the
  command) can run as node; any other value is refused (port de
  OpenMausBot #2865).
- **One bad entry never takes the fleet down.** Invalid entries are skipped
  with a logged reason; the rest still mount.
- **Credentials are write-only in the UI.** The API returns environment and
  header names, never their values. Leaving an existing value blank keeps it
  saved; removing its line deletes it.
- **Credentials stay off argv.** `env` values travel in the child
  environment (Codex argv carries env *names* only; Claude uses the private
  0600 mcp-config file; ACP passes them in the session payload with the
  wire log redacted). Header values do the same: Sagax's connector
  reads them from a private environment record (Codex names only the
  record's variable on argv; ACP gets it in the session payload), Claude
  Code from the 0600 file. They do persist as plaintext in the 0600 config file — prefer
  tokens scoped to the one server. Codex gives its MCP servers their
  variables from the same environment it runs the bot's shell commands in,
  so each variable a server needs there is excluded from that shell; a value
  you already had in your own environment, like a proxy setting, stays.
- **Proxies.** Where Sagax's own remote proxy connects to a URL
  server, an `https://` server goes through your `HTTPS_PROXY` /
  `HTTP_PROXY` (CONNECT), with this computer's loopback names always added
  to `NO_PROXY` (`[::1]` included). An `http://` server goes through your
  `http_proxy` / `HTTP_PROXY`, sent by the connector itself in absolute form
  (Node's own env-proxy switch stays off, `NODE_USE_ENV_PROXY=0`, since
  Node 24's fetch hangs on a plain http request sent through it); loopback
  and `NO_PROXY` hosts are reached directly. Proxies set only in macOS
  System Settings are not read.
- **Testing is bounded.** A command is stopped after the handshake (or eight
  seconds), its output is capped, and its stderr is never sent to the UI. It
  inherits none of Sagax's workspace or provider credentials; only the
  environment variables configured for that MCP server are added. A test
  reads at most 32 MB (Whop's tool list alone is 1.2 MB), and a URL test
  reports only the HTTP status of a refusal.
- **Addresses are checked.** A URL server needs a full `http://` or
  `https://` address with no credentials in it; header names must be valid
  HTTP field names and values a single line.
- **The result gate covers commands.** Oversized tool results from a stdio
  server are trimmed before they reach the model (`SAGAX_MCP_RESULT_BUDGET`).
  A URL server's results arrive untrimmed.
- `"enabled": false` parks an entry without deleting it.

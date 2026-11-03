# API keys Sagax sends itself, and command variables

Since 2026-10-26 an API key saved in Settings > Credentials has two optional uses
beside filling a web page.

## Sent by Sagax on a bot's request (the bot never sees the key)

On the key's form, "How Sagax sends it" picks one mode:

| mode | what the API receives |
|---|---|
| Bearer | `Authorization: Bearer <key>` |
| Named header | `<header>: <key>`, the person names the header (`X-Api-Key`) |
| Basic | `Authorization: Basic base64(<user name>:<key>)` |
| Query parameter | `?<param>=<key>`, the person names the parameter (`api_key`) |

The key's **Sites** are its origins (`api.example.com`, `api.example.com:8443`,
`*.example.com`), and an optional **Base path** (`/v1`) keeps requests under it.

A bot allowed on the key (the vault's grants: Always from Settings, or a request
card) gets the agents tool `vault_http_request` (`server/drivers/agents-vault-http-tools.ts`,
listed only when `SAGAX_VAULT_HTTP=1`, that is when the bot may send at least one key
here). It passes the key's handle (`cred_...`, from `request_login`), a method, an
https URL, optional headers and an optional body. The server
(`server/routes/credential-vault-internal.ts`, `POST /api/internal/credentials/http`):

1. checks the grant, that the key is set to be sent, the URL's sites and base path
   (`CredentialVault.resolveForRequest`);
2. resolves the host and refuses it when any address is not public: loopback, this
   computer, private network, link-local, cloud metadata or reserved
   (`server/browser/egress/policy.ts` `addressClass`); the connection goes to the
   checked address, never through a second lookup;
3. adds the key as chosen; the bot may not set `Authorization`, the key's own header,
   `Cookie`, `Host` or the transport's headers;
4. follows a redirect only on the same origin, on the key's sites and under its base
   path (adding the key again); a redirect to another origin is refused and never
   followed;
5. stops after 30 s, cuts the answer at 1 MB, drops `Set-Cookie`, and removes the key
   from the body, the headers, the final URL and any error text, with its encodings
   (base64 padded or not, URL-safe, hex, URL and form encodings, JSON, HTML, the Basic
   pair; `server/vault/credential-fill.ts` `variants`).

The audit hook receives the bot, host, method and status (or the refusal code), never
the key, the path or the query. The item's "last used" line is updated. There is no
administrator approval: the person decides with the grant.

Code: `server/vault/credential-http.ts`. Tests: `server/vault/credential-http.test.ts` (a local HTTP
server stands for the API; the resolver and the address classes are injected).

## Command variable (the person's choice: the bot can read it)

"Command variable" is off by default. When the person turns it on and names it
(`EXAMPLE_API_KEY`), the bots allowed on the key get it in the environment of their
commands, read again for every command (a revoke holds at the next one):

- the person's server environment on an organization server (`run_command`): the
  values ride `SAGAX_CMDVAR_<n>` (the sandbox takes only `SAGAX_*`) and a prelude made
  of the names exports them (`server/vault/credential-command-env.ts` `withCommandVariables`);
  the value is never on the command line;
- the engine's own shell on this computer, for every engine with a shell. The turn's
  `commandEnvironment` (`SendTurnInput`) carries them, read again for every turn:
  - Claude Code's Bash: they join the engine process's environment
    (`server/drivers/claude.ts`); a change starts a fresh process (the contract keeps a
    digest);
  - the ACP engines (Grok Build, Gemini, Qwen, Cursor, Cline, Droid, Kimi, OpenCode,
    Hermes, Antigravity, a custom ACP engine): they join the child's environment
    (`server/drivers/acp/core.ts`); the environment is in the spawn contract's
    fingerprint, so a change or a revoke starts a fresh process at the next turn;
  - Pi: they join the process pi runs its bash tool in (`piTurnEnvironment`); pi starts
    for every turn;
  - Codex: they go in the shell policy's `set` table on the thread
    (`shell_environment_policy.set`, sent over stdin with thread/start and
    thread/resume, merged with the person's own entries), so only Codex's shell gets
    them, after its exclusions; the app-server's own environment and argv never hold
    them, and the native log keeps the names only. Codex starts for every turn.

  An engine process never takes a name it would read as its own sign-in or billing
  (`OPENAI_API_KEY`, `XAI_API_KEY`, `GEMINI_API_KEY`, the workspace keys, the driver's
  own credential names: `engineCommandVariables`): such a variable would move the
  engine itself onto the key. Codex's shell and the other places below still get it;
- the Local VM's `vm_exec` (`server/computer/container-computer.ts` `containerExec`): a script
  of exports goes to the shell on stdin (`commandVariablesScript`), and the command
  line holds only `eval "$(cat)"` before the command;
- the person's own computer through the desktop app on an organization server
  (`sagax-desktop` `run_command`, and `local_vm` `run` on the Local VM there): the
  operation's `env` (added after the refusal checks, which never see a value) joins the
  command's environment on the desktop; the Local VM there gets `-e NAME` and the value
  from the client's environment. A desktop app from before this refuses the field
  before running anything: the command then runs without the variables and the bot is
  told to update the app.

The key's row says it in one line ("Readable by your allowed bots in their shell as
$NAME"). Names a shell or the engines need are refused (`PATH`, `HOME`, `LD_*`,
`SAGAX_*`, `ANTHROPIC_*`...: `shared/credential-vault.ts` `parseCommandVariable`).
1Password keys are not exposed as variables (their value is read only at use).
Tests: `server/vault/credential-command-env.test.ts`, `server/drivers/acp/command-variables.test.ts`,
`server/drivers/codex.test.ts`, `server/drivers/pi.test.ts`, `server/computer/container-exec.test.ts`,
`server/desktop-bridge.test.ts`, `electron/desktop-bridge.node-test.mjs`.

Not covered: the cloud computer's `exec` (its provider's API takes a command line only,
so the value would be on it) and `remote_session_exec` (someone else's machine, outside
the person's environment); the iOS app has no vault.

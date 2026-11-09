# Bring your own engine

Two zero-code ways to run Sagax bots on an engine the app doesn't ship.
Both live in `~/.sagax/config.json` under `"instances"`; restart the app
after editing (instance entries are read at boot).

## Provider icons

Settings does not offer a provider icon on each provider. The card uses the driver's own mark.
An `icon` already stored on an instance still shows until that field is removed from `config.json`.

## Any ACP agent (a CLI you spawn)

If an agent CLI speaks [ACP](https://agentclientprotocol.com) over stdio —
`fx acp`, a Zed-style agent server, your own wrapper — point a `customAcp`
instance at it:

```json
{
  "instances": {
    "my-agent": {
      "driver": "customAcp",
      "displayName": "My Agent",
      "environment": { "MY_AGENT_TOKEN": "…" },
      "config": { "cli": "my-agent acp" }
    }
  }
}
```

- **`config.cli`** is the whole command, args included (`"npx -y some-agent acp"`
  works). You can also set it from the app: Settings → Engines → *Set CLI…* on
  the instance's row. An instance without a command shows up with exactly that
  hint instead of failing at first message.
- **Sign in first.** The driver has no auth flow of its own — run the CLI once
  in a terminal and log in there; Sagax spawns it with your login intact.
- **Model choice stays inside the agent.** The picker shows a single
  "Agent default" entry; whatever the CLI is configured to run is what runs.
- **`environment`** is passed to the CLI child. Foreign provider keys
  (XAI_API_KEY, OPENAI_COMPAT_API_KEY, …) are deliberately stripped so a
  custom CLI can never bill against another engine's login.
- **Permissions** ride ACP's own `session/request_permission` — if your agent
  asks, the request becomes a normal approval card in chat.
- Multiple instances are fine — one per agent.

## Any OpenAI-compatible endpoint (no process at all)

The built-in `openai-compat` driver supports multiple instances, so a local
vLLM/LM Studio/Ollama-openai endpoint or any hosted compatible API is one
entry:

```json
{
  "instances": {
    "my-endpoint": {
      "driver": "openai-compat",
      "displayName": "My Endpoint",
      "environment": { "MY_ENDPOINT_KEY": "sk-…" },
      "config": {
        "url": "http://127.0.0.1:1234/v1",
        "apiKeyEnv": "MY_ENDPOINT_KEY",
        "model": "my-model"
      }
    }
  }
}
```

- `apiKeyEnv` names which `environment` value carries the key, so several
  instances can hold different keys without colliding.
- The driver lists the endpoint's `/models` when it can and keeps your
  `model` as a custom option either way.
- OpenAI-compatible instances support structured tools and image input. With a
  model that accepts both, the harness can mount the approved host, Local VM,
  VPS, Boat cloud or built-in browser tools and return their screenshots to the model.
  The existing platform, computer-selection and approval checks still apply.
  Boat turns retain the selected API model in direct chats, rooms and cloud
  routines, as they do for every engine with computer tools.
- Set `config.tools` to `false` for a model without tool support. Image support
  also depends on the chosen model; the driver cannot add vision to a text-only
  model. See [tool verification](verification/openai-tools.md) for scope and tests.

## Engines baked into a server image

A server image can carry every engine CLI Sagax drives, so the people of an
organization server only sign in or add a key. The pins live in ONE file,
[`engines.lock.json`](../engines.lock.json). The
[`Dockerfile`](../Dockerfile) installs them with
[`scripts/install-engines.mjs`](../scripts/install-engines.mjs).
The image default is that full set. On 2026-10-12 a build that left
`ENGINE_SET` unset shipped `engineSet none` and no CLIs
(`pulsa-bot-server:main-example1`). `SAGAX_REQUIRE_ENGINES=1` (also the
default) fails a build that is not the full lock, including an explicit
empty `--build-arg ENGINE_SET=`.

```sh
docker build -t sagax .                                  # full engine set
docker build --build-arg ENGINE_SET=none --build-arg SAGAX_REQUIRE_ENGINES=0 -t sagax .
                                                         # no engine CLI
docker build --build-arg ENGINE_SET=open --build-arg SAGAX_REQUIRE_ENGINES=0 -t sagax .
                                                         # only the open-source licences
```

The legacy `ENGINES` (npm specs) and `NATIVE_ENGINES` (native ids such as
`grok`) arguments still replace the lock's npm or native set; `none` drops
that kind. Each installed CLI must answer `--version` or the build fails.

| Engine | Driver | Installed as | Pinned | Licence |
|---|---|---|---|---|
| Claude Code | `claudeAgent` | npm `@anthropic-ai/claude-code` | 2.1.318 | Anthropic Commercial Terms |
| Codex (and the ChatGPT plan instance) | `codex` | npm `@openai/codex` | 0.160.0 | Apache-2.0 |
| pi | `piAgent` | npm `@earendil-works/pi-coding-agent` | 1.0.1 | MIT |
| Gemini CLI | `geminiAgent` | npm `@google/gemini-cli` | 0.62.0 | Apache-2.0 |
| Kimi Code | `kimiAgent` | npm `@moonshot-ai/kimi-code` | 2.1.1 | MIT |
| Qwen Code | `qwenAgent` | npm `@qwen-code/qwen-code` | 0.24.7 | Apache-2.0 |
| OpenCode | `opencodeGo` | npm `opencode-ai` | 1.18.34 | MIT |
| Droid | `droidAgent` | npm `@factory/cli` | 0.230.0 | Factory proprietary |
| Grok Build | `grokAgent` | x.ai release binary, SHA-256 per architecture | 1.0.46 | Apache-2.0 |
| Cursor Agent | `cursorAgent` | downloads.cursor.com package, SHA-256 per architecture | 2026.10.01-e373342 | Cursor proprietary |
| Hermes Agent | `hermesAgent` | Python venv, editable install of the v2026.9.24 source archive (SHA-256) | 0.21.5 | MIT |

Not preinstalled, and why (the card then reads "Not available on this
server" instead of "Not installed"):

- **Antigravity** (`antigravityAgent`): Google's runtime is about 2 GB
  unpacked under Google's own terms; Sagax already downloads and verifies it
  itself (Settings) where it can run. On an organization server it would run
  its own tools on the Sagax host, so organization turns are refused anyway.
- **mmx-cli**: the MiniMax engine calls the API with a key; the CLI is only
  a sign-in helper and publishes no licence.

No install needed: Grok (API), OpenAI, OpenRouter and other
OpenAI-compatible endpoints, Mistral, Cerebras, MiniMax (a key each), the
Boat agent (runs on its cloud computer) and custom ACP agents (your own
command, above).

Proprietary CLIs (Claude Code, Droid, Cursor Agent) are part of the
production image (`ENGINE_SET=all`, the default). The image with none of
them is the explicit opt-out `ENGINE_SET=none` and
`SAGAX_REQUIRE_ENGINES=0`. At startup the server runs each baked CLI's
`--version` once, logs
it (`[engines] claude: 2.1.318 (Claude Code) (pinned 2.1.318, ...)`), and a
short set or a CLI that did not start also logs `[engines] engine_missing ...`.
It
uses that result as the engine's installed state, so no page or turn probes
it again. An instance with its own `config.cli` is still probed as before.
To move an engine to a new release, change its version (and hashes) in the
lock only.

## pi: model servers from Perspicax

On a server linked to Perspicax, every pi turn (and the model picker) asks
Perspicax which model servers serve the person
(`POST /api/v1/pulsabot/model-servers/resolve`, cached 60 s per person): the
organization's servers and the person's own. Each server becomes one pi
provider in that person's pi home (`PI_CODING_AGENT_DIR/models.json`):
`px-org-<instanceId>` or `px-own-<instanceId>`, `api` `openai-completions` or
`anthropic-messages`, the server's `baseUrl`, and each model with its context
window, output limit, input kinds and thinking level map. Other providers in
that file (a local host, your own) are kept.

```jsonc
{
  "providers": {
    "px-org-acme-models": {
      "api": "openai-completions",
      "baseUrl": "https://models.example.com/v1",
      "apiKey": "$SAGAX_PI_KEY_ORG_ACME_MODELS",
      "compat": { "supportsDeveloperRole": false },
      "models": [{ "id": "example-27b", "contextWindow": 262144, "maxTokens": 32768 }]
    }
  }
}
```

The key never lands on disk: `models.json` names an environment variable and
the value is in that turn's pi process only. A server with no link, or one
Perspicax cannot reach, leaves `models.json` as it was. The keyed providers pi
knows natively (xAI, Gemini, Moonshot, Mistral, Cerebras, Groq, OpenRouter,
Z.ai, MiniMax and more) come through the organization or personal key path
like the other engines.

## pi: a kit on the server

`SAGAX_PI_KIT_DIR` names a read-only folder an operator mounts into the
service. Every pi turn copies it into the person's pi home:

| Kit file | What a turn does with it |
|---|---|
| `extensions/*.ts` (`.js`, `.mjs`) | copied, each loaded with an explicit `-e`, also under the organization's `--no-extensions` |
| `settings.json` | merged into the home's `settings.json` (the kit wins key by key) |
| `APPEND_SYSTEM.md` | a template: `{{USER_NAME}} {{CW_MEMBER}} {{TIMEZONE}} {{LANG_NAME}} {{USER_ORG}} {{MAX_PARALLEL}}` filled from the person; a line naming a variable with no value is dropped |
| `tools/` | copied as is, for the extensions that read it |
| `packages.txt` | one pi package source a line (`#` starts a comment), each loaded with `-e` |
| `guards.txt` | one extension file name or package source a line (`#` starts a comment) that is a guard; a name with `guard` or `policy` in it is one too |

Values: `USER_NAME` the person's display name, `TIMEZONE` their time zone,
`LANG_NAME` their language in English, `USER_ORG` from `SAGAX_ORG_NAME`,
`MAX_PARALLEL` from `SAGAX_PI_MAX_PARALLEL`, `CW_MEMBER` from
`SAGAX_PI_CW_MEMBER` on a single-person server only. Host tools stay withheld
from organization turns as they are without a kit.

The image removes npm, so the kit's packages are installed at build time. The
default preinstalls `npm:pi-subagents@0.84.0`; name your kit's own list:

```sh
docker build --build-arg PI_KIT_PACKAGES="npm:example-pi-package@1.2.3" -t sagax .
```

They land under `SAGAX_PI_PACKAGES_DIR` (`/opt/sagax-pi-packages/node_modules`)
and a turn loads them from there, from `packages.txt` and from the
`packages` of `settings.json` alike. An `npm:` source not preinstalled is
passed to pi only when npm is on the server's PATH; without npm it is left out
with a warning in the server log, since pi would try to install it at startup
and stop before replying (#3008). Other sources (local paths, `git:`) are
passed as written.

When pi stops because one kit extension or package failed to load, the turn
runs again without that one; the others and every guard stay loaded. The chat
says which one was left out and what pi said, on every turn that runs without
it. The server remembers it until it restarts or the kit file changes, so the
next turns start pi once. A guard, the Sagax extension, or an extension Sagax
cannot name (one in the person's own pi home) never runs without: the turn
fails with pi's words in the chat (#3063).

## Notes

- `config.json` is written with mode 0600; values in `environment` are stored
  as plaintext in that file. Prefer keys scoped to the one engine.
- A typo'd `driver` or invalid `config` never breaks the app: the instance
  shows as unavailable with the reason, and the rest of the fleet loads.

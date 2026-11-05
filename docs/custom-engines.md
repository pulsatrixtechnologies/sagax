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

## Notes

- `config.json` is written with mode 0600; values in `environment` are stored
  as plaintext in that file. Prefer keys scoped to the one engine.
- A typo'd `driver` or invalid `config` never breaks the app: the instance
  shows as unavailable with the reason, and the rest of the fleet loads.

# Bot setup, model scope, and file continuity

```sh
pnpm exec vitest run server/setup-mode.test.ts server/bot-setup.e2e.test.ts server/bot-continuity.e2e.test.ts server/workspace/independent-threads-api.test.ts
SAGAX_UI_E2E=1 pnpm exec vitest run scripts/testing/control-omb-ui.e2e.test.ts
```

The server recipe launches the real app in a temporary home with only the
offline CLI. It sends actual messages through `control-omb`, waits for settled
turns, and checks the prompt and model delivered to the provider boundary:

- A named bot with no description or SOUL can receive a normal work request
  without the setup interview or its "Wait for a yes" instruction.
- `/setup Help me track garden watering` explicitly enables coaching; the next
  ordinary request disables it, even if no profile card was confirmed.
- A thread's model change with `updateBotDefault: true` updates the bot and
  every existing thread, including an old own model. Approval levels stay
  unchanged. Groups and future threads use this same bot model.
- Without that flag, only the selected thread changes. Group dispatch still
  uses the bot default. Busy group changes and invalid requests are rejected.
- Direct and room prompts carry the same saved identity and standing rules,
  plus explicit current/shared/sibling file locations. Old files are retained;
  working-directory pins and concurrent-thread isolation do not change.

The test prints a retained `.bot-continuity.json` evidence path with commands,
wait results, bounded transcripts, and provider-input receipts. Launch
environments and MCP tokens are not retained. The renderer recipe checks both
scope buttons in the real model picker, saves a screenshot, changes models,
checks server persistence, and sends a message through the composer.

Since 2026-10-30 the picker is a flat list of active models grouped by
provider in both the window and composer. The scope says that a choice
applies to every thread. Its only connection shortcut opens Settings >
Providers, where sign-in, installation and keys are managed. A signed-out
account's cloud models stay out, while a working local model stays available
through an engine that supports it. The hover and keyboard preview names
the model, provider and payer; the server supplies Auto's ordered dispatch
chain, exclusion reasons and the bot's configured recovery choices.

`src/components/ModelPicker.interaction.test.ts` verifies these controls and
`server/model-switches.e2e.test.ts` verifies the live preview when models are
disabled, when a bot is pinned and when nothing can run. The headless
composer smoke uses its flat rows and checks persistence and a real fixture
turn. The sections below describe earlier verification evidence.

### Signed-out Claude in the picker — 2026-09-26

After a Discord report that Claude could no longer be selected, the picker was
checked in the headless renderer (`control-omb ui launch`, a Vite preview and
a headless browser on a disposable fixture; no Electron, no real account):

```sh
FAKE_CLAUDE_AUTH=out node --experimental-strip-types scripts/control-omb.ts ui launch --mode not-logged-in
```

The fake CLI answers `auth status` with `loggedIn: false` and every prompt
with Claude's own "Not logged in" frame. Pepper is on that Claude.

- Opening the picker shows **Claude** on the rail with **Sign-in required**,
  the **Sign in to Claude** card and **Use a local model**; no Claude model row
  is offered. Before this fix the filter returned no engine at all for this
  fixture; that reproduction is now a test in `src/lib/engine-rail.test.ts`.
- **Use a local model** sent one `POST /api/instances/claude/refresh-models`
  and showed **Looking for local models…** (held for three seconds by delaying
  that request in the page), then **No local models found**.
- Sending `hello` on the signed-out Claude ends in the existing setup error
  with the **Sign in to Claude** card, not a silent failure.
- Two more accounts were added through `POST /api/instances/claude-accounts`.
  **Spare** and Pepper's own account were then pointed at a missing CLI with
  `PATCH /api/instances/:id`. The picker kept Pepper's account with its
  install card and the CLI-not-found reason, kept the signed-out, unused
  **Work** account (choosing it showed its sign-in card and did not change
  Pepper's model), and left **Spare** out.
- The browser console had no errors.

This proves the renderer and the fixture server's instance catalog. It does
not prove a real Claude Code sign-in, a real Ollama or LM Studio server, or
the Electron shell, and it is not a production qualification. The Electron
picker smoke's assertions were updated for these rules but were not run for
this change.

![Pepper's signed-out Claude in the picker](evidence/model-picker-signed-out/signed-out.png)

![Opening local models re-probes local servers](evidence/model-picker-signed-out/looking-for-local-models.png)

![Pepper's Claude with a missing CLI keeps its install card](evidence/model-picker-signed-out/missing-cli.png)

## Live Claude smoke — 2026-09-12

Separately, the exact system prompts captured from the disposable app were
replayed to the signed-in Claude CLI (Sonnet 5). These were synthetic requests,
not live user conversations. `--safe-mode`, `--restricted`,
`--strict-mcp-config` and `--no-session-persistence` disabled customizations and
saved sessions. Tools were disabled except for the final test, which allowed
only Read inside the disposable working directories.

| Request | Observed response |
| --- | --- |
| `What is 17 + 25? Answer with the number.` | `42` |
| Explicit setup for tracking garden watering | Asked about the job, timing, apps and folder |
| Find `garden-plan.txt` from earlier work, outside the current directory | Read the shared-bot file and returned its hidden verification code, `MOSS-42` |

An arithmetic control using the old automatic-setup block also answered `42`.
This does **not** reproduce every reported refusal, establish malicious intent,
or prove every provider behaves identically. The verified regression is the
unrequested coaching sent by OMB; live results confirm ordinary work, explicit
setup and cross-folder reading on the tested Claude model. Group model routing
and UI persistence use the offline provider. No real bots or files were moved.

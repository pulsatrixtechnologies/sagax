# Import an agent you already use

**New bot > Start from > Grok Bot or Claude Code…**, or **Import an agent** on
the "create your first bot" step of the guided first run, brings an existing
agent into Sagax as a new bot. Anyone who may create bots can do it. No admin
is needed, and in an organization the bot is the person's own.

The imported bot arrives **inert**:

- its skills are switched off until the person turns them on;
- its routines are paused until the person starts them;
- an app it used becomes an empty connection slot, which keeps only the
  address and the names of the values it needs;
- no key, token, password or sign-in comes over;
- it uses the person's own engines and approval level, not the source's
  model or permissions.

Nothing existing is changed: every bot it creates is new. A preview lists
what will be created and what was left out (with the original text, to
redo it by hand) before anything is created.

Under the hood both sources become an ordinary Sagax package
(`openmaus.package` v2) in the app. It is then staged and imported through the
same bot import as **New bot > Zip file…** (`POST /api/bots/import/upload`,
member scope), so the rules of `server/packages/package-import.ts` apply unchanged.

## From Grok Bot

What the public documentation says (docs.x.ai/grok-bot, read 2026-10-26):

| Fact | Status | Source |
|---|---|---|
| Grok Bot is xAI's hosted product for persistent bots ("AI teammates with names, jobs, and context"). | Confirmed | docs.x.ai/grok-bot/overview |
| There is **no documented export, download or backup** of a bot, its memory or its skills. | Confirmed (absence) | docs.x.ai/grok-bot (overview, bots, skills, computer) |
| A bot can be shared as a template; its public link "shows the Bot's shared configuration, including its identity, description, skills, and routines". Adding it copies it to the recipient's account. | Confirmed | docs.x.ai/grok-bot/bots |
| The format behind a template is not documented. | Confirmed (absence) | docs.x.ai/grok-bot/bots |
| A routine has an **Instruction** and a **When to run**. | Confirmed | docs.x.ai/grok-bot/skills-routines-and-automations |
| Private skills are one library shared by all of a person's bots; no file format is given. | Confirmed | same page |
| Instructions are set through the conversation; there is no separate field. | Confirmed | docs.x.ai/grok-bot/bots |
| Connector sign-ins live on the vendor's backend, not on the bot's computer. | Confirmed | docs.x.ai/grok-bot/computer-and-apps |
| A template carries instructions, selected memories, skills, routines and first-party integrations, not custom MCP servers or scripts. | Secondary source, not official | a third-party guide (2026-10-21) |

So Sagax does not parse an undocumented file. The person's own Grok Bot writes
its setup out:

1. **Copy export prompt** (`GROK_EXPORT_PROMPT`, `shared/grok-import.ts`) and
   send it to the bot on x.ai. It answers with one JSON block
   (`openmaus.grok/1`): name, description, instructions, skills, routines
   (the "When to run" in plain words plus a cron when it has a clock), the
   apps it uses, and memories only if the person says yes. It is told to
   write `[removed]` in place of any key or personal data.
2. Paste the reply, or choose it saved as a `.json` file. The format
   `grokbot-bundle/v1` of the community tool pi-grokbot-import is also read.
3. Alternatively, paste the bot's public link (`https://x.ai/bot/<id>`): Sagax
   reads only the public card (name, creator, description) and offers
   **Start from the description**.

Routines with a cron or a plain time ("weekdays at 9am") come over paused.
Routines that start on an event, and schedules that cannot be read, are
listed under Left out with their original text. Text that looks like a key is
replaced.

## From Claude Code

Choose the project folder (or your `~/.claude` folder). The app opens only
these files, from the public Claude Code layout (code.claude.com/docs):

| File | Becomes |
|---|---|
| `CLAUDE.md` or `.claude/CLAUDE.md` (else `AGENTS.md`) | The bot's standing instructions. A whole-line `@path` import of one of these files is inlined; an `AGENTS.md` next to a `CLAUDE.md` that does not import it is added under its own heading. |
| `CLAUDE.local.md` | Added under "Personal notes". |
| `.claude/skills/<name>/SKILL.md` | A skill (off). |
| `.claude/commands/<name>.md` | A skill (off): Claude Code treats commands as skills. |
| `.claude/agents/<name>.md` | One more bot per subagent: its `name`, `description` and body as instructions, plus the imported skills it names. Its `tools`, `model` and `permissionMode` are not carried: the new bot follows the person's own settings. |
| `.mcp.json` | Each `http` or `sse` server with a plain `https://` address becomes a connection slot, with the **names** of its headers only. A server that runs a command (`command`, `args`) is listed under Left out with its program and the names of the values it needs, never their values. |

A file that may hold a secret (`.env*`, `.envrc`, `.netrc`, `*.pem`, `*.key`,
`*.p8`, `credentials*`, `auth.json`, `.credentials.json`,
`settings.local.json`, SSH keys) is **never opened**. When it sits at the top
of the folder or under `.claude/`, it is named under Left out. Everything else
in the folder (source code, `node_modules`, ...) is not read.

## On iPhone and iPad

**Create New Bot > Import from Grok Bot** does the Grok Bot import: Copy export
prompt, send it to the bot on x.ai, paste its reply, Preview, Import. The phone
has no copy of the converter, so it sends the reply to
`POST /api/bots/import/agent` (`{ text, timeZone }`; `GET` gives the prompt):
the server makes the same package with `shared/grok-import.ts` and stages it
like an uploaded zip, for this person only, then the zip import's own
`/api/bots/import/:id` finishes. Same rights as the upload: anyone who may
create bots. The Claude Code folder import is desktop only.

## Left out, in the person's language

Every left-out line carries `nameKey`, `reasonKey` and `params` (catalog keys
`leftOut.*` in `src/locales`, and the same English templates in the iOS
`Localizable.xcstrings`), so the app shows it translated; the English text
stays as the fallback.

## Code

- `shared/grok-import.ts`: the Grok Bot export, the share link, the package.
- `shared/claude-code-import.ts`: the Claude Code folder to a package.
- `src/lib/claude-code-folder.ts`: which picked files are read.
- `src/components/AgentImport.tsx`: the dialog (New bot, guided first run).
  It reuses `GrokImportBox` and the bot import panel (`BotZipImport.tsx`).
- Settings > Backups no longer holds a Grok Bot import row (JC 2026-11-06).
- Tests: `shared/claude-code-import.test.ts`, `shared/grok-import.test.ts`,
  `src/components/AgentImport.test.ts`, `src/components/BotZipImport.test.ts`,
  `src/components/onboarding/GuidedFirstRun.test.ts`,
  `server/routes/team-library-grok.test.ts`.

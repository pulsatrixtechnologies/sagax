# The bot workspace

Every bot has a folder, `~/.sagax/workspaces/<botId>/` (`server/workspace.ts`). It is the
bot's desk and its long-term notes: plain markdown that a person can open, edit or delete
in any editor, and that the persona editor shows under **Rules**, **Memory** and **Files**.

## What each file is

| Path | What it holds | When the bot sees it | Budget | Edited in |
|---|---|---|---|---|
| `SOUL.md` | Who the bot is: standing instructions. Lives on the bot record; `~/.sagax/bots/<botId>/SOUL.md` is a mirror outside the workspace | Every turn, first | 24 KB | Persona > Soul (changes from the bot need the person's OK, `propose_profile`) |
| `RULES.md` | The first rule set: hard constraints the bot checks every turn ("never email a client without my OK") | Every turn while its set is on, right after the soul, before memory | 100 lines / 12 KB of loaded text per set; 250 lines / 24 KB for every set that is on | Persona > Rules, Files (owner or admin), or `rules_update` in chat |
| `rules/<set>.md` | The other rule sets, one file each | Every turn while the set is on, in the sets' order | same as RULES.md | Persona > Rules, Files, `rules_update` with `set` |
| `rules/.sets.json` | The sets' order, names and on/off switches (hidden) | Never | none | Persona > Rules |
| `MEMORY.md` | Facts that hold in every session | Every turn (while memory is on) | 200 lines / 24 KB | Persona > Memory, Files, `memory_update` |
| `memory/<topic>.md` | Longer notes on one topic | On demand; their names, titles and aliases are listed each turn | none | Memory, Files |
| `memory/archive.md`, `memory/log/<day>.md` | What moved out of MEMORY.md; what happened each day | Never loaded; `session_search` finds them | none | Memory, Files |
| `docs/<name>.md` | Reference material: procedures, templates, lists | On demand; each turn carries a short index | 256 KB per file (store cap) | Files, `docs_update` |
| `skills/<name>/` | Imported and learned skills | On demand; enabled skills are indexed each turn | skills index cap | Persona > Skills |
| anything else | Task output, downloads, project files | Never loaded | none | read-only in Files, with a download |

Where things go, in one line each:

- **Identity** (who the bot is, its tone, its job): Soul.
- **Hard constraints** (always, never, must ask first): Rules.
- **Facts** (preferences, decisions, people, accounts): Memory.
- **Reference documents** (a procedure, a template, a price list): `docs/`.
- **Step-by-step know-how** the bot should follow for a kind of task: a skill.

Team and organization rules will come from the Perspicax memory tiers (lot A.2, in
progress). `RULES.md` holds only the rules specific to one bot.

## The prompt order

`server/system-prompt.ts` builds every turn's system prompt (direct turn, room turn, and the
"what the model sees" preview) in this order:

1. Identity (the persona line)
2. Standing instructions (`SOUL.md`)
3. **Rules** (`RULES.md` and the other rule sets that are on, in order): `buildSystemPrompt`
   places a part with id `rules` right after the soul wherever a call site lists it
4. About the user, setup, files, computer, connections, team and the other sections
5. Memory (`MEMORY.md`, then the topic index)
6. **Documents index** (`docs/`)
7. Skills index, skill instructions, playbooks, mentions

The Rules block is delimited like the soul:

```
--- BEGIN RULES (RULES.md, 123 bytes) ---
# Rules
- Never quote a price.
--- END RULES ---
```

With more than one set (or a renamed one), each set gets its own block, named:
`--- BEGIN RULES "Client emails" (rules/client-emails.md, 120 bytes) ---`.

## Rule sets (2026-10-15)

`server/rule-sets.ts` keeps several named sets per bot. `RULES.md` is the first set (id
`rules`, shown as "Rules" until it is renamed), so a bot that had a `RULES.md` keeps it, its
prompt block and its journal history unchanged: nothing is moved. Every other set is
`rules/<id>.md`; `rules/.sets.json` holds the order, the names and the switches. Without that
file the list is `RULES.md` then any `rules/*.md`, all on; a file on disk that the manifest
does not name is listed, on, rather than ignored. Each set loads under 100 lines / 12 KB, and
all the sets that are on under 250 lines / 24 KB (about 6k tokens a turn at most, the size of
the Soul and Memory budgets); past the total, the last sets are cut or left out with a notice.
The persona editor's Rules section shows a gauge per set and for the total, and adds, renames,
switches, reorders and deletes sets through `server/routes/bot-rules.ts` (`/api/bots/:id/rules`,
the Soul's gate, audited as `bot.rules-set.*`; text changes are journaled). At most 20 sets.

HTML comments in `RULES.md` are notes for the person and never load, which is how the starter
template (three example rules inside a comment) costs nothing. Past 60 lines or 8 KB the
block is cut and followed by a notice naming the full size, like MEMORY.md. Rules are part
of the stable half of the prompt; the documents index is volatile, like memory, because
`docs_update` can add a document mid-conversation.

The documents index names at most 20 documents: `- docs/<name>.md: <first heading or first
line> (<size>)`, then "…and N more". The documents themselves never load.

A bot with neither `RULES.md` nor `docs/` gets the prompt it always had, byte for byte.

## Tools the bot has

All four are on the agents MCP server (`server/drivers/agents-catalog.ts`), served by
internal routes in `server/index.ts`:

| Tool | What it does | Guard rails |
|---|---|---|
| `rules_update` | append one rule, replace or remove an exact unique passage of a rule set (`set`: its name; default the first set) | only when the person asks in this conversation; one rule of at most 500 characters; a change that would not load whole (the set's budget, or the total for a set that is on) is refused (413); secrets redacted; not from a room fewer people can see; on a Cloud home only from the owner's conversations; three refusals close it for the turn; journaled as the bot's |
| `docs_update` | write, append, replace or delete `docs/<name>.md` | flat names only (no folders, no dot names); 256 KB per file; same room, Cloud home, refusal and journal rules |
| `workspace_read` | read a text file of the workspace by relative path, 64 KB at a time with `next_offset` | traversal (`..`), absolute paths, backslashes, hidden names, links and binary files refused; read-only annotation |
| `workspace_search` | full-text search over `docs/` | same FTS index as memory (`message-db.ts`, `memory_files`); `session_search` and automatic recall keep to memory files, `workspace_search` to `docs/` |

Every change through these tools, the editor or the bot's own file tools lands in the memory
journal (`server/memory/memory-journal.ts`) and can be reverted from Memory's history, exactly like a
memory edit.

## The Files category

`GET /api/bots/:id/workspace` (`server/routes/bot-workspace.ts`) lists the tree, `SOUL.md`
first. Each file carries:

- a badge: **Every turn**, **On demand**, or **Never loaded**;
- its size against its budget when it has one (`SOUL.md`, `RULES.md`, `MEMORY.md`);
- created and modified dates;
- **last used**: when the file last reached the bot, from a sidecar at
  `DATA_DIR/workspace-usage/<botId>.json` (outside the workspace, like the journal). The
  dispatch paths mark what a turn's prompt carried (`SOUL.md`, `RULES.md`, `MEMORY.md`), and
  `workspace_read`, `docs_update` and `rules_update` mark the file they touch. A read through
  the bot's own file tools is not seen;
- **Forgotten**: not loaded every turn, and neither used nor created in the last 30 days
  (daily logs are never marked).

`RULES.md` and `docs/` open in the markdown editor in place and save through
`/api/bots/:id/workspace/file`; `MEMORY.md` and `memory/` do too for a viewer who may edit
Memory (the admin memory routes). Every save has Memory's conflict check. Other markdown is
read-only; any other file downloads (`GET /api/bots/:id/workspace/download`). Documents can be
created, uploaded (`.md`), renamed (`POST /api/bots/:id/workspace/docs/rename`) and deleted.
Simple mode shows the list and the badges and leaves out their details.

## Permissions and clients

RULES.md and docs/ follow the Soul's gate (2026-10-09: members manage their own bots).
The workspace routes (`/api/bots/:id/workspace`, `/workspace/file` for RULES.md and
docs/<name>.md, `/workspace/download`, `/workspace/docs/rename`) are open to a client session
in `server/request-auth.ts`, and the handler lets through only an admin, the bot's owner or
someone granted edit on it, never a person who may only use shared bots (`ownerOrAdminOf`,
like `PATCH /api/bots/:id {soul}`). MEMORY.md and memory/ stay on the admin memory routes. In
the persona editor Rules and Files lock on the Soul's field (`canEditBotField(..., "soul")`);
inside Files, memory files edit in place only for a viewer who may edit Memory. The bot's
own tools keep the memory restrictions. The org server, the solo server and the desktop
remote client use the same routes. iOS is not in scope yet: rows WS1 to WS4 of
`docs/superpowers/specs/2026-10-03-ios-feature-parity-matrix.md`.

The bot zip export includes `RULES.md` and `docs/` by these exact names.

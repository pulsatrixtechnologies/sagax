# Content encryption at rest

Conversations are encrypted in the message database (`DATA_DIR/messages.db`)
with a content key per person, and a key of its own for each confidential
thread. Deleting a person or a confidential thread destroys its key, so what
was sealed under it never opens again (cryptographic erasure). Search and
recall keep working through a blind index: keyed tokens, never text. The
bots' memory, the attachments and the event logs are sealed with the same
keys ("Files and logs" below).

Code: `server/content-crypto.ts` (sealing, blind tokens),
`server/content-keys.ts` (keys and their wrapping),
`server/content-key-azure.ts` (Azure Key Vault),
`server/content-encryption-env.ts` (settings), `server/message-sealing.ts`
(row shape, recall terms, snippets), `server/message-db.ts` (reads, writes,
migration, erasure), `server/message-search-query.ts` and the search worker,
`server/content-export.ts` (backups), `server/content-file-crypto.ts` and
`server/content-at-rest.ts` (files and logs). Tests:
`server/content-encryption.test.ts`, `server/content-at-rest.test.ts`.
Benchmarks: `node --experimental-strip-types scripts/bench-content-encryption.ts`
(transcripts) and `scripts/bench-content-at-rest.ts` (files and logs).

## Settings

All by environment, read at start. Nothing here names a vault, tenant or
organization; the operator supplies their own.

| Variable | Values | Default |
|---|---|---|
| `SAGAX_CONTENT_ENCRYPTION` | `on`, `off` | `on` |
| `SAGAX_CONTENT_KEY_PROVIDER` | `local`, `azure-keyvault` | `local` |
| `SAGAX_CONTENT_KEY_AZURE_KEY_URL` | `https://<vault>.vault.azure.net/keys/<name>[/<version>]` | none |
| `SAGAX_CONTENT_KEY_AZURE_ALG` | `RSA-OAEP-256`, `RSA-OAEP`, `A256KW` | `RSA-OAEP-256` |
| `SAGAX_CONTENT_KEY_AZURE_CLIENT_SECRET` | a client secret (or `AZURE_CLIENT_SECRET`) | none |
| `SAGAX_CONTENT_AT_REST_GRACE_MS` | idle time before a file written plain is sealed (files and logs, below) | `600000` (10 minutes) |

**On by default.** A new installation writes sealed rows from the first
message. An existing one migrates in the background (below), reversibly.
`SAGAX_CONTENT_ENCRYPTION=off` is the way back: the migration opens every
sealed row back to plain, a little at a time, and new rows are written plain.

**Key-encryption key (KEK).**

- `local`: the vault key the encrypted MCP sign-in store already uses
  (`resolveVaultKey` in `server/mcp-oauth.ts`): on the desktop the OS
  keychain through Electron safeStorage (`SAGAX_MCP_OAUTH_KEY`), on a
  headless server a 0600 key file in the data folder. A derivation of its
  own (HKDF, `sagax content kek v1`) wraps the content keys (AES-256-GCM).
- `azure-keyvault`: each person's content key is wrapped and opened by Key
  Vault (`wrapKey` / `unwrapKey`, REST API 7.4), so the key that opens the
  transcripts never sits on the server's disk. Credentials, first match
  wins: a client secret (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, the secret
  above); workload identity (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_FEDERATED_TOKEN_FILE`, `AZURE_AUTHORITY_HOST`, as AKS sets them);
  a managed identity (`IDENTITY_ENDPOINT` + `IDENTITY_HEADER`, else the
  instance metadata service; `AZURE_CLIENT_ID` picks a user-assigned one).
  The identity needs the key permissions `wrapKey` and `unwrapKey` only.
  Keys are unwrapped once at start, before the store reads a transcript; a
  key created later is wrapped asynchronously and the rows written meanwhile
  stay plain until the migration seals them. Switching from `local` to
  `azure-keyvault` (or back) re-wraps the existing keys at the next start;
  the local key keeps opening rows it wrapped until then. A wrapped key
  records the Key Vault key version that wrapped it, so a rotated key keeps
  opening older content keys; a row naming another vault is refused. The
  access token stays in memory; no token, secret or key is ever logged.

A misconfigured provider (an unknown name, Key Vault without a key URL)
stops the server at start with the variable to fix.

## Keys

| Key | Owner | Wrapped by |
|---|---|---|
| owner key | a person (`principals.json` id); the workspace (`@workspace`) for rooms, unowned threads and receipts | the KEK |
| thread key | one confidential thread | its owner's key (AES-256-GCM) |

A thread's owner is its recorded person (`ownerPrincipalId`), else on an
organization server the bot's owner, else the workspace (a solo or desktop
install has one person, so one key in practice). A thread keeps the key its
rows were sealed with (`thread_keys`); turning it confidential or giving it
an owner (`assignTaskOwners`) gives it its new key at once, and the migration
re-seals its older rows. Keys live wrapped in `content_keys` in
`messages.db`; unwrapped, they stay in the server's memory only.

## Row format

A sealed row keeps its columns (`thread_id`, `id`, `at`, `role`, `kind`)
and adds:

- `sealed`: version byte `0x01`, 12-byte IV, 16-byte tag, then AES-256-GCM
  of the whole message JSON (text included). The additional data is
  `sagax-content:v1 \0 key id \0 owner \0 thread id \0 message id`: a
  blob copied to another row, thread or person does not open (the row reads
  as absent, and one line, without content, says so);
- `key_id`: the content key;
- `text`: empty;
- `json`: a cleartext projection with only what the server's own SQL filters
  on: `id`, `at`, `role`, `kind`, `sealed: 1`, `hasText`, `from.name` and
  `from.botId`, `peerAsk.name`, `relayed`, `sendId`, `webhookPost`,
  `goalRun.status`, the open-card flags (`card.requestType`, `requestId`,
  `answered`, `dismissed`, `expired`) and `refs` (stored attachment names
  the message points at, for `threadsReferencing`).

A plain row has `sealed` and `key_id` empty: a database never encrypted
reads exactly as before, and every read accepts both. Receipts
(`command_receipts.result`) and queued follow-ups (`chat_followups.payload`)
are sealed as text fields (`sagax-sealed:v1:<key id>:<base64>`, additional
data naming the field, its key and its id).

A row whose key was destroyed is skipped by every read (erased, never
wrong). A key that exists but cannot be unwrapped on this launch (the
keychain unreadable, Key Vault unreachable) makes a read fail
(`ContentKeyUnavailable`) rather than show an empty or partial transcript,
and new rows are written plain until the key is back.

## Search and recall

Nothing is reduced: substring search (`/api/search`, the sidebar), ranked
recall (`session_search`, automatic recall, `recentMessages`,
`readMessageText`, `latestSaidByBot`) and the attachment checks work on
sealed and plain rows alike, mixed during a migration.

- **Substring search**: every sealed text row (and activity chip, by its
  tool name) has a keyed Bloom filter of its three-character windows
  (`message_index.bloom`: one bit per window, AES-256 of the window under
  the key's index key, twice as many bits as windows, 256 at least). The
  search worker, given the unwrapped keys in memory, keeps the rows whose
  filter holds every window of the needle, opens them newest first and
  confirms the substring on the text (same snippet and highlight). A
  needle under three characters opens the sealed rows newest first until
  it has its hits.
- **Recall**: the keyed words of text and digest rows (and their first four
  letters, for a prefix stem) are in a contentless FTS5 table
  (`messages_sealed_fts`, `detail=column`), so bm25 ranks them as before;
  the candidates are opened, checked against the query and snippeted
  (matched words in brackets) from the text.
- Tokens are written just after the row, in slices of a few milliseconds
  (a streamed reply is indexed once, not per patch), and always before a
  search, a recall or a backup reads them.
- Deleting a row (or re-sealing it) removes its index rows (triggers);
  destroying its key leaves any token that remains in an FTS segment
  meaningless.

**What the index still reveals** to someone holding the database file
without the keys: per row, which keyed words recur and how often, which
rows share a word or a four-letter prefix (with one owner's key), and how
long a row's text is (its filter size). Not the words themselves, and
nothing across two people's keys.

## Migration

A background loop on timers, about 4 ms of work then a 20 ms pause (a
sixth of one core while it runs). `on`: plain rows are sealed (each batch
checks that the sealed copy opens to the same message before it replaces
it) and rows under an older key are re-sealed under their thread's key.
`off`: sealed rows are opened back to plain. Receipts and follow-ups follow.
A pass runs at start and after any key change; reads accept both states
throughout. While rows are sealed, `PRAGMA secure_delete` is on, so the
plain cells they replace are zeroed.

After a pass that sealed plain rows, the next start (before the server
serves anything) rebuilds the plain full-text index (`messages_fts`, whose
segments could still hold words of the rows just sealed) and runs one
`VACUUM` (free pages written before the pass can still hold old text), then
checkpoints the write-ahead log (`vacuumAfterSealing`; skipped above 1 GB,
retried at the next start).

## Erasure

- **A person** (`DELETE /api/me`, the provider's purge, `erasePersonDataNow`
  in `server/index.ts`): after their threads go, `eraseContentOwner`
  re-seals any thread still bound to their key that now belongs to someone
  else (a bot that changed hands), then deletes the rows still sealed under
  their keys and destroys their owner key and every confidential-thread key
  under it.
- **A confidential thread** (`deleteThread`): its rows go, and its own key
  is destroyed with them.
- **Any thread**: its rows, receipts and key binding go (`deleteThread`).

A key is destroyed by deleting its row with `secure_delete` on, then
truncating the write-ahead log. This erases within the live database: a
copy made before (a disk snapshot, a copy of the data folder) still holds
the wrapped key of that time and opens with the key-encryption key, which an
erasure does not change. The workspace backup is in the clear by design
(above) and follows its own retention.

## Backups

The workspace backup (`server/workspace-backup.ts`) exports the message
database in the clear, inside the archive it already encrypts with the
backup password, as before this change: the server hands its unwrapped keys
to the backup worker in memory (`contentKeysForExport`), the snapshot copy
is opened (`unsealDatabaseCopy`), and keys, bindings and blind index are
dropped from the copy. A key the server cannot open at that moment fails the
backup instead of leaving conversations out. A restore brings plain rows,
which the destination's own migration seals under its own keys, so an
archive restores on any machine. A raw copy of `messages.db` made outside
Sagax is sealed, and opens only with that installation's KEK.

## Performance

`scripts/bench-content-encryption.ts`, synthetic text (about 1 KB a message,
25,000 rows), medians, macOS arm64, Node 26 (2026-10-26, on a shared host:
compare columns, not absolute values):

| Measure | Off | On |
|---|---:|---:|
| append (row + branch head), p50 / p95 | 0.11-0.16 / 0.40-0.50 ms | 0.09-0.10 / 0.12-0.17 ms |
| blind index, background, per row | none | about 0.2 ms, in 6 ms slices |
| streamed patch, p50 | 0.30-0.38 ms | 0.20-0.21 ms |
| read a 5,000-message thread (cold) | 15-20 ms | 29-30 ms |
| read the newest 100 | 0.3-0.5 ms | 0.6-0.7 ms |
| substring search, word present / absent | 54-71 / 49-57 ms | 57-77 / 35-42 ms |
| substring search, two characters | 88-102 ms | 38-40 ms |
| search through the worker | 49-56 ms | 37-46 ms |
| recall (any terms) | 4-5 ms | 7-9 ms |

Writes are faster sealed: the plain full-text index tokenizes every write in
the transaction, the blind index runs just after it. Opening costs about
2.5 µs a message, seen only on a cold read of a whole long thread (the
store keeps it in memory after). Migrating 15,000 rows took 6-13 s on a quiet
host (40 s on a saturated one) in steps of 6-11 ms (p95 about 20 ms; a WAL
checkpoint or FTS5 merge now and then makes a step of 100-300 ms), and the
next start's rebuild and VACUUM took 0.2-0.5 s (0.8 s saturated). `off`
took 6-12 s, with steps up to a few hundred milliseconds (1.3 s once on a saturated host) when FTS5 merges
the plain index it refills.

## Files and logs

What the server keeps outside `messages.db` is sealed with the same content
keys (`content_keys`, the same KEK, no second key store), reversibly, by the
same setting (`SAGAX_CONTENT_ENCRYPTION`).

| What | Where | Key | Read by |
|---|---|---|---|
| bot memory | `workspaces/<bot>/` `MEMORY.md`, `memory/` (topics, daily logs, archive), `docs/` | the bot's owner on an organization server, else the workspace | the prompt, the Memory editor and journal, search; the engine's own file tools |
| memory index | `memory_files` in `messages.db` | the same | `session_search`, automatic recall, `workspace_search` |
| memory journal | `memory-journal/<bot>.ndjson` (each row keeps the full prior text) | the same | Memory panel, revert |
| group memory | `group-memory/<group>/MEMORY.md` | the workspace | the room's prompt and editor |
| attachments | everything under `attachments/`: uploads, generated files, scaled pictures (`.model/`), an Office document's pictures (`.office/`), archive manifests (`.archives/`) and unpacked archives (solo) | the uploader on an organization server (known at upload), else the workspace | downloads and previews (streamed), copies to a person's computer or server environment, the Office, picture and archive readers, the drivers; the engine by path |
| event logs | `events/<thread>.ndjson`, `native/<thread>.ndjson` | the thread's key, as its messages | inspector, Activity, session ids |
| decision log | `decisions/YYYY-MM.ndjson` | the row's thread, else the workspace | Activity, Journal, History |
| admin activity | `admin-activity/YYYY-MM.ndjson` | the workspace | Activity, the organization audit |
| video jobs | `video-jobs/<jobId>.json` | the job's thread | video generation resume and status |
| held steers | `held-steers/<threadId>.json` | the thread's key | restart recovery of messages accepted into a running turn |

**File format** (`server/content-file-crypto.ts`): a header (`SGXF`, version,
chunk size, key id, context) then AES-256-GCM chunks of 64 KiB, each with its
own nonce and tag. The additional data of a chunk is the key, its owner, the
file's context (an attachment's stored path, `memory/<bot>`), the chunk's
index and whether it is the last one: a chunk moved, dropped or cut off, or a
file copied to another place or another bot, does not open. A file is sealed
and opened as a stream, never whole in memory, and a byte range (the audio
route's `Range`, a download) opens only the chunks it covers.

**Log lines** are sealed in blocks, one physical line per record kept (so
counts, line numbers, the organization audit's ids and a rotation that cuts
on a line boundary stay as they are): every line of a block but the last is
`{"sb":"<block id>"}`, and the last one is
`{"sb":"<block id>","n":<count>,"l":<length>,"sealed":"<key id>:<base64>","p":[<projections>]}`,
the AES-256-GCM of the block's original lines, byte for byte (additional
data: key, owner, folder and file name, block id, count and the projection
text: a block moved, cut or with a projection edited does not open). A
reader opens a block once for all its lines (`LogReader`), reading the line
by offsets (the base64 is never scanned). The projection keeps what readers
filter on before opening: an event's `type`, `createdAt` and `itemType`; a
native message's `at` and `dir`; a decision's `at`, `threadId`, `botId`,
`decision`, `source`; an admin row's `at`, `category`, `action`; a journal
row's `id`, `at`, `kind`. A reader that drops a record by those fields does
not open its block (the Activity view opens only the blocks that hold a
tool's start or end, and only the bot's own decisions). Every line is
sealed and on disk when its append returns, as durable as a plain one:
nothing waits in memory. What one append brings is one block (a batch of the
bus); a log appended a line at a time (the native tee) has blocks of one,
which the migration gathers into blocks of 64, checked line for line before
it replaces anything, once the log has been quiet for a minute.

**A view reads from memory what it just read**: the inspector and Activity
read a log's tail from the disk once, opening only the blocks the range
covers; that tail, opened, stays in this process's memory (at most 2,000
lines a log, 16 MB in all, 5 minutes) with what this process appends to the
log since (the writer holds that text already), so the view's next read of
a log being written needs neither the disk nor the cipher. Blocks a reader
opened are kept the same way (16 MB, 5 minutes) and the content keys stay
unwrapped in memory as before. A file changed by anything else (another
writer, a rotation, the migration) no longer matches and is read from the
disk again; a key that changes or goes, an erasure and a deleted thread
empty that memory; the migration's own checks always read the disk.

**Every reader opens both kinds**: `readAtRestSync`, `readMemoryText`,
`atRestStream` (`openMessageFile(...).stream()`), `LogReader`. A plain
file reads exactly as before.

**Writes are not slowed**: a new or edited file is written plain, as before,
and the background migration seals it once idle (`GRACE_MS`, 10 minutes since
its last write or use); a log line is sealed as it is appended (a batch of
the bus as one block); a record whose key is not available yet is written
plain and sealed later.

**Engines read by path**, so a turn holds its files plain in place
(`holdPlain`, `holdBotMemoryPlain`), never on the turn's path: they start
opening as soon as the person types in or opens the conversation (the
composer's warm request) and again when the turn starts, on a later turn of
the event loop, and the turn does not wait for them (an engine reads a file
only at a tool call, seconds after it starts; the server's own readers open
sealed files themselves). The files: the bot's memory, this message's
attachments and pictures (and their scaled copy, Office pictures, unpacked
archive), and in solo the earlier attachments of the thread. The turn waits
only for what is read by path before the engine starts: an attached archive
in solo (its listing) and the pictures of an engine that takes a picture by
path. On an organization server an engine works on copies made in the
person's computer or server environment, which are plain there, as before.
The turn's end (`releasePlain(turn:<thread>)`, at `turn.completed`,
`session.exited` or a failed dispatch) lets them go; the migration seals
them again once idle. A hold with no turn that runs (a conversation opened,
nothing sent) lets go after 10 minutes, a turn that never said it ended
after 6 hours. Opening for a turn skips the fsync: the sealed original stays
as a hard link in `.at-rest-originals/` until the file is sealed again, and
a plain copy that a power cut left empty or zeroed gets it back; an original
whose file was removed goes with it.

**Migration**: a background loop (a slice of synchronous checks then a turn
of the event loop, a 20 ms pause every 8 files or MiB) seals plain files,
re-seals a memory file whose bot changed hands, and with `off` opens every
file and line back to plain. Each replacement writes a hidden sibling, reads
it back and compares it with the original byte for byte (opened, for a
sealed one), checks the original did not change and is not held by a turn,
then renames it over the original (atomic), keeping its time, so nothing that
judges a file by its time (the memory index, a scaled picture) redoes its
work. A log is rewritten the same way, line for line, with the lines
appended during the copy carried over in a last short step. An upload keeps
the key it was sealed with. A key that is not available (Key Vault not
answering, a key not created yet) leaves the file exactly as it was, plain
(`on`) or sealed (`off`), and the pass is tried again. The memory index rows
migrate with the transcripts (`runContentMigration`), verified the same way.

**Key not available**: a read of a sealed file or line fails
(`ContentKeyUnavailable`, 503), never as an empty file: a memory read that
fails is never answered as empty memory, so neither the editor nor a memory
update writes over it (`isAtRestRefusal`).

**A thread that changes hands** (its person, its bot's owner, or turning
confidential: `contentOwnerChanged`) is re-sealed whole under its new key in
the change itself, synchronously, before anything can be erased: its rows,
queued follow-ups, event and native logs, decision rows, the attachments its
messages show (under the new owner's key, never a confidential thread's own:
another thread may show them) and, for a bot that changed owner, its memory.
A confidential thread's old key is destroyed once nothing is under it. A key
not available at that moment (Key Vault creating the new owner's) leaves
that content in the clear, never under the old owner's key.

**Erasure**: a person's erasure destroys their keys, so their bots' memory,
their uploads and the lines of their threads that are still sealed under
them never open again. It never takes someone else's data: whatever of a
thread now someone else's is still under the erased person's keys is first
re-sealed whole the same way, a bot's memory that now belongs to someone
else under its new owner's key, and an upload another conversation still
shows under the workspace's. Deleting a bot removes its workspace, journal
and index rows; deleting a thread removes its logs; a confidential thread's
own key goes with it.

**Backups**: the archive carries these files and logs in the clear, inside
its password encryption (`exportPlainCopy`), with the keys the server hands
the backup worker; a key that exists but cannot be opened fails the backup.
The migration pauses while the folder is copied; the hidden siblings and
kept originals are never exported. A restore brings plain files, which the
destination's migration seals under its own keys.

**Still plain**: a file while a turn holds it (and up to 10 minutes after;
an opened conversation with no turn, 10 minutes); in the server's memory only,
the tail of a log a view read and the blocks it opened, for 5 minutes;
the copies staged on a person's computer or in their server environment;
conversation work folders (`task-workspaces/`) and the engines' own
transcripts; logs that carry no content by design (usage ledger, problem
log, remote-control and terminal audits, the decision model's log).

**Performance** (`node --experimental-strip-types scripts/bench-content-at-rest.ts --before <main checkout>`,
synthetic text, macOS arm64, Node 26, 2026-10-27. Paired: each pass runs
main, off and on one after the other in the same minute, 6 passes; medians,
and the ratio is the median of each pass's on / main. "On" reads what the
migration already sealed; logs written as the server writes them, every line
on disk when its append returns: the native tee a line at a time, the bus 4
events per append; "while being written" appends 8 native lines and a bus
batch between two reads of a view):

| Measure | Main | Off | On | On / main |
|---|---:|---:|---:|---:|
| memory write (8 KB, index included) | 7.8 ms | 7.5 ms | 7.3 ms | 0.99 |
| memory read (MEMORY.md) | 0.018 ms | 0.029 ms | 0.009 ms | 0.47 |
| memory in the prompt | 0.67 ms | 0.74 ms | 0.71 ms | 0.96 |
| memory search | 0.32 ms | 0.35 ms | 0.36 ms | 1.12 |
| what a turn waits for memory / a sealed 20 MB attachment | n/a | 0.008 / 0.04 ms | 0.006 / 0.07 ms | |
| upload 1 MB / 20 MB | 1.3 / 10.1 ms | 4.4 / 10.5 ms | 1.6 / 10.4 ms | 1.27 / 1.02 |
| download 1 MB / 20 MB | 0.8 / 7.0 ms | 0.9 / 6.7 ms | 1.1 / 8.7 ms | 1.49 / 1.26 |
| inspector 300 lines, log being written | 0.60 ms | 0.64 ms | 0.53 ms | 0.91 |
| inspector 2,000 lines, log being written | 5.4 ms | 3.8 ms | 2.8 ms | 0.53 |
| inspector 300 / 2,000 lines, log quiet | 0.53 / 5.3 ms | 0.51 / 3.6 ms | 0.41 / 2.7 ms | 0.76 / 0.51 |
| Activity, being written / quiet | 2.6 / 2.6 ms | 1.6 / 1.6 ms | 1.2 / 1.2 ms | 0.48 / 0.45 |
| inspector 2,000 lines, first read after the migration gathered the log | 5.1 ms | 3.4 ms | 28 ms | 5.6 |
| native tee append, per line (calm host, 3 pairs) | 32-35 µs | | 40-42 µs | 1.19 |
| bus append, per event (calm host, 3 pairs) | 7-16 µs | | 9.5-10 µs | 1.3 |

Migration (640 files and 20 logs, 57 MB): 8 s (7 MB/s, paced), event-loop
delay p99 2 ms, longest 6 ms; back to plain in 8 s.

Every read a view repeats is at or below main (the tail and the blocks it
opened stay in memory, and the tail reader no longer rebuilds its window at
every chunk). Still above main: an append, by one AES-GCM per append and its
base64 framing (+7 µs a native line, +2 µs a bus event: the price of a line
sealed and on disk when the append returns); the first read of a log the
migration just gathered, which opens every block it shows (once, then
memory); and a sealed attachment's download (+0.3 ms on 1 MB, +1.7 ms on
20 MB), which opens its chunks as it streams.

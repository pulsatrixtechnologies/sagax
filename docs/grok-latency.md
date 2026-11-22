# Grok turn latency: where the time goes

Measured on the production server (<HOST_FQDN>), 2026-10-11, main-e002b38d.

## Reading a turn from the logs

Every ACP turn logs one line when it settles (server/drivers/acp/turn-latency.ts):

    [turn-latency] grokAgent thread=800b207c path=pooled queue=99ms setup=21ms ttfa=1150ms ttft=1150ms tools=1 total=2111ms prompt=1655ch full=no in=18225 cached=16000 stallGuard=10000ms ok

- queue: the message was stored -> the engine took the turn (context, recall, place).
- setup: engine took it -> prompt sent (spawn, handshake, session/new or session/load, mode, model).
- ttfa / ttft: prompt -> first streamed update / first answer text. This is the provider.
- path: pooled (live session prompted as is), load (pooled process, session re-established; text turns rotate MCP tokens), spawn (new process).
- full: the prompt carried the whole system block (new session, changed stable half, re-anchor).
- in / cached: the provider's input tokens and the cached share.
- stallGuard: how long a silent prompt is given before Sagax cancels and asks once more.
- spawnWhy (#4394): on a spawn only, why no warm engine took the turn: `first` (no engine
  process of this conversation since this server started), `closed:<why>` (Sagax closed its
  process: `idle`, `warm-budget`, `call-ended`, `stop`, `reestablish`, `rpc-failure`...),
  `exited:<code or signal>` (it ended on its own, between turns or at the end of the last
  one, or the system stopped it: `exited:sigkill`), `instance` (its process runs under
  another engine of this server), `closing` (its process was being closed when the turn
  came), `contract:<fields>` (started for another command, variables or tool scope:
  `envFingerprint`, `cwd`, `spawnArgs`...), `budget`, `tools` (an engine that restarts for
  changed tool servers) or `reset`. Every way a process goes leaves its reason, so `none`
  (the reading of 0.8.125, which also covered a process that had exited on its own) is gone.
- conv (#4394, on the turn's `[omb-turn]` start line, joined to this line by `thread=`): which
  conversation the turn runs in: `chat` (a person's message in the bot's one conversation),
  `routine`, `hidden` (an AI client's conversation; each of its asks opens a new one),
  `opened` (a thread a bot opened: a teammate's job, a pair conversation), `parallel`,
  `confidential`, `closed` or `unknown`. Only `chat` turns are a person's follow-ups; the
  others start their own engine and opening block by design.
- fullWhy (#4394): on a full=yes turn, why the whole opening block rode: `new:<why>` (a new
  native session: `no-cursor`, or the conversation's session could not be loaded:
  `load-failed`, `load-timeout`, `load-empty`, `load-model` when it was kept on another
  model), `unsent` (a session with no record of its opening block), `stable` (the stable
  half changed) or `anchor` (the periodic re-anchor). A process started again that loads the
  conversation's own session sends only the request and what changed (full=no).
- firstWords (#4394): what the stream did between its first update (ttfa) and the first answer
  text, in ms: `think` (reasoning streamed), `tool` (a tool running, from its
  call to the update that says it completed or failed, however long it is silent), `quiet`
  (any other gap of a second or more between two updates). The engine's own start and its tool
  listing are setupBy's `init` and `tools`.
- ttfc / shown / sent (#4456): ttfc is the prompt to the first tool call, on a turn that
  called one (a ttfc under ttft: the model chose a tool before any words). shown is the
  person's message to the first answer text Sagax streamed to them, queue and setup
  included: the wait for words as the person lives it. sent, on a full=no prompt, names the
  opening block's sections that rode it because they changed (nothing else of the block is
  sent again; `cached` says how much of the input the engine's cache held). The work style
  asks the model for one sentence of its own, saying what it understood and does, before its
  first tool call, so a turn that starts with tools still shows words at once.
  server/first-text-latency.e2e.test.ts (`pnpm vitest run server/first-text-latency.e2e.test.ts
  --silent=false` prints each turn's line) holds the target with a fake engine that has a
  model's timing and a prompt cache (fake-acp-cli.ts `FAKE_ACP_MODEL_MS`): a warm no-tool follow-up shows its first
  text in under 3 s, and a second conversation of the same bot finds the stable part of its
  opening block in the cache.
- queueBy / setupBy (#3561): the parts of queue and setup in ms, from the turn's own step marks
  (server/turns/turn-trace.ts), each step closing the part it names; a part the turn did not
  reach is left out, and the parts add up to the stage.
  - queueBy: admit (checks before the turn starts, and since #3679 the message's admission and
    the claim after them), prewarm (a warm being joined), engines (#3679: the engines' list
    read once after a start), compact (the fold check only, since #3679),
    context (selection, soul, skills), mcp (the tool servers' sign-in refresh and probe),
    connector (the account's connection, and the turn's connectors plan), place (workspace, sandbox, mounts), plugins
    (starting the plugin copy into the person's environment: since #4456 the turn never waits
    for it, what needs the plugins waits for the copy itself), prompt, recall,
    access (the turn's credentials, a typed command), slot (an engine start slot), send,
    dispatch (pictures, hand-off to the engine).
  - setupBy: prepare (sign-in check, command, spawn contract), init (process start and
    handshake), session (session/new or load), model (model and mode), tools (Grok's tool
    servers answering, the wait kept since hotfix 0.5.10), prompt (the rest until the prompt
    is sent).
- toolsBy (#3623): which tool servers the tools part waited for, right after setupBy. Each
  of the servers Sagax mounts for the turn by its product name (`agents`, `browser`,
  `perspicax`...; a mount under any other name, which may carry a person's or a bot's
  identifier, prints as `connector`) with the ms from the wait's start to the first poll of
  `_x.ai/mcp/list` after the last poll where it was seen waiting (pending, connecting,
  starting or initializing, the status Grok 1.0.77 gives a server it is still starting),
  slowest first, at most eight. A server never seen waiting prints nothing for
  itself: at the first poll the engine has often not begun to connect anything (a server has
  no state yet), and the first reading of this field (it printed every server at the first
  poll's 40 to 175 ms while the wait lasted 2.6 to 3.1 s) counted that as settled. Then the
  other servers of the engine's catalog (the person's own connections of their engine
  account) as one entry `own:<count>:<longest ms>`, never by name, `resolved:<ms>`, the first
  poll where the engine said its tool servers were resolved (`sessionMcpResolved`), and
  `pending:<count>` when the wait ended on its limit with servers still connecting. When
  every server's time is well under `resolved`, the wait went to the engine's own resolve.
  The poll interval (50 to 100 ms plus the request) bounds the precision. A turn that skipped
  the wait (a reused session) or waited under 50 ms prints no toolsBy.
- toolsServed (#3623): Sagax's own side of the same wait, right after toolsBy. Each of its
  endpoints a mount reaches (`data`, `browser`, `messages`, `perspicax`, `sagax-computer`,
  `sagax-desktop`, `sagax-environment`, `computer`; a connector's or a person's own server
  relayed by Sagax as `connector`) as `<mount>:<first request>-<tool list answer>`, in ms from
  the wait's start, in order of arrival, at most eight; a mount whose tool list was not
  answered during the wait prints its arrival only. The request in the server's internal
  route (server/request-pipeline/run-internal.ts) notes the mount by its turn capability's
  kind into the turn's trace (server/turns/turn-trace.ts) while the wait is open; mount names
  and milliseconds only, never a request's content. A mount that got no request during the
  wait is not printed: `agents` answers its tool list inside its own process, so it never
  shows here. `browser`, `data` and `computer` on their streamable HTTP route note their
  first request there (`initialize`, which that route answers itself); a mount whose stdio
  proxy answers `initialize` itself (`messages`, `sagax-computer`, `sagax-desktop`,
  `sagax-environment`) can only show its `tools/list` as its first request. It says whether the engine connects its servers one after the other, which of
  Sagax's endpoints is slow, and how long the engine takes before its first request. A
  reused session prints no toolsServed.
- toolsSlow (#3623): right after toolsServed, the parts of each of those endpoints whose tool
  list took more than 250 ms from its first request, `<mount>:<part>:<ms>,...`, mounts
  separated by `;`. Today the relayed `connector` mount (a person's own or a plugin's server
  command, run in the person's environment by server/sandbox/sandbox-stdio-mcp.ts) names
  them: `env` (the plugin copy into the person's environment), `open` (the stream to the
  server's new process), `hello` (the server's answer to initialize), `list` (its answer to
  tools/list) and `kb` (that answer's size). Example of a first turn after a server start:
  `toolsSlow=connector:env:12,open:410,hello:230,list:980,kb:85`. What the parts leave out is
  the engine's own proxy start and the hops between the proxy and Sagax. Names and numbers
  only.
- toolsGap (#3623): right after toolsSlow, the time of the tools part spent outside the
  mounts' answers, each part only when it is over 250 ms: `first:<ms>` (the wait's start to
  the first request any of Sagax's endpoints got, the engine starting its tool server
  processes) and `after:<ms>` (the last tool list answered, by an endpoint or as the engine
  saw a mount ready in toolsBy, to `resolved`). Example of a turn whose first list was asked
  late: `toolsGap=first:2510`. With either part, `busy:<ms>` (over 250 ms) is how long
  Sagax's own main thread was busy during the wait (the event loop's active time): near the
  gap, the time is Sagax's (other turns, a spawn, the collector: its endpoints answered and
  its polls read late); absent or small, it is the engine's and its tool server processes'.

  Where the gap comes from, measured with the installed engine (1.0.77) and fake mounts that
  answer at once, so only the engine and the processes count: the engine starts its first
  mount 250 to 290 ms after session/new and says resolved 20 to 40 ms after the last tool
  list, so `after` stays near zero on an idle machine. On a turn that loads the account's own
  connectors, the engine first reads their list over the network and starts the first mount
  830 to 1,100 ms after session/new. Each mount is one Node process with Sagax's relay as a
  thread, about 0.17 s of processor each (eight mounts: 1.4 s), so on a four core server
  that is already busy the starts queue up behind each other: that is the `first` of 2.5 to
  3.3 s read in production before the gates ran their relays as threads, and `busy` says
  when Sagax's own thread is part of it.

  The compile cache (#3561): the gate and Sagax's relay threads read Node's on-disk compile
  cache, the server's own directory (`cache/node-compile` under the data directory), so the
  gates of an engine start stop compiling the same bundles again. Eight gates with the agents
  relay started at once: every tool list answered 470 to 513 ms after the start without the
  cache, 250 to 380 ms with it; with the installed engine and those eight gates, resolved
  587 to 682 ms after session/new without it, 506 to 586 ms with it. A person's own server
  started by a gate never gets the variable.

  One process per mount (#3623): every mount is a gate process (server/mcp-gate.ts) the
  engine starts, and each gate used to start its upstream as a second Node process, so a turn
  with eight mounts started sixteen Node processes before the engine could ask any of them
  for its tool list. A gate now runs Sagax's own relay (a script beside the gate, started
  with the same executable) as a worker thread of its own process
  (server/mcp/gate-upstream.ts); any other upstream stays its own process. On a fixture turn
  with the installed engine and eight gated mounts, the engine said its servers were resolved
  1,332 ms after the session opened before (mean of eight) and 788 ms after, on a busy
  machine. The gate also no longer loads the agents catalog to start (1.5 MB to 0.5 MB).
  A relay thread that has not answered the first request written to it within 2 s, or that
  fails or ends before answering, gets the same relay started beside it as its own process,
  given every line written so far; whichever answers first serves the mount and the other is
  stopped. The gate's log says `mcp-gate(<mount>): the relay thread did not answer its first
  request in <ms> ms; starting it as its own process`. A relay thread that fails after it
  answered logs `<command> stopped on an error while it ran`, never `could not start`.

  A server that stays `initializing` (#3623): since Grok 1.0.77 reports a server it is still
  starting as `initializing`, the wait counts it as waiting, so a turn waits for it up to
  GROK_MCP_SETTLE_MS (20 s), then sends its prompt without that server's tools; the turn
  itself is not failed (toolsBy prints `pending:<count>`). The one bad start of the thread
  change's fixture (no tool list in 22.7 s) is not the gate: under stress, 1,760 gate starts
  alone (eight at once, a busy machine) answered every time, and in the three engine sessions
  out of 298 that stalled the same way, all eight gates were up within 150 ms and the engine
  never wrote its first request (`initialize`) to any of them for 20 s. Waiting time alone
  cannot tell that from a slow start: on a loaded server the engine starts every mount late at
  once (production reads of #3623: first mount served at 2.5 to 3.3 s, the whole wait up to
  4.4 s). So when, 12 s into the wait (GROK_MCP_STALL_MS, near three times that 4.4 s), every
  server the engine lists is still starting and none ever left that state, the turn stops
  waiting and sends its prompt then, as it would at the limit (`pending:<count>` with
  `waitedMs` near 12 s). A start slower than that with no server served loses those tools for
  that turn only.

  What is kept between turns (#3623): a turn that starts an engine process starts the
  person's server again (a new initialize is a new client), and the engine waits for its tool
  list before the prompt leaves. The relay keeps, per person, bot, server and command (with its
  variables), the server's last answer to initialize and to an unpaged tools/list, never
  shared between two people. The next engine gets both at once from that copy, while the
  server starts in the background with the engine's own initialize; every other frame waits
  for that start, then reaches the server as before, so a call to a tool the server no longer
  serves gets the server's own answer. Each list served from the copy is checked again in the
  background on the new process, and so is a list the server says changed
  (`notifications/tools/list_changed`): the next turn gets the fresh one. The copy goes with a
  changed command or variable (a new sign-in in the server's variables), a server removed,
  changed, turned off or stopped, the person's sign-out, a start that failed and a check that
  failed. The first turn after a Sagax start pays the whole path; the later turns of the same
  person and server show no toolsSlow for that mount.

  Example of a turn whose engine connected its servers one after the other (each endpoint
  answers in tens of ms, the engine starts the next one about 300 ms later, and resolves
  last):

      setupBy=prepare:100,init:270,session:230,tools:2680,prompt:6 toolsBy=sagax-computer:2310,perspicax:2010,messages:1700,browser:1390,data:1080,agents:770,resolved:2660 toolsServed=data:910-950,browser:1220-1300,messages:1530-1560,perspicax:1840-1990,sagax-computer:2150-2190

  Example of a turn that opened a conversation on a new process:

      queueBy=compact:104,context:2,mcp:6,place:67,prompt:35,recall:23,access:1,dispatch:2 setupBy=prepare:19,init:2786,session:902,tools:1,prompt:10

## What the parts do not change (#3561)

queueBy and setupBy only measure. The queue and the setup of a turn take as long as before:
no step was moved, skipped or shortened. They exist so one production turn names its slow part
before anything is changed.

What to read after a server roll, on an organization server, on turns that open a
conversation (path=spawn or path=load):

- queueBy: which part holds the 5 to 6 s of queue seen in production: connector (the
  account's connection), mcp (the tool servers' sign-in refresh and probe), place (workspace,
  sandbox, mounts), context (selection, soul, skills) or slot (waiting for an engine start
  slot). The other parts are expected in tens of ms.
- setupBy: how the 3 to 7 s of setup splits between init (process start and handshake),
  session (session/new or load) and tools (Grok's tool servers answering). A large init points
  at keeping a process warm between a bot's conversations; a large tools part at the wait for
  the tool servers; a large session part at the engine's own session start.

`grep turn-latency` on the server log gives the distribution; the native wire log
($SAGAX_DATA_DIR/native/<thread>.ndjson) has every ACP message with its time.

## Baseline (Nova, Sagax approval gate on)

| Stage | New thread "pong" | Follow-up "pong" | One tool (list_bots) |
|---|---|---|---|
| queue | 183 ms | 99 ms | 72 ms |
| setup | 355 ms (spawn) | 21 ms (load) | 34 ms (load) |
| prompt -> first text | 1.58 s | 1.41 s | 1.15 s |
| tool call -> done | - | - | 43 ms |
| message stored -> reply stored | 2.26 s | 1.63 s | 2.23 s |

Same tool turn on a bot in Grok auto mode (no gate), new thread: 14.0 s = search_tool round 2.1 s
+ second round 3.6 s + auto-mode hold on use_tool 7.3 s + final round 0.9 s.

Fleet (179 prompts, 2026-10-11): first streamed update p50 2.4 s, p90 7.8 s, p99 37 s; auto-mode
permission holds p50 4.5 s (n=2274); session/new|load p50 0.22 s; spawn -> prompt p50 0.33 s;
17% of model rounds read under half of their prompt from cache (39% in the evening).

## Findings

- Streaming is end to end: deltas leave the server per ACP chunk, both Caddy layers flush
  (flush_interval -1; encode zstd/gzip still flushes per frame, checked with caddy 2.11.6), and the
  web and iOS clients render deltas as they arrive.
- The provider's cache is per session: a new session (new thread, routine run) reads ~0.5k of
  ~15k tokens from cache whatever the prompt; a session idle past the provider's cache lifetime
  misses too, so a long thread pays its whole context again (94-173k tokens: 8.7-19.8 s).
- Long threads are the slowest turns. Context size is set by Sagax's fold point (compactAt) and
  Grok's own auto_compact_threshold_percent; both trade memory of the thread for speed.
- The provider sometimes sends nothing for 27-90 s, on short contexts too. The stall guard now
  waits 10 s on a short conversation and up to 30 s on a long one (grokAdaptiveStallMs);
  SAGAX_GROK_STALL_RETRY_MS still fixes it (0 turns it off).

## Grok HTTP prompt cache key (2026-11-22)

Measured on a fake xAI server in this repository (no live key, so these
numbers are Sagax's own request, not the vendor's time to first token).
Two turns of one thread, the second carrying the first turn's transcript:

- before: `x-grok-conv-id` absent on both turns; `reasoning_effort` absent;
  the second request extended the first (system prefix identical, 188 bytes
  of the JSON prefix); local send to `turn.completed` 7 ms then about 1 ms;
  `turn.completed` cost null on both even when the fake usage carried
  `cost_in_usd_ticks`.
- after the cache header, same fixture: both turns send
  `x-grok-conv-id: thread-ada` and `reasoning_effort: high`; the prefix is
  still 188 bytes and the second request still extends the first; local
  send to `turn.completed` 7 ms then 1 ms. The vendor stores a prompt
  cache per server, and that header is what routes a conversation to one
  server. The stable half was already the system message; this change
  does not rebuild it. Cost stayed null here; the ticks are read in the
  per-turn cost change.

## Cold start on every turn (#4215, 2026-11-13)

What the production lines showed: path=spawn on every turn, setup 2.7 to 13.6 s,
no prompt cache hit. Two causes, reproduced through the real server and the
fake engine (server/turn-start-latency.e2e.test.ts):

- The warm budget (server/resources/warm-resources.ts) counted the running
  turns of the same person (and of the server) against its retention caps. With
  four teammates of the same person working, at the default caps, the
  conversation's engine was closed `why=warm budget` each time its turn ended:
  three turns, three spawns. The caps now bound idle retention only: the same
  run reuses the engine (spawn, pooled, pooled).
- The person's connectors list (section `claude-ai`) sat in the stable half.
  Its first turn says "connectors not read yet", the background read lands
  after it, so the second turn re-sent the whole opening block into the session
  (prompt 22,766 characters instead of a short note): a second copy in the
  session's history and a new prefix for the provider's cache. It is volatile
  now: the second turn sends 577 characters (the changed section and the
  request), the third 13.

Queue: the first turn of a server read and indexed the self-knowledge base
(the lookup for a question about Sagax itself) inside its queue, 111 ms of a
202 ms queue in the reproduction. The index is built once when the server
starts listening; the same first turn now queues 76 ms. The lookup is its own
part of the line (`queueBy=help:`), and `queueBusy=` (over 250 ms) says how
long the server's own main thread was busy during the queue: near the queue,
the wait was Sagax's own work; near zero, the turn waited on I/O.

The conversation's timing line (Settings, Turn timing) reads one turn: send to
first word, the wait before send, the engine start (warm or cold), the first
text after the hand-off, and the total (shared/wire.ts WireTurnTiming).

Queue and the composer's warm. When the person starts typing, the composer
warms the conversation's engine (server/threads/thread-prewarm.ts). A send that
lands while that engine is still starting waits for it, up to 5 s, before its
message is even stored (server/index.ts startOrQueueDirectMessage). That wait
was on no line: the queue counted from the stored message. With the warm budget
above, the warmed engine was then closed `why=warm budget`, and the turn
started a second one: the engine start paid twice, once out of sight and once
as setup. Reproduced with the fake engine starting in 1.5 s
(FAKE_ACP_COLD_MS), four busy teammates, a warm before each send:

- before: path=spawn on all three turns, queue 12, 13, 10 ms (the first send's
  wait for the warm not counted), setup 1,687, 1,690, 1,710 ms, four engine
  starts for three turns;
- after: path=pooled on all three, queue 1,726 ms on the first turn
  (`queueBy=...,prewarm:1706,...`: the rest of the engine start the typing
  began, named) then 10 and 13 ms, setup 3, 2, 2 ms, one engine.

The send's arrival now starts the turn's clock (turn-trace.ts noteTurnArrival):
the line's queue, its `prewarm` part and the app's "send to first word" include
the wait. The queue's other parts stay in tens of ms in the reproduction; a
production queue of seconds reads `prewarm` (an engine start), `admit` (a
first attempt on an engine that failed and handed the turn to its backup: the
backup's run restarts the clock) or `queueBusy` (Sagax's own work).

Queue on a hosted server (#4456): 1.4 to 3.7 s on every turn, `queueBusy`
about the same, so the main thread was busy, not waiting on the network; its
parts (recall, place, prompt, admit) a few hundred ms each. The benchmark
`server/first-text-latency.e2e.test.ts` ("production-sized") runs a bot the
size of a production one (a 62 KB opening block: an 11.5 KB soul, a 12 KB
RULES.md, a full MEMORY.md, 120 topic notes, 40 earlier conversations, a long
main chat), prints `queueBy` and `queueBusy` on every turn
(SAGAX_TURN_LATENCY_BUSY_MS=0) and counts the server's synchronous file calls
in each queue (server/testing/fs-sync-calls.mjs, `fsSync=`). On a laptop SSD
the queue is 30 to 100 ms, all of it the turn's own synchronous work; what it
is made of is about 2,750 synchronous file calls per queue, nine in ten on the
bot's memory files: recall listed the topic folder four times, the memory
journal resolved every topic, log and doc through a realpath and stat'ed it
twice more, every unchanged plain file was opened, read and closed again, the
memory section's cache was rebuilt at every turn (the daily log written after
each turn changed its folder fingerprint) and read the head of every topic.
Each call holds the main thread for as long as the disk answers: a round trip
on a network disk, so the count grows with the person's notes and logs and
the time with the disk. Now:
- one topic listing per recall (workspace.ts withMemoryListingOnce);
- the journal resolves a folder's real path once per pass and reuses the
  listing's lstat (memory-store.ts memoryFileResolver);
- an unchanged small plain file is served from the opened-files cache by its
  stat (content-at-rest.ts readAtRestSync, as a sealed one already was), and a
  topic's head by a stat (memory-topics.ts readTopicHead);
- the memory section's fingerprint watches the topic files only;
- a person with no saved connections is read once (person-connections.ts).
Before and after, three measured turns each: `fsSync` 2,804, 2,726, 2,742 to
737, 702, 735 (realpath 250 to 8, open 260 to 3, read file 200 to 38); queue
41, 71, 105 ms to 32, 32, 30 ms, `queueBusy` equal to the queue in both. What
stays is a stat per memory file per reader that must see a change made on
the disk (the section's cache, the journal, the semantic index), the
provider keys store (about 65 calls a turn) and the skill links.

Memory and skills sized to the turn. A turn that can read MEMORY.md itself is
shown its first lines up to 8 KB (MEMORY_TURN_BYTES, whole lines); a line past
them comes back in the recalled block in front of the message that shares its
words (server/recall/recall.ts memoryLinePassages), so it never changes the
system prompt and its cached prefix. The skills index (an engine that reads a
reference by name) shares one 4 KB budget for its full entries between its
capabilities, at least 1 KB each; every other reference is still named with
its route. A MEMORY.md of 190 lines (about 23 KB) and four capabilities of 30
skills: memory section 25,770 to 9,840 bytes, skills index 15,607 to 6,319.
Both are the same bytes on every turn of a conversation, so the provider's
cache still holds them.

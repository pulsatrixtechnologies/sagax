# Process starts and the event loop (#3680)

On Linux, `child_process.spawn` forks the caller: the kernel copies the page
tables of the whole process, and the caller then waits until the child has
reached its exec. A hosted server of 1.4 to 1.9 GB stopped its event loop for
1.2 to 2.0 s at engine starts (`spawn` 83 to 100% of the samples), and every
person on it waited.

Since #3680 every process the server process starts is created by a small
helper process the server starts at boot (`server/process/spawn-helper.ts`):
the fork is of a 40 MB process, the server only sends a message and gets the
child's pid and stdio sockets back. `spawnChild` is the one way to start a
child, typed as `spawn`; `execChild` is its `execFile` shape (stdout and
stderr collected, `timeout`, `killSignal`, `maxBuffer`, an `AbortSignal`, the
same errors, an AbortError on an abort) and `execChildAsync` its
`promisify(execFile)` shape. Extra pipes (a browser's DevTools pipe on
descriptors 3 and 4) come back through the helper too. The helper runs at
nice 10, which its children inherit, so a burst of engine starts leaves the
server's main thread its processor. When the helper is down the server starts
processes itself and logs one line, `[spawn-helper] down (...)`, then
`[spawn-helper] back` once it runs again. The helper runs in a process
group of its own, so a Ctrl+C on the terminal of a server run by hand reaches
only the server: the server passes that SIGINT on to the helper, which gives
it to the children not started detached (the ones that sat in the server's
group before). A child's pid comes back a moment after the call: a stop in
that moment goes through `killCliTree` (which waits for the start) or
`whenStarted` (a group signal sent once the pid is there), never a read of
`child.pid` at once. Where no helper runs (macOS,
Windows, a test that does not start it), `execChild` is Node's `execFile`.

What goes through them, on a turn's path and around it:

- The engines (`spawnCli`) and every `execCli` call (the engines' `--version`
  and `--help` probes, the install and self checks), the model and reach
  probes that start an engine directly.
- The checkpoint's git calls (`server/checkpoints.ts`): a snapshot runs at
  every turn start, before the engine, and the turn waits for it; its diff
  runs after the turn.
- The lifecycle hooks (`server/hooks/lifecycle-hook-exec.ts`), the routine
  watches, the parallel task's worktree (its git calls were synchronous
  before: `server/parallel-tasks.ts` now awaits them), a run's git and shell
  commands (`server/runner/`), the coding branches' git and gh
  (`server/code-branches.ts`), the frames of a video attachment
  (`server/turns/turn-video.ts`), the widget check's browser.
- The browser engine and its live view, the computer's commands (container,
  VPS tunnel, desktop apps), the harness connectors, the tool hosts, the
  plugin sources and sandbox plugin archives, the memory store's indexer,
  remote support, the proactive watches, usage and keychain reads, voices,
  the wallet issuer, the password manager, messages.
- The `ps` and `lsof` reads of a quiet turn
  (`server/drivers/acp/quiet-status.ts`), the process list of a wait, the
  process table of the memory budget, the resource sampler and the login
  shell probe of `PATH`.

`server/process/spawn-helper.test.ts` lists these files and fails if one of
them imports a value of `node:child_process` (or imports it dynamically).

What still imports `node:child_process` under `server/`, and why it is not
the server process forking itself:

- Types only (`ChildProcess` and its siblings): the drivers, the terminal
  resources, `server/resources/warm-process.ts`, `server/engines/claude-update.ts`.
- Other processes than the server: the command line and its setup
  (`server/cli.ts`, `server/cli/cli-setup.ts`, which also start Caddy through
  `server/caddy.ts` and the tunnel through `server/tunnel.ts`), the launcher
  that starts the server (`server/server-launcher.ts`), the fleet command
  (`server/fleet/fleet-cli.ts`), the MCP gate and the computer bridges
  (`server/mcp/gate-upstream.ts`, `server/mcp/mcp-bridge.ts`, run by
  `server/mcp-gate.ts`, `server/container-mcp.ts`,
  `server/local-computer-proxy.ts` and `server/vps-container-mcp.ts`, each
  its own small process).
- Tests and their fixtures (`server/testing/`, a terminal adapter for tests,
  a test browser).
- The helper itself, and `procs.ts`'s `execFile` of Windows' `taskkill`
  (no helper runs on Windows).

## The harness

`scripts/bench-spawn-stall.ts` grows its process like a production server
(touched buffers in pieces of varying sizes, about 3,000 mappings, a heap of
small objects), starts `/bin/true` twenty times with the server's own spawn,
then twenty times through the helper, and prints the synchronous part of the
call and the longest stop of a 5 ms beat around each start. It exits 1 when a
start through the helper stops the loop 50 ms or more. It runs on Linux, in
the server's image (no build step: Node strips the types):

    docker run --rm -m 6g -v "$PWD/scripts:/w/scripts:ro" \
      -v "$PWD/server/process:/w/server/process:ro" -w /w \
      --entrypoint node <server image> scripts/bench-spawn-stall.ts busy=6

`busy=<n>` adds n busy children (the burst); `bufferMB`, `heapMB` and `runs`
change the shape.

## Last numbers (2026-11-11, server image on Node 24.21, arm64, 2 processors)

Longest loop stop per start, median and worst of 20, parent at 1.5 to 1.6 GB
resident with about 3,060 mappings:

- Server's own spawn: 9.9 ms median, 27 ms worst.
- Same, next to six busy children: 68 ms median, 128 ms worst.
- Through the helper: 0.6 ms median, 1.8 ms worst.
- Through the helper, next to six busy children: 2 ms median, 8 ms worst.

What the stop follows, from the same image (a standalone harness, 15 starts
each, parent at 1.4 GB unless named): the parent's size (2 ms at 44 MB, 5 ms
at 230 MB, 12 ms at 900 MB, 18 ms at 1.4 GB), and processor contention (57 ms
next to six busy children at the server's priority, 17 ms with those children
at nice 10). Not the environment (219 entries and 16 KB: no change), the open
descriptors (82: no change), `stdio` or `detached`, nor a running CPU
profiler. This machine forks about five times faster than the hosted one
(75 ms for 2 GB there), so the absolute numbers are lower; the shape is the
same.

## What the harness shows, and what it does not

The harness does not reach production's size of stop: its worst start with
the server's own spawn is 27 ms (128 ms next to six busy children), where the
hosted server stopped 1.0 to 2.0 s. The hosted machine forks more slowly, its
heap is more fragmented than a synthetic one, and engine starts there come in
bursts of up to 15 children on 4 processors. So "after" is not shown by a
matched before figure: it is shown by the mechanism. The server no longer
calls fork for these processes (the tests in
`server/process/spawn-helper.test.ts` check that each child's parent is the
helper, not the server), and what a fork of the server cost is no longer paid
on its main thread at any size.

## The rest of the loop turn of a start

The samples of the 1,505 ms stop named, beside `spawn` (83%): `concat
node:buffer` 8%, `childEnv` 2%, `cliTarget` 2% and `structuredClone` 2%. The
owner's question: what do they do in the same turn of the loop as the
creation, and do they belong before it?

- `childEnv` (`server/drivers/acp/create-instance.ts` and its siblings in
  `server/drivers/`) builds the child's environment: a copy of the server's
  variables plus the engine's own, minus the credentials the engine may not
  see. It must run before the creation: it is what the child is started with,
  and the isolation between people depends on it. It is a copy of a few
  hundred short strings, not a fork, and its cost does not grow with the
  server.
- `cliTarget` (`server/harness/registry.ts`) is two map reads that name the
  engine's program. The creation needs it; it belongs before.
- `structuredClone` is the turn's own snapshot of the bot
  (`projectBotForTask` in `server/store.ts` clones the model selection and the
  resume cursors, so a running turn never sees another turn's change). A
  run's clone is `cloneRun` (`server/routines/routines.ts`) when a routine
  starts a turn and reads its runs. Both are small copies the turn needs
  before its engine starts (the model and the resume cursor go into the
  engine's arguments), so they belong before the creation; they are not part
  of the fork's cost.
- `concat node:buffer` is, as far as the samples tell (they carry no caller),
  the collection of children's output: `execFile` and the engines' line
  readers join stdout chunks with `Buffer.concat`, and the output of other
  engines and probes that answered while the main thread was held lands in
  the same stretch. Nothing the creation itself needs is built with it.

None of these grows with the server's size the way the fork did: together
they are under a tenth of that stop, and the fork they surrounded is now done
by the helper.

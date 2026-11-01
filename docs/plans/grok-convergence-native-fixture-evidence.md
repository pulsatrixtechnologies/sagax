# Evidence: native fixture demo library / files / pages

Worker: Grok CLI native fixture. Branch
`feat/grok-convergence-native-fixture`, worktree
`/Users/jencryzthers/sagax-grok-native-fixture`, pinned base `c3bf9b03d`.

## What changed

1. `DemoFiles.swift`: synthetic Atlas Library entries (markdown plan, PDF
   checklist, tiny PNG), `GET /api/threads/:id/files` (+ bytes / pin /
   preview), `GET /api/bots/:id/files|artifacts|links`, page preview HTML at
   `/pages/preview/...`, and resumable `POST /api/files` /
   `POST /api/attachments` (`phase=status|chunk|commit|cancel`, durable
   offset, receipt replay, cancel, 404 when missing, chunk <= 4 MiB).
2. `DemoListen.swift`: ephemeral `127.0.0.1` HTTP/1.1 fixture so tests use a
   real `URLSession`, not only `DemoURLProtocol`.
3. `Demo.swift`: wires those routes, forwards query + Content-Type, seeds
   files, clears them on demo account delete, stops the listener on `stop()`.
4. `PageSurfaceView.swift`: moves `More` / `page-more` onto the Menu label so
   AXe sees a labeled control (actions / themes / richer Pages unchanged).
5. `DemoFilesTests.swift`: loopback coverage for library listing, pages
   metadata / preview read, resumable upload lifecycle, missing-route demo
   feedback, plus CompanionClient via DemoURLProtocol.

Synthetic data only. No secrets. No production server / AttachmentUpload /
Client / Session / other app files.

## Test commands and results

```text
cd ios && swift test --filter 'DemoFilesTests|DemoModeTests'
```

Result (2026-10-31, local Mac):

- DemoFilesTests: 5 passed (0 failures)
- DemoModeTests: 12 passed (0 failures)
- Total selected: 17 passed in ~0.08 s after build

Not run: full CompanionCore suite, `pnpm verify:merge`, simulator / device UI
(root owns the opened native app and physical qualification).

## Remaining physical UI qualification (root)

Root already opened native 0.8.23(100). After integrating these commits, re-check
demo Atlas > BotPanel > Library: files should list (weekly plan pinned, PDF,
PNG) instead of "Couldn't load this chat's files" + Retry. Optionally confirm
Page header More exposes `page-more` / "More" to AXe. No simulator control from
this worker.

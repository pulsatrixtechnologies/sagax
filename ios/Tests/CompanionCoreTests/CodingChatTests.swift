// Port of `src/lib/coding-chat.test.ts` / Android CodingChatTest.
// Synthetic names only (Osprey / Wren).
import XCTest
@testable import CompanionCore

final class CodingChatTests: XCTestCase {
    private let root = "/workspace/bots/wren/dispatch-board"
    private var seq = 0

    private func json(_ value: Any) -> String {
        let data = try! JSONSerialization.data(withJSONObject: value)
        return String(data: data, encoding: .utf8)!
    }

    private func tool(_ name: String, input: Any?, extra: ((inout CodingTool) -> Void)? = nil) -> CodingMessage {
        seq += 1
        var base = CodingTool(
            name: name,
            input: input.map { $0 is String ? $0 as! String : json($0) },
            ok: true
        )
        extra?(&base)
        return CodingMessage(
            id: "m\(seq)",
            role: "bot",
            kind: "activity",
            text: "",
            at: Double(1_000 + seq),
            tool: base
        )
    }

    private func line(role: String, text: String) -> CodingMessage {
        seq += 1
        return CodingMessage(
            id: "m\(seq)",
            role: role,
            kind: "text",
            text: text,
            at: Double(1_000 + seq)
        )
    }

    func testReadsAPathUnderTheTasksFolderRelativeToItAnyOtherAsItsLastTwoSegments() {
        XCTAssertEqual(shortPath("\(root)/src/board/column.ts", root: root), "src/board/column.ts")
        XCTAssertEqual(shortPath(root, root: root), "dispatch-board")
        XCTAssertEqual(shortPath("/home/osprey/.cache/tool/state.json"), "…/tool/state.json")
        XCTAssertEqual(shortPath("src/app.ts"), "src/app.ts")
        XCTAssertEqual(
            shortPath("/data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/plugins"),
            "…/bots/plugins"
        )
    }

    func testCutsServerPathsAndIdsOutOfCommandLinesAndOutput() {
        XCTAssertEqual(redactPaths("cd \(root) && pnpm test", root: root), "cd dispatch-board && pnpm test")
        XCTAssertEqual(
            redactPaths("FAIL \(root)/src/board/column.test.ts > keeps order", root: root),
            "FAIL src/board/column.test.ts > keeps order"
        )
        let out = redactPaths(
            "ls /data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/sagax-plugins and id a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        )
        XCTAssertNil(out.range(of: #"[0-9a-f]{8}-[0-9a-f]{4}"#, options: .regularExpression))
        XCTAssertFalse(out.contains("/data/.sagax"))
    }

    func testReadsClaudesBashCodexsCommandListAndABashLcWrapper() {
        XCTAssertEqual(
            commandOf(CodingTool(name: "Bash", input: json(["command": "pnpm test", "description": "Run tests"]))),
            "pnpm test"
        )
        XCTAssertEqual(
            commandOf(CodingTool(
                name: "commandExecution",
                input: json(["command": ["bash", "-lc", "cargo test"], "cwd": root])
            )),
            "cargo test"
        )
        XCTAssertEqual(
            commandOf(CodingTool(name: "shell", input: json(["command": "bash -lc 'git status'"]))),
            "git status"
        )
        XCTAssertEqual(commandOf(CodingTool(name: "Bash", summary: "ls -la")), "ls -la")
    }

    func testReadsOutputAndExitCodeFromATextACodexResultOrContentBlocks() {
        XCTAssertEqual(commandResult(CodingTool(name: "Bash", output: "ok\n")), CommandResult(output: "ok\n"))
        XCTAssertEqual(
            commandResult(CodingTool(name: "x", output: json(["output": "boom", "exitCode": 2]))),
            CommandResult(output: "boom", exitCode: 2)
        )
        XCTAssertEqual(
            commandResult(CodingTool(
                name: "x",
                output: json([["type": "text", "text": "line one"]])
            )),
            CommandResult(output: "line one")
        )
    }

    func testIsATerminalStepWithItsTestCountsFailedWhenItExitedNonZero() {
        let step = codingStep(
            id: "s",
            tool: CodingTool(
                name: "Bash",
                input: json(["command": "cd \(root) && pnpm vitest run"]),
                output: json([
                    "output": " Test Files  1 failed | 3 passed (4)\n      Tests  1 failed | 41 passed | 2 skipped (44)",
                    "exitCode": 1,
                ]),
                ok: true
            ),
            root: root
        )
        guard case let .command(_, command, _, exitCode, ok, _, tests, _) = step else {
            return XCTFail("expected command step")
        }
        XCTAssertEqual(command, "cd dispatch-board && pnpm vitest run")
        XCTAssertEqual(exitCode, 1)
        XCTAssertEqual(ok, false)
        XCTAssertEqual(tests, TestSummary(passed: 41, failed: 1, skipped: 2))
    }

    func testShowsGitDiffsOutputAsDiffsToo() {
        let output = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n keep();\n"
        let step = codingStep(
            id: "s",
            tool: CodingTool(name: "Bash", input: json(["command": "git diff"]), output: output, ok: true)
        )
        guard case let .command(_, _, _, _, _, _, _, diff) = step else {
            return XCTFail("expected command step")
        }
        XCTAssertEqual(diff?.first?.path, "src/a.ts")
        XCTAssertEqual(diff?.first?.added, 1)
        XCTAssertEqual(diff?.first?.removed, 1)
    }

    func testReadsVitestJestPytestCargoNodeTestMochaAndGo() {
        XCTAssertEqual(testSummary("      Tests  12 passed (12)"), TestSummary(passed: 12, failed: 0, skipped: 0))
        XCTAssertEqual(testSummary("Tests:       1 failed, 11 passed, 12 total"), TestSummary(passed: 11, failed: 1, skipped: 0))
        XCTAssertEqual(testSummary("===== 3 passed, 1 failed, 2 skipped in 0.12s ====="), TestSummary(passed: 3, failed: 1, skipped: 2))
        XCTAssertEqual(
            testSummary("test result: ok. 4 passed; 0 failed; 1 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored"),
            TestSummary(passed: 6, failed: 0, skipped: 1)
        )
        XCTAssertEqual(testSummary("# tests 5\n# pass 5\n# fail 0"), TestSummary(passed: 5, failed: 0, skipped: 0))
        XCTAssertEqual(testSummary("  12 passing (30ms)\n  1 failing"), TestSummary(passed: 12, failed: 1, skipped: 0))
        XCTAssertEqual(testSummary("ok  \tacme/board\t0.01s\nok  \tacme/lane\t0.02s"), TestSummary(passed: 2, failed: 0, skipped: 0))
        XCTAssertNil(testSummary("Compiled successfully"))
    }

    func testDiffsClaudesEditLineByLineUnchangedLinesKeptAsContext() {
        let files = editFiles(
            CodingTool(
                name: "Edit",
                input: json([
                    "file_path": "\(root)/src/board/column.ts",
                    "old_string": "const a = 1;\nkeep();\nconst b = 2;",
                    "new_string": "const a = 1;\nkeep();\nconst b = 3;\nconst c = 4;",
                ])
            ),
            root: root
        )
        let file = files[0]
        XCTAssertEqual(file.path, "src/board/column.ts")
        XCTAssertEqual(file.added, 2)
        XCTAssertEqual(file.removed, 1)
        XCTAssertEqual(file.status, .modified)
        XCTAssertEqual(
            file.hunks[0].lines.map(\.kind),
            [.ctx, .ctx, .del, .add, .add]
        )
    }

    func testReadsMultiEditWriteApplyPatchAndCodexFileChanges() {
        let multi = editFiles(
            CodingTool(
                name: "MultiEdit",
                input: json([
                    "file_path": "src/a.ts",
                    "edits": [
                        ["old_string": "x", "new_string": "y"],
                        ["old_string": "", "new_string": "z"],
                    ],
                ])
            )
        )[0]
        XCTAssertEqual(multi.added, 2)
        XCTAssertEqual(multi.removed, 1)

        let written = editFiles(
            CodingTool(name: "Write", input: json(["file_path": "src/new.ts", "content": "a\nb\nc"]))
        )[0]
        XCTAssertEqual(written.path, "src/new.ts")
        XCTAssertEqual(written.status, .added)
        XCTAssertEqual(written.added, 3)
        XCTAssertEqual(written.removed, 0)

        let patch = "*** Begin Patch\n*** Update File: src/lane.ts\n@@\n-old\n+new\n ctx\n*** Add File: src/fresh.ts\n+hello\n*** End Patch"
        let parsed = parseApplyPatch(patch)
        XCTAssertEqual(parsed.map { [$0.path, "\($0.status)", $0.added, $0.removed] as [Any] }.count, 2)
        XCTAssertEqual(parsed[0].path, "src/lane.ts")
        XCTAssertEqual(parsed[0].status, .modified)
        XCTAssertEqual(parsed[0].added, 1)
        XCTAssertEqual(parsed[0].removed, 1)
        XCTAssertEqual(parsed[1].path, "src/fresh.ts")
        XCTAssertEqual(parsed[1].status, .added)
        XCTAssertEqual(editFiles(CodingTool(name: "apply_patch", input: json(["input": patch]))).count, 2)

        let codex: [[String: Any]] = [
            [
                "path": "\(root)/src/x.ts",
                "kind": ["type": "update"],
                "diff": "@@ -1 +1 @@\n-a\n+b\n",
            ],
            [
                "path": "\(root)/src/y.ts",
                "kind": ["type": "add"],
                "diff": "one\ntwo",
            ],
        ]
        let files = editFiles(CodingTool(name: "fileChange", input: json(codex)), root: root)
        XCTAssertEqual(files[0].path, "src/x.ts")
        XCTAssertEqual(files[0].status, .modified)
        XCTAssertEqual(files[0].added, 1)
        XCTAssertEqual(files[0].removed, 1)
        XCTAssertEqual(files[1].path, "src/y.ts")
        XCTAssertEqual(files[1].status, .added)
        XCTAssertEqual(files[1].added, 2)
    }

    func testReadsAnEditWhosePreviewTheServerCutShort() {
        let cut = "{\n  \"file_path\": \"\(root)/src/a.ts\",\n  \"old_string\": \"one\\ntwo\",\n  \"new_string\": \"one\\nthree and a long tail that the bound cut"
        let file = editFiles(CodingTool(name: "Edit", input: "\(cut)\n[… preview shortened]"), root: root)[0]
        XCTAssertEqual(file.path, "src/a.ts")
        XCTAssertEqual(file.removed, 1)
        XCTAssertEqual(file.added, 1)
    }

    func testFallsBackToAllRemovedThenAllAddedPastTheDiffBound() {
        let big = (0..<600).map { "l\($0)" }.joined(separator: "\n")
        let lines = lineDiff(big, "\(big)\nmore")
        XCTAssertEqual(lines.filter { $0.kind == .del }.count, 600)
    }

    func testDrawsWordsAsLinesReadsInARowAsOneChipLineTheRestAsStepsAndSumsTheChanges() {
        let messages = [
            line(role: "user", text: "Pour la colonne du board, garde l'ordre"),
            tool("Read", input: ["file_path": "\(root)/src/board/column.ts"]),
            tool("Read", input: ["file_path": "\(root)/src/board/lane.ts"]),
            tool("Edit", input: ["file_path": "\(root)/src/board/column.ts", "old_string": "a", "new_string": "b"]),
            tool("Bash", input: ["command": "cd \(root) && pnpm test"]) { $0.output = "Tests  3 passed (3)" },
            tool("Edit", input: ["file_path": "\(root)/src/board/column.ts", "old_string": "c", "new_string": "d\ne"]),
            tool("mcp__github__create_issue", input: ["title": "x"]),
            line(role: "bot", text: "Done: the column keeps its order."),
        ]
        XCTAssertEqual(codingRoot(messages), root)
        let rows = codingRows(messages, root: root)
        let kinds: [String] = rows.map { row in
            switch row {
            case .line: return "line"
            case .reads: return "reads"
            case let .step(_, _, step):
                switch step {
                case .command: return "command"
                case .edit: return "edit"
                case .read: return "read"
                case .tool: return "tool"
                }
            }
        }
        XCTAssertEqual(kinds, ["line", "reads", "edit", "command", "edit", "tool", "line"])
        guard case let .reads(_, _, paths, _) = rows[1] else { return XCTFail("reads") }
        XCTAssertEqual(paths, ["src/board/column.ts", "src/board/lane.ts"])
        XCTAssertEqual(
            changedFiles(rows),
            [ChangedFile(path: "src/board/column.ts", added: 3, removed: 2, rowId: rows[4].id)]
        )
    }

    func testBuildsMessagesFromTheStepsOfATaskWithoutAReadableThread() {
        let messages = stepMessages(
            [BotActivityStep(id: "s", name: "Bash", summary: "pnpm lint", ok: true, at: 5)],
            botId: "wren",
            botName: "Wren"
        )
        guard case let .step(_, _, step) = codingRows(messages)[0],
              case let .command(_, command, _, _, _, _, _, _) = step else {
            return XCTFail("command")
        }
        XCTAssertEqual(command, "pnpm lint")
    }

    func testNamesTheFolderBranchNewestCommitAndPullRequest() {
        let place = codingPlace(
            code: BotCodeWork(
                folder: root,
                branch: "feat/column",
                repo: "acme/board",
                pullRequests: [
                    BotCodePullRequest(
                        number: 12,
                        url: "https://github.com/acme/board/pull/12",
                        action: .opened,
                        at: 1
                    ),
                ],
                commits: [BotCodeCommit(sha: "abcdef1234", pushed: true, at: 1)]
            )
        )
        XCTAssertEqual(place.folder, "dispatch-board")
        XCTAssertEqual(place.branch, "feat/column")
        XCTAssertEqual(place.pull?.number, 12)
        XCTAssertEqual(place.commit?.sha, "abcdef1234")
        XCTAssertEqual(languageOf(path: "src/a.tsx"), "tsx")
        XCTAssertEqual(languageOf(path: "Dockerfile"), "dockerfile")
    }

    func testSnapshotSumsChangesAndLatestTests() {
        let item = BotActivityItem(
            id: "thread:1",
            botId: "wren",
            title: "Column order",
            status: .running,
            startedAt: 1,
            threadId: "t1",
            coding: true,
            canStop: true,
            code: BotCodeWork(folder: root, branch: "feat/column")
        )
        let messages = [
            tool("Edit", input: ["file_path": "\(root)/a.ts", "old_string": "a", "new_string": "b"]),
            tool("Bash", input: ["command": "pnpm test"]) { $0.output = "Tests  2 passed (2)" },
        ]
        let snap = CodingChatModel.snapshot(messages: messages, item: item, detail: nil)
        XCTAssertEqual(snap.files.first?.path, "a.ts")
        XCTAssertEqual(snap.tests, TestSummary(passed: 2, failed: 0, skipped: 0))
        XCTAssertEqual(snap.place.folder, "dispatch-board")
        XCTAssertTrue(snap.live)
        XCTAssertTrue(snap.canStop)
        XCTAssertTrue(snap.canContinue)
        XCTAssertTrue(CodingChatRules.showChangesBand(files: snap.files, tests: snap.tests, place: snap.place))
    }

    func testStepKindOfUsesWorkingStepForSoUnusualNamesStopFallingThrough() {
        XCTAssertEqual(
            stepKindOf(CodingTool(name: "run_terminal_cmd", summary: "pnpm test", input: json(["command": "pnpm test"]))),
            .command
        )
        XCTAssertEqual(
            stepKindOf(CodingTool(name: "Read project/notes.md")),
            .read
        )
        XCTAssertEqual(
            stepKindOf(CodingTool(name: "Editing src/app.ts")),
            .edit
        )
        XCTAssertEqual(
            stepKindOf(CodingTool(name: "mcp__github__create_issue")),
            .tool
        )
        // A search is not a coding chip; it stays a tool row.
        XCTAssertEqual(stepKindOf(CodingTool(name: "Grep")), .tool)
        XCTAssertEqual(
            stepKindOf(CodingTool(name: "apply_patch", input: json(["path": "a.ts"]))),
            .edit
        )
    }
}

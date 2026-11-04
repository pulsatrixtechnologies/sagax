package com.openmausbot.companion.core

import kotlinx.serialization.encodeToString
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Port of `src/lib/coding-chat.test.ts`. Synthetic names only (Osprey / Wren).
 */
class CodingChatTest {
    private val root = "/workspace/bots/wren/dispatch-board"
    private var seq = 0

    /** Minimal JSON builder for tool inputs without depending on org.json. */
    private fun orgJson(value: Any?): String = when (value) {
        null -> "null"
        is String -> CompanionJson.encodeToString(value)
        is Number -> value.toString()
        is Boolean -> value.toString()
        is Map<*, *> -> value.entries.joinToString(",", "{", "}") { (k, v) ->
            "${orgJson(k.toString())}:${orgJson(v)}"
        }
        is List<*> -> value.joinToString(",", "[", "]") { orgJson(it) }
        else -> error("unsupported ${value::class}")
    }

    private fun tool(name: String, input: Any?, extra: CodingTool.() -> CodingTool = { this }): CodingMessage {
        val base = CodingTool(
            name = name,
            input = if (input is String) input else orgJson(input),
            ok = true,
        )
        return CodingMessage(
            id = "m${++seq}",
            role = "bot",
            kind = "activity",
            text = "",
            at = (1_000 + seq).toDouble(),
            tool = base.extra(),
        )
    }

    private fun line(role: String, text: String): CodingMessage = CodingMessage(
        id = "m${++seq}",
        role = role,
        kind = "text",
        text = text,
        at = (1_000 + seq).toDouble(),
    )

    @Test
    fun readsAPathUnderTheTasksFolderRelativeToItAnyOtherAsItsLastTwoSegments() {
        assertEquals("src/board/column.ts", shortPath("$root/src/board/column.ts", root))
        assertEquals("dispatch-board", shortPath(root, root))
        assertEquals("…/tool/state.json", shortPath("/home/osprey/.cache/tool/state.json"))
        assertEquals("src/app.ts", shortPath("src/app.ts"))
        assertEquals(
            "…/bots/plugins",
            shortPath("/data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/plugins"),
        )
    }

    @Test
    fun cutsServerPathsAndIdsOutOfCommandLinesAndOutput() {
        assertEquals("cd dispatch-board && pnpm test", redactPaths("cd $root && pnpm test", root))
        assertEquals(
            "FAIL src/board/column.test.ts > keeps order",
            redactPaths("FAIL $root/src/board/column.test.ts > keeps order", root),
        )
        val out = redactPaths(
            "ls /data/.sagax/bots/a1b2c3d4-e5f6-7890-abcd-ef1234567890/sagax-plugins and id a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        )
        assertTrue(!Regex("""[0-9a-f]{8}-[0-9a-f]{4}""").containsMatchIn(out))
        assertTrue(!out.contains("/data/.sagax"))
    }

    @Test
    fun readsClaudesBashCodexsCommandListAndABashLcWrapper() {
        assertEquals(
            "pnpm test",
            commandOf(CodingTool(name = "Bash", input = orgJson(mapOf("command" to "pnpm test", "description" to "Run tests")))),
        )
        assertEquals(
            "cargo test",
            commandOf(
                CodingTool(
                    name = "commandExecution",
                    input = orgJson(mapOf("command" to listOf("bash", "-lc", "cargo test"), "cwd" to root)),
                ),
            ),
        )
        assertEquals(
            "git status",
            commandOf(CodingTool(name = "shell", input = orgJson(mapOf("command" to "bash -lc 'git status'")))),
        )
        assertEquals("ls -la", commandOf(CodingTool(name = "Bash", summary = "ls -la")))
    }

    @Test
    fun readsOutputAndExitCodeFromATextACodexResultOrContentBlocks() {
        assertEquals(CommandResult(output = "ok\n"), commandResult(CodingTool(name = "Bash", output = "ok\n")))
        assertEquals(
            CommandResult(output = "boom", exitCode = 2),
            commandResult(CodingTool(name = "x", output = orgJson(mapOf("output" to "boom", "exitCode" to 2)))),
        )
        assertEquals(
            CommandResult(output = "line one"),
            commandResult(
                CodingTool(
                    name = "x",
                    output = orgJson(listOf(mapOf("type" to "text", "text" to "line one"))),
                ),
            ),
        )
    }

    @Test
    fun isATerminalStepWithItsTestCountsFailedWhenItExitedNonZero() {
        val step = codingStep(
            "s",
            CodingTool(
                name = "Bash",
                input = orgJson(mapOf("command" to "cd $root && pnpm vitest run")),
                output = orgJson(
                    mapOf(
                        "output" to " Test Files  1 failed | 3 passed (4)\n      Tests  1 failed | 41 passed | 2 skipped (44)",
                        "exitCode" to 1,
                    ),
                ),
                ok = true,
            ),
            root,
        )
        assertTrue(step is CodingStep.Command)
        val command = step as CodingStep.Command
        assertEquals("command", "command")
        assertEquals("cd dispatch-board && pnpm vitest run", command.command)
        assertEquals(1, command.exitCode)
        assertEquals(false, command.ok)
        assertEquals(TestSummary(passed = 41, failed = 1, skipped = 2), command.tests)
    }

    @Test
    fun showsGitDiffsOutputAsDiffsToo() {
        val output = "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const a = 1;\n+const a = 2;\n keep();\n"
        val step = codingStep(
            "s",
            CodingTool(name = "Bash", input = orgJson(mapOf("command" to "git diff")), output = output, ok = true),
        )
        assertTrue(step is CodingStep.Command)
        val diff = (step as CodingStep.Command).diff
        assertNotNull(diff)
        assertEquals("src/a.ts", diff!![0].path)
        assertEquals(1, diff[0].added)
        assertEquals(1, diff[0].removed)
    }

    @Test
    fun readsVitestJestPytestCargoNodeTestMochaAndGo() {
        assertEquals(TestSummary(12, 0, 0), testSummary("      Tests  12 passed (12)"))
        assertEquals(TestSummary(11, 1, 0), testSummary("Tests:       1 failed, 11 passed, 12 total"))
        assertEquals(TestSummary(3, 1, 2), testSummary("===== 3 passed, 1 failed, 2 skipped in 0.12s ====="))
        assertEquals(
            TestSummary(6, 0, 1),
            testSummary("test result: ok. 4 passed; 0 failed; 1 ignored\ntest result: ok. 2 passed; 0 failed; 0 ignored"),
        )
        assertEquals(TestSummary(5, 0, 0), testSummary("# tests 5\n# pass 5\n# fail 0"))
        assertEquals(TestSummary(12, 1, 0), testSummary("  12 passing (30ms)\n  1 failing"))
        assertEquals(TestSummary(2, 0, 0), testSummary("ok  \tacme/board\t0.01s\nok  \tacme/lane\t0.02s"))
        assertNull(testSummary("Compiled successfully"))
    }

    @Test
    fun diffsClaudesEditLineByLineUnchangedLinesKeptAsContext() {
        val files = editFiles(
            CodingTool(
                name = "Edit",
                input = orgJson(
                    mapOf(
                        "file_path" to "$root/src/board/column.ts",
                        "old_string" to "const a = 1;\nkeep();\nconst b = 2;",
                        "new_string" to "const a = 1;\nkeep();\nconst b = 3;\nconst c = 4;",
                    ),
                ),
            ),
            root,
        )
        val file = files[0]
        assertEquals("src/board/column.ts", file.path)
        assertEquals(2, file.added)
        assertEquals(1, file.removed)
        assertEquals(DiffFileStatus.MODIFIED, file.status)
        assertEquals(
            listOf(DiffLineKind.CTX, DiffLineKind.CTX, DiffLineKind.DEL, DiffLineKind.ADD, DiffLineKind.ADD),
            file.hunks[0].lines.map { it.kind },
        )
    }

    @Test
    fun readsMultiEditWriteApplyPatchAndCodexFileChanges() {
        assertEquals(
            2,
            editFiles(
                CodingTool(
                    name = "MultiEdit",
                    input = orgJson(
                        mapOf(
                            "file_path" to "src/a.ts",
                            "edits" to listOf(
                                mapOf("old_string" to "x", "new_string" to "y"),
                                mapOf("old_string" to "", "new_string" to "z"),
                            ),
                        ),
                    ),
                ),
            )[0].added,
        )
        assertEquals(
            1,
            editFiles(
                CodingTool(
                    name = "MultiEdit",
                    input = orgJson(
                        mapOf(
                            "file_path" to "src/a.ts",
                            "edits" to listOf(
                                mapOf("old_string" to "x", "new_string" to "y"),
                                mapOf("old_string" to "", "new_string" to "z"),
                            ),
                        ),
                    ),
                ),
            )[0].removed,
        )
        val written = editFiles(
            CodingTool(
                name = "Write",
                input = orgJson(mapOf("file_path" to "src/new.ts", "content" to "a\nb\nc")),
            ),
        )[0]
        assertEquals("src/new.ts", written.path)
        assertEquals(DiffFileStatus.ADDED, written.status)
        assertEquals(3, written.added)
        assertEquals(0, written.removed)

        val patch = "*** Begin Patch\n*** Update File: src/lane.ts\n@@\n-old\n+new\n ctx\n*** Add File: src/fresh.ts\n+hello\n*** End Patch"
        assertEquals(
            listOf(
                listOf("src/lane.ts", DiffFileStatus.MODIFIED, 1, 1),
                listOf("src/fresh.ts", DiffFileStatus.ADDED, 1, 0),
            ),
            parseApplyPatch(patch).map { listOf(it.path, it.status, it.added, it.removed) },
        )
        assertEquals(2, editFiles(CodingTool(name = "apply_patch", input = orgJson(mapOf("input" to patch)))).size)

        val codex = listOf(
            mapOf(
                "path" to "$root/src/x.ts",
                "kind" to mapOf("type" to "update"),
                "diff" to "@@ -1 +1 @@\n-a\n+b\n",
            ),
            mapOf(
                "path" to "$root/src/y.ts",
                "kind" to mapOf("type" to "add"),
                "diff" to "one\ntwo",
            ),
        )
        assertEquals(
            listOf(
                listOf("src/x.ts", DiffFileStatus.MODIFIED, 1, 1),
                listOf("src/y.ts", DiffFileStatus.ADDED, 2, 0),
            ),
            editFiles(CodingTool(name = "fileChange", input = orgJson(codex)), root)
                .map { listOf(it.path, it.status, it.added, it.removed) },
        )
    }

    @Test
    fun readsAnEditWhosePreviewTheServerCutShort() {
        val cut = "{\n  \"file_path\": \"$root/src/a.ts\",\n  \"old_string\": \"one\\ntwo\",\n  \"new_string\": \"one\\nthree and a long tail that the bound cut"
        val file = editFiles(CodingTool(name = "Edit", input = "$cut\n[… preview shortened]"), root)[0]
        assertEquals("src/a.ts", file.path)
        assertEquals(1, file.removed)
        assertEquals(1, file.added)
    }

    @Test
    fun fallsBackToAllRemovedThenAllAddedPastTheDiffBound() {
        val big = (0 until 600).joinToString("\n") { "l$it" }
        val lines = lineDiff(big, "$big\nmore")
        assertEquals(600, lines.count { it.kind == DiffLineKind.DEL })
    }

    @Test
    fun drawsWordsAsLinesReadsInARowAsOneChipLineTheRestAsStepsAndSumsTheChanges() {
        val messages = listOf(
            line("user", "Pour la colonne du board, garde l'ordre"),
            tool("Read", mapOf("file_path" to "$root/src/board/column.ts")),
            tool("Read", mapOf("file_path" to "$root/src/board/lane.ts")),
            tool("Edit", mapOf("file_path" to "$root/src/board/column.ts", "old_string" to "a", "new_string" to "b")),
            tool("Bash", mapOf("command" to "cd $root && pnpm test")) {
                copy(output = "Tests  3 passed (3)")
            },
            tool("Edit", mapOf("file_path" to "$root/src/board/column.ts", "old_string" to "c", "new_string" to "d\ne")),
            tool("mcp__github__create_issue", mapOf("title" to "x")),
            line("bot", "Done: the column keeps its order."),
        )
        assertEquals(root, codingRoot(messages))
        val rows = codingRows(messages, root)
        assertEquals(
            listOf("line", "reads", "edit", "command", "edit", "tool", "line"),
            rows.map { row ->
                when (row) {
                    is CodingRow.Step -> when (row.step) {
                        is CodingStep.Command -> "command"
                        is CodingStep.Edit -> "edit"
                        is CodingStep.Read -> "read"
                        is CodingStep.Tool -> "tool"
                    }
                    is CodingRow.Reads -> "reads"
                    is CodingRow.Line -> "line"
                }
            },
        )
        val reads = rows[1] as CodingRow.Reads
        assertEquals(listOf("src/board/column.ts", "src/board/lane.ts"), reads.paths)
        assertEquals(
            listOf(ChangedFile(path = "src/board/column.ts", added = 3, removed = 2, rowId = rows[4].id)),
            changedFiles(rows),
        )
    }

    @Test
    fun buildsMessagesFromTheStepsOfATaskWithoutAReadableThread() {
        val messages = stepMessages(
            listOf(BotActivityStep(id = "s", name = "Bash", at = 5.0, ok = true, summary = "pnpm lint")),
            "wren",
            "Wren",
        )
        val row = codingRows(messages)[0] as CodingRow.Step
        assertTrue(row.step is CodingStep.Command)
        assertEquals("pnpm lint", (row.step as CodingStep.Command).command)
    }

    @Test
    fun namesTheFolderBranchNewestCommitAndPullRequest() {
        val place = codingPlace(
            BotCodeWork(
                folder = root,
                branch = "feat/column",
                repo = "acme/board",
                pullRequests = listOf(
                    BotCodePullRequest(
                        number = 12,
                        url = "https://github.com/acme/board/pull/12",
                        action = BotCodePullAction.OPENED,
                        at = 1.0,
                    ),
                ),
                branches = emptyList(),
                commits = listOf(BotCodeCommit(sha = "abcdef1234", pushed = true, at = 1.0)),
            ),
        )
        assertEquals("dispatch-board", place.folder)
        assertEquals("feat/column", place.branch)
        assertEquals(12, place.pull?.number)
        assertEquals("abcdef1234", place.commit?.sha)
        assertEquals("tsx", languageOf("src/a.tsx"))
        assertEquals("dockerfile", languageOf("Dockerfile"))
    }
}

package com.openmausbot.companion.ui

import com.openmausbot.companion.core.BotActivityDetail
import com.openmausbot.companion.core.BotActivityItem
import com.openmausbot.companion.core.BotActivityStatus
import com.openmausbot.companion.core.BotCodeCommit
import com.openmausbot.companion.core.BotCodePullRequest
import com.openmausbot.companion.core.BotCodeWork
import com.openmausbot.companion.core.ChangedFile
import com.openmausbot.companion.core.CodingPlace
import com.openmausbot.companion.core.TestSummary
import com.openmausbot.companion.core.codingPlace
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CodingChatRulesTest {
    private val seed = BotActivityItem(
        id = "thread:t1",
        botId = "wren",
        title = "Keep board order",
        status = BotActivityStatus.RUNNING,
        startedAt = 1_000.0,
        threadId = "t1",
        canStop = true,
        coding = true,
        code = BotCodeWork(folder = "/workspace/bots/wren/dispatch-board", branch = "feat/column"),
    )

    @Test
    fun `live while running waiting or queued`() {
        assertTrue(CodingChatRules.isLive(seed, null))
        assertTrue(
            CodingChatRules.isLive(
                seed.copy(status = BotActivityStatus.FINISHED),
                BotActivityDetail(id = seed.id, status = BotActivityStatus.WAITING, canStop = true),
            ),
        )
        assertFalse(CodingChatRules.isLive(seed.copy(status = BotActivityStatus.FINISHED), null))
    }

    @Test
    fun `stop only while live and stoppable`() {
        assertTrue(CodingChatRules.canStop(seed, null, hasStopHandler = true))
        assertFalse(CodingChatRules.canStop(seed, null, hasStopHandler = false))
        assertFalse(
            CodingChatRules.canStop(
                seed.copy(status = BotActivityStatus.FINISHED, canStop = true),
                null,
                hasStopHandler = true,
            ),
        )
        assertFalse(
            CodingChatRules.canStop(
                seed,
                BotActivityDetail(id = seed.id, status = BotActivityStatus.RUNNING, canStop = false),
                hasStopHandler = true,
            ),
        )
    }

    @Test
    fun `continue needs a readable thread`() {
        assertTrue(CodingChatRules.canContinue("t1"))
        assertFalse(CodingChatRules.canContinue(null))
        assertFalse(CodingChatRules.canContinue("  "))
    }

    @Test
    fun `changes band appears when there is something to show`() {
        val empty = CodingPlace()
        assertFalse(CodingChatRules.showChangesBand(emptyList(), null, empty))
        assertTrue(
            CodingChatRules.showChangesBand(
                listOf(ChangedFile("src/a.ts", 1, 1, "row-1")),
                null,
                empty,
            ),
        )
        assertTrue(
            CodingChatRules.showChangesBand(
                emptyList(),
                TestSummary(3, 0, 0),
                empty,
            ),
        )
        assertTrue(
            CodingChatRules.showChangesBand(
                emptyList(),
                null,
                CodingPlace(commit = BotCodeCommit(sha = "abcdef1234")),
            ),
        )
        assertTrue(
            CodingChatRules.showChangesBand(
                emptyList(),
                null,
                CodingPlace(pull = BotCodePullRequest(number = 12)),
            ),
        )
    }

    @Test
    fun `copy helpers match the desktop wording`() {
        assertEquals("Continue", CodingChatRules.CONTINUE)
        assertEquals("Close chat", CodingChatRules.CLOSE)
        assertEquals("1 file changed", CodingChatRules.changesFilesLabel(1))
        assertEquals("3 files changed", CodingChatRules.changesFilesLabel(3))
        assertEquals("Ask Wren to continue", CodingChatRules.followUpPlaceholder("Wren"))
        assertEquals("Coding task: Keep board order", CodingChatRules.aria("Keep board order"))
        assertEquals("abcdef1", CodingChatRules.shortSha("abcdef1234"))
        assertEquals("Pull request #12", CodingChatRules.pullLabel(12))
        assertEquals("Running", CodingChatRules.statusLabel(BotActivityStatus.RUNNING))
        assertEquals("Waiting for approval", CodingChatRules.statusLabel(BotActivityStatus.WAITING))
    }

    @Test
    fun `folder line prefers the folder name from the place`() {
        val place = codingPlace(seed.code)
        assertEquals("dispatch-board", CodingChatRules.folderLine(place))
        assertEquals("feat/column", place.branch)
    }

    @Test
    fun `elapsed uses the detail end when present`() {
        val detail = BotActivityDetail(
            id = seed.id,
            status = BotActivityStatus.FINISHED,
            startedAt = 0.0,
            endedAt = 45_000.0,
        )
        assertEquals("45s", CodingChatRules.elapsedLabel(seed, detail, nowMs = 99_000.0))
    }
}

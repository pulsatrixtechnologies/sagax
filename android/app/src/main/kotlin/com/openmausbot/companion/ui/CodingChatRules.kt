package com.openmausbot.companion.ui

import com.openmausbot.companion.core.BotActivityDetail
import com.openmausbot.companion.core.BotActivityItem
import com.openmausbot.companion.core.BotActivityStatus
import com.openmausbot.companion.core.ChangedFile
import com.openmausbot.companion.core.CodingPlace
import com.openmausbot.companion.core.TestSummary
import com.openmausbot.companion.core.activityStatusActive
import com.openmausbot.companion.core.formatActivityDuration

/**
 * Coding chat sheet decisions: footer actions, header copy, Changes band.
 * Presentation-free twin of `src/components/coding/CodingChat.tsx`.
 */
object CodingChatRules {
    const val POLL_MS: Long = 3_000
    const val FOLLOW_MS: Long = 30_000

    const val CONTINUE: String = "Continue"
    const val STOP: String = "Stop"
    const val CLOSE: String = "Close chat"
    const val SEND: String = "Send"
    const val LOAD_OLDER: String = "Show earlier messages"
    const val LOADING_OLDER: String = "Loading earlier messages"
    const val EMPTY: String = "Nothing to show for this task yet."
    const val STARTING: String = "Starting the task"
    const val WORKING: String = "Working"
    const val READ: String = "Read"
    const val CHANGES_NONE: String = "No file changed yet"
    const val EDIT_FAILED: String = "This edit did not apply."
    const val FOLLOW_UP_ERROR: String = "Couldn't send. Try again."
    const val LOAD_ERROR: String = "Couldn't load this task."
    const val RETRY: String = "Try again"
    const val BOT_FALLBACK: String = "Bot"

    fun followUpPlaceholder(botName: String): String = "Ask $botName to continue"

    fun aria(title: String): String = "Coding task: $title"

    fun statusLabel(status: BotActivityStatus): String = when (status) {
        BotActivityStatus.RUNNING -> "Running"
        BotActivityStatus.WAITING -> "Waiting for approval"
        BotActivityStatus.QUEUED -> "Queued"
        BotActivityStatus.FINISHED -> "Finished"
        BotActivityStatus.FAILED -> "Failed"
        BotActivityStatus.STOPPED -> "Stopped"
        BotActivityStatus.BLOCKED -> "Blocked"
    }

    fun changesFilesLabel(count: Int): String = when (count) {
        1 -> "1 file changed"
        else -> "$count files changed"
    }

    fun editFailedWhy(why: String): String =
        "This edit did not apply: ${why.lineSequence().firstOrNull().orEmpty().take(200)}"

    fun isLive(item: BotActivityItem, detail: BotActivityDetail?): Boolean =
        activityStatusActive(detail?.status ?: item.status)

    fun canStop(item: BotActivityItem, detail: BotActivityDetail?, hasStopHandler: Boolean): Boolean {
        if (!hasStopHandler) return false
        if (!activityStatusActive(detail?.status ?: item.status)) return false
        return detail?.canStop ?: item.canStop ?: false
    }

    fun canContinue(threadId: String?): Boolean = !threadId.isNullOrBlank()

    fun showChangesBand(files: List<ChangedFile>, tests: TestSummary?, place: CodingPlace): Boolean =
        files.isNotEmpty() || tests != null || place.pull != null || place.commit != null

    fun elapsedLabel(item: BotActivityItem, detail: BotActivityDetail?, nowMs: Double): String {
        val started = detail?.startedAt ?: item.startedAt
        val end = detail?.endedAt ?: item.endedAt ?: nowMs
        return formatActivityDuration(end - started)
    }

    fun folderLine(place: CodingPlace): String? = place.folder ?: place.repo

    fun shortSha(sha: String): String = sha.take(7)

    fun pullLabel(number: Int?): String =
        if (number != null) "Pull request #$number" else "Pull request"
}

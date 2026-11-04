package com.openmausbot.companion.core

import java.util.Calendar
import java.util.TimeZone
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One file of a conversation (`GET /api/threads/:id/files`): an upload, a bot
 * attachment, a linked file or one a tool wrote. Twin of iOS `ThreadFile`.
 */
@Serializable
data class ThreadFile(
    val id: String,
    val messageId: String = "",
    val source: Source = Source.UNKNOWN,
    val name: String = "",
    val mime: String? = null,
    val at: Double = 0.0,
    val size: Int? = null,
    val available: Boolean = false,
    val path: String = "",
    val localPath: String? = null,
    /** Pinned in the Library tab; kept on the server per conversation. */
    val pinned: Boolean = false,
) {
    @Serializable
    enum class Source {
        @SerialName("upload") UPLOAD,
        @SerialName("attachment") ATTACHMENT,
        @SerialName("link") LINK,
        @SerialName("written") WRITTEN,
        @SerialName("unknown") UNKNOWN,
    }
}

@Serializable
internal data class ThreadFilesResponse(val files: List<ThreadFile> = emptyList())

/** One Library row: a conversation file for now (artifacts/pages later). */
sealed class LibraryEntry {
    abstract val id: String
    abstract val at: Double
    abstract val pinned: Boolean
    abstract val title: String

    data class File(val file: ThreadFile) : LibraryEntry() {
        override val id: String get() = "file:${file.id}"
        override val at: Double get() = file.at
        override val pinned: Boolean get() = file.pinned
        override val title: String get() = file.name.ifBlank { file.path.ifBlank { file.id } }
    }
}

data class LibraryGroups(
    val pinned: List<LibraryEntry>,
    val today: List<LibraryEntry>,
    val thisWeek: List<LibraryEntry>,
    val older: List<LibraryEntry>,
) {
    val isEmpty: Boolean
        get() = pinned.isEmpty() && today.isEmpty() && thisWeek.isEmpty() && older.isEmpty()

    val all: List<LibraryEntry>
        get() = pinned + today + thisWeek + older
}

/**
 * The Library tab's grouping (`src/lib/library-items.ts` / iOS `LibraryRules`):
 * pinned on top, then today, the rest of the last seven days, then older.
 */
object LibraryRules {
    /** Older shows this many rows first; "Show more" opens the rest. */
    const val OLDER_PREVIEW: Int = 5

    private const val WEEK_MS: Double = 7.0 * 24 * 3_600_000

    fun groups(
        files: List<ThreadFile>,
        nowMs: Double = System.currentTimeMillis().toDouble(),
        timeZone: TimeZone = TimeZone.getDefault(),
    ): LibraryGroups {
        val startOfToday = startOfDayMs(nowMs, timeZone)
        val entries = files
            .map { LibraryEntry.File(it) }
            .sortedWith(compareByDescending<LibraryEntry> { it.at }.thenBy { it.id })
        val rest = entries.filter { !it.pinned }
        return LibraryGroups(
            pinned = entries.filter { it.pinned },
            today = rest.filter { it.at >= startOfToday },
            thisWeek = rest.filter { it.at < startOfToday && nowMs - it.at < WEEK_MS },
            older = rest.filter { it.at < startOfToday && nowMs - it.at >= WEEK_MS },
        )
    }

    /** Files of every conversation of the group, newest first by file time. */
    fun groupFiles(roomsThreads: Set<String>, byThread: Map<String, List<ThreadFile>>): List<ThreadFile> =
        roomsThreads
            .flatMap { threadId -> byThread[threadId].orEmpty() }
            .sortedWith(compareByDescending<ThreadFile> { it.at }.thenBy { it.id })

    private fun startOfDayMs(nowMs: Double, timeZone: TimeZone): Double {
        val calendar = Calendar.getInstance(timeZone)
        calendar.timeInMillis = nowMs.toLong()
        calendar.set(Calendar.HOUR_OF_DAY, 0)
        calendar.set(Calendar.MINUTE, 0)
        calendar.set(Calendar.SECOND, 0)
        calendar.set(Calendar.MILLISECOND, 0)
        return calendar.timeInMillis.toDouble()
    }
}

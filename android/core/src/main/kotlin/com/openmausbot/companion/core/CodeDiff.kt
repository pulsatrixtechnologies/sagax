package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
enum class DiffLineKind {
    @SerialName("ctx") CTX,
    @SerialName("add") ADD,
    @SerialName("del") DEL,
}

@Serializable
data class DiffLine(
    val kind: DiffLineKind,
    val old: Int? = null,
    @SerialName("new") val newLine: Int? = null,
    val text: String = "",
)

@Serializable
data class DiffHunk(
    val header: String = "",
    val lines: List<DiffLine> = emptyList(),
)

@Serializable
enum class DiffFileStatus {
    @SerialName("added") ADDED,
    @SerialName("modified") MODIFIED,
    @SerialName("deleted") DELETED,
    @SerialName("renamed") RENAMED,
}

@Serializable
data class DiffFile(
    val path: String,
    val status: DiffFileStatus = DiffFileStatus.MODIFIED,
    val added: Int = 0,
    val removed: Int = 0,
    val hunks: List<DiffHunk> = emptyList(),
    val binary: Boolean? = null,
    val previewable: Boolean? = null,
)

private val PREVIEWABLE = Regex("""\.(?:md|markdown|mdx)$""", RegexOption.IGNORE_CASE)

/** Whether the Preview switch applies (Markdown; text only, never HTML). */
fun previewablePath(path: String): Boolean = PREVIEWABLE.containsMatchIn(path)

private val HUNK = Regex("""^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$""")

/**
 * Parse a unified diff (`git diff base...HEAD`) into DiffView's files.
 * Pure and total: unknown lines are skipped, never thrown on.
 * Port of `parseUnifiedDiff` in `shared/code-runs.ts`.
 */
fun parseUnifiedDiff(text: String): List<DiffFile> {
    val files = mutableListOf<MutableDiffFile>()
    var file: MutableDiffFile? = null
    var hunk: MutableDiffHunk? = null
    var oldLine = 0
    var newLine = 0

    fun start(path: String) {
        val next = MutableDiffFile(path = path)
        files += next
        file = next
        hunk = null
    }

    for (raw in text.split("\n")) {
        val line = if (raw.endsWith("\r")) raw.dropLast(1) else raw
        if (line.startsWith("diff --git ")) {
            val match = Regex(""" b/(.+)$""").find(line)
            start(match?.groupValues?.get(1) ?: line.removePrefix("diff --git "))
            continue
        }
        val current = file ?: continue
        if (hunk == null) {
            when {
                line.startsWith("new file mode") -> current.status = DiffFileStatus.ADDED
                line.startsWith("deleted file mode") -> current.status = DiffFileStatus.DELETED
                line.startsWith("rename to ") -> {
                    current.status = DiffFileStatus.RENAMED
                    current.path = line.removePrefix("rename to ")
                }
                line.startsWith("Binary files ") -> current.binary = true
                line.startsWith("+++ ") && line != "+++ /dev/null" ->
                    current.path = line.drop(4).removePrefix("b/")
            }
        }
        val header = HUNK.matchEntire(line)
        if (header != null) {
            oldLine = header.groupValues[1].toInt()
            newLine = header.groupValues[3].toInt()
            val open = MutableDiffHunk(header = line)
            current.hunks += open
            hunk = open
            continue
        }
        val open = hunk ?: continue
        when {
            line.startsWith("+") -> {
                open.lines += DiffLine(kind = DiffLineKind.ADD, newLine = newLine++, text = line.drop(1))
                current.added += 1
            }
            line.startsWith("-") -> {
                open.lines += DiffLine(kind = DiffLineKind.DEL, old = oldLine++, text = line.drop(1))
                current.removed += 1
            }
            line.startsWith(" ") || line.isEmpty() -> {
                if (line.isEmpty() && raw.isEmpty()) continue
                open.lines += DiffLine(
                    kind = DiffLineKind.CTX,
                    old = oldLine++,
                    newLine = newLine++,
                    text = line.drop(1),
                )
            }
        }
    }

    return files.map { entry ->
        entry.toDiffFile(
            previewable = !entry.binary &&
                entry.status != DiffFileStatus.DELETED &&
                previewablePath(entry.path),
        )
    }
}

private class MutableDiffHunk(var header: String, val lines: MutableList<DiffLine> = mutableListOf())

private class MutableDiffFile(
    var path: String,
    var status: DiffFileStatus = DiffFileStatus.MODIFIED,
    var added: Int = 0,
    var removed: Int = 0,
    val hunks: MutableList<MutableDiffHunk> = mutableListOf(),
    var binary: Boolean = false,
) {
    fun toDiffFile(previewable: Boolean): DiffFile = DiffFile(
        path = path,
        status = status,
        added = added,
        removed = removed,
        hunks = hunks.map { DiffHunk(header = it.header, lines = it.lines.toList()) },
        binary = binary.takeIf { it },
        previewable = previewable,
    )
}

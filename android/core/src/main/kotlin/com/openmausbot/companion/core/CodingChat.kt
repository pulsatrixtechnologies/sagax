package com.openmausbot.companion.core

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Pure coding-chat reading of a task's thread (`src/lib/coding-chat.ts`).
 * Paths never show whole; ids never reach a row's text.
 */

data class CodingTool(
    val name: String,
    val summary: String? = null,
    val input: String? = null,
    val output: String? = null,
    val ok: Boolean? = null,
    val durationMs: Double? = null,
    val files: List<String>? = null,
)

/** Lightweight message so coding rows do not depend on Message.Kind mismatches. */
data class CodingMessage(
    val id: String,
    val role: String,
    val kind: String,
    val text: String? = null,
    val at: Double,
    val tool: CodingTool? = null,
)

data class CodingChatTarget(
    val botId: String,
    /** `thread:<id>`, `run:<id>` or `cloud:<id>` */
    val itemId: String,
    val threadId: String? = null,
    val seed: BotActivityItem? = null,
)

data class TestSummary(
    val passed: Int,
    val failed: Int,
    val skipped: Int,
)

sealed class CodingStep {
    abstract val id: String

    data class Command(
        override val id: String,
        val command: String,
        val output: String? = null,
        val exitCode: Int? = null,
        val ok: Boolean? = null,
        val durationMs: Double? = null,
        val tests: TestSummary? = null,
        val diff: List<DiffFile>? = null,
    ) : CodingStep()

    data class Edit(
        override val id: String,
        val files: List<DiffFile>,
        val ok: Boolean? = null,
        val error: String? = null,
    ) : CodingStep()

    data class Read(
        override val id: String,
        val paths: List<String>,
    ) : CodingStep()

    data class Tool(
        override val id: String,
        val tool: CodingTool,
    ) : CodingStep()
}

sealed class CodingRow {
    abstract val id: String

    data class Line(
        override val id: String,
        val message: CodingMessage,
    ) : CodingRow()

    data class Step(
        override val id: String,
        val at: Double,
        val step: CodingStep,
    ) : CodingRow()

    data class Reads(
        override val id: String,
        val at: Double,
        val paths: MutableList<String>,
        var running: Boolean,
    ) : CodingRow()
}

data class ChangedFile(
    val path: String,
    var added: Int,
    var removed: Int,
    var rowId: String,
)

data class CodingPlace(
    val folder: String? = null,
    val repo: String? = null,
    val branch: String? = null,
    val commit: BotCodeCommit? = null,
    val pull: BotCodePullRequest? = null,
)

fun ToolActivity.toCodingTool(): CodingTool = CodingTool(
    name = name,
    summary = summary,
    input = input,
    output = output,
    ok = ok,
    durationMs = durationMs,
    files = files,
)

fun Message.toCodingMessage(): CodingMessage = CodingMessage(
    id = id,
    role = when (role) {
        Message.Role.USER -> "user"
        Message.Role.BOT -> "bot"
    },
    kind = when (kind) {
        Message.Kind.TEXT -> "text"
        Message.Kind.OPTIONS -> "options"
        Message.Kind.ACTIVITY -> "activity"
        Message.Kind.SCREEN -> "screen"
        Message.Kind.DIGEST -> "digest"
        Message.Kind.COMPACTION -> "compaction"
        Message.Kind.ROUTINE_RUN -> "routine.run"
        Message.Kind.UNKNOWN -> "unknown"
    },
    text = text,
    at = at,
    tool = tool?.toCodingTool(),
)

// --- paths ---------------------------------------------------------------

private fun norm(path: String): String = path.replace('\\', '/').trimEnd('/')

/** The folder's own name, never its path. */
fun folderLabel(folder: String?): String? {
    if (folder.isNullOrBlank()) return null
    return norm(folder).split('/').filter { it.isNotEmpty() }.lastOrNull()
}

private val UUID = Regex("""\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b""", RegexOption.IGNORE_CASE)
private val UUID_ONLY = Regex("""^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$""", RegexOption.IGNORE_CASE)

/**
 * A path as the sheet shows it: relative under the task's folder, else its
 * last two segments. A relative path stays as it is.
 */
fun shortPath(path: String, root: String? = null): String {
    val clean = norm(path.trim())
    if (clean.isEmpty()) return clean
    if (root != null) {
        val base = norm(root)
        if (clean == base) return folderLabel(base) ?: clean
        if (clean.startsWith("$base/")) return clean.substring(base.length + 1)
    }
    val absolute = clean.startsWith("/") || Regex("""^[A-Za-z]:/""").containsMatchIn(clean) || clean.startsWith("~/")
    if (!absolute) return clean.removePrefix("./")
    val parts = clean.split('/').filter { it.isNotEmpty() && !UUID_ONLY.matches(it) }
    return if (parts.size <= 2) parts.joinToString("/") else "…/${parts.takeLast(2).joinToString("/")}"
}

private val ABSOLUTE_PATH = Regex(
    """(?<![\w.~-])(?:/(?:workspace|workspaces|home|Users|root|srv|var|tmp|private|opt|data|mnt|app|repo|repos|code|src|builds?)(?:/[^\s'"`:;,()<>\[\]{}|]+)+)""",
)

/**
 * A command line or its output with every server path cut down: the task's
 * folder becomes its name (or nothing before a file under it), any other
 * absolute path its last two segments.
 */
fun redactPaths(text: String, root: String? = null): String {
    var out = text
    if (root != null) {
        val base = norm(root)
        if (base.length > 1) {
            val escaped = Regex.escape(base)
            out = out
                .replace(Regex("$escaped/"), "")
                .replace(Regex("$escaped(?![\\w/-])"), folderLabel(base) ?: "")
        }
    }
    return out.replace(ABSOLUTE_PATH) { shortPath(it.value) }.replace(UUID, "…")
}

// --- tool input and output -----------------------------------------------

private fun looseField(text: String, key: String): String? {
    val match = Regex(""""$key"\s*:\s*"((?:[^"\\]|\\.)*)("?)""", RegexOption.DOT_MATCHES_ALL).find(text) ?: return null
    val body = match.groupValues[1].removeSuffix("\\")
    return try {
        CompanionJson.decodeFromString(kotlinx.serialization.serializer<String>(), "\"$body\"")
    } catch (_: Exception) {
        body
            .replace("\\n", "\n")
            .replace("\\t", "\t")
            .replace("\\\"", "\"")
            .replace("\\\\", "\\")
    }
}

private val LOOSE_KEYS = listOf(
    "command", "cmd", "file_path", "path", "notebook_path", "old_string", "new_string",
    "content", "input", "patch", "output", "stdout", "stderr", "cwd",
)

/**
 * The call's arguments (or result) as the server previewed them: JSON when
 * it parses, else the known string fields read loosely, else the text.
 */
fun parseToolText(text: String?): Any? {
    if (text == null) return null
    val trimmed = text.trim()
    if (!Regex("""^[\[{]""").containsMatchIn(trimmed)) return text
    return try {
        CompanionJson.parseToJsonElement(trimmed)
    } catch (_: Exception) {
        val body = trimmed.replace(Regex("""\n?\[… preview shortened]$"""), "")
        val loose = mutableMapOf<String, JsonElement>()
        for (key in LOOSE_KEYS) {
            val value = looseField(body, key)
            if (value != null) loose[key] = JsonPrimitive(value)
        }
        val exit = Regex(""""(?:exitCode|exit_code)"\s*:\s*(-?\d+)""").find(body)
        if (exit != null) loose["exitCode"] = JsonPrimitive(exit.groupValues[1].toInt())
        if (loose.isNotEmpty()) JsonObject(loose) else text
    }
}

private fun str(value: JsonElement?): String? =
    value?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }

/** `bash -lc '...'` (how Codex reports a command) reads as its script. */
private fun unwrapShell(command: String): String {
    val wrapped = Regex(
        """^(?:/(?:usr/)?bin/)?(?:bash|zsh|sh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$""",
    ).matchEntire(command.trim())
    return wrapped?.groupValues?.get(2) ?: command.trim()
}

/** The shell command a call runs, whatever the engine. */
fun commandOf(tool: CodingTool): String? {
    val input = parseToolText(tool.input)
    if (input is JsonObject) {
        val raw = input["command"] ?: input["cmd"]
        if (raw is JsonArray) {
            val words = raw.mapNotNull { it.jsonPrimitive.contentOrNull }
            if (words.size >= 3 &&
                Regex("""^(?:.*/)?(?:bash|zsh|sh)$""").matches(words[0]) &&
                Regex("""^-l?c$""").matches(words[1])
            ) {
                return words.drop(2).joinToString(" ")
            }
            if (words.isNotEmpty()) return words.joinToString(" ")
        }
        str(raw)?.let { return unwrapShell(it) }
    }
    tool.summary?.let { return unwrapShell(it) }
    if (Regex("""\s""").containsMatchIn(tool.name)) return unwrapShell(tool.name)
    return null
}

/** The folder a call ran in, when it says (Codex `cwd`, a leading `cd`). */
fun commandFolder(tool: CodingTool): String? {
    val input = parseToolText(tool.input)
    if (input is JsonObject) str(input["cwd"])?.let { return it }
    val command = commandOf(tool) ?: return null
    val cd = Regex("""^\s*cd\s+(['"]?)(/[^'"\s;&|]+)\1""").find(command)
    return cd?.groupValues?.get(2)
}

data class CommandResult(val output: String? = null, val exitCode: Int? = null)

/** A shell call's output and exit code. */
fun commandResult(tool: CodingTool): CommandResult {
    val result = parseToolText(tool.output) ?: return CommandResult()
    if (result is String) return CommandResult(output = result)
    if (result is JsonArray) {
        val text = result.flatMap { part ->
            when {
                part is JsonObject && part["text"] is JsonPrimitive -> listOf(part["text"]!!.jsonPrimitive.content)
                part is JsonPrimitive -> listOf(part.content)
                else -> emptyList()
            }
        }.joinToString("\n")
        return if (text.isNotEmpty()) CommandResult(output = text) else CommandResult(output = tool.output)
    }
    if (result is JsonObject) {
        val output = listOf(result["output"], result["stdout"], result["aggregatedOutput"], result["stderr"])
            .mapNotNull { str(it) }
            .joinToString("\n")
        val exit = result["exitCode"] ?: result["exit_code"] ?: result["code"]
        val exitCode = exit?.jsonPrimitive?.intOrNull
            ?: exit?.jsonPrimitive?.longOrNull?.toInt()
            ?: exit?.jsonPrimitive?.doubleOrNull?.toInt()
        if (output.isNotEmpty() || exitCode != null) {
            return CommandResult(
                output = output.takeIf { it.isNotEmpty() },
                exitCode = exitCode,
            )
        }
        if (result["content"] is JsonArray) {
            return commandResult(tool.copy(output = CompanionJson.encodeToString(result["content"])))
        }
    }
    return CommandResult(output = tool.output)
}

// --- diffs -----------------------------------------------------------------

private const val LCS_MAX_CELLS = 250_000

/**
 * The lines two texts differ by, unchanged lines kept as context (LCS over
 * lines). Past its bound it reads as all removed, then all added.
 */
fun lineDiff(before: String, after: String): List<DiffLine> {
    fun split(text: String): List<String> =
        if (text.isEmpty()) emptyList() else text.removeSuffix("\n").split("\n")
    val a = split(before)
    val b = split(after)
    val out = mutableListOf<DiffLine>()
    if (a.size.toLong() * b.size.toLong() > LCS_MAX_CELLS) {
        a.forEachIndexed { index, text -> out += DiffLine(DiffLineKind.DEL, old = index + 1, text = text) }
        b.forEachIndexed { index, text -> out += DiffLine(DiffLineKind.ADD, newLine = index + 1, text = text) }
        return out
    }
    val m = a.size
    val n = b.size
    val table = Array(m + 1) { IntArray(n + 1) }
    for (i in m - 1 downTo 0) {
        for (j in n - 1 downTo 0) {
            table[i][j] = if (a[i] == b[j]) table[i + 1][j + 1] + 1 else maxOf(table[i + 1][j], table[i][j + 1])
        }
    }
    var i = 0
    var j = 0
    while (i < m && j < n) {
        when {
            a[i] == b[j] -> {
                out += DiffLine(DiffLineKind.CTX, old = i + 1, newLine = j + 1, text = a[i])
                i++; j++
            }
            table[i + 1][j] >= table[i][j + 1] -> {
                out += DiffLine(DiffLineKind.DEL, old = i + 1, text = a[i])
                i++
            }
            else -> {
                out += DiffLine(DiffLineKind.ADD, newLine = j + 1, text = b[j])
                j++
            }
        }
    }
    while (i < m) {
        out += DiffLine(DiffLineKind.DEL, old = i + 1, text = a[i]); i++
    }
    while (j < n) {
        out += DiffLine(DiffLineKind.ADD, newLine = j + 1, text = b[j]); j++
    }
    return out
}

internal fun fileOf(
    path: String,
    lines: List<DiffLine>,
    status: DiffFileStatus = DiffFileStatus.MODIFIED,
): DiffFile = DiffFile(
    path = path,
    status = status,
    added = lines.count { it.kind == DiffLineKind.ADD },
    removed = lines.count { it.kind == DiffLineKind.DEL },
    hunks = if (lines.isNotEmpty()) listOf(DiffHunk(header = "", lines = lines)) else emptyList(),
)

/**
 * An apply_patch body (`*** Begin Patch` / `*** Update File: x` / `@@` /
 * `-old` `+new`) into its files.
 */
fun parseApplyPatch(text: String): List<DiffFile> {
    if (!Regex("""\*\*\* (?:Begin Patch|Update File:|Add File:|Delete File:)""").containsMatchIn(text)) {
        return emptyList()
    }
    val files = mutableListOf<DiffFile>()
    var current: DiffFile? = null
    var lines = mutableListOf<DiffLine>()
    fun close() {
        val open = current
        if (open != null) {
            val idx = files.lastIndex
            files[idx] = open.copy(
                hunks = if (lines.isNotEmpty()) listOf(DiffHunk(header = "", lines = lines.toList())) else emptyList(),
                added = lines.count { it.kind == DiffLineKind.ADD },
                removed = lines.count { it.kind == DiffLineKind.DEL },
            )
        }
        lines = mutableListOf()
    }
    for (line in text.split("\n")) {
        val head = Regex("""^\*\*\* (Update|Add|Delete) File: (.+)$""").find(line)
        if (head != null) {
            close()
            val status = when (head.groupValues[1]) {
                "Add" -> DiffFileStatus.ADDED
                "Delete" -> DiffFileStatus.DELETED
                else -> DiffFileStatus.MODIFIED
            }
            current = DiffFile(path = head.groupValues[2].trim(), status = status)
            files += current!!
            continue
        }
        val move = Regex("""^\*\*\* Move to: (.+)$""").find(line)
        if (move != null && current != null) {
            val idx = files.lastIndex
            current = current!!.copy(path = move.groupValues[1].trim(), status = DiffFileStatus.RENAMED)
            files[idx] = current!!
            continue
        }
        if (current == null || line.startsWith("***") || line.startsWith("@@")) continue
        when {
            line.startsWith("+") -> lines += DiffLine(DiffLineKind.ADD, text = line.drop(1))
            line.startsWith("-") -> lines += DiffLine(DiffLineKind.DEL, text = line.drop(1))
            line.startsWith(" ") -> lines += DiffLine(DiffLineKind.CTX, text = line.drop(1))
        }
    }
    close()
    return files
}

private fun codexChange(change: JsonObject): DiffFile? {
    val path = str(change["path"]) ?: return null
    val kindEl = change["kind"]
    val kind = when (kindEl) {
        is JsonObject -> str(kindEl["type"])
        else -> str(kindEl)
    }
    val diff = str(change["diff"]) ?: str(change["unified_diff"]) ?: ""
    val status = when (kind) {
        "add" -> DiffFileStatus.ADDED
        "delete" -> DiffFileStatus.DELETED
        else -> DiffFileStatus.MODIFIED
    }
    if (Regex("""^(?:diff --git|---|@@)""", RegexOption.MULTILINE).containsMatchIn(diff)) {
        val text = if (diff.startsWith("diff --git")) diff else "diff --git a/$path b/$path\n$diff"
        val parsed = parseUnifiedDiff(text).firstOrNull()
        if (parsed != null) {
            return parsed.copy(
                path = path,
                status = if (parsed.status == DiffFileStatus.MODIFIED) status else parsed.status,
            )
        }
    }
    return when (status) {
        DiffFileStatus.ADDED -> fileOf(path, lineDiff("", diff), DiffFileStatus.ADDED)
        DiffFileStatus.DELETED -> fileOf(path, lineDiff(diff, ""), DiffFileStatus.DELETED)
        else -> fileOf(path, emptyList(), status)
    }
}

/** The files a file-editing call changed, as diffs. */
fun editFiles(tool: CodingTool, root: String? = null): List<DiffFile> {
    val input = parseToolText(tool.input)
    fun short(path: String) = shortPath(path, root)
    if (input is JsonArray) {
        return input.mapNotNull { change ->
            if (change is JsonObject) codexChange(change) else null
        }.map { it.copy(path = short(it.path)) }
    }
    if (input is String) return parseApplyPatch(input).map { it.copy(path = short(it.path)) }
    if (input !is JsonObject) return emptyList()
    if (input["changes"] is JsonArray) {
        return editFiles(tool.copy(input = CompanionJson.encodeToString(input["changes"])), root)
    }
    if (input["changes"] is JsonObject) {
        return input["changes"]!!.jsonObject.entries.flatMap { (path, value) ->
            if (value !is JsonObject) return@flatMap emptyList()
            val kindName = value.keys.firstOrNull() ?: return@flatMap emptyList()
            val body = value[kindName] as? JsonObject ?: JsonObject(emptyMap())
            val change = codexChange(
                JsonObject(
                    mapOf(
                        "path" to JsonPrimitive(path),
                        "kind" to JsonPrimitive(kindName),
                        "diff" to JsonPrimitive(str(body["unified_diff"]) ?: str(body["content"]) ?: ""),
                    ),
                ),
            )
            if (change != null) listOf(change.copy(path = short(change.path))) else emptyList()
        }
    }
    val patch = str(input["patch"]) ?: str(input["input"])
    if (patch != null && Regex("""\*\*\* Begin Patch""").containsMatchIn(patch)) {
        return parseApplyPatch(patch).map { it.copy(path = short(it.path)) }
    }
    if (patch != null && Regex("""^(?:diff --git|@@)""", RegexOption.MULTILINE).containsMatchIn(patch)) {
        return parseUnifiedDiff(patch).map { it.copy(path = short(it.path)) }
    }
    val path = str(input["file_path"]) ?: str(input["path"]) ?: str(input["notebook_path"]) ?: str(input["target_file"])
        ?: return emptyList()
    if (input["edits"] is JsonArray) {
        val lines = input["edits"]!!.jsonArray.flatMap { edit ->
            if (edit is JsonObject) {
                lineDiff(str(edit["old_string"]) ?: "", str(edit["new_string"]) ?: "")
            } else {
                emptyList()
            }
        }
        return listOf(fileOf(short(path), lines))
    }
    if (input["old_string"] is JsonPrimitive || input["new_string"] is JsonPrimitive) {
        return listOf(fileOf(short(path), lineDiff(str(input["old_string"]) ?: "", str(input["new_string"]) ?: "")))
    }
    val content = when {
        input["content"] is JsonPrimitive -> str(input["content"])
        input["file_text"] is JsonPrimitive -> str(input["file_text"])
        else -> null
    }
    if (content != null) return listOf(fileOf(short(path), lineDiff("", content), DiffFileStatus.ADDED))
    return emptyList()
}

// --- tests -----------------------------------------------------------------

private fun num(value: String?): Int = value?.toIntOrNull() ?: 0

/** A test run's counts, read off its output; null when it is not one. */
fun testSummary(output: String?): TestSummary? {
    if (output == null) return null
    val text = output.replace(Regex("""\u001b\[[0-9;]*m"""), "")
    Regex("""^\s*Tests\s+(.+?)\s*\(\d+\)\s*$""", RegexOption.MULTILINE).find(text)?.let { vitest ->
        val part = vitest.groupValues[1]
        return TestSummary(
            passed = num(Regex("""(\d+) passed""").find(part)?.groupValues?.get(1)),
            failed = num(Regex("""(\d+) failed""").find(part)?.groupValues?.get(1)),
            skipped = num(Regex("""(\d+) (?:skipped|todo)""").find(part)?.groupValues?.get(1)),
        )
    }
    Regex("""^\s*Tests:\s+(.+?total)\s*$""", RegexOption.MULTILINE).find(text)?.let { jest ->
        val part = jest.groupValues[1]
        return TestSummary(
            passed = num(Regex("""(\d+) passed""").find(part)?.groupValues?.get(1)),
            failed = num(Regex("""(\d+) failed""").find(part)?.groupValues?.get(1)),
            skipped = num(Regex("""(\d+) skipped""").find(part)?.groupValues?.get(1)),
        )
    }
    Regex("""^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s(?: \([^)]*\))? =+$""", RegexOption.MULTILINE)
        .find(text)?.let { pytest ->
            val part = pytest.groupValues[1]
            return TestSummary(
                passed = num(Regex("""(\d+) passed""").find(part)?.groupValues?.get(1)),
                failed = num(Regex("""(\d+) failed""").find(part)?.groupValues?.get(1)) +
                    num(Regex("""(\d+) errors?""").find(part)?.groupValues?.get(1)),
                skipped = num(Regex("""(\d+) skipped""").find(part)?.groupValues?.get(1)),
            )
        }
    val cargo = Regex("""test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored""").findAll(text).toList()
    if (cargo.isNotEmpty()) {
        return cargo.fold(TestSummary(0, 0, 0)) { sum, match ->
            TestSummary(
                passed = sum.passed + num(match.groupValues[1]),
                failed = sum.failed + num(match.groupValues[2]),
                skipped = sum.skipped + num(match.groupValues[3]),
            )
        }
    }
    Regex("""^# pass (\d+)$""", RegexOption.MULTILINE).find(text)?.let { tapPass ->
        return TestSummary(
            passed = num(tapPass.groupValues[1]),
            failed = num(Regex("""^# fail (\d+)$""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1)),
            skipped = num(Regex("""^# skip(?:ped)? (\d+)$""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1)),
        )
    }
    Regex("""^\s*(\d+) passing\b""", RegexOption.MULTILINE).find(text)?.let { mocha ->
        return TestSummary(
            passed = num(mocha.groupValues[1]),
            failed = num(Regex("""^\s*(\d+) failing\b""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1)),
            skipped = num(Regex("""^\s*(\d+) pending\b""", RegexOption.MULTILINE).find(text)?.groupValues?.get(1)),
        )
    }
    val goOk = Regex("""^ok\s+\S+\s+[\d.]+s""", RegexOption.MULTILINE).findAll(text).count()
    val goFailNamed = Regex("""^--- FAIL: """, RegexOption.MULTILINE).findAll(text).count()
    val goFailLine = Regex("""^FAIL\s+\S+\s+[\d.]+s""", RegexOption.MULTILINE).findAll(text).count()
    val goFail = if (goFailNamed > 0) goFailNamed else goFailLine
    if (goOk > 0 || goFail > 0) return TestSummary(passed = goOk, failed = goFail, skipped = 0)
    return null
}

// --- rows ------------------------------------------------------------------

enum class StepKind { COMMAND, EDIT, READ, TOOL }

fun stepKindOf(tool: CodingTool): StepKind {
    val step = workingStepFor(WorkingStepCall(name = tool.name, summary = tool.summary, input = tool.input))
    val bare = tool.name.replace(Regex("""^mcp__.+?__"""), "").lowercase()
    if (Regex("""^(apply_patch|filechange|file_change)$""").matches(bare)) return StepKind.EDIT
    if (step?.key == WorkingStepKey.RUN && commandOf(tool) != null) return StepKind.COMMAND
    if (step?.key == WorkingStepKey.EDIT_FILE || step?.key == WorkingStepKey.WRITE_FILE) return StepKind.EDIT
    if (step?.key == WorkingStepKey.READ_FILE) return StepKind.READ
    return StepKind.TOOL
}

private fun readPaths(tool: CodingTool, root: String?): List<String> {
    val input = parseToolText(tool.input)
    if (input is JsonObject) {
        val path = str(input["file_path"]) ?: str(input["path"]) ?: str(input["notebook_path"])
            ?: str(input["absolute_path"]) ?: str(input["filename"])
        if (path != null) return listOf(shortPath(path, root))
        if (input["paths"] is JsonArray) {
            return input["paths"]!!.jsonArray.mapNotNull { el ->
                el.jsonPrimitive.contentOrNull?.let { shortPath(it, root) }
            }
        }
    }
    tool.files?.takeIf { it.isNotEmpty() }?.let { return it.map { path -> shortPath(path, root) } }
    val titled = Regex("""^\S+\s+(\S+)$""").find(tool.name)
    return if (titled != null) listOf(shortPath(titled.groupValues[1], root)) else emptyList()
}

/** One tool call as a coding step. */
fun codingStep(id: String, tool: CodingTool, root: String? = null): CodingStep {
    val kind = stepKindOf(tool)
    if (kind == StepKind.COMMAND) {
        val raw = commandOf(tool)!!
        val command = redactPaths(raw, root)
        val result = commandResult(tool)
        val shown = result.output?.let { redactPaths(it, root) }
        val diff = if (
            Regex("""^\s*(?:cd\s+\S+\s*&&\s*)?git\s+(?:diff|show)\b""").containsMatchIn(raw) &&
            result.output != null &&
            Regex("""^diff --git """, RegexOption.MULTILINE).containsMatchIn(result.output)
        ) {
            parseUnifiedDiff(result.output).map { it.copy(path = shortPath(it.path, root)) }
        } else {
            null
        }
        return CodingStep.Command(
            id = id,
            command = command,
            output = shown,
            exitCode = result.exitCode,
            ok = tool.ok?.let { it && (result.exitCode == null || result.exitCode == 0) },
            durationMs = tool.durationMs,
            tests = testSummary(result.output),
            diff = diff?.takeIf { it.isNotEmpty() },
        )
    }
    if (kind == StepKind.EDIT) {
        val files = editFiles(tool, root).toMutableList()
        if (files.isEmpty() && !tool.files.isNullOrEmpty()) {
            files += tool.files.map { path -> fileOf(shortPath(path, root), emptyList()) }
        }
        if (files.isNotEmpty()) {
            val error = if (tool.ok == false && tool.output != null) {
                redactPaths(commandResult(tool).output ?: tool.output, root)
            } else {
                null
            }
            return CodingStep.Edit(id = id, files = files, ok = tool.ok, error = error)
        }
    }
    if (kind == StepKind.READ) {
        val paths = readPaths(tool, root)
        if (paths.isNotEmpty()) return CodingStep.Read(id = id, paths = paths)
    }
    return CodingStep.Tool(
        id = id,
        tool = tool.copy(summary = tool.summary?.let { redactPaths(it, root) }),
    )
}

/** The task's folder: the activity entry's repository folder, else the first folder a call named. */
fun codingRoot(messages: List<CodingMessage>, code: BotCodeWork? = null): String? {
    code?.folder?.let { return it }
    for (message in messages) {
        val tool = message.tool ?: continue
        commandFolder(tool)?.let { return it }
    }
    return null
}

fun codingRootFromMessages(messages: List<Message>, code: BotCodeWork? = null): String? =
    codingRoot(messages.map { it.toCodingMessage() }, code)

private fun isLine(message: CodingMessage): Boolean {
    if (message.kind == "activity" || message.kind == "digest" || message.kind == "compaction") return false
    return !message.text.isNullOrBlank()
}

/** The transcript as the coding chat draws it. */
fun codingRows(messages: List<CodingMessage>, root: String? = null): List<CodingRow> {
    val rows = mutableListOf<CodingRow>()
    for (message in messages) {
        if (message.tool != null && message.kind == "activity") {
            val step = codingStep(message.id, message.tool, root)
            val previous = rows.lastOrNull()
            if (step is CodingStep.Read) {
                if (previous is CodingRow.Reads) {
                    for (path in step.paths) if (path !in previous.paths) previous.paths += path
                    previous.running = message.tool.ok == null
                } else {
                    rows += CodingRow.Reads(
                        id = message.id,
                        at = message.at,
                        paths = step.paths.toMutableList(),
                        running = message.tool.ok == null,
                    )
                }
                continue
            }
            rows += CodingRow.Step(id = message.id, at = message.at, step = step)
            continue
        }
        if (isLine(message)) rows += CodingRow.Line(id = message.id, message = message)
    }
    return rows
}

fun codingRowsFromMessages(messages: List<Message>, root: String? = null): List<CodingRow> =
    codingRows(messages.map { it.toCodingMessage() }, root)

/** A task the viewer may not read the thread of: its steps alone. */
fun stepMessages(steps: List<BotActivityStep>, botId: String, botName: String): List<CodingMessage> =
    steps.mapIndexed { index, step ->
        CodingMessage(
            id = "step-$index",
            role = "bot",
            kind = "activity",
            text = "",
            at = step.at,
            tool = CodingTool(
                name = step.name,
                summary = step.summary,
                input = step.input,
                ok = step.ok,
                output = step.error,
                files = step.files,
            ),
        )
    }

/** Every file the task changed, edits of one file summed, in first-touch order. */
fun changedFiles(rows: List<CodingRow>): List<ChangedFile> {
    val byPath = linkedMapOf<String, ChangedFile>()
    for (row in rows) {
        if (row !is CodingRow.Step) continue
        val files = when (val step = row.step) {
            is CodingStep.Edit -> if (step.ok != false) step.files else emptyList()
            else -> emptyList()
        }
        for (file in files) {
            val known = byPath[file.path]
            if (known != null) {
                known.added += file.added
                known.removed += file.removed
                known.rowId = row.id
            } else {
                byPath[file.path] = ChangedFile(path = file.path, added = file.added, removed = file.removed, rowId = row.id)
            }
        }
    }
    return byPath.values.toList()
}

/** The newest test run of the task. */
fun latestTests(rows: List<CodingRow>): TestSummary? {
    for (index in rows.indices.reversed()) {
        val row = rows[index]
        if (row is CodingRow.Step) {
            val step = row.step
            if (step is CodingStep.Command && step.tests != null) return step.tests
        }
    }
    return null
}

/** What the header and the Changes band say of the task's code. */
fun codingPlace(detail: BotActivityDetail?, root: String? = null): CodingPlace {
    val code = detail?.code
    val folder = folderLabel(code?.folder ?: root)
    val pull = code?.pullRequests?.firstOrNull()
    val commit = code?.commits?.firstOrNull()
    return CodingPlace(
        folder = folder,
        repo = code?.repo,
        branch = code?.branch ?: commit?.branch ?: code?.branches?.firstOrNull()?.name,
        commit = commit,
        pull = pull,
    )
}

fun codingPlace(code: BotCodeWork?, root: String? = null): CodingPlace =
    codingPlace(
        detail = if (code == null) null else BotActivityDetail(code = code),
        root = root,
    )

/** The extension's grammar for the syntax colours. */
fun languageOf(path: String): String {
    val name = path.split('/').lastOrNull()?.lowercase().orEmpty()
    if (name == "dockerfile") return "dockerfile"
    if (name == "makefile") return "makefile"
    val ext = if (name.contains('.')) name.substringAfterLast('.') else ""
    val map = mapOf(
        "mjs" to "javascript",
        "cjs" to "javascript",
        "mts" to "typescript",
        "cts" to "typescript",
        "h" to "c",
        "hpp" to "cpp",
        "hh" to "cpp",
        "jsonl" to "json",
        "yml" to "yaml",
        "zsh" to "bash",
        "env" to "bash",
    )
    return map[ext] ?: ext
}

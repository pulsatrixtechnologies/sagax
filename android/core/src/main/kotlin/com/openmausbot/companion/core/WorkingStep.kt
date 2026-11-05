package com.openmausbot.companion.core

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The step a bot is on, named for people (`shared/working-step.ts`).
 * Clients only translate the key; the detail is a short name.
 */
@Serializable
enum class WorkingStepKey {
    @SerialName("readMail") READ_MAIL,
    @SerialName("writeMail") WRITE_MAIL,
    @SerialName("calendar") CALENDAR,
    @SerialName("writeCalendar") WRITE_CALENDAR,
    @SerialName("readChat") READ_CHAT,
    @SerialName("writeChat") WRITE_CHAT,
    @SerialName("openApp") OPEN_APP,
    @SerialName("browse") BROWSE,
    @SerialName("readPage") READ_PAGE,
    @SerialName("searchWeb") SEARCH_WEB,
    @SerialName("run") RUN,
    @SerialName("readFile") READ_FILE,
    @SerialName("writeFile") WRITE_FILE,
    @SerialName("editFile") EDIT_FILE,
    @SerialName("searchFiles") SEARCH_FILES,
    @SerialName("screen") SCREEN,
    @SerialName("computer") COMPUTER,
    @SerialName("teammate") TEAMMATE,
    @SerialName("subagent") SUBAGENT,
    @SerialName("memory") MEMORY,
    @SerialName("tool") TOOL,
}

@Serializable
data class WorkingStep(
    val key: WorkingStepKey,
    val detail: String? = null,
)

/** What a tool call carries when it starts. */
data class WorkingStepCall(
    val name: String,
    val summary: String? = null,
    val input: String? = null,
    val product: String? = null,
)

private const val DETAIL_MAX = 40

private fun cleanDetail(value: String?): String? {
    if (value == null) return null
    val text = value
        .replace(Regex("""[\r\n\t]+"""), " ")
        .replace(Regex("""\s+"""), " ")
        .trim()
        .trim('"', '\'', '`')
    if (text.isEmpty() || Regex("""\[redacted\]|\*{3,}""", RegexOption.IGNORE_CASE).containsMatchIn(text)) {
        return null
    }
    return if (text.length > DETAIL_MAX) text.take(DETAIL_MAX - 1) + "…" else text
}

private fun baseName(path: String): String {
    val trimmed = path.trim().trimEnd('/', '\\')
    val parts = trimmed.split('/', '\\')
    return parts.lastOrNull() ?: trimmed
}

private fun hostOf(url: String?): String? {
    if (url.isNullOrBlank()) return null
    return try {
        val withScheme = if (Regex("""^[a-z][\w+.-]*://""", RegexOption.IGNORE_CASE).containsMatchIn(url)) {
            url
        } else {
            "https://$url"
        }
        java.net.URI(withScheme).host?.removePrefix("www.")?.takeIf { it.isNotEmpty() }
    } catch (_: Exception) {
        null
    }
}

private fun parseInput(input: String?): JsonElement? {
    if (input.isNullOrBlank()) return null
    return try {
        val value = CompanionJson.parseToJsonElement(input)
        if (value is JsonObject || value is JsonArray) value else null
    } catch (_: Exception) {
        null
    }
}

private fun field(input: JsonElement?, names: List<String>): String? {
    if (input == null) return null
    val record: JsonObject? = when (input) {
        is JsonObject -> input
        is JsonArray -> input.firstOrNull { it is JsonObject }?.jsonObject
        else -> null
    }
    if (record == null) return null
    for (name in names) {
        val value = record[name]?.jsonPrimitive?.contentOrNull
        if (!value.isNullOrBlank()) return value
    }
    return null
}

private val FILE_FIELDS = listOf(
    "file_path", "path", "notebook_path", "filename", "file", "target_file", "absolute_path",
)
private val URL_FIELDS = listOf("url", "uri", "href", "link")
private val APP_FIELDS = listOf("app", "application", "app_name", "appName", "name", "bundle_id", "bundleId")

private fun fileDetail(input: JsonElement?): String? {
    val path = field(input, FILE_FIELDS) ?: return null
    return cleanDetail(baseName(path))
}

private fun withDetail(value: String?): WorkingStepExtras {
    val detail = cleanDetail(value)
    return WorkingStepExtras(detail)
}

private data class WorkingStepExtras(val detail: String? = null)

private val INTERPRETERS = setOf(
    "python", "python3", "python2", "py", "node", "bun", "deno", "ruby", "perl", "php", "bash", "sh", "zsh",
    "fish", "pwsh", "powershell", "tsx", "ts-node", "rscript", "lua", "osascript", "swift", "java",
)
private val PREFIXES = setOf("sudo", "env", "time", "nohup", "exec", "command", "caffeinate")

private val WRITE_VERB = Regex("""(send|reply|forward|draft|compose|create|update|delete|move|post|write|respond|cancel|schedule|book|set_)""")

/**
 * The program or the script a shell command runs, never its arguments.
 * Port of `commandStep` in `shared/working-step.ts`.
 */
fun commandStep(command: String): WorkingStep {
    val segments = command.split(Regex("""&&|\|\||;|\|""")).map { it.trim() }.filter { it.isNotEmpty() }
    val segment = segments.firstOrNull { part ->
        !Regex("""^(cd|pushd|export|set|source|\.)\s""").containsMatchIn(part) && part != "cd"
    } ?: segments.firstOrNull().orEmpty()
    val words = Regex("""("[^"]*"|'[^']*'|\S+)""").findAll(segment)
        .map { it.value.trim('"', '\'') }
        .toList()
    var index = 0
    while (index < words.size && (words[index] in PREFIXES || Regex("""^\w+=""").containsMatchIn(words[index]))) {
        index++
    }
    val program = words.getOrNull(index) ?: return WorkingStep(WorkingStepKey.RUN)
    val name = baseName(program)
    val lower = name.lowercase()
    if (lower == "open") {
        val flag = words.withIndex().indexOfFirst { (i, word) -> i >= index && word == "-a" }
        val app = if (flag >= 0) words.getOrNull(flag + 1) else null
        if (app != null) {
            return WorkingStep(WorkingStepKey.OPEN_APP, withDetail(baseName(app).replace(Regex("""\.app$""", RegexOption.IGNORE_CASE), "")).detail)
        }
        val target = words.drop(index + 1).firstOrNull { !it.startsWith("-") }
        val host = if (target != null && Regex("""^https?://""", RegexOption.IGNORE_CASE).containsMatchIn(target)) {
            hostOf(target)
        } else {
            null
        }
        if (host != null) return WorkingStep(WorkingStepKey.BROWSE, withDetail(host).detail)
    }
    if (lower == "start" && words.getOrNull(index + 1) != null) {
        return WorkingStep(WorkingStepKey.OPEN_APP, withDetail(words[index + 1]).detail)
    }
    var rest = words.drop(index + 1)
    if ((lower == "uv" || lower == "poetry" || lower == "pipenv") && rest.firstOrNull() == "run") {
        rest = rest.drop(1)
    }
    val interpreter = INTERPRETERS.contains(lower.removeSuffix(".exe")) ||
        ((lower == "uv" || lower == "poetry" || lower == "pipenv") && words.getOrNull(index + 1) == "run")
    if (interpreter) {
        val module = if (rest.firstOrNull() == "-m") rest.getOrNull(1) else null
        if (module != null) return WorkingStep(WorkingStepKey.RUN, withDetail(module).detail)
        val script = rest.firstOrNull { !it.startsWith("-") }
        if (script != null && Regex("""[./\\]""").containsMatchIn(script)) {
            return WorkingStep(WorkingStepKey.RUN, withDetail(baseName(script)).detail)
        }
        return WorkingStep(WorkingStepKey.RUN, withDetail(name).detail)
    }
    return WorkingStep(WorkingStepKey.RUN, withDetail(name).detail)
}

private fun splitName(name: String): Pair<String?, String> {
    val mcp = Regex("""^mcp__(.+?)__(.+)$""").find(name)
    if (mcp != null) return mcp.groupValues[1] to mcp.groupValues[2]
    val dotted = Regex("""^([\w-]+)[./]([\w-]+)$""").find(name)
    if (dotted != null && !Regex("""\.(py|js|ts|sh|rb|md|json|txt)$""", RegexOption.IGNORE_CASE).containsMatchIn(name)) {
        return dotted.groupValues[1] to dotted.groupValues[2]
    }
    return null to name
}

/**
 * The step for a tool call, or null when there is nothing better to say.
 * Faithful port of `workingStepFor` in `shared/working-step.ts`.
 */
fun workingStepFor(call: WorkingStepCall): WorkingStep? {
    val raw = call.name.trim()
    if (raw.isEmpty() || Regex("""^(auto-approved|error):""", RegexOption.IGNORE_CASE).containsMatchIn(raw)) {
        return null
    }
    val input = parseInput(call.input)
    val (server, tool) = splitName(raw)
    val bare = tool.lowercase()
    val scope = "${(server ?: "").lowercase()} $bare"

    if (Regex("""^(todowrite|todo_write|update_plan|toolsearch|tool_search|exitplanmode|think|sleep)$""").containsMatchIn(bare)) {
        return null
    }

    val shellName = Regex(
        """^(bash|shell|sh|zsh|terminal|exec|execute|run_command|run_shell_command|run_terminal_cmd|command|commandexecution|command_execution|computer_exec|powershell|local_shell|bashoutput)$""",
    ).containsMatchIn(bare)
    if (shellName) {
        val command = call.summary ?: field(input, listOf("command", "cmd"))
        return if (command != null) commandStep(command) else WorkingStep(WorkingStepKey.RUN)
    }

    if (Regex("""^(task|agent|spawn_agent|subagent|run_subagent|run_with_engine)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.SUBAGENT)
    }
    if (Regex("""(ask_bot|delegate_bot|coordinate_bots|list_bots|post_to_room|send_prompt|await_turn|list_agents|find_agents)""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.TEAMMATE)
    }
    if (bare == "send_message" && (server == null || Regex("""^agents$""", RegexOption.IGNORE_CASE).containsMatchIn(server))) {
        return WorkingStep(WorkingStepKey.TEAMMATE)
    }
    if (Regex("""^memory_|(^|_)memory$|recall_topic|remember""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.MEMORY)
    }

    if (Regex("""calendar|meeting|availab|(^|[\s_])events?($|_)|freebusy""").containsMatchIn(scope)) {
        val write = WRITE_VERB.containsMatchIn(bare) || Regex("""respond_to_event""").containsMatchIn(bare)
        return WorkingStep(if (write) WorkingStepKey.WRITE_CALENDAR else WorkingStepKey.CALENDAR)
    }
    if (Regex("""teams|slack|chat_message|channel_message|(^|[\s_])chats?($|_)|discord|imessage|whatsapp""").containsMatchIn(scope)) {
        val app = when {
            Regex("""teams""").containsMatchIn(scope) -> "Teams"
            Regex("""slack""").containsMatchIn(scope) -> "Slack"
            Regex("""discord""").containsMatchIn(scope) -> "Discord"
            Regex("""whatsapp""").containsMatchIn(scope) -> "WhatsApp"
            else -> null
        }
        val write = Regex("""(send|reply|post|create|write)""").containsMatchIn(bare)
        return WorkingStep(if (write) WorkingStepKey.WRITE_CHAT else WorkingStepKey.READ_CHAT, withDetail(app).detail)
    }
    if (Regex("""e?mail|outlook|gmail|inbox|(^|[\s_])messages?($|_)|thread_label|vacation""").containsMatchIn(scope) &&
        !Regex("""sms|voice""").containsMatchIn(scope)
    ) {
        val write = Regex("""(send|reply|forward|draft|compose)""").containsMatchIn(bare)
        return WorkingStep(if (write) WorkingStepKey.WRITE_MAIL else WorkingStepKey.READ_MAIL)
    }

    if (Regex("""^(open_application|open_app|launch_app|launch_application|activate_app|switch_app)$""").containsMatchIn(bare)) {
        return WorkingStep(
            WorkingStepKey.OPEN_APP,
            withDetail(field(input, APP_FIELDS)?.replace(Regex("""\.app$""", RegexOption.IGNORE_CASE), "")).detail,
        )
    }
    if (Regex("""^(screenshot|screen_capture|take_screenshot|zoom|cursor_position)$""").containsMatchIn(bare) ||
        Regex("""screenshot""").containsMatchIn(bare)
    ) {
        return WorkingStep(WorkingStepKey.SCREEN)
    }

    if (Regex("""^(web_?search|websearch|google_web_search|search_web|brave_search|tavily_search|search_query)$""").containsMatchIn(bare) ||
        Regex("""web_search""").containsMatchIn(bare)
    ) {
        return WorkingStep(WorkingStepKey.SEARCH_WEB)
    }
    if (Regex("""^(web_?fetch|fetch|fetch_url|read_page|get_page_text|read_url|scrape|browse_page)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.READ_PAGE, withDetail(hostOf(field(input, URL_FIELDS))).detail)
    }
    if (Regex("""^(open_url|navigate|browser_navigate|goto|go_to|open_page|tabs_create(_mcp)?|new_tab)$""").containsMatchIn(bare) ||
        bare.startsWith("browser_") ||
        Regex("""chrome|browser|playwright|puppeteer""").containsMatchIn(server?.lowercase().orEmpty())
    ) {
        return WorkingStep(WorkingStepKey.BROWSE, withDetail(hostOf(field(input, URL_FIELDS))).detail)
    }
    if (Regex("""^(computer|computer_batch|click|left_click|right_click|double_click|triple_click|type|type_text|key|press_key|hold_key|scroll|mouse_move|left_click_drag|wait_for|wait)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.COMPUTER, withDetail(field(input, listOf("app", "application"))).detail)
    }

    if (Regex("""^(read|read_file|view|open_file|cat|notebookread|read_many_files|view_file)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.READ_FILE, fileDetail(input))
    }
    if (Regex("""^(write|write_file|create_file|save_file)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.WRITE_FILE, fileDetail(input))
    }
    if (Regex("""^(edit|multiedit|multi_edit|apply_patch|str_replace|str_replace_editor|str_replace_based_edit_tool|replace|notebookedit|edit_file|patch|filechange|file_change)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.EDIT_FILE, fileDetail(input))
    }
    if (Regex("""^(grep|glob|find|search|ls|list_dir|list_directory|search_files|file_search|search_file_content|codebase_search|find_files)$""").containsMatchIn(bare)) {
        return WorkingStep(WorkingStepKey.SEARCH_FILES)
    }

    if (Regex("""\s""").containsMatchIn(raw)) {
        val parts = raw.split(Regex("""\s+"""))
        val first = parts.firstOrNull().orEmpty()
        val rest = parts.drop(1).joinToString(" ")
        val verb = first.lowercase()
        val detail = if (rest.isNotEmpty() && Regex("""[./\\]""").containsMatchIn(rest)) {
            withDetail(baseName(rest)).detail
        } else {
            null
        }
        when {
            Regex("""^(read|reading|view|viewing)$""").containsMatchIn(verb) ->
                return WorkingStep(WorkingStepKey.READ_FILE, detail)
            Regex("""^(write|writing|create|creating)$""").containsMatchIn(verb) ->
                return WorkingStep(WorkingStepKey.WRITE_FILE, detail)
            Regex("""^(edit|editing|update|updating|patch|patching)$""").containsMatchIn(verb) ->
                return WorkingStep(WorkingStepKey.EDIT_FILE, detail)
            Regex("""^(search|searching|grep|find|finding)$""").containsMatchIn(verb) ->
                return WorkingStep(WorkingStepKey.SEARCH_FILES)
            Regex("""^(fetch|fetching)$""").containsMatchIn(verb) ->
                return WorkingStep(WorkingStepKey.READ_PAGE, withDetail(hostOf(rest)).detail)
            else -> return commandStep(call.summary ?: raw)
        }
    }

    val product = cleanDetail(call.product) ?: if (
        server != null && !Regex("""^(agents|sagax|harness|perspicax|omb)""", RegexOption.IGNORE_CASE).containsMatchIn(server)
    ) {
        cleanDetail(
            server
                .replace(Regex("""^claude_ai_""", RegexOption.IGNORE_CASE), "")
                .replace(Regex("""[_-]+"""), " "),
        )
    } else {
        null
    }
    return WorkingStep(WorkingStepKey.TOOL, product)
}

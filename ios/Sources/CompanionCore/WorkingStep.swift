// The step a bot is on, as the server names it for the working line
// (shared/working-step.ts, 2026-10-29): a key and a short detail, the same
// whatever engine made the call. The app words the key in the reader's
// language (App/Features/Chat/WorkingStepText.swift).
import Foundation

public struct WorkingStep: Codable, Hashable, Sendable {
    public var key: String
    /// A file, an app, a host or a program name; never arguments.
    public var detail: String?

    public init(key: String, detail: String? = nil) {
        self.key = key
        self.detail = detail
    }
}

public enum WorkingStepLine {
    /// The keys this build knows (WORKING_STEP_KEYS). A newer server's key
    /// is ignored and the line stays as it was.
    public static let keys: Set<String> = [
        "readMail", "writeMail", "calendar", "writeCalendar", "readChat", "writeChat",
        "openApp", "browse", "readPage", "searchWeb", "run", "readFile", "writeFile",
        "editFile", "searchFiles", "screen", "computer", "teammate", "subagent", "memory", "tool",
    ]
    /// Keys that read with their detail (WORKING_STEP_DETAIL_KEYS).
    public static let detailKeys: Set<String> = [
        "readChat", "writeChat", "openApp", "browse", "readPage", "run", "readFile", "writeFile", "editFile", "computer", "tool",
    ]
    /// From this age on the line says how long the step has been quiet
    /// (WORKING_STEP_QUIET_MS).
    public static let quietAfterMs: Double = 60_000

    public struct Current: Hashable, Sendable {
        public var step: WorkingStep
        /// When the call started (epoch ms): nothing has come out since.
        public var since: Double
    }

    /// The step the working line names now: the newest row's, while its
    /// call still runs (currentWorkingStep). Nil between calls and after.
    public static func current(_ messages: [Message]) -> Current? {
        guard let last = messages.last(where: { $0.kind != .digest }),
              last.kind == .activity, let tool = last.tool, tool.ok == nil,
              let step = tool.step, keys.contains(step.key) else { return nil }
        return Current(step: step, since: last.at)
    }

    /// Whole minutes the step has been quiet, or nil while it is young.
    public static func quietMinutes(since: Double, now: Double) -> Int? {
        let elapsed = now - since
        guard elapsed >= quietAfterMs else { return nil }
        return Int(elapsed / 60_000)
    }

    /// Whether the step reads with its detail ("Opening Chrome").
    public static func readsDetail(_ step: WorkingStep) -> Bool {
        guard let detail = step.detail, !detail.isEmpty else { return false }
        return detailKeys.contains(step.key)
    }
}

/// What a tool call carries when it starts, whatever the engine.
public struct WorkingStepCall: Hashable, Sendable {
    public var name: String
    public var summary: String?
    public var input: String?
    public var product: String?

    public init(name: String, summary: String? = nil, input: String? = nil, product: String? = nil) {
        self.name = name
        self.summary = summary
        self.input = input
        self.product = product
    }
}

private let workingStepDetailMax = 40

private let workingStepInterpreters: Set<String> = [
    "python", "python3", "python2", "py", "node", "bun", "deno", "ruby", "perl", "php", "bash", "sh", "zsh",
    "fish", "pwsh", "powershell", "tsx", "ts-node", "rscript", "lua", "osascript", "swift", "java",
]

private let workingStepPrefixes: Set<String> = [
    "sudo", "env", "time", "nohup", "exec", "command", "caffeinate",
]

private let workingStepFileFields = [
    "file_path", "path", "notebook_path", "filename", "file", "target_file", "absolute_path",
]
private let workingStepURLFields = ["url", "uri", "href", "link"]
private let workingStepAppFields = ["app", "application", "app_name", "appName", "name", "bundle_id", "bundleId"]

private func workingStepCleanDetail(_ value: String?) -> String? {
    guard var text = value else { return nil }
    text = text
        .replacingOccurrences(of: #"[\r\n\t]+"#, with: " ", options: .regularExpression)
        .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        .trimmingCharacters(in: .whitespacesAndNewlines)
    while text.hasPrefix("\"") || text.hasPrefix("'") || text.hasPrefix("`") {
        text.removeFirst()
    }
    while text.hasSuffix("\"") || text.hasSuffix("'") || text.hasSuffix("`") {
        text.removeLast()
    }
    text = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { return nil }
    if text.range(of: #"\[redacted\]|\*{3,}"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return nil
    }
    if text.count > workingStepDetailMax {
        return String(text.prefix(workingStepDetailMax - 1)) + "…"
    }
    return text
}

private func workingStepBaseName(_ path: String) -> String {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        .trimmingCharacters(in: CharacterSet(charactersIn: "/\\"))
    let parts = trimmed.split { $0 == "/" || $0 == "\\" }.map(String.init)
    return parts.last ?? trimmed
}

private func workingStepHostOf(_ url: String?) -> String? {
    guard let url, !url.isEmpty else { return nil }
    let withScheme: String
    if url.range(of: #"^[a-z][\w+.-]*://"#, options: [.regularExpression, .caseInsensitive]) != nil {
        withScheme = url
    } else {
        withScheme = "https://\(url)"
    }
    guard let parsed = URL(string: withScheme), var host = parsed.host, !host.isEmpty else { return nil }
    if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
    return host.isEmpty ? nil : host
}

private func workingStepParseInput(_ input: String?) -> Any? {
    guard let input, !input.isEmpty, let data = input.data(using: .utf8) else { return nil }
    guard let value = try? JSONSerialization.jsonObject(with: data) else { return nil }
    if value is [String: Any] || value is [Any] { return value }
    return nil
}

private func workingStepField(_ input: Any?, _ names: [String]) -> String? {
    guard let input else { return nil }
    let record: [String: Any]?
    if let dict = input as? [String: Any] {
        record = dict
    } else if let list = input as? [Any] {
        record = list.first { $0 is [String: Any] } as? [String: Any]
    } else {
        record = nil
    }
    guard let record else { return nil }
    for name in names {
        if let value = record[name] as? String, !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return value
        }
    }
    return nil
}

private func workingStepFileDetail(_ input: Any?) -> String? {
    guard let path = workingStepField(input, workingStepFileFields) else { return nil }
    return workingStepCleanDetail(workingStepBaseName(path))
}

private func workingStepWithDetail(_ value: String?) -> String? {
    workingStepCleanDetail(value)
}

private func workingStepSplitName(_ name: String) -> (server: String?, tool: String) {
    if let re = try? NSRegularExpression(pattern: #"^mcp__(.+?)__(.+)$"#),
       let m = re.firstMatch(in: name, range: NSRange(name.startIndex..<name.endIndex, in: name)),
       m.numberOfRanges >= 3 {
        let ns = name as NSString
        return (ns.substring(with: m.range(at: 1)), ns.substring(with: m.range(at: 2)))
    }
    if name.range(of: #"\.(py|js|ts|sh|rb|md|json|txt)$"#, options: [.regularExpression, .caseInsensitive]) == nil,
       let re = try? NSRegularExpression(pattern: #"^([\w-]+)[./]([\w-]+)$"#),
       let m = re.firstMatch(in: name, range: NSRange(name.startIndex..<name.endIndex, in: name)),
       m.numberOfRanges >= 3 {
        let ns = name as NSString
        return (ns.substring(with: m.range(at: 1)), ns.substring(with: m.range(at: 2)))
    }
    return (nil, name)
}

private func workingStepCommandParts(_ command: String) -> [String] {
    guard let re = try? NSRegularExpression(pattern: #"&&|\|\||;|\|"#) else { return [command] }
    var last = command.startIndex
    var out: [String] = []
    let nsRange = NSRange(command.startIndex..<command.endIndex, in: command)
    re.enumerateMatches(in: command, range: nsRange) { match, _, _ in
        guard let match, let range = Range(match.range, in: command) else { return }
        out.append(String(command[last..<range.lowerBound]))
        last = range.upperBound
    }
    out.append(String(command[last...]))
    return out.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
}

private func workingStepWords(_ segment: String) -> [String] {
    guard let re = try? NSRegularExpression(pattern: #""[^"]*"|'[^']*'|\S+"#) else { return [] }
    let ns = segment as NSString
    return re.matches(in: segment, range: NSRange(location: 0, length: ns.length)).map { match in
        var word = ns.substring(with: match.range)
        if (word.hasPrefix("\"") && word.hasSuffix("\"")) || (word.hasPrefix("'") && word.hasSuffix("'")) {
            word = String(word.dropFirst().dropLast())
        }
        return word
    }
}

/// The program or the script a shell command runs, never its arguments.
public func commandStep(_ command: String) -> WorkingStep {
    let parts = workingStepCommandParts(command)
    let segment = parts.first(where: { part in
        part.range(of: #"^(cd|pushd|export|set|source|\.)\s"#, options: .regularExpression) == nil && part != "cd"
    }) ?? parts.first ?? ""
    let words = workingStepWords(segment)
    var index = 0
    while index < words.count && (workingStepPrefixes.contains(words[index]) || words[index].range(of: #"^\w+="#, options: .regularExpression) != nil) {
        index += 1
    }
    guard index < words.count else { return WorkingStep(key: "run") }
    let program = words[index]
    let name = workingStepBaseName(program)
    let lower = name.lowercased()
    if lower == "open" {
        let flag = words.enumerated().first(where: { $0.offset >= index && $0.element == "-a" })?.offset
        if let flag, words.indices.contains(flag + 1) {
            let cleaned = workingStepBaseName(words[flag + 1])
                .replacingOccurrences(of: #"\.app$"#, with: "", options: [.regularExpression, .caseInsensitive])
            return WorkingStep(key: "openApp", detail: workingStepWithDetail(cleaned))
        }
        let target = words.dropFirst(index + 1).first { !$0.hasPrefix("-") }
        if let target, target.range(of: #"^https?://"#, options: [.regularExpression, .caseInsensitive]) != nil,
           let host = workingStepHostOf(target) {
            return WorkingStep(key: "browse", detail: workingStepWithDetail(host))
        }
    }
    if lower == "start", words.indices.contains(index + 1) {
        return WorkingStep(key: "openApp", detail: workingStepWithDetail(words[index + 1]))
    }
    var rest = Array(words.dropFirst(index + 1))
    if (lower == "uv" || lower == "poetry" || lower == "pipenv"), rest.first == "run" {
        rest = Array(rest.dropFirst())
    }
    let interpreter = workingStepInterpreters.contains(lower.replacingOccurrences(of: ".exe", with: ""))
        || ((lower == "uv" || lower == "poetry" || lower == "pipenv") && words.indices.contains(index + 1) && words[index + 1] == "run")
    if interpreter {
        if rest.first == "-m", rest.count > 1 {
            return WorkingStep(key: "run", detail: workingStepWithDetail(rest[1]))
        }
        if let script = rest.first(where: { !$0.hasPrefix("-") }), script.range(of: #"[./\\]"#, options: .regularExpression) != nil {
            return WorkingStep(key: "run", detail: workingStepWithDetail(workingStepBaseName(script)))
        }
        return WorkingStep(key: "run", detail: workingStepWithDetail(name))
    }
    return WorkingStep(key: "run", detail: workingStepWithDetail(name))
}

/// The step for a tool call, or nil when there is nothing better to say
/// than the line already shows (a to-do list update, a tool search).
public func workingStepFor(_ call: WorkingStepCall) -> WorkingStep? {
    let raw = call.name.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return nil }
    if raw.range(of: #"^(auto-approved|error):"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return nil
    }
    let input = workingStepParseInput(call.input)
    let split = workingStepSplitName(raw)
    let bare = split.tool.lowercased()
    let scope = "\((split.server ?? "").lowercased()) \(bare)"

    if bare.range(of: #"^(todowrite|todo_write|update_plan|toolsearch|tool_search|exitplanmode|think|sleep)$"#, options: .regularExpression) != nil {
        return nil
    }

    let shellName = bare.range(
        of: #"^(bash|shell|sh|zsh|terminal|exec|execute|run_command|run_shell_command|run_terminal_cmd|command|commandexecution|command_execution|computer_exec|powershell|local_shell|bashoutput)$"#,
        options: .regularExpression
    ) != nil
    if shellName {
        let command = call.summary ?? workingStepField(input, ["command", "cmd"])
        return command.map(commandStep) ?? WorkingStep(key: "run")
    }

    if bare.range(of: #"^(task|agent|spawn_agent|subagent|run_subagent|run_with_engine)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "subagent")
    }
    if bare.range(of: #"(ask_bot|delegate_bot|coordinate_bots|list_bots|post_to_room|send_prompt|await_turn|list_agents|find_agents)"#, options: .regularExpression) != nil {
        return WorkingStep(key: "teammate")
    }
    if bare == "send_message", split.server == nil || (split.server?.range(of: #"^agents$"#, options: [.regularExpression, .caseInsensitive]) != nil) {
        return WorkingStep(key: "teammate")
    }
    if bare.range(of: #"^memory_|(^|_)memory$|recall_topic|remember"#, options: .regularExpression) != nil {
        return WorkingStep(key: "memory")
    }

    if scope.range(of: #"calendar|meeting|availab|(^|[\s_])events?($|_)|freebusy"#, options: .regularExpression) != nil {
        let write = bare.range(of: #"(send|reply|forward|draft|compose|create|update|delete|move|post|write|respond|cancel|schedule|book|set_)"#, options: .regularExpression) != nil
            || bare.range(of: #"respond_to_event"#, options: .regularExpression) != nil
        return WorkingStep(key: write ? "writeCalendar" : "calendar")
    }
    if scope.range(of: #"teams|slack|chat_message|channel_message|(^|[\s_])chats?($|_)|discord|imessage|whatsapp"#, options: .regularExpression) != nil {
        let app: String?
        if scope.range(of: "teams", options: .regularExpression) != nil { app = "Teams" }
        else if scope.range(of: "slack", options: .regularExpression) != nil { app = "Slack" }
        else if scope.range(of: "discord", options: .regularExpression) != nil { app = "Discord" }
        else if scope.range(of: "whatsapp", options: .regularExpression) != nil { app = "WhatsApp" }
        else { app = nil }
        let write = bare.range(of: #"(send|reply|post|create|write)"#, options: .regularExpression) != nil
        return WorkingStep(key: write ? "writeChat" : "readChat", detail: workingStepWithDetail(app))
    }
    if scope.range(of: #"e?mail|outlook|gmail|inbox|(^|[\s_])messages?($|_)|thread_label|vacation"#, options: .regularExpression) != nil,
       scope.range(of: #"sms|voice"#, options: .regularExpression) == nil {
        let write = bare.range(of: #"(send|reply|forward|draft|compose)"#, options: .regularExpression) != nil
        return WorkingStep(key: write ? "writeMail" : "readMail")
    }

    if bare.range(of: #"^(open_application|open_app|launch_app|launch_application|activate_app|switch_app)$"#, options: .regularExpression) != nil {
        let app = workingStepField(input, workingStepAppFields)?
            .replacingOccurrences(of: #"\.app$"#, with: "", options: [.regularExpression, .caseInsensitive])
        return WorkingStep(key: "openApp", detail: workingStepWithDetail(app))
    }
    if bare.range(of: #"^(screenshot|screen_capture|take_screenshot|zoom|cursor_position)$"#, options: .regularExpression) != nil
        || bare.range(of: "screenshot", options: .regularExpression) != nil {
        return WorkingStep(key: "screen")
    }

    if bare.range(of: #"^(web_?search|websearch|google_web_search|search_web|brave_search|tavily_search|search_query)$"#, options: .regularExpression) != nil
        || bare.range(of: "web_search", options: .regularExpression) != nil {
        return WorkingStep(key: "searchWeb")
    }
    if bare.range(of: #"^(web_?fetch|fetch|fetch_url|read_page|get_page_text|read_url|scrape|browse_page)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "readPage", detail: workingStepWithDetail(workingStepHostOf(workingStepField(input, workingStepURLFields))))
    }
    if bare.range(of: #"^(open_url|navigate|browser_navigate|goto|go_to|open_page|tabs_create(_mcp)?|new_tab)$"#, options: .regularExpression) != nil
        || bare.hasPrefix("browser_")
        || (split.server?.lowercased().range(of: #"chrome|browser|playwright|puppeteer"#, options: .regularExpression) != nil) {
        return WorkingStep(key: "browse", detail: workingStepWithDetail(workingStepHostOf(workingStepField(input, workingStepURLFields))))
    }
    if bare.range(of: #"^(computer|computer_batch|click|left_click|right_click|double_click|triple_click|type|type_text|key|press_key|hold_key|scroll|mouse_move|left_click_drag|wait_for|wait)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "computer", detail: workingStepWithDetail(workingStepField(input, ["app", "application"])))
    }

    if bare.range(of: #"^(read|read_file|view|open_file|cat|notebookread|read_many_files|view_file)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "readFile", detail: workingStepFileDetail(input))
    }
    if bare.range(of: #"^(write|write_file|create_file|save_file)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "writeFile", detail: workingStepFileDetail(input))
    }
    if bare.range(of: #"^(edit|multiedit|multi_edit|apply_patch|str_replace|str_replace_editor|str_replace_based_edit_tool|replace|notebookedit|edit_file|patch|filechange|file_change)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "editFile", detail: workingStepFileDetail(input))
    }
    if bare.range(of: #"^(grep|glob|find|search|ls|list_dir|list_directory|search_files|file_search|search_file_content|codebase_search|find_files)$"#, options: .regularExpression) != nil {
        return WorkingStep(key: "searchFiles")
    }

    if raw.range(of: #"\s"#, options: .regularExpression) != nil {
        let pieces = raw.split(whereSeparator: \.isWhitespace).map(String.init)
        let first = pieces.first ?? ""
        let rest = pieces.dropFirst().joined(separator: " ")
        let verb = first.lowercased()
        let detail: String? = {
            guard !rest.isEmpty, rest.range(of: #"[./\\]"#, options: .regularExpression) != nil else { return nil }
            return workingStepWithDetail(workingStepBaseName(rest))
        }()
        if verb.range(of: #"^(read|reading|view|viewing)$"#, options: .regularExpression) != nil {
            return WorkingStep(key: "readFile", detail: detail)
        }
        if verb.range(of: #"^(write|writing|create|creating)$"#, options: .regularExpression) != nil {
            return WorkingStep(key: "writeFile", detail: detail)
        }
        if verb.range(of: #"^(edit|editing|update|updating|patch|patching)$"#, options: .regularExpression) != nil {
            return WorkingStep(key: "editFile", detail: detail)
        }
        if verb.range(of: #"^(search|searching|grep|find|finding)$"#, options: .regularExpression) != nil {
            return WorkingStep(key: "searchFiles")
        }
        if verb.range(of: #"^(fetch|fetching)$"#, options: .regularExpression) != nil {
            return WorkingStep(key: "readPage", detail: workingStepWithDetail(workingStepHostOf(rest)))
        }
        return commandStep(call.summary ?? raw)
    }

    let product: String? = {
        if let cleaned = workingStepCleanDetail(call.product) { return cleaned }
        guard let server = split.server,
              server.range(of: #"^(agents|sagax|harness|perspicax|omb)"#, options: [.regularExpression, .caseInsensitive]) == nil else {
            return nil
        }
        let named = server
            .replacingOccurrences(of: #"^claude_ai_"#, with: "", options: [.regularExpression, .caseInsensitive])
            .replacingOccurrences(of: #"[_-]+"#, with: " ", options: .regularExpression)
        return workingStepCleanDetail(named)
    }()
    return WorkingStep(key: "tool", detail: product)
}

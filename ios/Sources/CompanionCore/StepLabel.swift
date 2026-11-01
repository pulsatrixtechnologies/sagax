// What a step row in the chat says: a plain sentence for each tool call
// ("Read a file", "Coordinated Wren and Olive", "Viewed tickets in
// <product>") in the tense of its state, never the raw tool id. The
// product's name is the one the server declared for the tool at run time
// (ToolActivity.product); no product name is written here.
//
// Ported rule for rule from the desktop: src/lib/step-label.ts (the
// sentence), shared/mcp-gateway-call.ts (a call through pi's `mcp` gateway
// reads as the tool it ran, server named) and the parts of
// shared/approval-describe.ts a step reuses (product, verb, resource, the
// short reading of the arguments). The words are the desktop's locale keys
// (`step.*`, `approval.*`), resolved by the caller's catalog: the app's
// Localizable.xcstrings, the tests' src/locales/*.json. One rule the phone
// leaves out: the date range a desktop step can add to its target.
import Foundation

public enum StepPhase: String, Hashable, Sendable {
    case running, done, failed

    public static func of(_ tool: ToolActivity) -> StepPhase {
        guard let ok = tool.ok else { return .running }
        return ok ? .done : .failed
    }
}

/// The catalog a step is worded from: a desktop locale key and its
/// `{name}` variables in, the sentence out.
public struct StepWords: Sendable {
    public let locale: Locale
    private let lookup: @Sendable (String) -> String?

    /// `lookup` answers a key's template, nil when the catalog lacks it
    /// (the key then reads as itself, as on the desktop).
    public init(locale: Locale, lookup: @escaping @Sendable (String) -> String?) {
        self.locale = locale
        self.lookup = lookup
    }

    public func t(_ key: String, _ vars: [String: String] = [:]) -> String {
        Self.fill(lookup(key) ?? key, vars)
    }

    /// `{name}` replaced by its value, once, left to right; an unknown
    /// placeholder stays as written.
    public static func fill(_ template: String, _ vars: [String: String]) -> String {
        guard !vars.isEmpty, template.contains("{") else { return template }
        var out = ""
        var rest = Substring(template)
        while let open = rest.firstIndex(of: "{") {
            out += rest[..<open]
            guard let close = rest[open...].firstIndex(of: "}") else { break }
            let name = String(rest[rest.index(after: open)..<close])
            if let value = vars[name] {
                out += value
            } else {
                out += rest[open...close]
            }
            rest = rest[rest.index(after: close)...]
        }
        return out + rest
    }

    var isFrench: Bool { locale.identifier.hasPrefix("fr") }
}

/// The words for one step: the sentence, and what it acted on.
public struct StepReading: Hashable, Sendable {
    public var label: String
    public var target: String?

    public init(label: String, target: String? = nil) {
        self.label = label
        self.target = target
    }
}

/// A teammate's display name from the id a coordination tool was given.
public typealias StepNameOf = @Sendable (String) -> String?

// MARK: - The MCP gateway (shared/mcp-gateway-call.ts)

/// What a call through the gateway tool did.
public enum McpGatewayCall: Hashable, Sendable {
    /// A call to one tool: the id reads `mcp__<server>__<tool>`; `args`
    /// is the JSON text of the arguments the gateway passed on.
    case tool(server: String, tool: String, id: String, args: String)
    /// The gateway's own housekeeping: what it did and on which server.
    case admin(action: Action, server: String?, query: String?)

    public enum Action: String, Hashable, Sendable { case search, connect, describe, status }
}

public enum McpGateway {
    /// The gateway's own name for its single tool.
    public static let tool = "mcp"

    private static let name = StepRegex.make(#"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$"#)

    static func text(_ value: Any?) -> String? {
        guard let string = value as? String else { return nil }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    static func record(_ value: Any?) -> [String: Any]? {
        if let string = value as? String {
            let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard trimmed.hasPrefix("{"), let data = trimmed.data(using: .utf8),
                  let parsed = try? JSONSerialization.jsonObject(with: data) else { return nil }
            return record(parsed)
        }
        return value as? [String: Any]
    }

    /// The arguments a gateway passes on, as JSON text: an object, or the
    /// JSON text of one; nothing reads `{}`.
    static func innerArgs(_ value: Any?) -> String {
        if value == nil || value is NSNull || (value as? String) == "" { return "{}" }
        let object: Any = record(value) ?? value!
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed, .sortedKeys]) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    /// `<server>_<tool>` split on a known server first, else on the first `_`.
    static func splitPrefixed(_ tool: String, servers: [String]) -> (server: String, tool: String)? {
        if let known = servers.sorted(by: { $0.count > $1.count }).first(where: { tool.hasPrefix("\($0)_") && tool.count > $0.count + 1 }) {
            return (known, String(tool.dropFirst(known.count + 1)))
        }
        guard let cut = tool.firstIndex(of: "_"), cut > tool.startIndex, tool.index(after: cut) < tool.endIndex else { return nil }
        return (String(tool[..<cut]), String(tool[tool.index(after: cut)...]))
    }

    /// What a gateway call did, from its tool name and arguments; nil for
    /// any tool that is not the gateway.
    public static func read(_ toolName: String?, input: String?, servers: [String] = []) -> McpGatewayCall? {
        guard toolName?.trimmingCharacters(in: .whitespacesAndNewlines) == tool else { return nil }
        let args = record(input) ?? [:]
        let server = text(args["server"]) ?? text(args["connect"])
        if let called = text(args["tool"]), StepRegex.test(name, called) {
            let split: (server: String, tool: String)? = server.map { ($0, called) } ?? splitPrefixed(called, servers: servers)
            if let split, StepRegex.test(name, split.server) {
                return .tool(
                    server: split.server, tool: split.tool, id: "mcp__\(split.server)__\(split.tool)",
                    args: innerArgs(args["args"] ?? args["arguments"])
                )
            }
        }
        let query = text(args["search"]) ?? text(args["query"])
        let action = text(args["action"])?.lowercased() ?? ""
        if query != nil || action == "search" { return .admin(action: .search, server: server, query: query) }
        if text(args["connect"]) != nil || action.range(of: "auth|connect|login", options: .regularExpression) != nil {
            return .admin(action: .connect, server: server, query: nil)
        }
        if text(args["describe"]) != nil || action == "describe" { return .admin(action: .describe, server: server, query: nil) }
        return .admin(action: .status, server: server, query: nil)
    }
}

// MARK: - The sentence (src/lib/step-label.ts)

public enum StepLabel {
    enum Kind: String {
        case think, readFile, writeFile, editFile, deleteFile, runCommand
        case searchFiles, listFiles, searchWeb, fetchPage, openPage
        case screen, computer, todo, toolSearch, subagent
        case coordinate, ask, delegate, sendTo, checkDelegation
        case whosAround, rooms, postRoom, startThread, closeThread, listThreads
        case memory, memorySearch, readConversations, routine, skill
        case attachFile, react, card, voiceNote, readResult
    }

    /// Claude and ACP built-ins, by their exact name.
    static let builtin: [String: Kind] = [
        "Bash": .runCommand, "shell": .runCommand, "execute": .runCommand, "BashOutput": .runCommand,
        "Read": .readFile, "read": .readFile, "NotebookRead": .readFile,
        "Write": .writeFile,
        "Edit": .editFile, "MultiEdit": .editFile, "NotebookEdit": .editFile, "edit": .editFile,
        "delete": .deleteFile,
        "Glob": .searchFiles, "Grep": .searchFiles, "search": .searchFiles,
        "LS": .listFiles,
        "WebSearch": .searchWeb,
        "WebFetch": .fetchPage, "fetch": .fetchPage,
        "TodoWrite": .todo,
        "ToolSearch": .toolSearch,
        "Agent": .subagent, "Task": .subagent,
        "think": .think,
    ]

    /// Sagax's own tools and the common bare names, lower case.
    static let bare: [String: Kind] = [
        "read_file": .readFile, "view": .readFile, "open_file": .readFile, "workspace_read": .readFile,
        "write_file": .writeFile, "create_file": .writeFile,
        "edit_file": .editFile, "str_replace": .editFile, "apply_patch": .editFile,
        "delete_file": .deleteFile,
        "run_command": .runCommand, "exec": .runCommand, "vm_exec": .runCommand, "bash": .runCommand, "terminal": .runCommand,
        "search_files": .searchFiles, "grep": .searchFiles, "glob": .searchFiles, "find_files": .searchFiles, "workspace_search": .searchFiles,
        "list_files": .listFiles, "list_dir": .listFiles, "list_directory": .listFiles,
        "web_search": .searchWeb, "search_web": .searchWeb,
        "web_fetch": .fetchPage, "fetch_url": .fetchPage, "read_page": .fetchPage, "browse": .fetchPage,
        "open_url": .openPage, "navigate": .openPage,
        "screenshot": .screen, "screen_capture": .screen, "get_screen_size": .screen,
        "computer_use": .computer, "computer": .computer, "click": .computer, "type": .computer, "keypress": .computer, "scroll": .computer,
        "coordinate_bots": .coordinate,
        "ask_bot": .ask, "send_bot_message": .ask,
        "delegate_bot": .delegate,
        "send_to_bot": .sendTo, "send_prompt": .sendTo,
        "check_delegation": .checkDelegation, "wait_delegation": .checkDelegation, "await_turn": .checkDelegation,
        "list_bots": .whosAround, "list_room_targets": .whosAround, "list_agents": .whosAround, "find_agents": .whosAround, "list_team_setup": .whosAround,
        "list_rooms": .rooms,
        "post_to_room": .postRoom,
        "start_thread": .startThread,
        "close_thread": .closeThread,
        "list_threads": .listThreads,
        "memory_update": .memory, "memory_log": .memory, "group_memory_update": .memory, "rules_update": .memory, "docs_update": .memory, "memory_write": .memory,
        "memory_save": .memory, "memory_remove": .memory, "memory_forget": .memory, "memory_suggestions": .memory,
        "memory_search": .memorySearch, "memory_recall": .memorySearch, "memory_find": .memorySearch,
        "session_search": .readConversations, "session_read": .readConversations, "read_transcript": .readConversations,
        "read_transcript_page": .readConversations, "read_latest_page": .readConversations,
        "read_latest_page_with_threads": .readConversations, "read_transcript_cold": .readConversations,
        "list_routines": .routine, "propose_routine": .routine, "propose_routine_action": .routine, "schedule_routine": .routine, "manage_routine": .routine,
        "skills_list": .skill, "skill_manage": .skill, "stage_skill": .skill, "update_skill": .skill,
        "attach_file": .attachFile,
        "react_to_message": .react, "remove_reaction": .react,
        "create_options_card": .card,
        "ask_choice": .card,
        "send_voice_note": .voiceNote,
        "tool_result_read": .readResult,
        "todo_write": .todo,
    ]

    /// Servers that are Sagax itself: their tools name no product.
    private static let internalPrefix = StepRegex.make(#"^(?:mcp__)?(?:agents|sagax|sagax-[a-z-]+|maus|ogb|harness)(?:__|_|\.)"#, [.caseInsensitive])


    static let targetMax = 80

    static func oneLine(_ text: String, max: Int = targetMax) -> String {
        let flat = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        guard flat.count > max else { return flat }
        let cut = String(flat.prefix(max - 1))
        return cut.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + "…"
    }

    static func str(_ args: [String: Any]?, _ keys: String...) -> String? {
        guard let args else { return nil }
        for key in keys {
            if let value = args[key] as? String {
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { return trimmed }
            }
        }
        return nil
    }

    static func basename(_ path: String) -> String {
        let clean = path.replacingOccurrences(of: #"[/\\]+$"#, with: "", options: .regularExpression)
        let last = clean.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? ""
        return last.isEmpty ? clean : last
    }

    static func host(_ url: String) -> String {
        guard let parts = URLComponents(string: url), let host = parts.host, !host.isEmpty else { return url }
        return parts.port.map { "\(host):\($0)" } ?? host
    }

    /// `mcp__<server>__<tool>` (the prefix optional), the server lazy.
    public static func parseToolId(_ tool: String) -> (server: String?, name: String) {
        guard let match = StepRegex.match(toolId, tool) else { return (nil, tool) }
        return (match[1], match[2] ?? tool)
    }
    private static let toolId = StepRegex.make(#"^(?:mcp__)?([A-Za-z0-9][A-Za-z0-9_.-]*?)__([A-Za-z0-9][A-Za-z0-9_.-]*)$"#)

    static func internalName(_ name: String) -> String? {
        guard StepRegex.test(internalPrefix, name) else { return nil }
        return StepRegex.strip(internalPrefix, name)
    }

    static func kindOf(_ name: String) -> Kind? {
        if let kind = builtin[name] { return kind }
        if let internalName = internalName(name) { return bare[internalName.lowercased()] }
        let parsed = parseToolId(name)
        if parsed.server != nil { return bare[parsed.name.lowercased()] }
        return bare[name.lowercased()]
    }

    static func names(_ ids: [String], nameOf: StepNameOf?, words: StepWords) -> String {
        let shown = ids.map { nameOf?($0) ?? $0 }.map { $0.hasPrefix("@") ? String($0.dropFirst()) : $0 }
        let formatter = ListFormatter()
        formatter.locale = words.locale
        return formatter.string(from: shown) ?? shown.joined(separator: ", ")
    }

    /// The teammates a coordination call names, as a readable list. Ids
    /// the person would not recognise (no known name, opaque) read nil.
    static func teammates(_ args: [String: Any]?, nameOf: StepNameOf?, words: StepWords) -> String? {
        let raw = ["bot_ids", "botIds", "bot_id", "botId", "agent_id", "agent"]
            .lazy.compactMap { key -> Any? in
                guard let value = args?[key], !(value is NSNull) else { return nil }
                return value
            }.first
        let values = (raw as? [Any]) ?? (raw.map { [$0] } ?? [])
        let ids = values.compactMap { $0 as? String }.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !ids.isEmpty else { return nil }
        let opaque = StepRegex.make(#"^[0-9a-f-]{12,}$"#, [.caseInsensitive])
        let readable = ids.filter { nameOf?($0) != nil || !StepRegex.test(opaque, $0) }
        guard readable.count == ids.count else { return nil }
        return names(ids, nameOf: nameOf, words: words)
    }

    static func kindLabel(_ kind: Kind, _ phase: StepPhase, _ args: [String: Any]?, nameOf: StepNameOf?, words: StepWords) -> String {
        switch kind {
        case .coordinate, .ask, .delegate, .sendTo:
            if let who = teammates(args, nameOf: nameOf, words: words) {
                return words.t("step.\(kind.rawValue).\(phase.rawValue)", ["names": who])
            }
            return words.t("step.\(kind.rawValue).bare.\(phase.rawValue)")
        case .subagent:
            if let about = str(args, "description", "subagent_type") {
                return words.t("step.subagent.\(phase.rawValue)", ["description": oneLine(about, max: 60)])
            }
            return words.t("step.subagent.bare.\(phase.rawValue)")
        default:
            return words.t("step.\(kind.rawValue).\(phase.rawValue)")
        }
    }

    /// The small grey words after the label: which file, which command,
    /// which query. Never JSON.
    static func kindTarget(_ kind: Kind, _ args: [String: Any]?, _ tool: ToolActivity) -> String? {
        func nonEmpty(_ text: String) -> String? { text.isEmpty ? nil : text }
        switch kind {
        case .readFile, .writeFile, .editFile, .deleteFile, .attachFile:
            return str(args, "file_path", "path", "filePath", "notebook_path", "file", "filename").map(basename)
        case .runCommand:
            let command = str(args, "command", "cmd", "script") ?? (tool.summary.flatMap { $0 != tool.name && !$0.isEmpty ? $0 : nil })
            return command.map { oneLine(String($0.split(separator: "\n", maxSplits: 1, omittingEmptySubsequences: false).first ?? "")) }
        case .searchFiles:
            return nonEmpty(oneLine(str(args, "pattern", "query", "glob", "regex") ?? ""))
        case .searchWeb:
            return nonEmpty(oneLine(str(args, "query", "q", "search") ?? ""))
        case .fetchPage, .openPage:
            return str(args, "url", "href", "uri").map(host)
        case .memorySearch, .readConversations:
            return nonEmpty(oneLine(str(args, "query", "q") ?? ""))
        case .postRoom, .startThread:
            return nonEmpty(oneLine(str(args, "title", "room", "room_name") ?? ""))
        default:
            return nil
        }
    }

    static func capitalize(_ text: String) -> String {
        guard let first = text.first else { return text }
        return String(first).uppercased(with: nil) + text.dropFirst()
    }

    static func mcpLabel(name: String, input: String?, phase: StepPhase, words: StepWords, product declared: String? = nil, productId: String? = nil) -> StepReading? {
        let parsed = parseToolId(name)
        guard let server = parsed.server else { return nil }
        // a gateway tool (`<gateway>__<product>__query`) reads as its
        // product's own, named as the server declared it
        let trimmed = declared?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let override: String? = trimmed.isEmpty ? nil : trimmed
        // the approval reads "view tickets"; a step reads "Viewed tickets"
        let reading = ApprovalReading.describe(name, input: input, words: words, product: override, productId: productId, verb: { key, vars in
            if key.hasPrefix("approval.verb.") {
                return words.t("step.verb.\(key.dropFirst("approval.verb.".count)).\(phase.rawValue)", vars)
            }
            if key == "approval.tool.runCommand" { return words.t("step.runCommand.\(phase.rawValue)", vars) }
            return words.t(key, vars)
        })
        let isInternal = server.hasPrefix("sagax-")
        let product = override ?? (isInternal ? nil : reading.product)
        // A failed call names where it went, never the raw tool id: the verb
        // the reading guessed from its arguments may be what failed, and the
        // id (acme_api__query) stays in the opened row's detail.
        if phase == .failed && !isInternal {
            return StepReading(label: words.t("step.use.failed", ["name": product ?? serverName(server)]), target: reading.summary)
        }
        // A tool named for itself (flow, query) reads as the product it
        // serves: "Used Acme", not "Used query in Acme".
        guard let readAction = reading.action, !reading.verbless else {
            let name = product ?? (reading.action ?? parsed.name)
                .replacingOccurrences(of: #"_+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            return StepReading(label: capitalize(words.t("step.use.\(phase.rawValue)", ["name": name])), target: reading.summary)
        }
        let action = readAction
        let label = product.map { words.t("approval.phrase.inProduct", ["action": action, "product": $0]) } ?? action
        return StepReading(label: capitalize(label), target: reading.summary)
    }

    /// A server id as a person reads it: its product when one is known,
    /// else its words titled (acme_api reads "Acme API"). Never the raw id.
    static func serverName(_ server: String) -> String {
        ApprovalReading.productFor(server: server, name: "").product ?? ApprovalReading.titleCase(server)
    }

    /// pi-mcp-adapter's `mcp` gateway housekeeping, read as what it did.
    static func gatewayLabel(_ action: McpGatewayCall.Action, server: String?, query: String?, phase: StepPhase, words: StepWords) -> StepReading {
        if action == .search {
            return StepReading(label: words.t("step.mcp.search.\(phase.rawValue)"), target: query.map { oneLine($0) })
        }
        if let server { return StepReading(label: words.t("step.mcp.\(action.rawValue).\(phase.rawValue)", ["server": serverName(server)])) }
        return StepReading(label: words.t("step.mcp.\(action.rawValue).bare.\(phase.rawValue)"))
    }

    /// Server rows written in English as a sentence, read again in the
    /// person's language. Unknown sentences stay as they are.
    static func serverSentence(_ name: String, words: StepWords) -> String? {
        if let match = StepRegex.match(resumed, name) {
            let who = match[1] == "delegated work"
                ? words.t("step.resumed.work")
                : names((match[1] ?? "").components(separatedBy: ",").map { $0.trimmingCharacters(in: .whitespaces) }, nameOf: nil, words: words)
            return words.t(match[2] != nil ? "step.resumed.afterRestart" : "step.resumed", ["names": who])
        }
        if name == "Resuming after a restart" { return words.t("step.resuming") }
        if let match = StepRegex.match(sentTo, name) {
            return match[2].map { words.t("step.sentToIn", ["names": match[1] ?? "", "room": $0]) } ?? words.t("step.sentTo", ["names": match[1] ?? ""])
        }
        if let match = StepRegex.match(postedIn, name) { return words.t("step.postedIn", ["room": match[1] ?? ""]) }
        if let match = StepRegex.match(replied, name) {
            return match[2].map { words.t("step.repliedIn", ["name": match[1] ?? "", "room": $0]) } ?? words.t("step.replied", ["name": match[1] ?? ""])
        }
        return nil
    }
    private static let resumed = StepRegex.make(#"^Resumed with (.+) results( after a restart)?, reviewing$"#)
    private static let sentTo = StepRegex.make(#"^Sent to (.+?)(?: · (.+))?$"#)
    private static let postedIn = StepRegex.make(#"^Posted in (.+)$"#)
    private static let replied = StepRegex.make(#"^(.+) replied(?: · (.+))?$"#)

    static func parseArgs(_ text: String?) -> [String: Any]? {
        guard let text, text.range(of: #"^\s*\{"#, options: .regularExpression) != nil,
              let data = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }

    /// The words for one step. `nameOf` turns a teammate id into its name.
    public static func read(_ tool: ToolActivity, words: StepWords, nameOf: StepNameOf? = nil) -> StepReading {
        let phase = StepPhase.of(tool)
        let name = tool.name.trimmingCharacters(in: .whitespacesAndNewlines)
        if let sentence = serverSentence(name, words: words) { return StepReading(label: sentence) }
        if name.contains(where: { $0.isWhitespace }) { return StepReading(label: name) }
        // rows stored before the driver named the tool a gateway call ran
        switch McpGateway.read(name, input: tool.input ?? tool.summary) {
        case let .admin(action, server, query)?:
            return gatewayLabel(action, server: server, query: query, phase: phase, words: words)
        case let .tool(_, _, id, args)?:
            if let named = mcpLabel(name: id, input: args, phase: phase, words: words, product: tool.product, productId: tool.productId) { return named }
        case nil:
            break
        }
        let args = parseArgs(tool.input) ?? parseArgs(tool.summary)
        if let kind = kindOf(name) {
            return StepReading(label: kindLabel(kind, phase, args, nameOf: nameOf, words: words), target: kindTarget(kind, args, tool))
        }
        if let mcp = mcpLabel(name: name, input: tool.input ?? tool.summary, phase: phase, words: words, product: tool.product, productId: tool.productId) { return mcp }
        let display = name.replacingOccurrences(of: #"_+"#, with: " ", options: .regularExpression)
        var summary: String?
        if let text = tool.summary, text != tool.name, text.trimmingCharacters(in: .whitespaces).range(of: #"^[\[{]"#, options: .regularExpression) == nil {
            summary = oneLine(text)
        }
        return StepReading(label: words.t("step.use.\(phase.rawValue)", ["name": display]), target: summary)
    }

    /// A quiet duration: "2s", "1m 05s"; under a second reads "<1s".
    public static func duration(_ ms: Double?, words: StepWords) -> String? {
        guard let ms, ms.isFinite, ms >= 0 else { return nil }
        if ms < 1_000 { return words.t("step.duration.underSecond") }
        let total = Int(min((ms / 1_000).rounded(), 1e9))
        if total < 60 { return words.t("step.duration.seconds", ["seconds": String(total)]) }
        return words.t("step.duration.minutes", ["minutes": String(total / 60), "seconds": String(format: "%02d", total % 60)])
    }

    /// The arguments a person can read: a few `key: value` pairs, long
    /// values cut, nested ones counted.
    public static func arguments(_ input: String?, words: StepWords) -> [(key: String, value: String)] {
        guard let input, let data = input.data(using: .utf8), input.range(of: #"^\s*\{"#, options: .regularExpression) != nil,
              let object = try? JSONSerialization.jsonObject(with: data, options: []) as? [String: Any] else { return [] }
        // JSON key order: JSONSerialization does not keep it, so read the
        // keys in the order the text writes them.
        var pairs: [(key: String, value: String)] = []
        for key in orderedKeys(input, of: object) {
            guard let value = object[key], !(value is NSNull) else { continue }
            let shown: String
            if let text = value as? String {
                guard !text.isEmpty else { continue }
                shown = oneLine(text, max: 120)
            } else if let number = value as? NSNumber {
                shown = CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? "true" : "false") : number.stringValue
            } else if let list = value as? [Any] {
                let scalars = list.compactMap { item -> String? in
                    if let text = item as? String { return text }
                    if let number = item as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { return number.stringValue }
                    return nil
                }
                shown = scalars.count == list.count ? oneLine(scalars.joined(separator: ", "), max: 120) : words.t("step.detail.items", ["count": String(list.count)])
            } else if let nested = value as? [String: Any] {
                shown = words.t("step.detail.fields", ["count": String(nested.count)])
            } else {
                continue
            }
            pairs.append((key, shown))
            if pairs.count >= 6 { break }
        }
        return pairs
    }

    static func orderedKeys(_ text: String, of object: [String: Any]) -> [String] {
        let keys = Set(object.keys)
        var seen: [String] = []
        let pattern = StepRegex.make(#""((?:[^"\\]|\\.)*)"\s*:"#)
        let ns = text as NSString
        for match in pattern.matches(in: text, range: NSRange(location: 0, length: ns.length)) {
            let key = ns.substring(with: match.range(at: 1))
            if keys.contains(key), !seen.contains(key) { seen.append(key) }
        }
        return seen + keys.subtracting(seen).sorted()
    }

    /// The first lines of a result, enough to see what came back.
    public static func result(_ output: String?, maxLines: Int = 4, maxChars: Int = 320) -> (text: String, cut: Bool)? {
        guard let trimmed = output?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else { return nil }
        var text = trimmed.split(separator: "\n", omittingEmptySubsequences: false).prefix(maxLines).joined(separator: "\n")
        if text.count > maxChars {
            text = String(text.prefix(maxChars - 1)).replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + "…"
        }
        return (text, text.count < trimmed.count)
    }
}

// MARK: - Regex helpers (JavaScript semantics on UTF-16)

enum StepRegex {
    static func make(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // SAFETY: every pattern is a literal in this file, covered by the tests.
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    static func test(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    /// The groups of the first match (0 is the whole match), nil when none.
    static func match(_ regex: NSRegularExpression, _ text: String) -> [String?]? {
        let ns = text as NSString
        guard let found = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        return (0..<found.numberOfRanges).map { index in
            let range = found.range(at: index)
            return range.location == NSNotFound ? nil : ns.substring(with: range)
        }
    }

    static func firstRange(_ regex: NSRegularExpression, _ text: String) -> Range<String.Index>? {
        guard let found = regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) else { return nil }
        return Range(found.range, in: text)
    }

    static func strip(_ regex: NSRegularExpression, _ text: String) -> String {
        regex.stringByReplacingMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length), withTemplate: "")
    }
}

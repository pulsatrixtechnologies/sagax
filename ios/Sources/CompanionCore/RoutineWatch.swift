// "Only when something changes" (#1202) in the phone's routine editor: the
// desktop's WatchFields (src/components/routines/WatchFields.tsx) over the
// same contract (shared/routine-watch.ts). A routine can watch a file or a
// folder of its bot's folder, the output of a command run where the bot
// works, or a read-only MCP tool with fixed arguments; Sagax checks it on
// each due time with no model turn and starts the run only on a change, or
// while a condition holds. The person sets it on their own bots, no admin.
// "Check now" reads it once where the routine would
// (POST /api/routines/watch-check), keeping nothing.
//
// An edit sends the watch only when the person changed it (RoutinePatch):
// a watch this editor did not touch, or a condition pre-check set elsewhere,
// stays exactly as it is.
import Foundation

public enum RoutineWatchSourceType: String, CaseIterable, Hashable, Sendable {
    case files, command, tool
}

public enum RoutineWatchOp: String, CaseIterable, Hashable, Sendable {
    case eq, ne, gt, gte, lt, lte, contains, exists

    /// The sign the desktop shows before the words.
    public var symbol: String {
        switch self {
        case .eq: "="
        case .ne: "≠"
        case .gt: ">"
        case .gte: "≥"
        case .lt: "<"
        case .lte: "≤"
        case .contains: "∋"
        case .exists: "∃"
        }
    }
}

public enum RoutineWatchConditionChoice: String, CaseIterable, Hashable, Sendable {
    case none
    case jsonPath = "json_path"
    case contains
    case exitCode = "exit_code"
}

/// The bounds the screen names (`ROUTINE_WATCH_LIMITS`); the server enforces them.
public enum RoutineWatchLimits {
    public static let minIntervalMinutes = 5
    public static let timeoutSeconds = 15
    public static let maxOutputKB = 256
    public static let maxFiles = 5_000
    public static let maxDepth = 8
}

/// Why the watch cannot be saved or checked yet.
public enum RoutineWatchProblem: Error, Equatable, Sendable {
    case path, command, tool, args, conditionPath, contains
}

/// What an edit does to the routine's pre-check.
public enum RoutineWatchEdit: Equatable, Sendable {
    /// Not touched: nothing is sent.
    case keep
    /// Set or changed: the whole watch.
    case set(WidgetJSON)
    /// Turned off: null, only when the routine had a watch.
    case remove
}

/// The section's fields, as the desktop's `WatchDraft`.
public struct RoutineWatchDraft: Equatable, Sendable {
    public var on = false
    public var type: RoutineWatchSourceType = .files
    public var path = ""
    public var recursive = false
    public var command = ""
    public var tool = ""
    public var args = ""
    public var condition: RoutineWatchConditionChoice = .none
    public var conditionPath = ""
    public var conditionOp: RoutineWatchOp = .eq
    public var conditionValue = ""
    public var containsText = ""
    public var containsNegate = false
    /// "eq" or "ne".
    public var exitOp = "ne"
    public var exitValue = "0"
    /// "change" or "match".
    public var wakeOn = "change"
    public var trackItems = ""
    public var trackKey = ""
    public var trackFields = ""
    /// "baseline" or "wake".
    public var firstRun = "baseline"
    /// "skip" or "wake".
    public var whenAsleep = "skip"

    public init() {}

    /// The draft of a routine's pre-check: its watch, else off (a condition
    /// pre-check set elsewhere is not a watch and is left alone).
    public init(precheck: WidgetJSON?) {
        guard let watch = RoutineWatchRules.watch(precheck) else { return }
        on = true
        let source = watch["source"]?.object ?? [:]
        type = source["type"]?.string.flatMap(RoutineWatchSourceType.init(rawValue:)) ?? .files
        switch type {
        case .files:
            path = source["path"]?.string ?? ""
            recursive = source["recursive"]?.bool == true
        case .command:
            command = source["command"]?.string ?? ""
        case .tool:
            tool = source["tool"]?.string ?? ""
            if let args = source["args"], let object = args.object, !object.isEmpty { self.args = RoutineWatchRules.pretty(args) }
        }
        if let condition = watch["condition"]?.object, let test = condition["test"]?.string.flatMap(RoutineWatchConditionChoice.init(rawValue:)) {
            self.condition = test
            switch test {
            case .jsonPath:
                conditionPath = condition["path"]?.string ?? ""
                conditionOp = condition["op"]?.string.flatMap(RoutineWatchOp.init(rawValue:)) ?? .eq
                if let value = condition["value"] { conditionValue = RoutineWatchRules.text(value) }
            case .contains:
                containsText = condition["text"]?.string ?? ""
                containsNegate = condition["negate"]?.bool == true
            case .exitCode:
                exitOp = condition["op"]?.string == "eq" ? "eq" : "ne"
                exitValue = condition["value"].map(RoutineWatchRules.text) ?? "0"
            case .none:
                break
            }
        }
        wakeOn = watch["wakeOn"]?.string == "match" ? "match" : "change"
        if let track = watch["track"]?.object {
            trackItems = track["items"]?.string ?? ""
            trackKey = track["key"]?.string ?? ""
            trackFields = (track["fields"]?.array ?? []).compactMap(\.string).joined(separator: ", ")
        }
        firstRun = watch["firstRun"]?.string == "wake" ? "wake" : "baseline"
        whenAsleep = watch["whenAsleep"]?.string == "wake" ? "wake" : "skip"
    }

    /// The conditions this source offers.
    public var conditionChoices: [RoutineWatchConditionChoice] {
        switch type {
        case .files: [.none, .jsonPath]
        case .command: [.none, .jsonPath, .contains, .exitCode]
        case .tool: [.none, .jsonPath, .contains]
        }
    }

    /// Another source: a condition it does not offer goes back to none.
    public mutating func setType(_ next: RoutineWatchSourceType) {
        type = next
        if !conditionChoices.contains(condition) { condition = .none }
    }

    /// Track (items, key, fields) is for a JSON result: not for files.
    public var offersTrack: Bool { type != .files }
    /// A tool never touches the computer, so it has no asleep choice.
    public var offersWhenAsleep: Bool { type != .tool }
    /// The cost line under "Wake it to check".
    public var showsWakeCost: Bool { offersWhenAsleep && whenAsleep == "wake" }

    /// The watch the draft says (nil when off), or what is missing.
    public func build() -> Result<WidgetJSON?, RoutineWatchProblem> {
        guard on else { return .success(nil) }
        var source: [String: WidgetJSON]
        switch type {
        case .files:
            let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
            if RoutineWatchRules.leavesTheFolder(path) || trimmed.hasPrefix("/") { return .failure(.path) }
            source = ["type": .string("files"), "path": .string(trimmed)]
            if recursive { source["recursive"] = .bool(true) }
        case .command:
            let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return .failure(.command) }
            source = ["type": .string("command"), "command": .string(trimmed)]
        case .tool:
            let trimmed = tool.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return .failure(.tool) }
            source = ["type": .string("tool"), "tool": .string(trimmed)]
            if !args.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                guard let parsed = RoutineWatchRules.parseObject(args) else { return .failure(.args) }
                source["args"] = parsed
            }
        }
        var conditionValue: WidgetJSON?
        switch condition {
        case .jsonPath:
            let trimmed = conditionPath.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return .failure(.conditionPath) }
            var value: [String: WidgetJSON] = ["test": .string("json_path"), "path": .string(trimmed), "op": .string(conditionOp.rawValue)]
            if conditionOp != .exists { value["value"] = RoutineWatchRules.typed(self.conditionValue) }
            conditionValue = .object(value)
        case .contains:
            guard !containsText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return .failure(.contains) }
            var value: [String: WidgetJSON] = ["test": .string("contains"), "text": .string(containsText)]
            if containsNegate { value["negate"] = .bool(true) }
            conditionValue = .object(value)
        case .exitCode where type == .command:
            let number = Double(exitValue.trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            let code = max(0, min(255, Int((number.isFinite ? number : 0).rounded())))
            conditionValue = .object(["test": .string("exit_code"), "op": .string(exitOp == "eq" ? "eq" : "ne"), "value": .number(Double(code))])
        default:
            conditionValue = nil
        }
        var watch: [String: WidgetJSON] = ["kind": .string("watch"), "source": .object(source)]
        if let conditionValue {
            if wakeOn == "match" { watch["wakeOn"] = .string("match") }
            watch["condition"] = conditionValue
        }
        let fields = trackFields.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let items = trackItems.trimmingCharacters(in: .whitespacesAndNewlines)
        let key = trackKey.trimmingCharacters(in: .whitespacesAndNewlines)
        if offersTrack, !items.isEmpty || !key.isEmpty || !fields.isEmpty {
            var track: [String: WidgetJSON] = [:]
            if !items.isEmpty { track["items"] = .string(items) }
            if !key.isEmpty { track["key"] = .string(key) }
            if !fields.isEmpty { track["fields"] = .array(fields.map(WidgetJSON.string)) }
            watch["track"] = .object(track)
        }
        if firstRun == "wake" { watch["firstRun"] = .string("wake") }
        if whenAsleep == "wake", offersWhenAsleep { watch["whenAsleep"] = .string("wake") }
        return .success(.object(watch))
    }

    public var problem: RoutineWatchProblem? {
        if case let .failure(problem) = build() { return problem }
        return nil
    }
}

public enum RoutineWatchRules {
    /// The desktop shows the section for a bot routine that repeats.
    public static func allowed(target: String, repeats: Bool) -> Bool { target != "room-goal" && repeats }

    /// The pre-check when it is a watch.
    public static func watch(_ precheck: WidgetJSON?) -> [String: WidgetJSON]? {
        guard let object = precheck?.object, object["kind"]?.string == "watch" else { return nil }
        return object
    }

    /// What Save does with the pre-check, from the draft the editor opened
    /// with and the one it closes with. Untouched: nothing. Turned off, or
    /// not allowed any more (a team goal, a one-time routine): removed when
    /// there was a watch. Else the whole watch.
    public static func edit(original: WidgetJSON?, initial: RoutineWatchDraft, draft: RoutineWatchDraft, allowed: Bool) -> Result<RoutineWatchEdit, RoutineWatchProblem> {
        let hadWatch = watch(original) != nil
        guard allowed else { return .success(hadWatch ? .remove : .keep) }
        guard draft != initial else { return .success(.keep) }
        switch draft.build() {
        case let .failure(problem): return .failure(problem)
        case .success(nil): return .success(hadWatch ? .remove : .keep)
        case let .success(.some(built)):
            return .success(built == original ? .keep : .set(built))
        }
    }

    /// `..` as a whole segment leaves the bot's folder.
    static func leavesTheFolder(_ path: String) -> Bool {
        path.split(separator: "/", omittingEmptySubsequences: false).contains("..")
    }

    /// A number or a boolean when the text reads as one (`typedValue`).
    static func typed(_ text: String) -> WidgetJSON {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed == "true" { return .bool(true) }
        if trimmed == "false" { return .bool(false) }
        if !trimmed.isEmpty, let number = Double(trimmed), number.isFinite { return .number(number) }
        return .string(text)
    }

    /// A value as the field shows it.
    static func text(_ value: WidgetJSON) -> String {
        switch value {
        case let .string(text): return text
        case let .bool(flag): return flag ? "true" : "false"
        case let .number(number): return number.rounded() == number && abs(number) < 1e15 ? String(Int64(number)) : String(number)
        case .null: return ""
        default: return pretty(value)
        }
    }

    static func parseObject(_ text: String) -> WidgetJSON? {
        guard let data = text.data(using: .utf8),
              let value = try? JSONDecoder().decode(WidgetJSON.self, from: data),
              case .object = value
        else { return nil }
        return value
    }

    static func pretty(_ value: WidgetJSON) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else { return "" }
        return text
    }
}

extension WidgetJSON {
    /// The value for a JSONSerialization body; whole numbers as integers.
    var bodyValue: Any {
        switch self {
        case .null: return NSNull()
        case let .bool(flag): return flag
        case let .number(number): return number.rounded() == number && abs(number) < 1e15 ? Int(number) as Any : number
        case let .string(text): return text
        case let .array(values): return values.map(\.bodyValue)
        case let .object(values): return values.mapValues(\.bodyValue)
        }
    }
}

/// `POST /api/routines/watch-check`: one reading, no model, nothing kept.
public enum RoutineWatchCheck: Equatable, Sendable {
    /// Not read now, and why (an asleep computer, for one).
    case skipped(String)
    case read(summary: String, excerpt: String, items: Int?, condition: Condition?, ms: Int)
    case failed(String)

    public struct Condition: Equatable, Sendable {
        public var holds: Bool
        public var seen: String
    }
}

extension RoutineWatchCheck: Decodable {
    private enum Keys: String, CodingKey { case ok, skipped, summary, excerpt, items, condition, ms, error }
    private struct ConditionWire: Decodable { var holds: Bool?; var seen: String? }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        if (try? c.decodeIfPresent(Bool.self, forKey: .ok)) != true {
            self = .failed((try? c.decodeIfPresent(String.self, forKey: .error)) ?? "The check failed.")
            return
        }
        if let skipped = try? c.decodeIfPresent(String.self, forKey: .skipped) {
            self = .skipped(skipped)
            return
        }
        // Each piece is typed on its own: one expression chaining these
        // optionals took the older compiler past its type-check limit.
        let wire: ConditionWire? = (try? c.decodeIfPresent(ConditionWire.self, forKey: .condition)) ?? nil
        let summary: String = (try? c.decodeIfPresent(String.self, forKey: .summary)) ?? ""
        let excerpt: String = (try? c.decodeIfPresent(String.self, forKey: .excerpt)) ?? ""
        let items: Int? = (try? c.decodeIfPresent(Int.self, forKey: .items)) ?? nil
        let condition: Condition? = wire.map { (found: ConditionWire) -> Condition in
            Condition(holds: found.holds == true, seen: found.seen ?? "")
        }
        let elapsed: Double = (try? c.decodeIfPresent(Double.self, forKey: .ms)) ?? 0
        let ms: Int = Int(elapsed)
        self = .read(summary: summary, excerpt: excerpt, items: items, condition: condition, ms: ms)
    }
}

public extension Routine {
    /// The badge "Runs on change" in the list.
    var runsOnChange: Bool { RoutineWatchRules.watch(precheck) != nil }
}

public extension CompanionClient {
    /// "Check now": the watch read once where the routine would read it
    /// (the routine's own person and place when `routineId` names it).
    func checkRoutineWatch(botId: String, watch: WidgetJSON, routineId: String? = nil, runOn: String? = nil) async throws -> RoutineWatchCheck {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var body: [String: Any] = ["botId": botId, "precheck": watch.bodyValue]
        if let routineId { body["routineId"] = routineId }
        if let runOn { body["runOn"] = runOn }
        return try await send(makeRequest("POST", "/api/routines/watch-check", body: body), as: RoutineWatchCheck.self)
    }
}

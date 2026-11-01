import Foundation

// What a bot is doing and did lately (matrix row BP10): the bot panel's
// Coding and Activity sections, their history and one entry's detail. Wire
// shapes from `shared/bot-activity.ts`, served by GET /api/bots/:id/activity
// and /activity/item (server/routes/bot-activity.ts), narrowed by the server
// to what the asking person may read. The list logic mirrors the desktop's
// `src/lib/bot-activity.ts` and `src/lib/activity-steps.ts` so the phone
// shows the same entries in the same order.

// MARK: - Wire

/// `BotActivityStatus`: running, waiting and queued are live.
public enum BotActivityStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case running, waiting, queued, finished, failed, stopped

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BotActivityStatus(rawValue: raw) ?? .finished
    }

    /// `activityStatusActive`.
    public var isActive: Bool { self == .running || self == .waiting || self == .queued }
}

/// `BotActivityKind`. An unknown kind reads as a session.
public enum BotActivityKind: String, Codable, Hashable, Sendable {
    case session, routine, hop, subagent

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        self = BotActivityKind(rawValue: raw) ?? .session
    }
}

/// Who started an entry.
public struct BotActivityActor: Codable, Hashable, Sendable {
    public enum Kind: String, Codable, Hashable, Sendable {
        case person, bot, routine

        public init(from decoder: Decoder) throws {
            let raw = try decoder.singleValueContainer().decode(String.self)
            self = Kind(rawValue: raw) ?? .person
        }
    }

    public var kind: Kind
    public var name: String

    public init(kind: Kind, name: String) {
        self.kind = kind
        self.name = name
    }
}

/// One entry of the list (`BotActivityItem`).
public struct BotActivityItem: Codable, Hashable, Identifiable, Sendable {
    /// `thread:<threadId>` or `run:<routineRunId>`.
    public var id: String
    public var kind: BotActivityKind
    /// The bot the work runs on (another bot's, for a sub-agent).
    public var botId: String
    public var botName: String?
    /// A conversation's entry: the request its newest turn answers, once the
    /// conversation had others (else the thread's title).
    public var title: String
    /// The conversation's own title, when `title` is a later request.
    public var threadTitle: String?
    /// That request is the same words sent again (Regenerate, Retry).
    public var retry: Bool?
    public var status: BotActivityStatus
    public var startedAt: Double
    public var endedAt: Double?
    public var updatedAt: Double
    /// Present only when the viewer may open that conversation.
    public var threadId: String?
    public var startedBy: BotActivityActor?
    public var childCount: Int?
    public var coding: Bool?
    public var currentStep: String?
    public var canStop: Bool?
    public var parentId: String?
    public var parallel: Bool?
    /// The conversation's repository work (`BotCodeWork`), when it is coding.
    public var code: BotCodeWork?

    public init(
        id: String, kind: BotActivityKind = .session, botId: String, botName: String? = nil, title: String,
        status: BotActivityStatus, startedAt: Double, endedAt: Double? = nil, updatedAt: Double? = nil,
        threadId: String? = nil, startedBy: BotActivityActor? = nil, childCount: Int? = nil, coding: Bool? = nil,
        currentStep: String? = nil, canStop: Bool? = nil, parentId: String? = nil, parallel: Bool? = nil,
        code: BotCodeWork? = nil, threadTitle: String? = nil, retry: Bool? = nil
    ) {
        self.id = id
        self.kind = kind
        self.botId = botId
        self.botName = botName
        self.title = title
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.updatedAt = updatedAt ?? startedAt
        self.threadId = threadId
        self.startedBy = startedBy
        self.childCount = childCount
        self.coding = coding
        self.currentStep = currentStep
        self.canStop = canStop
        self.parentId = parentId
        self.parallel = parallel
        self.code = code
        self.threadTitle = threadTitle
        self.retry = retry
    }

    /// The title as shown: a retried request says so ("Retry · ...", the
    /// desktop's `activityTitle`), with the word in the reader's language.
    public func shownTitle(retryWord: String) -> String {
        retry == true ? "\(retryWord) · \(title)" : title
    }

    private enum CodingKeys: String, CodingKey {
        case id, kind, botId, botName, title, status, startedAt, endedAt, updatedAt, threadId, startedBy
        case childCount, coding, currentStep, canStop, parentId, parallel, code, threadTitle, retry
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        kind = try values.decodeIfPresent(BotActivityKind.self, forKey: .kind) ?? .session
        botId = try values.decodeIfPresent(String.self, forKey: .botId) ?? ""
        botName = try values.decodeIfPresent(String.self, forKey: .botName)
        title = try values.decodeIfPresent(String.self, forKey: .title) ?? ""
        status = try values.decodeIfPresent(BotActivityStatus.self, forKey: .status) ?? .finished
        startedAt = try values.decodeIfPresent(Double.self, forKey: .startedAt) ?? 0
        endedAt = try values.decodeIfPresent(Double.self, forKey: .endedAt)
        updatedAt = try values.decodeIfPresent(Double.self, forKey: .updatedAt) ?? startedAt
        threadId = try values.decodeIfPresent(String.self, forKey: .threadId)
        startedBy = try? values.decodeIfPresent(BotActivityActor.self, forKey: .startedBy)
        childCount = try values.decodeIfPresent(Int.self, forKey: .childCount)
        coding = try values.decodeIfPresent(Bool.self, forKey: .coding)
        currentStep = try values.decodeIfPresent(String.self, forKey: .currentStep)
        canStop = try values.decodeIfPresent(Bool.self, forKey: .canStop)
        parentId = try values.decodeIfPresent(String.self, forKey: .parentId)
        parallel = try values.decodeIfPresent(Bool.self, forKey: .parallel)
        code = try? values.decodeIfPresent(BotCodeWork.self, forKey: .code)
        threadTitle = try values.decodeIfPresent(String.self, forKey: .threadTitle)
        retry = try values.decodeIfPresent(Bool.self, forKey: .retry)
    }

    /// The card's Stop: a live entry the viewer may stop, on a thread they
    /// may open (ActivityCard.tsx `stoppable`).
    public var stoppable: Bool { canStop == true && threadId != nil && status.isActive }
}

/// The repository work of a coding conversation (`BotCodeWork`). Only the
/// fields the Environment pod shows are read; the rest of the payload is
/// ignored.
public struct BotCodeWork: Codable, Hashable, Sendable {
    /// owner/name of the folder's origin remote.
    public var repo: String?
    /// The branch checked out in that folder now.
    public var branch: String?
}

/// A pull request tied to a launched agent's failed run.
public struct BotLaunchedAgentPullRequest: Codable, Hashable, Sendable {
    public var number: Int
    public var url: String?
}

/// A cloud agent this bot launched (agent API hidden peer thread).
public struct BotLaunchedAgentItem: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var targetBotId: String
    public var targetBotName: String
    public var title: String
    public var status: BotActivityStatus
    public var startedAt: Double
    public var updatedAt: Double
    public var threadId: String?
    public var pullRequest: BotLaunchedAgentPullRequest?

    public func asActivityItem() -> BotActivityItem {
        BotActivityItem(
            id: id, botId: targetBotId, title: title, status: status,
            startedAt: startedAt, updatedAt: updatedAt, threadId: threadId
        )
    }
}

/// GET /api/bots/:id/activity.
public struct BotActivityList: Decodable, Hashable, Sendable {
    public var items: [BotActivityItem]
    public var subagents: [BotActivityItem]
    public var launchedAgents: [BotLaunchedAgentItem]

    public init(items: [BotActivityItem] = [], subagents: [BotActivityItem] = [], launchedAgents: [BotLaunchedAgentItem] = []) {
        self.items = items
        self.subagents = subagents
        self.launchedAgents = launchedAgents
    }

    private enum CodingKeys: String, CodingKey { case items, subagents, launchedAgents }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        items = try values.decodeIfPresent([BotActivityItem].self, forKey: .items) ?? []
        subagents = try values.decodeIfPresent([BotActivityItem].self, forKey: .subagents) ?? []
        launchedAgents = try values.decodeIfPresent([BotLaunchedAgentItem].self, forKey: .launchedAgents) ?? []
    }

    public var all: [BotActivityItem] { items + subagents }
}

/// One tool call of an entry (`BotActivityStep`).
public struct BotActivityStep: Decodable, Hashable, Identifiable, Sendable {
    public struct Subagent: Decodable, Hashable, Sendable {
        public var description: String?
        public var prompt: String?
        public var type: String?
        public var result: String?
    }

    public enum Where: String, Decodable, Hashable, Sendable { case computer, server }

    public var id: String
    public var name: String
    public var summary: String?
    /// nil while the call runs.
    public var ok: Bool?
    public var at: Double
    public var `where`: Where?
    public var files: [String]?
    public var input: String?
    public var parentId: String?
    public var subagent: Subagent?

    public init(id: String, name: String, summary: String? = nil, ok: Bool? = nil, at: Double = 0, where place: Where? = nil, input: String? = nil, parentId: String? = nil, subagent: Subagent? = nil) {
        self.id = id
        self.name = name
        self.summary = summary
        self.ok = ok
        self.at = at
        self.where = place
        self.files = nil
        self.input = input
        self.parentId = parentId
        self.subagent = subagent
    }

    private enum CodingKeys: String, CodingKey { case id, name, summary, ok, at, `where`, files, input, parentId, subagent }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        id = try values.decode(String.self, forKey: .id)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        summary = try values.decodeIfPresent(String.self, forKey: .summary)
        ok = try values.decodeIfPresent(Bool.self, forKey: .ok)
        at = try values.decodeIfPresent(Double.self, forKey: .at) ?? 0
        self.where = try? values.decodeIfPresent(Where.self, forKey: .where)
        files = try values.decodeIfPresent([String].self, forKey: .files)
        input = try values.decodeIfPresent(String.self, forKey: .input)
        parentId = try values.decodeIfPresent(String.self, forKey: .parentId)
        subagent = try? values.decodeIfPresent(Subagent.self, forKey: .subagent)
    }
}

/// Whose credentials the newest turn ran with.
public enum BotActivityVia: String, Decodable, Hashable, Sendable {
    case subscription
    case ownerKey = "owner-key"
    case speakerKey = "speaker-key"
    case server
    case orgKey = "org-key"
}

/// GET /api/bots/:id/activity/item: one entry in full.
public struct BotActivityDetail: Decodable, Hashable, Sendable {
    public struct Engine: Decodable, Hashable, Sendable {
        public var instanceId: String
        public var model: String
    }

    public var item: BotActivityItem
    public var engine: Engine?
    public var via: BotActivityVia?
    public var steps: [BotActivityStep]
    public var stepsTruncated: Bool
    public var files: [String]
    public var children: [BotActivityItem]
    /// A routine run's error or the question it waits on.
    public var note: String?
    /// The viewer may stop it now.
    public var canStop: Bool

    public init(item: BotActivityItem, steps: [BotActivityStep] = [], files: [String] = [], children: [BotActivityItem] = [], canStop: Bool = false, note: String? = nil) {
        self.item = item
        self.engine = nil
        self.via = nil
        self.steps = steps
        self.stepsTruncated = false
        self.files = files
        self.children = children
        self.note = note
        self.canStop = canStop
    }

    private enum CodingKeys: String, CodingKey { case engine, via, steps, stepsTruncated, files, children, note, canStop }

    public init(from decoder: Decoder) throws {
        item = try BotActivityItem(from: decoder)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        engine = try? values.decodeIfPresent(Engine.self, forKey: .engine)
        via = try? values.decodeIfPresent(BotActivityVia.self, forKey: .via)
        steps = (try? values.decodeIfPresent([BotActivityStep].self, forKey: .steps)) ?? []
        stepsTruncated = try values.decodeIfPresent(Bool.self, forKey: .stepsTruncated) ?? false
        files = try values.decodeIfPresent([String].self, forKey: .files) ?? []
        children = (try? values.decodeIfPresent([BotActivityItem].self, forKey: .children)) ?? []
        note = try values.decodeIfPresent(String.self, forKey: .note)
        canStop = try values.decodeIfPresent(Bool.self, forKey: .canStop) ?? false
    }

    /// The detail's Stop and steer box: live, stoppable, on a thread.
    public var stoppable: Bool { item.status.isActive && canStop && item.threadId != nil }
}

private struct BotActivityDetailResponse: Decodable {
    var item: BotActivityDetail
}

// MARK: - Lists

/// Which section's history (`BotActivityFilter`).
public enum BotActivityFilter: String, CaseIterable, Hashable, Sendable {
    case coding
    case other
}

/// The history's status chips (`HistoryStatus`).
public enum BotActivityHistoryStatus: String, CaseIterable, Hashable, Sendable {
    case all, running, finished, failed
}

public enum BotActivityRules {
    /// The panel's list size and the history's (ActivitySection.tsx).
    public static let listLimit = 50
    /// Polls while work runs, and while idle.
    public static let pollActive: TimeInterval = 4
    public static let pollIdle: TimeInterval = 30
    /// The detail follows a live run.
    public static let detailPoll: TimeInterval = 3
    /// A job that finishes stays this long, the last part fading.
    public static let finishedLinger: TimeInterval = 5
    public static let finishedFade: TimeInterval = 0.7

    private static func newestRunningFirst(_ a: BotActivityItem, _ b: BotActivityItem) -> Bool {
        if a.status.isActive != b.status.isActive { return a.status.isActive }
        return a.updatedAt > b.updatedAt
    }

    private static func unique(_ items: [BotActivityItem]) -> [BotActivityItem] {
        var seen = Set<String>()
        return items.filter { seen.insert($0.id).inserted }
    }

    /// Details > Coding: running coding jobs (never a sub-agent), and those
    /// that just finished while they leave (`codingLive`).
    public static func codingLive(_ items: [BotActivityItem], visible: (BotActivityItem) -> Bool = { _ in true }) -> [BotActivityItem] {
        items.filter { $0.coding == true && $0.kind != .subagent && visible($0) }.sorted(by: newestRunningFirst)
    }

    /// Details > Activity: everything else plus the sub-agents (`activityLive`).
    public static func activityLive(_ items: [BotActivityItem], subagents: [BotActivityItem], visible: (BotActivityItem) -> Bool = { _ in true }) -> [BotActivityItem] {
        unique(items.filter { $0.coding != true } + subagents).filter(visible).sorted(by: newestRunningFirst)
    }

    /// The history: newest first, by status and words; Failed includes
    /// stopped work (`historyItems`).
    public static func history(_ items: [BotActivityItem], status: BotActivityHistoryStatus, search: String) -> [BotActivityItem] {
        let words = search.lowercased().split(whereSeparator: \.isWhitespace).map(String.init)
        return unique(items)
            .filter { item in
                switch status {
                case .all: break
                case .running: if !item.status.isActive { return false }
                case .finished: if item.status != .finished { return false }
                case .failed: if item.status != .failed && item.status != .stopped { return false }
                }
                guard !words.isEmpty else { return true }
                let text = [item.title, item.threadTitle, item.botName, item.startedBy?.name, item.currentStep]
                    .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " ").lowercased()
                return words.allSatisfy { text.contains($0) }
            }
            .sorted { $0.startedAt > $1.startedAt }
    }

    /// "45s", "12m", "1h 05m" (`formatActivityDuration`).
    public static func duration(_ milliseconds: Double) -> String {
        // server numbers: a NaN or a huge value must not trap `Int(_:)`
        let seconds = milliseconds.isFinite ? Int(min(max(0, (milliseconds / 1000).rounded()), 1e9)) : 0
        if seconds < 60 { return "\(seconds)s" }
        let minutes = seconds / 60
        if minutes < 60 { return "\(minutes)m" }
        return "\(minutes / 60)h \(String(format: "%02d", minutes % 60))m"
    }

    /// The query of an entry's detail, from its list id (`loadBotActivityDetail`).
    public static func detailQuery(itemId: String) -> URLQueryItem {
        let parts = itemId.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
        let kind = parts.first.map(String.init) ?? ""
        let id = parts.count > 1 ? String(parts[1]) : ""
        return URLQueryItem(name: kind == "run" ? "runId" : "threadId", value: id)
    }

    /// What should be on screen changed: refetch (`activitySignature`).
    public static func signature(_ tasks: [BotTask]?) -> String {
        (tasks ?? []).map { "\($0.threadId):\($0.busy == true ? 1 : 0):\($0.activity ?? ""):\(Int($0.updatedAt ?? 0))" }.joined(separator: "|")
    }
}

/// The pieces of a card's second line, in order (`activitySubtitle`); the
/// app turns each into words.
public enum BotActivitySubtitlePart: Hashable, Sendable {
    case parallel
    case status(BotActivityStatus)
    case elapsed(String)
    case botName(String)
    case routine
    case handedBy(String)
    case step(String)
    case subagents(Int)

    public static func parts(for item: BotActivityItem, now: Double?) -> [BotActivitySubtitlePart] {
        var parts: [BotActivitySubtitlePart] = item.parallel == true ? [.parallel] : []
        if let now, item.status.isActive {
            parts += [.status(item.status), .elapsed(BotActivityRules.duration(now - item.startedAt))]
            if item.kind == .subagent, let name = item.botName, !name.isEmpty { parts.append(.botName(name)) }
            if item.kind == .routine { parts.append(.routine) }
            if item.kind == .hop, let name = item.startedBy?.name, !name.isEmpty { parts.append(.handedBy(name)) }
            if let step = item.currentStep, !step.isEmpty { parts.append(.step(step)) }
        } else {
            parts.append(.status(item.status))
            if item.kind == .hop, let name = item.startedBy?.name, !name.isEmpty { parts.append(.handedBy(name)) }
            else if item.kind == .routine { parts.append(.routine) }
            else if item.kind == .subagent, let name = item.botName, !name.isEmpty { parts.append(.botName(name)) }
        }
        if let count = item.childCount, count > 0 { parts.append(.subagents(count)) }
        return parts
    }
}

/// Follows the entries across fetches (`LiveActivity`): one seen running
/// and then settled stays `finishedLinger` from the moment it was seen
/// settled, fading over the last `finishedFade`; one already settled when
/// first seen never shows.
public struct BotActivityLiveTracker: Sendable {
    private var running = Set<String>()
    private var settled: [String: Date] = [:]

    public init() {}

    public mutating func update(_ items: [BotActivityItem], at now: Date) {
        for item in items {
            if item.status.isActive {
                running.insert(item.id)
                settled[item.id] = nil
            } else if running.remove(item.id) != nil {
                settled[item.id] = now
            }
        }
        settled = settled.filter { now.timeIntervalSince($0.value) < BotActivityRules.finishedLinger }
    }

    public func visible(_ item: BotActivityItem, at now: Date) -> Bool {
        if item.status.isActive { return true }
        guard let since = settled[item.id] else { return false }
        return now.timeIntervalSince(since) < BotActivityRules.finishedLinger
    }

    public func fading(_ item: BotActivityItem, at now: Date) -> Bool {
        guard !item.status.isActive, let since = settled[item.id] else { return false }
        return now.timeIntervalSince(since) >= BotActivityRules.finishedLinger - BotActivityRules.finishedFade
    }

    /// The next moment the view changes on its own (a fade starts or an
    /// entry leaves), nil when nothing lingers.
    public func nextChange(after now: Date) -> Date? {
        settled.values.flatMap { since in
            [since.addingTimeInterval(BotActivityRules.finishedLinger - BotActivityRules.finishedFade),
             since.addingTimeInterval(BotActivityRules.finishedLinger)]
        }
        .filter { $0 > now }
        .min()
    }
}

// MARK: - Steps

/// A step's name in words (`humanStepName`); the app localizes each case.
public enum BotActivityStepLabel: Hashable, Sendable {
    case subagent(String?)
    case toolSearch, searchFiles, listFiles, todo
    case runCommand, readFile, writeFile, editFile, fetchWebPage, searchWeb, deleteFile
    case scheduleRoutine, changeRoutine, enableSkill, updateSkill, updateProfile, think, takeAction, useTool
    /// The tool's own name, underscores as spaces.
    case raw(String)

    public static func isSubagent(_ step: BotActivityStep) -> Bool {
        step.name == "Agent" || step.name == "Task" || step.subagent != nil
    }

    public static func of(_ step: BotActivityStep) -> BotActivityStepLabel {
        if isSubagent(step) {
            let about = step.subagent?.description ?? step.subagent?.type
            return .subagent(about?.isEmpty == false ? about : nil)
        }
        switch step.name {
        case "ToolSearch": return .toolSearch
        case "Glob", "Grep": return .searchFiles
        case "LS": return .listFiles
        case "TodoWrite": return .todo
        case "NotebookEdit", "MultiEdit": return .editFile
        default: break
        }
        let parsed = ApprovalRiskClassifier.parseToolId(step.name)
        if parsed.server != nil {
            switch parsed.name {
            case "read_file": return .readFile
            case "write_file": return .writeFile
            case "edit_file": return .editFile
            case "list_files", "list_dir", "list_directory": return .listFiles
            case "vm_exec", "run_command", "exec": return .runCommand
            case "search_files": return .searchFiles
            default: break
            }
        }
        // `toolLabel` (ApprovalCard.tsx)
        switch step.name {
        case "": return .takeAction
        case "Bash", "shell": return .runCommand
        case "Read", "read": return .readFile
        case "Write": return .writeFile
        case "Edit", "edit": return .editFile
        case "WebFetch", "fetch": return .fetchWebPage
        case "WebSearch": return .searchWeb
        case "schedule_routine": return .scheduleRoutine
        case "manage_routine": return .changeRoutine
        case "stage_skill": return .enableSkill
        case "update_skill": return .updateSkill
        case "update_profile": return .updateProfile
        case "delete": return .deleteFile
        case "think": return .think
        case "other": return .takeAction
        case "tool": return .useTool
        default: return .raw(parsed.name.replacingOccurrences(of: "_", with: " "))
        }
    }

    /// The top-level steps, and each sub-agent's own steps by its id (`stepTree`).
    public static func tree(_ steps: [BotActivityStep]) -> (top: [BotActivityStep], children: [String: [BotActivityStep]]) {
        let ids = Set(steps.map(\.id))
        var top: [BotActivityStep] = []
        var children: [String: [BotActivityStep]] = [:]
        for step in steps {
            if let parent = step.parentId, ids.contains(parent) {
                children[parent, default: []].append(step)
            } else {
                top.append(step)
            }
        }
        return (top, children)
    }
}

// MARK: - Step groups

/// The steps of a task as the sheet lists them (`groupActivitySteps`,
/// src/lib/activity-step-groups.ts): the same step repeated back to back
/// reads once with a count, a running step or a sub-agent's step never
/// merges, a failure never hides inside a run of successes, and the place a
/// step ran is marked once, then only when it changes.
public struct BotActivityStepGroup: Hashable, Identifiable, Sendable {
    public enum Phase: String, Hashable, Sendable { case running, done, failed }

    /// The first step's id.
    public var id: String
    public var label: BotActivityStepLabel
    public var steps: [BotActivityStep]
    public var phase: Phase
    /// The one summary when every step inside shares it.
    public var summary: String?
    public var place: BotActivityStep.Where?
    /// Draw the place: the first group with one, or a place other than the previous one's.
    public var placeChanged: Bool
    public var subagent: Bool
    /// A sub-agent's own calls, grouped the same way.
    public var substeps: [BotActivityStepGroup]

    public var count: Int { steps.count }

    public static func phase(_ step: BotActivityStep) -> Phase {
        step.ok == nil ? .running : step.ok == true ? .done : .failed
    }

    /// The top-level steps grouped, each sub-agent's calls grouped under it.
    public static func groups(_ steps: [BotActivityStep]) -> [BotActivityStepGroup] {
        let tree = BotActivityStepLabel.tree(steps)
        return list(tree.top, children: tree.children)
    }

    private static func list(_ steps: [BotActivityStep], children: [String: [BotActivityStep]]) -> [BotActivityStepGroup] {
        var groups: [BotActivityStepGroup] = []
        var lastPlace: BotActivityStep.Where?
        for step in steps {
            let phase = phase(step)
            let subagent = BotActivityStepLabel.isSubagent(step)
            let label = BotActivityStepLabel.of(step)
            if var last = groups.last, !subagent, !last.subagent, last.label == label, last.phase == phase, phase != .running, last.place == step.where {
                last.steps.append(step)
                if last.summary != step.summary { last.summary = nil }
                groups[groups.count - 1] = last
                continue
            }
            let changed = step.where != nil && step.where != lastPlace
            if let place = step.where { lastPlace = place }
            let own = children[step.id] ?? []
            groups.append(BotActivityStepGroup(
                id: step.id, label: label, steps: [step], phase: phase,
                summary: step.summary?.isEmpty == false ? step.summary : nil,
                place: step.where, placeChanged: changed, subagent: subagent,
                substeps: subagent && !own.isEmpty ? list(own, children: children) : []
            ))
        }
        return groups
    }
}

/// The sub-agents as the sheet lists them (`sortSubagents`,
/// src/components/task/SubagentList.tsx): waiting first, then running,
/// queued, failed, finished, stopped; newest first inside a state.
public enum BotActivitySubagents {
    private static func rank(_ status: BotActivityStatus) -> Int {
        switch status {
        case .waiting: 0
        case .running: 1
        case .queued: 2
        case .failed: 3
        case .finished: 4
        case .stopped: 5
        }
    }

    public static func sorted(_ items: [BotActivityItem]) -> [BotActivityItem] {
        items.sorted { a, b in
            rank(a.status) != rank(b.status) ? rank(a.status) < rank(b.status) : a.updatedAt > b.updatedAt
        }
    }
}

// MARK: - Client

public extension CompanionClient {
    /// `GET /api/bots/:id/activity[?filter=&limit=]`.
    func botActivity(botId: String, filter: BotActivityFilter? = nil, limit: Int? = BotActivityRules.listLimit) async throws -> BotActivityList {
        try await send(botActivityRequest(botId: botId, filter: filter, limit: limit), as: BotActivityList.self)
    }

    /// `GET /api/bots/:id/activity/item?threadId=|runId=`.
    func botActivityDetail(botId: String, itemId: String) async throws -> BotActivityDetail {
        try await send(botActivityDetailRequest(botId: botId, itemId: itemId), as: BotActivityDetailResponse.self).item
    }

    /// A message into a running task: it joins the work in progress
    /// (`busyMode: steer`, ActivityDetailModal.tsx `onSteer`).
    func steerActivity(botId: String, threadId: String, text: String) async throws {
        _ = try await send(
            text: text,
            to: .bot(id: botId, threadId: threadId),
            sendId: UUID().uuidString.lowercased(),
            options: SendOptions(busyMode: .steer)
        )
    }

    func botActivityRequest(botId: String, filter: BotActivityFilter?, limit: Int?) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var query: [URLQueryItem] = []
        if let filter { query.append(URLQueryItem(name: "filter", value: filter.rawValue)) }
        if let limit { query.append(URLQueryItem(name: "limit", value: String(limit))) }
        return try makeRequest("GET", "/api/bots/\(botId)/activity", query: query)
    }

    func botActivityDetailRequest(botId: String, itemId: String) throws -> URLRequest {
        let query = BotActivityRules.detailQuery(itemId: itemId)
        guard Self.validRouteID(botId), let id = query.value, Self.validRouteID(id) else { throw APIError.badURL }
        return try makeRequest("GET", "/api/bots/\(botId)/activity/item", query: [query])
    }
}

// Routine runs as the desktop's Automations page treats them (matrix AU6,
// AU8-AU10, AU15): which runs need attention, the logs' status filter and
// search, the bot filter, cancel and seen, and where a routine's results go.
//
// Desktop: src/components/RoutineCalendarPage.tsx (RoutinesPage, EventDetails),
// src/components/routines/RoutineLogs.tsx, ResultsDestination.tsx,
// shared/routines.ts (`isRoutineProblemRun`), src/lib/routine-display.ts.
import Foundation

public extension RoutineRun {
    /// `isRoutineProblemRun`: failed or missed.
    var isProblem: Bool { status == "failed" || status == "missed" }
    /// A problem nobody has looked at yet: the red dot and the badge.
    var isUnseenProblem: Bool { isProblem && seenAt == nil }
    /// Queued, running or waiting: "Cancel run" applies.
    var isActive: Bool { ["queued", "running", "waiting"].contains(status) }
    /// `routineRunTime`: the logs' sort key.
    var logTime: Double {
        if createdAt != 0 { return createdAt }
        if let startedAt, startedAt != 0 { return startedAt }
        return scheduledFor
    }
    /// "schedule", "manual" or "webhook" (`routines.trigger.*`).
    var trigger: String { triggerSource ?? (manual ? "manual" : "schedule") }
    /// What a team-goal run's label says instead of the run status.
    var labelKey: String { goalStatus.map { "goal.\($0)" } ?? "status.\(status)" }
    /// The text a log row previews: what it waits on, the error, the output.
    var preview: String? {
        for text in [attention, error, output] {
            if let text, !text.isEmpty { return text }
        }
        return nil
    }
    /// 2026-10-29 (`routineRunPreview`): the first line worth reading of the
    /// preview, without Markdown marks or a table's pipes ("Area · Open").
    var previewLine: String? {
        guard let text = preview else { return nil }
        let line = text.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .first { !$0.isEmpty && !Self.isTableRule($0) } ?? ""
        let plain = line.hasPrefix("|")
            ? line.split(separator: "|").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " · ")
            : line
        let cleaned = plain.filter { !"*_`#>".contains($0) }.trimmingCharacters(in: .whitespaces)
        return cleaned.isEmpty ? nil : cleaned
    }

    private static func isTableRule(_ line: String) -> Bool {
        let body = line.filter { !" |".contains($0) }
        return !body.isEmpty && body.allSatisfy { "-:".contains($0) } && body.contains("--")
    }

    /// The run's state in the task sheet's words (`runActivityStatus`).
    var activityStatus: BotActivityStatus {
        switch status {
        case "queued": .queued
        case "running": .running
        case "waiting": .waiting
        case "failed", "missed": .failed
        case "cancelled": .stopped
        default: .finished
        }
    }

    /// How long the run took, or has been going, in milliseconds (nil before
    /// it started, or when it ended without a finish time).
    func elapsedMs(now: Double) -> Double? {
        guard let startedAt, startedAt > 0 else { return nil }
        if let finishedAt { return max(0, finishedAt - startedAt) }
        return ["running", "waiting"].contains(status) ? max(0, now - startedAt) : nil
    }
}

public extension RoutineRunLog {
    /// The logs' period (2026-10-29): any time or the last day, week, month.
    enum Period: String, CaseIterable, Sendable {
        case all, day, week, month
        public var milliseconds: Double? {
            switch self {
            case .all: nil
            case .day: 86_400_000
            case .week: 7 * 86_400_000
            case .month: 30 * 86_400_000
            }
        }
    }

    /// The bot and period filters on top of `filter`.
    static func narrowed(_ runs: [RoutineRun], botId: String?, period: Period, now: Double) -> [RoutineRun] {
        runs.filter { run in
            (botId == nil || run.botId == botId) && (period.milliseconds.map { run.logTime >= now - $0 } ?? true)
        }
    }

    /// The routines the logs can narrow to, a deleted one included (its runs
    /// stay): id and name, by name.
    static func routineChoices(_ runs: [RoutineRun]) -> [(id: String, name: String)] {
        var seen: [String: String] = [:]
        for run in runs where seen[run.routineId] == nil { seen[run.routineId] = run.routineName }
        return seen.map { (id: $0.key, name: $0.value) }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }
}

/// The logs' status picker (`RoutineRunStatusFilter`).
public enum RoutineRunStatusFilter: Hashable, Sendable {
    case all
    case problems
    case status(String)

    /// The order the desktop lists them in.
    public static let statuses = ["queued", "running", "waiting", "completed", "failed", "missed", "cancelled"]
    public static let allCases: [RoutineRunStatusFilter] = [.all, .problems] + statuses.map { .status($0) }

    public func matches(_ run: RoutineRun) -> Bool {
        switch self {
        case .all: true
        case .problems: run.isProblem
        case let .status(status): run.status == status
        }
    }
}

public enum RoutineRunLog {
    /// `RoutineLogs`: one routine's runs or all, the status filter, a search
    /// over the routine, bot, output, error and question; newest first.
    public static func filter(
        _ runs: [RoutineRun], bots: [Bot], routineId: String? = nil,
        status: RoutineRunStatusFilter = .all, query: String = ""
    ) -> [RoutineRun] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return runs.filter { run in
            guard routineId == nil || run.routineId == routineId, status.matches(run) else { return false }
            guard !needle.isEmpty else { return true }
            let botName = bots.first { $0.id == run.botId }?.name ?? ""
            let haystack = "\(run.routineName) \(botName) \(run.output ?? "") \(run.error ?? "") \(run.attention ?? "")"
            return haystack.lowercased().contains(needle)
        }
        .sorted { $0.logTime > $1.logTime }
    }

    /// The badge beside "Run logs" and on the toolbar.
    public static func unseenProblems(_ runs: [RoutineRun]) -> Int {
        runs.filter(\.isUnseenProblem).count
    }

    /// Runs still going, the "N active" pill.
    public static func active(_ runs: [RoutineRun]) -> Int {
        runs.filter(\.isActive).count
    }

    /// Fold the server's answer to cancel or seen into the list.
    public static func replacing(_ runs: [RoutineRun], with updated: [RoutineRun]) -> [RoutineRun] {
        let byId = Dictionary(updated.map { ($0.id, $0) }, uniquingKeysWith: { _, last in last })
        return runs.map { byId[$0.id] ?? $0 }
    }

    /// "Mark all as read": stamp the runs the computer named by id.
    public static func stamping(_ runs: [RoutineRun], with seen: RoutineRunsSeen) -> [RoutineRun] {
        let ids = Set(seen.ids)
        guard !ids.isEmpty else { return runs }
        let stamp = seen.seenAt ?? Date().timeIntervalSince1970 * 1000
        return runs.map { run in
            guard ids.contains(run.id), run.seenAt == nil else { return run }
            var stamped = run
            stamped.seenAt = stamp
            return stamped
        }
    }
}

/// The "Filter schedule by bot" picker (AU6): nil is "All bots".
public struct RoutineBotFilter: Hashable, Sendable {
    public var botId: String?
    public init(botId: String? = nil) { self.botId = botId }

    public func routines(_ routines: [Routine]) -> [Routine] {
        guard let botId else { return routines }
        return routines.filter { $0.botId == botId }
    }

    public func runs(_ runs: [RoutineRun]) -> [RoutineRun] {
        guard let botId else { return runs }
        return runs.filter { $0.botId == botId }
    }
}

public extension Routine {
    /// `RoutineList`'s order: active first, then the next run, then the name.
    static func listOrder(_ a: Routine, _ b: Routine) -> Bool {
        if a.enabled != b.enabled { return a.enabled }
        let left = a.nextRunAt ?? .infinity
        let right = b.nextRunAt ?? .infinity
        if left != right { return left < right }
        return a.name.localizedCompare(b.name) == .orderedAscending
    }

    var isTeamGoal: Bool { target == "room-goal" }
}

// MARK: - Results thread (AU14, AU15)

public enum RoutineResults {
    /// #3581: the record of a run keeps this many characters of its report.
    static let recordOutputMax = 2_000

    /// #3581 (desktop RoutineRunWindow `recordMayBeClipped`): the record's
    /// text may be a clip of a longer report.
    public static func recordMayBeClipped(_ output: String?) -> Bool {
        let length = output?.count ?? 0
        return length >= recordOutputMax
            || (length > recordOutputMax / 2 && output!.trimmingCharacters(in: .whitespacesAndNewlines).hasSuffix("…"))
    }

    /// #3581: whether "Details" should read the run by its id for the rest
    /// of its report: a finished run whose card holds no more than a clip.
    public static func wantsWholeReport(_ card: RoutineRunCard) -> Bool {
        card.status == "completed" && recordMayBeClipped(card.summary)
    }

    /// #3581: the whole report "Details" shows: the longest of the card's own
    /// report (its message's summary, the whole text the chat holds) and the
    /// run's record (`report` from the single-run read, else `output`), as
    /// the desktop's run window does. Someone else's run keeps the card's
    /// text. Nothing to report: what the card says instead (its error, what
    /// it waits on, its state).
    public static func wholeReport(card: RoutineRunCard, run: RoutineRun? = nil) -> String {
        var candidates = [card.summary]
        if let run, run.redacted != true { candidates += [run.report, run.output] }
        let longest = candidates.compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .reduce("") { $1.count > $0.count ? $1 : $0 }
        if !longest.isEmpty { return longest }
        let fallback = [card.problems, card.error, card.attention]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        return fallback ?? card.stateLabel
    }

    /// The routine run a thread is the execution of, if any (desktop
    /// `routineRunOfThread`).
    public static func runId(ofThread threadId: String?, bots: [Bot], rooms: [Room] = []) -> String? {
        guard let threadId, !threadId.isEmpty else { return nil }
        for bot in bots {
            if let id = bot.tasks?.first(where: { $0.threadId == threadId })?.routineRunId, !id.isEmpty {
                return id
            }
        }
        for room in rooms {
            if let id = room.tasks?.first(where: { $0.threadId == threadId })?.routineRunId, !id.isEmpty {
                return id
            }
        }
        return nil
    }

    /// Which run a notification tap should open (desktop
    /// `openNotificationTarget` with `runDetail`): the payload's
    /// `routineRunId`, else the execution thread's run. Nil when the run is
    /// unknown to this client so the conversation still opens.
    public static func runId(
        for target: NotificationTarget,
        bots: [Bot],
        rooms: [Room] = [],
        knownRunIds: Set<String>?
    ) -> String? {
        let runId = target.routineRunId ?? runId(ofThread: target.threadId, bots: bots, rooms: rooms)
        guard let runId else { return nil }
        if let knownRunIds, !knownRunIds.contains(runId) { return nil }
        return runId
    }

    /// `EventDetails`: the results thread (or the chat it was asked from),
    /// when that conversation still exists.
    public static func openTarget(
        resultsThreadId: String?, sourceThreadId: String?, botId: String, bots: [Bot], rooms: [Room]
    ) -> NotificationTarget? {
        guard let threadId = resultsThreadId ?? sourceThreadId else { return nil }
        let exists = bots.contains { $0.threadId == threadId || ($0.tasks ?? []).contains { $0.threadId == threadId } }
            || rooms.contains { $0.threadId == threadId || ($0.tasks ?? []).contains { $0.threadId == threadId } }
        return exists ? NotificationTarget(botId: botId, threadId: threadId) : nil
    }

    public static func openTarget(for routine: Routine, bots: [Bot], rooms: [Room]) -> NotificationTarget? {
        openTarget(resultsThreadId: routine.resultsThreadId, sourceThreadId: routine.sourceThreadId,
                   botId: routine.botId, bots: bots, rooms: rooms)
    }

    public static func openTarget(for run: RoutineRun, routine: Routine?, bots: [Bot], rooms: [Room]) -> NotificationTarget? {
        openTarget(resultsThreadId: run.resultsThreadId ?? routine?.resultsThreadId,
                   sourceThreadId: run.sourceThreadId ?? routine?.sourceThreadId,
                   botId: run.botId, bots: bots, rooms: rooms)
    }

    /// 2026-10-29 ("we are in a unified chat"): Continue in the
    /// conversation opens the bot's one conversation (desktop
    /// `continueRoutineRunInConversation`): the topic the run's report went
    /// to when it is part of the conversation, else the conversation itself.
    /// Never the run's own task, never an older version's results thread.
    public static func conversationTarget(for run: RoutineRun, bots: [Bot]) -> NotificationTarget? {
        guard let bot = bots.first(where: { $0.id == run.botId }) else { return nil }
        if let reported = run.resultsThreadId ?? run.sourceThreadId,
           let task = bot.tasks?.first(where: { $0.threadId == reported }), SingleStream.isSegment(task) {
            return NotificationTarget(botId: bot.id, threadId: reported)
        }
        return NotificationTarget(botId: bot.id, threadId: SingleStream.home(of: bot) ?? bot.threadId)
    }

    /// 2026-11-05 (#2098, "a run opens ALWAYS in the main chat"): the run's
    /// message in the bot's unified conversation, when this client holds it
    /// (desktop `openRoutineRunInChat`): the row every way into a run lands on.
    public static func reportMessage(for run: RoutineRun, in messages: [Message]) -> Message? {
        messages.first { $0.kind == .routineRun && $0.routineRun?.runId == run.id }
    }

    /// What Continue in the conversation does (desktop
    /// `continueRoutineRunInConversation`): open the conversation, quote the
    /// report in that conversation's composer, and focus the report when this
    /// window already holds it.
    public struct ContinuePlan: Sendable {
        public var target: NotificationTarget
        /// Draft key for the composer now on screen (home when threads are hidden).
        public var composerThreadId: String
        public var citation: CitationAttachment?
        public var focusMessageId: String?
    }

    /// Builds the open + cite plan for a bot run. `messages` are the ones
    /// already loaded for the conversation target (the report card when this
    /// window holds it); a report not loaded is quoted from `run.output`.
    public static func continuePlan(
        for run: RoutineRun, bots: [Bot], messages: [Message] = [], threadsShown: Bool
    ) -> ContinuePlan? {
        guard let target = conversationTarget(for: run, bots: bots),
              let bot = bots.first(where: { $0.id == run.botId })
        else { return nil }
        let home = SingleStream.home(of: bot) ?? bot.threadId
        let composerThreadId = threadsShown ? target.threadId : home
        let report = reportMessage(for: run, in: messages)
        let raw = (report?.routineRun?.summary ?? run.output ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let quote: String = {
            guard !raw.isEmpty else { return "" }
            let ns = raw as NSString
            return ns.length > Citations.maxQuoteLength ? ns.substring(to: Citations.maxQuoteLength) : raw
        }()
        let messageId = report?.id ?? "routine-run:\(run.id)"
        var citation: CitationAttachment?
        if !quote.isEmpty {
            let selector = CitationTextSelector(
                text: quote, start: 0, end: Citations.jsLength(quote), prefix: "", suffix: ""
            )
            citation = Citations.attachment(
                source: CitationSource(
                    ownerType: .bot, ownerId: bot.id, threadId: target.threadId, messageId: messageId
                ),
                selector: selector
            )
        }
        return ContinuePlan(
            target: target,
            composerThreadId: composerThreadId,
            citation: citation,
            focusMessageId: report?.id
        )
    }

    /// One folder of the "Post results to" picker.
    public struct Group: Hashable, Sendable {
        /// The folder's name; nil for threads outside any folder.
        public var folder: String?
        public var threads: [BotTask]
    }

    /// `ResultsDestination`: the bot's own conversations (never a run's
    /// execution thread), by folder, the unfiled ones last.
    public static func groups(for bot: Bot?) -> [Group] {
        guard let bot else { return [] }
        let tasks = (bot.tasks ?? []).filter { !$0.isHiddenFromPerson }
        let projects = bot.projects ?? []
        var out: [Group] = projects.compactMap { project in
            let members = tasks.filter { $0.projectId == project.id }
            return members.isEmpty ? nil : Group(folder: project.name, threads: members)
        }
        let loose = tasks.filter { task in !projects.contains { $0.id == task.projectId } }
        if !loose.isEmpty { out.append(Group(folder: nil, threads: loose)) }
        return out
    }

    /// The chosen thread is no longer one of the bot's conversations.
    public static func isMissing(_ destination: RoutineResultsDestination, bot: Bot?) -> Bool {
        guard case let .thread(id) = destination else { return false }
        return !groups(for: bot).contains { $0.threads.contains { $0.threadId == id } }
    }
}

// MARK: - Team goal (AU14)

public enum RoutineTeamGoal {
    /// Rooms that can run a goal: not a direct conversation.
    public static func rooms(_ rooms: [Room]) -> [Room] {
        rooms.filter { $0.dm != true }
    }

    /// A room's members that can lead: its bots, not hidden.
    public static func members(of room: Room?, bots: [Bot]) -> [Bot] {
        guard let room else { return [] }
        return room.memberIds.compactMap { id in
            bots.first { $0.id == id && $0.hidden != true }
        }
    }

    /// `preferredRoomLead`: the current bot if it is a member, else the
    /// room's chosen responder, its chief of staff, or its first member.
    public static func preferredLead(of room: Room?, bots: [Bot], preferredId: String?) -> Bot? {
        let members = members(of: room, bots: bots)
        let explicit = room?.defaultResponder.kind == "member" ? room?.defaultResponder.botId : nil
        return members.first { $0.id == preferredId }
            ?? members.first { $0.id == explicit }
            ?? members.first { $0.chiefOfStaff == true }
            ?? members.first
    }
}

// MARK: - Calls

public extension CompanionClient {
    /// Stop a queued, running or waiting run (`POST /api/routine-runs/:id/cancel`).
    func cancelRoutineRun(id: String) async throws -> RoutineRun {
        try await send(try makeRequest("POST", "/api/routine-runs/\(id)/cancel"), as: RoutineRunResponse.self).run
    }

    /// Acknowledge one run (`POST /api/routine-runs/:id/seen`).
    func markRoutineRunSeen(id: String) async throws -> RoutineRun {
        try await send(try makeRequest("POST", "/api/routine-runs/\(id)/seen"), as: RoutineRunResponse.self).run
    }

    /// Clear one routine's run logs (`DELETE /api/routine-runs?routineId=`),
    /// the routine panel's Runs header; runs in progress are kept. The ids
    /// it removed.
    func clearRoutineRuns(routineId: String) async throws -> [String] {
        guard Self.validRouteID(routineId) else { throw APIError.badURL }
        let request = try makeRequest("DELETE", "/api/routine-runs", query: [
            URLQueryItem(name: "scope", value: "mine"), URLQueryItem(name: "routineId", value: routineId),
        ])
        return try await send(request, as: RoutineRunsCleared.self).removed
    }

    /// The run logs' Clear logs (`DELETE /api/routine-runs`, the store's
    /// `clearRoutineRuns`): every saved run the person may see; runs in
    /// progress are kept. The ids it removed.
    func clearAllRoutineRuns() async throws -> [String] {
        try await send(try makeRequest("DELETE", "/api/routine-runs"), as: RoutineRunsCleared.self).removed
    }

    /// "Mark all as read" (`POST /api/routine-runs/seen-all`): the ids of
    /// the runs it changed and their stamp.
    func markAllRoutineRunsSeen() async throws -> RoutineRunsSeen {
        try await send(try makeRequest("POST", "/api/routine-runs/seen-all"), as: RoutineRunsSeen.self)
    }
}

/// What Clear logs answers: the ids of the runs it removed.
public struct RoutineRunsCleared: Decodable, Sendable {
    public var removed: [String]
}

/// What "Mark all as read" answers: the ids it stamped, how many, and when.
public struct RoutineRunsSeen: Codable, Hashable, Sendable {
    public var ids: [String]
    public var count: Int
    public var seenAt: Double?

    public init(ids: [String] = [], count: Int = 0, seenAt: Double? = nil) {
        self.ids = ids
        self.count = count
        self.seenAt = seenAt
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ids = try container.decodeIfPresent([String].self, forKey: .ids) ?? []
        count = try container.decodeIfPresent(Int.self, forKey: .count) ?? ids.count
        seenAt = try container.decodeIfPresent(Double.self, forKey: .seenAt)
    }
}

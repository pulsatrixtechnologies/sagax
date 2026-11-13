// One background routine run, as the conversation that asked for it sees it.
//
// The computer upserts a single `routine.run` message per run into the
// source thread and patches it as the run moves from queued to its result
// (shared/routine-run.ts). The run itself happens in a separate execution
// thread that the thread list hides; this card is where its answer lands.
// Before this existed the phone drew only the message's one-line fallback,
// so a routine that wrote a whole report read as "Routine “X” completed".
import Foundation

public struct RoutineRunCard: Codable, Hashable, Sendable {
    public enum Status: String, Sendable {
        case queued, running, waiting, completed, failed, blocked, cancelled, missed
        case nothingToReport = "nothing_to_report"
    }

    public enum Tone: Sendable {
        case neutral, active, attention, danger
    }

    public var runId: String
    public var routineId: String
    public var routineName: String
    public var scheduledFor: Double?
    /// Kept as the raw string: a status added on the computer after this
    /// build shipped must still decode, and still read as something.
    public var status: String
    public var deferredAt: Double?
    public var goalStatus: String?
    public var executionThreadId: String?
    /// What the run said, already redacted and capped by the computer: the
    /// whole report, which "Details" opens.
    public var summary: String?
    /// #3581: the one or two lines the card shows, from the report's closing
    /// line (ReportBrief). Absent on cards stored before it: `briefText`
    /// reads the same function from `summary`.
    public var brief: String?
    public var error: String?
    /// This failure paused the routine after this many failed runs in a row
    /// (RoutineAutoPause); the passing notice offers Resume.
    public var autoPausedAfter: Int?
    /// 2026-11-01: completed, but not all of it went right (RoutineRun.problems).
    public var problems: String?
    /// 2026-11-04: the teammates this run handed work to, each with the
    /// thread that work runs in (shared/routine-run.ts handedTo).
    public var handedTo: [Handoff]
    /// #2694: the kind of wake this run was (heartbeat, mail, calendar,
    /// watch...); nil for a plain routine run.
    public var wakeTopic: String?
    /// #3423: the watches a watch wake reported, with their domain
    /// (`watches` of shared/routine-run.ts): the alert's two exits stop them.
    public var watches: [WatchRef]
    /// #3479: a lasting problem is one card whose count is patched in place.
    public var `repeat`: Repeat?
    /// #3479: the first run without problems after runs with problems.
    public var recovered: Recovered?
    /// When the run started, in epoch milliseconds (its elapsed time).
    public var startedAt: Double?
    /// The items only the person can do, as the report wrote them.
    public var attention: String?
    /// #3990: "person" when the person started this run (Run now): its card
    /// is theirs, and the chat draws it.
    public var startedBy: String?
    /// #3990: a wake's report the bot wrote for the person (it did not end
    /// with the nothing-to-report line); a wake's row without it leaves the
    /// chat (`RoutineRunRows.outOfChat`).
    public var forPerson: Bool

    /// The same problem, run after run, or (#3695, #3910) runs in a row that
    /// ended with problems, whatever they said.
    public struct Repeat: Codable, Hashable, Sendable {
        public var count: Int
        public var since: Double
        /// #3695: the one summary card of a routine's streak of problems.
        public var streak: Bool
        /// #3910: the runs in a row had problems, not one same problem.
        public var anyProblem: Bool
        /// #4201: the run the count started from (the desktop's `firstRunId`).
        public var firstRunId: String?

        /// How the card says it (the desktop's `routineRepeatText`).
        public enum Wording: Sendable { case sameProblem, problemStreak }
        public var wording: Wording { streak || anyProblem ? .problemStreak : .sameProblem }

        public init(count: Int, since: Double, streak: Bool = false, anyProblem: Bool = false, firstRunId: String? = nil) {
            self.count = count
            self.since = since
            self.streak = streak
            self.anyProblem = anyProblem
            self.firstRunId = firstRunId
        }

        private enum CodingKeys: String, CodingKey { case count, since, streak, anyProblem, firstRunId }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            count = try c.decode(Int.self, forKey: .count)
            since = try c.decode(Double.self, forKey: .since)
            streak = (try? c.decodeIfPresent(Bool.self, forKey: .streak)).flatMap { $0 } ?? false
            anyProblem = (try? c.decodeIfPresent(Bool.self, forKey: .anyProblem)).flatMap { $0 } ?? false
            firstRunId = (try? c.decodeIfPresent(String.self, forKey: .firstRunId)).flatMap { $0 }
        }
    }

    /// Works again after problems.
    public struct Recovered: Codable, Hashable, Sendable {
        public var since: Double
        /// #3990: the streak's own summary card, turned to works again.
        public var streak: Bool
        public init(since: Double, streak: Bool = false) {
            self.since = since
            self.streak = streak
        }

        private enum CodingKeys: String, CodingKey { case since, streak }

        public init(from decoder: any Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            since = try c.decode(Double.self, forKey: .since)
            streak = (try? c.decodeIfPresent(Bool.self, forKey: .streak)).flatMap { $0 } ?? false
        }
    }

    /// One watch an alert reported.
    public struct WatchRef: Codable, Hashable, Sendable {
        public var id: String
        public var domain: String
        public init(id: String, domain: String) {
            self.id = id
            self.domain = domain
        }
    }

    /// One teammate a run handed work to.
    public struct Handoff: Codable, Hashable, Sendable {
        public var botId: String
        public var threadId: String
        public var name: String?
        public var status: String
        public init(botId: String, threadId: String, name: String? = nil, status: String) {
            self.botId = botId
            self.threadId = threadId
            self.name = name
            self.status = status
        }
    }

    public init(
        runId: String, routineId: String, routineName: String, status: String,
        scheduledFor: Double? = nil, deferredAt: Double? = nil, goalStatus: String? = nil,
        executionThreadId: String? = nil, summary: String? = nil, error: String? = nil,
        autoPausedAfter: Int? = nil, problems: String? = nil, handedTo: [Handoff] = [],
        wakeTopic: String? = nil, watches: [WatchRef] = [], brief: String? = nil,
        repeat: Repeat? = nil, recovered: Recovered? = nil, startedAt: Double? = nil,
        startedBy: String? = nil, forPerson: Bool = false
    ) {
        self.runId = runId
        self.routineId = routineId
        self.routineName = routineName
        self.status = status
        self.scheduledFor = scheduledFor
        self.deferredAt = deferredAt
        self.goalStatus = goalStatus
        self.executionThreadId = executionThreadId
        self.summary = summary
        self.error = error
        self.autoPausedAfter = autoPausedAfter
        self.problems = problems
        self.handedTo = handedTo
        self.wakeTopic = wakeTopic
        self.watches = watches
        self.brief = brief
        self.repeat = `repeat`
        self.recovered = recovered
        self.startedAt = startedAt
        self.startedBy = startedBy
        self.forPerson = forPerson
    }

    private enum CodingKeys: String, CodingKey {
        case runId, routineId, routineName, scheduledFor, status, deferredAt
        case goalStatus, executionThreadId, summary, error, autoPausedAfter, problems, handedTo
        case wakeTopic, watches, brief, `repeat`, recovered, startedAt, attention, startedBy, forPerson
    }

    /// Field by field and forgiving: a card is a decoration on a message the
    /// phone can already draw from its text, so one odd field must cost that
    /// field, never the message — and a failed message decode costs the
    /// whole thread page it arrived in.
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        runId = (try? c.decodeIfPresent(String.self, forKey: .runId)) ?? ""
        routineId = (try? c.decodeIfPresent(String.self, forKey: .routineId)) ?? ""
        routineName = (try? c.decodeIfPresent(String.self, forKey: .routineName)) ?? ""
        scheduledFor = try? c.decodeIfPresent(Double.self, forKey: .scheduledFor)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? ""
        deferredAt = try? c.decodeIfPresent(Double.self, forKey: .deferredAt)
        goalStatus = try? c.decodeIfPresent(String.self, forKey: .goalStatus)
        executionThreadId = try? c.decodeIfPresent(String.self, forKey: .executionThreadId)
        summary = try? c.decodeIfPresent(String.self, forKey: .summary)
        error = try? c.decodeIfPresent(String.self, forKey: .error)
        autoPausedAfter = (try? c.decodeIfPresent(Int.self, forKey: .autoPausedAfter)).flatMap { $0 > 0 ? $0 : nil }
        let rawProblems = try? c.decodeIfPresent(String.self, forKey: .problems)
        problems = rawProblems.flatMap { $0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : $0 }
        handedTo = ((try? c.decodeIfPresent([Handoff].self, forKey: .handedTo)) ?? nil) ?? []
        wakeTopic = try? c.decodeIfPresent(String.self, forKey: .wakeTopic)
        watches = ((try? c.decodeIfPresent([Lossy<WatchRef>].self, forKey: .watches)) ?? nil)?.compactMap(\.value) ?? []
        brief = (try? c.decodeIfPresent(String.self, forKey: .brief)).flatMap { $0 }
        `repeat` = (try? c.decodeIfPresent(Repeat.self, forKey: .repeat)).flatMap { $0 }
        recovered = (try? c.decodeIfPresent(Recovered.self, forKey: .recovered)).flatMap { $0 }
        startedAt = (try? c.decodeIfPresent(Double.self, forKey: .startedAt)).flatMap { $0 }
        attention = (try? c.decodeIfPresent(String.self, forKey: .attention)).flatMap { $0 }
        startedBy = (try? c.decodeIfPresent(String.self, forKey: .startedBy)).flatMap { $0 }
        forPerson = (try? c.decodeIfPresent(Bool.self, forKey: .forPerson)).flatMap { $0 } ?? false
    }

    /// #3581: the card's one or two lines: the server's brief, or the same
    /// function read from the report of a card stored without one.
    public var briefText: String {
        if let brief = brief?.trimmingCharacters(in: .whitespacesAndNewlines), !brief.isEmpty { return brief }
        return ReportBrief.of(summary, from: .end)
    }

    /// "Paused after 5 failures in a row" when this failure paused its routine.
    public var autoPausedText: String? { autoPausedAfter.map(RoutineAutoPause.pausedText) }

    public var knownStatus: Status? { Status(rawValue: status) }

    /// Completed, but not all of it went right (desktop WITH_PROBLEMS).
    public var hasProblems: Bool { problems != nil }

    /// #3695: a repeating routine's one summary card of its streak of runs
    /// with problems (desktop `isProblemStreakCard`).
    public var isProblemStreak: Bool { `repeat`?.streak == true }

    /// #3695, #4066: a summary card whose latest run failed or was blocked
    /// (desktop `streakFailed`): its failure words are its brief, and its
    /// state line counts the runs in a row.
    public var isFailedStreak: Bool { isProblemStreak && goalStatus == nil && status != "completed" }

    /// #3479, #3695: the repeat a card's state line counts (desktop `repeat`
    /// of RoutineRunCard.tsx): a lasting problem of a completed run, or the
    /// streak's summary whatever its run said. Nil: the line counts nothing.
    public var countedRepeat: Repeat? {
        guard let lasting = `repeat`, lasting.count > 1,
              (status == "completed" && hasProblems) || lasting.streak else { return nil }
        return lasting
    }

    /// Still moving: the card will be patched again.
    public var isInFlight: Bool {
        goalStatus == nil && (knownStatus == .queued || knownStatus == .running)
    }

    public var isDeferred: Bool { knownStatus == .queued && deferredAt != nil }

    /// The computer's own wording (routineRunFallbackText), so the card, the
    /// roster and the desktop describe a run the same way. A room goal's
    /// outcome is the more exact fact and wins over the run's status.
    public var stateText: String {
        switch goalStatus {
        case "needs-input": return "needs your input"
        case "blocked": return "was blocked"
        case "limit-reached": return "reached its limit"
        case "stopped": return "was stopped"
        case "failed": return "failed"
        default: break
        }
        switch knownStatus {
        case .waiting: return "needs your attention"
        case .completed: return "completed"
        case .failed: return "failed"
        case .blocked: return "was blocked"
        case .cancelled: return "was cancelled"
        case .missed: return "was missed"
        case .nothingToReport: return "had nothing to report"
        case .queued: return deferredAt != nil ? "deferred: target busy" : "queued"
        case .running: return "running"
        case nil: return status
        }
    }

    /// The state as a pill label. 2026-11-04 / #2008: the desktop card's
    /// words (`routines.status.*`, `routines.goal.*`, `routineRun.card.done`),
    /// resolved through Localizable.xcstrings en + fr.
    public var stateLabel: String {
        if let goal = goalStatus, !goal.isEmpty {
            switch goal {
            case "completed": return String(localized: "Done")
            case "needs-input": return String(localized: "Needs your input")
            case "blocked": return String(localized: "Blocked")
            case "limit-reached": return String(localized: "Turn limit reached")
            case "paused": return String(localized: "Paused")
            case "stopped": return String(localized: "Stopped")
            case "failed": return String(localized: "Failed")
            default: break
            }
        }
        // Desktop: problems win over plain completed when there is no goal outcome.
        if hasProblems, knownStatus == .completed || status == "completed" {
            return String(localized: "Completed with problems")
        }
        if knownStatus == .queued, deferredAt != nil {
            return String(localized: "Deferred: target busy")
        }
        switch knownStatus {
        case .queued: return String(localized: "Queued")
        case .running: return String(localized: "Running")
        case .waiting: return String(localized: "Waiting")
        case .completed: return String(localized: "Done")
        case .failed: return String(localized: "Failed")
        case .blocked: return String(localized: "Blocked")
        case .cancelled: return String(localized: "Cancelled")
        case .missed: return String(localized: "Missed")
        case .nothingToReport: return String(localized: "Nothing to report")
        case nil:
            // A status added after this build: show it as written, title-cased.
            let text = status.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let first = text.first else { return "" }
            return String(first).uppercased() + text.dropFirst()
        }
    }

    public var tone: Tone {
        switch goalStatus {
        case "needs-input", "limit-reached", "paused": return .attention
        case "blocked", "failed": return .danger
        case "completed", "stopped": return .neutral
        default: break
        }
        if hasProblems, knownStatus == .completed || status == "completed" { return .attention }
        switch knownStatus {
        case .running: return .active
        case .waiting: return .attention
        case .queued: return deferredAt != nil ? .attention : .neutral
        case .failed, .missed, .blocked: return .danger
        case .completed, .cancelled, .nothingToReport, nil: return .neutral
        }
    }

    /// "Routine “Inbox sweep” completed", the sentence every surface opens with.
    public var headline: String {
        let name = routineName.isEmpty ? "Routine" : "Routine “\(routineName)”"
        let state = stateText
        return state.isEmpty ? name : "\(name) \(state)"
    }

    /// One line for a roster row, Updates, or Walkie: the headline, then the
    /// first thing the run actually said — which is why anyone set it up.
    public var previewLine: String {
        guard let first = summary?
            .split(whereSeparator: \.isNewline)
            .lazy
            .map({ $0.trimmingCharacters(in: .whitespaces) })
            .first(where: { !$0.isEmpty })
        else { return headline }
        return "\(headline): \(first)"
    }
}

public extension CompanionState {
    /// Where a routine card's "Open run" goes, or nil when this phone cannot
    /// go there. The execution thread is looked up among every bot's tasks —
    /// not `visibleTasks`, which hides run threads on purpose — so opening
    /// one never puts it back in the thread list. A run whose thread was
    /// deleted, or lives somewhere the phone has no route to, gets no button
    /// rather than a dead one.
    func routineExecutionRef(for card: RoutineRunCard) -> ThreadRef? {
        guard let threadId = card.executionThreadId, !threadId.isEmpty,
              let owner = bots.first(where: { $0.tasks?.contains { $0.threadId == threadId } == true })
        else { return nil }
        return ThreadRef(botId: owner.id, threadId: threadId, title: card.routineName)
    }
}

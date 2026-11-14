// "Edit routine", simplified (2026-10-29, desktop EventEditor): the summary
// line under the name, "Not saved" while a change waits, and the short
// summary beside "More options". The words are the app's; the rules (which
// parts show, in which order, what counts as a change) live here, tested.
import Foundation

public enum RoutineEditorRules {
    /// The line under the name: the schedule in words, where results go,
    /// whom it runs as. Empty parts are left out.
    /// "Every weekday at 9:00 AM · Results in the main thread · As Alex".
    public static func summary(schedule: String?, results: String?, runAs: String?) -> String {
        [schedule, results, runAs]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    /// Where results go, said in the summary: the bot's main thread, or the
    /// thread chosen (by its title), or the current one when kept.
    public enum ResultsPlace: Equatable, Sendable {
        case main
        case thread(String)
    }

    public static func resultsPlace(_ destination: RoutineResultsDestination, original: Routine?, threadTitle: (String) -> String?) -> ResultsPlace {
        let id: String?
        switch destination {
        case .newThread: id = nil
        case let .thread(chosen): id = chosen
        case .keep: id = original?.resultsThreadId
        }
        guard let id, let title = threadTitle(id), !title.isEmpty else { return .main }
        return .thread(title)
    }

    /// Beside "More options": the run limit, then overlap for a routine that
    /// repeats on the clock ("No time limit · Skip this occurrence").
    public enum MorePart: Equatable, Sendable {
        case noLimit
        case limit(minutes: Int)
        case overlapSkip
        case overlapQueue
    }

    public static func moreSummary(timeoutMinutes: Int?, overlap: String, recurrence: RoutineRecurrence) -> [MorePart] {
        var parts: [MorePart] = [timeoutMinutes.map { .limit(minutes: $0) } ?? .noLimit]
        if recurrence.repeatsOnClock { parts.append(overlap == "queue" ? .overlapQueue : .overlapSkip) }
        return parts
    }

    /// The choices of Repeat: "When a webhook arrives" for a bot routine,
    /// "When email arrives" only while the routine already starts that way,
    /// "Advanced" only for a schedule no choice can say, and "When
    /// something changes in a product" for a bot routine on a server linked
    /// to Perspicax (`productLinked`, GET /api/org) or a routine that already
    /// starts that way (the desktop's productTriggerOffered, #4250).
    public static func repeatChoices(current: RoutineRecurrence, teamGoal: Bool, productLinked: Bool = false) -> [RoutineRecurrence] {
        var choices: [RoutineRecurrence] = [.none, .hourly, .daily, .weekdays, .days, .monthly, .yearly, .interval]
        if current == .advanced { choices.append(.advanced) }
        if !teamGoal { choices.append(.webhook) }
        if current == .product || (!teamGoal && productLinked) { choices.append(.product) }
        if current == .email { choices.append(.email) }
        return choices
    }
}

/// Everything the editor holds, to tell a change from the state it opened
/// with: "Not saved" shows while they differ, and closing then asks first.
public struct RoutineEditorSnapshot: Equatable, Sendable {
    public var name: String
    public var prompt: String
    public var botId: String
    public var target: String
    public var groupId: String
    public var runOn: String
    public var form: RoutineScheduleForm
    public var durationMinutes: Int
    public var timeoutMinutes: Int?
    public var overlap: String
    public var results: RoutineResultsDestination
    public var attachmentIds: [String]
    public var runAs: String?
    public var onlyWhenPresent: Bool
    public var postResults: Bool
    public var deleteWhenFinished: Bool
    public var autoPauseAfter: Int
    public var continuity: Bool
    public var mailAlias: String
    /// "Only when something changes", compared as a whole.
    public var watch: RoutineWatchDraft

    public init(
        name: String, prompt: String, botId: String, target: String, groupId: String, runOn: String,
        form: RoutineScheduleForm, durationMinutes: Int, timeoutMinutes: Int?, overlap: String,
        results: RoutineResultsDestination, attachmentIds: [String], runAs: String?, onlyWhenPresent: Bool,
        postResults: Bool, deleteWhenFinished: Bool, autoPauseAfter: Int, continuity: Bool, mailAlias: String, watch: RoutineWatchDraft
    ) {
        self.name = name
        self.prompt = prompt
        self.botId = botId
        self.target = target
        self.groupId = groupId
        self.runOn = runOn
        self.form = form
        self.durationMinutes = durationMinutes
        self.timeoutMinutes = timeoutMinutes
        self.overlap = overlap
        self.results = results
        self.attachmentIds = attachmentIds
        self.runAs = runAs
        self.onlyWhenPresent = onlyWhenPresent
        self.postResults = postResults
        self.deleteWhenFinished = deleteWhenFinished
        self.autoPauseAfter = autoPauseAfter
        self.continuity = continuity
        self.mailAlias = mailAlias
        self.watch = watch
    }

    /// Changed since `opened`. The bot chosen on appear (a new routine
    /// opens before the bot list is read) is not a change of the person's.
    public func differs(from opened: RoutineEditorSnapshot) -> Bool {
        var base = opened
        if base.botId.isEmpty { base.botId = botId }
        return self != base
    }
}

public extension RoutineEditorRules {
    /// The routine page's one line (2026-10-29): what starts it, the next
    /// run (none for a webhook or an email) and the bot.
    static func pageSummary(trigger: String, nextRun: String?, bot: String?) -> String {
        summary(schedule: trigger, results: nextRun, runAs: bot)
    }

    /// Someone else's routine (or one the caller may not change) opens in
    /// the editor read only: fields off, no Save, titled "Routine".
    static func readOnly(_ routine: Routine?) -> Bool {
        routine.map { !$0.mayEdit } ?? false
    }
}

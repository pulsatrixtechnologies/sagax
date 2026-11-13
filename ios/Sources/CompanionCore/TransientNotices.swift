import Foundation

/// Notices the chat shows once, as a passing banner, never as a row (the
/// maintainer, 2026-10-26): a routine run that failed or was missed, and the
/// card saying a routine could not run on its owner's access. The banner
/// leaves on its own after a few seconds, when the person closes it, or
/// (access) once the routine has run again, and never comes back on reload.
/// The message stays stored: the failure stays in the routine's history, the
/// run's detail (View run) and the Updates inbox.
///
/// 2026-10-26: the failure that paused its routine (N failed runs in a row,
/// RoutineAutoPause) carries `routineRun.autoPausedAfter`: its banner says so
/// and offers Resume in one click.
///
/// #4058: the one summary of a routine's streak of problems
/// (`routineRun.repeat.streak`) is never one of these, even when its run
/// failed or paused the routine: it is the row the chat keeps until the
/// routine works again, and that same row then says so.
///
/// Same rules as the desktop's shared/transient-notices.ts:
/// TransientNoticesTests reads Fixtures/transient-notices.json, which
/// shared/transient-notices.test.ts keeps in step with that file.
public enum TransientNotices {
    public static let routineRunStatuses = ["failed", "missed"]
    public static let routineGoalStatuses = ["failed"]
    /// How long the banner stays when nobody closes it, in milliseconds.
    public static let visibleMs: Double = 8000
    /// Older than this when the chat first sees it: history, never shown.
    public static let freshMs: Double = 120_000

    /// #4058: the one summary of a routine's streak of problems: a row.
    public static func isRoutineStreakSummary(_ message: Message) -> Bool {
        message.kind == .routineRun && message.routineRun?.repeat?.streak == true
    }

    /// A routine run that failed or was missed, whatever its row.
    static func failedRoutineRun(_ message: Message) -> Bool {
        guard message.kind == .routineRun, let run = message.routineRun else { return false }
        if let goal = run.goalStatus, !goal.isEmpty { return routineGoalStatuses.contains(goal) }
        return routineRunStatuses.contains(run.status)
    }

    /// A run that paused its routine, whatever its row.
    static func autoPausedRoutineRun(_ message: Message) -> Bool {
        message.kind == .routineRun && (message.routineRun?.autoPausedAfter ?? 0) > 0
    }

    /// A routine run that failed or was missed (not a streak's summary).
    public static func isFailedRoutineRun(_ message: Message) -> Bool {
        failedRoutineRun(message) && !isRoutineStreakSummary(message)
    }

    /// The failure that paused its routine: the banner offers Resume (not a
    /// streak's summary).
    public static func isRoutineAutoPaused(_ message: Message) -> Bool {
        autoPausedRoutineRun(message) && !isRoutineStreakSummary(message)
    }

    public static func isRoutineAccess(_ message: Message) -> Bool {
        guard message.kind == .access, let access = message.access else { return false }
        return access.routine == true && access.reason != "routine_delegation"
    }

    /// True for a message the chat draws as a passing banner, never a row.
    public static func isTransient(_ message: Message) -> Bool {
        isFailedRoutineRun(message) || isRoutineAutoPaused(message) || isRoutineAccess(message)
    }

    /// A routine access notice is settled once the same bot's routine has
    /// run since without failing.
    public static func accessSettled(_ notice: Message, later: ArraySlice<Message>) -> Bool {
        let botId = notice.access?.botId
        return later.contains { message in
            message.at > notice.at && message.kind == .routineRun && message.routineRun != nil
                && !failedRoutineRun(message) && !autoPausedRoutineRun(message)
                && (botId == nil || message.from?.botId == nil || message.from?.botId == botId)
        }
    }

    public static func settled(_ notice: Message, in messages: [Message]) -> Bool {
        guard isRoutineAccess(notice), let index = messages.firstIndex(where: { $0.id == notice.id }) else { return false }
        return accessSettled(notice, later: messages[(index + 1)...])
    }

    /// The newest notice not shown yet that is still news. `now` and
    /// `Message.at` are epoch milliseconds.
    public static func pick(_ messages: [Message], now: Double, shown: Set<String>) -> Message? {
        for index in messages.indices.reversed() {
            let message = messages[index]
            guard isTransient(message), !shown.contains(message.id) else { continue }
            if now - message.at > freshMs { return nil }
            if isRoutineAccess(message), accessSettled(message, later: messages[(index + 1)...]) { continue }
            return message
        }
        return nil
    }
}

/// The ids already shown, kept across launches so a notice never comes back.
public struct TransientNoticeMemory {
    public static let key = "sagax.transientNotices.shown"
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var shown: Set<String> { Set(defaults.stringArray(forKey: Self.key) ?? []) }

    public func remember(_ id: String) {
        var list = defaults.stringArray(forKey: Self.key) ?? []
        guard !list.contains(id) else { return }
        list.append(id)
        defaults.set(Array(list.suffix(200)), forKey: Self.key)
    }
}

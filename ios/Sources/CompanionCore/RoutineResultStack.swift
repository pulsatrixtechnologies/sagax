// #3581: a routine's result is a compact card while it is the newest thing a
// routine said, or while it needs the person; once something newer says the
// same kind of thing, it folds into its one row, so a bot with 17 routines
// reporting in one hour fits one screen. The desktop's
// src/lib/routine-result-stack.ts and `routineRunForm`, read from the
// conversation's rows.
import Foundation

public enum RoutineResultStack {
    /// The two forms a run takes in the chat.
    public enum Form: String, Sendable {
        /// The compact card: a finished result with something to read, and
        /// any result that needs the person.
        case card
        /// The one quiet row: a run in progress, queued, waiting, failed,
        /// cancelled or with nothing to report, and a card a newer result folded.
        case row
    }

    private static let openGoal: Set<String> = ["needs-input", "blocked", "limit-reached", "paused", "failed"]

    /// A finished result: what the run had to say once it ended.
    public static func isResult(_ run: RoutineRunCard?) -> Bool {
        guard let run, run.status == "completed" || run.status == "nothing_to_report" else { return false }
        return run.goalStatus == nil || run.goalStatus == "completed"
    }

    /// The run's result needs the person: it completed with problems, it is
    /// blocked, a team goal waits on them, or its items are still open.
    public static func needsPerson(_ run: RoutineRunCard, attention: PersonAttentionCard?) -> Bool {
        if run.status == "completed" && run.hasProblems { return true }
        if run.status == "blocked" { return true }
        if let goal = run.goalStatus, openGoal.contains(goal) { return true }
        return openItems(attention)
    }

    private static func openItems(_ attention: PersonAttentionCard?) -> Bool {
        guard let attention else { return false }
        return !attention.items.isEmpty && attention.handledAt == nil
    }

    /// A row that breaks a stack of results: the person's message, or a
    /// bot's own answer (a text bubble). Steps, receipts and other runs do not.
    private static func breaksStack(_ row: Message) -> Bool {
        if row.role == .user { return true }
        guard row.kind == .text else { return false }
        return !(row.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Whether the result in `messageId` folds to its row:
    /// - one that needed the person folds when nothing is open any more (a
    ///   later run of the same routine works again, or its items were answered);
    /// - any other folds when a newer result follows it with no message of
    ///   the person and no answer of the bot between them.
    public static func folded(_ messages: [Message], messageId: String) -> Bool {
        guard let at = messages.firstIndex(where: { $0.id == messageId }),
              let run = messages[at].routineRun,
              isResult(run) || run.status == "blocked"
        else { return false }
        let later = messages[(at + 1)...]
        if needsPerson(run, attention: messages[at].attention) {
            if openItems(messages[at].attention) { return false }
            let problem = (run.status == "completed" && run.hasProblems) || run.status == "blocked"
            if !problem { return true }
            // a lasting problem stays a card until a later run of its routine works again
            return later.contains { row in
                guard let next = row.routineRun else { return false }
                return next.routineId == run.routineId && isResult(next) && !next.hasProblems
            }
        }
        for row in later {
            if row.kind == .routineRun, isResult(row.routineRun) { return true }
            if breaksStack(row) { return false }
        }
        return false
    }

    /// Every result of `messages` a newer one folds, in one pass per row.
    public static func foldedIds(_ messages: [Message]) -> Set<String> {
        Set(messages.filter { $0.kind == .routineRun && folded(messages, messageId: $0.id) }.map(\.id))
    }

    /// The form a run takes in the chat.
    public static func form(_ run: RoutineRunCard, attention: PersonAttentionCard?, folded: Bool) -> Form {
        // #3695, #4066: a repeating routine's one summary card is the one
        // thing its runs say in the chat: a card whatever its run's status,
        // so its count, since when and what is wrong are read whole
        if run.isProblemStreak { return .card }
        if folded { return .row }
        if needsPerson(run, attention: attention) { return .card }
        if !isResult(run) { return .row }
        return !run.briefText.isEmpty || run.recovered != nil || !run.handedTo.isEmpty ? .card : .row
    }
}

// #3581: the one rule for which turn of a chat is the live one, ported from
// the desktop's `src/lib/tool-liveness.ts` (`liveTurnIds`, `foldsLiveTurn`):
// this thread's own task is busy, the turn wrote a row since the turn
// started (a step or only notes), and it has no terminal or completed row
// yet. A failed or stopped turn is marked terminal too. The order of the
// rows does not matter: a message the person sends while the turn runs (a
// steer) leaves it live. The bot working somewhere else (a routine in
// another thread) never makes an old turn of this chat live.
import Foundation

public enum TurnLiveness {
    /// The busy stretch of one thread (desktop `LiveToolRun`).
    public struct Run: Hashable, Sendable {
        public var busy: Bool
        public var turnStartedAt: Double?
        public init(busy: Bool, turnStartedAt: Double?) {
            self.busy = busy
            self.turnStartedAt = turnStartedAt
        }
    }

    /// What the rule reads of a row (desktop `ToolRunMessage`).
    public struct Row: Hashable, Sendable {
        public var at: Double
        public var turnId: String?
        public var turnTerminal: Bool
        public var turnCompletedAt: Double?
        public init(at: Double, turnId: String? = nil, turnTerminal: Bool = false, turnCompletedAt: Double? = nil) {
            self.at = at
            self.turnId = turnId
            self.turnTerminal = turnTerminal
            self.turnCompletedAt = turnCompletedAt
        }

        public init(_ message: Message) {
            self.init(at: message.at, turnId: message.turnId, turnTerminal: message.turnTerminal == true)
        }

        var ended: Bool { turnTerminal || turnCompletedAt != nil }
    }

    /// The run of a bot's thread, as the desktop's `currentTaskBot` reads
    /// it: the thread's own task, busy while it says so (or while its
    /// activity is working or waiting on the person), from its own start.
    /// A thread with no task of its own has no start, so no live turn.
    public static func run(of bot: Bot?, threadId: String) -> Run? {
        guard let task = bot?.tasks?.first(where: { $0.threadId == threadId }) else { return nil }
        let busy = task.busy ?? (task.activity == "working" || task.activity == "waiting-on-you")
        return Run(busy: busy, turnStartedAt: task.turnStartedAt)
    }

    /// The turns still running (desktop `liveTurnIds`).
    public static func liveTurnIds(_ rows: [Row], run: Run?) -> Set<String> {
        guard let run, run.busy, let started = run.turnStartedAt, started.isFinite else { return [] }
        let completed = Set(rows.compactMap { $0.ended ? $0.turnId : nil })
        var ids = Set<String>()
        for row in rows {
            if let turn = row.turnId, row.at >= started, !completed.contains(turn) { ids.insert(turn) }
        }
        return ids
    }

    public static func liveTurnIds(_ messages: [Message], run: Run?) -> Set<String> {
        guard run?.busy == true else { return [] }
        return liveTurnIds(messages.map(Row.init), run: run)
    }

    /// Whether the rows a chat's step row folds belong to a live turn
    /// (desktop `foldsLiveTurn`).
    public static func foldsLiveTurn(_ rows: [Row], liveTurns: Set<String>) -> Bool {
        !liveTurns.isEmpty && rows.contains { $0.turnId.map(liveTurns.contains) ?? false }
    }

    public static func foldsLiveTurn(_ messages: [Message], liveTurns: Set<String>) -> Bool {
        !liveTurns.isEmpty && messages.contains { $0.turnId.map(liveTurns.contains) ?? false }
    }
}

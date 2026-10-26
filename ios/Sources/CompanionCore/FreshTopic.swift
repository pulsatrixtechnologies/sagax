// Fresh topic on return (one conversation per bot, threads hidden; JC
// 2026-10-18), the phone's copy of shared/fresh-topic.ts. Coming back to a
// bot after a while lands on a new, empty topic; the bot keeps the history
// (the server's "Earlier topics" digest and recall_topic). The topic is a
// draft until the first message creates it (POST .../tasks { stream: true }).
// Same cases as the desktop: shared/fresh-topic.vectors.json.
import Foundation

public enum FreshTopic {
    /// Settings, per person (the desktop's synced key of the same name).
    /// Hours as a decimal string; "0" never starts a fresh topic.
    public static let afterKey = "sagax.freshTopicAfter.v1"
    public static let defaultHours = 4
    /// The choices offered, in hours (0 = never).
    public static let choices = [1, 2, 4, 8, 24, 0]

    public static func parseAfter(_ value: String?) -> Int {
        guard let value, let hours = Int(value.trimmingCharacters(in: .whitespaces)), choices.contains(hours) else { return defaultHours }
        return hours
    }

    public static func afterMs(hours: Int) -> Double { Double(hours) * 3_600_000 }

    public enum Reason: String, Equatable, Sendable {
        case idle, away, never, noTopic = "no-topic", untouched, live, waiting, unread, seen, recent
    }

    public struct Decision: Equatable, Sendable {
        public let fresh: Bool
        public let reason: Reason
        public init(fresh: Bool, reason: Reason) {
            self.fresh = fresh
            self.reason = reason
        }
    }

    /// What the rule reads about the topic the bot opens to.
    public struct Topic: Equatable, Sendable {
        public var createdAt: Double
        public var updatedAt: Double?
        public var busy: Bool
        public var activity: String?
        public var unread: Bool
        public var waitingForTeammates: Bool
        public init(createdAt: Double, updatedAt: Double? = nil, busy: Bool = false, activity: String? = nil, unread: Bool = false, waitingForTeammates: Bool = false) {
            self.createdAt = createdAt
            self.updatedAt = updatedAt
            self.busy = busy
            self.activity = activity
            self.unread = unread
            self.waitingForTeammates = waitingForTeammates
        }

        public init(_ task: BotTask) {
            self.init(
                createdAt: task.createdAt, updatedAt: task.updatedAt, busy: task.busy == true,
                activity: task.activity, unread: task.unread == true, waitingForTeammates: task.waitingOnTeammate == true
            )
        }
    }

    /// Whether coming back lands on a fresh topic (shared/fresh-topic.ts
    /// `freshTopicOnReturn`, rule for rule).
    public static func onReturn(topic: Topic?, now: Double, afterMs: Double, leftAt: Double? = nil, queued: Bool = false) -> Decision {
        guard afterMs > 0 else { return Decision(fresh: false, reason: .never) }
        guard let topic else { return Decision(fresh: false, reason: .noTopic) }
        if topic.busy || topic.activity == "working" || topic.waitingForTeammates || queued { return Decision(fresh: false, reason: .live) }
        if topic.activity == "waiting-on-you" { return Decision(fresh: false, reason: .waiting) }
        if topic.unread { return Decision(fresh: false, reason: .unread) }
        guard let updated = topic.updatedAt, updated > topic.createdAt else { return Decision(fresh: false, reason: .untouched) }
        if let leftAt, now - leftAt <= afterMs {
            return Decision(fresh: false, reason: now - updated > afterMs ? .seen : .recent)
        }
        // Something happened there since they left: they see it first.
        if let leftAt, updated > leftAt { return Decision(fresh: false, reason: .unread) }
        if leftAt != nil { return Decision(fresh: true, reason: .away) }
        if now - updated > afterMs { return Decision(fresh: true, reason: .idle) }
        return Decision(fresh: false, reason: .recent)
    }

    /// Only a conversation a person had with the bot can be covered: never
    /// a routine run or its results thread, a hidden, confidential, bot-opened or parallel thread
    /// (shared/single-stream.ts `isStreamSegment`).
    public static func isSegment(_ task: BotTask) -> Bool {
        task.routineRunId == nil && task.routineResults != true && task.hidden != true && task.confidential != true && task.openedBy == nil && task.parallelOf == nil
    }
}

// Coding chat sheet decisions: footer actions, header copy, Changes band.
// Presentation-free twin of `src/components/coding/CodingChat.tsx` /
// Android `CodingChatRules`.
import Foundation

public enum CodingChatRules {
    public static let pollSeconds: TimeInterval = 3
    public static let followSeconds: TimeInterval = 30

    public static let continueLabel = "Continue"
    public static let stopLabel = "Stop"
    public static let closeLabel = "Close chat"
    public static let sendLabel = "Send"
    public static let loadOlder = "Show earlier messages"
    public static let loadingOlder = "Loading earlier messages"
    public static let empty = "Nothing to show for this task yet."
    public static let starting = "Starting the task"
    public static let working = "Working"
    public static let read = "Read"
    public static let changesNone = "No file changed yet"
    public static let editFailed = "This edit did not apply."
    public static let followUpError = "Couldn't send. Try again."
    public static let loadError = "Couldn't load this task."
    public static let retry = "Try again"
    public static let botFallback = "Bot"

    public static func followUpPlaceholder(botName: String) -> String {
        "Ask \(botName) to continue"
    }

    public static func aria(title: String) -> String {
        "Coding task: \(title)"
    }

    public static func statusLabel(_ status: BotActivityStatus) -> String {
        switch status {
        case .running: return "Running"
        case .waiting: return "Waiting for approval"
        case .queued: return "Queued"
        case .finished: return "Finished"
        case .failed: return "Failed"
        case .stopped: return "Stopped"
        }
    }

    public static func changesFilesLabel(_ count: Int) -> String {
        count == 1 ? "1 file changed" : "\(count) files changed"
    }

    public static func editFailedWhy(_ why: String) -> String {
        let first = why.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return "This edit did not apply: \(String(first.prefix(200)))"
    }

    public static func isLive(item: BotActivityItem, detail: BotActivityDetail?) -> Bool {
        (detail?.item.status ?? item.status).isActive
    }

    public static func canStop(item: BotActivityItem, detail: BotActivityDetail?, hasStopHandler: Bool) -> Bool {
        guard hasStopHandler else { return false }
        guard (detail?.item.status ?? item.status).isActive else { return false }
        return detail?.canStop ?? item.canStop ?? false
    }

    public static func canContinue(threadId: String?) -> Bool {
        !(threadId?.isEmpty ?? true)
    }

    public static func showChangesBand(files: [ChangedFile], tests: TestSummary?, place: CodingPlace) -> Bool {
        !files.isEmpty || tests != nil || place.pull != nil || place.commit != nil
    }

    public static func elapsedLabel(item: BotActivityItem, detail: BotActivityDetail?, nowMs: Double) -> String {
        let started = detail?.item.startedAt ?? item.startedAt
        let end = detail?.item.endedAt ?? item.endedAt ?? nowMs
        return BotActivityRules.duration(end - started)
    }

    public static func folderLine(_ place: CodingPlace) -> String? {
        place.folder ?? place.repo
    }

    public static func shortSha(_ sha: String) -> String {
        String(sha.prefix(7))
    }

    public static func pullLabel(number: Int?) -> String {
        if let number { return "Pull request #\(number)" }
        return "Pull request"
    }
}

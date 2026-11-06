// Coding chat sheet decisions: footer actions, header copy, Changes band.
// Presentation-free twin of `src/components/coding/CodingChat.tsx` /
// Android `CodingChatRules`. User-visible strings live in Localizable.xcstrings.
import Foundation

public enum CodingChatRules {
    public static let pollSeconds: TimeInterval = 3
    public static let followSeconds: TimeInterval = 30

    public static var continueLabel: String { String(localized: "Continue") }
    public static var stopLabel: String { String(localized: "Stop") }
    public static var closeLabel: String { String(localized: "Close chat") }
    public static var sendLabel: String { String(localized: "Send") }
    public static var loadOlder: String { String(localized: "Show earlier messages") }
    public static var loadingOlder: String { String(localized: "Loading earlier messages") }
    public static var empty: String { String(localized: "Nothing to show for this task yet.") }
    public static var starting: String { String(localized: "Starting the task") }
    public static var working: String { String(localized: "Working") }
    public static var read: String { String(localized: "Read") }
    public static var changesNone: String { String(localized: "No file changed yet") }
    public static var editFailed: String { String(localized: "This edit did not apply.") }
    public static var followUpError: String { String(localized: "Couldn't send. Try again.") }
    public static var loadError: String { String(localized: "Couldn't load this task.") }
    public static var retry: String { String(localized: "Try again") }
    public static var botFallback: String { String(localized: "Bot") }
    public static var cancelLabel: String { String(localized: "Cancel") }

    public static func followUpPlaceholder(botName: String) -> String {
        String(localized: "Ask \(botName) to continue")
    }

    public static func aria(title: String) -> String {
        String(localized: "Coding task: \(title)")
    }

    public static func statusLabel(_ status: BotActivityStatus) -> String {
        switch status {
        case .running: return String(localized: "Running")
        case .waiting: return String(localized: "Waiting for approval")
        case .queued: return String(localized: "Queued")
        case .finished: return String(localized: "Finished")
        case .failed: return String(localized: "Failed")
        case .stopped: return String(localized: "Stopped")
        }
    }

    public static func changesFilesLabel(_ count: Int) -> String {
        if count == 1 { return String(localized: "1 file changed") }
        return String(localized: "\(count) files changed")
    }

    public static func editFailedWhy(_ why: String) -> String {
        let first = why.split(separator: "\n", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        return String(localized: "This edit did not apply: \(String(first.prefix(200)))")
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
        if let number { return String(localized: "Pull request #\(number)") }
        return String(localized: "Pull request")
    }

    public static func testsPassedLabel(_ count: Int) -> String {
        String(localized: "\(count) passed")
    }

    public static func testsFailedLabel(_ count: Int) -> String {
        String(localized: "\(count) failed")
    }

    public static func testsSkippedLabel(_ count: Int) -> String {
        String(localized: "\(count) skipped")
    }

    public static var binaryFile: String { String(localized: "Binary file") }
    public static var noLineChanges: String { String(localized: "No line changes shown.") }
    public static func unchangedLines(_ count: Int) -> String {
        String(localized: "… \(count) unchanged lines")
    }
}

// MARK: - This session (#2285)

/// The bot panel's "This session" card (`SessionCard` in CodingChat.tsx):
/// status glyph and lead, duration, and the turn digests' tokens.
public enum CodingSessionRules {
    /// ○ while the task runs, ● once it settled.
    public static func glyph(live: Bool) -> String { live ? "○" : "●" }

    /// The current step while live (Working otherwise), the status once settled.
    public static func lead(item: BotActivityItem, detail: BotActivityDetail?) -> String {
        let shown = detail?.item ?? item
        guard shown.status.isActive else { return CodingChatRules.statusLabel(shown.status) }
        let step = shown.currentStep?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return step.isEmpty ? CodingChatRules.working : step
    }

    /// Sum of the turn digests' input plus output (`codingTokens`); nil when
    /// no turn reported usage yet.
    public static func tokens(_ messages: [Message]) -> Int? {
        var total = 0.0
        var any = false
        for message in messages {
            guard let usage = message.digest?.usage else { continue }
            any = true
            let input = usage.input.flatMap { $0.isFinite ? $0 : nil } ?? 0
            let output = usage.output.flatMap { $0.isFinite ? $0 : nil } ?? 0
            total += input + output
        }
        return any ? Int(total.rounded()) : nil
    }

    /// "12.4k", or nil when nothing worth showing (`tokensLabel`).
    public static func tokensLabel(_ messages: [Message]) -> String? {
        guard let tokens = tokens(messages), tokens > 0 else { return nil }
        return BotUsageTotal.formatTokens(tokens)
    }
}

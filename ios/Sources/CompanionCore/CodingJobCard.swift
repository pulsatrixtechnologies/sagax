// A coding job launched from a bot's chat stays in that chat as a card, like
// a routine run (#2148): running with Stop, then finished with its branch, a
// short result and the PR link. It never opens a thread.
// Twin of `src/lib/coding-job-card.ts`.
import Foundation

/// What the coding job card draws.
public struct CodingJobView: Hashable, Sendable {
    public var state: BotActivityStatus
    public var title: String
    public var branch: String?
    /// The short repo name ("marketplace"), never the full URL.
    public var repo: String?
    public var pr: CodingJobPull?
    public var result: String?
    public var currentStep: String?
    public var startedAt: Double
    public var endedAt: Double?

    public init(
        state: BotActivityStatus,
        title: String,
        branch: String? = nil,
        repo: String? = nil,
        pr: CodingJobPull? = nil,
        result: String? = nil,
        currentStep: String? = nil,
        startedAt: Double,
        endedAt: Double? = nil
    ) {
        self.state = state
        self.title = title
        self.branch = branch
        self.repo = repo
        self.pr = pr
        self.result = result
        self.currentStep = currentStep
        self.startedAt = startedAt
        self.endedAt = endedAt
    }
}

public struct CodingJobPull: Hashable, Sendable {
    public var number: Int?
    public var url: String

    public init(number: Int? = nil, url: String) {
        self.number = number
        self.url = url
    }
}

public enum CodingJobCard {
    /// A job is a coding job once it did code work (edits, branch, commits).
    public static func isCodingJob(_ item: BotActivityItem?) -> Bool {
        guard let item else { return false }
        return item.coding == true || item.code != nil
    }

    /// The short repo name: "owner/marketplace" or ".../marketplace.git" -> "marketplace".
    public static func shortRepoName(_ repo: String?) -> String? {
        guard var name = repo?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return nil }
        if name.hasSuffix(".git") { name = String(name.dropLast(4)) }
        while name.hasSuffix("/") || name.hasSuffix("\\") { name = String(name.dropLast()) }
        let parts = name.split { $0 == "/" || $0 == "\\" }.map(String.init)
        let last = parts.last?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return last.isEmpty ? nil : last
    }

    /// One short line of the bot's last words: whitespace folded, cut at `max`.
    public static func shortResult(_ text: String?, max: Int = 280) -> String? {
        guard var plain = text else { return nil }
        // Strip fenced code, headings and bold markers the way the desktop does.
        plain = plain.replacingOccurrences(of: "```[\\s\\S]*?```", with: " ", options: .regularExpression)
        if let heading = try? NSRegularExpression(pattern: "^#{1,6}\\s+", options: .anchorsMatchLines) {
            plain = heading.stringByReplacingMatches(in: plain, range: NSRange(plain.startIndex..., in: plain), withTemplate: "")
        }
        plain = plain.replacingOccurrences(of: "\\*\\*|__", with: "", options: .regularExpression)
        plain = plain.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !plain.isEmpty else { return nil }
        if plain.count <= max { return plain }
        let end = plain.index(plain.startIndex, offsetBy: max - 1)
        return plain[..<end].trimmingCharacters(in: .whitespacesAndNewlines) + "…"
    }

    /// The last text the bot wrote in the job's conversation.
    public static func lastBotText(_ messages: [Message]) -> String? {
        for message in messages.reversed() {
            guard message.role == .bot else { continue }
            guard message.kind == .text || message.kind == .unknown else { continue }
            if let text = message.text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty {
                return message.text
            }
        }
        return nil
    }

    public static func view(item: BotActivityItem, result: String? = nil) -> CodingJobView {
        let code = item.code
        let branchEntry = code?.branches.last
        let pull = code?.pullRequests.last
        return CodingJobView(
            state: item.status,
            title: item.title,
            branch: branchEntry?.name ?? code?.branch,
            repo: shortRepoName(branchEntry?.repo ?? code?.repo ?? code?.folder),
            pr: pull.flatMap { entry in
                guard let url = entry.url, !url.isEmpty else { return nil }
                return CodingJobPull(number: entry.number, url: url)
            },
            result: shortResult(result),
            currentStep: item.currentStep,
            startedAt: item.startedAt,
            endedAt: item.endedAt
        )
    }
}

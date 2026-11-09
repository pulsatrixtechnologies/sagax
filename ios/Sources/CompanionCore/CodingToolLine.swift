// The coding chat's tool rows as terminal lines (`ToolLine.tsx`,
// `toolLineOf` / `previewLines` / `isWaitCommand` in `src/lib/coding-chat.ts`):
//
//   ● Bash(pnpm test src/auth)        4s
//     ⎿ 4 passed
//       … +14 lines
//
// Pure text so the app draws it and the tests read it.
import Foundation

public struct CodingToolLine: Hashable, Sendable {
    public var name: String
    public var arg: String
    public var title: String?

    public init(name: String, arg: String, title: String? = nil) {
        self.name = name
        self.arg = arg
        self.title = title
    }
}

public enum CodingToolLines {
    private static func cut(_ text: String, _ max: Int) -> String {
        guard text.count > max else { return text }
        let head = String(text.prefix(Swift.max(1, max - 1))).trimmingCharacters(in: .whitespaces)
        return head + "\u{2026}"
    }

    private static func baseName(_ path: String) -> String {
        path.split(separator: "/").last.map(String.init) ?? path
    }

    private static let leadingCd = try! NSRegularExpression(pattern: #"^\s*cd\s+(?:'[^']*'|"[^"]*"|[^\s;&|]+)\s*(?:&&|;)\s*"#)
    private static let waitWord = try! NSRegularExpression(pattern: #"^(?:sleep|pgrep|pkill|wait|cd|true|:)(?:\s|$)"#)

    /// The command without its leading `cd <folder> && `, on one line, cut at `max`.
    public static func shortCommand(_ command: String, max: Int = 72) -> String {
        let range = NSRange(command.startIndex..., in: command)
        let stripped = leadingCd.stringByReplacingMatches(in: command, range: range, withTemplate: "")
        let body = stripped.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        let fallback = command.trimmingCharacters(in: .whitespacesAndNewlines)
        return cut(body.isEmpty ? fallback : body, max)
    }

    /// A command that only waits or looks (sleep, pgrep, a bare cd).
    public static func isWaitCommand(_ command: String) -> Bool {
        let parts = command
            .replacingOccurrences(of: "&&", with: "\u{1}")
            .replacingOccurrences(of: "||", with: "\u{1}")
            .replacingOccurrences(of: ";", with: "\u{1}")
            .replacingOccurrences(of: "|", with: "\u{1}")
            .split(separator: "\u{1}")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        guard !parts.isEmpty else { return false }
        return parts.allSatisfy { part in
            waitWord.firstMatch(in: part, range: NSRange(part.startIndex..., in: part)) != nil
        }
    }

    /// `Name(arg)` of a read, edit, command or other tool.
    public static func line(for step: CodingStep) -> CodingToolLine {
        switch step {
        case let .command(_, command, _, _, _, _, _, _):
            return CodingToolLine(name: "Bash", arg: shortCommand(command), title: command)
        case let .edit(_, files, _, _):
            let name = !files.isEmpty && files.allSatisfy { $0.status == .added } ? "Write" : "Edit"
            return pathsLine(name: name, paths: files.map(\.path))
        case let .read(_, paths):
            return pathsLine(name: "Read", paths: paths)
        case let .tool(_, tool):
            let name = tool.name.trimmingCharacters(in: .whitespaces)
            let target = (tool.summary ?? "").isEmpty ? nil : tool.summary
            return CodingToolLine(name: name.isEmpty ? "Tool" : name, arg: target.map { cut($0, 72) } ?? "", title: target)
        }
    }

    public static func readsLine(paths: [String]) -> CodingToolLine {
        pathsLine(name: "Read", paths: paths)
    }

    private static func pathsLine(name: String, paths: [String]) -> CodingToolLine {
        let arg = paths.count == 1 ? paths[0] : paths.map(baseName).joined(separator: ", ")
        return CodingToolLine(name: name, arg: cut(arg, 72), title: paths.joined(separator: "\n"))
    }

    /// The first `max` lines of a result and how many follow.
    public static func preview(_ output: String?, max: Int = 3) -> (lines: [String], more: Int) {
        guard let output else { return ([], 0) }
        let trimmed = output.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
        let all = trimmed.components(separatedBy: "\n")
        guard let start = all.firstIndex(where: { !$0.trimmingCharacters(in: .whitespaces).isEmpty }) else { return ([], 0) }
        let kept = Array(all[start...])
        return (kept.prefix(max).map { cut($0, 160) }, Swift.max(0, kept.count - max))
    }

    /// "4s", "1:05": a step's duration at the right of its first line.
    public static func duration(_ ms: Double?) -> String? {
        guard let ms, ms.isFinite, ms >= 0 else { return nil }
        if ms < 1000 { return "<1s" }
        let total = Int((ms / 1000).rounded())
        if total < 60 { return "\(total)s" }
        return "\(total / 60)m \(String(format: "%02d", total % 60))s"
    }
}

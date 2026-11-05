// Unified diff types and parser (`shared/code-runs.ts`), used by the coding
// chat. Pure and total: unknown lines are skipped, never thrown on.
import Foundation

public enum DiffLineKind: String, Codable, Hashable, Sendable {
    case ctx, add, del
}

public struct DiffLine: Hashable, Sendable {
    public var kind: DiffLineKind
    public var old: Int?
    public var new: Int?
    public var text: String

    public init(kind: DiffLineKind, old: Int? = nil, new: Int? = nil, text: String = "") {
        self.kind = kind
        self.old = old
        self.new = new
        self.text = text
    }
}

public struct DiffHunk: Hashable, Sendable {
    public var header: String
    public var lines: [DiffLine]

    public init(header: String = "", lines: [DiffLine] = []) {
        self.header = header
        self.lines = lines
    }
}

public enum DiffFileStatus: String, Codable, Hashable, Sendable {
    case added, modified, deleted, renamed
}

public struct DiffFile: Hashable, Sendable {
    public var path: String
    public var status: DiffFileStatus
    public var added: Int
    public var removed: Int
    public var hunks: [DiffHunk]
    public var binary: Bool?
    public var previewable: Bool?

    public init(
        path: String,
        status: DiffFileStatus = .modified,
        added: Int = 0,
        removed: Int = 0,
        hunks: [DiffHunk] = [],
        binary: Bool? = nil,
        previewable: Bool? = nil
    ) {
        self.path = path
        self.status = status
        self.added = added
        self.removed = removed
        self.hunks = hunks
        self.binary = binary
        self.previewable = previewable
    }
}

private let previewablePathPattern = try! NSRegularExpression(pattern: #"\.(?:md|markdown|mdx)$"#, options: .caseInsensitive)

/// Whether the Preview switch applies (Markdown; text only, never HTML).
public func previewablePath(_ path: String) -> Bool {
    let range = NSRange(path.startIndex..<path.endIndex, in: path)
    return previewablePathPattern.firstMatch(in: path, range: range) != nil
}

private let hunkPattern = try! NSRegularExpression(pattern: #"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$"#)

/// Parse a unified diff (`git diff base...HEAD`) into DiffView's files.
public func parseUnifiedDiff(_ text: String) -> [DiffFile] {
    struct MutableHunk {
        var header: String
        var lines: [DiffLine] = []
    }
    struct MutableFile {
        var path: String
        var status: DiffFileStatus = .modified
        var added = 0
        var removed = 0
        var hunks: [MutableHunk] = []
        var binary = false
    }

    var files: [MutableFile] = []
    var fileIndex: Int?
    var hunkIndex: Int?
    var oldLine = 0
    var newLine = 0

    func start(path: String) {
        files.append(MutableFile(path: path))
        fileIndex = files.count - 1
        hunkIndex = nil
    }

    for raw in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
        let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
        if line.hasPrefix("diff --git ") {
            let path: String
            if let bRange = line.range(of: " b/") {
                path = String(line[bRange.upperBound...])
            } else {
                path = String(line.dropFirst("diff --git ".count))
            }
            start(path: path)
            continue
        }
        guard let fi = fileIndex else { continue }
        if hunkIndex == nil {
            if line.hasPrefix("new file mode") {
                files[fi].status = .added
            } else if line.hasPrefix("deleted file mode") {
                files[fi].status = .deleted
            } else if line.hasPrefix("rename to ") {
                files[fi].status = .renamed
                files[fi].path = String(line.dropFirst("rename to ".count))
            } else if line.hasPrefix("Binary files ") {
                files[fi].binary = true
            } else if line.hasPrefix("+++ "), line != "+++ /dev/null" {
                var p = String(line.dropFirst(4))
                if p.hasPrefix("b/") { p = String(p.dropFirst(2)) }
                files[fi].path = p
            }
        }
        let ns = line as NSString
        if let match = hunkPattern.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)),
           match.numberOfRanges >= 4 {
            oldLine = Int(ns.substring(with: match.range(at: 1))) ?? 0
            newLine = Int(ns.substring(with: match.range(at: 3))) ?? 0
            files[fi].hunks.append(MutableHunk(header: line))
            hunkIndex = files[fi].hunks.count - 1
            continue
        }
        guard let hi = hunkIndex else { continue }
        if line.hasPrefix("+") {
            files[fi].hunks[hi].lines.append(DiffLine(kind: .add, new: newLine, text: String(line.dropFirst())))
            newLine += 1
            files[fi].added += 1
        } else if line.hasPrefix("-") {
            files[fi].hunks[hi].lines.append(DiffLine(kind: .del, old: oldLine, text: String(line.dropFirst())))
            oldLine += 1
            files[fi].removed += 1
        } else if line.hasPrefix(" ") || line.isEmpty {
            if line.isEmpty && raw.isEmpty { continue }
            files[fi].hunks[hi].lines.append(DiffLine(kind: .ctx, old: oldLine, new: newLine, text: String(line.dropFirst())))
            oldLine += 1
            newLine += 1
        }
    }

    return files.map { entry in
        DiffFile(
            path: entry.path,
            status: entry.status,
            added: entry.added,
            removed: entry.removed,
            hunks: entry.hunks.map { DiffHunk(header: $0.header, lines: $0.lines) },
            binary: entry.binary ? true : nil,
            previewable: !entry.binary && entry.status != .deleted && previewablePath(entry.path)
        )
    }
}

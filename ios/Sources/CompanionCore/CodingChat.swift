// Pure coding-chat reading of a task's thread (`src/lib/coding-chat.ts`).
// Paths never show whole; ids never reach a row's text.
import Foundation

// MARK: - Types

public struct CodingTool: Hashable, Sendable {
    public var name: String
    public var summary: String?
    public var input: String?
    public var output: String?
    public var ok: Bool?
    public var durationMs: Double?
    public var files: [String]?

    public init(
        name: String,
        summary: String? = nil,
        input: String? = nil,
        output: String? = nil,
        ok: Bool? = nil,
        durationMs: Double? = nil,
        files: [String]? = nil
    ) {
        self.name = name
        self.summary = summary
        self.input = input
        self.output = output
        self.ok = ok
        self.durationMs = durationMs
        self.files = files
    }
}

/// Lightweight message so coding rows do not depend on every Message.Kind.
public struct CodingMessage: Hashable, Sendable, Identifiable {
    public var id: String
    public var role: String
    public var kind: String
    public var text: String?
    public var at: Double
    public var tool: CodingTool?

    public init(id: String, role: String, kind: String, text: String? = nil, at: Double, tool: CodingTool? = nil) {
        self.id = id
        self.role = role
        self.kind = kind
        self.text = text
        self.at = at
        self.tool = tool
    }
}

public struct CodingChatTarget: Hashable, Sendable {
    public var botId: String
    /// `thread:<id>`, `run:<id>` or `cloud:<id>`
    public var itemId: String
    public var threadId: String?
    public var seed: BotActivityItem?

    public init(botId: String, itemId: String, threadId: String? = nil, seed: BotActivityItem? = nil) {
        self.botId = botId
        self.itemId = itemId
        self.threadId = threadId
        self.seed = seed
    }
}

public struct TestSummary: Hashable, Sendable {
    public var passed: Int
    public var failed: Int
    public var skipped: Int

    public init(passed: Int, failed: Int = 0, skipped: Int = 0) {
        self.passed = passed
        self.failed = failed
        self.skipped = skipped
    }
}

public enum CodingStep: Hashable, Sendable {
    case command(id: String, command: String, output: String?, exitCode: Int?, ok: Bool?, durationMs: Double?, tests: TestSummary?, diff: [DiffFile]?)
    case edit(id: String, files: [DiffFile], ok: Bool?, error: String?)
    case read(id: String, paths: [String])
    case tool(id: String, tool: CodingTool)

    public var id: String {
        switch self {
        case let .command(id, _, _, _, _, _, _, _): return id
        case let .edit(id, _, _, _): return id
        case let .read(id, _): return id
        case let .tool(id, _): return id
        }
    }
}

public enum CodingRow: Hashable, Sendable, Identifiable {
    case line(id: String, message: CodingMessage)
    case step(id: String, at: Double, step: CodingStep)
    case reads(id: String, at: Double, paths: [String], running: Bool)

    public var id: String {
        switch self {
        case let .line(id, _): return id
        case let .step(id, _, _): return id
        case let .reads(id, _, _, _): return id
        }
    }
}

public struct ChangedFile: Hashable, Sendable, Identifiable {
    public var path: String
    public var added: Int
    public var removed: Int
    public var rowId: String
    public var id: String { path }

    public init(path: String, added: Int, removed: Int, rowId: String) {
        self.path = path
        self.added = added
        self.removed = removed
        self.rowId = rowId
    }
}

public struct CodingPlace: Hashable, Sendable {
    public var folder: String?
    public var repo: String?
    public var branch: String?
    public var commit: BotCodeCommit?
    public var pull: BotCodePullRequest?

    public init(folder: String? = nil, repo: String? = nil, branch: String? = nil, commit: BotCodeCommit? = nil, pull: BotCodePullRequest? = nil) {
        self.folder = folder
        self.repo = repo
        self.branch = branch
        self.commit = commit
        self.pull = pull
    }
}

public extension ToolActivity {
    func toCodingTool() -> CodingTool {
        CodingTool(name: name, summary: summary, input: input, output: output, ok: ok, durationMs: durationMs, files: nil)
    }
}

public extension Message {
    func toCodingMessage() -> CodingMessage {
        let kindName: String
        switch kind {
        case .text: kindName = "text"
        case .options: kindName = "options"
        case .activity: kindName = "activity"
        case .screen: kindName = "screen"
        case .digest: kindName = "digest"
        case .compaction: kindName = "compaction"
        case .routineRun: kindName = "routine.run"
        default: kindName = "unknown"
        }
        return CodingMessage(
            id: id,
            role: role == .user ? "user" : "bot",
            kind: kindName,
            text: text,
            at: at,
            tool: tool?.toCodingTool()
        )
    }
}

// MARK: - Paths

private func norm(_ path: String) -> String {
    var p = path.replacingOccurrences(of: "\\", with: "/")
    while p.hasSuffix("/") { p = String(p.dropLast()) }
    return p
}

/// The folder's own name, never its path.
public func folderLabel(_ folder: String?) -> String? {
    guard let folder, !folder.isEmpty else { return nil }
    return norm(folder).split(separator: "/").filter { !$0.isEmpty }.last.map(String.init)
}

private let uuidOnly = try! NSRegularExpression(
    pattern: #"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"#,
    options: .caseInsensitive
)
private let uuidAnywhere = try! NSRegularExpression(
    pattern: #"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b"#,
    options: .caseInsensitive
)
private let absolutePath = try! NSRegularExpression(
    pattern: #"(?<![\w.~-])(?:/(?:workspace|workspaces|home|Users|root|srv|var|tmp|private|opt|data|mnt|app|repo|repos|code|src|builds?)(?:/[^\s'"`:;,()<>\[\]{}|]+)+)"#
)

/// A path as the sheet shows it: relative under the task's folder, else its last two segments.
public func shortPath(_ path: String, root: String? = nil) -> String {
    let clean = norm(path.trimmingCharacters(in: .whitespacesAndNewlines))
    if clean.isEmpty { return clean }
    if let root {
        let base = norm(root)
        if clean == base { return folderLabel(base) ?? clean }
        if clean.hasPrefix(base + "/") { return String(clean.dropFirst(base.count + 1)) }
    }
    let absolute = clean.hasPrefix("/")
        || clean.range(of: #"^[A-Za-z]:/"#, options: .regularExpression) != nil
        || clean.hasPrefix("~/")
    if !absolute {
        return clean.hasPrefix("./") ? String(clean.dropFirst(2)) : clean
    }
    let parts = clean.split(separator: "/").map(String.init).filter { part in
        guard !part.isEmpty else { return false }
        let range = NSRange(part.startIndex..<part.endIndex, in: part)
        return uuidOnly.firstMatch(in: part, range: range) == nil
    }
    if parts.count <= 2 { return parts.joined(separator: "/") }
    return "…/" + parts.suffix(2).joined(separator: "/")
}

/// A command line or its output with every server path cut down.
public func redactPaths(_ text: String, root: String? = nil) -> String {
    var out = text
    if let root {
        let base = norm(root)
        if base.count > 1 {
            let escaped = NSRegularExpression.escapedPattern(for: base)
            out = out.replacingOccurrences(of: escaped + "/", with: "", options: .regularExpression)
            out = out.replacingOccurrences(
                of: escaped + #"(?![\w/-])"#,
                with: folderLabel(base) ?? "",
                options: .regularExpression
            )
        }
    }
    let ns = out as NSString
    let matches = absolutePath.matches(in: out, range: NSRange(location: 0, length: ns.length))
    for match in matches.reversed() {
        let original = ns.substring(with: match.range)
        out = (out as NSString).replacingCharacters(in: match.range, with: shortPath(original))
    }
    let uuidRange = NSRange(out.startIndex..<out.endIndex, in: out)
    return uuidAnywhere.stringByReplacingMatches(in: out, range: uuidRange, withTemplate: "…")
}

// MARK: - Tool text

private func isRecord(_ value: Any?) -> [String: Any]? { value as? [String: Any] }

private func looseField(_ text: String, key: String) -> String? {
    let escaped = NSRegularExpression.escapedPattern(for: key)
    let realPattern = "\"\(escaped)\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)(\"?)"
    guard let regex = try? NSRegularExpression(pattern: realPattern, options: [.dotMatchesLineSeparators]) else {
        return nil
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    guard let match = regex.firstMatch(in: text, range: range), match.numberOfRanges >= 2 else { return nil }
    var body = (text as NSString).substring(with: match.range(at: 1))
    if body.hasSuffix("\\") { body = String(body.dropLast()) }
    let wrapped = "\"" + body + "\""
    if let data = wrapped.data(using: .utf8),
       let decoded = try? JSONSerialization.jsonObject(with: data) as? String {
        return decoded
    }
    return body
        .replacingOccurrences(of: "\\n", with: "\n")
        .replacingOccurrences(of: "\\t", with: "\t")
        .replacingOccurrences(of: "\\\"", with: "\"")
        .replacingOccurrences(of: "\\\\", with: "\\")
}

private let looseKeys = [
    "command", "cmd", "file_path", "path", "notebook_path", "old_string", "new_string",
    "content", "input", "patch", "output", "stdout", "stderr", "cwd",
]

/// The call's arguments (or result) as the server previewed them.
public func parseToolText(_ text: String?) -> Any? {
    guard let text else { return nil }
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard trimmed.range(of: #"^[\[{]"#, options: .regularExpression) != nil else { return text }
    if let data = trimmed.data(using: .utf8),
       let json = try? JSONSerialization.jsonObject(with: data) {
        return json
    }
    var body = trimmed
    if let range = body.range(of: #"\n?\[… preview shortened\]$"#, options: .regularExpression) {
        body.removeSubrange(range)
    }
    var loose: [String: Any] = [:]
    for key in looseKeys {
        if let value = looseField(body, key: key) { loose[key] = value }
    }
    if let exitRe = try? NSRegularExpression(pattern: #""(?:exitCode|exit_code)"\s*:\s*(-?\d+)"#),
       let match = exitRe.firstMatch(in: body, range: NSRange(body.startIndex..<body.endIndex, in: body)),
       match.numberOfRanges >= 2 {
        loose["exitCode"] = Int((body as NSString).substring(with: match.range(at: 1)))
    }
    return loose.isEmpty ? text : loose
}

private func str(_ value: Any?) -> String? {
    guard let s = value as? String, !s.isEmpty else { return nil }
    return s
}

private func unwrapShell(_ command: String) -> String {
    let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let re = try? NSRegularExpression(pattern: #"^(?:/(?:usr/)?bin/)?(?:bash|zsh|sh)\s+-l?c\s+(['"])([\s\S]*)\1\s*$"#),
          let match = re.firstMatch(in: trimmed, range: NSRange(trimmed.startIndex..<trimmed.endIndex, in: trimmed)),
          match.numberOfRanges >= 3 else {
        return trimmed
    }
    return (trimmed as NSString).substring(with: match.range(at: 2))
}

/// The shell command a call runs, whatever the engine.
public func commandOf(_ tool: CodingTool) -> String? {
    let input = parseToolText(tool.input)
    if let record = isRecord(input) {
        let raw = record["command"] ?? record["cmd"]
        if let words = raw as? [Any] {
            let list = words.compactMap { $0 as? String }
            if list.count >= 3,
               list[0].range(of: #"^(?:.*/)?(?:bash|zsh|sh)$"#, options: .regularExpression) != nil,
               list[1].range(of: #"^-l?c$"#, options: .regularExpression) != nil {
                return list.dropFirst(2).joined(separator: " ")
            }
            if !list.isEmpty { return list.joined(separator: " ") }
        }
        if let s = str(raw) { return unwrapShell(s) }
    }
    if let summary = tool.summary { return unwrapShell(summary) }
    if tool.name.range(of: #"\s"#, options: .regularExpression) != nil {
        return unwrapShell(tool.name)
    }
    return nil
}

/// The folder a call ran in, when it says (Codex `cwd`, a leading `cd`).
public func commandFolder(_ tool: CodingTool) -> String? {
    if let record = isRecord(parseToolText(tool.input)), let cwd = str(record["cwd"]) {
        return cwd
    }
    guard let command = commandOf(tool),
          let re = try? NSRegularExpression(pattern: #"^\s*cd\s+(['"]?)(/[^'"\s;&|]+)\1"#),
          let match = re.firstMatch(in: command, range: NSRange(command.startIndex..<command.endIndex, in: command)),
          match.numberOfRanges >= 3 else { return nil }
    return (command as NSString).substring(with: match.range(at: 2))
}

public struct CommandResult: Hashable, Sendable {
    public var output: String?
    public var exitCode: Int?
    public init(output: String? = nil, exitCode: Int? = nil) {
        self.output = output
        self.exitCode = exitCode
    }
}

/// A shell call's output and exit code.
public func commandResult(_ tool: CodingTool) -> CommandResult {
    guard let result = parseToolText(tool.output) else { return CommandResult() }
    if let s = result as? String { return CommandResult(output: s) }
    if let arr = result as? [Any] {
        let text = arr.compactMap { part -> String? in
            if let record = part as? [String: Any], let t = record["text"] as? String { return t }
            return part as? String
        }.joined(separator: "\n")
        return text.isEmpty ? CommandResult(output: tool.output) : CommandResult(output: text)
    }
    if let record = result as? [String: Any] {
        let output = [record["output"], record["stdout"], record["aggregatedOutput"], record["stderr"]]
            .compactMap { str($0) }
            .joined(separator: "\n")
        let exit = record["exitCode"] ?? record["exit_code"] ?? record["code"]
        let exitCode: Int?
        if let i = exit as? Int { exitCode = i }
        else if let d = exit as? Double { exitCode = Int(d) }
        else if let n = exit as? NSNumber { exitCode = n.intValue }
        else if let s = exit as? String { exitCode = Int(s) }
        else { exitCode = nil }
        if !output.isEmpty || exitCode != nil {
            return CommandResult(output: output.isEmpty ? nil : output, exitCode: exitCode)
        }
        if let content = record["content"] as? [Any],
           let data = try? JSONSerialization.data(withJSONObject: content),
           let encoded = String(data: data, encoding: .utf8) {
            return commandResult(CodingTool(name: tool.name, output: encoded))
        }
    }
    return CommandResult(output: tool.output)
}

// MARK: - Diffs

private let lcsMaxCells = 250_000

/// The lines two texts differ by, unchanged lines kept as context (LCS).
public func lineDiff(_ before: String, _ after: String) -> [DiffLine] {
    func split(_ text: String) -> [String] {
        if text.isEmpty { return [] }
        var t = text
        if t.hasSuffix("\n") { t = String(t.dropLast()) }
        return t.split(separator: "\n", omittingEmptySubsequences: false).map(String.init)
    }
    let a = split(before)
    let b = split(after)
    var out: [DiffLine] = []
    if a.count * b.count > lcsMaxCells {
        for (index, text) in a.enumerated() { out.append(DiffLine(kind: .del, old: index + 1, text: text)) }
        for (index, text) in b.enumerated() { out.append(DiffLine(kind: .add, new: index + 1, text: text)) }
        return out
    }
    let m = a.count
    let n = b.count
    var table = Array(repeating: Array(repeating: 0, count: n + 1), count: m + 1)
    for i in stride(from: m - 1, through: 0, by: -1) {
        for j in stride(from: n - 1, through: 0, by: -1) {
            table[i][j] = a[i] == b[j] ? table[i + 1][j + 1] + 1 : max(table[i + 1][j], table[i][j + 1])
        }
    }
    var i = 0
    var j = 0
    while i < m && j < n {
        if a[i] == b[j] {
            out.append(DiffLine(kind: .ctx, old: i + 1, new: j + 1, text: a[i]))
            i += 1; j += 1
        } else if table[i + 1][j] >= table[i][j + 1] {
            out.append(DiffLine(kind: .del, old: i + 1, text: a[i]))
            i += 1
        } else {
            out.append(DiffLine(kind: .add, new: j + 1, text: b[j]))
            j += 1
        }
    }
    while i < m { out.append(DiffLine(kind: .del, old: i + 1, text: a[i])); i += 1 }
    while j < n { out.append(DiffLine(kind: .add, new: j + 1, text: b[j])); j += 1 }
    return out
}

func codingFileOf(_ path: String, lines: [DiffLine], status: DiffFileStatus = .modified) -> DiffFile {
    DiffFile(
        path: path,
        status: status,
        added: lines.filter { $0.kind == .add }.count,
        removed: lines.filter { $0.kind == .del }.count,
        hunks: lines.isEmpty ? [] : [DiffHunk(header: "", lines: lines)]
    )
}

/// An apply_patch body into its files.
public func parseApplyPatch(_ text: String) -> [DiffFile] {
    guard text.range(of: #"\*\*\* (?:Begin Patch|Update File:|Add File:|Delete File:)"#, options: .regularExpression) != nil else {
        return []
    }
    var files: [DiffFile] = []
    var current: DiffFile?
    var lines: [DiffLine] = []
    func close() {
        guard var open = current else {
            lines = []
            return
        }
        open.hunks = lines.isEmpty ? [] : [DiffHunk(header: "", lines: lines)]
        open.added = lines.filter { $0.kind == .add }.count
        open.removed = lines.filter { $0.kind == .del }.count
        if let idx = files.indices.last { files[idx] = open }
        current = open
        lines = []
    }
    for line in text.split(separator: "\n", omittingEmptySubsequences: false).map(String.init) {
        if line.range(of: #"^\*\*\* (Update|Add|Delete) File: .+$"#, options: .regularExpression) != nil {
            close()
            let status: DiffFileStatus
            if line.hasPrefix("*** Add File:") { status = .added }
            else if line.hasPrefix("*** Delete File:") { status = .deleted }
            else { status = .modified }
            let path = line
                .replacingOccurrences(of: #"^\*\*\* (Update|Add|Delete) File: "#, with: "", options: .regularExpression)
                .trimmingCharacters(in: .whitespaces)
            let file = DiffFile(path: path, status: status)
            current = file
            files.append(file)
            continue
        }
        if line.hasPrefix("*** Move to: "), current != nil {
            let path = String(line.dropFirst("*** Move to: ".count)).trimmingCharacters(in: .whitespaces)
            current?.path = path
            current?.status = .renamed
            if let idx = files.indices.last, let current { files[idx] = current }
            continue
        }
        guard current != nil, !line.hasPrefix("***"), !line.hasPrefix("@@") else { continue }
        if line.hasPrefix("+") { lines.append(DiffLine(kind: .add, text: String(line.dropFirst()))) }
        else if line.hasPrefix("-") { lines.append(DiffLine(kind: .del, text: String(line.dropFirst()))) }
        else if line.hasPrefix(" ") { lines.append(DiffLine(kind: .ctx, text: String(line.dropFirst()))) }
    }
    close()
    return files
}

private func codexChange(_ change: [String: Any]) -> DiffFile? {
    guard let path = str(change["path"]) else { return nil }
    let kindEl = change["kind"]
    let kind: String?
    if let record = kindEl as? [String: Any] { kind = str(record["type"]) }
    else { kind = str(kindEl) }
    let diff = str(change["diff"]) ?? str(change["unified_diff"]) ?? ""
    let status: DiffFileStatus = kind == "add" ? .added : kind == "delete" ? .deleted : .modified
    if diff.range(of: #"^(?:diff --git|---|@@)"#, options: [.regularExpression]) != nil {
        let text = diff.hasPrefix("diff --git") ? diff : "diff --git a/\(path) b/\(path)\n\(diff)"
        if var parsed = parseUnifiedDiff(text).first {
            parsed.path = path
            if parsed.status == .modified { parsed.status = status }
            return parsed
        }
    }
    switch status {
    case .added: return codingFileOf(path, lines: lineDiff("", diff), status: .added)
    case .deleted: return codingFileOf(path, lines: lineDiff(diff, ""), status: .deleted)
    default: return codingFileOf(path, lines: [], status: status)
    }
}

/// The files a file-editing call changed, as diffs.
public func editFiles(_ tool: CodingTool, root: String? = nil) -> [DiffFile] {
    let input = parseToolText(tool.input)
    func short(_ path: String) -> String { shortPath(path, root: root) }
    if let arr = input as? [Any] {
        return arr.compactMap { ($0 as? [String: Any]).flatMap(codexChange) }.map {
            var f = $0; f.path = short(f.path); return f
        }
    }
    if let s = input as? String {
        return parseApplyPatch(s).map { var f = $0; f.path = short(f.path); return f }
    }
    guard let record = input as? [String: Any] else { return [] }
    if let changes = record["changes"] as? [Any],
       let data = try? JSONSerialization.data(withJSONObject: changes),
       let encoded = String(data: data, encoding: .utf8) {
        return editFiles(CodingTool(name: tool.name, input: encoded), root: root)
    }
    if let changes = record["changes"] as? [String: Any] {
        return changes.flatMap { path, value -> [DiffFile] in
            guard let value = value as? [String: Any], let kindName = value.keys.first else { return [] }
            let body = value[kindName] as? [String: Any] ?? [:]
            guard var change = codexChange([
                "path": path,
                "kind": kindName,
                "diff": str(body["unified_diff"]) ?? str(body["content"]) ?? "",
            ]) else { return [] }
            change.path = short(change.path)
            return [change]
        }
    }
    let patch = str(record["patch"]) ?? str(record["input"])
    if let patch, patch.range(of: #"\*\*\* Begin Patch"#, options: .regularExpression) != nil {
        return parseApplyPatch(patch).map { var f = $0; f.path = short(f.path); return f }
    }
    if let patch, patch.range(of: #"^(?:diff --git|@@)"#, options: .regularExpression) != nil {
        return parseUnifiedDiff(patch).map { var f = $0; f.path = short(f.path); return f }
    }
    guard let path = str(record["file_path"]) ?? str(record["path"]) ?? str(record["notebook_path"]) ?? str(record["target_file"]) else {
        return []
    }
    if let edits = record["edits"] as? [Any] {
        let lines = edits.flatMap { edit -> [DiffLine] in
            guard let edit = edit as? [String: Any] else { return [] }
            return lineDiff(str(edit["old_string"]) ?? "", str(edit["new_string"]) ?? "")
        }
        return [codingFileOf(short(path), lines: lines)]
    }
    if record["old_string"] is String || record["new_string"] is String {
        return [codingFileOf(short(path), lines: lineDiff(str(record["old_string"]) ?? "", str(record["new_string"]) ?? ""))]
    }
    if let content = str(record["content"]) ?? str(record["file_text"]) {
        return [codingFileOf(short(path), lines: lineDiff("", content), status: .added)]
    }
    return []
}

// MARK: - Tests

private func num(_ value: String?) -> Int { value.flatMap(Int.init) ?? 0 }

private func firstGroup(_ text: String, pattern: String) -> String? {
    guard let re = try? NSRegularExpression(pattern: pattern, options: .anchorsMatchLines),
          let match = re.firstMatch(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text)),
          match.numberOfRanges >= 2 else { return nil }
    return (text as NSString).substring(with: match.range(at: 1))
}

/// A test run's counts, read off its output; nil when it is not one.
public func testSummary(_ output: String?) -> TestSummary? {
    guard let output else { return nil }
    let esc = String(UnicodeScalar(0x1B)!)
    let text = output.replacingOccurrences(of: esc + #"\[[0-9;]*m"#, with: "", options: .regularExpression)

    if let part = firstGroup(text, pattern: #"^\s*Tests\s+(.+?)\s*\(\d+\)\s*$"#) {
        return TestSummary(
            passed: num(firstGroup(part, pattern: #"(\d+) passed"#)),
            failed: num(firstGroup(part, pattern: #"(\d+) failed"#)),
            skipped: num(firstGroup(part, pattern: #"(\d+) (?:skipped|todo)"#))
        )
    }
    if let part = firstGroup(text, pattern: #"^\s*Tests:\s+(.+?total)\s*$"#) {
        return TestSummary(
            passed: num(firstGroup(part, pattern: #"(\d+) passed"#)),
            failed: num(firstGroup(part, pattern: #"(\d+) failed"#)),
            skipped: num(firstGroup(part, pattern: #"(\d+) skipped"#))
        )
    }
    if let part = firstGroup(text, pattern: #"^=+ (.*\b(?:passed|failed|error)\b.*) in [\d.]+s(?: \([^)]*\))? =+$"#) {
        return TestSummary(
            passed: num(firstGroup(part, pattern: #"(\d+) passed"#)),
            failed: num(firstGroup(part, pattern: #"(\d+) failed"#)) + num(firstGroup(part, pattern: #"(\d+) errors?"#)),
            skipped: num(firstGroup(part, pattern: #"(\d+) skipped"#))
        )
    }
    if let re = try? NSRegularExpression(pattern: #"test result: \w+\. (\d+) passed; (\d+) failed; (\d+) ignored"#) {
        let matches = re.matches(in: text, range: NSRange(text.startIndex..<text.endIndex, in: text))
        if !matches.isEmpty {
            return matches.reduce(TestSummary(passed: 0, failed: 0, skipped: 0)) { sum, match in
                let ns = text as NSString
                return TestSummary(
                    passed: sum.passed + num(ns.substring(with: match.range(at: 1))),
                    failed: sum.failed + num(ns.substring(with: match.range(at: 2))),
                    skipped: sum.skipped + num(ns.substring(with: match.range(at: 3)))
                )
            }
        }
    }
    if let pass = firstGroup(text, pattern: #"^# pass (\d+)$"#) {
        return TestSummary(
            passed: num(pass),
            failed: num(firstGroup(text, pattern: #"^# fail (\d+)$"#)),
            skipped: num(firstGroup(text, pattern: #"^# skip(?:ped)? (\d+)$"#))
        )
    }
    if let pass = firstGroup(text, pattern: #"^\s*(\d+) passing\b"#) {
        return TestSummary(
            passed: num(pass),
            failed: num(firstGroup(text, pattern: #"^\s*(\d+) failing\b"#)),
            skipped: num(firstGroup(text, pattern: #"^\s*(\d+) pending\b"#))
        )
    }
    let range = NSRange(text.startIndex..<text.endIndex, in: text)
    let goOk = (try? NSRegularExpression(pattern: #"^ok\s+\S+\s+[\d.]+s"#, options: .anchorsMatchLines))?
        .numberOfMatches(in: text, range: range) ?? 0
    let goFailNamed = (try? NSRegularExpression(pattern: #"^--- FAIL: "#, options: .anchorsMatchLines))?
        .numberOfMatches(in: text, range: range) ?? 0
    let goFailLine = (try? NSRegularExpression(pattern: #"^FAIL\s+\S+\s+[\d.]+s"#, options: .anchorsMatchLines))?
        .numberOfMatches(in: text, range: range) ?? 0
    let goFail = goFailNamed > 0 ? goFailNamed : goFailLine
    if goOk > 0 || goFail > 0 { return TestSummary(passed: goOk, failed: goFail, skipped: 0) }
    return nil
}

// MARK: - Rows

public enum CodingStepKind: String, Sendable {
    case command, edit, read, tool
}

/// Classify a coding tool via the shared `workingStepFor` table so unusual
/// engine names (ACP titles, Codex shell aliases, connector MCP tools) map
/// to terminal / diff / read chips instead of a plain tool chip.
public func stepKindOf(_ tool: CodingTool) -> CodingStepKind {
    let step = workingStepFor(WorkingStepCall(name: tool.name, summary: tool.summary, input: tool.input))
    let bare = tool.name.replacingOccurrences(of: #"^mcp__.+?__"#, with: "", options: .regularExpression).lowercased()
    if bare.range(of: #"^(apply_patch|filechange|file_change)$"#, options: .regularExpression) != nil {
        return .edit
    }
    if step?.key == "run", commandOf(tool) != nil { return .command }
    if step?.key == "editFile" || step?.key == "writeFile" { return .edit }
    if step?.key == "readFile" { return .read }
    return .tool
}

private func readPaths(_ tool: CodingTool, root: String?) -> [String] {
    if let record = isRecord(parseToolText(tool.input)) {
        if let path = str(record["file_path"]) ?? str(record["path"]) ?? str(record["notebook_path"])
            ?? str(record["absolute_path"]) ?? str(record["filename"]) {
            return [shortPath(path, root: root)]
        }
        if let paths = record["paths"] as? [Any] {
            return paths.compactMap { ($0 as? String).map { shortPath($0, root: root) } }
        }
    }
    if let files = tool.files, !files.isEmpty {
        return files.map { shortPath($0, root: root) }
    }
    let parts = tool.name.split(whereSeparator: \.isWhitespace).map(String.init)
    if parts.count == 2 { return [shortPath(parts[1], root: root)] }
    return []
}

/// One tool call as a coding step.
public func codingStep(id: String, tool: CodingTool, root: String? = nil) -> CodingStep {
    let kind = stepKindOf(tool)
    if kind == .command, let raw = commandOf(tool) {
        let command = redactPaths(raw, root: root)
        let result = commandResult(tool)
        let shown = result.output.map { redactPaths($0, root: root) }
        var diff: [DiffFile]?
        if raw.range(of: #"^\s*(?:cd\s+\S+\s*&&\s*)?git\s+(?:diff|show)\b"#, options: .regularExpression) != nil,
           let output = result.output,
           output.contains("diff --git ") {
            let parsed = parseUnifiedDiff(output).map { file -> DiffFile in
                var f = file
                f.path = shortPath(f.path, root: root)
                return f
            }
            diff = parsed.isEmpty ? nil : parsed
        }
        let ok = tool.ok.map { $0 && (result.exitCode == nil || result.exitCode == 0) }
        return .command(
            id: id,
            command: command,
            output: shown,
            exitCode: result.exitCode,
            ok: ok,
            durationMs: tool.durationMs,
            tests: testSummary(result.output),
            diff: diff
        )
    }
    if kind == .edit {
        var files = editFiles(tool, root: root)
        if files.isEmpty, let listed = tool.files, !listed.isEmpty {
            files = listed.map { codingFileOf(shortPath($0, root: root), lines: []) }
        }
        if !files.isEmpty {
            let error: String?
            if tool.ok == false, tool.output != nil {
                error = redactPaths(commandResult(tool).output ?? tool.output ?? "", root: root)
            } else {
                error = nil
            }
            return .edit(id: id, files: files, ok: tool.ok, error: error)
        }
    }
    if kind == .read {
        let paths = readPaths(tool, root: root)
        if !paths.isEmpty { return .read(id: id, paths: paths) }
    }
    var shown = tool
    if let summary = tool.summary {
        shown.summary = redactPaths(summary, root: root)
    }
    return .tool(id: id, tool: shown)
}

/// The task's folder: the activity entry's repository folder, else the first folder a call named.
public func codingRoot(_ messages: [CodingMessage], code: BotCodeWork? = nil) -> String? {
    if let folder = code?.folder { return folder }
    for message in messages {
        guard let tool = message.tool else { continue }
        if let folder = commandFolder(tool) { return folder }
    }
    return nil
}

public func codingRoot(from messages: [Message], code: BotCodeWork? = nil) -> String? {
    codingRoot(messages.map { $0.toCodingMessage() }, code: code)
}

private func isLine(_ message: CodingMessage) -> Bool {
    if message.kind == "activity" || message.kind == "digest" || message.kind == "compaction" { return false }
    return !(message.text?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
}

/// The transcript as the coding chat draws it.
public func codingRows(_ messages: [CodingMessage], root: String? = nil) -> [CodingRow] {
    var rows: [CodingRow] = []
    for message in messages {
        if let tool = message.tool, message.kind == "activity" {
            let step = codingStep(id: message.id, tool: tool, root: root)
            if case let .read(_, paths) = step {
                if case .reads(let rid, let rat, var existing, _) = rows.last {
                    for path in paths where !existing.contains(path) { existing.append(path) }
                    rows[rows.count - 1] = .reads(id: rid, at: rat, paths: existing, running: tool.ok == nil)
                } else {
                    rows.append(.reads(id: message.id, at: message.at, paths: paths, running: tool.ok == nil))
                }
                continue
            }
            rows.append(.step(id: message.id, at: message.at, step: step))
            continue
        }
        if isLine(message) {
            rows.append(.line(id: message.id, message: message))
        }
    }
    return rows
}

public func codingRows(from messages: [Message], root: String? = nil) -> [CodingRow] {
    codingRows(messages.map { $0.toCodingMessage() }, root: root)
}

/// A task the viewer may not read the thread of: its steps alone.
public func stepMessages(_ steps: [BotActivityStep], botId: String, botName: String) -> [CodingMessage] {
    _ = (botId, botName)
    return steps.enumerated().map { index, step in
        CodingMessage(
            id: "step-\(index)",
            role: "bot",
            kind: "activity",
            text: "",
            at: step.at,
            tool: CodingTool(
                name: step.name,
                summary: step.summary,
                input: step.input,
                output: step.error,
                ok: step.ok,
                files: step.files
            )
        )
    }
}

/// Every file the task changed, edits of one file summed, in first-touch order.
public func changedFiles(_ rows: [CodingRow]) -> [ChangedFile] {
    var byPath: [String: ChangedFile] = [:]
    var order: [String] = []
    for row in rows {
        guard case let .step(id, _, step) = row else { continue }
        let files: [DiffFile]
        if case let .edit(_, editFiles, ok, _) = step, ok != false {
            files = editFiles
        } else {
            files = []
        }
        for file in files {
            if var known = byPath[file.path] {
                known.added += file.added
                known.removed += file.removed
                known.rowId = id
                byPath[file.path] = known
            } else {
                byPath[file.path] = ChangedFile(path: file.path, added: file.added, removed: file.removed, rowId: id)
                order.append(file.path)
            }
        }
    }
    return order.compactMap { byPath[$0] }
}

/// The newest test run of the task.
public func latestTests(_ rows: [CodingRow]) -> TestSummary? {
    for row in rows.reversed() {
        if case let .step(_, _, step) = row,
           case let .command(_, _, _, _, _, _, tests, _) = step,
           let tests {
            return tests
        }
    }
    return nil
}

/// What the header and the Changes band say of the task's code.
public func codingPlace(code: BotCodeWork?, root: String? = nil) -> CodingPlace {
    let folder = folderLabel(code?.folder ?? root)
    let pull = code?.pullRequests.first
    let commit = code?.commits.first
    return CodingPlace(
        folder: folder,
        repo: code?.repo,
        branch: code?.branch ?? commit?.branch ?? code?.branches.first?.name,
        commit: commit,
        pull: pull
    )
}

public func codingPlace(detail: BotActivityDetail?, root: String? = nil) -> CodingPlace {
    codingPlace(code: detail?.item.code, root: root)
}

/// The extension's grammar for the syntax colours.
public func languageOf(path: String) -> String {
    let name = path.split(separator: "/").last.map { String($0).lowercased() } ?? ""
    if name == "dockerfile" { return "dockerfile" }
    if name == "makefile" { return "makefile" }
    let ext = name.contains(".") ? String(name.split(separator: ".").last ?? "") : ""
    let map: [String: String] = [
        "mjs": "javascript", "cjs": "javascript", "mts": "typescript", "cts": "typescript",
        "h": "c", "hpp": "cpp", "hh": "cpp", "jsonl": "json", "yml": "yaml", "zsh": "bash", "env": "bash",
    ]
    return map[ext] ?? ext
}

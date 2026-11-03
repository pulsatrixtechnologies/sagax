// Memory > Import (desktop src/lib/memory-import.ts, src/lib/zip-read.ts and
// shared/obsidian-import.ts, 2026-11-03): an Obsidian vault read from a
// picked folder or a .zip, planned (the dry run the window previews), then
// written where the person chose:
//   - a bot's memory: POST /api/bots/<id>/memory/import in batches (the
//     server checks every file again, journals each one, skips what is
//     already there word for word);
//   - a Perspicax tier: one note at a time through the person's own
//     Perspicax proxy (/api/me/memory/entry), whose gate refuses a secret.
// The import can be stopped between two writes; run again, it skips what
// the first run wrote.
//
// The rules of the plan are the desktop's, none optional:
//   - a path is relative to the vault, with no `..`, `.`, empty, absolute,
//     drive-letter, backslash or control-character segment;
//   - `.obsidian/` and `.trash/` are left out when asked, every other hidden
//     folder or file always;
//   - a file that looks like a secret is never read into a note: a key
//     store or env file by its name, a note whose text holds a credential by
//     the shared secret filter plus the shapes Perspicax's gate refuses.
//     Each one is reported, never its value;
//   - sizes are capped; Perspicax tiers follow the gateway's entry rules; a
//     bot's memory is flat (memory/<name>.md), attachments go to
//     memory-attachments/ in its workspace.
import Compression
import Foundation

// MARK: - Types

public enum VaultLimits {
    /// Files read from one vault (notes, attachments and the rest).
    public static let files = 5_000
    /// One note's text.
    public static let noteBytes = 1_000_000
    /// One image or PDF.
    public static let attachmentBytes = 10 * 1024 * 1024
    /// Everything read from the vault.
    public static let totalBytes = 200 * 1024 * 1024
}

public enum VaultConflict: String, CaseIterable, Hashable, Sendable {
    case skip, rename, overwrite
}

public enum VaultDestination: String, Hashable, Sendable {
    case bot, perspicax
}

public struct VaultImportOptions: Equatable, Sendable {
    /// Keep the vault's folders (as Perspicax topics, as a bot file's prefix).
    public var keepStructure = true
    /// [[wikilinks]] point at the imported notes' titles.
    public var wikilinks = true
    /// #tags and the front matter's tags become tags.
    public var tags = true
    /// The front matter stays at the top of the note.
    public var properties = true
    /// Images and PDFs embedded with ![[...]] are copied.
    public var attachments = true
    /// .obsidian/ and .trash/ are left out.
    public var skipSystem = true
    public var conflict: VaultConflict = .skip

    public init() {}

    public static let `default` = VaultImportOptions()
}

public struct VaultFile: Hashable, Sendable {
    /// Relative to the vault's root, `/` separated.
    public var path: String
    public var size: Int
    /// A note's text (attachments and other files carry none).
    public var text: String?

    public init(path: String, size: Int, text: String? = nil) {
        self.path = path
        self.size = size
        self.text = text
    }
}

/// A note already in the destination: what a conflict is decided against.
public struct VaultExistingNote: Hashable, Sendable {
    public var folder: String
    public var title: String
    public var body: String?
    /// Perspicax entry id (an overwrite), or a bot's file path.
    public var id: String?

    public init(folder: String, title: String, body: String? = nil, id: String? = nil) {
        self.folder = folder
        self.title = title
        self.body = body
        self.id = id
    }
}

public enum VaultSkipReason: String, Hashable, Sendable {
    case unsafePath = "unsafe_path"
    case system, hidden, secret
    case tooLarge = "too_large"
    case empty, unsupported, limit
    case attachmentUnsupported = "attachment_unsupported"
    case exists, invalid
}

public struct VaultSkipped: Hashable, Sendable {
    public var path: String
    public var reason: VaultSkipReason

    public init(path: String, reason: VaultSkipReason) {
        self.path = path
        self.reason = reason
    }
}

public enum VaultPlannedAction: String, Hashable, Sendable {
    case create, overwrite, rename, skip, unchanged
}

public struct VaultPlannedNote: Hashable, Sendable {
    /// The vault file it comes from (several pieces may share one).
    public var source: String
    /// Perspicax topic, or "" for a bot (flat).
    public var folder: String
    public var title: String
    public var body: String
    public var tags: [String]
    public var action: VaultPlannedAction
    /// A note of that name was already there.
    public var conflict: Bool
    /// Perspicax: the entry an overwrite replaces.
    public var existingId: String?
    /// Bot: memory/<title>.md.
    public var path: String?
    public var links: Int
}

public struct VaultPlannedAttachment: Hashable, Sendable {
    public var source: String
    /// Workspace path (bot): memory-attachments/<folder>/<path>.
    public var target: String
    public var size: Int
}

public struct VaultPlanCounts: Hashable, Sendable {
    public var notes = 0
    public var folders = 0
    public var links = 0
    public var tags = 0
    public var attachments = 0
    public var conflicts = 0
    public var skipped = 0
    public var secrets = 0
    public var unchanged = 0
}

public struct VaultPlan: Hashable, Sendable {
    public var vaultName: String
    public var destination: VaultDestination
    public var folder: String
    public var notes: [VaultPlannedNote]
    public var attachments: [VaultPlannedAttachment]
    public var skipped: [VaultSkipped]
    public var counts: VaultPlanCounts
}

public struct VaultPlanInput: Sendable {
    public var vaultName: String
    public var files: [VaultFile]
    public var options: VaultImportOptions
    public var destination: VaultDestination
    /// The folder the vault lands in (a topic, or a bot file prefix); "" keeps none.
    public var folder: String
    public var existing: [VaultExistingNote]

    public init(vaultName: String, files: [VaultFile], options: VaultImportOptions = .default, destination: VaultDestination, folder: String, existing: [VaultExistingNote] = []) {
        self.vaultName = vaultName
        self.files = files
        self.options = options
        self.destination = destination
        self.folder = folder
        self.existing = existing
    }
}

public enum VaultFrontValue: Hashable, Sendable {
    case text(String)
    case list([String])
}

public struct VaultFrontMatter: Hashable, Sendable {
    public var data: [String: VaultFrontValue]
    /// The block's lines, without the --- fences; nil when the note has none.
    public var raw: String?
    public var body: String
}

// MARK: - Regex helpers

private func rx(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
    // The patterns are literals of this file: a typo is a programming error.
    // swiftlint:disable:next force_try
    try! NSRegularExpression(pattern: pattern, options: options)
}

private extension NSRegularExpression {
    func test(_ text: String) -> Bool {
        firstMatch(in: text, options: [], range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    /// Replaces each match with what `transform` returns for it.
    func replacing(in text: String, _ transform: (NSTextCheckingResult, NSString) -> String) -> String {
        let ns = text as NSString
        var out = ""
        var last = 0
        for match in matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += ns.substring(with: NSRange(location: last, length: match.range.location - last))
            out += transform(match, ns)
            last = match.range.location + match.range.length
        }
        out += ns.substring(from: last)
        return out
    }

    /// JS `String.split(regex)` without capture groups.
    func split(_ text: String) -> [String] {
        let ns = text as NSString
        var out: [String] = []
        var last = 0
        for match in matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out.append(ns.substring(with: NSRange(location: last, length: match.range.location - last)))
            last = match.range.location + match.range.length
        }
        out.append(ns.substring(from: last))
        return out
    }
}

private extension NSString {
    func group(_ match: NSTextCheckingResult, _ index: Int) -> String? {
        let range = match.range(at: index)
        return range.location == NSNotFound ? nil : substring(with: range)
    }
}

private func utf8Count(_ text: String) -> Int { text.utf8.count }

private func lines(_ text: String) -> [String] {
    text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
}

private func cut(_ text: String, _ count: Int) -> String {
    count <= 0 ? "" : String(text.prefix(count))
}

private func trimmedEnd(_ text: String) -> String {
    var scalars = Substring(text)
    while let last = scalars.last, last.isWhitespace || last.isNewline { scalars = scalars.dropLast() }
    return String(scalars)
}

// MARK: - The plan

public enum ObsidianVault {
    // Perspicax entry rules (gateway memory/entry.rs, import-local.py).
    public static let pxTopicMax = 48
    public static let pxTitleMax = 110
    public static let pxBodyMax = 3_800
    public static let pxTagsMax = 16
    public static let pxTagMax = 64
    private static let pxReservedTopics: Set<String> = ["inbox", "directory"]

    /// A bot memory file (server/workspace/workspace.ts MEMORY_FILE_MAX_BYTES).
    public static let botNoteMaxBytes = 256 * 1024
    public static let botAttachmentsDir = "memory-attachments"
    private static let botNameMax = 120

    private static let attachmentExt = rx(#"\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf)\z"#, .caseInsensitive)
    private static let noteExt = rx(#"\.md\z"#, .caseInsensitive)

    public static func isAttachmentPath(_ path: String) -> Bool { attachmentExt.test(path) }
    public static func isNotePath(_ path: String) -> Bool { noteExt.test(path) }

    // MARK: paths

    /// A vault-relative path, or nil when it could leave the vault.
    public static func safePath(_ raw: String) -> String? {
        if raw.isEmpty || raw.contains("\\") { return nil }
        if raw.unicodeScalars.contains(where: { $0.value <= 0x1f || $0.value == 0x7f }) { return nil }
        let path = rx(#"^(?:\./)+"#).replacing(in: raw) { _, _ in "" }
        if path.isEmpty || path.hasPrefix("/") || rx(#"^[A-Za-z]:"#).test(path) { return nil }
        let parts = path.components(separatedBy: "/")
        if parts.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) { return nil }
        return parts.joined(separator: "/")
    }

    /// The picked folder's or the zip's single top folder: the vault's name.
    public static func stripRoot(_ paths: [String]) -> (root: String, paths: [String]) {
        func first(_ path: String) -> String {
            guard let slash = path.range(of: "/") else { return "" }
            return String(path[..<slash.lowerBound])
        }
        let firsts = Set(paths.map(first))
        guard firsts.count == 1, let root = firsts.first, !root.isEmpty else { return ("", paths) }
        return (root, paths.map { String($0.dropFirst(root.count + 1)) })
    }

    private static func hiddenSegment(_ path: String) -> String? {
        path.components(separatedBy: "/").first { $0.hasPrefix(".") }
    }

    /// Key stores and env files by name: never opened.
    private static let secretFile = rx(
        #"(?:^|/)(?:\.env(?:\.[^/]*)?|\.envrc|\.netrc|\.npmrc|\.pypirc|\.pgpass|\.git-credentials|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|kubeconfig|credentials?(?:\.(?:json|jsonc|ya?ml|toml|txt|ini))?|secrets?(?:\.(?:json|jsonc|ya?ml|toml|txt|ini))?|tokens?(?:\.(?:json|ya?ml|txt))?|[^/]*\.(?:pem|key|p8|p12|pfx|keystore|jks|kdbx|keychain|ovpn|ppk|asc|gpg))\z"#,
        .caseInsensitive
    )

    public static func isSecretFile(_ path: String) -> Bool { secretFile.test(path) }

    // MARK: secrets in a text

    private static let keyPrefixes: [NSRegularExpression] = [
        #"\bom[dg]_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])"#,
        #"\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}"#,
        #"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}"#,
        #"\bxai-[A-Za-z0-9_-]{20,}"#,
        #"\bgsk_[A-Za-z0-9]{40,}"#,
        #"\bcsk-[A-Za-z0-9]{32,}"#,
        #"\bhf_[A-Za-z0-9]{30,}"#,
        #"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"#,
        #"\bgithub_pat_[A-Za-z0-9_]{20,}"#,
        #"\bxox[abposr]-[A-Za-z0-9-]{20,}"#,
        #"\bxapp-\d-[A-Za-z0-9-]{20,}"#,
        #"\bgl(?:pat|dt|rtr?)-[A-Za-z0-9_-]{20,}(?:\.[A-Za-z0-9_-]+)*"#,
        #"\bAKIA[0-9A-Z]{16}\b"#,
        #"\bAIza[0-9A-Za-z_-]{30,}"#,
        #"\bnpm_[A-Za-z0-9]{20,}"#,
        #"\bwhsec_[A-Za-z0-9_-]{20,}"#,
        #"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"#,
    ].map { rx($0) }
    private static let privateKeyBlock = rx(#"-----BEGIN [A-Z ]*PRIVATE KEY-----"#)

    /// Only shapes that are unmistakably a credential (a provider's key prefix, a private key block).
    static func holdsCredential(_ text: String) -> Bool {
        privateKeyBlock.test(text) || keyPrefixes.contains { $0.test(text) }
    }

    /// The shapes the shared redaction pass masks beyond the key prefixes: a
    /// pass that would change the text means it holds a credential.
    private static let redactShapes: [NSRegularExpression] = [
        rx(#"(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})"#),
        rx(#"(\bAuthorization["']?\s*[:=]\s*["']?Basic\s+)([A-Za-z0-9+/]{4,}={0,2})(?![A-Za-z0-9._~+/=-])"#, .caseInsensitive),
        rx(#"\b((?:[A-Za-z0-9_-]*_)?(?:api[_-]?key|apikey|secret|token|password|passwd|authorization|auth[_-]?token|access[_-]?key|private[_-]?key)s?)(["']?\s*[=:]\s*)(["']?)([A-Za-z0-9._~+/=-]{8,})\3"#, .caseInsensitive),
        rx(#"\b([A-Za-z][A-Za-z0-9_-]*[_-]key)s?(=)(["']?)([A-Za-z0-9._~+/=-]+)\3"#, .caseInsensitive),
        rx(#"(--(?:token|password|passwd|api-key|apikey|secret|access-key|auth-token)(?:=|\s+))(["']?)(?!-)([A-Za-z0-9._~+/=-]+)\2"#, .caseInsensitive),
        rx(#"(\b[a-z][a-z0-9+.-]*://[^\s/:@'"]+:)([^\s/@'"«»]+)(@)"#, .caseInsensitive),
    ]

    /// Perspicax's gate (memory/filter rules) beyond the shared shapes.
    private static let pxGateShapes: [NSRegularExpression] = [
        rx(#"\bpxat1\.[A-Za-z0-9_-]{16,}"#),
        rx(#"\bpxr_[A-Za-z0-9_-]{30,}"#),
        rx(#"\bsk-ant-[A-Za-z0-9_-]{16,}"#),
        rx(#"(?:^|[;\s])(?:Password|Pwd|AccountKey|SharedAccessKey)\s*=\s*[^;\s]{4,}"#, .caseInsensitive),
        rx(#"\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@"#, .caseInsensitive),
    ]

    /// Whether a note's text holds a credential (never says which).
    public static func textHoldsSecret(_ text: String) -> Bool {
        if holdsCredential(text) { return true }
        if pxGateShapes.contains(where: { $0.test(text) }) { return true }
        if (text as NSString).length < 8 { return false }
        return redactShapes.contains { $0.test(text) }
    }

    // MARK: markdown

    private static let frontRx = rx(#"^\x{FEFF}?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|\z)"#)

    private static func unquote(_ value: String) -> String {
        let v = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if v.count >= 2, (v.hasPrefix("\"") && v.hasSuffix("\"")) || (v.hasPrefix("'") && v.hasSuffix("'")) {
            return String(v.dropFirst().dropLast())
        }
        return v
    }

    /// The YAML front matter a vault uses: `key: value`, `key: [a, b]`, `key:` then `- item` lines.
    public static func parseFrontMatter(_ text: String) -> VaultFrontMatter {
        let ns = text as NSString
        guard let match = frontRx.firstMatch(in: text, options: [], range: NSRange(location: 0, length: ns.length)) else {
            var body = text
            if body.hasPrefix("\u{FEFF}") { body.removeFirst() }
            return VaultFrontMatter(data: [:], raw: nil, body: body)
        }
        let raw = ns.group(match, 1) ?? ""
        var data: [String: VaultFrontValue] = [:]
        var current: String?
        let itemRx = rx(#"^\s*-\s+(.*)$"#)
        let pairRx = rx(#"^([A-Za-z0-9_][\w .-]*?)\s*:\s*(.*)$"#)
        for line in lines(raw) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let lineNs = line as NSString
            let whole = NSRange(location: 0, length: lineNs.length)
            if let item = itemRx.firstMatch(in: line, options: [], range: whole), let key = current {
                var list: [String]
                switch data[key] {
                case .list(let existing)?: list = existing
                case .text(let one)?: list = one.isEmpty ? [] : [one]
                case nil: list = []
                }
                list.append(unquote(lineNs.group(item, 1) ?? ""))
                data[key] = .list(list)
                continue
            }
            if let pair = pairRx.firstMatch(in: line, options: [], range: whole), !(line.first?.isWhitespace ?? false) {
                let key = lineNs.group(pair, 1) ?? ""
                current = key
                let value = (lineNs.group(pair, 2) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                if value.hasPrefix("["), value.hasSuffix("]") {
                    data[key] = .list(String(value.dropFirst().dropLast()).components(separatedBy: ",").map(unquote).filter { !$0.isEmpty })
                } else {
                    data[key] = .text(unquote(value))
                }
                continue
            }
            // a folded or indented continuation: kept on the key it follows
            if let key = current, case .text(let previous)? = data[key] {
                data[key] = .text("\(previous) \(line.trimmingCharacters(in: .whitespacesAndNewlines))".trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return VaultFrontMatter(data: data, raw: raw, body: ns.substring(from: match.range.location + match.range.length))
    }

    private static let fenceRx = rx(#"^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$"#, [.anchorsMatchLines])
    private static let inlineCodeRx = rx(#"`[^`\n]+`"#)

    private static func inlineOutside(_ text: String, _ transform: (String) -> String) -> String {
        let ns = text as NSString
        var out = ""
        var last = 0
        for match in inlineCodeRx.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += transform(ns.substring(with: NSRange(location: last, length: match.range.location - last)))
            out += ns.substring(with: match.range)
            last = match.range.location + match.range.length
        }
        out += transform(ns.substring(from: last))
        return out
    }

    /// Code fences and inline code are left as they are; `transform` sees the rest.
    public static func outsideCode(_ text: String, _ transform: (String) -> String) -> String {
        let ns = text as NSString
        var out = ""
        var last = 0
        for match in fenceRx.matches(in: text, options: [], range: NSRange(location: 0, length: ns.length)) {
            out += inlineOutside(ns.substring(with: NSRange(location: last, length: match.range.location - last)), transform)
            out += ns.substring(with: match.range)
            last = match.range.location + match.range.length
        }
        out += inlineOutside(ns.substring(from: last), transform)
        return out
    }

    private static let inlineTagRx = rx(#"(^|[\s(,;])#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)"#)

    /// The #tags of a note's text, outside code, in order, without the `#`.
    public static func inlineTags(_ text: String) -> [String] {
        var found: [String] = []
        _ = outsideCode(text) { prose in
            let ns = prose as NSString
            for match in inlineTagRx.matches(in: prose, options: [], range: NSRange(location: 0, length: ns.length)) {
                if let tag = ns.group(match, 2) { found.append(tag) }
            }
            return prose
        }
        return unique(found)
    }

    private static func unique(_ list: [String]) -> [String] {
        var seen = Set<String>()
        return list.filter { seen.insert($0).inserted }
    }

    private static func frontTags(_ data: [String: VaultFrontValue]) -> [String] {
        let value = data["tags"] ?? data["tag"] ?? data["Tags"]
        let list: [String]
        switch value {
        case .list(let items)?: list = items
        case .text(let text)?: list = rx(#"[,\s]+"#).split(text)
        case nil: list = []
        }
        return list.map { rx(#"^#"#).replacing(in: $0.trimmingCharacters(in: .whitespacesAndNewlines)) { _, _ in "" } }.filter { !$0.isEmpty }
    }

    /// NFKD without the combining marks.
    static func fold(_ text: String) -> String {
        String(String.UnicodeScalarView(text.decomposedStringWithCompatibilityMapping.unicodeScalars.filter { !(0x0300...0x036F).contains($0.value) }))
    }

    /// Lowercase ASCII words joined by hyphens (a Perspicax topic).
    public static func topicSlug(_ text: String, limit: Int = pxTopicMax) -> String {
        let slug = fold(text).lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
        let trimmed = cut(slug, limit).replacingOccurrences(of: "-+$", with: "", options: .regularExpression)
        let out = trimmed.isEmpty ? "notes" : trimmed
        return pxReservedTopics.contains(out) ? "\(out)-notes" : out
    }

    /// A Perspicax tag: `[a-z0-9:._/-]`, starting with a letter or digit, at most 64.
    public static func pxTag(_ tag: String) -> String? {
        var cleaned = fold(tag).lowercased()
            .replacingOccurrences(of: "[^a-z0-9:._/-]+", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "^[^a-z0-9]+", with: "", options: .regularExpression)
        cleaned = cut(cleaned, pxTagMax).replacingOccurrences(of: "[-/:.]+$", with: "", options: .regularExpression)
        return cleaned.isEmpty ? nil : cleaned
    }

    /// A bot topic file's name: letters, digits, spaces, `_`, `.` and `-` (workspace.ts TOPIC_NAME).
    public static func botFileName(_ text: String) -> String {
        var cleaned = rx(#"[^\p{L}\p{N}_ .-]+"#).replacing(in: text) { _, _ in "-" }
        cleaned = rx(#"\s+"#).replacing(in: cleaned) { _, _ in " " }
        cleaned = rx(#"-{2,}"#).replacing(in: cleaned) { _, _ in "-" }
        cleaned = cleaned.trimmingCharacters(in: .whitespacesAndNewlines)
        cleaned = rx(#"^[^\p{L}\p{N}_]+"#).replacing(in: cleaned) { _, _ in "" }
        cleaned = cut(cleaned, botNameMax)
        cleaned = rx(#"[ .-]+\z"#).replacing(in: cleaned) { _, _ in "" }
        return cleaned.isEmpty ? "note" : cleaned
    }

    /// A body cut at its paragraphs, then lines, each piece at most `max` bytes.
    public static func pieces(_ body: String, max: Int = pxBodyMax) -> [String] {
        if utf8Count(body) <= max { return [body] }
        var out: [String] = []
        var current = ""
        func push(_ chunk: String) {
            let joined = current.isEmpty ? chunk : "\(current)\n\n\(chunk)"
            if utf8Count(joined) <= max { current = joined; return }
            if !current.isEmpty { out.append(current) }
            current = chunk
        }
        for para in rx(#"\n\s*\n"#).split(body) {
            if utf8Count(para) <= max { push(para); continue }
            for line in para.components(separatedBy: "\n") {
                var rest = Array(line)
                while utf8Count(String(rest)) > max {
                    var count = Swift.min(rest.count, max)
                    while count > 1, utf8Count(String(rest[0..<count])) > max { count -= 1 }
                    push(String(rest[0..<count]))
                    rest = Array(rest[count...])
                }
                if !rest.isEmpty { push(String(rest)) }
            }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    // MARK: the plan

    private final class Candidate {
        let path: String
        let dir: String
        let base: String
        let title: String
        let folder: String
        let front: VaultFrontMatter
        let tags: [String]
        var finalTitle: String?

        init(path: String, dir: String, base: String, title: String, folder: String, front: VaultFrontMatter, tags: [String]) {
            self.path = path
            self.dir = dir
            self.base = base
            self.title = title
            self.folder = folder
            self.front = front
            self.tags = tags
        }
    }

    private struct Decision {
        var action: VaultPlannedAction
        var conflict: Bool
        var existingId: String?
    }

    private static let wikilinkRx = rx(#"(!?)\[\[([^\]\n]+?)\]\]"#)
    private static let sizeAliasRx = rx(#"^\d+(?:x\d+)?\z"#)

    private static func dirOf(_ path: String) -> String {
        guard let slash = path.range(of: "/", options: .backwards) else { return "" }
        return String(path[..<slash.lowerBound])
    }

    private static func baseOf(_ path: String) -> String {
        guard let slash = path.range(of: "/", options: .backwards) else { return path }
        return String(path[slash.upperBound...])
    }

    /// The key a note is known by in its folder: its title, case-folded.
    public static func existingKey(folder: String, title: String) -> String {
        "\(folder)\u{0}\(title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())"
    }

    private static func frontBlock(_ raw: String?, _ tags: [String]?) -> String {
        var rows: [String] = []
        if let raw { rows = lines(raw) }
        if let tags, !tags.isEmpty {
            // the merged tags replace the block's own
            var kept: [String] = []
            var skipping = false
            let tagLine = rx(#"^(?:tags|tag|Tags)\s*:"#)
            let itemLine = rx(#"^\s+-\s"#)
            for line in rows {
                if tagLine.test(line) { skipping = true; continue }
                if skipping, itemLine.test(line) { continue }
                skipping = false
                kept.append(line)
            }
            kept.append("tags: [\(tags.joined(separator: ", "))]")
            return "---\n\(kept.joined(separator: "\n"))\n---\n\n"
        }
        return raw == nil ? "" : "---\n\(rows.joined(separator: "\n"))\n---\n\n"
    }

    private struct Rendered {
        var full: String
        var tags: [String]
        var links: Int
        var parts: [String]
    }

    /// The dry run: every note, attachment and skipped file, with the counts the window shows.
    public static func plan(_ input: VaultPlanInput) -> VaultPlan {
        let options = input.options
        let destination = input.destination
        var skipped: [VaultSkipped] = []
        var notes: [Candidate] = []
        var attachments: [String: VaultFile] = [:]
        var attachmentOrder: [String] = []
        var total = 0
        var read = 0
        let baseFolder = destination == .perspicax
            ? (input.folder.isEmpty ? "" : topicSlug(input.folder))
            : input.folder.trimmingCharacters(in: .whitespacesAndNewlines)

        for file in input.files {
            guard let path = safePath(file.path) else { skipped.append(VaultSkipped(path: file.path, reason: .unsafePath)); continue }
            let top = path.components(separatedBy: "/")[0]
            let isSystem = top == ".obsidian" || top == ".trash"
            if isSecretFile(path) { skipped.append(VaultSkipped(path: path, reason: .secret)); continue }
            if isSystem && options.skipSystem { skipped.append(VaultSkipped(path: path, reason: .system)); continue }
            if !isSystem && hiddenSegment(path) != nil { skipped.append(VaultSkipped(path: path, reason: .hidden)); continue }
            if read >= VaultLimits.files { skipped.append(VaultSkipped(path: path, reason: .limit)); continue }
            read += 1
            let isNote = isNotePath(path)
            let isAttachment = isAttachmentPath(path)
            if !isNote && !isAttachment { skipped.append(VaultSkipped(path: path, reason: .unsupported)); continue }
            let cap = isNote ? VaultLimits.noteBytes : VaultLimits.attachmentBytes
            if file.size > cap { skipped.append(VaultSkipped(path: path, reason: .tooLarge)); continue }
            if total + file.size > VaultLimits.totalBytes { skipped.append(VaultSkipped(path: path, reason: .limit)); continue }
            total += file.size
            if isAttachment {
                if attachments[path] == nil { attachmentOrder.append(path) }
                attachments[path] = file
                continue
            }
            let text = file.text ?? ""
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { skipped.append(VaultSkipped(path: path, reason: .empty)); continue }
            if textHoldsSecret(text) { skipped.append(VaultSkipped(path: path, reason: .secret)); continue }
            let front = parseFrontMatter(text)
            let dir = dirOf(path)
            let base = noteExt.replacing(in: baseOf(path)) { _, _ in "" }
            var frontTitle = ""
            if case .text(let value)? = front.data["title"] { frontTitle = value.trimmingCharacters(in: .whitespacesAndNewlines) }
            let joinedTitle = (frontTitle.isEmpty ? base : frontTitle)
                .replacingOccurrences(of: "[\r\n]+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let title = joinedTitle.isEmpty ? base : joinedTitle
            let tags = options.tags ? unique(frontTags(front.data) + inlineTags(front.body)) : []
            var folder = ""
            if destination == .perspicax {
                let parts = ([baseFolder] + (options.keepStructure && !dir.isEmpty ? dir.components(separatedBy: "/") : [])).filter { !$0.isEmpty }
                folder = parts.isEmpty ? "notes" : topicSlug(parts.joined(separator: "-"))
            }
            notes.append(Candidate(path: path, dir: dir, base: base, title: title, folder: folder, front: front, tags: tags))
        }

        // Obsidian resolves [[name]] by file name, or by its path in the vault.
        var byName: [String: Candidate] = [:]
        var byPath: [String: Candidate] = [:]
        for note in notes {
            let name = note.base.lowercased()
            if byName[name] == nil { byName[name] = note }
            byPath[noteExt.replacing(in: note.path) { _, _ in "" }.lowercased()] = note
            if note.title.lowercased() != name, byName[note.title.lowercased()] == nil { byName[note.title.lowercased()] = note }
        }
        var attachmentByName: [String: String] = [:]
        for path in attachmentOrder {
            let name = baseOf(path).lowercased()
            if attachmentByName[name] == nil { attachmentByName[name] = path }
        }
        func resolveNote(_ target: String) -> Candidate? {
            var clean = noteExt.replacing(in: target.trimmingCharacters(in: .whitespacesAndNewlines)) { _, _ in "" }
            clean = rx(#"^/+"#).replacing(in: clean) { _, _ in "" }.lowercased()
            if let hit = byPath[clean] { return hit }
            return byName[baseOf(clean)]
        }
        func resolveAttachment(_ target: String) -> String? {
            let clean = rx(#"^/+"#).replacing(in: target.trimmingCharacters(in: .whitespacesAndNewlines)) { _, _ in "" }
            if attachments[clean] != nil { return clean }
            return attachmentByName[baseOf(clean).lowercased()]
        }

        // Titles first (conflicts), then bodies (links need the final titles).
        var existing: [String: VaultExistingNote] = [:]
        for note in input.existing { existing[existingKey(folder: note.folder, title: note.title)] = note }
        var taken = Set(existing.keys)
        func botPrefix(_ note: Candidate) -> String {
            ([baseFolder] + (options.keepStructure && !note.dir.isEmpty ? note.dir.components(separatedBy: "/") : [])).filter { !$0.isEmpty }.joined(separator: " - ")
        }
        func wantedTitle(_ note: Candidate) -> String {
            if destination == .bot {
                let prefix = botPrefix(note)
                return botFileName(prefix.isEmpty ? note.title : "\(prefix) - \(note.title)")
            }
            let title = cut(note.title, pxTitleMax).trimmingCharacters(in: .whitespacesAndNewlines)
            return title.isEmpty ? note.base : title
        }
        func freeTitle(_ folder: String, _ title: String) -> String {
            for n in 2..<1000 {
                let suffix = " (\(n))"
                let max = destination == .bot ? botNameMax : pxTitleMax
                let head = trimmedEnd(cut(title, max - suffix.count))
                let candidate = "\(head)\(suffix)"
                let next = destination == .bot ? botFileName(candidate.replacingOccurrences(of: "[()]", with: "", options: .regularExpression)) : candidate
                if !taken.contains(existingKey(folder: folder, title: next)) { return next }
            }
            return "\(title) \(Int(Date().timeIntervalSince1970 * 1000))"
        }

        var decisions: [ObjectIdentifier: Decision] = [:]
        var plannedAttachments: [String: VaultPlannedAttachment] = [:]
        var plannedAttachmentOrder: [String] = []
        let attachmentRoot = botFileName(!baseFolder.isEmpty ? baseFolder : (!input.vaultName.isEmpty ? input.vaultName : "vault"))
            .replacingOccurrences(of: "\\s+", with: "-", options: .regularExpression)
        var unsupportedSeen: [String] = []

        /// A note's text and tags with the titles decided so far.
        func render(_ note: Candidate) -> Rendered {
            var links = 0
            let lead = rx(#"^\s*\n"#).replacing(in: note.front.body) { _, _ in "" }
            let body = outsideCode(lead) { prose in
                wikilinkRx.replacing(in: prose) { match, ns in
                    let whole = ns.substring(with: match.range)
                    let bang = ns.group(match, 1) ?? ""
                    let inner = ns.group(match, 2) ?? ""
                    let innerParts = inner.components(separatedBy: "|")
                    let targetPart = innerParts[0]
                    let alias = innerParts.count > 1 ? innerParts[1] : nil
                    let targetParts = targetPart.components(separatedBy: "#")
                    let target = targetParts[0]
                    let heading = targetParts.count > 1 ? targetParts[1] : nil
                    if !bang.isEmpty, isAttachmentPath(target.trimmingCharacters(in: .whitespacesAndNewlines)) {
                        if !options.attachments { return whole }
                        guard let source = resolveAttachment(target) else { return whole }
                        if destination != .bot {
                            if !unsupportedSeen.contains(source) { unsupportedSeen.append(source) }
                            return whole
                        }
                        let targetPath = "\(botAttachmentsDir)/\(attachmentRoot)/\(source)"
                        if plannedAttachments[source] == nil { plannedAttachmentOrder.append(source) }
                        plannedAttachments[source] = VaultPlannedAttachment(source: source, target: targetPath, size: attachments[source]!.size)
                        let label: String
                        if let alias, !alias.isEmpty, !sizeAliasRx.test(alias) { label = alias } else { label = baseOf(source) }
                        return "![\(label.replacingOccurrences(of: "[\\[\\]]", with: "", options: .regularExpression))](\(targetPath.replacingOccurrences(of: " ", with: "%20")))"
                    }
                    if !options.wikilinks { return whole }
                    guard let hit = resolveNote(target), let finalTitle = hit.finalTitle, decisions[ObjectIdentifier(hit)]?.action != .skip else { return whole }
                    links += 1
                    let anchor = (heading?.isEmpty == false) ? "#\(heading!)" : ""
                    let trimmedTarget = target.trimmingCharacters(in: .whitespacesAndNewlines)
                    let shown: String
                    if let alias, !alias.isEmpty { shown = "|\(alias)" }
                    else if finalTitle != trimmedTarget && (heading?.isEmpty ?? true) { shown = "|\(trimmedTarget)" }
                    else { shown = "" }
                    return "[[\(finalTitle)\(anchor)\(shown)]]"
                }
            }
            let tags = destination == .perspicax
                ? Array(unique(note.tags.compactMap(pxTag)).prefix(pxTagsMax))
                : note.tags
            let header: String
            if options.properties {
                header = frontBlock(note.front.raw, destination == .bot && options.tags ? tags : nil)
            } else if destination == .bot && options.tags && !tags.isEmpty {
                header = "---\ntags: [\(tags.joined(separator: ", "))]\n---\n\n"
            } else {
                header = ""
            }
            let joined = header + body
            var full = ""
            if !joined.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let trimmed = trimmedEnd(joined)
                full = trimmed != joined ? trimmed + "\n" : joined
            }
            return Rendered(full: full, tags: tags, links: links, parts: destination == .bot ? [full] : pieces(full))
        }
        func pieceTitle(_ title: String, _ index: Int, _ count: Int) -> String {
            count > 1 && index > 0 ? "\(trimmedEnd(cut(title, pxTitleMax - 8))) (\(index + 1)/\(count))" : title
        }
        func same(_ folder: String, _ title: String, _ text: String) -> Bool {
            guard let there = existing[existingKey(folder: folder, title: title)], let body = there.body else { return false }
            return body.trimmingCharacters(in: .whitespacesAndNewlines) == text.trimmingCharacters(in: .whitespacesAndNewlines)
        }

        // 1. Every note on the name it wants (two notes of the vault on one
        // name, a flattened folder: the second is renamed), to see which are
        // already there word for word: a second run writes none of them again.
        var seen = Set<String>()
        for note in notes {
            var title = wantedTitle(note)
            if seen.contains(existingKey(folder: note.folder, title: title)) { title = freeTitle(note.folder, title) }
            seen.insert(existingKey(folder: note.folder, title: title))
            note.finalTitle = title
        }
        var unchanged = Set<ObjectIdentifier>()
        for note in notes {
            let parts = render(note).parts
            if parts.enumerated().allSatisfy({ same(note.folder, pieceTitle(note.finalTitle!, $0.offset, parts.count), $0.element) }) {
                unchanged.insert(ObjectIdentifier(note))
            }
        }
        // 2. The conflict rule for the others.
        for note in notes { taken.insert(existingKey(folder: note.folder, title: note.finalTitle!)) }
        for note in notes {
            let id = ObjectIdentifier(note)
            if unchanged.contains(id) { decisions[id] = Decision(action: .unchanged, conflict: false); continue }
            guard let conflictWith = existing[existingKey(folder: note.folder, title: note.finalTitle!)] else {
                decisions[id] = Decision(action: .create, conflict: false)
                continue
            }
            switch options.conflict {
            case .skip: decisions[id] = Decision(action: .skip, conflict: true)
            case .overwrite: decisions[id] = Decision(action: .overwrite, conflict: true, existingId: conflictWith.id)
            case .rename:
                note.finalTitle = freeTitle(note.folder, note.finalTitle!)
                taken.insert(existingKey(folder: note.folder, title: note.finalTitle!))
                decisions[id] = Decision(action: .rename, conflict: true)
            }
        }
        // 3. The bodies, with the final titles in their links.
        plannedAttachments.removeAll()
        plannedAttachmentOrder.removeAll()
        unsupportedSeen.removeAll()
        var planned: [VaultPlannedNote] = []
        var allTags = Set<String>()
        var linkTotal = 0
        for note in notes {
            let rendered = render(note)
            let decision = decisions[ObjectIdentifier(note)]!
            let title = note.finalTitle!
            if destination == .bot && utf8Count(rendered.full) > botNoteMaxBytes { skipped.append(VaultSkipped(path: note.path, reason: .tooLarge)); continue }
            for tag in rendered.tags { allTags.insert(tag) }
            linkTotal += rendered.links
            if destination == .bot {
                planned.append(VaultPlannedNote(source: note.path, folder: "", title: title, body: rendered.full, tags: rendered.tags, action: decision.action, conflict: decision.conflict, existingId: nil, path: "memory/\(title).md", links: rendered.links))
                continue
            }
            for (index, piece) in rendered.parts.enumerated() {
                let titleOf = pieceTitle(title, index, rendered.parts.count)
                let there = existing[existingKey(folder: note.folder, title: titleOf)]
                let action: VaultPlannedAction
                if index == 0 || decision.action == .skip || decision.action == .unchanged { action = decision.action }
                else if same(note.folder, titleOf, piece) { action = .unchanged }
                // a later piece follows its note: replaced on an overwrite, written beside it otherwise
                else { action = there != nil && decision.action == .overwrite ? .overwrite : .create }
                planned.append(VaultPlannedNote(
                    source: note.path, folder: note.folder, title: titleOf, body: piece, tags: rendered.tags, action: action,
                    conflict: index == 0 ? decision.conflict : there != nil,
                    existingId: index == 0 ? decision.existingId : there?.id,
                    path: nil, links: index == 0 ? rendered.links : 0
                ))
            }
        }
        for source in unsupportedSeen { skipped.append(VaultSkipped(path: source, reason: .attachmentUnsupported)) }

        let writing = planned.filter { $0.action != .skip && $0.action != .unchanged }
        let folders = Set(planned.map { note -> String in
            destination == .bot ? note.title.components(separatedBy: " - ").dropLast().joined(separator: " - ") : note.folder
        })
        var counts = VaultPlanCounts()
        counts.notes = writing.count
        counts.folders = folders.count
        counts.links = linkTotal
        counts.tags = allTags.count
        counts.attachments = plannedAttachments.count
        counts.conflicts = planned.filter(\.conflict).count
        counts.skipped = skipped.count
        counts.secrets = skipped.filter { $0.reason == .secret }.count
        counts.unchanged = planned.filter { $0.action == .unchanged }.count
        return VaultPlan(
            vaultName: input.vaultName, destination: destination, folder: baseFolder,
            notes: planned, attachments: plannedAttachmentOrder.map { plannedAttachments[$0]! },
            skipped: skipped, counts: counts
        )
    }

    /// A bot memory path the import may write (memory/<name>.md, a safe name).
    public static func botImportNotePath(_ path: String) -> Bool {
        rx(#"^memory/[\p{L}\p{N}_][\p{L}\p{N}_ .-]{0,199}\.md\z"#).test(path)
    }

    /// A workspace path an imported attachment may land at.
    public static func botImportAttachmentPath(_ path: String) -> Bool {
        guard let safe = safePath(path), safe == path else { return false }
        return path.hasPrefix("\(botAttachmentsDir)/") && isAttachmentPath(path) && hiddenSegment(path) == nil
    }
}

// MARK: - Reading a vault

public enum VaultReadError: Error, Equatable, LocalizedError {
    case notAZip
    case zip64
    case encrypted
    case unsupportedCompression
    case tooManyFiles(Int)
    case damagedDirectory
    case damagedEntry
    case duplicate
    case tooLarge(String)
    case sizeMismatch
    case notInVault(String)
    case unreadable

    public var errorDescription: String? {
        switch self {
        case .notAZip: "This is not a zip file."
        case .zip64: "ZIP64 archives are not read here."
        case .encrypted: "Encrypted zips are not read here."
        case .unsupportedCompression: "The zip uses a compression this import does not read."
        case .tooManyFiles(let n): "The zip holds more than \(n) files."
        case .damagedDirectory: "The zip's directory is damaged."
        case .damagedEntry: "The zip's entries are damaged."
        case .duplicate: "The zip holds the same file twice."
        case .tooLarge(let path): "\(path) is too large."
        case .sizeMismatch: "A file in the zip is not the size it says."
        case .notInVault(let path): "\(path) is not in the vault."
        case .unreadable: "This folder could not be read."
        }
    }
}

public struct VaultZipEntry {
    public var path: String
    public var size: Int
    public var read: () throws -> Data
}

public enum VaultZip {
    private static let central: UInt32 = 0x02014b50
    private static let end: UInt32 = 0x06054b50
    private static let local: UInt32 = 0x04034b50
    private static let maxRatio = 200

    /// Raw DEFLATE through the platform's Compression framework.
    static func inflate(_ data: Data, size: Int) throws -> Data {
        if size == 0 { return Data() }
        let capacity = size + 1
        var out = Data(count: capacity)
        let written = out.withUnsafeMutableBytes { dst -> Int in
            data.withUnsafeBytes { src -> Int in
                guard let d = dst.bindMemory(to: UInt8.self).baseAddress, let s = src.bindMemory(to: UInt8.self).baseAddress else { return 0 }
                return compression_decode_buffer(d, capacity, s, data.count, nil, COMPRESSION_ZLIB)
            }
        }
        guard written == size else { throw VaultReadError.sizeMismatch }
        return out.prefix(size)
    }

    /// The entries of a zip (files only, folders left out). Nothing is
    /// inflated until an entry is read; ZIP64, encryption, methods other than
    /// store and deflate, too many entries, an entry over `maxEntryBytes` and
    /// a compression ratio no real file has are refused.
    public static func entries(_ file: Data, maxEntries: Int, maxEntryBytes: Int) throws -> [VaultZipEntry] {
        let bytes = [UInt8](file)
        func u16(_ at: Int) -> Int { Int(bytes[at]) | Int(bytes[at + 1]) << 8 }
        func u32(_ at: Int) -> Int { u16(at) | u16(at + 2) << 16 }
        var endAt = -1
        if bytes.count >= 22 {
            var i = bytes.count - 22
            let floor = Swift.max(0, bytes.count - 22 - 0xffff)
            while i >= floor {
                if UInt32(u32(i)) == end { endAt = i; break }
                i -= 1
            }
        }
        guard endAt >= 0 else { throw VaultReadError.notAZip }
        let count = u16(endAt + 10)
        let dirOffset = u32(endAt + 16)
        if count == 0xffff || dirOffset == 0xffff_ffff { throw VaultReadError.zip64 }
        if count > maxEntries { throw VaultReadError.tooManyFiles(maxEntries) }
        var entries: [VaultZipEntry] = []
        var names = Set<String>()
        var at = dirOffset
        for _ in 0..<count {
            guard at + 46 <= bytes.count, UInt32(u32(at)) == central else { throw VaultReadError.damagedDirectory }
            let flags = u16(at + 8)
            let method = u16(at + 10)
            let compressed = u32(at + 20)
            let size = u32(at + 24)
            let nameLength = u16(at + 28)
            let extraLength = u16(at + 30)
            let commentLength = u16(at + 32)
            let localOffset = u32(at + 42)
            guard at + 46 + nameLength <= bytes.count else { throw VaultReadError.damagedDirectory }
            let path = String(decoding: bytes[(at + 46)..<(at + 46 + nameLength)], as: UTF8.self)
            at += 46 + nameLength + extraLength + commentLength
            if path.hasSuffix("/") { continue }
            if flags & 0x1 != 0 { throw VaultReadError.encrypted }
            if method != 0 && method != 8 { throw VaultReadError.unsupportedCompression }
            if size == 0xffff_ffff || compressed == 0xffff_ffff || localOffset == 0xffff_ffff { throw VaultReadError.zip64 }
            if !names.insert(path).inserted { throw VaultReadError.duplicate }
            let tooBig = size > maxEntryBytes || (compressed > 0 && size / compressed > maxRatio && size > 1_000_000)
            entries.append(VaultZipEntry(path: path, size: size) {
                if tooBig { throw VaultReadError.tooLarge(path) }
                guard localOffset + 30 <= bytes.count, UInt32(u32(localOffset)) == local else { throw VaultReadError.damagedEntry }
                let start = localOffset + 30 + u16(localOffset + 26) + u16(localOffset + 28)
                guard start + compressed <= bytes.count else { throw VaultReadError.damagedEntry }
                let data = Data(bytes[start..<(start + compressed)])
                return method == 0 ? data : try inflate(data, size: size)
            })
        }
        return entries
    }
}

/// A vault read in memory: its files (a note carries its text) and, for an
/// attachment, a way to read its bytes when it is written.
public struct VaultSource {
    public var name: String
    public var files: [VaultFile]
    /// An attachment's bytes, read when it is written.
    public var bytes: (String) throws -> Data

    public init(name: String, files: [VaultFile], bytes: @escaping (String) throws -> Data) {
        self.name = name
        self.files = files
        self.bytes = bytes
    }

    public struct Entry {
        public var path: String
        public var size: Int
        public var text: () throws -> String
        public var bytes: () throws -> Data

        public init(path: String, size: Int, text: @escaping () throws -> String, bytes: @escaping () throws -> Data) {
            self.path = path
            self.size = size
            self.text = text
            self.bytes = bytes
        }
    }

    /// Whether the reader opens this file's text: a note, never a secret-looking or hidden file (.obsidian and .trash aside).
    static func readsText(_ path: String) -> Bool {
        if !path.lowercased().hasSuffix(".md") || ObsidianVault.isSecretFile(path) { return false }
        for (i, part) in path.components(separatedBy: "/").enumerated() where part.hasPrefix(".") {
            if !(i == 0 && (part == ".obsidian" || part == ".trash")) { return false }
        }
        return true
    }

    /// Entries under the vault's own top folder, planned as the page does.
    public static func make(name: String, entries: [Entry]) throws -> VaultSource {
        let (root, paths) = ObsidianVault.stripRoot(entries.map(\.path))
        var files: [VaultFile] = []
        var byPath: [String: Entry] = [:]
        for (index, entry) in entries.enumerated() {
            let path = paths[index]
            byPath[path] = entry
            var text: String?
            if let safe = ObsidianVault.safePath(path), readsText(safe), entry.size <= VaultLimits.noteBytes {
                text = try entry.text()
            }
            files.append(VaultFile(path: path, size: entry.size, text: text))
        }
        return VaultSource(name: root.isEmpty ? name : root, files: files) { path in
            guard let entry = byPath[path], ObsidianVault.isAttachmentPath(path) else { throw VaultReadError.notInVault(path) }
            return try entry.bytes()
        }
    }

    private static func decode(_ data: Data) -> String {
        var text = String(decoding: data, as: UTF8.self)
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        return text
    }

    /// A vault's .zip (an Obsidian vault exported as .zip).
    public static func readZip(_ file: Data, name: String) throws -> VaultSource {
        let entries = try VaultZip.entries(file, maxEntries: VaultLimits.files * 2, maxEntryBytes: VaultLimits.attachmentBytes)
        let stem = name.lowercased().hasSuffix(".zip") ? String(name.dropLast(4)) : name
        return try make(name: stem, entries: entries.map { entry in
            Entry(path: entry.path, size: entry.size, text: { decode(try entry.read()) }, bytes: { try entry.read() })
        })
    }

    public static func readZip(at url: URL) throws -> VaultSource {
        try readZip(Data(contentsOf: url, options: .mappedIfSafe), name: url.lastPathComponent)
    }

    /// A picked folder: its files under the folder's own name. The caller
    /// holds the security scope of `url` while this runs and while the
    /// attachments are written.
    public static func readFolder(at url: URL) throws -> VaultSource {
        let manager = FileManager.default
        let base = url.resolvingSymlinksInPath().standardizedFileURL
        guard let walker = manager.enumerator(at: base, includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey], options: []) else { throw VaultReadError.unreadable }
        var entries: [Entry] = []
        for case let file as URL in walker {
            let values = try? file.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values?.isRegularFile == true else { continue }
            let full = file.standardizedFileURL.path
            let prefix = base.path.hasSuffix("/") ? base.path : base.path + "/"
            guard full.hasPrefix(prefix) else { continue }
            let relative = String(full.dropFirst(prefix.count))
            entries.append(Entry(
                path: "\(base.lastPathComponent)/\(relative)",
                size: values?.fileSize ?? 0,
                text: { decode(try Data(contentsOf: file)) },
                bytes: { try Data(contentsOf: file) }
            ))
        }
        entries.sort { $0.path < $1.path }
        return try make(name: base.lastPathComponent, entries: entries)
    }
}

// MARK: - Writing it

public enum VaultImportTarget: Hashable, Sendable {
    case bot(botId: String)
    case perspicax(scope: String)
}

public enum VaultImportStatus: String, Hashable, Sendable {
    case written, unchanged, skipped, refused
}

public struct VaultImportOutcome: Hashable, Sendable {
    public var title: String
    public var status: VaultImportStatus
    public var reason: String?

    public init(title: String, status: VaultImportStatus, reason: String? = nil) {
        self.title = title
        self.status = status
        self.reason = reason
    }
}

public struct VaultImportProgress: Hashable, Sendable {
    public var done = 0
    public var total = 0
    public var outcomes: [VaultImportOutcome] = []
    public var cancelled = false

    public func tally(_ status: VaultImportStatus) -> Int { outcomes.filter { $0.status == status }.count }
    public var refused: [VaultImportOutcome] { outcomes.filter { $0.status == .refused } }
}

public struct VaultWriteResult: Hashable, Sendable {
    public var path: String
    public var status: VaultImportStatus
    public var reason: String?

    public init(path: String, status: VaultImportStatus, reason: String? = nil) {
        self.path = path
        self.status = status
        self.reason = reason
    }
}

public protocol VaultImportWriters {
    /// POST /api/bots/<id>/memory/import: one batch of notes, or of attachments (base64).
    func bot(botId: String, notes: [(path: String, text: String)], attachments: [(path: String, data: String)], conflict: VaultConflict) async throws -> [VaultWriteResult]
    func pxCreate(scope: String, topic: String, title: String, body: String, tags: [String]) async throws
    func pxUpdate(scope: String, id: String, title: String, body: String, tags: [String]) async throws
}

public enum VaultImportRunner {
    static let batchNotes = 40
    static let batchBytes = 6 * 1024 * 1024

    private static func reason(_ cause: Error) -> String {
        (cause as? LocalizedError)?.errorDescription ?? cause.localizedDescription
    }

    /// Writes the plan; `isCancelled` stops it between two writes.
    public static func run(
        plan: VaultPlan,
        source: VaultSource,
        target: VaultImportTarget,
        conflict: VaultConflict,
        writers: VaultImportWriters,
        isCancelled: @escaping () -> Bool = { Task.isCancelled },
        onProgress: ((VaultImportProgress) -> Void)? = nil
    ) async -> VaultImportProgress {
        let todo = plan.notes.filter { $0.action != .skip && $0.action != .unchanged }
        var attachments: [VaultPlannedAttachment] = []
        if case .bot = target { attachments = plan.attachments }
        var progress = VaultImportProgress(done: 0, total: todo.count + attachments.count)
        for note in plan.notes {
            if note.action == .skip { progress.outcomes.append(VaultImportOutcome(title: note.title, status: .skipped, reason: "exists")) }
            if note.action == .unchanged { progress.outcomes.append(VaultImportOutcome(title: note.title, status: .unchanged)) }
        }
        onProgress?(progress)
        func stopped() -> Bool {
            if isCancelled() { progress.cancelled = true }
            return progress.cancelled
        }

        if case .bot(let botId) = target {
            var titleOf: [String: String] = [:]
            for note in todo { if let path = note.path { titleOf[path] = note.title } }
            // a rename was decided by the plan (a new name): written like a new note
            let serverConflict: VaultConflict = conflict == .overwrite ? .overwrite : .skip
            var batch: [VaultPlannedNote] = []
            var bytes = 0
            func flush() async {
                if batch.isEmpty { return }
                let sent = batch
                batch = []
                bytes = 0
                do {
                    let results = try await writers.bot(botId: botId, notes: sent.map { ($0.path ?? "", $0.body) }, attachments: [], conflict: serverConflict)
                    for row in results { progress.outcomes.append(VaultImportOutcome(title: titleOf[row.path] ?? row.path, status: row.status, reason: row.reason)) }
                } catch {
                    for note in sent { progress.outcomes.append(VaultImportOutcome(title: note.title, status: .refused, reason: reason(error))) }
                }
                progress.done += sent.count
                onProgress?(progress)
            }
            for note in todo {
                if stopped() { break }
                let size = utf8Count(note.body)
                if batch.count >= batchNotes || bytes + size > batchBytes { await flush() }
                batch.append(note)
                bytes += size
            }
            if !stopped() { await flush() }
            for attachment in attachments {
                if stopped() { break }
                do {
                    let data = try source.bytes(attachment.source).base64EncodedString()
                    let results = try await writers.bot(botId: botId, notes: [], attachments: [(attachment.target, data)], conflict: serverConflict)
                    for row in results { progress.outcomes.append(VaultImportOutcome(title: attachment.source, status: row.status, reason: row.reason)) }
                } catch {
                    progress.outcomes.append(VaultImportOutcome(title: attachment.source, status: .refused, reason: reason(error)))
                }
                progress.done += 1
                onProgress?(progress)
            }
            return progress
        }

        guard case .perspicax(let scope) = target else { return progress }
        for note in todo {
            if stopped() { break }
            do {
                if note.action == .overwrite, let id = note.existingId {
                    try await writers.pxUpdate(scope: scope, id: id, title: note.title, body: note.body, tags: note.tags)
                } else {
                    try await writers.pxCreate(scope: scope, topic: note.folder, title: note.title, body: note.body, tags: note.tags)
                }
                progress.outcomes.append(VaultImportOutcome(title: note.title, status: .written))
            } catch {
                progress.outcomes.append(VaultImportOutcome(title: note.title, status: .refused, reason: reason(error)))
            }
            progress.done += 1
            onProgress?(progress)
        }
        return progress
    }
}

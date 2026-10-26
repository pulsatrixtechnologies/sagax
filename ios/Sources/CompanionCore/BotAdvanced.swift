// The advanced bot panel (WP16 of the iOS feature parity matrix, rows BA2,
// BA4-BA7, BA9, BA14-BA19): the wire types of the desktop renderer's bot
// settings sections (src/components/bot-settings/*) and the pure rules they
// render from, so the phone draws and decides exactly what the desktop does.
// The views are in ios/App/Features/BotAdvanced; the calls in
// Client+BotAdvanced.swift.
import Foundation

// MARK: - Prompt preview (BA2, PromptPreview.tsx)

/// `GET /api/bots/:id/system-prompt`: the settings-derived prompt, built by
/// the same function a real turn uses.
public struct PromptPreview: Decodable, Hashable, Sendable {
    public struct Section: Decodable, Hashable, Sendable, Identifiable {
        public var id: String
        public var label: String
        public var text: String
        public var bytes: Int
    }

    public var sections: [Section]
    public var totalBytes: Int
    public var approxTokens: Int
    public var note: String

    public init(sections: [Section], totalBytes: Int, approxTokens: Int, note: String) {
        self.sections = sections
        self.totalBytes = totalBytes
        self.approxTokens = approxTokens
        self.note = note
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        sections = (try? c.decodeIfPresent([Lossy<Section>].self, forKey: .sections))?.compactMap(\.value) ?? []
        totalBytes = (try? c.decodeIfPresent(Int.self, forKey: .totalBytes)) ?? sections.reduce(0) { $0 + $1.bytes }
        approxTokens = (try? c.decodeIfPresent(Int.self, forKey: .approxTokens)) ?? 0
        note = (try? c.decodeIfPresent(String.self, forKey: .note)) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case sections, totalBytes, approxTokens, note }
}

// MARK: - History (BA18, HistorySection.tsx)

public struct BotHistoryRow: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var at: Double
    public var actor: String
    public var via: String
    public var field: String
    public var summary: String
    public var canRestore: Bool?
    public var restoreUnavailableReason: String?

    public init(id: String, at: Double, actor: String, via: String, field: String, summary: String,
                canRestore: Bool? = nil, restoreUnavailableReason: String? = nil) {
        self.id = id
        self.at = at
        self.actor = actor
        self.via = via
        self.field = field
        self.summary = summary
        self.canRestore = canRestore
        self.restoreUnavailableReason = restoreUnavailableReason
    }

    /// A soul row that may be undone ("Undo this change").
    public var restorable: Bool { field == "soul" && canRestore == true }
    /// A soul row whose previous text is gone: the reason shows instead.
    public var showsRestoreReason: Bool { field == "soul" && canRestore != true }
}

/// `GET /api/bots/:id/history?limit=100`.
public struct BotHistory: Decodable, Hashable, Sendable {
    public var rows: [BotHistoryRow]
    /// Sent back with a rollback: the server refuses it (409) when the
    /// history moved since.
    public var revision: String?

    public init(rows: [BotHistoryRow], revision: String?) {
        self.rows = rows
        self.revision = revision
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        rows = (try? c.decodeIfPresent([Lossy<BotHistoryRow>].self, forKey: .rows))?.compactMap(\.value) ?? []
        revision = try? c.decodeIfPresent(String.self, forKey: .revision)
    }

    private enum CodingKeys: String, CodingKey { case rows, revision }

    /// Newest first, as the desktop sorts them.
    public var sorted: [BotHistoryRow] { rows.sorted { $0.at > $1.at } }
}

struct HistoryRollbackBody: Encodable {
    var id: String
    var expectedRevision: String
}

// MARK: - Skills (BA4, SkillsSection.tsx, OrgSkillsCard.tsx)

public struct ManagedSkill: Decodable, Hashable, Sendable, Identifiable {
    public var name: String
    public var description: String
    public var enabled: Bool
    public var source: String
    public var warnings: [String]

    public var id: String { name }

    public init(name: String, description: String = "", enabled: Bool, source: String = "", warnings: [String] = []) {
        self.name = name
        self.description = description
        self.enabled = enabled
        self.source = source
        self.warnings = warnings
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        name = try c.decode(String.self, forKey: .name)
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
        enabled = (try? c.decodeIfPresent(Bool.self, forKey: .enabled)) ?? false
        source = (try? c.decodeIfPresent(String.self, forKey: .source)) ?? ""
        warnings = (try? c.decodeIfPresent([String].self, forKey: .warnings)) ?? []
    }

    private enum CodingKeys: String, CodingKey { case name, description, enabled, source, warnings }
}

public struct StagedSkillSummary: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var gist: String?
}

/// `GET /api/bots/:id/skills`.
public struct BotSkills: Decodable, Hashable, Sendable {
    public var skills: [ManagedSkill]
    /// Proposals waiting for a decision in chat.
    public var staged: [StagedSkillSummary]

    public init(skills: [ManagedSkill], staged: [StagedSkillSummary] = []) {
        self.skills = skills
        self.staged = staged
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        skills = (try? c.decodeIfPresent([Lossy<ManagedSkill>].self, forKey: .skills))?.compactMap(\.value) ?? []
        staged = (try? c.decodeIfPresent([Lossy<StagedSkillSummary>].self, forKey: .staged))?.compactMap(\.value) ?? []
    }

    private enum CodingKeys: String, CodingKey { case skills, staged }
}

/// `GET /api/bots/:id/skills/:name`: the integrity-checked SKILL.md.
public struct SkillText: Decodable, Hashable, Sendable {
    public var text: String?
}

/// `POST /api/bots/:id/skills {source}`.
public struct SkillImportResult: Decodable, Hashable, Sendable {
    public var installed: Int

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        installed = (try? c.decodeIfPresent([Lossy<IgnoredValue>].self, forKey: .installed))?.count ?? 0
    }

    private enum CodingKeys: String, CodingKey { case installed }
}

/// Any JSON value, decoded only to be counted.
struct IgnoredValue: Decodable {
    init(from decoder: Decoder) throws {}
}

public enum SkillRules {
    /// The import field's value, or nil when there is nothing to import.
    public static func importSource(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    /// The server's skill names (`[a-z0-9-]+` in the route).
    public static func validName(_ name: String) -> Bool {
        !name.isEmpty && name.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
    }
}

/// A skill an organization package offers (`GET /api/org-library/skills`).
public struct OfferedOrgSkill: Decodable, Hashable, Sendable, Identifiable {
    public var installId: String
    public var packageName: String
    public var publisher: String
    public var release: String
    public var name: String
    public var description: String
    public var added: Bool

    public var id: String { "\(installId):\(name)" }
}

public struct OrgSkillsOffer: Decodable, Hashable, Sendable {
    public struct Organization: Decodable, Hashable, Sendable { public var name: String }
    public var organization: Organization?
    public var skills: [OfferedOrgSkill]

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        organization = try? c.decodeIfPresent(Organization.self, forKey: .organization)
        skills = (try? c.decodeIfPresent([Lossy<OfferedOrgSkill>].self, forKey: .skills))?.compactMap(\.value) ?? []
    }

    private enum CodingKeys: String, CodingKey { case organization, skills }

    /// The card is absent without an organization or anything offered.
    public var shown: Bool { organization != nil && !skills.isEmpty }
}

// MARK: - Memory (BA5, MemorySection.tsx, src/lib/memory.ts)

public enum MemoryRules {
    public static let index = "MEMORY.md"

    /// Daily logs are the bot's own record: read-only in the editor.
    public static func readOnly(_ path: String) -> Bool { path.hasPrefix("memory/log/") }

    /// A new topic's file name from whatever the person typed (`topicFileName`).
    public static func topicFileName(_ input: String) -> String? {
        var stem = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if stem.lowercased().hasSuffix(".md") { stem.removeLast(3) }
        // [^\w .-]+ -> "-"
        var out = ""
        var inRun = false
        for scalar in stem.unicodeScalars {
            let allowed = isWord(scalar) || scalar == " " || scalar == "." || scalar == "-"
            if allowed {
                out.unicodeScalars.append(scalar)
                inRun = false
            } else if !inRun {
                out.append("-")
                inRun = true
            }
        }
        // ^[^\w]+ -> ""
        while let first = out.unicodeScalars.first, !isWord(first) { out.unicodeScalars.removeFirst() }
        out = out.trimmingCharacters(in: .whitespaces)
        return out.isEmpty ? nil : "\(out).md"
    }

    /// JavaScript's `\w`: ASCII letters, digits and the underscore.
    private static func isWord(_ scalar: Unicode.Scalar) -> Bool {
        (65...90).contains(scalar.value) || (97...122).contains(scalar.value) || (48...57).contains(scalar.value) || scalar == "_"
    }

    /// A new topic's starting text (`topicTemplate`).
    public static func topicTemplate(_ fileName: String) -> String {
        let title = fileName.hasSuffix(".md") ? String(fileName.dropLast(3)) : fileName
        return "---\ntitle: \(title)\ndescription: \naliases: []\n---\n\n"
    }

    /// `formatBytes`: "512 B", "1.5 KB".
    public static func formatBytes(_ bytes: Int) -> String { MemoryCapacity.formatBytes(bytes) }

    /// `relativeTime`'s grain: just now, minutes, hours, yesterday, days, a date.
    public enum Ago: Equatable, Sendable {
        case justNow
        case minutes(Int)
        case hours(Int)
        case yesterday
        case days(Int)
        case date(Date)
    }

    public static func ago(_ at: Double, now: Date = Date()) -> Ago {
        let seconds = max(0, Int(((now.timeIntervalSince1970 * 1000 - at) / 1000).rounded()))
        if seconds < 45 { return .justNow }
        let minutes = Int((Double(seconds) / 60).rounded())
        if minutes < 60 { return .minutes(minutes) }
        let hours = Int((Double(minutes) / 60).rounded())
        if hours < 24 { return .hours(hours) }
        let days = Int((Double(hours) / 24).rounded())
        if days == 1 { return .yesterday }
        if days < 7 { return .days(days) }
        return .date(Date(timeIntervalSince1970: at / 1000))
    }
}

public struct MemoryFileInfo: Decodable, Hashable, Sendable, Identifiable {
    public var path: String
    public var name: String
    public var bytes: Int
    public var modifiedAt: Double

    public var id: String { path }
}

public struct MemoryLendingReview: Decodable, Hashable, Sendable {
    public var token: String
    public var changed: [String]
}

public struct MemoryOverview: Decodable, Hashable, Sendable {
    public var botId: String?
    public var workspacePath: String
    public var index: MemoryCapacity
    public var topics: [MemoryFileInfo]
    public var logs: [MemoryFileInfo]
    public var lendingReview: MemoryLendingReview?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        botId = try? c.decodeIfPresent(String.self, forKey: .botId)
        workspacePath = (try? c.decodeIfPresent(String.self, forKey: .workspacePath)) ?? ""
        index = try c.decode(MemoryCapacity.self, forKey: .index)
        topics = (try? c.decodeIfPresent([Lossy<MemoryFileInfo>].self, forKey: .topics))?.compactMap(\.value) ?? []
        logs = (try? c.decodeIfPresent([Lossy<MemoryFileInfo>].self, forKey: .logs))?.compactMap(\.value) ?? []
        lendingReview = try? c.decodeIfPresent(MemoryLendingReview.self, forKey: .lendingReview)
    }

    private enum CodingKeys: String, CodingKey { case botId, workspacePath, index, topics, logs, lendingReview }
}

public struct MemoryDoc: Decodable, Hashable, Sendable {
    public var path: String
    public var text: String
    /// sha256 of the text as loaded; sent back with a save.
    public var hash: String
    public var exists: Bool?

    public init(path: String, text: String, hash: String, exists: Bool? = nil) {
        self.path = path
        self.text = text
        self.hash = hash
        self.exists = exists
    }
}

/// A saved or reverted file and the refreshed overview.
public struct MemoryDocAndOverview: Decodable, Sendable {
    public var doc: MemoryDoc
    public var overview: MemoryOverview?

    public init(from decoder: Decoder) throws {
        doc = try MemoryDoc(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        overview = try? c.decodeIfPresent(MemoryOverview.self, forKey: .overview)
    }

    private enum CodingKeys: String, CodingKey { case overview }
}

/// `PUT /api/bots/:id/memory/file`: a 409 is an answer, not a failure (the
/// bot wrote the file after the editor opened it).
public enum MemorySaveResult: Sendable {
    case saved(MemoryDoc, MemoryOverview?)
    case conflict(current: String, currentHash: String)
}

struct MemorySaveBody: Encodable {
    var path: String
    var text: String
    var expectedHash: String?
}

struct MemoryConflictBody: Decodable {
    var current: String
    var currentHash: String
}

struct MemoryOverviewEnvelope: Decodable {
    var overview: MemoryOverview
}

public struct MemoryJournalRow: Decodable, Hashable, Sendable, Identifiable {
    public enum Kind: String, Decodable, Sendable { case created, edited, deleted }

    public var id: String
    public var at: Double
    public var path: String
    public var actor: String
    public var via: String
    public var threadTitle: String?
    public var kind: Kind
    public var diff: String
    public var added: Int
    public var removed: Int
    public var canRevert: Bool
    public var revertUnavailableReason: String?

    public init(id: String, at: Double, path: String, actor: String, via: String, threadTitle: String? = nil, kind: Kind,
                diff: String = "", added: Int = 0, removed: Int = 0, canRevert: Bool = false, revertUnavailableReason: String? = nil) {
        self.id = id
        self.at = at
        self.path = path
        self.actor = actor
        self.via = via
        self.threadTitle = threadTitle
        self.kind = kind
        self.diff = diff
        self.added = added
        self.removed = removed
        self.canRevert = canRevert
        self.revertUnavailableReason = revertUnavailableReason
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        at = (try? c.decodeIfPresent(Double.self, forKey: .at)) ?? 0
        path = (try? c.decodeIfPresent(String.self, forKey: .path)) ?? ""
        actor = (try? c.decodeIfPresent(String.self, forKey: .actor)) ?? "person"
        via = (try? c.decodeIfPresent(String.self, forKey: .via)) ?? ""
        threadTitle = try? c.decodeIfPresent(String.self, forKey: .threadTitle)
        kind = (try? c.decodeIfPresent(Kind.self, forKey: .kind)) ?? .edited
        diff = (try? c.decodeIfPresent(String.self, forKey: .diff)) ?? ""
        added = (try? c.decodeIfPresent(Int.self, forKey: .added)) ?? 0
        removed = (try? c.decodeIfPresent(Int.self, forKey: .removed)) ?? 0
        canRevert = (try? c.decodeIfPresent(Bool.self, forKey: .canRevert)) ?? false
        revertUnavailableReason = try? c.decodeIfPresent(String.self, forKey: .revertUnavailableReason)
    }

    private enum CodingKeys: String, CodingKey {
        case id, at, path, actor, via, threadTitle, kind, diff, added, removed, canRevert, revertUnavailableReason
    }

    /// Who made the change (`journalSummary`'s subject).
    public enum Who: Equatable, Sendable { case bot, anImport, upkeep, you }
    public var who: Who {
        switch actor {
        case "bot": .bot
        case "import": .anImport
        case "upkeep": .upkeep
        default: .you
        }
    }

    /// Which file, in the person's words (`fileLabel` plus the topic rule).
    public enum Target: Equatable, Sendable {
        case index
        case log(String)
        case topic(String)
    }
    public var target: Target {
        if path == MemoryRules.index { return .index }
        if path.hasPrefix("memory/log/") {
            var day = String(path.dropFirst("memory/log/".count))
            if day.hasSuffix(".md") { day.removeLast(3) }
            return .log(day)
        }
        var topic = path.hasPrefix("memory/") ? String(path.dropFirst("memory/".count)) : path
        if topic.hasSuffix(".md") { topic.removeLast(3) }
        return .topic(topic)
    }

    /// The verb of the summary.
    public enum Change: Equatable, Sendable {
        case created(lines: Int)
        case deleted
        case added(Int)
        case removed(Int)
        case rewrote(Int)
    }
    public var change: Change {
        switch kind {
        case .created: return .created(lines: added)
        case .deleted: return .deleted
        case .edited:
            if added > 0, removed == 0 { return .added(added) }
            if removed > 0, added == 0 { return .removed(removed) }
            return .rewrote(max(added, removed))
        }
    }

    /// Where it came from (`journalSource`).
    public enum Source: Equatable, Sendable {
        case undo, outside, tidy, organize
        case noticed(String?)
        case chat(String)
        case task, settings, api
    }
    public var source: Source? {
        switch via {
        case "revert": return .undo
        case "disk": return .outside
        case "tidy": return .tidy
        case "organize": return .organize
        case "capture": return .noticed(threadTitle)
        default: break
        }
        if let threadTitle { return .chat(threadTitle) }
        if actor == "bot" { return .task }
        if via == "ui" { return .settings }
        if via == "api" { return .api }
        return nil
    }
}

struct MemoryJournalEnvelope: Decodable {
    var entries: [MemoryJournalRow]

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        entries = (try? c.decodeIfPresent([Lossy<MemoryJournalRow>].self, forKey: .entries))?.compactMap(\.value) ?? []
    }

    private enum CodingKeys: String, CodingKey { case entries }
}

public struct TidyReport: Decodable, Hashable, Sendable {
    public var at: Double
    public var expired: Int
    public var duplicates: Int
    public var superseded: Int
    public var deferred: Int?
    public var organized: Int?
    public var note: String?

    public init(at: Double, expired: Int = 0, duplicates: Int = 0, superseded: Int = 0, organized: Int? = nil, note: String? = nil) {
        self.at = at
        self.expired = expired
        self.duplicates = duplicates
        self.superseded = superseded
        self.organized = organized
        self.note = note
    }

    /// `tidySummary`'s parts, in order; empty is "nothing to tidy".
    public enum Part: Equatable, Sendable {
        case expired(Int), duplicates(Int), superseded(Int), organized(Int)
    }
    public var parts: [Part] {
        var parts: [Part] = []
        if expired > 0 { parts.append(.expired(expired)) }
        if duplicates > 0 { parts.append(.duplicates(duplicates)) }
        if superseded > 0 { parts.append(.superseded(superseded)) }
        if let organized, organized > 0 { parts.append(.organized(organized)) }
        return parts
    }
}

public struct CaptureReport: Decodable, Hashable, Sendable {
    public var at: Double
    public var added: Int
    public var topics: Int?
    public var aboutMe: Int?
    /// Facts memory already held: the "N already known" of the receipt
    /// (parity M3). Absent on a report written before it.
    public var known: Int?

    /// `noticedCount`: facts filed in MEMORY.md and topic files.
    public var noticed: Int { added + (topics ?? 0) }
}

public struct MemoryUpkeepStatus: Decodable, Hashable, Sendable {
    public var enabled: Bool
    /// The engine can make the quick model call capture and contradictions need.
    public var modelSteps: Bool
    public var lastTidy: TidyReport?
    public var lastCapture: CaptureReport?

    public init(enabled: Bool, modelSteps: Bool, lastTidy: TidyReport? = nil, lastCapture: CaptureReport? = nil) {
        self.enabled = enabled
        self.modelSteps = modelSteps
        self.lastTidy = lastTidy
        self.lastCapture = lastCapture
    }
}

public struct MemoryTidyResult: Decodable, Sendable {
    public var report: TidyReport
    public var overview: MemoryOverview?
}

// MARK: - Sharing (BA15, SharingSection.tsx, GrantEditor.tsx, lib/perspicax-org.ts)

public enum GrantLevel: String, CaseIterable, Codable, Hashable, Sendable {
    case use, run, edit, manage

    /// `levelAllowed`: whether someone whose ceiling is `max` may give it.
    public func allowed(by max: GrantLevel) -> Bool {
        Self.allCases.firstIndex(of: self)! <= Self.allCases.firstIndex(of: max)!
    }
}

public struct WireGrant: Decodable, Hashable, Sendable, Identifiable {
    public enum Kind: String, Decodable, Sendable { case user, team }
    public var target: String
    public var level: GrantLevel
    public var label: String
    public var kind: Kind
    public var disabled: Bool?

    public var id: String { target }

    public init(target: String, level: GrantLevel, label: String, kind: Kind, disabled: Bool? = nil) {
        self.target = target
        self.level = level
        self.label = label
        self.kind = kind
        self.disabled = disabled
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        target = try c.decode(String.self, forKey: .target)
        level = (try? c.decodeIfPresent(GrantLevel.self, forKey: .level)) ?? .use
        kind = (try? c.decodeIfPresent(Kind.self, forKey: .kind)) ?? (target.hasPrefix("team:") ? .team : .user)
        label = (try? c.decodeIfPresent(String.self, forKey: .label)) ?? String(target.drop { $0 != ":" }.dropFirst())
        disabled = try? c.decodeIfPresent(Bool.self, forKey: .disabled)
    }

    private enum CodingKeys: String, CodingKey { case target, level, label, kind, disabled }
}

public struct GrantAdministration: Decodable, Hashable, Sendable {
    public var any: Bool
    public var teamIds: [String]
    public var maxLevel: GrantLevel
    public var canAdd: Bool?

    public init(any: Bool, teamIds: [String] = [], maxLevel: GrantLevel, canAdd: Bool? = nil) {
        self.any = any
        self.teamIds = teamIds
        self.maxLevel = maxLevel
        self.canAdd = canAdd
    }

    /// The owner's own, before the server answers.
    public static let owner = GrantAdministration(any: true, teamIds: [], maxLevel: .manage, canAdd: true)

    /// `canAdd` in the editor.
    public var mayAdd: Bool { any || canAdd != false }
}

/// `GET /api/bots/:id/grants`, and the answer of every PUT and DELETE.
public struct BotGrants: Decodable, Hashable, Sendable {
    public var grants: [WireGrant]
    public var administer: GrantAdministration?

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        grants = (try? c.decodeIfPresent([Lossy<WireGrant>].self, forKey: .grants))?.compactMap(\.value) ?? []
        administer = try? c.decodeIfPresent(GrantAdministration.self, forKey: .administer)
    }

    private enum CodingKeys: String, CodingKey { case grants, administer }
}

struct GrantPutBody: Encodable {
    var target: String
    var level: GrantLevel
}

/// `GET /api/org/directory` with teams (slice 4).
public struct OrgShareDirectory: Decodable, Hashable, Sendable {
    public struct Person: Decodable, Hashable, Sendable {
        public var principalId: String
        public var name: String
        public var login: String
        public var disabled: Bool

        public init(principalId: String, name: String, login: String, disabled: Bool = false) {
            self.principalId = principalId
            self.name = name
            self.login = login
            self.disabled = disabled
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            principalId = try c.decode(String.self, forKey: .principalId)
            name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? principalId
            login = (try? c.decodeIfPresent(String.self, forKey: .login)) ?? ""
            disabled = (try? c.decodeIfPresent(Bool.self, forKey: .disabled)) ?? false
        }

        private enum CodingKeys: String, CodingKey { case principalId, name, login, disabled }
    }

    public struct Team: Decodable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var managers: [String]
        public var members: [String]

        public init(id: String, name: String, managers: [String] = [], members: [String] = []) {
            self.id = id
            self.name = name
            self.managers = managers
            self.members = members
        }

        public init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decode(String.self, forKey: .id)
            name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? id
            managers = (try? c.decodeIfPresent([String].self, forKey: .managers)) ?? []
            members = (try? c.decodeIfPresent([String].self, forKey: .members)) ?? []
        }

        private enum CodingKeys: String, CodingKey { case id, name, managers, members }
    }

    public var people: [Person]
    public var teams: [Team]

    public init(people: [Person], teams: [Team] = []) {
        self.people = people
        self.teams = teams
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        people = (try? c.decodeIfPresent([Lossy<Person>].self, forKey: .people))?.compactMap(\.value) ?? []
        teams = (try? c.decodeIfPresent([Lossy<Team>].self, forKey: .teams))?.compactMap(\.value) ?? []
    }

    private enum CodingKeys: String, CodingKey { case people, teams }

    public var isEmpty: Bool { people.isEmpty && teams.isEmpty }
}

public struct GrantCandidate: Hashable, Sendable, Identifiable {
    public var target: String
    public var kind: WireGrant.Kind
    public var label: String
    public var detail: String
    public var count: Int?

    public var id: String { target }
}

public enum GrantRules {
    /// `grantEditable`: a manage grant only by those who may give manage.
    public static func editable(_ grant: WireGrant, administer: GrantAdministration?) -> Bool {
        guard let administer else { return false }
        return grant.level.allowed(by: administer.maxLevel)
    }

    /// `grantCandidates`, capped at 20 as the editor shows them.
    public static func candidates(
        _ directory: OrgShareDirectory?, ownerId: String?, taken: [String], query: String,
        administer: GrantAdministration?, limit: Int = 20
    ) -> [GrantCandidate] {
        guard let directory else { return [] }
        let taken = Set(taken)
        let owner = ownerId?.lowercased()
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let limited: Set<String>? = administer.flatMap { $0.any ? nil : Set($0.teamIds) }
        let teams = directory.teams.filter { limited == nil || limited!.contains($0.id) }
        let inTeams: Set<String>? = limited == nil ? nil : Set(teams.flatMap { $0.members + $0.managers })
        var out: [GrantCandidate] = []
        for team in teams {
            let target = "team:\(team.id)"
            if taken.contains(target) || (!q.isEmpty && !team.name.lowercased().contains(q)) { continue }
            out.append(GrantCandidate(target: target, kind: .team, label: team.name, detail: "", count: team.members.count))
        }
        for person in directory.people {
            let target = "user:\(person.principalId)"
            if person.disabled || taken.contains(target) || person.principalId.lowercased() == owner { continue }
            if let inTeams, !inTeams.contains(person.principalId) { continue }
            if !q.isEmpty, ![person.name, person.login].contains(where: { $0.lowercased().contains(q) }) { continue }
            out.append(GrantCandidate(target: target, kind: .user, label: person.name, detail: person.login))
        }
        return Array(out.prefix(limit))
    }

    /// `initialGrantRows`: the bot's own grants labelled from the directory,
    /// shown until the server's answer replaces them.
    public static func initialRows(_ bot: Bot, directory: OrgShareDirectory?) -> [WireGrant] {
        let people = Dictionary((directory?.people ?? []).map { ($0.principalId.lowercased(), $0) }, uniquingKeysWith: { a, _ in a })
        let teams = Dictionary((directory?.teams ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let records: [BotGrantRecord] = bot.grants ?? (bot.directGrants ?? []).map { BotGrantRecord(target: "user:\($0)", level: .use) }
        return records.map { record in
            let team = record.target.hasPrefix("team:")
            let id = String(record.target.dropFirst(5))
            let person = team ? nil : people[id.lowercased()]
            return WireGrant(
                target: record.target,
                level: record.level,
                label: team ? teams[id]?.name ?? id : person?.name ?? id,
                kind: team ? .team : .user,
                disabled: person?.disabled == true ? true : nil
            )
        }
    }

    /// The viewer owns the bot (`isOwner` in SharingSection).
    public static func viewerOwns(_ bot: Bot, viewerPrincipalId: String?) -> Bool {
        guard let viewer = viewerPrincipalId?.lowercased(), !viewer.isEmpty,
              let owner = bot.ownerUserId?.lowercased(), !owner.isEmpty
        else { return false }
        return viewer == owner
    }
}

/// A grant as the bot record carries it.
public struct BotGrantRecord: Codable, Hashable, Sendable {
    public var target: String
    public var level: GrantLevel

    public init(target: String, level: GrantLevel) {
        self.target = target
        self.level = level
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        target = try c.decode(String.self, forKey: .target)
        level = (try? c.decodeIfPresent(GrantLevel.self, forKey: .level)) ?? .use
    }

    private enum CodingKeys: String, CodingKey { case target, level }
}

// MARK: - Perspicax profiles (BA16, PerspicaxSection.tsx)

public struct PerspicaxProfile: Decodable, Hashable, Sendable, Identifiable {
    public var id: String
    public var slug: String
    public var name: String
    public var description: String

    public init(id: String, slug: String = "", name: String, description: String = "") {
        self.id = id
        self.slug = slug
        self.name = name
        self.description = description
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        slug = (try? c.decodeIfPresent(String.self, forKey: .slug)) ?? ""
        name = (try? c.decodeIfPresent(String.self, forKey: .name)) ?? id
        description = (try? c.decodeIfPresent(String.self, forKey: .description)) ?? ""
    }

    private enum CodingKeys: String, CodingKey { case id, slug, name, description }
}

public struct PerspicaxSelected: Decodable, Hashable, Sendable {
    public var profile: PerspicaxProfile
    public var heldByMe: Bool

    public init(profile: PerspicaxProfile, heldByMe: Bool) {
        self.profile = profile
        self.heldByMe = heldByMe
    }

    public init(from decoder: Decoder) throws {
        profile = try PerspicaxProfile(from: decoder)
        let c = try decoder.container(keyedBy: CodingKeys.self)
        heldByMe = (try? c.decodeIfPresent(Bool.self, forKey: .heldByMe)) ?? false
    }

    private enum CodingKeys: String, CodingKey { case heldByMe }
}

/// `GET /api/bots/:id/perspicax`.
public struct PerspicaxAnswer: Decodable, Hashable, Sendable {
    public var selected: [PerspicaxSelected]
    public var available: [PerspicaxProfile]
    public var canEdit: Bool

    public init(selected: [PerspicaxSelected], available: [PerspicaxProfile], canEdit: Bool) {
        self.selected = selected
        self.available = available
        self.canEdit = canEdit
    }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        selected = (try? c.decodeIfPresent([Lossy<PerspicaxSelected>].self, forKey: .selected))?.compactMap(\.value) ?? []
        available = (try? c.decodeIfPresent([Lossy<PerspicaxProfile>].self, forKey: .available))?.compactMap(\.value) ?? []
        canEdit = (try? c.decodeIfPresent(Bool.self, forKey: .canEdit)) ?? false
    }

    private enum CodingKeys: String, CodingKey { case selected, available, canEdit }

    public var selectedIds: [String] { selected.map(\.profile.id) }
}

public struct PerspicaxRow: Hashable, Sendable, Identifiable {
    public var profile: PerspicaxProfile
    public var checked: Bool
    /// Selected, but the viewer does not hold it: checked and disabled.
    public var notHeld: Bool
    public var disabled: Bool

    public var id: String { profile.id }
}

public enum PerspicaxRules {
    /// `perspicaxRows`: every profile the viewer holds, then the selected
    /// ones they do not hold.
    public static func rows(_ answer: PerspicaxAnswer, draft: [String]) -> [PerspicaxRow] {
        let checked = Set(draft)
        var rows = answer.available.map {
            PerspicaxRow(profile: $0, checked: checked.contains($0.id), notHeld: false, disabled: !answer.canEdit)
        }
        let shown = Set(answer.available.map(\.id))
        for selected in answer.selected where !shown.contains(selected.profile.id) && !selected.heldByMe {
            rows.append(PerspicaxRow(profile: selected.profile, checked: checked.contains(selected.profile.id), notHeld: true, disabled: true))
        }
        return rows
    }

    /// The draft after a switch (the desktop appends a newly checked id).
    public static func toggled(_ draft: [String], id: String, on: Bool) -> [String] {
        on ? draft.filter { $0 != id } + [id] : draft.filter { $0 != id }
    }

    /// Order matters, as the desktop compares.
    public static func changed(_ draft: [String], from answer: PerspicaxAnswer) -> Bool {
        draft != answer.selectedIds
    }

    public enum Refusal: String, Sendable {
        case profileNotHeld = "profile_not_held"
        case needsEdit = "needs_edit"
        case unknownProfile = "unknown_profile"
        case failed
    }

    /// The message for a refused save (`perspicaxErrorKey`).
    public static func refusal(code: String?) -> Refusal {
        code.flatMap(Refusal.init(rawValue:)) ?? .failed
    }
}

struct PerspicaxPutBody: Encodable {
    var profiles: [String]
}

/// A refused write's `code`, when the server sends one.
struct APIErrorCodeBody: Decodable {
    var code: String?
}

// MARK: - Visibility (BA14, VisibilitySection.tsx)

/// Who can see a bot on a workspace served to several people.
public enum BotVisibility: Hashable, Sendable, Codable {
    case everyone
    case admins
    case people([String])

    public init(from decoder: Decoder) throws {
        let single = try decoder.singleValueContainer()
        if let word = try? single.decode(String.self) {
            self = word == "admins" ? .admins : .everyone
            return
        }
        struct People: Decodable { var people: [String]? }
        if let object = try? single.decode(People.self) {
            self = .people(object.people ?? [])
            return
        }
        self = .everyone
    }

    public func encode(to encoder: Encoder) throws {
        switch self {
        case .everyone:
            var c = encoder.singleValueContainer()
            try c.encode("everyone")
        case .admins:
            var c = encoder.singleValueContainer()
            try c.encode("admins")
        case let .people(people):
            struct People: Encodable { var people: [String] }
            try People(people: people).encode(to: encoder)
        }
    }

    /// Restricted from its first moment: a copy carries it at creation.
    public var restricted: Bool { self != .everyone }
}

public enum VisibilityMode: String, CaseIterable, Sendable { case everyone, admins, people }

public enum VisibilityRules {
    /// `formFromVisibility`.
    public static func form(_ visibility: BotVisibility?) -> (mode: VisibilityMode, people: String) {
        switch visibility ?? .everyone {
        case .everyone: (.everyone, "")
        case .admins: (.admins, "")
        case let .people(list): (.people, list.joined(separator: "\n"))
        }
    }

    /// `visibilityFromForm`: nil when "only these people" lists nobody.
    public static func value(mode: VisibilityMode, people: String) -> BotVisibility? {
        switch mode {
        case .everyone: return .everyone
        case .admins: return .admins
        case .people:
            var seen = Set<String>()
            let separators = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",;"))
            let entries = people.components(separatedBy: separators)
                .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
                .filter { !$0.isEmpty && seen.insert($0).inserted }
            return entries.isEmpty ? nil : .people(entries)
        }
    }

    /// The form differs from what is saved.
    public static func dirty(mode: VisibilityMode, people: String, saved: BotVisibility?) -> Bool {
        let stored = form(saved)
        return mode != stored.mode || (mode == .people && people.trimmingCharacters(in: .whitespacesAndNewlines)
            != stored.people.trimmingCharacters(in: .whitespacesAndNewlines))
    }
}

extension VisibilityRules {
    /// One audience however it was written: absent is everyone, lists
    /// compare as sets (`audienceKey`).
    public static func key(_ visibility: BotVisibility?) -> String {
        switch visibility ?? .everyone {
        case .everyone: "everyone"
        case .admins: "admins"
        case let .people(list): Set(list.map { $0.trimmingCharacters(in: .whitespaces).lowercased() }).sorted().joined(separator: "\n")
        }
    }

    /// `mixedRooms`: rooms visible to fewer people than this bot (another
    /// bot in them has a different audience, or the room kept a narrower one).
    public static func mixedRooms(_ bot: Bot, rooms: [Room], bots: [Bot]) -> [Room] {
        let mine = key(bot.visibility)
        return rooms.filter { room in
            guard room.dm != true, room.memberIds.contains(bot.id) else { return false }
            if let floor = room.audienceFloor, key(floor) != mine { return true }
            return room.memberIds.contains { id in
                guard id != bot.id, let other = bots.first(where: { $0.id == id }) else { return false }
                return key(other.visibility) != mine
            }
        }
    }
}

struct VisibilityPatchBody: Encodable {
    var visibility: BotVisibility
}

// MARK: - Slack (BA17, useSlackManagement.ts)

public enum SlackRules {
    /// The link to open, or nil for anything but an available https link.
    public static func managementURL(available: Bool?, managementUrl: String?) -> URL? {
        guard available == true, let managementUrl, let url = URL(string: managementUrl),
              url.scheme?.lowercased() == "https", url.host?.isEmpty == false
        else { return nil }
        return url
    }
}

struct SlackManagementAnswer: Decodable {
    var available: Bool?
    var managementUrl: String?
}

// MARK: - Bot email address (B21 / CO5, 2026-10-21)

/// `GET /api/bots/:id/inbound-mail`: the bot's own address, given by the
/// Perspicax relay. `available` false on a solo server, an older
/// Perspicax, or when inbound mail is off.
public struct BotInboundMail: Decodable, Equatable, Sendable {
    public var available: Bool?
    public var address: String?
    public var enabled: Bool?
}

/// What the profile shows: the address (not an id, shown as is) and
/// whether it still waits for the administrator to turn it on (addresses
/// are off by default, JC decision 1 of 2026-10-21).
public struct BotInboundMailRow: Equatable, Sendable {
    public var address: String
    public var waitingForAdmin: Bool
    public init(address: String, waitingForAdmin: Bool) {
        self.address = address
        self.waitingForAdmin = waitingForAdmin
    }
}

public enum BotInboundMailRules {
    /// A row only for an available, well-formed address; nil hides it.
    public static func row(_ answer: BotInboundMail?) -> BotInboundMailRow? {
        guard let answer, answer.available == true, let address = answer.address,
              address.count <= 320, isAddress(address)
        else { return nil }
        return BotInboundMailRow(address: address, waitingForAdmin: answer.enabled != true)
    }

    static func isAddress(_ value: String) -> Bool {
        let parts = value.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2, let local = parts.first, let domain = parts.last,
              (1...64).contains(local.count), (1...253).contains(domain.count)
        else { return false }
        let forbidden = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: "<>()\",;:"))
        guard local.unicodeScalars.allSatisfy({ !forbidden.contains($0) }) else { return false }
        let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-")
        return domain.unicodeScalars.allSatisfy { allowed.contains($0) }
    }
}

// MARK: - Duplicate (BA19, store.tsx duplicateBot)

/// What a copy of a bot carries: the profile fields the desktop copies,
/// limited to the ones this pairing may set (a member's fields; the place
/// and computer fields need an admin session).
public struct BotDuplicatePatch: Encodable, Hashable, Sendable {
    public var name: String
    public var title: String
    public var description: String
    public var soul: String?
    public var notifications: Bool
    public var modelSelection: ModelSelection
    public var avatarUrl: String?
    public var avatarCrop: AvatarCrop?
    public var avatarZoom: Double?
    public var avatarFocusX: Double?
    public var avatarFocusY: Double?
    public var computer: String?
    public var cloudBackend: String?

    /// `soul` comes from `GET /soul` (the fleet omits it). `computerFields`
    /// adds where the bot works, which only an admin session may copy.
    public init(source: Bot, soul: String?, computerFields: Bool) {
        name = "\(source.name) copy"
        title = source.title
        description = source.description
        self.soul = soul
        notifications = source.notifications
        modelSelection = source.modelSelection
        avatarUrl = source.avatarUrl
        avatarCrop = source.avatarCrop
        avatarZoom = source.avatarZoom
        avatarFocusX = source.avatarFocusX
        avatarFocusY = source.avatarFocusY
        computer = computerFields ? source.computer : nil
        cloudBackend = computerFields ? source.cloudBackend : nil
    }
}

struct DuplicateCreateBody: Encodable {
    var visibility: BotVisibility?
}

// MARK: - Model variants (BA7, ModelPicker.tsx ModelVariantRow)

public enum ModelVariantRules {
    /// The variants offered for the selection's model (the catalog's; the
    /// desktop prefers a live session's report, which the phone does not get).
    public static func options(for selection: ModelSelection, instances: [Instance]) -> [ModelVariantOption]? {
        guard let instance = instances.first(where: { $0.instanceId == selection.instanceId }),
              instance.capabilities?.modelVariants == true
        else { return nil }
        let options = instance.models.options.first { $0.id == selection.model }?.variants ?? []
        if options.isEmpty, selection.variant == nil { return nil }
        return options
    }

    /// The saved variant is not among the offered ones.
    public static func missing(_ selection: ModelSelection, options: [ModelVariantOption]) -> Bool {
        guard let variant = selection.variant else { return false }
        return !options.contains { $0.id == variant }
    }

    /// `variantLabel`.
    public static func label(_ option: ModelVariantOption) -> String {
        option.id == "default" ? "OpenCode default" : option.label
    }

    /// A pick (or nil to clear) drops the effort, as the desktop does.
    public static func choosing(_ variant: String?, in selection: ModelSelection) -> ModelSelection {
        ModelSelection(instanceId: selection.instanceId, model: selection.model, effort: nil, variant: variant)
    }
}

// MARK: - Access (BA6, AccessSection.tsx), read-only on a phone

public enum AccessRules {
    /// `mcpServersForBot`: the enabled servers, narrowed by the bot's own list.
    public static func mounted(_ all: [MCPServerListing], own: [String]?) -> [MCPServerListing] {
        let enabled = all.filter { $0.enabled != false }
        guard let own else { return enabled }
        return enabled.filter { own.contains($0.name) }
    }

    /// The bot's list after one switch: absent means every enabled server,
    /// so the first switch writes an explicit list.
    public static func toggledMcp(_ all: [MCPServerListing], own: [String]?, name: String) -> [String] {
        var current = own ?? all.filter { $0.enabled != false }.map(\.name)
        if current.contains(name) { current.removeAll { $0 == name } } else { current.append(name) }
        return current
    }
}

/// An admin's Access patch (`PATCH /api/bots/:id`); nil fields are left out.
public struct BotAccessPatch: Encodable, Hashable, Sendable {
    public var browser: Bool?
    public var alwaysAllow: [String]?
    public var mcpServers: [String]?
    public var memoryEnabled: Bool?
    public var memoryUpkeep: Bool?

    public init(browser: Bool? = nil, alwaysAllow: [String]? = nil, mcpServers: [String]? = nil,
                memoryEnabled: Bool? = nil, memoryUpkeep: Bool? = nil) {
        self.browser = browser
        self.alwaysAllow = alwaysAllow
        self.mcpServers = mcpServers
        self.memoryEnabled = memoryEnabled
        self.memoryUpkeep = memoryUpkeep
    }
}

// MARK: - Command allowlist (BA9, CommandAllowlistDialog.tsx)

struct CommandAllowAddBody: Encodable {
    var command: String
    var cwd: String
    var providerInstanceId: String
}

public enum CommandAllowRules {
    /// Add is offered only with a command, a folder and a provider that
    /// can use saved approvals.
    public static func canAdd(command: String, cwd: String, list: CommandAllowlist?) -> Bool {
        guard let list, list.supported, list.context != nil else { return false }
        return !command.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !cwd.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }
}

// Display hygiene (iOS bot-edit lot 8, 2026-11-01): nothing a person reads
// on the bot's pages shows a UUID/GUID or other opaque id. Phrases use
// field names, people and places; ids and sizes stay behind a disclosure
// with Copy. Mirrors shared/human-id.ts for paths and opaque ids.
import Foundation

public enum DisplayHygiene {
    /// A UUID/GUID, whole or cut short (its first three groups are enough).
    public static let uuidFragment = try! NSRegularExpression(
        pattern: "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}(?:-[0-9a-f]{0,4}(?:-[0-9a-f]{0,12})?)?",
        options: [.caseInsensitive]
    )

    /// Whether `text` shows a UUID/GUID anywhere, whole or truncated.
    public static func containsUuid(_ text: String) -> Bool {
        let range = NSRange(text.startIndex..., in: text)
        return uuidFragment.firstMatch(in: text, range: range) != nil
    }

    /// Whether `value` is an id a person cannot read (a UUID, a long hex, a
    /// prefixed random id), as opposed to a name.
    public static func isOpaqueId(_ value: String) -> Bool {
        ActionJournal.isOpaqueID(value)
    }

    // MARK: - History phrases

    /// A field's name in words ("Instructions", "Name").
    public static func historyField(_ field: String) -> String {
        switch field {
        case "soul": String(localized: "Instructions")
        case "name": String(localized: "Name")
        case "title": String(localized: "Label")
        case "description": String(localized: "Description")
        case "cwd": String(localized: "Working folder")
        case "notifications": String(localized: "Notifications")
        case "speakReplies": String(localized: "Read replies aloud")
        default: field
        }
    }

    /// Who changed it ("You", the bot's name, "An import").
    public static func historyWho(_ actor: String, botName: String) -> String {
        switch actor.lowercased() {
        case "user", "you":
            return String(localized: "You")
        case "bot":
            let name = botName.trimmingCharacters(in: .whitespacesAndNewlines)
            return name.isEmpty || isOpaqueId(name) ? String(localized: "The bot") : name
        case "file":
            return String(localized: "A file change")
        case "import":
            return String(localized: "An import")
        case "system":
            return "Sagax"
        default:
            return isOpaqueId(actor) ? String(localized: "Someone") : actor
        }
    }

    /// How it was changed, without ids ("approval card", "phone", "API").
    public static func historyVia(_ via: String) -> String {
        let trimmed = via.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("card:") { return String(localized: "approval card") }
        switch trimmed.lowercased() {
        case "ui", "desktop":
            return String(localized: "desktop")
        case "phone", "ios", "android":
            return String(localized: "phone")
        case "api":
            return String(localized: "API")
        case "restore", "rollback":
            return String(localized: "version restored")
        case "migration":
            return String(localized: "a migration")
        case "":
            return String(localized: "the app")
        default:
            if containsUuid(trimmed) || isOpaqueId(trimmed) {
                return String(localized: "the app")
            }
            return trimmed
        }
    }

    /// The readable history line: "Instructions changed by Osprey, approval
    /// card, Oct 21". Ids and byte sizes stay out of this string.
    public static func historyPhrase(_ row: BotHistoryRow, botName: String, now: Date = Date()) -> String {
        let who = historyWho(row.actor, botName: botName)
        let via = historyVia(row.via)
        let when = historyWhen(row.at, now: now)
        if row.field == "soul" {
            return String(localized: "Instructions changed by \(who), \(via), \(when)")
        }
        let field = historyField(row.field)
        return String(localized: "\(field) changed by \(who), \(via), \(when)")
    }

    /// Detail lines for the disclosure under a history row (id, raw via,
    /// server summary with sizes). Each may be copied; none of them are
    /// required reading.
    public static func historyDetails(_ row: BotHistoryRow) -> [(label: String, value: String)] {
        var out: [(String, String)] = []
        let id = row.id.trimmingCharacters(in: .whitespacesAndNewlines)
        if !id.isEmpty {
            out.append((String(localized: "Change id"), id))
        }
        let via = row.via.trimmingCharacters(in: .whitespacesAndNewlines)
        if !via.isEmpty, via != historyVia(via) || containsUuid(via) || via.hasPrefix("card:") {
            out.append((String(localized: "Via"), via))
        }
        let summary = row.summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if !summary.isEmpty {
            out.append((String(localized: "Details"), summary))
        }
        return out
    }

    /// The time today, the day otherwise (same shape as BotAdvancedWording.when).
    public static func historyWhen(_ at: Double, now: Date = Date()) -> String {
        let date = Date(timeIntervalSince1970: at / 1000)
        if Calendar.current.isDate(date, inSameDayAs: now) {
            return date.formatted(date: .omitted, time: .shortened)
        }
        return date.formatted(.dateTime.month(.abbreviated).day())
    }

    // MARK: - Memory paths

    /// A workspace path with Sagax-made id folders folded to a short label
    /// ("this bot's folder", …). Other paths keep their last readable parts;
    /// a full opaque path becomes "On this computer".
    public static func displayWorkspacePath(_ path: String) -> String {
        let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return "" }
        if let folder = sagaxFolder(trimmed) {
            switch folder.kind {
            case .bot:
                return folder.rest.isEmpty
                    ? String(localized: "This bot's folder")
                    : String(localized: "This bot's folder / \(folder.rest.joined(separator: "/"))")
            case .conversation:
                return folder.rest.isEmpty
                    ? String(localized: "This conversation's folder")
                    : String(localized: "This conversation's folder / \(folder.rest.joined(separator: "/"))")
            case .parallel:
                return folder.rest.isEmpty
                    ? String(localized: "A parallel task's folder")
                    : String(localized: "A parallel task's folder / \(folder.rest.joined(separator: "/"))")
            }
        }
        if containsUuid(trimmed) {
            let parts = trimmed.split(whereSeparator: { $0 == "/" || $0 == "\\" }).map(String.init)
            let readable = parts.filter { !isOpaqueId($0) && !containsUuid($0) }
            if let last = readable.last, !last.isEmpty { return last }
            return String(localized: "On this computer")
        }
        return trimmed
    }

    public enum SagaxFolderKind: Equatable, Sendable {
        case conversation, parallel, bot
    }

    /// Which Sagax-made folder `path` is in, and the path below it.
    public static func sagaxFolder(_ path: String) -> (kind: SagaxFolderKind, rest: [String])? {
        let parts = path
            .trimmingCharacters(in: CharacterSet(charactersIn: "/\\"))
            .split(whereSeparator: { $0 == "/" || $0 == "\\" })
            .map(String.init)
            .filter { !$0.isEmpty }
        for index in stride(from: parts.count - 1, through: 0, by: -1) {
            let part = parts[index]
            if (part == "task-workspaces" || part == "parallel-worktrees"),
               index + 2 < parts.count,
               isOpaqueId(parts[index + 2]) {
                return (
                    kind: part == "task-workspaces" ? .conversation : .parallel,
                    rest: Array(parts.suffix(from: index + 3))
                )
            }
            if part == "workspaces", index + 1 < parts.count, isOpaqueId(parts[index + 1]) {
                return (kind: .bot, rest: Array(parts.suffix(from: index + 2)))
            }
        }
        return nil
    }

    // MARK: - Skills

    /// A skill's readable title: its description when present, else the slug
    /// with dashes turned into spaces.
    public static func skillTitle(_ skill: ManagedSkill) -> String {
        let detail = skill.description.trimmingCharacters(in: .whitespacesAndNewlines)
        if !detail.isEmpty {
            if let first = detail.split(whereSeparator: \.isNewline).first {
                return String(first).trimmingCharacters(in: .whitespacesAndNewlines)
            }
            return detail
        }
        return skill.name.replacingOccurrences(of: "-", with: " ")
    }

    /// The slug shown as a discreet subline under the title.
    public static func skillSlug(_ skill: ManagedSkill) -> String {
        skill.name
    }
}

// Which bot a folder of the Memory explorer belongs to (desktop
// src/lib/memory-folders.ts, 2026-11-03), so a row can say it and its menu
// can offer to delete a folder no bot is linked to.
//   - A bot's own memory is linked to that bot while it is a current bot:
//     the sources route lists only bots, and marks a temporary agent's
//     memory `linked: false`.
//   - A Perspicax folder `sagax-<bot>` is that bot's memory as
//     scripts/memory/import-local.py imports it: linked to the bot of that
//     name while it exists.
//   - A team section's folders belong to no bot; the bots of the section
//     read them, which the menu says.
// What uses a linked bot's memory: its routines, by name.
import Foundation

public struct LinkBot: Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    public var color: String?
    public var avatarUrl: String?
    public var avatarCrop: String?
    public var section: String?
    public var hidden: Bool

    public init(id: String, name: String, color: String? = nil, avatarUrl: String? = nil, avatarCrop: String? = nil, section: String? = nil, hidden: Bool = false) {
        self.id = id
        self.name = name
        self.color = color
        self.avatarUrl = avatarUrl
        self.avatarCrop = avatarCrop
        self.section = section
        self.hidden = hidden
    }

    public init(_ bot: Bot) {
        self.init(id: bot.id, name: bot.name, color: bot.color, avatarUrl: bot.avatarUrl, avatarCrop: bot.avatarCrop?.rawValue, section: bot.section, hidden: bot.hidden ?? false)
    }
}

public struct LinkRoutine: Hashable, Sendable {
    public var name: String
    public var botId: String

    public init(name: String, botId: String) {
        self.name = name
        self.botId = botId
    }

    public init(_ routine: Routine) {
        self.init(name: routine.name, botId: routine.botId)
    }
}

public struct FolderLink: Hashable, Sendable {
    /// The bots this folder is the memory of (empty: not linked).
    public var bots: [LinkBot]
    /// The routines of those bots, by name.
    public var routines: [String]
    /// Bots that read it without owning it (a team section's).
    public var readBy: [String]

    public init(bots: [LinkBot] = [], routines: [String] = [], readBy: [String] = []) {
        self.bots = bots
        self.routines = routines
        self.readBy = readBy
    }

    public static let unlinked = FolderLink()
}

/// Why "Delete folder..." is greyed, when it is.
public enum FolderDeleteBlock: Hashable, Sendable {
    /// A bot is linked: remove or archive the bot first.
    case linked(bots: String)
    /// A built-in group of team memory.
    case teamKind
    /// The person can read the folder, not change it.
    case readOnly
}

public enum MemoryFolders {
    private static func routines(of bots: [LinkBot], _ all: [LinkRoutine]) -> [String] {
        let ids = Set(bots.map(\.id))
        var seen = Set<String>()
        var out: [String] = []
        for routine in all where ids.contains(routine.botId) && seen.insert(routine.name).inserted { out.append(routine.name) }
        return out
    }

    /// A bot's memory folder (a bot source of the page).
    public static func botSourceLink(_ source: MemoryManagerSource, bots: [LinkBot], routines all: [LinkRoutine]) -> FolderLink {
        if source.kind != .bot || source.linked == false { return .unlinked }
        // The server lists only current bots the person reaches; the page's own list gives its look.
        let id = source.botId ?? source.id
        let bot = bots.first { $0.id == source.botId } ?? LinkBot(id: id, name: source.name)
        return FolderLink(bots: [bot], routines: routines(of: [bot], all), readBy: [])
    }

    /// Lowercase ASCII words joined by hyphens.
    public static func slug(_ text: String) -> String {
        ObsidianVault.fold(text).lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .replacingOccurrences(of: "^-+|-+$", with: "", options: .regularExpression)
    }

    /// A Perspicax folder: `sagax-<bot>` is that bot's imported memory.
    public static func pxFolderLink(_ folder: String, bots: [LinkBot], routines all: [LinkRoutine]) -> FolderLink {
        guard folder.hasPrefix("sagax-"), folder.count > "sagax-".count else { return .unlinked }
        let name = String(folder.dropFirst("sagax-".count))
        let linked = bots.filter { !$0.hidden && (slug($0.name) == name || $0.id.lowercased() == name) }
        return linked.isEmpty ? .unlinked : FolderLink(bots: linked, routines: routines(of: linked, all), readBy: [])
    }

    /// A team section's folder: no bot owns it; the section's bots read it.
    public static func teamFolderLink(section: String, bots: [LinkBot]) -> FolderLink {
        FolderLink(bots: [], routines: [], readBy: bots.filter { !$0.hidden && ($0.section ?? "") == section }.map(\.name))
    }

    public static func isLinked(_ link: FolderLink) -> Bool { !link.bots.isEmpty }

    /// The names a "Linked to" line shows, in order.
    public static func botNames(_ link: FolderLink) -> String { link.bots.map(\.name).joined(separator: ", ") }

    /// What greys "Delete folder...": a linked bot first, then the folder's kind, then the person's rights; nil when it can go.
    public static func deleteBlock(link: FolderLink, isTeam: Bool, mayWrite: Bool) -> FolderDeleteBlock? {
        if isLinked(link) { return .linked(bots: botNames(link)) }
        if isTeam { return .teamKind }
        return mayWrite ? nil : .readOnly
    }
}

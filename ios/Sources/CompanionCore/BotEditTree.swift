// Edit bot as one Grok-style page (lots 2 and 3, 2026-11-01): name, role,
// description, appearance and voice calls sit on the root; Instructions,
// Skills, Memory, Model, Approvals, Tools and apps, Routines, Sharing and
// Advanced are one tap away. The Identity and Personality intermediate
// pages are gone from the walk. Tools and apps opens Access directly.
// Voice & alerts is a disclosure under Voice calls (not a second page);
// Notifications lives only on the bot profile.
//
// Which rows show comes from `DesktopPanelSection.visible` (SurfaceGate,
// the bot's owner included) and the bot's own Archive gate: nothing here
// adds an admin check. A test checks that every field and action Edit bot
// had before this layout still has a place.
import Foundation

/// A page of the tree that lists rows.
public enum BotEditPageID: String, CaseIterable, Hashable, Sendable {
    case root, identity, personality, toolsApps, sharing, advanced
}

/// A row of the tree. Rows that open a tree page name it in `opens`; rows
/// that open a section's page name it in `section`.
public enum BotEditItem: String, CaseIterable, Hashable, Sendable {
    // Root (and former Identity fields drawn on the root)
    case header
    case identity, personality, model, approvals, toolsApps, routines, sharing
    case advanced
    case archive, delete
    // Identity fields (on the root after lot 2)
    case name, role, botDescription, avatar
    case callVoice, callSpeed, callLanguage, voiceAlerts
    // Personality (on the root after lot 2)
    case soul, skills, memory
    // Tools and apps (Access is opened by toolsApps; computer / Slack stay as rows)
    case computer, access, slack
    // Sharing
    case sharedWith, whoCanSee
    // Advanced
    case overview, usage, changes

    /// The tree page this row opens, if it opens one.
    public var opens: BotEditPageID? {
        switch self {
        // Identity and Personality are drawn on the root (lot 2); their
        // pages stay in the enum for deep-link compatibility only.
        case .sharing: .sharing
        case .advanced: .advanced
        default: nil
        }
    }

    /// The editor section whose page this row opens (or whose control it is).
    public var section: DesktopPanelSection? {
        switch self {
        case .model: .model
        case .approvals: .permissions
        // Tools and apps opens Access directly (lot 2); the intermediate
        // Tools page is no longer in the walk.
        case .toolsApps, .access: .access
        case .voiceAlerts: .voice
        case .soul: .soul
        case .skills: .skills
        case .memory: .memory
        case .computer: .worksOn
        case .slack: .slack
        case .sharedWith: .sharing
        case .whoCanSee: .visibility
        case .overview: .overview
        case .usage: .usage
        case .changes: .history
        default: nil
        }
    }

    /// Archive and Delete: drawn apart, in red, under everything else.
    public var destructive: Bool { self == .archive || self == .delete }
}

/// What decides which rows show: the sections this pairing reaches for the
/// bot, and the bot's own Archive and Delete gates.
public struct BotEditContext: Equatable, Sendable {
    public var sections: Set<DesktopPanelSection>
    public var archive: Bool
    public var delete: Bool

    public init(sections: some Sequence<DesktopPanelSection>, archive: Bool, delete: Bool) {
        self.sections = Set(sections)
        self.archive = archive
        self.delete = delete
    }

    /// The context for a pairing and a bot (`slack`: the server answered a
    /// link to the bot's Slack app).
    public init(gate: SurfaceGate, bot: Bot, slack: Bool = false) {
        self.init(
            sections: DesktopPanelSection.visible(gate: gate, slack: slack, bot: bot),
            archive: gate.allows(.archiveBot, bot: bot),
            delete: gate.allows(.botOwnerExtras, bot: bot)
        )
    }

    /// Everything on: the tree at its fullest.
    public static let everything = BotEditContext(sections: DesktopPanelSection.allCases, archive: true, delete: true)
}

public enum BotEditTree {
    /// A page's cards, top to bottom, each a list of rows; empty cards are dropped.
    public static func cards(_ page: BotEditPageID, _ c: BotEditContext) -> [[BotEditItem]] {
        let all: [[BotEditItem]]
        switch page {
        case .root:
            // Grok-style Edit (lots 2 and 3): fields and voice on the root,
            // then Sagax rows at one tap. Delete moved to the profile menu (lot 6).
            all = [
                [.name, .role, .botDescription],
                [.avatar],
                [.callVoice, .callSpeed, .callLanguage],
                [.voiceAlerts],
                [.soul, .skills, .memory, .model, .approvals, .toolsApps, .computer, .slack, .routines, .sharing],
                [.advanced],
                [.archive],
            ]
        case .identity:
            // Kept for deep links and the iPad editor that still pushes this
            // page; the phone root already draws these cards and does not
            // walk here.
            all = [
                [.name, .role, .botDescription],
                [.avatar],
                [.callVoice, .callSpeed, .callLanguage],
                [.voiceAlerts],
            ]
        case .personality:
            // Kept for deep links; soul / skills / memory sit on the root.
            all = [[.soul], [.skills, .memory]]
        case .toolsApps:
            // Intermediate page retired (lot 2): Access opens from the root
            // Tools and apps row; computer / Slack are root rows.
            all = []
        case .sharing:
            all = [[.sharedWith, .whoCanSee]]
        case .advanced:
            all = [[.overview], [.usage, .changes]]
        }
        return all.map { $0.filter { shows($0, c) } }.filter { !$0.isEmpty }
    }

    /// Whether a row shows in this context: a page row when its page lists
    /// something, a section row when the section is reachable.
    public static func shows(_ item: BotEditItem, _ c: BotEditContext) -> Bool {
        if let page = item.opens, item != .header { return !cards(page, c).isEmpty }
        // Computer is its own row when Works on is its own section; Access
        // (via Tools and apps) holds it otherwise. The Access leaf row is
        // not drawn: Tools and apps opens that page.
        if item == .access { return false }
        if item == .computer { return c.sections.contains(.worksOn) }
        if let section = item.section { return c.sections.contains(section) }
        switch item {
        case .archive: return c.archive
        case .delete: return false // profile menu (lot 6); kept in the enum
        case .header, .identity, .personality: return false // retired from the root walk
        default: return true
        }
    }

    /// Every row reachable from the root in this context, with the pages
    /// that lead to it (root excluded), in drawing order.
    public static func reachable(_ c: BotEditContext) -> [(item: BotEditItem, path: [BotEditPageID])] {
        var out: [(BotEditItem, [BotEditPageID])] = []
        var seen = Set<BotEditItem>()
        func walk(_ page: BotEditPageID, _ path: [BotEditPageID]) {
            for item in cards(page, c).joined() {
                if !seen.insert(item).inserted { continue }
                out.append((item, path))
                if let next = item.opens, !path.contains(next) { walk(next, path + [next]) }
            }
        }
        walk(.root, [])
        return out
    }

    /// The pages to open, outermost first, to show `item` (empty: the root).
    public static func path(to item: BotEditItem, _ c: BotEditContext = .everything) -> [BotEditPageID]? {
        reachable(c).first { $0.item == item }?.path
    }

    /// The pages to open to reach a section's page (a deep link: a
    /// suggestion, Share, an edit rule's Access). Nil when no row opens it.
    public static func path(to section: DesktopPanelSection, _ c: BotEditContext = .everything) -> [BotEditPageID]? {
        reachable(c).first { $0.item.section == section }?.path
    }

    /// The row a section's page belongs to.
    public static func item(for section: DesktopPanelSection) -> BotEditItem? {
        // Prefer the root Tools and apps row over the retired Access leaf.
        if section == .access { return .toolsApps }
        return BotEditItem.allCases.first { $0.section == section && $0 != .access }
    }
}

/// The short line at the end of a main row (the wizard's recap, `recapLines`
/// on the desktop and `RecapLine` on iOS): same words, read from the bot.
public enum BotEditSummary {
    /// Identity: the role (the bot's label), empty when it has none; the
    /// app adds Primary Bot after it, as the recap does.
    public static func role(_ bot: Bot) -> String {
        bot.title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Personality: whether a soul is written (its lead comes with the bot).
    public static func soulWritten(_ bot: Bot) -> Bool {
        !(bot.instructionsLead ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Approvals: the bot's own rules by effect (asked, denied, allowed),
    /// the rules that apply to every bot left out.
    public static func ruleCounts(_ rules: [CustomRuleRow], botId: String) -> (ask: Int, deny: Int, allow: Int) {
        var counts = (ask: 0, deny: 0, allow: 0)
        for rule in rules where rule.enabled && rule.botId == botId {
            switch rule.behavior {
            case .ask: counts.ask += 1
            case .deny: counts.deny += 1
            case .allow: counts.allow += 1
            }
        }
        return counts
    }

    /// Tools and apps: where it works (Off, or Auto for every other place,
    /// as the wizard's "Workspace") and its MCP servers.
    public enum MCP: Equatable, Sendable {
        case all, none, some([String])
    }

    public static func workspaceOff(_ bot: Bot) -> Bool { bot.computer == "off" }

    public static func mcp(_ servers: [String]?) -> MCP {
        guard let servers else { return .all }
        return servers.isEmpty ? .none : .some(servers)
    }

    /// Routines: the bot's own, by name, in the list's order.
    public static func routineNames(botId: String, in routines: [Routine]) -> [String] {
        DesktopRoutineList.of(botId: botId, in: routines).map(\.name)
    }

    /// A readable model name for a recap line. Uses a catalog label when
    /// one is offered; otherwise turns `grok-4.5` into `Grok 4.5`.
    public static func modelName(_ selection: ModelSelection, label: String? = nil) -> String {
        if let label {
            let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        let id = selection.model.trimmingCharacters(in: .whitespacesAndNewlines)
        if id.isEmpty { return String(localized: "Default") }
        return friendlyModelId(id)
    }

    /// `grok-4.5` -> `Grok 4.5`, `claude-sonnet-4` -> `Claude Sonnet 4`.
    public static func friendlyModelId(_ id: String) -> String {
        id.split(separator: "-").map { part in
            let s = String(part)
            if s.isEmpty { return s }
            if s.allSatisfy({ $0.isNumber || $0 == "." }) { return s }
            return s.prefix(1).uppercased() + s.dropFirst()
        }.joined(separator: " ")
    }
}

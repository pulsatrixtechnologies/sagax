// iPad I2b: what the desktop sidebar's foot shows (src/components/Sidebar.tsx
// `places`, SidebarPlaces.tsx, achievements/Gamertag.tsx), as rules the
// iPad's `DesktopSidebarFooter` reads and the tests pin.
//
// - Team map and Automations are not sidebar places on iOS. They live in
//   the avatar popup, under Settings (`NavigationMenus.accountShortcuts`).
// - Templates is experimental: it shows only once Settings > Experimental
//   features switches it on (`templatesEnabled` in src/lib/feature-flags.ts),
//   and only for a pairing allowed to open it.
// - The gamertag (a trophy and the points) shows under the name when the
//   server keeps achievements, the snapshot is read and the person did not
//   turn "Show my points" off.
import Foundation

public enum DesktopSidebarPlace: String, CaseIterable, Sendable {
    case teamMap = "team-map"
    case automations
    case templates
}

public enum DesktopSidebarPlaces {
    /// The places in the desktop's order.
    public static func visible(
        connected: Bool,
        gate: SurfaceGate,
        templatesOn: Bool
    ) -> [DesktopSidebarPlace] {
        guard connected else { return [] }
        var out: [DesktopSidebarPlace] = []
        // Browse Bots took the Templates place (#253, #259), same switch
        if templatesOn, gate.allows(.browseBots) { out.append(.templates) }
        return out
    }

    /// The same, from the server's experimental switches.
    public static func visible(connected: Bool, gate: SurfaceGate, features: ServerFeatures?) -> [DesktopSidebarPlace] {
        visible(
            connected: connected,
            gate: gate,
            templatesOn: features?.templates == true
        )
    }

    /// `gamertagText`: the points as the person's language groups them, or
    /// nil when the line stays hidden.
    public static func gamertag(ready: Bool, snapshot: AchievementSnapshot?, locale: Locale = .current) -> String? {
        guard ready, let snapshot, snapshot.settings.showPoints else { return nil }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.locale = locale
        return formatter.string(from: NSNumber(value: snapshot.points)) ?? String(snapshot.points)
    }
}

/// The sidebar's edge (`sidebarDragTarget`, src/lib/sidebar-preferences.ts):
/// a drag narrower than the snap width collapses it to the 80 pt rail, past
/// it the width is held to 240 to 400. There is no collapse button: the
/// edge (drag, double tap), ⌘\ and Settings > Appearance go in and out.
public enum DesktopSidebarEdge {
    public static let railWidth: Double = 80
    public static let minWidth: Double = 240
    public static let maxWidth: Double = 400
    public static let defaultWidth: Double = 280
    public static let snapWidth: Double = 180

    public enum Target: Equatable, Sendable {
        case collapsed
        case expanded(width: Double)
    }

    /// Where a drag lands; `raw` is the width under the finger (the width
    /// the drag started from plus its travel, 80 from the rail).
    public static func target(raw: Double) -> Target {
        guard raw.isFinite, raw >= snapWidth else { return .collapsed }
        return .expanded(width: (min(maxWidth, max(minWidth, raw))).rounded())
    }

    /// A stored width, or the default when it is missing or out of range.
    public static func clamped(_ stored: Double?) -> Double {
        guard let stored, stored.isFinite else { return defaultWidth }
        return min(maxWidth, max(minWidth, stored))
    }
}

/// The bot menu's Archive (`archiveBlocked` in Sidebar.tsx): the Primary Bot
/// and the last active bot stay; an archived bot is restored from the
/// account menu's Archived bots.
public enum DesktopBotArchive {
    public enum Block: Equatable, Sendable { case primary, last }

    public static func block(_ bot: Bot, in bots: [Bot]) -> Block? {
        if bot.chiefOfStaff == true { return .primary }
        if bots.filter({ $0.hidden != true }).count <= 1 { return .last }
        return nil
    }

    /// The archived bots, by name.
    public static func archived(_ bots: [Bot]) -> [Bot] {
        bots.filter { $0.hidden == true }.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }
}

/// The sidebar's New: the inline "To:" picker (src/components/ComposeToPicker.tsx).
/// Browse lists Create new Bot and Create a bot with the wizard (when the
/// viewer may), Create group chat,
/// then the viewer's own active bots matching the query; group mode keeps
/// the confirm row and the bots. ⌘1 to ⌘9 pick the first nine rows.
public enum DesktopComposeTo {
    public enum Mode: Equatable, Sendable { case browse, group }
    public enum Row: Equatable, Sendable {
        /// Create new Bot (the quick creation) and, beside it, Create a bot
        /// with the wizard (ComposeToPicker.tsx, 2026-10-26).
        case createBot, createBotWizard, createGroup
        case bot(String)
        /// A person of the organization (browse mode only): the direct
        /// conversation with them (ComposeToPicker.tsx `composePeople`).
        case person(String)
    }

    /// `state.bots` without archived bots and other people's, matching the
    /// query on name, title and description.
    public static func bots(_ bots: [Bot], viewerId: String, query: String) -> [Bot] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return bots.filter { bot in
            bot.hidden != true && PrimaryBotRules.viewerOwns(bot, viewerId: viewerId)
                && (q.isEmpty || "\(bot.name) \(bot.title) \(bot.description)".lowercased().contains(q))
        }
    }

    /// `COMPOSE_RESULT_LIMIT`: at most six results (bots and people
    /// together) under the create rows.
    public static let resultLimit = 6

    /// `composeRows`: the create rows first, then at most `resultLimit`
    /// results, the bots then the people (browse mode only). With a query
    /// the matches are ranked best first (`matchRank`), ties keeping that
    /// order; the shortcuts follow the visible rows.
    public static func rows(mode: Mode, bots: [Bot], canCreateBots: Bool, people: [OrgDirectoryPerson] = [], query: String = "") -> [Row] {
        var results: [(row: Row, name: String)] = bots.map { (Row.bot($0.id), $0.name) }
        if mode == .browse { results += people.map { (Row.person($0.principalId), $0.name.isEmpty ? $0.login : $0.name) } }
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if !q.isEmpty {
            // Typed step by step: one chain of untyped closures here took
            // the compiler seconds to type-check.
            typealias Ranked = (index: Int, rank: Int, item: (row: Row, name: String))
            let ranked: [Ranked] = results.indices.map { (index: Int) -> Ranked in
                (index: index, rank: matchRank(results[index].name, q), item: results[index])
            }
            let ordered: [Ranked] = ranked.sorted { (a: Ranked, b: Ranked) -> Bool in
                a.rank != b.rank ? a.rank < b.rank : a.index < b.index
            }
            results = ordered.map { (entry: Ranked) -> (row: Row, name: String) in entry.item }
        }
        let shown = results.prefix(resultLimit).map(\.row)
        if mode == .group { return [.createGroup] + shown }
        return (canCreateBots ? [.createBot, .createBotWizard] : []) + [.createGroup] + shown
    }

    /// 0 the name starts with the query, 1 a word of it does, 2 it matches elsewhere.
    static func matchRank(_ name: String, _ query: String) -> Int {
        let text = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if text.hasPrefix(query) { return 0 }
        let words = text.split(whereSeparator: { " \t._@-".contains($0) })
        return words.contains { $0.hasPrefix(query) } ? 1 : 2
    }

    /// Arrow keys wrap around the rows.
    public static func move(_ cursor: Int, by step: Int, count: Int) -> Int {
        guard count > 0 else { return 0 }
        return ((min(cursor, count - 1) + step) % count + count) % count
    }
}

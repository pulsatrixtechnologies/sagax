// iPad lot 3 (2026-11-03): the desktop's command palette (⌘K,
// src/components/CommandPalette.tsx, src/lib/palette-commands.ts and
// src/lib/palette-rank.ts) as rules the iPad's palette reads and the tests
// pin: the group order, Recent (at most five, taken out of their groups),
// and the ranking tiers (prefix, word start, substring, search word, letters
// in order), each group keeping its own order within a tier.
import Foundation

public enum DesktopPaletteGroup: String, CaseIterable, Sendable {
    case recent, conversations, bots, messages, navigation, settings, help
}

/// One row of the palette. The caller writes the labels (localized) and
/// says what a row does; the palette only orders and filters.
public struct DesktopPaletteItem<Action: Sendable>: Identifiable, Sendable {
    public var id: String
    public var group: DesktopPaletteGroup
    public var label: String
    public var detail: String?
    /// Search words beside the label (the group's name, keywords).
    public var words: [String]
    /// Keycaps at the trailing edge ("⌘", "1").
    public var shortcut: [String]
    public var action: Action

    public init(id: String, group: DesktopPaletteGroup, label: String, detail: String? = nil, words: [String] = [],
                shortcut: [String] = [], action: Action) {
        self.id = id
        self.group = group
        self.label = label
        self.detail = detail
        self.words = words
        self.shortcut = shortcut
        self.action = action
    }
}

public enum DesktopPalette {
    /// `PALETTE_RECENT_LIMIT`.
    public static let recentLimit = 5

    /// `foldForSearch`: lowercased, accents folded.
    public static func fold(_ text: String) -> String {
        text.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "en_US_POSIX")).lowercased()
    }

    /// `paletteMatchTier`: 0 prefix, 1 start of a word, 2 substring, 3 a
    /// search word contains it, 4 its letters in order; nil for no match.
    public static func tier(label: String, query: String, words: [String] = []) -> Int? {
        let q = fold(query.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !q.isEmpty else { return 0 }
        let name = fold(label)
        if name.hasPrefix(q) { return 0 }
        let separators = CharacterSet(charactersIn: " :/·,()-").union(.whitespaces)
        if name.components(separatedBy: separators).contains(where: { $0.hasPrefix(q) }) { return 1 }
        if name.contains(q) { return 2 }
        if words.contains(where: { fold($0).contains(q) }) { return 3 }
        let compact = Array(q.replacingOccurrences(of: " ", with: ""))
        var at = 0
        for char in name where at < compact.count && char == compact[at] { at += 1 }
        return at == compact.count && !compact.isEmpty ? 4 : nil
    }

    /// `rankFuzzy`: the matching items by tier, the input order kept within one.
    public static func rank<Action>(_ items: [DesktopPaletteItem<Action>], query: String) -> [DesktopPaletteItem<Action>] {
        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return items }
        var tiers: [[DesktopPaletteItem<Action>]] = Array(repeating: [], count: 5)
        for item in items {
            if let tier = tier(label: item.label, query: query, words: item.words) { tiers[tier].append(item) }
        }
        return tiers.flatMap { $0 }
    }

    /// `buildPaletteSections`: no query, Recent first (the ids picked last,
    /// at most five) and each group without what Recent shows; a query,
    /// each group ranked on its own and the server's message hits under
    /// Messages. Empty groups are left out.
    public static func sections<Action>(
        items: [DesktopPaletteItem<Action>], query: String, recents: [String], messages: [DesktopPaletteItem<Action>] = []
    ) -> [(group: DesktopPaletteGroup, items: [DesktopPaletteItem<Action>])] {
        var byGroup: [DesktopPaletteGroup: [DesktopPaletteItem<Action>]] = [:]
        if query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            let byId = Dictionary(items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
            let recent = Array(recents.compactMap { byId[$0] }.prefix(recentLimit)).map { item -> DesktopPaletteItem<Action> in
                var copy = item
                copy.group = .recent
                return copy
            }
            let shown = Set(recent.map(\.id))
            byGroup[.recent] = recent
            for item in items where !shown.contains(item.id) { byGroup[item.group, default: []].append(item) }
        } else {
            for group in DesktopPaletteGroup.allCases where group != .recent && group != .messages {
                byGroup[group] = rank(items.filter { $0.group == group }, query: query)
            }
            byGroup[.messages] = messages
        }
        return DesktopPaletteGroup.allCases.compactMap { group in
            guard let rows = byGroup[group], !rows.isEmpty else { return nil }
            return (group, rows)
        }
    }

    /// Recent after a pick: the id first, no repeat, at most `recentLimit`.
    public static func remember(_ id: String, in recents: [String]) -> [String] {
        Array(([id] + recents.filter { $0 != id }).prefix(recentLimit))
    }
}

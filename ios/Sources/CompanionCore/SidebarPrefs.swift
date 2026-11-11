// The sidebar preferences that follow a person between the desktop and the
// phone (matrix package WP6: SB2, SB7, SB8, SB10, SB25).
//
// The desktop keeps them in localStorage under these exact keys, each module
// owning one (src/lib/personal-sections.ts, sidebar-hidden.ts,
// sidebar-preferences.ts, thread-preferences.ts). On an organization server
// they are also the person's record on the server (shared/user-preferences.ts,
// GET/PUT /api/me/preferences), so desktop and phone agree; anywhere else that
// route answers 404 and each device keeps its own (the app stores them per
// pairing). The parsing, the edits and the layout below mirror those modules
// line for line, so a value written here reads the same on the desktop.
//
// A save sends only the keys the phone changed (PATCH /api/me/preferences
// `{ set, remove }`), so every other key (skin, language, keys this app does
// not know, a key another device just saved) survives; an older server
// without PATCH gets the record read first and PUT back with those keys
// changed. Every save on any of the person's devices comes back to all of
// them as a `preferences` frame (`Frame.preferences`), which
// `SidebarPrefs.receiving` folds in: the server wins, except for the keys
// changed here and not saved yet. Inside a value, unknown top-level fields
// survive too.
import Foundation

/// The localStorage keys, exactly as the desktop names them.
public enum SidebarPrefKey {
    /// The person's own sections on an organization server (personal-sections.ts).
    public static let personalSections = "sagax.sidebarSections.v1"
    /// What the person hid from their sidebar (sidebar-hidden.ts).
    public static let hidden = "sagax.sidebarHidden.v1"
    /// Folded section ids (sidebar-preferences.ts).
    public static let collapsedSections = "openmausbot.sidebarCollapsedSections.v1"
    /// Saved section order, by id (sidebar-preferences.ts).
    public static let sectionOrder = "openmausbot.sidebarSectionOrder.v1"
    /// "1" shows thread lists and controls (thread-preferences.ts).
    public static let showThreads = "omb-show-threads"
    /// The person's own order of each team's bots on the Team map, by
    /// section key (TeamCanvas.tsx on an organization server; `TeamMap.parseOrders`).
    public static let teamBotOrder = "sagax.teamCanvasBotOrder.v1"

    public static let all = [personalSections, hidden, collapsedSections, sectionOrder, showThreads, teamBotOrder]
}

/// One value must fit one preference (shared/user-preferences.ts).
public let maxPreferenceValue = 8 * 1024

private func jsLength(_ text: String) -> Int { text.utf16.count }

private func jsTrim(_ text: String) -> String { text.trimmingCharacters(in: .whitespacesAndNewlines) }

/// Writes `known` over the object `raw` holds, keeping its other fields.
private func mergedJSON(_ raw: String?, _ known: [String: Any]) -> String {
    var object: [String: Any] = [:]
    if let raw, let data = raw.data(using: .utf8),
       let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
        object = parsed
    }
    for (key, value) in known { object[key] = value }
    return jsonText(object)
}

private func jsonText(_ value: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes]) else {
        return "{}"
    }
    return String(decoding: data, as: UTF8.self)
}

private func isBoolean(_ number: NSNumber) -> Bool {
    CFGetTypeID(number) == CFBooleanGetTypeID()
}

private func jsonValue(_ raw: String?) -> Any? {
    guard let raw, let data = raw.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
}

// MARK: - Personal sections (#101)

/// Why a section edit was refused (personal-sections.ts `SectionEditError`).
public enum PersonalSectionError: String, Error, Sendable {
    case badName = "bad_name"
    case reserved
    case exists
    case missing
    case full
}

/// A person's own section: `bot:<id>` and `group:<id>` keys.
public struct PersonalSection: Hashable, Sendable {
    public var name: String
    public var items: [String]

    public init(name: String, items: [String] = []) {
        self.name = name
        self.items = items
    }
}

/// The person's own sidebar sections on an organization server. They share
/// nothing: nobody else sees them, and filing a bot or a group in one
/// changes nothing for anybody. What is in no section shows in General.
public struct PersonalSections: Hashable, Sendable {
    public var sections: [PersonalSection]

    public init(sections: [PersonalSection] = []) {
        self.sections = sections
    }

    public static let empty = PersonalSections()

    public static func itemKey(bot id: String) -> String { "bot:\(id)" }
    public static func itemKey(group id: String) -> String { "group:\(id)" }

    private static let reserved: Set<String> = ["general", "général", "generale", "sans section", "unassigned", "no section", "non assigné", "não atribuído"]

    public static func isReserved(_ name: String) -> Bool {
        reserved.contains(jsTrim(name).lowercased())
    }

    /// 1 to 60 characters, no control characters.
    public static func validName(_ name: String) -> Bool {
        let trimmed = jsTrim(name)
        return jsLength(trimmed) > 0 && jsLength(trimmed) <= 60
            && !trimmed.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
    }

    /// The stored value, or nil when the person has none yet (not seeded).
    public static func parse(_ raw: String?) -> PersonalSections? {
        guard let object = jsonValue(raw) as? [String: Any], let list = object["sections"] as? [Any] else { return nil }
        var names = Set<String>()
        var placed = Set<String>()
        var sections: [PersonalSection] = []
        for entry in list {
            // the desktop's schema refuses the whole value for one bad name
            guard let section = entry as? [String: Any], let rawName = section["name"] as? String else { return nil }
            var items: [String] = []
            if let rawItems = section["items"] as? [Any],
               rawItems.allSatisfy({ ($0 as? String).map { (1...220).contains(jsLength($0)) } ?? false }) {
                items = rawItems.compactMap { $0 as? String }
            }
            let name = jsTrim(rawName)
            if !validName(name) || isReserved(name) || names.contains(name) { continue }
            names.insert(name)
            // An item sits in one section at most: the first one wins.
            let kept = items.filter { key in
                !placed.contains(key) && (key.hasPrefix("bot:") || key.hasPrefix("group:")) && key.split(separator: ":", maxSplits: 1).count == 2
            }
            for key in kept { placed.insert(key) }
            sections.append(PersonalSection(name: name, items: kept))
        }
        return PersonalSections(sections: sections)
    }

    /// The value to store, over the previous one (its other fields kept).
    public func serialized(over raw: String? = nil) -> String {
        mergedJSON(raw, ["sections": sections.map { ["name": $0.name, "items": $0.items] }])
    }

    /// Whether the value still fits one preference.
    public var fits: Bool { jsLength(serialized()) <= maxPreferenceValue }

    public var names: [String] { sections.map(\.name) }

    public func section(of key: String) -> String? {
        sections.first { $0.items.contains(key) }?.name
    }

    private func check(_ name: String, except: String? = nil) -> PersonalSectionError? {
        if !Self.validName(name) { return .badName }
        if Self.isReserved(name) { return .reserved }
        let trimmed = jsTrim(name)
        if sections.contains(where: { $0.name == trimmed && $0.name != except }) { return .exists }
        return nil
    }

    private static func done(_ next: PersonalSections) -> Result<PersonalSections, PersonalSectionError> {
        next.fits ? .success(next) : .failure(.full)
    }

    public func creating(_ name: String) -> Result<PersonalSections, PersonalSectionError> {
        if let error = check(name) { return .failure(error) }
        return Self.done(PersonalSections(sections: sections + [PersonalSection(name: jsTrim(name))]))
    }

    public func renaming(_ from: String, to: String) -> Result<PersonalSections, PersonalSectionError> {
        guard sections.contains(where: { $0.name == from }) else { return .failure(.missing) }
        if let error = check(to, except: from) { return .failure(error) }
        return Self.done(PersonalSections(sections: sections.map {
            $0.name == from ? PersonalSection(name: jsTrim(to), items: $0.items) : $0
        }))
    }

    /// Removes the section; its items go back to General.
    public func deleting(_ name: String) -> PersonalSections {
        PersonalSections(sections: sections.filter { $0.name != name })
    }

    /// Files an item in a section (created when new), or back in General
    /// with "". `known` prunes keys of items that no longer exist when the
    /// value is full.
    public func assigning(_ key: String, to name: String, known: Set<String>? = nil) -> Result<PersonalSections, PersonalSectionError> {
        let target = jsTrim(name)
        var next = sections.map { section in
            section.items.contains(key) ? PersonalSection(name: section.name, items: section.items.filter { $0 != key }) : section
        }
        if !target.isEmpty {
            if !next.contains(where: { $0.name == target }) {
                if let error = PersonalSections(sections: next).check(target) { return .failure(error) }
                next.append(PersonalSection(name: target))
            }
            next = next.map { $0.name == target ? PersonalSection(name: $0.name, items: $0.items + [key]) : $0 }
        }
        let value = PersonalSections(sections: next)
        guard !value.fits, let known else { return Self.done(value) }
        return Self.done(PersonalSections(sections: next.map {
            PersonalSection(name: $0.name, items: $0.items.filter { $0 == key || known.contains($0) })
        }))
    }

    /// The first value for a person who never had one: their own bots and
    /// the rooms they see keep the section the server gave them (bots shared
    /// by someone else start in General).
    public static func seed(bots: [Bot], rooms: [Room], sections serverSections: [String], viewerId: String) -> PersonalSections {
        let me = jsTrim(viewerId).lowercased()
        func own(_ bot: Bot) -> Bool {
            guard let owner = bot.ownerUserId.map({ jsTrim($0).lowercased() }), !owner.isEmpty else { return true }
            return owner == "local-owner" || owner == me
        }
        var placed: [(String, String)] = []
        for bot in bots {
            if let name = bot.section.map(jsTrim), !name.isEmpty, own(bot) { placed.append((name, itemKey(bot: bot.id))) }
        }
        for room in rooms where room.dm != true {
            if let name = room.section.map(jsTrim), !name.isEmpty { placed.append((name, itemKey(group: room.id))) }
        }
        let used = Set(placed.map(\.0))
        let order = serverSections.map(jsTrim).filter(used.contains) + placed.map(\.0)
        var out: [PersonalSection] = []
        for name in order where !out.contains(where: { $0.name == name }) && validName(name) && !isReserved(name) {
            out.append(PersonalSection(name: name, items: placed.filter { $0.0 == name }.map(\.1)))
        }
        let seeded = PersonalSections(sections: out)
        return seeded.fits ? seeded : PersonalSections(sections: out.map { PersonalSection(name: $0.name) })
    }
}

// MARK: - Hidden from the sidebar

/// A bot (bot id), a group (group id) or a person (principal id: their
/// direct conversation with the viewer).
public enum HiddenKind: String, Hashable, Sendable {
    case bot
    case group
    case person
}

public struct HiddenEntry: Hashable, Sendable {
    public var kind: HiddenKind
    public var id: String
    /// When it was hidden (ms): only a message after this brings it back.
    public var at: Double

    public init(kind: HiddenKind, id: String, at: Double) {
        self.kind = kind
        self.id = id
        self.at = at
    }

    public var key: String { SidebarHidden.key(kind, id) }
}

/// What the person hid from their own sidebar. A view choice only: nothing
/// is deleted, nobody else sees a change, and search still reaches it.
public struct SidebarHidden: Hashable, Sendable {
    public var items: [HiddenEntry]
    /// People (and groups) come back on a new message by default; bots do
    /// not (they post on their own).
    public var unhidePeople: Bool
    public var unhideBots: Bool

    public init(items: [HiddenEntry] = [], unhidePeople: Bool = true, unhideBots: Bool = false) {
        self.items = items
        self.unhidePeople = unhidePeople
        self.unhideBots = unhideBots
    }

    public static let `default` = SidebarHidden()
    /// A bound, not a quota: the value must fit one preference.
    public static let maxItems = 100

    public static func key(_ kind: HiddenKind, _ id: String) -> String {
        "\(kind.rawValue):\(kind == .person ? jsTrim(id).lowercased() : id)"
    }

    public static func parse(_ raw: String?) -> SidebarHidden {
        guard let object = jsonValue(raw) as? [String: Any] else { return .default }
        var entries: [HiddenEntry] = []
        if let list = object["items"] as? [Any] {
            for case let item as [String: Any] in list {
                guard let kind = (item["kind"] as? String).flatMap(HiddenKind.init(rawValue:)),
                      let id = item["id"] as? String, (1...200).contains(jsLength(id)),
                      let number = item["at"] as? NSNumber, !isBoolean(number),
                      number.doubleValue.isFinite, number.doubleValue >= 0 else {
                    // the desktop's schema drops the whole list for one bad entry
                    entries = []
                    break
                }
                entries.append(HiddenEntry(kind: kind, id: id, at: number.doubleValue))
            }
            if list.contains(where: { !($0 is [String: Any]) }) { entries = [] }
        }
        var seen = Set<String>()
        let unique = entries.filter { seen.insert($0.key).inserted }
        var hidden = SidebarHidden(items: Array(unique.suffix(maxItems)))
        if let unhide = object["unhideOnMessage"] as? [String: Any] {
            hidden.unhidePeople = (unhide["people"] as? Bool) ?? true
            hidden.unhideBots = (unhide["bots"] as? Bool) ?? false
        }
        return hidden
    }

    public func serialized(over raw: String? = nil) -> String {
        mergedJSON(raw, [
            "items": items.suffix(Self.maxItems).map { ["kind": $0.kind.rawValue, "id": $0.id, "at": Int64($0.at)] as [String: Any] },
            "unhideOnMessage": ["people": unhidePeople, "bots": unhideBots],
        ])
    }

    public var keys: Set<String> { Set(items.map(\.key)) }

    public func hiding(_ kind: HiddenKind, _ id: String, at: Double) -> SidebarHidden {
        let key = Self.key(kind, id)
        var next = self
        next.items = Array((items.filter { $0.key != key } + [HiddenEntry(kind: kind, id: kind == .person ? jsTrim(id).lowercased() : id, at: at)]).suffix(Self.maxItems))
        return next
    }

    public func showing(_ keys: [String]) -> SidebarHidden {
        let drop = Set(keys)
        var next = self
        next.items = items.filter { !drop.contains($0.key) }
        return next
    }

    /// The hidden entries a new unread message brings back, by the person's
    /// setting (sidebar-hidden.ts `entriesToUnhide`).
    public func entriesToUnhide(state: CompanionState, viewerId: String) -> [String] {
        var out: [String] = []
        for item in items {
            // a closed conversation with a person always comes back on a new
            // message; the people switch now governs rooms only (#219)
            let on = item.kind == .bot ? unhideBots : (item.kind == .person ? true : unhidePeople)
            guard on else { continue }
            let newest: Double?
            switch item.kind {
            case .bot:
                newest = state.bots.first { $0.id == item.id && $0.unread }.map { bot in
                    var at = state.messages[bot.threadId]?.last?.at ?? bot.messages?.last?.at ?? 0
                    for task in bot.tasks ?? [] { at = max(at, task.updatedAt ?? 0) }
                    return at
                }
            case .group, .person:
                let room = item.kind == .group
                    ? state.rooms.first { $0.id == item.id }
                    : state.rooms.first { $0.peopleDm == true && SidebarHidden.groupKey($0, viewerId: viewerId) == item.key }
                newest = room.flatMap { room in
                    guard room.unread else { return nil }
                    var at = state.messages[room.threadId]?.last?.at ?? room.messages?.last?.at ?? 0
                    for task in room.tasks ?? [] { at = max(at, task.updatedAt ?? 0) }
                    return at
                }
            }
            if let newest, newest > item.at { out.append(item.key) }
        }
        return out
    }

    /// Selecting a closed conversation with a person reopens it (#219,
    /// `closedDmToReopen`): the value without its entry, or nil when it was
    /// not closed.
    public func reopening(_ room: Room, viewerId: String) -> SidebarHidden? {
        guard room.peopleDm == true else { return nil }
        let key = Self.groupKey(room, viewerId: viewerId)
        guard keys.contains(key) else { return nil }
        return showing([key])
    }

    /// A direct conversation with a person is hidden as that person (it
    /// follows them); any other group by its id.
    public static func groupKey(_ room: Room, viewerId: String) -> String {
        if room.peopleDm == true {
            let me = jsTrim(viewerId).lowercased()
            let humans = room.humanIds ?? []
            if let peer = humans.first(where: { jsTrim($0).lowercased() != me }) ?? humans.first {
                return key(.person, peer)
            }
        }
        return key(.group, room.id)
    }
}

/// One line of Settings > Appearance > Hidden from the sidebar: an entry
/// that still exists, named. The sidebar itself draws nothing for it (#3576).
public struct SidebarHiddenRow: Hashable, Sendable, Identifiable {
    public var key: String
    public var kind: HiddenKind
    public var id: String
    public var name: String
}

// MARK: - Section ids, order and folding (sidebar-layout.ts)

public enum SidebarSectionID {
    /// What is in no section: the desktop's General.
    public static let general = "builtin:general"
    /// Conversations between bots.
    public static let botChats = "builtin:bot-chats"

    public static func user(_ name: String) -> String { "section:\(name)" }

    public static func userName(_ id: String) -> String? {
        id.hasPrefix("section:") ? String(id.dropFirst("section:".count)) : nil
    }

    private static func unique(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// Saved positions restored; newly visible sections at their natural place.
    public static func ordered(_ present: [String], saved: [String]) -> [String] {
        let visible = unique(present)
        let visibleSet = Set(visible)
        var result = unique(saved).filter(visibleSet.contains)
        if result.isEmpty { return visible }
        for (naturalIndex, id) in visible.enumerated() where !result.contains(id) {
            let predecessor = visible[..<naturalIndex].reversed().first { result.contains($0) }
            let successor = visible[(naturalIndex + 1)...].first { result.contains($0) }
            let predecessorIndex = predecessor.flatMap { result.firstIndex(of: $0) } ?? -1
            let successorIndex = successor.flatMap { result.firstIndex(of: $0) } ?? -1
            if predecessorIndex >= 0 && (successorIndex < 0 || predecessorIndex < successorIndex) {
                result.insert(id, at: predecessorIndex + 1)
            } else if successorIndex >= 0 {
                result.insert(id, at: successorIndex)
            } else {
                result.append(id)
            }
        }
        return result
    }

    /// A section dropped on another (`placeSection` in Sidebar.tsx): before
    /// it, or after it when the pointer was in its lower half.
    public static func place(_ ids: [String], _ id: String, at target: String, after: Bool) -> [String] {
        guard id != target, ids.contains(id), ids.contains(target) else { return ids }
        var result = ids.filter { $0 != id }
        guard let index = result.firstIndex(of: target) else { return ids }
        result.insert(id, at: after ? index + 1 : index)
        return result
    }

    public static func move(_ ids: [String], _ id: String, by direction: Int) -> [String] {
        guard let index = ids.firstIndex(of: id) else { return ids }
        let destination = index + direction
        guard destination >= 0, destination < ids.count else { return ids }
        var result = ids
        let moved = result.remove(at: index)
        result.insert(moved, at: destination)
        return result
    }

    /// Keeps temporarily empty sections in the saved order, so their slot
    /// returns when something is filed there again.
    public static func merge(saved savedOrder: [String], visible visibleOrder: [String]) -> [String] {
        let saved = unique(savedOrder)
        var result = unique(visibleOrder)
        var included = Set(result)
        for (savedIndex, id) in saved.enumerated() where !included.contains(id) {
            var destination = result.count
            var foundPredecessor = false
            for previous in stride(from: savedIndex - 1, through: 0, by: -1) {
                if let position = result.firstIndex(of: saved[previous]) {
                    destination = position + 1
                    foundPredecessor = true
                    break
                }
            }
            if !foundPredecessor {
                for next in (savedIndex + 1)..<max(saved.count, savedIndex + 1) {
                    if let position = result.firstIndex(of: saved[next]) {
                        destination = position
                        break
                    }
                }
            }
            result.insert(id, at: destination)
            included.insert(id)
        }
        return result
    }

    public static func toggle(_ ids: [String], _ id: String) -> [String] {
        ids.contains(id) ? ids.filter { $0 != id } : ids + [id]
    }

    /// A stored id list (collapsed sections, section order).
    public static func parseList(_ raw: String?) -> [String] {
        guard let list = jsonValue(raw) as? [Any],
              list.allSatisfy({ ($0 as? String).map { (1...240).contains(jsLength($0)) } ?? false }) else { return [] }
        return Array(unique(list.compactMap { $0 as? String }).prefix(100))
    }

    public static func serializeList(_ ids: [String]) -> String {
        jsonText(Array(unique(ids.filter { (1...240).contains(jsLength($0)) }).prefix(100)))
    }
}

// MARK: - The whole set

/// The five sidebar values as the desktop stores them (absent: the
/// module's default), with typed reads and edits.
public struct SidebarPrefs: Hashable, Sendable {
    /// Raw values by `SidebarPrefKey` and `PersonPrefKey`; only those keys.
    public var values: [String: String]

    public init(values: [String: String] = [:]) {
        self.values = values.filter { SidebarPrefKey.synced.contains($0.key) }
    }

    public var personalSections: PersonalSections? { PersonalSections.parse(values[SidebarPrefKey.personalSections]) }
    public var hidden: SidebarHidden { SidebarHidden.parse(values[SidebarPrefKey.hidden]) }
    public var collapsed: [String] { SidebarSectionID.parseList(values[SidebarPrefKey.collapsedSections]) }
    public var sectionOrder: [String] { SidebarSectionID.parseList(values[SidebarPrefKey.sectionOrder]) }
    /// The stored switch, or nil when never set on any device.
    public var showThreads: Bool? { values[SidebarPrefKey.showThreads].map { $0 == "1" } }

    /// Threads are off until the person turns them on, as on the desktop
    /// (src/lib/thread-preferences.ts `SHOW_THREADS_DEFAULT`).
    public static let showThreadsDefault = false

    public mutating func setPersonalSections(_ value: PersonalSections) {
        values[SidebarPrefKey.personalSections] = value.serialized(over: values[SidebarPrefKey.personalSections])
    }

    public mutating func setHidden(_ value: SidebarHidden) {
        values[SidebarPrefKey.hidden] = value.serialized(over: values[SidebarPrefKey.hidden])
    }

    public mutating func setCollapsed(_ ids: [String]) {
        values[SidebarPrefKey.collapsedSections] = SidebarSectionID.serializeList(ids)
    }

    public mutating func setSectionOrder(_ ids: [String]) {
        values[SidebarPrefKey.sectionOrder] = SidebarSectionID.serializeList(ids)
    }

    public mutating func setShowThreads(_ on: Bool) {
        values[SidebarPrefKey.showThreads] = on ? "1" : "0"
    }

    /// The Team map's order of each team's bots (`TeamMap.parseOrders`).
    public var teamBotOrders: [String: [String]] { TeamMap.parseOrders(values[SidebarPrefKey.teamBotOrder]) }

    public mutating func setTeamBotOrders(_ orders: [String: [String]]) {
        values[SidebarPrefKey.teamBotOrder] = TeamMap.encodeOrders(orders)
    }

    /// The person's record as the server just sent it (a read, or a
    /// `preferences` frame after a save on any device): the server's value
    /// wins for every sidebar key, a key it does not hold is cleared (the
    /// default, as on a fresh device), and only the keys changed here and
    /// not saved yet keep this phone's value. So a section deleted on the
    /// desktop leaves the phone, and one deleted here is not brought back.
    public func receiving(_ remote: [String: String], pending: Set<String>) -> SidebarPrefs {
        var next = SidebarPrefs(values: remote)
        for key in pending where SidebarPrefKey.synced.contains(key) { next.values[key] = values[key] }
        return next
    }

    /// A rename carries the section's fold and place with it.
    public mutating func renameSectionID(from old: String, to new: String) {
        let replace: ([String]) -> [String] = { ids in
            var seen = Set<String>()
            return ids.map { $0 == SidebarSectionID.user(old) ? SidebarSectionID.user(new) : $0 }.filter { seen.insert($0).inserted }
        }
        if values[SidebarPrefKey.collapsedSections] != nil { setCollapsed(replace(collapsed)) }
        if values[SidebarPrefKey.sectionOrder] != nil { setSectionOrder(replace(sectionOrder)) }
    }

    /// The keys whose values differ from `other`.
    public func changedKeys(from other: SidebarPrefs) -> Set<String> {
        Set(SidebarPrefKey.synced.filter { values[$0] != other.values[$0] })
    }
}

// MARK: - The sidebar's layout

/// What the home lists once the person's sections, hidden entries and
/// saved order are applied (Sidebar.tsx's layout pass).
public struct SidebarLayout: Sendable {
    public var unsectionedChief: Bot?
    public var pinnedBots: [Bot]
    /// Named sections, in the person's order (empty ones included).
    public var sections: [SidebarSection]
    public var unsectionedBots: [Bot]
    public var unsectionedChannels: [Room]
    public var botChats: [Room]
    /// Every section id in the desktop's order (General on top on an
    /// organization server).
    public var sectionIds: [String]
    /// Sections are the person's own (organization server).
    public var personal: Bool

    public var sectionNames: [String] { sections.map(\.name) }

    /// The saved order after moving a named section one place among the
    /// named sections the home shows; nil when it cannot move.
    public func order(moving name: String, by direction: Int, saved: [String]) -> [String]? {
        let named = sectionIds.filter { SidebarSectionID.userName($0) != nil }
        let id = SidebarSectionID.user(name)
        let next = SidebarSectionID.move(named, id, by: direction)
        guard next != named else { return nil }
        var iterator = next.makeIterator()
        let full = sectionIds.map { SidebarSectionID.userName($0) != nil ? iterator.next()! : $0 }
        return SidebarSectionID.merge(saved: saved, visible: full)
    }

    public func canMove(_ name: String, by direction: Int) -> Bool {
        guard let index = sectionNames.firstIndex(of: name) else { return false }
        let destination = index + direction
        return destination >= 0 && destination < sectionNames.count
    }
}

extension CompanionState {
    /// The roster as the sidebar lays it out. `personal` is the person's own
    /// sections on an organization server (nil elsewhere: the server's).
    public func sidebarLayout(prefs: SidebarPrefs, personal: PersonalSections?, viewerId: String) -> SidebarLayout {
        var layoutBots = bots
        var layoutRooms = rooms
        if let personal {
            var placement: [String: String] = [:]
            for section in personal.sections { for key in section.items { placement[key] = section.name } }
            layoutBots = bots.map { var bot = $0; bot.section = placement[PersonalSections.itemKey(bot: bot.id)]; return bot }
            layoutRooms = rooms.map { var room = $0; room.section = placement[PersonalSections.itemKey(group: room.id)]; return room }
        }
        let hiddenKeys = prefs.hidden.keys
        let shownBots = layoutBots.filter { !hiddenKeys.contains(SidebarHidden.key(.bot, $0.id)) }
        let shownRooms = layoutRooms.filter { !hiddenKeys.contains(SidebarHidden.groupKey($0, viewerId: viewerId)) }

        func name(_ raw: String?) -> String? {
            guard let name = raw.map(jsTrim), !name.isEmpty else { return nil }
            return name
        }
        let visible = shownBots.filter { $0.hidden != true }
        let pinned = { SidebarBotPinning.isPinned($0) }
        let sectionChiefs = visible.filter { $0.chiefOfStaff == true && !pinned($0) && name($0.section) != nil }
        let sectionBots = visible.filter { $0.chiefOfStaff != true && !pinned($0) && name($0.section) != nil }
        let channels = shownRooms.filter { $0.dm != true }
        let sectionedRooms = channels.filter { name($0.section) != nil }
        let unsectionedRooms = channels.filter { name($0.section) == nil }
        let botChats = shownRooms.filter { $0.dm == true }

        var names: [String] = []
        for raw in (personal?.names ?? sectionOrder) + sectionBots.map(\.section) + sectionChiefs.map(\.section) + sectionedRooms.map(\.section) {
            guard let value = name(raw), !names.contains(value) else { continue }
            names.append(value)
        }
        let hasGeneral = visible.contains { name($0.section) == nil } || !unsectionedRooms.isEmpty
        let natural = (hasGeneral ? [SidebarSectionID.general] : []) + names.map(SidebarSectionID.user)
            + (botChats.isEmpty ? [] : [SidebarSectionID.botChats])
        var ids = SidebarSectionID.ordered(natural, saved: prefs.sectionOrder)
        if personal != nil, ids.contains(SidebarSectionID.general) {
            ids = [SidebarSectionID.general] + ids.filter { $0 != SidebarSectionID.general }
        }
        let sections = ids.compactMap(SidebarSectionID.userName).map { section in
            SidebarSection(
                name: section,
                chiefs: sectionChiefs.filter { name($0.section) == section },
                bots: sectionBots.filter { name($0.section) == section },
                channels: sectionedRooms.filter { name($0.section) == section }
            )
        }

        return SidebarLayout(
            unsectionedChief: visible.first { $0.chiefOfStaff == true && !pinned($0) && name($0.section) == nil },
            pinnedBots: visible.filter(pinned),
            sections: sections,
            unsectionedBots: visible.filter { $0.chiefOfStaff != true && !pinned($0) && name($0.section) == nil },
            unsectionedChannels: unsectionedRooms,
            botChats: botChats,
            sectionIds: ids,
            personal: personal != nil
        )
    }
}

extension CompanionState {
    /// What Settings > Appearance > Hidden from the sidebar lists, by name:
    /// the hidden bots and groups that still exist, each with Show there.
    /// The sidebar and the home list draw nothing for them (#3576, hidden
    /// means gone from the sidebar); search still finds them. A closed
    /// conversation with a person is not listed (#219).
    public func sidebarHiddenRows(_ hidden: SidebarHidden) -> [SidebarHiddenRow] {
        var rows: [SidebarHiddenRow] = []
        for item in hidden.items {
            switch item.kind {
            case .bot:
                if let bot = bots.first(where: { $0.id == item.id && $0.hidden != true }) {
                    rows.append(SidebarHiddenRow(key: item.key, kind: .bot, id: item.id, name: bot.name))
                }
            case .group:
                if let room = rooms.first(where: { $0.id == item.id }) {
                    rows.append(SidebarHiddenRow(key: item.key, kind: .group, id: item.id, name: room.name))
                }
            case .person:
                continue
            }
        }
        return rows.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }
}

// MARK: - The server's record

extension CompanionClient {
    /// The person's record on an organization server, or nil where the
    /// preferences stay on each device (404 or 403: a personal computer,
    /// a sidecar, a session that is not a person).
    public func sidebarPreferenceRecord() async throws -> UserPreferences? {
        do {
            return try await preferences()
        } catch let APIError.status(code, _) where code == 404 || code == 403 {
            return nil
        }
    }

    /// Saves `changed` (nil removes a key) into the person's record: PATCH
    /// with only those keys. An older server without PATCH (405, or 403/404
    /// from a route table that does not list it) gets the record read
    /// first and PUT back with only those keys changed.
    @discardableResult
    public func saveSidebarPreferences(_ changed: [String: String?]) async throws -> UserPreferences {
        do {
            return try await patchPreferences(changed)
        } catch let APIError.status(code, _) where [403, 404, 405].contains(code) {
            var record = try await preferences().preferences
            for (key, value) in changed { record[key] = value }
            return try await putPreferences(record)
        }
    }

    /// `PATCH /api/me/preferences` `{ set, remove }`: changes only these
    /// keys (nil removes one); the answer is the whole record.
    public func patchPreferences(_ changed: [String: String?]) async throws -> UserPreferences {
        var set: [String: String] = [:]
        var remove: [String] = []
        for (key, value) in changed {
            if let value { set[key] = value } else { remove.append(key) }
        }
        return try await send(
            makeRequest("PATCH", "/api/me/preferences", encodedBody: UserPreferencesPatch(set: set, remove: remove.sorted())),
            as: UserPreferences.self
        )
    }

    /// Renames a server section (`PATCH /api/sidebar-sections?section=`).
    public func renameSidebarSection(_ name: String, to newName: String) async throws {
        try await send(sectionRequest("PATCH", name, body: ["name": newName]))
    }

    /// Adds and removes bots of a server section (`PUT /api/sidebar-sections?section=`).
    public func setSidebarSectionBots(_ name: String, add: [String], remove: [String]) async throws {
        try await send(sectionRequest("PUT", name, body: ["addBotIds": add, "removeBotIds": remove]))
    }

    /// Deletes a server section; its bots and groups go to General.
    public func deleteSidebarSection(_ name: String) async throws {
        try await send(sectionRequest("DELETE", name))
    }

    /// `?section=<name>` with "&", "=" and "+" encoded too: the server reads
    /// it with URLSearchParams, where "+" is a space.
    private func sectionRequest(_ method: String, _ name: String, body: [String: Any]? = nil) throws -> URLRequest {
        var request = try makeRequest(method, "/api/sidebar-sections", body: body)
        guard let url = request.url, var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { throw APIError.badURL }
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "&=+?/#")
        components.percentEncodedQuery = "section=" + (name.addingPercentEncoding(withAllowedCharacters: allowed) ?? name)
        request.url = components.url
        return request
    }
}

/// "My team" is the name the reference design and earlier imports give the person's
/// default team; the apps show it in the interface's language, any other
/// name exactly as typed (desktop: `isMyTeamSectionName`,
/// src/lib/sidebar-layout.ts).
public func isMyTeamSectionName(_ name: String) -> Bool {
    name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "my team"
}

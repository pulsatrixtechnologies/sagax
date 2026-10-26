// The sidebar preferences on the phone (matrix package WP6: SB2, SB7, SB8,
// SB10, SB25): one store for the home, its menus and Settings > Appearance.
//
// It does what src/lib/user-preferences-sync.ts does for the desktop page:
// on an organization server the person's record (GET /api/me/preferences)
// wins when it is read, the first time it is empty this phone offers what it
// had (the migration of the local copy), and every change is saved back at
// once (PATCH of only the keys it changed:
// `CompanionClient.saveSidebarPreferences`). A save on any of the person's
// devices comes back to every one as a `preferences` frame on the live
// stream (`receive`), so a section deleted on the desktop leaves the phone
// within seconds and the other way round. Anywhere else the route answers
// 404 and the values stay on this phone, per pairing, as they stay in one
// browser's localStorage. A save that fails is retried at the next read,
// the local value winning for those keys.
import CompanionCore
import SwiftUI

@MainActor
final class SidebarPrefsModel: ObservableObject {
    static let shared = SidebarPrefsModel()

    @Published private(set) var prefs = SidebarPrefs()
    /// The server keeps them (organization server): the sections are the
    /// person's own.
    @Published private(set) var synced = false
    /// A refused personal-section edit, for the home's alert.
    @Published var editError: String?

    private var connectionID: String?
    /// Keys changed here and not yet on the server.
    private var pending = Set<String>()
    private var pushing = false
    private var pushAgain = false

    private static func storageKey(_ connectionID: String) -> String { "companion.sidebarPrefs.\(connectionID)" }

    // MARK: Reads

    /// The thread lists and controls (Settings > Appearance > Threads). The
    /// desktop's default is off; a phone that never stored the switch keeps
    /// showing them, as it always did.
    var showThreads: Bool {
#if DEBUG
        // UI tests: the desktop's default (threads hidden) on a fixture
        if ProcessInfo.processInfo.arguments.contains("-threads-hidden") { return false }
#endif
        return prefs.showThreads ?? true
    }

    /// Settings > Appearance > Threads location (#210): per device, never
    /// synced, the desktop's own key.
    @Published private(set) var threadsLocation = ThreadsLocation.parse(UserDefaults.standard.string(forKey: ThreadsLocation.storageKey))

    /// Where a bot's threads show: under its row, or in the chat header.
    var threadsPlacement: ThreadsPlacement { ThreadsPlacement(showThreads: showThreads, location: threadsLocation) }

    func setThreadsLocation(_ location: ThreadsLocation) {
        threadsLocation = location
        UserDefaults.standard.set(location.rawValue, forKey: ThreadsLocation.storageKey)
    }

    /// The person's own sections on an organization server, nil elsewhere.
    var personal: PersonalSections? { synced ? (prefs.personalSections ?? .empty) : nil }

    func viewerID(_ session: Session) -> String {
        if let principal = session.account?.principalId?.trimmingCharacters(in: .whitespaces), !principal.isEmpty {
            return principal.lowercased()
        }
        return session.account?.email?.trimmingCharacters(in: .whitespaces).lowercased() ?? "local-owner"
    }

    func layout(_ session: Session) -> SidebarLayout {
        session.state.sidebarLayout(prefs: prefs, personal: personal, viewerId: viewerID(session))
    }

    func isCollapsed(_ id: String) -> Bool { prefs.collapsed.contains(id) }

    // MARK: Loading

    /// Switches to the pairing's own values (what this phone stored for it).
    func attach(_ session: Session) {
        let id = session.connection?.id
        guard id != connectionID else { return }
        connectionID = id
        pending = []
        synced = false
        prefs = SidebarPrefs()
        guard let id else { return }
        if let raw = UserDefaults.standard.string(forKey: Self.storageKey(id)),
           let values = try? JSONDecoder().decode([String: String].self, from: Data(raw.utf8)) {
            prefs = SidebarPrefs(values: values)
        }
        if prefs.values[SidebarPrefKey.collapsedSections] == nil {
            migrateLegacyCollapsed()
        }
    }

    /// Reads the person's record when the server keeps one.
    func load(_ session: Session) async {
        attach(session)
        guard let client = session.settingsClient, let id = connectionID else { return }
        let record: UserPreferences?
        do {
            record = try await client.sidebarPreferenceRecord()
        } catch {
            return // offline: what this phone has stands
        }
        guard id == connectionID else { return }
        guard let record else {
            synced = false
            return
        }
        synced = true
        if record.stored {
            prefs = prefs.receiving(record.preferences, pending: pending)
        } else {
            // the first time: what this phone already had
            pending.formUnion(prefs.values.keys)
        }
        persist()
        seedIfNeeded(session)
        await push(session)
    }

    /// The person's record as another device (or this one) just saved it:
    /// the `preferences` frame of the live stream.
    func receive(_ session: Session, _ record: UserPreferences) {
        guard synced, session.connection?.id == connectionID else { return }
        let next = prefs.receiving(record.preferences, pending: pending)
        guard next != prefs else { return }
        prefs = next
        persist()
    }

    // MARK: Writes

    func update(_ session: Session, _ edit: (inout SidebarPrefs) -> Void) {
        attach(session)
        var next = prefs
        edit(&next)
        let changed = next.changedKeys(from: prefs)
        guard !changed.isEmpty else { return }
        prefs = next
        persist()
        guard synced else { return }
        pending.formUnion(changed)
        Task { await push(session) }
    }

    private func push(_ session: Session) async {
        guard synced, !pending.isEmpty, let client = session.settingsClient else { return }
        if pushing {
            pushAgain = true
            return
        }
        pushing = true
        defer { pushing = false }
        repeat {
            pushAgain = false
            let keys = pending
            let sent = keys.reduce(into: [String: String?]()) { $0[$1] = prefs.values[$1] }
            do {
                try await client.saveSidebarPreferences(sent)
                for key in keys where prefs.values[key] == sent[key] ?? nil { pending.remove(key) }
            } catch {
                return // kept: the next read sends them again
            }
        } while pushAgain && !pending.isEmpty
    }

    private func persist() {
        guard let id = connectionID, let data = try? JSONEncoder().encode(prefs.values) else { return }
        UserDefaults.standard.set(String(decoding: data, as: UTF8.self), forKey: Self.storageKey(id))
    }

    /// The home folded sections by name before they followed the person.
    private func migrateLegacyCollapsed() {
        let legacy = CollapsedSections.decode(UserDefaults.standard.string(forKey: CollapsedSections.key) ?? "[]")
        let ids = legacy.sorted().compactMap(HomeSectionKey.sectionID(forLegacy:))
        if !ids.isEmpty { prefs.setCollapsed(ids) }
    }

    // MARK: Organization server: the person's own sections

    /// The first value for a person who never had one (Sidebar.tsx seeds it
    /// once the roster has arrived).
    func seedIfNeeded(_ session: Session) {
        guard synced, prefs.personalSections == nil,
              !session.state.bots.isEmpty || !session.state.rooms.isEmpty else { return }
        let seeded = PersonalSections.seed(
            bots: session.state.bots, rooms: session.state.rooms,
            sections: session.state.sectionOrder, viewerId: viewerID(session)
        )
        update(session) { $0.setPersonalSections(seeded) }
    }

    /// Applies a section edit; the sentence to show when it was refused.
    @discardableResult
    func editPersonal(_ session: Session, _ edit: (PersonalSections) -> Result<PersonalSections, PersonalSectionError>) -> String? {
        switch edit(personal ?? .empty) {
        case let .success(next):
            update(session) { $0.setPersonalSections(next) }
            return nil
        case let .failure(error):
            return error.message
        }
    }

    func renamePersonal(_ session: Session, _ name: String, to newName: String) -> String? {
        let failed = editPersonal(session) { $0.renaming(name, to: newName) }
        if failed == nil {
            let trimmed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
            update(session) { $0.renameSectionID(from: name, to: trimmed) }
        }
        return failed
    }

    func deletePersonal(_ session: Session, _ name: String) {
        guard let personal else { return }
        update(session) { $0.setPersonalSections(personal.deleting(name)) }
    }

    /// Files a bot or a group in one of the person's sections ("" puts it
    /// back in Unassigned).
    func assignPersonal(_ session: Session, key: String, to name: String) -> String? {
        let known = Set(session.state.bots.map { PersonalSections.itemKey(bot: $0.id) }
            + session.state.rooms.map { PersonalSections.itemKey(group: $0.id) })
        return editPersonal(session) { $0.assigning(key, to: name, known: known) }
    }

    // MARK: Folding and order

    func toggleCollapsed(_ session: Session, _ id: String) {
        update(session) { $0.setCollapsed(SidebarSectionID.toggle($0.collapsed, id)) }
    }

    func setAllCollapsed(_ session: Session, _ ids: [String]) {
        update(session) { $0.setCollapsed(ids) }
    }

    /// A whole new section order (the iPad sidebar's drag, DD1).
    func setSectionOrder(_ session: Session, _ ids: [String]) {
        update(session) { $0.setSectionOrder(ids) }
    }

    func moveSection(_ session: Session, _ name: String, by direction: Int) {
        guard let next = layout(session).order(moving: name, by: direction, saved: prefs.sectionOrder) else { return }
        update(session) { $0.setSectionOrder(next) }
    }

    // MARK: Hidden

    func hide(_ session: Session, _ kind: HiddenKind, _ id: String) {
        update(session) { $0.setHidden($0.hidden.hiding(kind, id, at: (Date().timeIntervalSince1970 * 1000).rounded())) }
    }

    func hide(_ session: Session, room: Room) {
        let key = SidebarHidden.groupKey(room, viewerId: viewerID(session))
        if key.hasPrefix("person:") {
            hide(session, .person, String(key.dropFirst("person:".count)))
        } else {
            hide(session, .group, room.id)
        }
    }

    func show(_ session: Session, _ keys: [String]) {
        update(session) { $0.setHidden($0.hidden.showing(keys)) }
    }

    func setUnhide(_ session: Session, people: Bool? = nil, bots: Bool? = nil) {
        update(session) {
            var hidden = $0.hidden
            if let people { hidden.unhidePeople = people }
            if let bots { hidden.unhideBots = bots }
            $0.setHidden(hidden)
        }
    }

    /// Opening a closed conversation with a person reopens it (#219).
    func reopenIfClosed(_ session: Session, room: Room) {
        guard let next = prefs.hidden.reopening(room, viewerId: viewerID(session)) else { return }
        update(session) { $0.setHidden(next) }
    }

    /// A new message brings a hidden entry back, per the person's setting.
    func unhideNewMessages(_ session: Session) {
        let hidden = prefs.hidden
        guard !hidden.items.isEmpty else { return }
        let keys = hidden.entriesToUnhide(state: session.state, viewerId: viewerID(session))
        if !keys.isEmpty { show(session, keys) }
    }

    func setShowThreads(_ session: Session, _ on: Bool) {
        update(session) { $0.setShowThreads(on) }
    }

    // MARK: Team map

    /// The Team map's bot order follows the person on an organization
    /// server (TeamCanvas.tsx keeps it in the same record); elsewhere it
    /// stays on this phone (TeamMapModel).
    var teamBotOrders: [String: [String]]? { synced ? prefs.teamBotOrders : nil }

    func setTeamBotOrders(_ session: Session, _ orders: [String: [String]]) {
        update(session) { $0.setTeamBotOrders(orders) }
    }
}

extension PersonalSectionError {
    /// The desktop sidebar's sentences (`sectionEditMessage`).
    var message: String {
        switch self {
        case .reserved: String(localized: "Unassigned already holds what is in no section. Choose another name.")
        case .exists: String(localized: "You already have a section with that name.")
        case .full: String(localized: "Your sections hold too much to save. Empty one first.")
        case .badName, .missing: String(localized: "Section name")
        }
    }
}

/// The home's section keys and the desktop's section ids. The phone splits
/// the desktop's Unassigned into Bots and Group Chats: both fold together.
enum HomeSectionKey {
    static let attention = "__attention"
    static let bots = "__bots"
    static let groups = "__groups"
    static let botChats = "__botchats"

    /// The desktop id a home section folds under; nil for the phone's own
    /// (Needs attention), which stays on this phone.
    static func sectionID(for key: String) -> String? {
        switch key {
        case attention: nil
        case bots, groups: SidebarSectionID.general
        case botChats: SidebarSectionID.botChats
        default: SidebarSectionID.user(key)
        }
    }

    static func sectionID(forLegacy key: String) -> String? { sectionID(for: key) }
}

private struct SidebarShowsThreadsKey: EnvironmentKey {
    static let defaultValue = true
}

extension EnvironmentValues {
    /// The thread lists and thread controls under every bot row: Settings >
    /// Appearance > Threads on, with Threads location "In the sidebar".
    var sidebarShowsThreads: Bool {
        get { self[SidebarShowsThreadsKey.self] }
        set { self[SidebarShowsThreadsKey.self] = newValue }
    }
}

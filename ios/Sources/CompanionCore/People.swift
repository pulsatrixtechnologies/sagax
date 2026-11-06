// People of an organization server (matrix RM21, RM22): who wrote a room's
// line (src/lib/room-authors.ts), the direct conversation between two
// people (src/lib/people-dm.ts, server/people/people-dms.ts), the person sheet
// (src/lib/person-panel.ts) and the people the compose-to list offers
// (ComposeToPicker.tsx `composePeople`). Only the directory's fields show:
// nothing from a private thread.
//
// Routes: `GET /api/org/directory` (CLIENT_ALLOW, orgDirectory) and
// `POST /api/people-dms` (CLIENT_ALLOW); both exist on organization servers
// only, so every surface here sits behind `SurfaceGate.organization`.
import Foundation

public enum People {
    public static func norm(_ value: String?) -> String {
        (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// `personInitials` (people-dm.ts): two letters for a person without a
    /// picture, from the first two words of their name or address.
    public static func initials(_ label: String) -> String {
        let parts = label.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { " \t\n@._-".contains($0) })
        let letters = String(parts.first?.prefix(1) ?? "") + String(parts.dropFirst().first?.prefix(1) ?? "")
        return (letters.isEmpty ? String(label.prefix(2)) : letters).uppercased()
    }

    /// `personInitials` of room-authors.ts: the room line's version, "?"
    /// when there is nothing to read.
    public static func authorInitials(_ label: String) -> String {
        let parts = label.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(whereSeparator: { " \t\n@._-".contains($0) })
        let letters = parts.prefix(2).compactMap(\.first).map(String.init).joined()
        return letters.isEmpty ? "?" : letters.uppercased()
    }

    /// The part of an address before the @, or the value itself.
    public static func emailLocalPart(_ value: String?) -> String {
        let trimmed = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let at = trimmed.firstIndex(of: "@"), at != trimmed.startIndex else { return trimmed }
        return String(trimmed[..<at])
    }

    /// `personDisplayName`: the Perspicax name, else the address's local
    /// part, else the login. A name equal to the login is not a name.
    public static func displayName(_ person: OrgDirectoryPerson) -> String {
        let name = person.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let login = person.login.trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty, name != login { return name }
        let local = emailLocalPart(person.email)
        if !local.isEmpty { return local }
        return login.isEmpty ? name : login
    }

    /// The label the sheet and the conversation row use: name, else login,
    /// else the id (PersonPanel.tsx, people-dm.ts).
    public static func label(_ person: OrgDirectoryPerson?, fallback: String) -> String {
        if let person {
            if !person.name.isEmpty { return person.name }
            if !person.login.isEmpty { return person.login }
        }
        return fallback
    }
}

// MARK: - The directory by principal id

public extension OrgDirectory {
    /// One person by principal id (any case), or nil.
    func person(_ principalId: String) -> OrgDirectoryPerson? {
        let id = People.norm(principalId)
        return people.first { People.norm($0.principalId) == id }
    }

    /// `composePeople`: active people one may write to, never a service
    /// account and never oneself, matching the query on name, login or
    /// address.
    func messageable(viewer: String, query: String = "") -> [OrgDirectoryPerson] {
        let me = People.norm(viewer)
        let q = People.norm(query)
        return people.filter { person in
            guard person.disabled != true, person.service != true, People.norm(person.principalId) != me else { return false }
            return q.isEmpty || "\(person.name) \(person.login) \(person.email ?? "")".lowercased().contains(q)
        }
    }
}

// MARK: - A room line's author (room-authors.ts)

public enum RoomAuthor: Hashable, Sendable {
    case me
    /// Another person: their directory name, and their id when the
    /// directory knows them (their name then opens the person sheet).
    case person(key: String, name: String, initials: String, personId: String?)
    case bot(id: String)
    case none

    public var key: String {
        switch self {
        case .me: "self"
        case let .person(key, _, _, _): key
        case let .bot(id): "bot:\(id)"
        case .none: "none"
        }
    }

    /// `roomAuthor` for a server that names who sent each person line
    /// (`message.sender`). A line with no sender is the viewer's own: the
    /// operator's name for a member's session is not on the phone.
    public static func of(_ message: Message, viewer: RoomViewer, directory: OrgDirectory?) -> RoomAuthor {
        if message.role == .user {
            guard let sender = message.sender else { return .me }
            let id = People.norm(sender.id)
            if !id.isEmpty, id == People.norm(viewer.principalId) { return .me }
            if id.isEmpty, let email = viewer.normalizedEmail, People.norm(sender.name) == email { return .me }
            let other = sender.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !other.isEmpty else { return .me }
            let person = id.isEmpty ? nil : directory?.person(id)
            let local = People.emailLocalPart(other)
            let name = person.map(People.displayName).flatMap { $0.isEmpty ? nil : $0 } ?? (local.isEmpty ? other : local)
            return .person(
                key: "person:\(id.isEmpty ? other.lowercased() : id)",
                name: name,
                initials: People.authorInitials(name),
                personId: person?.principalId
            )
        }
        if let bot = message.from?.botId { return .bot(id: bot) }
        return .none
    }

    /// `continuesRun`: same author, same day, at most five minutes apart.
    public static func continuesRun(previous: (at: Double, author: RoomAuthor)?, next: (at: Double, author: RoomAuthor)) -> Bool {
        guard let previous, previous.author.key == next.author.key else { return false }
        let calendar = Calendar.current
        let a = Date(timeIntervalSince1970: previous.at / 1000), b = Date(timeIntervalSince1970: next.at / 1000)
        guard calendar.isDate(a, inSameDayAs: b) else { return false }
        return next.at - previous.at <= 5 * 60_000
    }
}

// MARK: - The direct conversation between two people (people-dm.ts)

public struct PeopleDMPeer: Hashable, Sendable {
    public var id: String
    public var name: String
    public var initials: String
}

public extension Room {
    /// `peopleDmPeer`: the other person of a people-only conversation, with
    /// their directory name, else the conversation's name, else their id.
    func peopleDMPeer(viewerId: String, directory: OrgDirectory?) -> PeopleDMPeer? {
        guard peopleDm == true else { return nil }
        let me = People.norm(viewerId)
        let humans = humanIds ?? []
        guard let id = humans.first(where: { People.norm($0) != me }) ?? humans.first else { return nil }
        let person = directory?.person(id)
        let label = person.map { People.label($0, fallback: "") } ?? ""
        let shown = !label.isEmpty ? label : (name.isEmpty ? id : name)
        return PeopleDMPeer(id: id, name: shown, initials: People.initials(shown))
    }
}

public extension CompanionClient {
    func openPeopleDMRequest(principalId: String) throws -> URLRequest {
        struct Body: Encodable { let principalId: String }
        return try makeRequest("POST", "/api/people-dms", encodedBody: Body(principalId: principalId))
    }

    /// `openPeopleDm`: the conversation with this person, made on first use.
    func openPeopleDM(principalId: String) async throws -> Room {
        try await send(openPeopleDMRequest(principalId: principalId), as: GroupResponse.self).group
    }

    /// `GET /api/people/:id/library` (#2117): files of the rooms both people
    /// are in, their direct conversation included.
    func personLibraryRequest(personId: String) throws -> URLRequest {
        try makeRequest("GET", "/api/people/\(personId)/library")
    }

    func personLibrary(personId: String) async throws -> [ThreadFile] {
        try await send(personLibraryRequest(personId: personId), as: ThreadFilesResponse.self).files
    }
}

// MARK: - The person sheet (person-panel.ts, PersonPanel.tsx #2117)

/// Tabs of the person panel, desktop order: Profile, Library, Achievements.
public enum PersonPanelTab: String, CaseIterable, Identifiable, Sendable {
    case profile, library, achievements
    public var id: String { rawValue }
}

public struct PersonSheetModel: Hashable, Sendable {
    public struct Team: Hashable, Sendable {
        public var id: String
        public var name: String
        public var manager: Bool
    }

    public var personId: String
    /// Nil when the directory does not know them ("not in your directory").
    public var person: OrgDirectoryPerson?
    public var name: String
    public var initials: String
    /// Name-sorted teams with their manager flag.
    public var teams: [Team]
    /// Rooms the viewer shares with them (not their direct conversation).
    public var sharedRooms: [Room]
    /// Their bots the viewer already sees.
    public var sharedBots: [Bot]
    /// The direct conversation, when there is one.
    public var directRoom: Room?
    /// Message: off for yourself, a disabled or service account, and while
    /// the sheet was opened from inside their direct conversation (it would
    /// only reopen it, the owner 2026-10-26). From a group or a list it stays.
    public var canMessage: Bool
    /// Groups or bots in common: the In common section draws only then (#2117).
    public var hasInCommon: Bool { !sharedRooms.isEmpty || !sharedBots.isEmpty }

    public init(personId: String, directory: OrgDirectory?, state: CompanionState, viewerId: String, viewerIsAdmin: Bool = false, openedFromRoomId: String? = nil) {
        let id = People.norm(personId)
        let person = directory?.person(personId)
        self.personId = personId
        self.person = person
        name = People.label(person, fallback: personId)
        initials = People.initials(name)
        let teamNames = Dictionary((directory?.teams ?? []).map { ($0.id, $0.name) }, uniquingKeysWith: { first, _ in first })
        teams = (person?.teams ?? [])
            .compactMap { seat in teamNames[seat.id].flatMap { $0.isEmpty ? nil : Team(id: seat.id, name: $0, manager: seat.manager) } }
            .sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
        sharedRooms = state.rooms.filter { room in
            room.dm != true && room.peopleDm != true && (room.humanIds ?? []).contains { People.norm($0) == id }
        }
        sharedBots = state.bots.filter { $0.hidden != true && People.norm($0.ownerUserId) == id }
        directRoom = state.rooms.first { room in
            room.peopleDm == true && (room.humanIds ?? []).contains { People.norm($0) == id }
        }
        let inTheirRoom = directRoom.map { room in openedFromRoomId == room.id } ?? false
        if let person, !inTheirRoom {
            canMessage = person.disabled != true && person.service != true && People.norm(person.principalId) != People.norm(viewerId)
        } else {
            canMessage = false
        }
        // #2117: no Manage in Perspicax / console link on the person panel,
        // even for an admin. viewerIsAdmin stays on the signature so call
        // sites keep compiling; it no longer changes what the sheet shows.
        _ = viewerIsAdmin
    }
}

// MARK: - Person panel Achievements tab (AchievementsPanel.tsx)

/// One tile of the person panel's Achievements tab.
public struct PersonAchievementTile: Hashable, Identifiable, Sendable {
    public var id: String { item.id }
    public var item: AchievementDefinition
    public var unlocked: Bool
    public var unlockedAt: Double?
    public var points: Int
}

public struct PersonAchievementCategory: Hashable, Identifiable, Sendable {
    public var id: AchievementCategory { category }
    public var category: AchievementCategory
    public var tiles: [PersonAchievementTile]
    public var unlocked: Int
}

/// Pure helpers for the person panel's Achievements tab (#2117).
public enum PersonPanelAchievements {
    /// How many recent unlocks the panel shows (desktop PANEL_RECENT).
    public static let recentLimit = 4

    /// Every achievement the panel may draw, by category in catalog order:
    /// unlocked ones in colour, the others locked. A secret that is not
    /// unlocked stays out, and a category left empty is dropped.
    public static func categories(_ card: PublicAchievementCard) -> [PersonAchievementCategory] {
        let unlocked = Dictionary(uniqueKeysWithValues: card.unlocked.map { ($0.id, $0) })
        var byCategory: [AchievementCategory: PersonAchievementCategory] = [:]
        var order: [AchievementCategory] = []
        for item in AchievementDefinition.catalog {
            let entry = unlocked[item.id]
            if entry == nil && item.hidden { continue }
            var group = byCategory[item.category] ?? PersonAchievementCategory(category: item.category, tiles: [], unlocked: 0)
            if byCategory[item.category] == nil { order.append(item.category) }
            let tile = PersonAchievementTile(
                item: item,
                unlocked: entry != nil,
                unlockedAt: entry?.unlockedAt,
                points: entry?.points ?? item.points
            )
            group.tiles.append(tile)
            if entry != nil { group.unlocked += 1 }
            byCategory[item.category] = group
        }
        return order.compactMap { byCategory[$0] }.filter { !$0.tiles.isEmpty }
    }

    /// The last unlocks, newest first.
    public static func recent(_ card: PublicAchievementCard, limit: Int = recentLimit) -> [PersonAchievementTile] {
        let known = Dictionary(uniqueKeysWithValues: AchievementDefinition.catalog.map { ($0.id, $0) })
        return card.unlocked
            .compactMap { entry -> PersonAchievementTile? in
                guard let item = known[entry.id] else { return nil }
                return PersonAchievementTile(item: item, unlocked: true, unlockedAt: entry.unlockedAt, points: entry.points)
            }
            .sorted { ($0.unlockedAt ?? 0) > ($1.unlockedAt ?? 0) }
            .prefix(limit)
            .map { $0 }
    }
}

// Rooms (feature parity matrix WP11: RM6-RM8, RM11, RM13-RM19): what the
// desktop's group panel (src/components/GroupPanel.tsx, GroupView.tsx,
// GroupMemoryTab.tsx, GroupPeoplePicker.tsx, GroupBotPicker.tsx, ChannelMembers.tsx) and its
// sidebar room menu (Sidebar.tsx RoomContextMenu) decide, as pure logic the
// phone's Room info sheet and room row menu draw from.
//
// Who may do what mirrors src/lib/group-owner.ts and server/groups/group-ownership.ts:
// on an organization server only a room's owner changes its settings (an
// organization admin owns a room nobody created, and may delete any room
// for moderation); anyone listed may leave it and bring their own bots in
// or take them out. A solo server has no owner: whoever may manage rooms
// owns them all. The remote client (a sidecar pairing) shows the panel
// read-only, with the memory tab the server itself says may be edited.
import Foundation

// MARK: - Who is looking

/// The person the room logic judges (`viewerActorId`, `config.viewer` in
/// src/lib/viewer.ts), from the signed-in session.
public struct RoomViewer: Hashable, Sendable {
    public var principalId: String?
    public var email: String?
    /// Organization role: "owner", "admin" or "member"; nil when unknown.
    public var role: String?

    public init(principalId: String? = nil, email: String? = nil, role: String? = nil) {
        self.principalId = principalId
        self.email = email
        self.role = role
    }

    public init(account: AuthSession?) {
        self.init(principalId: account?.principalId, email: account?.email, role: account?.role)
    }

    /// The id the viewer's bots and room seats carry: the principal, else
    /// the sign-in email, else "local-owner" (the desktop's fallback).
    public var actorId: String {
        if let principal = Self.norm(principalId), !principal.isEmpty { return principal }
        if let email = Self.norm(email), !email.isEmpty { return email }
        return "local-owner"
    }

    public var normalizedEmail: String? {
        guard let email = Self.norm(email), !email.isEmpty else { return nil }
        return email
    }

    /// Organization admin, or the server's owner (`viewerIsOrgAdmin`).
    public var isOrgAdmin: Bool { role == "admin" || role == "owner" }

    static func norm(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

// MARK: - Ownership (src/lib/group-owner.ts)

public enum RoomOwnership {
    /// Whether the viewer may change this room's settings. A solo server
    /// sends no owner (everyone who may manage rooms owns them); on an
    /// organization server a room without an owner is its admins'.
    public static func owns(_ room: Room, viewer: RoomViewer, organization: Bool) -> Bool {
        guard let raw = room.ownerId else { return organization ? viewer.isOrgAdmin : true }
        let owner = RoomViewer.norm(raw) ?? ""
        return owner == viewer.actorId || (viewer.normalizedEmail.map { $0 == owner } ?? false)
    }

    /// The owner deletes a room; an organization admin may too (moderation).
    public static func mayDelete(_ room: Room, viewer: RoomViewer, organization: Bool) -> Bool {
        owns(room, viewer: viewer, organization: organization) || (organization && viewer.isOrgAdmin)
    }

    /// Whether the viewer is one of the room's people (and so may leave it).
    public static func isListed(_ room: Room, viewer: RoomViewer) -> Bool {
        (room.humanIds ?? []).contains { isViewer($0, viewer) }
    }

    /// Listed in their own name, or the recorded owner (server/groups/group-leave.ts).
    public static func mayLeave(_ room: Room, viewer: RoomViewer) -> Bool {
        if isListed(room, viewer: viewer) { return true }
        guard let raw = room.ownerId, let owner = RoomViewer.norm(raw), !owner.isEmpty else { return false }
        return owner == viewer.actorId || viewer.normalizedEmail == owner
    }

    /// What leaving does (src/lib/group-leave.ts `leaveOutcome`).
    public enum LeaveOutcome: Equatable, Sendable { case member, owner, last }

    public static func leaveOutcome(_ room: Room, viewer: RoomViewer) -> LeaveOutcome {
        let others = humanIdsLeaving(room, viewer: viewer).filter {
            let id = RoomViewer.norm($0) ?? ""
            return !id.isEmpty && !id.hasPrefix("team:")
        }
        if others.isEmpty { return .last }
        guard let raw = room.ownerId, let owner = RoomViewer.norm(raw) else { return .member }
        return owner == viewer.actorId || viewer.normalizedEmail == owner ? .owner : .member
    }

    /// The room's people without the viewer.
    public static func humanIdsLeaving(_ room: Room, viewer: RoomViewer) -> [String] {
        (room.humanIds ?? []).filter { !isViewer($0, viewer) }
    }

    /// The room's people with one more (lowercased, deduplicated, in order).
    public static func humanIdsAdding(_ id: String, to room: Room) -> [String] {
        var seen = Set<String>()
        return ((room.humanIds ?? []) + [id])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// The room's people without one.
    public static func humanIdsRemoving(_ id: String, from room: Room) -> [String] {
        let target = RoomViewer.norm(id)
        return (room.humanIds ?? []).filter { RoomViewer.norm($0) != target }
    }

    private static func isViewer(_ id: String, _ viewer: RoomViewer) -> Bool {
        let entry = RoomViewer.norm(id) ?? ""
        return entry == viewer.actorId || (viewer.normalizedEmail.map { $0 == entry } ?? false)
    }

    /// `nextMemberIds` (src/lib/room-members.ts): existing members keep their
    /// order, additions land at the end in the picker's order.
    public static func nextMemberIds(current: [String], picked: Set<String>, order: [String]) -> [String] {
        current.filter { picked.contains($0) } + order.filter { picked.contains($0) && !current.contains($0) }
    }

    /// Bots the viewer owns (`ownBotIds`): a member who does not own the
    /// room still brings them in and takes them out.
    public static func ownBotIds(_ bots: [Bot], viewer: RoomViewer) -> Set<String> {
        let actor = viewer.actorId
        return Set(bots.filter { (RoomViewer.norm($0.ownerUserId) ?? "") == actor && !actor.isEmpty }.map(\.id))
    }

    /// `nextHumanIds` (src/lib/room-members.ts): who stays keeps their
    /// place, people added land at the end; lowercased, never twice.
    public static func nextHumanIds(current: [String], picked: Set<String>, added: [String]) -> [String] {
        var seen = Set<String>()
        return (current + added)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty && picked.contains($0) && seen.insert($0).inserted }
    }

    /// `rosterBotChoices` (src/lib/room-members.ts, #1240): the bots the
    /// viewer may tick in the roster. The owner picks among every bot;
    /// anyone else only their own. An archived bot stays while a member.
    public static func rosterBotChoices(_ room: Room, bots: [Bot], viewer: RoomViewer, owns: Bool) -> [Bot] {
        let own = ownBotIds(bots, viewer: viewer)
        return bots.filter { bot in
            if bot.hidden == true && !room.memberIds.contains(bot.id) { return false }
            return owns || own.contains(bot.id)
        }
    }

    /// The first of the viewer's bots not yet in the room (`onAddBot`).
    public static func ownBotToAdd(_ room: Room, bots: [Bot], viewer: RoomViewer) -> Bot? {
        let own = ownBotIds(bots, viewer: viewer)
        return bots.first { own.contains($0.id) && !room.memberIds.contains($0.id) }
    }
}

// MARK: - What the Room info sheet offers

/// The desktop panel's decisions for one room and one pairing. A refused
/// item is not drawn (`SurfaceGate`); the memory tab asks the server.
public struct RoomInfoAccess: Hashable, Sendable {
    /// The room's own settings are reachable on this pairing (not the
    /// remote client's read-only panel).
    public var manages: Bool
    /// The viewer owns the room's settings.
    public var owns: Bool
    /// Rename, instructions, manage members, who answers.
    public var editable: Bool { manages && owns }
    /// "Only the group's owner can change these settings."
    public var readOnlyNote: Bool { manages && !owns }
    /// The Memory row (RM8, D3).
    public var memory: Bool
    /// Leave group (#1480): listed in their own name, owner included (the
    /// group passes on), on an organization server.
    public var canLeave: Bool
    /// Delete group chat (RM16).
    public var canDelete: Bool
    /// Move to section (RM15). An organization server files rooms in each
    /// person's own sections, which this build does not edit yet (SB2).
    public var canMoveSection: Bool
    /// Add a person (`channelRosterActions` canAddHuman).
    public var canAddHuman: Bool
    /// Add one of the viewer's own bots (`canAddBot`).
    public var canAddOwnBot: Bool
    /// "+ Add" under Bots: a bot the viewer may tick is not in the room
    /// yet. It opens the roster, never adds on its own (#1240).
    public var canAddBot: Bool
    /// "Manage members": the viewer can change something in the roster
    /// (the owner, someone who adds people, or anyone with a bot).
    public var canManageRoster: Bool
    /// Remove any bot (the owner) or only the viewer's own.
    public var removableBotIds: Set<String>
    /// The owner removes people.
    public var canRemoveHumans: Bool { editable }
    /// The people picker reads the organization directory.
    public var organization: Bool

    public init(room: Room, gate: SurfaceGate, viewer: RoomViewer, bots: [Bot]) {
        let organization = gate.organization
        let teamRoom = room.dm != true && room.peopleDm != true
        let manages = gate.allows(.roomManagement) && teamRoom
        let owns = RoomOwnership.owns(room, viewer: viewer, organization: organization)
        self.manages = manages
        self.owns = owns
        self.organization = organization
        memory = gate.allows(.roomMemory) && teamRoom
        canLeave = manages && organization && RoomOwnership.mayLeave(room, viewer: viewer)
        canDelete = gate.allows(.roomDelete) && room.peopleDm != true
            && RoomOwnership.mayDelete(room, viewer: viewer, organization: organization)
        canMoveSection = manages && !organization
        // A solo server's viewer is its operator (the desktop's "owner" role).
        let role = organization ? viewer.role : "owner"
        // The room's owner adds people whatever their organization role, as
        // on the desktop (`channelRosterActions`, #1061): the server limits a
        // member to the people the organization directory shows them.
        canAddHuman = manages && owns && role != nil
        canAddOwnBot = manages && RoomOwnership.ownBotToAdd(room, bots: bots, viewer: viewer) != nil
        let own = RoomOwnership.ownBotIds(bots, viewer: viewer)
        removableBotIds = manages ? Set(room.memberIds.filter { owns || own.contains($0) }) : []
        canAddBot = manages && RoomOwnership.rosterBotChoices(room, bots: bots, viewer: viewer, owns: owns)
            .contains { !room.memberIds.contains($0.id) }
        canManageRoster = manages && (owns || canAddHuman || !own.isEmpty)
    }
}

// MARK: - A room's call (GroupCallButton, src/components/GroupCallView.tsx)

public enum RoomCallReadiness {
    /// `CallTargetButton` with `requireExplicitVoices`: a room call speaks
    /// with text to speech, so it waits until speech is set up and every
    /// member has its own voice; until then the button wears the warning
    /// dot and explains instead of calling.
    public static func ready(speechConfigured: Bool, memberVoices: [String?]) -> Bool {
        speechConfigured && !memberVoices.isEmpty && memberVoices.allSatisfy { ($0 ?? "").isEmpty == false }
    }
}

// MARK: - Who answers (DefaultResponderSelect, src/lib/group-routing.ts)

public enum RoomResponder {
    /// `effectiveDefaultResponder`: a lead that left falls back to the first
    /// member, an Auto room keeps its fallback while that bot is still in.
    public static func effective(_ room: Room) -> GroupResponder {
        let value = room.defaultResponder
        let members = room.memberIds
        switch value.kind {
        case "everyone", "mentions":
            return value
        case "member":
            if let botId = value.botId, members.contains(botId) { return value }
        case "auto":
            if let fallback = value.fallbackBotId, members.contains(fallback) { return value }
            return GroupResponder(kind: "auto")
        default:
            break
        }
        if let first = members.first { return GroupResponder(kind: "member", botId: first) }
        return GroupResponder(kind: "mentions")
    }

    /// One choice of the picker.
    public enum Choice: Hashable, Sendable {
        case lead(botId: String)
        case auto, everyone, mentions
    }

    public static func choice(_ room: Room) -> Choice {
        let value = effective(room)
        switch value.kind {
        case "everyone": return .everyone
        case "mentions": return .mentions
        case "auto": return .auto
        default: return .lead(botId: value.botId ?? "")
        }
    }

    /// The value sent for a choice. The lead a room had stays on as Auto's
    /// fallback.
    public static func value(for choice: Choice, in room: Room) -> GroupResponder {
        switch choice {
        case .everyone: return GroupResponder(kind: "everyone")
        case .mentions: return GroupResponder(kind: "mentions")
        case let .lead(botId): return GroupResponder(kind: "member", botId: botId)
        case .auto:
            let current = effective(room)
            if current.kind == "member", let lead = current.botId { return GroupResponder(kind: "auto", fallbackBotId: lead) }
            return GroupResponder(kind: "auto")
        }
    }

    /// The bot that answers a plain message (`defaultResponderName`): the
    /// lead, or an Auto room's fallback (else the first member).
    public static func answeringBotId(_ room: Room) -> String? {
        let value = effective(room)
        if value.kind == "auto" { return value.fallbackBotId ?? room.memberIds.first }
        return value.kind == "member" ? value.botId : nil
    }
}

// MARK: - Group memory (GroupMemoryTab.tsx, server/routes/group-memory.ts)

/// How much of a memory file loads each turn (`MemoryCapacity`).
public struct MemoryCapacity: Codable, Hashable, Sendable {
    public var lines: Int
    public var bytes: Int
    public var maxLines: Int
    public var maxBytes: Int
    public var loadedLines: Int
    public var loadedBytes: Int
    public var truncated: Bool

    public init(lines: Int, bytes: Int, maxLines: Int, maxBytes: Int, loadedLines: Int, loadedBytes: Int, truncated: Bool) {
        self.lines = lines
        self.bytes = bytes
        self.maxLines = maxLines
        self.maxBytes = maxBytes
        self.loadedLines = loadedLines
        self.loadedBytes = loadedBytes
        self.truncated = truncated
    }

    public enum Level: String, Hashable, Sendable { case ok, near, over }

    public var lineShare: Double { maxLines > 0 ? Double(lines) / Double(maxLines) : 0 }
    public var byteShare: Double { maxBytes > 0 ? Double(bytes) / Double(maxBytes) : 0 }

    /// `capacityStatus`: over when the file is cut, near from 80 %.
    public var level: Level {
        if truncated { return .over }
        return max(lineShare, byteShare) >= 0.8 ? .near : .ok
    }

    /// Lines the turn does not load (positive only when cut by lines).
    public var missingLines: Int { truncated ? lines - loadedLines : 0 }

    /// `formatBytes` of src/lib/memory.ts: "512 B", "3.4 KB".
    public static func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        let tenths = (Double(bytes) / 102.4).rounded() / 10
        return tenths == tenths.rounded() ? "\(Int(tenths)) KB" : "\(tenths) KB"
    }
}

/// What `GET /api/groups/:id/memory` answers.
public struct GroupMemoryView: Codable, Hashable, Sendable {
    public var enabled: Bool
    /// The group's owner: the server's word, never guessed here.
    public var canEdit: Bool
    public var text: String
    public var hash: String
    public var capacity: MemoryCapacity

    public init(enabled: Bool, canEdit: Bool, text: String, hash: String, capacity: MemoryCapacity) {
        self.enabled = enabled
        self.canEdit = canEdit
        self.text = text
        self.hash = hash
        self.capacity = capacity
    }
}

/// A bot changed the memory while the person edited it: nothing was saved.
public struct GroupMemoryConflict: Error, Hashable, Sendable {
    public init() {}
}

// MARK: - People picker (GroupPeoplePicker.tsx, src/lib/private-threads.ts)

public struct OrgDirectoryPerson: Codable, Hashable, Sendable, Identifiable {
    /// A team the person is in, and whether they manage it.
    public struct TeamSeat: Codable, Hashable, Sendable {
        public var id: String
        public var manager: Bool
        public init(id: String, manager: Bool = false) {
            self.id = id
            self.manager = manager
        }
    }

    public var principalId: String
    public var name: String
    public var login: String
    public var email: String?
    public var disabled: Bool?
    /// "admin" or "member" in the organization.
    public var role: String?
    /// Their Perspicax avatar as this server serves it.
    public var avatarUrl: String?
    /// A Perspicax service account: never someone to write to.
    public var service: Bool?
    /// Admins only: this person's page in the Perspicax console.
    public var manageUrl: String?
    public var teams: [TeamSeat]?
    /// Their custom label (#172), as the directory carries it.
    public var label: String?

    public var id: String { principalId }

    public init(
        principalId: String, name: String = "", login: String = "", email: String? = nil, disabled: Bool? = nil,
        role: String? = nil, avatarUrl: String? = nil, service: Bool? = nil, manageUrl: String? = nil, teams: [TeamSeat]? = nil,
        label: String? = nil
    ) {
        self.principalId = principalId
        self.name = name
        self.login = login
        self.email = email
        self.disabled = disabled
        self.role = role
        self.avatarUrl = avatarUrl
        self.service = service
        self.manageUrl = manageUrl
        self.teams = teams
        self.label = label
    }

    private enum CodingKeys: String, CodingKey { case principalId, name, login, email, disabled, role, avatarUrl, service, manageUrl, teams, label }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        principalId = try values.decode(String.self, forKey: .principalId)
        name = try values.decodeIfPresent(String.self, forKey: .name) ?? ""
        login = try values.decodeIfPresent(String.self, forKey: .login) ?? ""
        email = try values.decodeIfPresent(String.self, forKey: .email)
        disabled = try values.decodeIfPresent(Bool.self, forKey: .disabled)
        role = try? values.decodeIfPresent(String.self, forKey: .role)
        avatarUrl = try? values.decodeIfPresent(String.self, forKey: .avatarUrl)
        service = try? values.decodeIfPresent(Bool.self, forKey: .service)
        manageUrl = try? values.decodeIfPresent(String.self, forKey: .manageUrl)
        teams = (try? values.decodeIfPresent([Lossy<TeamSeat>].self, forKey: .teams))?.compactMap(\.value)
        label = try? values.decodeIfPresent(String.self, forKey: .label)
    }
}

/// A team of the organization's directory.
public struct OrgDirectoryTeam: Codable, Hashable, Sendable, Identifiable {
    public var id: String
    public var name: String
    /// Principal ids, when the directory gives them (a group's size).
    public var members: [String]?
    public var managers: [String]?
    public init(id: String, name: String, members: [String]? = nil, managers: [String]? = nil) {
        self.id = id
        self.name = name
        self.members = members
        self.managers = managers
    }

    /// How many people the team holds, members and managers once each.
    public var size: Int { Set((members ?? []) + (managers ?? [])).count }
}

public struct OrgDirectory: Decodable, Hashable, Sendable {
    /// Who asks (`viewer` of the directory answer): their role and the teams
    /// they manage, for the label rights (#172).
    public struct Viewer: Decodable, Hashable, Sendable {
        public var principalId: String?
        public var orgRole: String?
        public var managedTeamIds: [String]

        public init(principalId: String? = nil, orgRole: String? = nil, managedTeamIds: [String] = []) {
            self.principalId = principalId
            self.orgRole = orgRole
            self.managedTeamIds = managedTeamIds
        }

        private enum CodingKeys: String, CodingKey { case principalId, orgRole, managedTeamIds }

        public init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            principalId = try? values.decodeIfPresent(String.self, forKey: .principalId)
            orgRole = try? values.decodeIfPresent(String.self, forKey: .orgRole)
            managedTeamIds = (try? values.decodeIfPresent([String].self, forKey: .managedTeamIds)) ?? []
        }
    }

    public var people: [OrgDirectoryPerson]
    public var teams: [OrgDirectoryTeam]
    public var viewer: Viewer?

    private enum CodingKeys: String, CodingKey { case people, teams, viewer }

    public init(people: [OrgDirectoryPerson], teams: [OrgDirectoryTeam] = [], viewer: Viewer? = nil) {
        self.people = people
        self.teams = teams
        self.viewer = viewer
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        people = (try? values.decodeIfPresent([Lossy<OrgDirectoryPerson>].self, forKey: .people))?.compactMap(\.value) ?? []
        teams = (try? values.decodeIfPresent([Lossy<OrgDirectoryTeam>].self, forKey: .teams))?.compactMap(\.value) ?? []
        viewer = try? values.decodeIfPresent(Viewer.self, forKey: .viewer)
    }

    /// `groupPeopleCandidates`: active people not yet in the room, matching
    /// the query on name, login or email, at most `limit`.
    public func candidates(taken: [String], query: String, limit: Int = 20) -> [OrgDirectoryPerson] {
        let takenIds = Set(taken.map { id -> String in
            let bare = id.hasPrefix("user:") ? String(id.dropFirst(5)) : id
            return bare.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        })
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return Array(people.filter { person in
            if person.disabled == true || takenIds.contains(person.principalId.lowercased()) { return false }
            if q.isEmpty { return true }
            return [person.name, person.login, person.email ?? ""].contains { $0.lowercased().contains(q) }
        }.prefix(limit))
    }

    /// How a person id of the room reads: the directory's name, else the id.
    public func label(for id: String) -> String {
        let bare = (id.hasPrefix("user:") ? String(id.dropFirst(5)) : id).lowercased()
        guard let person = people.first(where: { $0.principalId.lowercased() == bare }) else { return id }
        return person.name.isEmpty ? (person.login.isEmpty ? id : person.login) : person.name
    }
}

// MARK: - Room patch (PATCH /api/groups/:id, the desktop's `patchGroup`)

/// One room write. Only the fields set are sent.
public struct RoomPatch: Encodable, Hashable, Sendable {
    public var name: String?
    public var bulletin: String?
    public var section: String?
    public var memberIds: [String]?
    public var humanIds: [String]?
    public var defaultResponder: GroupResponder?

    public init(
        name: String? = nil, bulletin: String? = nil, section: String? = nil,
        memberIds: [String]? = nil, humanIds: [String]? = nil, defaultResponder: GroupResponder? = nil
    ) {
        self.name = name
        self.bulletin = bulletin
        self.section = section
        self.memberIds = memberIds
        self.humanIds = humanIds
        self.defaultResponder = defaultResponder
    }

    /// `nextRename`: a trimmed, non-empty name of at most 100 characters that
    /// differs from the current one; nil when there is nothing to save.
    public static func rename(_ current: String, to draft: String) -> String? {
        let name = String(draft.trimmingCharacters(in: .whitespacesAndNewlines).prefix(100))
        return name.isEmpty || name == current ? nil : name
    }
}

// MARK: - Sections a room may move to (Sidebar.tsx SectionPicker)

public enum RoomSections {
    /// The server's sections, then the ones bots and rooms already carry,
    /// once each.
    public static func names(_ state: CompanionState) -> [String] {
        var seen = Set<String>()
        let raw = state.sidebarSections.map(\.name)
            + state.bots.filter { $0.hidden != true }.compactMap(\.section)
            + state.rooms.compactMap(\.section)
        return raw
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty && seen.insert($0).inserted }
    }

    /// A new section name the picker accepts (1 to 60 characters).
    public static func valid(_ draft: String) -> String? {
        let name = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return name.isEmpty || name.count > 60 ? nil : name
    }
}

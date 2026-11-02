import Foundation

// Who sees which routines on the Automations page (matrix AU20; the desktop's
// routines/RoutineScopeBar.tsx and lib/use-routine-scope.ts over
// shared/routine-scope.ts and server/routines/routine-scope.ts).
//
//   mine  the routines of the bots and rooms the person sees (always)
//   team  plus those of the people in their teams and of the bots shared
//         with those teams (routines.viewTeam, or an admin)
//   all   every routine of the organization (routines.viewAll, or an admin)
//
// The server decides what each scope answers and never returns a routine
// outside it. Someone else's routine comes `redacted` with `canRun` and
// `canEdit` false: the phone shows its owner and hides Run now, Edit, Pause
// and Delete. Organization servers only; a solo server lists Mine.

public enum RoutineScope: String, Codable, CaseIterable, Hashable, Sendable {
    case mine, team, all

    /// The permission a wider scope needs (`ROUTINE_SCOPE_PERMISSION`).
    public var permission: String? {
        switch self {
        case .mine: nil
        case .team: "routines.viewTeam"
        case .all: "routines.viewAll"
        }
    }
}

public enum RoutineScopeStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case active, paused, failing
}

/// Which scopes the caller may ask for (`allowed` of the listing).
public struct RoutineScopeAllowed: Codable, Hashable, Sendable {
    public var mine: Bool
    public var team: Bool
    public var all: Bool

    public init(mine: Bool = true, team: Bool = false, all: Bool = false) {
        self.mine = mine
        self.team = team
        self.all = all
    }

    /// An older server, or a solo one: Mine only.
    public static let mineOnly = RoutineScopeAllowed()

    public func allows(_ scope: RoutineScope) -> Bool {
        switch scope {
        case .mine: true
        case .team: team
        case .all: all
        }
    }
}

/// A person, a team or a bot one of the filters can pick.
public struct RoutineScopeChoice: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var avatarUrl: String? = nil

    public init(id: String, name: String, avatarUrl: String? = nil) {
        self.id = id
        self.name = name
        self.avatarUrl = avatarUrl
    }
}

public typealias RoutineOwner = RoutineScopeChoice

public struct RoutineScopeFacets: Codable, Hashable, Sendable {
    public var teams: [RoutineScopeChoice]
    public var owners: [RoutineScopeChoice]
    public var botChoices: [RoutineScopeChoice]

    public init(teams: [RoutineScopeChoice] = [], owners: [RoutineScopeChoice] = [], botChoices: [RoutineScopeChoice] = []) {
        self.teams = teams
        self.owners = owners
        self.botChoices = botChoices
    }
}

/// The scope and filters of `GET /api/routines` (`RoutineScopeQuery`).
public struct RoutineScopeQuery: Hashable, Sendable {
    public var scope: RoutineScope
    public var teamId: String?
    public var botId: String?
    public var ownerId: String?
    public var status: RoutineScopeStatus?

    public init(scope: RoutineScope = .mine, teamId: String? = nil, botId: String? = nil, ownerId: String? = nil, status: RoutineScopeStatus? = nil) {
        self.scope = scope
        self.teamId = teamId
        self.botId = botId
        self.ownerId = ownerId
        self.status = status
    }

    /// Mine with no filter sends nothing (the plain listing, as before).
    /// The bot filter stays on the phone, as the desktop's All bots does.
    public var queryItems: [URLQueryItem] {
        var items: [URLQueryItem] = []
        if scope != .mine { items.append(URLQueryItem(name: "scope", value: scope.rawValue)) }
        if scope != .mine, let teamId, !teamId.isEmpty { items.append(URLQueryItem(name: "teamId", value: teamId)) }
        if scope != .mine, let ownerId, !ownerId.isEmpty { items.append(URLQueryItem(name: "ownerId", value: ownerId)) }
        if let status { items.append(URLQueryItem(name: "status", value: status.rawValue)) }
        return items
    }

    /// The query after picking another scope: Team and Owner belong to the
    /// wider scopes and are cleared on Mine (`RoutineScopeBar`).
    public func choosing(_ next: RoutineScope) -> RoutineScopeQuery {
        var copy = self
        copy.scope = next
        if next == .mine {
            copy.teamId = nil
            copy.ownerId = nil
        }
        return copy
    }

    /// A scope the caller may not ask for falls back to Mine.
    public func allowed(by allowed: RoutineScopeAllowed) -> RoutineScopeQuery {
        allowed.allows(scope) ? self : choosing(.mine)
    }

    public var hasFilters: Bool { teamId != nil || ownerId != nil || status != nil }
}

/// One scoped listing.
public struct ScopedRoutines: Sendable {
    public var routines: [Routine]
    public var runs: [RoutineRun]
    public var scope: RoutineScope
    public var allowed: RoutineScopeAllowed
    public var facets: RoutineScopeFacets
    /// Each bot's folder order (RoutineFolders.swift); empty from an older server.
    public var folders: [String: [String]] = [:]
    /// Whether the server has routine folders (`folders` is always sent there).
    public var foldersSupported = true

    init(response: RoutinesResponse, asked: RoutineScope) {
        folders = response.folders ?? [:]
        foldersSupported = response.folders != nil
        routines = response.routines
        runs = response.runs
        scope = response.scope ?? asked
        allowed = response.allowed ?? .mineOnly
        facets = response.facets ?? RoutineScopeFacets()
    }

    public init(routines: [Routine], runs: [RoutineRun], scope: RoutineScope = .mine, allowed: RoutineScopeAllowed = .mineOnly, facets: RoutineScopeFacets = RoutineScopeFacets()) {
        self.routines = routines
        self.runs = runs
        self.scope = scope
        self.allowed = allowed
        self.facets = facets
    }
}

public extension Routine {
    /// Edit, Pause, Resume and Delete: only on the caller's own routines
    /// (an older server sends no flag: allowed, as before).
    var mayEdit: Bool { canEdit != false && redacted != true }
    /// Run now (its own gate on the server, `mayRunRoutineNow`).
    var mayRun: Bool { canRun != false && redacted != true }
    /// The owner line of someone else's routine, nil on the caller's own.
    var foreignOwnerName: String? {
        guard redacted == true || canEdit == false, let owner else { return nil }
        return owner.name.isEmpty ? owner.id : owner.name
    }
}

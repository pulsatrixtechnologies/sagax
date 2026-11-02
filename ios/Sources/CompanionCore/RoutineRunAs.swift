// "Runs as" in the routine editor (the desktop's routines/RunAsField.tsx,
// Owner 2026-10-08). On an organization server a routine acts with one
// person's access: their routine delegation and their rights on the bot. An
// admin may pick any active person, a team manager the people of their
// teams (else themselves and the bot's owner); anyone else sees only the
// line. The server decides whom (GET /api/routines/run-as-options,
// server/routines/routine-run-as.ts) and checks the choice again on save. A solo
// server answers with no choice and no current person: nothing is shown.
import Foundation

public struct RoutineRunAsOption: Codable, Hashable, Identifiable, Sendable {
    public var principalId: String
    public var name: String
    public var avatarUrl: String?
    /// False: listed for context, cannot be chosen (`reason` says why).
    public var selectable: Bool
    /// "no_right": the person cannot run this bot's routines.
    public var reason: String?
    /// The person has not delegated routines yet: it runs once they sign in.
    public var pending: Bool?

    public var id: String { principalId }

    public init(principalId: String, name: String, avatarUrl: String? = nil, selectable: Bool = true, reason: String? = nil, pending: Bool? = nil) {
        self.principalId = principalId
        self.name = name
        self.avatarUrl = avatarUrl
        self.selectable = selectable
        self.reason = reason
        self.pending = pending
    }
}

public struct RoutineRunAsCurrent: Codable, Hashable, Sendable {
    public var principalId: String
    public var name: String
    public var pending: Bool?

    public init(principalId: String, name: String, pending: Bool? = nil) {
        self.principalId = principalId
        self.name = name
        self.pending = pending
    }
}

public struct RoutineRunAsOptions: Codable, Hashable, Sendable {
    public var canChoose: Bool
    public var people: [RoutineRunAsOption]
    public var current: RoutineRunAsCurrent?

    public init(canChoose: Bool, people: [RoutineRunAsOption] = [], current: RoutineRunAsCurrent? = nil) {
        self.canChoose = canChoose
        self.people = people
        self.current = current
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        canChoose = (try? values.decode(Bool.self, forKey: .canChoose)) ?? false
        people = (try? values.decode([RoutineRunAsOption].self, forKey: .people)) ?? []
        current = try? values.decodeIfPresent(RoutineRunAsCurrent.self, forKey: .current)
    }
}

public enum RoutineRunAsField {
    /// Above this many people the list gets a search field.
    public static let searchAfter = 8

    /// The field shows at all: a choice, or at least the current person.
    public static func shown(_ options: RoutineRunAsOptions?) -> Bool {
        guard let options else { return false }
        return options.canChoose || options.current != nil
    }

    /// The list's rows: the people matching `query`, the selected one always
    /// kept (first, when the server did not list it). `runAsRows`.
    public static func rows(_ options: RoutineRunAsOptions, selected: String?, query: String) -> [RoutineRunAsOption] {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let rows = options.people.filter { person in
            needle.isEmpty || person.principalId == selected || person.name.lowercased().contains(needle)
        }
        let listed = options.people.contains { $0.principalId == selected }
        if !listed, let selected, let current = options.current, current.principalId == selected {
            let row = RoutineRunAsOption(principalId: selected, name: current.name.isEmpty ? selected : current.name, selectable: true, pending: current.pending == true ? true : nil)
            return [row] + rows
        }
        return rows
    }

    /// The person shown as chosen: the selection, else the current person.
    public static func chosen(_ options: RoutineRunAsOptions, selected: String?) -> RoutineRunAsOption? {
        let id = selected ?? options.current?.principalId
        if let person = options.people.first(where: { $0.principalId == id }) { return person }
        if let current = options.current, current.principalId == id || id == nil {
            return RoutineRunAsOption(principalId: current.principalId, name: current.name, selectable: true, pending: current.pending == true ? true : nil)
        }
        return nil
    }

    /// The name of a person, their id when the server sent no name.
    public static func name(_ person: RoutineRunAsOption) -> String {
        person.name.isEmpty ? person.principalId : person.name
    }

    /// A choice that no longer stands (another bot chosen, the person can't
    /// run it): back to the current person (nil).
    public static func keep(_ selected: String?, in options: RoutineRunAsOptions?) -> String? {
        guard let selected, let options else { return selected }
        return options.people.contains { $0.principalId == selected && $0.selectable } ? selected : nil
    }

    /// What a save sends: the chosen person only when it differs from the
    /// routine's current one (the desktop's `runAs !== current`).
    public static func toSend(_ selected: String?, options: RoutineRunAsOptions?) -> String? {
        guard let selected, let options, options.canChoose, selected != options.current?.principalId else { return nil }
        return selected
    }
}

public extension CompanionClient {
    /// Whom the caller may choose for a routine of this bot
    /// (`GET /api/routines/run-as-options`).
    func routineRunAsOptions(botId: String, routineId: String? = nil, target: String = "bot", groupId: String? = nil) async throws -> RoutineRunAsOptions {
        var query = [URLQueryItem(name: "botId", value: botId), URLQueryItem(name: "target", value: target)]
        if let routineId, !routineId.isEmpty { query.append(URLQueryItem(name: "routineId", value: routineId)) }
        if let groupId, !groupId.isEmpty { query.append(URLQueryItem(name: "groupId", value: groupId)) }
        return try await send(try makeRequest("GET", "/api/routines/run-as-options", query: query), as: RoutineRunAsOptions.self)
    }
}

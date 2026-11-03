// iPad final sweep (2026-11-03): the Team map team ⋯ menu's editors, the
// desktop's routes (TeamDialog.tsx, TeamMapPage.tsx SectionContextDialog,
// TeamMemoryDialog.tsx).
import Foundation

public struct SectionContext: Decodable, Equatable, Sendable {
    public var text: String
    public var updatedAt: Double?
    public var maxBytes: Int
}

struct SectionBotsResponse: Decodable, Sendable {
    var sections: [String]?
    var bots: [Bot]?
}

public extension CompanionClient {
    /// `GET /api/section-context?section=`: a team's shared instructions.
    func sectionContext(section: String) async throws -> SectionContext {
        try await send(try makeRequest("GET", "/api/section-context", query: [URLQueryItem(name: "section", value: section)]), as: SectionContext.self)
    }

    /// `PUT /api/section-context?section=` with `{ text }`.
    func saveSectionContext(section: String, text: String) async throws -> SectionContext {
        try await send(try makeRequest("PUT", "/api/section-context", query: [URLQueryItem(name: "section", value: section)], body: ["text": text]), as: SectionContext.self)
    }

    /// `PUT /api/sidebar-sections?section=` with `{ addBotIds, removeBotIds }`:
    /// Add or remove bots (a removed bot goes to Unassigned).
    func manageSectionBots(section: String, add: [String], remove: [String]) async throws -> [Bot] {
        try await send(try makeRequest("PUT", "/api/sidebar-sections", query: [URLQueryItem(name: "section", value: section)],
                                       body: ["addBotIds": add, "removeBotIds": remove]), as: SectionBotsResponse.self).bots ?? []
    }

    /// `PATCH /api/team-memory/:id?section=` with `{ accept: true }`: Remember.
    func acceptTeamMemory(section: String, id: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/team-memory/\(id)", query: [URLQueryItem(name: "section", value: section)], body: ["accept": true]))
    }

    /// `PATCH /api/team-memory/:id?section=` with `{ detail }`.
    func editTeamMemoryDetail(section: String, id: String, detail: String) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/team-memory/\(id)", query: [URLQueryItem(name: "section", value: section)], body: ["detail": detail]))
    }
}

// MARK: - Team computers (CanvasComputers.tsx, shared/team-computer.ts)

/// A named, workspace-owned Boat. Assignment grants one team's Auto bots
/// access to the same desktop, files and desktop browser sessions.
public struct TeamComputer: Decodable, Equatable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var section: String?
    public var state: String
    public var held: Bool
    public var problem: String?

    public var ready: Bool { ["idle", "ready", "running"].contains(state) }
    public var starting: Bool { ["init", "provisioning", "provisioned", "cloning", "starting"].contains(state) }
}

public struct TeamComputers: Decodable, Equatable, Sendable {
    public var computers: [TeamComputer]
    public var configured: Bool
    public var problem: String?
}

public struct TeamComputerJoin: Decodable, Sendable {
    public var joinUrl: String?
}

public extension CompanionClient {
    /// `GET /api/team-computers`
    func teamComputers() async throws -> TeamComputers {
        try await send(try makeRequest("GET", "/api/team-computers"), as: TeamComputers.self)
    }

    /// `POST /api/team-computers` `{ name, requestId, acknowledgeCost }`: a new cloud computer.
    func createTeamComputer(name: String, requestId: String) async throws {
        try await send(makeRequest("POST", "/api/team-computers", body: ["name": name, "requestId": requestId, "acknowledgeCost": true]))
    }

    /// `POST /api/team-computers/:id/<action>`: provision, sleep, control, join.
    @discardableResult
    func teamComputerAction(id: String, _ action: String, body: [String: Any] = [:]) async throws -> TeamComputerJoin {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        return try await send(try makeRequest("POST", "/api/team-computers/\(id)/\(action)", body: body), as: TeamComputerJoin.self)
    }

    /// `PATCH /api/team-computers/:id` `{ section, acknowledgeSharedAccess }`: assign or unassign.
    func assignTeamComputer(id: String, section: String?) async throws {
        guard Self.validRouteID(id) else { throw APIError.badURL }
        try await send(makeRequest("PATCH", "/api/team-computers/\(id)", body: ["section": section.map { $0 as Any } ?? NSNull(), "acknowledgeSharedAccess": true]))
    }
}

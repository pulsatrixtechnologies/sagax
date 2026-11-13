// The composer's requests (feature parity package WP3): the engine's slash
// commands, Steer on a held send, Stop in a room, Compact, and what the
// engines can do. Each path is the one the desktop renderer calls (store.tsx
// `steerQueued`, `steerGroupQueued`, `interruptGroup`; src/lib/harness-commands.ts)
// and passes both gates (companion `ALLOWED`, server `CLIENT_ALLOW`).
import Foundation

private struct InstanceCapabilityList: Decodable {
    struct Entry: Decodable {
        let instanceId: String
        let capabilities: EngineAbilities?
    }
    let instances: [Lossy<Entry>]
}

private struct FeatureFlagConfig: Decodable {
    struct Features: Decodable { let skillAuthoring: Bool?; let teachTask: Bool? }
    let features: Features?
}

extension CompanionClient {
    // MARK: Slash commands

    /// `harnessCommandsPath`.
    public func harnessCommandsRequest(botId: String, threadId: String?, groupId: String? = nil, refresh: Bool = false) throws -> URLRequest {
        guard Self.validRouteID(botId) else { throw APIError.badURL }
        var query: [URLQueryItem] = []
        if let threadId {
            guard Self.validRouteID(threadId) else { throw APIError.badURL }
            query.append(URLQueryItem(name: "threadId", value: threadId))
        }
        if let groupId {
            guard Self.validRouteID(groupId) else { throw APIError.badURL }
            query.append(URLQueryItem(name: "groupId", value: groupId))
        }
        if refresh { query.append(URLQueryItem(name: "refresh", value: "1")) }
        return try makeRequest("GET", "/api/bots/\(botId)/harness-commands", query: query)
    }

    /// `GET /api/bots/:id/harness-commands`: the engine's own commands for
    /// this conversation (in a room, `groupId` names it).
    public func harnessCommands(botId: String, threadId: String?, groupId: String? = nil, refresh: Bool = false) async throws -> HarnessCommandsAnswer {
        try await send(harnessCommandsRequest(botId: botId, threadId: threadId, groupId: groupId, refresh: refresh), as: HarnessCommandsAnswer.self)
    }

    /// What each engine instance can do, by instance id.
    public func engineAbilities() async throws -> [String: EngineAbilities] {
        let list = try await send(try makeRequest("GET", "/api/instances"), as: InstanceCapabilityList.self)
        var out: [String: EngineAbilities] = [:]
        for entry in list.instances.compactMap(\.value) {
            out[entry.instanceId] = entry.capabilities ?? EngineAbilities()
        }
        return out
    }

    /// `skillAuthoringEnabled`: on unless the computer switched it off.
    public func skillAuthoringEnabled() async throws -> Bool {
        try await composerFeatures().skillAuthoring
    }

    /// The composer's switches in one read of `/api/config`: skill authoring
    /// (on unless switched off) and Teach a task with `/learn`
    /// (`features.teachTask`, shared/teach-task.ts, #4209), offered only
    /// when the server says so.
    public func composerFeatures() async throws -> (skillAuthoring: Bool, teachTask: Bool) {
        let config = try await send(try makeRequest("GET", "/api/config"), as: FeatureFlagConfig.self)
        return (config.features?.skillAuthoring != false, config.features?.teachTask == true)
    }

    // MARK: Held sends

    public func steerQueuedRequest(queueId: String, to destination: MessageDestination) throws -> URLRequest {
        guard Self.validRouteID(queueId) else { throw APIError.badURL }
        switch destination {
        case let .bot(id, threadId):
            guard Self.validRouteID(id), Self.validRouteID(threadId) else { throw APIError.badURL }
            return try makeRequest("POST", "/api/bots/\(id)/queue/\(queueId)/steer", body: ["threadId": threadId])
        case let .room(id, threadId):
            guard Self.validRouteID(id), Self.validRouteID(threadId) else { throw APIError.badURL }
            return try makeRequest("POST", "/api/groups/\(id)/queue/\(queueId)/steer", body: ["threadId": threadId])
        }
    }

    /// Steer a held send into the running turn (never interrupts it). A
    /// bot's queue goes in whole; a room's head (its sender's burst).
    public func steerQueued(queueId: String, to destination: MessageDestination) async throws -> QueueSteerResult {
        try await send(steerQueuedRequest(queueId: queueId, to: destination), as: QueueSteerResult.self)
    }

    // MARK: Rooms

    public func interruptRoomRequest(groupId: String, threadId: String?) throws -> URLRequest {
        guard Self.validRouteID(groupId) else { throw APIError.badURL }
        if let threadId {
            guard Self.validRouteID(threadId) else { throw APIError.badURL }
            return try makeRequest("POST", "/api/groups/\(groupId)/interrupt", body: ["threadId": threadId])
        }
        return try makeRequest("POST", "/api/groups/\(groupId)/interrupt", body: [:])
    }

    /// Stop the room's running turn on this thread (`interruptGroup`).
    public func interruptRoom(groupId: String, threadId: String?) async throws {
        try await send(interruptRoomRequest(groupId: groupId, threadId: threadId))
    }

    // MARK: Compact

    public func compactRequest(botId: String, threadId: String) throws -> URLRequest {
        guard Self.validRouteID(botId), Self.validRouteID(threadId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/bots/\(botId)/compact", body: ["threadId": threadId])
    }

    /// Summarize the conversation's context (the engine's `/compact`): runs
    /// like a turn, keeps the full history, and leaves a compaction receipt.
    public func compact(botId: String, threadId: String) async throws {
        try await send(compactRequest(botId: botId, threadId: threadId))
    }
}

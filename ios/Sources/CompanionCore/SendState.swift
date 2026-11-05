import Foundation

/// Whether a person's message to a bot can be answered right now (the
/// maintainer, 2026-10-27; desktop shared/send-state.ts and
/// src/lib/send-state.ts). When it certainly cannot (the engine is not
/// connected for this person, the computer or the local server that serves
/// its model is down), the composer does not send and says why in one line,
/// with the one thing to do; the draft stays. Any doubt (no answer, an error,
/// an older server, a body this build cannot read) sends as before.
public struct SendBlock: Equatable, Sendable {
    public enum Reason: String, Sendable {
        case engineNotConnected = "engine_not_connected"
        case computerOffline = "computer_offline"
        case localServerOffline = "local_server_offline"
        case ownerComputerOffline = "owner_computer_offline"
        /// The engine account is at its usage limit or out of credit
        /// (the maintainer, 2026-11-04): the composer locks whole until it resets or
        /// the bot moves to another engine or account.
        case engineLimit = "engine_limit"
    }

    public enum Action: Equatable, Sendable {
        /// Connect this engine (Settings > Engines on the computer).
        case connect(instanceId: String, engine: String)
        /// Nothing to change here: ask again once the computer or server is back.
        case retry
        /// Move the bot to another engine or account (the model menu).
        case switchEngine
    }

    /// The wire reason. A reason this build does not know still blocks, and
    /// the line then reads the server's English `message`.
    public var reasonCode: String
    /// The English line, for a reason this build does not word itself.
    public var message: String
    public var action: Action
    /// The engine's display name, or the owner's for owner_computer_offline.
    public var name: String?
    /// engine_limit: "usage_limit" or "credits".
    public var limitCause: String?
    /// engine_limit: when the limit resets, when the provider said.
    public var resetsAt: Date?

    public init(reasonCode: String, message: String, action: Action, name: String? = nil, limitCause: String? = nil, resetsAt: Date? = nil) {
        self.reasonCode = reasonCode
        self.message = message
        self.action = action
        self.name = name
        self.limitCause = limitCause
        self.resetsAt = resetsAt
    }

    /// No typing, no send, no action in the chat while this shows.
    public var locksComposer: Bool { reason == .engineLimit }

    public var reason: Reason? { Reason(rawValue: reasonCode) }

    /// The engine the line names: `name`, else the connect action's engine.
    public var engineName: String {
        if let name, !name.isEmpty { return name }
        if case let .connect(_, engine) = action { return engine }
        return ""
    }

    /// `GET /api/bots/<id>/send-state` answers `{ "block": SendBlock | null }`.
    /// A block only when the server says so plainly; anything else is none.
    public static func parse(_ data: Data) -> SendBlock? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return parse(object["block"])
    }

    static func parse(_ value: Any?) -> SendBlock? {
        guard let block = value as? [String: Any],
              let reason = block["reason"] as? String, !reason.isEmpty,
              let message = block["message"] as? String,
              let action = block["action"] as? [String: Any],
              let kind = action["kind"] as? String
        else { return nil }
        let parsed: Action
        switch kind {
        case "retry":
            parsed = .retry
        case "switch_engine":
            parsed = .switchEngine
        case "connect":
            guard let instanceId = action["instanceId"] as? String,
                  let engine = action["engine"] as? String else { return nil }
            parsed = .connect(instanceId: instanceId, engine: engine)
        default:
            return nil
        }
        let name = (block["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        let limit = block["limit"] as? [String: Any]
        let cause = limit?["cause"] as? String
        let resetsAt = (limit?["resetsAt"] as? NSNumber).map { Date(timeIntervalSince1970: $0.doubleValue / 1000) }
        return SendBlock(reasonCode: reason, message: message, action: parsed, name: name, limitCause: cause, resetsAt: resetsAt)
    }
}

/// The composer's send state for one conversation, as a pure value the
/// screen keeps (`SendBlockState`): which bot, thread and model the last
/// answer was for, and that answer. A block is only shown for the scope it
/// was asked for, so a block of another bot never leaks into this one.
public struct SendBlockState: Equatable, Sendable {
    /// While blocked, how often the composer asks again (desktop
    /// SEND_BLOCK_RECHECK_MS).
    public static let recheckSeconds: Double = 15

    public private(set) var scope: String?
    public private(set) var block: SendBlock?

    public init(scope: String? = nil, block: SendBlock? = nil) {
        self.scope = scope
        self.block = block
    }

    /// What identifies the question: the bot, the thread and the model the
    /// thread runs on (a model change asks again). Nil for a room.
    public static func scope(botId: String?, threadId: String, model: ModelSelection?) -> String? {
        guard let botId, !botId.isEmpty else { return nil }
        let picked = model.map { "\($0.instanceId)/\($0.model)/\($0.auto == true ? "auto" : "")" } ?? ""
        return [botId, threadId, picked].joined(separator: "\u{0}")
    }

    /// The block for the conversation on screen, or nil.
    public func block(for scope: String?) -> SendBlock? {
        guard let scope, scope == self.scope else { return nil }
        return block
    }

    /// The composer may send to `scope`.
    public func allowsSend(for scope: String?) -> Bool { block(for: scope) == nil }

    /// The answer of a check. `nil` (no block, an error, no answer) unblocks.
    public mutating func record(_ answer: SendBlock?, for scope: String?) {
        self.scope = scope
        block = scope == nil ? nil : answer
    }

    /// How long to wait before asking again: every 15 s while blocked,
    /// never while the composer may send.
    public func recheckDelay(for scope: String?) -> Double? {
        block(for: scope) == nil ? nil : Self.recheckSeconds
    }
}

public extension CompanionClient {
    /// `GET /api/bots/<id>/send-state?threadId=`: whether this person's next
    /// message can be answered. Never throws: any failure is "not blocked".
    func sendState(botId: String, threadId: String?) async -> SendBlock? {
        guard Self.validRouteID(botId) else { return nil }
        do {
            let request = try sendStateRequest(botId: botId, threadId: threadId)
            let (data, response) = try await perform(request)
            try Self.check(response, data)
            return SendBlock.parse(data)
        } catch {
            return nil
        }
    }

    func sendStateRequest(botId: String, threadId: String?) throws -> URLRequest {
        let query = threadId.flatMap { $0.isEmpty ? nil : [URLQueryItem(name: "threadId", value: $0)] } ?? []
        return try makeRequest("GET", "/api/bots/\(botId)/send-state", query: query)
    }
}

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
        /// #2013: the engine refused this conversation's last turn before
        /// any prompt went out (not ready, or its own configuration
        /// conflicts with the bot's). Advisory: the composer still sends.
        case engineRefused = "engine_refused"
        /// #2013: the engine's sign-in expired or was refused. Advisory.
        case engineSignedOut = "engine_signed_out"
    }

    public enum Action: Equatable, Sendable {
        /// Connect this engine (Settings > Engines on the computer).
        case connect(instanceId: String, engine: String)
        /// Nothing to change here: ask again once the computer or server is back.
        case retry
        /// Move the bot to another engine or account (the model menu).
        case switchEngine
        /// Send the conversation's last user message again (Retry).
        case resend
        /// Sagax repairs the cause itself (POST .../send-state/fix), then
        /// sends the last message again. The wire's fix id, such as
        /// "codex_native_mcp".
        case fix(String)
    }

    /// #2013: what kind of pre-send refusal, and the engine's own words
    /// for the Details disclosure.
    public struct Refusal: Equatable, Sendable {
        /// "config_conflict", "engine_not_ready" or "signed_out".
        public var kind: String
        public var cause: String
        public init(kind: String, cause: String) {
            self.kind = kind
            self.cause = cause
        }
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
    /// #2013: true when the line only informs and the composer still
    /// sends (engine_refused, engine_signed_out).
    public var advisory: Bool
    public var refusal: Refusal?

    public init(reasonCode: String, message: String, action: Action, name: String? = nil, limitCause: String? = nil, resetsAt: Date? = nil,
                advisory: Bool = false, refusal: Refusal? = nil) {
        self.reasonCode = reasonCode
        self.message = message
        self.action = action
        self.name = name
        self.limitCause = limitCause
        self.resetsAt = resetsAt
        self.advisory = advisory
        self.refusal = refusal
    }

    /// No typing, no send, no action in the chat while this shows.
    public var locksComposer: Bool { reason == .engineLimit }

    /// The line informs; the next message still goes out.
    public var isAdvisory: Bool { advisory }

    /// The composer refuses to send while this shows (every block but an
    /// advisory one; an unknown reason still blocks).
    public var blocksSend: Bool { !advisory }

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
        case "resend":
            parsed = .resend
        case "fix":
            guard let fix = action["fix"] as? String, !fix.isEmpty else { return nil }
            parsed = .fix(fix)
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
        let advisory = (block["advisory"] as? Bool) == true
        let refusal = (block["refusal"] as? [String: Any]).flatMap { raw -> Refusal? in
            guard let kind = raw["kind"] as? String else { return nil }
            return Refusal(kind: kind, cause: raw["cause"] as? String ?? "")
        }
        return SendBlock(reasonCode: reason, message: message, action: parsed, name: name, limitCause: cause, resetsAt: resetsAt,
                         advisory: advisory, refusal: refusal)
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
    /// An advisory block (#2013) informs and still lets the message go.
    public func allowsSend(for scope: String?) -> Bool { block(for: scope)?.blocksSend != true }

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

    /// `POST /api/bots/<id>/send-state/fix?threadId=` with `{ "fix": <id> }`
    /// (#2013): Sagax repairs the cause itself. Answers `{ ok, block }`;
    /// nil when the request failed.
    func fixSendState(botId: String, threadId: String?, fix: String) async -> SendStateFixResult? {
        guard Self.validRouteID(botId) else { return nil }
        do {
            let request = try sendStateFixRequest(botId: botId, threadId: threadId, fix: fix)
            let (data, response) = try await perform(request)
            try Self.check(response, data)
            return SendStateFixResult.parse(data)
        } catch {
            return nil
        }
    }

    func sendStateFixRequest(botId: String, threadId: String?, fix: String) throws -> URLRequest {
        let query = threadId.flatMap { $0.isEmpty ? nil : [URLQueryItem(name: "threadId", value: $0)] } ?? []
        return try makeRequest("POST", "/api/bots/\(botId)/send-state/fix", query: query, body: ["fix": fix])
    }

    func sendStateRequest(botId: String, threadId: String?) throws -> URLRequest {
        let query = threadId.flatMap { $0.isEmpty ? nil : [URLQueryItem(name: "threadId", value: $0)] } ?? []
        return try makeRequest("GET", "/api/bots/\(botId)/send-state", query: query)
    }
}

/// The answer of a Fix (#2013): whether the repair held, and the send
/// state after it.
public struct SendStateFixResult: Equatable, Sendable {
    public var ok: Bool
    public var block: SendBlock?

    public init(ok: Bool, block: SendBlock?) {
        self.ok = ok
        self.block = block
    }

    public static func parse(_ data: Data) -> SendStateFixResult? {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return SendStateFixResult(ok: (object["ok"] as? Bool) == true, block: SendBlock.parse(object["block"]))
    }
}

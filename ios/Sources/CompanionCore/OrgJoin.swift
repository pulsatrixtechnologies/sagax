// Settings > Organization > Connect to a server, Your organization's
// Perspicax server (JoinPerspicaxCard.tsx, src/lib/org-join.ts): which of
// the person's own bots to copy, with or without their conversations and
// memory, what stays behind (POST /api/org/export), then the copy file.
// Joining from the app itself is the desktop window's; the iPad offers the
// file, as the served page does.
import Foundation

public struct OrgJoinChoice: Hashable, Sendable {
    public var copy: Bool
    public var threads: Bool
    public var memory: Bool

    public init(copy: Bool = false, threads: Bool = false, memory: Bool = true) {
        self.copy = copy
        self.threads = threads
        self.memory = memory
    }

    public static let `default` = OrgJoinChoice()
}

public struct OrgExportSummary: Decodable, Equatable, Sendable {
    public struct Named: Decodable, Equatable, Sendable { public var id: String; public var name: String }
    public struct NotCopied: Decodable, Equatable, Sendable {
        public var kind: String
        public var name: String
        public var reason: String
        public var person: String?
    }
    public var bots: [Named]
    public var groups: [Named]
    public var routines: [Named]
    public var notCopied: [NotCopied]
    public var redacted: Int
}

public struct OrgExportAnswer: Sendable {
    public var filename: String
    public var summary: OrgExportSummary
    /// The copy file itself (the answer's `document`, as JSON).
    public var document: Data
}

public enum OrgJoin {
    /// `offeredBots`: the person's own, or ones with no owner; hidden ones left out.
    public static func offered(_ bots: [Bot], principalId: String?) -> [Bot] {
        let me = principalId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
        return bots.filter { bot in
            guard bot.hidden != true else { return false }
            let owner = bot.ownerUserId?.trimmingCharacters(in: .whitespaces).lowercased() ?? ""
            return owner.isEmpty || owner == "local-owner" || (!me.isEmpty && owner == me)
        }
    }

    /// `withChoice`: choosing conversations or memory also chooses the bot.
    public static func with(_ choices: [String: OrgJoinChoice], bot: String, copy: Bool? = nil, threads: Bool? = nil, memory: Bool? = nil) -> [String: OrgJoinChoice] {
        var next = choices[bot] ?? .default
        if let copy { next.copy = copy }
        if let threads { next.threads = threads; if threads { next.copy = true } }
        if let memory { next.memory = memory; if memory { next.copy = true } }
        var out = choices
        out[bot] = next
        return out
    }

    /// The body of POST /api/org/export: the chosen bots, in list order.
    public static func request(_ bots: [Bot], _ choices: [String: OrgJoinChoice]) -> [[String: Any]] {
        bots.compactMap { bot in
            let choice = choices[bot.id] ?? .default
            return choice.copy ? ["id": bot.id, "threads": choice.threads, "memory": choice.memory] : nil
        }
    }
}

public extension CompanionClient {
    func orgExportRequest(_ bots: [[String: Any]]) throws -> URLRequest {
        try makeRequest("POST", "/api/org/export", body: ["bots": bots])
    }

    func orgExport(_ bots: [[String: Any]]) async throws -> OrgExportAnswer {
        let (data, response) = try await perform(orgExportRequest(bots))
        try Self.check(response, data)
        struct Head: Decodable { var filename: String; var summary: OrgExportSummary }
        let head = try JSONDecoder().decode(Head.self, from: data)
        let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let document = try JSONSerialization.data(withJSONObject: object?["document"] ?? [:])
        return OrgExportAnswer(filename: head.filename, summary: head.summary, document: document)
    }
}

import Foundation

// Import an agent from x.ai bot on the phone (desktop AgentImport.tsx,
// docs/import-agent.md). The phone has no copy of the converter: it sends the
// reply the person's own bot on x.ai wrote to the export prompt, the server
// makes it a Sagax package and stages it like an uploaded file
// (`/api/bots/import/agent`), and the zip import's own preview and import
// calls finish the job. The bot arrives inert: skills off, routines paused,
// no key, token or sign-in.

/// What could not come over, with what the person needs to redo it by hand.
public struct AgentImportLeftOut: Decodable, Hashable, Sendable {
    public var kind: String
    public var name: String
    public var reason: String
    public var original: String?
    public var nameKey: String?
    public var reasonKey: String?
    public var params: [String: AgentImportParam]?
}

/// A placeholder value of a left-out line ({name}, {max}, {bytes}, {parts}).
public enum AgentImportParam: Decodable, Hashable, Sendable {
    case text(String)
    case number(Double)

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let number = try? c.decode(Double.self) { self = .number(number) } else { self = .text(try c.decode(String.self)) }
    }

    public var text: String {
        switch self {
        case let .text(value): value
        case let .number(value): value.rounded() == value ? String(Int(value)) : String(value)
        }
    }
}

public struct AgentImportStaged: Decodable, Sendable {
    public var id: String
    public var preview: BotZipPreview
    public var leftOut: [AgentImportLeftOut]
}

struct AgentImportPrompt: Decodable { var prompt: String }
struct AgentImportBody: Encodable { var text: String; var timeZone: String }

public enum AgentImportRules {
    /// The server refuses a reply larger than this.
    public static let maximumCharacters = 4 * 1024 * 1024

    /// A template's {placeholders} filled from the line's params; one without a value stays as written.
    public static func fill(_ template: String, _ params: [String: AgentImportParam]?) -> String {
        guard let params, !params.isEmpty else { return template }
        var out = template
        for (key, value) in params { out = out.replacingOccurrences(of: "{\(key)}", with: value.text) }
        return out
    }
}

public extension CompanionClient {
    /// `GET /api/bots/import/agent`: the export prompt to send to the person's bot on x.ai.
    func agentImportPrompt() async throws -> String {
        try await send(makeRequest("GET", "/api/bots/import/agent"), as: AgentImportPrompt.self).prompt
    }

    /// `POST /api/bots/import/agent {text, timeZone}`: the reply made into a
    /// package and staged for this person, with what was left out.
    func stageAgentImport(text: String, timeZone: String = TimeZone.current.identifier) async throws -> AgentImportStaged {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw APIError.transport("Paste the reply first.") }
        guard trimmed.count <= AgentImportRules.maximumCharacters else { throw APIError.transport("That reply is larger than 4 MB.") }
        return try await send(makeRequest("POST", "/api/bots/import/agent", encodedBody: AgentImportBody(text: trimmed, timeZone: timeZone)), as: AgentImportStaged.self)
    }
}

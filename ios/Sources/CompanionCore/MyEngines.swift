// Settings > My engines (#1098): the signed-in person's own access to each
// engine the organization offers them (`src/components/settings/MyEngines.tsx`,
// `MyEngineAccess`): what their own turns run with, and their own
// subscription sign-in (Claude, Codex, Grok, Kimi), never the server's. The
// list is the server's answer (`GET /api/me/engines`): the organization's
// engine list stays the lock, the phone never adds an engine to it. Keys are
// never set here: they live in Perspicax (`keysUrl`).
import Foundation

/// One engine as `GET /api/me/engines` describes it for this person.
public struct MyEngine: Decodable, Hashable, Sendable, Identifiable {
    public struct Subscription: Decodable, Hashable, Sendable {
        public var supported: Bool
        public var signedIn: Bool
        public init(supported: Bool, signedIn: Bool) {
            self.supported = supported
            self.signedIn = signedIn
        }
    }

    public var instanceId: String
    public var driver: String
    public var displayName: String
    public var installed: Bool
    /// Set when the server's image deliberately does not carry this engine.
    public var notAvailable: String?
    public var subscription: Subscription
    public var myKey: Bool
    public var orgKey: Bool
    public var orgKeyNotGiven: Bool?
    /// Outside the organization's engine list: only the person's own
    /// subscription or key runs it.
    public var orgNotAllowed: Bool?
    /// What the person's own turns on it run with: `subscription`, `key`,
    /// `org-key` or `none`.
    public var myTurns: String

    public var id: String { instanceId }

    /// `engineUnavailable`: the image deliberately does not carry it.
    public var unavailable: Bool { !installed && notAvailable != nil }

    /// `MyEngineAccess` draws a sign-in: a subscription engine the server
    /// does not deliberately lack. Independent of `installed` on purpose: a
    /// sign-out must never remove the way back in.
    public var offersSignIn: Bool { !unavailable && subscription.supported }

    /// `connectName`: the account people sign in with.
    public var connectName: String {
        switch driver {
        case "codex": "ChatGPT"
        case "claudeAgent": "Claude"
        case "grokAgent": "Grok"
        case "kimiAgent": "Kimi"
        case "geminiAgent": "Gemini"
        default: displayName
        }
    }
}

/// `GET /api/me/engines`.
public struct MyEnginesList: Decodable, Hashable, Sendable {
    public var engines: [MyEngine]
    /// Where the person sets their own model keys (Perspicax).
    public var keysUrl: String?
}

/// A personal sign-in in progress (`server/engines/principal-engine-logins.ts`).
public struct EngineLoginState: Decodable, Hashable, Sendable {
    public var flowId: String?
    public var authorizationUrl: String?
    /// A device code to type at the provider's page; without one, the
    /// person pastes the code the page shows.
    public var userCode: String?
    /// `waiting`, `succeeded`, `failed`, `cancelled`, ...
    public var phase: String
    public var message: String?

    public init(flowId: String?, authorizationUrl: String?, userCode: String? = nil, phase: String, message: String? = nil) {
        self.flowId = flowId
        self.authorizationUrl = authorizationUrl
        self.userCode = userCode
        self.phase = phase
        self.message = message
    }

    /// `signInPage`: https only, with no embedded credentials.
    public var signInPage: URL? { MyEnginesRules.signInPage(authorizationUrl) }
}

public enum MyEnginesRules {
    /// https only, with no user or password in it (the desktop's `signInPage`).
    public static func signInPage(_ value: String?) -> URL? {
        guard let value, let url = URL(string: value), url.scheme?.lowercased() == "https",
              url.host?.isEmpty == false, url.user == nil, url.password == nil
        else { return nil }
        return url
    }

    /// An instance id the routes accept (`[\w.-]+`).
    public static func validInstanceId(_ value: String) -> Bool {
        !value.isEmpty && value.contains(where: { $0 != "." }) && value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
                || byte == 45 || byte == 95 || byte == 46
        }
    }
}

public extension CompanionClient {
    /// `GET /api/me/engines`.
    func myEngines() async throws -> MyEnginesList {
        try await send(makeRequest("GET", "/api/me/engines"), as: MyEnginesList.self)
    }

    /// `POST /api/me/engines/:id/login/start`: nil when the sign-in needed
    /// nothing more (already signed in).
    func startEngineLogin(instanceId: String) async throws -> EngineLoginState? {
        struct Answer: Decodable { var auth: EngineLoginState? }
        return try await send(loginRequest(instanceId, "start", body: [:]), as: Answer.self).auth
    }

    /// `GET /api/me/engines/:id/login/status?flowId=`.
    func engineLoginStatus(instanceId: String, flowId: String) async throws -> EngineLoginState {
        guard MyEnginesRules.validInstanceId(instanceId) else { throw APIError.badURL }
        struct Answer: Decodable { var auth: EngineLoginState }
        let request = try makeRequest("GET", "/api/me/engines/\(instanceId)/login/status",
                                      query: [URLQueryItem(name: "flowId", value: flowId)])
        return try await send(request, as: Answer.self).auth
    }

    /// `POST /api/me/engines/:id/login/complete {flowId, code}`.
    func completeEngineLogin(instanceId: String, flowId: String, code: String) async throws {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !flowId.isEmpty else { throw APIError.badURL }
        try await send(loginRequest(instanceId, "complete", body: ["flowId": flowId, "code": trimmed]))
    }

    /// `POST /api/me/engines/:id/login/cancel {flowId}`.
    func cancelEngineLogin(instanceId: String, flowId: String?) async throws {
        try await send(loginRequest(instanceId, "cancel", body: flowId.map { ["flowId": $0] } ?? [:]))
    }

    /// `POST /api/me/engines/:id/login/sign-out`: the person's own sign-in only.
    func signOutEngine(instanceId: String) async throws {
        try await send(loginRequest(instanceId, "sign-out", body: [:]))
    }

    private func loginRequest(_ instanceId: String, _ action: String, body: [String: Any]) throws -> URLRequest {
        guard MyEnginesRules.validInstanceId(instanceId) else { throw APIError.badURL }
        return try makeRequest("POST", "/api/me/engines/\(instanceId)/login/\(action)", body: body)
    }
}

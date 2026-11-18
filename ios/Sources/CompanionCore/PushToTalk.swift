// Push to Talk (PushToTalk framework, docs/ios-push.md): hold to talk to a
// bot from the lock screen or the Dynamic Island. What is decided here, apart
// from the devices: which bot the channel talks to, what the server is told,
// and what an incoming PTT push says.
import Foundation

/// The bot a voice entry point talks to (the Push to Talk channel, the side
/// button): the one the person chose while it still exists, else their
/// Primary Bot, else their first bot.
public enum PrimaryBotChoice {
    public static func bot(chosenId: String?, bots: [Bot]) -> Bot? {
        if let chosenId, let chosen = bots.first(where: { $0.id == chosenId }) { return chosen }
        return bots.first(where: { $0.chiefOfStaff == true }) ?? bots.first
    }
}

public enum PushToTalkChannel {
    /// The call id of a turn held from the channel: the server answers it as
    /// a spoken PTT push (server/push/ptt.ts PTT_CALL_PREFIX).
    public static func callId() -> String { "ptt-" + UUID().uuidString.lowercased() }
}

/// The body of `POST /api/push/ptt`.
public struct PushToTalkRegistration: Codable, Equatable, Sendable {
    public var token: String
    public var channelId: String
    public var botId: String
    public var environment: APNsEnvironment
    public var appVersion: String

    public init(token: String, channelId: UUID, botId: String, environment: APNsEnvironment, appVersion: String) {
        self.token = token
        self.channelId = channelId.uuidString.lowercased()
        self.botId = botId
        self.environment = environment
        self.appVersion = String(appVersion.prefix(40))
    }
}

/// What the person chose, kept on this phone.
public struct PushToTalkPrefs {
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }

    public var enabled: Bool {
        get { defaults.bool(forKey: "sagax.ptt.enabled") }
        nonmutating set { defaults.set(newValue, forKey: "sagax.ptt.enabled") }
    }
    /// nil: the Primary Bot.
    public var botId: String? {
        get { defaults.string(forKey: "sagax.ptt.botId") }
        nonmutating set {
            if let newValue { defaults.set(newValue, forKey: "sagax.ptt.botId") } else { defaults.removeObject(forKey: "sagax.ptt.botId") }
        }
    }
    /// The channel's identity for the system, stable for this install.
    public var channelUUID: UUID {
        if let raw = defaults.string(forKey: "sagax.ptt.channel"), let id = UUID(uuidString: raw) { return id }
        let id = UUID()
        defaults.set(id.uuidString, forKey: "sagax.ptt.channel")
        return id
    }
    /// The name shown in the system UI, cached so a restored channel needs no network.
    public var channelName: String {
        get { defaults.string(forKey: "sagax.ptt.name") ?? "Sagax" }
        nonmutating set { defaults.set(newValue, forKey: "sagax.ptt.name") }
    }
}

/// An incoming PTT push: who speaks and what they say.
public struct PushToTalkIncoming: Equatable, Sendable {
    public var speaker: String
    public var botId: String?
    public var threadId: String?
    public var text: String

    public init?(payload: [String: Any]) {
        guard let speaker = (payload["activeSpeaker"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !speaker.isEmpty else { return nil }
        self.speaker = speaker
        self.botId = payload["botId"] as? String
        self.threadId = payload["threadId"] as? String
        self.text = (payload["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }
}

public enum PushToTalkSpeech {
    /// The words in sentences, the way the call speaks them: each is fetched
    /// while the one before plays.
    public static func sentences(_ text: String) -> [String] {
        var out: [String] = []
        text.enumerateSubstrings(in: text.startIndex..., options: .bySentences) { piece, _, _, _ in
            if let piece = piece?.trimmingCharacters(in: .whitespacesAndNewlines), !piece.isEmpty { out.append(piece) }
        }
        return out
    }
}

public extension CompanionClient {
    func registerPushToTalkRequest(_ registration: PushToTalkRegistration) throws -> URLRequest {
        try makeRequest("POST", "/api/push/ptt", encodedBody: registration)
    }

    /// The joined channel's ephemeral token and bot, for the signed-in person.
    func registerPushToTalk(_ registration: PushToTalkRegistration) async throws {
        try await send(registerPushToTalkRequest(registration))
    }

    /// The person left the channel.
    func removePushToTalk() async throws {
        try await send(makeRequest("DELETE", "/api/push/ptt"))
    }
}

// Pushes through Apple Push Notification service (docs/ios-push.md). The
// organization server sends them when the app is closed or suspended
// (server/push/); this is what the phone tells the server when it registers
// (`POST /api/push/devices`), what it reads out of a push it receives, and
// the collapse identifier both sides share so one conversation shows one
// notification.
import CryptoKit
import Foundation

/// Which APNs the build talks to. A build run from Xcode is sandbox; a
/// TestFlight or App Store build is production.
public enum APNsEnvironment: String, Codable, Sendable {
    case sandbox
    case production

    /// From the build's embedded provisioning profile: `aps-environment`
    /// `development` is sandbox. No profile (TestFlight and App Store strip
    /// it) is production. The simulator is always sandbox.
    public static func detect(provisioningProfile: Data?, isSimulator: Bool) -> APNsEnvironment {
        if isSimulator { return .sandbox }
        guard let profile = provisioningProfile else { return .production }
        // The profile is a signed CMS envelope; its plist is plain text inside.
        guard let start = profile.range(of: Data("<?xml".utf8)),
              let end = profile.range(of: Data("</plist>".utf8), in: start.lowerBound..<profile.endIndex)
        else { return .production }
        let plist = profile.subdata(in: start.lowerBound..<end.upperBound)
        guard let root = try? PropertyListSerialization.propertyList(from: plist, format: nil) as? [String: Any],
              let entitlements = root["Entitlements"] as? [String: Any],
              let aps = entitlements["aps-environment"] as? String
        else { return .production }
        return aps == "development" ? .sandbox : .production
    }
}

/// This device's Settings > Notifications, as the server applies them to a push.
public struct PushDeviceSettings: Codable, Equatable, Hashable, Sendable {
    public var sound: Bool
    public var badge: Bool
    public var nudgeSound: Bool
    /// Distinct sound on an approval banner. On unless this phone said otherwise.
    public var approvalChime: Bool

    public init(sound: Bool = true, badge: Bool = true, nudgeSound: Bool = true, approvalChime: Bool = true) {
        self.sound = sound
        self.badge = badge
        self.nudgeSound = nudgeSound
        self.approvalChime = approvalChime
    }

    public init(_ attention: AttentionSettings) {
        self.init(sound: attention.sound, badge: attention.badge, nudgeSound: attention.nudgeSound, approvalChime: attention.approvalChime)
    }
}

/// The body of `POST /api/push/devices`.
public struct PushRegistration: Codable, Equatable, Hashable, Sendable {
    public var token: String
    public var platform: String
    public var environment: APNsEnvironment
    public var appVersion: String
    public var deviceName: String
    public var settings: PushDeviceSettings

    public init(token: String, environment: APNsEnvironment, appVersion: String, deviceName: String, settings: PushDeviceSettings) {
        self.token = token
        self.platform = "ios"
        self.environment = environment
        self.appVersion = String(appVersion.prefix(40))
        self.deviceName = String(deviceName.prefix(80))
        self.settings = settings
    }
}

public enum PushToken {
    /// On `GET /api/events`: this phone's APNs token, so the server skips
    /// a push to a device that is already reading the live stream.
    public static let header = "x-sagax-push-token"

    /// The device token as the server stores it: lowercase hex.
    public static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }
}

public enum PushKind: String, Sendable {
    case message
    case nudge
    case approval
    case achievement
    case routine
    /// Silent: the conversation was read on another device; withdraw its
    /// banner and recount the badge.
    case read
}

/// One conversation, one notification: the server's `apns-collapse-id`
/// (server/push/payload.ts collapseId) and this app's local notification
/// identifier are the same string, so a push replaces the banner the live
/// stream already showed instead of adding a second one.
public enum PushCollapse {
    public static func identifier(threadId: String?, kind: String) -> String {
        let thread = threadId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let key = thread.isEmpty ? "sagax.\(kind)" : "sagax.t.\(thread)"
        if key.utf8.count <= 64 { return key }
        let digest = SHA256.hash(data: Data(key.utf8)).map { String(format: "%02x", $0) }.joined()
        return "sagax.h.\(digest.prefix(48))"
    }
}

/// Who a communication notification should name as the sender: a bot or a
/// person, never the Sagax app icon. The Notification Service Extension
/// builds an `INSendMessageIntent` from this.
public struct PushSenderIdentity: Equatable, Sendable {
    public var id: String
    public var displayName: String
    public var conversationId: String
    /// Relative path on this server, only when `AccountAvatar` accepts it.
    public var avatarUrl: String?

    public init(id: String, displayName: String, conversationId: String, avatarUrl: String? = nil) {
        self.id = id
        self.displayName = displayName
        self.conversationId = conversationId
        self.avatarUrl = avatarUrl
    }
}

/// What a received push carries next to `aps`.
public struct PushPayload: Equatable, Sendable {
    public var kind: PushKind
    public var threadId: String?
    public var botId: String?
    public var groupId: String?
    public var fromId: String?
    public var id: String?
    public var senderName: String?
    public var senderId: String?
    public var avatarUrl: String?
    /// The approval Allow or Deny answers. Absent on a question or a message.
    public var requestId: String?
    /// `approval` or `question` when `kind` is approval.
    public var prompt: String?
    /// Allow must open Sagax: the person's security key signs it.
    public var needsKey: Bool
    public var routineRunId: String?
    public var routineName: String?
    /// Milliseconds since 1970.
    public var at: Double?

    public init?(userInfo: [AnyHashable: Any]) {
        guard userInfo["aps"] != nil,
              let raw = userInfo["kind"] as? String, let kind = PushKind(rawValue: raw)
        else { return nil }
        func string(_ key: String) -> String? {
            guard let value = userInfo[key] as? String else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        self.kind = kind
        threadId = string("threadId")
        botId = string("botId")
        groupId = string("groupId")
        fromId = string("fromId")
        id = string("id")
        senderName = string("senderName")
        senderId = string("senderId")
        // Only this server's own avatar routes. A tracking pixel in the
        // payload is dropped so the extension never fetches it.
        if let rawAvatar = string("avatarUrl"), AccountAvatar(rawAvatar) != nil {
            avatarUrl = rawAvatar
        } else {
            avatarUrl = nil
        }
        requestId = string("requestId")
        prompt = string("prompt")
        if let flag = userInfo["needsKey"] as? Bool {
            needsKey = flag
        } else if let flag = userInfo["needsKey"] as? NSNumber {
            needsKey = flag.boolValue
        } else if let flag = userInfo["needsKey"] as? String {
            needsKey = flag == "1" || flag == "true"
        } else {
            needsKey = false
        }
        routineRunId = string("routineRunId")
        routineName = string("routineName")
        at = (userInfo["at"] as? NSNumber)?.doubleValue
    }

    /// Present when this push should show as a communication notification.
    public var senderIdentity: PushSenderIdentity? {
        guard let displayName = senderName else { return nil }
        let id = senderId ?? botId ?? fromId ?? displayName
        return PushSenderIdentity(
            id: id,
            displayName: displayName,
            conversationId: threadId ?? id,
            avatarUrl: avatarUrl
        )
    }

    /// Where a tap goes (the same target a local notification carries).
    public var target: NotificationTarget? {
        NotificationTarget(botId: botId ?? groupId, threadId: threadId)
    }

    /// The same nudge from the live stream and from APNs share this key, so
    /// it rings once.
    public var nudgeKey: String? {
        guard kind == .nudge, let fromId, let at else { return nil }
        return NudgeFrame.dedupKey(fromId: fromId, at: at)
    }
}

public extension NudgeFrame {
    static func dedupKey(fromId: String, at: Double) -> String {
        "\(fromId.lowercased()).\(Int64(at))"
    }

    var dedupKey: String? {
        guard let at else { return nil }
        return Self.dedupKey(fromId: fromId, at: at)
    }
}

private struct PushRemovalBody: Encodable {
    var token: String
}

public extension CompanionClient {
    func registerPushDeviceRequest(_ registration: PushRegistration) throws -> URLRequest {
        try makeRequest("POST", "/api/push/devices", encodedBody: registration)
    }

    /// Registers (or refreshes) this phone for pushes for the signed-in person.
    func registerPushDevice(_ registration: PushRegistration) async throws {
        try await send(registerPushDeviceRequest(registration))
    }

    func unregisterPushDeviceRequest(token: String) throws -> URLRequest {
        try makeRequest("DELETE", "/api/push/devices", encodedBody: PushRemovalBody(token: token))
    }

    /// Sign-out: this phone stops getting that person's pushes.
    func unregisterPushDevice(token: String) async throws {
        try await send(unregisterPushDeviceRequest(token: token))
    }
}

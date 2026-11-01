// ActivityKit push tokens for Live Activities (server/push/activity-*.ts,
// docs/ios-push.md). The phone starts an activity with `pushType: .token`,
// listens for `pushTokenUpdates`, and registers each token with the server
// for this person and bot. On iOS 17.2+ it also registers the push-to-start
// token. CompanionCore stays free of ActivityKit: the app supplies hex
// tokens; this file owns the wire types and request builders (tested).
import Foundation

/// `kind` on `POST /api/push/activities`.
public enum LiveActivityTokenKind: String, Codable, Sendable {
    /// Per-activity update/end token from `Activity.pushTokenUpdates`.
    case update
    /// Push-to-start token from `Activity.pushToStartTokenUpdates` (iOS 17.2+).
    case start
}

/// Body of `POST /api/push/activities`.
public struct LiveActivityTokenRegistration: Codable, Equatable, Hashable, Sendable {
    public var token: String
    public var kind: LiveActivityTokenKind
    public var environment: APNsEnvironment
    public var botId: String?
    public var activityId: String?
    public var deviceToken: String?
    public var frequentUpdates: Bool?
    public var appVersion: String
    public var deviceName: String

    public init(
        token: String,
        kind: LiveActivityTokenKind,
        environment: APNsEnvironment,
        botId: String? = nil,
        activityId: String? = nil,
        deviceToken: String? = nil,
        frequentUpdates: Bool? = nil,
        appVersion: String,
        deviceName: String
    ) {
        self.token = token.lowercased()
        self.kind = kind
        self.environment = environment
        self.botId = botId.map { String($0.prefix(128)) }
        self.activityId = activityId.map { String($0.prefix(128)) }
        self.deviceToken = deviceToken?.lowercased()
        self.frequentUpdates = frequentUpdates
        self.appVersion = String(appVersion.prefix(40))
        self.deviceName = String(deviceName.prefix(80))
    }

    /// True when the registration is complete enough to POST.
    public var isValid: Bool {
        guard LiveActivityPushToken.isHexToken(token) else { return false }
        if kind == .update {
            guard let botId, !botId.isEmpty else { return false }
        }
        return true
    }
}

private struct LiveActivityTokenRemoval: Codable, Sendable {
    var token: String
}

public enum LiveActivityPushToken {
    /// Lowercase hex, same rules as the alert device token (64+ hex chars).
    public static func isHexToken(_ value: String) -> Bool {
        let clean = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard clean.count >= 64, clean.count <= 200 else { return false }
        return clean.unicodeScalars.allSatisfy { CharacterSet(charactersIn: "0123456789abcdef").contains($0) }
    }

    public static func hex(_ data: Data) -> String {
        PushToken.hex(data)
    }
}

/// Pure helpers for deciding what to register (no ActivityKit).
public enum LiveActivityTokenPlan: Sendable {
    public struct Want: Equatable, Sendable {
        public var kind: LiveActivityTokenKind
        public var token: String
        public var botId: String?
        public var activityId: String?

        public init(kind: LiveActivityTokenKind, token: String, botId: String? = nil, activityId: String? = nil) {
            self.kind = kind
            self.token = token
            self.botId = botId
            self.activityId = activityId
        }
    }

    /// Skip a POST when the server already has the same token for the same bot.
    public static func needsRegister(
        want: Want,
        lastRegistered: [String: LiveActivityTokenRegistration]
    ) -> Bool {
        guard let existing = lastRegistered[want.token] else { return true }
        if existing.kind != want.kind { return true }
        if want.kind == .update && existing.botId != want.botId { return true }
        if want.activityId != nil && existing.activityId != want.activityId { return true }
        return false
    }

    /// Build the registration body the server expects.
    public static func registration(
        want: Want,
        environment: APNsEnvironment,
        deviceToken: String?,
        frequentUpdates: Bool?,
        appVersion: String,
        deviceName: String
    ) -> LiveActivityTokenRegistration? {
        let body = LiveActivityTokenRegistration(
            token: want.token,
            kind: want.kind,
            environment: environment,
            botId: want.botId,
            activityId: want.activityId,
            deviceToken: deviceToken,
            frequentUpdates: frequentUpdates,
            appVersion: appVersion,
            deviceName: deviceName
        )
        return body.isValid ? body : nil
    }
}

extension CompanionClient {
    public func registerLiveActivityTokenRequest(_ registration: LiveActivityTokenRegistration) throws -> URLRequest {
        try makeRequest("POST", "/api/push/activities", encodedBody: registration)
    }

    public func registerLiveActivityToken(_ registration: LiveActivityTokenRegistration) async throws {
        try await send(registerLiveActivityTokenRequest(registration))
    }

    public func unregisterLiveActivityTokenRequest(token: String) throws -> URLRequest {
        try makeRequest("DELETE", "/api/push/activities", encodedBody: LiveActivityTokenRemoval(token: token.lowercased()))
    }

    public func unregisterLiveActivityToken(token: String) async throws {
        try await send(unregisterLiveActivityTokenRequest(token: token))
    }
}

// The settings this iPhone keeps, read and changed for a bot (#1545,
// shared/device-settings.ts on the server). The server's `device-settings`
// frame says a request waits for this person; the app fetches it, answers
// from what Settings keeps here (UserDefaults, the same keys as the screens'
// @AppStorage) and posts the answer. A setting this phone does not keep
// answers `unsupported`, so the person's desktop app can answer instead.
import Foundation

/// A request waiting on the person's open apps
/// (GET /api/me/device-settings/requests).
public struct DeviceSettingRequest: Decodable, Sendable, Equatable {
    public var id: String
    public var op: String
    public var key: String
    public var value: String?
    public var botName: String?

    public init(id: String, op: String, key: String, value: String? = nil, botName: String? = nil) {
        self.id = id
        self.op = op
        self.key = key
        self.value = value
        self.botName = botName
    }
}

public struct DeviceSettingRequests: Decodable, Sendable {
    public var requests: [DeviceSettingRequest]
}

/// This phone's answer (POST /api/me/device-settings/requests/:id).
public struct DeviceSettingAnswer: Encodable, Sendable, Equatable {
    public var device = "ios"
    public var value: String?
    public var unsupported: Bool?
    public var error: String?

    public static let notKept = DeviceSettingAnswer(unsupported: true)
    public static func failed(_ reason: String) -> DeviceSettingAnswer { DeviceSettingAnswer(error: String(reason.prefix(300))) }
}

/// Settings > Notifications > Connection notices (#2013): on by default,
/// kept on this device only (no settings sync for it).
public enum ConnectionNoticePrefs {
    /// Where this app keeps it (UserDefaults, the screens' @AppStorage).
    public static let key = "companion.prefs.connectionNotices"
    /// The server's key for it (shared/device-settings.ts).
    public static let serverKey = "omb-connection-notices"
    public static let defaultValue = true

    public static func isEnabled(_ defaults: UserDefaults = .standard) -> Bool {
        defaults.object(forKey: key) as? Bool ?? defaultValue
    }
}

public enum DeviceSettings {
    enum Kind: Equatable {
        case bool(defaultValue: Bool)
        case language
        case soundChoice
    }

    /// The server's key (a preference's storage key, or a device setting)
    /// and where this app keeps it.
    static let kept: [String: (defaultsKey: String, kind: Kind)] = [
        "device.haptics": ("companion.prefs.haptics", .bool(defaultValue: true)),
        "device.nudgeHaptic": ("companion.prefs.nudgeHaptic", .bool(defaultValue: true)),
        "omb-notification-sounds": ("companion.prefs.notificationSounds", .bool(defaultValue: true)),
        "omb-approval-chime": ("companion.prefs.approvalChime", .bool(defaultValue: true)),
        "omb-nudge-sound": ("companion.prefs.nudgeSound", .bool(defaultValue: true)),
        "omb-dock-badge": ("companion.prefs.appBadge", .bool(defaultValue: true)),
        "omb-show-run-card": ("companion.prefs.showRunCard", .bool(defaultValue: true)),
        // #2013: the connection notice at the top of the chat, per device
        ConnectionNoticePrefs.serverKey: (ConnectionNoticePrefs.key, .bool(defaultValue: true)),
        "omb-language": ("companion.prefs.language", .language),
        "sagax.notificationSound.v1": ("companion.prefs.notificationSoundChoice", .soundChoice),
    ]

    static let languages: Set<String> = ["en", "fr", "pt-BR"]
    static let sounds: Set<String> = ["system", "tick", "double-tick", "chime-a", "chime-b", "blip"]

    /// The keys this phone answers.
    public static var keys: [String] { kept.keys.sorted() }

    /// One request, answered from (and written to) `defaults`.
    public static func answer(_ request: DeviceSettingRequest, defaults: UserDefaults) -> DeviceSettingAnswer {
        guard let (defaultsKey, kind) = kept[request.key] else { return .notKept }
        if request.op == "set" {
            guard let value = request.value else { return .failed("No value to set.") }
            switch kind {
            case .bool:
                guard value == "true" || value == "false" else { return .failed("value is true or false.") }
                defaults.set(value == "true", forKey: defaultsKey)
            case .language:
                // empty follows the system, as on the desktop
                if value.isEmpty || value == "system" {
                    defaults.set("system", forKey: defaultsKey)
                } else {
                    guard languages.contains(value) else { return .failed("This phone speaks en, fr or pt-BR (empty follows the system).") }
                    defaults.set(value, forKey: defaultsKey)
                }
            case .soundChoice:
                guard sounds.contains(value) else { return .failed("No such notification sound.") }
                defaults.set(value, forKey: defaultsKey)
            }
        } else if request.op != "get" {
            return .failed("op is get or set.")
        }
        return DeviceSettingAnswer(value: read(defaultsKey, kind, defaults))
    }

    static func read(_ key: String, _ kind: Kind, _ defaults: UserDefaults) -> String {
        switch kind {
        case let .bool(defaultValue):
            return String((defaults.object(forKey: key) as? Bool) ?? defaultValue)
        case .language:
            let stored = defaults.string(forKey: key) ?? "system"
            return stored == "system" ? "" : stored
        case .soundChoice:
            return defaults.string(forKey: key) ?? "system"
        }
    }
}

public extension CompanionClient {
    /// The device settings requests waiting on this person (#1545).
    func deviceSettingRequests() async throws -> [DeviceSettingRequest] {
        try await send(makeRequest("GET", "/api/me/device-settings/requests"), as: DeviceSettingRequests.self).requests
    }

    /// This phone's answer to one of them.
    func answerDeviceSetting(id: String, answer: DeviceSettingAnswer) async throws {
        try await send(makeRequest("POST", "/api/me/device-settings/requests/\(id)", encodedBody: answer))
    }
}

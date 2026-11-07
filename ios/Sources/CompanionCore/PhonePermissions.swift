// The phone's permissions and the one action behind each button (#2614),
// the iOS side of electron/os-permissions.mjs. JC 2026-11-07: every missing
// permission gets an action, never a sentence that says where to look:
// - not asked yet: the system prompt, in place;
// - refused or restricted: the app's page in the iOS Settings app (the
//   notification page for notifications), the only place iOS lets the person
//   turn it back on;
// - allowed (or limited): nothing to do.
// Pure, so `swift test` checks it against the same vectors as the desktop
// (electron/os-permissions.vectors.json, "ios").
import Foundation

public enum PhonePermission: String, CaseIterable, Sendable {
    case notifications, microphone, speech, camera, contacts, calendars, reminders, location
}

public enum PhonePermissionStatus: String, Sendable {
    case notDetermined = "not-determined"
    case granted, limited, denied, restricted, unknown
}

public enum PhonePermissionAction: String, Sendable {
    /// Allowed: no button.
    case none
    /// The system prompt still shows: ask in place.
    case prompt
    /// The app's page in the iOS Settings app.
    case settings
    /// The app's notification page in the iOS Settings app.
    case notificationSettings = "notification-settings"
}

public enum PhonePermissions {
    /// The action behind a permission's button.
    public static func action(for permission: PhonePermission, status: PhonePermissionStatus) -> PhonePermissionAction {
        switch status {
        case .granted, .limited: return .none
        case .notDetermined: return .prompt
        case .denied, .restricted, .unknown:
            return permission == .notifications ? .notificationSettings : .settings
        }
    }

    /// The permission a bot's `sagax://permission/<id>` link names, if the
    /// phone has it.
    public static func permission(fromLink link: String) -> PhonePermission? {
        let prefix = "sagax://permission/"
        let trimmed = link.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.lowercased().hasPrefix(prefix) else { return nil }
        var id = String(trimmed.dropFirst(prefix.count))
        if id.hasSuffix("/") { id.removeLast() }
        return PhonePermission.allCases.first { $0.rawValue.lowercased() == id.lowercased() }
    }
}

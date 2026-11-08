// In-app places a chat-widget button opens on this device (2026-11-02):
// open_page, open_routine and open_run. Mirrors shared/widget.ts
// (`widgetAppAction`, WIDGET_APP_PAGES) and the desktop's
// src/components/widget/widget-device.ts. The phone opens the closest
// existing page (reference app rule: a card acts; it does not ask the model).
import Foundation

/// Pages `open_page.payload.page` may name.
public enum ChatWidgetAppPage: String, Hashable, Sendable, CaseIterable {
    case routines
    case approvals
    case teamMap = "team_map"
    case achievements
    case code
    case remoteSessions = "remote_sessions"
}

/// Actions the device performs itself. `open_url` stays a plain client link;
/// these open a Sagax place, then the press is recorded as done (no turn).
public enum ChatWidgetAppAction: Hashable, Sendable {
    case openPage(ChatWidgetAppPage)
    case openRoutine(routineId: String, botId: String?)
    case openRun(runId: String, routineId: String?)

    /// Wire `type` as the server and transcript store it (`deviceAction.type`).
    public var typeName: String {
        switch self {
        case .openPage: "open_page"
        case .openRoutine: "open_routine"
        case .openRun: "open_run"
        }
    }
}

/// Where the iPhone / iPad opens each action. Pages that have no phone twin
/// map to the closest existing surface (same rule as reference app: act now).
public enum ChatWidgetDestination: Hashable, Sendable {
    /// Automations / routines list (`TasksRoutinesView`).
    case automations
    /// Updates / Needs you inbox (desktop Approvals page has no phone twin).
    case updates
    case teamMap
    case achievements
    /// Bot panel Computer (desktop Code and Remote sessions).
    case botComputer(botId: String)
    case routine(routineId: String, botId: String?)
    case run(runId: String, routineId: String?)
}

public enum ChatWidgetDevice {
    /// The in-app destination an action names, or nil when it names none.
    public static func appAction(type: String, payload: WidgetJSON?) -> ChatWidgetAppAction? {
        guard let object = payload?.object else { return nil }
        switch type {
        case "open_page":
            guard let page = object["page"]?.string, let known = ChatWidgetAppPage(rawValue: page) else { return nil }
            return .openPage(known)
        case "open_routine":
            guard let routineId = id(object["routineId"]?.string) else { return nil }
            return .openRoutine(routineId: routineId, botId: id(object["botId"]?.string))
        case "open_run":
            guard let runId = id(object["runId"]?.string) else { return nil }
            return .openRun(runId: runId, routineId: id(object["routineId"]?.string))
        default:
            return nil
        }
    }

    public static func appAction(from entry: ChatWidgetActionEntry) -> ChatWidgetAppAction? {
        appAction(type: entry.type, payload: entry.payload)
    }

    /// Whether this action type is handled on the device (link or in-app place).
    public static func isClientAction(type: String, payload: WidgetJSON?) -> Bool {
        type == "open_url" || appAction(type: type, payload: payload) != nil
    }

    /// Map an in-app action to the phone destination. `botId` is the chat's
    /// bot when the action does not name one (open_page / open_routine).
    public static func destination(for action: ChatWidgetAppAction, botId: String) -> ChatWidgetDestination {
        switch action {
        case let .openPage(page):
            switch page {
            case .routines: return .automations
            case .approvals: return .updates
            case .teamMap: return .teamMap
            case .achievements: return .achievements
            case .code, .remoteSessions: return .botComputer(botId: botId)
            }
        case let .openRoutine(routineId, namedBot):
            return .routine(routineId: routineId, botId: namedBot ?? botId)
        case let .openRun(runId, routineId):
            return .run(runId: runId, routineId: routineId)
        }
    }

    /// Same alphabet as shared/widget.ts `ID_TEXT`: `^[\w.:-]{1,128}$` in JS
    /// (`\w` = ASCII word chars).
    private static func id(_ value: String?) -> String? {
        guard let value, !value.isEmpty, value.count <= 128 else { return nil }
        let ok = value.utf8.allSatisfy { byte in
            (48...57).contains(byte) // 0-9
                || (65...90).contains(byte) // A-Z
                || (97...122).contains(byte) // a-z
                || byte == 95 || byte == 46 || byte == 58 || byte == 45 // _ . : -
        }
        return ok ? value : nil
    }
}

public extension ChatWidgetActionEntry {
    /// The in-app place this press opens, when it is one of open_page /
    /// open_routine / open_run.
    var appAction: ChatWidgetAppAction? { ChatWidgetDevice.appAction(from: self) }
}

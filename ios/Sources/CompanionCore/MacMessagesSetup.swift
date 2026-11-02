// Connect apps > Mac > Messages setup (parity with shared/mac-messages-setup.ts).
// Tools and the enable switch live only on the solo Mac Sagax process.
// The phone shows the same steps and can call the Mac's /api/messages when
// that host answers; Full Disk Access and Automation are granted on the Mac.
import Foundation

public enum MessagesPermissionState: String, Hashable, Sendable, Codable {
    case granted, denied, unknown, notAsked, unsupported
}

public enum MessagesPermissionId: String, Hashable, Sendable, Codable {
    case fullDiskAccess, automation
}

public struct MessagesSetupPermissions: Hashable, Sendable, Codable {
    public var fullDiskAccess: MessagesPermissionState
    public var automation: MessagesPermissionState

    public init(fullDiskAccess: MessagesPermissionState = .unknown, automation: MessagesPermissionState = .unknown) {
        self.fullDiskAccess = fullDiskAccess
        self.automation = automation
    }
}

public enum MessagesSetupUnavailableReason: String, Hashable, Sendable, Codable {
    case notDarwin = "not_darwin"
    case organizationServer = "organization_server"
    case bridgeRefused = "bridge_refused"
    case webOrRemote = "web_or_remote"
}

public struct MessagesSetupStatus: Hashable, Sendable, Codable {
    public var available: Bool
    public var onThisMac: Bool
    public var reason: MessagesSetupUnavailableReason?
    public var useMessages: Bool
    public var permissions: MessagesSetupPermissions

    public init(
        available: Bool,
        onThisMac: Bool,
        reason: MessagesSetupUnavailableReason? = nil,
        useMessages: Bool = false,
        permissions: MessagesSetupPermissions = MessagesSetupPermissions()
    ) {
        self.available = available
        self.onThisMac = onThisMac
        self.reason = reason
        self.useMessages = useMessages
        self.permissions = permissions
    }
}

public struct MessagesSetupTestResult: Hashable, Sendable, Codable {
    /// Count of recent conversation names. Never include message bodies.
    public var conversationCount: Int
    /// Display names for the UI only (synthetic in galleries and fixtures).
    public var names: [String]

    public init(conversationCount: Int, names: [String] = []) {
        self.conversationCount = conversationCount
        self.names = names
    }
}

public enum MessagesPrivacyPane: String, Hashable, Sendable, Codable {
    case fullDiskAccess, automation
}

public enum MessagesSetupStepId: String, Hashable, Sendable {
    case fullDiskAccess, automation, test, enable
}

public enum MessagesSetupStepState: String, Hashable, Sendable {
    case done, todo, blocked, waiting
}

/// Live checklist state for one setup step (mirrors shared/mac-messages-setup.ts).
public func messagesStepState(
    step: MessagesSetupStepId,
    permissions: MessagesSetupPermissions,
    useMessages: Bool,
    tested: Bool,
    testOk: Bool
) -> MessagesSetupStepState {
    switch step {
    case .fullDiskAccess:
        if permissions.fullDiskAccess == .granted { return .done }
        if permissions.fullDiskAccess == .denied { return .blocked }
        return .todo
    case .automation:
        if permissions.automation == .granted { return .done }
        if permissions.automation == .denied { return .blocked }
        return .todo
    case .test:
        if permissions.fullDiskAccess != .granted { return .blocked }
        if tested && testOk { return .done }
        if tested && !testOk { return .blocked }
        return .todo
    case .enable:
        if useMessages { return .done }
        if permissions.fullDiskAccess != .granted { return .blocked }
        return .todo
    }
}

/// Cap names shown in the test result; never log message bodies.
public func messagesTestNamesView(_ names: [String], limit: Int = 8) -> MessagesSetupTestResult {
    let clean = names
        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    return MessagesSetupTestResult(
        conversationCount: clean.count,
        names: Array(clean.prefix(max(0, limit)))
    )
}

/// Row state for Installed > This Mac > Messages (views pick the localized copy).
public enum MessagesMacRowState: Hashable, Sendable {
    case unknown, off, on, unavailable
}

public func messagesMacRowState(_ status: MessagesSetupStatus?) -> MessagesMacRowState {
    guard let status else { return .unknown }
    if !status.available { return .unavailable }
    return status.useMessages ? .on : .off
}

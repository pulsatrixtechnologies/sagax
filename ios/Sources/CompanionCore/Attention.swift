// What a nudge or an unread count does on THIS phone (src/lib/attention.ts,
// #164, #222; matrix DC16 to DC18). The desktop shakes its window, bounces
// the Dock and flashes the taskbar; the phone's equivalents are a haptic
// pattern, a local notification and the app icon badge. Each part follows
// this device's switches in Settings > Notifications.
import Foundation

public struct AttentionSettings: Hashable, Sendable {
    /// Notification sounds.
    public var sound: Bool
    /// Unread count on the app icon.
    public var badge: Bool
    /// The wizz on a nudge.
    public var nudgeSound: Bool
    /// The haptic on a nudge (the desktop's window shake).
    public var nudgeHaptic: Bool
    /// A distinct sound when an approval banner arrives. On by default.
    public var approvalChime: Bool

    public init(sound: Bool = true, badge: Bool = true, nudgeSound: Bool = true, nudgeHaptic: Bool = true, approvalChime: Bool = true) {
        self.sound = sound
        self.badge = badge
        self.nudgeSound = nudgeSound
        self.nudgeHaptic = nudgeHaptic
        self.approvalChime = approvalChime
    }

    /// All on by default, as on the desktop.
    public static let `default` = AttentionSettings()
}

public struct NudgeAttention: Hashable, Sendable {
    /// False for a stale replay: nothing rings, nothing moves.
    public var fresh: Bool
    public var sound: Bool
    public var haptic: Bool
    /// A local notification too, when the app is not in front.
    public var notify: Bool

    /// `nudgeAttention`.
    public static func decide(_ nudge: NudgeFrame, now: Double, appActive: Bool, viewingThreadId _: String?, settings: AttentionSettings) -> NudgeAttention {
        let fresh: Bool
        if let at = nudge.at { fresh = abs(now - at) <= NudgeFrame.freshMs } else { fresh = true }
        guard fresh else { return NudgeAttention(fresh: false, sound: false, haptic: false, notify: false) }
        return NudgeAttention(fresh: true, sound: settings.nudgeSound, haptic: settings.nudgeHaptic && appActive, notify: !appActive)
    }
}

public enum Attention {
    /// `badgeCount`: the unread conversations, or nothing when the badge is off.
    public static func badge(_ unread: Int, settings: AttentionSettings) -> Int {
        guard settings.badge, unread > 0 else { return 0 }
        return unread
    }
}

/// What `userNotificationCenter(_:willPresent:)` should show. The live stream
/// already delivered the line: a banner or sound on top of the open app is
/// noise, especially when that bot's conversation is on screen.
public enum ForegroundNotification {
    /// False while the app is in front. A backgrounded phone still rings,
    /// even if the last open thread matches.
    public static func showsSystemBanner(appActive: Bool, viewingThreadId: String?, threadId: String?) -> Bool {
        guard appActive else { return true }
        // Floor: the conversation on screen. This build is silent for every
        // notification while the app is in front.
        if let threadId, let viewingThreadId, threadId == viewingThreadId { return false }
        return false
    }
}

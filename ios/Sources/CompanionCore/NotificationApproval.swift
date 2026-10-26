// Allow or Deny from a notification, without opening the card.
//
// Allow once only. "Always allow" is not offered: the lock screen does not
// show the whole card, and a standing grant from there is the risk this
// closes. A class the person protects with a security key is not granted
// in the background. That Allow opens Sagax and the existing ceremony
// (Face ID or a key) runs. Until the ceremony answers, nothing is approved.
import Foundation

public enum NotificationApproval {
    public static let allowAction = "sagax.approval.allow"
    public static let denyAction = "sagax.approval.deny"
    /// `UNNotificationDefaultActionIdentifier`.
    public static let defaultAction = "com.apple.UNNotificationDefaultActionIdentifier"
    /// `UNNotificationDismissActionIdentifier`.
    public static let dismissAction = "com.apple.UNNotificationDismissActionIdentifier"

    public static let category = "SAGAX_APPROVAL"
    public static let keyCategory = "SAGAX_APPROVAL_KEY"
    public static let updateCategory = "SAGAX_UPDATE"
    /// Bundled chime (ios/App/approval.caf). Distinct from the system sound and the nudge.
    public static let soundFile = "approval.caf"
    /// APNs subtitle key. `%@` is the routine's name.
    public static let routineSubtitleKey = "Open routine %@"
    /// userInfo flag: the follow-up banner, after a key was required in the background.
    public static let stepUpPending = "pending"

    public enum Decision: Equatable, Sendable {
        case open(NotificationTarget)
        /// Allow once. `needsKey` means the action already brought the app forward.
        case allow(threadId: String, requestId: String, needsKey: Bool)
        case deny(threadId: String, requestId: String)
        /// The person opened the follow-up banner. Run the security-key ceremony, then Allow once.
        case confirmKey(threadId: String, requestId: String)
    }

    /// What to do after the server refuses an Allow because a key is required.
    /// Active: the ceremony can run. Otherwise nothing is approved, and a
    /// banner asks the person to open Sagax.
    public enum StepUpFollowUp: Equatable, Sendable {
        case ceremony
        case deferToApp
    }

    public static func afterRefusal(appActive: Bool) -> StepUpFollowUp {
        appActive ? .ceremony : .deferToApp
    }

    /// The category a local banner registers. Only an approval that names
    /// its request gets actions. A question does not.
    public static func category(kind: String, requestId: String?, needsKey: Bool) -> String {
        guard kind == "approval", token(requestId) != nil else { return updateCategory }
        return needsKey ? keyCategory : category
    }

    /// `nil` dismisses the banner and does nothing else.
    public static func decide(actionIdentifier: String, info: [String: String]) -> Decision? {
        if actionIdentifier == dismissAction { return nil }
        let threadId = token(info["threadId"])
        let requestId = token(info["requestId"])
        let target = NotificationTarget(payload: info)
        switch actionIdentifier {
        case allowAction:
            guard let threadId, let requestId else { return target.map(Decision.open) }
            return .allow(threadId: threadId, requestId: requestId, needsKey: info["needsKey"] == "1")
        case denyAction:
            guard let threadId, let requestId else { return target.map(Decision.open) }
            return .deny(threadId: threadId, requestId: requestId)
        case defaultAction:
            if info["stepUp"] == stepUpPending, let threadId, let requestId {
                return .confirmKey(threadId: threadId, requestId: requestId)
            }
            return target.map(Decision.open)
        default:
            return target.map(Decision.open)
        }
    }

    /// A route id the phone will put in a URL. Anything else opens the
    /// conversation instead of being sent.
    static func token(_ raw: String?) -> String? {
        guard let raw else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard (1...128).contains(value.utf8.count) else { return nil }
        let ok = value.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
                || byte == 45 || byte == 95
        }
        return ok ? value : nil
    }
}

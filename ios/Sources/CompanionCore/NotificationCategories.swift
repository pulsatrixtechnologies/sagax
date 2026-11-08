// The notification categories the phone registers, in one place for the app
// and its Notification Service Extension: Allow once and Deny on an
// approval, Approve and Deny on a needs-you, Do it and Not now on a
// proactive proposal (#2697), a question's own choices (up to NotificationChoices.limit, then
// Open), Reply on a question with no choices, nothing on the rest.
//
// A question's choices change with every question, so their category is
// made when the notification arrives (the extension, or the app for a local
// banner) and added next to the fixed ones, before the banner shows: a
// category that is not registered yet is a banner without buttons.
#if canImport(UserNotifications)
import Foundation
import UserNotifications

public enum NotificationCategories {
    /// The words on the fixed buttons, in the app's language.
    public struct Titles: Sendable {
        public var allowOnce: String
        public var deny: String
        public var reply: String
        public var send: String
        public var placeholder: String
        /// #2697: a needs-you's Approve (its Deny is `deny`).
        public var approve: String
        /// #2697: a proactive proposal's Do it and Not now.
        public var doIt: String
        public var notNow: String

        public init(
            allowOnce: String, deny: String, reply: String, send: String, placeholder: String,
            approve: String = "Approve", doIt: String = "Do it", notNow: String = "Not now"
        ) {
            self.allowOnce = allowOnce
            self.deny = deny
            self.reply = reply
            self.send = send
            self.placeholder = placeholder
            self.approve = approve
            self.doIt = doIt
            self.notNow = notNow
        }
    }

    /// Per-choices categories kept at most; past it, others go first.
    public static let choicesKept = 16

    /// Allow once and Deny. Unlock (Face ID, the passcode, or a watch on the
    /// wrist) is required before iOS delivers either. A key-protected Allow
    /// opens the app so the ceremony can run.
    public static func fixed(_ titles: Titles) -> Set<UNNotificationCategory> {
        let deny = UNNotificationAction(identifier: NotificationApproval.denyAction, title: titles.deny, options: [.authenticationRequired, .destructive])
        let allow = UNNotificationAction(identifier: NotificationApproval.allowAction, title: titles.allowOnce, options: [.authenticationRequired])
        let allowWithKey = UNNotificationAction(identifier: NotificationApproval.allowAction, title: titles.allowOnce, options: [.authenticationRequired, .foreground])
        let reply = UNTextInputNotificationAction(
            identifier: NotificationApproval.replyAction, title: titles.reply, options: [.authenticationRequired],
            textInputButtonTitle: titles.send, textInputPlaceholder: titles.placeholder
        )
        // #2697: a needs-you and a proactive proposal answer from the banner
        let approve = UNNotificationAction(identifier: NotificationApproval.approveAction, title: titles.approve, options: [.authenticationRequired])
        let decline = UNNotificationAction(identifier: NotificationApproval.declineAction, title: titles.deny, options: [.authenticationRequired, .destructive])
        let doIt = UNNotificationAction(identifier: NotificationApproval.doItAction, title: titles.doIt, options: [.authenticationRequired])
        let notNow = UNNotificationAction(identifier: NotificationApproval.notNowAction, title: titles.notNow, options: [])
        return [
            UNNotificationCategory(identifier: NotificationApproval.needsYouCategory, actions: [approve, decline], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationApproval.proposalCategory, actions: [doIt, notNow], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationApproval.category, actions: [allow, deny], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationApproval.keyCategory, actions: [allowWithKey, deny], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationApproval.updateCategory, actions: [], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: NotificationApproval.questionCategory, actions: [reply], intentIdentifiers: [], options: []),
        ]
    }

    /// A question's choices as buttons, in order; past the limit, Open.
    public static func choices(_ layout: NotificationChoices.Layout, openTitle: String) -> UNNotificationCategory {
        var actions: [UNNotificationAction] = layout.shown.enumerated().map { index, choice in
            UNNotificationAction(identifier: NotificationChoices.actionIdentifier(index), title: choice, options: [.authenticationRequired])
        }
        if layout.overflow {
            actions.append(UNNotificationAction(identifier: NotificationChoices.openAction, title: openTitle, options: [.foreground]))
        }
        return UNNotificationCategory(
            identifier: NotificationChoices.categoryIdentifier(layout.shown, overflow: layout.overflow),
            actions: actions, intentIdentifiers: [], options: []
        )
    }

    /// The registered set with `added` in it: the fixed ones kept, the
    /// per-choices ones bounded (the new one always stays).
    public static func merged(_ current: Set<UNNotificationCategory>, adding added: UNNotificationCategory) -> Set<UNNotificationCategory> {
        var kept = current.filter { $0.identifier != added.identifier }
        let choiceCategories = kept.filter { NotificationChoices.isChoicesCategory($0.identifier) }
            .sorted { $0.identifier < $1.identifier }
        if choiceCategories.count >= choicesKept {
            for old in choiceCategories.prefix(choiceCategories.count - choicesKept + 1) { kept.remove(old) }
        }
        kept.insert(added)
        return kept
    }

    /// Adds `category` to what the center has, and returns once it is there.
    public static func register(_ category: UNNotificationCategory, in center: UNUserNotificationCenter) async {
        let current = await center.notificationCategories()
        if current.contains(where: { $0.identifier == category.identifier && $0.actions.map(\.identifier) == category.actions.map(\.identifier) }) { return }
        center.setNotificationCategories(merged(current, adding: category))
        // the set is applied asynchronously: one read back waits for it
        _ = await center.notificationCategories()
    }

    /// "Open", for a button made outside the app's catalog (the extension).
    public static func openTitle(languages: [String] = Locale.preferredLanguages) -> String {
        for language in languages {
            let code = language.lowercased()
            if code.hasPrefix("fr") { return "Ouvrir" }
            if code.hasPrefix("pt") { return "Abrir" }
            if code.hasPrefix("en") { return "Open" }
        }
        return "Open"
    }
}
#endif

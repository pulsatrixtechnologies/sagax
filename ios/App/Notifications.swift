import Foundation
import UIKit
import UserNotifications
import CompanionCore

/// The on-device notification surface. Delivery comes from live or replayed
/// companion frames, and from APNs pushes the server sends while the app is
/// closed (PushRegistrar.swift), which carry the same categories and userInfo.
final class NotificationCoordinator: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCoordinator()
    private let center = UNUserNotificationCenter.current()
    /// Set by `Session`; kept as an id-only value so the notification layer
    /// does not know about SwiftUI navigation or mutable fleet state.
    var responseHandler: ((NotificationTarget) -> Void)?
    /// Allow or Deny from the banner. The session wires the sender.
    var approvalHandler: ((NotificationApproval.Decision) async -> NotificationApprovalRunner.Outcome)?

    private override init() {
        super.init()
        center.delegate = self
        registerCategories()
    }

    /// Allow once and Deny. Unlock (Face ID or the passcode) is required
    /// before iOS delivers either action. A key-protected Allow also opens
    /// the app so the ceremony can run. "Always allow" is not an action.
    private func registerCategories() {
        let deny = UNNotificationAction(
            identifier: NotificationApproval.denyAction,
            title: String(localized: "Deny"),
            options: [.authenticationRequired, .destructive]
        )
        let allow = UNNotificationAction(
            identifier: NotificationApproval.allowAction,
            title: String(localized: "Allow once"),
            options: [.authenticationRequired]
        )
        let allowWithKey = UNNotificationAction(
            identifier: NotificationApproval.allowAction,
            title: String(localized: "Allow once"),
            options: [.authenticationRequired, .foreground]
        )
        let plain = UNNotificationCategory(
            identifier: NotificationApproval.category, actions: [allow, deny], intentIdentifiers: [], options: []
        )
        let keyed = UNNotificationCategory(
            identifier: NotificationApproval.keyCategory, actions: [allowWithKey, deny], intentIdentifiers: [], options: []
        )
        let update = UNNotificationCategory(
            identifier: NotificationApproval.updateCategory, actions: [], intentIdentifiers: [], options: []
        )
        center.setNotificationCategories([plain, keyed, update])
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true
    }

    func deliver(_ notification: NotificationFrame, sequence: Int?, confidential: Bool = false) {
        // the conversation on a live call is heard, not buzzed
        if CallQuiet.shared.silences(threadId: notification.threadId) { return }
        let content = UNMutableNotificationContent()
        // a confidential thread's banner never carries its words nor its
        // title (taken from its first message); the bot's name replaces
        // the title below when there is one
        content.title = confidential ? ConfidentialRedaction.placeholder : notification.title
        content.body = ConfidentialRedaction.notificationBody(notification.body, confidential: confidential)
        // Settings > Haptics > Notification sounds: off keeps the banner.
        content.sound = sound(for: notification.kind)
        let needsKey = notification.needsKey == true
        content.categoryIdentifier = NotificationApproval.category(
            kind: notification.kind, requestId: notification.requestId, needsKey: needsKey
        )
        content.threadIdentifier = notification.threadId
        var info: [String: String] = [
            "threadId": notification.threadId,
            "botId": notification.botId,
            "kind": notification.kind,
            // a person's message or a room tag names its conversation (#262, #274)
            "groupId": notification.groupId ?? "",
        ]
        if let requestId = notification.requestId, !requestId.isEmpty { info["requestId"] = requestId }
        if needsKey { info["needsKey"] = "1" }
        if let routineRunId = notification.routineRunId, !routineRunId.isEmpty { info["routineRunId"] = routineRunId }
        if let routineName = notification.routineName, !routineName.isEmpty {
            info["routineName"] = routineName
            if notification.kind == "done" {
                content.subtitle = String(format: String(localized: "Open routine %@"), routineName)
            }
        }
        content.userInfo = info
        if notification.isBlocking { content.interruptionLevel = .timeSensitive }

        let posted = communicationContent(content, name: notification.botName, id: notification.botId, conversationId: notification.threadId)
        // One conversation, one banner: a replayed frame, the next line of
        // the same conversation and the APNs push for it (whose
        // apns-collapse-id is this same identifier) replace it.
        let identifier = PushCollapse.identifier(threadId: notification.threadId, kind: notification.kind)
        center.add(UNNotificationRequest(identifier: identifier, content: posted, trigger: nil))
    }

    /// Name the bot (or person) as the sender when we have a display name.
    private func communicationContent(
        _ content: UNMutableNotificationContent,
        name: String,
        id: String,
        conversationId: String
    ) -> UNNotificationContent {
        let display = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !display.isEmpty else { return content }
        content.title = display
        let handle = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let conversation = conversationId.trimmingCharacters(in: .whitespacesAndNewlines)
        let sender = PushSenderIdentity(
            id: handle.isEmpty ? display : handle,
            displayName: display,
            conversationId: conversation.isEmpty ? display : conversation,
            avatarUrl: nil
        )
        return CommunicationNotification.applyingIntent(content, sender: sender, imageData: nil)
    }

    /// Settings > Notifications > Unread count on the app icon (#222).
    func setBadge(_ count: Int) {
        center.setBadgeCount(Attention.badge(count, settings: AttentionPrefs.settings))
    }

    /// Banners for bot conversations the person has since read or answered,
    /// on this device or another, leave Notification Center.
    func withdrawSettled(bots: [Bot]) async {
        let ids = DeliveredNotifications.settled(await delivered(), bots: bots)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    /// A silent "read" push: the conversation was read on another device.
    func withdraw(threadId: String) async {
        let ids = DeliveredNotifications.forThread(await delivered(), threadId: threadId)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    private func delivered() async -> [DeliveredNotifications.Delivered] {
        await center.deliveredNotifications().map { note in
            let info = note.request.content.userInfo
            func string(_ key: String) -> String? {
                guard let value = info[key] as? String, !value.isEmpty else { return nil }
                return value
            }
            return DeliveredNotifications.Delivered(
                id: note.request.identifier, botId: string("botId") ?? string("groupId"),
                threadId: string("threadId"), date: note.date
            )
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // nothing for the conversation on a live call: no banner, no sound
        let userInfo = notification.request.content.userInfo
        let threadId = userInfo["threadId"] as? String
        if CallQuiet.shared.silences(threadId: threadId) { return completionHandler([]) }
        // App in front: return [] (no banner, no sound). The live stream already
        // showed the line; a nudge still rings in-app once.
        Task { @MainActor in
            let appActive = UIApplication.shared.applicationState == .active
            if let push = PushPayload(userInfo: userInfo) {
                completionHandler(AttentionCenter.shared.presentation(for: push, appActive: appActive))
                return
            }
            if !ForegroundNotification.showsSystemBanner(
                appActive: appActive,
                viewingThreadId: AttentionCenter.shared.viewingThreadId,
                threadId: threadId
            ) {
                completionHandler([])
                return
            }
            completionHandler(NotificationSounds.isEnabled ? [.banner, .list, .sound, .badge] : [.banner, .list, .badge])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let strings = Self.strings(from: response.notification.request.content.userInfo)
        guard let decision = NotificationApproval.decide(actionIdentifier: response.actionIdentifier, info: strings) else {
            completionHandler()
            return
        }
        switch decision {
        case let .open(target):
            responseHandler?(target)
            completionHandler()
        case .allow, .deny, .confirmKey:
            if case .confirmKey = decision, let target = NotificationTarget(payload: strings) {
                responseHandler?(target)
            }
            let handler = approvalHandler
            let identifier = response.notification.request.identifier
            Task {
                let outcome = await handler?(decision) ?? .failed
                if outcome == .answered {
                    self.center.removeDeliveredNotifications(withIdentifiers: [identifier])
                } else if outcome == .needsForeground, case let .allow(threadId, requestId, _) = decision {
                    NotificationApprovalRunner.remember(threadId: threadId, requestId: requestId)
                    self.postKeyNeeded(threadId: threadId, botId: strings["botId"] ?? "", requestId: requestId, title: response.notification.request.content.title)
                } else if outcome == .failed, let target = NotificationTarget(payload: strings) {
                    self.responseHandler?(target)
                }
                completionHandler()
            }
        }
    }

    /// The approval sound when the chime is on, else the system sound, else none.
    private func sound(for kind: String) -> UNNotificationSound? {
        guard NotificationSounds.isEnabled else { return nil }
        if kind == "approval", ApprovalChime.isEnabled {
            return UNNotificationSound(named: UNNotificationSoundName(NotificationApproval.soundFile))
        }
        return .default
    }

    /// A key was required and the app was not in front. Nothing was approved.
    private func postKeyNeeded(threadId: String, botId: String, requestId: String, title: String) {
        let content = UNMutableNotificationContent()
        content.title = title.isEmpty ? "Sagax" : title
        content.body = String(localized: "This approval needs your security key. Open Sagax to confirm. Nothing was approved yet.")
        content.categoryIdentifier = NotificationApproval.updateCategory
        content.threadIdentifier = threadId
        content.interruptionLevel = .timeSensitive
        content.sound = sound(for: "approval")
        content.userInfo = [
            "threadId": threadId,
            "botId": botId,
            "requestId": requestId,
            "kind": "approval",
            "stepUp": NotificationApproval.stepUpPending,
        ]
        let identifier = PushCollapse.identifier(threadId: threadId, kind: "approval")
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    static func strings(from userInfo: [AnyHashable: Any]) -> [String: String] {
        var result: [String: String] = [:]
        for (key, value) in userInfo {
            guard let key = key as? String else { continue }
            if let value = value as? String, !value.isEmpty {
                result[key] = value
            } else if key == "needsKey" {
                let on = (value as? Bool) == true || (value as? NSNumber)?.boolValue == true
                if on { result[key] = "1" }
            }
        }
        return result
    }
}

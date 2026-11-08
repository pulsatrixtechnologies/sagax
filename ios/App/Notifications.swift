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
    /// The bot a local banner comes from, for its mascot. Set by `Session`.
    var botLookup: (@MainActor (String) -> Bot?)?
    /// Local banners post in the order their frames came, even while a
    /// face is being drawn.
    @MainActor private var lastPost: Task<Void, Never>?

    private override init() {
        super.init()
        center.delegate = self
        registerCategories()
    }

    /// Allow once and Deny, Reply, and the plain category, registered at
    /// launch (NotificationCategories). A question's choices get their own
    /// category when its banner is made. "Always allow" is not an action.
    private func registerCategories() {
        center.setNotificationCategories(NotificationCategories.fixed(Self.titles))
    }

    static var titles: NotificationCategories.Titles {
        NotificationCategories.Titles(
            allowOnce: String(localized: "Allow once"),
            deny: String(localized: "Deny"),
            reply: String(localized: "Reply"),
            send: String(localized: "Send"),
            placeholder: String(localized: "Type your answer"),
            approve: String(localized: "notification.needsYou.approve", defaultValue: "Approve"),
            doIt: String(localized: "notification.proposal.doIt", defaultValue: "Do it"),
            notNow: String(localized: "notification.proposal.notNow", defaultValue: "Not now"),
            open: String(localized: "Open")
        )
    }

    func authorizationStatus() async -> UNAuthorizationStatus {
        await center.notificationSettings().authorizationStatus
    }

    func requestAuthorization() async -> Bool {
        (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) == true
    }

    @MainActor func deliver(_ notification: NotificationFrame, sequence: Int?, confidential: Bool = false) {
        // the conversation on a live call is heard, not buzzed
        if CallQuiet.shared.silences(threadId: notification.threadId) { return }
        // an AI client's conversation over MCP never rings the phone or the watch
        if notification.quietOnPhones == true { return }
        if notification.notify == false { return }
        let content = UNMutableNotificationContent()
        // a confidential thread's banner never carries its words nor its
        // title (taken from its first message); the bot's name replaces
        // the title below when there is one
        content.title = confidential ? ConfidentialRedaction.placeholder : notification.title
        content.body = ConfidentialRedaction.notificationBody(notification.bannerBody, confidential: confidential)
        // Settings > Haptics > Notification sounds: off keeps the banner.
        content.sound = sound(for: notification.kind)
        let needsKey = notification.needsKey == true
        let choices = confidential ? [] : (notification.choices ?? [])
        let choiceLabels = confidential ? [] : (notification.choiceLabels ?? [])
        content.categoryIdentifier = NotificationApproval.category(
            kind: notification.kind, requestId: notification.requestId, needsKey: needsKey, choices: choices,
            choiceLabels: choiceLabels, proposalId: notification.proposalId
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
        if let proposalId = notification.proposalId, !proposalId.isEmpty { info["proposalId"] = proposalId }
        if notification.kind == "question" || notification.kind == "needs-you", !choices.isEmpty {
            info["choices"] = NotificationChoices.layout(choices, limit: 10).shown.joined(separator: "\u{1F}")
        }
        // #2909: the tap opens the bot's chat on the card
        if let cardId = notification.cardId, !cardId.isEmpty { info["cardId"] = cardId }
        if let routineRunId = notification.routineRunId, !routineRunId.isEmpty { info["routineRunId"] = routineRunId }
        if let routineName = notification.routineName, !routineName.isEmpty {
            info["routineName"] = routineName
            if notification.kind == "done" {
                content.subtitle = String(format: String(localized: "Open routine %@"), routineName)
            }
        }
        content.userInfo = info
        if notification.isBlocking { content.interruptionLevel = .timeSensitive }

        // One conversation, one banner: a replayed frame, the next line of
        // the same conversation and the APNs push for it (whose
        // apns-collapse-id is this same identifier) replace it.
        let identifier = PushCollapse.identifier(
            threadId: notification.threadId, kind: notification.kind, requestId: notification.requestId, proposalId: notification.proposalId
        )
        let choicesCategory: UNNotificationCategory? = NotificationChoices.isChoicesCategory(content.categoryIdentifier)
            ? NotificationChoices.buttons(choices: choices, labels: choiceLabels)
                .map { NotificationCategories.choices($0, openTitle: String(localized: "Open")) }
            : nil
        // the bot's mascot as the banner's face, like a push (MascotAvatarRenderer)
        let botId = notification.botId.trimmingCharacters(in: .whitespacesAndNewlines)
        let bot = botId.isEmpty ? nil : botLookup?(botId)
        let previous = lastPost
        lastPost = Task { @MainActor [center] in
            await previous?.value
            // the buttons first: a banner whose category is not registered has none
            if let choicesCategory { await NotificationCategories.register(choicesCategory, in: center) }
            let sender = Self.sender(name: notification.botName, id: notification.botId, conversationId: notification.threadId, bot: bot)
            var imageData: Data?
            if let sender, sender.look != nil {
                imageData = await NotificationAvatarResolver.imageData(
                    for: sender,
                    cache: NotificationAvatarCache.appGroup(SagaxSharedConfiguration.appGroupIdentifier),
                    // a local banner draws the mascot; a picture is the push's
                    download: { _ in nil },
                    render: { look in await MascotAvatarRenderer.png(look) }
                )
            }
            let posted = Self.communicationContent(content, sender: sender, imageData: imageData)
            try? await center.add(UNNotificationRequest(identifier: identifier, content: posted, trigger: nil))
        }
    }

    /// The bot (or person) a local banner names as its sender, with the
    /// bot's look when the app knows the bot.
    static func sender(name: String, id: String, conversationId: String, bot: Bot?) -> PushSenderIdentity? {
        let display = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !display.isEmpty else { return nil }
        let handle = id.trimmingCharacters(in: .whitespacesAndNewlines)
        let conversation = conversationId.trimmingCharacters(in: .whitespacesAndNewlines)
        let look = bot.map(PushSenderLook.init(bot:))
        return PushSenderIdentity(
            id: handle.isEmpty ? display : handle,
            displayName: display,
            conversationId: conversation.isEmpty ? display : conversation,
            avatarUrl: nil,
            look: look,
            lookVersion: look?.fingerprint()
        )
    }

    /// Name the bot (or person) as the sender when we have a display name.
    private static func communicationContent(
        _ content: UNMutableNotificationContent,
        sender: PushSenderIdentity?,
        imageData: Data?
    ) -> UNNotificationContent {
        guard let sender else { return content }
        content.title = sender.displayName
        return CommunicationNotification.applyingIntent(content, sender: sender, imageData: imageData)
    }

    /// Settings > Notifications > Unread count on the app icon (#222).
    func setBadge(_ count: Int) {
        center.setBadgeCount(Attention.badge(count, settings: AttentionPrefs.settings))
    }

    /// Banners for bot conversations the person has since read or answered,
    /// on this device or another, leave Notification Center.
    func withdrawSettled(bots: [Bot], openRequestIds: Set<String> = []) async {
        let ids = DeliveredNotifications.settled(await delivered(), bots: bots, openRequestIds: openRequestIds)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    /// A silent "read" push: the conversation was read on another device.
    func withdraw(threadId: String) async {
        let ids = DeliveredNotifications.forThread(await delivered(), threadId: threadId)
        if !ids.isEmpty { center.removeDeliveredNotifications(withIdentifiers: ids) }
    }

    /// An approval or question was answered or expired: its banner goes,
    /// and only its own (`PushKind.settled`, or this phone's own answer).
    func withdraw(threadId: String?, requestId: String) async {
        var ids = DeliveredNotifications.forRequest(await delivered(), threadId: threadId, requestId: requestId)
        ids.append(PushCollapse.identifier(threadId: threadId, kind: "approval", requestId: requestId))
        center.removeDeliveredNotifications(withIdentifiers: Array(Set(ids)))
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
                threadId: string("threadId"), date: note.date, requestId: string("requestId")
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
        let typed = (response as? UNTextInputNotificationResponse)?.userText
        guard let decision = NotificationApproval.decide(actionIdentifier: response.actionIdentifier, info: strings, replyText: typed) else {
            completionHandler()
            return
        }
        switch decision {
        case let .open(target):
            responseHandler?(target)
            completionHandler()
        case .allow, .deny, .confirmKey, .reply, .needsYou, .needsYouAnswer, .proposal:
            if case .confirmKey = decision, let target = NotificationTarget(payload: strings) {
                responseHandler?(target)
            }
            let handler = approvalHandler
            let identifier = response.notification.request.identifier
            let original = response.notification.request.content
            Task {
                let outcome = await handler?(decision) ?? .failed
                if outcome == .answered {
                    // the ask leaves, and one quiet line says the answer went
                    self.center.removeDeliveredNotifications(withIdentifiers: [identifier])
                    if case .confirmKey = decision {} else {
                        self.postOutcome(AnswerFeedback.answered(decision), original: original, info: strings)
                    }
                } else if outcome == .needsForeground, case let .allow(threadId, requestId, _) = decision {
                    NotificationApprovalRunner.remember(threadId: threadId, requestId: requestId)
                    self.postKeyNeeded(threadId: threadId, botId: strings["botId"] ?? "", requestId: requestId, title: response.notification.request.content.title)
                } else if outcome == .failed {
                    let active = await MainActor.run { UIApplication.shared.applicationState == .active }
                    if active, let target = NotificationTarget(payload: strings) {
                        self.responseHandler?(target)
                    } else {
                        // in the background nothing opens: a plain banner says it did not go
                        self.postOutcome(.failed, original: original, info: strings)
                    }
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
        // Settings > Notifications > Notification sound
        return NotificationSounds.platformSound
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
        let identifier = PushCollapse.identifier(threadId: threadId, kind: "approval", requestId: requestId)
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    /// The answer given from a banner or the watch: one quiet line in its
    /// conversation's place ("Allowed", "Denied", "Answer sent: Yes"), or a
    /// plain banner when it did not go through. The conversation's next line
    /// replaces it, so it never contradicts what follows.
    private func postOutcome(_ feedback: AnswerFeedback, original: UNNotificationContent, info: [String: String]) {
        let threadId = info["threadId"] ?? ""
        let content = UNMutableNotificationContent()
        content.title = original.title.isEmpty ? "Sagax" : original.title
        content.body = feedback.text(question: NotificationQuestion.first(line: original.body))
        content.categoryIdentifier = NotificationApproval.updateCategory
        content.threadIdentifier = threadId
        var userInfo: [String: String] = ["threadId": threadId, "botId": info["botId"] ?? "", "kind": feedback == .failed ? "failed" : "answered"]
        if let groupId = info["groupId"], !groupId.isEmpty { userInfo["groupId"] = groupId }
        content.userInfo = userInfo
        if feedback == .failed {
            content.interruptionLevel = .active
            content.sound = NotificationSounds.isEnabled ? NotificationSounds.platformSound : nil
        } else {
            // a receipt, not news: no sound, no lit screen
            content.interruptionLevel = .passive
        }
        let identifier = PushCollapse.identifier(threadId: threadId, kind: "message")
        center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
    }

    static func strings(from userInfo: [AnyHashable: Any]) -> [String: String] {
        var result: [String: String] = [:]
        for (key, value) in userInfo {
            guard let key = key as? String else { continue }
            if let value = value as? String, !value.isEmpty {
                result[key] = value
            } else if key == "choices" {
                // a push carries its choices as a list; the decision reads them joined
                let choices = NotificationChoices.choices(from: value)
                if !choices.isEmpty { result[key] = choices.joined(separator: "\u{1F}") }
            } else if key == "needsKey" {
                let on = (value as? Bool) == true || (value as? NSNumber)?.boolValue == true
                if on { result[key] = "1" }
            }
        }
        return result
    }
}

extension AnswerFeedback {
    /// The receipt's line, in the app's language.
    func text(question: String) -> String {
        switch self {
        case .allowed:
            question.isEmpty ? String(localized: "Allowed.") : String(format: String(localized: "Allowed: %@"), question)
        case .denied:
            question.isEmpty ? String(localized: "Denied.") : String(format: String(localized: "Denied: %@"), question)
        case let .answered(choice):
            String(format: String(localized: "Answer sent: %@"), choice)
        case .failed:
            String(localized: "Your answer did not go through. Open Sagax to answer.")
        }
    }
}

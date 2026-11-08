import CompanionCore
import UserNotifications

/// APNs `mutable-content` entry point. The system gives this about 30
/// seconds to download the bot's avatar and attach an `INSendMessageIntent`
/// so the banner names the bot instead of Sagax (docs/ios-push.md).
final class NotificationService: UNNotificationServiceExtension {
    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttemptContent: UNMutableNotificationContent?
    private var delivered = false

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        // a lock screen draws no Markdown: a body an older server sent with
        // its table or bold still reads as plain words (PlainText)
        content.body = PlainText.bannerLines(content.body)
        bestAttemptContent = content
        Task {
            let center = UNUserNotificationCenter.current()
            let payload = PushPayload(userInfo: content.userInfo)
            // Answered elsewhere, or expired: the approval's banner leaves this
            // phone and the watch, and this push shows nothing of its own.
            if let payload, payload.kind == .settled {
                await SettledNotifications.withdraw(payload, from: center)
                finish(SettledNotifications.silent)
                return
            }
            // A question's choices are its buttons: their category is made
            // here and registered before the banner shows.
            if let layout = payload?.questionChoicesLayout {
                let category = NotificationCategories.choices(layout, openTitle: NotificationCategories.openTitle())
                await NotificationCategories.register(category, in: center)
                content.categoryIdentifier = category.identifier
            }
            let updated = await CommunicationNotification.decorate(content)
            finish(updated)
        }
    }

    override func serviceExtensionTimeWillExpire() {
        if let bestAttemptContent {
            finish(bestAttemptContent)
        }
    }

    private func finish(_ content: UNNotificationContent) {
        lock.lock()
        defer { lock.unlock() }
        guard !delivered, let handler = contentHandler else { return }
        delivered = true
        handler(content)
        contentHandler = nil
        bestAttemptContent = nil
    }
}

/// The banners a settled push takes down: that request's, wherever they
/// came from (a push or a local banner), on this phone and its watch.
enum SettledNotifications {
    /// Nothing to show: the system shows no banner for empty content.
    static var silent: UNNotificationContent { UNNotificationContent() }

    static func withdraw(_ payload: PushPayload, from center: UNUserNotificationCenter) async {
        let delivered = await center.deliveredNotifications().map { note in
            let info = note.request.content.userInfo
            return DeliveredNotifications.Delivered(
                id: note.request.identifier, botId: info["botId"] as? String,
                threadId: info["threadId"] as? String, date: note.date,
                requestId: info["requestId"] as? String
            )
        }
        let ids = DeliveredNotifications.forRequest(delivered, threadId: payload.threadId, requestId: payload.requestId)
            + [payload.collapseIdentifier]
        center.removeDeliveredNotifications(withIdentifiers: Array(Set(ids)))
    }
}

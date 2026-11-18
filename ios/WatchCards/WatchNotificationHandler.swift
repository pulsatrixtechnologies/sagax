import CompanionCore
import SwiftUI
import UserNotifications
import WatchConnectivity

@MainActor
final class WatchNotificationHandler: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = WatchNotificationHandler()
    @Published var openInbox = false
    @Published var needsPhoneKey = false
    @Published var focusedCard: String?

    func continueOnPhone(bot: String, thread: String, request: String, connectionID: String) {
        #if DEBUG
        if connectionID == DemoServer.connectionID { return }
        #endif
        guard WCSession.isSupported(), WCSession.default.activationState == .activated else { return }
        WCSession.default.transferUserInfo(["watchKeyCard": [
            "botId": bot, "threadId": thread, "requestId": request, "connectionID": connectionID
        ]])
    }

    func install() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        Task {
            let registered = await center.notificationCategories()
            center.setNotificationCategories(NotificationCategories.fixed(NotificationCategories.localizedTitles).union(
                registered.filter { NotificationChoices.isChoicesCategory($0.identifier) }
            ))
        }
    }

    // On forwarded notifications watchOS runs background actions on the
    // original target, the iPhone. Its NotificationApprovalRunner receives
    // Allow, Deny, Reply and the question's own buttons. Foreground actions
    // open on the wrist: show the inbox or identify the required phone key.
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard response.actionIdentifier != UNNotificationDismissActionIdentifier else { return }
        let content = response.notification.request.content
        needsPhoneKey = (response.actionIdentifier == NotificationApproval.allowAction && content.categoryIdentifier == NotificationApproval.keyCategory)
            || (content.userInfo["stepUp"] as? String) == NotificationApproval.stepUpPending
        focusedCard = content.userInfo["cardId"] as? String ?? content.userInfo["requestId"] as? String
        if needsPhoneKey, let bot = content.userInfo["botId"] as? String,
           let thread = content.userInfo["threadId"] as? String,
           let request = content.userInfo["requestId"] as? String,
           let connection = SagaxWatchApp.activeSession.client?.connection {
            continueOnPhone(bot: bot, thread: thread, request: request, connectionID: connection.id)
        }
        openInbox = true
    }
}

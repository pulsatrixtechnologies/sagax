import CompanionCore
import UserNotifications
import WatchConnectivity

extension WatchPairingPublisher {
    // A watch cannot perform the phone's registered security-key ceremony.
    // Continue on the card on the phone; its owner still chooses the answer.
    nonisolated func session(_ session: WCSession, didReceiveUserInfo info: [String: Any]) {
        guard let values = info["watchKeyCard"] as? [String: String],
              let pairing = values["connectionID"], let request = values["requestId"],
              let target = NotificationTarget(payload: values) else { return }
        Task { @MainActor in
            guard let connection = SagaxSharedConnectionStore.loadActiveConnection(), connection.id == pairing,
                  let token = try? SagaxSharedKeychain.token(for: pairing) else { return }
            let entries = try? await WidgetRouteRequest.perform(connection: connection, token: token) { client in
                try await client.waitingItems(botId: target.botId)
            }
            guard let item = entries?.waiting.first(where: { $0.id == request && $0.threadId == target.threadId && $0.botId == target.botId }),
                  SagaxSharedConnectionStore.loadActiveConnection()?.id == pairing else { return }
            let content = UNMutableNotificationContent()
            content.title = item.botName
            content.body = String(localized: "This approval needs your security key. Open Sagax to confirm. Nothing was approved yet.")
            content.categoryIdentifier = NotificationApproval.openCategory
            content.userInfo = ["botId": item.botId, "threadId": item.threadId, "cardId": item.messageId ?? ""]
            let identifier = PushCollapse.identifier(threadId: item.threadId, kind: "approval", requestId: item.id)
            try? await UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
        }
    }
}

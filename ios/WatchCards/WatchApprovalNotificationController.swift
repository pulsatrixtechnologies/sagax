import CompanionCore
import SwiftUI
import UserNotifications

// iOS registers the system buttons. An interactive long look can also
// present the durable choice that only the live card can authorize.
final class WatchApprovalNotificationController: WKUserNotificationHostingController<WatchApprovalNotification> {
    private let model = WatchApprovalContent()
    override class var isInteractive: Bool { true }
    override var body: WatchApprovalNotification {
        WatchApprovalNotification(content: model) { [weak self] in self?.performDismissAction() }
    }

    override func didReceive(_ notification: UNNotification) {
        model.notification = notification.request
    }
}

final class WatchApprovalContent: ObservableObject {
    @Published var notification: UNNotificationRequest?
}

struct WatchApprovalNotification: View {
    @ObservedObject var content: WatchApprovalContent
    @ObservedObject private var session = SagaxWatchApp.activeSession
    let dismiss: () -> Void
    @State private var card: PinnedWaitingEntry?
    @State private var generation: UUID?

    private struct Lookup: Equatable {
        var request: UNNotificationRequest?
        var account: UUID
        var connected: Bool
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let request = content.notification {
                Text(request.content.title).font(.headline)
                Text(request.content.body).font(.footnote)
                if let card, generation == session.identity {
                    WatchWaitingCard(entry: card, session: session, rememberOnly: true) {
                        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [request.identifier])
                        dismiss()
                    }
                }
            }
        }
        .task(id: Lookup(request: content.notification, account: session.identity, connected: session.client != nil)) {
            await resolve()
        }
    }

    @MainActor private func resolve() async {
        card = nil
        guard let info = content.notification?.content.userInfo,
              let thread = info["threadId"] as? String, let request = info["requestId"] as? String,
              let bot = info["botId"] as? String, let client = session.client else { return }
        let original = session.identity
        let identifier = content.notification?.identifier
        guard let payload = try? await WatchWaitingList.read(using: client, botId: bot),
              let found = PinnedWaiting.entries(payload, transcript: { _ in nil }).first(where: {
                  $0.item.botId == bot && $0.threadId == thread && $0.approval?.requestId == request
              }), original == session.identity, identifier == content.notification?.identifier, !Task.isCancelled else { return }
        generation = original
        card = found
    }
}

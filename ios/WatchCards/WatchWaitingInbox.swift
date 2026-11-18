import CompanionCore
import SwiftUI

struct WatchWaitingInbox: View {
    @ObservedObject var session: WatchSession
    var botId: String?
    @ObservedObject private var notifications = WatchNotificationHandler.shared
    @State private var entries: [PinnedWaitingEntry]?
    @State private var errorLine: String?
    @Environment(\.scenePhase) private var phase

    var body: some View {
        ScrollViewReader { reader in
            List {
                if notifications.needsPhoneKey { Text("Use your security key on iPhone to approve.") }
                if let errorLine { Text(errorLine).foregroundStyle(.secondary) }
                if let entries {
                    if entries.isEmpty { Label("All quiet", systemImage: "checkmark.circle") }
                    ForEach(entries) { entry in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(entry.item.botName).font(.caption).foregroundStyle(.secondary)
                            WatchWaitingCard(entry: entry, session: session, onAnswered: reload)
                        }.id(entry.id)
                    }
                } else if errorLine == nil { ProgressView() }
            }
            .navigationTitle("Needs you")
            .onDisappear { notifications.needsPhoneKey = false; notifications.focusedCard = nil }
            .onChange(of: entries, initial: true) { _, current in
                guard let focus = notifications.focusedCard, let card = current?.first(where: { $0.item.messageId == focus || $0.item.id == focus }) else { return }
                reader.scrollTo(card.id, anchor: .top)
            }
            .refreshable { await reload() }
            .task(id: phase) {
                guard phase == .active else { return }
                while !Task.isCancelled {
                    await reload()
                    try? await Task.sleep(for: .seconds(12))
                }
            }
        }
    }

    @MainActor private func reload() async {
        guard let client = session.client else { return }
        let identity = session.identity
        do {
            let result = try await WatchWaitingList.read(using: client, botId: botId)
            guard identity == session.identity, !Task.isCancelled else { return }
            entries = PinnedWaiting.entries(result) { _ in nil }
            errorLine = nil
        } catch {
            guard identity == session.identity, !Task.isCancelled else { return }
            errorLine = String(localized: "Could not load requests.")
            await session.recover(after: error, using: client)
        }
    }
}

struct WatchMessageCard: View {
    let bot: Bot
    let threadId: String
    let message: Message
    @ObservedObject var session: WatchSession
    var onAnswered: () async -> Void

    var body: some View {
        if let entry = PinnedWaitingEntry(message: message, botId: bot.id, botName: bot.name, threadId: threadId) {
            WatchWaitingCard(entry: entry, session: session, onAnswered: onAnswered)
        }
    }
}

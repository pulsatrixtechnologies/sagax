import CompanionCore
import SwiftUI
import WatchKit

@main
@MainActor
struct SagaxWatchApp: App {
    @StateObject private var session: WatchSession

    static let activeSession: WatchSession = {
        #if DEBUG
        if WatchDemo.screen != nil {
            return WatchSession.preview(client: WatchDemo.server.makeClient())
        }
        #endif
        return WatchSession.shared
    }()

    init() {
        _session = StateObject(wrappedValue: Self.activeSession)
        WatchNotificationHandler.shared.install()
    }

    var body: some Scene {
        WindowGroup {
            WatchHome(session: session)
                .id(session.identity)
        }
        WKNotificationScene(controller: WatchApprovalNotificationController.self, category: NotificationApproval.category)
    }
}

#if DEBUG
private enum WatchDemo {
    static var screen: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let option = arguments.firstIndex(of: "-watch-demo"),
              arguments.indices.contains(option + 1) else { return nil }
        return arguments[option + 1]
    }

    static let server = DemoServer(language: DemoLanguage(identifier: Bundle.main.preferredLocalizations.first))
}
#endif

private enum WatchDestination: Hashable {
    case chat(String)
    case waiting
}

private struct WatchHome: View {
    @ObservedObject var session: WatchSession
    @ObservedObject private var notifications = WatchNotificationHandler.shared
    @Environment(\.scenePhase) private var phase
    @State private var path: [WatchDestination] = []
    @State private var bots: [Bot] = []
    @State private var loaded = false
    @State private var failed = false

    var body: some View {
        NavigationStack(path: $path) {
            List {
                if session.client != nil {
                    NavigationLink(value: WatchDestination.waiting) {
                        Label("To answer", systemImage: "tray")
                    }
                    ForEach(bots) { bot in
                        NavigationLink(value: WatchDestination.chat(bot.id)) {
                            HStack(spacing: 8) {
                                MascotCharacterView(bot: bot, size: 32)
                                    .accessibilityHidden(true)
                                VStack(alignment: .leading, spacing: 0) {
                                    Text(verbatim: bot.name)
                                        .font(.headline)
                                    if !bot.title.isEmpty {
                                        Text(verbatim: bot.title)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                    if failed {
                        Label("Couldn’t load your bots.", systemImage: "wifi.exclamationmark")
                        Button("Retry") { Task { await loadBots() } }
                    } else if bots.isEmpty {
                        if loaded { Text("No bots yet.") } else { ProgressView() }
                    }
                } else {
                    Label("Open Sagax on your paired iPhone.", systemImage: "iphone")
                }
            }
            .navigationTitle("Sagax")
            .navigationDestination(for: WatchDestination.self) { destination in
                switch destination {
                case .waiting:
                    WatchWaitingInbox(session: session)
                case .chat(let id):
                    if let bot = bots.first(where: { $0.id == id }) {
                        WatchChat(bot: bot, session: session)
                    }
                }
            }
        }
        .task(id: phase) {
            guard phase == .active else { return }
            session.refresh()
            await loadBots()
            #if DEBUG
            if path.isEmpty {
                if WatchDemo.screen == "chat", let pixel = bots.first(where: { $0.id == "demo-pixel" }) {
                    path = [.chat(pixel.id)]
                } else if WatchDemo.screen == "inbox" { path = [.waiting] }
            }
            #endif
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(30)) } catch { return }
                await loadBots()
            }
        }
        .onOpenURL { url in
            if url == WatchWaitingLink.url { notifications.openInbox = true }
        }
        .onChange(of: notifications.openInbox, initial: true) { _, open in
            guard open, session.client != nil else { return }
            path = [.waiting]
            notifications.openInbox = false
        }
    }

    @MainActor private func loadBots() async {
        guard let client = session.client else { return }
        do {
            async let fleet = client.fleet(messages: 0)
            // The desktop sidecar has no organization viewer. Ownerless and local
            // bots remain visible there, using the same ownership rule as iOS.
            let person = client.connection.serverEnvironmentId == nil ? nil : try await client.authSession().principalId
            let mine = try await OrgJoin.offered(fleet.bots, principalId: person)
            try Task.checkCancellation()
            bots = mine
            failed = false
            loaded = true
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
            await session.recover(after: error, using: client)
        }
    }
}

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

    /// `-watch-demo-scroll <botId>`: the roster opens scrolled to that bot, for a capture.
    static var scrollTo: String? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let option = arguments.firstIndex(of: "-watch-demo-scroll"),
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
    @State private var rows: [WatchBotRow] = []
    @State private var loaded = false
    @State private var failed = false

    var body: some View {
        NavigationStack(path: $path) {
            ScrollViewReader { scroller in
                List {
                    if session.client != nil {
                        NavigationLink(value: WatchDestination.waiting) {
                            Label("To answer", systemImage: "tray")
                        }
                        ForEach(rows) { row in
                            NavigationLink(value: WatchDestination.chat(row.id)) {
                                WatchBotRowView(row: row)
                            }
                        }
                        if failed {
                            Label("Couldn’t load your bots.", systemImage: "wifi.exclamationmark")
                            Button("Retry") { Task { await loadBots() } }
                        } else if rows.isEmpty {
                            if loaded { Text("No bots yet.") } else { ProgressView() }
                        }
                    } else {
                        Label("Open Sagax on your paired iPhone.", systemImage: "iphone")
                    }
                }
                #if DEBUG
                .onChange(of: rows.count) {
                    if let target = WatchDemo.scrollTo, rows.contains(where: { $0.id == target }) { scroller.scrollTo(target, anchor: .top) }
                }
                #endif
            }
            .navigationTitle("Sagax")
            .navigationDestination(for: WatchDestination.self) { destination in
                switch destination {
                case .waiting:
                    WatchWaitingInbox(session: session)
                case .chat(let id):
                    if let bot = rows.first(where: { $0.id == id })?.bot {
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
                if WatchDemo.screen == "chat", let pixel = rows.first(where: { $0.id == "demo-pixel" }) {
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
            // The newest few messages of each bot: its last words, read by
            // the phone's roster rules (WatchRoster).
            async let fleet = client.fleet(messages: WatchRoster.messagesPerBot)
            // The cards waiting on the person, the same list "To answer" shows.
            async let waiting = try? WatchWaitingList.read(using: client)
            // The desktop sidecar has no organization viewer. Ownerless and local
            // bots remain visible there, using the same ownership rule as iOS.
            let person = client.connection.serverEnvironmentId == nil ? nil : try await client.authSession().principalId
            let snapshot = try await fleet
            let mine = OrgJoin.offered(snapshot.bots, principalId: person)
            var transcripts = CompanionState()
            transcripts.hydrate(snapshot)
            let cardBots = Set((await waiting)?.waiting.map(\.botId) ?? [])
            try Task.checkCancellation()
            rows = WatchRoster.rows(mine, transcripts: transcripts, cardBots: cardBots)
            failed = false
            loaded = true
        } catch {
            guard !Task.isCancelled else { return }
            failed = true
            await session.recover(after: error, using: client)
        }
    }
}

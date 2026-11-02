// Details > temporary (attended) remote sessions: only while at least one is
// active, above Routines. Unattended hosts live in the Computer place picker.
import SwiftUI
import CompanionCore

@MainActor
final class BotRemoteSessionsModel: ObservableObject {
    @Published private(set) var temporary: [RemoteSessionView] = []
    @Published private(set) var places: [RemoteHostPlace] = []
    @Published private(set) var catalog: [UnattendedHostRow] = []
    @Published private(set) var attached: [UnattendedHostRow] = []

    private let botId: String
    private var client: CompanionClient?
    private var loop: Task<Void, Never>?

    init(botId: String) { self.botId = botId }

    func start(client: CompanionClient?) {
        self.client = client
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 4_000_000_000)
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    func refresh() async {
        guard let client else { return }
        do {
            async let hosts = client.botRemoteHosts(botId: botId)
            async let sessions = client.botRemoteSessions(botId: botId)
            let answer = try await hosts
            let rows = try await sessions
            attached = answer.hosts
            catalog = answer.catalog
            places = RemoteBotHostsLogic.places(attached: answer.attached, catalog: answer.catalog)
            temporary = RemoteBotHostsLogic.temporarySessions(rows, attachedHosts: answer.hosts)
        } catch {
            // Keep the last list; the next poll retries.
        }
    }

    func attach(hostId: String) async {
        guard let client else { return }
        _ = try? await client.attachBotRemoteHost(botId: botId, hostId: hostId)
        _ = try? await client.openBotRemoteHost(botId: botId, hostId: hostId)
        await refresh()
    }

    func detach(hostId: String) async {
        guard let client else { return }
        _ = try? await client.detachBotRemoteHost(botId: botId, hostId: hostId)
        await refresh()
    }

    func open(hostId: String) async {
        guard let client else { return }
        _ = try? await client.openBotRemoteHost(botId: botId, hostId: hostId)
        await refresh()
    }

    func end(_ view: RemoteSessionView) async {
        guard let client else { return }
        try? await client.closeBotRemoteSession(botId: botId, sessionId: view.id)
        await refresh()
    }

    func openSession(_ view: RemoteSessionView) async {
        guard let client else { return }
        try? await client.focusBotRemoteSession(botId: botId, sessionId: view.id)
    }
}

/// Temporary attended sessions in Details (hidden when empty).
struct BotPanelRemoteSessions: View {
    @Environment(\.desktopTheme) private var theme
    @ObservedObject var model: BotRemoteSessionsModel

    var body: some View {
        if !model.temporary.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "desktopcomputer")
                        .font(.system(size: 16))
                        .foregroundStyle(theme.inkSecondary)
                    Text("Remote sessions")
                        .font(theme.font(13))
                        .foregroundStyle(theme.inkSecondary)
                }
                .accessibilityIdentifier("desktop-panel-remote-sessions-header")

                VStack(spacing: 0) {
                    ForEach(Array(model.temporary.enumerated()), id: \.element.id) { index, row in
                        remoteRow(row)
                        if index < model.temporary.count - 1 {
                            Divider().overlay(theme.hairline50)
                        }
                    }
                }
                .background(theme.card, in: RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: theme.radiusXl, style: .continuous).strokeBorder(theme.hairline50, lineWidth: 1))
            }
            .accessibilityIdentifier("desktop-panel-remote-sessions")
        }
    }

    private func remoteRow(_ view: RemoteSessionView) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: RemoteBotHostsLogic.sessionTitle(view))
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Text(verbatim: subtitle(view))
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button(String(localized: "Open")) {
                Task { await model.openSession(view) }
            }
            .font(theme.font(12.5))
            .accessibilityIdentifier("desktop-panel-remote-open")

            Button(String(localized: "End")) {
                Task { await model.end(view) }
            }
            .font(theme.font(12.5))
            .foregroundStyle(.red)
            .accessibilityIdentifier("desktop-panel-remote-end")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .accessibilityIdentifier("desktop-panel-remote-row")
    }

    private func subtitle(_ view: RemoteSessionView) -> String {
        var parts: [String] = [String(localized: "Connected")]
        if let user = view.user?.trimmingCharacters(in: .whitespacesAndNewlines), !user.isEmpty {
            parts.append(user)
        }
        if let end = view.endAt, let date = ISO8601DateFormatter().date(from: end) {
            let formatter = DateFormatter()
            formatter.timeStyle = .short
            formatter.dateStyle = .none
            parts.append(String(format: String(localized: "Ends at %@"), formatter.string(from: date)))
        }
        return parts.joined(separator: " · ")
    }
}

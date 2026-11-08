// The connection notice at the top of the chat (#2013; CompanionCore
// ConnectionNotice.swift, desktop src/components/ConnectionNotice.tsx):
// the server is updating, the server or the organization's Perspicax
// connector cannot be reached, and "Reconnected" once a notice that showed
// clears. Session feeds the stream's events; this keeps the clock, probes
// the health route every 5 s while the stream is down, watches the device's
// network, and publishes what to show. Never over the composer.
import CompanionCore
import Network
import SwiftUI

@MainActor
final class ConnectionNoticeCenter: ObservableObject {
    static let shared = ConnectionNoticeCenter()

    @Published private(set) var notice: ConnectionNoticeMachine.Notice?

    private var machine = ConnectionNoticeMachine(enabled: ConnectionNoticePrefs.isEnabled())
    private var ticker: Task<Void, Never>?
    private var prober: Task<Void, Never>?
    private let monitor = NWPathMonitor()
    /// The client the health probe asks, set by Session with the stream.
    private weak var session: Session?
    /// `-connection-notice-preview <kind>` (with `-store-preview`): a fixed notice for captures.
    private let preview: ConnectionNoticeMachine.Kind?

    private init() {
        let arguments = ProcessInfo.processInfo.arguments
        if arguments.contains("-store-preview"), let flag = arguments.firstIndex(of: "-connection-notice-preview"),
           arguments.indices.contains(flag + 1) {
            preview = ConnectionNoticeMachine.Kind(rawValue: arguments[flag + 1])
        } else {
            preview = nil
        }
        if let preview {
            notice = .init(kind: preview, occurrence: "preview")
            return
        }
        monitor.pathUpdateHandler = { [weak self] path in
            let offline = path.status != .satisfied
            Task { @MainActor in
                self?.machine.network(offline: offline)
                self?.update()
            }
        }
        monitor.start(queue: DispatchQueue(label: "ca.pulsatrix.sagax.connection-notice"))
    }

    private static var now: Double { Date().timeIntervalSince1970 * 1000 }

    // MARK: Session's events

    func attach(_ session: Session) { self.session = session }

    func streamConnected() {
        machine.streamConnected(at: Self.now)
        update()
        refreshConnectorStatus()
    }

    func streamDisconnected() {
        machine.streamDisconnected(at: Self.now)
        update()
    }

    func restartAnnounced() {
        machine.restartAnnounced(at: Self.now)
        update()
    }

    func connector(_ status: ConnectorStatus) {
        machine.perspicax(unreachable: status.perspicaxUnreachable, since: status.since, at: Self.now)
        update()
    }

    /// Settings > Notifications > Connection notices.
    func setEnabled(_ value: Bool) {
        machine.setEnabled(value)
        update()
    }

    func dismiss() {
        guard let notice else { return }
        if preview != nil { withAnimation { self.notice = nil }; return }
        machine.dismiss(notice)
        update()
    }

    // MARK: Clock and probe

    private func update() {
        guard preview == nil else { return }
        let next = machine.evaluate(now: Self.now)
        if next != notice {
            withAnimation(.snappy(duration: 0.25)) { notice = next }
        }
        if machine.needsTicks {
            if ticker == nil {
                ticker = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: 500_000_000)
                        guard let self else { return }
                        self.update()
                        if !self.machine.needsTicks { break }
                    }
                    self?.ticker = nil
                }
            }
        }
        if machine.probing {
            if prober == nil {
                prober = Task { [weak self] in
                    while !Task.isCancelled {
                        try? await Task.sleep(nanoseconds: UInt64(ConnectionNoticeMachine.probeEverySeconds * 1_000_000_000))
                        guard let self, self.machine.probing else { break }
                        guard let client = self.session?.settingsClient else { continue }
                        let result = await client.connectionHealth()
                        self.machine.probed(result, at: Self.now)
                        self.update()
                    }
                    self?.prober = nil
                }
            }
        } else {
            prober?.cancel()
            prober = nil
        }
    }

    /// The connector's state when the stream opens; the frame follows changes.
    private func refreshConnectorStatus() {
        guard let client = session?.settingsClient else { return }
        Task {
            guard let status = await client.connectorStatus() else { return }
            connector(status)
        }
    }
}

/// The notice itself: the app's banner family (card surface, a hairline and
/// the icon in the tone color, one sentence, an X), reference app style.
struct ConnectionNoticeBanner: View {
    @ObservedObject private var center = ConnectionNoticeCenter.shared

    var body: some View {
        Group {
            if let notice = center.notice {
                ConnectionNoticeCard(kind: notice.kind, close: { center.dismiss() })
                    .padding(.horizontal, 12)
                    .transition(.move(edge: .top).combined(with: .opacity))
            }
        }
    }
}

struct ConnectionNoticeCard: View {
    let kind: ConnectionNoticeMachine.Kind
    let close: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: Self.icon(kind))
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Self.tone(kind))
                .accessibilityHidden(true)
            Text(Self.text(kind))
                .font(.subheadline)
                .foregroundStyle(Theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Close"))
            .accessibilityIdentifier("connection-notice-close")
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .padding(.vertical, 8)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(Self.tone(kind).opacity(0.45), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.08), radius: 8, y: 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("connection-notice-\(kind.rawValue)")
    }

    static func text(_ kind: ConnectionNoticeMachine.Kind) -> String {
        switch kind {
        case .updating: String(localized: "Server update in progress, back in a moment")
        case .serverUnreachable: String(localized: "Sagax can't reach the server, retrying…")
        case .perspicaxUnreachable: String(localized: "Perspicax is unreachable, retrying…")
        case .reconnected: String(localized: "Reconnected")
        }
    }

    static func icon(_ kind: ConnectionNoticeMachine.Kind) -> String {
        switch kind {
        case .updating: "arrow.triangle.2.circlepath"
        case .serverUnreachable, .perspicaxUnreachable: "exclamationmark.triangle"
        case .reconnected: "checkmark.circle"
        }
    }

    static func tone(_ kind: ConnectionNoticeMachine.Kind) -> Color {
        switch kind {
        case .updating: Theme.accent
        case .serverUnreachable, .perspicaxUnreachable: Theme.warning
        case .reconnected: Theme.success
        }
    }
}

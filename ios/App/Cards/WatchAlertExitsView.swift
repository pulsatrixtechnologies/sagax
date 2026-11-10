import CompanionCore
import SwiftUI

/// #3465: the two exits on every alert a chosen watch sends, under its run
/// card in the chat (the desktop's `WatchAlertExits.tsx`, #3457, docs/design
/// 2.16): « Arrêter cette veille » and « Arrêter ce domaine », two quiet
/// links. They act at once, with no confirmation, through
/// `PUT /api/me/proactive` (via "alert"); one grey line then says what
/// stopped, by its label. The bot's owner only.
struct WatchAlertExitsView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.desktopChatText) private var desktop
    let watches: [RoutineRunCard.WatchRef]

    @State private var busy = false
    @State private var failed = false
    @State private var stopped: String?

    private var inkTertiary: Color { desktop?.inkTertiary ?? Theme.textTertiary }

    private func font(_ size: CGFloat) -> Font {
        desktop?.font(size) ?? .system(size: size + 1)
    }

    var body: some View {
        if let stopped {
            Text(verbatim: stopped)
                .font(font(12))
                .foregroundStyle(inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("watch-alert-stopped")
        } else if !watches.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 2) {
                    exit(.watch, String(localized: "Stop this watch"))
                    exit(.domain, String(localized: "Stop this domain"))
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Stop this alert"))
                if failed {
                    Text("Could not save your answer. Check the connection and try again.")
                        .font(font(12))
                        .foregroundStyle(desktop?.danger ?? Theme.danger)
                        .padding(.horizontal, 4)
                }
            }
        }
    }

    private func exit(_ exit: WatchAlertExit, _ label: String) -> some View {
        Button { stop(exit) } label: {
            Text(verbatim: label)
                .font(font(12))
                .foregroundStyle(inkTertiary)
                .padding(.horizontal, 6)
                .frame(minHeight: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .opacity(busy ? 0.55 : 1)
        .accessibilityIdentifier("watch-alert-stop-\(exit.rawValue)")
    }

    private func stop(_ exit: WatchAlertExit) {
        guard !busy, let client = session.profileClient else { return }
        Haptics.selection()
        busy = true
        failed = false
        Task {
            do {
                for change in WatchAlertRules.changes(watches, exit: exit) {
                    try await client.setProactiveChoice(change)
                }
            } catch {
                failed = true
                busy = false
                return
            }
            // the words only: a listing that cannot be read leaves a plain line
            let listed = (try? await client.proactiveReceive())?.receive?.domains ?? []
            let label = WatchAlertRules.stoppedLabel(watches, exit: exit, listed: listed, french: ProactiveReceiveModel.french)
            stopped = WatchAlertRules.stoppedLine(exit, label: label)
            busy = false
        }
    }
}

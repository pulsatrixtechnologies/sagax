// iPad I3: the Inspector (InspectorPanel.tsx), opened by the chat header's
// bug button: 460 wide beside the chat from 1024 pt, over it below. Its top
// bar (bug glyph, "Inspector" 13 medium, a 36 pt close), the Run log /
// Events / Raw switch (inset track, raised selection), then the list.
//
// The phone API has no run log route, so the Run log here is read from the
// conversation the app already holds: each turn's input, its tool steps and
// its recorded reply, with their times. Raw is that transcript as JSON.
// Nothing is fetched or written.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopInspectorPanel: View {
    enum Tab: String, CaseIterable, Identifiable {
        case runLog, events, raw
        var id: String { rawValue }
        var title: LocalizedStringKey {
            switch self {
            case .runLog: "Run Log"
            case .events: "Events"
            case .raw: "Raw"
            }
        }
    }

    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let threadId: String
    let close: () -> Void
    @State private var tab: Tab = .runLog

    /// lucide `bug`.
    static let bug = [
        "m8 2 1.88 1.88", "M14.12 3.88 16 2", "M9 7.13v-1a3.003 3.003 0 1 1 6 0v1",
        "M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6", "M12 20v-9",
        "M6.53 9C4.6 8.8 3 7.1 3 5", "M6 13H2", "M3 21c0-2.1 1.7-3.9 3.8-4", "M20.97 5c0 2.1-1.6 3.8-3.5 4",
        "M22 13h-4", "M17.2 17c2.1.1 3.8 1.9 3.8 4",
    ]

    private var messages: [Message] { session.visibleTranscript(forThread: threadId) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                DesktopLucideGlyph(paths: Self.bug, size: 16)
                    .foregroundStyle(theme.inkSecondary)
                Text("Inspector")
                    .font(theme.font(13, .medium))
                    .foregroundStyle(theme.ink)
                Spacer(minLength: 0)
                DesktopRoundButton(systemImage: "sidebar.right", label: "Close the Inspector", icon: .panelRight, action: close)
                    .keyboardShortcut(.cancelAction)
            }
            .padding(.leading, 16)
            .padding(.trailing, 16)
            .padding(.top, 12)
            .frame(height: 48 + 12, alignment: .top)

            HStack(spacing: 0) {
                ForEach(Tab.allCases) { item in
                    Button { tab = item } label: {
                        Text(item.title)
                            .font(theme.font(12, .medium))
                            .foregroundStyle(tab == item ? theme.ink : theme.inkSecondary)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(tab == item ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(2)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.horizontal, 16)
            .padding(.bottom, 12)
            .accessibilityElement(children: .contain)
            .accessibilityLabel(Text("Inspector views"))

            Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1)

            ScrollView {
                switch tab {
                case .runLog: runLog
                case .events: events
                case .raw: raw
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .overlay(alignment: .leading) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(width: 1) }
        .accessibilityIdentifier("desktop-inspector")
    }

    private struct Entry: Identifiable {
        let id: String
        let icon: String
        let title: String
        let at: Date
    }

    private var entries: [Entry] {
        messages.compactMap { message in
            switch message.kind {
            case .text where message.role == .user:
                Entry(id: message.id, icon: "circle", title: String(localized: "User input"), at: message.date)
            case .text:
                Entry(id: message.id, icon: "checkmark.circle", title: String(localized: "Response recorded"), at: message.date)
            case .activity:
                Entry(id: message.id, icon: "wrench.and.screwdriver", title: message.tool?.name ?? String(localized: "Tool"), at: message.date)
            case .options:
                Entry(id: message.id, icon: "hand.raised", title: message.card?.title ?? String(localized: "Approval"), at: message.date)
            default:
                nil
            }
        }
    }

    private var runLog: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 8) {
                Text("Recorded activity for this conversation. Commands may be shortened; Events and Raw contain the recorded technical details.")
                    .font(theme.font(12))
                    .lineSpacing(6)
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                DesktopActionButton(systemImage: "doc.on.doc", label: "Copy redacted run log") {
                    PlatformBridge.copyToPasteboard(entries.map { "\($0.title)\t\($0.at.formatted(date: .omitted, time: .shortened))" }.joined(separator: "\n"))
                }
            }
            .padding(.vertical, 12)
            ForEach(entries) { entry in
                VStack(spacing: 0) {
                    Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1)
                    HStack(spacing: 8) {
                        Image(systemName: entry.icon)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.inkSecondary)
                            .frame(width: 14, height: 14)
                        Text(verbatim: entry.title)
                            .font(theme.font(12, .medium))
                            .foregroundStyle(theme.ink)
                            .lineLimit(2)
                            .frame(minHeight: 18)
                        Spacer(minLength: 8)
                        Text(entry.at, format: .dateTime.hour().minute())
                            .font(theme.font(12).monospacedDigit())
                            .foregroundStyle(theme.inkSecondary)
                    }
                    .padding(.vertical, 12)
                }
            }
        }
        .padding(.horizontal, 16)
    }

    private var events: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(messages, id: \.id) { message in
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: "\(message.role.rawValue) · \(message.kind.rawValue)")
                        .font(Theme.mono(11))
                        .foregroundStyle(theme.ink)
                    Text(message.date, format: .dateTime.hour().minute().second())
                        .font(theme.font(11))
                        .foregroundStyle(theme.inkSecondary)
                }
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.3)).frame(height: 1) }
            }
        }
        .padding(.horizontal, 16)
    }

    private var raw: some View {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let text = (try? encoder.encode(messages)).flatMap { String(data: $0, encoding: .utf8) } ?? ""
        return Text(verbatim: text)
            .font(Theme.mono(10.5))
            .foregroundStyle(theme.inkSecondary)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
    }
}

// The whole of one permission ask, opened from the approval dock's title
// (the reference design's command approval sheet): a close button, the
// question ("Allow <bot> to run a command?"), its state (waiting, then
// "Allowed once" in green or "Denied" in red once answered here), the
// plain line in a card, where it runs, and the command in a monospace
// block that scrolls. While it waits, Deny and Allow once answer it exactly
// as the dock's buttons do (`Session.decide`); every other choice (Always
// allow, Cancel turn, the stepper) stays on the dock.
import CompanionCore
import SwiftUI

struct ApprovalDetailSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let chat: Chat
    let pending: PendingApproval

    private enum Outcome { case allowed, denied }

    @State private var outcome: Outcome?
    @State private var answering = false

    private var card: OptionCard { pending.card }
    private var botName: String { pending.message.from?.name ?? chat.name }
    private var action: ApprovalToolAction {
        if case let .wantsTo(action) = ApprovalHeading.of(card) { return action }
        return .useTool
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close", glyphSize: 16) { dismiss() }
                    .chatGlassRim(Circle())
                    .accessibilityIdentifier("approval-detail-close")
                    .padding(.bottom, 28)

                Text(verbatim: title)
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("approval-detail-title")
                status
                    .padding(.top, 6)

                if let line = description {
                    Text(verbatim: line)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(Theme.Profile.textInset)
                        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
                        .padding(.top, 22)
                        .accessibilityIdentifier("approval-detail-description")
                }

                HStack(spacing: 12) {
                    Text("Runs on")
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textPrimary)
                    Spacer(minLength: 12)
                    Text(verbatim: place)
                        .font(Theme.Font.body)
                        .foregroundStyle(Theme.textSecondary)
                        .lineLimit(1)
                }
                .padding(.horizontal, Theme.Profile.textInset)
                .frame(height: Theme.Profile.toggleRow)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
                .padding(.top, 16)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("approval-detail-place")

                if let detail = ApprovalHeading.detail(card) {
                    Text(action == .runCommand ? LocalizedStringKey("Command") : LocalizedStringKey("Details"))
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.textTertiary)
                        .padding(.leading, Theme.Profile.textInset)
                        .padding(.top, 28)
                        .padding(.bottom, 8)
                    ScrollView(.vertical) {
                        Text(verbatim: detail)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundStyle(Theme.textSecondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .frame(maxHeight: 220)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(Theme.Profile.textInset)
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
                    .accessibilityIdentifier("approval-detail-command")
                }

                if outcome == nil, card.isPending, card.adminApproval != true {
                    buttons.padding(.top, 28)
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 20)
            .padding(.bottom, 32)
        }
        .background(Theme.bg.ignoresSafeArea())
        .presentationDragIndicator(.hidden)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("approval-detail")
    }

    // MARK: Parts

    /// The server's plain question in English, else "Allow <bot> to run a
    /// command?" in the phone's language.
    private var title: String {
        ApprovalHeading.plainTitle(card)
            ?? String(localized: "Allow \(botName) to \(ApprovalDock.phrase(action))?")
    }

    private var description: String? {
        if let line = ApprovalHeading.plainLine(card) { return line }
        let text = card.title.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || text == title ? nil : text
    }

    /// A member's server command runs on the server; the rest on the
    /// bot's own computer, named after the bot.
    private var place: String {
        card.adminApproval == true ? String(localized: "The server") : String(localized: "\(botName)'s computer")
    }

    @ViewBuilder
    private var status: some View {
        switch outcome {
        case .allowed:
            Text("Allowed once").foregroundStyle(Theme.success)
                .font(Theme.Font.body)
                .accessibilityIdentifier("approval-detail-status")
        case .denied:
            Text("Denied").foregroundStyle(Theme.destructive)
                .font(Theme.Font.body)
                .accessibilityIdentifier("approval-detail-status")
        case nil:
            Text("Waiting for you").foregroundStyle(Theme.textSecondary)
                .font(Theme.Font.body)
                .accessibilityIdentifier("approval-detail-status")
        }
    }

    private var buttons: some View {
        HStack(spacing: 10) {
            answer(String(localized: "Deny"), primary: false, id: "approval-detail-deny") {
                await session.decide(.deny, on: pending, in: chat)
                outcome = .denied
            }
            answer(String(localized: "Allow once"), primary: true, id: "approval-detail-allow") {
                await session.decide(.allowOnce, on: pending, in: chat)
                outcome = .allowed
            }
        }
    }

    private func answer(_ label: String, primary: Bool, id: String, _ action: @escaping () async -> Void) -> some View {
        Button {
            Haptics.selection()
            answering = true
            Task {
                await action()
                answering = false
            }
        } label: {
            Text(verbatim: label)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(primary ? Theme.accentInk : Theme.textPrimary)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .background(Capsule().fill(primary ? Theme.accent : Theme.cardRaised))
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(answering)
        .accessibilityIdentifier(id)
    }
}

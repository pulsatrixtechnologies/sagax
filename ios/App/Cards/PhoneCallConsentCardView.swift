// One-time acceptable-use consent before a bot may place phone calls
// (PhoneCallConsentCard.tsx). Same Ask card chrome as other options asks;
// Accept/Decline go through answerCard (session.answer) like meetings.
import CompanionCore
import SwiftUI

struct PhoneCallConsentCardView: View {
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message
    let accent: Color
    @Environment(\.desktopChatText) private var desktop
    @State private var busy: Bool?
    @State private var answeredLocally: String?

    private var card: OptionCard? { message.card }
    private var data: PhoneCallConsentCardData? { card?.phoneCallConsent }
    private var pending: Bool {
        guard let card, let data else { return false }
        return card.answered == nil && answeredLocally == nil && data.status == "pending"
    }

    var body: some View {
        let ink = ApprovalInk.of(desktop, accent: desktop?.accent ?? accent)
        if let data {
            if pending {
                pendingCard(data, ink)
            } else {
                settledLine(data, ink)
            }
        }
    }

    private func pendingCard(_ data: PhoneCallConsentCardData, _ ink: ApprovalInk) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "phone").font(.system(size: 12, weight: .medium))
                Text("Allow phone calls for your bots").lineLimit(2)
                Spacer(minLength: 8)
            }
            .font(ink.font(12, .regular))
            .foregroundStyle(ink.secondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(ink.inset.opacity(0.6))

            VStack(alignment: .leading, spacing: 10) {
                Text("Before your bots can place calls for you, confirm you accept these rules.")
                    .font(ink.font(13, .regular))
                    .foregroundStyle(ink.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(alignment: .leading, spacing: 6) {
                    bullet("Only lawful calls to people who agreed to hear from you or your organization.", ink)
                    bullet("No marketing blasts, no mass dialing, no emergency numbers (911 and the like).", ink)
                    bullet("You are responsible for how your bots use your phone line.", ink)
                }
                HStack(spacing: 8) {
                    Button { answer(true) } label: {
                        HStack(spacing: 6) {
                            if busy == true { ProgressView().controlSize(.mini).tint(.white) }
                            Text("Accept")
                        }
                        .font(ink.font(13, .medium))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(ink.accent, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                    .disabled(busy != nil)
                    .opacity(busy != nil ? 0.4 : 1)
                    .accessibilityIdentifier("phone-call-consent-accept")
                    Button { answer(false) } label: {
                        HStack(spacing: 6) {
                            if busy == false { ProgressView().controlSize(.mini) }
                            Text("Decline")
                        }
                        .font(ink.font(13, .regular))
                        .foregroundStyle(ink.ink)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(ink.hairline.opacity(0.6), lineWidth: 1))
                    }
                    .disabled(busy != nil)
                    .opacity(busy != nil ? 0.4 : 1)
                    .accessibilityIdentifier("phone-call-consent-decline")
                }
                .buttonStyle(.plain)
            }
            .padding(12)
        }
        .frame(maxWidth: 560, alignment: .leading)
        .background(desktop?.panel ?? Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(ink.hairline.opacity(0.4), lineWidth: 1))
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("phone-call-consent-\(data.status)")
    }

    private func settledLine(_ data: PhoneCallConsentCardData, _ ink: ApprovalInk) -> some View {
        let accepted = data.isAccepted || answeredLocally == "Accept"
        return Label(
            accepted
                ? String(localized: "Phone calls allowed for your bots.")
                : String(localized: "Phone calls not allowed."),
            systemImage: accepted ? "checkmark.circle" : "xmark.circle"
        )
        .font(ink.font(13, .regular))
        .foregroundStyle(ink.secondary)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("phone-call-consent-\(accepted ? "accepted" : "declined")")
    }

    private func bullet(_ text: LocalizedStringKey, _ ink: ApprovalInk) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(verbatim: "•").foregroundStyle(ink.secondary)
            Text(text).fixedSize(horizontal: false, vertical: true)
        }
        .font(ink.font(13, .regular))
        .foregroundStyle(ink.ink)
    }

    private func answer(_ allow: Bool) {
        guard let card else { return }
        Haptics.selection()
        busy = allow
        let choice = allow ? PhoneCallConsentRules.approveLabels[0] : PhoneCallConsentRules.declineLabels[0]
        Task {
            await session.answer(chat: chat, card: card, choice: choice, rememberingPermission: false)
            answeredLocally = choice
            busy = nil
        }
    }
}

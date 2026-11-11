import CompanionCore
import SwiftUI

/// #3465 (lot 8 of #3408): the choice card a bot posts when one watch
/// domain fits the person (propose_proactive), on the phone and the tablet.
/// The desktop's `ProactiveChoiceCard.tsx` (#3457, docs/design 2.10): the
/// compact ask surface with a bell, the title, one or two plain lines,
/// « Pas maintenant » as a neutral pill and « Oui » in the accent, the
/// « Ne plus proposer » row on the left (no thumbs). Folded details list
/// each watch with its cadence, its switch and the read-only tools it uses,
/// in words. The yes keeps the switches as they are; a yes with every
/// switch off cannot be sent. Answered, it folds to one quiet row.
struct ProactiveChoiceCardView: View {
    @EnvironmentObject private var session: Session
    @Environment(\.desktopChatText) private var desktop
    let chat: Chat
    let message: Message

    @State private var open = false
    @State private var switches: [String: Bool] = [:]
    @State private var answering = false
    /// The answer sent, held until the server marks the card.
    @State private var sent: String?
    /// « Ne plus proposer » sent, before the server marks the card.
    @State private var saidNever = false
    @State private var neverFailed = false
    @State private var receiptOpen = false

    static func draws(_ card: OptionCard) -> Bool { ProactiveProposalRules.isChoice(card) }

    private var ink: Color { desktop?.ink ?? Theme.textPrimary }
    private var inkSecondary: Color { desktop?.inkSecondary ?? Theme.textSecondary }
    private var inkTertiary: Color { desktop?.inkTertiary ?? Theme.textTertiary }
    private var accent: Color { desktop?.accent ?? Theme.accent }
    private var accentInk: Color { desktop?.accentInk ?? Theme.accentInk }
    private var success: Color { desktop?.success ?? Theme.success }
    private var hairline: Color { desktop?.hairline ?? Theme.hairline }
    private var inset: Color { desktop?.inset ?? Theme.inset }

    private func font(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
        desktop?.font(size, weight) ?? .system(size: size + 1, weight: weight)
    }

    var body: some View {
        if let card = message.card, let choice = card.proactiveChoice {
            if ProactiveProposalRules.isFolded(card) || sent != nil {
                receipt(card, choice)
            } else {
                pending(card, choice)
            }
        }
    }

    // MARK: Pending

    private func pending(_ card: OptionCard, _ choice: ProactiveChoiceCardData) -> some View {
        let yes = card.options.first ?? ""
        let notNow = card.options.dropFirst().first ?? ""
        let canYes = ProactiveProposalRules.canSayYes(card, switches: switches)
        let never = saidNever || ProactiveProposalRules.saidNever(card)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "bell.badge")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(inkSecondary)
                    .frame(width: 18, height: 20)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: card.title)
                        .font(font(15, .semibold))
                        .foregroundStyle(ink)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityAddTraits(.isHeader)
                    if !card.subtitle.isEmpty {
                        Text(verbatim: card.subtitle)
                            .font(font(13))
                            .foregroundStyle(inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            if !choice.watches.isEmpty {
                Button {
                    Haptics.selection()
                    withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 11, weight: .semibold))
                            .rotationEffect(.degrees(open ? 0 : -90))
                        Text(open ? String(localized: "Hide the watches") : String(localized: "Watches and tools"))
                            .font(font(12.5))
                    }
                    .foregroundStyle(inkSecondary)
                    .frame(minHeight: 28)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 6)
                .accessibilityIdentifier("proactive-choice-details")
                if open {
                    ProactiveChoiceWatchList(
                        watches: choice.watches, switches: $switches, editable: !answering,
                        ink: ink, inkSecondary: inkSecondary, success: success, inset: inset, hairline: hairline, font: font
                    )
                }
            }
            HStack(alignment: .center, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Button { sayNever(card) } label: {
                        Text(verbatim: ProactiveProposalRules.neverLabel)
                            .font(font(12.5))
                            .fixedSize(horizontal: false, vertical: true)
                            .foregroundStyle(never ? accent : inkTertiary)
                            .padding(.horizontal, 6)
                            .frame(minHeight: 30)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(answering || never)
                    .accessibilityAddTraits(never ? .isSelected : [])
                    .accessibilityIdentifier("proactive-never-\(message.id)")
                }
                Spacer(minLength: 4)
                Button { answer(card, notNow) } label: {
                    Text(verbatim: notNow)
                        .font(font(13, .medium))
                        // the two pills keep their words on one line (« Pas maintenant »)
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(ink)
                        .padding(.horizontal, 14)
                        .frame(minHeight: 32)
                        .background(Capsule().fill(ink.opacity(0.06)))
                        .overlay(Capsule().strokeBorder(hairline, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(answering || notNow.isEmpty)
                .accessibilityIdentifier("proactive-not-now-\(message.id)")
                Button { answer(card, yes) } label: {
                    Text(verbatim: yes)
                        .font(font(13, .semibold))
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(accentInk)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 32)
                        .background(Capsule().fill(accent))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(answering || !canYes || yes.isEmpty)
                .opacity(canYes ? 1 : 0.45)
                .accessibilityIdentifier("proactive-yes-\(message.id)")
            }
            .padding(.top, 10)
            if never {
                Text("Noted: this will not be suggested again.")
                    .font(font(12))
                    .foregroundStyle(inkTertiary)
                    .padding(.horizontal, 6)
                    .padding(.top, 2)
            } else if neverFailed {
                Text("Could not save your answer. Check the connection and try again.")
                    .font(font(12))
                    .foregroundStyle(desktop?.danger ?? Theme.danger)
                    .padding(.horizontal, 6)
                    .padding(.top, 2)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(desktop?.composer ?? Theme.card)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(desktop?.composerRing ?? Theme.hairline, lineWidth: 1)
        )
        .frame(maxWidth: desktop == nil ? .infinity : 600, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: card.title))
        .accessibilityIdentifier("proactive-choice-\(message.id)")
    }

    // MARK: Answered

    private func receipt(_ card: OptionCard, _ choice: ProactiveChoiceCardData) -> some View {
        let accepted = sent.map { ProactiveProposalRules.accepts(card, answer: $0) } ?? ProactiveProposalRules.receiptAccepted(card)
        let said = card.expired == true ? String(localized: "Closed without an answer") : (card.answeredText ?? card.answered ?? sent ?? "")
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                Haptics.selection()
                receiptOpen.toggle()
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: accepted ? "checkmark" : "xmark")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(accepted ? success : inkTertiary)
                    Text(verbatim: said)
                        .font(font(12.5))
                        .foregroundStyle(inkSecondary)
                    if !choice.label.isEmpty {
                        Text(verbatim: choice.label)
                            .font(font(12.5))
                            .foregroundStyle(inkTertiary)
                            .lineLimit(1)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(inkTertiary)
                        .rotationEffect(.degrees(receiptOpen ? 90 : 0))
                }
                .frame(minHeight: 28)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("proactive-choice-receipt-\(message.id)")
            if receiptOpen {
                VStack(alignment: .leading, spacing: 2) {
                    Text(verbatim: card.title).font(font(12.5)).foregroundStyle(ink)
                    if !card.subtitle.isEmpty {
                        Text(verbatim: card.subtitle).font(font(12.5)).foregroundStyle(inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !choice.watches.isEmpty {
                        ProactiveChoiceWatchList(
                            watches: choice.watches, switches: .constant([:]), editable: false, showsSwitches: false,
                            ink: ink, inkSecondary: inkSecondary, success: success, inset: inset, hairline: hairline, font: font
                        )
                    }
                }
                .padding(.leading, 17)
            }
        }
        .frame(maxWidth: desktop == nil ? .infinity : 600, alignment: .leading)
    }

    // MARK: Answers

    private func answer(_ card: OptionCard, _ option: String) {
        guard !answering, sent == nil, !option.isEmpty else { return }
        if ProactiveProposalRules.accepts(card, answer: option), !ProactiveProposalRules.canSayYes(card, switches: switches) { return }
        Haptics.selection()
        sent = option
        answering = true
        Task {
            // #3465: the server kept nothing, so the card comes back to try again
            let kept = await session.answer(chat: chat, card: card, choice: option, watchSwitches: switches)
            sent = ProactiveProposalRules.heldAnswer(option, kept: kept)
            answering = false
        }
    }

    private func sayNever(_ card: OptionCard) {
        guard !answering, !saidNever, !ProactiveProposalRules.saidNever(card) else { return }
        Haptics.selection()
        answering = true
        neverFailed = false
        Task {
            let done = await session.answerProactiveNever(chat: chat, card: card)
            saidNever = done
            neverFailed = !done
            answering = false
        }
    }
}

/// Each watch of the domain: its label, how often, and the tools it reads
/// with; open on a pending card, its switch.
struct ProactiveChoiceWatchList: View {
    let watches: [ProactiveChoiceCardData.Watch]
    @Binding var switches: [String: Bool]
    var editable = true
    var showsSwitches = true
    let ink: Color
    let inkSecondary: Color
    let success: Color
    let inset: Color
    let hairline: Color
    let font: (CGFloat, Font.Weight) -> Font

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(watches.enumerated()), id: \.element.id) { index, watch in
                if index > 0 { Rectangle().fill(hairline.opacity(0.4)).frame(height: 1) }
                HStack(alignment: .top, spacing: 12) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text(verbatim: watch.label)
                            .font(font(13, .regular))
                            .foregroundStyle(ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if !watch.cadence.isEmpty {
                            Text(verbatim: watch.cadence).font(font(12, .regular)).foregroundStyle(inkSecondary)
                        }
                        tools(watch)
                    }
                    Spacer(minLength: 0)
                    if showsSwitches {
                        Toggle(isOn: Binding(
                            get: { switches[watch.id] ?? watch.on },
                            set: { switches[watch.id] = $0 }
                        )) { Text(verbatim: watch.label) }
                        .labelsHidden()
                        .tint(Theme.toggleOn)
                        .disabled(!editable)
                        .accessibilityIdentifier("proactive-watch-\(watch.id)")
                    }
                }
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 12)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(inset))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(hairline.opacity(0.4), lineWidth: 1))
        .padding(.top, 6)
    }

    @ViewBuilder
    private func tools(_ watch: ProactiveChoiceCardData.Watch) -> some View {
        let words = StepWords.app
        let labels = watch.tools.map { ProactiveProposalRules.toolWords($0, words: words) }.filter { !$0.isEmpty }
            .reduce(into: [String]()) { if !$0.contains($1) { $0.append($1) } }
        if !labels.isEmpty {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Label(DesktopApprovalText.riskLabel(.read), systemImage: "eye")
                    .labelStyle(.titleAndIcon)
                    .font(font(11, .medium))
                    .foregroundStyle(success)
                Text(verbatim: "·").font(font(12, .regular)).foregroundStyle(inkSecondary).accessibilityHidden(true)
                Text(verbatim: labels.joined(separator: ", "))
                    .font(font(12, .regular))
                    .foregroundStyle(inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.top, 2)
            .accessibilityHint(Text(verbatim: watch.tools.joined(separator: ", ")))
        }
    }
}

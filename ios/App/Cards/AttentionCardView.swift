import CompanionCore
import SwiftUI

/// What a bot's turn elsewhere left for the person (2026-11-05): a
/// hand-off, a thread another bot opened or a routine run ended with items
/// only the person can do. The desktop's `src/components/AttentionCard.tsx`,
/// for a phone: who needs you, where it came from, each item with its
/// ticket, and Open ticket, Open thread and Open run.
struct AttentionCardView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let card: PersonAttentionCard
    let tint: Color
    var openThread: ((ThreadRef) -> Void)? = nil
    var openRun: (() -> Void)? = nil

    private var title: String {
        switch card.kind {
        case "question": String(localized: "\(card.botName) has a question for you")
        case "failure": String(localized: "\(card.botName) needs a decision")
        default: String(localized: "\(card.botName) needs you")
        }
    }

    private var origin: String {
        if let routine = card.routineName, !routine.isEmpty { return String(localized: "From the routine \(routine)") }
        if let opener = card.openedBy { return String(localized: "From work \(opener.name) handed over") }
        return String(localized: "From \(card.threadTitle ?? card.botName)")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Theme.warning)
                    Text(verbatim: title)
                        .font(.system(size: 15, weight: .semibold))
                        .lineLimit(2)
                    Spacer(minLength: 4)
                }
                Text(verbatim: origin)
                    .font(.system(size: 12))
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
            }
            .accessibilityElement(children: .combine)

            AttentionItemsView(items: card.items)

            HStack(spacing: 14) {
                if let openThread {
                    Button {
                        Haptics.selection()
                        openThread(card.threadRef)
                    } label: {
                        Label(String(localized: "Open thread"), systemImage: "arrow.right")
                    }
                    .accessibilityIdentifier("attention-open-thread")
                }
                if card.routineRunId != nil, let openRun {
                    Button {
                        Haptics.selection()
                        openRun()
                    } label: {
                        Label(String(localized: "Open run"), systemImage: "arrow.right")
                    }
                    .accessibilityIdentifier("attention-open-run")
                }
            }
            .labelStyle(.titleAndIcon)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(Theme.readable(tint))
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(Theme.card))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(Theme.warning.opacity(0.4), lineWidth: 1))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("attention-card")
    }
}

/// The items, each with its ticket (shared with the routine run row).
struct AttentionItemsView: View {
    @Environment(\.openURL) private var openURL
    let items: [PersonAttentionItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 6) {
                    Text(LocalizedStringKey(item.text))
                        .font(.system(size: 14.5))
                        .foregroundStyle(Theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let ticket = item.ticketId {
                        if let url = item.safeTicketURL {
                            Button {
                                Haptics.selection()
                                openURL(url)
                            } label: {
                                Label(String(localized: "Open ticket \(String(ticket))"), systemImage: "arrow.up.right.square")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                            .buttonStyle(.plain)
                            .foregroundStyle(Theme.warning)
                            .accessibilityIdentifier("attention-ticket-\(ticket)")
                        } else {
                            Text(verbatim: "#\(ticket)")
                                .font(.system(size: 12, weight: .medium).monospacedDigit())
                                .foregroundStyle(Theme.textSecondary)
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(Theme.warning.opacity(0.08)))
            }
        }
    }
}

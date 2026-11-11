// #3471 on the phone and the tablet: the one quiet control that skips a
// waiting card, at the same place on every kind (the end of the card's top
// row, in the chat and on the card pinned over the composer), and the one
// quiet line a card closed without an answer folds into. The desktop's
// `CardCloseButton` (src/components/AskCard.tsx) and `waitingCard.*` words.
import CompanionCore
import SwiftUI

enum WaitingCardWords {
    /// The control's label and hint ("Passer sans répondre").
    static var skip: String { String(localized: "waitingCard.skipAria", defaultValue: "Skip this without answering") }

    /// The folded line of a card closed without an answer.
    static func fold(_ fold: WaitingCardSkip.Fold) -> String {
        switch fold {
        case .skipped: String(localized: "waitingCard.skipped", defaultValue: "Skipped, no answer")
        case .expired: String(localized: "waitingCard.expired", defaultValue: "Expired, no answer")
        case .defaulted: String(localized: "waitingCard.defaulted", defaultValue: "No answer from you in time: the default answer was used.")
        }
    }
}

/// The quiet × at the end of a waiting card's top row: 28 pt, tertiary ink,
/// never a filled button. A tap skips the card (never a refusal).
struct CardSkipButton: View {
    let ink: Color
    var disabled = false
    let id: String
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(ink)
                .frame(width: 28, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .disabled(disabled)
        .accessibilityLabel(Text(verbatim: WaitingCardWords.skip))
        .accessibilityIdentifier("card-skip-\(id)")
    }
}

/// "Skipped, no answer" or "Expired, no answer": one quiet line with a
/// small ×, the way an answered card folds into one row.
struct WaitingCardFoldLine: View {
    let fold: WaitingCardSkip.Fold
    let ink: Color
    var size: CGFloat = 13
    let id: String

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "xmark")
                .font(.system(size: size - 2, weight: .semibold))
            Text(verbatim: WaitingCardWords.fold(fold))
                .font(.system(size: size))
        }
        .foregroundStyle(ink)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("card-fold-\(id)")
    }
}

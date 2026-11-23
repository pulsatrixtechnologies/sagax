import CompanionCore
import SwiftUI

/// The structured facts of a bot's question (`OptionCard.facts`): a compact
/// two-column table, a quiet label on the left and its value on the right,
/// above the card's sentence (`src/components/AskFactsTable.tsx`, in SwiftUI).
/// A long value wraps. A value that carries a record (a ticket number) is the
/// record's chip: the accent over the quiet tint, a tap opens its card.
struct AskFactsTableView: View {
    let colors: QuestionSheetColors
    let facts: [AskFact]
    @EnvironmentObject private var session: Session
    @Environment(\.recordAsk) private var recordAsk
    @State private var sheet: RecordSheetItem?

    var body: some View {
        let rows = AskFact.shown(facts)
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(rows.enumerated()), id: \.offset) { _, fact in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(fact.label)
                            .font(colors.font(12))
                            .foregroundStyle(colors.inkSecondary)
                            .frame(width: 84, alignment: .leading)
                            .fixedSize(horizontal: false, vertical: true)
                        value(fact)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("ask-facts")
            .sheet(item: $sheet) { item in
                RecordCardSheet(start: item)
                    .environmentObject(session)
                    .environment(\.recordAsk, recordAsk)
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
            }
        }
    }

    @ViewBuilder
    private func value(_ fact: AskFact) -> some View {
        if let ref = fact.record {
            Button {
                Haptics.selection()
                sheet = RecordSheetItem(ref: ref, label: fact.value)
            } label: {
                Text(fact.value)
                    .font(colors.font(13))
                    .foregroundStyle(Theme.blue)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Theme.inset, in: RoundedRectangle(cornerRadius: 6))
            }
            .buttonStyle(.plain)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(fact.value)
                .font(colors.font(13))
                .foregroundStyle(colors.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

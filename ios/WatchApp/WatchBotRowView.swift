import CompanionCore
import SwiftUI

/// One bot in the watch's list (#5128): its mascot and name, its role, its
/// state and its last message, as WatchRoster reads them.
struct WatchBotRowView: View {
    let row: WatchBotRow

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            MascotCharacterView(bot: row.bot, size: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(verbatim: row.bot.name)
                        .font(.headline)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if let time {
                        Text(verbatim: time)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                            .layoutPriority(1)
                    }
                }
                if !row.bot.title.isEmpty {
                    Text(verbatim: row.bot.title)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                stateLine
                if !row.preview.isEmpty {
                    Text(verbatim: row.preview)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    private var stateLine: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol)
                .imageScale(.small)
                .accessibilityHidden(true)
            Text(label)
        }
        .font(.caption2)
        .foregroundStyle(tint)
        .lineLimit(1)
    }

    private var symbol: String {
        switch row.state {
        case .working: "ellipsis.circle.fill"
        case .cardToAnswer: "hand.raised.fill"
        case .standingBy: "moon.zzz"
        }
    }

    private var label: LocalizedStringKey {
        switch row.state {
        case .working: "Working"
        case .cardToAnswer: "Card to answer"
        case .standingBy: "Standing by"
        }
    }

    private var tint: Color {
        switch row.state {
        case .working: .green
        case .cardToAnswer: .orange
        case .standingBy: .secondary
        }
    }

    /// When the conversation last moved: the time today, else the day.
    private var time: String? {
        guard let at = row.lastAt, at > 0 else { return nil }
        let date = Date(timeIntervalSince1970: at / 1000)
        if Calendar.current.isDateInToday(date) { return date.formatted(date: .omitted, time: .shortened) }
        return date.formatted(.dateTime.day().month(.abbreviated))
    }
}

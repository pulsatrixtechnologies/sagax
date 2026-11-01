// The bot panel's Grok Bot parts (2026-11-01): the three tabs under the
// name, the Computer tab's asleep and waking card, and how many routines
// Details lists before "Show all".
import CompanionCore
import SwiftUI

enum PanelRoutinePreview {
    /// Routines listed in Details; the rest wait behind "Show all".
    static let limit = 6
}

/// Details, Library and Computer as Grok Bot draws them: centred labels,
/// the selected one on a quiet capsule.
struct PanelTabBar: View {
    @Environment(\.themePalette) var themePalette
    let tabs: [DesktopPanelTab]
    @Binding var selected: DesktopPanelTab

    var body: some View {
        HStack(spacing: 4) {
            ForEach(tabs, id: \.self) { tab in
                let on = tab == selected
                Button {
                    Haptics.selection()
                    withAnimation(.snappy(duration: 0.2)) { selected = tab }
                } label: {
                    Text(Self.title(tab))
                        .font(Theme.Font.body)
                        .foregroundStyle(on ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(Capsule().fill(on ? Theme.cardRaised : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("panel-tab.\(tab.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-tabs")
    }

    static func title(_ tab: DesktopPanelTab) -> LocalizedStringKey {
        switch tab {
        case .details: "Details"
        case .library: "Library"
        case .computer: "Computer"
        }
    }
}

/// The Computer tab while nothing runs: the bot's own mascot asleep with
/// its "z Z", "Waking up..." once woken, or no computer at all. The live
/// screen replaces the card once the computer runs.
struct BotComputerSleepCard: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    let phase: BotComputerPhase
    let wake: () -> Void
    let open: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .topTrailing) {
                BotMascotView(bot: bot, size: 56, state: phase == .waking ? .waking : .sleeping, animated: phase == .waking)
                    .frame(width: 56, height: 56)
                if phase == .asleep {
                    SleepingZs()
                        .offset(x: 16, y: -12)
                }
            }
            .frame(width: 80, height: 64)
            .accessibilityHidden(true)

            Group {
                switch phase {
                case .waking:
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Waking up…")
                    }
                case .off:
                    Text("No computer for this bot")
                default:
                    Text("Computer is asleep")
                }
            }
            .font(Theme.Font.bodyMedium)
            .foregroundStyle(Theme.textPrimary)
            .accessibilityIdentifier("panel-computer-state")

            if phase == .asleep {
                HStack(spacing: 10) {
                    Button {
                        Haptics.selection()
                        wake()
                    } label: {
                        Text("Wake up")
                            .font(Theme.Font.bodyMedium)
                            .foregroundStyle(Theme.primaryInk)
                            .padding(.horizontal, 18)
                            .frame(height: 36)
                            .background(Theme.primaryFill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("panel-computer-wake")
                    Button {
                        Haptics.selection()
                        open()
                    } label: {
                        Text("Open")
                            .font(Theme.Font.bodyMedium)
                            .foregroundStyle(Theme.textPrimary)
                            .padding(.horizontal, 18)
                            .frame(height: 36)
                            .background(Theme.cardRaised, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("panel-computer-open")
                }
                .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 220)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .padding(.horizontal, Theme.Profile.cardMargin)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-computer-\(phase.rawValue)")
    }
}

/// Grok Bot's small "z Z" over a sleeping mascot.
struct SleepingZs: View {
    @Environment(\.themePalette) var themePalette

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            Text(verbatim: "z")
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .offset(x: 0, y: 0)
            Text(verbatim: "Z")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .offset(x: 7, y: -9)
        }
        .foregroundStyle(Theme.textSecondary)
        .frame(width: 22, height: 22, alignment: .bottomLeading)
        .accessibilityHidden(true)
    }
}

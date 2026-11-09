// The bot panel's reference app parts (2026-11-01). Phone Lot 4 replaced the
// three tabs with overview rows; PanelTabBar and BotComputerSleepCard stay
// for older shots and for any surface that still embeds the sleep card.
import CompanionCore
import SwiftUI

enum PanelRoutinePreview {
    /// Routines listed in Upcoming before "Show more" (reference app, #2127).
    static let limit = 5
}

/// Activity and Library as centred labels on a quiet capsule (reference app).
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
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(Capsule().fill(on ? Theme.cardRaised : Color.clear))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("panel-tab.\(tab.rawValue)")
            }
        }
        .padding(4)
        .background(Theme.card.opacity(0.55), in: Capsule())
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-tabs")
    }

    static func title(_ tab: DesktopPanelTab) -> LocalizedStringKey {
        switch tab {
        case .activity: "Activity"
        case .library: "Library"
        case .computer: "Computer"
        case .coding: "Coding"
        }
    }
}

/// The Computer tab while nothing runs: a generic muted bot glyph asleep with
/// its "z Z", "Waking up..." once woken, or no computer at all. The live
/// screen replaces the card once the computer runs. The bot's own mascot
/// stays in the header, chat and profile.
struct BotComputerSleepCard: View {
    @Environment(\.themePalette) var themePalette
    let phase: BotComputerPhase
    let wake: () -> Void
    let open: () -> Void

    var body: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .topTrailing) {
                ComputerIdleBotGlyph(size: 56, waking: phase == .waking)
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

/// The reference app's small "z Z" over the idle bot glyph on an asleep Computer screen.
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
        .foregroundStyle(Theme.textPrimary.opacity(0.45))
        .frame(width: 22, height: 22, alignment: .bottomLeading)
        .accessibilityHidden(true)
    }
}

/// Generic muted robot glyph for calm Computer screens (asleep / waking / off).
/// Rounded square head, two eyes, antenna; monochrome at about 40% opacity.
/// Same in light and dark. Matches the desktop lucide `Bot` idle look.
struct ComputerIdleBotGlyph: View {
    var size: CGFloat = 56
    var waking: Bool = false
    @State private var pulsed = false

    var body: some View {
        ComputerIdleBotShape()
            .stroke(style: StrokeStyle(lineWidth: max(1.2, size * 0.027), lineCap: .round, lineJoin: .round))
            .foregroundStyle(Theme.textPrimary)
            .frame(width: size, height: size)
            .opacity(waking ? (pulsed ? 0.48 : 0.32) : 0.4)
            .animation(waking ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulsed)
            .onAppear { if waking { pulsed = true } }
            .onValueChange(of: waking) { next in pulsed = next }
            .accessibilityHidden(true)
            .accessibilityIdentifier(waking ? "computer-idle-bot-waking" : "computer-idle-bot-asleep")
    }
}

/// Classic bot head in a 24x24 view box (antenna, rounded head, two eyes).
private struct ComputerIdleBotShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height)
        let ox = rect.midX - s / 2
        let oy = rect.midY - s / 2
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: ox + x / 24 * s, y: oy + y / 24 * s)
        }
        var path = Path()
        path.move(to: p(12, 8))
        path.addLine(to: p(12, 3))
        path.addEllipse(in: CGRect(x: p(10.5, 1.5).x, y: p(10.5, 1.5).y, width: 3 / 24 * s, height: 3 / 24 * s))
        let head = CGRect(x: p(5, 8).x, y: p(5, 8).y, width: 14 / 24 * s, height: 12 / 24 * s)
        path.addRoundedRect(in: head, cornerSize: CGSize(width: 3 / 24 * s, height: 3 / 24 * s))
        let eyeR = 1.4 / 24 * s
        path.addEllipse(in: CGRect(x: p(9, 13).x - eyeR, y: p(9, 13).y - eyeR, width: eyeR * 2, height: eyeR * 2))
        path.addEllipse(in: CGRect(x: p(15, 13).x - eyeR, y: p(15, 13).y - eyeR, width: eyeR * 2, height: eyeR * 2))
        return path
    }
}

// The Live Activity's drawings: the lock-screen card, the Dynamic Island's
// presentations and the watch's small card. Plain inputs (the attributes, the
// state, whether the system marked it stale), so the widget extension draws
// them from its `ActivityViewContext` and the app's DEBUG gallery
// (`-mascotGallery live-activity`) draws the very same views for captures.
//
// The system renders snapshots: nothing here animates but the two things iOS
// keeps ticking on its own, the elapsed clock and nothing else. The mascot is
// the engine's resting face for the state, a different one each update.
import AppIntents
import CompanionCore
import SwiftUI
import WidgetKit

/// The words the card leads with, in the phone's language.
struct BotActivityTitleText: View {
    let name: String
    let state: BotActivityContent

    var body: some View {
        switch LiveActivityTitle(state) {
        case .needsYou: Text("\(name) needs you")
        case .working: Text("\(name) is working")
        case .answered: Text("\(name): answered")
        case .done: Text("\(name) is done")
        case .confidential: Text(verbatim: ConfidentialRedaction.placeholder)
        }
    }
}

/// The time since the state began, kept ticking by the system. A stale or
/// finished card shows no clock: a clock that keeps counting on a card the
/// phone cannot vouch for reads as "still working".
struct BotActivityClock: View {
    let state: BotActivityContent
    let isStale: Bool

    var body: some View {
        if LiveActivityTitle(state).timed && !isStale {
            Text(timerInterval: state.since...state.since.addingTimeInterval(86_400), countsDown: false)
                .monospacedDigit()
                .multilineTextAlignment(.trailing)
        }
    }
}

/// The bot's face, with a thin ring in the state's colour.
struct BotActivityFace: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let isStale: Bool
    let size: CGFloat

    var body: some View {
        let title = LiveActivityTitle(state)
        let tint = MausPalette.color(attributes.color)
        ZStack {
            Circle()
                .strokeBorder(
                    title == .needsYou ? tint : tint.opacity(title == .working || title == .confidential ? 0.55 : 0.3),
                    lineWidth: max(1.5, size * 0.045)
                )
                .frame(width: size + 6, height: size + 6)
            MascotStill(
                color: attributes.color, look: attributes.look, skin: attributes.mascotSkin ?? .none,
                state: MausState(rawValue: state.face) ?? .idle, size: size,
                comets: title == .working && !isStale, at: state.since
            )
        }
        .frame(width: size + 6, height: size + 6)
        .opacity(isStale ? 0.6 : 1)
    }
}

/// The card's status glyph for the compact island.
struct BotActivityGlyph: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let isStale: Bool

    var body: some View {
        let tint = MausPalette.color(attributes.color)
        if isStale {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.55))
        } else {
            switch LiveActivityTitle(state) {
            case .needsYou:
                Image(systemName: "hand.raised.fill")
                    .font(.system(size: 13, weight: .bold))
                    .foregroundStyle(tint)
            case .working, .confidential:
                BotActivityClock(state: state, isStale: false)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(maxWidth: 44)
            case .answered, .done:
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(tint)
            }
        }
    }
}

/// The lock screen's card on the phone. The background is painted here, in
/// the same skin as the ink: a card painted in the dark skin with ink read
/// from a light lock screen was dark text on a dark card.
struct BotActivityLockScreenCard: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let isStale: Bool
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let palette = SharedTheme.palette(for: SharedTheme.pinnedScheme ?? scheme)
        let title = LiveActivityTitle(state)
        let asking = title == .needsYou
        HStack(alignment: .top, spacing: 12) {
            BotActivityFace(attributes: attributes, state: state, isStale: isStale, size: 40)
            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    BotActivityTitleText(name: attributes.name, state: state)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(asking ? MausPalette.color(attributes.color) : palette.textPrimary.color)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    BotActivityClock(state: state, isStale: isStale)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(palette.textSecondary.color)
                        .frame(maxWidth: 64, alignment: .trailing)
                }
                if !state.line.isEmpty {
                    Text(verbatim: state.line)
                        .font(.system(size: asking ? 15 : 14, weight: asking ? .medium : .regular))
                        .foregroundStyle(asking ? palette.textPrimary.color : palette.textSecondary.color)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let threadId = state.approvalThreadId, let requestId = state.requestId {
                    ActivityAnswerButtons(
                        attributes: attributes, state: state, threadId: threadId, requestId: requestId,
                        refusalInk: palette.textPrimary.color, refusalFill: palette.cardRaised.color,
                        hintInk: palette.textSecondary.color
                    )
                    .padding(.top, 5)
                }
                if isStale {
                    Text("Open Sagax for the latest")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(palette.textSecondary.color)
                        .padding(.top, 2)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .activityBackgroundTintCompat(palette.bg.color)
        .activitySystemActionForegroundColorCompat(palette.textPrimary.color)
    }
}

/// The Dynamic Island, expanded: the face on the leading edge, the clock on
/// the trailing one, the words in the middle and the answers below. Sizes
/// stay inside the regions Apple gives (a leading region is about 52 pt
/// tall before the bottom region pushes the island down).
struct BotActivityIslandCenter: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            BotActivityTitleText(name: attributes.name, state: state)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
                .lineLimit(1)
            if !state.line.isEmpty {
                Text(verbatim: state.line)
                    .font(.system(size: 13))
                    .foregroundStyle(.white.opacity(0.72))
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct BotActivityIslandBottom: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let isStale: Bool

    var body: some View {
        if let threadId = state.approvalThreadId, let requestId = state.requestId {
            ActivityAnswerButtons(attributes: attributes, state: state, threadId: threadId, requestId: requestId)
                .padding(.top, 2)
        } else if isStale {
            Text("Open Sagax for the latest")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.6))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// The watch: everything on one screen, the answers never pushed below it.
struct BotActivityWatchCard: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let isStale: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 5) {
                MascotStill(color: attributes.color, look: attributes.look, skin: attributes.mascotSkin ?? .none, state: MausState(rawValue: state.face) ?? .idle, size: 16)
                Text(verbatim: attributes.name)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(MausPalette.color(attributes.color))
                    .lineLimit(1)
            }
            Group {
                if LiveActivityTitle(state) == .needsYou, !state.line.isEmpty {
                    Text(verbatim: state.line)
                } else {
                    BotActivityTitleText(name: attributes.name, state: state)
                }
            }
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(.white.opacity(isStale ? 0.6 : 1))
            .lineLimit(state.approvalThreadId == nil ? 3 : 2)
            .minimumScaleFactor(0.85)
            if let threadId = state.approvalThreadId, let requestId = state.requestId,
               state.options.count <= 2 {
                ActivityAnswerButtons(attributes: attributes, state: state, threadId: threadId, requestId: requestId, height: 26, fontSize: 13)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The card's options, as pills — exactly the options the card offered.
struct ActivityAnswerButtons: View {
    let attributes: BotActivityAttributes
    let state: BotActivityContent
    let threadId: String
    let requestId: String
    /// The island is black: white ink and a faint white refusal pill. The
    /// lock-screen card passes its skin's.
    var refusalInk: Color = .white
    var refusalFill: Color = .white.opacity(0.16)
    var hintInk: Color = .white.opacity(0.7)
    var height: CGFloat = 34
    var fontSize: CGFloat = 14

    var body: some View {
        // Answering from the activity itself is an interactive-widget feature,
        // and those arrived in iOS 17. Below that the buttons would be dead
        // pills, so say where the answer lives instead of pretending.
        if #available(iOS 17.0, *) {
            buttons
        } else {
            Text("Open Sagax to answer")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(hintInk)
        }
    }

    @available(iOS 17.0, *)
    @ViewBuilder
    private var buttons: some View {
        // Up to three side by side; past that the activity opens the chat.
        let layout = NotificationChoices.layout(state.options, limit: 3)
        HStack(spacing: 8) {
            ForEach(layout.overflow ? [] : layout.shown, id: \.self) { option in
                Button(intent: AnswerApprovalIntent(
                    threadId: threadId,
                    requestId: requestId,
                    choice: option,
                    isPermission: state.isPermission
                )) {
                    let refusal = option.caseInsensitiveCompare("Deny") == .orderedSame
                    Text(option)
                        .font(.system(size: fontSize, weight: .semibold))
                        .foregroundStyle(refusal ? refusalInk : .white)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .frame(height: height)
                        .background(
                            Capsule().fill(
                                refusal
                                    ? refusalFill
                                    : MausPalette.color(attributes.color)
                            )
                        )
                }
                .buttonStyle(.plain)
            }
            if layout.overflow {
                Text("Open Sagax to answer")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(hintInk)
            }
        }
    }
}

private extension View {
    /// ActivityKit's tint modifiers exist in the app too (iOS 16.1), and are
    /// inert outside an activity: the gallery paints the background itself.
    @ViewBuilder
    func activityBackgroundTintCompat(_ color: Color) -> some View {
        if #available(iOS 16.1, *) {
            self.activityBackgroundTint(color).background(color)
        } else {
            self.background(color)
        }
    }

    @ViewBuilder
    func activitySystemActionForegroundColorCompat(_ color: Color) -> some View {
        if #available(iOS 16.1, *) {
            self.activitySystemActionForegroundColor(color)
        } else {
            self
        }
    }
}

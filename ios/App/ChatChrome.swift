// The chat screen's chrome (reference 02): the name capsule, the fade under
// the top bar, the white voice / send capsule, and the one place that decides
// what the capsule opens.
//
// Values come from docs/superpowers/specs/assets/ios-visual-parity/
// measure-chat-profile.md §1 and live in `Theme.Chat`.
import SwiftUI
import CompanionCore

// MARK: - Profile hook

/// What the name capsule (and every other door into the bot) opens: the
/// bot panel, full screen, on the door's tab (`BotPanelDoor`), as the
/// desktop's header opens its panel.
enum ChatProfileRoute {
    @ViewBuilder
    static func destination(for bot: Bot, tab: DesktopPanelTab, section: DesktopPanelSection? = nil) -> some View {
        PhoneBotPanel(bot: bot, tab: tab, section: section)
    }
}

// MARK: - Name capsule

/// The centred 44 pt glass capsule: 12 pt in, a 24 pt mascot, 10 pt, the name
/// in 14 medium, 14 pt out (83 pt wide for "Ara").
/// The mascot carries the bot's live state (working, needs you).
struct ChatNameCapsule: View {
    @Environment(\.themePalette) var themePalette
    let chat: Chat
    var state: MausState = .idle
    let open: () -> Void
    @EnvironmentObject private var session: Session
    @ObservedObject private var people = PeopleDirectory.shared

    var body: some View {
        Button {
            Haptics.selection()
            open()
        } label: {
            HStack(spacing: 10) {
                ChatAvatarView(
                    chat: chat,
                    size: Theme.Chat.capsuleMascot,
                    state: state,
                    animated: state.showsActivity,
                    background: Theme.glassFill
                )
                // a green dot on the mascot while the bot works (the
                // reference design's header pill)
                .overlay(alignment: .bottomTrailing) {
                    if chat.isBot, state.showsActivity {
                        Circle()
                            .fill(Theme.success)
                            .frame(width: 10, height: 10)
                            .overlay(Circle().strokeBorder(Theme.glassFill, lineWidth: 2))
                            .offset(x: 2, y: 2)
                            .transition(.opacity)
                            .accessibilityHidden(true)
                    }
                }
                Text(verbatim: people.name(chat, session: session))
                    .font(Theme.Font.bodyMedium)
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                // the title's lock: this thread is confidential
                if ConfidentialBanner.shows(for: chat) {
                    ConfidentialMark(showsLabel: false)
                }
            }
            .padding(.leading, 12)
            .padding(.trailing, 14)
            .frame(height: Theme.Metric.glassLarge)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .themeGlass(Capsule())
        .chatGlassRim(Capsule())
    }
}

// MARK: - Top edge

/// Content scrolled under the top bar blurs and fades into the background:
/// gone above about y 36, about 60% through the bar, clear below it.
struct ChatTopEdgeFade: View {
    @Environment(\.themePalette) var themePalette
    var background: Color = Theme.bg

    var body: some View {
        // Place it in a full-screen layer that ignores the safe area, so y is
        // measured from the screen's top edge.
        let height = Theme.Chat.edgeFadeEnd
        let stop = { (y: CGFloat) in min(1, max(0, y / height)) }
        ZStack(alignment: .top) {
            Rectangle()
                .fill(.ultraThinMaterial)
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .black, location: 0),
                            .init(color: .black, location: stop(100)),
                            .init(color: .clear, location: 1),
                        ],
                        startPoint: .top, endPoint: .bottom
                    )
                )
                .opacity(0.35)
            LinearGradient(
                stops: [
                    .init(color: background, location: 0),
                    .init(color: background, location: stop(36)),
                    .init(color: background.opacity(0.5), location: stop(50)),
                    .init(color: background.opacity(0.42), location: stop(58)),
                    .init(color: background.opacity(0.42), location: stop(110)),
                    .init(color: background.opacity(0), location: 1),
                ],
                startPoint: .top, endPoint: .bottom
            )
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Voice / send

/// Five rounded bars: 2 pt wide on a 3.33 pt pitch, 6 / 14.7 / 8.7 / 14.7 / 6
/// pt tall, centred. Drawn rather than taken from SF Symbols so it matches.
struct VoiceWaveformGlyph: Shape {
    func path(in rect: CGRect) -> Path {
        let heights: [CGFloat] = [6, 14.7, 8.7, 14.7, 6]
        let width: CGFloat = 2
        let pitch: CGFloat = 3.33
        let total = pitch * CGFloat(heights.count - 1) + width
        var path = Path()
        for (index, height) in heights.enumerated() {
            let x = rect.midX - total / 2 + CGFloat(index) * pitch
            let bar = CGRect(x: x, y: rect.midY - height / 2, width: width, height: height)
            path.addRoundedRect(in: bar, cornerSize: CGSize(width: width / 2, height: width / 2))
        }
        return path
    }
}

/// The white 36x28 capsule at the end of the field: the waveform starts voice
/// mode; once there is something to send it becomes the send arrow.
struct ComposerVoiceSendButton: View {
    @Environment(\.themePalette) var themePalette
    let canSend: Bool
    let busy: Bool
    /// This chat is on a call: the capsule hangs up (the desktop's red
    /// call button).
    var onCall = false
    let send: () -> Void
    let voice: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            canSend ? send() : voice()
        } label: {
            ZStack {
                if onCall && !canSend {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.white)
                        .transition(.scale.combined(with: .opacity))
                } else if canSend {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .transition(.scale.combined(with: .opacity))
                } else {
                    VoiceWaveformGlyph()
                        .transition(.scale.combined(with: .opacity))
                }
            }
            .foregroundStyle(Theme.primaryInk)
            .frame(width: Theme.Chat.voiceCapsule.width, height: Theme.Chat.voiceCapsule.height)
            .background(onCall && !canSend ? Color(red: 0.89, green: 0.27, blue: 0.27) : Theme.primaryFill, in: Capsule())
            .opacity(busy ? 0.5 : 1)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(busy)
        .animation(.snappy(duration: 0.2), value: canSend)
        .animation(.snappy(duration: 0.2), value: onCall)
        .accessibilityLabel(canSend ? Text(String(localized: "Send")) : onCall ? Text(String(localized: "End call")) : Text(String(localized: "Start voice mode")))
        .accessibilityIdentifier(canSend ? "composer-send" : onCall ? "composer-end-call" : "composer-voice")
    }
}

// MARK: - Glyphs

/// The computer button's outline monitor, as measured: an 18 x 12.3 pt
/// screen with a 1.8 pt stroke, a 2 pt neck and a 10 pt base (ink 18 x 16.7).
struct ComputerGlyph: Shape {
    static let size = CGSize(width: 18, height: 16.7)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width
        let sy = rect.height / Self.size.height
        func r(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
            CGRect(x: rect.minX + x * sx, y: rect.minY + y * sy, width: w * sx, height: h * sy)
        }
        var path = Path()
        let screen = Path(roundedRect: r(0.9, 0.9, 16.2, 10.5), cornerRadius: 1.4 * sx, style: .continuous)
        path.addPath(screen.strokedPath(StrokeStyle(lineWidth: 1.8 * sx)))
        path.addRect(r(8, 12.2, 2, 2.8))
        path.addRoundedRect(in: r(4, 14.95, 10, 1.75), cornerSize: CGSize(width: 0.87 * sx, height: 0.87 * sy))
        return path
    }
}

/// The composer's mic, as measured (ink 11.7 x 16.3): a filled capsule, a
/// 1.2 pt cradle and a short stem, no base.
struct MicGlyph: Shape {
    static let size = CGSize(width: 11.7, height: 16.3)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width
        let sy = rect.height / Self.size.height
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        var path = Path()
        path.addRoundedRect(
            in: CGRect(origin: p(3.05, 0), size: CGSize(width: 5.7 * sx, height: 10.2 * sy)),
            cornerSize: CGSize(width: 2.85 * sx, height: 2.85 * sx)
        )
        var cradle = Path()
        cradle.move(to: p(0.65, 5.3))
        cradle.addLine(to: p(0.65, 7.6))
        cradle.addArc(center: p(5.9, 7.6), radius: 5.25 * sx, startAngle: .degrees(180), endAngle: .degrees(0), clockwise: true)
        cradle.addLine(to: p(11.15, 5.3))
        cradle.move(to: p(5.9, 13.3))
        cradle.addLine(to: p(5.9, 15.8))
        path.addPath(cradle.strokedPath(StrokeStyle(lineWidth: 1.15 * sx, lineCap: .round)))
        return path
    }
}

// MARK: - Rim

extension View {
    /// The reference's glass rim peaks around #777 and fades within 1 pt;
    /// the system Liquid Glass rim reads brighter over the dark chat. A 1 pt
    /// inner veil of the glass fill brings it back to the measured values.
    func chatGlassRim<S: InsettableShape>(_ shape: S) -> some View {
        overlay(
            shape.strokeBorder(Theme.glassFill.opacity(0.35), lineWidth: 1)
                .allowsHitTesting(false)
        )
    }
}

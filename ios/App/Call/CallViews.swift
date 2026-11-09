// The call's views, ported from the desktop:
//
// - CallBar: a bot's voice call (src/components/voice-mode/VoiceModeBar.tsx).
//   A compact rounded bar centred under the chat header: the bot's face, a
//   dotted live waveform, then Settings, Transcript, Mic and the red End.
//   It takes only its own short row; the conversation stays on screen and
//   scrolls under it. Settings or Transcript grow a card of the same width
//   out of the bar's bottom edge (height and opacity, the menus' 200 ms
//   motion) that lies over the thread and folds back into the bar. There is
//   no full-screen stage: hanging up leaves the plain header.
// - A room's call (src/components/GroupCallView.tsx) uses the same bar under
//   the room's name (owner, 2026-10-09: no full-screen call on iOS): the
//   members' faces side by side in the avatar's seat, the one speaking or
//   working in focus, and the room's state ("Nova is speaking").
import CompanionCore
import SwiftUI

// MARK: - Colors of the call (the desktop's tokens on the app's Theme)

private enum CallTheme {
    static let elevated = Theme.card
    static let raised = Theme.pill
    static let inset = Theme.chip
    static let hairline = Theme.hairline
    static let ink = Theme.textPrimary
    static let inkSecondary = Theme.textSecondary
    static let inkTertiary = Theme.textTertiary
    static let accent = Theme.blue
    static let danger = Color(red: 0.89, green: 0.27, blue: 0.27)
    static let warning = Color(red: 0.96, green: 0.65, blue: 0.24)
}

extension CallState {
    /// The face the bot wears for each state (VoiceModeBar's BotAvatar state).
    var mascot: MausState {
        switch phase {
        case .listening, .hearing: .listening
        case .speaking: .sending
        case .thinking, .interrupted: .thinking
        default: .working
        }
    }
}

// MARK: - The call bar

/// What the card under the bar shows (VoiceModeBar's `panel`).
enum CallBarPanel: String, Equatable {
    case settings, transcript
}

/// The bar's measures, the desktop's in points (VoiceModeBar.tsx): a 64 row
/// with 12 of padding, a 40 face and 40 round controls with 18 icons, 8
/// apart, at most 420 wide; corners half the row (32), 22 at the bottom
/// while a card hangs under it. Dynamic Type grows them, up to a third.
enum CallBarMetrics {
    static let row: CGFloat = 64
    static let padding: CGFloat = 12
    static let control: CGFloat = 40
    static let icon: CGFloat = 18
    static let gap: CGFloat = 8
    static let maxWidth: CGFloat = 420
    static let radius: CGFloat = 32
    static let cardRadius: CGFloat = 22
    /// the waveform folds away below this bar width (`@[21rem]/callpill`)
    static let waveformMinWidth: CGFloat = 336
    /// the card's scroll area: `max-h-[min(55vh,360px)]`
    static let cardMaxHeight: CGFloat = 360
    /// the bar's side gutter on the phone, and its gap to the header above
    static let gutter: CGFloat = 16
    static let top: CGFloat = 4
    static let below: CGFloat = 8

    /// The Dynamic Type factor the bar uses: never smaller, at most 4/3.
    static func scale(_ raw: CGFloat) -> CGFloat { min(max(raw, 1), 4.0 / 3.0) }

    /// The room the bar's row takes above the transcript.
    static func inset(scale raw: CGFloat) -> CGFloat { top + row * scale(raw) + below }

    /// The menus' motion: 200 ms on cubic-bezier(0.22, 1, 0.36, 1), none
    /// under Reduce Motion (MenuMotion.tsx).
    static func motion(reduce: Bool) -> Animation? {
        reduce ? nil : .timingCurve(0.22, 1, 0.36, 1, duration: 0.2)
    }
}

/// The bar's outline: every corner half the row, the bottom ones 22 while
/// the card is open. Animatable, so the corners move with the card.
private struct CallBarShape: Shape {
    var top: CGFloat
    var bottom: CGFloat

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(top, bottom) }
        set { top = newValue.first; bottom = newValue.second }
    }

    func path(in rect: CGRect) -> Path {
        let t = min(top, rect.height / 2, rect.width / 2)
        let b = min(bottom, rect.height / 2, rect.width / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + t, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - t, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + t), radius: t)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - b))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - b, y: rect.maxY), radius: b)
        path.addLine(to: CGPoint(x: rect.minX + b, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - b), radius: b)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + t))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + t, y: rect.minY), radius: t)
        path.closeSubpath()
        return path
    }
}

private struct CallCardContentHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

private struct CallBarWidth: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// Who the bar calls: one bot, or a room and its members.
enum CallBarSubject {
    case bot(Bot)
    case room(Room, members: [Bot])

    var name: String {
        switch self {
        case let .bot(bot): bot.name
        case let .room(room, _): room.name
        }
    }
}

/// A call's voice bar: the bar under the chat header and the card that
/// grows out of it. `panel` lives in the chat, so a tap on the thread can
/// fold the card the way a click outside does on the desktop.
struct CallBar: View {
    let subject: CallBarSubject
    @ObservedObject var call: CallController
    @Binding var panel: CallBarPanel?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.verticalSizeClass) private var verticalSizeClass
    @ScaledMetric(relativeTo: .body) private var rawScale: CGFloat = 1
    @State private var list: CallSettingsPanel.List?
    @State private var width: CGFloat = 0
    @State private var contentHeight: CGFloat = 0
    /// Closing, the card keeps drawing the panel it had while it folds away.
    @State private var heldPanel: CallBarPanel?

    private var scale: CGFloat { CallBarMetrics.scale(rawScale) }
    private var status: String {
        switch subject {
        case .bot: CallController.phaseLabel(call.state)
        case let .room(room, members):
            CallController.roomPhaseLabel(
                call.state,
                speaking: call.speakingMemberId.flatMap { id in members.first { $0.id == id } },
                working: room.busyBotId.flatMap { id in members.first { $0.id == id } },
                push: call.callSettings.input == .push
            )
        }
    }
    private var line: String {
        switch call.state.phase {
        case .hearing, .interrupted: call.heard
        case .speaking: call.caption
        default: ""
        }
    }
    private var alert: Bool { call.note != nil || call.notice != nil }
    /// A panel, or an alert alone, hangs a card under the row.
    private var expanded: Bool { panel != nil || alert }
    private var shownPanel: CallBarPanel? { panel ?? heldPanel }
    /// `min(55vh, 360)`; a phone on its side keeps the card shorter still.
    private var scrollMax: CGFloat {
        let screen = UIScreen.main.bounds.height
        let cap = verticalSizeClass == .compact ? 0.4 : 0.55
        return min(CallBarMetrics.cardMaxHeight * scale, screen * cap)
    }
    private var cardHeight: CGFloat { expanded ? min(contentHeight, scrollMax) + 20 : 0 }
    private var motion: Animation? { CallBarMetrics.motion(reduce: reduceMotion) }

    var body: some View {
        VStack(spacing: 0) {
            row
            card
        }
        .background(
            GeometryReader { proxy in
                Color.clear.preference(key: CallBarWidth.self, value: proxy.size.width)
            }
        )
        .onPreferenceChange(CallBarWidth.self) { width = $0 }
        .background(CallTheme.elevated, in: CallBarShape(top: CallBarMetrics.radius * scale, bottom: (expanded ? CallBarMetrics.cardRadius : CallBarMetrics.radius) * scale))
        .clipShape(CallBarShape(top: CallBarMetrics.radius * scale, bottom: (expanded ? CallBarMetrics.cardRadius : CallBarMetrics.radius) * scale))
        .overlay(
            CallBarShape(top: CallBarMetrics.radius * scale, bottom: (expanded ? CallBarMetrics.cardRadius : CallBarMetrics.radius) * scale)
                .strokeBorderCompat(CallTheme.hairline.opacity(0.5), lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.28), radius: 14, y: 8)
        .frame(maxWidth: CallBarMetrics.maxWidth)
        .animation(motion, value: expanded)
        .animation(motion, value: cardHeight)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(String(localized: "Voice call with \(subject.name)")))
        .accessibilityIdentifier("call-pill")
        .onAppear { call.loadVoices() }
        .onValueChange(of: panel) { next in
            if let next { heldPanel = next }
            if next != .settings { list = nil }
        }
        .onValueChange(of: expanded) { open in
            guard !open else { return }
            // the fold has played: let the held panel go
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                if !expanded { heldPanel = nil }
            }
        }
        .background {
            // Escape on a hardware keyboard folds the card (an open list first)
            if panel != nil {
                Button("") {
                    if list != nil { list = nil } else { withAnimation(motion) { panel = nil } }
                }
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .accessibilityHidden(true)
            }
        }
    }

    // MARK: The row

    private var row: some View {
        HStack(spacing: CallBarMetrics.gap * scale) {
            avatar
            if width >= CallBarMetrics.waveformMinWidth {
                CallWaveform(call: call)
                    .frame(height: 32)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 4)
                    .accessibilityIdentifier("call-waveform")
            } else {
                Spacer(minLength: 0)
            }
            HStack(spacing: CallBarMetrics.gap * scale) {
                if call.callSettings.input == .push { pushButton }
                gearButton
                transcriptButton
                muteButton
                endButton
            }
            .fixedSize()
        }
        .padding(.horizontal, CallBarMetrics.padding)
        .frame(height: CallBarMetrics.row * scale)
        .background(alignment: .leading) {
            // the state is spoken, not printed (the desktop's sr-only live region)
            Text(verbatim: line.isEmpty ? status : line)
                .font(.system(size: 1))
                .opacity(0.01)
                .frame(width: 1, height: 1)
                .accessibilityLabel(Text(verbatim: line.isEmpty ? status : line))
                .accessibilityIdentifier("call-status")
        }
    }

    private var avatar: some View {
        TimelineView(.periodic(from: call.startedAt, by: 1)) { context in
            let time = formatCallTime(context.date.timeIntervalSince(call.startedAt))
            switch subject {
            case let .bot(bot):
                Button {
                    if call.state.botAudible { call.interrupt() }
                } label: {
                    BotMascotView(bot: bot, size: CallBarMetrics.control * scale, state: call.state.mascot, animated: true)
                        .frame(width: CallBarMetrics.control * scale, height: CallBarMetrics.control * scale)
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(call.state.botAudible ? Text(String(localized: "Interrupt")) : Text(verbatim: subject.name))
                // the desktop's tooltip: name · time · state
                .accessibilityValue(Text(verbatim: "\(time) · \(status)"))
                .accessibilityIdentifier("call-avatar")
            case let .room(room, members):
                // each face stays its own element (the member's name), so
                // the faces are not one button: a tap interrupts the voice
                CallRoomFaces(room: room, members: members, call: call, side: CallBarMetrics.control * scale)
                    .onTapGesture { if call.state.botAudible { call.interrupt() } }
                    .accessibilityAction(named: Text(String(localized: "Interrupt"))) { if call.state.botAudible { call.interrupt() } }
                    .accessibilityValue(Text(verbatim: "\(time) · \(status)"))
            }
        }
    }

    private func round(_ symbol: String, color: Color = CallTheme.inkSecondary, fill: Color = CallTheme.raised, ring: Bool = false, weight: Font.Weight = .regular) -> some View {
        let side = CallBarMetrics.control * scale
        return Image(systemName: symbol)
            .font(.system(size: CallBarMetrics.icon * scale, weight: weight))
            .foregroundStyle(color)
            .frame(width: side, height: side)
            .background(fill, in: Circle())
            .overlay {
                if ring { Circle().strokeBorderCompat(CallTheme.ink.opacity(0.4), lineWidth: 2) }
            }
            .contentShape(Circle())
    }

    private func toggle(_ next: CallBarPanel) {
        Haptics.selection()
        withAnimation(motion) { panel = panel == next ? nil : next }
        list = nil
    }

    private var gearButton: some View {
        let open = panel == .settings
        return Button { toggle(.settings) } label: {
            round("gearshape", color: open ? CallTheme.ink : CallTheme.inkSecondary, ring: open)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "Voice settings")))
        .accessibilityAddTraits(open ? .isSelected : [])
        .accessibilityIdentifier("call-settings")
    }

    private var transcriptButton: some View {
        let open = panel == .transcript
        return Button { toggle(.transcript) } label: {
            round("text.bubble", color: open ? CallTheme.elevated : CallTheme.inkSecondary, fill: open ? CallTheme.ink : CallTheme.raised)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "Transcript")))
        .accessibilityAddTraits(open ? .isSelected : [])
        .accessibilityIdentifier("call-transcript-toggle")
    }

    private var muteButton: some View {
        let muted = call.state.muted
        return Button {
            Haptics.selection()
            call.setMuted(!muted)
        } label: {
            round(muted ? "mic.slash" : "mic", color: muted ? CallTheme.danger : CallTheme.inkSecondary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(muted ? Text(String(localized: "Unmute microphone")) : Text(String(localized: "Mute microphone")))
        .accessibilityAddTraits(muted ? .isSelected : [])
        .accessibilityIdentifier("call-mute")
    }

    private var endButton: some View {
        Button {
            Haptics.impact(.medium)
            call.end()
        } label: {
            round("xmark", color: .white, fill: CallTheme.danger, weight: .bold)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(String(localized: "End voice mode")))
        .accessibilityIdentifier("call-end")
    }

    private var pushButton: some View {
        let hearing = call.state.phase == .hearing
        return round("hand.raised", color: hearing ? .white : CallTheme.inkSecondary, fill: hearing ? CallTheme.accent : CallTheme.raised)
            .opacity(call.state.muted || call.state.phase == .held ? 0.4 : 1)
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { _ in if call.state.phase != .hearing { call.pushToTalk(true) } }
                    .onEnded { _ in call.pushToTalk(false) }
            )
            .accessibilityElement()
            .accessibilityLabel(Text(String(localized: "Hold to talk")))
            .accessibilityIdentifier("call-ptt")
    }

    // MARK: The card

    /// The card grows out of the row's bottom edge: its content keeps its
    /// natural size (it never reflows) and only the clip's height moves.
    private var card: some View {
        ScrollViewReader { proxy in
            VStack(spacing: 0) {
                Rectangle().fill(CallTheme.hairline.opacity(0.5)).frame(height: 0.5)
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ZStack(alignment: .top) {
                            if let shown = shownPanel {
                                panelBody(shown)
                                    .id(shown)
                                    .transition(.opacity)
                            }
                        }
                        alerts
                        Color.clear.frame(height: 0).id("call-card-end")
                    }
                    .padding(.horizontal, CallBarMetrics.padding)
                    .background(
                        GeometryReader { inner in
                            Color.clear.preference(key: CallCardContentHeight.self, value: inner.size.height)
                        }
                    )
                }
                .scrollIndicators(.hidden)
                .frame(height: min(contentHeight, scrollMax))
                .padding(.vertical, 10)
                .id(shownPanel?.rawValue ?? "alert")
                .onPreferenceChange(CallCardContentHeight.self) { height in
                    contentHeight = height
                    // the transcript is read from its last line, before it shows
                    if panel == .transcript { proxy.scrollTo("call-card-end", anchor: .bottom) }
                }
            }
            .frame(height: cardHeight, alignment: .top)
            .clipped()
            .opacity(expanded ? 1 : 0)
            .allowsHitTesting(expanded)
            .accessibilityHidden(!expanded)
            .accessibilityIdentifier("call-card")
            .onValueChange(of: panel) { next in
                if next == .transcript { proxy.scrollTo("call-card-end", anchor: .bottom) }
            }
            .onValueChange(of: call.heard) { _ in
                if panel == .transcript { proxy.scrollTo("call-card-end", anchor: .bottom) }
            }
            .onValueChange(of: call.caption) { _ in
                if panel == .transcript { proxy.scrollTo("call-card-end", anchor: .bottom) }
            }
        }
    }

    @ViewBuilder
    private func panelBody(_ which: CallBarPanel) -> some View {
        switch which {
        case .settings:
            VStack(spacing: 0) {
                CallSettingsPanel(call: call, open: $list)
                holdButton.padding(.bottom, 4)
            }
        case .transcript:
            CallTranscriptPanel(name: subject.name, room: { if case .room = subject { true } else { false } }(), call: call, status: status, line: line)
        }
    }

    private var holdButton: some View {
        let held = call.state.phase == .held
        return Button {
            held ? call.resume() : call.hold()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: held ? "play.fill" : "pause.fill").font(.system(size: 12 * scale))
                Text(held ? String(localized: "Resume the call") : String(localized: "Put the call on hold"))
                    .font(.system(size: 13 * scale))
            }
            .foregroundStyle(held ? CallTheme.warning : CallTheme.ink)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 7)
            .background(CallTheme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("call-hold")
    }

    @ViewBuilder
    private var alerts: some View {
        if let note = call.note {
            HStack(spacing: 8) {
                Text(note).font(.system(size: 12.5 * scale)).foregroundStyle(CallTheme.warning)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                Button(String(localized: "Try again")) { call.retry() }
                    .font(.system(size: 12 * scale))
                    .foregroundStyle(CallTheme.warning)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 2)
                    .overlay(Capsule().strokeBorderCompat(CallTheme.warning.opacity(0.4), lineWidth: 1))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(CallTheme.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.vertical, 4)
            .accessibilityIdentifier("call-note")
        } else if let notice = call.notice {
            Text(notice)
                .font(.system(size: 12.5 * scale))
                .foregroundStyle(CallTheme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(CallTheme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(.vertical, 4)
                .onTapGesture { call.dismissNotice() }
                .accessibilityIdentifier("call-notice")
        }
    }
}

private extension Shape {
    /// `strokeBorder` on any shape (InsettableShape is not needed for a hairline).
    func strokeBorderCompat(_ color: Color, lineWidth: CGFloat) -> some View {
        stroke(color, lineWidth: lineWidth)
    }
}

// MARK: - The waveform

/// Both sides of the call as a row of dots: each column grows taller and
/// brighter with the loudest side at that point (the bot's voice in the
/// accent, the person's in ink); a quiet line is one dim dot per column.
struct CallWaveform: View {
    @ObservedObject var call: CallController
    @State private var history = WaveHistory()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    /// The desktop's dots: 7 between columns, 6 between rows, 4 wide.
    private static let column: CGFloat = 7
    private static let row: CGFloat = 6
    private static let radius: CGFloat = 2
    private static let rows = 5

    var body: some View {
        let quiet = call.state.phase == .held || call.state.phase == .connecting
        let muted = call.state.muted
        // Any frame rate: the columns advance with the clock (WaveHistory),
        // not once per drawn frame, so 120 Hz draws smoother, not faster.
        // Reduce Motion keeps the levels, ten times a second, without the
        // shimmer; nothing is drawn while the app is in the background.
        let schedule: AnimationTimelineSchedule = reduceMotion
            ? .animation(minimumInterval: 0.1, paused: scenePhase != .active)
            : .animation(minimumInterval: nil, paused: scenePhase != .active)
        TimelineView(schedule) { timeline in
            Canvas { context, size in
                let columns = max(1, Int(size.width / Self.column))
                let levels = call.levels
                let time = timeline.date.timeIntervalSinceReferenceDate
                history.advance(to: time, mic: quiet || muted ? 0 : levels.mic, bot: quiet ? 0 : levels.bot, columns: columns)
                let middle = size.height / 2
                let offset = (size.width - CGFloat(columns - 1) * Self.column) / 2
                for i in 0..<columns {
                    let theirs = history.bot[i]
                    let mine = history.mic[i]
                    let shimmer = quiet || reduceMotion ? 0 : 0.08 * abs(sin(time * 1000 / 600 + Double(i) * 0.45))
                    let level = Double(max(theirs, mine))
                    let reach = Int((level * Double(Self.rows - 1) / 2).rounded())
                    let color = theirs >= mine && level > 0.05 ? CallTheme.accent : CallTheme.ink
                    for row in -reach...reach {
                        let alpha = min(1, 0.22 + shimmer + level * 0.75 - Double(abs(row)) * 0.08)
                        let center = CGPoint(x: offset + CGFloat(i) * Self.column, y: middle + CGFloat(row) * Self.row)
                        context.fill(Path(ellipseIn: CGRect(x: center.x - Self.radius, y: center.y - Self.radius, width: Self.radius * 2, height: Self.radius * 2)), with: .color(color.opacity(alpha)))
                    }
                }
            }
        }
        .accessibilityHidden(true)
    }
}

/// The levels of the last columns, newest on the right.
final class WaveHistory {
    private(set) var mic: [Float] = []
    private(set) var bot: [Float] = []

    /// One column per 1/30 s of clock time, whatever the frame rate.
    static let step: TimeInterval = 1.0 / 30
    private var clock: TimeInterval?

    /// Add the columns that `time` has moved past since the last call, all
    /// at the current levels; none when it has not moved a whole column.
    func advance(to time: TimeInterval, mic level: Float, bot output: Float, columns: Int) {
        guard let last = clock else {
            clock = time
            push(mic: level, bot: output, columns: columns)
            return
        }
        let steps = Int((time - last) / Self.step)
        if steps <= 0 {
            // a new width still resets the columns at once
            if mic.count != columns { push(mic: level, bot: output, columns: columns) }
            return
        }
        // after a pause, at most one screen of new columns
        for _ in 0..<min(steps, columns) { push(mic: level, bot: output, columns: columns) }
        clock = last + Double(steps) * Self.step
    }

    func push(mic level: Float, bot output: Float, columns: Int) {
        if mic.count != columns {
            mic = Array(repeating: 0, count: columns)
            bot = Array(repeating: 0, count: columns)
        }
        mic.removeFirst()
        bot.removeFirst()
        mic.append(min(1, level * 9))
        bot.append(min(1, output * 9))
    }
}

// MARK: - Settings (VoiceModeSettingsPanel)

/// The gear's card (VoiceModeSettingsPanel.tsx): Voice, Speed and Language,
/// then an Advanced zone, folded by default and remembered with the call's
/// settings, that holds the rest of this phone's call settings (microphone,
/// end of turn, Only my voice with its enrollment, call sounds, the soft
/// tone). The zone grows out of its row with the same
/// height motion as the card, and its content never reflows.
struct CallSettingsPanel: View {
    enum List { case voice, speed, language }

    @ObservedObject var call: CallController
    @Binding var open: List?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ScaledMetric(relativeTo: .body) private var rawScale: CGFloat = 1

    private var scale: CGFloat { CallBarMetrics.scale(rawScale) }
    private var motion: Animation? { CallBarMetrics.motion(reduce: reduceMotion) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if call.voiceModeAvailable {
                row(String(localized: "Voice"), value: voiceName, list: .voice)
                if open == .voice { voiceList }
                row(String(localized: "Speed"), value: VoiceModeSettings.speedLabel(call.voiceSettings.speed), list: .speed)
                if open == .speed {
                    options(VoiceModeSettings.speeds.map { (String($0), VoiceModeSettings.speedLabel($0)) }, selected: String(call.voiceSettings.speed)) {
                        call.voiceSettings.speed = Double($0) ?? 1
                    }
                }
            }
            row(String(localized: "Language"), value: languageName, list: .language)
            if open == .language {
                ScrollView {
                    options(VoiceModeSettings.languages.map { ($0.code, $0.code == "auto" ? String(localized: "Auto-detect") : $0.label) }, selected: call.voiceSettings.language) {
                        call.voiceSettings.language = $0
                    }
                }
                .frame(maxHeight: 224)
            }
            advanced
        }
        .padding(.horizontal, 4)
        .padding(.bottom, 8)
    }

    // MARK: Advanced

    private var advancedOpen: Bool { call.callSettings.advancedOpen }

    private var advanced: some View {
        VStack(alignment: .leading, spacing: 0) {
            Rectangle().fill(CallTheme.hairline.opacity(0.5)).frame(height: 0.5)
            Button {
                withAnimation(motion) { call.callSettings.advancedOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Text(String(localized: "Advanced"))
                        .font(.system(size: 13 * scale))
                        .foregroundStyle(CallTheme.inkSecondary)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12 * scale, weight: .semibold))
                        .foregroundStyle(CallTheme.inkSecondary)
                        .rotationEffect(.degrees(advancedOpen ? 90 : 0))
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityValue(advancedOpen ? Text(String(localized: "Expanded")) : Text(String(localized: "Collapsed")))
            .accessibilityIdentifier("call-advanced")
            // closed, the rows stay laid out at their width but take no
            // height, cannot be reached and are hidden from VoiceOver
            advancedRows
                .fixedSize(horizontal: false, vertical: true)
                .frame(height: advancedOpen ? nil : 0, alignment: .top)
                .clipped()
                .opacity(advancedOpen ? 1 : 0)
                .allowsHitTesting(advancedOpen)
                .accessibilityHidden(!advancedOpen)
        }
        .padding(.top, 4)
    }

    private var advancedRows: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 12) {
                Text(String(localized: "Microphone")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
                Spacer(minLength: 8)
                Picker(String(localized: "Microphone"), selection: $call.callSettings.input) {
                    Text(String(localized: "Hands-free")).tag(CallSettings.Input.auto)
                    Text(String(localized: "Push to talk")).tag(CallSettings.Input.push)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
                .accessibilityIdentifier("call-input")
            }
            .padding(.vertical, 6)
            HStack(spacing: 12) {
                Text(String(localized: "End of turn")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
                Spacer(minLength: 8)
                Picker(String(localized: "End of turn"), selection: $call.callSettings.pause) {
                    Text(String(localized: "Short")).tag(CallPause.short)
                    Text(String(localized: "Normal")).tag(CallPause.normal)
                    Text(String(localized: "Patient")).tag(CallPause.patient)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 200)
                .accessibilityIdentifier("call-pause")
            }
            .padding(.vertical, 6)
            Text(String(localized: "How long a pause ends what you say. An unfinished sentence always gets more time."))
                .font(.system(size: 11.5 * scale))
                .foregroundStyle(CallTheme.inkTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 4)
            onlyMyVoice
            Toggle(isOn: $call.callSettings.earcons) {
                Text(String(localized: "Call sounds")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
            }
            .tint(Theme.toggleOn)
            .padding(.vertical, 6)
            .accessibilityIdentifier("call-earcons")
            Toggle(isOn: $call.callSettings.thinkingCue) {
                Text(String(localized: "Soft tone while a slow answer is coming")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
            }
            .tint(Theme.toggleOn)
            .padding(.vertical, 6)
            .accessibilityIdentifier("call-thinking-cue")
            Toggle(isOn: $call.callSettings.fullDuplex) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(String(localized: "Full-duplex conversation")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
                    Text(String(localized: "Talk over the bot at any time. It stops its current answer and never stacks the next ones. On by default here. Turn off to have words said while it works join that turn."))
                        .font(.system(size: 11.5 * scale))
                        .foregroundStyle(CallTheme.inkTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .tint(Theme.toggleOn)
            .padding(.vertical, 6)
            .accessibilityIdentifier("call-full-duplex")
        }
    }

    /// "Only my voice" (the desktop's switch and its enrollment row): on
    /// without a recorded voice, the switch records one first.
    @ViewBuilder
    private var onlyMyVoice: some View {
        let enrolled = call.enrollment == .enrolled
        Toggle(isOn: Binding(
            get: { call.callSettings.onlyMyVoice && enrolled },
            set: { on in
                if on && !enrolled { call.enroll() } else { call.callSettings.onlyMyVoice = on }
            }
        )) {
            VStack(alignment: .leading, spacing: 2) {
                Text(String(localized: "Only my voice")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
                Text(String(localized: "Record a few seconds of your voice once: the call then ignores other voices (a TV, a colleague). Your voiceprint stays on this device."))
                    .font(.system(size: 11.5 * scale))
                    .foregroundStyle(CallTheme.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .tint(Theme.toggleOn)
        .padding(.vertical, 6)
        .accessibilityIdentifier("call-only-my-voice")
        enrollmentRow
            .padding(.bottom, 6)
    }

    @ViewBuilder
    private var enrollmentRow: some View {
        switch call.enrollment {
        case let .recording(share):
            let percent = Int((share * 100).rounded())
            VStack(alignment: .leading, spacing: 4) {
                Text(String(localized: "Keep talking, read anything aloud (\(percent)%)"))
                    .font(.system(size: 12.5 * scale))
                    .foregroundStyle(CallTheme.ink)
                    .accessibilityIdentifier("call-enrolling")
                ProgressView(value: min(1, max(0, share)))
                    .tint(CallTheme.accent)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        default:
            VStack(alignment: .leading, spacing: 6) {
                if call.enrollment == .enrolled {
                    Text(String(localized: "Your voice is enrolled.")).font(.system(size: 12.5 * scale)).foregroundStyle(CallTheme.ink)
                } else if call.enrollment == .failed {
                    Text(String(localized: "Not enough speech was heard. Try again somewhere quieter."))
                        .font(.system(size: 12.5 * scale))
                        .foregroundStyle(CallTheme.warning)
                        .fixedSize(horizontal: false, vertical: true)
                }
                HStack(spacing: 8) {
                    Button(call.enrollment == .enrolled ? String(localized: "Record again") : String(localized: "Record my voice")) {
                        call.enroll()
                    }
                    .font(.system(size: 12.5 * scale))
                    .foregroundStyle(CallTheme.ink)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(CallTheme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("call-enroll")
                    if call.enrollment == .enrolled {
                        Button(String(localized: "Forget my voice")) { call.forgetVoice() }
                            .font(.system(size: 12.5 * scale))
                            .foregroundStyle(CallTheme.inkSecondary)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("call-forget-voice")
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    // MARK: Voice, speed, language

    /// The bot this call speaks for (its provider decides which voice slot).
    private var voiceBotId: String? {
        if case let .bot(bot)? = call.target { return bot.id }
        return nil
    }

    private var voiceName: String {
        let id = call.voiceSettings.forBot(voiceBotId).voice
        guard !id.isEmpty else { return String(localized: "Provider's default voice") }
        return call.voices?.first { $0.id == id }?.label ?? id
    }

    private var languageName: String {
        call.voiceSettings.language == "auto" ? String(localized: "Auto-detect") : VoiceModeSettings.languageLabel(call.voiceSettings.language)
    }

    /// A label, then the value in a raised button that opens its list.
    private func row(_ label: String, value: String, list: List) -> some View {
        let expanded = open == list
        return HStack(spacing: 12) {
            Text(label).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkSecondary)
            Spacer(minLength: 8)
            Button {
                withAnimation(motion) { open = expanded ? nil : list }
            } label: {
                HStack(spacing: 8) {
                    Text(value).lineLimit(1).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.ink)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 11 * scale, weight: .semibold))
                        .foregroundStyle(CallTheme.inkSecondary)
                        .rotationEffect(.degrees(expanded ? 180 : 0))
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(minWidth: 136 * scale)
                .fixedSize(horizontal: true, vertical: false)
                .background(CallTheme.raised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text(verbatim: label))
            .accessibilityValue(Text(verbatim: value))
            .accessibilityIdentifier("call-list-\(list)")
        }
        .padding(.vertical, 6)
    }

    private var voiceList: some View {
        ScrollView {
            VStack(spacing: 0) {
                option(id: "", label: String(localized: "Provider's default voice"), selected: call.voiceSettings.forBot(voiceBotId).voice.isEmpty) { call.voiceSettings = call.voiceSettings.withVoice("", forBot: voiceBotId) }
                if call.voices == nil && call.voicesError == nil {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text(String(localized: "Loading voices")).font(.system(size: 12.5 * scale)).foregroundStyle(CallTheme.inkTertiary)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(8)
                }
                if let error = call.voicesError {
                    Text(error).font(.system(size: 12.5 * scale)).foregroundStyle(CallTheme.danger).padding(8)
                }
                ForEach(call.voices ?? []) { voice in
                    HStack(spacing: 8) {
                        Button { call.preview(voice) } label: {
                            Image(systemName: call.previewing == voice.id ? "stop.fill" : "play.fill")
                                .font(.system(size: 10 * scale))
                                .foregroundStyle(CallTheme.inkSecondary)
                                .frame(width: 24 * scale, height: 24 * scale)
                                .background(CallTheme.raised, in: Circle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(String(localized: "Preview \(voice.label)")))
                        option(id: voice.id, label: voice.label, selected: call.voiceSettings.forBot(voiceBotId).voice == voice.id) {
                            call.voiceSettings = call.voiceSettings.withVoice(voice.id, forBot: voiceBotId)
                        }
                    }
                }
            }
            .padding(4)
        }
        .frame(maxHeight: 224)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(CallTheme.hairline.opacity(0.6)))
    }

    private func options(_ values: [(String, String)], selected: String, choose: @escaping (String) -> Void) -> some View {
        VStack(spacing: 0) {
            ForEach(values, id: \.0) { value in
                option(id: value.0, label: value.1, selected: value.0 == selected) { choose(value.0) }
            }
        }
        .padding(4)
        .background(Theme.bg, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(CallTheme.hairline.opacity(0.6)))
    }

    private func option(id: String, label: String, selected: Bool, choose: @escaping () -> Void) -> some View {
        Button {
            choose()
            withAnimation(motion) { open = nil }
        } label: {
            HStack {
                Text(label).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.ink).lineLimit(1)
                Spacer()
                if selected { Image(systemName: "checkmark").font(.system(size: 12 * scale, weight: .semibold)).foregroundStyle(CallTheme.accent) }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .background(selected ? CallTheme.raised.opacity(0.6) : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Transcript

struct CallTranscriptPanel: View {
    /// the bot's or the room's name
    let name: String
    /// a room's call: the turn-taking hint under the lines
    var room = false
    @ObservedObject var call: CallController
    let status: String
    let line: String
    @EnvironmentObject private var session: Session
    @ScaledMetric(relativeTo: .body) private var rawScale: CGFloat = 1

    private var scale: CGFloat { CallBarMetrics.scale(rawScale) }

    private struct Entry: Identifiable {
        let id: String
        let you: Bool
        let text: String
        let interrupted: Bool
        let unheard: String?
    }

    private var entries: [Entry] {
        session.visibleTranscript(forThread: call.threadId)
            .filter { $0.kind == .text && !($0.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            .suffix(8)
            .map { message -> Entry in
                let raw = (message.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                // the bot's words as they are said: no raw markdown, the
                // full answer stays in the chat
                let spoken = message.role == .user ? raw : SpokenText.transcriptText(raw)
                return Entry(id: message.id, you: message.role == .user, text: spoken.isEmpty ? raw : spoken, interrupted: call.interrupted.contains(message.id), unheard: call.unheard[message.id])
            }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(verbatim: name).lineLimit(1)
                Spacer()
                TimelineView(.periodic(from: call.startedAt, by: 1)) { context in
                    Text(verbatim: "\(formatCallTime(context.date.timeIntervalSince(call.startedAt))) · \(status)")
                        .monospacedDigit()
                        .accessibilityIdentifier("call-timer")
                }
            }
            .font(.system(size: 11.5 * scale))
            .foregroundStyle(CallTheme.inkTertiary)
            // who hears and speaks on this call: xAI (whose key) or Apple
            Text(verbatim: call.providerLabel)
                .font(.system(size: 11 * scale))
                .foregroundStyle(CallTheme.inkTertiary)
                .lineLimit(2)
                .accessibilityIdentifier("call-provider")
            let entries = entries
            if entries.isEmpty && line.isEmpty {
                Text(String(localized: "Nothing said yet.")).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.inkTertiary)
            } else {
                VStack(spacing: 6) {
                    ForEach(entries) { entry in
                        bubble(entry.text, you: entry.you, interrupted: entry.interrupted, unheard: entry.unheard)
                            .accessibilityIdentifier(entry.you ? "call-line-you" : "call-line-bot")
                    }
                    if !line.isEmpty {
                        bubble(line, you: call.state.phase != .speaking, interrupted: false)
                            .opacity(0.7)
                            .accessibilityIdentifier("call-line-live")
                    }
                }
            }
            if room {
                Text(String(localized: "Say a member's name to direct the turn · Talk over a member to interrupt"))
                    .font(.system(size: 11.5 * scale))
                    .foregroundStyle(CallTheme.inkTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("call-room-hint")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("call-transcript")
    }

    private func bubble(_ text: String, you: Bool, interrupted: Bool, unheard: String? = nil) -> some View {
        HStack {
            if you { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(text).font(.system(size: 13 * scale)).foregroundStyle(CallTheme.ink)
                if interrupted {
                    Text(String(localized: "interrupted"))
                        .font(.system(size: 11 * scale))
                        .foregroundStyle(CallTheme.inkTertiary)
                        .padding(.horizontal, 4)
                        .background(CallTheme.elevated.opacity(0.6), in: RoundedRectangle(cornerRadius: 4))
                }
            }
            // the cut answer's words the person never heard, marked
            if let unheard, !unheard.isEmpty {
                (Text(String(localized: "Not heard:")) + Text(verbatim: " ") + Text(unheard).italic())
                    .font(.system(size: 12 * scale))
                    .foregroundStyle(CallTheme.inkTertiary)
                    .accessibilityIdentifier("call-unheard")
            }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(you ? CallTheme.raised : CallTheme.inset, in: UnevenBubble(you: you))
            if !you { Spacer(minLength: 40) }
        }
    }
}

/// A bubble with the tail corner tucked (rounded-2xl with br-md / bl-md).
private struct UnevenBubble: Shape {
    let you: Bool
    func path(in rect: CGRect) -> Path {
        let big: CGFloat = 16, small: CGFloat = 6
        let tl = big, tr = big, bl = you ? big : small, br = you ? small : big
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + tl, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - tr, y: rect.minY))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.minY), tangent2End: CGPoint(x: rect.maxX, y: rect.minY + tr), radius: tr)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - br))
        path.addArc(tangent1End: CGPoint(x: rect.maxX, y: rect.maxY), tangent2End: CGPoint(x: rect.maxX - br, y: rect.maxY), radius: br)
        path.addLine(to: CGPoint(x: rect.minX + bl, y: rect.maxY))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.maxY), tangent2End: CGPoint(x: rect.minX, y: rect.maxY - bl), radius: bl)
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + tl))
        path.addArc(tangent1End: CGPoint(x: rect.minX, y: rect.minY), tangent2End: CGPoint(x: rect.minX + tl, y: rect.minY), radius: tl)
        path.closeSubpath()
        return path
    }
}

// MARK: - A room's call (GroupCallView, in the bar)

/// The members' faces in the bar's avatar seat: up to three, overlapping,
/// the one speaking (or working) ringed and in front, "+N" for the rest.
/// Each face wears what its member is doing (GroupCallView's member cards).
struct CallRoomFaces: View {
    let room: Room
    let members: [Bot]
    @ObservedObject var call: CallController
    let side: CGFloat

    static let shown = 3
    /// how far each next face sits from the last, a share of a face
    static let step: CGFloat = 0.55

    private var speakingId: String? { call.speakingMemberId }
    private var workingId: String? { room.busyBotId }
    private var focusId: String? { speakingId ?? workingId }

    /// The faces drawn: the focused member always among them.
    static func visible(_ members: [Bot], focus: String?) -> [Bot] {
        var faces = Array(members.prefix(shown))
        if let focus, !faces.contains(where: { $0.id == focus }), let member = members.first(where: { $0.id == focus }) {
            faces[faces.count - 1] = member
        }
        return faces
    }

    var body: some View {
        let faces = Self.visible(members, focus: focusId)
        let extra = members.count - faces.count
        let width = side + CGFloat(max(0, faces.count - 1)) * side * Self.step
        ZStack(alignment: .leading) {
            ForEach(Array(faces.enumerated()), id: \.element.id) { index, member in
                let focused = member.id == focusId
                BotMascotView(bot: member, size: side, state: state(of: member), animated: true)
                    .frame(width: side, height: side)
                    .background(CallTheme.elevated, in: Circle())
                    .overlay(Circle().stroke(focused ? CallTheme.accent : CallTheme.elevated, lineWidth: focused ? 2 : 1.5))
                    .scaleEffect(focused ? 1 : 0.92)
                    .opacity(focusId == nil || focused ? 1 : 0.8)
                    .offset(x: CGFloat(index) * side * Self.step)
                    .zIndex(focused ? 10 : Double(faces.count - index))
                    .accessibilityElement()
                    .accessibilityLabel(Text(verbatim: member.name))
                    .accessibilityIdentifier(focused ? "call-member-focused" : "call-member")
            }
            if extra > 0 {
                Text(verbatim: "+\(extra)")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(CallTheme.ink)
                    .padding(.horizontal, 4)
                    .padding(.vertical, 1)
                    .background(CallTheme.raised, in: Capsule())
                    .offset(x: width - 14, y: side / 2 - 8)
                    .zIndex(20)
                    .accessibilityHidden(true)
            }
        }
        .frame(width: width, height: side, alignment: .leading)
        .animation(.easeOut(duration: 0.2), value: focusId)
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("call-room-faces")
    }

    private func state(of member: Bot) -> MausState {
        if speakingId == member.id { return .sending }
        if workingId == member.id { return .working }
        if [.listening, .hearing].contains(call.state.phase) { return .listening }
        return MausState.normalize(member.mascotExpression) ?? .happy
    }
}

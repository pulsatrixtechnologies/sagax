import AVFoundation
import CompanionCore
import SwiftUI

/// The one-voice rule for transcript audio: playing one note pauses any
/// other, exactly as the web bubble's claimExternalVoice does. The audio
/// session itself arbitrates against call mode — its reconfiguration
/// arrives here as an interruption, which pauses the holder. The current
/// holder is weak: a bubble scrolled out of the transcript releases itself.
///
/// The session this coordinates is process-wide, so the arbiter is too:
/// dictation and calls file through the same instance before they
/// reconfigure the shared session for recording.
@MainActor
final class VoiceNoteCenter {
    static let shared = VoiceNoteCenter()

    enum InputOwner: String { case dictation, call, voiceNote }

    private weak var current: VoiceNotePlayer?
    private var inputOwners: Set<InputOwner> = []
    /// True while a voice-note player configured the shared session for
    /// playback and no input owner has taken it since.
    private var ownsPlaybackSession = false

    func claim(_ player: VoiceNotePlayer) {
        if current !== player { current?.pause() }
        current = player
    }

    func release(_ player: VoiceNotePlayer) {
        if current === player { current = nil }
    }

    /// An input owner is about to reconfigure the shared session for
    /// recording: pause the audible note here, and keep playback off until
    /// the owner returns the session. Starting another in-app owner does
    /// not reliably fire interruptionNotification, so this is explicit.
    func beginInputOwnership(_ owner: InputOwner) {
        inputOwners.insert(owner)
        current?.pause()
        ownsPlaybackSession = false
    }

    func endInputOwnership(_ owner: InputOwner) {
        inputOwners.remove(owner)
    }

    /// Claim the shared session for playback. Rejected while an input
    /// owner holds it, so starting dictation or a call silences the
    /// transcript instead of the two fighting over the route.
    func beginPlaybackSession() -> Bool {
        guard inputOwners.isEmpty else { return false }
        ownsPlaybackSession = true
        return true
    }

    /// Give the session back — but only if a voice-note player still owns
    /// it. Deactivating while dictation or a call holds the session would
    /// end their capture.
    func endPlaybackSession() {
        guard ownsPlaybackSession else { return }
        ownsPlaybackSession = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

/// Plays one parked voice-note clip: load, play, pause, scrub, and the
/// interruption pause the umbrella spec requires. Bytes arrive through the
/// authenticated attachment route and the session cache, so replay never
/// refetches.
@MainActor
final class VoiceNotePlayer: NSObject, ObservableObject {
    @Published private(set) var isPlaying = false
    @Published private(set) var elapsed: Double = 0
    /// Real duration once the clip loads; until then the bubble shows the
    /// server's durationMs estimate.
    @Published private(set) var loadedDuration: Double?
    /// Playback speed, 1x -> 1.5x -> 2x (the web bubble's speed button).
    @Published private(set) var rate: Float = 1

    static let rates: [Float] = [1, 1.5, 2]

    private var player: AVAudioPlayer?
    private var ticker: Timer?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(sessionWasInterrupted(_:)),
            name: AVAudioSession.interruptionNotification,
            object: nil
        )
    }

    func load(_ data: Data) throws {
        let player = try AVAudioPlayer(data: data)
        player.delegate = self
        player.enableRate = true
        player.rate = rate
        player.prepareToPlay()
        self.player = player
        loadedDuration = player.duration > 0 ? player.duration : nil
        elapsed = 0
        isPlaying = false
    }

    /// Drop a loaded clip so a retry can fetch fresh bytes.
    func reset() {
        pause()
        player = nil
        loadedDuration = nil
        elapsed = 0
    }

    func play() {
        guard let player, player.duration > 0,
              VoiceNoteCenter.shared.beginPlaybackSession() else { return }
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default)
        try? session.setActive(true)
        guard player.play() else {
            VoiceNoteCenter.shared.endPlaybackSession()
            return
        }
        isPlaying = true
        startTicker()
    }

    func pause() {
        player?.pause()
        isPlaying = false
        stopTicker()
    }

    func cycleRate() {
        let index = Self.rates.firstIndex(of: rate) ?? -1
        rate = Self.rates[(index + 1) % Self.rates.count]
        player?.rate = rate
    }

    func seek(to time: Double) {
        guard let player else { return }
        let target = min(max(0, time), player.duration)
        player.currentTime = target
        elapsed = target
    }

    private func startTicker() {
        stopTicker()
        let timer = Timer(timeInterval: 0.2, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }

    private func stopTicker() {
        ticker?.invalidate()
        ticker = nil
    }

    private func tick() {
        guard let player, isPlaying else { return }
        elapsed = player.currentTime
    }

    @objc private func sessionWasInterrupted(_ note: Notification) {
        let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey]
        let value = (raw as? NSNumber)?.uintValue ?? (raw as? UInt)
        if value == AVAudioSession.InterruptionType.began.rawValue {
            pause()
            VoiceNoteCenter.shared.endPlaybackSession()
        }
    }

    private func finished() {
        isPlaying = false
        stopTicker()
        // Rewind so pressing play again replays instead of sitting at the
        // end of the clip.
        seek(to: 0)
        VoiceNoteCenter.shared.endPlaybackSession()
    }
}

extension VoiceNotePlayer: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in self.finished() }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in self.finished() }
    }
}

/// One voice note in the transcript: a play button, a scrub bar, and the
/// clip's length — the iOS match of the web bubble in PR #1801, whose
/// behavior is this slice's contract. The transcript stays the message
/// body; this bubble is the playable clip beside it.
struct VoiceNoteBubble: View {
    @Environment(\.themePalette) var themePalette
    let note: MessageVoiceNote
    var tint: Color = .accentColor
    /// A note the person recorded (an attached `voice-note-*.wav`): loaded
    /// through its message's file route instead of the bots' clip route.
    var recordedIn: (threadId: String, messageId: String)?
    /// The message text, used only when the clip has no word times of its own.
    var transcript: String? = nil

    @EnvironmentObject private var session: Session
    @StateObject private var player = VoiceNotePlayer()
    @State private var loading = true
    @State private var loadFailed = false
    @State private var attempt = 0

    /// The server's estimate until the clip loads its own metadata.
    private var duration: Double? {
        if let loaded = player.loadedDuration, loaded > 0 { return loaded }
        if let ms = note.durationMs, ms > 0 { return ms / 1000 }
        return nil
    }

    private var timeText: String {
        let total = duration.map(Self.clock) ?? "--:--"
        return "\(Self.clock(player.elapsed)) / \(total)"
    }

    private var timeBinding: Binding<Double> {
        Binding(
            get: { player.elapsed },
            set: { player.seek(to: $0) }
        )
    }

    private var words: [VoiceNoteWord] {
        if let given = note.words, !given.isEmpty { return given }
        return VoiceNoteWords.aligned(transcript: transcript, duration: duration ?? 0)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            controls
            if !words.isEmpty {
                VoiceNoteWordWrap(spacing: 4) {
                    ForEach(Array(words.enumerated()), id: \.offset) { index, word in
                        let current = VoiceNoteWords.index(at: player.elapsed, in: words) == index
                        Button {
                            player.seek(to: word.start)
                            if !player.isPlaying {
                                VoiceNoteCenter.shared.claim(player)
                                player.play()
                            }
                        } label: {
                            Text(verbatim: word.text)
                                .font(.system(size: 12.5))
                                .foregroundStyle(current ? Theme.textPrimary : Theme.textSecondary)
                                .padding(.horizontal, 2)
                                .background(current ? tint.opacity(0.15) : Color.clear, in: RoundedRectangle(cornerRadius: 3))
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("Go to \(word.text) in the voice note"))
                        .accessibilityIdentifier("voice-note-word.\(index)")
                    }
                }
                .accessibilityIdentifier("voice-note-words")
            }
        }
    }

    private var controls: some View {
        HStack(spacing: 10) {
            Button {
                if player.isPlaying {
                    player.pause()
                } else {
                    VoiceNoteCenter.shared.claim(player)
                    player.play()
                }
            } label: {
                Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(tint))
            }
            .buttonStyle(.plain)
            .disabled(loading || loadFailed || duration == nil)
            .accessibilityIdentifier("voice-note-play")
            .accessibilityLabel(player.isPlaying ? Text("Pause voice note") : Text("Play voice note"))

            if loading {
                ProgressView()
                    .controlSize(.small)
                    .frame(maxWidth: .infinity)
            } else if loadFailed {
                failure
            } else {
                Slider(value: timeBinding, in: 0...Swift.max(duration ?? 1, 0.1))
                    .tint(tint)
                    .accessibilityLabel(Text("Voice note position"))
                Text(timeText)
                    .font(.system(size: 11))
                    .monospacedDigit()
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityIdentifier("voice-note-time")
                Button {
                    player.cycleRate()
                } label: {
                    Text(verbatim: Self.rateLabel(player.rate))
                        .font(.system(size: 11, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(Theme.textSecondary)
                        .frame(minWidth: 30, minHeight: 22)
                        .background(Capsule().fill(Theme.textSecondary.opacity(0.12)))
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("voice-note-speed")
                .accessibilityLabel(Text("Playback speed"))
                .accessibilityValue(Text(verbatim: Self.rateLabel(player.rate)))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Theme.inset)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice-note")
        .task(id: "\(note.path)#\(attempt)") {
            guard player.loadedDuration == nil, !loadFailed else { return }
            let loaded: Data?
            if let recordedIn {
                loaded = await session.recordedVoiceNoteData(threadId: recordedIn.threadId, messageId: recordedIn.messageId, path: note.path)
            } else {
                loaded = await session.voiceNoteData(for: note)
            }
            guard let data = loaded, !Task.isCancelled else {
                if !Task.isCancelled {
                    loadFailed = true
                    loading = false
                }
                return
            }
            do {
                try player.load(data)
                loadFailed = false
            } catch {
                loadFailed = true
            }
            loading = false
        }
        .onValueChange(of: player.isPlaying) { playing in
            if !playing { VoiceNoteCenter.shared.release(player) }
        }
        .onDisappear {
            player.pause()
            VoiceNoteCenter.shared.release(player)
        }
    }

    private var failure: some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle.fill")
                .accessibilityHidden(true)
            Text("Couldn’t load the voice note.")
                .font(.system(size: 12))
            Spacer(minLength: 4)
            Button("Retry") {
                player.reset()
                loadFailed = false
                loading = true
                attempt += 1
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(tint)
        }
        .foregroundStyle(Theme.textSecondary)
    }

    private static func rateLabel(_ rate: Float) -> String {
        rate == rate.rounded() ? "\(Int(rate))x" : "\(rate)x"
    }

    private static func clock(_ seconds: Double) -> String {
        guard seconds.isFinite, seconds > 0 else { return "0:00" }
        let whole = Int(seconds.rounded(.down))
        return String(format: "%d:%02d", whole / 60, whole % 60)
    }
}

/// Words of a voice note, wrapped on the bubble's width.
private struct VoiceNoteWordWrap: Layout {
    var spacing: CGFloat = 4

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 280
        var x: CGFloat = 0
        var y: CGFloat = 0
        var row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > 0, x + size.width > width {
                x = 0
                y += row + spacing
                row = 0
            }
            row = max(row, size.height)
            x += size.width + spacing
        }
        return CGSize(width: width, height: y + row)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX
        var y = bounds.minY
        var row: CGFloat = 0
        for view in subviews {
            let size = view.sizeThatFits(.unspecified)
            if x > bounds.minX, x + size.width > bounds.maxX {
                x = bounds.minX
                y += row + spacing
                row = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            row = max(row, size.height)
            x += size.width + spacing
        }
    }
}

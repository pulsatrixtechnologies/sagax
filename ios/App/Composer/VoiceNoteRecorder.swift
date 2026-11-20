// The composer's voice note recorder (the desktop's useVoiceNoteRecorder,
// PR #601): one recording at a time, a 16 kHz mono WAV from AVAudioRecorder
// with metering for the live waveform, five minutes at most. The rules (file
// name, bars, WAV, clips, hold or tap) are VoiceNoteRecording in
// CompanionCore; this is the part that needs a microphone.
//
// The watch's push-to-talk records with this same recorder (#5129); the
// phone's audio session bookkeeping (VoiceNoteCenter), its haptics and the
// composer's strip stay on the phone.
import AVFoundation
import CompanionCore
import SwiftUI
#if os(watchOS)
import WatchKit
#endif

@MainActor
final class VoiceNoteRecorder: ObservableObject {
    enum Phase: Equatable { case idle, starting, recording, sending }
    /// How the recording was started: a held mic sends on release, the +
    /// menu's entry keeps going until Send or Cancel.
    enum Mode: Equatable { case hold, toggle }

    /// What the composer gets back: the clean WAV and its length.
    struct Clip {
        let wav: Data
        let pcm: Data
        let sampleRate: Int
        let name: String
        let seconds: Double
    }

    @Published private(set) var phase: Phase = .idle
    @Published private(set) var mode: Mode = .toggle
    @Published private(set) var seconds: Double = 0
    @Published private(set) var bars: [Double] = Array(repeating: 0, count: VoiceNoteRecording.bars)
    /// A hold slid far enough left that letting go cancels.
    @Published var cancelArmed = false
    @Published var error: LocalizedStringKey?

    /// The five-minute cap was reached: the composer sends what it has.
    var onCapped: (() -> Void)?

    private var recorder: AVAudioRecorder?
    private var fileURL: URL?
    private var ticker: Timer?
    private var levels: [Double] = []
    /// Bumped on every start and stop, so a permission answer that lands
    /// after the person let go never opens the microphone.
    private var generation = 0

    var isActive: Bool { phase != .idle }
    var isRecording: Bool { phase == .recording }

    func start(mode: Mode) {
        guard phase == .idle else { return }
        error = nil
        cancelArmed = false
        // The first permission prompt takes the touch away from a held mic,
        // so that recording carries on with Send and Cancel instead.
        self.mode = mode == .hold && MicrophonePermission.undetermined ? .toggle : mode
        phase = .starting
        generation += 1
        let gen = generation
        Task { await begin(generation: gen) }
    }

    private func begin(generation gen: Int) async {
        let allowed = await MicrophonePermission.request()
        guard gen == generation, phase == .starting else { return }
        guard allowed else {
            phase = .idle
            error = "Allow the microphone in Settings to record a voice note."
            return
        }
        #if os(iOS)
        VoiceNoteCenter.shared.beginInputOwnership(.voiceNote)
        #endif
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .default)
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            let url = FileManager.default.temporaryDirectory
                .appendingPathComponent("voice-note-\(UUID().uuidString).wav")
            let settings: [String: Any] = [
                AVFormatIDKey: kAudioFormatLinearPCM,
                AVSampleRateKey: Double(VoiceNoteRecording.sampleRate),
                AVNumberOfChannelsKey: 1,
                AVLinearPCMBitDepthKey: 16,
                AVLinearPCMIsFloatKey: false,
                AVLinearPCMIsBigEndianKey: false,
            ]
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            guard recorder.record(forDuration: VoiceNoteRecording.maxSeconds + 1) else {
                throw CocoaError(.fileWriteUnknown)
            }
            self.recorder = recorder
            fileURL = url
            levels = []
            seconds = 0
            bars = VoiceNoteRecording.waveformBars([])
            phase = .recording
            startTicker()
            #if os(iOS)
            Haptics.impact(.medium)
            #else
            WKInterfaceDevice.current().play(.start)
            #endif
        } catch {
            teardown()
            phase = .idle
            self.error = "Couldn't start the microphone."
        }
    }

    /// Stops and returns the clip, or nil (too short, unreadable). The
    /// composer moves the phase to `.sending` and back.
    func finish() -> Clip? {
        guard phase == .recording || phase == .starting else { return nil }
        let wasRecording = phase == .recording
        generation += 1
        let url = fileURL
        recorder?.stop()
        teardown()
        phase = .idle
        guard wasRecording, let url, let raw = try? Data(contentsOf: url) else { return nil }
        try? FileManager.default.removeItem(at: url)
        guard let parsed = VoiceNoteRecording.pcm(fromWAV: raw), parsed.channels == 1 else {
            error = "Couldn't record the voice note."
            return nil
        }
        let length = VoiceNoteRecording.duration(pcmBytes: parsed.samples.count, sampleRate: parsed.sampleRate)
        guard length >= VoiceNoteRecording.minSeconds else {
            error = "Too short: hold a little longer to record a voice note."
            return nil
        }
        return Clip(
            wav: VoiceNoteRecording.wav(pcm: parsed.samples, sampleRate: parsed.sampleRate),
            pcm: parsed.samples,
            sampleRate: parsed.sampleRate,
            name: VoiceNoteRecording.fileName(),
            seconds: length
        )
    }

    /// Stops and throws the recording away.
    func cancel() {
        guard phase == .recording || phase == .starting else { return }
        generation += 1
        let url = fileURL
        recorder?.stop()
        recorder?.deleteRecording()
        teardown()
        if let url { try? FileManager.default.removeItem(at: url) }
        phase = .idle
        #if os(iOS)
        Haptics.selection()
        #else
        WKInterfaceDevice.current().play(.retry)
        #endif
    }

    func markSending(_ sending: Bool) {
        phase = sending ? .sending : .idle
    }

    private func teardown() {
        stopTicker()
        recorder = nil
        fileURL = nil
        cancelArmed = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        #if os(iOS)
        VoiceNoteCenter.shared.endInputOwnership(.voiceNote)
        #endif
    }

    // the timer and the waveform repaint every 80 ms, as on the desktop
    private func startTicker() {
        stopTicker()
        let timer = Timer(timeInterval: 0.08, repeats: true) { [weak self] _ in
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
        guard let recorder, phase == .recording else { return }
        recorder.updateMeters()
        levels.append(VoiceNoteRecording.level(fromDecibels: recorder.averagePower(forChannel: 0)))
        if levels.count > 256 { levels.removeFirst(levels.count - 128) }
        seconds = recorder.currentTime
        bars = VoiceNoteRecording.waveformBars(levels)
        if seconds >= VoiceNoteRecording.maxSeconds { onCapped?() }
    }
}

#if os(iOS)
/// The strip that takes the field's place while a voice note records: a red
/// dot, the timer and the waveform, then Cancel and Send (from the + menu) or
/// "Slide left to cancel" (while the mic is held).
struct VoiceNoteRecordingStrip: View {
    @ObservedObject var recorder: VoiceNoteRecorder
    let tint: Color
    let cancel: () -> Void
    let send: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            if recorder.mode == .toggle || recorder.phase == .sending {
                Button(action: cancel) {
                    Image(systemName: "xmark")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Theme.textSecondary)
                        .frame(width: 30, height: 30)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(recorder.phase == .sending)
                .accessibilityLabel(Text("Cancel voice note"))
                .accessibilityIdentifier("voice-note-cancel")
            }

            Circle()
                .fill(Theme.danger)
                .frame(width: 8, height: 8)
                .opacity(recorder.phase == .recording ? 1 : 0.35)
                .accessibilityHidden(true)

            Text(verbatim: VoiceNoteRecording.clock(recorder.seconds))
                .font(.system(size: 14, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("voice-note-timer")

            if recorder.phase == .sending {
                ProgressView().controlSize(.small)
                Text("Sending…")
                    .font(.system(size: 14))
                    .foregroundStyle(Theme.textSecondary)
                Spacer(minLength: 0)
            } else if recorder.mode == .hold {
                Text(recorder.cancelArmed ? "Release to cancel" : "Slide left to cancel")
                    .font(.system(size: 13))
                    .foregroundStyle(recorder.cancelArmed ? Theme.danger : Theme.textSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 0)
            } else {
                waveform
            }

            if recorder.mode == .toggle, recorder.phase != .sending {
                Button(action: send) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(tint))
                }
                .buttonStyle(.plain)
                .disabled(recorder.phase != .recording)
                .accessibilityLabel(Text("Send voice note"))
                .accessibilityIdentifier("voice-note-send")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, 6)
        .frame(minHeight: Theme.Metric.glassLarge)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("voice-note-recorder")
        .accessibilityLabel(Text("Recording a voice note"))
    }

    private var waveform: some View {
        HStack(alignment: .center, spacing: 2) {
            ForEach(Array(recorder.bars.enumerated()), id: \.offset) { _, level in
                Capsule()
                    .fill(Theme.textSecondary)
                    .frame(width: 2.5, height: max(3, 22 * level))
            }
        }
        .frame(maxWidth: .infinity, minHeight: 24)
        .animation(.linear(duration: 0.08), value: recorder.bars)
        .accessibilityHidden(true)
    }
}
#endif

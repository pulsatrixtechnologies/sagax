import AVFoundation
import CompanionCore
import Foundation

/// The watch's microphone for an in-person meeting (#5130): one AVAudioEngine
/// input, converted to 16 kHz mono 16-bit PCM and cut every
/// MeetingRecording.chunkSeconds into a WAV handed to `onChunk`, with no gap
/// between chunks. It started in the foreground with the app's `audio`
/// background mode, so it keeps going with the wrist down. An interruption
/// (a call, Siri) pauses it; it starts again when the system gives the
/// microphone back.
final class WatchMeetingRecorder: @unchecked Sendable {
    /// A chunk was cut: its WAV and when its first sample was heard.
    var onChunk: (@Sendable (_ wav: Data, _ startedAt: Date) -> Void)?

    private let engine = AVAudioEngine()
    private let queue = DispatchQueue(label: "ca.pulsatrix.sagax.meeting.chunks")
    private let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(MeetingRecording.sampleRate), channels: 1, interleaved: true)!
    private var converter: AVAudioConverter?
    private var pending = Data()
    private var chunkStart = Date()
    private var observers: [NSObjectProtocol] = []
    /// Chunks handed out so far (on `queue`).
    private var emitted = 0
    private(set) var running = false

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        try startEngine()
        running = true
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: session, queue: .main) { [weak self] note in
            guard let self, self.running else { return }
            let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
            if raw.flatMap(AVAudioSession.InterruptionType.init(rawValue:)) == .ended {
                try? session.setActive(true)
                try? self.startEngine()
            }
        })
        observers.append(center.addObserver(forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
            guard let self, self.running, !self.engine.isRunning else { return }
            try? self.startEngine()
        })
    }

    /// Stops and cuts the last chunk (dropped when shorter than half a
    /// second). Returns how many chunks were handed out in all.
    @discardableResult
    func stop() -> Int {
        running = false
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
        observers = []
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        let total = queue.sync { () -> Int in
            self.cut(force: true)
            return self.emitted
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        return total
    }

    private func startEngine() throws {
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else { throw CocoaError(.featureUnsupported) }
        converter = AVAudioConverter(from: format, to: target)
        input.installTap(onBus: 0, bufferSize: 4_096, format: format) { [weak self] buffer, _ in
            self?.captured(buffer)
        }
        engine.prepare()
        try engine.start()
    }

    private func captured(_ buffer: AVAudioPCMBuffer) {
        guard let converter else { return }
        let ratio = target.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 32
        guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
        var given = false
        var error: NSError?
        converter.convert(to: out, error: &error) { _, status in
            if given { status.pointee = .noDataNow; return nil }
            given = true
            status.pointee = .haveData
            return buffer
        }
        guard error == nil, out.frameLength > 0, let samples = out.int16ChannelData?[0] else { return }
        let bytes = Data(bytes: samples, count: Int(out.frameLength) * 2)
        queue.async { [weak self] in
            guard let self else { return }
            if self.pending.isEmpty { self.chunkStart = Date() }
            self.pending.append(bytes)
            self.cut(force: false)
        }
    }

    /// On `queue`: a full chunk goes out; at the stop, what is left does.
    private func cut(force: Bool) {
        while pending.count >= MeetingRecording.chunkBytes {
            let pcm = pending.prefix(MeetingRecording.chunkBytes)
            pending.removeFirst(MeetingRecording.chunkBytes)
            let start = chunkStart
            chunkStart = start.addingTimeInterval(TimeInterval(MeetingRecording.chunkSeconds))
            emitted += 1
            onChunk?(VoiceNoteRecording.wav(pcm: Data(pcm)), start)
        }
        guard force else { return }
        let seconds = VoiceNoteRecording.duration(pcmBytes: pending.count, sampleRate: MeetingRecording.sampleRate)
        if seconds >= MeetingRecording.minChunkSeconds {
            emitted += 1
            onChunk?(VoiceNoteRecording.wav(pcm: pending), chunkStart)
        }
        pending = Data()
    }
}

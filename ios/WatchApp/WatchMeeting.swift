import CompanionCore
import SwiftUI
import WatchKit

/// An in-person meeting heard by the watch (#5130, D-20261120-005): one at a
/// time. The microphone (WatchMeetingRecorder) cuts chunks to disk; the loop
/// here carries them to the bot's listening session of purpose "meeting" in
/// order (MeetingQueue): each heard by the app's speech to text, sent as a
/// line, its audio deleted. A lost connection waits and tries again; a
/// relaunch picks the queue up from disk. At the stop, once every chunk is
/// sent, the server gives the bot the meeting notes to write and keep.
///
/// The transport is the watch's URLSession, which watchOS routes through
/// the paired iPhone when it is near, else Wi-Fi or cellular: one path.
@MainActor
final class WatchMeeting: ObservableObject {
    static let shared = WatchMeeting()

    /// The meeting being heard or still being sent.
    @Published private(set) var queue: MeetingQueue?
    /// The microphone is on: the red pill shows.
    @Published private(set) var recording = false
    /// The last try failed: the chunks wait on the watch.
    @Published private(set) var waitingForNetwork = false
    @Published private(set) var problem: LocalizedStringKey?
    /// The bot whose meeting was just all sent: its screen says the notes come.
    @Published private(set) var sentFor: String?

    private var recorder: WatchMeetingRecorder?
    private var loop: Task<Void, Never>?
    private var wake: CheckedContinuation<Void, Never>?
    private weak var session: WatchSession?
    private var failures = 0

    /// When the person started, for the pill's clock.
    var startedAt: Date? { queue.map { Date(timeIntervalSince1970: $0.startedAt / 1000) } }

    func isLive(botId: String) -> Bool { recording && queue?.botId == botId }

    // MARK: - Starting and stopping

    /// Starts listening for this bot's conversation. The microphone must
    /// start while the app is in front (watchOS), so this is the person's tap.
    func start(bot: Bot, threadId: String, session: WatchSession) async {
        guard queue == nil else { return }
        self.session = session
        problem = nil
        sentFor = nil
        guard await MicrophonePermission.request() else {
            problem = "Allow the microphone for Sagax in Settings."
            return
        }
        let fresh = MeetingQueue(botId: bot.id, threadId: threadId, startedAt: Date().timeIntervalSince1970 * 1000)
        let recorder = WatchMeetingRecorder()
        recorder.onChunk = { wav, startedAt in
            Task { @MainActor in WatchMeeting.shared.cut(wav, at: startedAt) }
        }
        do {
            try FileManager.default.createDirectory(at: Self.folder, withIntermediateDirectories: true)
            queue = fresh
            save()
            try recorder.start()
        } catch {
            queue = nil
            clearDisk()
            problem = "Couldn't start the microphone."
            return
        }
        self.recorder = recorder
        recording = true
        WKInterfaceDevice.current().play(.start)
        run()
    }

    /// The person's stop: the last chunk is cut, then everything left is
    /// sent before the stop.
    func stop() {
        guard recording else { return }
        let cut = recorder?.stop()
        recorder = nil
        recording = false
        queue?.stopped = true
        queue?.expectedChunks = cut
        save()
        WKInterfaceDevice.current().play(.stop)
        nudge()
    }

    /// At launch: a meeting left on disk (the app was stopped mid-meeting or
    /// before its last chunks went) is carried on. Its microphone is not
    /// restarted: watchOS starts one only from the person's tap.
    func resume(session: WatchSession) {
        self.session = session
        guard queue == nil, let saved = Self.load() else { return }
        var resumed = saved
        resumed.stopped = true
        queue = resumed
        save()
        run()
    }

    #if DEBUG
    /// `-watch-demo meeting`: a meeting drawn as it runs, 12 minutes in, two
    /// parts waiting, with no microphone and no network (captures).
    func demo(botId: String) {
        var shown = MeetingQueue(botId: botId, threadId: "demo", startedAt: (Date().timeIntervalSince1970 - 754) * 1000)
        shown.sessionId = "demo"
        shown.add(file: "demo-0.wav", at: shown.startedAt)
        shown.add(file: "demo-1.wav", at: shown.startedAt + 30_000)
        queue = shown
        recording = true
    }
    #endif

    // MARK: - The loop

    private func cut(_ wav: Data, at startedAt: Date) {
        guard queue != nil else { return }
        let name = "\(queue!.nextSeq).wav"
        // a chunk that could not be written still takes its place: its line is empty
        try? wav.write(to: Self.folder.appendingPathComponent(name), options: .atomic)
        queue!.add(file: name, at: startedAt.timeIntervalSince1970 * 1000)
        save()
        nudge()
    }

    private func run() {
        guard loop == nil else { return }
        loop = Task { [weak self] in
            while let self, !Task.isCancelled {
                guard await self.step() else { break }
            }
            self?.loop = nil
        }
    }

    /// One step of the queue. False when the meeting is done.
    private func step() async -> Bool {
        guard var current = queue else { return false }
        guard let client = session?.client else {
            await pause(seconds: 5)
            return true
        }
        let now = Date().timeIntervalSince1970 * 1000
        do {
            switch current.next(now: now) {
            case .done:
                finish()
                return false
            case .wait:
                await pause(seconds: 5)
                return true
            case .start:
                let info = try await client.startListening(botId: current.botId, threadId: current.threadId, purpose: MeetingRecording.purpose)
                current = queue ?? current
                current.started(sessionId: info.sessionId, at: now)
            case let .transcribe(chunk):
                let url = Self.folder.appendingPathComponent(chunk.file)
                guard let wav = try? Data(contentsOf: url), let parsed = VoiceNoteRecording.pcm(fromWAV: wav) else {
                    // the file is gone (a cleared disk): its line is empty
                    current.heard(seq: chunk.seq, text: "")
                    break
                }
                let words = try await client.transcribeRecording(pcm: parsed.samples, sampleRate: parsed.sampleRate, botId: current.botId, threadId: current.threadId)
                current = queue ?? current
                current.heard(seq: chunk.seq, text: words)
            case let .post(chunk):
                guard let sessionId = current.sessionId else { break }
                _ = try await client.addListeningLines(sessionId: sessionId, lines: [current.line(for: chunk)], speakers: [Self.room])
                current = queue ?? current
                if let sent = current.posted(seq: chunk.seq, at: now) {
                    try? FileManager.default.removeItem(at: Self.folder.appendingPathComponent(sent.file))
                }
            case .heartbeat:
                guard let sessionId = current.sessionId else { break }
                _ = try await client.addListeningLines(sessionId: sessionId, lines: [], speakers: [])
                current = queue ?? current
                current.heartbeat(at: now)
            case .stop:
                guard let sessionId = current.sessionId else { break }
                _ = try await client.stopListening(sessionId: sessionId)
                current = queue ?? current
                current.finished = true
            }
            queue = current
            save()
            failures = 0
            waitingForNetwork = false
        } catch {
            if case let APIError.status(code, _) = error, code == 404, current.sessionId != nil {
                // the session is gone from the server: a new one carries the rest
                queue?.lostSession()
                save()
                return true
            }
            failures += 1
            waitingForNetwork = true
            await session?.recover(after: error, using: client)
            await pause(seconds: MeetingRecording.retryDelay(failures: failures))
        }
        return true
    }

    private func finish() {
        sentFor = queue?.botId
        queue = nil
        waitingForNetwork = false
        clearDisk()
    }

    /// Waits, or less when a chunk is cut or the person stops.
    private func pause(seconds: TimeInterval) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            wake = continuation
            Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(seconds))
                self?.nudge()
            }
        }
    }

    private func nudge() {
        wake?.resume()
        wake = nil
    }

    // MARK: - Disk

    private static let room = ListeningSpeakerBody(key: MeetingRecording.speakerKey, label: String(localized: "Room"))

    private static var folder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("meeting", isDirectory: true)
    }

    private static var file: URL { folder.appendingPathComponent("queue.json") }

    private static func load() -> MeetingQueue? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(MeetingQueue.self, from: data)
    }

    private func save() {
        guard let queue, let data = try? JSONEncoder().encode(queue) else { return }
        try? data.write(to: Self.file, options: .atomic)
    }

    private func clearDisk() {
        try? FileManager.default.removeItem(at: Self.folder)
    }
}

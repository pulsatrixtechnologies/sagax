// An in-person meeting heard by the watch (#5130, D-20261120-005). The
// watch's microphone listens until the person stops; the audio is cut into
// chunks kept on the watch's disk, each heard by the app's own speech to text
// (`transcribeRecording`, the voice notes' `/voice/transcribe`) and sent as
// one line of a listening session of purpose "meeting"
// (server/routes/listening.ts). At the stop the server gives the bot the
// online notetaker's notes to write, kept in its memory: only where the
// audio comes from differs. No audio is kept once its line is sent.
//
// Here: the session routes' client, and the queue that survives a lost
// connection or a relaunch (MeetingQueue), as data. The microphone and the
// loop that drives the queue live in the watch app.
import Foundation

/// A listening session as the routes answer it (the fields the watch reads).
public struct ListeningSessionInfo: Decodable, Equatable, Sendable {
    public var sessionId: String
    public var state: String
    public var lineCount: Int?
    public var lastSeq: Int?
    public var purpose: String?
}

/// One final line of a listening session (shared/listening.ts ListeningLine).
public struct ListeningLineBody: Codable, Equatable, Sendable {
    public var seq: Int
    public var at: Double
    public var speaker: String
    public var text: String

    public init(seq: Int, at: Double, speaker: String, text: String) {
        self.seq = seq
        self.at = at
        self.speaker = speaker
        self.text = text
    }
}

/// A voice of the session (shared/listening.ts ListeningSpeaker).
public struct ListeningSpeakerBody: Codable, Equatable, Sendable {
    public var key: String
    public var label: String

    public init(key: String, label: String) {
        self.key = key
        self.label = label
    }
}

public extension CompanionClient {
    private struct SessionAnswer: Decodable { var session: ListeningSessionInfo }

    /// `POST /api/bots/:id/listening`: the person's session in their
    /// conversation with the bot (the live one answered again).
    func startListening(botId: String, threadId: String?, purpose: String) async throws -> ListeningSessionInfo {
        var body: [String: Any] = ["sources": ["microphone": true, "computer": false], "purpose": purpose]
        if let threadId { body["threadId"] = threadId }
        return try await send(makeRequest("POST", "/api/bots/\(botId)/listening", body: body), as: SessionAnswer.self).session
    }

    /// `POST /api/listening/:id/lines`: final lines, idempotent by seq; an
    /// empty batch is a heartbeat.
    func addListeningLines(sessionId: String, lines: [ListeningLineBody], speakers: [ListeningSpeakerBody]) async throws -> ListeningSessionInfo {
        struct Batch: Encodable { var lines: [ListeningLineBody]; var speakers: [ListeningSpeakerBody] }
        return try await send(makeRequest("POST", "/api/listening/\(sessionId)/lines", encodedBody: Batch(lines: lines, speakers: speakers)), as: SessionAnswer.self).session
    }

    /// `POST /api/listening/:id/stop`: the person's stop (again: the ended session).
    func stopListening(sessionId: String) async throws -> ListeningSessionInfo {
        try await send(makeRequest("POST", "/api/listening/\(sessionId)/stop", body: [:]), as: SessionAnswer.self).session
    }
}

public enum MeetingRecording {
    /// The purpose the session is started with.
    public static let purpose = "meeting"
    /// One chunk: about 0.96 MB of 16 kHz mono 16-bit WAV, one transcription
    /// clip, a line the chat's listening row can show soon after it is said.
    public static let chunkSeconds = 30
    public static let sampleRate = VoiceNoteRecording.sampleRate
    /// A last chunk shorter than this is dropped at the stop.
    public static let minChunkSeconds = 0.5
    /// The server ends a session it has not heard from for 5 minutes
    /// (shared/listening.ts LISTENING_IDLE_END_MS): an empty batch says the
    /// watch is still there when no chunk was sent for this long.
    public static let heartbeatSeconds: TimeInterval = 60
    /// The waits between tries after a failure, the last one repeated.
    public static let retryDelays: [TimeInterval] = [2, 5, 15, 30, 60, 120]
    /// The watch hears the room, not who speaks: one voice.
    public static let speakerKey = "room"

    public static func retryDelay(failures: Int) -> TimeInterval {
        guard failures > 0 else { return 0 }
        return retryDelays[min(failures, retryDelays.count) - 1]
    }

    /// Bytes of 16-bit mono PCM in one chunk.
    public static var chunkBytes: Int { chunkSeconds * sampleRate * 2 }
}

/// The meeting's work still to do, kept on the watch's disk so a lost
/// connection, a suspended app or a relaunch picks it up where it was.
public struct MeetingQueue: Codable, Equatable, Sendable {
    public struct Chunk: Codable, Equatable, Sendable {
        /// The line's seq: the chunk's order in the meeting.
        public var seq: Int
        /// When its first sample was heard (ms since 1970).
        public var at: Double
        /// Its WAV file, by name, in the meeting's folder.
        public var file: String
        /// Its words once heard (empty when the chunk was silence).
        public var heard: String?
    }

    /// What the loop does next.
    public enum Step: Equatable, Sendable {
        /// Open the session on the server.
        case start
        /// Hear this chunk.
        case transcribe(Chunk)
        /// Send this chunk's words as its line.
        case post(Chunk)
        /// Tell the server the watch is still there.
        case heartbeat
        /// Everything is sent: the person's stop.
        case stop
        /// Nothing to do until a chunk is cut or the person stops.
        case wait
        /// The server has the stop: the meeting is the bot's now.
        case done
    }

    public var botId: String
    public var threadId: String
    /// When the person started (ms since 1970).
    public var startedAt: Double
    public var sessionId: String?
    /// Cut and not yet sent, oldest first.
    public var chunks: [Chunk] = []
    public var nextSeq = 0
    /// The person stopped listening (the recorder is off).
    public var stopped = false
    /// How many chunks the recorder cut in all, told at the stop: the stop
    /// waits until each of them is in the queue (a chunk can land a moment
    /// after the person's tap). Nil after a relaunch: what is on disk is all.
    public var expectedChunks: Int?
    /// The server has the stop.
    public var finished = false
    /// When the server last heard from the watch (ms since 1970).
    public var lastSentAt: Double?

    public init(botId: String, threadId: String, startedAt: Double) {
        self.botId = botId
        self.threadId = threadId
        self.startedAt = startedAt
    }

    /// The next step, oldest chunk first, the stop only once all is sent.
    public func next(now: Double) -> Step {
        if finished { return .done }
        guard sessionId != nil else { return .start }
        if let first = chunks.first { return first.heard == nil ? .transcribe(first) : .post(first) }
        if stopped { return nextSeq < (expectedChunks ?? 0) ? .wait : .stop }
        if now - (lastSentAt ?? startedAt) >= MeetingRecording.heartbeatSeconds * 1000 { return .heartbeat }
        return .wait
    }

    /// A chunk was cut: it gets the next seq.
    @discardableResult
    public mutating func add(file: String, at: Double) -> Chunk {
        let chunk = Chunk(seq: nextSeq, at: at, file: file, heard: nil)
        nextSeq += 1
        chunks.append(chunk)
        return chunk
    }

    public mutating func started(sessionId: String, at now: Double) {
        self.sessionId = sessionId
        lastSentAt = now
    }

    public mutating func heard(seq: Int, text: String) {
        guard let index = chunks.firstIndex(where: { $0.seq == seq }) else { return }
        chunks[index].heard = text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Its line is on the server: the chunk (and its file) can go.
    @discardableResult
    public mutating func posted(seq: Int, at now: Double) -> Chunk? {
        lastSentAt = now
        guard let index = chunks.firstIndex(where: { $0.seq == seq }) else { return nil }
        return chunks.remove(at: index)
    }

    public mutating func heartbeat(at now: Double) { lastSentAt = now }

    /// The server no longer knows the session (it was removed): a new one
    /// carries what is left.
    public mutating func lostSession() { sessionId = nil }

    /// The line a chunk sends.
    public func line(for chunk: Chunk) -> ListeningLineBody {
        ListeningLineBody(seq: chunk.seq, at: chunk.at, speaker: MeetingRecording.speakerKey, text: chunk.heard ?? "")
    }

    /// Chunks still to send.
    public var pending: Int { chunks.count }
}

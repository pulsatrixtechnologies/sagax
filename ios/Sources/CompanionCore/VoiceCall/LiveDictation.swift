// Composer dictation over the call's listen socket (GET /voice/listen), the
// same path as the desktop's LiveTranscriber for the grey mic
// (src/lib/voice-mode/stt-stream.ts, useComposerDictation). Audio streams
// while the person speaks, partials reach the field as they come, and the
// stop only waits for xAI's answer to finalize (at most
// DICTATION_FINAL_TIMEOUT_MS). The whole clip is uploaded
// (POST /voice/transcribe) only when the socket cannot open.
import Foundation

/// After the stop, how long xAI's last words may take before the words
/// already streamed are kept as they are (desktop DICTATION_FINAL_TIMEOUT_MS).
public let DICTATION_FINAL_TIMEOUT_MS: UInt64 = 1_500

/// One JSON frame from the listen socket (server/voice/voice-listen-session.ts).
public enum ListenFrame: Equatable, Sendable {
    case ready
    case reconnected
    case transcript(text: String, final: Bool, speechFinal: Bool, requestId: String?)
    case error(String)
    case unknown

    public static func parse(_ text: String) -> ListenFrame {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String
        else { return .unknown }
        switch type {
        case "ready": return .ready
        case "reconnected": return .reconnected
        case "error": return .error((json["message"] as? String) ?? "")
        case "transcript":
            return .transcript(
                text: (json["text"] as? String) ?? "",
                final: json["final"] as? Bool == true,
                speechFinal: json["speechFinal"] as? Bool == true,
                requestId: json["requestId"] as? String
            )
        default: return .unknown
        }
    }
}

/// A duplex channel to `/voice/listen`. Tests inject a fake; production
/// opens a `URLSessionWebSocketTask`.
public protocol DictationListenSocket: AnyObject {
    func sendBinary(_ data: Data)
    func sendText(_ text: String)
    func close()
}

/// Opens a listen socket for one dictation. Returns nil when the handshake
/// cannot start (bad URL); a socket that never becomes ready falls back to
/// a whole-clip upload.
public typealias DictationListenOpener = () async -> (socket: DictationListenSocket, events: AsyncStream<ListenEvent>)?

public enum ListenEvent: Sendable {
    case opened
    case frame(ListenFrame)
    case closed
}

/// The words of one dictation, with whether they came from the socket or
/// an upload fallback.
public struct DictationHeard: Equatable, Sendable {
    public var text: String
    public var streamed: Bool
    public var key: VoiceKeyOutcome
    public var failed: Bool

    public init(text: String, streamed: Bool, key: VoiceKeyOutcome = VoiceKeyOutcome(), failed: Bool = false) {
        self.text = text
        self.streamed = streamed
        self.key = key
        self.failed = failed
    }
}

/// One composer dictation's ears on the server.
@MainActor
public final class LiveDictation {
    private let openListen: DictationListenOpener
    private let upload: @MainActor ([Float]) async throws -> VoiceTranscription
    private let finalTimeoutMs: UInt64
    private let connectTimeoutMs: UInt64

    private var socket: DictationListenSocket?
    private var listenTask: Task<Void, Never>?
    private var open = false
    private var streaming = false
    private var closing = false
    private var frames: [[Float]] = []
    private var sent = 0
    private var text = ""
    private var interim: String?
    private var requestSequence = 0
    private var pendingRequestId: String?
    private var probing = false
    private var ended = false
    private var closedAt: Int?
    private var onPartial: ((String) -> Void)?
    private var finishWaiter: CheckedContinuation<DictationHeard, Never>?
    private var finishTimer: Task<Void, Never>?
    private var readyWaiter: CheckedContinuation<Bool, Never>?
    private var readySettled = false
    /// The last upload's error (a VoiceFailure shows the key and what to do).
    public private(set) var uploadError: Error?

    public init(
        openListen: @escaping DictationListenOpener,
        upload: @escaping @MainActor ([Float]) async throws -> VoiceTranscription,
        finalTimeoutMs: UInt64 = DICTATION_FINAL_TIMEOUT_MS,
        connectTimeoutMs: UInt64 = 6_000
    ) {
        self.openListen = openListen
        self.upload = upload
        self.finalTimeoutMs = finalTimeoutMs
        self.connectTimeoutMs = connectTimeoutMs
    }

    /// Partial words while the person speaks.
    public func onPartial(_ handler: @escaping (String) -> Void) {
        onPartial = handler
    }

    /// Open the listen socket. False means frames stay local until finish
    /// uploads the whole clip (and the field stays empty meanwhile).
    @discardableResult
    public func connect() async -> Bool {
        if closing { return false }
        guard let opened = await openListen() else {
            streaming = false
            return false
        }
        socket = opened.socket
        // Arm the waiter before consuming events: a fast ready must not
        // settle before the continuation exists.
        return await withCheckedContinuation { continuation in
            readyWaiter = continuation
            listenTask = Task { @MainActor [weak self] in
                for await event in opened.events {
                    guard let self, !self.closing else { break }
                    self.handle(event)
                }
            }
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: connectTimeoutMs * 1_000_000)
                self.settleReady(false)
            }
        }
    }

    /// One 16 kHz mono frame of the dictation.
    public func push(_ frame: [Float]) {
        guard !closing else { return }
        frames.append(frame)
        flush()
    }

    /// Samples recorded so far (upload fallback, empty check).
    public func audio() -> [Float] {
        frames.flatMap { $0 }
    }

    /// The person stopped: wait for the last words, or upload the clip.
    public func finish() async -> DictationHeard {
        if closing {
            return DictationHeard(text: text.trimmingCharacters(in: .whitespacesAndNewlines), streamed: streaming)
        }
        let recorded = audio()
        if recorded.isEmpty {
            close()
            return DictationHeard(text: "", streamed: streaming)
        }
        if !open {
            return await uploadWhole(recorded)
        }
        return await withCheckedContinuation { continuation in
            finishWaiter = continuation
            if (ended || probing), closedAt == sent, !spoken.isEmpty || probing {
                if ended, !spoken.isEmpty {
                    settleFinish(DictationHeard(text: spoken, streamed: true))
                    return
                }
                armFinalTimer()
                return
            }
            closedAt = sent
            probing = true
            sendFinalize()
            armFinalTimer()
        }
    }

    public func close() {
        closing = true
        open = false
        streaming = false
        finishTimer?.cancel()
        finishTimer = nil
        listenTask?.cancel()
        listenTask = nil
        socket?.close()
        socket = nil
        settleReady(false)
        if let waiter = finishWaiter {
            finishWaiter = nil
            waiter.resume(returning: DictationHeard(text: spoken, streamed: false))
        }
        frames = []
        sent = 0
        text = ""
        interim = nil
    }

    // MARK: - Internals

    private var spoken: String {
        let words = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if !words.isEmpty { return words }
        return interim?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    private func handle(_ event: ListenEvent) {
        switch event {
        case .opened:
            break
        case .closed:
            open = false
            streaming = false
            settleReady(false)
            if finishWaiter != nil {
                Task { @MainActor in await self.finishByUpload() }
            }
        case let .frame(frame):
            switch frame {
            case .ready:
                open = true
                streaming = true
                settleReady(true)
                // frames heard before ready go out now
                flush()
            case .reconnected:
                // xAI's side was replaced: resend from the first frame
                sent = 0
                text = ""
                interim = nil
                pendingRequestId = nil
                probing = false
                ended = false
                closedAt = nil
                flush()
            case let .transcript(chunk, isFinal, speechFinal, requestId):
                heard(text: chunk, final: isFinal, speechFinal: speechFinal, requestId: requestId)
            case .error:
                open = false
                streaming = false
                settleReady(false)
            case .unknown:
                break
            }
        }
    }

    private func heard(text chunk: String, final: Bool, speechFinal: Bool, requestId: String?) {
        let trimmed = chunk.trimmingCharacters(in: .whitespacesAndNewlines)
        if let requestId, pendingRequestId == requestId {
            if !trimmed.isEmpty { text = trimmed }
            notifyPartial()
            if final && speechFinal {
                probing = false
                if finishWaiter != nil { settleFinish(DictationHeard(text: spoken, streamed: true)) }
                else { ended = true }
            }
            return
        }
        if !final {
            interim = chunk
            notifyPartial()
            return
        }
        if !trimmed.isEmpty {
            text = text.isEmpty ? trimmed : "\(text) \(trimmed)"
        }
        notifyPartial()
        guard speechFinal else { return }
        let covered = closedAt == nil || closedAt == sent
        probing = false
        guard covered else { return }
        if finishWaiter != nil { settleFinish(DictationHeard(text: spoken, streamed: true)) }
        else { ended = true }
    }

    private func notifyPartial() {
        let words = spoken
        guard !words.isEmpty else { return }
        onPartial?(words)
    }

    private func flush() {
        guard open, let socket else { return }
        while sent < frames.count {
            let pcm = CallWav.pcm16(frames[sent])
            socket.sendBinary(pcm)
            sent += 1
            ended = false
        }
    }

    private func sendFinalize() {
        requestSequence += 1
        let requestId = "stt-\(requestSequence)"
        pendingRequestId = requestId
        let payload = #"{"type":"finalize","requestId":"\#(requestId)"}"#
        socket?.sendText(payload)
    }

    private func armFinalTimer() {
        finishTimer?.cancel()
        let timeout = finalTimeoutMs
        finishTimer = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: timeout * 1_000_000)
            guard let self, !Task.isCancelled else { return }
            let fallback = self.spoken
            if !fallback.isEmpty {
                self.settleFinish(DictationHeard(text: fallback, streamed: true))
            } else {
                await self.finishByUpload()
            }
        }
    }

    private func finishByUpload() async {
        guard finishWaiter != nil else { return }
        let recorded = audio()
        let heard = await uploadWhole(recorded)
        settleFinish(heard)
    }

    private func uploadWhole(_ recorded: [Float]) async -> DictationHeard {
        do {
            let result = try await upload(recorded)
            uploadError = nil
            return DictationHeard(text: result.text.trimmingCharacters(in: .whitespacesAndNewlines), streamed: false, key: result.key)
        } catch {
            uploadError = error
            return DictationHeard(text: "", streamed: false, failed: true)
        }
    }

    private func settleReady(_ ok: Bool) {
        guard !readySettled else { return }
        readySettled = true
        readyWaiter?.resume(returning: ok)
        readyWaiter = nil
    }

    private func settleFinish(_ heard: DictationHeard) {
        finishTimer?.cancel()
        finishTimer = nil
        guard let waiter = finishWaiter else { return }
        finishWaiter = nil
        waiter.resume(returning: heard)
    }
}

// MARK: - Production socket

/// `URLSessionWebSocketTask` as a `DictationListenSocket`.
public final class URLSessionDictationSocket: NSObject, DictationListenSocket, URLSessionWebSocketDelegate, @unchecked Sendable {
    private var task: URLSessionWebSocketTask?
    private var session: URLSession?
    private let continuation: AsyncStream<ListenEvent>.Continuation
    private var opened = false

    public let events: AsyncStream<ListenEvent>

    public init(request: URLRequest) {
        var cont: AsyncStream<ListenEvent>.Continuation!
        events = AsyncStream { cont = $0 }
        continuation = cont
        super.init()
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        self.session = session
        let task = session.webSocketTask(with: request)
        self.task = task
        task.resume()
        listen()
    }

    public func sendBinary(_ data: Data) {
        task?.send(.data(data)) { _ in }
    }

    public func sendText(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    public func close() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
        continuation.yield(.closed)
        continuation.finish()
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        opened = true
        continuation.yield(.opened)
    }

    public func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        continuation.yield(.closed)
        continuation.finish()
    }

    private func listen() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                self.continuation.yield(.closed)
                self.continuation.finish()
            case let .success(message):
                switch message {
                case let .string(text):
                    self.continuation.yield(.frame(ListenFrame.parse(text)))
                case .data:
                    break
                @unknown default:
                    break
                }
                self.listen()
            }
        }
    }
}

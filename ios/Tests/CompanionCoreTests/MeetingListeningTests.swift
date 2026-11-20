// The watch's in-person meeting (#5130): the queue that carries the chunks
// to the server in order through a lost connection or a relaunch, and the
// session routes it calls.
import XCTest
@testable import CompanionCore

final class MeetingListeningTests: XCTestCase {
    func testTheSessionOpensFirstThenEachChunkIsHeardThenSentInOrder() {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 0)
        queue.add(file: "0.wav", at: 0)
        queue.add(file: "1.wav", at: 30_000)
        XCTAssertEqual(queue.next(now: 1), .start)
        queue.started(sessionId: "ls_1", at: 1)

        guard case let .transcribe(first) = queue.next(now: 2) else { return XCTFail("hear the oldest chunk first") }
        XCTAssertEqual(first.seq, 0)
        queue.heard(seq: 0, text: "  We ship on Friday. ")
        guard case let .post(sent) = queue.next(now: 3) else { return XCTFail("then send its line") }
        XCTAssertEqual(queue.line(for: sent), ListeningLineBody(seq: 0, at: 0, speaker: "room", text: "We ship on Friday."))
        XCTAssertEqual(queue.posted(seq: 0, at: 3)?.file, "0.wav")

        guard case let .transcribe(second) = queue.next(now: 4) else { return XCTFail("the next chunk") }
        XCTAssertEqual(second.seq, 1)
        XCTAssertEqual(queue.pending, 1)
    }

    func testTheStopWaitsForEveryChunk() {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 0)
        queue.started(sessionId: "ls_1", at: 0)
        queue.add(file: "0.wav", at: 0)
        queue.stopped = true
        guard case .transcribe = queue.next(now: 1) else { return XCTFail("chunks before the stop") }
        queue.heard(seq: 0, text: "")
        // a silent chunk still sends its (empty) line: it is the heartbeat
        guard case .post = queue.next(now: 2) else { return XCTFail("the silent chunk's line") }
        queue.posted(seq: 0, at: 2)
        XCTAssertEqual(queue.next(now: 3), .stop)
        queue.finished = true
        XCTAssertEqual(queue.next(now: 4), .done)
    }

    /// The last chunk can land a moment after the tap on Stop: the stop waits for it.
    func testTheStopWaitsForTheChunksTheRecorderStillHands() {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 0)
        queue.started(sessionId: "ls_1", at: 0)
        queue.stopped = true
        queue.expectedChunks = 1
        XCTAssertEqual(queue.next(now: 1), .wait)
        queue.add(file: "0.wav", at: 0)
        guard case .transcribe = queue.next(now: 2) else { return XCTFail("the late chunk first") }
    }

    func testAQuietRecordingSaysItIsStillThereBeforeTheServerGivesUp() {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 0)
        queue.started(sessionId: "ls_1", at: 0)
        XCTAssertEqual(queue.next(now: 59_000), .wait)
        XCTAssertEqual(queue.next(now: 60_000), .heartbeat)
        queue.heartbeat(at: 60_000)
        XCTAssertEqual(queue.next(now: 61_000), .wait)
        // the server's idle end is 5 minutes: the heartbeat comes well before it
        XCTAssertLessThan(MeetingRecording.heartbeatSeconds * 1000, 5 * 60_000)
    }

    func testALostSessionIsOpenedAgainWithWhatIsLeft() {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 0)
        queue.started(sessionId: "ls_1", at: 0)
        queue.add(file: "0.wav", at: 0)
        queue.lostSession()
        XCTAssertEqual(queue.next(now: 1), .start)
        XCTAssertEqual(queue.pending, 1)
    }

    func testTheQueueSurvivesARelaunch() throws {
        var queue = MeetingQueue(botId: "pixel", threadId: "main", startedAt: 5)
        queue.started(sessionId: "ls_1", at: 5)
        queue.add(file: "0.wav", at: 5)
        queue.heard(seq: 0, text: "Hello")
        queue.stopped = true
        let restored = try JSONDecoder().decode(MeetingQueue.self, from: JSONEncoder().encode(queue))
        XCTAssertEqual(restored, queue)
        guard case .post = restored.next(now: 6) else { return XCTFail("a heard chunk is sent, not heard again") }
    }

    func testRetriesWaitLongerUpToTwoMinutes() {
        XCTAssertEqual(MeetingRecording.retryDelay(failures: 0), 0)
        XCTAssertEqual(MeetingRecording.retryDelay(failures: 1), 2)
        XCTAssertEqual(MeetingRecording.retryDelay(failures: 3), 15)
        XCTAssertEqual(MeetingRecording.retryDelay(failures: 40), 120)
    }

    func testAChunkIsOneTranscriptionClip() {
        XCTAssertLessThanOrEqual(MeetingRecording.chunkBytes + 44, VoiceNoteRecording.maxTranscriptionBytes)
        XCTAssertEqual(VoiceNoteRecording.transcriptionClips(pcm: Data(count: MeetingRecording.chunkBytes)).count, 1)
    }

    // MARK: - The routes

    func testTheRoutesTheWatchCalls() async throws {
        SessionStub.requests = []
        let client = stubClient()
        let started = try await client.startListening(botId: "pixel", threadId: "main", purpose: MeetingRecording.purpose)
        XCTAssertEqual(started.sessionId, "ls_00000000000000000001")
        _ = try await client.addListeningLines(sessionId: started.sessionId, lines: [ListeningLineBody(seq: 0, at: 1, speaker: "room", text: "Hi")], speakers: [ListeningSpeakerBody(key: "room", label: "Room")])
        _ = try await client.stopListening(sessionId: started.sessionId)

        XCTAssertEqual(SessionStub.requests.map(\.path), [
            "/api/bots/pixel/listening",
            "/api/listening/ls_00000000000000000001/lines",
            "/api/listening/ls_00000000000000000001/stop",
        ])
        let start = try XCTUnwrap(SessionStub.requests[0].body)
        XCTAssertEqual(start["purpose"] as? String, "meeting")
        XCTAssertEqual(start["threadId"] as? String, "main")
        XCTAssertEqual((start["sources"] as? [String: Bool])?["microphone"], true)
        let lines = try XCTUnwrap(SessionStub.requests[1].body?["lines"] as? [[String: Any]])
        XCTAssertEqual(lines.first?["speaker"] as? String, "room")
        XCTAssertEqual(lines.first?["seq"] as? Int, 0)
    }

    private func stubClient() -> CompanionClient {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [SessionStub.self]
        return CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: URLSession(configuration: configuration)
        )
    }
}

/// Answers every listening route with the same session.
private final class SessionStub: URLProtocol {
    nonisolated(unsafe) static var requests: [(path: String, body: [String: Any]?)] = []

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request.url?.path ?? "", Self.body(of: request).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }))
        let body = Data(#"{"session":{"sessionId":"ls_00000000000000000001","state":"listening","lineCount":0,"lastSeq":0,"purpose":"meeting"}}"#.utf8)
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(of request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4_096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

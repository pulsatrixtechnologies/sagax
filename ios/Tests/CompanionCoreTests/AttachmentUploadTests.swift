import Foundation
import XCTest
@testable import CompanionCore

private final class ResumableRequestStub: URLProtocol {
    static var handle: ((URLRequest, Data) throws -> (Int, [String: Any]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        do {
            let body: Data
            if let data = request.httpBody { body = data }
            else if let stream = request.httpBodyStream {
                stream.open()
                defer { stream.close() }
                var data = Data()
                var buffer = [UInt8](repeating: 0, count: 64 * 1_024)
                while stream.hasBytesAvailable {
                    let count = stream.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    data.append(buffer, count: count)
                }
                body = data
            } else { body = Data() }
            let (status, payload) = try Self.handle!(request, body)
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status,
                                                               httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!,
                                cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: try JSONSerialization.data(withJSONObject: payload))
            client?.urlProtocolDidFinishLoading(self)
        } catch { client?.urlProtocol(self, didFailWithError: error) }
    }
    override func stopLoading() {}
}

private actor UploadProgressLog {
    var entries: [Int] = []
    func append(_ value: Int) { entries.append(value) }
}

final class AttachmentUploadTests: XCTestCase {
    private var session: URLSession!
    private var api: CompanionClient!
    private var files: [URL] = []
    private let chunk = CompanionClient.attachmentUploadChunkBytes

    override func setUp() {
        super.setUp()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ResumableRequestStub.self]
        session = URLSession(configuration: configuration)
        api = CompanionClient(connection: Connection(name: "Fixture", host: "127.0.0.1", port: 8810),
                              token: "synthetic-upload-token", session: session)
    }
    override func tearDown() {
        session.invalidateAndCancel()
        for file in files { try? FileManager.default.removeItem(at: file) }
        ResumableRequestStub.handle = nil
        super.tearDown()
    }

    private func attachment(bytes: Int, name: String = "clip.mp4", mime: String = "video/mp4", kind: PendingMessageAttachment.Kind = .file) throws -> PendingMessageAttachment {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        XCTAssertTrue(FileManager.default.createFile(atPath: url.path, contents: nil))
        files.append(url)
        let handle = try FileHandle(forWritingTo: url)
        try handle.truncate(atOffset: UInt64(bytes))
        try handle.close()
        return PendingMessageAttachment(fileURL: url, bytes: bytes, name: name, mime: mime, kind: kind)
    }

    private func saved(_ attachment: PendingMessageAttachment) -> [String: Any] {
        ["path": "/fixture/attachments/stored.mp4", "name": attachment.name, "mime": attachment.mime, "bytes": attachment.bytes]
    }
    private func query(_ request: URLRequest) -> [String: String] {
        Dictionary(uniqueKeysWithValues: URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.queryItems!.map { ($0.name, $0.value ?? "") })
    }

    func testDiskBackedUploadRecoversLostChunkAndCommitReplies() async throws {
        let source = try attachment(bytes: chunk * 2 + 7)
        XCTAssertTrue(source.data.isEmpty)
        var offset = 0
        var receipt: [String: Any]?
        var sizes: [Int] = []
        var ids = Set<String>()
        var lostReply = false
        let progress = UploadProgressLog()
        ResumableRequestStub.handle = { [self] request, body in
            let query = self.query(request)
            ids.insert(query["uploadId"]!)
            XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer synthetic-upload-token")
            XCTAssertEqual(request.url?.path, "/api/files")
            XCTAssertEqual(query["name"], "clip.mp4")
            switch query["phase"] {
            case "status":
                if offset == 0 { return (404, ["error": "no such upload"]) }
                var state: [String: Any] = ["offset": offset, "total": source.bytes]
                if let receipt { state["saved"] = receipt }
                return (200, state)
            case "chunk":
                XCTAssertEqual(Int(query["offset"]!), offset)
                XCTAssertLessThanOrEqual(body.count, self.chunk)
                XCTAssertFalse(body.isEmpty)
                sizes.append(body.count)
                offset += body.count
                if !lostReply { lostReply = true; return (503, ["error": "lost chunk reply"]) }
                return (200, ["offset": offset, "total": source.bytes])
            case "commit":
                receipt = self.saved(source)
                return (503, ["error": "lost commit reply"])
            default: XCTFail("unexpected request"); return (400, [:])
            }
        }
        let result = try await api.uploadAttachment(source) { sent, _ in await progress.append(sent) }
        XCTAssertEqual(result.path, "/fixture/attachments/stored.mp4")
        XCTAssertEqual(sizes, [chunk, chunk, 7])
        XCTAssertEqual(ids, [source.id.uuidString])
        let sent = await progress.entries
        XCTAssertEqual(sent, [chunk, chunk * 2, source.bytes, source.bytes])
        XCTAssertEqual(result.reference(for: source).kind, .file)
    }

    func testManualRetryUsesSameUUIDAndAcknowledgedOffset() async throws {
        let source = try attachment(bytes: chunk + 3)
        var offset = 0
        var firstAttempt = true
        var accepted: [Int] = []
        var ids = Set<String>()
        ResumableRequestStub.handle = { [self] request, body in
            let query = self.query(request)
            ids.insert(query["uploadId"]!)
            switch query["phase"] {
            case "status": return offset == 0 ? (404, ["error": "no such upload"]) : (200, ["offset": offset, "total": source.bytes])
            case "chunk":
                XCTAssertEqual(Int(query["offset"]!), offset)
                if offset == self.chunk && firstAttempt { return (503, ["error": "offline"]) }
                accepted.append(body.count)
                offset += body.count
                return (200, ["offset": offset, "total": source.bytes])
            case "commit": return (200, ["offset": offset, "total": source.bytes, "saved": self.saved(source)])
            default: return (400, [:])
            }
        }
        do { _ = try await api.uploadAttachment(source, retryDelays: []); XCTFail("expected upload failure") } catch {}
        firstAttempt = false
        _ = try await api.uploadAttachment(source, retryDelays: [])
        XCTAssertEqual(accepted, [chunk, 3])
        XCTAssertEqual(ids, [source.id.uuidString])
    }

    func testCommittedStatusReusesReceiptWithoutReadingAnyChunks() async throws {
        let source = try attachment(bytes: 1_024 * 1_024 * 1_024)
        var phases: [String] = []
        ResumableRequestStub.handle = { [self] request, body in
            phases.append(self.query(request)["phase"]!)
            XCTAssertTrue(body.isEmpty)
            return (200, ["offset": source.bytes, "total": source.bytes, "saved": self.saved(source)])
        }
        _ = try await api.uploadAttachment(source)
        XCTAssertEqual(phases, ["status"])
        XCTAssertTrue(source.data.isEmpty)
    }

    func testCancellationCleanupRunsWithIndependentTaskAndOriginalUUID() async throws {
        let source = try attachment(bytes: chunk + 5)
        let acknowledged = expectation(description: "first chunk acknowledged")
        var phases: [String] = []
        ResumableRequestStub.handle = { [self] request, _ in
            let query = self.query(request)
            phases.append(query["phase"]!)
            XCTAssertEqual(query["uploadId"], source.id.uuidString)
            if query["phase"] == "status" { return (404, ["error": "no such upload"]) }
            return (200, ["offset": query["phase"] == "cancel" ? 0 : self.chunk, "total": source.bytes])
        }
        let task = Task {
            try await api.uploadAttachment(source) { _, _ in
                acknowledged.fulfill()
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
        await fulfillment(of: [acknowledged], timeout: 5)
        task.cancel()
        do { _ = try await task.value; XCTFail("expected cancellation") } catch is CancellationError {} catch { XCTFail("wrong cancellation: \(error)") }
        let client = try XCTUnwrap(api)
        try await Task.detached { try await client.cancelAttachmentUpload(source) }.value
        XCTAssertEqual(phases, ["status", "chunk", "cancel"])
    }

    func testConcurrentSelectionsBoundChunkBuffersAndCancelQueuedWork() async throws {
        let sources = try (0..<4).map { _ in try attachment(bytes: chunk + 1) }
        let active = expectation(description: "two active transfers")
        active.expectedFulfillmentCount = 2
        var started = Set<String>()
        ResumableRequestStub.handle = { [self] request, _ in
            let query = self.query(request)
            if query["phase"] == "status" {
                started.insert(query["uploadId"]!)
                return (404, ["error": "no such upload"])
            }
            return (200, ["offset": self.chunk, "total": self.chunk + 1])
        }
        let client = try XCTUnwrap(api)
        let tasks = sources.map { source in
            Task {
                try await client.uploadAttachment(source) { _, _ in
                    active.fulfill()
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                }
            }
        }
        await fulfillment(of: [active], timeout: 5)
        XCTAssertEqual(started.count, 2)
        tasks.forEach { $0.cancel() }
        for task in tasks {
            do { _ = try await task.value; XCTFail("expected cancellation") }
            catch is CancellationError {} catch { XCTFail("wrong cancellation: \(error)") }
        }
        XCTAssertEqual(started.count, 2)
    }

    func testInvalidOffsetAndUnsafeReceiptNeverProduceReference() async throws {
        let source = try attachment(bytes: 10)
        ResumableRequestStub.handle = { _, _ in (200, ["offset": 11, "total": 10]) }
        do { _ = try await api.uploadAttachment(source); XCTFail("expected invalid offset") } catch {}
        ResumableRequestStub.handle = { [self] _, _ in
            var receipt = self.saved(source)
            receipt["name"] = "../secret.mp4"
            return (200, ["offset": 10, "total": 10, "saved": receipt])
        }
        do { _ = try await api.uploadAttachment(source); XCTFail("expected unsafe receipt") } catch {}
    }

    func testFileCopyOwnsSourceEnforcesActualSizeAndReleasesTemporaryFile() throws {
        let source = try attachment(bytes: 100, name: "notes.txt", mime: "text/plain")
        var copied: PendingMessageAttachment? = try .copyingFile(try XCTUnwrap(source.fileURL), name: source.name,
                                                              mime: source.mime, kind: .file, maximumBytes: 100)
        let owned = try XCTUnwrap(copied?.fileURL)
        XCTAssertEqual(copied?.bytes, 100)
        XCTAssertTrue(copied!.data.isEmpty)
        try FileManager.default.removeItem(at: source.fileURL!)
        XCTAssertEqual(try Data(contentsOf: owned).count, 100)
        copied = nil
        XCTAssertFalse(FileManager.default.fileExists(atPath: owned.path))
        let larger = try attachment(bytes: 101, name: "notes.txt", mime: "text/plain")
        XCTAssertThrowsError(try PendingMessageAttachment.copyingFile(larger.fileURL!, name: larger.name,
                                                                    mime: larger.mime, kind: .file, maximumBytes: 100))
    }

    func testPolicyKeepsCountImageAggregateAndSharedSoloCeilings() throws {
        let image = try attachment(bytes: AttachmentPolicy.maximumSoloImageBytes, name: "image.png", mime: "image/png", kind: .image)
        XCTAssertThrowsError(try AttachmentPolicy.validate([image]))
        XCTAssertNoThrow(try AttachmentPolicy.validate([image], sharedHost: false))
        let third = try attachment(bytes: 21 * 1_024 * 1_024, name: "image.png", mime: "image/png", kind: .image)
        XCTAssertThrowsError(try AttachmentPolicy.validate([image, image, third], sharedHost: false)) {
            XCTAssertEqual($0 as? AttachmentPolicyError, .totalTooLarge)
        }
        let document = try attachment(bytes: AttachmentPolicy.maximumFileBytes, name: "report.pdf", mime: "application/pdf")
        let video = try attachment(bytes: AttachmentPolicy.maximumVideoBytes)
        XCTAssertNoThrow(try AttachmentPolicy.validate([document, video]))
        XCTAssertNoThrow(try AttachmentPolicy.validate(Array(repeating: video, count: 32)))
        XCTAssertThrowsError(try AttachmentPolicy.validate(Array(repeating: video, count: 33)))
    }

    func testDraftJournalRestoresStableFilesIDsAndOffsetsAfterProcessReconstruction() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let original = try attachment(bytes: 100, name: "notes.txt", mime: "text/plain")
        let journal = AttachmentTransferJournal(root: root)
        try journal.saveDraft([original], connectionID: "computer-1", threadID: "thread-1")
        let id = AttachmentTransferJournal.draftID(connectionID: "computer-1", threadID: "thread-1")
        try journal.updateProgress(50, attachmentID: original.id, id: id)
        try FileManager.default.removeItem(at: original.fileURL!)
        let reconstructed = AttachmentTransferJournal(root: root)
        let manifest = try reconstructed.load(id)
        let restored = try reconstructed.attachments(manifest, id: id)
        XCTAssertEqual(manifest.entries.map(\.uploadedBytes), [50])
        XCTAssertEqual(restored.map(\.id), [original.id])
        XCTAssertEqual(try Data(contentsOf: restored[0].fileURL!).count, 100)
        XCTAssertTrue(restored[0].data.isEmpty)
        try reconstructed.saveDraft(restored, connectionID: "computer-1", threadID: "thread-1")
        XCTAssertEqual(reconstructed.ids(), [id])
        XCTAssertEqual(try reconstructed.load(id).entries.count, 1)
        XCTAssertThrowsError(try reconstructed.load(AttachmentTransferJournal.draftID(connectionID: "computer-2", threadID: "thread-1")))
    }

    func testShareHandoffRestartsAtOffsetAndReusesAcceptedSendWithoutDuplicateCharge() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let source = try attachment(bytes: chunk + 3)
        let journal = AttachmentTransferJournal(root: root)
        let sendID = UUID().uuidString
        let options = SendOptions(replyToId: "reply-1", busyMode: .auto, singleStream: true)
        let job = try journal.prepareDelivery([source], connectionID: api.connection.id,
            destination: .bot(id: "bot-1", threadId: "thread-1"), prefix: "Inspect this clip", sendID: sendID, options: options)
        try journal.updateProgress(chunk, attachmentID: source.id, id: job)
        try FileManager.default.removeItem(at: source.fileURL!)
        var offset = chunk
        var receipt: [String: Any]?
        var chunks: [Int] = []
        var sentBodies: [Data] = []
        var charged = Set<String>()
        ResumableRequestStub.handle = { [self] request, body in
            if request.url?.path == "/api/bots/bot-1/messages" {
                let message = try JSONSerialization.jsonObject(with: body) as! [String: Any]
                XCTAssertEqual(message["sendId"] as? String, sendID)
                XCTAssertEqual(message["threadId"] as? String, "thread-1")
                XCTAssertEqual(message["replyToId"] as? String, "reply-1")
                XCTAssertEqual(message["routeWhileBusy"] as? Bool, true)
                XCTAssertEqual(message["singleStream"] as? Bool, true)
                charged.insert(message["sendId"] as! String)
                sentBodies.append(body)
                return sentBodies.count == 1 ? (503, ["error": "accepted send reply lost"]) : (200, ["queued": false])
            }
            let query = self.query(request)
            XCTAssertEqual(query["uploadId"], source.id.uuidString)
            switch query["phase"] {
            case "status":
                var state: [String: Any] = ["offset": offset, "total": source.bytes]
                if let receipt { state["saved"] = receipt }
                return (200, state)
            case "chunk":
                XCTAssertEqual(Int(query["offset"]!), self.chunk)
                chunks.append(body.count)
                offset += body.count
                return (200, ["offset": offset, "total": source.bytes])
            case "commit":
                receipt = self.saved(source)
                return (200, ["offset": offset, "total": source.bytes, "saved": receipt!])
            default: return (400, [:])
            }
        }
        do { _ = try await AttachmentTransferDelivery(journal: journal, id: job).run(using: api); XCTFail("expected lost send reply") } catch {}
        let kept = try AttachmentTransferJournal(root: root).load(job)
        XCTAssertNotNil(kept.preparedText)
        XCTAssertEqual(kept.entries[0].uploadedBytes, source.bytes)
        XCTAssertEqual(kept.options, options)
        let finished = try await AttachmentTransferDelivery(journal: AttachmentTransferJournal(root: root), id: job).run(using: api)
        XCTAssertTrue(finished)
        XCTAssertEqual(chunks, [3])
        XCTAssertEqual(charged.count, 1)
        XCTAssertEqual(sentBodies.count, 2)
        let first = try JSONSerialization.jsonObject(with: sentBodies[0]) as! NSDictionary
        let second = try JSONSerialization.jsonObject(with: sentBodies[1]) as! NSDictionary
        XCTAssertEqual(first, second)
        XCTAssertTrue(journal.ids().isEmpty)
    }

    func testTransferLeasePreventsAppAndExtensionFromDeliveringTogether() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let source = try attachment(bytes: 10)
        let journal = AttachmentTransferJournal(root: root)
        let id = try journal.prepareDelivery([source], connectionID: api.connection.id,
            destination: .bot(id: "bot-1", threadId: "thread-1"), prefix: "Inspect", sendID: UUID().uuidString)
        var held = try journal.lease(id)
        XCTAssertNotNil(held)
        ResumableRequestStub.handle = { _, _ in XCTFail("a leased transfer must not reach the network"); return (500, [:]) }
        let ran = try await AttachmentTransferDelivery(journal: journal, id: id).run(using: api)
        XCTAssertFalse(ran)
        held = nil
        XCTAssertNotNil(try journal.lease(id))
    }

    func testAcceptedDeliveryCleanupPreservesNewerDraftAttachments() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let source = try attachment(bytes: 10)
        let newer = try attachment(bytes: 11)
        let journal = AttachmentTransferJournal(root: root)
        let connectionID = api.connection.id
        let draftID = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: "thread-1")
        try journal.saveDraft([source], connectionID: connectionID, threadID: "thread-1")
        let job = try journal.prepareDelivery([source], connectionID: connectionID,
            destination: .bot(id: "bot-1", threadId: "thread-1"), prefix: "Inspect", sendID: UUID().uuidString, sourceDraftID: draftID)
        try journal.saveDraft([source, newer], connectionID: connectionID, threadID: "thread-1")
        try journal.finish(journal.load(job), id: job)
        let kept = try journal.load(draftID)
        XCTAssertEqual(kept.entries.map(\.id), [newer.id])
        XCTAssertEqual(try journal.attachments(kept, id: draftID).first?.bytes, 11)
    }


    func testCancelledRecoveryCannotResurrectOrSendItsAcceptedFiles() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let source = try attachment(bytes: 10)
        let journal = AttachmentTransferJournal(root: root)
        let id = try journal.prepareDelivery([source], connectionID: api.connection.id,
            destination: .bot(id: "bot-1", threadId: "thread-1"), prefix: "Inspect", sendID: UUID().uuidString)
        var phases: [String] = []
        ResumableRequestStub.handle = { [self] request, _ in
            let query = self.query(request)
            XCTAssertNotEqual(request.url?.path, "/api/bots/bot-1/messages")
            XCTAssertEqual(query["uploadId"], source.id.uuidString)
            phases.append(query["phase"]!)
            if query["phase"] == "cancel" { return (200, ["offset": 0, "total": source.bytes]) }
            try journal.cancel(id)
            return (200, ["offset": source.bytes, "total": source.bytes, "saved": self.saved(source)])
        }
        do { _ = try await AttachmentTransferDelivery(journal: journal, id: id).run(using: api); XCTFail("cancelled transfer must not send") }
        catch is CancellationError {} catch { XCTFail("wrong cancellation: \(error)") }
        XCTAssertTrue(try journal.load(id).cancelled)
        let replayed = try await AttachmentTransferDelivery(journal: journal, id: id).run(using: api)
        XCTAssertFalse(replayed)
        XCTAssertTrue(journal.ids().isEmpty)
        // The tombstone releases the server copy with the original UUID.
        XCTAssertEqual(phases, ["status", "cancel"])
    }


    func testTransientChunkFailureRetriesInPlaceFromDurableOffset() async throws {
        let source = try attachment(bytes: chunk + 9)
        var offset = 0
        var failures = 2
        var accepted: [Int] = []
        var ids = Set<String>()
        ResumableRequestStub.handle = { [self] request, body in
            let query = self.query(request)
            ids.insert(query["uploadId"]!)
            switch query["phase"] {
            case "status": return offset == 0 ? (404, ["error": "no such upload"]) : (200, ["offset": offset, "total": source.bytes])
            case "chunk":
                XCTAssertEqual(Int(query["offset"]!), offset)
                if offset == self.chunk, failures > 0 { failures -= 1; return (502, ["error": "proxy dropped the request"]) }
                accepted.append(body.count)
                offset += body.count
                return (200, ["offset": offset, "total": source.bytes])
            case "commit": return (200, ["offset": offset, "total": source.bytes, "saved": self.saved(source)])
            default: return (400, [:])
            }
        }
        let result = try await api.uploadAttachment(source, retryDelays: [.zero, .zero, .zero])
        XCTAssertEqual(result.bytes, source.bytes)
        XCTAssertEqual(accepted, [chunk, 9])
        XCTAssertEqual(ids, [source.id.uuidString])
        XCTAssertEqual(failures, 0)
    }

    func testDefinitiveRefusalAndLocalFailuresAreNotRetried() async throws {
        let source = try attachment(bytes: 10)
        var requests = 0
        ResumableRequestStub.handle = { _, _ in requests += 1; return (413, ["error": "file exceeds the limit"]) }
        do { _ = try await api.uploadAttachment(source, retryDelays: [.zero, .zero]); XCTFail("expected refusal") }
        catch let APIError.status(code, _) { XCTAssertEqual(code, 413) }
        XCTAssertEqual(requests, 1)
        requests = 0
        ResumableRequestStub.handle = { _, _ in requests += 1; return (200, ["offset": 11, "total": 10]) }
        do { _ = try await api.uploadAttachment(source, retryDelays: [.zero, .zero]); XCTFail("expected invalid offset") }
        catch { XCTAssertTrue(error is AttachmentUploadFailure) }
        XCTAssertEqual(requests, 1)
        XCTAssertTrue(AttachmentTransferDelivery.definitive(APIError.status(code: 403, message: nil)))
        XCTAssertFalse(AttachmentTransferDelivery.definitive(APIError.status(code: 401, message: nil)))
        XCTAssertFalse(AttachmentTransferDelivery.definitive(APIError.status(code: 503, message: nil)))
        XCTAssertFalse(AttachmentTransferDelivery.definitive(APIError.transport("offline")))
    }

    func testRefusedDeliveryLeavesOutboxAndKeepsSourceDraft() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        files.append(root)
        let source = try attachment(bytes: 10)
        let journal = AttachmentTransferJournal(root: root)
        let connectionID = api.connection.id
        let draftID = AttachmentTransferJournal.draftID(connectionID: connectionID, threadID: "thread-1")
        try journal.saveDraft([source], connectionID: connectionID, threadID: "thread-1")
        let job = try journal.prepareDelivery([source], connectionID: connectionID,
            destination: .bot(id: "bot-1", threadId: "thread-1"), prefix: "Inspect", sendID: UUID().uuidString, sourceDraftID: draftID)
        var phases: [String] = []
        ResumableRequestStub.handle = { [self] request, _ in
            XCTAssertNotEqual(request.url?.path, "/api/bots/bot-1/messages")
            let phase = self.query(request)["phase"]!
            phases.append(phase)
            if phase == "cancel" { return (200, ["offset": 0, "total": source.bytes]) }
            return (403, ["error": "Your organization does not allow this file type."])
        }
        do { _ = try await AttachmentTransferDelivery(journal: journal, id: job).run(using: api); XCTFail("expected refusal") }
        catch let rejected as AttachmentTransferRejected {
            XCTAssertEqual(rejected.message, "Your organization does not allow this file type.")
        }
        XCTAssertEqual(phases, ["status", "cancel"])
        XCTAssertEqual(journal.ids(), [draftID])
        XCTAssertEqual(try journal.load(draftID).entries.map(\.id), [source.id])
    }

    /// The demo's in-process transport (DemoURLProtocol) speaks the same
    /// resumable contract: a disk-backed file crosses a chunk boundary and an
    /// in-memory picture commits in one chunk, both through the real client.
    func testDemoServerAcceptsTheComposerResumableUpload() async throws {
        let server = DemoServer(chunkDelay: 0)
        defer { server.stop() }
        let demo = server.makeClient()
        let video = try attachment(bytes: chunk + 11)
        let stored = try await demo.uploadAttachment(video, retryDelays: [])
        XCTAssertEqual(stored.bytes, video.bytes)
        XCTAssertEqual(stored.name, "clip.mp4")
        XCTAssertEqual(stored.path, "/demo/attachments/\(video.id.uuidString.lowercased()).mp4")
        let replay = try await demo.uploadAttachment(video, retryDelays: [])
        XCTAssertEqual(replay, stored)
        let picture = PendingMessageAttachment(data: Data(repeating: 7, count: 2_048), name: "Photo.png", mime: "image/png", kind: .image)
        let image = try await demo.uploadAttachment(picture, retryDelays: [])
        XCTAssertEqual(image.reference(for: picture).kind, .image)
        XCTAssertEqual(image.bytes, 2_048)
        try await demo.cancelAttachmentUpload(picture)
    }
}

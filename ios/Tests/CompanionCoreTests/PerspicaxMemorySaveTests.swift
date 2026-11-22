// #4941: a Perspicax note's version is its content hash. A save sends it
// back as base_version. A 409 memory_conflict is the current hash, not a
// thrown error. An import overwrite sends no version.
import Foundation
import XCTest
@testable import CompanionCore

private final class PerspicaxSaveStub: URLProtocol {
    static var statusCode = 200
    static var responseBody = Data("{}".utf8)
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedBody = Self.readBody(from: request)
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: Self.statusCode,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func readBody(from request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            guard count >= 0 else { return nil }
            if count == 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class PerspicaxMemorySaveTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!
    private let hash = String(repeating: "cd", count: 32)

    override func setUp() {
        super.setUp()
        PerspicaxSaveStub.statusCode = 200
        PerspicaxSaveStub.responseBody = Data("{}".utf8)
        PerspicaxSaveStub.capturedBody = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PerspicaxSaveStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(
            connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: session
        )
    }

    override func tearDown() {
        session.invalidateAndCancel()
        session = nil
        client = nil
        super.tearDown()
    }

    func testSaveSendsTheHashAsBaseVersion() async throws {
        PerspicaxSaveStub.responseBody = Data("""
        {"id":"n1","title":"Hello","body":"Next","version":"\(hash)"}
        """.utf8)
        let result = try await client.savePerspicaxMemoryEntry(
            scope: "me", id: "n1", title: "Hello", body: "Next", tags: ["a"], baseVersion: hash
        )
        guard case let .saved(entry) = result else {
            return XCTFail("expected a saved note")
        }
        XCTAssertEqual(entry.version, hash)
        let body = try XCTUnwrap(jsonBody())
        XCTAssertEqual(body["base_version"] as? String, hash)
        XCTAssertEqual(body["scope"] as? String, "me")
        XCTAssertEqual(body["id"] as? String, "n1")
    }

    func testSaveOmitsBaseVersionWhenTheNoteHasNone() async throws {
        PerspicaxSaveStub.responseBody = Data("""
        {"id":"n1","title":"Hello","body":"Next"}
        """.utf8)
        _ = try await client.savePerspicaxMemoryEntry(
            scope: "me", id: "n1", title: "Hello", body: "Next", tags: [], baseVersion: nil
        )
        let body = try XCTUnwrap(jsonBody())
        XCTAssertNil(body["base_version"])
    }

    func testConflictReturnsTheCurrentHash() async throws {
        let current = String(repeating: "ef", count: 32)
        PerspicaxSaveStub.statusCode = 409
        PerspicaxSaveStub.responseBody = Data("""
        {"code":"memory_conflict","details":{"version":"\(current)"}}
        """.utf8)
        let result = try await client.savePerspicaxMemoryEntry(
            scope: "me", id: "n1", title: "Hello", body: "Stale", tags: [], baseVersion: hash
        )
        guard case let .conflict(version) = result else {
            return XCTFail("expected a conflict")
        }
        XCTAssertEqual(version, current)
    }

    func testANumberedConflictVersionIsKeptAsText() async throws {
        PerspicaxSaveStub.statusCode = 409
        PerspicaxSaveStub.responseBody = Data("""
        {"code":"memory_conflict","details":{"version":4}}
        """.utf8)
        let result = try await client.savePerspicaxMemoryEntry(
            scope: "me", id: "n1", title: "Hello", body: "Stale", tags: [], baseVersion: "3"
        )
        guard case let .conflict(version) = result else {
            return XCTFail("expected a conflict")
        }
        XCTAssertEqual(version, "4")
    }

    func testAnotherRefusalStillThrows() async {
        PerspicaxSaveStub.statusCode = 409
        PerspicaxSaveStub.responseBody = Data("""
        {"error":"Sign in with Pulsatrix again to manage these notes.","code":"memory_sign_in_again"}
        """.utf8)
        do {
            _ = try await client.savePerspicaxMemoryEntry(
                scope: "me", id: "n1", title: "Hello", body: "Next", tags: [], baseVersion: hash
            )
            XCTFail("expected the sign-in refusal")
        } catch let APIError.status(code, message) {
            XCTAssertEqual(code, 409)
            XCTAssertEqual(message, "Sign in with Pulsatrix again to manage these notes.")
        } catch {
            XCTFail("unexpected \(error)")
        }
    }

    func testImportOverwriteSendsNoVersion() async throws {
        try await client.updatePerspicaxMemoryNote(scope: "me", id: "n1", title: "Hello", body: "Replaced", tags: ["a"])
        let body = try XCTUnwrap(jsonBody())
        XCTAssertNil(body["base_version"])
        XCTAssertEqual(body["body"] as? String, "Replaced")
        XCTAssertEqual(body["id"] as? String, "n1")
    }

    private func jsonBody() -> [String: Any]? {
        guard let data = PerspicaxSaveStub.capturedBody else { return nil }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }
}

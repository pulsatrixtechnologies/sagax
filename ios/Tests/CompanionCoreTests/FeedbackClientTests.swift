import Foundation
import XCTest
@testable import CompanionCore

private final class FeedbackRequestStub: URLProtocol {
    static var capturedRequest: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedRequest = request
        Self.capturedBody = Self.readBody(from: request)
        let response = HTTPURLResponse(
            url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(#"{"botId":"bot-fb","threadId":"thread-fb"}"#.utf8))
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

final class FeedbackClientTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        FeedbackRequestStub.capturedRequest = nil
        FeedbackRequestStub.capturedBody = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [FeedbackRequestStub.self]
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

    /// #2618: a shake on the phone starts a report with the Feedback bot.
    /// The phone attaches its version, OS and page; the server writes the
    /// bot's first question and answers with the conversation to open.
    func testStartFeedbackPostsTheShakeReportAndReturnsTheConversation() async throws {
        let started = try await client.startFeedback(
            FeedbackStart(source: .shake, appVersion: "0.8.70", os: "iOS 26.1", page: "chat", locale: "fr")
        )
        XCTAssertEqual(started.botId, "bot-fb")
        XCTAssertEqual(started.threadId, "thread-fb")
        let request = try XCTUnwrap(FeedbackRequestStub.capturedRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/feedback/start")
        let body = try XCTUnwrap(try JSONSerialization.jsonObject(with: XCTUnwrap(FeedbackRequestStub.capturedBody)) as? [String: Any])
        XCTAssertEqual(body["source"] as? String, "shake")
        XCTAssertEqual(body["platform"] as? String, "ios")
        XCTAssertEqual(body["appVersion"] as? String, "0.8.70")
        XCTAssertEqual(body["os"] as? String, "iOS 26.1")
        XCTAssertEqual(body["page"] as? String, "chat")
        XCTAssertEqual(body["locale"] as? String, "fr")
        XCTAssertNil(body["screenshot"])
    }
}

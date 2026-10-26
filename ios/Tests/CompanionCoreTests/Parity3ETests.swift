// Parity 3E: ignore a question, routines paused while away, typed triggers
// in reading. No simulator.
import Foundation
import XCTest
@testable import CompanionCore

final class Parity3ETests: XCTestCase {
    func testIgnoreIsAnAnswerAndOnlyOnAnOpenQuestion() throws {
        var card = try question()
        XCTAssertTrue(QuestionIgnore.canIgnore(card))
        card.tool = "Bash"
        XCTAssertFalse(QuestionIgnore.canIgnore(card))
        card.tool = nil
        card.answered = "answer"
        XCTAssertFalse(QuestionIgnore.canIgnore(card))
        XCTAssertFalse(QuestionIgnore.answer.contains("closed this question without answering"))
        XCTAssertTrue(QuestionIgnore.isSkip(QuestionIgnore.answer))
        XCTAssertFalse(QuestionIgnore.isSkip("Ship it"))
    }

    func testIgnoreCountsDownOnlyWhileTheCardWillCloseItself() {
        let now = Date(timeIntervalSince1970: 1_000)
        XCTAssertEqual(QuestionIgnore.face(expiresAt: nil, now: now), .ignore)
        XCTAssertEqual(QuestionIgnore.face(expiresAt: 1_000_000, now: now), .ignore, "already past")
        XCTAssertEqual(QuestionIgnore.face(expiresAt: 1_090_000, now: now), .closesAutomatically(remaining: 90))
        XCTAssertEqual(QuestionIgnore.clock(90), "1:30")
        XCTAssertEqual(QuestionIgnore.clock(3_660), "1:01:00")
    }

    func testAPausedCreateReadsAsPaused() throws {
        var card = try question()
        card.answered = "allow"
        card.routineRequest = ProposalRequestMarker(operation: .init(action: "create", paused: true))
        XCTAssertEqual(ApprovalOutcome.of(card), .routineCreatedPaused)
        XCTAssertEqual(ApprovalHeading.of(card), .confirmPausedRoutine)
        card.routineRequest = ProposalRequestMarker(operation: .init(action: "create"))
        XCTAssertEqual(ApprovalOutcome.of(card), .routineScheduled)
        XCTAssertEqual(ApprovalHeading.of(card), .confirmRoutine)
    }

    func testAwayReportAndGlobalPauseFollowTheDesktop() throws {
        let reported = try routine(#"""
        {"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1,2,3,4,5]},"durationMinutes":30,
         "createdAt":1,"updatedAt":2,"onlyWhenPresent":true,
         "awaySkips":{"count":3,"firstAt":10,"lastAt":20,"reportedAt":30}}
        """#)
        let stillAway = try routine(#"""
        {"id":"r2","name":"Other","prompt":"p","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1]},"durationMinutes":30,
         "createdAt":1,"updatedAt":2,"awaySkips":{"count":1,"firstAt":10,"lastAt":10}}
        """#)
        let paused = try routine(#"""
        {"id":"r3","name":"Off","prompt":"p","botId":"b1","runOn":"maus","enabled":false,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1]},"durationMinutes":30,
         "createdAt":1,"updatedAt":2}
        """#)
        XCTAssertEqual(reported.onlyWhenPresent, true)
        XCTAssertEqual(RoutineAway.reports([reported, stillAway, paused]).map(\.id), ["r1"])
        XCTAssertEqual(RoutinePauseAll.pausable([reported, paused]).map(\.id), ["r1"])
        XCTAssertEqual(RoutinePauseAll.resumable([reported, paused]).map(\.id), ["r3"])
    }

    func testOnlyWhenPresentIsSentOnlyWhenItChanges() throws {
        let original = try routine(#"""
        {"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1]},"durationMinutes":30,
         "createdAt":1,"updatedAt":2,"onlyWhenPresent":true}
        """#)
        var same = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule, durationMinutes: 30)
        same.onlyWhenPresent = true
        XCTAssertNil(RoutinePatch.body(original: original, input: same)["onlyWhenPresent"])
        same.onlyWhenPresent = false
        XCTAssertEqual(RoutinePatch.body(original: original, input: same)["onlyWhenPresent"] as? Bool, false)
        var created = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule)
        XCTAssertNil(RoutinePatch.createBody(created)["onlyWhenPresent"])
        created.onlyWhenPresent = true
        XCTAssertEqual(RoutinePatch.createBody(created)["onlyWhenPresent"] as? Bool, true)
    }

    func testPostResultsRoundTripsAndIsSentOnlyWhenItChanges() throws {
        // A migrated routine decodes postResults=true; it stays silent only
        // when the editor turns it off (JC 2026-10-22).
        let original = try routine(#"""
        {"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":true,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1]},"durationMinutes":30,
         "createdAt":1,"updatedAt":2,"postResults":true}
        """#)
        XCTAssertEqual(original.postResults, true)
        var same = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule, durationMinutes: 30)
        same.postResults = true
        XCTAssertNil(RoutinePatch.body(original: original, input: same)["postResults"])
        same.postResults = false
        XCTAssertEqual(RoutinePatch.body(original: original, input: same)["postResults"] as? Bool, false)
        var created = RoutineInput(name: "Digest", prompt: "p", botId: "b1", schedule: original.schedule)
        XCTAssertNil(RoutinePatch.createBody(created)["postResults"])
        created.postResults = true
        XCTAssertEqual(RoutinePatch.createBody(created)["postResults"] as? Bool, true)
    }

    func testATriggerUrlNeverCarriesASecret() throws {
        let json = #"{"webhooks":[{"id":"w1","endpointId":"ep_1","name":"PRs","botId":"b1","enabled":true,"deliveryCount":2,"lastReceivedAt":50,"signingSecretSet":true,"token":"whsec_secret","source":{"type":"github","events":["pr.opened","ci.failed"],"filters":{"repo":["acme/app"]}}}],"ingress":{"available":true,"baseUrl":"https://hooks.example.test/"}}"#
        let list = try JSONDecoder().decode(WebhooksResponse.self, from: Data(json.utf8))
        let hook = try XCTUnwrap(list.webhooks.first)
        XCTAssertEqual(hook.sourceType, "github")
        XCTAssertEqual(hook.sourceEvents, ["pr.opened", "ci.failed"])
        XCTAssertEqual(hook.sourceFilters, "repo: acme/app")
        XCTAssertTrue(hook.signingSecretSet)
        let url = WebhookPublicURL.make(baseURL: list.ingress?.baseUrl, endpointId: hook.endpointId, typed: true)
        XCTAssertEqual(url, "https://hooks.example.test/sources/ep_1")
        XCTAssertFalse(url?.contains("whsec") ?? true)
        XCTAssertEqual(WebhookPublicURL.make(baseURL: "https://hooks.example.test", endpointId: "ep_1", typed: false), "https://hooks.example.test/hooks/ep_1")
        XCTAssertNil(WebhookPublicURL.make(baseURL: "https://hooks.example.test", endpointId: "../secrets", typed: true))
        XCTAssertEqual(WebhookPublicURL.sourceLabel("pagerduty"), "PagerDuty")
    }

    func testAwaySeenAndTriggerToggleUseTheDesktopRoutes() async throws {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [Parity3EStub.self]
        let session = URLSession(configuration: configuration)
        defer { session.invalidateAndCancel() }
        let client = CompanionClient(connection: Connection(name: "Mac", host: "127.0.0.1", port: 8810), token: "t", session: session)
        Parity3EStub.body = Data(#"{"state":"away"}"#.utf8)
        let state = try await client.routineAwayState()
        XCTAssertEqual(state, "away")
        XCTAssertEqual(Parity3EStub.captured?.url?.path, "/api/routines/away")

        Parity3EStub.body = Data(#"""
        {"routine":{"id":"r1","name":"Digest","prompt":"p","botId":"b1","runOn":"maus","enabled":false,
         "schedule":{"type":"daily","time":"09:00","weekdays":[1]},"durationMinutes":30,"createdAt":1,"updatedAt":3}}
        """#.utf8)
        let cleared = try await client.markRoutineAwaySeen(id: "r1")
        XCTAssertEqual(cleared.enabled, false)
        XCTAssertNil(cleared.awaySkips)
        XCTAssertEqual(Parity3EStub.captured?.url?.path, "/api/routines/r1/away-seen")
        XCTAssertEqual(Parity3EStub.captured?.httpMethod, "POST")

        Parity3EStub.body = Data(#"{"webhook":{"id":"w1","name":"PRs","botId":"b1","enabled":false,"deliveryCount":2,"endpointId":"ep_1"}}"#.utf8)
        let hook = try await client.setWebhookEnabled(id: "w1", enabled: false)
        XCTAssertFalse(hook.enabled)
        XCTAssertEqual(Parity3EStub.captured?.url?.path, "/api/webhooks/w1")
        XCTAssertEqual(Parity3EStub.captured?.httpMethod, "PATCH")
        let sent = Parity3EStub.capturedBody.json()
        XCTAssertEqual(sent["enabled"] as? Bool, false)
        XCTAssertEqual(sent["verificationPending"] as? Bool, false)
        XCTAssertNil(sent["signingSecret"])
        XCTAssertNil(sent["token"])
    }

    private func question() throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(#"""
        {"title":"Which?","subtitle":"","options":["A","B"],"requestId":"q1","requestType":"question"}
        """#.utf8))
    }

    private func routine(_ json: String) throws -> Routine {
        try JSONDecoder().decode(Routine.self, from: Data(json.utf8))
    }
}

private final class Parity3EStub: URLProtocol {
    static var captured: URLRequest?
    static var capturedBody = Data()
    static var body = Data()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        Self.captured = request
        if let data = request.httpBody {
            Self.capturedBody = data
        } else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: 1024)
            defer { buffer.deallocate() }
            while stream.hasBytesAvailable {
                let count = stream.read(buffer, maxLength: 1024)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            Self.capturedBody = data
        } else {
            Self.capturedBody = Data()
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.body)
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

private extension Data {
    func json() -> [String: Any] {
        (try? JSONSerialization.jsonObject(with: self) as? [String: Any]) ?? [:]
    }
}

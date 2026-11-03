// The phone's computer input (parity 13 and 11): gesture -> event
// translation, batching, typing, and the wire shapes of the input,
// clipboard and control routes (server/computer/computer-input.ts).
import Foundation
import XCTest
@testable import CompanionCore

private final class ComputerRequestStub: URLProtocol {
    static var responseBody = Data()
    static var statusCode = 200
    static var capturedRequest: URLRequest?
    static var capturedBody: Data?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedRequest = request
        Self.capturedBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: Self.statusCode, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

final class ComputerInputTests: XCTestCase {
    private func json(_ events: [ComputerInputEvent]) throws -> [[String: AnyHashable]] {
        let data = try JSONEncoder().encode(events)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [[String: AnyHashable]])
    }

    // MARK: Wire shapes

    func testEventsEncodeAsTheServerSchema() throws {
        let encoded = try json([
            .move(dx: 3, dy: -4),
            .moveTo(x: 0.5, y: 0.25),
            .button(.left, .click),
            .button(.left, .click, count: 2),
            .button(.right, .down),
            .scroll(dx: 0, dy: 2),
            .key("Return"),
            .key("c", modifiers: [.ctrl]),
            .text("héllo"),
        ])
        XCTAssertEqual(encoded[0], ["type": "move", "dx": 3, "dy": -4])
        XCTAssertEqual(encoded[1], ["type": "moveTo", "x": 0.5, "y": 0.25])
        XCTAssertEqual(encoded[2], ["type": "button", "button": "left", "action": "click"])
        XCTAssertEqual(encoded[3], ["type": "button", "button": "left", "action": "click", "count": 2])
        XCTAssertEqual(encoded[4], ["type": "button", "button": "right", "action": "down"])
        XCTAssertEqual(encoded[5], ["type": "scroll", "dx": 0, "dy": 2])
        XCTAssertEqual(encoded[6], ["type": "key", "key": "Return"])
        XCTAssertEqual(encoded[7], ["type": "key", "key": "c", "modifiers": ["ctrl"]])
        XCTAssertEqual(encoded[8], ["type": "text", "text": "héllo"])
    }

    // MARK: Gestures

    func testTapsBecomeClicks() {
        var t = TrackpadTranslator()
        XCTAssertEqual(t.events(for: .tap), [.button(.left, .click)])
        XCTAssertEqual(t.events(for: .doubleTap), [.button(.left, .click, count: 2)])
        XCTAssertEqual(t.events(for: .twoFingerTap), [.button(.right, .click)])
    }

    func testSlowPanMovesAtBaseGainAndKeepsRemainders() {
        var t = TrackpadTranslator(baseGain: 2)
        // 10 pt over 0.1 s is 100 pt/s: under the acceleration threshold.
        XCTAssertEqual(t.events(for: .pan(dx: 10, dy: -5, interval: 0.1)), [.move(dx: 20, dy: -10)])
        // Sub-pixel travel accumulates instead of being lost.
        var slow = TrackpadTranslator(baseGain: 1)
        XCTAssertEqual(slow.events(for: .pan(dx: 0.4, dy: 0, interval: 0.016)), [])
        XCTAssertEqual(slow.events(for: .pan(dx: 0.4, dy: 0, interval: 0.016)), [])
        XCTAssertEqual(slow.events(for: .pan(dx: 0.4, dy: 0, interval: 0.016)), [.move(dx: 1, dy: 0)])
    }

    func testFastPanAccelerates() {
        var t = TrackpadTranslator(baseGain: 1)
        // 20 pt in 16 ms is 1250 pt/s: boosted, capped at 2.5x.
        guard case let .move(dx, dy)? = t.events(for: .pan(dx: 20, dy: 0, interval: 0.016)).first else {
            return XCTFail("expected a move")
        }
        XCTAssertGreaterThan(dx, 20)
        XCTAssertLessThanOrEqual(dx, 50)
        XCTAssertEqual(dy, 0)
        XCTAssertEqual(PointerAccelerator(baseGain: 1).gain(speed: 100), 1)
        XCTAssertEqual(PointerAccelerator(baseGain: 1).gain(speed: 100_000), 2.5)
    }

    func testTwoFingerPanScrollsNaturallyInTicks() {
        var t = TrackpadTranslator()
        // Fingers up 24 pt: the content scrolls down two ticks.
        XCTAssertEqual(t.events(for: .scroll(dx: 0, dy: -24)), [.scroll(dx: 0, dy: 2)])
        // Fingers down 6 pt twice: half a tick each, one tick up.
        XCTAssertEqual(t.events(for: .scroll(dx: 0, dy: 6)), [])
        XCTAssertEqual(t.events(for: .scroll(dx: 0, dy: 6)), [.scroll(dx: 0, dy: -1)])
        XCTAssertEqual(t.events(for: .scroll(dx: -12, dy: 0)), [.scroll(dx: 1, dy: 0)])
    }

    func testLongPressDragHoldsTheButton() {
        var t = TrackpadTranslator(baseGain: 1)
        XCTAssertEqual(t.events(for: .dragEnded), [], "no up without a down")
        XCTAssertEqual(t.events(for: .dragBegan), [.button(.left, .down)])
        XCTAssertTrue(t.dragging)
        XCTAssertEqual(t.events(for: .dragChanged(dx: 5, dy: 5, interval: 0.1)), [.move(dx: 5, dy: 5)])
        XCTAssertEqual(t.events(for: .dragEnded), [.button(.left, .up)])
        XCTAssertFalse(t.dragging)
    }

    // MARK: Batching

    func testBatcherMergesMovesAndScrollsButNotAcrossClicks() {
        var b = ComputerInputBatcher()
        b.append(.move(dx: 1, dy: 2))
        b.append(.move(dx: 3, dy: 4))
        b.append(.button(.left, .click))
        b.append(.move(dx: 1, dy: 1))
        b.append(.scroll(dx: 0, dy: 1))
        b.append(.scroll(dx: 0, dy: 2))
        b.append(.text("a"))
        b.append(.text("b"))
        XCTAssertEqual(b.drain(), [
            .move(dx: 4, dy: 6), .button(.left, .click), .move(dx: 1, dy: 1), .scroll(dx: 0, dy: 3), .text("ab"),
        ])
        XCTAssertTrue(b.isEmpty)
    }

    func testBatcherRespectsServerLimits() {
        var b = ComputerInputBatcher()
        b.append(.scroll(dx: 0, dy: 40))
        b.append(.scroll(dx: 0, dy: 20))
        XCTAssertEqual(b.pending, [.scroll(dx: 0, dy: 40), .scroll(dx: 0, dy: 20)], "never over 50 ticks")
        b.clear()
        for _ in 0..<100 { b.append(.button(.left, .click)) }
        XCTAssertEqual(b.drain().count, 64)
        XCTAssertEqual(b.drain().count, 36)
        XCTAssertTrue(b.drain().isEmpty)
    }

    func testAStrokeDuringARoundTripIsOneMove() {
        // 60 Hz pan samples while one request is in flight collapse.
        var t = TrackpadTranslator(baseGain: 1)
        var b = ComputerInputBatcher()
        for _ in 0..<30 { b.append(contentsOf: t.events(for: .pan(dx: 2, dy: 1, interval: 1.0 / 60))) }
        XCTAssertEqual(b.drain(), [.move(dx: 60, dy: 30)])
    }

    // MARK: Keyboard

    func testTypingStreamsTextAndNamedKeys() {
        var k = RemoteKeyboardTranslator()
        XCTAssertEqual(k.insert("hello"), [.text("hello")])
        XCTAssertEqual(k.insert("\n"), [.key("Return")])
        XCTAssertEqual(k.insert("a\tb"), [.text("a"), .key("Tab"), .text("b")])
        XCTAssertEqual(k.deleteBackward(), [.key("BackSpace")])
        XCTAssertEqual(k.special(.escape), [.key("Escape")])
        XCTAssertEqual(k.special(.left), [.key("Left")])
    }

    func testStickyModifiersMakeOneChord() {
        var k = RemoteKeyboardTranslator()
        k.toggle(.meta)
        k.toggle(.ctrl)
        XCTAssertEqual(k.modifiers, [.ctrl, .meta])
        XCTAssertEqual(k.insert("C"), [.key("c", modifiers: [.ctrl, .meta])])
        XCTAssertTrue(k.modifiers.isEmpty, "modifiers clear after one chord")
        k.toggle(.alt)
        XCTAssertEqual(k.special(.tab), [.key("Tab", modifiers: [.alt])])
        k.toggle(.shift)
        k.toggle(.shift)
        XCTAssertTrue(k.modifiers.isEmpty)
    }

    func testLongPasteSplitsAtTheServerLimit() {
        var k = RemoteKeyboardTranslator()
        let events = k.insert(String(repeating: "x", count: 2_500))
        XCTAssertEqual(events.count, 3)
        XCTAssertEqual(events.first, .text(String(repeating: "x", count: 1_000)))
    }

    // MARK: Pointer estimate

    func testPointerEstimateFollowsSentMoves() {
        var p = RemotePointerEstimate()
        p.apply([.moveTo(x: 0.5, y: 0.5), .move(dx: 128, dy: -80)], width: 1280, height: 800)
        XCTAssertEqual(p.x, 0.6, accuracy: 1e-9)
        XCTAssertEqual(p.y, 0.4, accuracy: 1e-9)
        p.apply([.move(dx: 10_000, dy: 10_000)], width: 1280, height: 800)
        XCTAssertEqual(p, RemotePointerEstimate(x: 1, y: 1))
    }

    func testLeaseIdsFitTheServerSchema() {
        let lease = ComputerControlLease.make()
        XCTAssertTrue((16...120).contains(lease.count))
        XCTAssertNotNil(lease.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression))
    }

    // MARK: Errors

    func testRefusalsAreClassifiedByCode() {
        func body(_ code: String) -> Data { Data(#"{"error":"x","code":"\#(code)"}"#.utf8) }
        XCTAssertEqual(ComputerError.from(status: 409, body: body("no_control")), .noControl)
        XCTAssertEqual(ComputerError.from(status: 409, body: body("control_lease")), .controlHeldElsewhere)
        XCTAssertEqual(ComputerError.from(status: 404, body: body("no_computer")), .noComputer)
        XCTAssertEqual(ComputerError.from(status: 502, body: body("input_failed")), .other(status: 502, message: "x"))
        XCTAssertEqual(ComputerError.noComputer.errorDescription, "This bot has no computer.")
    }
}

final class ComputerClientTests: XCTestCase {
    private var client: CompanionClient!

    override func setUp() {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ComputerRequestStub.self]
        client = CompanionClient(
            connection: Connection(id: "c", name: "Mac", host: "127.0.0.1", port: 8799),
            token: "t",
            session: URLSession(configuration: configuration)
        )
        ComputerRequestStub.statusCode = 200
        ComputerRequestStub.capturedRequest = nil
        ComputerRequestStub.capturedBody = nil
    }

    private func body() throws -> [String: AnyHashable] {
        let data = try XCTUnwrap(ComputerRequestStub.capturedBody)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: AnyHashable])
    }

    func testInputPostsEventsWithTheLease() async throws {
        ComputerRequestStub.responseBody = Data(#"{"ok":true,"applied":2}"#.utf8)
        let result = try await client.computerInput(botId: "bot-1", events: [.button(.left, .click), .text("hi")], controlLeaseId: "lease0123456789abcdef")
        XCTAssertEqual(result, ComputerInputResult(ok: true, applied: 2))
        let request = try XCTUnwrap(ComputerRequestStub.capturedRequest)
        XCTAssertEqual(request.httpMethod, "POST")
        XCTAssertEqual(request.url?.path, "/api/bots/bot-1/computer/input")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
        let sent = try body()
        XCTAssertEqual(sent["controlLeaseId"], "lease0123456789abcdef")
        XCTAssertEqual((sent["events"] as? [[String: AnyHashable]])?.count, 2)
    }

    func testInputWithoutControlIsNoControl() async {
        ComputerRequestStub.statusCode = 409
        ComputerRequestStub.responseBody = Data(#"{"error":"Take control of this computer first.","code":"no_control"}"#.utf8)
        do {
            _ = try await client.computerInput(botId: "bot-1", events: [.button(.left, .click)], controlLeaseId: nil)
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error as? ComputerError, .noControl)
        }
    }

    func testABotWithoutAComputer() async {
        ComputerRequestStub.statusCode = 404
        ComputerRequestStub.responseBody = Data(#"{"error":"This bot has no computer to control.","code":"no_computer"}"#.utf8)
        do {
            _ = try await client.computerClipboard(botId: "bot-1", controlLeaseId: nil)
            XCTFail("expected a refusal")
        } catch {
            XCTAssertEqual(error as? ComputerError, .noComputer)
        }
    }

    func testClipboardRoundTrip() async throws {
        ComputerRequestStub.responseBody = Data(#"{"text":"remote text"}"#.utf8)
        let text = try await client.computerClipboard(botId: "bot-1", controlLeaseId: "lease0123456789abcdef")
        XCTAssertEqual(text, "remote text")
        let read = try XCTUnwrap(ComputerRequestStub.capturedRequest)
        XCTAssertEqual(read.httpMethod, "GET")
        XCTAssertEqual(read.url?.query, "controlLeaseId=lease0123456789abcdef")

        ComputerRequestStub.responseBody = Data(#"{"ok":true}"#.utf8)
        try await client.setComputerClipboard(botId: "bot-1", text: "phone text", controlLeaseId: nil)
        XCTAssertEqual(ComputerRequestStub.capturedRequest?.httpMethod, "PUT")
        XCTAssertEqual(ComputerRequestStub.capturedRequest?.url?.path, "/api/bots/bot-1/computer/clipboard")
        XCTAssertEqual(try body(), ["text": "phone text"])
    }

    func testTakeAndReleaseControl() async throws {
        ComputerRequestStub.responseBody = Data(#"{"held":true,"helpReason":null,"heldSinceMs":1700000000000,"owned":true,"acquired":true}"#.utf8)
        let taken = try await client.takeComputerControl(botId: "bot-1", controlLeaseId: "lease0123456789abcdef")
        XCTAssertTrue(taken.held)
        XCTAssertEqual(taken.owned, true)
        XCTAssertEqual(ComputerRequestStub.capturedRequest?.url?.path, "/api/bots/bot-1/computer/control")
        XCTAssertEqual(try body(), ["action": "take", "controlLeaseId": "lease0123456789abcdef"])

        ComputerRequestStub.responseBody = Data(#"{"held":false,"helpReason":null,"heldSinceMs":null,"released":true}"#.utf8)
        let released = try await client.releaseComputerControl(botId: "bot-1", controlLeaseId: nil)
        XCTAssertFalse(released.held)
        XCTAssertEqual(try body(), ["action": "release"])
    }

    func testScreenshotDecodes() async throws {
        let png = Data([0x89, 0x50, 0x4E, 0x47]).base64EncodedString()
        ComputerRequestStub.responseBody = Data(#"{"png":"\#(png)","format":"jpeg"}"#.utf8)
        let shot = try await client.computerScreenshot(botId: "bot-1")
        XCTAssertEqual(shot.data, Data([0x89, 0x50, 0x4E, 0x47]))
        XCTAssertEqual(ComputerRequestStub.capturedRequest?.httpMethod, "POST")
    }

    func testBadBatchesAreRefusedBeforeSending() {
        XCTAssertThrowsError(try client.computerInputRequest(botId: "bot-1", events: [], controlLeaseId: nil))
        XCTAssertThrowsError(try client.computerInputRequest(botId: "../x", events: [.text("a")], controlLeaseId: nil))
    }
}

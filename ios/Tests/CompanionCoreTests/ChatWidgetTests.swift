import Foundation
import XCTest
@testable import CompanionCore

/// Chat widgets (`show_widget`) against the server's own fixtures:
/// `node --experimental-strip-types scripts/gen-widget-fixtures.ts ios/Tests/CompanionCoreTests/Fixtures`
/// writes every sample tree as the server stores it, and what the shared
/// helpers say about each (pressable refs, client-only refs, settling refs,
/// each press's scope and initial values).
final class ChatWidgetTests: XCTestCase {
    private struct Scope: Decodable {
        let fields: [String]
        let initial: ChatWidgetValues
    }

    private struct Expectation: Decodable {
        let pressable: [String]
        let onDevice: [String]
        let settles: [String]
        let scopes: [String: Scope]
    }

    private func fixture(_ name: String) throws -> Data {
        let url = try XCTUnwrap(
            Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
                ?? Bundle.module.url(forResource: name, withExtension: "json")
        )
        return try Data(contentsOf: url)
    }

    private func messages() throws -> [Message] {
        try JSONDecoder().decode(ThreadPage.self, from: fixture("widget-messages")).messages
    }

    func testEveryWidgetRowDecodesWithItsTree() throws {
        let rows = try messages()
        let widgets = rows.filter { $0.kind == .widget }
        XCTAssertEqual(widgets.count, 15)
        for row in widgets where row.id != "widget-broken" {
            XCTAssertNotNil(row.drawableWidget, row.id)
            XCTAssertFalse((row.text ?? "").isEmpty, row.id)
        }
        // not a tree: the row keeps its text and draws it
        let broken = try XCTUnwrap(rows.first { $0.id == "widget-broken" })
        XCTAssertNil(broken.drawableWidget)
        XCTAssertEqual(broken.text, "A widget this build cannot read")
    }

    func testActionsScopesAndDefaultsMatchTheServer() throws {
        let expectations = try JSONDecoder().decode([String: Expectation].self, from: fixture("widget-expectations"))
        let rows = try messages()
        XCTAssertEqual(expectations.count, 11)
        for (id, expected) in expectations {
            let root = try XCTUnwrap(rows.first { $0.id == id }?.widget?.root, id)
            let actions = ChatWidgetRules.actions(root)
            XCTAssertEqual(actions.filter { !$0.client }.map(\.ref), expected.pressable, id)
            XCTAssertEqual(actions.filter(\.client).map(\.ref), expected.onDevice, id)
            XCTAssertEqual(actions.filter { $0.tone != nil }.map(\.ref), expected.settles, id)
            for (ref, scope) in expected.scopes {
                let node = ChatWidgetRules.scope(root, ref: ref)
                XCTAssertEqual(ChatWidgetRules.fields(node, root: root).map(\.name), scope.fields, "\(id) \(ref)")
                XCTAssertEqual(ChatWidgetRules.initialValues(node), scope.initial, "\(id) \(ref)")
            }
        }
    }

    func testAFutureTreeKeepsWhatItKnows() throws {
        let future = try XCTUnwrap(try messages().first { $0.id == "widget-future" }?.widget?.root)
        XCTAssertEqual(future.type, "Card")
        XCTAssertEqual(future.string("title"), "From the future")
        XCTAssertEqual(future.children.map(\.type), ["Tesseract", "Hologram", "Text"])
        XCTAssertEqual(future.children[0].children.first?.string("value"), "Still readable")
        // a node without an id still gets one, so it can be drawn and keyed
        XCTAssertFalse(future.children[2].id.isEmpty)
    }

    func testASettledWidgetSaysHow() throws {
        let settled = try XCTUnwrap(try messages().first { $0.id == "widget-settled" }?.widget?.settled)
        XCTAssertEqual(settled.ref, "confirm")
        XCTAssertEqual(settled.label, "Merge the two ready")
        XCTAssertEqual(settled.tone, "confirm")
        XCTAssertEqual(settled.sendId, "send-1")
    }

    func testARequiredFieldStopsAConfirmButNotACancel() throws {
        let rows = try messages()
        let root = try XCTUnwrap(rows.first { $0.id == "widget-dinnerChoice" }?.widget?.root)
        let actions = ChatWidgetRules.actions(root)
        let confirm = try XCTUnwrap(actions.first { $0.ref == "confirm" })
        let cancel = try XCTUnwrap(actions.first { $0.ref == "cancel" })
        let empty = ChatWidgetRules.valuesToSend(root, entry: confirm, values: ChatWidgetRules.initialValues(root))
        XCTAssertEqual(empty.missing?.name, "dish")
        XCTAssertNil(empty.values)
        let picked = ChatWidgetRules.options(try XCTUnwrap(ChatWidgetRules.fields(root).first).node).first?.value ?? ""
        let full = ChatWidgetRules.valuesToSend(root, entry: confirm, values: ["dish": .text(picked)])
        XCTAssertNil(full.missing)
        XCTAssertEqual(full.values, ["dish": .text(picked)])
        let none = ChatWidgetRules.valuesToSend(root, entry: cancel, values: [:])
        XCTAssertNil(none.values)
        XCTAssertNil(none.missing)
    }

    func testAChoiceListOffersItsRows() throws {
        let root = try XCTUnwrap(try messages().first { $0.id == "widget-dinnerChoice" }?.widget?.root)
        let options = ChatWidgetRules.options(root)
        XCTAssertFalse(options.isEmpty)
        XCTAssertTrue(options.allSatisfy { !$0.label.isEmpty && !$0.value.isEmpty })
    }

    func testDays() {
        XCTAssertEqual(ChatWidgetRules.dayList("mon,tue,wed,thu,fri,sat,sun"), "Every day")
        XCTAssertEqual(ChatWidgetRules.dayList("mon,tue,wed,thu,fri"), "Weekdays")
        XCTAssertEqual(ChatWidgetRules.dayList("sat,sun"), "Weekends")
        XCTAssertEqual(ChatWidgetRules.dayList("mon,thu"), "Mon, Thu")
        XCTAssertEqual(ChatWidgetRules.days("fri,mon,xyz"), ["mon", "fri"])
    }

    func testAnOpenURLActionStaysOnTheDevice() throws {
        let json = """
        {"type":"Card","id":"n1","children":[
          {"type":"Button","id":"n2","label":"Open","onClickAction":{"type":"open_url","payload":{"url":"https://example.com/a"}}},
          {"type":"Button","id":"n3","label":"Bad","onClickAction":{"type":"open_url","payload":{"url":"javascript:alert(1)"}}},
          {"type":"Button","id":"n4","label":"Off","disabled":true,"onClickAction":{"type":"go"}}
        ]}
        """
        let root = try XCTUnwrap(ChatWidgetNode(json: try JSONDecoder().decode(WidgetJSON.self, from: Data(json.utf8))))
        let actions = ChatWidgetRules.actions(root)
        XCTAssertEqual(actions.map(\.ref), ["n2", "n3"])
        XCTAssertEqual(actions[0].url?.absoluteString, "https://example.com/a")
        XCTAssertNil(actions[1].url)
        XCTAssertTrue(actions.allSatisfy(\.client))
    }

    func testRepeatedLabelsTakeTheirRowsName() throws {
        let json = """
        {"type":"Card","id":"n1","children":[
          {"type":"Row","id":"n2","children":[{"type":"Text","id":"n3","value":"James"},{"type":"Button","id":"n4","label":"View","onClickAction":{"type":"view"}}]},
          {"type":"Row","id":"n5","children":[{"type":"Text","id":"n6","value":"Ana"},{"type":"Button","id":"n7","label":"View","onClickAction":{"type":"view"}}]}
        ]}
        """
        let root = try XCTUnwrap(ChatWidgetNode(json: try JSONDecoder().decode(WidgetJSON.self, from: Data(json.utf8))))
        XCTAssertEqual(ChatWidgetRules.actions(root).map(\.label), ["View: James", "View: Ana"])
    }

    func testAMessageRoundTripsItsWidget() throws {
        let row = try XCTUnwrap(try messages().first { $0.id == "widget-routineForm" })
        let again = try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(row))
        XCTAssertEqual(again.widget?.root, row.widget?.root)
        XCTAssertEqual(again.kind, .widget)
    }

    func testAPressPostsTheWidgetActionWithoutText() async throws {
        WidgetRequestStub.capturedBody = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [WidgetRequestStub.self]
        let client = CompanionClient(
            connection: Connection(name: "Test", host: "127.0.0.1", port: 8810),
            token: "paired-token",
            session: URLSession(configuration: configuration)
        )
        try await client.sendWidgetAction(
            botId: "bot-1", threadId: "thread-1", messageId: "m1", ref: "confirm", rev: 2,
            values: ["dish": .text("pizza"), "veggie": .flag(true)], sendId: "send-0123456789abcdef"
        )
        XCTAssertEqual(WidgetRequestStub.capturedPath, "/api/bots/bot-1/messages")
        let body = try XCTUnwrap(WidgetRequestStub.capturedBody.flatMap { try JSONSerialization.jsonObject(with: $0) as? [String: Any] })
        XCTAssertNil(body["text"])
        XCTAssertEqual(body["threadId"] as? String, "thread-1")
        XCTAssertEqual(body["sendId"] as? String, "send-0123456789abcdef")
        let press = try XCTUnwrap(body["widgetAction"] as? [String: Any])
        XCTAssertEqual(press["messageId"] as? String, "m1")
        XCTAssertEqual(press["ref"] as? String, "confirm")
        XCTAssertEqual(press["rev"] as? Int, 2)
        let values = try XCTUnwrap(press["values"] as? [String: Any])
        XCTAssertEqual(values["dish"] as? String, "pizza")
        XCTAssertEqual(values["veggie"] as? Bool, true)
    }
}

private final class WidgetRequestStub: URLProtocol {
    static var capturedBody: Data?
    static var capturedPath: String?

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.capturedPath = request.url?.path
        if let body = request.httpBody {
            Self.capturedBody = body
        } else if let stream = request.httpBodyStream {
            stream.open()
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 1_024)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(buffer, count: count)
            }
            stream.close()
            Self.capturedBody = data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data("{}".utf8))
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}

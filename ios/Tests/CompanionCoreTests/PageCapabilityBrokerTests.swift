// A page's capabilities on the phone (#3413 lot 8): the broker answers the
// page's data.read, viewer.get, open and files.download with this phone's
// session, instead of leaving them to fail as `unavailable`. The desktop's
// own tests: src/page-reader/capabilities.test.ts, shared/page-capabilities.test.ts.
import Foundation
import JavaScriptCore
import XCTest
@testable import CompanionCore

@MainActor
final class PageCapabilityBrokerTests: XCTestCase {
    private final class Fake {
        var posted: [[String: Any]] = []
        var calls: [(method: String, path: String, query: [String: String], body: [String: Any]?)] = []
        var opened: [URL] = []
        var refs: [(String, String?)] = []
        var saved: [(String, String, Data)] = []
        var now = Date(timeIntervalSince1970: 1_000)
        var routes: [String: (Int, Any?)] = [:]
        var refOpens = true

        func results() -> [[String: Any]] { posted.filter { $0["type"] as? String == PageCapMessage.result } }
        func result(_ id: Int) -> [String: Any]? { results().last { $0["id"] as? Int == id } }
    }

    private let caps: [String: Any] = ["capabilities": ["data": ["team-board"], "viewer": true, "open": true, "files": ["download"]],
                                       "reads": [["name": "team-board", "label": "the work of your coding teams"]]]

    private func broker(_ fake: Fake, caps: [String: Any]? = nil) -> PageCapabilityBroker {
        fake.routes["GET /api/pages/page_one/capabilities"] = (200, caps ?? self.caps)
        let deps = PageCapabilityBroker.Deps(
            api: { method, path, query, body in
                fake.calls.append((method, path, Dictionary(uniqueKeysWithValues: query.map { ($0.name, $0.value ?? "") }), body))
                guard let (status, answer) = fake.routes["\(method) \(path)"] else { return PageCapHTTPAnswer(status: 404, body: ["error": "no route"]) }
                return PageCapHTTPAnswer(status: status, body: answer)
            },
            post: { fake.posted.append($0) },
            openURL: { fake.opened.append($0) },
            openRef: { bot, thread in fake.refs.append((bot, thread)); return fake.refOpens },
            saveFile: { fake.saved.append(($0, $1, $2)) },
            now: { fake.now }
        )
        return PageCapabilityBroker(pageId: "page_one", version: 3, lang: "en", deps: deps)
    }

    private func call(_ id: Int, _ cap: String, _ args: [String: Any] = [:], gesture: Bool? = nil) -> [String: Any] {
        var message: [String: Any] = ["type": "sagax-cap", "v": 1, "id": id, "cap": cap, "args": args]
        if let gesture { message["gesture"] = gesture }
        return message
    }

    private let board: [String: Any] = ["name": "team-board", "value": ["teams": []], "at": 1,
                                         "links": ["https://github.com/acme/app/pull/7"], "refs": ["thread:bot-a:thread-b"]]

    // MARK: Handshake

    func testHelloIsAnsweredReadyWithTaken() async {
        let fake = Fake()
        let broker = broker(fake)
        let handled = await broker.receive(["type": "sagax-cap-hello", "v": 1], fromClick: false)
        XCTAssertTrue(handled)
        XCTAssertEqual(fake.posted.last?["type"] as? String, "sagax-cap-ready")
        XCTAssertEqual(fake.posted.last?["taken"] as? Bool, true)
        XCTAssertEqual(fake.posted.last?["v"] as? Int, 1)
    }

    func testAnUnknownCallIsAnsweredUnavailableNeverDropped() async {
        let fake = Fake()
        let broker = broker(fake)
        await broker.receive(call(4, "store.put"), fromClick: false)
        XCTAssertEqual(fake.result(4)?["ok"] as? Bool, false)
        XCTAssertEqual(fake.result(4)?["error"] as? String, "unavailable")
        let other = await broker.receive(["type": "other"], fromClick: false)
        XCTAssertFalse(other)
    }

    // MARK: data.read

    func testDataReadAnswersTheValueWithTheReadersSessionForThisVersion() async throws {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (200, board)
        let broker = broker(fake)
        broker.start()
        await broker.receive(call(1, "data.read", ["name": "team-board", "params": ["team": "lane-1", "fresh": true]]), fromClick: false)
        XCTAssertTrue(fake.posted.contains { $0["type"] as? String == "sagax-cap-taken" && $0["id"] as? Int == 1 })
        let result = try XCTUnwrap(fake.result(1))
        XCTAssertEqual(result["ok"] as? Bool, true)
        XCTAssertEqual((result["value"] as? [String: Any])?.keys.sorted(), ["teams"])
        // the links and refs stay in the broker
        XCTAssertNil((result["value"] as? [String: Any])?["links"])
        let read = try XCTUnwrap(fake.calls.last)
        XCTAssertEqual(read.query, ["team": "lane-1", "fresh": "1", "version": "3", "lang": "en"])
    }

    func testAnUndeclaredSourceIsRefusedWithoutARequest() async {
        let fake = Fake()
        let broker = broker(fake, caps: ["capabilities": ["data": [], "viewer": true]])
        await broker.receive(call(2, "data.read", ["name": "team-board"]), fromClick: false)
        XCTAssertEqual(fake.result(2)?["error"] as? String, "not_declared")
        XCTAssertFalse(fake.calls.contains { $0.path.contains("/data/") })
    }

    func testBadParamsAreRefused() async {
        let fake = Fake()
        let broker = broker(fake)
        await broker.receive(call(3, "data.read", ["name": "team-board", "params": ["Bad-Key": "x"]]), fromClick: false)
        XCTAssertEqual(fake.result(3)?["error"] as? String, "bad_request")
    }

    func testTheServersRefusalReachesThePageWithItsCodeAndReason() async {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (403, ["error": "Your organization refuses this.", "code": "denied", "reason": "org_rule"])
        let broker = broker(fake)
        await broker.receive(call(5, "data.read", ["name": "team-board"]), fromClick: false)
        XCTAssertEqual(fake.result(5)?["error"] as? String, "denied")
        XCTAssertEqual(fake.result(5)?["reason"] as? String, "org_rule")
        XCTAssertEqual(fake.result(5)?["message"] as? String, "Your organization refuses this.")
    }

    func testAskFirstShowsItsCardAndReadsAgainAfterTheReadersAnswer() async throws {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (409, ["error": "asks", "code": "ask_first", "approvalId": "appr_1", "source": "team-board", "version": 3])
        fake.routes["POST /api/pages/page_one/data-approvals/appr_1"] = (200, ["ok": true])
        let broker = broker(fake)
        let pending = Task { await broker.receive(call(6, "data.read", ["name": "team-board"]), fromClick: false) }
        while broker.state.approvals.isEmpty { await Task.yield() }
        let card = try XCTUnwrap(broker.state.approvals.first)
        XCTAssertEqual(card.label, "the work of your coding teams")
        // a tap right after the card appears is ignored (a decoy under the finger)
        XCTAssertFalse(broker.resolveApproval(card.id, .once))
        fake.now = fake.now.addingTimeInterval(1)
        fake.routes["GET /api/pages/page_one/data/team-board"] = (200, board)
        XCTAssertTrue(broker.resolveApproval(card.id, .always))
        _ = await pending.value
        XCTAssertEqual(fake.result(6)?["ok"] as? Bool, true)
        XCTAssertEqual(fake.calls.first { $0.method == "POST" }?.body?["answer"] as? String, "always")
        XCTAssertTrue(broker.state.approvals.isEmpty)
    }

    func testDecliningAskFirstAnswersDeniedDeclined() async throws {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (409, ["error": "asks", "code": "ask_first", "approvalId": "appr_2"])
        fake.routes["POST /api/pages/page_one/data-approvals/appr_2"] = (200, ["ok": true])
        let broker = broker(fake)
        let pending = Task { await broker.receive(call(7, "data.read", ["name": "team-board"]), fromClick: false) }
        while broker.state.approvals.isEmpty { await Task.yield() }
        XCTAssertTrue(broker.resolveApproval(try XCTUnwrap(broker.state.approvals.first).id, .decline))
        _ = await pending.value
        XCTAssertEqual(fake.result(7)?["error"] as? String, "denied")
        XCTAssertEqual(fake.result(7)?["reason"] as? String, "declined")
        XCTAssertEqual(fake.calls.first { $0.method == "POST" }?.body?["answer"] as? String, "deny")
    }

    func testComingBackMakesThePageReadAgain() async {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (200, board)
        let broker = broker(fake)
        await broker.receive(call(8, "data.read", ["name": "team-board"]), fromClick: false)
        broker.refocused()
        XCTAssertEqual(fake.posted.last?["type"] as? String, "sagax-cap-event")
        XCTAssertEqual(fake.posted.last?["name"] as? String, "team-board")
    }

    // MARK: viewer.get

    func testViewerGetAnswersTheServersViewer() async {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/viewer"] = (200, ["name": "Sam", "handle": "h1", "role": "owner", "lang": "en"])
        let broker = broker(fake)
        await broker.receive(call(9, "viewer.get"), fromClick: false)
        XCTAssertEqual((fake.result(9)?["value"] as? [String: Any])?["role"] as? String, "owner")
    }

    // MARK: open

    func testOpenTakesOnlyAReferenceADataAnswerHeld() async {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (200, board)
        let broker = broker(fake)
        await broker.receive(call(10, "open", ["ref": "bot:bot-z"]), fromClick: true)
        XCTAssertEqual(fake.result(10)?["error"] as? String, "not_found")
        await broker.receive(call(11, "data.read", ["name": "team-board"]), fromClick: false)
        await broker.receive(call(12, "open", ["ref": "thread:bot-a:thread-b"]), fromClick: true)
        XCTAssertEqual(fake.result(12)?["value"] as? Bool, true)
        XCTAssertEqual(fake.refs.first?.0, "bot-a")
        XCTAssertEqual(fake.refs.first?.1, "thread-b")
    }

    func testALinkOpensAtOnceBeforeDataAndAsksAfterUnlessTheDataNamedIt() async throws {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/data/team-board"] = (200, board)
        fake.routes["GET /api/pages/page_one/link-approvals"] = (200, ["allowed": false])
        fake.routes["POST /api/pages/page_one/link-approvals"] = (200, ["ok": true])
        let broker = broker(fake)
        await broker.receive(call(13, "open", ["ref": "https://example.com/a"]), fromClick: true)
        XCTAssertEqual(fake.opened.map(\.absoluteString), ["https://example.com/a"])
        await broker.receive(call(14, "data.read", ["name": "team-board"]), fromClick: false)
        await broker.receive(call(15, "open", ["ref": "https://github.com/acme/app/pull/7"]), fromClick: true)
        XCTAssertEqual(fake.opened.count, 2)
        await broker.receive(call(16, "open", ["ref": "https://example.com/b?x=1"]), fromClick: true)
        XCTAssertEqual(fake.result(16)?["value"] as? Bool, false)
        XCTAssertEqual(fake.opened.count, 2)
        let card = try XCTUnwrap(broker.state.links.first)
        XCTAssertEqual(card.host, "example.com")
        XCTAssertEqual(card.rest, "/b?x=1")
        XCTAssertTrue(card.always)
        fake.now = fake.now.addingTimeInterval(1)
        XCTAssertTrue(broker.resolveLink(card.id, .always))
        XCTAssertEqual(fake.opened.last?.absoluteString, "https://example.com/b?x=1")
        while !fake.calls.contains(where: { $0.method == "POST" }) { await Task.yield() }
        XCTAssertEqual(fake.calls.first { $0.method == "POST" }?.body?["origin"] as? String, "https://example.com")
    }

    func testTheWrappersOwnOpenLinkFollowsTheSameRule() async {
        let fake = Fake()
        fake.routes["GET /api/pages/page_one/viewer"] = (200, ["name": "Sam"])
        let broker = broker(fake)
        let took = await broker.receiveOpen(["type": "sagax-page-open", "url": "https://example.com/"])
        XCTAssertTrue(took)
        XCTAssertEqual(fake.opened.count, 1)
        await broker.receive(call(17, "viewer.get"), fromClick: false)
        await broker.receiveOpen(["type": "sagax-page-open", "url": "https://example.com/next"])
        XCTAssertEqual(fake.opened.count, 1)
        XCTAssertEqual(broker.state.links.count, 1)
        let script = await broker.receiveOpen(["type": "sagax-page-open", "url": "javascript:alert(1)"])
        XCTAssertFalse(script)
    }

    /// The frame posts one link to its parent and to the top window; on the
    /// phone both are the wrapper, so the same address arrives twice at once.
    func testOneLinkPostedToParentAndTopOpensOnce() async {
        let fake = Fake()
        let broker = broker(fake)
        let message: [String: Any] = ["type": "sagax-page-open", "url": "https://example.com/once"]
        await broker.receiveOpen(message)
        await broker.receiveOpen(message)
        XCTAssertEqual(fake.opened.count, 1)
        // the same address tapped again later opens again
        fake.now = fake.now.addingTimeInterval(2)
        await broker.receiveOpen(message)
        XCTAssertEqual(fake.opened.count, 2)
    }

    // MARK: files.download

    func testDownloadHandsTheFileOverOnlyFromATap() async {
        let fake = Fake()
        let broker = broker(fake)
        let args: [String: Any] = ["name": "../report.csv", "mime": "text/csv", "data": Data("a,b\n".utf8).base64EncodedString()]
        await broker.receive(call(18, "files.download", args, gesture: true), fromClick: false)
        XCTAssertEqual(fake.result(18)?["error"] as? String, "bad_request")
        await broker.receive(call(19, "files.download", args, gesture: true), fromClick: true)
        XCTAssertEqual(fake.result(19)?["value"] as? Bool, true)
        XCTAssertEqual(fake.saved.first?.0, "report.csv")
        XCTAssertEqual(fake.saved.first?.2, Data("a,b\n".utf8))
        await broker.receive(call(20, "files.download", ["name": "x.html", "mime": "text/html", "data": "AAAA"]), fromClick: true)
        XCTAssertEqual(fake.result(20)?["error"] as? String, "bad_request")
    }

    func testFileRules() {
        XCTAssertNil(PageCapRules.fileName(".."))
        XCTAssertNil(PageCapRules.fileName("a\u{7}b"))
        XCTAssertEqual(PageCapRules.fileName("dir\\name.txt"), "name.txt")
        if case .success = PageCapRules.fileData("AB=C") { XCTFail("bad padding") }
        if case .success = PageCapRules.fileData("data:text/plain;base64,QQ==") { XCTFail("data URL") }
        if case let .success(bytes) = PageCapRules.fileData("QQ==") { XCTAssertEqual(bytes, Data("A".utf8)) } else { XCTFail("valid") }
        if case let .failure(failure) = PageCapRules.fileData("QUFB", limit: 2) { XCTAssertEqual(failure, .tooLarge) } else { XCTFail("too large") }
    }

    func testRequestShapes() {
        XCTAssertNil(PageCapRules.request(["type": "sagax-cap", "v": 1, "id": 1, "cap": "open", "gesture": 1]))
        XCTAssertNil(PageCapRules.request(["type": "sagax-cap", "v": 1, "id": -1, "cap": "open"]))
        XCTAssertNil(PageCapRules.request(["type": "sagax-cap", "v": 1, "id": 1, "cap": "open", "args": [1]]))
        XCTAssertEqual(PageCapRules.request(["type": "sagax-cap", "v": 1, "id": 2, "cap": "viewer.get"])?.cap, .viewerGet)
        XCTAssertNil(PageCapabilities.parse(["data": ["*"], "viewer": 1]).flatMap { $0.any ? $0 : nil })
    }

    // MARK: The isolated script

    /// The script takes messages from the wrapper's own page frame only, with
    /// its opaque origin, and posts answers to that frame.
    func testTheBridgeScriptRelaysOnlyThePageFrame() throws {
        let context = try XCTUnwrap(JSContext())
        context.evaluateScript("""
        var handled=[],sent=[],listeners=[],frameWin={postMessage:function(m,o){sent.push(m)}},other={};
        var window={webkit:{messageHandlers:{\(PageCapBridge.handler):{postMessage:function(b){handled.push(b)}}}},
          addEventListener:function(t,f){listeners.push(f)}};
        var document={querySelector:function(){return {contentWindow:frameWin}}};var navigator={userActivation:{isActive:true}};
        function fire(src,origin,data){listeners.forEach(function(f){f({source:src,origin:origin,data:data})})}
        """)
        context.evaluateScript("(function(window){\(PageCapBridge.script)})(window)")
        context.evaluateScript("""
        fire(frameWin,"null",{type:"sagax-cap",v:1,id:1,cap:"viewer.get"});
        fire(other,"null",{type:"sagax-cap",v:1,id:2,cap:"viewer.get"});
        fire(frameWin,"https://elsewhere.example",{type:"sagax-cap",v:1,id:3,cap:"viewer.get"});
        fire(frameWin,"null",{type:"sagax-page-scroll",v:1,y:3});
        window.__sagaxCapPost({type:"sagax-cap-ready",v:1,taken:true});
        """)
        XCTAssertEqual(context.evaluateScript("handled.length")?.toInt32(), 1)
        let body = try XCTUnwrap(context.evaluateScript("handled[0]")?.toObject())
        let parsed = try XCTUnwrap(PageCapBridge.parse(body))
        XCTAssertTrue(parsed.fromClick)
        XCTAssertEqual(PageCapRules.callId(parsed.message), 1)
        XCTAssertEqual(context.evaluateScript("sent[0].type")?.toString(), "sagax-cap-ready")
        XCTAssertNotNil(PageCapBridge.postSource(["type": "sagax-cap-result", "v": 1, "id": 1, "ok": true, "value": NSNull()]))
    }
}

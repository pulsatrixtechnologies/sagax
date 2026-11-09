import XCTest
@testable import CompanionCore

/// Mirrors the desktop `modelTurnLock` (bot-settings/ModelSection.tsx).
final class ModelTurnLockTests: XCTestCase {
    private func bot(_ extra: String = "") throws -> Bot {
        try JSONDecoder().decode(Bot.self, from: Data(#"""
        {"id":"b1","threadId":"t1","name":"Ara","title":"Ops","description":"","notifications":true,"color":"blue",
        "unread":false,"modelSelection":{"instanceId":"claude","model":"opus"},"createdAt":1\#(extra)}
        """#.utf8))
    }

    private func ask(_ id: String, admin: Bool) -> String {
        #"{"id":"m-\#(id)","role":"bot","kind":"options","at":1,"card":{"title":"Approve?","subtitle":"","options":["Allow","Deny"],"requestId":"\#(id)","tool":"Bash"\#(admin ? #","adminApproval":true"# : "")}}"#
    }

    func testIdleBotIsUnlocked() throws {
        XCTAssertNil(ModelTurnLock.of(try bot()))
        XCTAssertNil(ModelTurnLock.of(try bot(#","busy":false"#)))
    }

    func testBusyTurnIsWorking() throws {
        XCTAssertEqual(ModelTurnLock.of(try bot(#","busy":true,"activity":"working""#)), .working)
        XCTAssertEqual(ModelTurnLock.of(try bot(#","busy":true"#)), .working)
    }

    func testWaitingOnTheViewerIsApprovalUnlessEveryCardIsAnAdmins() throws {
        let waiting = #","busy":true,"activity":"waiting-on-you""#
        XCTAssertEqual(ModelTurnLock.of(try bot(waiting)), .approval, "no card loaded yet")
        XCTAssertEqual(ModelTurnLock.of(try bot(waiting + #","messages":[\#(ask("a", admin: false))]"#)), .approval)
        XCTAssertEqual(ModelTurnLock.of(try bot(waiting + #","messages":[\#(ask("a", admin: true)),\#(ask("b", admin: false))]"#)), .approval)
        XCTAssertEqual(ModelTurnLock.of(try bot(waiting + #","messages":[\#(ask("a", admin: true))]"#)), .admin)
    }

    func testTheSelectedThreadOutranksTheBot() throws {
        let other = #","busy":true,"activity":"working","tasks":[{"threadId":"t1","title":"Main","createdAt":1,"busy":false}]"#
        XCTAssertNil(ModelTurnLock.of(try bot(other)), "another thread's work does not lock this one")
        let mine = #","busy":false,"tasks":[{"threadId":"t1","title":"Main","createdAt":1,"busy":true,"activity":"waiting-on-you"}]"#
        XCTAssertEqual(ModelTurnLock.of(try bot(mine)), .approval)
    }
}

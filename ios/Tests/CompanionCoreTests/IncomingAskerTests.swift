// #4201: the "Asked by" line never names the same bot twice. A hand-off
// receipt keeps the asking bot's id; a copy whose request kept only who asked
// by name is that same bot. The rule is the desktop's (src/lib/incoming-line.ts
// `sameIncomingParty`): a bot is one asker by its id, else by its name when
// neither side is an AI client or a phone line.
import XCTest
@testable import CompanionCore

final class IncomingAskerTests: XCTestCase {
    private func exchange(_ id: String, _ asker: IncomingAsker) -> IncomingExchange {
        IncomingExchange(id: id, asker: asker, at: 1, request: "Please check", reply: nil, trace: nil)
    }

    private func line(_ askers: [IncomingAsker]) -> IncomingLine {
        IncomingLine(messages: [], exchanges: askers.enumerated().map { exchange("e\($0.offset)", $0.element) })
    }

    func testABotByItsIdAndByItsNameAloneIsOneName() {
        let line = line([
            IncomingAsker(botId: "b", name: "Bot B", agent: false),
            IncomingAsker(botId: nil, name: "Bot B", agent: false),
        ])
        XCTAssertEqual(line.askers.count, 1)
        // the face is the bot's, from the row that has its id
        XCTAssertEqual(line.askers.first?.botId, "b")
        XCTAssertEqual(line.requestCount, 2)
        XCTAssertEqual(line.exchanges(of: line.askers[0]).map(\.id), ["e1", "e0"])
    }

    func testTheNameAloneFirstStillTakesTheBotsId() {
        let line = line([
            IncomingAsker(botId: nil, name: "bot b ", agent: false),
            IncomingAsker(botId: "b", name: "Bot B", agent: false),
        ])
        XCTAssertEqual(line.askers.map(\.botId), ["b"])
        XCTAssertEqual(line.exchanges(of: line.askers[0]).count, 2)
    }

    func testTwoBotsAnAIClientAndAPhoneLineStayApart() {
        let line = line([
            IncomingAsker(botId: "b", name: "Bot B", agent: false),
            IncomingAsker(botId: "c", name: "Bot B", agent: false),
            IncomingAsker(botId: nil, name: "Bot B", agent: true),
            IncomingAsker(botId: nil, name: "Bot B", agent: false, phone: "sms"),
        ])
        XCTAssertEqual(line.askers.count, 4)
        XCTAssertNil(line.requestCount)
    }
}

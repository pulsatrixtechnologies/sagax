@testable import CompanionCore
import XCTest

/// #1329: the "do not finish until" row and settings on the wire
/// (shared/finish-until-line.ts, server/bots/bot-profile.ts).
final class FinishUntilTests: XCTestCase {
    func testDecodesTheConditionRowAndTheBotSetting() throws {
        let row = #"{"name":"Relaunch 1/5: not finished until the tests pass","ok":true,"finishUntil":{"status":"relaunch","condition":"the tests pass","round":1,"max":5}}"#
        let tool = try JSONDecoder().decode(ToolActivity.self, from: Data(row.utf8))
        XCTAssertEqual(tool.finishUntil, FinishUntilLine(status: "relaunch", condition: "the tests pass", round: 1, max: 5))
        // an older server sends no line: the chip still decodes
        let plain = try JSONDecoder().decode(ToolActivity.self, from: Data(#"{"name":"Bash","ok":true}"#.utf8))
        XCTAssertNil(plain.finishUntil)
        XCTAssertEqual(FinishUntilLine.rounds(nil), 5)
        XCTAssertEqual(FinishUntilLine.rounds(0), 1)
        XCTAssertEqual(FinishUntilLine.rounds(99), 50)
    }

    func testEncodesTheConditionAndTheBoundWithAClear() throws {
        let set = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            BotProfilePatch(finishUntil: "the tests pass", finishUntilMaxRounds: .set(3))
        )) as? [String: Any]
        XCTAssertEqual(set?["finishUntil"] as? String, "the tests pass")
        XCTAssertEqual(set?["finishUntilMaxRounds"] as? Int, 3)
        let cleared = try JSONSerialization.jsonObject(with: JSONEncoder().encode(
            BotProfilePatch(finishUntil: "", finishUntilMaxRounds: .clear)
        )) as? [String: Any]
        XCTAssertEqual(cleared?["finishUntil"] as? String, "")
        XCTAssertTrue(cleared?["finishUntilMaxRounds"] is NSNull)
        let untouched = try JSONSerialization.jsonObject(with: JSONEncoder().encode(BotProfilePatch(speakReplies: true))) as? [String: Any]
        XCTAssertNil(untouched?["finishUntilMaxRounds"])
    }
}

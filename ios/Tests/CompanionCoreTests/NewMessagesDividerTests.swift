import XCTest
@testable import CompanionCore

/// The phone's "New" line: above the first reply after the person's last
/// message, nowhere when they wrote last or never wrote.
final class NewMessagesDividerTests: XCTestCase {
    private func text(_ id: String, _ role: Message.Role, at: Double) -> TranscriptRow {
        var message = Message(id: id, role: role, kind: .text, at: at)
        message.text = "sample"
        return .message(message)
    }

    func testSitsAboveTheFirstReplyAfterThePersonsLastMessage() {
        let rows = [
            text("a", .user, at: 1), text("b", .bot, at: 2),
            text("c", .user, at: 3), text("d", .bot, at: 4), text("e", .bot, at: 5),
        ]
        XCTAssertEqual(NewMessagesDivider.anchor(rows), "d")
    }

    func testNoLineWhenThePersonWroteLast() {
        let rows = [text("a", .bot, at: 1), text("b", .user, at: 2)]
        XCTAssertNil(NewMessagesDivider.anchor(rows))
    }

    func testNoLineWithoutAMessageOfThePerson() {
        let rows = [text("a", .bot, at: 1), text("b", .bot, at: 2)]
        XCTAssertNil(NewMessagesDivider.anchor(rows))
        XCTAssertNil(NewMessagesDivider.anchor([]))
    }
}

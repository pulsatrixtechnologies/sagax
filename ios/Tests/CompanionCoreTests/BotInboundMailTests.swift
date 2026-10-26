import XCTest
@testable import CompanionCore

/// The bot's own email address (B21 / iOS CO5, contract C of 2026-10-21):
/// `GET /api/bots/:id/inbound-mail` answers `{ available, address, enabled }`;
/// the profile shows the row only for an available, well-formed address.
final class BotInboundMailTests: XCTestCase {
    private func decode(_ text: String) throws -> BotInboundMail {
        try JSONDecoder().decode(BotInboundMail.self, from: Data(text.utf8))
    }

    func testAvailableAddressGivesARow() throws {
        let answer = try decode(#"{"available":true,"address":"cryptic@bots.example.org","enabled":true}"#)
        XCTAssertEqual(BotInboundMailRules.row(answer), BotInboundMailRow(address: "cryptic@bots.example.org", waitingForAdmin: false))
    }

    func testAnAddressWaitingForTheAdminIsShownWithItsState() throws {
        let answer = try decode(#"{"available":true,"address":"ember@bots.example.org","enabled":false}"#)
        XCTAssertEqual(BotInboundMailRules.row(answer), BotInboundMailRow(address: "ember@bots.example.org", waitingForAdmin: true))
    }

    func testNothingWhenUnavailableOrNotAnAddress() throws {
        XCTAssertNil(BotInboundMailRules.row(try decode(#"{"available":false,"address":null,"enabled":false}"#)))
        XCTAssertNil(BotInboundMailRules.row(try decode(#"{"available":true,"address":null,"enabled":true}"#)))
        XCTAssertNil(BotInboundMailRules.row(try decode(#"{"available":true,"address":"not an address","enabled":true}"#)))
        XCTAssertNil(BotInboundMailRules.row(try decode(#"{"available":false,"address":"a@b.example","enabled":true}"#)))
        XCTAssertNil(BotInboundMailRules.row(nil))
    }

    func testTriggerSourceLabel() {
        XCTAssertEqual(WebhookPublicURL.sourceLabel("botmail"), "Bot email")
        XCTAssertEqual(WebhookPublicURL.sourceLabel("email"), "Outlook")
    }
}

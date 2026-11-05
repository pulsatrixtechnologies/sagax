import XCTest
@testable import CompanionCore

/// 2026-11-05: what a bot's turn elsewhere left for the person rides
/// `Message.attention` (shared/person-attention.ts); the phone decodes it,
/// opens only https tickets, and older rows without it still decode.
final class PersonAttentionTests: XCTestCase {
    func testDecodesTheCardOnATextMessage() throws {
        let json = #"{"id":"m1","role":"bot","kind":"text","at":1,"text":"Atlas needs you:\n- **100201** decide","attention":{"kind":"human","items":[{"text":"**100201** decide","ticketId":100201,"ticketUrl":"https://cw.example.com/v4_6_release/services/system_io/router/openrecord.rails?recordType=ServiceFv&recid=100201"},{"text":"close it by hand","ticketId":100202,"ticketUrl":"javascript:alert(1)"}],"botId":"b-atlas","botName":"Atlas","threadId":"work","threadTitle":"@Nova · work","sourceMessageId":"src","openedBy":{"botId":"b-nova","name":"Nova"}}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        let card = try XCTUnwrap(message.attention)
        XCTAssertEqual(card.items.map(\.ticketId), [100201, 100202])
        XCTAssertEqual(card.items[0].safeTicketURL?.host, "cw.example.com")
        XCTAssertNil(card.items[1].safeTicketURL)
        XCTAssertEqual(card.openedBy?.name, "Nova")
        XCTAssertEqual(card.threadRef, ThreadRef(botId: "b-atlas", threadId: "work", title: "@Nova · work"))
    }

    func testARowWithoutTheCardStillDecodes() throws {
        let message = try JSONDecoder().decode(Message.self, from: Data(#"{"id":"m1","role":"bot","kind":"text","at":1,"text":"hi"}"#.utf8))
        XCTAssertNil(message.attention)
    }
}

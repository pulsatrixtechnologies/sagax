import XCTest
@testable import CompanionCore

final class AskFactTests: XCTestCase {
    private func decode(_ json: String) throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(json.utf8))
    }

    func testCardCarriesFactsAndTheRecordRef() throws {
        let card = try decode(#"""
        {"title":"t","subtitle":"s","options":[],"facts":[
          {"label":"Billet","value":"#300769","record":{"product":"connectwise","kind":"ticket","id":"300769"}},
          {"label":"Client","value":"Sherweb"}]}
        """#)
        let rows = AskFact.shown(card.facts)
        XCTAssertEqual(rows.map(\.label), ["Billet", "Client"])
        XCTAssertEqual(rows[0].record, RecordRef(product: "connectwise", kind: "ticket", id: "300769"))
        XCTAssertNil(rows[1].record)
    }

    func testOddRowsAreDroppedNotFatal() throws {
        let card = try decode(#"""
        {"title":"t","subtitle":"s","options":[],"facts":[
          {"label":"","value":"blank label"},{"label":"No value"},
          {"label":"Bad ref","value":"x","record":{"product":"Connect Wise","kind":"ticket","id":"1"}}]}
        """#)
        let rows = AskFact.shown(card.facts)
        XCTAssertEqual(rows.map(\.label), ["Bad ref"])
        XCTAssertNil(rows[0].record)
    }

    func testCardWithoutFactsIsUnchanged() throws {
        let card = try decode(#"{"title":"t","subtitle":"s","options":[]}"#)
        XCTAssertNil(card.facts)
        XCTAssertTrue(AskFact.shown(card.facts).isEmpty)
    }
}

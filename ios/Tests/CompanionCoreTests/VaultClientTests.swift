import XCTest
@testable import CompanionCore

final class VaultClientTests: XCTestCase {
    func testACardListingShowsTheLastFourAndNotANumber() throws {
        let json = """
        {"items":[{"id":"abc12345","kind":"card","name":"Shop","domains":[],"hasPassword":false,"hasNotes":false,"card":{"brand":"visa","last4":"4242","expMonth":12,"expYear":2030,"holder":"Ada"}}],"purchases":[{"id":"pay_0123456789abcdef","title":"Pay 12.50 CAD to Shop?","line":"Card ending 4242 (visa).","merchant":"Shop"}]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertEqual(list.items[0].subtitle, "visa · 4242")
        XCTAssertFalse(json.contains("4242424242424242"))
        XCTAssertEqual(list.purchases[0].merchant, "Shop")
    }

    func testAnOlderListWithoutPurchasesStillDecodes() throws {
        let json = """
        {"items":[{"id":"abc12345","kind":"login","name":"Portal","domains":["example.test"],"hasPassword":true,"hasNotes":false}]}
        """
        let list = try JSONDecoder().decode(VaultList.self, from: Data(json.utf8))
        XCTAssertTrue(list.purchases.isEmpty)
        XCTAssertEqual(list.items[0].subtitle, "example.test")
    }
}

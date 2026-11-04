import XCTest
@testable import CompanionCore

final class GrokLinkTests: XCTestCase {
    func testAMarketplacePageAndAShareLinkAreGrokLinks() {
        XCTAssertEqual(GrokLink.marketplaceSlug("https://x.ai/bot/marketplace/bots/osprey-helper"), "osprey-helper")
        XCTAssertEqual(GrokLink.marketplaceSlug("x.ai/bot/marketplace/bots/ara"), "ara")
        XCTAssertEqual(GrokLink.shareId("https://x.ai/bot/AbC123xyz0123456789_-"), "AbC123xyz0123456789_-")
        XCTAssertNil(GrokLink.shareId("https://x.ai/bot/marketplace"))
    }

    func testOtherAddressesAreNot() {
        XCTAssertFalse(GrokLink.isLink("http://x.ai/bot/AbC123xyz0123456789_-"))
        XCTAssertFalse(GrokLink.isLink("https://evil.example/bot/AbC123xyz0123456789_-"))
        XCTAssertFalse(GrokLink.isLink("https://x.ai:8443/bot/AbC123xyz0123456789_-"))
        XCTAssertFalse(GrokLink.isLink("hello"))
    }
}

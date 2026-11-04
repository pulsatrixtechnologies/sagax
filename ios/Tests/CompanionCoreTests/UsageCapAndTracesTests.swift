import XCTest
@testable import CompanionCore

final class UsageCapAndTracesTests: XCTestCase {
    func testALimitIsReadAsTheDesktopReadsIt() {
        XCTAssertEqual(PersonalSpendCap.parse("25"), 25)
        XCTAssertEqual(PersonalSpendCap.parse("$25,50"), 25.5)
        XCTAssertNil(PersonalSpendCap.parse("0.5"))
        XCTAssertNil(PersonalSpendCap.parse("abc"))
        XCTAssertNil(PersonalSpendCap.parse("25.555"))
    }

    func testRemovingTheLimitSendsNullAndTracesAreTheirOwn() throws {
        let client = CompanionClient(connection: Connection(id: "c", name: "c", host: "example.test", port: 443), token: "t")
        let remove = try client.setSpendCapRequest(nil)
        let body = try JSONSerialization.jsonObject(with: remove.httpBody ?? Data()) as? [String: Any]
        XCTAssertTrue(body?["monthlyUsd"] is NSNull)
        let traces = try client.myUsageTracesRequest(from: "2026-11-01", to: "2026-11-30", limit: 10, offset: 0)
        XCTAssertEqual(traces.url?.path, "/api/me/usage/traces")
    }
}

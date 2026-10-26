import XCTest
@testable import CompanionCore

final class AppVersionTextTests: XCTestCase {
    func testLineNamesAppVersionBuildAndPlatform() {
        XCTAssertEqual(
            AppVersionText.line(version: "0.6.0", build: "61", platform: "iOS", osVersion: "19.1"),
            "Pulsatrix Sagax 0.6.0 (61) · iOS 19.1"
        )
    }

    func testLineKeepsDevPlaceholdersVisibleRatherThanEmpty() {
        XCTAssertEqual(
            AppVersionText.line(version: "dev", build: "?", platform: "iPadOS", osVersion: "19.0"),
            "Pulsatrix Sagax dev (?) · iPadOS 19.0"
        )
    }
}

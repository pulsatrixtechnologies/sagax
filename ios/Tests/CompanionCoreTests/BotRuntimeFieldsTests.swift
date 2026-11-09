// Edit bot fields read on iOS (#3017): the bot's parallel conversations
// limit from GET /api/bots/:id/runtime-settings.
import XCTest
@testable import CompanionCore

final class BotRuntimeFieldsTests: XCTestCase {
    func testRuntimeSettingsReadTheThreadLimit() throws {
        let json = #"{"automaticRecovery":{"enabled":false},"maxConcurrentThreads":5,"busySend":"queue"}"#
        let settings = try JSONDecoder().decode(BotRuntimeSettings.self, from: Data(json.utf8))
        XCTAssertEqual(settings.maxConcurrentThreads, 5)
    }

    func testRuntimeSettingsWithoutALimitReadNil() throws {
        let settings = try JSONDecoder().decode(BotRuntimeSettings.self, from: Data("{}".utf8))
        XCTAssertNil(settings.maxConcurrentThreads)
    }
}

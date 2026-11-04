import XCTest
@testable import CompanionCore

final class ExperimentalFeaturesTests: XCTestCase {
    func testTheSevenExperimentalSwitchesAreSentAndAnUnknownOneIsNot() throws {
        for name in ["skillAuthoring", "browser", "decisionModel", "dataWindow", "meetingNotetaker", "llmThreadTitles"] {
            let body = DesktopConfigChange.feature(name, true).body as? [String: [String: Bool]]
            XCTAssertEqual(body?["features"]?[name], true, name)
        }
        XCTAssertNil(DesktopConfigChange.feature("bogus", true).body)
        let config = try JSONDecoder().decode(DesktopSettingsConfig.self, from: Data(#"{"features":{"decisionModel":true,"llmThreadTitles":false}}"#.utf8))
        XCTAssertEqual(config.features?.decisionModel, true)
        XCTAssertNil(config.features?.dataWindow, "an older server sends none: the row stays greyed")
    }
}

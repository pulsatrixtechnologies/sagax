import CompanionCore
import Foundation
import XCTest

/// Parity R1: the phone's typed trigger list names each event the way the
/// desktop does (`triggers.event.*`), never the raw kind.
final class ParityR1TriggersTests: XCTestCase {
    private func desktopEnglish() throws -> [String: String] {
        let root = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        let data = try Data(contentsOf: root.appendingPathComponent("src/locales/en.json"))
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
    }

    func testEveryDesktopEventKindHasTheDesktopLabel() throws {
        let english = try desktopEnglish()
        let keys = english.keys.filter { $0.hasPrefix("triggers.event.") }
        XCTAssertFalse(keys.isEmpty)
        XCTAssertEqual(Set(keys.map { String($0.dropFirst("triggers.event.".count)) }), Set(WebhookPublicURL.eventLabels.keys.map { $0.replacingOccurrences(of: ".", with: "_") }))
        for (kind, label) in WebhookPublicURL.eventLabels {
            XCTAssertEqual(english["triggers.event.\(kind.replacingOccurrences(of: ".", with: "_"))"], label, kind)
        }
    }

    func testNewGitHubLinearAndSentryKindsAreNamed() {
        XCTAssertEqual(WebhookPublicURL.eventLabel("pr.review_approved"), "Review approves")
        XCTAssertEqual(WebhookPublicURL.eventLabel("pr.thread_resolved"), "Review thread resolved")
        XCTAssertEqual(WebhookPublicURL.eventLabel("cycle.completed"), "Cycle completed")
        XCTAssertEqual(WebhookPublicURL.eventLabel("issue.unresolved"), "Issue unresolved again")
        XCTAssertNil(WebhookPublicURL.eventLabel("something.new"))
    }
}

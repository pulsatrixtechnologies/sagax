import CompanionCore
import XCTest

final class WatchSessionGenerationTests: XCTestCase {
    private let time = Date(timeIntervalSince1970: 10)

    func testPhoneRelaunchPreservesWatchSessionWhenPhoneIsAway() throws {
        let first = WatchSessionGeneration.resolve(previous: nil, accountID: "first", token: "fixture", now: time)
        let restored = try JSONDecoder().decode(WatchSessionGeneration.self, from: JSONEncoder().encode(first))
        let later = WatchSessionGeneration.resolve(previous: restored, accountID: "first", token: "fixture",
                                                   now: time.addingTimeInterval(50))
        XCTAssertEqual(later, first)
    }

    func testAccountSwitchSignOutAndNewCredentialRejectOlderDeliveries() {
        var previous = WatchSessionGeneration.resolve(previous: nil, accountID: "first", token: "fixture", now: time)
        let transitions: [(String?, String?)] = [("second", "fixture"), ("second", "renewed"), (nil, nil), ("first", "fixture")]
        for (account, token) in transitions {
            let next = WatchSessionGeneration.resolve(previous: previous, accountID: account, token: token,
                                                       now: time.addingTimeInterval(-1))
            XCTAssertGreaterThan(next.revision, previous.revision)
            XCTAssertFalse(WatchSessionGeneration.accepts(previous.revision, after: next.revision))
            XCTAssertTrue(WatchSessionGeneration.accepts(next.revision, after: next.revision))
            previous = next
        }
    }
}

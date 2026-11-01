import XCTest
@testable import CompanionCore

final class BotComputerPhaseTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_800_000_000)

    func testAnIdleBotsComputerIsAsleep() {
        XCTAssertEqual(BotComputerPhase.of(computer: nil, busy: false, wakeRequestedAt: nil, now: now), .asleep)
    }

    func testAWorkingBotShowsItsLiveScreen() {
        XCTAssertEqual(BotComputerPhase.of(computer: "cloud", busy: true, wakeRequestedAt: nil, now: now), .running)
    }

    func testWakingThenRunning() {
        XCTAssertEqual(BotComputerPhase.of(computer: nil, busy: false, wakeRequestedAt: now.addingTimeInterval(-1), now: now), .waking)
        XCTAssertEqual(BotComputerPhase.of(computer: nil, busy: false, wakeRequestedAt: now.addingTimeInterval(-BotComputerPhase.wakeWindow - 1), now: now), .running)
    }

    func testNoComputer() {
        XCTAssertEqual(BotComputerPhase.of(computer: "off", busy: true, wakeRequestedAt: nil, now: now), .off)
    }
}

import XCTest
@testable import CompanionCore

final class DesktopFirstRunTests: XCTestCase {
    func testFirstRunDueFollowsTheRecord() {
        XCTAssertTrue(FirstRun.due(nil, configLoaded: true, canSave: true))
        XCTAssertFalse(FirstRun.due(nil, configLoaded: false, canSave: true))
        XCTAssertFalse(FirstRun.due(nil, configLoaded: true, canSave: false))
        XCTAssertFalse(FirstRun.due(OnboardingStatus(completedAt: "2026-11-04T10:00:00.000Z", version: 1), configLoaded: true, canSave: true))
        XCTAssertTrue(FirstRun.due(OnboardingStatus(completedAt: "2026-11-04T10:00:00.000Z", version: 0), configLoaded: true, canSave: true))
    }

    func testInitialStepSkipsWhatIsDone() {
        XCTAssertEqual(FirstRun.initialStep(engineReady: false, botExists: true), .engine)
        XCTAssertEqual(FirstRun.initialStep(engineReady: true, botExists: false), .bot)
        XCTAssertEqual(FirstRun.initialStep(engineReady: true, botExists: true), .message)
    }

    func testCompletionPatchCarriesTheVersion() throws {
        let patch = FirstRun.completionPatch(now: Date(timeIntervalSince1970: 0))
        let onboarding = try XCTUnwrap(patch["onboarding"] as? [String: Any])
        XCTAssertEqual(onboarding["version"] as? Int, 1)
        XCTAssertEqual(onboarding["completedAt"] as? String, "1970-01-01T00:00:00.000Z")
    }

    func testTourHasNineVisibleSteps() {
        XCTAssertEqual(GuidedTour.steps.count, 10)
        let first = GuidedTour.steps[0]
        XCTAssertEqual(GuidedTour.number(first).current, 1)
        XCTAssertEqual(GuidedTour.number(first).total, 9)
        XCTAssertEqual(GuidedTour.steps.last?.id, "tour.done")
        XCTAssertEqual(first.copy, "composer")
    }

    func testTourProgressComesFromTheHints() {
        XCTAssertEqual(GuidedTour.current(nil)?.id, "tour.composer")
        XCTAssertFalse(GuidedTour.inProgress(nil))
        let record = OnboardingStatus(hintsSeen: ["tour.composer", "other"])
        XCTAssertEqual(GuidedTour.current(record)?.id, "tour.model")
        XCTAssertTrue(GuidedTour.inProgress(record))
        XCTAssertNil(GuidedTour.seenPatch(record, id: "tour.composer"))
        let patch = GuidedTour.seenPatch(record, id: "tour.model")?["onboarding"] as? [String: Any]
        XCTAssertEqual(patch?["hintsSeen"] as? [String], ["tour.composer", "other", "tour.model"])
        let finished = GuidedTour.finishedPatch(record)["onboarding"] as? [String: Any]
        XCTAssertEqual((finished?["hintsSeen"] as? [String])?.count, 11)
        let reset = GuidedTour.resetPatch(record)["onboarding"] as? [String: Any]
        XCTAssertEqual(reset?["hintsSeen"] as? [String], ["other"])
    }

    func testConfigDecodesTheOnboardingRecord() throws {
        let json = #"{"onboarding":{"completedAt":"2026-11-04T10:00:00.000Z","version":1,"hintsSeen":["tour.composer"]}}"#
        let config = try JSONDecoder().decode(ConfigStatus.self, from: Data(json.utf8))
        XCTAssertEqual(config.onboarding?.version, 1)
        XCTAssertEqual(config.onboarding?.hintsSeen, ["tour.composer"])
    }
}

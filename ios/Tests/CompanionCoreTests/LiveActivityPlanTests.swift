import XCTest
@testable import CompanionCore

/// What the Dynamic Island and the lock screen hold across the app's life:
/// stuck "working" cards, cards that vanished on launch, asks whose buttons
/// outlived the answer (2026-11-01, JC on a physical iPhone).
final class LiveActivityPlanTests: XCTestCase {
    private let since = Date(timeIntervalSince1970: 1_800_000_000)

    private func ask(_ requestId: String = "r1") -> OptionCard? {
        try? JSONDecoder().decode(OptionCard.self, from: Data(#"{"title":"Run a command","subtitle":"","options":["Allow","Deny"],"requestId":"\#(requestId)","tool":"Bash"}"#.utf8))
    }

    private func working(_ line: String = "Reading") -> BotActivityContent {
        BotActivityContent(face: "working", kind: "working", headline: "Scout is working", line: line, threadId: "t1", card: nil, since: since)
    }

    private func needsYou() -> BotActivityContent {
        BotActivityContent(face: "alerting", kind: "needsYou", headline: "Scout needs you", line: "Run npm install?", threadId: "t1", card: ask(), since: since)
    }

    func testABotThatStartsWorkingGetsOneActivity() {
        let plan = LiveActivityPlan.plan(wants: [.init(botId: "b1", content: working())], running: [], knownBots: ["b1"], knowledge: .live)
        XCTAssertEqual(plan, [.start(botId: "b1", content: working(), relevance: 50, staleAfter: nil)])
    }

    func testABotThatGoesQuietEndsWithADoneCardThatLeavesOnItsOwn() {
        let plan = LiveActivityPlan.plan(wants: [], running: [.init(id: "a1", botId: "b1", content: needsYou())], knownBots: ["b1"], knowledge: .live)
        guard case let .end(id, final?, dismissAfter) = plan.first else { return XCTFail("\(plan)") }
        XCTAssertEqual(id, "a1")
        XCTAssertEqual(final.kind, "done")
        XCTAssertNil(final.requestId)
        XCTAssertTrue(final.options.isEmpty)
        XCTAssertNil(final.approvalThreadId, "a finished card has no buttons")
        XCTAssertEqual(dismissAfter, LiveActivityPlan.doneLinger)
        XCTAssertEqual(LiveActivityTitle(final), .done)
        XCTAssertFalse(LiveActivityTitle(final).timed, "no clock still counting on a finished card")
    }

    func testABotNoLongerOnThisAccountEndsAtOnce() {
        let plan = LiveActivityPlan.plan(wants: [], running: [.init(id: "a1", botId: "gone", content: working())], knownBots: ["b1"], knowledge: .live)
        XCTAssertEqual(plan, [.end(id: "a1", final: nil, dismissAfter: 0)])
    }

    /// Launch, before the first hydrate (or offline): the island keeps what
    /// it showed and only gets a stale date, never an end-then-start flicker.
    func testUnknownStateKeepsEveryCardAndMarksItStale() {
        let running = [LiveActivityPlan.Running(id: "a1", botId: "b1", content: working())]
        let plan = LiveActivityPlan.plan(wants: [], running: running, knownBots: [], knowledge: .unknown)
        XCTAssertEqual(plan, [.update(id: "a1", content: working(), relevance: 50, staleAfter: LiveActivityPlan.unknownStaleAfter)])
    }

    /// A push hydrated the state in the background: the system refuses a
    /// start there, so nothing starts; updates and ends carry a stale date.
    func testABackgroundPushUpdatesAndEndsButNeverStarts() {
        let running = [LiveActivityPlan.Running(id: "a1", botId: "b1", content: needsYou())]
        let plan = LiveActivityPlan.plan(
            wants: [.init(botId: "b1", content: working()), .init(botId: "b2", content: working())],
            running: running, knownBots: ["b1", "b2"], knowledge: .background
        )
        XCTAssertEqual(plan, [.update(id: "a1", content: working(), relevance: 50, staleAfter: LiveActivityPlan.backgroundStaleAfter)])
    }

    func testTwoActivitiesForOneBotKeepTheFirst() {
        let running = [
            LiveActivityPlan.Running(id: "a1", botId: "b1", content: working()),
            LiveActivityPlan.Running(id: "a2", botId: "b1", content: working()),
        ]
        let plan = LiveActivityPlan.plan(wants: [.init(botId: "b1", content: working())], running: running, knownBots: ["b1"],
                                         knowledge: .live, lastSent: ["a1": working()])
        XCTAssertEqual(plan, [.end(id: "a2", final: nil, dismissAfter: 0)])
    }

    func testTheSameContentIsNotSentAgainUnlessTheStaleDateMustChange() {
        let running = [LiveActivityPlan.Running(id: "a1", botId: "b1", content: working())]
        let wants = [LiveActivityPlan.Want(botId: "b1", content: working())]
        XCTAssertEqual(LiveActivityPlan.plan(wants: wants, running: running, knownBots: ["b1"], knowledge: .live, lastSent: ["a1": working()]), [])
        // back from the background: the stale date set while away is cleared
        XCTAssertEqual(
            LiveActivityPlan.plan(wants: wants, running: running, knownBots: ["b1"], knowledge: .live, lastSent: ["a1": working()], forceRefresh: true),
            [.update(id: "a1", content: working(), relevance: 50, staleAfter: nil)]
        )
        // a new line is always sent
        XCTAssertEqual(
            LiveActivityPlan.plan(wants: [.init(botId: "b1", content: working("Writing"))], running: running, knownBots: ["b1"], knowledge: .live, lastSent: ["a1": working()]),
            [.update(id: "a1", content: working("Writing"), relevance: 50, staleAfter: nil)]
        )
    }

    func testTheAskOutranksTheWorkInTheIsland() {
        XCTAssertGreaterThan(LiveActivityPlan.relevance(needsYou()), LiveActivityPlan.relevance(working()))
    }

    func testAnAnswerFromTheIslandDropsTheButtonsAtOnce() {
        let ask = needsYou()
        XCTAssertNotNil(ask.approvalThreadId)
        let answered = LiveActivityPlan.answered(ask, choice: "Allow")
        XCTAssertNil(answered.approvalThreadId)
        XCTAssertFalse(answered.canAnswer(threadId: "t1", requestId: "r1", choice: "Allow", isPermission: ask.isPermission),
                       "a second tap on a card still on screen cannot answer twice")
        XCTAssertEqual(answered.line, "Allow")
        XCTAssertEqual(LiveActivityTitle(answered), .answered)
    }

    func testAConfidentialThreadIsTitledAsSuch() {
        var content = working()
        content.headline = ConfidentialRedaction.placeholder
        XCTAssertEqual(LiveActivityTitle(content), .confidential)
    }
}

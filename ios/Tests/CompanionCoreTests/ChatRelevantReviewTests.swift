import Foundation
import XCTest
@testable import CompanionCore

/// #3581, second review of the phone's lot: the whole routine report behind
/// Details, "Working" only on a turn of this thread that runs (the desktop's
/// rule, its cases ported), a failed or stopped background task keeps its
/// row, and a names line that does not fit drops names, never cuts one.
final class ChatRelevantReviewTests: XCTestCase {
    // MARK: Details shows the whole report

    private func routineRun(_ id: String, output: String? = nil, report: String? = nil, redacted: Bool? = nil) -> RoutineRun {
        var run = RoutineRun(id: id, routineId: "r", routineName: "Inbox", botId: "b", runOn: "computer",
                             scheduledFor: 1, status: "completed", manual: false, output: output, createdAt: 1)
        run.report = report
        run.redacted = redacted
        return run
    }

    func testACardWhoseRunCannotBeReadStillShowsItsWholeSummary() {
        let report = String(repeating: "Checked one more mailbox rule and left it alone. ", count: 60)
            + "\n\n3 messages need you."
        let card = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: "completed", summary: report)
        XCTAssertEqual(RoutineResults.wholeReport(card: card, run: nil), report.trimmingCharacters(in: .whitespacesAndNewlines))
        XCTAssertEqual(RoutineResults.wholeReport(card: card, run: routineRun("1", output: String(report.prefix(2_000)))), report.trimmingCharacters(in: .whitespacesAndNewlines),
                       "the record's clip never replaces the card's longer report")
    }

    func testACardWithABriefShorterThanItsReportShowsTheReportNotTheBrief() {
        let report = "Read 40 messages.\n\n- two quotes to sign\n- one meeting to confirm\n\n3 messages need you."
        let card = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: "completed", summary: report,
                                  brief: "3 messages need you.")
        XCTAssertLessThan(card.briefText.count, report.count)
        XCTAssertEqual(RoutineResults.wholeReport(card: card), report)
        XCTAssertNotEqual(RoutineResults.wholeReport(card: card), card.briefText)
    }

    func testTheSingleRunReadWinsWhenItHoldsMore() {
        let clip = String(repeating: "a", count: 2_000)
        let whole = clip + String(repeating: "b", count: 3_000)
        let card = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: "completed", summary: clip)
        XCTAssertTrue(RoutineResults.wantsWholeReport(card))
        XCTAssertEqual(RoutineResults.wholeReport(card: card, run: routineRun("1", output: clip, report: whole)), whole)
        // someone else's run: the card's own text
        XCTAssertEqual(RoutineResults.wholeReport(card: card, run: routineRun("1", report: whole, redacted: true)), clip)
        // a short report is whole already: no read
        XCTAssertFalse(RoutineResults.wantsWholeReport(RoutineRunCard(runId: "2", routineId: "r", routineName: "Inbox", status: "completed", summary: "Done.")))
    }

    func testARunWithNoReportSaysWhatTheCardSays() {
        let failed = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: "failed", error: "the mailbox refused the sign-in")
        XCTAssertEqual(RoutineResults.wholeReport(card: failed), "the mailbox refused the sign-in")
    }

    // MARK: The live turn (desktop src/lib/tool-liveness.test.ts)

    private typealias Row = TurnLiveness.Row
    private func run(_ busy: Bool, _ started: Double?) -> TurnLiveness.Run { .init(busy: busy, turnStartedAt: started) }

    func testIsTheBusyTurnSinceItStartedATurnThatOnlyWritesNotesIncluded() {
        let rows = [Row(at: 10, turnId: "before"), Row(at: 60, turnId: "a")]
        XCTAssertEqual(TurnLiveness.liveTurnIds(rows, run: run(true, 50)), ["a"])
        XCTAssertTrue(TurnLiveness.foldsLiveTurn([rows[1]], liveTurns: TurnLiveness.liveTurnIds(rows, run: run(true, 50))))
    }

    func testASteerSentWhileTheTurnRunsLeavesItLive() {
        let rows = [Row(at: 40), Row(at: 60, turnId: "a"), Row(at: 70, turnId: "a"), Row(at: 80)]
        let live = TurnLiveness.liveTurnIds(rows, run: run(true, 50))
        XCTAssertTrue(TurnLiveness.foldsLiveTurn([rows[1], rows[2]], liveTurns: live))
    }

    func testEmptyWhenIdleAndAStoppedOrFailedOrCompletedTurnIsNotLive() {
        // a failed or stopped turn is marked terminal, as an answered one
        let rows = [Row(at: 60, turnId: "a"), Row(at: 70, turnId: "a", turnTerminal: true), Row(at: 80, turnId: "b", turnCompletedAt: 90)]
        XCTAssertTrue(TurnLiveness.liveTurnIds(rows, run: run(false, 50)).isEmpty)
        XCTAssertTrue(TurnLiveness.liveTurnIds(rows, run: run(true, nil)).isEmpty)
        XCTAssertTrue(TurnLiveness.liveTurnIds(rows, run: run(true, 50)).isEmpty)
        XCTAssertTrue(TurnLiveness.liveTurnIds(rows, run: nil).isEmpty)
        XCTAssertFalse(TurnLiveness.foldsLiveTurn([rows[0]], liveTurns: TurnLiveness.liveTurnIds(rows, run: run(true, 50))))
    }

    private func task(_ threadId: String, busy: Bool, startedAt: Double? = nil) -> BotTask {
        var task = BotTask(threadId: threadId, title: threadId, createdAt: 0)
        task.busy = busy
        task.turnStartedAt = startedAt
        return task
    }

    private func bot(tasks: [BotTask]) -> Bot {
        var bot = Bot(id: "b", threadId: "home", name: "Server", title: "Assistant",
                      description: "", notifications: true, color: "green", unread: false,
                      modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1,
                      tasks: tasks)
        // the bot works somewhere: a routine in another thread
        bot.busy = true
        return bot
    }

    private func turnRow(_ id: String, turn: String, at: Double, terminal: Bool = false) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "note \(id)"
        message.turnId = turn
        message.turnTerminal = terminal ? true : nil
        return message
    }

    func testAnOldTurnWithNoTerminalRowIsNotLiveWhileAnotherThreadOfTheBotWorks() {
        // history from before the terminal marker, or a turn cut off by a restart
        let old = [turnRow("n1", turn: "old", at: 100), turnRow("n2", turn: "old", at: 110)]
        let working = bot(tasks: [task("home", busy: false), task("routine-run", busy: true, startedAt: 5_000)])
        let live = TurnLiveness.liveTurnIds(old, run: TurnLiveness.run(of: working, threadId: "home"))
        XCTAssertFalse(TurnLiveness.foldsLiveTurn(old, liveTurns: live))
        // this thread's own turn that runs is live
        let mine = old + [turnRow("n3", turn: "now", at: 6_000)]
        let own = bot(tasks: [task("home", busy: true, startedAt: 5_000)])
        let ownLive = TurnLiveness.liveTurnIds(mine, run: TurnLiveness.run(of: own, threadId: "home"))
        XCTAssertEqual(ownLive, ["now"])
        XCTAssertFalse(TurnLiveness.foldsLiveTurn(old, liveTurns: ownLive), "the old turn stays settled while the new one runs")
    }

    // MARK: A background task that failed or was stopped

    func testAFailedOrStoppedTaskKeepsItsRowAndADoneOneLeavesItToItsAnswer() {
        XCTAssertTrue(ParallelCardState.failed.drawsRow)
        XCTAssertTrue(ParallelCardState.stopped.drawsRow)
        XCTAssertTrue(ParallelCardState.failed.leavesTrace)
        XCTAssertTrue(ParallelCardState.stopped.leavesTrace)
        XCTAssertFalse(ParallelCardState.done.drawsRow)
        for live in [ParallelCardState.queued, .running, .waiting] {
            XCTAssertTrue(live.drawsRow)
            XCTAssertFalse(live.leavesTrace)
        }
        let ref = ParallelTaskRef(threadId: "t", title: "Draft the email", requestMessageId: "m", role: "card", state: "failed")
        XCTAssertEqual(ParallelCardState.of(ref, task: nil), .failed)
    }

    // MARK: A waiting task says what it waits on (ParallelTaskCard.tsx)

    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testAWaitingTaskWaitsOnAnAnswerOnlyWhenAQuestionIsOpenInItsThread() throws {
        let approval = try message(#"""
        {"id":"a","role":"bot","kind":"options","at":1,
         "card":{"title":"Approval needed","subtitle":"ls","options":["Allow","Deny"],"requestId":"r-a","tool":"Bash"}}
        """#)
        let question = try message(#"""
        {"id":"q","role":"bot","kind":"options","at":2,
         "card":{"title":"t","subtitle":"Which account?","options":[],"requestId":"r-q",
                 "questionRequest":{"questions":[{"question":"Which account?"}]}}}
        """#)
        let answered = try message(#"""
        {"id":"q2","role":"bot","kind":"options","at":3,
         "card":{"title":"t","subtitle":"Which account?","options":[],"requestId":"r-q2","answered":"Main",
                 "questionRequest":{"questions":[{"question":"Which account?"}]}}}
        """#)
        XCTAssertEqual(ApprovalDockRules.pendingQuestions([approval, question, answered]).map(\.id), ["q"])
        XCTAssertEqual(ParallelCardState.waiting.waitsOn(taskThread: [approval, question]), .answer)
        XCTAssertEqual(ParallelCardState.waiting.waitsOn(taskThread: [approval, answered]), .approval)
        XCTAssertEqual(ParallelCardState.waiting.waitsOn(taskThread: nil), .approval, "an unread thread waits on an approval, as on the desktop")
        XCTAssertNil(ParallelCardState.running.waitsOn(taskThread: [question]))
    }

    // MARK: The names line

    func testANamesLineThatDoesNotFitTriesFewerNamesNeverACutOne() {
        XCTAssertEqual(NamesLineFit.shownCounts(total: 15), [3, 2, 1])
        XCTAssertEqual(NamesLineFit.shownCounts(total: 2), [2, 1])
        XCTAssertEqual(NamesLineFit.shownCounts(total: 1), [1])
    }

    // MARK: The one rule places the received rows

    func testTheRulePlacesAReceivedRequestAsItsTrace() {
        var receipt = Message(id: "h", role: .bot, kind: .activity, at: 1)
        receipt.tool = ToolActivity(name: "handoff")
        receipt.tool?.handoffId = "h1"
        XCTAssertEqual(IncomingLines.place(receipt), .trace)
        XCTAssertNil(IncomingLines.place(Message(id: "x", role: .bot, kind: .text, at: 1)))
    }
}

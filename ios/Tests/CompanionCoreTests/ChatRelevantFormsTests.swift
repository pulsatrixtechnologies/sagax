import Foundation
import XCTest
@testable import CompanionCore

/// #3581 on the phone and the tablet: the same forms as the desktop. A
/// routine's result is a compact card that folds to its row once a newer
/// result follows; a turn's notes fold while it runs; requests received fold
/// into one names line per burst.
final class ChatRelevantFormsTests: XCTestCase {
    private func run(_ id: String, routine: String = "r", status: String = "completed", summary: String? = "All 12 backups completed.",
                     problems: String? = nil, at: Double) -> Message {
        var message = Message(id: id, role: .bot, kind: .routineRun, at: at)
        message.routineRun = RoutineRunCard(runId: id, routineId: routine, routineName: "Backup check", status: status, summary: summary, problems: problems)
        return message
    }

    private func note(_ id: String, turn: String, at: Double, terminal: Bool = false) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "note \(id)"
        message.turnId = turn
        message.turnTerminal = terminal ? true : nil
        return message
    }

    private func step(_ id: String, turn: String, at: Double, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: "Read", ok: ok)
        message.turnId = turn
        return message
    }

    // MARK: The result card

    func testAFinishedResultWithALongReportIsTheCardWithItsBriefNeverTheReport() {
        let report = String(repeating: "Checked one more mailbox rule and left it alone. ", count: 60)
            + "\n\n3 messages need you: two quotes to sign and one meeting to confirm."
        XCTAssertGreaterThan(report.count, 3_000)
        let card = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: "completed", summary: report)
        XCTAssertEqual(RoutineResultStack.form(card, attention: nil, folded: false), .card)
        XCTAssertEqual(card.briefText, "3 messages need you: two quotes to sign and one meeting to confirm.")
        XCTAssertLessThanOrEqual(card.briefText.count, ReportBrief.max)
    }

    func testRunsInProgressAndNothingToReportAreTheRow() {
        for status in ["queued", "running", "waiting", "failed", "cancelled", "nothing_to_report"] {
            let card = RoutineRunCard(runId: "1", routineId: "r", routineName: "Inbox", status: status)
            XCTAssertEqual(RoutineResultStack.form(card, attention: nil, folded: false), .row, status)
        }
    }

    func testAResultFollowedByANewerResultFoldsAndAProblemStaysACard() {
        let messages = [
            run("a", routine: "a", at: 1), run("b", routine: "b", problems: "the mailbox refused the sign-in", at: 2),
            run("c", routine: "c", at: 3),
        ]
        let folded = RoutineResultStack.foldedIds(messages)
        XCTAssertEqual(folded, ["a"], "the newest is the card, a problem stays a card until its routine works again")
        let b = messages[1].routineRun!
        XCTAssertEqual(RoutineResultStack.form(b, attention: nil, folded: folded.contains("b")), .card)
        // a later run of the same routine works again: the problem folds
        XCTAssertTrue(RoutineResultStack.foldedIds(messages + [run("d", routine: "b", at: 4)]).contains("b"))
    }

    func testThePersonsMessageBreaksAStack() {
        var person = Message(id: "p", role: .user, kind: .text, at: 2)
        person.text = "thanks"
        XCTAssertEqual(RoutineResultStack.foldedIds([run("a", at: 1), person, run("b", at: 3)]), [])
    }

    func testSeventeenRoutinesReportingInOneHourShowOneCard() {
        let messages = (0..<17).map { run("r\($0)", routine: "routine\($0)", at: Double($0)) }
        let folded = RoutineResultStack.foldedIds(messages)
        XCTAssertEqual(folded.count, 16)
        XCTAssertFalse(folded.contains("r16"))
    }

    func testABlockedRunDecodesAndIsAProblemCard() throws {
        let json = #"{"runId":"1","routineId":"r","routineName":"Sync","status":"blocked","brief":"Sign in again.","repeat":{"firstRunId":"0","count":4,"since":1,"lastAt":2},"recovered":{"afterRuns":2,"since":1}}"#
        let card = try JSONDecoder().decode(RoutineRunCard.self, from: Data(json.utf8))
        XCTAssertEqual(card.knownStatus, .blocked)
        XCTAssertEqual(card.repeat?.count, 4)
        XCTAssertNotNil(card.recovered)
        XCTAssertEqual(card.briefText, "Sign in again.")
        XCTAssertEqual(RoutineResultStack.form(card, attention: nil, folded: false), .card)
    }

    // MARK: The live fold

    func testARunningTurnFoldsEveryNoteButTheNewest() {
        var user = Message(id: "u", role: .user, kind: .text, at: 0)
        user.text = "go"
        let messages = [user, note("n1", turn: "t", at: 1), step("s1", turn: "t", at: 2), note("n2", turn: "t", at: 3)]
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.map(\.id), ["u", "turn.t", "n2"], "the row, then the line being written")
        guard case let .activityRun(run) = rows[1] else { return XCTFail("the turn's row") }
        XCTAssertEqual(run.messages.map(\.id), ["n1", "s1"])
        XCTAssertFalse(run.settled)
    }

    func testASettledTurnIsOneRowAndTheAnswerWithToolCallsOnAndOff() {
        var user = Message(id: "u", role: .user, kind: .text, at: 0)
        user.text = "go"
        let messages = [user, note("n1", turn: "t", at: 1), step("s1", turn: "t", at: 2), note("n2", turn: "t", at: 3),
                        step("s2", turn: "t", at: 4), note("n3", turn: "t", at: 5), note("a", turn: "t", at: 6, terminal: true)]
        for detail in [ActivityDetail.full, .hidden] {
            let rows = transcriptRows(messages, detail: detail)
            XCTAssertEqual(rows.map(\.id), ["u", "turn.t", "a"], "\(detail)")
            guard case let .activityRun(run) = rows[1] else { return XCTFail("the turn's row") }
            XCTAssertTrue(run.settled)
            XCTAssertEqual(run.messages.filter { $0.kind == .text }.map(\.id), ["n1", "n2", "n3"])
        }
    }

    func testAFailedHandOffStaysVisibleWhileTheTurnRuns() {
        var failed = Message(id: "f", role: .bot, kind: .activity, at: 2)
        failed.tool = ToolActivity(name: "error: the teammate could not be reached", ok: false)
        failed.turnId = "t"
        let rows = transcriptRows([note("n1", turn: "t", at: 1), failed, note("n2", turn: "t", at: 3)], detail: .full)
        XCTAssertTrue(rows.contains { $0.id == "f" }, "a failed turn row is never folded")
    }

    // MARK: Requests received

    private func receipt(_ id: String, from bot: String, at: Double) -> Message {
        let json = """
        {"id":"\(id)","role":"bot","kind":"activity","at":\(at),"from":{"botId":"\(bot)","name":"Bot \(bot.uppercased())","color":"blue"},
         "tool":{"name":"Asked by Bot \(bot.uppercased())","ok":true,"input":"Please check the board for \(id)","handoffId":"h\(id)"},
         "threadRef":{"botId":"self","threadId":"w\(id)","title":"Teammate work"}}
        """
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    private func reply(_ id: String, at: Double) -> Message {
        let json = """
        {"id":"r\(id)","role":"bot","kind":"activity","at":\(at),"roomRequest":{"id":"h\(id)","phase":"result"},
         "tool":{"name":"Self replied","ok":true,"output":"Done for \(id)."},"threadRef":{"botId":"self","threadId":"w\(id)","title":"Teammate work"}}
        """
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    func testFiveRequestsFromThreeBotsAreOneLineWithThreeNamesAndACount() {
        let messages = [
            receipt("1", from: "b", at: 1), receipt("2", from: "c", at: 2), reply("1", at: 3), receipt("3", from: "b", at: 4),
            receipt("4", from: "d", at: 5), receipt("5", from: "c", at: 6),
        ]
        for showThreads in [false, true] {
            let rows = transcriptRows(messages, detail: .full, showThreads: showThreads)
            XCTAssertEqual(rows.count, 1, "one names line, the reply behind the name (threads \(showThreads))")
            guard case let .incoming(line) = rows[0] else { return XCTFail("the names line") }
            XCTAssertEqual(line.askers.map(\.name), ["Bot B", "Bot C", "Bot D"])
            XCTAssertEqual(line.requestCount, 5)
            let fromB = line.exchanges(of: line.askers[0])
            XCTAssertEqual(fromB.map(\.id), ["3", "1"], "newest first")
            XCTAssertEqual(fromB.last?.request, "Please check the board for 1")
            XCTAssertEqual(fromB.last?.reply, "Done for 1.")
        }
    }

    func testFifteenAskingBotsAreOneLine() {
        let messages = (0..<15).map { receipt("\($0)", from: "bot\($0)", at: Double($0)) }
        let rows = transcriptRows(messages, detail: .full, showThreads: false)
        XCTAssertEqual(rows.count, 1)
        guard case let .incoming(line) = rows[0] else { return XCTFail("the names line") }
        XCTAssertEqual(line.askers.count, 15)
        XCTAssertNil(line.requestCount, "one request per name: no count")
    }

    func testAStoredCopyFromAnAIClientIsTheNamesLineNeverTheBubble() throws {
        let copies = (1...5).map { index in
            """
            {"id":"c\(index)","role":"bot","kind":"text","at":\(index),"text":"Here is the whole reply \(index).","relayVia":"mcp","relayOf":"x\(index)","relayAsk":{"text":"Summarize ticket \(index)","by":"Desktop client"}}
            """
        }
        let trace = #"{"id":"t","role":"bot","kind":"activity","at":9,"relayVia":"mcp","relayTrace":"stopped","tool":{"name":"stopped"},"relayAsk":{"text":"Draft"}}"#
        let messages = try (copies + [trace]).map { try JSONDecoder().decode(Message.self, from: Data($0.utf8)) }
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.count, 1)
        guard case let .incoming(line) = rows[0] else { return XCTFail("the names line") }
        XCTAssertEqual(line.askers.map(\.name), ["Desktop client", ""], "an unnamed client reads as the AI client")
        XCTAssertTrue(line.askers.allSatisfy(\.agent))
        XCTAssertEqual(line.requestCount, 6)
        XCTAssertEqual(line.exchanges(of: line.askers[0]).first?.reply, "Here is the whole reply 5.")
        XCTAssertEqual(line.exchanges(of: line.askers[1]).first?.trace, "stopped")
    }

    func testSomethingWrittenBetweenTwoRequestsStartsANewLine() {
        var answer = Message(id: "a", role: .bot, kind: .text, at: 2)
        answer.text = "Here you go"
        let rows = transcriptRows([receipt("1", from: "b", at: 1), answer, receipt("2", from: "b", at: 3)], detail: .full)
        XCTAssertEqual(rows.map(\.id), ["incoming.1", "a", "incoming.2"])
    }

    // MARK: A heavy user's chat (the capture fixture)

    func testAHeavyUsersChatFitsItsForms() throws {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("App/ChatRelevantPreview.json")
        let fleet = try JSONDecoder().decode(Fleet.self, from: Data(contentsOf: url))
        let messages = try XCTUnwrap(fleet.bots.first?.messages)
        let rows = transcriptRows(messages, detail: .full, showThreads: false)
        let lines = rows.compactMap { row -> IncomingLine? in if case let .incoming(line) = row { return line } else { return nil } }
        XCTAssertEqual(lines.map(\.askers.count), [3, 15, 1], "five requests from three bots, fifteen bots, an AI client")
        XCTAssertEqual(lines.map(\.requestCount), [5, nil, 3])
        let folded = RoutineResultStack.foldedIds(messages)
        let runs = messages.filter { $0.kind == .routineRun }
        XCTAssertEqual(runs.count, 17)
        let cards = runs.filter { RoutineResultStack.form($0.routineRun!, attention: $0.attention, folded: folded.contains($0.id)) == .card }
        XCTAssertEqual(cards.map(\.id), ["rr2", "rr15"], "the lasting problem and the newest result; the running run is a row")
    }
}

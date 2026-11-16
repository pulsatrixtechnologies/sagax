import Foundation
import XCTest
@testable import CompanionCore

/// #4437: every text a bot writes during a turn is its own bubble on the
/// phone and the tablet, in order, from its first word, while the turn runs
/// and after. The desktop's cases (src/lib/activity-runs.test.ts), ported one
/// for one, so both give the same answers: the working line never draws the
/// bot's words and a run never holds them.
final class LiveTextPlaceTests: XCTestCase {
    private func note(_ text: String, id: String = "n", role: Message.Role = .bot, turn: String? = "t",
                      terminal: Bool = false, at: Double = 2) -> Message {
        var message = Message(id: id, role: role, kind: .text, at: at)
        message.text = text
        message.turnId = turn
        message.turnTerminal = terminal ? true : nil
        return message
    }

    private func step(_ name: String, id: String, turn: String, at: Double, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: name, ok: ok)
        message.turnId = turn
        return message
    }

    func testATeamNoteDecodesFromTheWire() throws {
        let json = #"{"id":"m","role":"bot","kind":"text","at":1,"text":"x","teamNote":{"botId":"b","botName":"B","threadId":"s","text":"x","at":1,"lastAt":1,"count":1}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(message.teamNote?.botId, "b")
    }

    // MARK: The transcript (desktop activity-runs.test.ts, #4437)

    private func ids(_ rows: [TranscriptRow]) -> [String] { rows.map(\.id) }

    private func user(_ id: String) -> Message {
        var message = Message(id: id, role: .user, kind: .text, at: 1_000)
        message.text = "check the request"
        return message
    }

    func testAShortSentenceWrittenMidTurnIsItsOwnRowAndNeverGoesUnderTheRun() {
        let asked = user("u-l1")
        let short = note("I am checking these 4 tickets.", id: "n-l1", turn: "turn-l", at: 2_000)
        XCTAssertEqual(ids(transcriptRows([asked, short], detail: .full)), [asked.id, short.id])
        let read = step("Read", id: "s-l1", turn: "turn-l", at: 3_000, ok: nil)
        let grep = step("Grep", id: "g-l1", turn: "turn-l", at: 3_500, ok: nil)
        let working = transcriptRows([asked, short, read, grep], detail: .full)
        XCTAssertEqual(ids(working), [asked.id, short.id, "run.s-l1"])
        guard case let .activityRun(run) = working[2] else { return XCTFail("the stretch of work") }
        XCTAssertEqual(run.messages.map(\.id), [read.id, grep.id])
        XCTAssertFalse(run.closed, "the stretch still runs")
    }

    func testEveryTextOfATurnStaysInOrderWhileItRunsAndAfterItEnds() {
        let asked = user("u-l2")
        let first = note("Reading ticket 1042.", id: "a-l2", turn: "turn-l", at: 2_000)
        let read = step("Read", id: "s-l2", turn: "turn-l", at: 3_000)
        let bash = step("Bash", id: "b-l2", turn: "turn-l", at: 3_500)
        let second = note("Checking 1040 now.", id: "n-l2", turn: "turn-l", at: 4_000)
        let grep = step("Grep", id: "g-l2", turn: "turn-l", at: 5_000, ok: nil)
        let live = transcriptRows([asked, first, read, bash, second, grep], detail: .full)
        XCTAssertEqual(ids(live), [asked.id, first.id, "run.s-l2", second.id, "run.g-l2"])
        let final = note("Merge 1042 into 1040.", id: "f-l2", turn: "turn-l", terminal: true, at: 9_000)
        let done = step("Grep", id: "g-l2", turn: "turn-l", at: 5_000)
        let settled = transcriptRows([asked, first, read, bash, second, done, final], detail: .full)
        XCTAssertEqual(ids(settled), [asked.id, first.id, "run.s-l2", second.id, "run.g-l2", final.id])
        guard case let .activityRun(run) = settled[2] else { return XCTFail("the first stretch") }
        XCTAssertTrue(run.closed)
    }

    func testTheNewestDrawnRowLooksPastTheTurnsReceipts() {
        let short = note("Checking.", id: "n-r", turn: "t", at: 2)
        let digest = Message(id: "d", role: .bot, kind: .digest, at: 3)
        XCTAssertEqual(LiveTextPlace.lastDrawn([short, digest])?.id, short.id)
    }

    // MARK: The live tail (ChatLiveTail)

    func testAnyTextBeingWrittenIsItsBubbleFromTheFirstWord() {
        for text in ["Y", "Yes, on it.", "**Yes**, on it.", String(repeating: "word ", count: 30)] {
            XCTAssertEqual(LiveTail.of(text: text, reasoning: "r", streams: true, onCall: false, showsReasoning: true, busy: true), .bubble(text), text)
        }
    }

    func testTheLiveTailOrder() {
        let long = String(repeating: "word ", count: 30)
        XCTAssertEqual(LiveTail.of(text: nil, reasoning: "Reading.", streams: true, onCall: false, showsReasoning: true, busy: true), .reasoning("Reading."))
        XCTAssertEqual(LiveTail.of(text: nil, reasoning: "Reading.", streams: true, onCall: false, showsReasoning: false, busy: true), .working)
        // on a call, or with streaming off, the text waits for its message
        XCTAssertEqual(LiveTail.of(text: long, reasoning: nil, streams: false, onCall: false, showsReasoning: true, busy: true), .working)
        XCTAssertEqual(LiveTail.of(text: long, reasoning: "r", streams: true, onCall: true, showsReasoning: true, busy: true), .working)
        XCTAssertEqual(LiveTail.of(text: nil, reasoning: nil, streams: true, onCall: false, showsReasoning: true, busy: false), LiveTail.nothing)
        XCTAssertEqual(LiveTail.of(text: "", reasoning: "", streams: true, onCall: false, showsReasoning: true, busy: false), LiveTail.nothing)
    }
}

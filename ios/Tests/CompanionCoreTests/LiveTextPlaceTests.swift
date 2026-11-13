import Foundation
import XCTest
@testable import CompanionCore

/// #3712: where a live turn's text is drawn on the phone and the tablet. The
/// desktop's cases (src/lib/live-text-place.test.ts and the #3696 cases of
/// src/lib/activity-runs.test.ts), ported one for one, so both give the same
/// answers: a short note is written in the working line and never shows as a
/// bubble that a step then hides.
final class LiveTextPlaceTests: XCTestCase {
    private let max = LiveTextPlace.lineTextMax

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

    // MARK: liveTextPlace

    func testKeepsAShortSentenceInTheWorkingLineFromItsFirstWord() {
        for text in ["Y", "Yes", "Yes, I will check the request.", String(repeating: "x", count: max)] {
            XCTAssertEqual(LiveTextPlace.of(text), .line, text)
        }
    }

    func testOpensABubbleForTextPastTheLineLongerALineBreakAMarkdownBlockOrALink() {
        for text in [
            String(repeating: "x", count: max + 1), "Two lines.\nSecond.", "- item", "1. first", "# Title", "> quote",
            "| a | b |", "```ts", "See [the page](x)", "See https://example.com",
        ] {
            XCTAssertEqual(LiveTextPlace.of(text), .bubble, text)
        }
    }

    func testNeverGoesBackToTheLineOnceAGrowingTextOpenedItsBubble() {
        let answer = Array("Ticket 1042 failed three times since Monday.\n\n- Merge it into 1040\n- Order the part")
        var opened = false
        for end in 1...answer.count {
            let place = LiveTextPlace.of(String(answer[0..<end]))
            if opened { XCTAssertEqual(place, .bubble) }
            if place == .bubble { opened = true }
        }
        XCTAssertTrue(opened)
    }

    func testDrawsTheWordsWithoutTheirInlineMarks() {
        XCTAssertEqual(LiveTextPlace.lineWords("  Checking **ticket** `1042` "), "Checking ticket 1042")
    }

    // MARK: liveLineNote

    func testIsTheNewestShortNoteOfALiveTurn() {
        let row = note("Yes, I will check the request.")
        XCTAssertEqual(LiveTextPlace.liveLineNote(row, liveTurns: ["t"]), row)
    }

    func testIsNoneForAFinalMessageALongTextATurnThatEndedAPersonsMessageATeamNoteOrAStep() {
        let live: Set<String> = ["t"]
        XCTAssertNil(LiveTextPlace.liveLineNote(note("Done.", terminal: true), liveTurns: live))
        XCTAssertNil(LiveTextPlace.liveLineNote(note(String(repeating: "x", count: max + 1)), liveTurns: live))
        XCTAssertNil(LiveTextPlace.liveLineNote(note("Done."), liveTurns: []))
        XCTAssertNil(LiveTextPlace.liveLineNote(note("Hi", role: .user), liveTurns: live))
        var team = note("Use the main branch.")
        team.teamNote = TeamNoteRef()
        XCTAssertNil(LiveTextPlace.liveLineNote(team, liveTurns: live))
        XCTAssertNil(LiveTextPlace.liveLineNote(step("Read", id: "s", turn: "t", at: 3, ok: nil), liveTurns: live))
    }

    func testATeamNoteDecodesFromTheWire() throws {
        let json = #"{"id":"m","role":"bot","kind":"text","at":1,"text":"x","teamNote":{"botId":"b","botName":"B","threadId":"s","text":"x","at":1,"lastAt":1,"count":1}}"#
        let message = try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        XCTAssertEqual(message.teamNote?.botId, "b")
    }

    // MARK: The transcript (desktop activity-runs.test.ts, #3696)

    private let long = "Ticket 1042: the printer on the second floor failed three times since Monday, and two of its notes repeat ticket 1040."
    private let live: Set<String> = ["turn-l"]

    private func ids(_ rows: [TranscriptRow]) -> [String] { rows.map(\.id) }

    private func user(_ id: String) -> Message {
        var message = Message(id: id, role: .user, kind: .text, at: 1_000)
        message.text = "check the request"
        return message
    }

    func testAShortNoteThenAStepIsNeverARowOfItsOwnWhileTheTurnRunsAndIsInTheTurnsRowOnceAStepFollows() {
        let asked = user("u-l1")
        let short = note("Yes, I will check the request.", id: "n-l1", turn: "turn-l", at: 2_000)
        // the newest row: the working line draws it, the list does not
        XCTAssertEqual(ids(transcriptRows([asked, short], detail: .full, liveTurns: live, lineNoteId: short.id)), [asked.id])
        let read = step("Read", id: "s-l1", turn: "turn-l", at: 3_000, ok: nil)
        let working = transcriptRows([asked, short, read], detail: .full, liveTurns: live)
        XCTAssertEqual(ids(working), [asked.id, "turn.turn-l"])
        guard case let .activityRun(run) = working[1] else { return XCTFail("the turn's row") }
        XCTAssertEqual(run.messages.map(\.id), [short.id, read.id])
    }

    func testAGrowingAnswerOpensOnceAndStaysABubbleForTheRestOfTheTurnEvenWithStepsAfterIt() {
        let asked = user("u-l2")
        let answer = note(long, id: "a-l2", turn: "turn-l", at: 2_000)
        let read = step("Read", id: "s-l2", turn: "turn-l", at: 3_000)
        let short = note("Checking 1040 now.", id: "n-l2", turn: "turn-l", at: 4_000)
        let grep = step("Grep", id: "g-l2", turn: "turn-l", at: 5_000, ok: nil)
        let rows = transcriptRows([asked, answer, read, short, grep], detail: .full, liveTurns: live)
        XCTAssertEqual(ids(rows), [asked.id, answer.id, "turn.turn-l"])
        guard case let .activityRun(run) = rows[2] else { return XCTFail("the turn's row") }
        XCTAssertEqual(run.messages.map(\.id), [read.id, short.id, grep.id])
        // the turn ends: what came before the answer is put away once
        let final = note("Merge 1042 into 1040.", id: "f-l2", turn: "turn-l", terminal: true, at: 9_000)
        let done = step("Grep", id: "g-l2", turn: "turn-l", at: 5_000)
        XCTAssertEqual(ids(transcriptRows([asked, answer, read, short, done, final], detail: .full)), [asked.id, "turn.turn-l", final.id])
    }

    func testAShortAnswerStaysInTheWorkingLineWhileTheTurnRunsAndIsItsBubbleOnceTheTurnEnds() {
        let asked = user("u-l3")
        let yes = note("Yes.", id: "y-l3", turn: "turn-l", at: 2_000)
        XCTAssertEqual(ids(transcriptRows([asked, yes], detail: .full, liveTurns: live, lineNoteId: yes.id)), [asked.id])
        let final = note("Yes.", id: "y-l3", turn: "turn-l", terminal: true, at: 2_000)
        XCTAssertEqual(ids(transcriptRows([asked, final], detail: .full)), [asked.id, yes.id])
        // the turn ended before its final mark arrived: the newest line stays
        XCTAssertEqual(ids(transcriptRows([asked, yes], detail: .full)), [asked.id, yes.id])
    }

    func testTheNewestDrawnRowLooksPastTheTurnsReceipts() {
        let short = note("Checking.", id: "n-r", turn: "t", at: 2)
        let digest = Message(id: "d", role: .bot, kind: .digest, at: 3)
        XCTAssertEqual(LiveTextPlace.lastDrawn([short, digest])?.id, short.id)
    }

    // #4066: what the chat's live tail draws (ChatLiveTail). The note the
    // transcript leaves to the working line stays on screen while the
    // reasoning streams (Tool calls on): before, the reasoning took the tail
    // and the note was drawn nowhere.
    func testTheNoteStaysOnScreenWhileTheReasoningStreams() {
        XCTAssertEqual(
            LiveTail.of(text: nil, reasoning: "Reading 1040 first.", note: "Checking the notes.", streams: true, onCall: false, showsReasoning: true, busy: true),
            .reasoning("Reading 1040 first.", note: "Checking the notes.")
        )
        // no note: the reasoning alone
        XCTAssertEqual(
            LiveTail.of(text: nil, reasoning: "Reading.", note: nil, streams: true, onCall: false, showsReasoning: true, busy: true),
            .reasoning("Reading.", note: nil)
        )
        // Tool calls off: the working line keeps the note
        XCTAssertEqual(
            LiveTail.of(text: nil, reasoning: "Reading.", note: "Checking.", streams: true, onCall: false, showsReasoning: false, busy: true),
            .working(note: "Checking.")
        )
    }

    func testTheLiveTailOrder() {
        let long = String(repeating: "word ", count: 30)
        XCTAssertEqual(LiveTail.of(text: long, reasoning: "r", note: "n", streams: true, onCall: false, showsReasoning: true, busy: true), .bubble(long))
        XCTAssertEqual(LiveTail.of(text: "**Yes**, on it.", reasoning: "r", note: nil, streams: true, onCall: false, showsReasoning: true, busy: true), .line("Yes, on it."))
        // on a call, or with streaming off, the text waits for its message
        XCTAssertEqual(LiveTail.of(text: long, reasoning: nil, note: nil, streams: false, onCall: false, showsReasoning: true, busy: true), .working(note: nil))
        XCTAssertEqual(LiveTail.of(text: long, reasoning: "r", note: nil, streams: true, onCall: true, showsReasoning: true, busy: true), .working(note: nil))
        XCTAssertEqual(LiveTail.of(text: nil, reasoning: nil, note: nil, streams: true, onCall: false, showsReasoning: true, busy: false), LiveTail.nothing)
        XCTAssertEqual(LiveTail.of(text: "", reasoning: "", note: nil, streams: true, onCall: false, showsReasoning: true, busy: false), LiveTail.nothing)
    }
}

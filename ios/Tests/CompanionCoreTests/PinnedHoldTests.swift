// #3689, the rule of #3681 on the phone and the tablet (the owner,
// 2026-11-11): while an ask waits and the pinned card over the composer
// holds it, the conversation draws no card for it; once it is answered,
// skipped or expired its record is back at its place. The vectors are the
// desktop's (src/lib/pinned-waiting.test.ts, "what the pinned card holds,
// the conversation does not draw"), with the same items, ids and answers.
import Foundation
import XCTest
@testable import CompanionCore

final class PinnedHoldTests: XCTestCase {
    /// The desktop's `todayRowsOfEveryKind`, as the server serves them: an
    /// approval, a question card, a "needs you" card, a parked teammate's
    /// input request, an offer, a learned-skill proposal, in the
    /// conversation on screen and in conversations the phone has not
    /// loaded; and an item of a kind this app does not know.
    private let everyKindJSON = #"""
    {
      "pending": [],
      "waiting": [
        {"id":"req_perm","kind":"approval","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"m-perm","at":100,"title":"uptime","text":"uptime","options":["Allow","Deny"],
         "message":{"id":"m-perm","role":"bot","kind":"options","at":100,"card":{"title":"Run Bash?","subtitle":"uptime","options":["Allow","Deny"],"requestId":"req_perm","requestType":"permission","tool":"Bash"}}},
        {"id":"req_q","kind":"question","botId":"b1","botName":"Nimbus","threadId":"older-topic","messageId":"m-q","at":200,"title":"Where should I deliver?","text":"Where should I deliver?","options":["Here","By mail"],
         "message":{"id":"m-q","role":"bot","kind":"options","at":200,"card":{"title":"","subtitle":"","options":[],"requestId":"req_q","requestType":"question","questionRequest":{"version":1,"questions":[{"question":"Where should I deliver?","options":[{"label":"Here"},{"label":"By mail"}]}]}}}},
        {"id":"attention:m-needs","kind":"request","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"m-needs","at":300,"title":"Approve the invoice?","text":"Approve the invoice?","options":["Approve","Hold"],
         "message":{"id":"m-needs","role":"bot","kind":"text","at":300,"attention":{"kind":"question","items":[{"text":"Approve the invoice?"}],"botId":"b2","botName":"Ada","threadId":"work-a","sourceMessageId":"s1","choices":["Approve","Hold"]}}},
        {"id":"attention:m-input","kind":"request","botId":"b1","botName":"Nimbus","threadId":"task-b","messageId":"m-input","at":400,"title":"Which build host?","text":"Which build host?","options":[],
         "message":{"id":"m-input","role":"bot","kind":"activity","at":400,"inputRequest":{"botId":"b3","threadId":"work-b","botName":"Kiro","title":"Build","question":"Which build host?"},"attention":{"kind":"question","items":[{"text":"Which build host?"}],"botId":"b3","botName":"Kiro","threadId":"work-b","sourceMessageId":"m-input"}}},
        {"id":"proactive:x1","kind":"proposal","botId":"b1","botName":"Nimbus","threadId":"older-topic","messageId":"m-offer","at":500,"title":"Keep the daily brief?","text":"Keep the daily brief?","options":["Yes","Not now"],"proactiveId":"x1",
         "message":{"id":"m-offer","role":"bot","kind":"options","at":500,"card":{"title":"Keep the daily brief?","subtitle":"Every day at 8:00.","options":["Yes","Not now"],"proactiveProposal":{"id":"x1"}}}},
        {"id":"skill-s1","kind":"proposal","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"m-skill","at":600,"title":"Enable skill?","text":"Enable skill?","options":["Enable","Deny"],
         "message":{"id":"m-skill","role":"bot","kind":"options","at":600,"card":{"title":"Enable skill?","subtitle":"Stop a task cleanly.","options":["Enable","Deny"],"requestId":"skill-s1","tool":"stage_skill"}}},
        {"id":"later-kind:1","kind":"checklist","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"m-later","at":700,"title":"Sign","text":"Sign","options":[],
         "message":{"id":"m-later","role":"bot","kind":"options","at":700,"card":{"title":"Sign","subtitle":"","options":["Sign"],"requestId":"later-1"}}}
      ]
    }
    """#

    private func everyKind() throws -> WaitingPayload {
        try JSONDecoder().decode(WaitingPayload.self, from: Data(everyKindJSON.utf8))
    }

    private func message(_ json: String) throws -> Message {
        try JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    /// The desktop's `ask`: a question card of the conversation.
    private func ask(_ id: String, at: Double, answered: Bool = false) throws -> Message {
        let settled = answered ? #","answered":"answer","answeredText":"A""# : ""
        return try message(#"{"id":"\#(id)","role":"bot","kind":"options","at":\#(at),"text":"","card":{"title":"","subtitle":"","options":[],"requestId":"req-\#(id)","requestType":"question","questionRequest":{"version":1,"questions":[{"question":"Which one?","options":[{"label":"A"},{"label":"B"}]}]}\#(settled)}}"#)
    }

    private func pinned(_ payload: WaitingPayload?, conversation: String = "conv", transcripts: [String: [Message]] = [:], fallback: [PendingApproval] = []) -> [PinnedWaitingEntry] {
        PinnedWaiting.pinned(payload, fallback: fallback, botId: "b1", botName: "Nimbus", conversation: conversation) { transcripts[$0] }
    }

    func testHoldsTheMessageOfEveryItemItDrawsWithTheConversationsCardNeverOneOfAKindItOnlyNames() throws {
        let held = PinnedWaiting.heldIds(pinned(try everyKind()))
        XCTAssertEqual(held.sorted(), ["m-input", "m-needs", "m-offer", "m-perm", "m-q", "m-skill"])
        XCTAssertFalse(held.contains("m-later"))
    }

    func testPinsAQuestionOfThisConversationTheListDoesNotCarryYetOnceAndLetsItGoOnceSettled() throws {
        let open = try ask("q-live", at: 700)
        let served = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[]}"#.utf8))
        let before = pinned(served, transcripts: ["conv": [open]])
        XCTAssertEqual(before.map { [$0.item.kind, $0.id] }, [["question", "conv:req-q-live"]])
        XCTAssertTrue(PinnedWaiting.heldIds(before).contains("q-live"))
        // once the list carries it, the server's item is the one drawn, once
        let listed = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[{"id":"req-q-live","kind":"question","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"q-live","at":700,"title":"Which one?","text":"Which one?","options":["A","B"]}]}"#.utf8))
        var withMessage = listed
        withMessage.messages["conv:req-q-live"] = open
        let after = pinned(withMessage, transcripts: ["conv": [open]])
        XCTAssertEqual(after.map(\.item), listed.waiting)
        // answered: nothing pinned, nothing held, its record back in place
        let answered = try ask("q-live", at: 700, answered: true)
        XCTAssertEqual(pinned(served, transcripts: ["conv": [answered]]), [])
        XCTAssertEqual(PinnedWaiting.drawn([answered], held: PinnedWaiting.heldIds(pinned(served, transcripts: ["conv": [answered]]))).map(\.id), ["q-live"])
    }

    /// #3615 on the phone: a live approval of this conversation the list
    /// does not carry yet is pinned meanwhile, and only once when it does.
    func testPinsALiveApprovalTheListDoesNotCarryYetAndOnlyOnceWhenItDoes() throws {
        let live = try message(#"{"id":"m-live","role":"bot","kind":"options","at":700,"card":{"title":"Run a command","subtitle":"ls -la","options":["Allow","Deny"],"requestId":"req_live","tool":"bash"}}"#)
        let fallback = ApprovalDockRules.pendingApprovals([live])
        let empty = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[]}"#.utf8))
        let before = pinned(empty, transcripts: ["conv": [live]], fallback: fallback)
        XCTAssertEqual(before.map(\.id), ["conv:req_live"])
        XCTAssertEqual(before.compactMap(\.approval).map(\.requestId), ["req_live"])
        var listed = try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[{"id":"req_live","kind":"approval","botId":"b1","botName":"Nimbus","threadId":"conv","messageId":"m-live","at":700,"title":"ls -la","text":"ls -la","options":["Allow","Deny"]}]}"#.utf8))
        listed.messages["conv:req_live"] = live
        XCTAssertEqual(pinned(listed, transcripts: ["conv": [live]], fallback: fallback).map(\.item), listed.waiting)
    }

    func testLandsSeeInTheConversationOnTheWordsBeforeTheAskPastCardsItAlsoHolds() throws {
        let words = try message(#"{"id":"w","role":"bot","kind":"text","at":1,"text":"Two things first."}"#)
        let step = try message(#"{"id":"s","role":"bot","kind":"activity","at":2,"tool":{"name":"Read","ok":true}}"#)
        let first = try ask("q1", at: 3)
        let second = try ask("q2", at: 4)
        let messages = [words, step, first, second]
        XCTAssertEqual(PinnedWaiting.jumpTarget(messages, askId: "q2", held: ["q1", "q2"]), "w")
        XCTAssertEqual(PinnedWaiting.jumpTarget(messages, askId: "q1", held: ["q1"]), "w")
        // nothing drawn before it: the ask itself
        XCTAssertEqual(PinnedWaiting.jumpTarget([first], askId: "q1", held: ["q1"]), "q1")
        // an ask the card does not hold is drawn: the jump lands on it
        XCTAssertEqual(PinnedWaiting.focus(messages, messageId: "q2", held: []), "q2")
        XCTAssertEqual(PinnedWaiting.focus(messages, messageId: "q2", held: ["q2"]), "w")
    }

    /// The conversation leaves the held messages out before its rows are
    /// grouped: no empty row, no row of its own for the ask, and the bot's
    /// words around it read as before.
    func testTheConversationDrawsNoRowForAHeldAskAndItsRecordOnceSettled() throws {
        let user = try message(#"{"id":"u","role":"user","kind":"text","at":1,"text":"Go"}"#)
        let words = try message(#"{"id":"w","role":"bot","kind":"text","at":2,"text":"Two things first."}"#)
        let open = try ask("q1", at: 3)
        let entries = pinned(try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[]}"#.utf8)), transcripts: ["conv": [user, words, open]])
        let held = PinnedWaiting.heldIds(entries)
        XCTAssertEqual(held, ["q1"])
        let rows = transcriptRows(PinnedWaiting.drawn([user, words, open], held: held), detail: .full)
        XCTAssertEqual(rows.map(\.head.id), ["u", "w"])
        XCTAssertFalse(rows.contains { row in if case let .message(message) = row { return message.id == "q1" }; return false })
        // answered: back at its place
        let answered = try ask("q1", at: 3, answered: true)
        let settled = PinnedWaiting.heldIds(pinned(try JSONDecoder().decode(WaitingPayload.self, from: Data(#"{"pending":[],"waiting":[]}"#.utf8)), transcripts: ["conv": [user, words, answered]]))
        XCTAssertEqual(transcriptRows(PinnedWaiting.drawn([user, words, answered], held: settled), detail: .full).map(\.head.id), ["u", "w", "q1"])
    }

    /// A view where the pinned card cannot hold the ask (a conversation the
    /// person cannot write in) draws every card as before.
    func testAViewWithNoPinnedCardHoldsNothing() throws {
        let entries = pinned(try everyKind())
        XCTAssertFalse(PinnedWaiting.heldIds(entries).isEmpty)
        XCTAssertTrue(PinnedWaiting.heldIds(entries, dockShown: false).isEmpty)
    }
}

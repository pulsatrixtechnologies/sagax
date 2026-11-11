// Issue #426 (approval card parity) and the threads switch in the chat
// (#1026): the rules the iPhone and the iPad draw by.
import XCTest
@testable import CompanionCore

final class ApprovalReceiptTests: XCTestCase {
    private func card(_ json: String) throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(json.utf8))
    }

    // MARK: Teammate asks

    func testATeammateAskReadsItsRecipientsAndMessageFromTheToolInput() throws {
        let ask = try XCTUnwrap(TeammateAsk.parse(card(#"""
        {"title":"Approval needed","subtitle":"","options":["Allow","Deny"],"requestId":"r","tool":"mcp__agents__coordinate_bots",
         "toolInput":"{\"bot_ids\":[\"nova\",\"bot_1234abcd\",\"Ada\"],\"message\":\"Check the build\"}"}
        """#)))
        XCTAssertEqual(ask.tool, "coordinate_bots")
        XCTAssertEqual(ask.recipients, ["nova", "bot_1234abcd", "Ada"])
        XCTAssertEqual(ask.message, "Check the build")
    }

    func testTheGateSubtitleIsArgumentsWithoutItsToolId() throws {
        let gate = try card(#"""
        {"title":"Approval needed","subtitle":"mcp__agents__ask_bot {\"bot_id\":\"nova\",\"message\":\"Ready?\"}","options":["Allow","Deny"],"requestId":"r","tool":"other"}
        """#)
        let ask = try XCTUnwrap(TeammateAsk.parse(gate))
        XCTAssertEqual(ask.tool, "ask_bot")
        XCTAssertEqual(ask.recipients, ["nova"])
        XCTAssertEqual(ask.message, "Ready?")
        XCTAssertTrue(GateArguments.isTechnical(gate), "never the visible line")
        XCTAssertEqual(ApprovalHeading.detail(gate), nil, "no argument a person reads, no server line")
    }

    func testACutPreviewIsReadLoosely() throws {
        let cut = try card(#"""
        {"title":"Approval needed","subtitle":"send_to_bot {\"bot_id\":\"nova\",\"title\":\"T\",\"message\":\"Line one\\nand the rest was cut","options":["Allow","Deny"],"requestId":"r","tool":"send_to_bot"}
        """#)
        let ask = try XCTUnwrap(TeammateAsk.parse(cut))
        XCTAssertEqual(ask.recipients, ["nova"])
        XCTAssertTrue(ask.message.hasPrefix("Line one\nand the rest"))
    }

    func testOtherToolsAreNotTeammateAsks() throws {
        XCTAssertNil(TeammateAsk.parse(try card(#"{"title":"t","subtitle":"echo {a,b}","options":["Allow"],"requestId":"r","tool":"Bash"}"#)))
        XCTAssertFalse(GateArguments.isTechnical(try card(#"{"title":"t","subtitle":"echo {a,b}","options":["Allow"],"requestId":"r","tool":"Bash"}"#)),
                       "a command with braces stays the visible line")
    }

    func testTheQuoteIsCutNear240Characters() {
        let long = String(repeating: "word ", count: 80)
        let ask = TeammateAsk(tool: "ask_bot", recipients: ["nova"], message: long)
        XCTAssertTrue(ask.quoteIsCut)
        XCTAssertLessThanOrEqual(ask.quote.count, TeammateAsk.quoteLimit + 1)
        XCTAssertTrue(ask.quote.hasSuffix("…"))
        XCTAssertFalse(TeammateAsk(tool: "ask_bot", recipients: [], message: "short").quoteIsCut)
    }

    // MARK: Held note

    func testAWaitingAskShowsOnlyTheNoteOfThePersonsRule() throws {
        func held(_ code: String, extra: String = "") throws -> OptionCard {
            let base = #"{"title":"t","subtitle":"ls","options":["Allow"],"requestId":"r","tool":"Bash","held":"Note","heldCode":"CODE""#
            return try card(base.replacingOccurrences(of: "CODE", with: code) + extra + "}")
        }
        // #1221 (issue #426): a waiting ask shows why it was held, as on the
        // desktop; only the provider's own note and the routine gate stay silent.
        for code in ["approval.held.customRule", "approval.held.outbound", "approval.held.sandbox", "approval.held.safety", "approval.held.undelivered"] {
            XCTAssertTrue(ApprovalHeldNote.shows(try held(code)), code)
        }
        for code in ["approval.held.native", "approval.held.gate"] {
            XCTAssertFalse(ApprovalHeldNote.shows(try held(code)), code)
        }
        // a receipt keeps the note it was held with, never the provider's own
        XCTAssertTrue(ApprovalHeldNote.shows(try held("approval.held.outbound", extra: #","answered":"allow""#)))
        XCTAssertFalse(ApprovalHeldNote.shows(try held("approval.held.native", extra: #","answered":"allow""#)))
    }

    // MARK: Receipt

    func testThePillReadsAsTheDesktopOne() throws {
        let base = #""title":"t","subtitle":"ls","options":["Allow","Deny"],"requestId":"r","tool":"Bash""#
        XCTAssertNil(ApprovalPill.of(try card("{\(base)}")))
        XCTAssertEqual(ApprovalPill.of(try card("{\(base),\"answered\":\"allow\"}")), .allowedOnce)
        XCTAssertEqual(ApprovalPill.of(try card("{\(base),\"answered\":\"deny\"}")), .declined)
        XCTAssertEqual(ApprovalPill.of(try card("{\(base),\"expired\":true}")), .expired)
        XCTAssertEqual(ApprovalPill.of(try card(#"{"# + base + #","answered":"allow","ruleSaved":{"id":"x","behavior":"allow","description":"Run any command"}}"#)), .alwaysAllowed)
        XCTAssertEqual(ApprovalPill.of(try card(#"{"# + base + #","answered":"deny","ruleSaved":{"id":"x","behavior":"deny","description":"Never"}}"#)), .alwaysDenied)
        XCTAssertEqual(ApprovalPill.of(try card("{\(base),\"answered\":\"allow\",\"alwaysAllowed\":\"mcp:a__b\"}")), .alwaysAllowed)
        XCTAssertEqual(ApprovalPill.allowedOnce.tone, .success)
        XCTAssertEqual(ApprovalPill.declined.tone, .danger)
    }

    func testAnAnsweredAskIsAReceiptAClosedOneIsNot() throws {
        let base = #""title":"t","subtitle":"ls","options":["Allow","Deny"],"requestId":"r","tool":"Bash""#
        XCTAssertTrue(ApprovalReceiptRules.isReceipt(try card("{\(base),\"answered\":\"allow\"}")))
        XCTAssertTrue(ApprovalReceiptRules.isReceipt(try card("{\(base),\"expired\":true}")))
        XCTAssertFalse(ApprovalReceiptRules.isReceipt(try card("{\(base)}")), "an open ask waits on the dock")
        XCTAssertFalse(ApprovalReceiptRules.isReceipt(try card("{\(base),\"answered\":\"unavailable\"}")))
        XCTAssertFalse(ApprovalReceiptRules.isReceipt(try card("{\(base),\"answered\":\"allow\",\"dismissed\":true}")))
        // #3415: an answered card folds into one row, a proposal too
        XCTAssertTrue(ApprovalReceiptRules.isReceipt(try card(#"{"title":"t","subtitle":"s","options":["Confirm"],"requestId":"r","tool":"schedule_routine","answered":"allow","routineRequest":{}}"#)),
                      "an answered proposal folds into one row")
        XCTAssertFalse(ApprovalReceiptRules.isReceipt(try card(#"{"title":"t","subtitle":"s","options":["Confirm"],"requestId":"r","tool":"schedule_routine","routineRequest":{}}"#)),
                       "an open proposal waits on the dock")
    }

    /// #1982: a bot-created routine's Undo receipt stays in the chat even
    /// when the server marked it dismissed (so it leaves the pending dock).
    func testAnAutoAppliedReceiptStaysInChatWhenDismissed() throws {
        let receipt = try card(#"""
        {"title":"Schedule?","subtitle":"","options":[],"answered":"allow","dismissed":true,
         "autoApplied":true,"requestId":"r","tool":"schedule_routine","routineRequest":{}}
        """#)
        XCTAssertTrue(ApprovalReceiptRules.staysInChat(receipt))
        XCTAssertEqual(receipt.autoApplied, true)
        let plainDismissed = try card(#"{"title":"t","subtitle":"s","options":[],"answered":"allow","dismissed":true,"requestId":"r","tool":"Bash"}"#)
        XCTAssertFalse(ApprovalReceiptRules.staysInChat(plainDismissed))
    }

    // MARK: The server's words in the reader's language (#1089)

    func testTheServerPhraseIsUsedOnlyInItsOwnLanguage() throws {
        let french = try card(#"{"title":"t","subtitle":"","options":["Allow"],"requestId":"r","tool":"mcp__cw__query","plain":{"title":"Autoriser Nova à consulter l'horaire ?","line":"l","action":"consulter l'horaire","locale":"fr"}}"#)
        XCTAssertEqual(ApprovalReceiptRules.plainAction(french, language: "fr-CA"), "consulter l'horaire")
        XCTAssertNil(ApprovalReceiptRules.plainAction(french, language: "en"))
        XCTAssertEqual(ApprovalHeading.plainTitle(french, language: "fr-CA"), "Autoriser Nova à consulter l'horaire ?")
        XCTAssertNil(ApprovalHeading.plainTitle(french, language: "en-US"))
        let older = try card(#"{"title":"t","subtitle":"","options":["Allow"],"requestId":"r","tool":"Bash","plain":{"title":"Allow Nova to run a command?","line":"l"}}"#)
        XCTAssertEqual(ApprovalHeading.plainTitle(older, language: "en"), "Allow Nova to run a command?", "an older server words in English")
        XCTAssertNil(ApprovalHeading.plainTitle(older, language: "fr"))
    }

    // MARK: Threads off (#1026)

    func testThreadsOffLeavesTheThreadReceiptsOutOfTheChat() throws {
        func decode(_ json: String) throws -> Message { try JSONDecoder().decode(Message.self, from: Data(json.utf8)) }
        let thread = try decode(#"{"id":"th","role":"bot","kind":"activity","at":1,"tool":{"name":"Opened thread"},"threadRef":{"botId":"b","threadId":"t","title":"Opened"}}"#)
        let comm = try decode(#"{"id":"comm","role":"bot","kind":"activity","at":2,"tool":{"name":"Messaged @Ada"},"comm":{"groupId":"g","withBotId":"ada","withName":"Ada","withColor":"teal"}}"#)
        var reply = Message(id: "txt", role: .bot, kind: .text, at: 3)
        reply.text = "done"
        XCTAssertEqual(chatMessages([thread, comm, reply], showThreads: false).map(\.id), ["comm", "txt"])
        XCTAssertEqual(chatMessages([thread, comm, reply], showThreads: true).map(\.id), ["th", "comm", "txt"])
        XCTAssertTrue(hidesThreadReceipt(thread, showThreads: false))
        XCTAssertFalse(hidesThreadReceipt(thread, showThreads: true))
    }

    func testThreadsAreOffByDefaultAsOnTheDesktop() {
        XCTAssertFalse(SidebarPrefs.showThreadsDefault)
        XCTAssertNil(SidebarPrefs().showThreads)
        var on = SidebarPrefs()
        on.setShowThreads(true)
        XCTAssertEqual(on.showThreads, true)
    }
}

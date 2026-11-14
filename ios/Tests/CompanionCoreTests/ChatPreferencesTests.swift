// The two pieces of preference logic worth testing without a screen: how a
// transcript folds at each activity level, and how a quick-reply list
// survives a round trip through storage.
//
// Both are written against what the reader ends up seeing, not internals —
// a run collapses, a failure never does, and a corrupt store still puts
// four usable chips on the composer.
import XCTest
@testable import CompanionCore

final class ChatPreferencesTests: XCTestCase {
    private func text(_ id: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .text, at: at)
        message.text = "hello"
        return message
    }

    private func activity(_ id: String, at: Double = 1, ok: Bool? = true) -> Message {
        var message = Message(id: id, role: .bot, kind: .activity, at: at)
        message.tool = ToolActivity(name: "run", ok: ok)
        return message
    }

    /// What the harness appends after every settled turn: a work receipt,
    /// decoded from the wire exactly as it arrives.
    private func digest(_ id: String, at: Double = 1) -> Message {
        let json = """
        {"id":"\(id)","role":"bot","kind":"digest","at":\(at),"text":"[digest] · tools: /bin/bash -lc 'composio search' ×1 · reply: Done."}
        """
        return try! JSONDecoder().decode(Message.self, from: Data(json.utf8))
    }

    // MARK: - Full

    func testFullFoldsToolStepsIntoOneLineBetweenTheTexts() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        let rows = transcriptRows(messages, detail: .full)
        XCTAssertEqual(rows.map(\.id), ["a", "run.b", "d"])
        guard case let .activityRun(run) = rows[1] else { return XCTFail("one step line") }
        XCTAssertEqual(run.steps.map(\.id), ["b", "c"])
        XCTAssertEqual(messages.map(\.id), ["a", "b", "c", "d"], "hiding a row does not drop the stored message")
    }

    /// The phone transcript: a turn's tool steps and narration are one step
    /// line, the reply and the question card stay; Hidden keeps only the
    /// folded narration.
    func testToolActivityRowIsDroppedAndTextAndQuestionCardStay() {
        var user = Message(id: "user", role: .user, kind: .text, at: 1_000)
        user.text = "can you import this bot"
        user.attachments = [MessageImageAttachment(kind: "file", path: "export.json", mime: "application/json", name: "export-connectwise-psa.json", durationMs: nil)]

        var succeeded = activity("ok", at: 2_000)
        succeeded.tool = ToolActivity(name: "mcp_sagax-environment__run_command", ok: true)
        var failed = activity("bad", at: 3_000, ok: false)
        failed.tool = ToolActivity(name: "mcp_agents__create_bot", ok: false)

        var progress = Message(id: "progress", role: .bot, kind: .text, at: 4_000)
        progress.text = "Importing the bot"
        progress.turnId = "turn"
        var answer = Message(id: "answer", role: .bot, kind: .text, at: 44_000)
        answer.text = "The bot is ready"
        answer.turnId = "turn"
        answer.turnTerminal = true

        var question = Message(id: "ask", role: .bot, kind: .options, at: 45_000)
        var card = OptionCard(title: "Update @Connectwise PSA's profile?", subtitle: "Whose profile: @Connectwise PSA", options: ["Allow", "Deny"])
        card.requestId = "req-ask"
        card.questionRequest = QuestionRequestCardData(
            questions: [AskQuestion(question: "Whose profile?", options: [AskQuestionOption(label: "@Connectwise PSA")])]
        )
        question.card = card

        let messages = [user, succeeded, failed, progress, answer, question]
        for detail in ActivityDetail.allCases {
            let rows = transcriptRows(messages, detail: detail)
            XCTAssertEqual(rows.map(\.id), ["user", "turn.turn", "answer", "ask"], "\(detail)")
            guard case let .activityRun(run) = rows[1] else { return XCTFail("the worked summary stays") }
            XCTAssertEqual(run.englishLabel, "Worked for 43s")
            XCTAssertEqual(run.steps.map(\.id), detail == .hidden ? [] : ["ok", "bad"], "\(detail)")
            guard case let .message(kept) = rows[0] else { return XCTFail("the text stays") }
            XCTAssertEqual(kept.attachments?.first?.name, "export-connectwise-psa.json")
            guard case let .message(asked) = rows[3] else { return XCTFail("the question card stays") }
            XCTAssertEqual(asked.kind, .options)
            XCTAssertEqual(asked.card?.questions.first?.question, "Whose profile?")
        }
        XCTAssertTrue(messages.contains { isToolActivityRow($0) })
    }

    // MARK: - Hidden

    func testHiddenDropsActivityAndKeepsTheRest() {
        let messages = [text("a"), activity("b"), activity("c"), text("d")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    // The digest and compaction receipts are the harness talking about the
    // tool calls: hidden with them, but never folded into a run of them.

    func testHiddenDropsDigestAndCompactionReceiptsToo() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), compaction("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    func testReducedKeepsACompactionAndDropsTheToolRowsAroundIt() {
        let messages = [activity("a"), activity("b"), compaction("c"), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.map(\.id), ["run.a", "c", "run.d"])
        XCTAssertEqual(rows[1].kind, .compaction)
    }

    private func compaction(_ id: String, at: Double = 1) -> Message {
        var message = Message(id: id, role: .bot, kind: .compaction, at: at)
        message.text = "[compaction] summary"
        message.compaction = Compaction(summary: "summary", tokensBefore: 10)
        return message
    }

    func testHiddenDropsFailedActivityToo() {
        let messages = [text("a"), activity("b", ok: false)]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a"])
    }

    // MARK: - Reduced

    func testReducedFoldsToolStepsIntoOneLine() {
        let messages = [text("a"), activity("b"), activity("c"), activity("d"), text("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "run.b", "e"])
    }

    func testALoneToolStepIsStillAStepLine() {
        let messages = [text("a"), activity("b"), text("c")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "run.b", "c"])
    }

    func testAnotherSpeakerStartsANewRun() {
        var other = activity("c")
        other.from = Sender(botId: "other", name: "Other", color: "blue")
        let messages = [activity("a"), activity("b"), other]
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["run.a", "run.c"])
    }

    func testStatusNoticeIsNeverHiddenOrFolded() {
        // A notice that asks something of the person (approve in 1Password)
        // is not tool noise; technical notices leave no row (ChatNoticesTests).
        var notice = Message(id: "n", role: .bot, kind: .activity, at: 1)
        notice.tool = ToolActivity(name: "notice: Waiting for 1Password: approve the request in 1Password on your computer.", ok: true)
        let messages = [activity("a"), activity("b"), notice, activity("c"), activity("d")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["n"])
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["run.a", "n", "run.c"])
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["run.a", "n", "run.c"])
    }

    func testNoWorkspaceLineIsDrawn() {
        var here = Message(id: "w", role: .bot, kind: .activity, at: 1)
        here.tool = ToolActivity(name: "notice: Workspace: On your computer", ok: true)
        var cloud = Message(id: "c", role: .bot, kind: .activity, at: 2)
        cloud.tool = ToolActivity(name: "notice: Workspace: In the cloud", ok: true)
        let messages = [activity("a"), here, activity("b"), cloud]
        for detail in [ActivityDetail.full, .reduced, .hidden] {
            let ids = transcriptRows(messages, detail: detail).map(\.id)
            XCTAssertFalse(ids.contains("w") || ids.contains("c"), "\(detail)")
        }
        // nor does one split the stretch of work in two
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["run.a"])
    }

    func testAFailedToolCallFoldsWithTheOtherSteps() {
        // A failed tool step is counted in the line ("1 failed"). A failed
        // turn, whose name starts with "error:", is a different row and stays.
        let messages = [activity("a"), activity("b"), activity("c", ok: false), activity("d"), activity("e")]
        XCTAssertTrue(transcriptRows(messages, detail: .hidden).isEmpty)
        for detail in [ActivityDetail.full, .reduced] {
            let rows = transcriptRows(messages, detail: detail)
            XCTAssertEqual(rows.map(\.id), ["run.a"], "\(detail)")
            guard case let .activityRun(run) = rows[0] else { return XCTFail("one line") }
            XCTAssertEqual(StepGroup.summarize(run.messages).failed, 1)
        }
        var turn = activity("err", ok: false)
        turn.tool = ToolActivity(name: "error: boom", ok: false)
        XCTAssertEqual(transcriptRows(messages + [turn], detail: .full).map(\.id), ["run.a", "err"])
    }

    func testReducedDropsToolRowsOnEitherSideOfText() {
        let messages = [activity("a"), activity("b"), text("c"), activity("d"), activity("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["run.a", "c", "run.d"])
    }

    func testARunningToolCallIsDroppedToo() {
        let messages = [activity("a"), activity("b", ok: nil)]
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["run.a"])
        XCTAssertTrue(transcriptRows(messages, detail: .hidden).isEmpty)
        guard case let .activityRun(run) = transcriptRows(messages, detail: .reduced)[0] else { return XCTFail("one line") }
        XCTAssertEqual(StepGroup.summarize(run.messages).running?.id, "b")
    }

    /// Phone and iPad: every tool receipt leaves, including a running chip
    /// and an Error badge. A notice, a failed turn, a parallel card, a
    /// comm/thread chip, text, an attachment and a pending approval stay.
    /// Hidden used to drop comm/thread with the digest receipts.
    func testIosHidesEveryToolReceiptAndKeepsNoticesCardsAndChips() throws {
        func decode(_ json: String) throws -> Message {
            try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        }
        var user = Message(id: "user", role: .user, kind: .text, at: 1)
        user.text = "go"
        user.attachments = [MessageImageAttachment(kind: "file", path: "a.json", mime: "application/json", name: "a.json", durationMs: nil)]
        let running = try decode(#"{"id":"run","role":"bot","kind":"activity","at":2,"tool":{"name":"Bash"}}"#)
        let ok = try decode(#"{"id":"ok","role":"bot","kind":"activity","at":3,"tool":{"name":"Read","ok":true}}"#)
        let receipt = try decode(#"{"id":"bad","role":"bot","kind":"activity","at":4,"tool":{"name":"Write","ok":false}}"#)
        let notice = try decode(#"{"id":"n","role":"bot","kind":"activity","at":5,"tool":{"name":"notice: Waiting for 1Password: approve the request in 1Password on your computer.","ok":true}}"#)
        let failed = try decode(#"{"id":"err","role":"bot","kind":"activity","at":6,"tool":{"name":"error: boom","ok":false}}"#)
        let parallel = try decode(#"""
        {"id":"par","role":"bot","kind":"activity","at":7,"tool":{"name":"Parallel task"},
         "parallelTask":{"threadId":"p","title":"T","requestMessageId":"r","role":"card","state":"running"}}
        """#)
        let comm = try decode(#"""
        {"id":"comm","role":"bot","kind":"activity","at":8,"tool":{"name":"Messaged @Ada"},
         "comm":{"groupId":"g","withBotId":"ada","withName":"Ada","withColor":"teal"}}
        """#)
        let thread = try decode(#"""
        {"id":"th","role":"bot","kind":"activity","at":9,"tool":{"name":"Opened thread"},
         "threadRef":{"botId":"b","threadId":"t","title":"Opened"}}
        """#)
        let ask = try decode(#"""
        {"id":"ask","role":"bot","kind":"options","at":10,
         "card":{"title":"Approval needed","subtitle":"ls","options":["Allow","Deny"],"requestId":"r-ask","tool":"Bash"}}
        """#)
        let settled = try decode(#"""
        {"id":"done","role":"bot","kind":"options","at":11,
         "card":{"title":"Approval needed","subtitle":"ls","options":["Allow","Deny"],"requestId":"r-done","tool":"Bash","answered":"allow"}}
        """#)
        var reply = Message(id: "txt", role: .bot, kind: .text, at: 12)
        reply.text = "done"
        let messages = [user, running, ok, receipt, notice, failed, parallel, comm, thread, ask, settled, reply]
        XCTAssertEqual(messages.map(\.id), ["user", "run", "ok", "bad", "n", "err", "par", "comm", "th", "ask", "done", "txt"])
        XCTAssertTrue(isToolActivityRow(running) && isToolActivityRow(ok) && isToolActivityRow(receipt))
        XCTAssertFalse(isToolActivityRow(notice) || isToolActivityRow(failed) || isToolActivityRow(parallel))
        XCTAssertFalse(isToolActivityRow(comm) || isToolActivityRow(thread))
        for detail in ActivityDetail.allCases {
            let ids = transcriptRows(messages, detail: detail).map(\.id)
            XCTAssertFalse(ids.contains("run") || ids.contains("ok") || ids.contains("bad"), "\(detail)")
            // issue #426: an answered ask stays as its one-line receipt
            XCTAssertTrue(ids.contains("done"), "\(detail)")
            XCTAssertEqual(ids.contains("run.run"), detail != .hidden, "the steps are one line, gone when Hidden")
            XCTAssertTrue(ids.contains("user") && ids.contains("n") && ids.contains("err") && ids.contains("par") && ids.contains("ask") && ids.contains("txt"), "\(detail)")
            XCTAssertTrue(ids.contains("comm") || ids.contains("run.comm"), "\(detail)")
            XCTAssertTrue(ids.contains("th") || ids.contains("run.comm"), "\(detail)")
            guard case let .message(kept) = transcriptRows(messages, detail: detail)[0] else { return XCTFail("the text stays") }
            XCTAssertEqual(kept.attachments?.first?.name, "a.json")
        }
    }

    func testRowCarriesTheTimeAndSenderOfItsFirstMessage() {
        // The transcript's date separators and bubble tails read these off
        // the row rather than the message, so a run must answer for itself.
        let first = activity("a", at: 500)
        let second = activity("b", at: 900)
        let rows = transcriptRows([first, second], detail: .reduced)
        XCTAssertEqual(rows[0].at, 500)
        XCTAssertEqual(rows[0].kind, .activity)
        XCTAssertEqual(rows[0].role, .bot)
        XCTAssertEqual(rows[0].endAt, 900)
    }

    func testEmptyTranscriptStaysEmptyAtEveryLevel() {
        for detail in ActivityDetail.allCases {
            XCTAssertTrue(transcriptRows([], detail: detail).isEmpty)
        }
    }

    // MARK: - Quick replies

    func testDefaultsAreTheFourChipsTheComposerAlreadyShows() {
        XCTAssertEqual(QuickReply.defaults.count, 4)
        XCTAssertEqual(QuickReply.defaults.map(\.title), ["Show diff", "Run tests", "Explain steps", "What's next?"])
    }

    func testQuickRepliesSurviveARoundTrip() {
        let mine = [
            QuickReply(title: "Deploy", prompt: "Deploy to staging", icon: "paperplane"),
            QuickReply(title: "Log", prompt: "Show the last 50 log lines", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(mine)), mine)
    }

    func testAnEmptyStoreFallsBackToDefaults() {
        // First launch: nothing written yet.
        XCTAssertEqual(QuickReply.decode(""), QuickReply.defaults)
    }

    func testCorruptStoreFallsBackToDefaultsRatherThanNoChips() {
        // A composer with no chips is worse than a composer with the stock
        // ones, so a bad decode is not allowed to empty the row.
        XCTAssertEqual(QuickReply.decode("{not json"), QuickReply.defaults)
    }

    func testDeletingEveryChipIsRespectedRatherThanReset() {
        // Distinct from a corrupt store: an explicit empty list means the
        // user cleared the row on purpose and it must stay cleared.
        XCTAssertEqual(QuickReply.decode(QuickReply.encode([])), [])
    }

    func testEmptyQuickReplyIDFallsBackToDefaults() {
        let replies = [QuickReply(id: " ", title: "Deploy", prompt: "Deploy", icon: "paperplane")]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }

    func testDuplicateQuickReplyIDsFallBackToDefaults() {
        let replies = [
            QuickReply(id: "same", title: "Deploy", prompt: "Deploy", icon: "paperplane"),
            QuickReply(id: "same", title: "Logs", prompt: "Show logs", icon: "doc.text"),
        ]
        XCTAssertEqual(QuickReply.decode(QuickReply.encode(replies)), QuickReply.defaults)
    }


    // MARK: - Digests

    // The harness writes a "[digest] · tools: … · reply: …" receipt after
    // every turn. Drawn as a bubble it was a log line under every reply;
    // dropped, the one record of what a turn touched was gone. It is its
    // own row — a chip — beside the tool chips it sums up, never among them.
    func testADigestIsItsOwnRowAtFullAndReduced() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), digest("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .full).map(\.id), ["a", "run.b", "c", "d", "e"])
        XCTAssertEqual(transcriptRows(messages, detail: .reduced).map(\.id), ["a", "run.b", "c", "d", "e"])
    }

    func testADigestIsHiddenWithTheActivityItSummarises() {
        let messages = [text("a"), activity("b"), digest("c"), text("d"), digest("e")]
        XCTAssertEqual(transcriptRows(messages, detail: .hidden).map(\.id), ["a", "d"])
    }

    func testADigestIsNeverFoldedIntoARunOfActivity() {
        let messages = [activity("a"), activity("b"), digest("c"), activity("d"), activity("e")]
        let rows = transcriptRows(messages, detail: .reduced)
        XCTAssertEqual(rows.map(\.id), ["run.a", "c", "run.d"])
        guard case let .message(receipt) = rows[1] else { return XCTFail("digest should be a message row") }
        XCTAssertEqual(receipt.kind, .digest)
    }

    func testVoiceCallTurnsAreOneCard() throws {
        let json = """
        [
          {"id":"u","role":"user","kind":"text","at":1000,"text":"hello there","voiceCall":{"callId":"call-1"}},
          {"id":"ask","role":"bot","kind":"options","at":2000,"text":"Allow this?"},
          {"id":"n","role":"bot","kind":"text","at":30000,"text":"working on it","turnId":"turn"},
          {"id":"b","role":"bot","kind":"text","at":35000,"text":"hi back","turnId":"turn","turnTerminal":true},
          {"id":"t","role":"user","kind":"text","at":40000,"text":"after","via":"call"}
        ]
        """
        let messages = try JSONDecoder().decode([Message].self, from: Data(json.utf8))
        XCTAssertEqual(messages[0].voiceCall?.callId, "call-1")
        let rows = transcriptRows(messages, detail: .full)
        // #4120 (#4112): a line that came by a call request (`via` "call"
        // without a Live call's id) is the Asked by row, outside the card
        XCTAssertEqual(rows.map(\.id), ["voice.call-1", "ask", "incoming.t"])
        guard case let .voiceCall(card) = rows[0] else { return XCTFail("one card") }
        XCTAssertEqual(spokenLines(card.messages).map(\.text), ["hello there", "working on it", "hi back"])
        XCTAssertEqual(formatVoiceCallDuration(voiceCallDurationMs(card.messages, now: 0, clock: nil)), "00:34")
        XCTAssertEqual(rosterPreview(messages, detail: .full), "after")
        XCTAssertFalse(rows.contains { if case .activityRun = $0 { return true } else { return false } })

        var fragment = Message(id: "f1", role: .user, kind: .text, at: 1)
        fragment.text = "hel"
        fragment.voiceCall = VoiceCallMeta(callId: "c")
        var whole = Message(id: "f2", role: .user, kind: .text, at: 2)
        whole.text = "hello"
        whole.voiceCall = VoiceCallMeta(callId: "c", continues: true)
        XCTAssertEqual(spokenLines([fragment, whole]).map(\.text), ["hello"])
        XCTAssertEqual(formatVoiceCallDuration(90_000), "01:30")
    }

    // A turn that touched nothing has nothing for the chip to open.
    func testADigestWithNothingDoneIsNotARow() {
        var quiet = digest("c")
        quiet.text = "[digest] · no tool calls · reply: Hi there."
        XCTAssertEqual(transcriptRows([text("a"), quiet], detail: .full).map(\.id), ["a"])
    }

    /// Issue #426: an answered or expired ask stays as its one-line receipt;
    /// one the engine closed on its own ("unavailable") or put away leaves.
    func testAnAnsweredPermissionStaysAsItsReceiptAndAClosedOneLeaves() throws {
        func permission(_ id: String, extra: String = "") throws -> Message {
            let json = """
            {"id":"\(id)","role":"bot","kind":"options","at":2,"card":{"title":"Approval needed","subtitle":"ls","options":["Allow","Deny"],"requestId":"r-\(id)","tool":"Bash"\(extra)}}
            """
            return try JSONDecoder().decode(Message.self, from: Data(json.utf8))
        }
        let open = try permission("open")
        let allowed = try permission("allowed", extra: ",\"answered\":\"allow\"")
        let denied = try permission("denied", extra: ",\"answered\":\"deny\"")
        let expired = try permission("expired", extra: ",\"expired\":true")
        let question = try JSONDecoder().decode(Message.self, from: Data("""
        {"id":"question","role":"bot","kind":"options","at":3,"card":{"title":"Which one?","subtitle":"Pick","options":["A"],"requestId":"q"}}
        """.utf8))
        let unavailable = try permission("gone", extra: ",\"answered\":\"unavailable\"")
        let dismissed = try permission("away", extra: ",\"dismissed\":true")
        XCTAssertFalse(settledPermissionLeavesChat(open))
        XCTAssertFalse(settledPermissionLeavesChat(allowed))
        XCTAssertFalse(settledPermissionLeavesChat(expired))
        XCTAssertTrue(settledPermissionLeavesChat(unavailable))
        XCTAssertTrue(settledPermissionLeavesChat(dismissed))
        XCTAssertFalse(settledPermissionLeavesChat(question))
        var saved = allowed
        saved.card?.alwaysAllowed = "mcp:sagax-environment__run_command"
        XCTAssertFalse(settledPermissionLeavesChat(saved), "an Always-allowed card stays to show its rule")
        XCTAssertEqual(
            transcriptRows([text("hi"), open, allowed, denied, expired, unavailable, dismissed, question], detail: .full).map(\.id),
            ["hi", "open", "allowed", "denied", "expired", "question"]
        )
    }
}

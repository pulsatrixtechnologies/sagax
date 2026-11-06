import Foundation
import XCTest
@testable import CompanionCore

/// 2026-10-29 ("we are in a unified chat"): a run's Continue in the
/// conversation opens the bot's one conversation, never the run's own task
/// nor an older version's results thread (desktop
/// `continueRoutineRunInConversation`, src/state/routine-run-open.test.ts).
/// #1699: the report is quoted in the composer.
final class RoutineContinueTests: XCTestCase {
    private func task(_ json: String) throws -> BotTask {
        try JSONDecoder().decode(BotTask.self, from: Data(json.utf8))
    }

    private func run(results: String?, output: String? = "Draft 1: ...\nDraft 2: ...") throws -> RoutineRun {
        let resultsField = results.map { #","resultsThreadId":"\#($0)""# } ?? ""
        let outputField: String
        if let output {
            let escaped = output
                .replacingOccurrences(of: "\\", with: "\\\\")
                .replacingOccurrences(of: "\"", with: "\\\"")
                .replacingOccurrences(of: "\n", with: "\\n")
            outputField = #","output":"\#(escaped)""#
        } else {
            outputField = ""
        }
        return try JSONDecoder().decode(RoutineRun.self, from: Data(#"{"id":"run-1","routineId":"r1","routineName":"Drafts","botId":"b","runOn":"maus","scheduledFor":1,"status":"completed","manual":false,"createdAt":1,"threadId":"exec"\#(resultsField)\#(outputField)}"#.utf8))
    }

    private func bot() throws -> Bot {
        Bot(id: "b", threadId: "chat", name: "Scout", title: "Researcher",
            description: "", notifications: true, color: "green", unread: false,
            modelSelection: ModelSelection(instanceId: "engine", model: "default"), createdAt: 1,
            tasks: [
                try task(#"{"threadId":"old","title":"","createdAt":1}"#),
                try task(#"{"threadId":"chat","title":"","createdAt":2}"#),
                try task(#"{"threadId":"exec","title":"Drafts · Oct 29","createdAt":3,"routineRunId":"run-1"}"#),
                try task(#"{"threadId":"results","title":"Drafts · Results","createdAt":0,"routineResults":true}"#),
            ])
    }

    private func reportMessage(summary: String = "All green.") -> Message {
        var message = Message(id: "report", role: .bot, kind: .routineRun, at: 1)
        message.routineRun = RoutineRunCard(
            runId: "run-1", routineId: "r1", routineName: "Drafts", status: "completed", summary: summary
        )
        return message
    }

    /// #2098: a run opens at its own message in the chat, never in a side
    /// view; a run this phone has no message for lands on the chat alone.
    func testReportMessageIsTheRunsRowInTheChat() throws {
        var other = reportMessage()
        other.id = "other"
        other.routineRun?.runId = "run-9"
        let plain = Message(id: "plain", role: .bot, kind: .text, at: 1)
        let report = RoutineResults.reportMessage(for: try run(results: "chat"), in: [plain, other, reportMessage()])
        XCTAssertEqual(report?.id, "report")
        XCTAssertNil(RoutineResults.reportMessage(for: try run(results: "chat"), in: [plain, other]))
    }

    func testContinueOpensTheTopicTheReportWentTo() throws {
        let target = RoutineResults.conversationTarget(for: try run(results: "old"), bots: [try bot()])
        XCTAssertEqual(target?.threadId, "old")
    }

    func testAnOldResultsThreadOrTheRunsTaskOpensTheConversation() throws {
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: "results"), bots: [try bot()])?.threadId, "chat")
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: "exec"), bots: [try bot()])?.threadId, "chat")
        XCTAssertEqual(RoutineResults.conversationTarget(for: try run(results: nil), bots: [try bot()])?.threadId, "chat")
    }

func testContinueQuotesTheLoadedReportInTheComposer() throws {
        let plan = RoutineResults.continuePlan(
            for: try run(results: "chat"), bots: [try bot()],
            messages: [reportMessage()], threadsShown: false
        )
        XCTAssertEqual(plan?.target.threadId, "chat")
        XCTAssertEqual(plan?.composerThreadId, "chat")
        XCTAssertEqual(plan?.focusMessageId, "report")
        XCTAssertEqual(plan?.citation?.quote, "All green.")
        XCTAssertEqual(plan?.citation?.source.threadId, "chat")
        XCTAssertEqual(plan?.citation?.source.messageId, "report")
        XCTAssertEqual(plan?.citation?.source.ownerId, "b")
        XCTAssertEqual(plan?.citation?.kind, "citation")
    }

    func testAReportTheWindowHasNotLoadedIsQuotedFromTheRunsRecord() throws {
        let run = try run(results: "chat")
        let plan = RoutineResults.continuePlan(
            for: run, bots: [try bot()], messages: [], threadsShown: false
        )
        XCTAssertEqual(plan?.citation?.quote, run.output)
        XCTAssertEqual(plan?.citation?.source.messageId, "routine-run:run-1")
        XCTAssertNil(plan?.focusMessageId)
    }

    func testWithThreadsHiddenAnEarlierTopicStillQuotesOnTheHomeComposer() throws {
        let plan = RoutineResults.continuePlan(
            for: try run(results: "old"), bots: [try bot()],
            messages: [reportMessage()], threadsShown: false
        )
        XCTAssertEqual(plan?.target.threadId, "old")
        XCTAssertEqual(plan?.composerThreadId, "chat")
        XCTAssertEqual(plan?.citation?.source.threadId, "old")
        XCTAssertEqual(plan?.citation?.quote, "All green.")
    }

    func testEmptyOutputYieldsNoCitation() throws {
        let plan = RoutineResults.continuePlan(
            for: try run(results: "chat", output: "   "), bots: [try bot()],
            messages: [], threadsShown: true
        )
        XCTAssertNil(plan?.citation)
        XCTAssertEqual(plan?.composerThreadId, "chat")
    }

    /// #1700: a run's notification (or a link to its execution thread) opens
    /// the run detail when this phone knows the run, never the report thread.
    func testARunNotificationResolvesToItsRunId() throws {
        let bots = [try bot()]
        let known: Set<String> = ["run-1"]
        let fromPayload = try XCTUnwrap(NotificationTarget(
            botId: "b", threadId: "chat", routineRunId: "run-1"
        ))
        XCTAssertEqual(
            RoutineResults.runId(for: fromPayload, bots: bots, knownRunIds: known),
            "run-1"
        )
        let fromExecution = try XCTUnwrap(NotificationTarget(botId: "b", threadId: "exec"))
        XCTAssertEqual(RoutineResults.runId(ofThread: "exec", bots: bots), "run-1")
        XCTAssertEqual(
            RoutineResults.runId(for: fromExecution, bots: bots, knownRunIds: known),
            "run-1"
        )
        // a run this client does not know keeps opening its conversation
        XCTAssertNil(
            RoutineResults.runId(
                for: try XCTUnwrap(NotificationTarget(botId: "b", threadId: "chat", routineRunId: "run-gone")),
                bots: bots,
                knownRunIds: known
            )
        )
        // a plain chat notification has no run
        XCTAssertNil(
            RoutineResults.runId(
                for: try XCTUnwrap(NotificationTarget(botId: "b", threadId: "chat")),
                bots: bots,
                knownRunIds: known
            )
        )
    }
}

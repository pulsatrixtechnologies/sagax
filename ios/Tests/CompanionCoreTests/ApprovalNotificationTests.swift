// Approval notifications on the phone and the watch (AGENTS.md, 2026-10-29):
// one notification per ask with its own id, the buttons always registered,
// a question's choices as buttons, the answer and the withdrawal.
import Foundation
import XCTest
@testable import CompanionCore
#if canImport(UserNotifications)
import UserNotifications
#endif

final class ApprovalNotificationTests: XCTestCase {
    // MARK: - One notification per ask

    func testAnAskHasItsOwnIdTheServerSharesAndTheNextLineKeepsTheConversations() {
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "approval", requestId: "r1"), "sagax.r.t1.r1")
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "question", requestId: "r1"), "sagax.r.t1.r1")
        // the next line of t1 never replaces the ask
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "message", requestId: "r1"), "sagax.t.t1")
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "done"), "sagax.t.t1")
        // an ask without a request is still the conversation's
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "approval"), "sagax.t.t1")
        let long = PushCollapse.identifier(threadId: String(repeating: "t", count: 80), kind: "approval", requestId: String(repeating: "r", count: 80))
        XCTAssertLessThanOrEqual(long.utf8.count, 64)
    }

    func testAPushNamesTheSameIdItsBannerHas() throws {
        let push = try XCTUnwrap(PushPayload(userInfo: ["aps": [:], "kind": "approval", "threadId": "t1", "requestId": "r1", "prompt": "approval"]))
        XCTAssertEqual(push.collapseIdentifier, "sagax.r.t1.r1")
        let settled = try XCTUnwrap(PushPayload(userInfo: ["aps": [:], "kind": "settled", "threadId": "t1", "requestId": "r1"]))
        XCTAssertEqual(settled.kind, .settled)
        XCTAssertEqual(settled.collapseIdentifier, "sagax.r.t1.r1")
    }

    // MARK: - Buttons

    func testChoicesUpToTheLimitThenThreeAndOpen() {
        XCTAssertEqual(NotificationChoices.layout(["Yes", "No"]), .init(shown: ["Yes", "No"], overflow: false))
        XCTAssertEqual(NotificationChoices.layout(["A", "B", "C", "D"]).shown, ["A", "B", "C", "D"])
        let many = NotificationChoices.layout(["A", "B", "C", "D", "E"])
        XCTAssertEqual(many.shown, ["A", "B", "C"])
        XCTAssertTrue(many.overflow)
        // blanks and repeats are not buttons
        XCTAssertEqual(NotificationChoices.layout([" A ", "A", "", "B"]).shown, ["A", "B"])
    }

    func testAQuestionWithChoicesGetsItsOwnCategoryAndOneWithoutGetsReply() {
        XCTAssertEqual(NotificationApproval.category(kind: "question", requestId: "q1", needsKey: false), NotificationApproval.questionCategory)
        let withChoices = NotificationApproval.category(kind: "question", requestId: "q1", needsKey: false, choices: ["Red", "Blue"])
        XCTAssertTrue(NotificationChoices.isChoicesCategory(withChoices))
        XCTAssertEqual(withChoices, NotificationApproval.category(kind: "question", requestId: "q2", needsKey: false, choices: ["Red", "Blue"]))
        XCTAssertNotEqual(withChoices, NotificationApproval.category(kind: "question", requestId: "q1", needsKey: false, choices: ["Blue", "Red"]))
        // approvals keep Allow once and Deny; no request, no buttons
        XCTAssertEqual(NotificationApproval.category(kind: "approval", requestId: "r1", needsKey: false, choices: ["x"]), NotificationApproval.category)
        XCTAssertEqual(NotificationApproval.category(kind: "question", requestId: nil, needsKey: false, choices: ["x"]), NotificationApproval.updateCategory)
    }

    func testAPushCarriesItsChoicesAndTheirLayout() throws {
        let push = try XCTUnwrap(PushPayload(userInfo: [
            "aps": [:], "kind": "approval", "prompt": "question", "threadId": "t1", "requestId": "q1",
            "choices": ["Red", "Blue", "Green", "Black", "White"],
        ]))
        XCTAssertEqual(push.choices, ["Red", "Blue", "Green", "Black", "White"])
        XCTAssertEqual(push.questionChoicesLayout, .init(shown: ["Red", "Blue", "Green"], overflow: true))
        // an approval never takes choices as buttons
        let approval = try XCTUnwrap(PushPayload(userInfo: ["aps": [:], "kind": "approval", "prompt": "approval", "requestId": "r1", "choices": ["A"]]))
        XCTAssertNil(approval.questionChoicesLayout)
    }

    // MARK: - Answering

    func testAChoiceButtonAnswersWithItsWords() {
        let info = ["threadId": "t1", "botId": "b1", "requestId": "q1", "choices": "Red\u{1F}Blue"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationChoices.actionIdentifier(1), info: info),
            .reply(threadId: "t1", requestId: "q1", text: "Blue")
        )
        // a choice the banner no longer knows opens the conversation instead of guessing
        if case .open = NotificationApproval.decide(actionIdentifier: NotificationChoices.actionIdentifier(5), info: info) {} else {
            XCTFail("an unknown choice opens the conversation")
        }
        if case .open = NotificationApproval.decide(actionIdentifier: NotificationChoices.openAction, info: info) {} else {
            XCTFail("Open opens the conversation")
        }
        XCTAssertEqual(NotificationApproval.decide(actionIdentifier: NotificationApproval.allowAction, info: ["threadId": "t1", "botId": "b1", "requestId": "r1"]),
                       .allow(threadId: "t1", requestId: "r1", needsKey: false))
    }

    func testTheReceiptSaysWhatWasAnswered() {
        XCTAssertEqual(AnswerFeedback.answered(.allow(threadId: "t", requestId: "r", needsKey: false)), .allowed)
        XCTAssertEqual(AnswerFeedback.answered(.deny(threadId: "t", requestId: "r")), .denied)
        XCTAssertEqual(AnswerFeedback.answered(.reply(threadId: "t", requestId: "r", text: "Blue")), .answered("Blue"))
        XCTAssertEqual(NotificationQuestion.first(line: "Publish version 2.4 to the team?\nRelease notes checked."), "Publish version 2.4 to the team?")
    }

    func testUnavailableRespondNeverCountsAsLanded() {
        // #1744: a 200 with outcome unavailable must not become Allowed / Answer sent
        XCTAssertFalse(AnswerFeedback.respondLanded("unavailable"))
        XCTAssertTrue(AnswerFeedback.respondLanded("allowed-once"))
        XCTAssertTrue(AnswerFeedback.respondLanded("rejected"))
        XCTAssertTrue(AnswerFeedback.respondLanded("answered"))
        XCTAssertTrue(AnswerFeedback.respondLanded(nil), "a body without outcome still landed")
    }

    // MARK: - Withdrawal

    func testASettledAskTakesDownItsOwnBannersOnly() {
        let now = Date()
        let delivered = [
            DeliveredNotifications.Delivered(id: "a", botId: "b", threadId: "t1", date: now, requestId: "r1"),
            DeliveredNotifications.Delivered(id: "b", botId: "b", threadId: "t1", date: now, requestId: "r2"),
            DeliveredNotifications.Delivered(id: "c", botId: "b", threadId: "t1", date: now),
            DeliveredNotifications.Delivered(id: "d", botId: "b", threadId: "t2", date: now, requestId: "r1"),
        ]
        XCTAssertEqual(DeliveredNotifications.forRequest(delivered, threadId: "t1", requestId: "r1"), ["a"])
        XCTAssertEqual(DeliveredNotifications.forRequest(delivered, threadId: "t1", requestId: nil), [])
    }

    func testReadingAConversationNeverTakesDownAnAskStillOpen() throws {
        let bot = Bot(
            id: "b", threadId: "t1", name: "Scout", title: "Scout", description: "", notifications: true,
            color: "cyan", unread: false, modelSelection: ModelSelection(instanceId: "engine", model: "default"),
            createdAt: 0, tasks: [BotTask(threadId: "t1", title: "x", createdAt: 0)]
        )
        let old = Date().addingTimeInterval(-60)
        let delivered = [
            DeliveredNotifications.Delivered(id: "ask", botId: "b", threadId: "t1", date: old, requestId: "r1"),
            DeliveredNotifications.Delivered(id: "line", botId: "b", threadId: "t1", date: old),
        ]
        XCTAssertEqual(DeliveredNotifications.settled(delivered, bots: [bot], openRequestIds: ["r1"]), ["line"])
        XCTAssertEqual(Set(DeliveredNotifications.settled(delivered, bots: [bot])), ["ask", "line"])
    }

    func testTheStreamSaysWhenAnAskWasAnsweredElsewhere() throws {
        let frame = try JSONDecoder().decode(Frame.self, from: Data(#"{"kind":"notify-withdraw","threadId":"t1","requestId":"r1"}"#.utf8))
        guard case let .notifyWithdraw(threadId, requestId) = frame else { return XCTFail("notify-withdraw") }
        XCTAssertEqual(threadId, "t1")
        XCTAssertEqual(requestId, "r1")
    }

    // MARK: - Words

    func testTheQuestionComesFirstAndNeverTwice() throws {
        let frame = try JSONDecoder().decode(Frame.self, from: Data("""
        {"kind":"notify","notification":{"kind":"approval","botId":"b","botName":"Scout","threadId":"t1",
         "title":"Publish version 2.4?","ask":"Publish version 2.4?","body":"Release notes checked.","requestId":"r1",
         "quietOnPhones":true}}
        """.utf8))
        guard case let .notify(note) = frame else { return XCTFail("notify") }
        XCTAssertEqual(note.bannerBody, "Publish version 2.4?\nRelease notes checked.")
        XCTAssertEqual(note.quietOnPhones, true)
        var same = note
        same.body = "Publish version 2.4?"
        XCTAssertEqual(same.bannerBody, "Publish version 2.4?")
    }

    func testAnAsksQuestionReadsFirstWhateverTheCardsHeader() {
        // a header title ("Approval needed") asks with its subtitle
        XCTAssertEqual(NeedsYouText(title: "Approval needed", subtitle: "Publish version 2.4 to the team?"),
                       NeedsYouText(question: "Publish version 2.4 to the team?", detail: nil))
        // a plain question title asks first, its subtitle is the detail
        XCTAssertEqual(NeedsYouText(title: "Allow Scout to run a command?", subtitle: "npm publish"),
                       NeedsYouText(question: "Allow Scout to run a command?", detail: "npm publish"))
        XCTAssertEqual(NeedsYouText(title: nil, subtitle: nil, line: "Waiting on you").question, "Waiting on you")
    }

    #if canImport(UserNotifications)
    func testChoiceButtonsAreAddedNextToTheFixedOnesAndStayBounded() {
        let titles = NotificationCategories.Titles(allowOnce: "Allow once", deny: "Deny", reply: "Reply", send: "Send", placeholder: "Type")
        let fixed = NotificationCategories.fixed(titles)
        XCTAssertEqual(Set(fixed.map(\.identifier)), [NotificationApproval.category, NotificationApproval.keyCategory, NotificationApproval.updateCategory, NotificationApproval.questionCategory, NotificationApproval.needsYouCategory, NotificationApproval.proposalCategory])
        let approval = try? XCTUnwrap(fixed.first { $0.identifier == NotificationApproval.category })
        XCTAssertEqual(approval?.actions.map(\.identifier), [NotificationApproval.allowAction, NotificationApproval.denyAction])

        let category = NotificationCategories.choices(NotificationChoices.layout(["A", "B", "C", "D", "E"]), openTitle: "Open")
        XCTAssertEqual(category.actions.map(\.title), ["A", "B", "C", "Open"])
        XCTAssertEqual(category.actions.last?.identifier, NotificationChoices.openAction)

        var all = fixed
        for index in 0..<40 {
            all = NotificationCategories.merged(all, adding: NotificationCategories.choices(NotificationChoices.layout(["x\(index)"]), openTitle: "Open"))
        }
        // the fixed ones never go, the per-choices ones stay bounded, the newest is there
        XCTAssertTrue(fixed.allSatisfy { kept in all.contains { $0.identifier == kept.identifier } })
        XCTAssertLessThanOrEqual(all.filter { NotificationChoices.isChoicesCategory($0.identifier) }.count, NotificationCategories.choicesKept)
        XCTAssertTrue(all.contains { $0.identifier == NotificationChoices.categoryIdentifier(["x39"], overflow: false) })
    }
    #endif
}

/// "Needs you" follows the server, shared by every device (2026-10-29): an
/// ask answered on the Mac leaves the phone's Updates, badge and banners,
/// even when the phone still holds the card as open.
final class NeedsYouFollowsServerTests: XCTestCase {
    private func state(activity: String?) throws -> CompanionState {
        var task = BotTask(threadId: "t1", title: "Release", createdAt: 0)
        task.activity = activity
        let bot = Bot(
            id: "b", threadId: "t1", name: "Scout", title: "Scout", description: "", notifications: true,
            color: "cyan", unread: false, modelSelection: ModelSelection(instanceId: "engine", model: "default"),
            createdAt: 0, tasks: [task]
        )
        var state = CompanionState()
        state.hydrate(Fleet(bots: [bot], groups: []))
        let card = try JSONDecoder().decode(Message.self, from: Data("""
        {"id":"m1","role":"bot","kind":"options","at":1,
         "card":{"title":"Approval needed","subtitle":"Publish version 2.4 to the team?","options":["Allow","Deny"],"requestId":"r1"}}
        """.utf8))
        state.apply(.message(threadId: "t1", message: card))
        return state
    }

    func testAnAskTheServerStillWaitsOnIsAnAction() throws {
        let waiting = try state(activity: "waiting-on-you")
        XCTAssertEqual(waiting.pendingApprovals.count, 1)
        XCTAssertEqual(waiting.updates.first?.kind, .needsYou)
        XCTAssertEqual(waiting.openRequestIds, ["r1"])
    }

    func testAnAskAnsweredOnTheMacLeavesThePhonesActions() throws {
        // the phone missed the card's patch; the server says the
        // conversation no longer waits (answered on the Mac)
        for activity in ["working", "idle"] {
            let answered = try state(activity: activity)
            XCTAssertTrue(answered.pendingApprovals.isEmpty, activity)
            XCTAssertFalse(answered.updates.contains { $0.kind == .needsYou }, activity)
            XCTAssertTrue(answered.openRequestIds.isEmpty, activity)
        }
    }

    func testAnOlderServerWithoutActivityKeepsTheCard() throws {
        XCTAssertEqual(try state(activity: nil).pendingApprovals.count, 1)
    }
}

// #2697: a needs-you answers with Approve and Deny, a proactive proposal with
// Do it and Not now, from the banner.
final class NeedsYouProposalNotificationTests: XCTestCase {
    func testTheCategoriesFollowTheServer() {
        XCTAssertEqual(NotificationApproval.category(kind: "needs-you", requestId: nil, needsKey: false), "SAGAX_NEEDS_YOU")
        XCTAssertEqual(NotificationApproval.category(kind: "proposal", requestId: nil, needsKey: false, proposalId: "p1"), "SAGAX_PROPOSAL")
        XCTAssertEqual(NotificationApproval.category(kind: "proposal", requestId: nil, needsKey: false), NotificationApproval.updateCategory)
        XCTAssertEqual(PushCollapse.identifier(threadId: "t1", kind: "proposal", proposalId: "p-123"), "sagax.p.p-123")
    }

    func testApproveAndDenyAnswerTheBotInItsConversation() {
        let info = ["threadId": "t1", "botId": "b1", "kind": "approval", "groupId": "g1"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.approveAction, info: info),
            .needsYou(botId: "b1", threadId: "t1", groupId: "g1", approve: true)
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.declineAction, info: ["threadId": "t1", "botId": "b1", "groupId": ""]),
            .needsYou(botId: "b1", threadId: "t1", groupId: nil, approve: false)
        )
    }

    func testDoItAndNotNowAnswerTheProposal() {
        let info = ["threadId": "t1", "botId": "b1", "proposalId": "p1"]
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.doItAction, info: info),
            .proposal(botId: "b1", proposalId: "p1", accept: true)
        )
        XCTAssertEqual(
            NotificationApproval.decide(actionIdentifier: NotificationApproval.notNowAction, info: info),
            .proposal(botId: "b1", proposalId: "p1", accept: false)
        )
    }

    #if canImport(UserNotifications)
    func testTheFixedCategoriesCarryTheButtons() {
        let categories = NotificationCategories.fixed(NotificationCategories.Titles(allowOnce: "Allow once", deny: "Deny", reply: "Reply", send: "Send", placeholder: "…"))
        let needsYou = categories.first { $0.identifier == NotificationApproval.needsYouCategory }
        XCTAssertEqual(needsYou?.actions.map(\.title), ["Approve", "Deny"])
        let proposal = categories.first { $0.identifier == NotificationApproval.proposalCategory }
        XCTAssertEqual(proposal?.actions.map(\.title), ["Do it", "Not now"])
    }
    #endif
}

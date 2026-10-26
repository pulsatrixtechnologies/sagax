// WP2: the approval dock and the interactive cards, decided as the Electron
// renderer decides them (PendingApproval.tsx, OptionCard.tsx,
// SecretRequestCard.tsx, AccessCard.tsx,
// ParallelTaskCard.tsx, GoalRunCard.tsx, ChatView.tsx ErrorRow), and the
// requests they send.
import Foundation
import XCTest
@testable import CompanionCore

final class CardActionsTests: XCTestCase {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    private func ask(
        _ id: String, tool: String, subtitle: String = "", input: String? = nil, extra: String = ""
    ) throws -> Message {
        let inputField = input.map { #","toolInput":\#(String(data: try! JSONEncoder().encode($0), encoding: .utf8)!)"# } ?? ""
        return try decode(Message.self, #"""
        {"id":"m-\#(id)","role":"bot","kind":"options","at":1,
         "card":{"title":"Approve?","subtitle":"\#(subtitle)","options":["Allow","Deny"],
                 "requestId":"\#(id)","tool":"\#(tool)"\#(inputField)\#(extra)}}
        """#)
    }

    private func text(_ id: String, _ role: Message.Role, _ words: String = "words") throws -> Message {
        try decode(Message.self, #"{"id":"\#(id)","role":"\#(role.rawValue)","kind":"text","at":1,"text":"\#(words)"}"#)
    }

    // MARK: Decoding

    func testDecodesTheDockFieldsOfAnApprovalCard() throws {
        let message = try ask("r1", tool: "Bash", subtitle: "ls", extra: #"""
        ,"allowSession":true,"heldCode":"held.guard","expired":false,"adminApproval":true,
         "toolHints":{"readOnly":true},
         "commandAllowlist":{"command":"ls -la","cwd":"/work","providerInstanceId":"claude"},
         "routineRequest":{"version":1,"operation":{"action":"create","name":"n"},"extra":[1,2]},
         "teamSetupRequest":{"deletion":true,"bots":[]}
        """#)
        let card = try XCTUnwrap(message.card)
        XCTAssertEqual(card.allowSession, true)
        XCTAssertEqual(card.heldCode, "held.guard")
        XCTAssertEqual(card.adminApproval, true)
        XCTAssertEqual(card.toolHints?.readOnly, true)
        XCTAssertEqual(card.commandAllowlist, CommandAllowlistCandidate(command: "ls -la", cwd: "/work", providerInstanceId: "claude"))
        XCTAssertEqual(card.routineRequest?.operation?.action, "create")
        XCTAssertEqual(card.teamSetupRequest?.deletion, true)
        XCTAssertTrue(card.isPending)
        XCTAssertEqual(try JSONDecoder().decode(Message.self, from: JSONEncoder().encode(message)), message)
    }

    func testAnExpiredProposalIsNotPending() throws {
        let card = try XCTUnwrap(try ask("r1", tool: "schedule_routine", extra: #","expired":true"#).card)
        XCTAssertFalse(card.isPending)
        XCTAssertEqual(ApprovalOutcome.of(card), .expired)
    }

    func testASupersededSecretIsNotPending() throws {
        let secret = try decode(SecretRequestCardData.self, #"{"label":"Key","superseded":true}"#)
        XCTAssertFalse(secret.isPending)
        XCTAssertFalse(SecretCardRules.canDismiss(secret))
    }

    // MARK: Risk

    func testRiskFollowsTheDesktopClassifier() {
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "Read", input: nil), .read)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "Glob", input: nil), .read)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "Bash", input: "ls"), .execute)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "Write", input: nil), .write)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__perspicax__cw_psa_schedule__query", input: "{}"), .read)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__perspicax__cw_psa_tickets_delete", input: nil), .destructive)
        // a generic verb reads the arguments
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__perspicax__cw_psa__write", input: #"{"method":"GET"}"#), .read)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__perspicax__cw_psa__write", input: #"{"method":"DELETE"}"#), .destructive)
        // annotations win
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__x__do_thing", input: nil, hints: ToolHints(readOnly: true)), .read)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__x__list_items", input: nil, hints: ToolHints(destructive: true)), .destructive)
        XCTAssertEqual(ApprovalRiskClassifier.risk(tool: "mcp__x__list_items", input: nil, hints: ToolHints(readOnly: false)), .write)
        XCTAssertNil(ApprovalRiskClassifier.risk(tool: "mcp__x__frobnicate", input: nil))
        XCTAssertNil(ApprovalRiskClassifier.risk(tool: nil, input: nil))
    }

    // MARK: Dock

    func testPendingApprovalsAreOpenToolAsksOldestFirst() throws {
        var answered = try ask("old", tool: "Read")
        answered.card?.answered = "allow"
        var question = try ask("q", tool: "Read")
        question.card?.tool = nil
        var waiting = try ask("w", tool: "Read")
        waiting.state = "waiting-on-owner"
        let list = ApprovalDockRules.pendingApprovals([
            answered, try ask("a", tool: "Read"), question, try text("t", .user), waiting, try ask("b", tool: "Bash"),
        ])
        XCTAssertEqual(list.map(\.requestId), ["a", "b"])
        XCTAssertEqual(list[1].tool, "Bash")
    }

    func testAllowAllReadOnlyTakesOnlyPlainReads() throws {
        let list = ApprovalDockRules.pendingApprovals([
            try ask("read", tool: "Read"),
            try ask("glob", tool: "Glob"),
            try ask("bash", tool: "Bash", subtitle: "ls"),
            try ask("admin", tool: "Read", extra: #","adminApproval":true"#),
            try ask("skill", tool: "Read", extra: #","skillRequest":{"version":1,"requestId":"s","botId":"b","threadId":"t","stagedId":"x","action":"create","name":"n","gist":"g","warnings":[],"createdAt":1}"#),
        ])
        XCTAssertEqual(ApprovalDockRules.readOnly(list).map(\.requestId), ["read", "glob"])
    }

    func testTheStepperFollowsTheRequestNotItsPosition() throws {
        let list = ApprovalDockRules.pendingApprovals([try ask("a", tool: "Read"), try ask("b", tool: "Read"), try ask("c", tool: "Read")])
        XCTAssertEqual(ApprovalDockRules.stepperIndex(list, requestId: nil), 0)
        XCTAssertEqual(ApprovalDockRules.stepperIndex(list, requestId: "c"), 2)
        XCTAssertEqual(ApprovalDockRules.stepperIndex(list, requestId: "gone"), 0)
        let after = Array(list.dropFirst())
        XCTAssertEqual(ApprovalDockRules.stepperIndex(after, requestId: "c"), 1)
    }

    /// 2026-10-20 (JC): a card with an owner rule offers one Always allow
    /// that keeps that rule in one click, and no older grant beside it.
    func testOwnerRuleIsTheOneAlwaysAllow() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "Bash", extra: #","allowSession":true,"ownerRule":{"description":"Run a command (git)"}"#)]).first)
        let actions = ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true)
        XCTAssertTrue(actions.alwaysAllowRule)
        XCTAssertFalse(actions.alwaysAllowSession)
        XCTAssertFalse(actions.alwaysAllowCommand)
        XCTAssertEqual(ApprovalDockRules.decision(.alwaysAllowRule, for: pending).rule, "allow")
        XCTAssertNil(ApprovalDockRules.decision(.allowOnce, for: pending).rule)
    }

    func testActionsForAProviderAskOfferTheSessionAllow() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "Read", extra: #","allowSession":true"#)]).first)
        let actions = ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true)
        XCTAssertFalse(actions.cancelTurn)
        XCTAssertTrue(actions.alwaysAllowSession)
        XCTAssertFalse(actions.alwaysAllowTool)
        XCTAssertFalse(actions.alwaysAllowCommand)
        XCTAssertEqual(actions.primary, .allowOnce)
        XCTAssertFalse(actions.denyIsCancel)
    }

    func testACommandTheOwnerMayRememberReplacesTheSessionAllow() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "Bash", extra: #"""
        ,"allowSession":true,"commandAllowlist":{"command":"ls","cwd":"/w","providerInstanceId":"claude"}
        """#)]).first)
        let owner = ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true)
        XCTAssertTrue(owner.alwaysAllowCommand)
        XCTAssertFalse(owner.alwaysAllowSession)
        let member = ApprovalDockRules.actions(for: pending, ownerOrAdmin: false, hasBot: true)
        XCTAssertFalse(member.alwaysAllowCommand)
        XCTAssertTrue(member.alwaysAllowSession)
    }

    func testAHarnessGrantKeyOffersAlwaysAllowOnlyWithABot() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "message_bot", extra: ##","allowKey":"peer:b2","allowSession":true"##)]).first)
        XCTAssertTrue(ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true).alwaysAllowTool)
        XCTAssertFalse(ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true).alwaysAllowSession)
        XCTAssertFalse(ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: false).alwaysAllowTool)
    }

    func testProposalsAreConfirmedOrCancelledNeverRemembered() throws {
        let routine = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("r", tool: "schedule_routine", extra: #","allowSession":true,"routineRequest":{"operation":{"action":"create"}}"#)]).first)
        let actions = ApprovalDockRules.actions(for: routine, ownerOrAdmin: true, hasBot: true)
        XCTAssertFalse(actions.cancelTurn)
        XCTAssertTrue(actions.denyIsCancel)
        XCTAssertFalse(actions.alwaysAllowSession)
        XCTAssertEqual(actions.primary, .confirm)

        let skill = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("s", tool: "stage_skill", extra: #","skillRequest":{"version":1,"requestId":"s","botId":"b","threadId":"t","stagedId":"x","action":"update","name":"n","gist":"g","warnings":[],"createdAt":1}"#)]).first)
        let skillActions = ApprovalDockRules.actions(for: skill, ownerOrAdmin: true, hasBot: true)
        XCTAssertEqual(skillActions.primary, .update)
        XCTAssertTrue(skillActions.primaryDisabled, "no reviewed hash: deny-only")
        XCTAssertFalse(skillActions.denyIsCancel)

        let setup = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("t", tool: "propose_team", extra: #","teamSetupRequest":{}"#)]).first)
        XCTAssertEqual(ApprovalDockRules.actions(for: setup, ownerOrAdmin: true, hasBot: true).primary, .option("Allow"))
    }

    func testAnAdminCommandWaitsForAnAdmin() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "Bash", extra: #","adminApproval":true"#)]).first)
        let member = ApprovalDockRules.actions(for: pending, ownerOrAdmin: false, hasBot: true)
        XCTAssertTrue(member.waitingForAdmin)
        XCTAssertTrue(member.cancelTurn)
        XCTAssertFalse(ApprovalDockRules.actions(for: pending, ownerOrAdmin: true, hasBot: true).waitingForAdmin)
    }

    func testDecisionsCarryTheDesktopsRespondBody() throws {
        let pending = try XCTUnwrap(ApprovalDockRules.pendingApprovals([try ask("a", tool: "Read", extra: ##","allowSession":true,"allowKey":"Read:x""##)]).first)
        let deny = ApprovalDockRules.decision(.deny, for: pending)
        XCTAssertEqual(deny.behavior, "deny")
        XCTAssertEqual(deny.message, "Denied by the user.")
        let once = ApprovalDockRules.decision(.allowOnce, for: pending)
        XCTAssertEqual(once.behavior, "allow")
        XCTAssertFalse(once.always)
        XCTAssertNil(once.alwaysAllowKey)
        let tool = ApprovalDockRules.decision(.alwaysAllowTool, for: pending)
        XCTAssertEqual(tool.alwaysAllowKey, "Read:x")
        XCTAssertFalse(tool.always, "a harness grant is saved on the bot, not the provider session")
        let command = ApprovalDockRules.decision(.alwaysAllowCommand, for: pending)
        XCTAssertTrue(command.rememberCommand)

        var session = pending
        session.card.allowKey = nil
        XCTAssertTrue(ApprovalDockRules.decision(.alwaysAllowSession, for: session).always)
    }

    func testParallelTasksWaitingOnThePersonJoinTheDock() throws {
        let tasks = try decode([BotTask].self, #"""
        [{"threadId":"p1","title":"Inventory","createdAt":1,"activity":"waiting-on-you",
          "parallelOf":{"threadId":"main","messageId":"m","at":1}},
         {"threadId":"p2","title":"Done one","createdAt":1,"activity":"waiting-on-you",
          "parallelOf":{"threadId":"main","messageId":"m","at":1,"reportedAt":2}},
         {"threadId":"p3","title":"Elsewhere","createdAt":1,"activity":"waiting-on-you",
          "parallelOf":{"threadId":"other","messageId":"m","at":1}},
         {"threadId":"main","title":"Main","createdAt":1}]
        """#)
        let waiting = ApprovalDockRules.waitingParallelTasks(tasks, of: "main")
        XCTAssertEqual(waiting.map(\.threadId), ["p1"])
        let pendings = ApprovalDockRules.parallelPendings([try ask("x", tool: "Read")], task: waiting[0])
        XCTAssertEqual(pendings.first?.parallelTitle, "Inventory")
        XCTAssertEqual(pendings.first?.answerThread(conversation: "main"), "p1")
    }

    func testTheDockShowsWhatRunsNeverRawArguments() throws {
        XCTAssertEqual(ApprovalHeading.detail(try XCTUnwrap(try ask("a", tool: "Bash", subtitle: "ls -la").card)), "ls -la")
        let read = try XCTUnwrap(try ask("b", tool: "Read", subtitle: #"{\"file_path\":\"/tmp/notes.md\"}"#).card)
        XCTAssertEqual(ApprovalHeading.detail(read), "/tmp/notes.md")
        let opaque = try XCTUnwrap(try ask("c", tool: "mcp__x__y", subtitle: #"{\"id\":3}"#).card)
        XCTAssertNil(ApprovalHeading.detail(opaque))
        XCTAssertEqual(ApprovalHeading.of(read), .wantsTo(.readFile))
        XCTAssertEqual(ApprovalHeading.of(try XCTUnwrap(try ask("d", tool: "mcp__srv__list_sites").card)), .wantsTo(.named("list sites")))
    }

    func testSettledOutcomes() throws {
        var card = try XCTUnwrap(try ask("a", tool: "Read").card)
        XCTAssertNil(ApprovalOutcome.of(card))
        card.answered = "allow"
        XCTAssertEqual(ApprovalOutcome.of(card), .allowed)
        card.alwaysAllowed = "mcp:sagax-environment__run_command"
        XCTAssertEqual(ApprovalOutcome.of(card), .alwaysAllowed, "Always allow reads like the web pill")
        card.alwaysAllowed = nil
        card.answered = "deny"
        XCTAssertEqual(ApprovalOutcome.of(card), .denied)
        card.routineRequest = ProposalRequestMarker(operation: .init(action: "pause"))
        XCTAssertEqual(ApprovalOutcome.of(card), .cancelled)
        card.answered = "allow"
        XCTAssertEqual(ApprovalOutcome.of(card), .routinePaused)
    }

    // MARK: Option card

    func testAQuizHidesOnceTalkedPastAndDismissesByPatch() throws {
        let quiz = try decode(Message.self, #"""
        {"id":"q","role":"bot","kind":"options","at":1,"card":{"title":"Pick","subtitle":"","options":["A","B"]}}
        """#)
        XCTAssertTrue(OptionCardRules.isOnboardingCard(quiz))
        XCTAssertFalse(OptionCardRules.hidesOnboardingCard(quiz, in: [quiz]))
        XCTAssertTrue(OptionCardRules.hidesOnboardingCard(quiz, in: [quiz, try text("u", .user)]))
        XCTAssertFalse(OptionCardRules.hidesOnboardingCard(quiz, in: [quiz, try text("b", .bot)]))
        var dismissed = quiz
        dismissed.card?.dismissed = true
        XCTAssertTrue(OptionCardRules.hidesOnboardingCard(dismissed, in: [dismissed]))
        XCTAssertEqual(OptionCardRules.dismissal(for: quiz.card!), .patch)
    }

    func testClosingALiveAskAnswersIt() throws {
        let tool = try XCTUnwrap(try ask("a", tool: "Read").card)
        XCTAssertEqual(OptionCardRules.dismissal(for: tool), .respond(behavior: "deny", message: "Dismissed by user."))
        var question = tool
        question.tool = nil
        guard case let .respond(behavior, _) = OptionCardRules.dismissal(for: question) else { return XCTFail("respond") }
        XCTAssertEqual(behavior, "answer")
    }

    // MARK: Credential card

    func testCredentialCardResumeAndDismissFollowTheDesktop() throws {
        let waiting = try decode(SecretRequestCardData.self, #"{"label":"Key"}"#)
        XCTAssertTrue(SecretCardRules.canDismiss(waiting))
        XCTAssertFalse(SecretCardRules.canRetryResume(waiting))
        XCTAssertFalse(SecretCardRules.isHidden(waiting))

        let declinedQuietly = try decode(SecretRequestCardData.self, #"{"label":"Key","dismissed":true}"#)
        XCTAssertTrue(SecretCardRules.isHidden(declinedQuietly))
        let declinedFailed = try decode(SecretRequestCardData.self, #"{"label":"Key","dismissed":true,"error":"resume failed"}"#)
        XCTAssertFalse(SecretCardRules.isHidden(declinedFailed))
        XCTAssertTrue(SecretCardRules.canRetryResume(declinedFailed))
        XCTAssertFalse(SecretCardRules.canDismiss(declinedFailed))

        let saved = try decode(SecretRequestCardData.self, #"{"label":"Key","provided":true,"resumed":true}"#)
        XCTAssertFalse(SecretCardRules.canRetryResume(saved))
    }

    // MARK: Parallel task card

    func testParallelCardStateRecordedEndWinsThenLiveState() throws {
        let ref = ParallelTaskRef(threadId: "p", title: "T", requestMessageId: "r", role: "card", state: "running")
        let busy = try decode(BotTask.self, #"{"threadId":"p","title":"T","createdAt":1,"busy":true}"#)
        let waiting = try decode(BotTask.self, #"{"threadId":"p","title":"T","createdAt":1,"busy":true,"activity":"waiting-on-you"}"#)
        let idle = try decode(BotTask.self, #"{"threadId":"p","title":"T","createdAt":1}"#)
        XCTAssertEqual(ParallelCardState.of(ref, task: busy), .running)
        XCTAssertEqual(ParallelCardState.of(ref, task: waiting), .waiting)
        XCTAssertEqual(ParallelCardState.of(ref, task: idle), .running)
        var stopped = ref
        stopped.state = "stopped"
        XCTAssertEqual(ParallelCardState.of(stopped, task: busy), .stopped)
        XCTAssertFalse(ParallelCardState.stopped.isLive)
        var queued = ref
        queued.state = "queued"
        XCTAssertEqual(ParallelCardState.of(queued, task: idle), .queued)
        XCTAssertTrue(ParallelCardState.queued.isLive)
        queued.state = nil
        XCTAssertEqual(ParallelCardState.of(queued, task: nil), .queued)
    }

    func testParallelCardsAndErrorsStayInTheTranscriptWhenActivityIsHidden() throws {
        let card = try decode(Message.self, #"""
        {"id":"c","role":"bot","kind":"activity","at":2,"tool":{"name":"Parallel task"},
         "parallelTask":{"threadId":"p","title":"T","requestMessageId":"r","role":"card","state":"running"}}
        """#)
        let error = try decode(Message.self, #"{"id":"e","role":"bot","kind":"activity","at":3,"tool":{"name":"error: boom","ok":false}}"#)
        let chip = try decode(Message.self, #"{"id":"k","role":"bot","kind":"activity","at":4,"tool":{"name":"Read","ok":true}}"#)
        for detail in [ActivityDetail.hidden, .reduced] {
            let rows = transcriptRows([card, chip, error, chip], detail: detail)
            let ids = rows.compactMap { row -> String? in
                if case let .message(message) = row { return message.id }
                return nil
            }
            XCTAssertTrue(ids.contains("c"), "\(detail)")
            XCTAssertTrue(ids.contains("e"), "\(detail)")
        }
    }

    // MARK: Error row

    func testRetryBelongsToTheLastRowOfAnIdleBot() throws {
        let user = try text("u", .user, "do it")
        let error = try decode(Message.self, #"{"id":"e","role":"bot","kind":"activity","at":2,"tool":{"name":"error: The engine stopped","ok":false}}"#)
        let digest = try decode(Message.self, #"{"id":"d","role":"bot","kind":"digest","at":3,"text":"[digest]"}"#)
        XCTAssertTrue(ErrorRowRules.isError(error))
        XCTAssertEqual(ErrorRowRules.text(error), "The engine stopped")
        XCTAssertEqual(ErrorRowRules.retryableErrorId(in: [user, error, digest], busy: false), "e")
        XCTAssertNil(ErrorRowRules.retryableErrorId(in: [user, error], busy: true))
        XCTAssertNil(ErrorRowRules.retryableErrorId(in: [error], busy: false), "no user line to send again")
        XCTAssertNil(ErrorRowRules.retryableErrorId(in: [user, error, try text("b", .bot)], busy: false))
        var setup = error
        setup.tool?.setup = true
        XCTAssertNil(ErrorRowRules.retryableErrorId(in: [user, setup], busy: false))
    }

    // MARK: Access card

    func testAccessCardLinesForTheViewer() throws {
        let card = try decode(AccessCard.self, #"""
        {"reason":"no_access","engine":"Claude","botId":"b","ownerPrincipalId":"P1",
         "payerPrincipalId":"p2","keysUrl":"https://console.example/keys","subscriptionSignIn":true}
        """#)
        let mine = AccessCardLines.of(card, viewerPrincipalId: "P2", admin: false)
        XCTAssertEqual(mine.text, .noAccessMine(engine: "Claude"))
        XCTAssertNil(mine.hint)
        XCTAssertEqual(mine.keysUrl, "https://console.example/keys")
        XCTAssertTrue(mine.signIn)
        let other = AccessCardLines.of(card, viewerPrincipalId: "p9", admin: true)
        XCTAssertEqual(other.text, .noAccessOther(engine: "Claude"))
        XCTAssertEqual(other.hint, .noAccessAdminOrgKey)
        XCTAssertNil(other.keysUrl)

        let missing = try decode(AccessCard.self, #"{"reason":"engine_missing","engine":"Codex","botId":"b","ownerPrincipalId":"p1"}"#)
        XCTAssertEqual(AccessCardLines.of(missing, viewerPrincipalId: "p1", admin: false).hint, .engineMissingOwner)
        let refused = try decode(AccessCard.self, #"{"reason":"key_refused","engine":"Claude","botId":"b","ownerPrincipalId":"p1","detail":"401"}"#)
        XCTAssertNil(AccessCardLines.of(refused, viewerPrincipalId: "x", admin: false).detail)
        XCTAssertEqual(AccessCardLines.of(refused, viewerPrincipalId: "p1", admin: false).detail, "401")
        let delegation = try decode(AccessCard.self, #"""
        {"reason":"routine_delegation","engine":"","botId":"b","ownerPrincipalId":"p1","runAsPrincipalId":"p1",
         "runAsName":"Jo","routineName":"Daily","suspendReason":"delegation_ended"}
        """#)
        let lines = AccessCardLines.of(delegation, viewerPrincipalId: "p1", admin: false)
        XCTAssertEqual(lines.text, .routineDelegation(routine: "Daily", person: "Jo"))
        XCTAssertEqual(lines.hint, .routineDelegationReason("delegation_ended"))
        XCTAssertTrue(lines.reconnect)
    }

    // MARK: Goal run card

    func testGoalRunText() throws {
        XCTAssertEqual(GoalRunText.compact("  a\n b   c ", limit: 10), "a b c")
        XCTAssertEqual(GoalRunText.compact("abcdefghijkl", limit: 5), "abcd…")
        let working = GoalRunCard(runId: "r", goal: "g", status: "working", coordinatorBotId: "b", coordinatorName: "Ara", turnCount: 2, maxTurns: 3, startedAt: 1)
        XCTAssertEqual(GoalRunText.turns(working), .current(turn: 3, of: 3))
        var done = working
        done.status = "completed"
        XCTAssertEqual(GoalRunText.turns(done), .total(2))
    }
}

// MARK: - Requests

private final class CardRequestStub: URLProtocol {
    nonisolated(unsafe) static var requests: [(URLRequest, Data?)] = []
    nonisolated(unsafe) static var responseBody = Data("{}".utf8)

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.requests.append((request, Self.body(request)))
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Self.responseBody)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}

    private static func body(_ request: URLRequest) -> Data? {
        if let body = request.httpBody { return body }
        guard let stream = request.httpBodyStream else { return nil }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 1_024)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count <= 0 { break }
            data.append(buffer, count: count)
        }
        return data
    }
}

final class CardClientTests: XCTestCase {
    private var session: URLSession!
    private var client: CompanionClient!

    override func setUp() {
        super.setUp()
        CardRequestStub.requests = []
        CardRequestStub.responseBody = Data("{}".utf8)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [CardRequestStub.self]
        session = URLSession(configuration: configuration)
        client = CompanionClient(connection: Connection(name: "Test", host: "127.0.0.1", port: 8810), token: "t", session: session)
    }

    override func tearDown() {
        session.invalidateAndCancel()
        super.tearDown()
    }

    private func last() throws -> (method: String, path: String, query: String?, body: [String: Any]) {
        let (request, data) = try XCTUnwrap(CardRequestStub.requests.last)
        let body = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        return (request.httpMethod ?? "", request.url?.path ?? "", request.url?.query, body)
    }

    func testDockAnswersSendTheRememberFlags() async throws {
        CardRequestStub.responseBody = Data(#"{"ok":true,"outcome":"allowed-once"}"#.utf8)
        let decision = ApprovalDecision(requestId: "r1", behavior: "allow", message: nil, reviewedSha256: nil, always: true, rememberCommand: false, alwaysAllowKey: nil)
        let outcome = try await client.respond(threadId: "t1", decision: decision)
        XCTAssertEqual(outcome, "allowed-once")
        var sent = try last()
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.path, "/api/threads/t1/respond")
        XCTAssertEqual(sent.body["requestId"] as? String, "r1")
        XCTAssertEqual(sent.body["always"] as? Bool, true)
        XCTAssertNil(sent.body["rememberCommand"])

        let command = ApprovalDecision(requestId: "r2", behavior: "allow", message: nil, reviewedSha256: nil, always: false, rememberCommand: true, alwaysAllowKey: nil)
        try await client.respond(threadId: "t1", decision: command)
        sent = try last()
        XCTAssertEqual(sent.body["rememberCommand"] as? Bool, true)
        XCTAssertNil(sent.body["always"])

        let deny = ApprovalDecision(requestId: "r3", behavior: "deny", message: "Denied by the user.", reviewedSha256: nil, always: false, rememberCommand: false, alwaysAllowKey: nil)
        try await client.respond(threadId: "t1", decision: deny)
        sent = try last()
        XCTAssertEqual(sent.body["behavior"] as? String, "deny")
        XCTAssertEqual(sent.body["message"] as? String, "Denied by the user.")
    }

    func testCardRoutes() async throws {
        try await client.dismissCard(botId: "b1", messageId: "m1")
        var sent = try last()
        XCTAssertEqual(sent.method, "PATCH")
        XCTAssertEqual(sent.path, "/api/bots/b1/cards/m1")
        XCTAssertEqual(sent.body["dismissed"] as? Bool, true)

        try await client.stopParallelTask(botId: "b1", threadId: "p1")
        sent = try last()
        XCTAssertEqual(sent.method, "POST")
        XCTAssertEqual(sent.path, "/api/bots/b1/parallel/p1/stop")

        try await client.resumeSecretCard(botId: "b1", messageId: "m2", threadId: "t1")
        sent = try last()
        XCTAssertEqual(sent.path, "/api/bots/b1/secret-cards/m2/resume")
        XCTAssertEqual(sent.body["threadId"] as? String, "t1")
        try await client.dismissSecretCard(botId: "b1", messageId: "m2", threadId: "t1")
        XCTAssertEqual(try last().path, "/api/bots/b1/secret-cards/m2/dismiss")
    }

    func testParallelStopRefusesARouteIdThatIsNotOne() async throws {
        do {
            try await client.stopParallelTask(botId: "b1", threadId: "../x")
            XCTFail("bad id")
        } catch {}
        XCTAssertTrue(CardRequestStub.requests.isEmpty)
    }
}

final class ApprovalPlainWordsTests: XCTestCase {
    private func card(_ json: String) throws -> OptionCard {
        try JSONDecoder().decode(OptionCard.self, from: Data(json.utf8))
    }

    func testServerPlainTitleOnEnglishPhones() throws {
        let ask = try card(#"{"title":"Approval needed","subtitle":"{\"command\":\"echo hi\"}","options":["Allow","Deny"],"requestId":"r1","tool":"other","plain":{"title":"Allow Cryptic to run a command?","line":"Runs an action.","risk":"execute"},"expiresAt":1760000000000}"#)
        XCTAssertEqual(ApprovalHeading.plainTitle(ask, language: "en-CA"), "Allow Cryptic to run a command?")
        XCTAssertEqual(ApprovalHeading.plainLine(ask, language: "en"), "Runs an action.")
        XCTAssertEqual(ask.expiresAt, 1760000000000)
        // English words never land in a French sentence
        XCTAssertNil(ApprovalHeading.plainTitle(ask, language: "fr-CA"))
    }

    func testOlderServersAndProposalsKeepTheAppHeading() throws {
        let old = try card(#"{"title":"Approval needed","subtitle":"pnpm test","options":["Allow","Deny"],"requestId":"r1","tool":"Bash"}"#)
        XCTAssertNil(ApprovalHeading.plainTitle(old, language: "en"))
        let routine = try card(#"{"title":"Routine","subtitle":"x","options":["Confirm"],"requestId":"r2","tool":"schedule_routine","routineRequest":{"operation":{"action":"create"}},"plain":{"title":"Allow X to schedule?","line":"y"}}"#)
        XCTAssertNil(ApprovalHeading.plainTitle(routine, language: "en"))
    }

    func testSavedAllowRuleShowsOnlyOnAnAllowedCard() throws {
        let base = #""title":"t","subtitle":"s","options":[],"requestId":"r","tool":"other""#
        let saved = try card("{\(base),\"answered\":\"allow\",\"alwaysAllowed\":\"mcp:sagax-environment__run_command\"}")
        XCTAssertEqual(AllowRuleText.savedRule(saved), "mcp:sagax-environment__run_command")
        XCTAssertNil(AllowRuleText.savedRule(try card("{\(base),\"answered\":\"allow\"}")))
        XCTAssertNil(AllowRuleText.savedRule(try card("{\(base),\"answered\":\"deny\",\"alwaysAllowed\":\"mcp:a__b\"}")))
        XCTAssertEqual(AllowRuleText.action(of: "mcp:sagax-environment__run_command"), .runCommand)
        XCTAssertEqual(AllowRuleText.action(of: "mcp:perspicax__cw_psa__write"), .named("cw psa write"))
        XCTAssertNil(AllowRuleText.action(of: "ask_bot:b2"))
    }
}

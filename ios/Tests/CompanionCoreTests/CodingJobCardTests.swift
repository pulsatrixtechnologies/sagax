// Port of `src/components/CodingJobCard.test.ts` / `src/lib/coding-job-card.ts`
// (#2148): the coding job card stays in the chat and never opens a thread.
import XCTest
@testable import CompanionCore

final class CodingJobCardTests: XCTestCase {
    private let now: Double = 1_800_000_000_000

    private func base() -> BotActivityItem {
        BotActivityItem(
            id: "thread:t1",
            botId: "pepper",
            title: "Fix the lexer",
            status: .running,
            startedAt: now - 5 * 60_000,
            updatedAt: now,
            threadId: "t1",
            coding: true,
            currentStep: "Running the tests",
            code: BotCodeWork(
                folder: "/srv/repos/parser",
                branch: "fix/lexer",
                repo: "acme/parser"
            )
        )
    }

    private func done() -> BotActivityItem {
        let item = base()
        return BotActivityItem(
            id: item.id,
            botId: item.botId,
            title: item.title,
            status: .finished,
            startedAt: item.startedAt,
            endedAt: now - 60_000,
            updatedAt: now,
            threadId: item.threadId,
            coding: true,
            currentStep: item.currentStep,
            code: BotCodeWork(
                folder: "/srv/repos/parser",
                branch: "fix/lexer",
                repo: "acme/parser",
                pullRequests: [
                    BotCodePullRequest(
                        number: 42,
                        title: "Split the lexer",
                        url: "https://github.com/acme/parser/pull/42",
                        at: now - 90_000
                    ),
                ],
                branches: [
                    BotCodeBranch(
                        name: "fix/lexer",
                        repo: "acme/parser",
                        pushed: true,
                        url: "https://github.com/acme/parser/tree/fix/lexer",
                        at: now - 100_000
                    ),
                ]
            )
        )
    }

    func testIsCodingJob() {
        XCTAssertTrue(CodingJobCard.isCodingJob(base()))
        XCTAssertFalse(CodingJobCard.isCodingJob(
            BotActivityItem(
                id: "x", botId: "b", title: "t", status: .finished,
                startedAt: now, coding: false, code: nil
            )
        ))
        XCTAssertTrue(CodingJobCard.isCodingJob(
            BotActivityItem(
                id: "x", botId: "b", title: "t", status: .finished,
                startedAt: now, coding: false, code: BotCodeWork(branch: "feat/x")
            )
        ))
    }

    func testShortRepoName() {
        XCTAssertEqual(CodingJobCard.shortRepoName("acme/marketplace"), "marketplace")
        XCTAssertEqual(CodingJobCard.shortRepoName("https://github.com/acme/marketplace.git"), "marketplace")
        XCTAssertNil(CodingJobCard.shortRepoName(nil))
        XCTAssertNil(CodingJobCard.shortRepoName("   "))
    }

    func testShortResultAndLastBotText() {
        XCTAssertEqual(CodingJobCard.shortResult(String(repeating: "x", count: 300))?.count, 280)
        var first = Message(id: "1", role: .bot, kind: .text, at: 1)
        first.text = "first"
        var user = Message(id: "2", role: .user, kind: .text, at: 2)
        user.text = "ok"
        var tool = Message(id: "3", role: .bot, kind: .activity, at: 3)
        tool.text = "ls"
        XCTAssertEqual(CodingJobCard.lastBotText([first, user, tool]), "first")
    }

    func testCodingJobView() {
        let view = CodingJobCard.view(item: done(), result: "**Done.** I split the lexer.")
        XCTAssertEqual(view.state, .finished)
        XCTAssertEqual(view.branch, "fix/lexer")
        XCTAssertEqual(view.repo, "parser")
        XCTAssertEqual(view.pr?.number, 42)
        XCTAssertEqual(view.pr?.url, "https://github.com/acme/parser/pull/42")
        XCTAssertEqual(view.result, "Done. I split the lexer.")
        XCTAssertNil(view.result?.range(of: "**"))
    }

    func testRunningViewKeepsStep() {
        let view = CodingJobCard.view(item: base())
        XCTAssertEqual(view.state, .running)
        XCTAssertEqual(view.currentStep, "Running the tests")
        XCTAssertEqual(view.branch, "fix/lexer")
        XCTAssertNil(view.pr)
    }
}

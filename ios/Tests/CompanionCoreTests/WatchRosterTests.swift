// The watch's bot list (#5128): the state and the last message of each row
// come from the phone's roster rules, never from a rule of the watch's own.
import XCTest
@testable import CompanionCore

final class WatchRosterTests: XCTestCase {
    func testStateFollowsThePhoneRowMark() {
        XCTAssertEqual(row(bot()).state, .standingBy)

        var working = bot()
        working.busy = true
        XCTAssertEqual(row(working).state, .working)

        var asks = bot()
        asks.activity = "waiting-on-you"
        XCTAssertEqual(row(asks).state, .cardToAnswer)
    }

    /// A card listed for the bot outranks its work, as on the phone.
    func testAPendingCardOutranksWork() {
        var working = bot()
        working.busy = true
        XCTAssertEqual(row(working, cardBots: ["pixel"]).state, .cardToAnswer)
        XCTAssertEqual(row(working, cardBots: ["someone-else"]).state, .working)
    }

    /// A teammate wait is painted busy on the wire; the phone shows it as a
    /// quiet wait, so the watch says the bot stands by.
    func testATeammateWaitIsNotWork() {
        var waits = bot()
        waits.busy = true
        waits.waitingOnTeammate = true
        XCTAssertEqual(row(waits).state, .standingBy)
    }

    func testPreviewIsTheBotsLastWordsNotAToolStep() {
        var question = Message(id: "1", role: .user, kind: .text, at: 1_000)
        question.text = "Status of the release?"
        var answer = Message(id: "2", role: .bot, kind: .text, at: 2_000)
        answer.text = "**Ready**: notes are written."
        var tool = Message(id: "3", role: .bot, kind: .activity, at: 3_000)
        tool.tool = ToolActivity(name: "read_file", ok: true)
        let rows = rows([bot()], messages: ["pixel-thread": [question, answer, tool]])
        XCTAssertEqual(rows.first?.preview, "Ready: notes are written.")
        XCTAssertEqual(rows.first?.lastAt, 3_000)
    }

    func testABotThatNeverSpokeHasNoPreviewNorTime() {
        let rows = rows([bot()], messages: [:])
        XCTAssertEqual(rows.first?.preview, "")
        XCTAssertNil(rows.first?.lastAt)
    }

    func testRowsKeepTheGivenOrder() {
        var other = bot()
        other.id = "scout"
        other.threadId = "scout-thread"
        XCTAssertEqual(rows([other, bot()], messages: [:]).map(\.id), ["scout", "pixel"])
    }

    // MARK: - Helpers

    private func row(_ bot: Bot, cardBots: Set<String> = []) -> WatchBotRow {
        rows([bot], messages: [:], cardBots: cardBots)[0]
    }

    private func rows(_ bots: [Bot], messages: [String: [Message]], cardBots: Set<String> = []) -> [WatchBotRow] {
        var fleetBots = bots
        for index in fleetBots.indices { fleetBots[index].messages = messages[fleetBots[index].threadId] ?? [] }
        var state = CompanionState()
        state.hydrate(Fleet(bots: fleetBots, groups: []))
        return WatchRoster.rows(bots, transcripts: state, cardBots: cardBots)
    }

    private func bot() -> Bot {
        Bot(
            id: "pixel", threadId: "pixel-thread", name: "Pixel", title: "Designer",
            description: "", notifications: true, color: "blue", unread: false,
            modelSelection: ModelSelection(instanceId: "i", model: "m"), createdAt: 1
        )
    }
}

import XCTest
@testable import CompanionCore

/// Markdown read as plain words on every line that does not draw it
/// (banners, roster, Updates). Mirrors shared/plain-text.test.ts.
final class PlainTextTests: XCTestCase {
    // the push a bot sent on 2026-11-08
    private let captureMarkdown = """
    Cinq messages de Nova, tous dépassés. Rien à trancher.

    | Champ | Valeur |
    | --- | --- |
    | Source | Nova, 5 messages, tours expirés |
    """
    private let captureFlattened = "Cinq messages de Nova, tous dépassés. Rien à trancher. | Champ | Valeur | | --- | --- | | Source | Nova, 5 messages, tours expirés..."

    func testReportedTableReadsAsKeyValue() {
        XCTAssertEqual(PlainText.from(markdown: captureMarkdown), "Cinq messages de Nova, tous dépassés. Rien à trancher. Source : Nova, 5 messages, tours expirés")
    }

    func testFlattenedTableAsThePhoneReceivedIt() {
        XCTAssertEqual(PlainText.from(markdown: captureFlattened), "Cinq messages de Nova, tous dépassés. Rien à trancher. Source : Nova, 5 messages, tours expirés...")
    }

    func testEmphasisLinksHeadingsBulletsCode() {
        XCTAssertEqual(PlainText.from(markdown: "**Gras** et __aussi__ et *italique*"), "Gras et aussi et italique")
        XCTAssertEqual(PlainText.from(markdown: "Voir [le billet](https://example.com/t/1) maintenant"), "Voir le billet maintenant")
        XCTAssertEqual(PlainText.from(markdown: "## Résumé\nTout est vert."), "Résumé Tout est vert.")
        XCTAssertEqual(PlainText.from(markdown: "- un\n- deux\n1. trois\n- [x] fait"), "un deux trois fait")
        XCTAssertEqual(PlainText.from(markdown: "Lance `pnpm test` puis lis."), "Lance pnpm test puis lis.")
        XCTAssertEqual(PlainText.from(markdown: "snake_case et 2 * 3 restent"), "snake_case et 2 * 3 restent")
        let fenced = "Correctif :\n```ts\nconst a = 1;\n```\nC'est fait."
        XCTAssertEqual(PlainText.from(markdown: fenced), "Correctif : const a = 1; C'est fait.")
        XCTAssertEqual(PlainText.from(markdown: fenced, dropCode: true), "Correctif : C'est fait.")
    }

    func testClipNeverCutsAWordInHalf() {
        XCTAssertEqual(PlainText.clip("Cinq messages de Nova, tous dépassés", max: 20), "Cinq messages de…")
        XCTAssertEqual(PlainText.clip("court", max: 20), "court")
    }

    func testBannerKeepsTheQuestionLineBreak() {
        XCTAssertEqual(PlainText.bannerLines("**Publier ?**\n| a | b | | --- | --- | | x | y |"), "Publier ?\nx : y")
    }

    func testFrameBannerBodyReadsPlainWords() {
        let frame = NotificationFrame(kind: "done", botId: "b", botName: "Scout", threadId: "t", title: "Scout", body: "Rien à trancher. | Champ | Valeur | | --- | --- | | Source | Nova |")
        XCTAssertEqual(frame.bannerBody, "Rien à trancher. Source : Nova")
    }
    // review 2026-11-08: a pending card's question feeds the lock screen
    // (Live Activity), the Updates sheet and the roster row
    private func pendingQuestion(subtitle: String) throws -> CompanionState {
        var task = BotTask(threadId: "t1", title: "Release", createdAt: 0)
        task.activity = "waiting-on-you"
        let bot = Bot(
            id: "b", threadId: "t1", name: "Scout", title: "Scout", description: "", notifications: true,
            color: "cyan", unread: false, modelSelection: ModelSelection(instanceId: "engine", model: "default"),
            createdAt: 0, tasks: [task]
        )
        var state = CompanionState()
        state.hydrate(Fleet(bots: [bot], groups: []))
        var message = Message(id: "m1", role: .bot, kind: .options, at: 1)
        var card = OptionCard(title: "Question", subtitle: subtitle, options: ["Oui", "Non"])
        card.requestId = "r1"
        message.card = card
        state.apply(.message(threadId: "t1", message: message))
        return state
    }

    func testANeedsYouLineReadsTheQuestionsWords() throws {
        let state = try pendingQuestion(subtitle: "**Publier** la version `2.4` ? Voir [notes](https://example.com)")
        let update = try XCTUnwrap(state.updates.first { $0.kind == .needsYou })
        XCTAssertEqual(update.line, "Publier la version 2.4 ? Voir notes")
    }

    func testARosterRowReadsAPendingCardsWords() {
        var message = Message(id: "m1", role: .bot, kind: .options, at: 1)
        var card = OptionCard(title: "Question", subtitle: "| Champ | Valeur |\n| --- | --- |\n| Version | **2.4** |", options: ["Oui"])
        card.requestId = "r1"
        message.card = card
        XCTAssertEqual(previewText(of: message), "Version : 2.4")
        card.requestId = nil
        card.title = "**Fait** : `deploy`"
        message.card = card
        XCTAssertEqual(previewText(of: message), "Fait : deploy")
    }
}

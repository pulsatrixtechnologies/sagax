import XCTest
@testable import CompanionCore

/// #2909: a question, an approval or a needs-you never asks for a pick
/// without its context, never shows a cut answer, and opens on its card.
final class NotificationContextTests: XCTestCase {
    private let longChoices = [
        "Ajouter une note générique à chaque entrée et les soumettre",
        "Laisser les entrées telles quelles et te les envoyer pour révision",
        "Supprimer les entrées et les recréer à partir de l'agenda",
    ]

    // MARK: - Labels (same rules as shared/notification-context.ts)

    func testShortLabelsAreWholeOrThereAreNone() {
        XCTAssertEqual(NotificationChoiceLabels.shortLabel("Créer le billet : un billet neuf au tableau Service"), "Créer le billet")
        XCTAssertNil(NotificationChoiceLabels.shortLabel("Archiver seulement les anciens billets fermés depuis plus de 90 jours"))
        XCTAssertEqual(NotificationChoiceLabels.labels(for: ["Oui", "Non"]), ["Oui", "Non"])
        XCTAssertNil(NotificationChoiceLabels.labels(for: ["A", "B", "C", "D"]))
        XCTAssertNil(NotificationChoiceLabels.labels(for: longChoices))
        XCTAssertEqual(NotificationChoiceLabels.labels(for: ["Purger : vider la cache des builds du mois", "Attendre"]), ["Purger", "Attendre"])
    }

    func testButtonsShowShortLabelsOrNothing() throws {
        let layout = try XCTUnwrap(NotificationChoices.buttons(choices: ["Locale", "Serveur"], labels: ["Locale", "Serveur"]))
        XCTAssertEqual(layout.shown, ["Locale", "Serveur"])
        XCTAssertFalse(layout.overflow)
        XCTAssertNil(NotificationChoices.buttons(choices: longChoices, labels: []))
        // a label too long for a button: the answer's own short form, else nothing
        XCTAssertEqual(NotificationChoices.buttons(choices: ["A", "B"], labels: ["Un libellé beaucoup trop long pour un bouton", "B"])?.shown, ["A", "B"])
        // an older server sends no labels: derived by the same rule
        XCTAssertEqual(NotificationChoices.buttons(choices: ["Red", "Blue"], labels: [])?.shown, ["Red", "Blue"])
        XCTAssertNil(NotificationChoices.buttons(choices: ["A", "B", "C", "D"], labels: ["A", "B", "C", "D"]))
    }

    // MARK: - Capture replay: long answers mean Open only

    func testTheCaptureReplayOffersOpenOnlyAndOpensTheCard() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Ember", "body": "Le billet #41872 a 3 entrées de temps sans note.\nMembre : Alex · Heures : 2,5"], "category": "SAGAX_OPEN"],
            "kind": "approval", "threadId": "t-ember", "botId": "b-ember", "needsYou": true, "cardId": "m-card",
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        XCTAssertTrue(payload.needsYou)
        XCTAssertEqual(payload.cardId, "m-card")
        XCTAssertEqual(payload.target?.cardId, "m-card")
        XCTAssertNil(payload.questionChoicesLayout)
        XCTAssertEqual(
            NotificationApproval.category(kind: "needs-you", requestId: nil, needsKey: false, choices: longChoices, choiceLabels: []),
            NotificationApproval.openCategory
        )
        let open = NotificationApproval.decide(
            actionIdentifier: NotificationChoices.openAction,
            info: ["threadId": "t-ember", "botId": "b-ember", "cardId": "m-card", "kind": "approval"]
        )
        guard case let .open(target)? = open else { return XCTFail("open") }
        XCTAssertEqual(target.cardId, "m-card")
    }

    func testLegibleNeedsYouAnswersAreButtonsAndSendTheWholeAnswer() throws {
        let userInfo: [AnyHashable: Any] = [
            "aps": ["alert": ["title": "Ember", "body": "Le disque est plein."], "category": "SAGAX_NEEDS_YOU"],
            "kind": "approval", "threadId": "t-ember", "botId": "b-ember", "needsYou": true,
            "choices": ["Purger : vider la cache des builds du mois", "Attendre"], "choiceLabels": ["Purger", "Attendre"],
        ]
        let payload = try XCTUnwrap(PushPayload(userInfo: userInfo))
        XCTAssertEqual(payload.choiceLabels, ["Purger", "Attendre"])
        XCTAssertEqual(payload.questionChoicesLayout?.shown, ["Purger", "Attendre"])
        let decision = NotificationApproval.decide(
            actionIdentifier: NotificationChoices.actionIdentifier(0),
            info: ["threadId": "t-ember", "botId": "b-ember", "kind": "approval",
                   "choices": ["Purger : vider la cache des builds du mois", "Attendre"].joined(separator: "\u{1F}")]
        )
        XCTAssertEqual(decision, .needsYouAnswer(botId: "b-ember", threadId: "t-ember", groupId: nil, text: "Purger : vider la cache des builds du mois"))
    }

    func testTheOpenCategoryHasOneOpenAction() throws {
        let categories = NotificationCategories.fixed(NotificationCategories.Titles(allowOnce: "Allow once", deny: "Deny", reply: "Reply", send: "Send", placeholder: "…", open: "Ouvrir"))
        let open = try XCTUnwrap(categories.first { $0.identifier == NotificationApproval.openCategory })
        XCTAssertEqual(open.actions.map(\.identifier), [NotificationChoices.openAction])
    }

    // MARK: - Target and banner

    func testATargetKeepsAValidCardOnly() {
        XCTAssertEqual(NotificationTarget(botId: "b", threadId: "t", cardId: "m1")?.cardId, "m1")
        XCTAssertNil(NotificationTarget(botId: "b", threadId: "t", cardId: "")?.cardId)
        XCTAssertNil(NotificationTarget(botId: "b", threadId: "t", cardId: String(repeating: "x", count: 200))?.cardId)
    }

    func testTheBannerShowsTheWholeContext() throws {
        let frame = try JSONDecoder().decode(Frame.self, from: Data("""
        {"kind":"notify","notification":{"kind":"needs-you","botId":"b","botName":"Ember","threadId":"t1",
         "title":"Ember","body":"Je fais quoi ?","context":"Deux copies diffèrent.\\nCopie : Locale · Date : 7 nov.\\n\\n• Locale\\n• Serveur",
         "cardId":"m1","choices":["Locale","Serveur"],"choiceLabels":["Locale","Serveur"]}}
        """.utf8))
        guard case let .notify(note) = frame else { return XCTFail("notify") }
        XCTAssertEqual(note.bannerBody, "Deux copies diffèrent.\nCopie : Locale · Date : 7 nov.\n\n• Locale\n• Serveur")
        XCTAssertEqual(note.cardId, "m1")
        XCTAssertEqual(note.choiceLabels, ["Locale", "Serveur"])
    }

    func testMarkdownTablesBecomeReadableLines() {
        let text = NotificationContextLines.plain("Deux copies :\n\n| Copie | Date |\n|---|---|\n| **Locale** | 7 nov. |\n| Serveur | 8 nov. |")
        XCTAssertEqual(text, "Deux copies :\n\nCopie : Locale · Date : 7 nov.\nCopie : Serveur · Date : 8 nov.")
    }
}

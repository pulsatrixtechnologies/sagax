import XCTest

@testable import CompanionCore

/// #4490: a form (a row per question, each with its control) and a
/// checklist (items to tick, then a button). The expected strings were
/// produced by `formatQuestionAnswers` in `shared/ask-question.ts` itself, so
/// an answer given on the phone is the same text the desktop sends.
final class FormCardAnswerTests: XCTestCase {
    private func row(_ question: String, _ kind: AnswerKind, optional: Bool = false, options: [String] = []) -> AskQuestion {
        AskQuestion(
            question: question, multiSelect: kind == .multi ? true : nil,
            options: options.map { AskQuestionOption(label: $0) },
            kind: kind, optional: optional ? true : nil
        )
    }

    private var checklist: AskQuestion {
        AskQuestion(
            question: "Six drafts", multiSelect: true,
            options: [AskQuestionOption(label: "Alpha", detail: "First text"), AskQuestionOption(label: "Beta", detail: "Second text")],
            kind: .multi, checked: ["Alpha"], actions: ["Post selected", "Skip tonight"]
        )
    }

    func testEveryKindAnswersAsTheDesktopDoes() {
        let form = [
            row("Standup, how long?", .duration), row("Which day?", .date), row("Start?", .time),
            row("Hours?", .number), row("Billable?", .yesNo, options: ["Yes", "No"]), row("Note", .longText, optional: true),
        ]
        let drafts: [Int: FormDraft] = [
            0: FormDraft(hours: "1", minutes: "30"), 1: FormDraft(value: "2026-11-17"), 2: FormDraft(value: "09:30"),
            3: FormDraft(value: " 7.5 "), 4: FormDraft(picked: ["yes"]),
        ]
        XCTAssertEqual(
            AskQuestionAnswer.formAnswer(form, drafts: drafts),
            "The user answered your questions.\n\nQ: Standup, how long?\nA: 90 min\n\nQ: Which day?\nA: 2026-11-17\n\nQ: Start?\nA: 09:30\n\nQ: Hours?\nA: 7.5\n\nQ: Billable?\nA: yes\n\nQ: Note\nA: (left empty)"
        )
    }

    func testAnOptionalRowNeverBlocksButARequiredOneDoes() {
        let form = [row("Ticket", .text), row("Note", .text, optional: true)]
        XCTAssertEqual(AskQuestionAnswer.owed(form, drafts: [:]), 1)
        XCTAssertNil(AskQuestionAnswer.formAnswer(form, drafts: [1: FormDraft(value: "hi")]))
        XCTAssertEqual(AskQuestionAnswer.owed(form, drafts: [0: FormDraft(value: "4512")]), 0)
        XCTAssertEqual(
            AskQuestionAnswer.formAnswer(form, drafts: [0: FormDraft(value: "4512")]),
            "The user answered your questions.\n\nQ: Ticket\nA: 4512\n\nQ: Note\nA: (left empty)"
        )
    }

    func testDurationIsTotalMinutesAndMoreThanZero() {
        XCTAssertEqual(AskQuestionAnswer.durationMinutes(FormDraft(hours: "", minutes: "45")), 45)
        XCTAssertEqual(AskQuestionAnswer.durationMinutes(FormDraft(hours: "2", minutes: "")), 120)
        XCTAssertEqual(AskQuestionAnswer.durationMinutes(FormDraft(hours: "0.5", minutes: "0")), 30)
        XCTAssertNil(AskQuestionAnswer.durationMinutes(FormDraft(hours: "0", minutes: "0")))
        XCTAssertNil(AskQuestionAnswer.durationMinutes(FormDraft()))
        XCTAssertNil(AskQuestionAnswer.durationMinutes(FormDraft(hours: "-1", minutes: "30")))
        XCTAssertNil(AskQuestionAnswer.durationMinutes(FormDraft(hours: "abc", minutes: "")))
        XCTAssertEqual(AskQuestionAnswer.durationParts("90 min")?.hours, 1)
        XCTAssertEqual(AskQuestionAnswer.durationParts("90 min")?.minutes, 30)
        XCTAssertEqual(AskQuestionAnswer.durationParts("45 min")?.hours, 0)
        XCTAssertNil(AskQuestionAnswer.durationParts("about an hour"))
    }

    func testAChecklistSendsItsPicksAndTheButtonPressed() {
        XCTAssertEqual(
            AskQuestionAnswer.checklistAnswer([checklist], picked: ["Alpha", "Beta"], action: "Post selected"),
            "The user answered your questions.\n\nQ: Six drafts\nA: Alpha, Beta\n\nQ: Action\nA: Post selected"
        )
    }

    func testAnEmptyChecklistSendsNoneAndItsActionBlock() {
        let text = AskQuestionAnswer.checklistAnswer([checklist], picked: [], action: "Skip tonight")
        XCTAssertEqual(text, "The user answered your questions.\n\nQ: Six drafts\nA: (none)\n\nQ: Action\nA: Skip tonight")
        XCTAssertEqual(AskQuestionAnswer.action(in: text), "Skip tonight")
        XCTAssertEqual(AskQuestionAnswer.byQuestion(text, questions: [checklist])["Six drafts"], "(none)")
    }

    func testANewlineSendsTheWholeAnswerAsJSON() {
        let questions = [row("Notes?", .longText), row("Q2 \"x\" /y\\", .text)]
        let text = AskQuestionAnswer.format(
            questions: questions, answers: [["line one\nline two"], ["tab\there é 😀 \u{01}"]]
        )
        XCTAssertEqual(
            text,
            "The user answered your questions.\n\nAnswers (JSON):\n[[\"Notes?\",\"line one\\nline two\"],[\"Q2 \\\"x\\\" /y\\\\\",\"tab\\there é 😀 \\u0001\"]]"
        )
        // and it reads back, newline intact
        let back = AskQuestionAnswer.byQuestion(text, questions: questions)
        XCTAssertEqual(back["Notes?"], "line one\nline two")
    }

    func testTheSettledCardReadsEachRowBack() {
        let form = [row("Length", .duration), row("Billable?", .yesNo, options: ["Yes", "No"]), row("Note", .text, optional: true)]
        let text = AskQuestionAnswer.formAnswer(form, drafts: [0: FormDraft(hours: "1", minutes: "30"), 1: FormDraft(picked: ["no"])])!
        let byQuestion = AskQuestionAnswer.byQuestion(text, questions: form)
        XCTAssertEqual(byQuestion["Length"], "90 min")
        XCTAssertEqual(byQuestion["Billable?"], "no")
        XCTAssertEqual(byQuestion["Note"], AskQuestionAnswer.leftEmpty)
        XCTAssertNil(AskQuestionAnswer.action(in: text))
    }

    func testYesNoShowsTheWordAndSendsTheId() {
        let yesNo = AskQuestion(
            question: "Billable?", options: [AskQuestionOption(label: "Yes", id: "yes"), AskQuestionOption(label: "No", id: "no")],
            kind: .yesNo
        )
        XCTAssertEqual(yesNo.options.map(yesNo.key), ["yes", "no"])
        XCTAssertEqual(AskQuestionAnswer.rowAnswer(yesNo, FormDraft(picked: ["yes"])), ["yes"])
    }

    func testDecodesAFormRowAndAChecklist() throws {
        let json = #"""
        {"title": "Posts", "subtitle": "Six drafts are ready.", "options": [], "requestId": "r1",
         "questionRequest": {"version": 1, "questions": [
           {"question": "Six drafts", "kind": "multi", "multiSelect": true,
            "options": [{"label": "Alpha", "description": "First text"}, {"label": "Beta"}],
            "checked": ["Alpha"], "actions": ["Post selected", "Skip tonight"]},
           {"question": "When?", "kind": "teleport", "optional": true}
         ]}}
        """#
        let card = try JSONDecoder().decode(OptionCard.self, from: Data(json.utf8))
        XCTAssertTrue(isFormCard(card.questions))
        XCTAssertTrue(card.questions[0].isChecklist)
        XCTAssertEqual(card.questions[0].checked, ["Alpha"])
        XCTAssertEqual(card.questions[0].actions, ["Post selected", "Skip tonight"])
        XCTAssertEqual(card.questions[0].options[0].detail, "First text")
        // a kind this build does not know is a plain row, never a decode failure
        XCTAssertNil(card.questions[1].kind)
        XCTAssertTrue(card.questions[1].isOptional)
    }

    func testAnEnginesOwnQuestionIsNotAForm() {
        XCTAssertFalse(isFormCard([AskQuestion(question: "Which model?", options: [AskQuestionOption(label: "A")])]))
    }
}

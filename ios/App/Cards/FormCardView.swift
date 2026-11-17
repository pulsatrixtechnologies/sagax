import CompanionCore
import SwiftUI

/// #4490: a question card a bot asks as a form (a row per question, each with
/// the control for its kind) or a checklist (items to tick, then the bot's
/// buttons). The desktop's `src/components/QuestionForm.tsx` in SwiftUI, on
/// the same sheet as every question card. The answer text is built by
/// `AskQuestionAnswer`, so the same input sends the same text as the Mac.
struct FormCardView: View {
    @Environment(\.themePalette) private var themePalette
    @Environment(\.desktopChatText) private var desktop
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message

    @State private var drafts: [Int: FormDraft] = [:]
    @State private var answering = false
    /// The harness settles the card after a round trip; holding the sent
    /// answer closes the window where the controls are still live.
    @State private var sent: String?
    /// Which field has the keyboard: row * 10 + 0 (the field) or + 1 (a duration's minutes).
    @FocusState private var focus: Int?
    /// #4490: Dynamic Type. Every size in the form and its sheet scales with it.
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1
    /// The date or time row whose picker sheet is open.
    @State private var pickerTarget: PickerTarget?

    private var card: OptionCard? { message.card }
    private var questions: [AskQuestion] { card?.questions ?? [] }
    private var checklist: Bool { questions.count == 1 && questions[0].isChecklist }
    private var colors: QuestionSheetColors { QuestionSheetColors(desktop: desktop, scale: scale, secondaryOpacity: 0.7) }
    private var ink2: Color { colors.inkSecondary }
    private var settled: Bool { (card?.answered != nil) || sent != nil || card.flatMap(WaitingCardSkip.fold) != nil }

    private func draft(_ index: Int) -> FormDraft {
        if let value = drafts[index] { return value }
        // a checklist starts as the bot proposed it
        if checklist, index == 0 { return FormDraft(picked: questions[0].checked ?? []) }
        return FormDraft()
    }

    private func update(_ index: Int, _ change: (inout FormDraft) -> Void) {
        var next = draft(index)
        change(&next)
        drafts[index] = next
    }

    private var allDrafts: [Int: FormDraft] {
        Dictionary(uniqueKeysWithValues: questions.indices.map { ($0, draft($0)) })
    }

    private var owed: Int { AskQuestionAnswer.owed(questions, drafts: allDrafts) }
    private var required: Int { questions.filter { !$0.isOptional }.count }

    /// The line of context under the title: the card's subtitle, unless it
    /// only repeats the first question (a checklist then shows its question).
    private var contextLine: String? {
        let subtitle = card?.subtitle.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let first = questions.first?.question.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !subtitle.isEmpty, subtitle != first { return subtitle }
        if checklist { return first.isEmpty ? nil : first }
        return subtitle.isEmpty ? nil : subtitle
    }

    var body: some View {
        Group {
            if let card, !questions.isEmpty {
                if settled { settledCard(card) } else { pendingCard(card) }
            }
        }
        .sheet(item: $pickerTarget) { target in
            FormPickerSheet(
                colors: colors, title: questions.indices.contains(target.row) ? questions[target.row].question : "",
                component: target.component, initial: target.initial,
                onDone: { date in
                    update(target.row) { $0.value = Self.formatter(target.format).string(from: date) }
                    pickerTarget = nil
                },
                onCancel: { pickerTarget = nil }
            )
            .presentationDetents([.medium, .large])
        }
    }

    private struct PickerTarget: Identifiable {
        let row: Int
        let component: DatePickerComponents
        let format: String
        let initial: Date
        var id: Int { row }
    }

    // MARK: pending

    private func pendingCard(_ card: OptionCard) -> some View {
        let meta: String? = checklist
            ? String(localized: "\(draft(0).picked.count) of \(questions[0].options.count) selected")
            : (questions.count > 1 ? String(localized: "\(required - owed) of \(required) answered") : nil)
        return QuestionSheet(
            colors: colors, title: card.title, meta: meta,
            onDismiss: WaitingCardSkip.waits(card) && !answering ? { skip() } : nil,
            dismissLabel: WaitingCardWords.skip, dismissId: "card-skip-\(message.id)"
        ) {
            if let contextLine {
                Text(contextLine)
                    .font(colors.font(13))
                    .foregroundStyle(colors.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .textSelection(.enabled)
            }
            if checklist { checklistBody } else { formBody }
        }
        .accessibilityIdentifier("question-card-\(message.id)")
        #if DEBUG
        .onAppear { seedPreviewDrafts() }
        #endif
    }

    #if DEBUG
    /// `-form-cards-fill`: the capture of a form half filled in (every row but
    /// the last answered), so a screenshot shows each control with a value.
    private func seedPreviewDrafts() {
        guard ProcessInfo.processInfo.arguments.contains("-form-cards-fill"), drafts.isEmpty, !checklist else { return }
        for (index, question) in questions.enumerated().dropLast() {
            switch question.kind ?? .text {
            case .choice, .yesNo: drafts[index] = FormDraft(picked: question.options.first.map { [question.key($0)] } ?? [])
            case .multi: drafts[index] = FormDraft(picked: question.options.prefix(2).map(question.key))
            case .duration: drafts[index] = index == 1 ? FormDraft(hours: "1", minutes: "30") : FormDraft()
            case .time: drafts[index] = FormDraft(value: "09:30")
            case .date: drafts[index] = FormDraft(value: "2026-11-17")
            case .number: drafts[index] = FormDraft(value: "3")
            case .text, .longText: drafts[index] = FormDraft(value: "4512")
            }
        }
    }
    #endif

    private var formBody: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(question.question)
                            .font(colors.font(13.5, .medium))
                            .foregroundStyle(colors.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if question.isOptional {
                            Text("Optional")
                                .font(colors.font(11.5))
                                .foregroundStyle(colors.inkSecondary)
                        }
                    }
                    control(index, question)
                }
                .padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(alignment: .top) {
                    if index > 0 { Rectangle().fill(colors.ink.opacity(0.06)).frame(height: 1) }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(question.question)
            }
            QuestionSheetButtons(
                colors: colors, actions: [String(localized: "Submit")], enabled: owed == 0 && !answering,
                onPress: { _ in submitForm() }
            )
            .padding(.top, 4)
        }
    }

    private var checklistBody: some View {
        let only = questions[0]
        let picked = Set(draft(0).picked)
        return VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(Array(only.options.enumerated()), id: \.offset) { position, option in
                    let key = only.key(option)
                    QuestionSheetRow(
                        colors: colors, index: position, label: option.label, detail: option.detail,
                        multi: true, on: picked.contains(key), quiet: true, minHeight: 44, disabled: answering
                    ) {
                        update(0) { value in
                            if value.picked.contains(key) { value.picked.removeAll { $0 == key } } else { value.picked.append(key) }
                        }
                    }
                }
            }
            QuestionSheetButtons(
                colors: colors, actions: only.actions ?? [], enabled: !answering,
                onPress: { sendChecklist($0) }
            )
        }
    }

    // MARK: controls

    @ViewBuilder
    private func control(_ index: Int, _ question: AskQuestion) -> some View {
        switch question.kind ?? .text {
        case .choice, .yesNo:
            pills(index, question, multi: false)
        case .multi:
            pills(index, question, multi: true)
        case .duration:
            FormPillsLayout(spacing: 8, lineSpacing: 0) {
                numberField(index, \.hours, sub: 0, width: 64, label: String(localized: "Hours for \(question.question)"), keyboard: .numberPad, inlineDone: false)
                Text("question.form.hours").font(colors.font(13)).foregroundStyle(ink2).frame(minHeight: 44)
                numberField(index, \.minutes, sub: 1, width: 64, label: String(localized: "Minutes for \(question.question)"), keyboard: .numberPad, inlineDone: false)
                Text("question.form.minutes").font(colors.font(13)).foregroundStyle(ink2).frame(minHeight: 44)
                if focus == index * 10 || focus == index * 10 + 1 {
                    Button { dismissKeyboard() } label: {
                        Text("Done").font(colors.font(13, .medium)).foregroundStyle(colors.ink).padding(.horizontal, 8).frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("form-keyboard-done")
                }
            }
        case .time:
            pickerRow(index, question, component: .hourAndMinute, format: "HH:mm", prompt: String(localized: "Choose a time"))
        case .date:
            pickerRow(index, question, component: .date, format: "yyyy-MM-dd", prompt: String(localized: "Choose a date"))
        case .number:
            numberField(index, \.value, sub: 0, width: 128, label: question.question, keyboard: .decimalPad, decimal: true, grows: true)
        case .text, .longText:
            FormFieldBox(colors: colors, focused: focus == index * 10, onTap: { focus = index * 10 }, onDone: { dismissKeyboard() }) {
                TextField("Type your answer", text: binding(index, \.value), axis: .vertical)
                    .font(colors.font(13.5))
                    .foregroundStyle(colors.ink)
                    .lineLimit(1...(question.kind == .longText ? 8 : 4))
                    .textFieldStyle(.plain)
                    .focused($focus, equals: index * 10)
                    .disabled(answering)
                    .accessibilityLabel(question.question)
            }
        }
    }

    private func dismissKeyboard() {
        focus = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    private func binding(_ index: Int, _ path: WritableKeyPath<FormDraft, String>, decimal: Bool = false) -> Binding<String> {
        Binding(
            get: { draft(index)[keyPath: path] },
            set: { raw in
                var text = String(raw.prefix(2000))
                // a decimal comma is a dot in the answer
                if decimal { text = text.replacingOccurrences(of: ",", with: ".") }
                update(index) { $0[keyPath: path] = text }
            }
        )
    }

    private func numberField(
        _ index: Int, _ path: WritableKeyPath<FormDraft, String>, sub: Int, width: CGFloat, label: String,
        keyboard: UIKeyboardType, decimal: Bool = false, grows: Bool = false, inlineDone: Bool = true
    ) -> some View {
        let id = index * 10 + sub
        let box = FormFieldBox(colors: colors, focused: inlineDone && focus == id, onTap: { focus = id }, onDone: { dismissKeyboard() }) {
            TextField("", text: binding(index, path, decimal: decimal))
                .font(colors.font(13.5).monospacedDigit())
                .foregroundStyle(colors.ink)
                .keyboardType(keyboard)
                .textFieldStyle(.plain)
                .focused($focus, equals: id)
                .disabled(answering)
                .accessibilityLabel(label)
        }
        // the layout (duration) needs a width; a lone number field takes up to one
        return Group {
            if grows { box.frame(maxWidth: width * scale, alignment: .leading) } else { box.frame(width: width * scale) }
        }
    }

    /// A date or time row: a pill that says what is picked (or asks for it),
    /// opening the native picker in a sheet. The row is answered only when
    /// the person presses Done there. No UIKit picker sits in the chat row
    /// (a compact `DatePicker` in a very tall row left the whole chat blank,
    /// and it cannot wrap at the largest text sizes).
    private func pickerRow(_ index: Int, _ question: AskQuestion, component: DatePickerComponents, format: String, prompt: String) -> some View {
        let formatter = Self.formatter(format)
        let answered = formatter.date(from: draft(index).value)
        let shown = answered.map { component == .date
            ? $0.formatted(date: .abbreviated, time: .omitted) : $0.formatted(date: .omitted, time: .shortened) }
        return FormPillsLayout(spacing: 8, lineSpacing: 0) {
            Button {
                Haptics.selection()
                pickerTarget = PickerTarget(row: index, component: component, format: format, initial: answered ?? Date())
            } label: {
                Text(shown ?? prompt)
                    .font(colors.font(13.5))
                    .foregroundStyle(shown == nil ? ink2 : colors.ink)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .frame(minHeight: 34)
                    .background(colors.ink.opacity(shown == nil ? 0.04 : 0.08), in: Capsule())
                    .padding(.vertical, 5)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(answering)
            .accessibilityLabel(Text(verbatim: "\(question.question), \(shown ?? prompt.lowercasedFirst)"))
            if answered != nil {
                Button {
                    Haptics.selection()
                    update(index) { $0.value = "" }
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(colors.font(15))
                        .foregroundStyle(ink2)
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: "\(question.question), \(String(localized: "Clear"))"))
            }
        }
    }

    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = format
        return formatter
    }

    /// A choice row's answers as pills: one tap picks (several for multi).
    /// Drawn 34 pt tall, a 44 pt target; a long answer wraps inside the card.
    private func pills(_ index: Int, _ question: AskQuestion, multi: Bool) -> some View {
        let picked = draft(index).picked
        return FormPillsLayout(spacing: 6, lineSpacing: 0) {
            ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                let key = question.key(option)
                let on = picked.contains(key)
                Button {
                    Haptics.selection()
                    update(index) { value in
                        if multi {
                            if value.picked.contains(key) { value.picked.removeAll { $0 == key } } else { value.picked.append(key) }
                        } else {
                            value.picked = on ? [] : [key]
                        }
                    }
                } label: {
                    HStack(spacing: 5) {
                        if on {
                            Image(systemName: "checkmark")
                                .font(.system(size: 11 * scale, weight: .bold))
                                .foregroundStyle(.green)
                        }
                        Text(optionLabel(question, option))
                            .font(colors.font(13.5))
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 7)
                    .frame(minHeight: 34)
                    .foregroundStyle(on ? colors.ink : ink2)
                    .background(colors.ink.opacity(on ? 0.08 : 0.04), in: Capsule())
                    .padding(.vertical, 5)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(answering)
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
    }

    /// A yes / no row speaks the person's language and sends the id.
    private func optionLabel(_ question: AskQuestion, _ option: AskQuestionOption) -> String {
        if question.kind == .yesNo {
            if option.id == "yes" { return String(localized: "Yes") }
            if option.id == "no" { return String(localized: "No") }
        }
        return option.label
    }

    // MARK: send

    private func submitForm() {
        guard !settled, !answering, let answer = AskQuestionAnswer.formAnswer(questions, drafts: allDrafts) else { return }
        deliver(answer)
    }

    private func sendChecklist(_ action: String) {
        guard !settled, !answering else { return }
        deliver(AskQuestionAnswer.checklistAnswer(questions, picked: draft(0).picked, action: action))
    }

    private func deliver(_ answer: String) {
        guard let requestId = card?.requestId, !answer.isEmpty else { return }
        sent = answer
        answering = true
        focus = nil
        Task {
            await session.answer(threadId: chat.threadId, requestId: requestId, choice: answer, isPermission: false)
            answering = false
        }
    }

    private func skip() {
        guard !settled, !answering, let card else { return }
        answering = true
        focus = nil
        Task {
            await session.skipOptionCard(message, in: chat)
            answering = false
        }
    }

    // MARK: settled

    private func settledCard(_ card: OptionCard) -> some View {
        let answer = card.answeredText ?? sent
        let fold = WaitingCardSkip.fold(card)
        let closed = fold != nil || (answer == nil && card.answered != nil && card.answered != "answer")
        let readable = fold != nil ? nil : answer
        let byQuestion = readable.map { AskQuestionAnswer.byQuestion($0, questions: questions) } ?? [:]
        let pressed = readable.flatMap { AskQuestionAnswer.action(in: $0) }
        return QuestionSheet(colors: colors, title: card.title) {
            if let contextLine {
                Text(contextLine)
                    .font(colors.font(13))
                    .foregroundStyle(colors.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if checklist {
                let only = questions[0]
                let given = byQuestion[only.question] ?? ""
                let picked = AskQuestionAnswer.picks(
                    in: given == AskQuestionAnswer.nothingPicked ? "" : given, labels: only.options.map(only.key)
                ).picked
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(only.options.enumerated()), id: \.offset) { position, option in
                        QuestionSheetRow(
                            colors: colors, index: position, label: option.label, detail: option.detail,
                            multi: true, on: picked.contains(only.key(option)), settled: true, quiet: true
                        ) {}
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(questions.enumerated()), id: \.offset) { index, question in
                        let given = byQuestion[question.question]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                        let value = given == AskQuestionAnswer.leftEmpty ? "" : given
                        let label = Text(question.question)
                            .font(colors.font(13))
                            .foregroundStyle(ink2)
                        let answerText = Text(value.isEmpty ? String(localized: "Not answered") : shown(question, value))
                            .font(colors.font(13, .medium))
                            .foregroundStyle(value.isEmpty ? ink2 : colors.ink)
                        // at a large text size the answer goes under its question
                        Group {
                            if scale > 1.4 {
                                VStack(alignment: .leading, spacing: 2) {
                                    label.frame(maxWidth: .infinity, alignment: .leading)
                                    answerText.frame(maxWidth: .infinity, alignment: .leading)
                                }
                            } else {
                                HStack(alignment: .firstTextBaseline, spacing: 12) {
                                    label.frame(maxWidth: .infinity, alignment: .leading)
                                    answerText.multilineTextAlignment(.trailing).frame(maxWidth: 180, alignment: .trailing)
                                }
                            }
                        }
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                        .padding(.vertical, 6)
                        .overlay(alignment: .top) {
                            if index > 0 { Rectangle().fill(colors.ink.opacity(0.06)).frame(height: 1) }
                        }
                    }
                }
            }
            if let pressed {
                QuestionSheetNote(colors: colors, text: String(localized: "Chosen: \(pressed)"))
            }
            if closed {
                QuestionSheetNote(colors: colors, text: fold.map(WaitingCardWords.fold) ?? String(localized: "Closed without an answer"), closed: true)
            } else if answer == nil {
                QuestionSheetNote(colors: colors, text: String(localized: "Answered"))
            }
        }
        .accessibilityIdentifier("question-card-\(message.id)")
    }

    /// A settled row's answer as the person reads it.
    private func shown(_ question: AskQuestion, _ value: String) -> String {
        if question.kind == .duration, let parts = AskQuestionAnswer.durationParts(value) {
            if parts.hours == 0 { return String(localized: "\(parts.minutes) min") }
            return parts.minutes == 0
                ? String(localized: "\(parts.hours) h")
                : String(localized: "\(parts.hours) h \(parts.minutes) min")
        }
        guard question.kind?.isChoice == true else { return value }
        let split = AskQuestionAnswer.picks(in: value, labels: question.options.map(question.key))
        let labels = split.picked.compactMap { key in
            question.options.first { question.key($0) == key }.map { optionLabel(question, $0) }
        }
        return (labels + (split.rest.isEmpty ? [] : [split.rest])).joined(separator: ", ")
    }
}

/// The plain field chrome of the sheet (`QuestionSheetField`'s fill and
/// hairline), a 44 pt target that takes the keyboard wherever it is pressed,
/// with its own Done while it holds the keyboard.
private struct FormFieldBox<Content: View>: View {
    let colors: QuestionSheetColors
    let focused: Bool
    let onTap: () -> Void
    let onDone: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        HStack(spacing: 8) {
            content()
            if focused {
                Button(action: onDone) {
                    Text("Done")
                        .font(colors.font(13, .medium))
                        .foregroundStyle(colors.ink)
                        .padding(.horizontal, 6)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("form-keyboard-done")
            }
        }
        .padding(.leading, 12)
        .padding(.trailing, focused ? 4 : 12)
        .frame(minHeight: 44)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(colors.ink.opacity(0.04), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(colors.ink.opacity(0.12), lineWidth: 1))
        .contentShape(Rectangle())
        .onTapGesture(perform: onTap)
    }
}

private extension String {
    /// "Choose a time" read after the question: "Start, choose a time".
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}

/// Pills that wrap onto the next line, each line starting at the left. An
/// item wider than the card is measured at the card's width, so it wraps.
private struct FormPillsLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let placed = place(width: proposal.width ?? .infinity, subviews: subviews)
        return CGSize(width: min(proposal.width ?? placed.width, placed.width), height: placed.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let placed = place(width: bounds.width, subviews: subviews)
        for (index, origin) in placed.origins.enumerated() {
            subviews[index].place(at: CGPoint(x: bounds.minX + origin.x, y: bounds.minY + origin.y), proposal: ProposedViewSize(placed.sizes[index]))
        }
    }

    private func place(width: CGFloat, subviews: Subviews) -> (origins: [CGPoint], sizes: [CGSize], width: CGFloat, height: CGFloat) {
        var origins: [CGPoint] = []
        var sizes: [CGSize] = []
        var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > width { size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil)) }
            size.width = min(size.width, width)
            if x > 0, x + size.width > width + 0.5 {
                x = 0
                y += rowHeight + lineSpacing
                rowHeight = 0
            }
            origins.append(CGPoint(x: x, y: y))
            sizes.append(size)
            x += size.width + spacing
            rowHeight = max(rowHeight, size.height)
            widest = max(widest, x - spacing)
        }
        return (origins, sizes, widest, y + rowHeight)
    }
}

/// The native date or time picker, in a sheet: the card's row is answered
/// when Done is pressed, never by opening the picker.
private struct FormPickerSheet: View {
    let colors: QuestionSheetColors
    let title: String
    let component: DatePickerComponents
    let onDone: (Date) -> Void
    let onCancel: () -> Void
    @State private var date: Date

    init(colors: QuestionSheetColors, title: String, component: DatePickerComponents, initial: Date,
         onDone: @escaping (Date) -> Void, onCancel: @escaping () -> Void) {
        self.colors = colors
        self.title = title
        self.component = component
        self.onDone = onDone
        self.onCancel = onCancel
        _date = State(initialValue: initial)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(colors.font(14, .semibold))
                    .foregroundStyle(colors.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Group {
                    if component == .date {
                        DatePicker("", selection: $date, displayedComponents: component).datePickerStyle(.graphical)
                    } else {
                        DatePicker("", selection: $date, displayedComponents: component).datePickerStyle(.wheel)
                    }
                }
                .labelsHidden()
                .accessibilityLabel(Text(verbatim: title))
                HStack {
                    Button("Cancel", action: onCancel)
                        .font(colors.font(13.5, .medium))
                        .foregroundStyle(colors.ink)
                        .frame(minWidth: 44, minHeight: 44)
                        .accessibilityIdentifier("form-picker-cancel")
                    Spacer()
                    Button { onDone(date) } label: {
                        Text("Done")
                            .font(colors.font(13.5, .medium))
                            .foregroundStyle(colors.fill)
                            .padding(.horizontal, 20)
                            .frame(minHeight: 44)
                            .background(Capsule().fill(colors.ink))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("form-picker-done")
                }
            }
            .padding(20)
        }
        .background(colors.fill.ignoresSafeArea())
    }
}

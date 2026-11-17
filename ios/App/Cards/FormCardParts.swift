import CompanionCore
import SwiftUI
import UIKit

// MARK: - State outside the views

/// What a person has entered in one pending form or checklist: the drafts of
/// every row, the picks and ticks, the sent answer and which field holds the
/// keyboard. It lives in `FormCardStore`, above the transcript, so a rebuilt
/// row (a text size change, rotation, a row scrolled off screen and back, a
/// new message) never loses a typed note, a pick or the focus (#4490).
@MainActor
final class FormCardState: ObservableObject {
    let questions: [AskQuestion]
    var checklist: Bool { questions.count == 1 && questions[0].isChecklist }
    @Published var drafts: [Int: FormDraft] = [:]
    @Published var answering = false
    /// The harness settles the card after a round trip; holding the sent
    /// answer closes the window where the controls are still live.
    @Published var sent: String?
    /// The field with the keyboard: row * 10 + 0 (the field) or + 1 (a duration's minutes).
    @Published var focus: Int?

    init(questions: [AskQuestion]) { self.questions = questions }

    func draft(_ index: Int) -> FormDraft {
        if let value = drafts[index] { return value }
        // a checklist starts as the bot proposed it
        if checklist, index == 0 { return FormDraft(picked: questions[0].checked ?? []) }
        return FormDraft()
    }

    func update(_ index: Int, _ change: (inout FormDraft) -> Void) {
        var next = draft(index)
        change(&next)
        drafts[index] = next
    }

    var allDrafts: [Int: FormDraft] { Dictionary(uniqueKeysWithValues: questions.indices.map { ($0, draft($0)) }) }
    var owed: Int { AskQuestionAnswer.owed(questions, drafts: allDrafts) }
    var required: Int { questions.filter { !$0.isOptional }.count }
}

@MainActor
final class FormCardStore: ObservableObject {
    static let shared = FormCardStore()
    private var states: [String: FormCardState] = [:]
    /// Bumped when a card is answered, so the transcript redraws it settled.
    @Published private(set) var sentRevision = 0

    /// A person is typing in a form: the transcript does not follow a new
    /// message to the end and pull the field out from under them.
    var isEditing: Bool { states.values.contains { $0.focus != nil } }

    func state(chat: Chat, message: Message) -> FormCardState {
        let key = "\(chat.threadId)/\(message.id)"
        if let state = states[key] { return state }
        let state = FormCardState(questions: message.card?.questions ?? [])
        #if DEBUG
        Self.seedPreview(state)
        #endif
        states[key] = state
        return state
    }

    func answered() { sentRevision += 1 }

    #if DEBUG
    /// `-form-cards-fill`: a form half filled in (every row but the last
    /// answered), so a capture shows each control with a value.
    private static func seedPreview(_ state: FormCardState) {
        guard ProcessInfo.processInfo.arguments.contains("-form-cards-fill"), !state.checklist else { return }
        for (index, question) in state.questions.enumerated().dropLast() {
            switch question.kind ?? .text {
            case .choice, .yesNo: state.drafts[index] = FormDraft(picked: question.options.first.map { [question.key($0)] } ?? [])
            case .multi: state.drafts[index] = FormDraft(picked: question.options.prefix(2).map(question.key))
            case .duration: state.drafts[index] = index == 1 ? FormDraft(hours: "1", minutes: "30") : FormDraft()
            case .time: state.drafts[index] = FormDraft(value: "09:30")
            case .date: state.drafts[index] = FormDraft(value: "2026-11-17")
            case .number: state.drafts[index] = FormDraft(value: "3")
            case .text, .longText: state.drafts[index] = FormDraft(value: "4512")
            }
        }
    }
    #endif
}

func formOptionLabel(_ question: AskQuestion, _ option: AskQuestionOption) -> String {
    if question.kind == .yesNo {
        if option.id == "yes" { return String(localized: "Yes") }
        if option.id == "no" { return String(localized: "No") }
    }
    return option.label
}

/// The sheet's colours and type scale as a form draws them (secondary ink 70 %).
func formColors(desktop: DesktopTheme?, scale: CGFloat) -> QuestionSheetColors {
    QuestionSheetColors(desktop: desktop, scale: scale, secondaryOpacity: 0.7)
}

// MARK: - One row's content

/// A form row: its label and the control of its kind. Drafts, picks and the
/// focus are read from and written to `FormCardState`, never kept here.
struct FormRowContent: View {
    @Environment(\.desktopChatText) private var desktop
    @ObservedObject var state: FormCardState
    let index: Int
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1
    @FocusState private var field: Int?
    /// The date or time row whose picker sheet is open.
    @State private var pickerTarget: PickerTarget?

    private var question: AskQuestion { state.questions[index] }
    private var colors: QuestionSheetColors { formColors(desktop: desktop, scale: scale) }
    private var ink2: Color { colors.inkSecondary }

    struct PickerTarget: Identifiable {
        let row: Int
        let component: DatePickerComponents
        let format: String
        let initial: Date
        var id: Int { row }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // the "Optional" tag sits beside the question when both fit on a
            // line, under it otherwise; a word is never cut to make room
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) { questionLabel(question); optionalTag(question) }
                VStack(alignment: .leading, spacing: 2) { questionLabel(question); optionalTag(question) }
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
        .onChange(of: field) { new in
            if let new { state.focus = new } else if state.focus.map({ $0 / 10 }) == index { state.focus = nil }
        }
        .onAppear {
            // a rebuilt row takes the keyboard back where it was
            if let held = state.focus, held / 10 == index { DispatchQueue.main.async { field = held } }
            #if DEBUG
            openPreviewPicker()
            #endif
        }
        .sheet(item: $pickerTarget) { target in
            FormPickerSheet(
                colors: colors, title: question.question,
                component: target.component, initial: target.initial,
                onDone: { date in
                    state.update(target.row) { $0.value = FormRowContent.formatter(target.format).string(from: date) }
                    pickerTarget = nil
                },
                onCancel: { pickerTarget = nil }
            )
            .presentationDetents([.medium, .large])
        }
    }

    #if DEBUG
    /// `-form-cards-open-picker <row>`: the picker sheet of a date or time row, for a capture.
    private func openPreviewPicker() {
        let args = ProcessInfo.processInfo.arguments
        if let at = args.firstIndex(of: "-form-cards-open-picker"), args.indices.contains(at + 1),
           Int(args[at + 1]) == index, pickerTarget == nil {
            let date = question.kind == .date
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
                pickerTarget = PickerTarget(row: index, component: date ? .date : .hourAndMinute,
                                            format: date ? "yyyy-MM-dd" : "HH:mm", initial: Date())
            }
        }
    }
    #endif

    private func dismissKeyboard() {
        field = nil
        state.focus = nil
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    }

    static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = format
        return formatter
    }

    private func questionLabel(_ question: AskQuestion) -> some View {
        Text(question.question)
            .font(colors.font(13.5, .medium))
            .foregroundStyle(colors.ink)
            .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private func optionalTag(_ question: AskQuestion) -> some View {
        if question.isOptional {
            Text("Optional")
                .font(colors.font(11.5))
                .foregroundStyle(colors.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
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
                if field == index * 10 || field == index * 10 + 1 {
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
            FormFieldBox(colors: colors, focused: field == index * 10, onTap: { field = index * 10 }, onDone: { dismissKeyboard() }) {
                // the placeholder is in the layout, so a long one wraps and the box grows
                ZStack(alignment: .topLeading) {
                    if state.draft(index).value.isEmpty {
                        Text("Type your answer")
                            .font(colors.font(13.5))
                            .foregroundStyle(ink2)
                            .fixedSize(horizontal: false, vertical: true)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                    TextField("", text: binding(index, \.value), axis: .vertical)
                        .font(colors.font(13.5))
                        .foregroundStyle(colors.ink)
                        .lineLimit(1...(question.kind == .longText ? 8 : 4))
                        .textFieldStyle(.plain)
                        .focused($field, equals: index * 10)
                        .disabled(state.answering)
                        .accessibilityLabel(question.question)
                }
            }
        }
    }

    private func binding(_ index: Int, _ path: WritableKeyPath<FormDraft, String>, decimal: Bool = false) -> Binding<String> {
        Binding(
            get: { state.draft(index)[keyPath: path] },
            set: { raw in
                var text = String(raw.prefix(2000))
                // a decimal comma is a dot in the answer
                if decimal { text = text.replacingOccurrences(of: ",", with: ".") }
                state.update(index) { $0[keyPath: path] = text }
            }
        )
    }

    private func numberField(
        _ index: Int, _ path: WritableKeyPath<FormDraft, String>, sub: Int, width: CGFloat, label: String,
        keyboard: UIKeyboardType, decimal: Bool = false, grows: Bool = false, inlineDone: Bool = true
    ) -> some View {
        let id = index * 10 + sub
        let box = FormFieldBox(colors: colors, focused: inlineDone && field == id, onTap: { field = id }, onDone: { dismissKeyboard() }) {
            TextField("", text: binding(index, path, decimal: decimal))
                .font(colors.font(13.5).monospacedDigit())
                .foregroundStyle(colors.ink)
                .keyboardType(keyboard)
                .textFieldStyle(.plain)
                .focused($field, equals: id)
                .disabled(state.answering)
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
        let formatter = FormRowContent.formatter(format)
        let answered = formatter.date(from: state.draft(index).value)
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
            .disabled(state.answering)
            .accessibilityLabel(Text(verbatim: "\(question.question), \(shown ?? prompt.lowercasedFirst)"))
            if answered != nil {
                Button {
                    Haptics.selection()
                    state.update(index) { $0.value = "" }
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

    /// A choice row's answers as pills: one tap picks (several for multi).
    /// Drawn 34 pt tall, a 44 pt target; a long answer wraps inside the card.
    private func pills(_ index: Int, _ question: AskQuestion, multi: Bool) -> some View {
        let picked = state.draft(index).picked
        return FormPillsLayout(spacing: 6, lineSpacing: 0) {
            ForEach(Array(question.options.enumerated()), id: \.offset) { _, option in
                let key = question.key(option)
                let on = picked.contains(key)
                Button {
                    Haptics.selection()
                    state.update(index) { value in
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
                .disabled(state.answering)
                .accessibilityAddTraits(on ? [.isSelected] : [])
            }
        }
    }

    /// A yes / no row speaks the person's language and sends the id.
    private func optionLabel(_ question: AskQuestion, _ option: AskQuestionOption) -> String { formOptionLabel(question, option) }
}

/// The plain field chrome of the sheet (`QuestionSheetField`'s fill and
/// hairline), a 44 pt target that takes the keyboard wherever it is pressed,
/// with its own Done while it holds the keyboard.
struct FormFieldBox<Content: View>: View {
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

extension String {
    /// "Choose a time" read after the question: "Start, choose a time".
    var lowercasedFirst: String { prefix(1).lowercased() + dropFirst() }
}

/// Pills that wrap onto the next line, each line starting at the left. An
/// item wider than the card is measured at the card's width, so it wraps.
struct FormPillsLayout: Layout {
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
struct FormPickerSheet: View {
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

// MARK: - The card in pieces

/// A pending form or checklist drawn as separate transcript rows, so no row
/// of the lazy stack is far taller than the screen (#4490): the head (title,
/// progress, context), a row per question or per checklist item, and the
/// action row. Each piece is a `FormSegment`: together they read as one card.
enum FormCardPieces {
    /// The line of context under the title: the card's subtitle, unless it
    /// only repeats the first question (a checklist then shows its question).
    static func contextLine(_ message: Message) -> String? {
        let questions = message.card?.questions ?? []
        let checklist = questions.count == 1 && questions[0].isChecklist
        let subtitle = message.card?.subtitle.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let first = questions.first?.question.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !subtitle.isEmpty, subtitle != first { return subtitle }
        if checklist { return first.isEmpty ? nil : first }
        return subtitle.isEmpty ? nil : subtitle
    }

    @MainActor
    static func isSettled(_ message: Message, state: FormCardState) -> Bool {
        guard let card = message.card else { return true }
        let sent = state.sent != nil
        return card.answered != nil || sent || WaitingCardSkip.fold(card) != nil
    }

    /// The ids of the transcript's messages drawn as pieces.
    @MainActor
    static func splitIds(transcript rows: [TranscriptRow], chat: Chat) -> Set<String> {
        var ids = Set<String>()
        for row in rows {
            if case let .message(message) = row, splits(message, chat: chat) { ids.insert(message.id) }
        }
        return ids
    }

    /// Whether the transcript draws this message as pieces.
    @MainActor
    static func splits(_ message: Message, chat: Chat) -> Bool {
        guard message.kind == .options, let card = message.card, card.pageTargetChoice == nil, isFormCard(card.questions) else { return false }
        return !isSettled(message, state: FormCardStore.shared.state(chat: chat, message: message))
    }
}

/// The first row of a pending form in the transcript: head and context.
struct FormSplitHead: View {
    let chat: Chat
    let message: Message

    var body: some View {
        FormSegment(first: true, last: false) {
            FormHeadContent(chat: chat, message: message, state: FormCardStore.shared.state(chat: chat, message: message))
        }
    }
}

extension FormCardPieces {
    /// The rest of a pending form, each piece a transcript row of its own:
    /// a row per question or checklist item, then the action row. A function
    /// returning a group, so the lazy stack takes every piece as a child.
    @MainActor @ViewBuilder
    static func rest(after row: TranscriptRow, chat: Chat) -> some View {
        if case let .message(message) = row, splits(message, chat: chat) {
            pieces(chat: chat, message: message)
        }
    }

    @MainActor @ViewBuilder
    static func pieces(chat: Chat, message: Message) -> some View {
        let state = FormCardStore.shared.state(chat: chat, message: message)
        if state.checklist {
            ForEach(Array(state.questions[0].options.indices), id: \.self) { position in
                FormSegment(first: false, last: false) { FormChecklistItem(state: state, index: position) }
            }
        } else {
            ForEach(Array(state.questions.indices), id: \.self) { position in
                FormSegment(first: false, last: false) { FormRowContent(state: state, index: position) }
            }
        }
        FormSegment(first: false, last: true) { FormFooterContent(chat: chat, message: message, state: state) }
    }
}

struct FormSegmentShape: Shape {
    var top: Bool
    var bottom: Bool

    func path(in rect: CGRect) -> Path {
        var corners: UIRectCorner = []
        if top { corners.formUnion([.topLeft, .topRight]) }
        if bottom { corners.formUnion([.bottomLeft, .bottomRight]) }
        return Path(UIBezierPath(roundedRect: rect, byRoundingCorners: corners, cornerRadii: CGSize(width: 16, height: 16)).cgPath)
    }
}

/// One piece of the card: the sheet's fill and corners on the first and last,
/// the same padding, no gap to the next (the fill runs 1 pt under a piece).
struct FormSegment<Content: View>: View {
    @Environment(\.desktopChatText) private var desktop
    let first: Bool
    let last: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        let colors = QuestionSheetColors(desktop: desktop)
        content()
            .padding(.horizontal, 16)
            .padding(.top, first ? 16 : 0)
            .padding(.bottom, last ? 16 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(FormSegmentShape(top: first, bottom: last).fill(colors.fill).padding(.bottom, last ? 0 : -1))
            .frame(maxWidth: colors.desktop == nil ? .infinity : 560, alignment: .leading)
    }
}

/// The card's head: title, progress, the skip ×, and the line of context.
struct FormHeadContent: View {
    @Environment(\.desktopChatText) private var desktop
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message
    @ObservedObject var state: FormCardState
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    private var colors: QuestionSheetColors { formColors(desktop: desktop, scale: scale) }

    var body: some View {
        if let card = message.card {
            let questions = state.questions
            let meta: String? = state.checklist
                ? String(localized: "\(state.draft(0).picked.count) of \(questions[0].options.count) selected")
                : (questions.count > 1 ? String(localized: "\(state.required - state.owed) of \(state.required) answered") : nil)
            VStack(alignment: .leading, spacing: 10) {
                QuestionSheetHeader(
                    colors: colors, title: card.title, meta: meta,
                    onDismiss: WaitingCardSkip.waits(card) && !state.answering ? { skip() } : nil,
                    dismissLabel: WaitingCardWords.skip, dismissId: "card-skip-\(message.id)"
                )
                if let context = FormCardPieces.contextLine(message) {
                    Text(context)
                        .font(colors.font(13))
                        .foregroundStyle(colors.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
            .padding(.bottom, 10)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("question-card-\(message.id)")
        }
    }

    private func skip() {
        guard !state.answering else { return }
        state.answering = true
        state.focus = nil
        Task {
            await session.skipOptionCard(message, in: chat)
            state.answering = false
        }
    }
}

/// One checklist item: its box and text.
struct FormChecklistItem: View {
    @Environment(\.desktopChatText) private var desktop
    @ObservedObject var state: FormCardState
    let index: Int
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let colors = formColors(desktop: desktop, scale: scale)
        let only = state.questions[0]
        let option = only.options[index]
        let key = only.key(option)
        QuestionSheetRow(
            colors: colors, index: index, label: option.label, detail: option.detail,
            multi: true, on: state.draft(0).picked.contains(key), quiet: true, minHeight: 44, disabled: state.answering
        ) {
            state.update(0) { value in
                if value.picked.contains(key) { value.picked.removeAll { $0 == key } } else { value.picked.append(key) }
            }
        }
        .accessibilityIdentifier("form-item-\(index)")
    }
}

/// The action row: Submit, or the bot's buttons (the main one last).
struct FormFooterContent: View {
    @Environment(\.desktopChatText) private var desktop
    @EnvironmentObject private var session: Session
    let chat: Chat
    let message: Message
    @ObservedObject var state: FormCardState
    @ScaledMetric(relativeTo: .body) private var scale: CGFloat = 1

    var body: some View {
        let colors = formColors(desktop: desktop, scale: scale)
        Group {
            if state.checklist {
                QuestionSheetButtons(
                    colors: colors, actions: state.questions[0].actions ?? [], enabled: !state.answering,
                    onPress: { deliver(AskQuestionAnswer.checklistAnswer(state.questions, picked: state.draft(0).picked, action: $0)) }
                )
            } else {
                QuestionSheetButtons(
                    colors: colors, actions: [String(localized: "Submit")], enabled: state.owed == 0 && !state.answering,
                    onPress: { _ in
                        if let answer = AskQuestionAnswer.formAnswer(state.questions, drafts: state.allDrafts) { deliver(answer) }
                    }
                )
            }
        }
        .padding(.top, 4)
    }

    private func deliver(_ answer: String) {
        guard !state.answering, state.sent == nil, let requestId = message.card?.requestId, !answer.isEmpty else { return }
        state.sent = answer
        state.answering = true
        state.focus = nil
        FormCardStore.shared.answered()
        Task {
            await session.answer(threadId: chat.threadId, requestId: requestId, choice: answer, isPermission: false)
            state.answering = false
        }
    }
}

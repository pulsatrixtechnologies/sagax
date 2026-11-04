// The markdown editor on iOS (desktop src/components/markdown/MarkdownEditor.tsx,
// docs/markdown-editor.md): every place a person writes markdown on the
// phone (the soul, rules, docs, memory, group instructions and memory,
// routine instructions, About me) uses it. The text stays plain markdown:
// what is saved is exactly what was typed, through the same binding the
// plain text box had.
//
// What it does, as the desktop: light formatting while typing (headings
// sized, bold, code and fences in monospace, quotes dimmed, a checked task
// struck through), Write and Preview (rendered by `MarkdownText`, the chat's
// renderer), the toolbar above the keyboard (bold, italic, heading, lists,
// checklist, quote, code, link, table, divider, nest and un-nest, Format),
// Return continues a list or a quote and ends it on an empty item, pairs for
// ( [ ` * _, paste of a link over a selection or of spreadsheet rows as a
// table, a tap on a task box toggles it, and the word and character counts.
// A hardware keyboard has the desktop's shortcuts. The edits are
// CompanionCore's `MarkdownEdits` (tested there).
import CompanionCore
import SwiftUI
import UIKit

struct MarkdownEditor: View {
    @Binding var text: String
    var placeholder: String = ""
    var minHeight: CGFloat = 200
    /// A cap in characters (About me); nil: none.
    var maxLength: Int? = nil
    var monospaced = false
    /// The field's own counter, left of the counts (SOUL.md bytes, rules).
    var footer: String? = nil
    var footerIsWarning = false
    var showsCount = true
    var accessibilityLabel: String
    var identifier: String = "markdown-editor"
    /// Called when the text view gives up focus (a field that saves on blur).
    var onEndEditing: (() -> Void)? = nil
    /// 2026-10-29 (routine instructions): writing straight away, Preview one
    /// tap away, few buttons above the keyboard, no counts.
    var compact = false
    /// Shows "Full screen" (compact): long text gets the whole screen.
    var onExpand: (() -> Void)? = nil

    @State private var preview = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if compact {
                compactBar
            } else {
                Picker(String(localized: "View"), selection: $preview) {
                    Text("Write").tag(false)
                    Text("Preview").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 240)
                .accessibilityIdentifier("\(identifier).view")
            }

            if preview {
                ScrollView {
                    if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                        Text("Nothing to preview yet.").foregroundStyle(Theme.textSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        MarkdownText(source: text)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .frame(minHeight: minHeight)
                .accessibilityLabel(Text("Markdown preview"))
                .accessibilityIdentifier("\(identifier).preview")
            } else {
                MarkdownTextView(
                    text: $text, placeholder: placeholder, maxLength: maxLength, monospaced: monospaced,
                    accessibilityLabel: accessibilityLabel, identifier: identifier, onEndEditing: onEndEditing,
                    fewButtons: compact
                )
                .frame(minHeight: minHeight)
            }

            if (showsCount && !compact) || footer != nil {
                HStack(spacing: 8) {
                    if let footer {
                        Text(verbatim: footer)
                            .foregroundStyle(footerIsWarning ? Color.red : Theme.textSecondary)
                    }
                    Spacer(minLength: 0)
                    if showsCount { Text(verbatim: counts).foregroundStyle(atCap ? Color.red : Theme.textSecondary) }
                }
                .font(.caption)
                .monospacedDigit()
            }
        }
    }

    /// Compact: Preview (or Write) and Full screen, small, on one line.
    private var compactBar: some View {
        HStack(spacing: 14) {
            Spacer(minLength: 0)
            Button {
                preview.toggle()
            } label: {
                Label(preview ? String(localized: "Write") : String(localized: "Preview"), systemImage: preview ? "pencil" : "eye")
            }
            .accessibilityIdentifier("\(identifier).view")
            if let onExpand {
                Button(action: onExpand) {
                    Label(String(localized: "Full screen"), systemImage: "arrow.up.left.and.arrow.down.right")
                }
                .accessibilityIdentifier("\(identifier).full-screen")
            }
        }
        .buttonStyle(.borderless)
        .font(.footnote.weight(.medium))
        .labelStyle(.titleAndIcon)
        .foregroundStyle(Theme.accentText)
    }

    private var atCap: Bool { maxLength.map { text.count >= $0 } ?? false }

    /// "12 words · 80 characters", and " · 80 / 4,000" with a cap.
    private var counts: String {
        let words = MarkdownEdits.countWords(text)
        let characters = MarkdownEdits.countCharacters(text)
        var out = String(localized: "\(words) words · \(characters) characters")
        if let maxLength { out += " · \(characters.formatted()) / \(maxLength.formatted())" }
        return out
    }
}

// MARK: - The text view

struct MarkdownTextView: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var maxLength: Int?
    var monospaced: Bool
    var accessibilityLabel: String
    var identifier: String
    var onEndEditing: (() -> Void)?
    /// The keyboard bar with the everyday marks only.
    var fewButtons = false

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> MarkdownUITextView {
        let view = MarkdownUITextView()
        view.delegate = context.coordinator
        view.coordinator = context.coordinator
        view.backgroundColor = .clear
        view.isScrollEnabled = true
        view.autocorrectionType = .default
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.textContainerInset = UIEdgeInsets(top: 8, left: 4, bottom: 8, right: 4)
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityIdentifier = identifier
        view.inputAccessoryView = MarkdownToolbar(coordinator: context.coordinator, fewButtons: fewButtons)
        view.placeholder = placeholder
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        view.addGestureRecognizer(tap)
        context.coordinator.view = view
        view.text = text
        context.coordinator.restyle()
        return view
    }

    func updateUIView(_ view: MarkdownUITextView, context: Context) {
        context.coordinator.parent = self
        // `.disabled` reads only
        view.isEditable = context.environment.isEnabled
        if view.text != text {
            let selection = view.selectedRange
            view.text = text
            let length = (text as NSString).length
            view.selectedRange = NSRange(location: min(selection.location, length), length: 0)
            context.coordinator.restyle()
        }
        view.placeholder = placeholder
    }

    final class Coordinator: NSObject, UITextViewDelegate, UIGestureRecognizerDelegate {
        var parent: MarkdownTextView
        weak var view: MarkdownUITextView?

        init(_ parent: MarkdownTextView) { self.parent = parent }

        private var state: MarkdownEdits.TextSelection? {
            guard let view else { return nil }
            let range = view.selectedRange
            return MarkdownEdits.TextSelection(doc: view.text ?? "", from: range.location, to: range.location + range.length)
        }

        /// Replace only what changed, so undo and VoiceOver follow it.
        func apply(_ next: MarkdownEdits.TextSelection) {
            guard let view else { return }
            let before = view.text ?? ""
            let change = MarkdownEdits.minimalChange(before, next.doc)
            if let start = view.position(from: view.beginningOfDocument, offset: change.from),
               let end = view.position(from: view.beginningOfDocument, offset: change.to),
               let range = view.textRange(from: start, to: end) {
                view.replace(range, withText: change.insert)
            } else {
                view.text = next.doc
            }
            view.selectedRange = NSRange(location: next.from, length: max(0, next.to - next.from))
            commit()
        }

        func commit() {
            guard let view else { return }
            parent.text = view.text ?? ""
            view.setNeedsDisplay()
            restyle()
        }

        // MARK: Toolbar and shortcuts

        enum Action: CaseIterable {
            case bold, italic, heading, bullet, numbered, task, quote, code, link, table, rule, indent, outdent, format
        }

        func perform(_ action: Action) {
            guard let state else { return }
            let next: MarkdownEdits.TextSelection?
            switch action {
            case .bold: next = MarkdownEdits.toggleWrap(state, marker: "**", placeholder: String(localized: "bold text"))
            case .italic: next = MarkdownEdits.toggleWrap(state, marker: "_", placeholder: String(localized: "italic text"))
            case .heading: next = MarkdownEdits.cycleHeading(state)
            case .bullet: next = MarkdownEdits.toggleLinePrefix(state, kind: .bullet)
            case .numbered: next = MarkdownEdits.toggleLinePrefix(state, kind: .numbered)
            case .task: next = MarkdownEdits.toggleLinePrefix(state, kind: .task)
            case .quote: next = MarkdownEdits.toggleLinePrefix(state, kind: .quote)
            case .code:
                next = state.from == state.to && Self.lineIsBlank(state)
                    ? MarkdownEdits.insertCodeBlock(state)
                    : MarkdownEdits.toggleCode(state, placeholder: String(localized: "code"))
            case .link: next = MarkdownEdits.insertLink(state, textPlaceholder: String(localized: "link text"))
            case .table: next = MarkdownEdits.insertTable(state) { String(localized: "Column \($0)") }
            case .rule: next = MarkdownEdits.insertRule(state)
            case .indent: next = MarkdownEdits.indentList(state, direction: 1)
            case .outdent: next = MarkdownEdits.indentList(state, direction: -1)
            case .format:
                let formatted = MarkdownEdits.formatMarkdown(state.doc)
                let caret = min(state.from, (formatted as NSString).length)
                next = formatted == state.doc ? nil : MarkdownEdits.TextSelection(doc: formatted, caret: caret)
            }
            Haptics.selection()
            if let next { apply(next) }
        }

        func heading(_ level: Int) {
            guard let state else { return }
            apply(MarkdownEdits.setHeading(state, level: level))
        }

        /// Tab in a list nests; elsewhere it types a tab.
        func tab(_ direction: Int) {
            guard let state else { return }
            if let next = MarkdownEdits.indentList(state, direction: direction) { apply(next) }
            else if direction == 1 { view?.insertText("\t") }
        }

        private static func lineIsBlank(_ state: MarkdownEdits.TextSelection) -> Bool {
            let ns = state.doc as NSString
            let line = ns.lineRange(for: NSRange(location: min(state.from, ns.length), length: 0))
            return ns.substring(with: line).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }

        // MARK: Typing

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            guard textView.markedTextRange == nil, let state else { return true }
            let caretState = MarkdownEdits.TextSelection(doc: state.doc, from: range.location, to: range.location + range.length)
            if replacement == "\n", let next = MarkdownEdits.continueList(caretState) {
                apply(next)
                return false
            }
            if replacement.isEmpty, range.length == 1, state.from == state.to, state.from == range.location + 1,
               let next = MarkdownEdits.deletePair(MarkdownEdits.TextSelection(doc: state.doc, caret: state.from)) {
                apply(next)
                return false
            }
            if (replacement as NSString).length == 1, "([`*_)]".contains(replacement),
               let next = MarkdownEdits.autoPair(caretState, char: replacement) {
                apply(next)
                return false
            }
            if let max = parent.maxLength {
                let current = textView.text ?? ""
                let removed = (current as NSString).substring(with: range).count
                if current.count - removed + replacement.count > max { return false }
            }
            return true
        }

        func textViewDidChange(_ textView: UITextView) { commit() }

        func textViewDidEndEditing(_ textView: UITextView) { parent.onEndEditing?() }

        /// Pasted text: a URL over a selection becomes a link, spreadsheet
        /// rows a table. True when handled here.
        func paste(_ pasted: String) -> Bool {
            guard let state else { return false }
            let selected = (state.doc as NSString).substring(with: NSRange(location: state.from, length: state.to - state.from))
            let replacement = MarkdownEdits.linkFromPaste(selected: selected, pasted: pasted) ?? MarkdownEdits.tableFromTsv(pasted)
            guard let replacement else { return false }
            let ns = state.doc as NSString
            let doc = ns.replacingCharacters(in: NSRange(location: state.from, length: state.to - state.from), with: replacement)
            apply(MarkdownEdits.TextSelection(doc: doc, caret: state.from + (replacement as NSString).length))
            return true
        }

        // MARK: Task boxes

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let view, let position = view.closestPosition(to: gesture.location(in: view)) else { return }
            let offset = view.offset(from: view.beginningOfDocument, to: position)
            let doc = view.text ?? ""
            let ns = doc as NSString
            let line = ns.lineRange(for: NSRange(location: min(offset, ns.length), length: 0))
            let lineText = ns.substring(with: line)
            // only a tap on the box itself, "- [ ]"
            guard let box = lineText.range(of: #"^\s*[-*+]\s+\[[ xX]\]"#, options: .regularExpression) else { return }
            let boxEnd = line.location + (String(lineText[..<box.upperBound]) as NSString).length
            guard offset >= boxEnd - 4, offset <= boxEnd, let toggled = MarkdownEdits.toggleTask(doc, at: offset) else { return }
            let caret = view.selectedRange
            apply(MarkdownEdits.TextSelection(doc: toggled, from: caret.location, to: caret.location + caret.length))
        }

        func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

        // MARK: Light formatting

        func restyle() {
            guard let view, view.markedTextRange == nil else { return }
            MarkdownStyler.style(view.textStorage, monospaced: parent.monospaced)
            view.typingAttributes = MarkdownStyler.base(monospaced: parent.monospaced)
        }
    }
}

/// The text view: paste rules, the hardware keyboard's shortcuts and the
/// placeholder.
final class MarkdownUITextView: UITextView {
    weak var coordinator: MarkdownTextView.Coordinator?
    var placeholder = "" { didSet { setNeedsDisplay() } }

    override func paste(_ sender: Any?) {
        if let pasted = UIPasteboard.general.string, coordinator?.paste(pasted) == true { return }
        super.paste(sender)
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        guard (text ?? "").isEmpty, !placeholder.isEmpty else { return }
        let inset = textContainerInset
        let padding = textContainer.lineFragmentPadding
        (placeholder as NSString).draw(
            in: rect.inset(by: UIEdgeInsets(top: inset.top, left: inset.left + padding, bottom: inset.bottom, right: inset.right + padding)),
            withAttributes: [.font: font ?? UIFont.preferredFont(forTextStyle: .body), .foregroundColor: UIColor.placeholderText]
        )
    }

    override var keyCommands: [UIKeyCommand]? {
        func command(_ input: String, _ flags: UIKeyModifierFlags, _ title: String, _ action: Selector) -> UIKeyCommand {
            let key = UIKeyCommand(title: title, action: action, input: input, modifierFlags: flags)
            key.wantsPriorityOverSystemBehavior = true
            return key
        }
        return [
            command("b", .command, String(localized: "Bold"), #selector(kBold)),
            command("i", .command, String(localized: "Italic"), #selector(kItalic)),
            command("k", .command, String(localized: "markdownEditor.link"), #selector(kLink)),
            command("e", .command, String(localized: "Code"), #selector(kCode)),
            command("1", [.command, .alternate], String(localized: "Heading 1"), #selector(kH1)),
            command("2", [.command, .alternate], String(localized: "Heading 2"), #selector(kH2)),
            command("3", [.command, .alternate], String(localized: "Heading 3"), #selector(kH3)),
            command("7", [.command, .shift], String(localized: "Numbered list"), #selector(kNumbered)),
            command("8", [.command, .shift], String(localized: "Bulleted list"), #selector(kBullet)),
            command("9", [.command, .shift], String(localized: "Checklist"), #selector(kTask)),
            command(".", [.command, .shift], String(localized: "Quote"), #selector(kQuote)),
            command("f", [.shift, .alternate], String(localized: "Tidy up the formatting"), #selector(kFormat)),
            command("\t", [], String(localized: "Nest list item"), #selector(kTab)),
            command("\t", .shift, String(localized: "Move list item out"), #selector(kShiftTab)),
        ]
    }

    @objc private func kBold() { coordinator?.perform(.bold) }
    @objc private func kItalic() { coordinator?.perform(.italic) }
    @objc private func kLink() { coordinator?.perform(.link) }
    @objc private func kCode() { coordinator?.perform(.code) }
    @objc private func kH1() { coordinator?.heading(1) }
    @objc private func kH2() { coordinator?.heading(2) }
    @objc private func kH3() { coordinator?.heading(3) }
    @objc private func kNumbered() { coordinator?.perform(.numbered) }
    @objc private func kBullet() { coordinator?.perform(.bullet) }
    @objc private func kTask() { coordinator?.perform(.task) }
    @objc private func kQuote() { coordinator?.perform(.quote) }
    @objc private func kFormat() { coordinator?.perform(.format) }
    @objc private func kTab() { coordinator?.tab(1) }
    @objc private func kShiftTab() { coordinator?.tab(-1) }
}

/// The toolbar above the keyboard, in the desktop's order.
final class MarkdownToolbar: UIInputView {
    private weak var coordinator: MarkdownTextView.Coordinator?

    init(coordinator: MarkdownTextView.Coordinator, fewButtons: Bool = false) {
        self.coordinator = coordinator
        super.init(frame: CGRect(x: 0, y: 0, width: 320, height: 46), inputViewStyle: .keyboard)
        autoresizingMask = .flexibleWidth
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        scroll.translatesAutoresizingMaskIntoConstraints = false
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 2
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        addSubview(scroll)
        let done = button("keyboard.chevron.compact.down", String(localized: "Hide keyboard")) { [weak self] in
            self?.coordinator?.view?.resignFirstResponder()
        }
        done.translatesAutoresizingMaskIntoConstraints = false
        addSubview(done)
        NSLayoutConstraint.activate([
            scroll.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 6),
            scroll.trailingAnchor.constraint(equalTo: done.leadingAnchor, constant: -4),
            scroll.topAnchor.constraint(equalTo: topAnchor),
            scroll.bottomAnchor.constraint(equalTo: bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: scroll.centerYAnchor),
            stack.heightAnchor.constraint(equalToConstant: 40),
            done.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -8),
            done.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
        let items = fewButtons ? Self.fewItems : Self.items
        for (index, item) in items.enumerated() {
            if !fewButtons && Self.dividersBefore.contains(index) {
                let line = UIView()
                line.backgroundColor = .separator
                line.translatesAutoresizingMaskIntoConstraints = false
                line.widthAnchor.constraint(equalToConstant: 1 / UIScreen.main.scale).isActive = true
                line.heightAnchor.constraint(equalToConstant: 22).isActive = true
                stack.addArrangedSubview(line)
            }
            stack.addArrangedSubview(button(item.symbol, item.label) { [weak self] in self?.coordinator?.perform(item.action) })
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private struct Item {
        let action: MarkdownTextView.Coordinator.Action
        let symbol: String
        let label: String
    }

    private static let items: [Item] = [
        Item(action: .bold, symbol: "bold", label: String(localized: "Bold")),
        Item(action: .italic, symbol: "italic", label: String(localized: "Italic")),
        Item(action: .heading, symbol: "number", label: String(localized: "Heading")),
        Item(action: .bullet, symbol: "list.bullet", label: String(localized: "Bulleted list")),
        Item(action: .numbered, symbol: "list.number", label: String(localized: "Numbered list")),
        Item(action: .task, symbol: "checklist", label: String(localized: "Checklist")),
        Item(action: .outdent, symbol: "decrease.indent", label: String(localized: "Move list item out")),
        Item(action: .indent, symbol: "increase.indent", label: String(localized: "Nest list item")),
        Item(action: .quote, symbol: "text.quote", label: String(localized: "Quote")),
        Item(action: .code, symbol: "chevron.left.forwardslash.chevron.right", label: String(localized: "Code")),
        Item(action: .link, symbol: "link", label: String(localized: "markdownEditor.link")),
        Item(action: .table, symbol: "tablecells", label: String(localized: "Table")),
        Item(action: .rule, symbol: "minus", label: String(localized: "Divider line")),
        Item(action: .format, symbol: "wand.and.stars", label: String(localized: "Tidy up the formatting")),
    ]
    /// The everyday marks (routine instructions): bold, italic, heading,
    /// a list, a checklist and a link.
    private static var fewItems: [Item] {
        let kept: [MarkdownTextView.Coordinator.Action] = [.bold, .italic, .heading, .bullet, .task, .link]
        return items.filter { item in kept.contains { $0 == item.action } }
    }
    /// A thin line before heading, quote, table and Format, as the desktop.
    private static let dividersBefore: Set<Int> = [2, 8, 11, 13]

    private func button(_ symbol: String, _ label: String, _ action: @escaping () -> Void) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.image = UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 16, weight: .medium))
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 8, leading: 9, bottom: 8, trailing: 9)
        let button = UIButton(configuration: configuration, primaryAction: UIAction { _ in action() })
        button.tintColor = .label
        button.accessibilityLabel = label
        button.largeContentTitle = label
        button.showsLargeContentViewer = true
        button.addInteraction(UILargeContentViewerInteraction())
        return button
    }
}

/// Light formatting while typing; the marks stay visible.
enum MarkdownStyler {
    static func base(monospaced: Bool) -> [NSAttributedString.Key: Any] {
        let body = UIFont.preferredFont(forTextStyle: .body)
        let font = monospaced ? UIFont.monospacedSystemFont(ofSize: body.pointSize * 0.94, weight: .regular) : body
        return [.font: font, .foregroundColor: UIColor.label]
    }

    private static let heading = try! NSRegularExpression(pattern: #"^(#{1,6})[ \t]+.*$"#, options: .anchorsMatchLines)
    private static let bold = try! NSRegularExpression(pattern: #"\*\*[^*\n]+\*\*|__[^_\n]+__"#)
    private static let italic = try! NSRegularExpression(pattern: #"(?<![\w*])[*_][^*_\n]+[*_](?![\w*])"#)
    private static let code = try! NSRegularExpression(pattern: #"`[^`\n]+`"#)
    private static let quote = try! NSRegularExpression(pattern: #"^\s*>.*$"#, options: .anchorsMatchLines)
    private static let done = try! NSRegularExpression(pattern: #"^\s*[-*+]\s+\[[xX]\].*$"#, options: .anchorsMatchLines)
    private static let link = try! NSRegularExpression(pattern: #"\[[^\]\n]+\]\([^)\n]+\)"#)

    static func style(_ storage: NSTextStorage, monospaced: Bool) {
        let text = storage.string
        let ns = text as NSString
        let all = NSRange(location: 0, length: ns.length)
        let attributes = base(monospaced: monospaced)
        let body = attributes[.font] as? UIFont ?? UIFont.preferredFont(forTextStyle: .body)
        storage.beginEditing()
        storage.setAttributes(attributes, range: all)
        heading.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            let level = match.range(at: 1).length
            let scale: CGFloat = level == 1 ? 1.35 : level == 2 ? 1.2 : 1.08
            storage.addAttribute(.font, value: UIFont.systemFont(ofSize: body.pointSize * scale, weight: .semibold), range: match.range)
        }
        bold.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.font, value: UIFont.systemFont(ofSize: body.pointSize, weight: .semibold), range: match.range)
        }
        italic.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match, let descriptor = body.fontDescriptor.withSymbolicTraits(.traitItalic) else { return }
            storage.addAttribute(.font, value: UIFont(descriptor: descriptor, size: body.pointSize), range: match.range)
        }
        let mono = UIFont.monospacedSystemFont(ofSize: body.pointSize * 0.92, weight: .regular)
        let tint = UIColor.secondarySystemFill
        code.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttributes([.font: mono, .backgroundColor: tint], range: match.range)
        }
        quote.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.foregroundColor, value: UIColor.secondaryLabel, range: match.range)
        }
        done.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: UIColor.secondaryLabel], range: match.range)
        }
        link.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.foregroundColor, value: UIColor.tintColor, range: match.range)
        }
        // fenced blocks last: everything inside is code
        var offset = 0
        var fenceStart: Int?
        for line in text.components(separatedBy: "\n") {
            let length = (line as NSString).length
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                if let start = fenceStart {
                    storage.setAttributes([.font: mono, .foregroundColor: UIColor.label, .backgroundColor: tint], range: NSRange(location: start, length: offset + length - start))
                    fenceStart = nil
                } else {
                    fenceStart = offset
                }
            }
            offset += length + 1
        }
        if let start = fenceStart, start < ns.length {
            storage.setAttributes([.font: mono, .foregroundColor: UIColor.label, .backgroundColor: tint], range: NSRange(location: start, length: ns.length - start))
        }
        storage.endEditing()
    }
}

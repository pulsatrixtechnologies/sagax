// The desktop's markdown editor card (src/components/markdown/MarkdownEditor.tsx
// in Advanced mode, MarkdownEditorCore.tsx's CodeMirror theme) for the Edit
// bot window's Personality page: the formatting toolbar (bold, italic,
// heading, lists, checklist, quote, code, link, table, rule, Format), the
// Write / Preview / Side by side tabs, the text in the app's 13 pt sans
// with light markdown styling, and the status line (the field's footer at
// the left, the word and character counts at the right). The edits are
// CompanionCore's `MarkdownEdits`, the same the phone's editor uses.
import CompanionCore
import SwiftUI
import UIKit

/// A catalog string with `%@` arguments, in the language chosen in Settings.
func instructionsText(_ key: String, _ arguments: String...) -> String {
    String(format: AppStrings.localized(key), arguments: arguments.map { $0 as CVarArg })
}

// MARK: - Icons

/// The lucide icons of the editor and the two pages (lucide-react, ISC).
enum InstructionsIcon: String {
    case bold, italic, heading, list, listOrdered, listChecks, textQuote, code, link, table, minus, wandSparkles
    case penLine, eye, columns2, upload, arrowUpRight, squareSlash, ellipsis, x, pencil, share2, trash2, check

    var paths: [String] {
        switch self {
        case .bold: ["M6 12h9a4 4 0 0 1 0 8H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h7a4 4 0 0 1 0 8"]
        case .italic: ["M19 4L10 4", "M14 20L5 20", "M15 4L9 20"]
        case .heading: ["M6 12h12", "M6 20V4", "M18 20V4"]
        case .list: ["M3 5h.01", "M3 12h.01", "M3 19h.01", "M8 5h13", "M8 12h13", "M8 19h13"]
        case .listOrdered: ["M11 5h10", "M11 12h10", "M11 19h10", "M4 4h1v5", "M4 9h2", "M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"]
        case .listChecks: ["M13 5h8", "M13 12h8", "M13 19h8", "m3 17 2 2 4-4", "m3 7 2 2 4-4"]
        case .textQuote: ["M17 5H3", "M21 12H8", "M21 19H8", "M3 12v7"]
        case .code: ["m16 18 6-6-6-6", "m8 6-6 6 6 6"]
        case .link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"]
        case .table: ["M12 3v18", "M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3Z", "M3 9h18", "M3 15h18"]
        case .minus: ["M5 12h14"]
        case .wandSparkles: ["m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72", "m14 7 3 3", "M5 6v4", "M19 14v4", "M10 2v2", "M7 8H3", "M21 16h-4", "M11 3H9"]
        case .penLine: ["M13 21h8", "M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"]
        case .eye: ["M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0", "M9 12A3 3 0 1 0 15 12A3 3 0 1 0 9 12Z"]
        case .columns2: ["M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3Z", "M12 3v18"]
        case .upload: ["M12 3v12", "m17 8-5-5-5 5", "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"]
        case .arrowUpRight: ["M7 7h10v10", "M7 17 17 7"]
        case .squareSlash: ["M5 3H19A2 2 0 0 1 21 5V19A2 2 0 0 1 19 21H5A2 2 0 0 1 3 19V5A2 2 0 0 1 5 3Z", "M9 15L15 9"]
        case .ellipsis: ["M11 12A1 1 0 1 0 13 12A1 1 0 1 0 11 12Z", "M18 12A1 1 0 1 0 20 12A1 1 0 1 0 18 12Z", "M4 12A1 1 0 1 0 6 12A1 1 0 1 0 4 12Z"]
        case .x: ["M18 6 6 18", "m6 6 12 12"]
        case .pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z", "m15 5 4 4"]
        case .share2: ["M15 5A3 3 0 1 0 21 5A3 3 0 1 0 15 5Z", "M3 12A3 3 0 1 0 9 12A3 3 0 1 0 3 12Z", "M15 19A3 3 0 1 0 21 19A3 3 0 1 0 15 19Z", "M8.59 13.51L15.42 17.49", "M15.41 6.51L8.59 10.49"]
        case .trash2: ["M10 11v6", "M14 11v6", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M3 6h18", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]
        case .check: ["M20 6 9 17l-5-5"]
        }
    }
}

struct InstructionsIconView: View {
    let icon: InstructionsIcon
    var size: CGFloat = 14
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Actions

enum DesktopMarkdownAction: CaseIterable {
    case bold, italic, heading, bullet, numbered, task, quote, code, link, table, rule, format

    var icon: InstructionsIcon {
        switch self {
        case .bold: .bold
        case .italic: .italic
        case .heading: .heading
        case .bullet: .list
        case .numbered: .listOrdered
        case .task: .listChecks
        case .quote: .textQuote
        case .code: .code
        case .link: .link
        case .table: .table
        case .rule: .minus
        case .format: .wandSparkles
        }
    }

    var label: String {
        switch self {
        case .bold: AppStrings.localized("Bold")
        case .italic: AppStrings.localized("Italic")
        case .heading: AppStrings.localized("Heading")
        case .bullet: AppStrings.localized("Bulleted list")
        case .numbered: AppStrings.localized("Numbered list")
        case .task: AppStrings.localized("Checklist")
        case .quote: AppStrings.localized("Quote")
        case .code: AppStrings.localized("Code")
        case .link: AppStrings.localized("markdownEditor.link")
        case .table: AppStrings.localized("Table")
        case .rule: AppStrings.localized("Divider line")
        case .format: AppStrings.localized("Tidy up the formatting")
        }
    }

    /// The desktop's shortcut, as a Mac reads it.
    var keys: String? {
        switch self {
        case .bold: "⌘B"
        case .italic: "⌘I"
        case .heading: "⌘⌥1"
        case .bullet: "⌘⇧8"
        case .numbered: "⌘⇧7"
        case .task: "⌘⇧9"
        case .quote: "⌘⇧."
        case .code: "⌘E"
        case .link: "⌘K"
        case .format: "⇧⌥F"
        case .table, .rule: nil
        }
    }

    /// A thin divider before heading, quote, table and Format.
    var startsGroup: Bool { [.heading, .quote, .table, .format].contains(self) }

    func edit(_ state: MarkdownEdits.TextSelection) -> MarkdownEdits.TextSelection? {
        switch self {
        case .bold: return MarkdownEdits.toggleWrap(state, marker: "**", placeholder: AppStrings.localized("bold text"))
        case .italic: return MarkdownEdits.toggleWrap(state, marker: "_", placeholder: AppStrings.localized("italic text"))
        case .heading: return MarkdownEdits.cycleHeading(state)
        case .bullet: return MarkdownEdits.toggleLinePrefix(state, kind: .bullet)
        case .numbered: return MarkdownEdits.toggleLinePrefix(state, kind: .numbered)
        case .task: return MarkdownEdits.toggleLinePrefix(state, kind: .task)
        case .quote: return MarkdownEdits.toggleLinePrefix(state, kind: .quote)
        case .code: return MarkdownEdits.toggleCode(state, placeholder: AppStrings.localized("code"))
        case .link: return MarkdownEdits.insertLink(state, textPlaceholder: AppStrings.localized("link text"))
        case .table: return MarkdownEdits.insertTable(state) { instructionsText("Column %@", "\($0)") }
        case .rule: return MarkdownEdits.insertRule(state)
        case .format:
            let formatted = MarkdownEdits.formatMarkdown(state.doc)
            guard formatted != state.doc else { return nil }
            return MarkdownEdits.TextSelection(doc: formatted, caret: min(state.from, (formatted as NSString).length))
        }
    }
}

/// The text view the toolbar edits.
@MainActor
final class DesktopMarkdownController: ObservableObject {
    weak var view: DesktopMarkdownUITextView?
    var commit: ((String) -> Void)?

    var state: MarkdownEdits.TextSelection? {
        guard let view else { return nil }
        let range = view.selectedRange
        return MarkdownEdits.TextSelection(doc: view.text ?? "", from: range.location, to: range.location + range.length)
    }

    func run(_ action: DesktopMarkdownAction) {
        guard let state, let next = action.edit(state) else { return }
        apply(next)
    }

    func heading(_ level: Int) {
        guard let state else { return }
        apply(MarkdownEdits.setHeading(state, level: level))
    }

    /// Only what changed is replaced, so undo follows it.
    func apply(_ next: MarkdownEdits.TextSelection) {
        guard let view else { return }
        let change = MarkdownEdits.minimalChange(view.text ?? "", next.doc)
        if let start = view.position(from: view.beginningOfDocument, offset: change.from),
           let end = view.position(from: view.beginningOfDocument, offset: change.to),
           let range = view.textRange(from: start, to: end) {
            view.replace(range, withText: change.insert)
        } else {
            view.text = next.doc
        }
        view.selectedRange = NSRange(location: next.from, length: max(0, next.to - next.from))
        changed()
    }

    func changed() {
        guard let view else { return }
        commit?(view.text ?? "")
        view.restyle()
    }
}

// MARK: - The card

/// `MarkdownEditor` (Advanced): toolbar and tabs, the writing area or the
/// preview (or both side by side), the status line.
struct DesktopMarkdownField<Footer: View>: View {
    enum Mode: String { case write, preview, split }

    @Environment(\.desktopTheme) private var theme
    @Binding var text: String
    var placeholder: String
    var minHeight: CGFloat = 220
    var maxHeight: CGFloat = 620
    var invalid = false
    var disabled = false
    var accessibilityLabel: String
    var identifier: String
    @ViewBuilder var footer: () -> Footer

    @StateObject private var controller = DesktopMarkdownController()
    @State private var mode: Mode = Self.storedMode()
    @State private var height: CGFloat = 0

    static var viewKey: String { "sagax.markdownEditor.view.v1" }

    private static func storedMode() -> Mode {
        UserDefaults.standard.string(forKey: viewKey) == Mode.split.rawValue ? .split : .write
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 4) {
                    tools
                    Spacer(minLength: 0)
                    tabs
                }
                VStack(alignment: .leading, spacing: 4) {
                    tools
                    tabs
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 4)
            .overlay(alignment: .bottom) { Rectangle().fill(theme.hairline40).frame(height: 1) }
            switch mode {
            case .write:
                writing
            case .preview:
                preview
            case .split:
                HStack(alignment: .top, spacing: 0) {
                    writing.frame(maxWidth: .infinity)
                    Rectangle().fill(theme.hairline40).frame(width: 1)
                    preview.frame(maxWidth: .infinity)
                }
            }
            HStack(alignment: .top, spacing: 12) {
                footer()
                    .frame(maxWidth: .infinity, alignment: .leading)
                DesktopText(verbatim: instructionsText("%@ words · %@ characters", MarkdownEdits.countWords(text).formatted(), MarkdownEdits.countCharacters(text).formatted()),
                            size: 11, line: 16.5, color: \.inkTertiary)
                    .monospacedDigit()
                    .fixedSize()
                    .accessibilityIdentifier("\(identifier).count")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .overlay(alignment: .top) { Rectangle().fill(theme.hairline40).frame(height: 1) }
        }
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(invalid ? theme.danger.opacity(0.6) : theme.hairline40, lineWidth: 1)
        )
        .opacity(disabled ? 0.6 : 1)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(identifier).editor")
    }

    private var tools: some View {
        HStack(spacing: 2) {
            ForEach(Array(DesktopMarkdownAction.allCases.enumerated()), id: \.offset) { index, action in
                if index > 0 && action.startsGroup {
                    Rectangle().fill(theme.hairline.opacity(0.6)).frame(width: 1, height: 14).padding(.horizontal, 2)
                }
                Button {
                    if mode == .preview { choose(.write) }
                    DispatchQueue.main.async { controller.run(action) }
                } label: {
                    InstructionsIconView(icon: action.icon, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 28, height: 28)
                        .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 6))
                .disabled(disabled)
                .opacity(disabled ? 0.4 : 1)
                .help(action.keys.map { "\(action.label) (\($0))" } ?? action.label)
                .accessibilityLabel(Text(verbatim: action.label))
                .accessibilityIdentifier("\(identifier).tool.\(action)")
            }
        }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Formatting"))
    }

    private var tabs: some View {
        HStack(spacing: 2) {
            tab(.write, .penLine, AppStrings.localized("Write"))
            tab(.preview, .eye, AppStrings.localized("Preview"))
            tab(.split, .columns2, AppStrings.localized("Side by side"))
        }
        .fixedSize()
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("View"))
    }

    private func tab(_ target: Mode, _ icon: InstructionsIcon, _ label: String) -> some View {
        let active = mode == target
        return Button { choose(target) } label: {
            HStack(spacing: 4) {
                InstructionsIconView(icon: icon, size: 13)
                DesktopText(verbatim: label, size: 12, line: 16, color: active ? \DesktopTheme.ink : \DesktopTheme.inkSecondary)
            }
            .foregroundStyle(active ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(active ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 6))
        .accessibilityAddTraits(active ? .isSelected : [])
        .accessibilityIdentifier("\(identifier).view.\(target.rawValue)")
    }

    private func choose(_ next: Mode) {
        // Drop first responder before Write is removed from the tree so the
        // fields under the card (Do not finish until) can take focus (#1939).
        if next != .write {
            controller.view?.resignFirstResponder()
            controller.view?.window?.endEditing(true)
        }
        mode = next
        UserDefaults.standard.set(next == .split ? Mode.split.rawValue : Mode.write.rawValue, forKey: Self.viewKey)
    }

    private var writing: some View {
        DesktopMarkdownTextView(
            text: $text, placeholder: placeholder, controller: controller, theme: theme,
            accessibilityLabel: accessibilityLabel, identifier: identifier, height: $height
        )
        .disabled(disabled)
        .frame(height: min(maxHeight, max(minHeight, height)))
    }

    private var preview: some View {
        ScrollView {
            Group {
                if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    DesktopText("Nothing to preview yet.", color: \.inkTertiary)
                } else {
                    MarkdownText(source: text, inert: true)
                        .environment(\.desktopChatText, theme)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .frame(minHeight: minHeight, maxHeight: maxHeight)
        .fixedSize(horizontal: false, vertical: mode == .preview)
        .accessibilityLabel(Text("Markdown preview"))
        .accessibilityIdentifier("\(identifier).preview")
    }
}

// MARK: - The text view

struct DesktopMarkdownTextView: UIViewRepresentable {
    @Binding var text: String
    var placeholder: String
    let controller: DesktopMarkdownController
    let theme: DesktopTheme
    var accessibilityLabel: String
    var identifier: String
    @Binding var height: CGFloat

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIView(context: Context) -> DesktopMarkdownUITextView {
        let view = DesktopMarkdownUITextView()
        view.delegate = context.coordinator
        view.controller = controller
        view.backgroundColor = .clear
        view.isScrollEnabled = true
        view.smartQuotesType = .no
        view.smartDashesType = .no
        view.textContainerInset = UIEdgeInsets(top: 8, left: 12, bottom: 8, right: 12)
        view.textContainer.lineFragmentPadding = 0
        view.accessibilityLabel = accessibilityLabel
        view.accessibilityIdentifier = identifier
        view.styler = DesktopMarkdownStyler(theme: theme)
        view.placeholder = placeholder
        view.tintColor = UIColor(theme.ink)
        view.text = text
        controller.view = view
        controller.commit = { [weak coordinator = context.coordinator] value in coordinator?.parent.text = value }
        context.coordinator.watchOtherFields()
        view.restyle()
        return view
    }

    func updateUIView(_ view: DesktopMarkdownUITextView, context: Context) {
        context.coordinator.parent = self
        controller.view = view
        controller.commit = { [weak coordinator = context.coordinator] value in coordinator?.parent.text = value }
        view.isEditable = context.environment.isEnabled
        view.styler = DesktopMarkdownStyler(theme: theme)
        view.placeholder = placeholder
        if view.text != text {
            let selection = view.selectedRange
            view.text = text
            let length = (text as NSString).length
            view.selectedRange = NSRange(location: min(selection.location, length), length: 0)
            view.restyle()
        }
        context.coordinator.measure(view)
    }

    /// Leaving Write (Preview / Side by side) or the page must drop first
    /// responder: a UITextView torn down while focused leaves the window
    /// unable to focus the "Do not finish until" field below (#1939).
    static func dismantleUIView(_ view: DesktopMarkdownUITextView, coordinator: Coordinator) {
        view.resignFirstResponder()
        view.window?.endEditing(true)
        if coordinator.parent.controller.view === view {
            coordinator.parent.controller.view = nil
        }
        coordinator.stopWatching()
    }

    @MainActor
    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: DesktopMarkdownTextView
        private var fieldObserver: NSObjectProtocol?
        private var editorObserver: NSObjectProtocol?

        init(_ parent: DesktopMarkdownTextView) { self.parent = parent }

        deinit {
            if let fieldObserver { NotificationCenter.default.removeObserver(fieldObserver) }
            if let editorObserver { NotificationCenter.default.removeObserver(editorObserver) }
        }

        /// When a SwiftUI TextField / TextEditor below the SOUL card takes
        /// focus, resign this UITextView so the hand-off actually lands.
        func watchOtherFields() {
            guard fieldObserver == nil else { return }
            let resign: (Notification) -> Void = { [weak self] note in
                guard let self, let view = self.parent.controller.view, view.isFirstResponder else { return }
                if let other = note.object as? UIView, other === view { return }
                view.resignFirstResponder()
            }
            fieldObserver = NotificationCenter.default.addObserver(
                forName: UITextField.textDidBeginEditingNotification, object: nil, queue: .main, using: resign
            )
            editorObserver = NotificationCenter.default.addObserver(
                forName: UITextView.textDidBeginEditingNotification, object: nil, queue: .main, using: resign
            )
        }

        func stopWatching() {
            if let fieldObserver { NotificationCenter.default.removeObserver(fieldObserver) }
            if let editorObserver { NotificationCenter.default.removeObserver(editorObserver) }
            fieldObserver = nil
            editorObserver = nil
        }

        func measure(_ view: UITextView) {
            let width = view.bounds.width
            guard width > 0 else {
                DispatchQueue.main.async { [weak self, weak view] in if let view { self?.measure(view) } }
                return
            }
            let fitted = view.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude)).height.rounded(.up)
            if abs(fitted - parent.height) > 0.5 {
                DispatchQueue.main.async { [weak self] in self?.parent.height = fitted }
            }
        }

        func textViewShouldEndEditing(_ textView: UITextView) -> Bool { true }

        func textView(_ textView: UITextView, shouldChangeTextIn range: NSRange, replacementText replacement: String) -> Bool {
            guard textView.markedTextRange == nil else { return true }
            let controller = parent.controller
            let doc = textView.text ?? ""
            let caret = MarkdownEdits.TextSelection(doc: doc, from: range.location, to: range.location + range.length)
            if replacement == "\n", let next = MarkdownEdits.continueList(caret) {
                controller.apply(next)
                return false
            }
            let selected = textView.selectedRange
            if replacement.isEmpty, range.length == 1, selected.length == 0, selected.location == range.location + 1,
               let next = MarkdownEdits.deletePair(MarkdownEdits.TextSelection(doc: doc, caret: selected.location)) {
                controller.apply(next)
                return false
            }
            if (replacement as NSString).length == 1, "([`*_)]".contains(replacement),
               let next = MarkdownEdits.autoPair(caret, char: replacement) {
                controller.apply(next)
                return false
            }
            return true
        }

        func textViewDidChange(_ textView: UITextView) {
            parent.controller.changed()
            measure(textView)
        }
    }
}

/// The text view: paste rules, the desktop's shortcuts and the placeholder.
final class DesktopMarkdownUITextView: UITextView {
    weak var controller: DesktopMarkdownController?
    var styler: DesktopMarkdownStyler?
    var placeholder = "" { didSet { setNeedsDisplay() } }

    func restyle() {
        guard markedTextRange == nil, let styler else { return }
        styler.style(textStorage)
        typingAttributes = styler.base
        setNeedsDisplay()
    }

    override func paste(_ sender: Any?) {
        if let pasted = UIPasteboard.general.string, let controller, let state = controller.state {
            let ns = state.doc as NSString
            let selected = ns.substring(with: NSRange(location: state.from, length: state.to - state.from))
            if let replacement = MarkdownEdits.linkFromPaste(selected: selected, pasted: pasted) ?? MarkdownEdits.tableFromTsv(pasted) {
                let doc = ns.replacingCharacters(in: NSRange(location: state.from, length: state.to - state.from), with: replacement)
                controller.apply(MarkdownEdits.TextSelection(doc: doc, caret: state.from + (replacement as NSString).length))
                return
            }
        }
        super.paste(sender)
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        guard (text ?? "").isEmpty, !placeholder.isEmpty, let styler else { return }
        var attributes = styler.base
        attributes[.foregroundColor] = styler.tertiary
        (placeholder as NSString).draw(
            in: bounds.inset(by: textContainerInset),
            withAttributes: attributes
        )
    }

    override var keyCommands: [UIKeyCommand]? {
        func command(_ input: String, _ flags: UIKeyModifierFlags, _ action: Selector) -> UIKeyCommand {
            let command = UIKeyCommand(input: input, modifierFlags: flags, action: action)
            command.wantsPriorityOverSystemBehavior = true
            return command
        }
        return [
            command("b", .command, #selector(kBold)), command("i", .command, #selector(kItalic)),
            command("k", .command, #selector(kLink)), command("e", .command, #selector(kCode)),
            command("1", [.command, .alternate], #selector(kH1)), command("2", [.command, .alternate], #selector(kH2)),
            command("3", [.command, .alternate], #selector(kH3)),
            command("7", [.command, .shift], #selector(kNumbered)), command("8", [.command, .shift], #selector(kBullet)),
            command("9", [.command, .shift], #selector(kTask)), command(".", [.command, .shift], #selector(kQuote)),
            command("f", [.shift, .alternate], #selector(kFormat)),
        ]
    }

    @objc private func kBold() { controller?.run(.bold) }
    @objc private func kItalic() { controller?.run(.italic) }
    @objc private func kLink() { controller?.run(.link) }
    @objc private func kCode() { controller?.run(.code) }
    @objc private func kH1() { controller?.heading(1) }
    @objc private func kH2() { controller?.heading(2) }
    @objc private func kH3() { controller?.heading(3) }
    @objc private func kNumbered() { controller?.run(.numbered) }
    @objc private func kBullet() { controller?.run(.bullet) }
    @objc private func kTask() { controller?.run(.task) }
    @objc private func kQuote() { controller?.run(.quote) }
    @objc private func kFormat() { controller?.run(.format) }
}

// MARK: - Light formatting

/// MarkdownEditorCore.tsx's highlight style: 13 pt sans at 1.55 with a
/// 1 pt pad per line, headings 1.2 / 1.1 / 1.05 em, bold 650, code in
/// monospace on a 6 % ink ground, the marks (#, list bullets, rule) in
/// tertiary ink, links underlined, quotes and finished tasks secondary.
struct DesktopMarkdownStyler {
    let theme: DesktopTheme

    var ink: UIColor { UIColor(theme.ink) }
    var secondary: UIColor { UIColor(theme.inkSecondary) }
    var tertiary: UIColor { UIColor(theme.inkTertiary) }
    var font: UIFont { theme.uiFont(13) }

    /// `.cm-line { padding: 1px 0 }` at `line-height: 1.55`: every source
    /// line is its own box, 2 pt taller than its wrapped rows' pitch; a
    /// heading adds its own padding above and below.
    func paragraph(_ font: UIFont, line: CGFloat, above: CGFloat = 0, below: CGFloat = 0) -> NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.minimumLineHeight = line
        style.maximumLineHeight = line
        style.paragraphSpacingBefore = 1 + above
        style.paragraphSpacing = 1 + below
        return style
    }

    func attributes(_ font: UIFont, color: UIColor? = nil, line: CGFloat? = nil,
                    above: CGFloat = 0, below: CGFloat = 0) -> [NSAttributedString.Key: Any] {
        let line = line ?? font.pointSize * 1.55
        return [
            .font: font, .foregroundColor: color ?? ink, .paragraphStyle: paragraph(font, line: line, above: above, below: below),
            .baselineOffset: (line - font.lineHeight) / 4,
        ]
    }

    var base: [NSAttributedString.Key: Any] { attributes(font) }

    private static let heading = try! NSRegularExpression(pattern: #"^(#{1,6})([ \t]+)(.*)$"#, options: .anchorsMatchLines)
    private static let bold = try! NSRegularExpression(pattern: #"(\*\*|__)([^*_\n]+)(\*\*|__)"#)
    private static let italic = try! NSRegularExpression(pattern: #"(?<![\w*])([*_])([^*_\n]+)([*_])(?![\w*])"#)
    private static let code = try! NSRegularExpression(pattern: #"`[^`\n]+`"#)
    private static let quote = try! NSRegularExpression(pattern: #"^\s*>.*$"#, options: .anchorsMatchLines)
    private static let listMark = try! NSRegularExpression(pattern: #"^\s*(?:[-*+]|\d+[.)])(?=\s)"#, options: .anchorsMatchLines)
    private static let done = try! NSRegularExpression(pattern: #"^\s*[-*+]\s+\[[xX]\].*$"#, options: .anchorsMatchLines)
    private static let link = try! NSRegularExpression(pattern: #"\[([^\]\n]+)\]\(([^)\n]+)\)"#)
    private static let rule = try! NSRegularExpression(pattern: #"^\s*(?:-{3,}|\*{3,}|_{3,})\s*$"#, options: .anchorsMatchLines)
    private static let table = try! NSRegularExpression(pattern: #"^\s*\|.*\|\s*$"#, options: .anchorsMatchLines)

    /// The whole source line around a match (with its newline), so its
    /// paragraph style covers the paragraph.
    private func lineRange(_ range: NSRange, in text: String) -> NSRange {
        (text as NSString).lineRange(for: range)
    }

    func style(_ storage: NSTextStorage) {
        let text = storage.string
        let all = NSRange(location: 0, length: (text as NSString).length)
        let mono = UIFont.monospacedSystemFont(ofSize: 13 * 0.92, weight: .regular)
        let codeGround = UIColor(theme.ink.opacity(0.06))
        storage.beginEditing()
        storage.setAttributes(base, range: all)
        Self.heading.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            let level = match.range(at: 1).length
            let scale: CGFloat = level == 1 ? 1.2 : level == 2 ? 1.1 : level == 3 ? 1.05 : 1
            let face = theme.uiFont(13 * scale, .semibold)
            // h1/h2 at 1.35, the rest at the editor's 1.55; .cm-md-h1..h3 padding
            let line = level <= 2 ? 13 * scale * 1.35 : nil
            let above: CGFloat = level == 1 ? 4 : level == 2 ? 3 : level == 3 ? 2 : 0
            let below: CGFloat = level == 1 ? 2 : level == 2 ? 1 : 0
            storage.addAttributes(attributes(face, line: line, above: above, below: below), range: lineRange(match.range, in: text))
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range(at: 1))
        }
        Self.bold.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.font, value: theme.uiFont(13, .semibold), range: match.range)
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range(at: 1))
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range(at: 3))
        }
        Self.italic.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match, let descriptor = font.fontDescriptor.withSymbolicTraits(.traitItalic) else { return }
            storage.addAttribute(.font, value: UIFont(descriptor: descriptor, size: 13), range: match.range)
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range(at: 1))
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range(at: 3))
        }
        Self.code.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttributes([.font: mono, .backgroundColor: codeGround], range: match.range)
        }
        Self.listMark.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range)
        }
        Self.quote.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.foregroundColor, value: secondary, range: match.range)
        }
        Self.done.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: secondary], range: match.range)
        }
        Self.link.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.underlineStyle, value: NSUnderlineStyle.single.rawValue, range: match.range(at: 1))
            storage.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue, .foregroundColor: secondary], range: match.range(at: 2))
        }
        Self.rule.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.foregroundColor, value: tertiary, range: match.range)
        }
        Self.table.enumerateMatches(in: text, range: all) { match, _, _ in
            guard let match else { return }
            storage.addAttribute(.font, value: mono, range: match.range)
        }
        // fenced blocks last: everything inside is code
        var offset = 0
        var fenceStart: Int?
        for line in text.components(separatedBy: "\n") {
            let length = (line as NSString).length
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                if let start = fenceStart {
                    storage.addAttributes([.font: mono, .foregroundColor: ink, .backgroundColor: codeGround],
                                          range: NSRange(location: start, length: offset + length - start))
                    fenceStart = nil
                } else {
                    fenceStart = offset
                }
            }
            offset += length + 1
        }
        if let start = fenceStart, start < all.length {
            storage.addAttributes([.font: mono, .foregroundColor: ink, .backgroundColor: codeGround],
                                  range: NSRange(location: start, length: all.length - start))
        }
        storage.endEditing()
    }
}

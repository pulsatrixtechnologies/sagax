// One recursive renderer for every node a chat widget can hold: the
// desktop's WidgetBody, WidgetNodes, WidgetFields, WidgetControls,
// WidgetContent, WidgetTable and WidgetChart (src/components/widget/) in
// SwiftUI. It reads canonical trees only and never fails on one: a type this
// build does not know draws its children, or nothing. Charts are Swift
// Charts, icons SF Symbols, pickers the system's own.
import Charts
import CompanionCore
import SwiftUI

/// Where a node is drawn (WidgetWhere on the desktop).
struct ChatWidgetWhere {
    var axis: Axis = .vertical
    /// Inside a list row, where every line is one line.
    var item = false
    /// The first thing in a list row: an icon or image there is its thumbnail.
    var lead = false
    /// A direct child of the card: a Row there is a 44 pt key-value row.
    var card = false
    /// Inside a table cell.
    var cell = false
}

// MARK: - Body

/// The inside of the card under its header: a Card stacks its children, a
/// ListView draws its rows and folds the ones past `limit` behind Show all.
struct ChatWidgetBody: View {
    let root: ChatWidgetNode
    let headed: Bool
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink
    @State private var all = false

    private static func isRow(_ node: ChatWidgetNode?) -> Bool { node?.type == "Row" || node?.type == "Checkbox" }

    var body: some View {
        if root.type == "ListView" {
            list
        } else if !root.children.isEmpty {
            let children = root.children
            let sides = ChatWidgetStyle.fourSides(root["padding"])
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(children.enumerated()), id: \.offset) { index, child in
                    if index > 0, room(children[index - 1], child) > 0 {
                        Color.clear.frame(height: room(children[index - 1], child))
                    }
                    ChatWidgetNodeView(node: child, where: ChatWidgetWhere(card: true))
                }
            }
            .padding(.top, sides?[0] ?? (headed ? 0 : Self.isRow(children.first) ? 6 : 16))
            .padding(.trailing, sides?[1] ?? 16)
            .padding(.bottom, sides?[2] ?? (Self.isRow(children.last) ? 6 : 16))
            .padding(.leading, sides?[3] ?? 16)
            .environment(\.chatWidgetCardInset, sides?[3] ?? 16)
        }
    }

    /// The room between two children of a card. A Divider carries its own.
    private func room(_ above: ChatWidgetNode, _ below: ChatWidgetNode) -> CGFloat {
        if above.type == "Divider" || below.type == "Divider" { return 0 }
        return Self.isRow(above) && Self.isRow(below) ? 0 : 12
    }

    @ViewBuilder
    private var list: some View {
        let items = root.children
        let limit = root.number("limit").map { Int($0) }
        let name = root.string("name")
        // a chosen row is never left behind the fold
        let chosenAt = name.flatMap { name in items.firstIndex { ChatWidgetStyle.rowValue($0) == form.text(name) } } ?? -1
        let folds = limit.map { !all && items.count > $0 && chosenAt < $0 } ?? false
        let shown = folds ? Array(items.prefix(limit ?? items.count)) : items
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(shown) { item in
                    if let name {
                        ChatWidgetChoiceRow(node: item, name: name)
                    } else if item.type == "ListViewItem" {
                        ChatWidgetListRow(node: item)
                    } else {
                        ChatWidgetNodeView(node: item, where: ChatWidgetWhere())
                    }
                }
                if shown.count < items.count {
                    // unfolding is the reader's own: it works on a settled card too
                    Button {
                        all = true
                    } label: {
                        Text("Show all (\(items.count))")
                            .font(ink.font(13, .medium))
                            .foregroundStyle(ink.secondary)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .padding(.horizontal, 12)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("widget-\(form.messageId)-show-all")
                }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
            .padding(.top, headed ? 0 : 8)
        }
    }
}

// MARK: - Nodes

struct ChatWidgetNodeView: View {
    let node: ChatWidgetNode
    var `where` = ChatWidgetWhere()
    @Environment(\.chatWidgetInk) private var ink
    @EnvironmentObject private var form: ChatWidgetForm

    var body: some View {
        if ChatWidgetRules.fieldTypes.contains(node.type) {
            ChatWidgetFieldView(node: node, where: `where`)
        } else {
            switch node.type {
            case "Box", "Row", "Col", "Form":
                ChatWidgetLayout(node: node, where: `where`)
            case "ListViewItem":
                ChatWidgetListRow(node: node)
            case "Spacer":
                Spacer(minLength: node.number("minSize").map { CGFloat($0) } ?? 0)
            case "Divider":
                ChatWidgetDivider(node: node, where: `where`)
            case "Table":
                ChatWidgetTable(node: node)
            case "Text", "Title", "Caption":
                ChatWidgetText(node: node, where: `where`)
            case "Label":
                ChatWidgetLabel(node: node, where: `where`)
            case "Markdown":
                MarkdownText(source: node.string("value") ?? "", inert: true)
                    .font(ink.font(14))
                    .foregroundStyle(ink.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            case "Image":
                ChatWidgetImage(node: node, where: `where`)
            case "Icon":
                icon
            case "Chart":
                ChatWidgetChart(node: node)
            case "Badge":
                ChatWidgetBadge(node: node)
            case "Progress":
                ChatWidgetProgress(node: node)
            case "Carousel":
                ChatWidgetCarousel(node: node)
            case "Product":
                ChatWidgetProduct(node: node)
            case "Button":
                ChatWidgetButton(
                    actionRef: node.id, label: node.string("label"), look: node.string("style") ?? "secondary",
                    iconStart: node.string("iconStart"), iconEnd: node.string("iconEnd"),
                    block: node.flag("block"), disabled: node.flag("disabled")
                )
            default:
                // Transition draws its one child. So does anything else that has children.
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(node.children) { child in ChatWidgetNodeView(node: child, where: `where`) }
                }
            }
        }
    }

    @ViewBuilder
    private var icon: some View {
        let size = ChatWidgetStyle.iconSize[node.string("size") ?? "md"] ?? 16
        let tone = ink.tone(node.string("color"))
        if `where`.item, `where`.lead {
            ChatWidgetGlyph(name: node.string("name") ?? "dot", size: size)
                .foregroundStyle(tone ?? ink.secondary)
                .frame(width: 40, height: 40)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        } else {
            ChatWidgetGlyph(name: node.string("name") ?? "dot", size: size)
                .foregroundStyle(tone ?? ink.ink)
        }
    }
}

/// Box, Row, Col and Form: a stack, or a flow when a row of buttons, badges
/// or fields would run past the card. In a narrow card a Row of a label and
/// a field stacks the words over a full-width field.
struct ChatWidgetLayout: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    private static let words: Set<String> = ["Label", "Text", "Caption", "Title"]
    private static let flowing: Set<String> = ChatWidgetRules.fieldTypes.union(["Button", "Badge", "Spacer"])

    private var pairsField: Bool {
        node.children.contains { ChatWidgetRules.fieldTypes.contains($0.type) && $0.type != "Checkbox" }
            && node.children.contains { Self.words.contains($0.type) }
    }

    var body: some View {
        let stacked = form.compact && node.type == "Row" && pairsField
        let row = !stacked && (node.type == "Row" || (node.type != "Col" && node.string("direction") == "row"))
        let gap = stacked ? 6 : node.number("gap").map { CGFloat($0) } ?? (row ? 8 : node.type == "Form" ? 12 : 0)
        let shown = stacked ? node.children.filter { $0.type != "Spacer" } : node.children
        let flows = row && (node.flag("wrap") || node["wrap"]?.string != nil
            || (shown.count > 1 && shown.allSatisfy { Self.flowing.contains($0.type) }))
        let inner = ChatWidgetWhere(axis: row ? .horizontal : .vertical, item: `where`.item)
        Group {
            if flows {
                ChatWidgetFlow(spacing: gap) {
                    ForEach(shown) { child in ChatWidgetNodeView(node: child, where: inner) }
                }
            } else if row {
                HStack(alignment: ChatWidgetStyle.vertical(node.string("align")), spacing: gap) {
                    ForEach(shown) { child in
                        ChatWidgetNodeView(node: child, where: inner)
                            .modifier(ChatWidgetFlex(node: child))
                    }
                }
                .frame(maxWidth: node.string("justify") == "between" || shown.contains { $0.type == "Spacer" } ? .infinity : nil, alignment: .leading)
            } else {
                VStack(alignment: ChatWidgetStyle.horizontal(stacked ? "stretch" : node.string("align")), spacing: gap) {
                    ForEach(shown) { child in
                        ChatWidgetNodeView(node: child, where: inner)
                            .frame(maxWidth: stacked || (node.string("align") ?? "stretch") == "stretch" ? .infinity : nil,
                                   alignment: stacked ? .leading : ChatWidgetStyle.frameAlignment(node.string("align")))
                    }
                }
            }
        }
        .padding(ChatWidgetStyle.insets(node["padding"]))
        .frame(minHeight: `where`.card && node.type == "Row" && !stacked ? 44 : nil)
        .padding(.vertical, `where`.card && node.type == "Row" && stacked ? 10 : 0)
        .modifier(ChatWidgetBox(node: node))
    }
}

/// A child's share of a row (`flex`), or its own width.
struct ChatWidgetFlex: ViewModifier {
    let node: ChatWidgetNode
    func body(content: Content) -> some View {
        if node.number("flex") != nil {
            content.frame(maxWidth: .infinity, alignment: .leading).layoutPriority(1)
        } else {
            content
        }
    }
}

/// The box a layout node asks for: lengths, ratio, background, radius, border.
struct ChatWidgetBox: ViewModifier {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    func body(content: Content) -> some View {
        let radius = node.number("radius").map { CGFloat(min($0, 999)) } ?? 0
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .frame(
                minWidth: length("minWidth"), maxWidth: node["width"]?.string == "full" || node["maxWidth"]?.string == "full" ? .infinity : length("maxWidth"),
                minHeight: length("minHeight"), maxHeight: length("maxHeight"), alignment: .topLeading
            )
            .frame(width: length("width"), height: length("height"))
            .background(background.map { AnyShapeStyle($0) } ?? AnyShapeStyle(Color.clear), in: shape)
            .overlay {
                if let border = node.number("border"), border > 0 {
                    shape.strokeBorder(ink.ink.opacity(0.12), lineWidth: CGFloat(border))
                }
            }
            .clipShape(shape)
    }

    private func length(_ key: String) -> CGFloat? { node.number(key).map { CGFloat($0) } }

    private var background: Color? {
        switch node.string("background") {
        case "surface": ink.surface
        case "secondary": ink.inset
        case "tertiary": ink.ink.opacity(0.07)
        case "elevated": ink.desktop?.card ?? Theme.cardRaised
        default: nil
        }
    }
}

struct ChatWidgetDivider: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @Environment(\.chatWidgetInk) private var ink
    @Environment(\.chatWidgetCardInset) private var cardInset

    var body: some View {
        let spacing = node.number("spacing").map { CGFloat($0) }
        if `where`.axis == .horizontal {
            Rectangle().fill(ink.ink.opacity(0.12)).frame(width: 1).padding(.horizontal, spacing ?? 0)
        } else {
            Rectangle().fill(ink.ink.opacity(0.12)).frame(height: 1)
                .padding(.horizontal, node.flag("flush") && `where`.card ? -cardInset : 0)
                .padding(.vertical, spacing ?? (`where`.card ? 12 : 8))
        }
    }
}

struct ChatWidgetText: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let size = node.string("size")
        let metrics: (CGFloat, CGFloat) = switch node.type {
        case "Title": ChatWidgetStyle.titleSize[size ?? "md"] ?? (17, 24)
        case "Caption": ChatWidgetStyle.captionSize[size ?? "md"] ?? (13, 18)
        default: `where`.cell && size == nil ? (13, 18) : ChatWidgetStyle.textSize[size ?? "md"] ?? (14, 20)
        }
        let weight = ChatWidgetStyle.weight(node.string("weight")) ?? (node.type == "Title" ? .semibold : .regular)
        let tone = ink.tone(node.string("color")) ?? (node.type == "Caption" ? ink.secondary : ink.ink)
        let maxLines = node.number("maxLines").map { Int($0) }
        let oneLine = node.flag("truncate") || (`where`.item && maxLines == nil)
        var text = Text(verbatim: node.string("value") ?? "")
        if node.flag("italic") { text = text.italic() }
        if node.flag("lineThrough") { text = text.strikethrough() }
        return text
            .font(ink.font(metrics.0, weight))
            .lineSpacing(max(0, metrics.1 - metrics.0 * 1.2))
            .foregroundStyle(tone)
            .multilineTextAlignment(ChatWidgetStyle.textAlignment(node.string("textAlign")))
            .lineLimit(oneLine ? 1 : maxLines)
            .truncationMode(.tail)
            .fixedSize(horizontal: false, vertical: !oneLine)
            .frame(width: node.number("width").map { CGFloat($0) }, alignment: ChatWidgetStyle.textFrame(node.string("textAlign")))
            .frame(maxWidth: node["width"]?.string == "full" ? .infinity : nil, alignment: .leading)
            .frame(minHeight: node.number("minLines").map { CGFloat($0) * metrics.1 }, alignment: .top)
    }
}

/// Above its field a label is the form caption; beside it, in a row, the
/// row's 14 pt in the secondary ink.
struct ChatWidgetLabel: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let above = `where`.axis == .vertical
        let size = ChatWidgetStyle.textSize[node.string("size") ?? ""]?.0 ?? (above ? 12 : 14)
        Text(verbatim: node.string("value") ?? "")
            .font(ink.font(size, ChatWidgetStyle.weight(node.string("weight")) ?? .regular))
            .foregroundStyle(ink.tone(node.string("color")) ?? ink.secondary)
            .multilineTextAlignment(ChatWidgetStyle.textAlignment(node.string("textAlign")))
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: node.number("width").map { CGFloat($0) }, alignment: .leading)
            .padding(.leading, above ? 2 : 0)
    }
}

// MARK: - List rows

/// A list row: 60 pt, the whole of it the target when it has an action.
struct ChatWidgetListRow: View {
    let node: ChatWidgetNode
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let entry = form.actions[node.id]
        let gap = node.number("gap").map { CGFloat($0) } ?? 12
        let content = HStack(alignment: ChatWidgetStyle.vertical(node.string("align")), spacing: gap) {
            ForEach(Array(node.children.enumerated()), id: \.element.id) { index, child in
                ChatWidgetNodeView(node: child, where: ChatWidgetWhere(axis: .horizontal, item: true, lead: index == 0))
                    .modifier(ChatWidgetFlex(node: child))
            }
            if form.pending == node.id {
                ProgressView().controlSize(.small)
            } else if form.sent == node.id {
                Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold)).foregroundStyle(ink.success)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
        if let entry {
            Button {
                form.press(node.id)
            } label: {
                content.contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(ChatWidgetRowStyle(fill: ink.inset))
            .disabled(!form.canPress(entry))
            .accessibilityHint(entry.url != nil ? Text(verbatim: entry.url?.host ?? "") : Text(""))
            .accessibilityIdentifier("widget-\(form.messageId)-row-\(node.id)")
        } else {
            content
        }
    }
}

struct ChatWidgetRowStyle: ButtonStyle {
    let fill: Color
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? fill : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

/// A row of a list with a `name`: one of them is chosen, as in a radio group.
struct ChatWidgetChoiceRow: View {
    let node: ChatWidgetNode
    let name: String
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let value = ChatWidgetStyle.rowValue(node)
        let checked = !value.isEmpty && form.text(name) == value
        let gap = node.number("gap").map { CGFloat($0) } ?? 12
        Button {
            if !form.locked, !value.isEmpty { form.set(name, .text(value)) }
        } label: {
            HStack(alignment: ChatWidgetStyle.vertical(node.string("align")), spacing: gap) {
                ChatWidgetRadioMark(on: checked, invalid: form.problem?.field == name)
                ForEach(Array(node.children.enumerated()), id: \.element.id) { index, child in
                    ChatWidgetNodeView(node: child, where: ChatWidgetWhere(axis: .horizontal, item: true, lead: index == 0))
                        .modifier(ChatWidgetFlex(node: child))
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
            .background(checked ? ink.inset : Color.clear, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(form.locked)
        .accessibilityAddTraits(checked ? [.isSelected] : [])
        .accessibilityIdentifier("widget-\(form.messageId)-choice-\(node.id)")
    }
}

struct ChatWidgetRadioMark: View {
    let on: Bool
    var invalid = false
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        ZStack {
            Circle().strokeBorder(on ? ink.accent : invalid ? ink.danger : ink.ink.opacity(0.3), lineWidth: on ? 5 : 1.5)
        }
        .frame(width: 18, height: 18)
        .accessibilityHidden(true)
    }
}

// MARK: - Buttons

/// One pressable action: a Button node, or the confirm and cancel under the
/// card. It shows its own press: a spinner while sent, a tick after.
struct ChatWidgetButton: View {
    let actionRef: String
    var label: String?
    var look: String
    var iconStart: String? = nil
    var iconEnd: String? = nil
    var block = false
    var disabled = false
    /// The confirm and cancel under the card: 48 pt on phones.
    var tall = false
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let entry = form.actions[actionRef]
        let pending = form.pending == actionRef
        let sent = form.sent == actionRef
        let live = !disabled && form.canPress(entry)
        Button {
            form.press(actionRef)
        } label: {
            HStack(spacing: 6) {
                if pending {
                    ProgressView().controlSize(.small).tint(foreground)
                } else if sent {
                    Image(systemName: "checkmark").font(.system(size: 13, weight: .semibold))
                } else if let iconStart {
                    ChatWidgetGlyph(name: iconStart, size: 15)
                }
                if let label, !label.isEmpty {
                    Text(verbatim: label).lineLimit(1)
                }
                if let iconEnd, !pending, !sent {
                    ChatWidgetGlyph(name: iconEnd, size: 15)
                }
            }
            .font(ink.font(14, .medium))
            .foregroundStyle(foreground)
            .padding(.horizontal, look == "quiet" ? 10 : 16)
            .frame(minHeight: tall && ink.desktop == nil ? 48 : 36)
            .frame(maxWidth: block ? .infinity : nil)
            .background(fill, in: Capsule())
            .overlay {
                if look == "outline" { Capsule().strokeBorder(ink.ring, lineWidth: 1) }
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!live)
        .opacity(live || pending ? 1 : 0.45)
        .accessibilityValue(Text(pending ? "Sending" : sent ? "Sent" : ""))
        .accessibilityIdentifier("widget-\(form.messageId)-button-\(actionRef)")
    }

    private var fill: Color {
        switch look {
        case "primary": ink.accent
        case "danger": ink.danger
        case "outline": ink.surface
        case "quiet": .clear
        default: ink.ink.opacity(0.07)
        }
    }

    private var foreground: Color {
        switch look {
        case "primary": ink.accentInk
        case "danger": Theme.dangerInk
        case "quiet": ink.secondary
        default: ink.ink
        }
    }
}

// MARK: - Content

struct ChatWidgetBadge: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let label = node.string("label") ?? ""
        let color = ink.badge(node.string("color") ?? "secondary")
        let variant = node.string("variant") ?? "soft"
        if variant == "dot" {
            HStack(spacing: 6) {
                Circle().fill(color).frame(width: 7, height: 7)
                Text(verbatim: label)
            }
            .font(ink.font(13))
            .foregroundStyle(ink.secondary)
            .lineLimit(1)
            .fixedSize()
        } else {
            let size: (CGFloat, CGFloat, CGFloat) = switch node.string("size") {
            case "sm": (11, 20, 8)
            case "lg": (13, 26, 11)
            default: (12, 22, 9)
            }
            let shape = RoundedRectangle(cornerRadius: node["pill"]?.bool == false ? 7 : size.1 / 2, style: .continuous)
            Text(verbatim: label)
                .font(ink.font(size.0, .medium))
                .lineLimit(1)
                .foregroundStyle(variant == "solid" ? Color.white : color)
                .padding(.horizontal, size.2)
                .frame(height: size.1)
                .background(variant == "solid" ? color : variant == "outline" ? Color.clear : color.opacity(0.13), in: shape)
                .overlay { if variant == "outline" { shape.strokeBorder(color.opacity(0.45), lineWidth: 1) } }
                .fixedSize()
        }
    }
}

struct ChatWidgetProgress: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let fraction = min(1, max(0, node.number("value") ?? 0))
        let percent = Int((fraction * 100).rounded())
        let label = node.string("label")
        VStack(alignment: .leading, spacing: 8) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule().fill(ink.ink.opacity(0.1))
                    Capsule().fill(ink.accent).frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 6)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                Text(verbatim: "\(percent)%").monospacedDigit().foregroundStyle(ink.secondary)
                Spacer(minLength: 0)
                if let label { Text(verbatim: label).lineLimit(1).foregroundStyle(ink.tertiary) }
            }
            .font(ink.font(13))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Progress"))
        .accessibilityValue(Text(verbatim: label.map { "\(percent)%, \($0)" } ?? "\(percent)%"))
    }
}

/// A remote image waits for a tap, the way one in a bot's Markdown does: a
/// widget is bot-authored, and loading it is a request to whatever address
/// the bot wrote. One tap loads the card's images. https only.
struct ChatWidgetImage: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        if let src = node.string("src"), src.lowercased().hasPrefix("https://"), let url = URL(string: src) {
            let thumb = `where`.item && `where`.lead && node.number("width") == nil && node.number("height") == nil
            let radius = node.number("radius").map { CGFloat(min($0, 999)) } ?? (thumb ? 10 : 12)
            let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
            Group {
                if form.imagesAllowed {
                    AsyncImage(url: url) { phase in
                        if let image = phase.image {
                            image.resizable().aspectRatio(contentMode: node.string("fit") == "contain" ? .fit : .fill)
                        } else {
                            ink.inset
                        }
                    }
                    .accessibilityLabel(Text(verbatim: node.string("alt") ?? ""))
                } else {
                    Button {
                        form.imagesAllowed = true
                    } label: {
                        VStack(spacing: 4) {
                            Image(systemName: "photo").font(.system(size: thumb ? 15 : 18))
                            if !thumb {
                                Text("External image hidden for privacy").font(ink.font(12)).multilineTextAlignment(.center)
                                Text("Load image").font(ink.font(12, .medium)).foregroundStyle(ink.ink).underline()
                            }
                        }
                        .foregroundStyle(ink.secondary)
                        .padding(thumb ? 0 : 12)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(ink.inset)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(node.string("alt").map { "\(String(localized: "Load image")): \($0)" } ?? String(localized: "Load image")))
                    .accessibilityIdentifier("widget-load-image")
                }
            }
            .frame(width: thumb ? 40 : node.number("width").map { CGFloat($0) },
                   height: thumb ? 40 : node.number("height").map { CGFloat($0) } ?? (node.number("aspectRatio") == nil ? 120 : nil))
            .frame(maxWidth: thumb ? nil : .infinity)
            .aspectRatio(thumb ? nil : node.number("aspectRatio").map { CGFloat($0) }, contentMode: .fit)
            .clipShape(shape)
            .overlay { if node.flag("frame") { shape.strokeBorder(ink.ink.opacity(0.1), lineWidth: 1) } }
        }
    }
}

/// A widget Table: rows of cells, the header in the secondary ink, a rule
/// between rows, the last column's numbers to the end when it asks.
struct ChatWidgetTable: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let rows = node.children.filter { $0.type == "Table.Row" }
        ScrollView(.horizontal, showsIndicators: false) {
            Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    if index > 0 {
                        Rectangle().fill(ink.ink.opacity(row.flag("header") ? 0.2 : 0.08)).frame(height: 1).gridCellUnsizedAxes(.horizontal)
                    }
                    GridRow {
                        ForEach(row.children.filter { $0.type == "Table.Cell" }) { cell in
                            VStack(alignment: ChatWidgetStyle.horizontal(cell.string("align") ?? "start"), spacing: 2) {
                                ForEach(cell.children) { child in
                                    ChatWidgetNodeView(node: child, where: ChatWidgetWhere(cell: true))
                                }
                            }
                            .padding(.vertical, 8)
                            .gridColumnAlignment(ChatWidgetStyle.horizontal(cell.string("align") ?? "start"))
                            .gridCellColumns(cell.integer("colSpan", in: 1...12) ?? 1)
                            .environment(\.chatWidgetInk, row.flag("header") ? headerInk : ink)
                        }
                    }
                }
            }
        }
        .accessibilityIdentifier("widget-table")
    }

    private var headerInk: ChatWidgetInk {
        var header = ink
        header.ink = ink.secondary
        return header
    }
}

/// A chart of the rows it holds: bar, line or area series over one x key.
struct ChatWidgetChart: View {
    let node: ChatWidgetNode
    @Environment(\.chatWidgetInk) private var ink

    private struct Point: Identifiable {
        let id: String
        let x: String
        let series: String
        let y: Double
        let mark: String
    }

    var body: some View {
        let xKey = node["xAxis"]?.object?["dataKey"]?.string ?? node["xAxis"]?.string ?? "x"
        let series = (node["series"]?.array ?? []).compactMap { $0.object }
        let rows = (node["data"]?.array ?? []).compactMap { $0.object }
        let stacked = series.contains { $0["stack"]?.string != nil }
        let names = series.map { $0["label"]?.string ?? $0["dataKey"]?.string ?? "" }
        let points: [Point] = rows.enumerated().flatMap { index, row in
            series.compactMap { spec -> Point? in
                guard let key = spec["dataKey"]?.string, let y = row[key]?.number else { return nil }
                let x = row[xKey]?.string ?? row[xKey]?.number.map { String($0) } ?? "\(index + 1)"
                let name = spec["label"]?.string ?? key
                return Point(id: "\(index)-\(key)", x: x, series: name, y: y, mark: spec["type"]?.string ?? "bar")
            }
        }
        let palette: [Color] = [ink.accent, ink.success, ink.warning, Color(red: 0.62, green: 0.42, blue: 0.95)]
        Chart(points) { point in
            switch point.mark {
            case "line":
                LineMark(x: .value("x", point.x), y: .value("y", point.y))
                    .foregroundStyle(by: .value("series", point.series))
            case "area":
                AreaMark(x: .value("x", point.x), y: .value("y", point.y))
                    .foregroundStyle(by: .value("series", point.series))
            default:
                if stacked {
                    BarMark(x: .value("x", point.x), y: .value("y", point.y))
                        .foregroundStyle(by: .value("series", point.series))
                } else {
                    BarMark(x: .value("x", point.x), y: .value("y", point.y))
                        .foregroundStyle(by: .value("series", point.series))
                        .position(by: .value("series", point.series))
                }
            }
        }
        .chartForegroundStyleScale(domain: names, range: Array(palette.prefix(max(names.count, 1))))
        .chartLegend(node["showLegend"]?.bool == false || names.count < 2 ? .hidden : .visible)
        .chartYAxis(node["showYAxis"]?.bool == false ? .hidden : .automatic)
        .frame(height: node.number("height").map { CGFloat($0) } ?? 180)
        .accessibilityLabel(Text("Chart of \(names.joined(separator: ", ")) across \(rows.count) points"))
        .accessibilityIdentifier("widget-chart")
    }
}

/// An icon by its canonical name (shared/widget.ts) as an SF Symbol.
struct ChatWidgetGlyph: View {
    let name: String
    var size: CGFloat = 16

    var body: some View {
        if name == "dot" {
            Circle().frame(width: 7, height: 7).frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            Image(systemName: Self.symbol(name))
                .font(.system(size: size * 0.9, weight: .medium))
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }

    static func symbol(_ name: String) -> String {
        switch name {
        case "info": "info.circle"
        case "agent": "person.crop.circle.badge.checkmark"
        case "analytics", "chart": "chart.bar"
        case "atom": "atom"
        case "batch": "square.stack.3d.up"
        case "bolt": "bolt"
        case "book-open": "book"
        case "book-closed": "book.closed"
        case "book-clock": "clock.badge"
        case "bug": "ladybug"
        case "calendar": "calendar"
        case "check": "checkmark"
        case "check-circle": "checkmark.circle"
        case "check-circle-filled": "checkmark.circle.fill"
        case "chevron-left": "chevron.left"
        case "chevron-right": "chevron.right"
        case "circle-question": "questionmark.circle"
        case "compass": "safari"
        case "confetti": "party.popper"
        case "cube": "cube"
        case "desktop": "desktopcomputer"
        case "document", "file", "page-blank": "doc"
        case "dots-horizontal": "ellipsis"
        case "dots-vertical": "ellipsis.vertical"
        case "empty-circle": "circle"
        case "external-link": "arrow.up.right.square"
        case "globe": "globe"
        case "keys": "key"
        case "lab": "flask"
        case "images", "square-image": "photo"
        case "lifesaver": "lifepreserver"
        case "lightbulb": "lightbulb"
        case "mail": "envelope"
        case "map-pin": "mappin"
        case "maps": "map"
        case "mobile": "iphone"
        case "name", "profile-card": "person.text.rectangle"
        case "notebook": "book.pages"
        case "notebook-pencil", "write", "write-alt", "write-alt2": "square.and.pencil"
        case "phone": "phone"
        case "play": "play"
        case "plus": "plus"
        case "profile", "user": "person"
        case "reload": "arrow.clockwise"
        case "star": "star"
        case "star-filled": "star.fill"
        case "search": "magnifyingglass"
        case "sparkle": "sparkle"
        case "sparkle-double": "sparkles"
        case "square-code": "chevron.left.forwardslash.chevron.right"
        case "square-text": "text.alignleft"
        case "suitcase": "suitcase"
        case "settings-slider": "slider.horizontal.3"
        case "wreath": "laurel.leading"
        case "pull-request": "arrow.triangle.pull"
        case "upload": "arrow.up.circle"
        case "download": "arrow.down.circle"
        case "clock": "clock"
        case "lock": "lock"
        case "link": "link"
        case "folder": "folder"
        case "bell": "bell"
        case "warning": "exclamationmark.triangle"
        case "close": "xmark"
        case "arrow-right": "arrow.right"
        default: "circle.fill"
        }
    }
}

// MARK: - Style

enum ChatWidgetStyle {
    /// (font size, line height) per canonical size.
    static let textSize: [String: (CGFloat, CGFloat)] = ["xs": (12, 16), "sm": (13, 18), "md": (14, 20), "lg": (16, 22), "xl": (18, 26)]
    static let titleSize: [String: (CGFloat, CGFloat)] = [
        "sm": (15, 22), "md": (17, 24), "lg": (20, 28), "xl": (24, 32), "2xl": (28, 36), "3xl": (32, 40), "4xl": (40, 44), "5xl": (48, 52),
    ]
    static let captionSize: [String: (CGFloat, CGFloat)] = ["sm": (12, 16), "md": (13, 18), "lg": (14, 20)]
    static let iconSize: [String: CGFloat] = ["xs": 12, "sm": 14, "md": 16, "lg": 20, "xl": 24, "2xl": 28, "3xl": 32]

    static func weight(_ name: String?) -> Font.Weight? {
        switch name {
        case "normal": .regular
        case "medium": .medium
        case "semibold": .semibold
        case "bold": .bold
        default: nil
        }
    }

    static func vertical(_ align: String?) -> VerticalAlignment {
        switch align {
        case "start": .top
        case "end": .bottom
        case "baseline": .firstTextBaseline
        default: .center
        }
    }

    static func horizontal(_ align: String?) -> HorizontalAlignment {
        switch align {
        case "center": .center
        case "end": .trailing
        default: .leading
        }
    }

    static func frameAlignment(_ align: String?) -> Alignment {
        switch align {
        case "center": .center
        case "end": .trailing
        default: .leading
        }
    }

    static func textAlignment(_ align: String?) -> TextAlignment {
        switch align {
        case "center": .center
        case "end": .trailing
        default: .leading
        }
    }

    static func textFrame(_ align: String?) -> Alignment { frameAlignment(align) }

    /// A canonical `[top, right, bottom, left]` in px, or nothing.
    static func fourSides(_ value: WidgetJSON?) -> [CGFloat]? {
        guard let sides = value?.array, sides.count == 4 else { return nil }
        let numbers = sides.compactMap(\.number)
        return numbers.count == 4 ? numbers.map { CGFloat($0) } : nil
    }

    static func insets(_ value: WidgetJSON?) -> EdgeInsets {
        guard let sides = fourSides(value) else { return EdgeInsets() }
        return EdgeInsets(top: sides[0], leading: sides[3], bottom: sides[2], trailing: sides[1])
    }

    /// The value a row of a named list stands for.
    static func rowValue(_ node: ChatWidgetNode) -> String {
        node.string("value") ?? node.number("value").map { String($0) } ?? ""
    }
}

private struct ChatWidgetCardInsetKey: EnvironmentKey {
    static let defaultValue: CGFloat = 16
}

extension EnvironmentValues {
    /// The card's side padding: a flush divider runs out to the card's edges.
    var chatWidgetCardInset: CGFloat {
        get { self[ChatWidgetCardInsetKey.self] }
        set { self[ChatWidgetCardInsetKey.self] = newValue }
    }
}

/// Lays its children out in rows, wrapping to the next row when one runs out
/// of room: rows of buttons, badges and fields never scroll sideways.
struct ChatWidgetFlow: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: width, height: nil))
            if x > 0, x + size.width > width {
                y += line + spacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + spacing
                x = bounds.minX
                line = 0
            }
            subview.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }
}

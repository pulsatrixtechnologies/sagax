// The fields a chat widget can hold (WidgetFields, WidgetControls,
// WidgetTimePicker and WidgetDayPicker on the desktop): Select, DatePicker,
// TimePicker, DayPicker, Checkbox, RadioGroup, Input and Textarea, each
// reading and writing the card's form by field name. Select is the system
// menu, the date and time pickers the system's own; a field's own `label`
// is drawn as a caption above it unless a Label node already names it.
import CompanionCore
import SwiftUI

struct ChatWidgetFieldView: View {
    let node: ChatWidgetNode
    let `where`: ChatWidgetWhere
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    private static let bareTypes: Set<String> = ["Select", "DatePicker", "TimePicker", "DayPicker", "Input"]

    var body: some View {
        let name = node.string("name") ?? ""
        let label = node.string("label")
        let captioned = label != nil && !form.labelled.contains(name)
        // beside a label in a row a picker drops its box and shows its value alone
        let bare = `where`.axis == .horizontal && !captioned && !node.flag("block") && Self.bareTypes.contains(node.type)
        if node.type == "Checkbox" {
            ChatWidgetCheckbox(node: node)
        } else {
            VStack(alignment: .leading, spacing: 6) {
                if captioned, let label {
                    Text(verbatim: label)
                        .font(ink.font(12))
                        .foregroundStyle(ink.secondary)
                        .padding(.leading, 2)
                }
                control(bare: bare)
            }
            .frame(maxWidth: bare ? nil : .infinity, alignment: .leading)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("widget-field-\(name)")
        }
    }

    @ViewBuilder
    private func control(bare: Bool) -> some View {
        switch node.type {
        case "Select": ChatWidgetSelect(node: node, bare: bare)
        case "DatePicker": ChatWidgetDatePicker(node: node, bare: bare)
        case "TimePicker": ChatWidgetTimePicker(node: node, bare: bare)
        case "DayPicker": ChatWidgetDayPicker(node: node)
        case "RadioGroup": ChatWidgetRadioGroup(node: node)
        case "Input": ChatWidgetInput(node: node, bare: bare)
        default: ChatWidgetTextarea(node: node)
        }
    }
}

/// The settings-field box a full field sits in.
private struct ChatWidgetFieldBox: ViewModifier {
    let bare: Bool
    let invalid: Bool
    @Environment(\.chatWidgetInk) private var ink

    func body(content: Content) -> some View {
        if bare {
            content
        } else {
            content
                .padding(.horizontal, 12)
                .frame(minHeight: 44)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(ink.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(invalid ? ink.danger : Color.clear, lineWidth: 1)
                )
        }
    }
}

private extension ChatWidgetForm {
    func disabled(_ node: ChatWidgetNode) -> Bool { locked || node.flag("disabled") }
    func invalid(_ node: ChatWidgetNode) -> Bool { problem?.field != nil && problem?.field == node.string("name") }
}

struct ChatWidgetSelect: View {
    let node: ChatWidgetNode
    let bare: Bool
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let options = ChatWidgetRules.options(node)
        let chosen = options.first { $0.value == form.text(name) }
        Menu {
            ForEach(options, id: \.value) { option in
                Button {
                    form.set(name, .text(option.value))
                } label: {
                    if option.value == chosen?.value { Label(option.label, systemImage: "checkmark") } else { Text(option.label) }
                }
            }
            if node.flag("clearable"), chosen != nil {
                Divider()
                Button(String(localized: "Clear \(form.fields[name]?.label ?? name)"), role: .destructive) { form.set(name, .text("")) }
            }
        } label: {
            HStack(spacing: 6) {
                Text(verbatim: chosen?.label ?? node.string("placeholder") ?? String(localized: "Choose"))
                    .foregroundStyle(chosen == nil ? ink.tertiary : ink.ink)
                    .lineLimit(1)
                if !bare { Spacer(minLength: 4) }
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .medium)).foregroundStyle(ink.tertiary)
            }
            .font(ink.font(14))
            .modifier(ChatWidgetFieldBox(bare: bare, invalid: form.invalid(node)))
            .contentShape(Rectangle())
        }
        .disabled(form.disabled(node))
        .accessibilityLabel(Text(verbatim: form.fields[name]?.label ?? name))
        .accessibilityValue(Text(verbatim: chosen?.label ?? ""))
    }
}

/// `YYYY-MM-DD` and `HH:MM`, read and written in the person's own calendar.
enum ChatWidgetDates {
    static let isoDay: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    static func day(_ text: String?) -> Date? { text.flatMap { $0.isEmpty ? nil : isoDay.date(from: $0) } }

    static func time(_ text: String?) -> Date? {
        guard let text, text.count == 5, let hours = Int(text.prefix(2)), let minutes = Int(text.suffix(2)) else { return nil }
        return Calendar.current.date(bySettingHour: hours, minute: minutes, second: 0, of: Date(timeIntervalSince1970: 0))
    }

    static func timeString(_ date: Date, step: Int) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        var minutes = (parts.hour ?? 0) * 60 + (parts.minute ?? 0)
        if step > 1 { minutes = min(23 * 60 + 59, Int((Double(minutes) / Double(step)).rounded()) * step) }
        return String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }
}

struct ChatWidgetDatePicker: View {
    let node: ChatWidgetNode
    let bare: Bool
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let value = ChatWidgetDates.day(form.text(name))
        let low = ChatWidgetDates.day(node.string("min")) ?? .distantPast
        let high = ChatWidgetDates.day(node.string("max")) ?? .distantFuture
        HStack(spacing: 6) {
            if let value {
                DatePicker(
                    "",
                    selection: Binding(get: { value }, set: { form.set(name, .text(ChatWidgetDates.isoDay.string(from: $0))) }),
                    in: low...max(low, high),
                    displayedComponents: .date
                )
                .labelsHidden()
                .datePickerStyle(.compact)
                if node.flag("clearable"), !form.disabled(node) {
                    clear(name)
                }
            } else {
                Button {
                    let today = Calendar.current.startOfDay(for: Date())
                    form.set(name, .text(ChatWidgetDates.isoDay.string(from: min(max(today, low), high))))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").foregroundStyle(ink.tertiary)
                        Text(verbatim: node.string("placeholder") ?? String(localized: "Choose")).foregroundStyle(ink.tertiary)
                    }
                    .font(ink.font(14))
                }
                .buttonStyle(.plain)
            }
            if !bare { Spacer(minLength: 0) }
        }
        .modifier(ChatWidgetFieldBox(bare: bare, invalid: form.invalid(node)))
        .disabled(form.disabled(node))
        .accessibilityLabel(Text(verbatim: form.fields[name]?.label ?? name))
    }

    private func clear(_ name: String) -> some View {
        Button {
            form.set(name, .text(""))
        } label: {
            Image(systemName: "xmark.circle.fill").foregroundStyle(ink.tertiary)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Clear \(form.fields[name]?.label ?? name)"))
    }
}

struct ChatWidgetTimePicker: View {
    let node: ChatWidgetNode
    let bare: Bool
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let step = node.integer("step", in: 1...1_000_000) ?? 1
        let value = ChatWidgetDates.time(form.text(name))
        let low = ChatWidgetDates.time(node.string("min")) ?? ChatWidgetDates.time("00:00")!
        let high = ChatWidgetDates.time(node.string("max")) ?? ChatWidgetDates.time("23:59")!
        HStack(spacing: 6) {
            if let value {
                DatePicker(
                    "",
                    selection: Binding(get: { value }, set: { form.set(name, .text(ChatWidgetDates.timeString(min(max($0, low), high), step: step))) }),
                    in: low...max(low, high),
                    displayedComponents: .hourAndMinute
                )
                .labelsHidden()
                .datePickerStyle(.compact)
                if node.flag("clearable"), !form.disabled(node) {
                    Button { form.set(name, .text("")) } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(ink.tertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Clear \(form.fields[name]?.label ?? name)"))
                }
            } else {
                Button {
                    form.set(name, .text(ChatWidgetDates.timeString(low, step: step)))
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "clock").foregroundStyle(ink.tertiary)
                        Text(verbatim: node.string("placeholder") ?? String(localized: "Choose a time")).foregroundStyle(ink.tertiary)
                    }
                    .font(ink.font(14))
                }
                .buttonStyle(.plain)
            }
            if !bare { Spacer(minLength: 0) }
        }
        .modifier(ChatWidgetFieldBox(bare: bare, invalid: form.invalid(node)))
        .disabled(form.disabled(node))
        .accessibilityLabel(Text(verbatim: form.fields[name]?.label ?? name))
    }
}

/// Seven round toggles, Monday first, and what they add up to under them.
struct ChatWidgetDayPicker: View {
    let node: ChatWidgetNode
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let picked = ChatWidgetRules.days(form.text(name))
        let symbols = Self.symbols
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(Array(ChatWidgetRules.weekdays.enumerated()), id: \.offset) { index, day in
                    let on = picked.contains(day)
                    Button {
                        var next = Set(picked)
                        if on { next.remove(day) } else { next.insert(day) }
                        form.set(name, .text(ChatWidgetRules.weekdays.filter(next.contains).joined(separator: ",")))
                    } label: {
                        Text(verbatim: symbols.short[index])
                            .font(ink.font(13, .medium))
                            .foregroundStyle(on ? ink.accentInk : ink.ink)
                            .frame(width: 34, height: 34)
                            .background(on ? ink.accent : ink.inset, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text(verbatim: symbols.full[index]))
                    .accessibilityAddTraits(on ? [.isSelected] : [])
                    .accessibilityIdentifier("widget-day-\(day)")
                }
            }
            Text(verbatim: caption(picked, symbols: symbols))
                .font(ink.font(12))
                .foregroundStyle(ink.secondary)
        }
        .disabled(form.disabled(node))
    }

    /// The weekday names in the person's language, Monday first.
    static var symbols: (short: [String], full: [String]) {
        let calendar = Calendar.current
        let short = calendar.veryShortStandaloneWeekdaySymbols
        let full = calendar.standaloneWeekdaySymbols
        // Calendar lists Sunday first
        let order = [1, 2, 3, 4, 5, 6, 0]
        return (order.map { short[$0] }, order.map { full[$0] })
    }

    private func caption(_ picked: [String], symbols: (short: [String], full: [String])) -> String {
        if picked.isEmpty { return String(localized: "No days picked") }
        if picked.count == 7 { return String(localized: "Every day") }
        if picked == ["mon", "tue", "wed", "thu", "fri"] { return String(localized: "Weekdays") }
        if picked == ["sat", "sun"] { return String(localized: "Weekends") }
        let short = Calendar.current.shortStandaloneWeekdaySymbols
        let order = [1, 2, 3, 4, 5, 6, 0]
        return picked.compactMap { day in ChatWidgetRules.weekdays.firstIndex(of: day).map { short[order[$0]] } }.joined(separator: ", ")
    }
}

struct ChatWidgetCheckbox: View {
    let node: ChatWidgetNode
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let on = form.flag(name)
        Button {
            form.set(name, .flag(!on))
        } label: {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 19))
                    .foregroundStyle(on ? ink.accent : form.invalid(node) ? ink.danger : ink.tertiary)
                Text(verbatim: node.string("label") ?? name)
                    .font(ink.font(14))
                    .foregroundStyle(ink.ink)
                    .multilineTextAlignment(.leading)
                Spacer(minLength: 0)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(form.disabled(node))
        .accessibilityAddTraits(on ? [.isSelected] : [])
        .accessibilityIdentifier("widget-field-\(name)")
    }
}

struct ChatWidgetRadioGroup: View {
    let node: ChatWidgetNode
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let options = ChatWidgetRules.options(node)
        let row = node.string("direction") == "row"
        let content = ForEach(options, id: \.value) { option in
            let on = form.text(name) == option.value
            Button {
                form.set(name, .text(option.value))
            } label: {
                HStack(spacing: 8) {
                    ChatWidgetRadioMark(on: on, invalid: form.invalid(node))
                    Text(verbatim: option.label).font(ink.font(14)).foregroundStyle(ink.ink)
                }
                .frame(minHeight: 44)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(on ? [.isSelected] : [])
            .accessibilityIdentifier("widget-radio-\(name)-\(option.value)")
        }
        Group {
            if row {
                ChatWidgetFlow(spacing: 16) { content }
            } else {
                VStack(alignment: .leading, spacing: 0) { content }
            }
        }
        .disabled(form.disabled(node))
    }
}

struct ChatWidgetInput: View {
    let node: ChatWidgetNode
    let bare: Bool
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        TextField(
            "",
            text: Binding(get: { form.text(name) }, set: { form.set(name, .text($0)) }),
            prompt: Text(verbatim: node.string("placeholder") ?? "").foregroundColor(ink.tertiary)
        )
        .font(ink.font(14))
        .foregroundStyle(ink.ink)
        .keyboardType(keyboard)
        .textInputAutocapitalization(["email", "url"].contains(node.string("inputType")) ? .never : .sentences)
        .autocorrectionDisabled(["email", "url", "tel", "number"].contains(node.string("inputType")))
        .multilineTextAlignment(bare ? .trailing : .leading)
        .modifier(ChatWidgetFieldBox(bare: bare, invalid: form.invalid(node)))
        .disabled(form.disabled(node))
        .accessibilityLabel(Text(verbatim: form.fields[name]?.label ?? name))
    }

    private var keyboard: UIKeyboardType {
        switch node.string("inputType") {
        case "number": .decimalPad
        case "email": .emailAddress
        case "tel": .phonePad
        case "url": .URL
        default: .default
        }
    }
}

struct ChatWidgetTextarea: View {
    let node: ChatWidgetNode
    @EnvironmentObject private var form: ChatWidgetForm
    @Environment(\.chatWidgetInk) private var ink

    var body: some View {
        let name = node.string("name") ?? ""
        let rows = node.integer("rows", in: 1...40) ?? 3
        let most = max(rows, node.integer("maxRows", in: 1...40) ?? max(rows, 8))
        TextField(
            "",
            text: Binding(get: { form.text(name) }, set: { form.set(name, .text($0)) }),
            prompt: Text(verbatim: node.string("placeholder") ?? "").foregroundColor(ink.tertiary),
            axis: .vertical
        )
        .lineLimit(rows...most)
        .font(ink.font(14))
        .foregroundStyle(ink.ink)
        .padding(.vertical, 11)
        .modifier(ChatWidgetFieldBox(bare: false, invalid: form.invalid(node)))
        .disabled(form.disabled(node))
        .accessibilityLabel(Text(verbatim: form.fields[name]?.label ?? name))
    }
}

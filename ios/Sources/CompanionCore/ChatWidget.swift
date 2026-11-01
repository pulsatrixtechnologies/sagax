// A bot-authored chat widget: message kind "widget", a JSON tree in
// ChatKit's format that `show_widget` posts and `update_widget` replaces
// (shared/widget.ts, docs/superpowers/specs/2026-10-13-chat-widgets-design.md).
// The server stores canonical trees only; this reads them and never throws on
// one: a node this build does not know keeps its children, a payload that is
// not a tree leaves `root` nil and the row falls back to its text.
//
// On phones the type is `ChatWidget`, because `Widget` already means the
// home-screen extension. The reading helpers below are the shared ones
// (`widgetActions`, `widgetScope`, `widgetFields`, `widgetInitialValues`,
// `widgetFieldOptions`, `dayList`) in Swift, tested against the server's own
// fixtures (`scripts/gen-widget-fixtures.ts`).
import Foundation

/// Any JSON value, kept as sent.
public indirect enum WidgetJSON: Hashable, Sendable, Codable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([WidgetJSON])
    case object([String: WidgetJSON])

    public init(from decoder: any Decoder) throws {
        let box = try decoder.singleValueContainer()
        if box.decodeNil() { self = .null }
        else if let value = try? box.decode(Bool.self) { self = .bool(value) }
        else if let value = try? box.decode(Double.self) { self = .number(value) }
        else if let value = try? box.decode(String.self) { self = .string(value) }
        else if let value = try? box.decode([WidgetJSON].self) { self = .array(value) }
        else if let value = try? box.decode([String: WidgetJSON].self) { self = .object(value) }
        else { self = .null }
    }

    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case .null: try box.encodeNil()
        case let .bool(value): try box.encode(value)
        case let .number(value): try box.encode(value)
        case let .string(value): try box.encode(value)
        case let .array(value): try box.encode(value)
        case let .object(value): try box.encode(value)
        }
    }

    public var string: String? { if case let .string(value) = self { return value } else { return nil } }
    public var number: Double? { if case let .number(value) = self { return value } else { return nil } }
    public var bool: Bool? { if case let .bool(value) = self { return value } else { return nil } }
    public var object: [String: WidgetJSON]? { if case let .object(value) = self { return value } else { return nil } }
    public var array: [WidgetJSON]? { if case let .array(value) = self { return value } else { return nil } }
}

/// What a field holds: text (a choice's value, a date, a time, days) or a tick.
public enum ChatWidgetValue: Hashable, Sendable, Codable {
    case text(String)
    case flag(Bool)

    public init(from decoder: any Decoder) throws {
        let box = try decoder.singleValueContainer()
        if let flag = try? box.decode(Bool.self) { self = .flag(flag) }
        else if let text = try? box.decode(String.self) { self = .text(text) }
        else if let number = try? box.decode(Double.self) { self = .text(JS.string(number)) }
        else { self = .text("") }
    }

    public func encode(to encoder: any Encoder) throws {
        var box = encoder.singleValueContainer()
        switch self {
        case let .text(value): try box.encode(value)
        case let .flag(value): try box.encode(value)
        }
    }

    public var text: String? { if case let .text(value) = self { return value } else { return nil } }
    public var flag: Bool? { if case let .flag(value) = self { return value } else { return nil } }

    /// The body value `POST /api/bots/:id/messages` takes.
    public var wire: Any {
        switch self {
        case let .text(value): return value
        case let .flag(value): return value
        }
    }
}

public typealias ChatWidgetValues = [String: ChatWidgetValue]

/// One canonical node: its type, its server-assigned id, its props, its children.
public struct ChatWidgetNode: Hashable, Sendable, Identifiable {
    public var type: String
    /// "n1", "n2", ... in document order: how a press names its button.
    public var id: String
    public var props: [String: WidgetJSON]
    public var children: [ChatWidgetNode]

    public init(type: String, id: String, props: [String: WidgetJSON] = [:], children: [ChatWidgetNode] = []) {
        self.type = type
        self.id = id
        self.props = props
        self.children = children
    }

    /// A node from its JSON, or nil when it is not one (no type).
    public init?(json: WidgetJSON, fallbackId: String = "") {
        guard let object = json.object, let type = object["type"]?.string, !type.isEmpty else { return nil }
        self.type = type
        id = object["id"]?.string ?? fallbackId
        var props = object
        props["type"] = nil
        props["id"] = nil
        props["children"] = nil
        self.props = props
        children = (object["children"]?.array ?? []).enumerated().compactMap { index, child in
            ChatWidgetNode(json: child, fallbackId: "\(fallbackId)~\(index)")
        }
    }

    public func string(_ key: String) -> String? { props[key]?.string }
    public func number(_ key: String) -> Double? { props[key]?.number }
    /// A whole number a bot wrote, clamped to `range` before it becomes an
    /// `Int`: `Int(1e20)` traps, and a huge span or row count would hang
    /// the layout. Nil when absent or not finite.
    public func integer(_ key: String, in range: ClosedRange<Int>) -> Int? {
        guard let value = number(key), value.isFinite else { return nil }
        return Int(min(Double(range.upperBound), max(Double(range.lowerBound), value.rounded(.towardZero))))
    }
    public func flag(_ key: String) -> Bool { props[key]?.bool == true }
    public subscript(_ key: String) -> WidgetJSON? { props[key] }

    /// Every node, this one first, with its ancestors.
    func walk(_ ancestors: [ChatWidgetNode] = [], _ visit: (ChatWidgetNode, [ChatWidgetNode]) -> Void) {
        visit(self, ancestors)
        let next = ancestors + [self]
        for child in children { child.walk(next, visit) }
    }
}

/// A widget that took its one answer: it folds to a line and takes no more presses.
public struct ChatWidgetSettled: Hashable, Sendable, Codable {
    public var ref: String
    public var label: String
    /// "confirm", "cancel" or "submit".
    public var tone: String
    public var at: Double
    public var sendId: String?
    public var values: ChatWidgetValues?

    public init(ref: String, label: String, tone: String, at: Double, sendId: String? = nil, values: ChatWidgetValues? = nil) {
        self.ref = ref
        self.label = label
        self.tone = tone
        self.at = at
        self.sendId = sendId
        self.values = values
    }

    private enum CodingKeys: String, CodingKey { case ref, label, tone, at, sendId, values }

    public init(from decoder: any Decoder) throws {
        let box = try decoder.container(keyedBy: CodingKeys.self)
        ref = (try? box.decode(String.self, forKey: .ref)) ?? ""
        label = (try? box.decode(String.self, forKey: .label)) ?? ""
        tone = (try? box.decode(String.self, forKey: .tone)) ?? "confirm"
        at = (try? box.decode(Double.self, forKey: .at)) ?? 0
        sendId = try? box.decodeIfPresent(String.self, forKey: .sendId)
        values = try? box.decodeIfPresent(ChatWidgetValues.self, forKey: .values)
    }
}

/// `message.widget`: the tree, its revision and, once answered, how.
public struct ChatWidgetPayload: Hashable, Sendable, Codable {
    /// Nil when the row carries something that is not a tree: draw its text.
    public var root: ChatWidgetNode?
    /// How many times update_widget replaced the tree. A press names it.
    public var rev: Int
    public var settled: ChatWidgetSettled?
    /// Kept whole so a re-encoded message (the app's cache) loses nothing.
    private var raw: WidgetJSON

    public init(root: ChatWidgetNode?, rev: Int = 0, settled: ChatWidgetSettled? = nil) {
        self.root = root
        self.rev = rev
        self.settled = settled
        raw = .null
    }

    public init(from decoder: any Decoder) throws {
        raw = (try? WidgetJSON(from: decoder)) ?? .null
        let object = raw.object ?? [:]
        root = object["root"].flatMap { ChatWidgetNode(json: $0, fallbackId: "n0") }
        rev = Int(object["rev"]?.number ?? 0)
        if let settledJSON = object["settled"], settledJSON.object != nil,
           let data = try? JSONEncoder().encode(settledJSON) {
            settled = try? JSONDecoder().decode(ChatWidgetSettled.self, from: data)
        } else {
            settled = nil
        }
    }

    public func encode(to encoder: any Encoder) throws {
        if raw != .null {
            try raw.encode(to: encoder)
            return
        }
        var box = encoder.container(keyedBy: DynamicKey.self)
        try box.encode(1, forKey: DynamicKey("v"))
        try box.encode(rev, forKey: DynamicKey("rev"))
        try box.encodeIfPresent(settled, forKey: DynamicKey("settled"))
    }

    private struct DynamicKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ value: String) { stringValue = value }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

/// One pressable thing in a widget.
public struct ChatWidgetActionEntry: Hashable, Sendable {
    /// "confirm", "cancel", or the node id of the button or list item.
    public var ref: String
    /// What the person is recorded as having said.
    public var label: String
    public var type: String
    public var payload: WidgetJSON?
    /// "confirm", "cancel" or "submit" when the press settles the widget.
    public var tone: String?
    /// Handled on the device and never sent (open_url).
    public var client: Bool
    public var kind: String

    /// The address an `open_url` press opens, when it is http(s).
    public var url: URL? {
        guard client, let text = payload?.object?["url"]?.string,
              let url = URL(string: text), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else { return nil }
        return url
    }
}

/// A named field and the words it goes by.
public struct ChatWidgetField: Hashable, Sendable {
    public var name: String
    public var type: String
    /// Its Label's text, else its own label (a list's title), else its name.
    public var label: String
    public var node: ChatWidgetNode
}

public enum ChatWidgetRules {
    public static let fieldTypes: Set<String> = ["Select", "DatePicker", "TimePicker", "DayPicker", "Checkbox", "RadioGroup", "Input", "Textarea"]
    public static let weekdays = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    static let labelLimit = 80

    /// What a row is called: its first Title or Text without a fixed width, on one line.
    public static func firstText(_ node: ChatWidgetNode) -> String {
        var found = ""
        node.walk { inner, _ in
            guard found.isEmpty, inner.type == "Title" || inner.type == "Text",
                  let value = inner.string("value"), inner.number("width") == nil else { return }
            found = String(oneLine(value).prefix(labelLimit))
        }
        return found
    }

    static func oneLine(_ text: String) -> String {
        text.split(whereSeparator: { $0.isWhitespace || $0.isNewline }).joined(separator: " ")
    }

    private static func action(_ json: WidgetJSON?) -> (type: String, payload: WidgetJSON?)? {
        guard let object = json?.object, let type = object["type"]?.string else { return nil }
        return (type, object["payload"])
    }

    /// Every pressable thing in a canonical widget, in document order.
    public static func actions(_ root: ChatWidgetNode) -> [ChatWidgetActionEntry] {
        var found: [(entry: ChatWidgetActionEntry, row: String?, product: Bool)] = []
        root.walk { node, ancestors in
            if node.type == "Button" {
                if node.flag("disabled") { return }
                let form = ancestors.last { $0.type == "Form" }
                let own = action(node["onClickAction"])
                let submitted = node.flag("submit") ? action(form?["onSubmitAction"]) : nil
                guard let picked = own ?? submitted else { return }
                let row = ancestors.last { ["ListViewItem", "Table.Row", "Row", "Product"].contains($0.type) }
                // a product's button always names its product: "Buy now: Trail shoes"
                let product = row?.type == "Product" ? row?.string("title") : nil
                found.append((ChatWidgetActionEntry(
                    ref: node.id, label: node.string("label") ?? "", type: picked.type, payload: picked.payload,
                    tone: node.flag("submit") ? "submit" : nil, client: false, kind: "button"
                ), product ?? row.map(firstText), product != nil))
            } else if node.type == "ListViewItem", let picked = action(node["onClickAction"]) {
                found.append((ChatWidgetActionEntry(
                    ref: node.id, label: firstText(node), type: picked.type, payload: picked.payload,
                    tone: nil, client: false, kind: "item"
                ), nil, false))
            }
        }
        for key in ["confirm", "cancel"] {
            guard let spec = root[key]?.object, let label = spec["label"]?.string, let picked = action(spec["action"]) else { continue }
            found.append((ChatWidgetActionEntry(
                ref: key, label: label, type: picked.type, payload: picked.payload, tone: key, client: false, kind: key
            ), nil, false))
        }
        var counts: [String: Int] = [:]
        for item in found { counts[item.entry.label, default: 0] += 1 }
        return found.map { item in
            var entry = item.entry
            entry.client = entry.type == "open_url"
            if let row = item.row, !entry.label.isEmpty, item.product || (counts[entry.label] ?? 0) > 1 {
                entry.label = String("\(entry.label): \(row)".prefix(labelLimit * 2))
            }
            return entry
        }
    }

    /// Where a press collects its values: the nearest Form around it, or the whole widget.
    public static func scope(_ root: ChatWidgetNode, ref: String) -> ChatWidgetNode {
        var scope = root
        root.walk { node, ancestors in
            if node.id == ref { scope = ancestors.last { $0.type == "Form" } ?? root }
        }
        return scope
    }

    /// The named fields under `scope`. Labels are looked up across `root`.
    public static func fields(_ scope: ChatWidgetNode, root: ChatWidgetNode? = nil) -> [ChatWidgetField] {
        var labels: [String: String] = [:]
        (root ?? scope).walk { node, _ in
            if node.type == "Label", let name = node.string("fieldName"), let value = node.string("value") { labels[name] = value }
        }
        var fields: [ChatWidgetField] = []
        scope.walk { node, _ in
            guard let name = node.string("name"), fieldTypes.contains(node.type) || node.type == "ListView" else { return }
            let own = node.type == "ListView" ? node.string("title") : node.string("label")
            fields.append(ChatWidgetField(name: name, type: node.type, label: labels[name] ?? own ?? name, node: node))
        }
        return fields
    }

    /// What a choice field offers: options, or the rows of a named list.
    public static func options(_ node: ChatWidgetNode) -> [(label: String, value: String)] {
        if node.type == "ListView" {
            return node.children.map { row in
                let value = row.string("value") ?? row.number("value").map(JS.string) ?? ""
                let label = firstText(row)
                return (label.isEmpty ? value : label, value)
            }
        }
        return (node["options"]?.array ?? []).compactMap { option in
            guard let object = option.object, let value = object["value"]?.string else { return nil }
            return (object["label"]?.string ?? value, value)
        }
    }

    /// What each field holds before the person touches it.
    public static func initialValues(_ scope: ChatWidgetNode) -> ChatWidgetValues {
        var values: ChatWidgetValues = [:]
        for field in fields(scope) {
            values[field.name] = field.type == "Checkbox"
                ? .flag(field.node.flag("defaultChecked"))
                : .text(field.node.string("defaultValue") ?? "")
        }
        return values
    }

    /// A required field that a confirming press may not leave empty.
    public static func isEmpty(_ field: ChatWidgetField, in values: ChatWidgetValues) -> Bool {
        if field.type == "Checkbox" { return values[field.name]?.flag != true }
        return (values[field.name]?.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// What a press sends: every field in its scope, or nothing for `cancel`;
    /// or the first required field left empty, which stops it.
    public static func valuesToSend(
        _ root: ChatWidgetNode, entry: ChatWidgetActionEntry, values: ChatWidgetValues
    ) -> (values: ChatWidgetValues?, missing: ChatWidgetField?) {
        guard entry.tone != "cancel" else { return (nil, nil) }
        let scoped = fields(scope(root, ref: entry.ref), root: root)
        if entry.tone != nil, let empty = scoped.first(where: { $0.node.flag("required") && isEmpty($0, in: values) }) {
            return (nil, empty)
        }
        var sending: ChatWidgetValues = [:]
        for field in scoped {
            sending[field.name] = values[field.name] ?? (field.type == "Checkbox" ? .flag(false) : .text(""))
        }
        return (sending, nil)
    }

    /// The fields a Label node names: their own `label` is not drawn twice.
    public static func labelledFields(_ root: ChatWidgetNode) -> Set<String> {
        var names = Set<String>()
        root.walk { node, _ in
            if node.type == "Label", let name = node.string("fieldName") { names.insert(name) }
        }
        return names
    }

    /// Days as a person says them, in English (the recorded form; the card
    /// draws its own localized caption).
    public static func dayList(_ days: String) -> String {
        let picked = days.split(separator: ",").map(String.init).filter { !$0.isEmpty }
        if picked.count == 7 { return "Every day" }
        if picked.joined(separator: ",") == "mon,tue,wed,thu,fri" { return "Weekdays" }
        if picked.joined(separator: ",") == "sat,sun" { return "Weekends" }
        return picked.map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: ", ")
    }

    /// Picked days in week order, as a DayPicker stores them.
    public static func days(_ value: String) -> [String] {
        let picked = Set(value.split(separator: ",").map(String.init))
        return weekdays.filter(picked.contains)
    }
}

public extension Message {
    /// A widget row with a tree this build can draw.
    var drawableWidget: ChatWidgetPayload? {
        guard kind == .widget, let widget, widget.root != nil else { return nil }
        return widget
    }
}

/// How a press went: taken, or not, with the server's sentence when it said no.
public enum ChatWidgetSendResult: Equatable, Sendable {
    case sent
    /// `refused` is the server answering no; without it the request got no
    /// answer and the same sendId may go again.
    case failed(refused: Bool, message: String?)
}

public extension CompanionClient {
    /// A press on a chat widget: the person's next message, on the route a
    /// typed one uses. No `text`: the server writes it from the widget and
    /// the pressed control, sends it as a reply to the widget row, and
    /// patches the row when the press settles it (`message.patch`).
    func sendWidgetAction(
        botId: String, threadId: String?, messageId: String, ref: String, rev: Int,
        values: ChatWidgetValues?, sendId: String
    ) async throws {
        guard Self.validRouteID(botId), Self.validSendID(sendId) else { throw APIError.badURL }
        var press: [String: Any] = ["messageId": messageId, "ref": ref, "rev": rev]
        if let values { press["values"] = values.mapValues(\.wire) }
        var body: [String: Any] = ["sendId": sendId, "widgetAction": press]
        if let threadId { body["threadId"] = threadId }
        try await send(try makeRequest("POST", "/api/bots/\(botId)/messages", body: body))
    }
}

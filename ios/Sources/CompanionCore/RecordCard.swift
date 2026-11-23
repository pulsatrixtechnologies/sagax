// Record cards (#4572, lot S3): the phone's copy of shared/record-cards.ts.
//
// A record of a connected product, named in a bot's message, is a chip
// (`[#481516](sagax://record/<product>/<kind>/<id>)`) that opens a card. The
// card is the organization console's, read as the signed-in person through
// GET /api/me/records/:product/:kind/:id. One model and one parser serve every
// kind: this file names no product and no kind, and branches on neither.
//
// The parser reads as tolerantly as the TypeScript one and enforces the same
// caps; both are checked against the same vectors (shared/record-card-vectors.json):
// an unknown field is dropped, an unknown `type` is read as text, a typed part
// that does not validate is dropped and the row stays text.
import Foundation

public struct RecordRef: Hashable, Codable, Sendable {
    public var product: String
    public var kind: String
    public var id: String

    public init(product: String, kind: String, id: String) {
        self.product = product
        self.kind = kind
        self.id = id
    }
}

// MARK: - Links

public enum RecordLinks {
    public static let prefix = "sagax://record/"
    private static let linkMax = 512

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    public static func validName(_ value: String) -> Bool {
        matches(value, "^[a-z][a-z0-9_]{1,40}$")
    }

    /// `[A-Za-z0-9._:-]{1,128}`, never only dots.
    public static func validId(_ value: String) -> Bool {
        matches(value, "^[A-Za-z0-9._:-]{1,128}$") && !matches(value, "^\\.+$")
    }

    public static func looksLikeLink(_ value: String) -> Bool {
        value.lowercased().hasPrefix(prefix)
    }

    /// A record link's product, kind and id, or nil when it is not one.
    public static func parse(_ href: String) -> RecordRef? {
        guard looksLikeLink(href), href.utf16.count <= linkMax else { return nil }
        let rest = String(href.dropFirst(prefix.count))
        let segments = rest.components(separatedBy: "/")
        guard segments.count == 3 else { return nil }
        var decoded: [String] = []
        for segment in segments {
            if segment.isEmpty || segment.rangeOfCharacter(from: CharacterSet(charactersIn: "?#").union(.whitespacesAndNewlines)) != nil { return nil }
            guard let value = segment.removingPercentEncoding else { return nil }
            decoded.append(value)
        }
        let ref = RecordRef(product: decoded[0], kind: decoded[1], id: decoded[2])
        return validName(ref.product) && validName(ref.kind) && validId(ref.id) ? ref : nil
    }

    public static func parse(_ url: URL) -> RecordRef? {
        parse(url.absoluteString)
    }

    /// `encodeURIComponent`: the characters a record href leaves alone.
    private static let hrefAllowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.!~*'()")
        return set
    }()

    private static func hrefPart(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: hrefAllowed) ?? value
    }

    /// The href of a record link (`recordLink`).
    public static func link(_ ref: RecordRef) -> String {
        prefix + [hrefPart(ref.product), hrefPart(ref.kind), hrefPart(ref.id)].joined(separator: "/")
    }

    /// Link text as Markdown reads it: one line, brackets and backslashes escaped.
    public static func linkText(_ label: String) -> String {
        let flat = label.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return flat
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
    }

    /// `[label](sagax://record/...)` (`recordMarkdown`).
    public static func markdown(label: String, ref: RecordRef) -> String {
        "[\(linkText(label))](\(link(ref)))"
    }

    private static let link = try! NSRegularExpression(pattern: #"\[((?:\\.|[^\]\\\n])*)\]\(\s*(sagax://record/[^)\s]*)[^)]*\)"#, options: [.caseInsensitive])
    private static let bare = try! NSRegularExpression(pattern: #"<?sagax://record/[^\s"'<>)\]]*>?"#, options: [.caseInsensitive])

    /// The words with no record address left: each record link reduced to its
    /// label, any other record address dropped (shared `withoutRecordLinks`).
    public static func withoutLinks(_ text: String) -> String {
        guard text.contains("://"), text.range(of: prefix, options: .caseInsensitive) != nil else { return text }
        var out = text
        let whole = NSRange(out.startIndex..., in: out)
        out = link.stringByReplacingMatches(in: out, options: [], range: whole, withTemplate: "$1")
        return bare.stringByReplacingMatches(in: out, options: [], range: NSRange(out.startIndex..., in: out), withTemplate: "")
    }

    /// The words a record link wore in a message's linked text, for the sheet's
    /// title while the card loads; nil when the link is not there.
    public static func label(of href: String, in recordText: String?) -> String? {
        guard let recordText else { return nil }
        let whole = NSRange(recordText.startIndex..., in: recordText)
        for match in link.matches(in: recordText, options: [], range: whole) {
            guard let hrefRange = Range(match.range(at: 2), in: recordText), let labelRange = Range(match.range(at: 1), in: recordText),
                  recordText[hrefRange].lowercased() == href.lowercased() else { continue }
            let label = String(recordText[labelRange]).replacingOccurrences(of: #"\\(.)"#, with: "$1", options: .regularExpression)
            return label.isEmpty || RecordCardFormat.isGuid(label) ? nil : label
        }
        return nil
    }

    /// The words that draw record chips: `recordText` while it is still the
    /// same message as `text`, else `text` (shared `recordTextOf`).
    public static func chipText(text: String?, recordText: String?) -> String? {
        guard let recordText, let text else { return text }
        return withoutLinks(recordText) == text ? recordText : text
    }
}

// MARK: - The card

public struct RecordCard: Codable, Equatable, Sendable {
    public struct Product: Codable, Equatable, Sendable {
        public struct Icon: Codable, Equatable, Sendable { public var url: String }
        public var id: String
        public var name: String
        public var icon: Icon?
    }

    public struct Kind: Codable, Equatable, Sendable {
        public var id: String
        public var name: String
    }

    public struct State: Codable, Equatable, Sendable {
        public var label: String
        public var tone: String
    }

    public struct Priority: Codable, Equatable, Sendable {
        public var label: String
        public var level: String
    }

    public struct Chip: Codable, Equatable, Sendable {
        public var label: String
        public var tone: String
    }

    public struct Company: Codable, Equatable, Sendable {
        public var name: String
        public var ref: RecordRef?
    }

    public struct Person: Codable, Equatable, Sendable {
        public var role: String
        public var label: String
        public var name: String
        public var detail: String?
        public var ref: RecordRef?
    }

    public struct Field: Codable, Equatable, Sendable {
        public var label: String
        public var value: String
        public var type: String?
        public var amount: String?
        public var currency: String?
        public var at: String?
        public var day: Bool?
        public var share: Double?
        public var ref: RecordRef?
        public var detail: String?
        public var role: String?
        public var tone: String?
    }

    public struct Description: Codable, Equatable, Sendable {
        public var text: String
        public var more: Bool
    }

    public struct Line: Codable, Equatable, Sendable {
        public var label: String
        public var detail: String?
        public var value: String?
        public var ref: RecordRef?
    }

    public struct Lines: Codable, Equatable, Sendable {
        public var state: String
        public var title: String?
        public var items: [Line]
        public var total: Int?
        public var more: Bool
    }

    public struct Note: Codable, Equatable, Sendable {
        public var author: String?
        public var at: String?
        public var isInternal: Bool?
        /// A short marker the product gives the entry (a channel, a kind: "Email", "Time entry").
        public var tag: String?
        public var text: String
        public var more: Bool

        enum CodingKeys: String, CodingKey { case author, at, tag, text, more, isInternal = "internal" }
    }

    public struct Notes: Codable, Equatable, Sendable {
        public var state: String
        public var title: String?
        public var items: [Note]
        public var total: Int?
        public var more: Bool
    }

    public var product: Product
    public var kind: Kind
    public var id: String
    /// The human label (`#481516`, a company's name): never an internal id.
    public var number: String
    public var title: String
    public var state: State?
    public var priority: Priority?
    public var chips: [Chip]?
    public var company: Company?
    public var people: [Person]?
    public var dates: [String: String]?
    public var fields: [Field]?
    public var description: Description?
    public var lines: Lines?
    public var notes: Notes
    public var openUrl: String?
    public var tz: String?
    public var asOf: String?
    public var cached: Bool

    public var ref: RecordRef { RecordRef(product: product.id, kind: kind.id, id: id) }
}

/// What the route answers when there is no card.
public struct RecordCardMiss: Codable, Equatable, Sendable {
    public var state: String
    public var code: String?
    public var retryAfter: Int?
    public var productState: String?
    public var rule: Rule?

    public struct Rule: Codable, Equatable, Sendable {
        public var id: String
        public var text: String
    }

    public init(state: String, code: String? = nil, retryAfter: Int? = nil, productState: String? = nil, rule: Rule? = nil) {
        self.state = state
        self.code = code
        self.retryAfter = retryAfter
        self.productState = productState
        self.rule = rule
    }
}

public enum RecordCardAnswer: Equatable, Sendable {
    case card(RecordCard)
    case miss(RecordCardMiss)
}

// MARK: - The parser

public enum RecordCardParser {
    public static let tones = ["open", "waiting", "done", "alert"]
    public static let levels = ["urgent", "high", "normal", "low"]
    public static let fieldTypes = ["text", "date", "ago", "money", "duration", "percent", "person", "ref", "state"]
    public static let listStates = ["ok", "none", "forbidden", "unavailable"]
    public static let dateKeys = ["opened", "updated", "due", "closed"]
    public static let missStates = ["sign_in", "no_access", "unknown", "not_connected", "busy", "down", "unavailable", "org_refused"]

    private enum Cap {
        static let title = 200, description = 600, note = 400, fieldValue = 120, name = 80, label = 80
        static let people = 4, fields = 10, notes = 3, chips = 2, lines = 6, tag = 24
        static let lineLabel = 160, lineDetail = 80, lineValue = 80, heading = 80
    }

    // MARK: text

    private static func isJSWhitespace(_ scalar: Unicode.Scalar) -> Bool {
        switch scalar.value {
        case 0x09...0x0D, 0x20, 0xA0, 0x1680, 0x2000...0x200A, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF: return true
        default: return false
        }
    }

    private static func jsTrim(_ text: String) -> String {
        var scalars = Array(text.unicodeScalars)
        while let last = scalars.last, isJSWhitespace(last) { scalars.removeLast() }
        var start = 0
        while start < scalars.count, isJSWhitespace(scalars[start]) { start += 1 }
        var out = String.UnicodeScalarView()
        out.append(contentsOf: scalars[start...])
        return String(out)
    }

    /// Plain text: control characters out (tabs and line breaks kept), runs of
    /// blanks collapsed, three line breaks or more made two, trimmed. Nil when
    /// empty or longer than `max` UTF-16 units.
    static func plain(_ value: Any?, max: Int = 2_048) -> String? {
        guard let raw = value as? String else { return nil }
        var kept = String.UnicodeScalarView()
        for scalar in raw.unicodeScalars {
            let code = scalar.value
            if code == 9 || code == 10 || (code >= 32 && code != 127) { kept.append(scalar) }
        }
        var text = String(kept)
        text = text.replacingOccurrences(of: "[ \\t]+", with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: "\\n{3,}", with: "\n\n", options: .regularExpression)
        text = jsTrim(text)
        return !text.isEmpty && text.utf16.count <= max ? text : nil
    }

    /// Text cut on a word to `max` UTF-16 units, with whether it was cut.
    static func cutText(_ value: String, _ max: Int) -> (text: String, cut: Bool) {
        let ns = value as NSString
        if ns.length <= max { return (value, false) }
        let head = ns.substring(to: Swift.max(1, max - 1))
        let headNS = head as NSString
        let space = headNS.range(of: " ", options: .backwards)
        let useSpace = space.location != NSNotFound && Double(space.location) > Double(max) * 0.6
        let cutHead = useSpace ? headNS.substring(to: space.location) : head
        var trimmed = cutHead
        while let last = trimmed.unicodeScalars.last, isJSWhitespace(last) { trimmed.unicodeScalars.removeLast() }
        return (trimmed + "…", true)
    }

    private static func capped(_ value: Any?, _ max: Int) -> (text: String, cut: Bool)? {
        guard let text = plain(value, max: 16_384) else { return nil }
        return cutText(text, max)
    }

    // MARK: pieces

    private static func object(_ value: Any?) -> [String: Any]? {
        value as? [String: Any]
    }

    private static func isBool(_ value: Any?) -> Bool? {
        guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
        return number.boolValue
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double == double.rounded(), double >= 0, double < 9e15 else { return nil }
        return Int(double)
    }

    private static func finite(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        return double.isFinite ? double : nil
    }

    private static func matches(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }

    /// An ISO 8601 day or instant with the same reach as the TypeScript check.
    static func isoDate(_ value: Any?) -> String? {
        guard let text = plain(value, max: 64) else { return nil }
        let pattern = #"^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }
        func group(_ index: Int) -> Int? {
            let range = match.range(at: index)
            guard range.location != NSNotFound, let swiftRange = Range(range, in: text) else { return nil }
            return Int(text[swiftRange])
        }
        guard let month = group(2), let day = group(3), (1...12).contains(month), (1...31).contains(day) else { return nil }
        if let hour = group(4) {
            let minute = group(5) ?? 0
            let second = group(6) ?? 0
            guard hour <= 24, minute <= 59, second <= 59, hour < 24 || (minute == 0 && second == 0) else { return nil }
        }
        return text
    }

    private static func httpsUrl(_ value: Any?) -> String? {
        guard let text = plain(value, max: 2_048), text.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              let components = URLComponents(string: text), components.scheme?.lowercased() == "https",
              components.host?.isEmpty == false, components.user == nil, components.password == nil,
              let url = components.url
        else { return nil }
        return url.absoluteString
    }

    private static func tone(_ value: Any?) -> String {
        if let text = value as? String, tones.contains(text) { return text }
        return "open"
    }

    private static func typedRef(_ value: Any?) -> RecordRef? {
        guard let raw = object(value), let product = raw["product"] as? String, let kind = raw["kind"] as? String, let id = raw["id"] as? String,
              RecordLinks.validName(product), RecordLinks.validName(kind), RecordLinks.validId(id)
        else { return nil }
        return RecordRef(product: product, kind: kind, id: id)
    }

    /// The typed parts of a field: an unknown type, or a type whose own part
    /// does not validate, leaves the row as text.
    private static func apply(typedPartOf raw: [String: Any], to field: inout RecordCard.Field) {
        guard let type = raw["type"] as? String, fieldTypes.contains(type), type != "text" else { return }
        switch type {
        case "money":
            guard let amount = plain(raw["amount"], max: 40), matches(amount, #"^-?\d{1,24}(\.\d{1,12})?$"#) else { return }
            field.type = "money"
            field.amount = amount
            if let currency = plain(raw["currency"], max: 3), matches(currency, "^[A-Z]{3}$") { field.currency = currency }
        case "date", "ago":
            guard let at = isoDate(raw["at"]) else { return }
            if type == "date", isBool(raw["day"]) == true, matches(at, #"^\d{4}-\d{2}-\d{2}$"#) {
                field.type = "date"
                field.at = at
                field.day = true
            } else {
                field.type = type
                field.at = at
            }
        case "percent":
            guard let share = finite(raw["share"]), share >= 0, share <= 100 else { return }
            field.type = "percent"
            field.share = share
        case "person":
            field.type = "person"
            if let detail = capped(raw["detail"], Cap.fieldValue) { field.detail = detail.text }
            if let role = plain(raw["role"], max: 40), matches(role, "^[a-z][a-z0-9_]{0,39}$") { field.role = role }
            if let ref = typedRef(raw["ref"]) { field.ref = ref }
        case "ref":
            guard let ref = typedRef(raw["ref"]) else { return }
            field.type = "ref"
            field.ref = ref
            if let detail = capped(raw["detail"], Cap.fieldValue) { field.detail = detail.text }
        case "state":
            field.type = "state"
            field.tone = tone(raw["tone"])
        default:
            field.type = type
        }
    }

    // MARK: the card

    /// The console's card, read tolerantly: nil without the parts every card
    /// has (product, kind, id, number, title).
    public static func parse(_ rawCard: Any?) -> RecordCard? {
        guard let card = object(rawCard) else { return nil }
        let productRaw = object(card["product"])
        let kindRaw = object(card["kind"])
        guard let productId = productRaw?["id"] as? String, let kindId = kindRaw?["id"] as? String, let id = card["id"] as? String,
              RecordLinks.validName(productId), RecordLinks.validName(kindId), RecordLinks.validId(id),
              let productName = plain(productRaw?["name"], max: 256), let kindName = plain(kindRaw?["name"], max: Cap.label),
              let numberRaw = plain(card["number"], max: 400)?.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression),
              let title = capped(card["title"], Cap.title)
        else { return nil }
        var out = RecordCard(
            product: .init(id: productId, name: productName, icon: nil),
            kind: .init(id: kindId, name: kindName),
            id: id,
            number: cutText(numberRaw, Cap.name).text,
            title: title.text,
            notes: .init(state: "none", title: nil, items: [], total: nil, more: false),
            cached: isBool(card["cached"]) == true
        )
        if let url = httpsUrl(object(productRaw?["icon"])?["url"]) { out.product.icon = .init(url: url) }

        let state = object(card["state"])
        if let label = plain(state?["label"], max: 400) {
            out.state = .init(label: cutText(label, Cap.label).text, tone: tone(state?["tone"]))
        }
        let priority = object(card["priority"])
        if let label = plain(priority?["label"], max: 400) {
            let level = (priority?["level"] as? String).flatMap { levels.contains($0) ? $0 : nil } ?? "normal"
            out.priority = .init(label: cutText(label, Cap.label).text, level: level)
        }
        let company = object(card["company"])
        if let name = capped(company?["name"], Cap.name) {
            out.company = .init(name: name.text, ref: typedRef(company?["ref"]))
        }
        if let list = card["people"] as? [Any] {
            var people: [RecordCard.Person] = []
            for entry in list {
                let person = object(entry)
                guard let person, let name = capped(person["name"], Cap.name), let role = plain(person["role"], max: 40),
                      matches(role, "^[a-z][a-z0-9_]{0,39}$")
                else { continue }
                let label = plain(person["label"], max: 400).map { cutText($0, Cap.label).text } ?? ""
                people.append(.init(role: role, label: label, name: name.text, detail: capped(person["detail"], Cap.fieldValue)?.text, ref: typedRef(person["ref"])))
                if people.count >= Cap.people { break }
            }
            if !people.isEmpty { out.people = people }
        }
        if let dates = object(card["dates"]) {
            var kept: [String: String] = [:]
            for key in dateKeys { if let value = isoDate(dates[key]) { kept[key] = value } }
            if !kept.isEmpty { out.dates = kept }
        }
        if let list = card["chips"] as? [Any] {
            var chips: [RecordCard.Chip] = []
            for entry in list {
                let chip = object(entry)
                guard let chip, let label = plain(chip["label"], max: 400) else { continue }
                chips.append(.init(label: cutText(label, Cap.label).text, tone: tone(chip["tone"])))
                if chips.count >= Cap.chips { break }
            }
            if !chips.isEmpty { out.chips = chips }
        }
        if let list = card["fields"] as? [Any] {
            var fields: [RecordCard.Field] = []
            for entry in list {
                let raw = object(entry)
                guard let raw, let label = plain(raw["label"], max: 400), let value = capped(raw["value"], Cap.fieldValue) else { continue }
                var field = RecordCard.Field(label: cutText(label, Cap.label).text, value: value.text)
                apply(typedPartOf: raw, to: &field)
                fields.append(field)
                if fields.count >= Cap.fields { break }
            }
            if !fields.isEmpty { out.fields = fields }
        }
        let description = object(card["description"])
        if let text = capped(description?["text"], Cap.description) {
            out.description = .init(text: text.text, more: text.cut || isBool(description?["more"]) == true)
        }
        if let lines = object(card["lines"]) {
            let state = (lines["state"] as? String).flatMap { listStates.contains($0) ? $0 : nil } ?? "unavailable"
            var items: [RecordCard.Line] = []
            var dropped = false
            if state == "ok", let list = lines["items"] as? [Any] {
                for entry in list {
                    let line = object(entry)
                    guard let line, let label = capped(line["label"], Cap.lineLabel) else { continue }
                    if items.count >= Cap.lines { dropped = true; break }
                    items.append(.init(label: label.text, detail: capped(line["detail"], Cap.lineDetail)?.text, value: capped(line["value"], Cap.lineValue)?.text, ref: typedRef(line["ref"])))
                }
            }
            let total = integer(lines["total"])
            out.lines = .init(
                state: state,
                title: capped(lines["title"], Cap.heading)?.text,
                items: items,
                total: total,
                more: isBool(lines["more"]) == true || dropped || (total.map { $0 > items.count } ?? false)
            )
        }
        if let notes = object(card["notes"]) {
            let state = (notes["state"] as? String).flatMap { listStates.contains($0) ? $0 : nil } ?? "unavailable"
            var items: [RecordCard.Note] = []
            var dropped = false
            if state == "ok", let list = notes["items"] as? [Any] {
                for entry in list {
                    let note = object(entry)
                    guard let note, let text = capped(note["text"], Cap.note) else { continue }
                    if items.count >= Cap.notes { dropped = true; break }
                    items.append(.init(
                        author: capped(note["author"], Cap.name)?.text,
                        at: isoDate(note["at"]),
                        isInternal: isBool(note["internal"]),
                        tag: capped(note["tag"], Cap.tag)?.text,
                        text: text.text,
                        more: text.cut || isBool(note["more"]) == true
                    ))
                }
            }
            let total = integer(notes["total"])
            out.notes = .init(
                state: state,
                title: capped(notes["title"], Cap.heading)?.text,
                items: items,
                total: total,
                more: isBool(notes["more"]) == true || dropped || (total.map { $0 > items.count } ?? false)
            )
        }
        out.openUrl = httpsUrl(card["open_url"])
        if let tz = plain(card["tz"], max: 64), matches(tz, "^[A-Za-z0-9_+\\-/]{1,64}$") { out.tz = tz }
        out.asOf = isoDate(card["as_of"])
        return out
    }

    /// The route's answer as the app reads it: a card, or a state.
    public static func parseAnswer(_ rawBody: Any?) -> RecordCardAnswer {
        let body = object(rawBody)
        if let body, body["card"] != nil {
            if let card = parse(body["card"]) { return .card(card) }
            return .miss(.init(state: "unavailable"))
        }
        let state = (body?["state"] as? String).flatMap { missStates.contains($0) ? $0 : nil } ?? "unavailable"
        var retry: Int?
        if let seconds = finite(body?["retryAfter"]), seconds > 0 { retry = Int(min(seconds.rounded(.up), 3_600)) }
        let rule = object(body?["rule"])
        var miss = RecordCardMiss(state: state, code: plain(body?["code"], max: 64), retryAfter: retry, productState: plain(body?["productState"], max: 64), rule: nil)
        if let id = plain(rule?["id"], max: 128), let text = plain(rule?["text"], max: 600) { miss.rule = .init(id: id, text: text) }
        return .miss(miss)
    }

    public static func parseAnswer(data: Data) -> RecordCardAnswer {
        let raw = try? JSONSerialization.jsonObject(with: data)
        return parseAnswer(raw)
    }
}

// MARK: - The person's products (which records may open)

/// What the card needs of the product list (`GET /api/me/perspicax/products`):
/// a record opens in place only when the person holds its product and that
/// product describes the kind; any other reference stays plain words.
public struct RecordProducts: Equatable, Sendable {
    public struct Kind: Equatable, Sendable {
        public var kind: String
        public var name: String
    }

    public struct Product: Equatable, Sendable {
        public var id: String
        public var name: String
        public var kinds: [Kind]
    }

    public var products: [Product]

    public init(products: [Product] = []) { self.products = products }

    public func product(_ id: String) -> Product? { products.first { $0.id == id } }

    public func canOpen(_ ref: RecordRef) -> Bool {
        product(ref.product)?.kinds.contains { $0.kind == ref.kind } == true
    }

    public func kindName(_ ref: RecordRef) -> String? {
        product(ref.product)?.kinds.first { $0.kind == ref.kind }?.name
    }

    /// Read tolerantly from the route's `{ products: [...] }`; a kind's name is
    /// the person's language, else English, else the other.
    public static func parse(_ raw: Any?, language: String) -> RecordProducts {
        guard let list = (raw as? [String: Any])?["products"] as? [Any] else { return .init() }
        let wantsFrench = language.lowercased().hasPrefix("fr")
        var out: [Product] = []
        for entry in list {
            guard let item = entry as? [String: Any], let id = item["id"] as? String, RecordLinks.validName(id) else { continue }
            var kinds: [Kind] = []
            var seen = Set<String>()
            for kindEntry in (item["records"] as? [Any] ?? []) {
                guard let record = kindEntry as? [String: Any], let kind = record["kind"] as? String, RecordLinks.validName(kind), !seen.contains(kind) else { continue }
                let names = record["name"] as? [String: Any]
                let single = record["name"] as? String
                let en = names?["en"] as? String ?? single
                let fr = names?["fr"] as? String
                guard let name = (wantsFrench ? fr ?? en : en ?? fr), !name.isEmpty else { continue }
                seen.insert(kind)
                kinds.append(.init(kind: kind, name: name))
            }
            out.append(.init(id: id, name: item["name"] as? String ?? id, kinds: kinds))
        }
        return .init(products: out)
    }
}

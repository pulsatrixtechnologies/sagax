// The rules behind the chat's rich blocks, ported from the desktop's
// `src/lib/rich-blocks.ts` so both clients read the same fences the same
// way: email drafts, widgets, charts, CSV tables and the table toolbar's
// copy, sort and filter. Every function takes model text as untrusted input
// and returns plain data or strings; the views stay thin and each rule is
// unit-tested on its own (Tests/CompanionCoreTests/RichBlocksTests.swift,
// cases copied from `src/lib/rich-blocks.test.ts`).
//
// Fence conventions the bots are taught (server/system-prompt.ts) and the
// renderer recognizes:
//   ```email   To/Cc/Bcc/Subject header lines, a blank line, then the body
//   ```widget  a self-contained HTML/CSS/JS snippet, run in a sandbox
//   ```artifact  HTML (same as widget) or JSON {title, url} for a published page
//   ```chart   a JSON spec or CSV rows, drawn without scripts
//   ```csv / ```tsv  a data table with sort, filter and copy
// Claude harness <antArtifact> tags are rewritten by liftClaudeChatBlocks
// (`shared/claude-chat-blocks.ts` on the desktop).
import Foundation

public enum RichFenceKind: String, Sendable {
    case email, widget, chart, csv, cw
}

public enum RichBlocks {
    private static let fenceKinds: [String: RichFenceKind] = [
        "email": .email, "mail": .email, "eml": .email,
        "widget": .widget, "html-widget": .widget, "widget-imperfect": .widget, "artifact": .widget,
        "chart": .chart,
        "csv": .csv, "tsv": .csv,
        "cw": .cw,
    ]

    /// The rich renderer a fence language asks for, if any.
    public static func fenceKind(_ lang: String) -> RichFenceKind? {
        fenceKinds[lang.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()]
    }
}

// MARK: - JavaScript-compatible helpers

/// Small pieces of JavaScript's string and number behaviour the desktop's
/// rules lean on, so a port reads the same as its source.
enum JS {
    /// `String(number)` for the values a chart or a table holds.
    static func string(_ value: Double) -> String {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
        if value == value.rounded(), abs(value) < 1e21 {
            return String(format: "%.0f", value == 0 ? 0 : value)
        }
        var text = "\(value)"
        // Swift writes 1e-07; JavaScript writes 1e-7
        if let range = text.range(of: #"e([+-])0*(\d)"#, options: .regularExpression) {
            let match = String(text[range])
            let sign = match.contains("-") ? "-" : "+"
            let digits = match.drop(while: { !$0.isNumber || $0 == "0" })
            text.replaceSubrange(range, with: "e\(sign)\(digits)")
        }
        return text
    }

    /// `Number(value.toPrecision(digits))`.
    static func precision(_ value: Double, _ digits: Int) -> Double {
        guard value.isFinite, value != 0 else { return value }
        return Double(String(format: "%.\(digits)g", value)) ?? value
    }

    /// `encodeURIComponent`.
    static func encodeURIComponent(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)...Unicode.Scalar(127)))
        allowed.insert(charactersIn: "-_.!~*'()")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }

    static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression {
        // SAFETY: every pattern is a literal in this file, covered by the tests.
        try! NSRegularExpression(pattern: pattern, options: options)
    }

    static func replace(
        _ text: String,
        _ regex: NSRegularExpression,
        with transform: ([String?]) -> String
    ) -> String {
        let source = text as NSString
        var out = ""
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            out += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            let groups = (0..<match.numberOfRanges).map { index -> String? in
                let range = match.range(at: index)
                return range.location == NSNotFound ? nil : source.substring(with: range)
            }
            out += transform(groups)
            cursor = match.range.location + match.range.length
        }
        out += source.substring(from: cursor)
        return out
    }

    static func test(_ regex: NSRegularExpression, _ text: String) -> Bool {
        regex.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil
    }

    static func trim(_ text: String) -> String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

// MARK: - Email

public struct EmailDraft: Equatable, Hashable, Sendable {
    public var from: String?
    public var to: [String]
    public var cc: [String]
    public var bcc: [String]
    public var subject: String
    public var body: String

    public init(from: String? = nil, to: [String] = [], cc: [String] = [], bcc: [String] = [], subject: String = "", body: String = "") {
        self.from = from
        self.to = to
        self.cc = cc
        self.bcc = bcc
        self.subject = subject
        self.body = body
    }
}

extension RichBlocks {
    private static let emailHeader = JS.regex(#"^(from|to|cc|bcc|subject|reply-to)\s*:\s?(.*)$"#, [.caseInsensitive])
    private static let plainLangs: Set<String> = ["", "text", "txt", "plain", "plaintext", "markdown", "md"]

    /// Split an address header on commas and semicolons, dropping empties. A
    /// display name with a comma inside quotes stays whole.
    public static func splitAddresses(_ value: String) -> [String] {
        var out: [String] = []
        var current = ""
        var quoted = false
        var angle = 0
        for character in value {
            if character == "\"" { quoted.toggle() }
            else if character == "<" { angle += 1 }
            else if character == ">" { angle = max(0, angle - 1) }
            if (character == "," || character == ";") && !quoted && angle == 0 {
                if !JS.trim(current).isEmpty { out.append(JS.trim(current)) }
                current = ""
                continue
            }
            current.append(character)
        }
        if !JS.trim(current).isEmpty { out.append(JS.trim(current)) }
        return out
    }

    /// Read an email draft from a fence body. With an explicit email fence the
    /// headers are optional (a bare body is still an email); a plain text
    /// fence only counts when it opens with a Subject header and at least one
    /// recipient or sender header, so ordinary snippets never turn into cards.
    public static func parseEmailBlock(_ code: String, lang: String = "email") -> EmailDraft? {
        let explicit = fenceKind(lang) == .email
        if !explicit && !plainLangs.contains(JS.trim(lang).lowercased()) { return nil }
        let lines = code.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n")
        var index = 0
        while index < lines.count && JS.trim(lines[index]).isEmpty { index += 1 }
        var draft = EmailDraft()
        var headers = 0
        var sawSubject = false
        while index < lines.count {
            let line = lines[index]
            if JS.trim(line).isEmpty {
                index += 1
                break
            }
            let ns = line as NSString
            guard let match = emailHeader.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) else { break }
            headers += 1
            let key = ns.substring(with: match.range(at: 1)).lowercased()
            let value = JS.trim(ns.substring(with: match.range(at: 2)))
            switch key {
            case "subject":
                draft.subject = value
                sawSubject = true
            case "from": draft.from = value
            case "to": draft.to += splitAddresses(value)
            case "cc": draft.cc += splitAddresses(value)
            case "bcc": draft.bcc += splitAddresses(value)
            default: break
            }
            index += 1
        }
        if !explicit && (!sawSubject || headers < 2) { return nil }
        let bodyLines = headers == 0 ? lines : Array(lines[min(index, lines.count)...])
        var body = bodyLines.joined(separator: "\n")
        while body.hasPrefix("\n") { body.removeFirst() }
        while let last = body.last, last.isWhitespace { body.removeLast() }
        draft.body = body
        if !explicit && draft.body.isEmpty { return nil }
        return draft
    }

    private static let bold = JS.regex(#"\*\*(.+?)\*\*"#)
    private static let underline = JS.regex(#"__(.+?)__"#)
    private static let italic = JS.regex(#"(^|[^*A-Za-z0-9_])\*(?!\s)(.+?)\*(?![A-Za-z0-9_])"#)
    private static let image = JS.regex(#"!\[([^\]]*)\]\([^)]*\)"#)
    private static let link = JS.regex(#"\[([^\]]+)\]\(([^)\s]+)\)"#)
    private static let heading = JS.regex(#"^#{1,6}\s+"#, [.anchorsMatchLines])
    private static let codeSpan = JS.regex(#"`([^`]+)`"#)

    /// Markdown-light body as the plain text a mail client or clipboard
    /// wants: emphasis markers and link syntax are removed, line structure
    /// is kept.
    public static func emailPlainBody(_ body: String) -> String {
        var text = JS.replace(body, bold) { $0[1] ?? "" }
        text = JS.replace(text, underline) { $0[1] ?? "" }
        text = JS.replace(text, italic) { ($0[1] ?? "") + ($0[2] ?? "") }
        text = JS.replace(text, image) { $0[1] ?? "" }
        text = JS.replace(text, link) { groups in
            let label = groups[1] ?? ""
            let url = groups[2] ?? ""
            return label == url ? url : "\(label) (\(url))"
        }
        text = JS.replace(text, heading) { _ in "" }
        return JS.replace(text, codeSpan) { $0[1] ?? "" }
    }

    /// The whole draft as copyable plain text, headers first.
    public static func emailPlainText(_ draft: EmailDraft) -> String {
        let head = [
            draft.from.map { "From: \($0)" } ?? "",
            draft.to.isEmpty ? "" : "To: \(draft.to.joined(separator: ", "))",
            draft.cc.isEmpty ? "" : "Cc: \(draft.cc.joined(separator: ", "))",
            draft.bcc.isEmpty ? "" : "Bcc: \(draft.bcc.joined(separator: ", "))",
            draft.subject.isEmpty ? "" : "Subject: \(draft.subject)",
        ].filter { !$0.isEmpty }
        let body = emailPlainBody(draft.body)
        return head.isEmpty ? body : "\(head.joined(separator: "\n"))\n\n\(body)"
    }

    /// Longest mailto URL handed to the OS; a long body is left out (the
    /// card copies it to the clipboard instead).
    public static let mailtoMaxLength = 1900

    private static func bareAddress(_ value: String) -> String {
        if let open = value.firstIndex(of: "<"),
           let close = value[open...].firstIndex(of: ">"),
           value.index(after: open) < close {
            let inside = value[value.index(after: open)..<close]
            if !inside.contains("<") { return JS.trim(String(inside)) }
        }
        return JS.trim(value)
    }

    private static func encodeAddress(_ value: String) -> String {
        JS.encodeURIComponent(bareAddress(value)).replacingOccurrences(of: "%40", with: "@")
    }

    public static func emailMailtoURL(_ draft: EmailDraft, maxLength: Int = mailtoMaxLength) -> (url: String, bodyIncluded: Bool) {
        func params(_ withBody: Bool) -> String {
            var parts: [String] = []
            if !draft.cc.isEmpty { parts.append("cc=\(draft.cc.map(encodeAddress).joined(separator: ","))") }
            if !draft.bcc.isEmpty { parts.append("bcc=\(draft.bcc.map(encodeAddress).joined(separator: ","))") }
            if !draft.subject.isEmpty { parts.append("subject=\(JS.encodeURIComponent(draft.subject))") }
            if withBody && !draft.body.isEmpty {
                let plain = emailPlainBody(draft.body)
                    .replacingOccurrences(of: "\r\n", with: "\n")
                    .replacingOccurrences(of: "\n", with: "\r\n")
                parts.append("body=\(JS.encodeURIComponent(plain))")
            }
            return parts.isEmpty ? "" : "?\(parts.joined(separator: "&"))"
        }
        let base = "mailto:\(draft.to.map(encodeAddress).joined(separator: ","))"
        let full = base + params(true)
        if full.utf16.count <= maxLength || draft.body.isEmpty { return (full, !draft.body.isEmpty) }
        return (base + params(false), false)
    }
}

// MARK: - Widgets

extension RichBlocks {
    /// The only sandbox token a widget frame ever gets: scripts run, in an
    /// opaque origin with no same-origin access, forms, popups, top
    /// navigation or downloads.
    public static let widgetSandbox = "allow-scripts"

    /// Content Security Policy stamped as the first element of every widget
    /// document. No network at all.
    public static let widgetCSP = [
        "default-src 'none'",
        "script-src 'unsafe-inline'",
        "style-src 'unsafe-inline'",
        "img-src data: blob:",
        "media-src data: blob:",
        "font-src data:",
        "connect-src 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "object-src 'none'",
        "form-action 'none'",
        "base-uri 'none'",
    ].joined(separator: "; ")

    public static let widgetMessage = "omb-widget-size"
    public static let widgetMinHeight = 48.0
    public static let widgetMaxHeight = 1600.0

    /// Clamp a height a widget reported; garbage becomes nil (ignored).
    public static func clampWidgetHeight(_ value: Any?) -> Double? {
        guard let number = value as? Double ?? (value as? Int).map(Double.init), number.isFinite,
              !(value is Bool) else { return nil }
        return min(max(number, widgetMinHeight), widgetMaxHeight).rounded()
    }

    /// The document a widget runs in. The CSP meta comes before any widget
    /// byte; the size reporter is ours and posts only a number.
    public static func widgetDocument(_ source: String, dark: Bool) -> String {
        let scheme = dark ? "dark" : "light"
        let base = ":root{color-scheme:\(scheme);--omb-bg:\(dark ? "#1b1b1b" : "#ffffff");--omb-fg:\(dark ? "#f2f2f2" : "#161616");--omb-muted:\(dark ? "#a3a3a3" : "#5c5c5c");--omb-border:\(dark ? "#3a3a3a" : "#dedede");--omb-accent:\(dark ? "#3987e5" : "#2a78d6")}"
            + "html,body{margin:0;padding:0}body{padding:12px;background:var(--omb-bg);color:var(--omb-fg);font:13px/20px Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;overflow-x:auto}"
            + "button,input,select,textarea{font:inherit}*,*::before,*::after{box-sizing:border-box}"
            + "label:has(>input[type=checkbox],>input[type=radio]){display:flex;flex-direction:row;align-items:flex-start;gap:8px;width:auto}"
            + "label,button,input[type=range],input[type=checkbox],input[type=radio]{-webkit-user-select:none;user-select:none}"
            + "@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}}"
        let reporter = "(function(){var last=0;function send(){var h=Math.ceil(Math.max(document.documentElement.scrollHeight,document.body?document.body.scrollHeight:0));if(h!==last){last=h;parent.postMessage({type:\"\(widgetMessage)\",height:h},\"*\");}}"
            + "addEventListener('load',send);if(typeof ResizeObserver!=='undefined'){new ResizeObserver(send).observe(document.documentElement);}setTimeout(send,50);setTimeout(send,500);})();"
        return "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"\(widgetCSP)\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>\(base)</style><script>\(reporter)</script></head><body>\(source)</body></html>"
    }
}

// MARK: - Tables and delimited data

public enum RichColumnAlign: String, Equatable, Sendable {
    case left, right, center
}

public struct RichSort: Equatable, Sendable {
    public enum Direction: String, Sendable { case asc, desc }
    public var column: Int
    public var direction: Direction

    public init(column: Int, direction: Direction) {
        self.column = column
        self.direction = direction
    }
}

extension RichBlocks {
    /// Parse one CSV/TSV document. Quotes follow RFC 4180 ("" is a quote);
    /// the delimiter is a tab when the first line has one, a semicolon when
    /// the header has only semicolons, otherwise a comma. Rows are capped.
    public static func parseDelimited(_ text: String, delimiter: Character? = nil, maxRows: Int = 5000) -> [[String]] {
        var source = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        while source.hasPrefix("\n") { source.removeFirst() }
        while source.hasSuffix("\n") { source.removeLast() }
        if source.isEmpty { return [] }
        let firstLine = source.components(separatedBy: "\n")[0]
        let sep: Character = delimiter ?? (firstLine.contains("\t")
            ? "\t"
            : (!firstLine.contains(",") && firstLine.contains(";")) ? ";" : ",")
        var rows: [[String]] = []
        var row: [String] = []
        var cell = ""
        var quoted = false
        let characters = Array(source)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            if quoted {
                if character == "\"" {
                    if index + 1 < characters.count, characters[index + 1] == "\"" {
                        cell.append("\"")
                        index += 1
                    } else {
                        quoted = false
                    }
                } else {
                    cell.append(character)
                }
                index += 1
                continue
            }
            if character == "\"" && JS.trim(cell).isEmpty {
                cell = ""
                quoted = true
            } else if character == sep {
                row.append(JS.trim(cell))
                cell = ""
            } else if character == "\n" {
                row.append(JS.trim(cell))
                rows.append(row)
                if rows.count >= maxRows { return rows }
                row = []
                cell = ""
            } else {
                cell.append(character)
            }
            index += 1
        }
        row.append(JS.trim(cell))
        rows.append(row)
        return rows
    }

    private static let numberShape = JS.regex("^[+-]?(?:\\d{1,3}(?:[,\u{00A0}\u{202F} ]\\d{3})+|\\d+)?(?:\\.\\d+)?(?:e[+-]?\\d+)?$", [.caseInsensitive])
    private static let currencyPrefix = JS.regex(#"^([+-]?)\s*(?:[$€£¥₹]|USD|CAD|EUR)\s*"#, [.caseInsensitive])
    private static let currencySuffix = JS.regex(#"\s*(?:[$€£¥₹%]|USD|CAD|EUR)$"#, [.caseInsensitive])

    /// A table cell read as a number: currency signs, percent, thousands
    /// separators, a Unicode minus and accounting parentheses are
    /// understood. Anything else, including an empty cell, is nil.
    public static func parseNumeric(_ value: String) -> Double? {
        var text = JS.trim(value)
        if text.isEmpty { return nil }
        var negative = false
        if text.count >= 2, text.hasPrefix("("), text.hasSuffix(")") {
            negative = true
            text = JS.trim(String(text.dropFirst().dropLast()))
        }
        text = text.replacingOccurrences(of: "\u{2212}", with: "-")
        text = JS.replace(text, currencyPrefix) { $0[1] ?? "" }
        text = JS.replace(text, currencySuffix) { _ in "" }
        guard !text.isEmpty, text.contains(where: \.isASCIIDigit), JS.test(numberShape, text) else { return nil }
        let digits = text.filter { !",\u{00A0}\u{202F} ".contains($0) }
        guard let number = Double(digits), number.isFinite else { return nil }
        return negative ? -number : number
    }

    /// Columns whose every non-empty body cell is a number (and at least one is).
    public static func numericColumns(_ rows: [[String]], width: Int) -> [Bool] {
        (0..<max(0, width)).map { column in
            var seen = 0
            for row in rows {
                let value = column < row.count ? row[column] : ""
                if JS.trim(value).isEmpty { continue }
                if parseNumeric(value) == nil { return false }
                seen += 1
            }
            return seen > 0
        }
    }

    /// Sort order for two cells; empties always sink to the bottom.
    public static func compareCells(_ left: String, _ right: String, numeric: Bool) -> Int {
        let leftEmpty = JS.trim(left).isEmpty
        let rightEmpty = JS.trim(right).isEmpty
        if leftEmpty || rightEmpty { return leftEmpty == rightEmpty ? 0 : leftEmpty ? 1 : -1 }
        if numeric, let a = parseNumeric(left), let b = parseNumeric(right) {
            return a < b ? -1 : a > b ? 1 : 0
        }
        switch left.compare(right, options: [.caseInsensitive, .diacriticInsensitive, .numeric, .widthInsensitive]) {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }

    /// Row indices after filtering by a case-insensitive query and sorting.
    public static func visibleRowOrder(_ rows: [[String]], query: String = "", sort: RichSort? = nil, numeric: [Bool] = []) -> [Int] {
        let needle = JS.trim(query).lowercased()
        var order = rows.indices.filter { index in
            needle.isEmpty || rows[index].contains { $0.lowercased().contains(needle) }
        }
        if let sort {
            let factor = sort.direction == .asc ? 1 : -1
            let isNumeric = sort.column < numeric.count ? numeric[sort.column] : false
            func cell(_ index: Int) -> String {
                sort.column < rows[index].count ? rows[index][sort.column] : ""
            }
            order = order.sorted { a, b in
                let left = cell(a)
                let right = cell(b)
                let result: Int
                if JS.trim(left).isEmpty || JS.trim(right).isEmpty {
                    result = compareCells(left, right, numeric: false)
                } else {
                    result = compareCells(left, right, numeric: isNumeric) * factor
                }
                return result != 0 ? result < 0 : a < b
            }
        }
        return order
    }

    /// Next state when a header is tapped: ascending, descending, off.
    public static func nextSort(_ current: RichSort?, column: Int) -> RichSort? {
        guard let current, current.column == column else { return RichSort(column: column, direction: .asc) }
        return current.direction == .asc ? RichSort(column: column, direction: .desc) : nil
    }

    private static let csvNeedsQuotes = JS.regex(#"[",\n\r]"#)
    private static let csvFormula = JS.regex(#"^[=+\-@\t\r]"#)

    private static func csvCell(_ value: String) -> String {
        let edges = value.first.map { $0.isWhitespace } == true || value.last.map { $0.isWhitespace } == true
        if JS.test(csvNeedsQuotes, value) || edges {
            return "\"\(value.replacingOccurrences(of: "\"", with: "\"\""))\""
        }
        return value
    }

    /// RFC 4180 CSV with CRLF line ends. A cell that starts with a formula
    /// trigger is prefixed with a quote so a pasted table cannot run a
    /// spreadsheet formula.
    public static func tableToCSV(header: [String], rows: [[String]]) -> String {
        func safe(_ value: String) -> String {
            csvCell(JS.test(csvFormula, value) && parseNumeric(value) == nil ? "'\(value)" : value)
        }
        return ([header] + rows).map { $0.map(safe).joined(separator: ",") }.joined(separator: "\r\n")
    }

    private static func mdCell(_ value: String) -> String {
        value.replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "|", with: "\\|")
            .replacingOccurrences(of: "\r\n", with: " ")
            .replacingOccurrences(of: "\n", with: " ")
    }

    /// GitHub-flavored Markdown for the table as currently shown.
    public static func tableToMarkdown(header: [String], rows: [[String]], align: [RichColumnAlign?] = []) -> String {
        let width = ([header.count] + rows.map(\.count)).max() ?? 0
        func cells(_ row: [String]) -> String {
            "| " + (0..<width).map { mdCell($0 < row.count ? row[$0] : "") }.joined(separator: " | ") + " |"
        }
        let rule = "| " + (0..<width).map { index -> String in
            switch index < align.count ? align[index] : nil {
            case .right: "---:"
            case .center: ":---:"
            case .left: ":---"
            case nil: "---"
            }
        }.joined(separator: " | ") + " |"
        return ([cells(header), rule] + rows.map(cells)).joined(separator: "\n")
    }
}

private extension Character {
    var isASCIIDigit: Bool { ("0"..."9").contains(self) }
}

// MARK: - Charts

public enum ChartType: String, Equatable, Sendable {
    case bar, line, area, pie
}

public struct ChartSeries: Equatable, Sendable {
    public var name: String
    public var values: [Double?]

    public init(name: String, values: [Double?]) {
        self.name = name
        self.values = values
    }
}

public struct ChartSpec: Equatable, Sendable {
    public var type: ChartType
    public var title: String?
    public var xLabel: String?
    public var yLabel: String?
    public var labels: [String]
    public var series: [ChartSeries]
    /// Series dropped past the palette's eight slots.
    public var truncatedSeries: Int
}

extension RichBlocks {
    public static let chartMaxSeries = 8
    public static let chartMaxPoints = 500

    private static let chartTypes: [String: ChartType] = [
        "bar": .bar, "column": .bar, "line": .line, "area": .area,
        "pie": .pie, "donut": .pie, "doughnut": .pie,
    ]

    private static func chartType(_ value: OrderedJSON?) -> ChartType {
        guard case let .string(text)? = value else { return .bar }
        return chartTypes[JS.trim(text).lowercased()] ?? .bar
    }

    private static func chartType(_ text: String) -> ChartType {
        chartTypes[JS.trim(text).lowercased()] ?? .bar
    }

    private static func asText(_ value: OrderedJSON?) -> String? {
        guard case let .string(text)? = value else { return nil }
        return asText(text)
    }

    private static func asText(_ text: String) -> String? {
        let trimmed = JS.trim(text)
        return trimmed.isEmpty ? nil : String(trimmed.prefix(200))
    }

    private static func chartNumber(_ value: OrderedJSON?) -> Double? {
        switch value {
        case let .number(number)?: return number.isFinite ? number : nil
        case let .string(text)?: return parseNumeric(text)
        default: return nil
        }
    }

    private static func finishChart(
        type: ChartType, title: String?, xLabel: String?, yLabel: String?,
        labels allLabels: [String], series allSeries: [ChartSeries]
    ) -> Result<ChartSpec, ChartError> {
        let labels = Array(allLabels.prefix(chartMaxPoints))
        let usable = allSeries
            .map { series in
                ChartSeries(
                    name: String(series.name.prefix(120)),
                    values: labels.indices.map { $0 < series.values.count ? series.values[$0] : nil }
                )
            }
            .filter { $0.values.contains { $0 != nil } }
        if labels.isEmpty || usable.isEmpty { return .failure(ChartError("no numeric data")) }
        let series = Array(usable.prefix(type == .pie ? 1 : chartMaxSeries))
        let truncated = usable.count - series.count
        if type == .pie && labels.count > chartMaxSeries {
            // a ninth hue is never generated: the smallest slices fold into "Other"
            let values = series[0].values
            let keep = labels.indices
                .sorted { a, b in
                    let left = values[a] ?? 0
                    let right = values[b] ?? 0
                    return left != right ? left > right : a < b
                }
                .prefix(chartMaxSeries - 1)
                .sorted()
            let other = values.indices.reduce(0.0) { sum, index in
                keep.contains(index) ? sum : sum + max(0, values[index] ?? 0)
            }
            return .success(ChartSpec(
                type: type, title: title, xLabel: xLabel, yLabel: yLabel,
                labels: keep.map { labels[$0] } + ["Other"],
                series: [ChartSeries(name: series[0].name, values: keep.map { values[$0] } + [other])],
                truncatedSeries: truncated
            ))
        }
        return .success(ChartSpec(type: type, title: title, xLabel: xLabel, yLabel: yLabel, labels: labels, series: series, truncatedSeries: truncated))
    }

    public struct ChartError: Error, Equatable, Sendable {
        public let reason: String
        init(_ reason: String) { self.reason = reason }
    }

    private static let chartHeaderLine = JS.regex(#"^(type|title)\s*:"#, [.caseInsensitive])

    /// Read a ```chart fence. JSON comes in three spellings models write:
    ///   {"type","labels":[..],"series":[{"name","data":[..]}]}
    ///   {"type","x":"month","y":["a","b"],"data":[{"month":..,"a":..}]}
    ///   {"type","labels":[..],"datasets":[{"label","data":[..]}]}   (Chart.js)
    /// Anything else is CSV: a header row, labels in the first column and
    /// one numeric series per remaining column; an optional first line
    /// "type: line" picks the chart type.
    public static func parseChartSpec(_ code: String) -> Result<ChartSpec, ChartError> {
        let text = JS.trim(code)
        if text.isEmpty { return .failure(ChartError("empty chart")) }
        if text.hasPrefix("{") {
            let raw: OrderedJSON
            do { raw = try OrderedJSON.parse(text) } catch {
                return .failure(ChartError((error as? OrderedJSON.ParseError)?.message ?? "invalid JSON"))
            }
            guard case let .object(fields) = raw else { return .failure(ChartError("chart JSON must be an object")) }
            func field(_ key: String) -> OrderedJSON? { fields.first { $0.0 == key }?.1 }
            func firstText(_ keys: String...) -> String? {
                for key in keys { if let value = field(key), value != .null { return asText(value) } }
                return nil
            }
            let type = chartType(field("type"))
            let title = asText(field("title"))
            let xLabel = firstText("xLabel", "x_label", "xAxis")
            let yLabel = firstText("yLabel", "y_label", "yAxis")
            if case let .array(items)? = field("data"), items.allSatisfy({ if case .object = $0 { return true }; return false }) {
                let rows = items.map { item -> [(String, OrderedJSON)] in
                    if case let .object(pairs) = item { return pairs }
                    return []
                }
                let keys = rows.first?.map(\.0) ?? []
                let x: String?
                if case let .string(name)? = field("x") { x = name } else { x = keys.first }
                guard let x else { return .failure(ChartError("chart data has no columns")) }
                let ys: [String]
                switch field("y") {
                case let .array(list)?: ys = list.compactMap { if case let .string(key) = $0 { return key }; return nil }
                case let .string(key)?: ys = [key]
                default: ys = keys.filter { $0 != x }
                }
                func value(_ row: [(String, OrderedJSON)], _ key: String) -> OrderedJSON? {
                    row.first { $0.0 == key }?.1
                }
                return finishChart(
                    type: type, title: title, xLabel: xLabel, yLabel: yLabel,
                    labels: rows.map { (value($0, x) ?? .null).jsString(nullAs: "") },
                    series: ys.map { key in ChartSeries(name: key, values: rows.map { chartNumber(value($0, key)) }) }
                )
            }
            var labels: [String]?
            if case let .array(list)? = field("labels") { labels = list.map { $0.jsString(nullAs: "") } }
            var entries: [OrderedJSON]?
            if case let .array(list)? = field("series") { entries = list }
            else if case let .array(list)? = field("datasets") { entries = list }
            if let labels, let entries {
                let series = entries.enumerated().flatMap { index, entry -> [ChartSeries] in
                    switch entry {
                    case let .array(values):
                        return [ChartSeries(name: "Series \(index + 1)", values: values.map(chartNumber))]
                    case let .object(pairs):
                        func get(_ key: String) -> OrderedJSON? { pairs.first { $0.0 == key }?.1 }
                        var data: [OrderedJSON] = []
                        if case let .array(list)? = get("data") { data = list }
                        else if case let .array(list)? = get("values") { data = list }
                        let nameValue = get("name").flatMap { $0 == .null ? nil : $0 } ?? get("label")
                        return [ChartSeries(name: asText(nameValue) ?? "Series \(index + 1)", values: data.map(chartNumber))]
                    default:
                        return []
                    }
                }
                return finishChart(type: type, title: title, xLabel: xLabel, yLabel: yLabel, labels: labels, series: series)
            }
            return .failure(ChartError("chart JSON needs labels with series, or data rows"))
        }
        var lines = text.components(separatedBy: "\n").map { $0.hasSuffix("\r") ? String($0.dropLast()) : $0 }
        var type = ChartType.bar
        var title: String?
        while let first = lines.first, JS.test(chartHeaderLine, first) {
            lines.removeFirst()
            let parts = first.components(separatedBy: ":")
            let rest = parts.dropFirst().joined(separator: ":")
            if JS.trim(parts[0]).lowercased() == "type" { type = chartType(rest) } else { title = asText(rest) }
        }
        let rows = parseDelimited(lines.joined(separator: "\n"))
        if rows.count < 2 { return .failure(ChartError("CSV chart needs a header row and data")) }
        let header = rows[0]
        let body = Array(rows.dropFirst())
        return finishChart(
            type: type, title: title,
            xLabel: header.first.flatMap { $0.isEmpty ? nil : $0 }, yLabel: nil,
            labels: body.map { $0.first ?? "" },
            series: header.dropFirst().enumerated().map { column, name in
                ChartSeries(
                    name: name.isEmpty ? "Series \(column + 1)" : name,
                    values: body.map { parseNumeric(column + 1 < $0.count ? $0[column + 1] : "") }
                )
            }
        )
    }

    /// Round-number axis ticks covering [min, max].
    public static func niceTicks(_ low: Double, _ high: Double, count: Int = 5) -> [Double] {
        guard low.isFinite, high.isFinite else { return [0] }
        var min = low
        var max = high
        if min == max {
            if min == 0 { return [0, 1] }
            let pad = abs(min) * 0.1
            min -= pad
            max += pad
        }
        let span = max - min
        let raw = span / Double(Swift.max(1, count))
        let power = pow(10, floor(log10(raw)))
        let step = [1, 2, 2.5, 5, 10].map { $0 * power }.first { span / $0 <= Double(count) } ?? 10 * power
        let start = floor(min / step) * step
        let end = ceil(max / step) * step
        var ticks: [Double] = []
        var value = start
        while value <= end + step / 2 {
            ticks.append(JS.precision(value, 12))
            value += step
        }
        return ticks
    }

    /// Compact tick label: 1.2k, 3.4M; small values keep their digits.
    public static func formatTick(_ value: Double) -> String {
        let magnitude = abs(value)
        if magnitude >= 1e9 { return "\(JS.string(JS.precision(value / 1e9, 3)))B" }
        if magnitude >= 1e6 { return "\(JS.string(JS.precision(value / 1e6, 3)))M" }
        if magnitude >= 1e4 { return "\(JS.string(JS.precision(value / 1e3, 3)))k" }
        return JS.string(JS.precision(value, 6))
    }

    /// A chart value in its tooltip and table: large values grouped.
    public static func formatChartValue(_ value: Double?) -> String {
        guard let value else { return "" }
        if abs(value) >= 1e4 {
            return value.formatted(.number.grouping(.automatic))
        }
        return JS.string(JS.precision(value, 8))
    }

    /// The chart's numbers as a table: the x label then one column per series.
    public static func chartTable(_ spec: ChartSpec) -> (header: [String], rows: [[String]], align: [RichColumnAlign?]) {
        let header = [spec.xLabel ?? ""] + spec.series.map(\.name)
        let rows = spec.labels.enumerated().map { index, label in
            [label] + spec.series.map { series in
                index < series.values.count ? series.values[index].map(JS.string) ?? "" : ""
            }
        }
        return (header, rows, header.indices.map { $0 == 0 ? nil : .right })
    }
}

// MARK: - Markdown extras

public enum CalloutKind: String, Equatable, Sendable, CaseIterable {
    case note, tip, important, warning, caution
}

extension RichBlocks {
    private static let callout = JS.regex(#"^\s*\[!(note|tip|important|warning|caution|info|danger|success)\][ \t]*(.*)$"#, [.caseInsensitive])
    private static let calloutAliases: [String: CalloutKind] = ["info": .note, "danger": .caution, "success": .tip]

    /// GitHub alert marker at the start of a blockquote: "[!NOTE] optional title".
    public static func parseCalloutMarker(_ text: String) -> (kind: CalloutKind, title: String)? {
        let first = text.components(separatedBy: "\n").first ?? ""
        let ns = first as NSString
        guard let match = callout.firstMatch(in: first, range: NSRange(location: 0, length: ns.length)) else { return nil }
        let key = ns.substring(with: match.range(at: 1)).lowercased()
        guard let kind = calloutAliases[key] ?? CalloutKind(rawValue: key) else { return nil }
        return (kind, JS.trim(ns.substring(with: match.range(at: 2))))
    }

    /// URL fragment for a heading, GitHub style.
    public static func headingSlug(_ text: String) -> String {
        var slug = JS.trim(text).lowercased()
        slug = String(slug.unicodeScalars.filter { scalar in
            scalar.properties.isAlphabetic || scalar.properties.numericType != nil
                || CharacterSet.whitespacesAndNewlines.contains(scalar) || scalar == "-"
        }.map(Character.init))
        slug = JS.replace(slug, JS.regex(#"\s+"#)) { _ in "-" }
        slug = JS.replace(slug, JS.regex(#"-+"#)) { _ in "-" }
        slug = JS.replace(slug, JS.regex(#"^-|-$"#)) { _ in "" }
        return slug.isEmpty ? "section" : slug
    }

    private static let fenceOpener = JS.regex(#"(^|\r?\n)((?: {0,3}>[ \t]?)* {0,3})(?:(`{3,})[^`\r\n]*|(~{3,})[^\r\n]*)(?:\r?\n|$)"#)

    /// UTF-16 offset where a still-open fence starts (the message ends
    /// inside it), or -1 when every fence is closed. A block past this
    /// offset is still being written: charts and widgets wait for it.
    public static func unclosedFenceOffset(_ text: String) -> Int {
        let ns = text as NSString
        var location = 0
        while location <= ns.length,
              let match = fenceOpener.firstMatch(in: text, range: NSRange(location: location, length: ns.length - location)) {
            let fenceRange = match.range(at: 3).location != NSNotFound ? match.range(at: 3) : match.range(at: 4)
            let fence = ns.substring(with: fenceRange)
            let character = fence.first == "~" ? "~" : "`"
            let closer = JS.regex("(^|\\r?\\n)(?: {0,3}>[ \\t]?)* {0,3}\\\(character){\(fence.count),}[ \\t]*(?=\\r?\\n|$)")
            let after = match.range.location + match.range.length
            guard let closing = closer.firstMatch(in: text, range: NSRange(location: after, length: ns.length - after)) else {
                return match.range.location + match.range(at: 1).length
            }
            location = closing.range.location + closing.range.length
            if closing.range.length == 0 { location += 1 }
        }
        return -1
    }

    private static let wideFence = JS.regex(#"(^|\n) {0,3}(?:`{3,}|~{3,})[ \t]*(?:email|mail|eml|widget|html-widget|artifact|chart|csv|tsv|mermaid|cw)\b"#, [.caseInsensitive])
    private static let tableRule = JS.regex(#"(^|\n)\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*(\n|$)"#)
    private static let antArtifactWide = JS.regex(#"<antArtifact\b"#, [.caseInsensitive])

    /// A message holding a table, a diagram or one of the rich fences gets
    /// the wide bubble on the desktop.
    public static func prefersWideBubble(_ text: String) -> Bool {
        JS.test(wideFence, text) || JS.test(tableRule, text) || JS.test(antArtifactWide, text)
    }

    private static let rasterDataURL = JS.regex(#"^data:image/(?:png|jpe?g|gif|webp|avif|bmp);base64,[a-z0-9+/=\s]+$"#, [.caseInsensitive])

    /// Raster data: URLs are safe to show inline (no network, no script);
    /// SVG and every other media type stay blocked.
    public static func isInlineRasterDataURL(_ value: String) -> Bool {
        value.utf16.count <= 8_000_000 && JS.test(rasterDataURL, value)
    }

    /// The image bytes of an inline raster data: URL.
    public static func inlineRasterData(_ value: String) -> Data? {
        guard isInlineRasterDataURL(value), let comma = value.firstIndex(of: ",") else { return nil }
        let payload = value[value.index(after: comma)...].filter { !$0.isWhitespace }
        return Data(base64Encoded: String(payload))
    }

    /// The desktop's `isExternalImageSource`: anything an image tag would
    /// fetch from the network, held behind "Load image" for privacy.
    public static func isExternalImageSource(_ src: String) -> Bool {
        let value = JS.trim(src)
            .replacingOccurrences(of: "\t", with: "")
            .replacingOccurrences(of: "\n", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\\", with: "/")
        return value.hasPrefix("//") || value.lowercased().hasPrefix("http:") || value.lowercased().hasPrefix("https:")
    }

    /// The desktop's `markdownImageName`: the alt text, else the file name.
    public static func markdownImageName(_ src: String, alt: String?) -> String {
        if let alt = alt.map(JS.trim), !alt.isEmpty { return alt }
        let path: String
        if let url = URL(string: src, relativeTo: URL(string: "https://openmausbot.invalid/")) {
            path = url.path.removingPercentEncoding ?? url.path
        } else {
            path = src
        }
        let name = path.components(separatedBy: CharacterSet(charactersIn: "/\\")).last { !$0.isEmpty }.map(JS.trim)
        return name?.isEmpty == false ? name! : "Image"
    }

    /// The desktop's `markdownImageOpenUrl`: http(s) only.
    public static func markdownImageOpenURL(_ src: String) -> URL? {
        let spelled = src.hasPrefix("//") ? "https:\(src)" : src
        guard let url = URL(string: spelled), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host != nil else { return nil }
        return url
    }
}

// MARK: - Code blocks

public enum CodeBlocks {
    /// Code blocks longer than this fold behind a "Show all" button.
    public static let collapseLines = 30

    private static let languages: [String: String] = [
        "js": "JavaScript", "javascript": "JavaScript", "jsx": "JavaScript (JSX)",
        "ts": "TypeScript", "typescript": "TypeScript", "tsx": "TypeScript (TSX)", "node": "Node.js",
        "html": "HTML", "htm": "HTML", "css": "CSS", "scss": "SCSS", "sass": "Sass", "less": "Less",
        "json": "JSON", "jsonc": "JSON", "json5": "JSON5", "xml": "XML", "svg": "SVG",
        "md": "Markdown", "markdown": "Markdown", "mdx": "MDX", "yaml": "YAML", "yml": "YAML", "toml": "TOML",
        "sh": "Bash", "bash": "Bash", "zsh": "Bash", "shell": "Shell", "ps1": "PowerShell",
        "powershell": "PowerShell", "fish": "Fish",
        "c": "C", "cpp": "C++", "c++": "C++", "cc": "C++", "cxx": "C++", "cs": "C#", "csharp": "C#", "c#": "C#",
        "rs": "Rust", "rust": "Rust", "go": "Go", "golang": "Go", "py": "Python", "python": "Python",
        "rb": "Ruby", "ruby": "Ruby", "php": "PHP", "java": "Java", "kt": "Kotlin", "kotlin": "Kotlin",
        "swift": "Swift", "dart": "Dart", "r": "R", "lua": "Lua",
        "sql": "SQL", "graphql": "GraphQL", "gql": "GraphQL", "proto": "Protobuf", "protobuf": "Protobuf",
        "docker": "Dockerfile", "dockerfile": "Dockerfile", "makefile": "Makefile", "make": "Makefile",
        "diff": "Diff", "wasm": "WebAssembly",
    ]

    private static let extensions: [String: String] = [
        "js": "js", "javascript": "js", "jsx": "jsx", "ts": "ts", "typescript": "ts", "tsx": "tsx", "node": "js",
        "html": "html", "htm": "html", "css": "css", "scss": "scss", "sass": "sass", "less": "less",
        "json": "json", "jsonc": "json", "json5": "json5", "xml": "xml", "svg": "svg",
        "md": "md", "markdown": "md", "mdx": "mdx", "yaml": "yaml", "yml": "yaml", "toml": "toml",
        "sh": "sh", "bash": "sh", "zsh": "zsh", "shell": "sh", "ps1": "ps1", "powershell": "ps1", "fish": "fish",
        "c": "c", "cpp": "cpp", "c++": "cpp", "cc": "cpp", "cxx": "cpp", "cs": "cs", "csharp": "cs", "c#": "cs",
        "rs": "rs", "rust": "rs", "go": "go", "golang": "go", "py": "py", "python": "py", "rb": "rb", "ruby": "rb",
        "php": "php", "java": "java", "kt": "kt", "kotlin": "kt", "swift": "swift", "dart": "dart", "r": "r", "lua": "lua",
        "sql": "sql", "graphql": "graphql", "gql": "graphql", "proto": "proto", "protobuf": "proto",
        "docker": "dockerfile", "dockerfile": "dockerfile", "makefile": "makefile", "make": "makefile",
        "diff": "diff", "wasm": "wasm",
    ]

    /// "TypeScript" for "ts"; "Code" when unspecified; else capitalized.
    public static func languageDisplayName(_ lang: String?) -> String {
        guard let lang, !JS.trim(lang).isEmpty else { return "Code" }
        let normalized = JS.trim(lang).lowercased()
        if let known = languages[normalized] { return known }
        return normalized.prefix(1).uppercased() + normalized.dropFirst()
    }

    /// File extension for a fence language, "txt" when unknown.
    public static func fileExtension(_ lang: String?) -> String {
        guard let lang, !JS.trim(lang).isEmpty else { return "txt" }
        let normalized = JS.trim(lang).lowercased()
        if let known = extensions[normalized] { return known }
        if normalized.range(of: #"^[a-z0-9_-]{1,8}$"#, options: .regularExpression) != nil { return normalized }
        return "txt"
    }

    /// "snippet.py", or "dockerfile" / "makefile" as themselves.
    public static func snippetFileName(_ lang: String?) -> String {
        let ext = fileExtension(lang)
        return ext == "dockerfile" || ext == "makefile" ? ext : "snippet.\(ext)"
    }

    /// Rendered lines, trailing blank lines included; 0 for empty code.
    public static func countLines(_ code: String?) -> Int {
        guard let code, !code.isEmpty else { return 0 }
        return code.replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            .components(separatedBy: "\n").count
    }
}

// MARK: - Claude chat blocks
// Ported from `shared/claude-chat-blocks.ts`. The Artifact tool's publish
// JSON and Claude.ai <antArtifact> tags become the fences this renderer
// already draws. Invented URLs are dropped.

public struct ArtifactPage: Equatable, Hashable, Sendable {
    public var title: String
    public var url: String?
    public var icon: String?

    public init(title: String, url: String? = nil, icon: String? = nil) {
        self.title = title
        self.url = url
        self.icon = icon
    }
}

extension RichBlocks {
    public static let artifactTitleMax = 200
    public static let artifactIconMax = 32
    private static let artifactChartTypes: Set<String> = ["bar", "line", "area", "pie", "scatter"]
    private static let fenceBlock = JS.regex(#"(^|\n)((?: {0,3}>[ \t]?)* {0,3})(`{3,}|~{3,})([^\n]*)\n[\s\S]*?(?:\n(?: {0,3}>[ \t]?)* {0,3}\3[ \t]*(?=\n|$)|$)"#)
    private static let antArtifact = JS.regex(#"<antArtifact\b([^>]*)>([\s\S]*?)</antArtifact>"#, [.caseInsensitive])
    private static let antArtifactOpenTag = JS.regex(#"<antArtifact\b[^>]*>"#, [.caseInsensitive])
    private static let antArtifactClose = JS.regex(#"</antArtifact>"#, [.caseInsensitive])
    private static let attr = JS.regex(#"([A-Za-z_:][\w:.-]*)\s*=\s*"([^"]*)""#)

    /// https URLs, plus http on loopback. Userinfo is refused.
    public static func isSafeHttpUrl(_ value: String) -> Bool {
        guard let url = URL(string: value) else { return false }
        if let user = url.user, !user.isEmpty { return false }
        if let password = url.password, !password.isEmpty { return false }
        guard let scheme = url.scheme?.lowercased() else { return false }
        let host = url.host ?? ""
        if scheme == "https" { return !host.isEmpty }
        if scheme == "http" {
            return host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        }
        return false
    }

    /// JSON in a ```artifact fence: a title and an optional real URL. HTML in
    /// that fence stays a widget (parseArtifactPage returns nil). Chart-shaped
    /// JSON is refused so a mis-tagged ```artifact does not become a page card.
    public static func parseArtifactPage(_ code: String) -> ArtifactPage? {
        let trimmed = JS.trim(code)
        guard trimmed.hasPrefix("{") else { return nil }
        let raw: OrderedJSON
        do { raw = try OrderedJSON.parse(trimmed) } catch { return nil }
        guard case let .object(fields) = raw else { return nil }
        func field(_ key: String) -> OrderedJSON? { fields.first { $0.0 == key }?.1 }
        if case let .string(type)? = field("type"), artifactChartTypes.contains(type) { return nil }
        if case .array = field("labels"), case .array = field("series") { return nil }
        if case .array = field("artifacts") { return nil }
        let title: String
        if case let .string(text)? = field("title") {
            title = String(JS.trim(text).prefix(artifactTitleMax))
        } else {
            title = ""
        }
        var url: String?
        if case let .string(text)? = field("url") {
            let candidate = JS.trim(text)
            if isSafeHttpUrl(candidate) { url = candidate }
        }
        var icon: String?
        if case let .string(text)? = field("icon") {
            let value = String(JS.trim(text).prefix(artifactIconMax))
            if !value.isEmpty { icon = value }
        }
        if title.isEmpty && url == nil { return nil }
        return ArtifactPage(title: title.isEmpty ? "Page" : title, url: url, icon: icon)
    }

    private static func fenceAttrs(_ raw: String) -> [String: String] {
        var out: [String: String] = [:]
        let ns = raw as NSString
        for match in attr.matches(in: raw, range: NSRange(location: 0, length: ns.length)) {
            out[ns.substring(with: match.range(at: 1)).lowercased()] = ns.substring(with: match.range(at: 2))
        }
        return out
    }

    private static func fenced(_ lang: String, _ body: String) -> String {
        var text = body
        if text.hasPrefix("\n") { text = String(text.dropFirst()) }
        if text.hasSuffix("\n") { text = String(text.dropLast()) }
        return "```\(lang)\n\(text)\n```"
    }

    private static func langFromMime(_ type: String) -> String? {
        if type == "text/javascript" || type == "application/javascript" { return "javascript" }
        if type == "text/typescript" || type == "application/typescript" { return "typescript" }
        if type == "application/json" || type == "text/json" { return "json" }
        if type == "text/css" { return "css" }
        if type == "text/x-python" || type == "text/python" { return "python" }
        if type.hasPrefix("text/x-") { return String(type.dropFirst("text/x-".count)) }
        return nil
    }

    private static func looksLikeChart(_ body: String) -> Bool {
        let trimmed = JS.trim(body)
        guard trimmed.hasPrefix("{") else { return false }
        guard let raw = try? OrderedJSON.parse(trimmed), case let .object(fields) = raw else { return false }
        guard case let .string(type)? = fields.first(where: { $0.0 == "type" })?.1 else { return false }
        return artifactChartTypes.contains(type)
    }

    /// Turn one Claude.ai artifact tag into the Sagax fence the renderer already
    /// knows. React/JSX stays a code fence: the widget sandbox has no network
    /// and cannot load React.
    public static func antArtifactToMarkdown(_ attributeSource: String, _ body: String) -> String {
        let attrs = fenceAttrs(attributeSource)
        let type = JS.trim(attrs["type"] ?? "").lowercased()
        let language = JS.trim(attrs["language"] ?? "")
        var trimmed = body
        if trimmed.hasPrefix("\n") { trimmed = String(trimmed.dropFirst()) }
        if trimmed.hasSuffix("\n") { trimmed = String(trimmed.dropLast()) }
        if type == "application/vnd.sagax.cw+json" { return fenced("cw", trimmed) }
        if type == "application/vnd.ant.mermaid" || type == "text/mermaid" { return fenced("mermaid", trimmed) }
        if type == "text/markdown" { return trimmed }
        if type.contains("chart") || looksLikeChart(trimmed) { return fenced("chart", trimmed) }
        if type == "text/html" || type == "image/svg+xml" || type == "application/vnd.ant.html" {
            return fenced("widget", trimmed)
        }
        if type == "application/vnd.ant.react" || type.contains("react") {
            return fenced(language.isEmpty ? "jsx" : language, trimmed)
        }
        if type == "application/vnd.ant.code" {
            return fenced(language.isEmpty ? (langFromMime(type) ?? "text") : language, trimmed)
        }
        if type.hasPrefix("text/"), type != "text/plain" {
            return fenced(language.isEmpty ? (langFromMime(type) ?? "text") : language, trimmed)
        }
        if trimmed.range(of: #"^\s*<"#, options: .regularExpression) != nil { return fenced("widget", trimmed) }
        return fenced(language.isEmpty ? "text" : language, trimmed)
    }

    /// Rewrite complete `<antArtifact>` tags into fences. An unclosed tag (the
    /// model is still streaming) is dropped so raw XML never flashes in the
    /// bubble. Fenced code that documents the tag is left alone.
    public static func liftClaudeChatBlocks(_ text: String) -> String {
        var parts: [String] = []
        let protected = JS.replace(text, fenceBlock) { groups in
            let token = "\u{0000}OMB_FENCE_\(parts.count)\u{0000}"
            parts.append(groups[0] ?? "")
            return token
        }
        var lifted = JS.replace(protected, antArtifact) { groups in
            "\n\n\(antArtifactToMarkdown(groups[1] ?? "", groups[2] ?? ""))\n\n"
        }
        let ns = lifted as NSString
        if let opener = antArtifactOpenTag.firstMatch(in: lifted, range: NSRange(location: 0, length: ns.length)) {
            let rest = ns.substring(from: opener.range.location)
            if !JS.test(antArtifactClose, rest) {
                lifted = ns.substring(to: opener.range.location)
            }
        }
        // ICU regex cannot hold a NUL, so the restore walks the same token
        // the desktop writes (`\0OMB_FENCE_n\0`) by hand.
        return restoreFences(lifted, parts)
    }

    private static func restoreFences(_ text: String, _ parts: [String]) -> String {
        let prefix = "\u{0000}OMB_FENCE_"
        let suffix: Character = "\u{0000}"
        var out = ""
        var rest = Substring(text)
        while let start = rest.range(of: prefix) {
            out += rest[..<start.lowerBound]
            let after = rest[start.upperBound...]
            var digits = ""
            var idx = after.startIndex
            while idx < after.endIndex, after[idx].isNumber {
                digits.append(after[idx])
                idx = after.index(after: idx)
            }
            guard idx < after.endIndex, after[idx] == suffix, let index = Int(digits), parts.indices.contains(index) else {
                out += prefix
                rest = after
                continue
            }
            out += parts[index]
            rest = after[after.index(after: idx)...]
        }
        out += rest
        return out
    }
}

// MARK: - Turn access

/// Organization server (2026-10-01): which credentials a turn ran with.
/// Never a secret (`shared/digest.ts` DigestAccess).
public struct DigestAccess: Codable, Hashable, Sendable {
    public var via: String
    public var payer: String
    public var payerPrincipalId: String?
    public var routine: Bool?

    public init(via: String, payer: String, payerPrincipalId: String? = nil, routine: Bool? = nil) {
        self.via = via
        self.payer = payer
        self.payerPrincipalId = payerPrincipalId
        self.routine = routine
    }

    /// The desktop's `turnAccessLabel`, as a key the app words.
    public enum Label: String, Sendable {
        case yourSubscription, yourKey, speakerSubscription, speakerKey, ownerCredentials, orgKey, server
    }

    public func label(viewerPrincipalId: String?) -> Label {
        if via == "org-key" { return .orgKey }
        if via == "server" { return .server }
        if routine == true && payer == "owner" { return .ownerCredentials }
        var mine = false
        if let viewer = viewerPrincipalId, !viewer.isEmpty, let payer = payerPrincipalId, !payer.isEmpty {
            mine = viewer.lowercased() == payer.lowercased()
        }
        if via == "subscription" { return mine ? .yourSubscription : .speakerSubscription }
        return mine ? .yourKey : .speakerKey
    }
}

/// The structured part of a turn digest the phone reads. The rest of the
/// digest stays in the message text (`DigestSummary`).
public struct MessageDigest: Codable, Hashable, Sendable {
    public var access: DigestAccess?

    public init(access: DigestAccess? = nil) {
        self.access = access
    }
}

// MARK: - Ordered JSON

/// A JSON value that keeps object keys in document order: a row-object
/// chart takes its x column from the first key, as the desktop's
/// `Object.keys` does.
public indirect enum OrderedJSON: Equatable, Sendable {
    case object([(String, OrderedJSON)])
    case array([OrderedJSON])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    public static func == (lhs: OrderedJSON, rhs: OrderedJSON) -> Bool {
        switch (lhs, rhs) {
        case let (.object(a), .object(b)):
            return a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        case let (.array(a), .array(b)): return a == b
        case let (.string(a), .string(b)): return a == b
        case let (.number(a), .number(b)): return a == b
        case let (.bool(a), .bool(b)): return a == b
        case (.null, .null): return true
        default: return false
        }
    }

    /// `String(value ?? fallback)` in JavaScript.
    func jsString(nullAs fallback: String) -> String {
        switch self {
        case .null: fallback
        case let .string(text): text
        case let .number(number): JS.string(number)
        case let .bool(flag): flag ? "true" : "false"
        case .array(let items): items.map { $0 == .null ? "" : $0.jsString(nullAs: "") }.joined(separator: ",")
        case .object: "[object Object]"
        }
    }

    public struct ParseError: Error {
        public let message: String
    }

    public static func parse(_ text: String) throws -> OrderedJSON {
        var parser = Parser(scalars: Array(text.unicodeScalars))
        let value = try parser.value()
        parser.skipSpace()
        guard parser.index == parser.scalars.count else { throw parser.fail("Unexpected non-whitespace character after JSON") }
        return value
    }

    private struct Parser {
        let scalars: [Unicode.Scalar]
        var index = 0
        var depth = 0

        func fail(_ message: String) -> ParseError {
            ParseError(message: "\(message) at position \(index)")
        }

        mutating func skipSpace() {
            while index < scalars.count, [" ", "\n", "\r", "\t"].contains(scalars[index]) { index += 1 }
        }

        mutating func value() throws -> OrderedJSON {
            skipSpace()
            guard index < scalars.count else { throw fail("Unexpected end of JSON input") }
            depth += 1
            defer { depth -= 1 }
            guard depth < 512 else { throw fail("JSON nested too deeply") }
            switch scalars[index] {
            case "{": return try object()
            case "[": return try array()
            case "\"": return .string(try string())
            case "t": try literal("true"); return .bool(true)
            case "f": try literal("false"); return .bool(false)
            case "n": try literal("null"); return .null
            default: return .number(try number())
            }
        }

        mutating func literal(_ word: String) throws {
            for scalar in word.unicodeScalars {
                guard index < scalars.count, scalars[index] == scalar else { throw fail("Unexpected token in JSON") }
                index += 1
            }
        }

        mutating func object() throws -> OrderedJSON {
            index += 1
            var pairs: [(String, OrderedJSON)] = []
            skipSpace()
            if index < scalars.count, scalars[index] == "}" { index += 1; return .object(pairs) }
            while true {
                skipSpace()
                guard index < scalars.count, scalars[index] == "\"" else { throw fail("Expected property name in JSON") }
                let key = try string()
                skipSpace()
                guard index < scalars.count, scalars[index] == ":" else { throw fail("Expected ':' after property name in JSON") }
                index += 1
                let item = try value()
                // a repeated key keeps its first position and its last value, as JSON.parse does
                if let existing = pairs.firstIndex(where: { $0.0 == key }) { pairs[existing].1 = item } else { pairs.append((key, item)) }
                skipSpace()
                guard index < scalars.count else { throw fail("Unexpected end of JSON input") }
                if scalars[index] == "," { index += 1; continue }
                if scalars[index] == "}" { index += 1; return .object(pairs) }
                throw fail("Expected ',' or '}' after property value in JSON")
            }
        }

        mutating func array() throws -> OrderedJSON {
            index += 1
            var items: [OrderedJSON] = []
            skipSpace()
            if index < scalars.count, scalars[index] == "]" { index += 1; return .array(items) }
            while true {
                items.append(try value())
                skipSpace()
                guard index < scalars.count else { throw fail("Unexpected end of JSON input") }
                if scalars[index] == "," { index += 1; continue }
                if scalars[index] == "]" { index += 1; return .array(items) }
                throw fail("Expected ',' or ']' after array element in JSON")
            }
        }

        mutating func string() throws -> String {
            index += 1
            var out = String.UnicodeScalarView()
            while index < scalars.count {
                let scalar = scalars[index]
                index += 1
                if scalar == "\"" { return String(out) }
                if scalar.value < 0x20 { throw fail("Bad control character in string literal in JSON") }
                guard scalar == "\\" else { out.append(scalar); continue }
                guard index < scalars.count else { break }
                let escape = scalars[index]
                index += 1
                switch escape {
                case "\"": out.append("\"")
                case "\\": out.append("\\")
                case "/": out.append("/")
                case "b": out.append("\u{08}")
                case "f": out.append("\u{0C}")
                case "n": out.append("\n")
                case "r": out.append("\r")
                case "t": out.append("\t")
                case "u":
                    var code = try hex4()
                    if (0xD800...0xDBFF).contains(code), index + 1 < scalars.count, scalars[index] == "\\", scalars[index + 1] == "u" {
                        index += 2
                        let low = try hex4()
                        if (0xDC00...0xDFFF).contains(low) {
                            code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                        }
                    }
                    out.append(Unicode.Scalar(code) ?? "\u{FFFD}")
                default:
                    throw fail("Bad escaped character in JSON")
                }
            }
            throw fail("Unterminated string in JSON")
        }

        mutating func hex4() throws -> UInt32 {
            guard index + 4 <= scalars.count else { throw fail("Bad Unicode escape in JSON") }
            let digits = String(String.UnicodeScalarView(scalars[index..<index + 4]))
            guard let code = UInt32(digits, radix: 16) else { throw fail("Bad Unicode escape in JSON") }
            index += 4
            return code
        }

        mutating func number() throws -> Double {
            let start = index
            if index < scalars.count, scalars[index] == "-" { index += 1 }
            while index < scalars.count, "0123456789+-.eE".unicodeScalars.contains(scalars[index]) { index += 1 }
            let text = String(String.UnicodeScalarView(scalars[start..<index]))
            guard !text.isEmpty,
                  text.range(of: #"^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$"#, options: .regularExpression) != nil,
                  let number = Double(text)
            else {
                index = start
                throw fail("Unexpected token in JSON")
            }
            return number
        }
    }
}

// Markdown, split into blocks.
//
// The desktop renders bot replies with react-markdown + GFM. The phone draws
// the same blocks a chat bubble needs: paragraphs, lists, task items,
// headings, fences, quotes, rules, and tables. Inline emphasis stays with
// Foundation. Anything this does not recognise stays text, which is the
// failure mode that loses nothing.
import Foundation

public enum MarkdownTableAlignment: Equatable, Sendable {
    case leading, trailing, center
}

public struct MarkdownTable: Equatable, Sendable {
    public var headers: [String]
    public var alignments: [MarkdownTableAlignment]
    public var rows: [[String]]
    /// Columns whose delimiter cell set an alignment. The desktop
    /// right-aligns a numeric column only when nothing was declared.
    public var declared: [Bool] = []

    public init(headers: [String], alignments: [MarkdownTableAlignment], rows: [[String]], declared: [Bool] = []) {
        self.headers = headers
        self.alignments = alignments
        self.rows = rows
        self.declared = declared
    }

    public static func == (lhs: MarkdownTable, rhs: MarkdownTable) -> Bool {
        lhs.headers == rhs.headers && lhs.alignments == rhs.alignments && lhs.rows == rhs.rows
    }

    /// Whether column `index` had an alignment written in its delimiter cell.
    public func isDeclared(_ index: Int) -> Bool {
        index < declared.count && declared[index]
    }
}

public enum MarkdownBlock: Equatable, Sendable {
    case paragraph(String)
    /// `indent` is nesting depth, 0 for a top-level item.
    case bullet(indent: Int, text: String)
    case ordered(indent: Int, number: Int, text: String)
    /// `number` is set for `1.` and `1)` and nil for a bullet task.
    case task(indent: Int, number: Int?, checked: Bool, text: String)
    case heading(level: Int, text: String)
    /// A fenced block. `language` is whatever followed the opening fence.
    case code(language: String?, text: String)
    case quote(String)
    case rule
    case table(MarkdownTable)
    /// A GitHub alert (`> [!NOTE] title`): its kind, the title written after
    /// the marker (empty for the kind's own word), and the body as Markdown.
    case callout(kind: CalloutKind, title: String, text: String)
    /// `![alt](src)` standing in a paragraph: drawn as a preview, not text.
    case image(MarkdownImage)
    /// GFM footnote definitions, numbered by first reference, drawn last.
    case footnotes([MarkdownFootnote])
}

public struct MarkdownImage: Equatable, Hashable, Sendable {
    public var alt: String
    public var source: String
    /// `[![alt](src)](href)`: where the picture links to.
    public var link: String?

    public init(alt: String, source: String, link: String? = nil) {
        self.alt = alt
        self.source = source
        self.link = link
    }
}

public struct MarkdownFootnote: Equatable, Hashable, Sendable {
    public var number: Int
    public var text: String

    public init(number: Int, text: String) {
        self.number = number
        self.text = text
    }
}

public enum Markdown {
    /// Split into blocks. Never throws and never drops input: an unparseable
    /// line ends up in a paragraph, which is what the reader wanted anyway.
    public static func blocks(_ source: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []
        /// Marker indents of lists that are still open, outermost first.
        var listIndents: [Int] = []

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            // A single newline inside a paragraph stays a line break, as in
            // chat apps and on the desktop (remarkSoftBreaks): options written
            // "A. ...\nB. ..." must each keep their own line.
            let text = paragraph.joined(separator: "\n")
            paragraph.removeAll()
            if text.contains("![") {
                blocks.append(contentsOf: splitImages(text))
            } else {
                blocks.append(.paragraph(text))
            }
        }
        /// Footnote definitions by lowercased label, first one wins.
        var footnoteDefinitions: [(label: String, text: String)] = []

        // Normalise the line endings before splitting, because
        // `CharacterSet.newlines` contains \r and \n *separately* and
        // `components(separatedBy:)` breaks on each of them: "a\r\nb" comes
        // back as ["a", "", "b"], one phantom empty line per CRLF. That empty
        // line is not cosmetic — it calls `flushParagraph`, so a paragraph
        // written across several lines arrives as one paragraph per line, and
        // a fenced block gains a blank line between every line of code. Tool
        // output and pasted text reach chat bubbles with CRLF intact, so this
        // is a path real messages take. Claude.ai <antArtifact> tags become
        // the fences ChatMarkdown already draws, so lift them after CRLF
        // repair and before the fence split.
        let normalised = RichBlocks.liftClaudeChatBlocks(
            source.replacingOccurrences(of: "\r\n", with: "\n")
                .replacingOccurrences(of: "\r", with: "\n")
        )
        var lines = normalised.components(separatedBy: "\n")[...]
        while let line = lines.first {
            lines = lines.dropFirst()
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flushParagraph()
                closeLists(line, indents: &listIndents)
                let marker = String(trimmed.prefix(3))
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var body: [String] = []
                while let next = lines.first {
                    lines = lines.dropFirst()
                    if next.trimmingCharacters(in: .whitespaces).hasPrefix(marker) { break }
                    body.append(next)
                }
                blocks.append(.code(language: language.isEmpty ? nil : language, text: body.joined(separator: "\n")))
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                listIndents.removeAll()
                continue
            }

            if trimmed.count >= 3, "-*_".contains(trimmed.first!),
               trimmed.allSatisfy({ $0 == trimmed.first! }) {
                flushParagraph()
                closeLists(line, indents: &listIndents)
                blocks.append(.rule)
                continue
            }

            if let heading = heading(trimmed) {
                flushParagraph()
                closeLists(line, indents: &listIndents)
                blocks.append(heading)
                continue
            }

            if trimmed.hasPrefix(">") {
                flushParagraph()
                closeLists(line, indents: &listIndents)
                let content = String(trimmed.dropFirst()).trimmingCharacters(in: .whitespaces)
                if let marker = RichBlocks.parseCalloutMarker(content) {
                    // The alert's body is the rest of the quote, each line
                    // with its ">" and one following space removed.
                    var body: [String] = []
                    while let next = lines.first {
                        let rest = next.trimmingCharacters(in: .whitespaces)
                        guard rest.hasPrefix(">") else { break }
                        lines = lines.dropFirst()
                        var inner = rest.dropFirst()
                        if inner.first == " " { inner = inner.dropFirst() }
                        body.append(String(inner))
                    }
                    blocks.append(.callout(kind: marker.kind, title: marker.title, text: body.joined(separator: "\n")))
                    continue
                }
                blocks.append(.quote(content))
                continue
            }

            if let definition = footnoteDefinition(line) {
                flushParagraph()
                listIndents.removeAll()
                var text = [definition.text]
                // continuation lines are indented four spaces or a tab
                while let next = lines.first, next.hasPrefix("    ") || next.hasPrefix("\t") {
                    lines = lines.dropFirst()
                    text.append(next.trimmingCharacters(in: .whitespaces))
                }
                if !footnoteDefinitions.contains(where: { $0.label == definition.label }) {
                    footnoteDefinitions.append((definition.label, text.joined(separator: " ")))
                }
                continue
            }

            let leading = leadingCount(line)
            while let inner = listIndents.last, leading <= inner {
                listIndents.removeLast()
            }
            if let inner = listIndents.last, leading > inner {
                if let item = listItem(line) {
                    flushParagraph()
                    listIndents.append(leading)
                    blocks.append(item)
                } else {
                    paragraph.append(trimmed)
                }
                continue
            }

            if let table = takeTable(line, rest: &lines) {
                flushParagraph()
                blocks.append(.table(table))
                continue
            }

            if let item = listItem(line) {
                flushParagraph()
                listIndents.append(leading)
                blocks.append(item)
                continue
            }

            paragraph.append(trimmed)
        }
        flushParagraph()
        if !footnoteDefinitions.isEmpty {
            return numberFootnotes(blocks, definitions: footnoteDefinitions)
        }
        return blocks
    }

    // MARK: Footnotes

    /// The scheme a footnote reference links to; the view draws these runs
    /// as superscript numbers and opens the note on a tap.
    public static let footnoteScheme = "sagax-footnote"

    private static func footnoteDefinition(_ line: String) -> (label: String, text: String)? {
        let indent = line.prefix(while: { $0 == " " }).count
        guard indent <= 3 else { return nil }
        let rest = line.dropFirst(indent)
        guard rest.hasPrefix("[^"), let close = rest.firstIndex(of: "]") else { return nil }
        let label = rest[rest.index(rest.startIndex, offsetBy: 2)..<close]
        guard !label.isEmpty, !label.contains(where: { $0.isWhitespace }) else { return nil }
        let after = rest[rest.index(after: close)...]
        guard after.hasPrefix(":") else { return nil }
        return (label.lowercased(), after.dropFirst().trimmingCharacters(in: .whitespaces))
    }

    /// GFM numbers notes by first reference and drops the unreferenced ones;
    /// a reference with no definition stays literal text.
    private static func numberFootnotes(_ blocks: [MarkdownBlock], definitions: [(label: String, text: String)]) -> [MarkdownBlock] {
        let known = Set(definitions.map(\.label))
        var numbers: [String: Int] = [:]
        func rewrite(_ text: String) -> String {
            guard text.contains("[^") else { return text }
            var out = ""
            var index = text.startIndex
            var inCode = false
            while index < text.endIndex {
                let character = text[index]
                if character == "`" { inCode.toggle() }
                if !inCode, text[index...].hasPrefix("[^"),
                   let close = text[index...].firstIndex(of: "]") {
                    let labelStart = text.index(index, offsetBy: 2)
                    let label = text[labelStart..<close].lowercased()
                    if known.contains(label) {
                        let number = numbers[label] ?? (numbers.count + 1)
                        numbers[label] = number
                        out += "[\(number)](\(footnoteScheme):\(number))"
                        index = text.index(after: close)
                        continue
                    }
                }
                out.append(character)
                index = text.index(after: index)
            }
            return out
        }
        var rewritten: [MarkdownBlock] = blocks.map { block -> MarkdownBlock in
            switch block {
            case let .paragraph(text): return .paragraph(rewrite(text))
            case let .bullet(indent, text): return .bullet(indent: indent, text: rewrite(text))
            case let .ordered(indent, number, text): return .ordered(indent: indent, number: number, text: rewrite(text))
            case let .task(indent, number, checked, text): return .task(indent: indent, number: number, checked: checked, text: rewrite(text))
            case let .heading(level, text): return .heading(level: level, text: rewrite(text))
            case let .quote(text): return .quote(rewrite(text))
            case let .callout(kind, title, text): return .callout(kind: kind, title: title, text: rewrite(text))
            case var .table(table):
                table.headers = table.headers.map(rewrite)
                table.rows = table.rows.map { $0.map(rewrite) }
                return .table(table)
            default: return block
            }
        }
        let notes = definitions.compactMap { definition -> MarkdownFootnote? in
            guard let number = numbers[definition.label] else { return nil }
            return MarkdownFootnote(number: number, text: definition.text)
        }.sorted { $0.number < $1.number }
        if !notes.isEmpty { rewritten.append(.footnotes(notes)) }
        return rewritten
    }

    // MARK: Images

    private static let imagePattern = try! NSRegularExpression(
        pattern: #"\[!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)\]\(\s*([^\s)]+)(?:\s+"[^"]*")?\s*\)|!\[([^\]]*)\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)"#
    )

    /// A paragraph holding pictures: the words around them stay paragraphs,
    /// each picture becomes its own block, in order.
    static func splitImages(_ text: String) -> [MarkdownBlock] {
        let ns = text as NSString
        let matches = imagePattern.matches(in: text, range: NSRange(location: 0, length: ns.length))
        guard !matches.isEmpty else { return [.paragraph(text)] }
        func group(_ match: NSTextCheckingResult, _ index: Int) -> String? {
            let range = match.range(at: index)
            return range.location == NSNotFound ? nil : ns.substring(with: range)
        }
        func unbracket(_ value: String) -> String {
            value.hasPrefix("<") && value.hasSuffix(">") ? String(value.dropFirst().dropLast()) : value
        }
        var out: [MarkdownBlock] = []
        var cursor = 0
        func words(upTo location: Int) {
            let chunk = ns.substring(with: NSRange(location: cursor, length: location - cursor))
                .trimmingCharacters(in: .whitespaces)
            if !chunk.isEmpty { out.append(.paragraph(chunk)) }
        }
        for match in matches {
            words(upTo: match.range.location)
            if let source = group(match, 2) {
                out.append(.image(MarkdownImage(alt: group(match, 1) ?? "", source: unbracket(source), link: group(match, 3))))
            } else {
                out.append(.image(MarkdownImage(alt: group(match, 4) ?? "", source: unbracket(group(match, 5) ?? ""))))
            }
            cursor = match.range.location + match.range.length
        }
        words(upTo: ns.length)
        return out
    }

    private static func leadingCount(_ line: String) -> Int {
        line.prefix(while: { $0 == " " || $0 == "\t" }).count
    }

    /// Pop list markers this line is not inside. A blank line clears the stack
    /// on its own. A nested quote or fence must not.
    private static func closeLists(_ line: String, indents: inout [Int]) {
        let leading = leadingCount(line)
        while let inner = indents.last, leading <= inner {
            indents.removeLast()
        }
    }

    private static func heading(_ trimmed: String) -> MarkdownBlock? {
        let hashes = trimmed.prefix(while: { $0 == "#" }).count
        guard hashes >= 1, hashes <= 6 else { return nil }
        let rest = String(trimmed.dropFirst(hashes))
        // "#hashtag" is not a heading; ATX requires the space
        guard rest.hasPrefix(" ") else { return nil }
        return .heading(level: hashes, text: rest.trimmingCharacters(in: .whitespaces))
    }

    private static func listItem(_ line: String) -> MarkdownBlock? {
        let leading = leadingCount(line)
        let indent = min(leading / 2, 4)
        let trimmed = line.trimmingCharacters(in: .whitespaces)

        for marker in ["- ", "* ", "+ "] where trimmed.hasPrefix(marker) {
            let text = String(trimmed.dropFirst(2))
            if let task = taskMark(text) {
                return .task(indent: indent, number: nil, checked: task.checked, text: task.text)
            }
            return .bullet(indent: indent, text: text)
        }

        let digits = trimmed.prefix(while: \.isNumber)
        if !digits.isEmpty, digits.count <= 9 {
            let rest = trimmed.dropFirst(digits.count)
            if rest.hasPrefix(". ") || rest.hasPrefix(") ") {
                let text = String(rest.dropFirst(2))
                let number = Int(digits) ?? 1
                if let task = taskMark(text) {
                    return .task(indent: indent, number: number, checked: task.checked, text: task.text)
                }
                return .ordered(indent: indent, number: number, text: text)
            }
        }
        return nil
    }

    /// `[ ]`, `[x]`, or `[X]`, either alone or followed by whitespace.
    private static func taskMark(_ text: String) -> (checked: Bool, text: String)? {
        guard text.hasPrefix("["), let close = text.firstIndex(of: "]") else { return nil }
        let inside = text[text.index(after: text.startIndex)..<close]
        guard inside == " " || inside == "x" || inside == "X" else { return nil }
        let after = text[text.index(after: close)...]
        if after.isEmpty {
            return (inside != " ", "")
        }
        guard after.first == " " || after.first == "\t" else { return nil }
        return (inside != " ", String(after.drop(while: { $0 == " " || $0 == "\t" })))
    }

    private static func takeTable(_ line: String, rest: inout ArraySlice<String>) -> MarkdownTable? {
        guard isRowCandidate(line), !oddBackticks(line) else { return nil }
        let next = rest.first ?? ""
        if let welded = weld(line), !isDelimiterRow(next) {
            var table = welded
            while let body = rest.first, isBodyRow(body) {
                rest = rest.dropFirst()
                appendRow(cells(body), to: &table)
            }
            return table
        }
        guard isDelimiterRow(next) else { return nil }
        rest = rest.dropFirst()
        var headers = cells(line)
        guard !headers.isEmpty else { return nil }
        var alignments = fittedAlignments(cells(next), count: headers.count)
        var rows: [[String]] = []
        let declared = declaredAlignments(cells(next), count: headers.count)
        var table = MarkdownTable(headers: headers, alignments: alignments, rows: rows, declared: declared)
        while let body = rest.first, isBodyRow(body) {
            rest = rest.dropFirst()
            appendRow(cells(body), to: &table)
        }
        headers = table.headers
        alignments = table.alignments
        rows = table.rows
        return MarkdownTable(headers: headers, alignments: alignments, rows: rows, declared: table.declared)
    }

    private static func isRowCandidate(_ line: String) -> Bool {
        let leading = line.prefix(while: { $0 == " " })
        guard line.prefix(while: { $0 == " " || $0 == "\t" }).allSatisfy({ $0 == " " }) else { return false }
        guard leading.count <= 3 else { return false }
        guard line.contains("|") else { return false }
        guard listItem(line) == nil else { return false }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix(">") || trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { return false }
        if heading(trimmed) != nil { return false }
        if trimmed.count >= 3, "-*_".contains(trimmed.first!), trimmed.allSatisfy({ $0 == trimmed.first! }) {
            return false
        }
        return !cells(line).isEmpty
    }

    private static func isBodyRow(_ line: String) -> Bool {
        isRowCandidate(line) && !oddBackticks(line)
    }

    private static func isDelimiterRow(_ line: String) -> Bool {
        guard isRowCandidate(line) else { return false }
        let parts = cells(line)
        guard !parts.isEmpty else { return false }
        return parts.allSatisfy(isDelimiterCell)
    }

    private static func isDelimiterCell(_ cell: String) -> Bool {
        var rest = Substring(cell)
        if rest.first == ":" { rest = rest.dropFirst() }
        let dashes = rest.prefix(while: { $0 == "-" })
        guard !dashes.isEmpty else { return false }
        rest = rest.dropFirst(dashes.count)
        if rest.first == ":" { rest = rest.dropFirst() }
        return rest.isEmpty
    }

    private static func alignment(_ cell: String) -> MarkdownTableAlignment {
        let left = cell.hasPrefix(":")
        let right = cell.hasSuffix(":")
        if left && right { return .center }
        if right { return .trailing }
        return .leading
    }

    private static func declaredAlignments(_ supplied: [String], count: Int) -> [Bool] {
        (0..<count).map { index in
            index < supplied.count && (supplied[index].hasPrefix(":") || supplied[index].hasSuffix(":"))
        }
    }

    private static func fittedAlignments(_ supplied: [String], count: Int) -> [MarkdownTableAlignment] {
        (0..<count).map { index in
            guard index < supplied.count else { return .leading }
            return alignment(supplied[index])
        }
    }

    private static func appendRow(_ row: [String], to table: inout MarkdownTable) {
        var row = row
        if row.count > table.headers.count {
            let extra = row.count - table.headers.count
            table.headers.append(contentsOf: Array(repeating: "", count: extra))
            table.alignments.append(contentsOf: Array(repeating: .leading, count: extra))
            if !table.declared.isEmpty { table.declared.append(contentsOf: Array(repeating: false, count: extra)) }
            for index in table.rows.indices {
                table.rows[index].append(contentsOf: Array(repeating: "", count: extra))
            }
        }
        while row.count < table.headers.count {
            row.append("")
        }
        table.rows.append(row)
    }

    /// A one-line table. Nil when the line is not the welded shape.
    private static func weld(_ line: String) -> MarkdownTable? {
        let indent = line.prefix(while: { $0 == " " }).count
        guard indent <= 3, line.dropFirst(indent).hasPrefix("|") else { return nil }
        guard !line.contains("`"), !line.contains("\\") else { return nil }
        guard !isDelimiterRow(line) else { return nil }
        guard let range = delimiterRun(in: line) else { return nil }
        let header = String(line[..<range.lowerBound])
        let run = String(line[range])
        let body = String(line[range.upperBound...])
        let headers = cells(header)
        guard headers.count >= 2, header.trimmingCharacters(in: .whitespaces).hasSuffix("|") else { return nil }
        let trimmedBody = body.trimmingCharacters(in: .whitespaces)
        guard trimmedBody.isEmpty || trimmedBody.hasPrefix("|") else { return nil }
        let delimiter = cells(run)
        guard delimiter.count >= 1, delimiter.allSatisfy(isDelimiterCell) else { return nil }

        var table = MarkdownTable(
            headers: headers,
            alignments: fittedAlignments(delimiter, count: headers.count),
            rows: [],
            declared: declaredAlignments(delimiter, count: headers.count)
        )
        var chunk: [String] = []
        var boundary = false
        for value in cells(body) {
            if boundary {
                boundary = false
                if value.isEmpty { continue }
            }
            chunk.append(value)
            if chunk.count == headers.count {
                table.rows.append(chunk)
                chunk = []
                boundary = true
            }
        }
        if !chunk.isEmpty {
            while chunk.count < headers.count { chunk.append("") }
            table.rows.append(chunk)
        }
        return table
    }

    /// Split a row on pipes that are not escaped and not inside a code span.
    /// One empty cell created by an outer pipe on each edge is dropped.
    static func cells(_ line: String) -> [String] {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        var parts: [String] = []
        var current = ""
        var escaped = false
        var inCode = false
        for character in trimmed {
            if escaped {
                if character == "|" {
                    current.append("|")
                } else {
                    current.append("\\")
                    current.append(character)
                }
                escaped = false
                continue
            }
            if character == "\\" {
                escaped = true
                continue
            }
            if character == "`" {
                inCode.toggle()
                current.append(character)
                continue
            }
            if character == "|" && !inCode {
                parts.append(current)
                current = ""
                continue
            }
            current.append(character)
        }
        if escaped { current.append("\\") }
        parts.append(current)
        if trimmed.hasPrefix("|"), parts.first?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            parts.removeFirst()
        }
        if trimmed.hasSuffix("|"), parts.last?.trimmingCharacters(in: .whitespaces).isEmpty == true {
            parts.removeLast()
        }
        return parts.map { $0.trimmingCharacters(in: .whitespaces) }
    }

    /// The first run of `| --- | --- |` style cells in a line.
    private static func delimiterRun(in line: String) -> Range<String.Index>? {
        var index = line.startIndex
        while let pipe = line[index...].firstIndex(of: "|") {
            var cursor = line.index(after: pipe)
            var cells = 0
            var end = cursor
            while cursor < line.endIndex {
                var look = cursor
                while look < line.endIndex, line[look] == " " { look = line.index(after: look) }
                if look < line.endIndex, line[look] == ":" { look = line.index(after: look) }
                let dashes = look
                while look < line.endIndex, line[look] == "-" { look = line.index(after: look) }
                guard look != dashes else { break }
                if look < line.endIndex, line[look] == ":" { look = line.index(after: look) }
                while look < line.endIndex, line[look] == " " { look = line.index(after: look) }
                guard look < line.endIndex, line[look] == "|" else { break }
                cells += 1
                end = line.index(after: look)
                cursor = end
            }
            if cells >= 1 {
                return pipe..<end
            }
            index = line.index(after: pipe)
        }
        return nil
    }

    /// A paragraph whose whole text is a delimiter row, after the same edge
    /// drop table cells use. A delimiter line buried in other words is not.
    static func delimiterParagraph(_ text: String) -> Bool {
        guard text.contains("|") else { return false }
        let parts = cells(text)
        return !parts.isEmpty && parts.allSatisfy(isDelimiterCell)
    }

    private static func oddBackticks(_ line: String) -> Bool {
        var count = 0
        var escaped = false
        for character in line {
            if escaped {
                escaped = false
                continue
            }
            if character == "\\" {
                escaped = true
                continue
            }
            if character == "`" { count += 1 }
        }
        return count % 2 == 1
    }
}

/// Where a growing reply can be cut so the part above never changes again
/// (#3017 L03): just after the last blank line that sits outside a code
/// fence. Everything before it is settled Markdown and can be parsed once;
/// only the tail after it is parsed again on each streamed frame.
public enum MarkdownStreamSplit {
    /// The UTF-8 offset where the stable prefix ends, or 0 when there is
    /// none (no blank line yet, or every blank line is inside a fence).
    ///
    /// A blank line only cuts where parsing the two parts apart gives the
    /// same blocks as parsing the whole (#3017): the line after it starts at
    /// the margin (an indented line may continue a list item or a block
    /// above), and the text holds no footnote or link definition, which
    /// reach back over the cut.
    public static func stablePrefixLength(_ source: String) -> Int {
        if source.contains("[^") || source.contains("]:") { return 0 }
        let bytes = Array(source.utf8)
        var fence: (char: UInt8, count: Int)?
        var lineStart = 0
        var lastBlankEnd = 0
        /// The end of a blank line waiting for the line after it.
        var pendingBlankEnd: Int?
        var index = 0
        let n = bytes.count
        while lineStart < n {
            index = lineStart
            while index < n, bytes[index] != 0x0A { index += 1 }
            let lineEnd = index
            // the line, minus up to three leading spaces and any quote markers
            var cursor = lineStart
            var spaces = 0
            while cursor < lineEnd, bytes[cursor] == 0x20, spaces < 3 { cursor += 1; spaces += 1 }
            while cursor < lineEnd, bytes[cursor] == 0x3E { // '>'
                cursor += 1
                while cursor < lineEnd, bytes[cursor] == 0x20 { cursor += 1 }
            }
            var run = 0
            let marker: UInt8? = cursor < lineEnd && (bytes[cursor] == 0x60 || bytes[cursor] == 0x7E) ? bytes[cursor] : nil
            if let marker {
                while cursor + run < lineEnd, bytes[cursor + run] == marker { run += 1 }
            }
            if let open = fence {
                if let marker, marker == open.char, run >= open.count {
                    // a closer: only the marker and trailing blanks on the line
                    let rest = bytes[(cursor + run)..<lineEnd].allSatisfy { $0 == 0x20 || $0 == 0x09 || $0 == 0x0D }
                    if rest { fence = nil }
                }
            } else {
                let blank = bytes[lineStart..<lineEnd].allSatisfy { $0 == 0x20 || $0 == 0x09 || $0 == 0x0D }
                if blank {
                    // a blank line that is not the very end of what has arrived
                    if lineEnd < n { pendingBlankEnd = lineEnd + 1 }
                } else {
                    if let end = pendingBlankEnd, ![0x20, 0x09, 0x3E].contains(bytes[lineStart]) {
                        lastBlankEnd = end
                    }
                    pendingBlankEnd = nil
                }
                if let marker, run >= 3 { fence = (marker, run) }
            }
            lineStart = lineEnd + 1
        }
        return lastBlankEnd
    }

    /// The stable prefix and the open tail of `source`.
    public static func split(_ source: String) -> (stable: String, tail: String) {
        let length = stablePrefixLength(source)
        guard length > 0 else { return ("", source) }
        let utf8 = source.utf8
        let cut = utf8.index(utf8.startIndex, offsetBy: length)
        return (String(source[..<cut]), String(source[cut...]))
    }
}

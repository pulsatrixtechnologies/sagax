import Foundation

// Markdown read as plain words, for every line that shows a message without
// drawing it: a banner, the roster's last line, an Updates row. The bubble
// draws the Markdown; everywhere else a person reads what it says.
//
// A push read "Rien à trancher. | Champ | Valeur | | --- | --- | | Source |
// Nova..." (2026-11-08). The server now sends plain words; this reads
// the same way here so a stored message, an older server or a local banner
// never shows syntax either. Mirrors shared/plain-text.ts.

public enum PlainText {
    /// One line of plain text: Markdown gone, whitespace collapsed.
    /// `dropCode` drops fenced code blocks instead of reading their code.
    public static func from(markdown raw: String, dropCode: Bool = false) -> String {
        var text = raw.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        // escaped characters read as typed: park them
        var escaped: [String] = []
        text = replace(text, #"\\([\\`*_{}\[\]()#+\-.!|>~])"#) { groups in
            escaped.append(groups[1])
            return "\u{E000}\(escaped.count - 1)\u{E001}"
        }
        // code reads as its code (or leaves, for a banner), untouched by the rules below
        var code: [String] = []
        let park: (String) -> String = { body in
            code.append(body)
            return "\u{E002}\(code.count - 1)\u{E003}"
        }
        text = replace(text, #"^[ \t]*(`{3,}|~{3,})[^\n]*(?:\n([\s\S]*?))?(?:\n[ \t]*\1[`~]*[ \t]*(?=\n|$(?![\s\S]))|$(?![\s\S]))"#, lines: true) { groups in
            dropCode ? "\n" : "\n\(park(groups[2]))\n"
        }
        text = replace(text, #"(`+)([^`]*?)\1"#) { groups in park(groups[2]) }
        // images read as their alt text, links as their label
        text = replace(text, #"!\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)"#) { $0[1] }
        text = replace(text, #"\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)"#) { $0[1] }
        text = replace(text, #"\[([^\]]+)\]\[[^\]]*\]"#) { $0[1] }
        text = replace(text, #"<((?:https?|mailto):[^>\s]+)>"#) { $0[1] }
        text = replace(text, #"<br\s*/?>"#) { _ in " " }
        text = replace(text, #"</?(?:b|strong|i|em|u|s|del|ins|mark|code|kbd|sub|sup|small|span|p|div)\b[^>]*>"#) { _ in "" }
        // tables read as `key : value`, laid out on lines or already flat
        text = linedTables(text)
        text = flattenedTables(text)
        // headings, quotes, bullets, task boxes, rules
        text = replace(text, #"^[ \t]{0,3}#{1,6}[ \t]+"#, lines: true) { _ in "" }
        text = replace(text, #"^[ \t]{0,3}#{1,6}[ \t]*$"#, lines: true) { _ in "" }
        text = replace(text, #"^[ \t]*(?:>[ \t]?)+"#, lines: true) { _ in "" }
        text = replace(text, #"^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?"#, lines: true) { _ in "" }
        text = replace(text, #"^[ \t]{0,3}(?:[-*_][ \t]*){3,}$"#, lines: true) { _ in "" }
        // emphasis; an underscore inside a word (snake_case) stays
        text = replace(text, #"(\*{1,3})(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}])"#) { $0[2] }
        text = replace(text, #"(?<![\p{L}\p{N}])(_{1,3})(?=\S)([\s\S]*?\S)\1(?![\p{L}\p{N}])"#) { $0[2] }
        text = replace(text, #"~~(?=\S)([\s\S]*?\S)~~"#) { $0[1] }
        text = replace(text, #"\*\*+|`{3,}|~~"#) { _ in "" }
        text = replace(text, #"\x{E002}(\d+)\x{E003}"#) { groups in Int(groups[1]).flatMap { code.indices.contains($0) ? code[$0] : nil } ?? "" }
        text = replace(text, #"\x{E000}(\d+)\x{E001}"#) { groups in Int(groups[1]).flatMap { escaped.indices.contains($0) ? escaped[$0] : nil } ?? "" }
        return collapse(text)
    }

    /// A banner body as plain words, line by line: the server joins the
    /// question and its detail with a newline, and that break stays.
    public static func bannerLines(_ raw: String) -> String {
        raw.components(separatedBy: "\n")
            .map { from(markdown: $0, dropCode: true) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// A preview line at most `max` characters, cut at a word with an ellipsis.
    public static func previewLine(_ raw: String, max: Int, dropCode: Bool = true) -> String {
        clip(from(markdown: raw, dropCode: dropCode), max: max)
    }

    /// `text` at most `max` characters, never cut mid-word when a boundary is near.
    public static func clip(_ text: String, max: Int) -> String {
        let clean = collapse(text)
        guard max > 0 else { return "" }
        guard clean.count > max else { return clean }
        if max == 1 { return "…" }
        var cut = String(clean.prefix(max - 1))
        if let space = cut.lastIndex(of: " "), cut.distance(from: cut.startIndex, to: space) >= (max - 1) * 6 / 10 {
            cut = String(cut[..<space])
        }
        while let last = cut.last, last.isWhitespace || ",;:·|([{-".contains(last) { cut.removeLast() }
        return cut + "…"
    }

    // MARK: - Tables

    private static func cells(_ row: String) -> [String] {
        var inner = row.trimmingCharacters(in: .whitespaces)
        if inner.hasPrefix("|") { inner.removeFirst() }
        if inner.hasSuffix("|") { inner.removeLast() }
        return inner.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func rowText(_ cells: [String]) -> String {
        guard cells.contains(where: { !$0.isEmpty }), let key = cells.first else { return "" }
        let value = cells.dropFirst().filter { !$0.isEmpty }.joined(separator: ", ")
        if key.isEmpty { return value }
        return value.isEmpty ? key : "\(key) : \(value)"
    }

    private static func isSeparator(_ line: String) -> Bool {
        line.contains("|") && line.contains("-")
            && line.range(of: #"^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{1,}:?[ \t]*)*\|?[ \t]*$"#, options: .regularExpression) != nil
    }

    /// A whole table already flattened on one line is not a row:
    /// flattenedTables reads it by its separator.
    private static func isPipeRow(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.range(of: #"\|[ \t]*:?-{3,}:?[ \t]*\|"#, options: .regularExpression) != nil, !isSeparator(trimmed) { return false }
        return trimmed.hasPrefix("|") && trimmed.filter { $0 == "|" }.count >= 2
    }

    private static func linedTables(_ text: String) -> String {
        let lines = text.components(separatedBy: "\n")
        var out: [String] = []
        var index = 0
        while index < lines.count {
            let line = lines[index]
            let headed = line.contains("|") && index + 1 < lines.count && isSeparator(lines[index + 1])
            guard headed || isPipeRow(line) else {
                out.append(isSeparator(line) ? "" : line)
                index += 1
                continue
            }
            var rows: [String] = []
            var cursor = index
            if headed { cursor += 2 } else { rows.append(rowText(cells(line))); cursor += 1 }
            while cursor < lines.count, lines[cursor].contains("|"), !lines[cursor].trimmingCharacters(in: .whitespaces).isEmpty {
                if !isSeparator(lines[cursor]) { rows.append(rowText(cells(lines[cursor]))) }
                cursor += 1
            }
            out.append(rows.filter { !$0.isEmpty }.joined(separator: "; "))
            index = cursor
        }
        return out.joined(separator: "\n")
    }

    /// `| a | b | | --- | --- | | x | y |` on one line: the separator says how
    /// many cells a row holds, which is enough to find the rows again.
    private static func flattenedTables(_ input: String) -> String {
        var text = input
        for _ in 0..<32 {
            guard let separator = text.range(of: #"\|(?:[ \t]*:?-{3,}:?[ \t]*\|)+"#, options: .regularExpression) else { break }
            let separatorText = String(text[separator])
            let dashes = (try? NSRegularExpression(pattern: "-{3,}"))?
                .numberOfMatches(in: separatorText, range: NSRange(location: 0, length: (separatorText as NSString).length)) ?? 1
            let columns = Swift.max(1, dashes)
            var start = separator.lowerBound
            let before = String(text[..<separator.lowerBound])
            if let header = before.range(of: "\\|(?:[^|\\n]*\\|){\(columns)}[ \\t]*$", options: .regularExpression) {
                start = text.index(text.startIndex, offsetBy: before.distance(from: before.startIndex, to: header.lowerBound))
            }
            var end = separator.upperBound
            var rows: [String] = []
            while let found = text[end...].range(of: "^[ \\t]*\\|(?:[^|\\n]*\\|){\(columns)}", options: .regularExpression) {
                rows.append(rowText(cells(String(text[found]))))
                end = found.upperBound
            }
            if let partial = text[end...].range(of: #"^[ \t]*\|[^\n]*"#, options: .regularExpression),
               !text[partial].trimmingCharacters(in: CharacterSet(charactersIn: " \t|")).isEmpty {
                rows.append(rowText(cells(String(text[partial]))))
                end = partial.upperBound
            }
            let head = String(text[..<start]).replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression)
            let tail = String(text[end...]).replacingOccurrences(of: #"^\s+"#, with: "", options: .regularExpression)
            let pairs = rows.filter { !$0.isEmpty }.joined(separator: "; ")
            text = [head, pairs, tail].filter { !$0.isEmpty }.joined(separator: " ")
        }
        return text
    }

    // MARK: - Helpers

    private static func collapse(_ text: String) -> String {
        text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Replace every match of `pattern`, the closure given the capture groups
    /// (index 0 the whole match, a group that did not take part as "").
    private static func replace(_ text: String, _ pattern: String, lines: Bool = false, _ transform: ([String]) -> String) -> String {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: lines ? [.anchorsMatchLines] : []) else { return text }
        let source = text as NSString
        var out = ""
        var cursor = 0
        for match in regex.matches(in: text, range: NSRange(location: 0, length: source.length)) {
            out += source.substring(with: NSRange(location: cursor, length: match.range.location - cursor))
            var groups: [String] = []
            for group in 0..<match.numberOfRanges {
                let range = match.range(at: group)
                groups.append(range.location == NSNotFound ? "" : source.substring(with: range))
            }
            out += transform(groups)
            cursor = match.range.location + match.range.length
        }
        out += source.substring(from: cursor)
        return out
    }
}

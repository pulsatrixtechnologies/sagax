// What of the bot's answer a call reads aloud, and in which pieces. A port
// of the desktop's `src/lib/voice-mode/spoken.ts` and `sentences.ts`.
//
// The bot is told it is on the phone (server/voice/voice-call-prompt.ts), but a
// model still slips in a bold word, a bullet, an emoji or a link: the
// speakable text is the safety net before a sentence goes to text to
// speech. The bot ends a call with a written follow-up below a line of only
// `---`: that part is for the chat and is never spoken.
//
// SentenceStream cuts the answer into sentences while it is still being
// written, so the call speaks the first sentence while the rest is
// generated. Feed it the whole text so far; it returns the sentences
// completed since the last call. `finish` returns what is left once the
// answer is settled. A boundary is ., !, ?, ..., : or ; followed by a space
// or a line break (not a decimal "3.5", not an abbreviation "e.g." or
// "M."), a blank line, or the end of a list item. Text inside a code fence
// is skipped. The first sentence may be cut early at a comma once it is
// long, to start speaking sooner; later short sentences are joined to the
// next one, so a reply of many short lines is not many requests.
import Foundation

public enum SpokenText {
    private static let followUpRule = try! NSRegularExpression(
        pattern: #"^[ \t]{0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$"#,
        options: [.anchorsMatchLines]
    )

    /// The part of an answer to read aloud: everything before the follow-up rule.
    public static func spokenPart(_ text: String) -> String {
        let range = NSRange(text.startIndex..., in: text)
        guard let match = followUpRule.firstMatch(in: text, range: range),
              let cut = Range(match.range, in: text) else { return text }
        return String(text[..<cut.lowerBound])
    }

    private struct Rule {
        let regex: NSRegularExpression
        let template: String
        init(_ pattern: String, _ template: String, _ options: NSRegularExpression.Options = []) {
            regex = try! NSRegularExpression(pattern: pattern, options: options)
            self.template = template
        }
    }

    private static let rules: [Rule] = [
        // code fences: the code is for the eye
        Rule("```[\\s\\S]*?(```|$)", " "),
        Rule("~~~[\\s\\S]*?(~~~|$)", " "),
        // images, then links: the label stays, the address goes
        Rule("!\\[([^\\]]*)\\]\\([^)]*\\)", "$1"),
        Rule("\\[([^\\]]+)\\]\\([^)]*\\)", "$1"),
        Rule("<(?:https?://|mailto:)[^>\\s]+>", " ", [.caseInsensitive]),
        Rule("\\b(?:https?://|www\\.)[^\\s<>()]*[^\\s<>().,!?;:'\"]", " ", [.caseInsensitive]),
        // HTML tags
        Rule("</?[a-z][^>]*>", " ", [.caseInsensitive]),
        // table rows and separators
        Rule("^\\s*\\|?[\\s:-]*\\|[\\s|:-]*$", " ", [.anchorsMatchLines]),
        Rule("^\\s*\\|", "", [.anchorsMatchLines]),
        Rule("\\|\\s*$", "", [.anchorsMatchLines]),
        Rule("\\s*\\|\\s*", ", "),
        // headings, list markers, quotes, rules
        Rule("^\\s{0,3}#{1,6}\\s+", "", [.anchorsMatchLines]),
        Rule("^\\s*(?:[-*+\u{2022}]|\\d+[.)])\\s+", "", [.anchorsMatchLines]),
        Rule("^\\s*>\\s?", "", [.anchorsMatchLines]),
        Rule("^\\s*(?:[-*_]\\s*){3,}$", " ", [.anchorsMatchLines]),
        // checkboxes, emphasis, strikethrough, inline code
        Rule("\\[[ xX]\\]\\s*", ""),
        Rule("(\\*\\*|__)(.+?)\\1", "$2"),
        Rule("(^|[^\\w*])\\*(?=\\S)(.+?)(?<=\\S)\\*(?!\\w)", "$1$2"),
        Rule("(^|\\W)_(?=\\S)(.+?)(?<=\\S)_(?!\\w)", "$1$2"),
        Rule("~~(.+?)~~", "$1"),
        Rule("`([^`\\n]*)`", "$1"),
        Rule("[`*]+", " "),
        Rule("[\\p{Extended_Pictographic}\\x{1F1E6}-\\x{1F1FF}\\x{1F3FB}-\\x{1F3FF}\\x{200D}\\x{20E3}\\x{FE0E}\\x{FE0F}]", ""),
        Rule("\\s+", " "),
        Rule("\\s+([.,!?;:])", "$1"),
        Rule("^[\\s,;:]+", ""),
    ]

    private static let letterOrNumber = try! NSRegularExpression(pattern: "[\\p{L}\\p{N}]")

    /// A sentence without markdown, emoji, URLs, HTML or identifiers
    /// (SpokenIdentifiers), whitespace folded.
    public static func speakableSentence(_ piece: String) -> String {
        var text = piece
        for rule in rules {
            text = rule.regex.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text), withTemplate: rule.template
            )
        }
        text = SpokenIdentifiers.strip(text)
        for rule in rules.suffix(3) {
            text = rule.regex.stringByReplacingMatches(
                in: text, range: NSRange(text.startIndex..., in: text), withTemplate: rule.template
            )
        }
        text = text.trimmingCharacters(in: .whitespacesAndNewlines)
        let range = NSRange(text.startIndex..., in: text)
        return letterOrNumber.firstMatch(in: text, range: range) == nil ? "" : text
    }
}

public final class SentenceStream {
    private static let abbreviations: Set<String> = [
        "e.g", "i.e", "etc", "vs", "mr", "mrs", "ms", "dr", "st", "no", "p", "pp", "fig", "approx", "cf",
        "m", "mme", "mlle", "env", "ex", "art", "av", "bd", "ste",
    ]

    private var consumed = 0
    private var emitted = 0
    private var carry = ""
    private let minChars: Int
    private let firstClauseChars: Int
    private let maxChars: Int

    public init(minChars: Int = 28, firstClauseChars: Int = 90, maxChars: Int = 380) {
        self.minChars = minChars
        self.firstClauseChars = firstClauseChars
        self.maxChars = maxChars
    }

    /// Characters of the text already turned into sentences.
    public var position: Int { consumed }

    /// New complete sentences in `text` (the whole text so far).
    public func feed(_ text: String) -> [String] {
        let chars = Self.characters(text)
        if chars.count < consumed {
            // a new block of text started over: begin again
            consumed = 0
            carry = ""
            emitted = 0
        }
        var out: [String] = []
        while true {
            let rest = Array(chars[consumed...])
            let cut = boundary(rest)
            if cut < 0 { break }
            consumed += cut
            push(String(rest[..<cut]), into: &out, last: false)
        }
        return out
    }

    /// Whatever is left once the text is complete.
    public func finish(_ text: String) -> [String] {
        var out = feed(text)
        let chars = Self.characters(text)
        let rest = chars.count >= consumed ? String(chars[consumed...]) : ""
        consumed = chars.count
        push(rest, into: &out, last: true)
        return out
    }

    /// Characters with CRLF folded, so a line break is always one "\n".
    private static func characters(_ text: String) -> [Character] {
        Array(text.replacingOccurrences(of: "\r\n", with: "\n"))
    }

    private func push(_ piece: String, into out: inout [String], last: Bool) {
        let clean = SpokenText.speakableSentence(piece)
        let joined = carry.isEmpty ? clean : (clean.isEmpty ? carry : "\(carry) \(clean)")
        guard !joined.isEmpty else { return }
        if !last && emitted > 0 && joined.count < minChars {
            carry = joined
            return
        }
        carry = ""
        emitted += 1
        out.append(joined)
    }

    private static func isSpace(_ c: Character?) -> Bool { c.map { $0.isWhitespace } ?? false }

    private static func index(of needle: String, in chars: [Character], from start: Int = 0) -> Int? {
        let pattern = Array(needle)
        guard chars.count >= pattern.count, start <= chars.count - pattern.count else { return nil }
        var i = start
        while i <= chars.count - pattern.count {
            if Array(chars[i..<(i + pattern.count)]) == pattern { return i }
            i += 1
        }
        return nil
    }

    /// Index just after the first sentence boundary in `rest`, or -1.
    private func boundary(_ rest: [Character]) -> Int {
        let fence = Self.index(of: "```", in: rest)
        var limit = rest.count
        if let fence {
            if !rest[..<fence].contains(where: { !$0.isWhitespace }) {
                guard let close = Self.index(of: "```", in: rest, from: fence + 3) else { return -1 }
                return close + 3
            }
            limit = fence
        }
        let scan = Array(rest[..<limit])
        let first = emitted == 0
        for i in scan.indices {
            let ch = scan[i]
            let next: Character? = i + 1 < scan.count ? scan[i + 1] : nil
            if ch == "\n" && next == "\n" { return i + 2 }
            if ch == "\n", next != nil, Self.listItemStart(Array(scan[(i + 1)..<min(scan.count, i + 6)])),
               scan[..<i].contains(where: { !$0.isWhitespace }) {
                return i + 1
            }
            if ".!?\u{2026}:;".contains(ch) {
                guard let next else { continue } // the next character decides
                if !next.isWhitespace && !(ch != "." && "\"'\u{00BB})]".contains(next)) { continue }
                if ch == "." && abbreviation(scan, dot: i) { continue }
                if (ch == ":" || ch == ";") && i < 40 { continue }
                return i + 1
            }
            if first && ch == "," && i >= firstClauseChars && Self.isSpace(next) { return i + 1 }
            if i >= maxChars && ch.isWhitespace { return i + 1 }
        }
        return fence ?? -1
    }

    private static let listItem = try! NSRegularExpression(pattern: "^\\s*(?:[-*\u{2022}]|\\d+[.)])\\s")

    private static func listItemStart(_ chars: [Character]) -> Bool {
        let text = String(chars)
        return listItem.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    private func abbreviation(_ text: [Character], dot: Int) -> Bool {
        Self.isAbbreviationDot(text, dot: dot)
    }

    /// The "." at `dot` belongs to an abbreviation ("e.g.", "M."), an
    /// initial ("J. Smith") or a decimal ("3.5"): it ends no sentence.
    static func isAbbreviationDot(_ text: [Character], dot: Int) -> Bool {
        let window = String(text[max(0, dot - 8)..<dot])
        var word = ""
        for ch in window.reversed() {
            if ch.isLetter || ch == "." { word.insert(ch, at: word.startIndex) } else { break }
        }
        word = word.lowercased()
        if word.isEmpty {
            let before = dot > 0 ? text[dot - 1] : " "
            let after = dot + 1 < text.count ? text[dot + 1] : " "
            return before.isNumber && after.isNumber
        }
        if Self.abbreviations.contains(word) { return true }
        // a single capital letter: an initial ("J. Smith")
        return word.count == 1 && dot > 0 && text[dot - 1].isUppercase
    }
}

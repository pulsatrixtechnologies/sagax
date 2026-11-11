// #3581: a result's one or two lines, from the bot's own words (never a model
// call): `reportBrief` of shared/routine-result.ts, for a card the server
// stored before it wrote `brief`. The same cases run on the server, the
// desktop and here (shared/routine-result.vectors.json).
//
// `end`: a routine's report, read from the closing line the run contract
// asks for (its last prose paragraph; run markers, code blocks, tables,
// headings and list items left out), or its first prose sentence when that
// line is shorter than 12 characters or ends with a colon. `start`: the
// first sentence (a reply to another bot, verdict first). A courtesy (an
// offer of more help, a sign-off) is never the brief. At most 200
// characters, whole sentences, never cut inside a word, no Markdown.
import Foundation

public enum ReportBrief {
    public enum From: String, Sendable { case end, start }

    /// The longest brief a result's card shows (two lines of the card).
    public static let max = 200
    /// A closing line shorter than this does not read alone ("Done.").
    private static let minimum = 12

    public static func of(_ text: String?, from: From) -> String {
        let clean = unwrap(withoutRoutineMarkers(text ?? ""))
        guard !clean.isEmpty else { return "" }
        let parts = resultParts(clean)
        let source = parts.structured ? parts.words : clean
        guard !source.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        let prose = proseOf(source)
        guard !prose.isEmpty else { return "" }
        // each entry's sentences without its courtesies; an entry left empty goes
        let kept = prose
            .map { Entry(text: sentences($0.text).filter { !isCourtesy($0) }.joined(separator: " "), item: $0.item) }
            .filter { !$0.text.isEmpty }
        func pick(_ entries: [Entry]) -> [Entry] {
            entries.contains { !$0.item } ? entries.filter { !$0.item } : entries
        }
        // nothing but courtesies: the bot's own first sentence, the only words there are
        let paragraphs = pick(kept.isEmpty ? prose : kept)
        let first = { fit(sentences(paragraphs[0].text).first ?? paragraphs[0].text) }
        if from == .start { return first() }
        let closing = paragraphs[paragraphs.count - 1].text
        if closing.count < minimum || matches(#":\s*$"#, closing) {
            return paragraphs.count > 1 || sentences(closing).count > 1 ? first() : fit(closing)
        }
        return fit(closing)
    }

    // MARK: Courtesy

    /// Matched at the sentence's start only: "let me know" inside a fact is a fact.
    private static let courtesyOpenings = [
        // English
        #"(?:just |please )?let me know (?:if|whether|when|should)\b"#,
        #"(?:please )?feel free to\b"#,
        #"(?:just )?tell me if\b"#,
        #"(?:i'?m |i am |i'?d be |i would be |always )?(?:happy|glad) to\b(?! (?:report|say|confirm|announce|share that)\b)"#,
        #"(?:please )?don'?t hesitate\b"#,
        #"if you (?:need|have|want) (?:anything|any|more)\b"#,
        #"hope (?:this|that) helps\b"#,
        #"have a (?:good|great|nice|lovely) (?:day|evening|night|weekend|one)\b"#,
        // French
        #"(?:sinon, )?di(?:s|tes)[- ]moi si\b"#,
        #"n'h[ée]sit(?:e|ez) pas\b"#,
        #"fai(?:s|tes)[- ]moi (?:signe|savoir)\b"#,
        #"laisse(?:z)?[- ]moi savoir\b"#,
        #"si (?:tu as|vous avez) besoin\b"#,
        #"bonne (?:journ[ée]e|soir[ée]e|nuit|fin de semaine)\b"#,
    ]
    private static let courtesy = try! NSRegularExpression(
        pattern: "^[\\s\"'«“*_(]*(?:\(courtesyOpenings.joined(separator: "|")))", options: [.caseInsensitive]
    )

    /// The sentence is an offer of more help or a sign-off, never a brief.
    public static func isCourtesy(_ sentence: String) -> Bool {
        let text = sentence.replacingOccurrences(of: "’", with: "'").replacingOccurrences(of: "‘", with: "'")
        return courtesy.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) != nil
    }

    // MARK: Prose

    private struct Entry { var text: String; var item: Bool }

    private static let tableLine = #"^\|"#
    private static let headingLine = #"^#{1,6}\s"#
    private static let ruleLine = #"^(?:[-*_]\s*){3,}$"#
    private static let htmlLine = #"^</?[a-zA-Z!]"#
    private static let listItem = #"^(?:[-*+]|\d{1,3}[.)])\s+"#
    private static let punctuationOnly = #"^[\s{}\[\](),:;"'`]*$"#

    /// The prose of a text, one entry per paragraph, in order: fenced
    /// blocks, tables, headings, rules and HTML left out; a list item is its
    /// own entry, marked so prose paragraphs come first.
    private static func proseOf(_ text: String) -> [Entry] {
        let lines = splitLines(text)
        let fenced = fencedLines(lines)
        var out: [Entry] = []
        var current: [String] = []
        func flush() {
            let joined = PlainText.from(markdown: current.joined(separator: " "))
            if !joined.isEmpty, !matches(punctuationOnly, joined) { out.append(Entry(text: joined, item: false)) }
            current = []
        }
        for (index, raw) in lines.enumerated() {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if fenced[index] || line.isEmpty || matches(tableLine, line) || matches(headingLine, line)
                || matches(ruleLine, line) || matches(htmlLine, line) {
                flush()
                continue
            }
            if matches(listItem, line) {
                flush()
                let item = PlainText.from(markdown: replace(listItem, in: line, with: ""))
                if !item.isEmpty { out.append(Entry(text: item, item: true)) }
                continue
            }
            current.append(line)
        }
        flush()
        return out
    }

    private static let sentenceBreak = try! NSRegularExpression(pattern: #"(?<=[.!?…])\s+(?=\S)"#)

    /// The sentences of a paragraph (a period inside "2.5" or "1,204" splits nothing).
    static func sentences(_ paragraph: String) -> [String] {
        let range = NSRange(paragraph.startIndex..., in: paragraph)
        var parts: [String] = []
        var start = paragraph.startIndex
        for match in sentenceBreak.matches(in: paragraph, range: range) {
            guard let found = Range(match.range, in: paragraph) else { continue }
            parts.append(String(paragraph[start..<found.lowerBound]))
            start = found.upperBound
        }
        parts.append(String(paragraph[start...]))
        return parts.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// A paragraph within the brief's length: whole when it fits, else its
    /// whole sentences from the start that fit, else cut at a word.
    private static func fit(_ paragraph: String) -> String {
        if paragraph.count <= max { return paragraph }
        var kept = ""
        for sentence in sentences(paragraph) {
            let next = kept.isEmpty ? sentence : "\(kept) \(sentence)"
            if next.count > max { break }
            kept = next
        }
        return kept.isEmpty ? clipReadable(paragraph, max) : kept
    }

    /// `text` within `max` characters: cut at the last line, sentence or
    /// word that fits and marked with "…", never inside a word
    /// (`clipReadable`).
    static func clipReadable(_ text: String, _ max: Int, mark: String = "…") -> String {
        if text.count <= max { return text }
        let head = String(text.prefix(Swift.max(1, max - mark.count)))
        func last(_ needle: String) -> Int {
            guard let range = head.range(of: needle, options: .backwards) else { return -1 }
            return head.distance(from: head.startIndex, to: range.lowerBound)
        }
        let line = last("\n")
        let sentence = [last(". "), last("! "), last("? "), last(": ")].max() ?? -1
        let word: Int = {
            guard let range = head.range(of: #"\s\S*$"#, options: .regularExpression) else { return -1 }
            return head.distance(from: head.startIndex, to: range.lowerBound)
        }()
        let half = Double(max) / 2
        let end = Double(line) > half ? line : Double(sentence) > half ? sentence + 1 : Double(word) > half ? word : head.count
        let kept = String(head.prefix(end))
        return kept.replacingOccurrences(of: #"\s+$"#, with: "", options: .regularExpression) + mark
    }

    // MARK: Run markers

    private static let wrapperLine = #"^<<</?\s*(?:END\s+)?UNTRUSTED\b[^>]*>>>$"#
    private static let runStatusAny = #"^[\s`*_>]*RUN_STATUS[\s`*_]*(?::|$)"#
    private static let runStatusProblem = #"^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially)\b[\s`*_]*[:\x{2014}\x{2013}-]?\s*(.*)$"#
    private static let quietToken = #"^[\s`*_]*NOTHING_TO_REPORT[\s`*_.!]*$"#
    private static let sameToken = #"^[\s`*_]*SAME_PROBLEM[\s`*_.!]*$"#
    private static let quietLine = #"^[\s`*_\[(<"']*nothing[\s_-]to[\s_-]report[\s`*_\])>"'.!]*$"#
    private static let sameLine = #"^[\s`*_\[(<"']*same[\s_-]problem[\s`*_\])>"'.!]*$"#
    private static let markerHint = #"RUN[_ ]STATUS|nothing[\s_-]to[\s_-]report|same[\s_-]problem"#

    /// Lines without the engine's wrapper markers.
    private static func unwrap(_ text: String) -> String {
        splitLines(text).filter { !matches(wrapperLine, $0.trimmingCharacters(in: .whitespaces), ignoreCase: true) }
            .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func isRoutineMarker(_ line: String) -> Bool {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        return matches(runStatusAny, trimmed) || matches(runStatusProblem, trimmed, ignoreCase: true)
            || matches(quietToken, trimmed) || matches(sameToken, trimmed)
            || matches(quietLine, trimmed, ignoreCase: true) || matches(sameLine, trimmed, ignoreCase: true)
    }

    /// Routine output without its marker lines; a line inside a fenced code
    /// block is what the bot quoted, never a marker.
    private static func withoutRoutineMarkers(_ text: String) -> String {
        guard matches(markerHint, text, ignoreCase: true, anchored: false) else { return text }
        let lines = splitLines(text)
        let fenced = fencedLines(lines)
        let kept = lines.enumerated().filter { fenced[$0.offset] || !isRoutineMarker($0.element) }.map(\.element)
        guard kept.count != lines.count else { return text }
        return replace(#"\n{3,}"#, in: kept.joined(separator: "\n"), with: "\n\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func fencedLines(_ lines: [String]) -> [Bool] {
        var open = false
        return lines.map { line in
            if matches(#"^\s*(?:```|~~~)"#, line) {
                open.toggle()
                return true
            }
            return open
        }
    }

    // MARK: Structure

    private struct Parts {
        var summary: String?
        var reason: String?
        var done: [String] = []
        var blocked: [String] = []
        var todo: [String] = []
        var excerpt: String?
        var structured = false

        /// The words of a structure a brief can read.
        var words: String {
            if let summary, !summary.isEmpty { return summary }
            if let reason, !reason.isEmpty { return reason }
            for list in [todo, done, blocked] where !list.isEmpty { return list.joined(separator: "; ") }
            return excerpt ?? ""
        }
    }

    private static let statusLine = #"^[\s`*_>]*RUN[_ ]STATUS\s*:?[\s`*_]*(failed|failure|partial|partially|blocked)\b[\s`*_]*[:\x{2014}\x{2013}-]?\s*(.*)$"#
    private static let summaryKeys = ["summary", "message", "result", "report", "text", "outcome", "status_line", "statusline", "headline"]
    private static let reasonKeys = ["reason", "blocked_reason", "blockedreason", "why", "error", "problem", "cause"]
    private static let doneKeys = ["done", "completed", "did", "actions", "actions_taken", "actionstaken", "changes", "steps_done"]
    private static let blockedKeys = ["blocked", "blockers", "blocked_on", "blockedon", "waiting_on", "waitingon", "waiting_for", "waitingfor"]
    private static let todoKeys = ["todo", "next", "next_steps", "nextsteps", "needs", "needs_you", "action_required", "actionrequired", "person_action", "you_must", "ask"]

    /// The parts of a run's final text a brief reads (`routineResultParts`).
    private static func resultParts(_ raw: String) -> Parts {
        var parts = Parts()
        var text = unwrap(raw)
        guard !text.isEmpty else { return parts }
        let lines = splitLines(text)
        if let at = lines.firstIndex(where: { matches(statusLine, $0.trimmingCharacters(in: .whitespaces), ignoreCase: true) }) {
            text = lines.enumerated().filter { $0.offset != at }.map(\.element).joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
        }
        guard let found = findStructure(text) else {
            if matches(#"^\s*[{\[]"#, text) {
                parts.structured = true
                let line = meaningfulLine(text)
                if !line.isEmpty { parts.excerpt = line }
            } else if !text.isEmpty {
                parts.summary = text
            }
            return parts
        }
        parts.structured = true
        let lead = [found.before, found.after].filter { !$0.isEmpty && !matches(punctuationOnly, $0) }
            .joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !lead.isEmpty { parts.summary = lead }
        if let array = found.value as? [Any] {
            parts.excerpt = list(array).prefix(3).joined(separator: " · ")
            return parts
        }
        guard let object = found.value as? [String: Any] else { return parts }
        let summary = sentence(field(object, summaryKeys))
        if !summary.isEmpty {
            if let lead = parts.summary { if summary != lead { parts.summary = "\(lead)\n\(summary)" } } else { parts.summary = summary }
        }
        let reason = sentence(field(object, reasonKeys))
        if !reason.isEmpty { parts.reason = reason }
        parts.done = list(field(object, doneKeys))
        parts.blocked = list(field(object, blockedKeys))
        parts.todo = list(field(object, todoKeys))
        if parts.summary == nil, parts.reason == nil, parts.todo.isEmpty, parts.done.isEmpty, parts.blocked.isEmpty {
            parts.excerpt = object.keys.sorted().compactMap { key -> String? in
                let inner = object[key]
                guard let inner, !(inner is [Any]), !(inner is [String: Any]), !(inner is NSNull) else { return nil }
                return "\(key): \(String(describing: inner).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).prefix(80))"
            }.prefix(4).joined(separator: " · ")
        }
        return parts
    }

    private static func parse(_ text: String) -> Any? {
        guard let data = text.data(using: .utf8) else { return nil }
        let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
        return value is [Any] || value is [String: Any] ? value : nil
    }

    /// The JSON object or array in the text, with the prose around it.
    private static func findStructure(_ text: String) -> (value: Any, before: String, after: String)? {
        let trim: (Substring) -> String = { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        if let fence = text.range(of: #"```(?:json|JSON)?\s*\n([\s\S]*?)\n?```"#, options: .regularExpression) {
            let block = String(text[fence])
            let body = replace(#"^```(?:json|JSON)?\s*\n|\n?```$"#, in: block, with: "")
            if let value = parse(body.trimmingCharacters(in: .whitespacesAndNewlines)) {
                return (value, trim(text[..<fence.lowerBound]), trim(text[fence.upperBound...]))
            }
        }
        let lines = splitLines(text)
        var offset = 0
        for (index, line) in lines.enumerated() {
            defer { offset += line.count + 1 }
            guard let opener = line.drop(while: { $0.isWhitespace }).first, opener == "{" || opener == "[" else { continue }
            let closer: Character = opener == "{" ? "}" : "]"
            guard let end = text.lastIndex(of: closer) else { continue }
            let from = text.index(text.startIndex, offsetBy: offset)
            guard end > from else { continue }
            if let value = parse(String(text[from...end])) {
                return (value, trim(text[..<from]), trim(text[text.index(after: end)...]))
            }
            if let single = parse(line.trimmingCharacters(in: .whitespaces)) {
                return (single, lines[..<index].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines),
                        lines[(index + 1)...].joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
        return nil
    }

    private static func field(_ object: [String: Any], _ keys: [String]) -> Any? {
        for key in object.keys.sorted() {
            let normal = key.lowercased().replacingOccurrences(of: #"[\s-]"#, with: "_", options: .regularExpression)
            if keys.contains(normal) { return object[key] }
        }
        return nil
    }

    private static func sentence(_ value: Any?) -> String {
        switch value {
        case let text as String:
            return text.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        case let number as NSNumber:
            return CFGetTypeID(number) == CFBooleanGetTypeID() ? (number.boolValue ? "true" : "false") : number.stringValue
        case let object as [String: Any]:
            if let named = field(object, ["summary", "message", "text", "title", "what", "reason", "name"]) as? String { return sentence(named) }
            return object.keys.sorted().compactMap { key -> String? in
                switch object[key] {
                case let text as String: return "\(key): \(text)"
                case let number as NSNumber: return "\(key): \(number)"
                default: return nil
                }
            }.prefix(3).joined(separator: ", ")
        default:
            return ""
        }
    }

    private static func list(_ value: Any?) -> [String] {
        guard let value, !(value is NSNull) else { return [] }
        if let flag = value as? Bool, flag == false, CFGetTypeID(value as CFTypeRef) == CFBooleanGetTypeID() { return [] }
        let items = value as? [Any] ?? [value]
        return Array(items.map(sentence).filter { !$0.isEmpty }.prefix(8))
    }

    /// The first line of the text that carries words.
    private static func meaningfulLine(_ text: String) -> String {
        for raw in splitLines(unwrap(text)) {
            let line = raw.trimmingCharacters(in: .whitespaces)
            if line.isEmpty || matches(punctuationOnly, line) { continue }
            return line
        }
        return ""
    }

    // MARK: Text

    private static func splitLines(_ text: String) -> [String] {
        text.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    }

    private static func matches(_ pattern: String, _ text: String, ignoreCase: Bool = false, anchored: Bool = true) -> Bool {
        var options: String.CompareOptions = [.regularExpression]
        if ignoreCase { options.insert(.caseInsensitive) }
        return text.range(of: pattern, options: options) != nil
    }

    private static func replace(_ pattern: String, in text: String, with template: String) -> String {
        text.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
    }
}

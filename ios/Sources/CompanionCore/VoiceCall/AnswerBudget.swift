// How much of an answer a call says aloud. A port of the desktop's
// `src/lib/voice-mode/answer-budget.ts`.
//
// The bot is told the voice output contract (server/voice/voice-call-prompt.ts:
// the verdict first, one to four short spoken sentences, at most one
// question). This is the deterministic cap: at most four sentences are said
// (a line break after words ends one too), and a question ends what is
// said, so the person answers it. The words after the cut stay in the
// chat; after the sentence cap the call says the rest is written there.
// The cut keeps a prefix of the text so far that only grows, so a sentence
// stream fed with it never starts over.
import Foundation

public enum SpokenAnswerCut: Equatable, Sendable {
    /// the sentence cap: the call says the rest is in the chat
    case length
    /// the first question ends it: the person answers
    case question
}

extension SpokenText {
    /// The most sentences a call says of one answer.
    public static let spokenSentencesMax = 4

    /// The text with its code (a fenced block, even unfinished, and inline
    /// code) blanked out with "_", line breaks kept: code counts for nothing,
    /// and a mark next to it never becomes a sentence end later.
    static func withoutCode(_ text: [Character]) -> [Character] {
        var out = text
        var i = 0
        func fence(at j: Int) -> Character? {
            guard j + 2 < text.count else { return nil }
            for mark in ["`", "~"] as [Character] where text[j] == mark && text[j + 1] == mark && text[j + 2] == mark { return mark }
            return nil
        }
        while i < text.count {
            if let mark = fence(at: i) {
                var j = i + 3
                while j < text.count && fence(at: j) != mark { j += 1 }
                let stop = min(text.count, j + 3)
                for k in i..<stop where !text[k].isNewline { out[k] = "_" }
                i = stop
                continue
            }
            if text[i] == "`" {
                var j = i + 1
                while j < text.count && text[j] != "`" && !text[j].isNewline { j += 1 }
                if j < text.count && text[j] == "`" {
                    for k in i...j { out[k] = "_" }
                    i = j + 1
                    continue
                }
            }
            i += 1
        }
        return out
    }

    /// The part of an answer a call says aloud, and why it stops early
    /// (nil: said whole). A quoted question, or a rhetorical one of one or
    /// two words, does not end it.
    public static func spokenAnswer(_ text: String, max: Int = spokenSentencesMax) -> (text: String, cut: SpokenAnswerCut?) {
        let spoken = Array(spokenPart(text))
        let scan = withoutCode(spoken)
        let closing: Set<Character> = ["\"", "'", "»", "”", ")", "]"]
        let quotes: Set<Character> = ["\"", "'", "»", "”"]
        var count = 0
        var from = 0
        var i = 0
        func hasLetter(_ slice: ArraySlice<Character>) -> Bool { slice.contains { $0.isLetter } }
        func words(_ slice: ArraySlice<Character>) -> Int {
            String(slice).split { !($0.isLetter || $0.isNumber || $0 == "'" || $0 == "’" || $0 == "-") }.count
        }
        while i < scan.count {
            let ch = scan[i]
            var marks = ""
            var end = i
            var quotedAfter = false
            if ch.isNewline {
                end = i + 1
            } else if ".!?…".contains(ch) {
                var j = i
                while j < scan.count, ".!?…".contains(scan[j]) { marks.append(scan[j]); j += 1 }
                var lastQuote = false
                while j < scan.count, closing.contains(scan[j]) { lastQuote = quotes.contains(scan[j]); j += 1 }
                // a boundary only before a space or the end
                if j < scan.count && !scan[j].isWhitespace { i = j; continue }
                end = j
                if marks == "." && SentenceStream.isAbbreviationDot(scan, dot: i) { i = j; continue }
                var k = j
                while k < scan.count, scan[k].isWhitespace, !scan[k].isNewline { k += 1 }
                quotedAfter = lastQuote || (k > j && k < scan.count && (scan[k] == "»" || scan[k] == "”"))
            } else {
                i += 1
                continue
            }
            let start = i
            i = end
            let sentence = scan[from..<start]
            // a sentence needs words: a lone "1." or an empty line is not one
            if !hasLetter(sentence) { from = end; continue }
            from = end
            count += 1
            let question = marks.contains("?") && !quotedAfter && words(sentence) > 2
            if !question && count < max { continue }
            var keep = end
            while keep < spoken.count, spoken[keep].isWhitespace { keep += 1 }
            let rest = String(spoken[end...])
            let cut: SpokenAnswerCut? = speakableSentence(rest).isEmpty ? nil : (question ? .question : .length)
            return (String(spoken[..<keep]), cut)
        }
        return (String(spoken), nil)
    }
}

extension SpokenText {
    /// A bot's answer as the call's transcript shows it (spoken.ts
    /// transcriptText): the part the call says, no markdown, one sentence
    /// per former line or bullet; an answer cut at the sentence cap ends
    /// with an ellipsis, the rest being in the chat.
    public static func transcriptText(_ text: String) -> String {
        let said = spokenAnswer(text)
        let lines = said.text
            .split(whereSeparator: \.isNewline)
            .map { speakableSentence(String($0)) }
            .filter { !$0.isEmpty }
            .map { line -> String in
                guard let last = line.last, ".!?…:;,".contains(last) else { return line + "." }
                return line
            }
        let joined = lines.joined(separator: " ")
        guard said.cut == .length, !joined.isEmpty else { return joined }
        var trimmed = joined
        if let last = trimmed.last, ".!?…:;,".contains(last) { trimmed.removeLast() }
        return trimmed + "…"
    }
}

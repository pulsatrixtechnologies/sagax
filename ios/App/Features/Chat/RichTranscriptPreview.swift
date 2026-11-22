#if DEBUG
// `-rich-transcript-preview <count>`: one long conversation made of every
// message of the store preview fixtures (text, markdown, forms, approvals,
// steps, routine cards, digests), repeated with fresh ids, for the headless
// chat-open stack measure (MainStackProbe). Fixture data only.
import Foundation
import CompanionCore

enum RichTranscriptPreview {
    static let flag = "-rich-transcript-preview"
    static let fixtures = [
        "StorePreview", "CardsPreview", "ChatRelevantPreview", "FormCardsPreview", "OutboundPreview",
        "PhoneLinePreview", "RecordCardPreview", "ChatPresentationPreview", "AskFactsPreview", "ImagePreview",
    ]

    static func count(in arguments: [String]) -> Int? {
        guard let index = arguments.firstIndex(of: flag) else { return nil }
        if arguments.indices.contains(index + 1), let parsed = Int(arguments[index + 1]), parsed > 0 { return parsed }
        return 400
    }

    /// The fixtures' messages, oldest first, then long markdown replies.
    static func samples() -> [Message] {
        var out: [Message] = []
        for name in fixtures {
            guard let url = Bundle.main.url(forResource: name, withExtension: "json"),
                  let data = try? Data(contentsOf: url),
                  let fleet = try? JSONDecoder().decode(Fleet.self, from: data) else { continue }
            for bot in fleet.bots { out += bot.messages ?? [] }
            for room in fleet.groups { out += room.messages ?? [] }
        }
        // the markdown replies borrow a fixture bot reply's shape
        if let template = out.first(where: { $0.role == .bot && $0.kind == .text }) {
            for text in markdown {
                var message = template
                message.text = text
                out.append(message)
            }
        }
        // one bot card nested 40 deep: what a phone pays for a message's shape
        // (ChatWidgetNode.cappedDepth, #5159). Near the top on purpose: a
        // `LazyVStack` lays out the rows on screen, and a card at the end of
        // the pool would never be drawn by the measure.
        if let template = out.first(where: { $0.role == .bot }), let payload = RichTranscriptPreview.deepCard {
            var message = template
            message.kind = .widget
            message.text = "Weekly numbers"
            message.widget = payload
            out.insert(message, at: min(2, out.count))
        }
        return out
    }

    /// A widget tree nested 40 deep, one line of text at the bottom, as it
    /// arrives on the wire: drawn 10 levels deep, its words kept
    /// (ChatWidgetNode.maxDepth).
    static let deepCard: ChatWidgetPayload? = {
        var json = #"{"type":"Text","id":"deep-leaf","value":"Weekly numbers"}"#
        for level in 0..<39 { json = #"{"type":"Col","id":"deep-\#(level)","children":[\#(json)]}"# }
        return try? JSONDecoder().decode(ChatWidgetPayload.self, from: Data(#"{"v":1,"rev":0,"root":\#(json)}"#.utf8))
    }()

    static func messages(count: Int, idPrefix: String, baseAt: Double = 1_700_000_000_000) -> [Message] {
        let pool = samples()
        guard !pool.isEmpty, count > 0 else { return [] }
        var out: [Message] = []
        out.reserveCapacity(count)
        var parent: String?
        for i in 0..<count {
            var message = pool[i % pool.count]
            message.id = "\(idPrefix)-\(i)"
            message.at = baseAt + Double(i) * 60_000
            message.parentId = parent
            parent = message.id
            out.append(message)
        }
        return out
    }

    static let markdown = [
        """
        ## Weekly plan

        Here is what changed since **Monday**, with the open points:

        1. Billing export
           - the March file is late
           - two lines need a second look
             - one refund
             - one duplicate
        2. Network refresh
           > The switch in room B stays until Friday.
        3. Follow-ups

        | Item | Owner | Due |
        |---|---|---|
        | Export | Ava | Fri |
        | Switch | Leo | Mon |

        ```swift
        let total = lines.reduce(0) { $0 + $1.amount }
        print(total)
        ```

        See [the report](https://example.com/report) for the details.
        """,
        """
        ### Checklist

        - [x] Backups verified
        - [ ] Certificates renewed
        - [ ] Printer queue cleared

        > **Note**: the second item needs the admin account.
        > It can wait until the window on *Saturday*.

        ---

        A long paragraph to wrap over several lines so the bubble has to measure real text: \
        the quick brown fox jumps over the lazy dog, again and again, until the line breaks \
        a few times on a phone screen and the layout has some work to do.
        """,
    ]
}
#endif

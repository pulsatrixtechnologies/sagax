// Synthetic long threads for DEBUG / demo measurement of the chat transcript.
// Pure data only: no UI, no network. Used to prove LazyVStack stays responsive
// around ~2000 messages without touching a real conversation.
import Foundation

public enum LongTranscript {
    /// Default size for the headless before/after measure.
    public static let defaultCount = 2000

    /// Builds `count` alternating user/bot text lines, oldest first, chained
    /// by `parentId` the way a real thread is stored. Timestamps advance by
    /// one minute so day separators and stretch gaps stay quiet.
    public static func messages(
        count: Int,
        idPrefix: String = "long",
        baseAt: Double = 1_700_000_000_000
    ) -> [Message] {
        let n = max(0, count)
        guard n > 0 else { return [] }
        var out: [Message] = []
        out.reserveCapacity(n)
        var parent: String? = nil
        for i in 0..<n {
            let id = "\(idPrefix)-\(i)"
            let user = i % 2 == 0
            var message = Message(
                id: id,
                role: user ? .user : .bot,
                kind: .text,
                at: baseAt + Double(i) * 60_000
            )
            message.text = user
                ? "Synthetic user line \(i) for long-transcript measure."
                : "Synthetic bot reply \(i). Short on purpose so layout cost is mostly the row count."
            message.parentId = parent
            parent = id
            out.append(message)
        }
        return out
    }

    /// Parses `-long-transcript-preview` and an optional count that follows it.
    /// Returns nil when the flag is absent.
    public static func previewCount(in arguments: [String]) -> Int? {
        guard let index = arguments.firstIndex(of: "-long-transcript-preview") else { return nil }
        if arguments.indices.contains(index + 1),
           let parsed = Int(arguments[index + 1]), parsed > 0 {
            return parsed
        }
        return defaultCount
    }
}

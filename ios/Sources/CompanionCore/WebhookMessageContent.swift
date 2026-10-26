import Foundation

/// A display projection only: the stored prompt retains its trust wrappers.
/// Matches the desktop's webhook-message parser.
public struct WebhookMessageContent: Hashable, Sendable {
    public let task: String
    public let payload: String?

    public static func parse(_ text: String) -> Self? {
        // Newer prompts carry a random boundary on both event markers; older ones none.
        guard let regex = try? NSRegularExpression(pattern: "\\[UNTRUSTED WEBHOOK EVENT DATA(?: ([0-9a-f]{12,64}))?\\]\n"),
              let open = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let openRange = Range(open.range, in: text) else { return nil }
        let boundary = Range(open.range(at: 1), in: text).map { " " + text[$0] } ?? ""
        let trustedPrefix = String(text[..<openRange.lowerBound])
        func block(_ marker: String, in source: String) -> String? {
            guard let start = source.range(of: "[\(marker)]\n"),
                  let end = source.range(of: "\n[/\(marker)]", range: start.upperBound..<source.endIndex) else { return nil }
            return String(source[start.upperBound..<end.lowerBound])
        }
        let markers = ["AUTHENTICATED WEBHOOK TASK", "USER-CONFIGURED WEBHOOK INSTRUCTIONS", "DEFAULT WEBHOOK INSTRUCTIONS"]
        guard let task = markers.compactMap({ block($0, in: trustedPrefix)?.trimmingCharacters(in: .whitespacesAndNewlines) })
            .first(where: { !$0.isEmpty }),
              let close = text.range(of: "\n[/UNTRUSTED WEBHOOK EVENT DATA\(boundary)]", range: openRange.upperBound..<text.endIndex)
        else { return nil }
        let event = String(text[openRange.upperBound..<close.lowerBound])
        guard !event.isEmpty else { return nil }
        let payload = event.range(of: "\n\n").map {
            String(event[$0.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return Self(task: task, payload: payload?.isEmpty == false ? payload : nil)
    }
}

public extension Message {
    var webhookContent: WebhookMessageContent? {
        guard role == .user, kind == .text, let text else { return nil }
        return WebhookMessageContent.parse(text)
    }
}

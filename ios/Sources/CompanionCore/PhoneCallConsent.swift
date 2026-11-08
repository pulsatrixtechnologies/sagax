// One-time acceptable-use consent before a bot may place phone calls for
// the person (`shared/phone-call-consent.ts`, PhoneCallConsentCard.tsx).
// Sagax wording; never reference app legal text. The answer is a fixed Accept /
// Decline label the server maps to allow/deny.
import Foundation

public struct PhoneCallConsentCardData: Codable, Hashable, Sendable {
    public var requestId: String
    public var botId: String
    public var threadId: String
    /// "pending", "accepted" or "declined".
    public var status: String
    /// Consent wording version the card records.
    public var version: Int
    /// epoch ms when the person accepted (absent while pending or declined).
    public var acceptedAt: Double?

    public var isPending: Bool { status == "pending" }
    public var isAccepted: Bool { status == "accepted" || acceptedAt != nil }

    public init(requestId: String, botId: String, threadId: String, status: String, version: Int = 1, acceptedAt: Double? = nil) {
        self.requestId = requestId
        self.botId = botId
        self.threadId = threadId
        self.status = status
        self.version = version
        self.acceptedAt = acceptedAt
    }

    private enum CodingKeys: String, CodingKey {
        case requestId, botId, threadId, status, version, acceptedAt
    }

    /// Lenient: a field this phone does not know the shape of is left out
    /// rather than failing the whole options message it arrived on.
    public init(from decoder: Decoder) throws {
        let row = try decoder.container(keyedBy: CodingKeys.self)
        requestId = (try? row.decode(String.self, forKey: .requestId)) ?? ""
        botId = (try? row.decode(String.self, forKey: .botId)) ?? ""
        threadId = (try? row.decode(String.self, forKey: .threadId)) ?? ""
        status = (try? row.decode(String.self, forKey: .status)) ?? "pending"
        version = (try? row.decodeIfPresent(Int.self, forKey: .version))
            ?? (try? row.decodeIfPresent(Double.self, forKey: .version)).map { Int($0.rounded()) }
            ?? 1
        acceptedAt = try? row.decodeIfPresent(Double.self, forKey: .acceptedAt)
    }
}

/// Fixed labels and the allow/deny map (`phoneCallConsentBehavior`).
public enum PhoneCallConsentRules {
    public static let approveLabels = ["Accept", "Accepter"]
    public static let declineLabels = ["Decline", "Refuser"]

    /// Maps the card's answer label to the respond route's behavior.
    public static func behavior(for answer: String) -> String {
        let normalized = answer.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return approveLabels.contains(where: { $0.lowercased() == normalized }) ? "allow" : "deny"
    }
}

import CryptoKit
import Foundation

/// Stays stable across phone restarts and route changes. The credential
/// fingerprint and revision live together in the phone's Keychain.
public struct WatchSessionGeneration: Codable, Equatable {
    public let revision: Int64
    private let fingerprint: Data?

    public static func resolve(previous: Self?, accountID: String?, token: String?, now: Date = Date()) -> Self {
        let fingerprint: Data?
        if let accountID, let token {
            var hash = SHA256()
            hash.update(data: Data(accountID.utf8))
            hash.update(data: Data([0]))
            hash.update(data: Data(token.utf8))
            fingerprint = Data(hash.finalize())
        } else {
            fingerprint = nil
        }
        if let previous, previous.fingerprint == fingerprint { return previous }
        let clock = Int64(now.timeIntervalSince1970 * 1_000_000)
        return Self(revision: max(clock, (previous?.revision ?? 0) + 1), fingerprint: fingerprint)
    }

    /// A delayed reply or queued context can never restore a previous account.
    public static func accepts(_ incoming: Int64, after local: Int64) -> Bool {
        incoming > 0 && incoming >= local
    }
}

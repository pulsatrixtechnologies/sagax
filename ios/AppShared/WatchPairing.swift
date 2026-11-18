import CompanionCore
import Foundation

/// Only the revision and non-secret connection metadata go in WatchConnectivity's
/// queued application context. The paired watch requests the credential
/// through an interactive reply and saves it directly to its own Keychain.
struct WatchPairing: Codable, Equatable {
    static let requestKey = "sagax.watch.pairing"
    static let revisionKey = "sagax.watch.revision"
    static let connectionKey = "sagax.watch.connection"

    var connection: Connection
    var token: String
}

struct WatchPairingReply: Codable {
    var revision: Int64
    var pairing: WatchPairing?
}

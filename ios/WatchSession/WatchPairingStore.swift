import CompanionCore
import Foundation

/// Changing accounts publishes one new record after its Keychain write.
enum WatchPairingStore {
    struct Record: Codable, Equatable {
        let revision: Int64
        let connection: Connection?
    }

    private static let key = "watch.activePairing"

    static var record: Record? {
        guard let data = SagaxSharedConfiguration.sharedDefaults?.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(Record.self, from: data)
    }

    static func token(for revision: Int64) throws -> String? {
        try SagaxSharedKeychain.token(for: keychainID(revision))
    }

    static func loadClient(endpoint: CompanionEndpoint? = nil) async throws -> CompanionClient? {
        guard let record, let connection = record.connection,
              let token = try token(for: record.revision) else { return nil }
        let endpoint = endpoint ?? CandidateRotation(endpoints: connection.orderedEndpoints).currentEndpoint
        let client = CompanionClient(connection: endpoint.map(connection.dialing) ?? connection, token: token)
        guard await !client.serverIdentityChanged(), !Task.isCancelled,
              Self.record == record else { return nil }
        return client
    }

    static func save(revision: Int64, connection: Connection?, token: String?) throws {
        let previous = record
        guard let defaults = SagaxSharedConfiguration.sharedDefaults else {
            throw SagaxSharedKeychainError.configurationMissing
        }
        let data = try JSONEncoder().encode(Record(revision: revision, connection: connection))
        if let token { try SagaxSharedKeychain.save(token, for: keychainID(revision)) }
        defaults.set(data, forKey: key)
        if let previous, previous.connection != nil, previous.revision != revision || token == nil {
            SagaxSharedKeychain.remove(keychainID(previous.revision))
        }
    }

    private static func keychainID(_ revision: Int64) -> String { "watch.\(revision)" }
}

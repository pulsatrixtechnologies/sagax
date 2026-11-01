import CompanionCore
import Foundation

/// A Share Send is durable before the extension starts network work. The
/// containing app drains it after suspension or extension termination, using
/// the original pairing from Keychain and the exact same UUID/sendId.
@MainActor
enum SagaxSharedTransfers {
    private static var draining = false

    static var journal: AttachmentTransferJournal? {
        guard let group = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: SagaxSharedConfiguration.appGroupIdentifier) else { return nil }
        return AttachmentTransferJournal(root: group.appendingPathComponent("AttachmentTransfers", isDirectory: true))
    }

    static func resume(onError: @escaping @MainActor (String) -> Void) {
        guard !draining, let journal else { return }
        draining = true
        Task {
            defer { draining = false }
            let registry = SagaxSharedConnectionStore.loadRegistry()
            for id in journal.ids() {
                guard let manifest = try? journal.load(id), manifest.destination != nil else { continue }
                do {
                    guard let connection = registry.connection(id: manifest.connectionID),
                          let token = try SagaxSharedKeychain.token(for: connection.id) else {
                        throw APIError.transport(String(localized: "A shared file is waiting for its paired computer. Open Sagax to reconnect."))
                    }
                    var finished = false
                    var failure: Error?
                    for endpoint in connection.automaticEndpoints {
                        do {
                            let client = CompanionClient(connection: connection.dialing(endpoint), token: token)
                            _ = try await SagaxTransferActivity.run("Sagax shared file delivery") {
                                try await AttachmentTransferDelivery(journal: journal, id: id).run(using: client)
                            }
                            finished = true
                            break
                        } catch let rejected as AttachmentTransferRejected {
                            // Removed from the outbox: no other route may
                            // report it as delivered.
                            throw rejected
                        } catch { failure = error }
                    }
                    if !finished, let failure { throw failure }
                } catch let rejected as AttachmentTransferRejected {
                    onError(String(localized: "A shared file could not be sent: \(rejected.message)"))
                } catch {
                    onError(String(localized: "A shared file is waiting to resume. Open Sagax again to retry."))
                }
            }
        }
    }
}

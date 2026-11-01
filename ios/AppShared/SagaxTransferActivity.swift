import Foundation

/// Asks iOS for the usual extra running time while an attachment transfer
/// is in flight, in the app and in the Share extension alike (no
/// UIApplication). When the time runs out, the transfer is simply suspended:
/// the durable journal and resumable offsets continue it on the next launch
/// or foreground, from the last acknowledged chunk.
final class SagaxTransferActivity: @unchecked Sendable {
    private let done = DispatchSemaphore(value: 0)
    private let lock = NSLock()
    private var ended = false

    init(_ reason: String) {
        ProcessInfo.processInfo.performExpiringActivity(withReason: reason) { [done] expired in
            // The block runs on a system queue and holds the assertion for
            // as long as it blocks. Expiry, or `end()`, releases it.
            if expired { done.signal(); return }
            done.wait()
        }
    }

    func end() {
        lock.lock()
        defer { lock.unlock() }
        guard !ended else { return }
        ended = true
        done.signal()
    }

    deinit { end() }

    /// Run one transfer under an assertion that ends with it.
    static func run<T>(_ reason: String, _ operation: () async throws -> T) async rethrows -> T {
        let activity = SagaxTransferActivity(reason)
        defer { activity.end() }
        return try await operation()
    }
}

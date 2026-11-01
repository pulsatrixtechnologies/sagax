import Foundation
import CryptoKit
import Darwin

/// No credentials are persisted. A transfer records the paired connection,
/// attachment UUIDs, acknowledged progress and the exact retry-safe message.
public struct AttachmentTransferManifest: Codable, Sendable {
    public struct Entry: Codable, Sendable {
        public let id: UUID
        public let filename: String
        public let name: String
        public let mime: String
        public let bytes: Int
        public let image: Bool
        public var uploadedBytes: Int = 0
        public var receipt: AttachmentUploadReceipt?
    }
    public let connectionID: String
    public let threadID: String
    public var entries: [Entry]
    public var destinationID: String?
    public var room: Bool = false
    public var prefix: String?
    public var sendID: String?
    public var preparedText: String?
    public var completed: Bool = false
    public var cancelled: Bool = false
    public var options: SendOptions?
    public var sourceDraftID: String?

    public var destination: MessageDestination? {
        guard let destinationID else { return nil }
        return room ? .room(id: destinationID, threadId: threadID) : .bot(id: destinationID, threadId: threadID)
    }
}

/// Files and JSON are app-owned and protected until first authentication.
/// Each job has a cross-process lease, so the extension and containing app
/// cannot run it together. The server's UUID/sendId receipts cover a crash
/// between an accepted HTTP request and saving its local acknowledgement.
public struct AttachmentTransferJournal: Sendable {
    public let root: URL
    public init(root: URL) { self.root = root }
    public static let manifestName = "transfer.json"

    public static func draftID(connectionID: String, threadID: String) -> String {
        SHA256.hash(data: Data((connectionID + "\0" + threadID).utf8)).map { String(format: "%02x", $0) }.joined()
    }

    public func directory(_ id: String) -> URL { root.appendingPathComponent(id, isDirectory: true) }

    public func saveDraft(_ attachments: [PendingMessageAttachment], connectionID: String, threadID: String, id suppliedID: String? = nil) throws {
        let id = suppliedID ?? Self.draftID(connectionID: connectionID, threadID: threadID)
        if attachments.isEmpty { try remove(id); return }
        let directory = directory(id)
        try createProtectedDirectory(directory)
        let previous = try? load(id)
        var entries: [AttachmentTransferManifest.Entry] = []
        for attachment in attachments {
            let filename = attachment.id.uuidString
            let target = directory.appendingPathComponent(filename)
            if !FileManager.default.fileExists(atPath: target.path) {
                if let source = attachment.fileURL {
                    // The source is already our immutable provider copy. An
                    // app-owned hard link keeps it durable without a second
                    // 1 GiB copy, even after its in-memory owner unlinks it.
                    do { try FileManager.default.linkItem(at: source, to: target) }
                    catch { try copyBounded(source, to: target, bytes: attachment.bytes) }
                } else { try writeProtected(attachment.data, to: target) }
            }
            var entry = AttachmentTransferManifest.Entry(id: attachment.id, filename: filename, name: attachment.name,
                                                        mime: attachment.mime, bytes: attachment.bytes, image: attachment.kind == .image)
            if let old = previous?.entries.first(where: { $0.id == attachment.id }) {
                entry.uploadedBytes = old.uploadedBytes
                entry.receipt = old.receipt
            }
            entries.append(entry)
        }
        var manifest = AttachmentTransferManifest(connectionID: connectionID, threadID: threadID, entries: entries)
        // Ordinary draft updates do not erase an ambiguous accepted send.
        // A deliberately changed set of attachments starts a new delivery.
        if previous?.entries.map(\.id) == entries.map(\.id) {
            manifest.destinationID = previous?.destinationID
            manifest.room = previous?.room ?? false
            manifest.prefix = previous?.prefix
            manifest.sendID = previous?.sendID
            manifest.preparedText = previous?.preparedText
        }
        try save(manifest, id: id)
        let kept = Set(entries.map(\.filename))
        for old in previous?.entries ?? [] where !kept.contains(old.filename) {
            try? FileManager.default.removeItem(at: directory.appendingPathComponent(old.filename))
        }
    }

    public func prepareDelivery(_ attachments: [PendingMessageAttachment], connectionID: String, destination: MessageDestination,
                                prefix: String, sendID: String, preparedText: String? = nil, options: SendOptions = SendOptions(),
                                sourceDraftID: String? = nil) throws -> String {
        let threadID: String
        let destinationID: String
        let room: Bool
        switch destination {
        case let .bot(id, threadId): destinationID = id; threadID = threadId; room = false
        case let .room(id, threadId): destinationID = id; threadID = threadId; room = true
        }
        // Empty shares (a link or text only) still need a retry-safe receipt.
        if !attachments.isEmpty { try saveDraft(attachments, connectionID: connectionID, threadID: threadID, id: sendID) }
        var manifest = (try? load(sendID)) ?? AttachmentTransferManifest(connectionID: connectionID, threadID: threadID, entries: [])
        manifest.destinationID = destinationID
        manifest.room = room
        manifest.prefix = prefix
        manifest.sendID = sendID
        manifest.preparedText = preparedText
        manifest.options = options
        manifest.sourceDraftID = sourceDraftID
        try save(manifest, id: sendID)
        return sendID
    }

    public func cancel(_ id: String) throws {
        var manifest = try load(id)
        manifest.cancelled = true
        try save(manifest, id: id)
    }

    public func updateProgress(_ bytes: Int, attachmentID: UUID, receipt: AttachmentUploadReceipt? = nil, id: String) throws {
        var manifest = try load(id)
        guard let index = manifest.entries.firstIndex(where: { $0.id == attachmentID }) else { return }
        manifest.entries[index].uploadedBytes = bytes
        if let receipt { manifest.entries[index].receipt = receipt }
        try save(manifest, id: id)
    }

    public func finish(_ manifest: AttachmentTransferManifest, id: String) throws {
        if let sourceID = manifest.sourceDraftID, let source = try? load(sourceID) {
            let sent = Set(manifest.entries.map(\.id))
            let kept = try attachments(source, id: sourceID).filter { !sent.contains($0.id) }
            try saveDraft(kept, connectionID: source.connectionID, threadID: source.threadID)
        }
        try remove(id)
    }

    public func load(_ id: String) throws -> AttachmentTransferManifest {
        try JSONDecoder().decode(AttachmentTransferManifest.self, from: Data(contentsOf: directory(id).appendingPathComponent(Self.manifestName)))
    }
    public func save(_ manifest: AttachmentTransferManifest, id: String) throws {
        try createProtectedDirectory(directory(id))
        try writeProtected(JSONEncoder().encode(manifest), to: directory(id).appendingPathComponent(Self.manifestName))
    }
    public func ids() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
            .filter { FileManager.default.fileExists(atPath: $0.appendingPathComponent(Self.manifestName).path) }
            .map(\.lastPathComponent).sorted()
    }
    public func attachments(_ manifest: AttachmentTransferManifest, id: String) throws -> [PendingMessageAttachment] {
        let base = directory(id).resolvingSymlinksInPath().path + "/"
        let attachments = try manifest.entries.map { entry -> PendingMessageAttachment in
            guard entry.filename == URL(fileURLWithPath: entry.filename).lastPathComponent else { throw CocoaError(.fileReadCorruptFile) }
            let url = directory(id).appendingPathComponent(entry.filename)
            let values = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
            guard values.isRegularFile == true, values.fileSize == entry.bytes,
                  url.resolvingSymlinksInPath().path.hasPrefix(base) else { throw CocoaError(.fileReadCorruptFile) }
            return PendingMessageAttachment(id: entry.id, fileURL: url, bytes: entry.bytes, name: entry.name,
                                            mime: entry.mime, kind: entry.image ? .image : .file)
        }
        try AttachmentPolicy.validate(attachments, sharedHost: false)
        return attachments
    }
    public func remove(_ id: String) throws {
        let url = directory(id)
        if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
    }
    public func lease(_ id: String) throws -> AttachmentTransferLease? {
        let path = directory(id).appendingPathComponent("transfer.lock").path
        let descriptor = open(path, O_CREAT | O_RDWR, S_IRUSR | S_IWUSR)
        guard descriptor >= 0 else { throw CocoaError(.fileWriteUnknown) }
        guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else { close(descriptor); return nil }
        return AttachmentTransferLease(descriptor)
    }

    private func createProtectedDirectory(_ url: URL) throws {
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
        #endif
    }
    private func writeProtected(_ data: Data, to url: URL) throws {
        #if os(iOS)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: url, options: .atomic)
        #endif
    }
    private func copyBounded(_ source: URL, to target: URL, bytes: Int) throws {
        let input = try FileHandle(forReadingFrom: source)
        defer { try? input.close() }
        guard FileManager.default.createFile(atPath: target.path, contents: nil) else { throw CocoaError(.fileWriteUnknown) }
        let output = try FileHandle(forWritingTo: target)
        defer { try? output.close() }
        do {
            var copied = 0
            while let chunk = try input.read(upToCount: 64 * 1_024), !chunk.isEmpty {
                guard chunk.count <= bytes - copied else { throw CocoaError(.fileReadCorruptFile) }
                try output.write(contentsOf: chunk)
                copied += chunk.count
            }
            guard copied == bytes else { throw CocoaError(.fileReadCorruptFile) }
        } catch { try? FileManager.default.removeItem(at: target); throw error }
    }
}

/// The computer definitively refused a durable delivery; it was removed.
public struct AttachmentTransferRejected: Error, LocalizedError, Sendable {
    public let message: String
    public init(underlying: Error) { message = underlying.localizedDescription }
    public var errorDescription: String? { message }
}

public final class AttachmentTransferLease: @unchecked Sendable {
    private let descriptor: Int32
    fileprivate init(_ descriptor: Int32) { self.descriptor = descriptor }
    deinit { flock(descriptor, LOCK_UN); close(descriptor) }
}

public actor AttachmentTransferDelivery {
    private let journal: AttachmentTransferJournal
    private let id: String
    public init(journal: AttachmentTransferJournal, id: String) { self.journal = journal; self.id = id }

    /// Returns false while another process owns this transfer. The containing
    /// app retries on foreground; a foreground extension owns its own lease.
    private func recordProgress(_ bytes: Int, attachmentID: UUID) {
        try? journal.updateProgress(bytes, attachmentID: attachmentID, id: id)
    }

    private func requireActive() throws {
        guard try !journal.load(id).cancelled else { throw CancellationError() }
    }

    public func run(using client: CompanionClient) async throws -> Bool {
        guard FileManager.default.fileExists(atPath: journal.directory(id).appendingPathComponent(AttachmentTransferJournal.manifestName).path) else { return true }
        guard let lease = try journal.lease(id) else { return false }
        defer { withExtendedLifetime(lease) {} }
        let manifest = try journal.load(id)
        guard manifest.connectionID == client.connection.id else { throw APIError.badURL }
        if manifest.cancelled {
            // The tombstone outlived the process that set it: release any
            // partial or unreferenced server copy before forgetting the job.
            await cancelUploads(manifest, using: client)
            try journal.remove(id)
            return false
        }
        if manifest.completed { try journal.finish(manifest, id: id); return true }
        guard manifest.destination != nil, manifest.sendID != nil else { return false }
        do {
            return try await deliver(manifest, using: client)
        } catch where Self.definitive(error) {
            // The computer refused this delivery (policy, type, size). A
            // replay can never succeed, so it leaves the outbox; the composer
            // draft, when there is one, keeps its attachments.
            await cancelUploads(manifest, using: client)
            try? journal.remove(id)
            throw AttachmentTransferRejected(underlying: error)
        }
    }

    /// A definitive answer: a 4xx other than unauthorized (re-pair) and the
    /// transient 408/409/425/429, or a local file/policy failure.
    public static func definitive(_ error: Error) -> Bool {
        if case let APIError.status(code, _) = error {
            return (400..<500).contains(code) && ![401, 408, 409, 425, 429].contains(code)
        }
        return error is AttachmentPolicyError || error is AttachmentUploadFailure || error is CocoaError
    }

    private func cancelUploads(_ manifest: AttachmentTransferManifest, using client: CompanionClient) async {
        guard let attachments = try? journal.attachments(manifest, id: id) else { return }
        for attachment in attachments { try? await client.cancelAttachmentUpload(attachment) }
    }

    private func deliver(_ initial: AttachmentTransferManifest, using client: CompanionClient) async throws -> Bool {
        var manifest = initial
        guard let destination = manifest.destination, let sendID = manifest.sendID else { return false }
        if manifest.preparedText == nil {
            let attachments = try journal.attachments(manifest, id: id)
            var references: [SharedAttachmentReference] = []
            for attachment in attachments {
                let receipt = try await client.uploadAttachment(attachment, sharedHost: false) { [weak self] sent, _ in
                    await self?.recordProgress(sent, attachmentID: attachment.id)
                }
                if let index = manifest.entries.firstIndex(where: { $0.id == attachment.id }) {
                    manifest.entries[index].receipt = receipt
                    manifest.entries[index].uploadedBytes = attachment.bytes
                }
                try requireActive()
                try journal.save(manifest, id: id)
                references.append(receipt.reference(for: attachment))
            }
            try requireActive()
            manifest.preparedText = SharedMessageComposer.compose(instruction: manifest.prefix ?? "", text: [], urls: [], attachments: references)
            try journal.save(manifest, id: id)
        }
        try Task.checkCancellation()
        try requireActive()
        _ = try await client.send(text: manifest.preparedText!, to: destination, sendId: sendID, options: manifest.options ?? SendOptions())
        manifest.completed = true
        try journal.save(manifest, id: id)
        try journal.finish(manifest, id: id)
        return true
    }
}

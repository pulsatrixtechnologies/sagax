import Foundation

/// Durable server receipt, shared by image and file uploads. The server owns
/// the stored path and enforces content checks, owner isolation and at rest
/// encryption before returning this receipt.
public struct AttachmentUploadReceipt: Codable, Hashable, Sendable {
    public let path: String
    public let name: String
    public let mime: String
    public let bytes: Int

    public func reference(for attachment: PendingMessageAttachment) -> SharedAttachmentReference {
        SharedAttachmentReference(path: path, kind: attachment.kind == .image ? .image : .file,
                                  displayName: attachment.kind == .image ? attachment.name : name)
    }
}

/// A local, non-retryable upload failure: the picked file changed, could not
/// be read, or the computer returned an unusable offset or receipt.
public struct AttachmentUploadFailure: Error, LocalizedError, Equatable, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
    public var errorDescription: String? { message }
}

private struct AttachmentUploadOffset: Decodable {
    let offset: Int
    let total: Int
    let saved: AttachmentUploadReceipt?
}

/// A large selection retains its 32 entries without allocating 32 chunk
/// buffers at once. A queued transfer can be cancelled before it starts.
private actor AttachmentUploadSlots {
    static let shared = AttachmentUploadSlots()
    private var active = Set<UUID>()
    private var queue: [UUID] = []
    private var waiting: [UUID: CheckedContinuation<Void, Error>] = [:]

    func acquire(_ id: UUID) async throws {
        try Task.checkCancellation()
        if active.count < 2 { active.insert(id); return }
        try await withTaskCancellationHandler {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                if Task.isCancelled { continuation.resume(throwing: CancellationError()); return }
                waiting[id] = continuation
                queue.append(id)
            }
        } onCancel: { Task { await self.cancel(id) } }
    }

    private func cancel(_ id: UUID) {
        waiting.removeValue(forKey: id)?.resume(throwing: CancellationError())
        queue.removeAll { $0 == id }
    }

    func release(_ id: UUID) {
        guard active.remove(id) != nil else { return }
        if !queue.isEmpty {
            let next = queue.removeFirst()
            active.insert(next)
            waiting.removeValue(forKey: next)?.resume()
        }
    }
}

extension CompanionClient {
    public static let attachmentUploadChunkBytes = 4 * 1_024 * 1_024
    /// Transient failures (lost reply, proxy 5xx, brief offline) are retried
    /// in place after these pauses, consulting durable progress each time.
    /// The visible Retry and the durable outbox handle anything longer.
    public static let attachmentUploadRetryDelays: [Duration] = [.seconds(1), .seconds(3), .seconds(8)]

    /// Read at most one proxy-sized chunk. Retry keeps the attachment's UUID,
    /// asks the server for its fsynced offset and reuses a committed receipt.
    /// A lost chunk/commit reply therefore never produces another stored file.
    public func uploadAttachment(
        _ attachment: PendingMessageAttachment,
        sharedHost: Bool = true,
        retryDelays: [Duration] = CompanionClient.attachmentUploadRetryDelays,
        onProgress: (@Sendable (Int, Int) async -> Void)? = nil
    ) async throws -> AttachmentUploadReceipt {
        let slot = UUID()
        try await AttachmentUploadSlots.shared.acquire(slot)
        do {
            try Task.checkCancellation()
            var attempt = 0
            var receipt: AttachmentUploadReceipt?
            while receipt == nil {
                do {
                    receipt = try await performAttachmentUpload(attachment, sharedHost: sharedHost, onProgress: onProgress)
                } catch {
                    try Task.checkCancellation()
                    guard attempt < retryDelays.count, Self.retryableAttachmentUpload(error) else { throw error }
                    try await Task.sleep(for: retryDelays[attempt])
                    attempt += 1
                }
            }
            let saved = receipt!
            await AttachmentUploadSlots.shared.release(slot)
            return saved
        } catch {
            await AttachmentUploadSlots.shared.release(slot)
            throw error
        }
    }

    private func performAttachmentUpload(
        _ attachment: PendingMessageAttachment, sharedHost: Bool,
        onProgress: (@Sendable (Int, Int) async -> Void)?
    ) async throws -> AttachmentUploadReceipt {
        try AttachmentPolicy.validate([attachment], sharedHost: sharedHost)
        let handle = try attachment.fileURL.map { try FileHandle(forReadingFrom: $0) }
        defer { try? handle?.close() }
        if let handle {
            guard try handle.seekToEnd() == UInt64(attachment.bytes) else {
                throw AttachmentUploadFailure(String(localized: "The attachment changed. Choose the file again."))
            }
        }
        var offset = 0
        do {
            let state = try await attachmentUploadRequest(attachment, phase: "status")
            try validateUploadOffset(state, attachment: attachment)
            if let saved = state.saved { return try await checkedUploadReceipt(saved, attachment, onProgress) }
            offset = state.offset
            if offset > 0 { await onProgress?(offset, attachment.bytes) }
        } catch APIError.status(code: 404, message: _) {
            // A new UUID has no durable upload yet. Only its first chunk
            // creates one. Other status errors remain visible for Retry.
        }

        while offset < attachment.bytes {
            try Task.checkCancellation()
            let end = min(offset + Self.attachmentUploadChunkBytes, attachment.bytes)
            let chunk: Data
            if let handle {
                try handle.seek(toOffset: UInt64(offset))
                chunk = try handle.read(upToCount: end - offset) ?? Data()
            } else {
                chunk = attachment.data.subdata(in: offset..<end)
            }
            guard chunk.count == end - offset else {
                throw AttachmentUploadFailure(String(localized: "The attachment could not be read. Choose the file again."))
            }
            let state: AttachmentUploadOffset
            do {
                state = try await attachmentUploadRequest(attachment, phase: "chunk", offset: offset, body: chunk)
            } catch {
                try Task.checkCancellation()
                guard Self.retryableAttachmentUpload(error) else { throw error }
                // The server may have accepted a chunk before its reply was
                // lost. Consult durable progress before deciding to retry.
                let current = try await attachmentUploadRequest(attachment, phase: "status")
                try validateUploadOffset(current, attachment: attachment)
                if let saved = current.saved { return try await checkedUploadReceipt(saved, attachment, onProgress) }
                guard current.offset > offset else { throw error }
                state = current
            }
            try validateUploadOffset(state, attachment: attachment)
            guard state.offset > offset, state.offset <= end else {
                throw AttachmentUploadFailure(String(localized: "The computer returned an invalid upload offset."))
            }
            offset = state.offset
            await onProgress?(offset, attachment.bytes)
        }
        try Task.checkCancellation()
        let committed: AttachmentUploadOffset
        do {
            committed = try await attachmentUploadRequest(attachment, phase: "commit")
        } catch {
            try Task.checkCancellation()
            guard Self.retryableAttachmentUpload(error) else { throw error }
            committed = try await attachmentUploadRequest(attachment, phase: "status")
        }
        try validateUploadOffset(committed, attachment: attachment)
        guard let saved = committed.saved else {
            throw AttachmentUploadFailure(String(localized: "The computer returned no committed file. Try again."))
        }
        return try await checkedUploadReceipt(saved, attachment, onProgress)
    }

    /// Call this from a fresh Task after cancelling the data task. A removed
    /// completed upload uses the same endpoint; the server keeps any result
    /// already referenced by a transcript.
    public func cancelAttachmentUpload(_ attachment: PendingMessageAttachment) async throws {
        _ = try await attachmentUploadRequest(attachment, phase: "cancel")
    }

    private func attachmentUploadRequest(_ attachment: PendingMessageAttachment, phase: String,
                                         offset: Int = 0, body: Data? = nil) async throws -> AttachmentUploadOffset {
        var query = [
            URLQueryItem(name: "uploadId", value: attachment.id.uuidString),
            URLQueryItem(name: "total", value: String(attachment.bytes)),
            URLQueryItem(name: "phase", value: phase),
            URLQueryItem(name: "offset", value: String(offset)),
        ]
        if attachment.kind == .file { query.append(URLQueryItem(name: "name", value: attachment.name)) }
        var request = try makeRequest("POST", attachment.kind == .image ? "/api/attachments" : "/api/files", query: query)
        request.setValue(AttachmentPolicy.normalizedMIME(attachment.mime), forHTTPHeaderField: "Content-Type")
        // One 4 MiB request, rather than a 1 GiB body, crosses relay/proxy
        // limits. Allow slower mobile links time to acknowledge that chunk.
        request.timeoutInterval = phase == "cancel" ? 10 : 150
        if let body {
            let (data, response) = try await streamingSession.upload(for: request, from: body)
            try Self.check(response, data)
            return try JSONDecoder().decode(AttachmentUploadOffset.self, from: data)
        }
        return try await send(request, as: AttachmentUploadOffset.self)
    }

    private func validateUploadOffset(_ state: AttachmentUploadOffset, attachment: PendingMessageAttachment) throws {
        guard state.total == attachment.bytes, (0...attachment.bytes).contains(state.offset),
              state.saved == nil || state.offset == attachment.bytes else {
            throw AttachmentUploadFailure(String(localized: "The computer returned an invalid upload offset."))
        }
    }

    private func checkedUploadReceipt(_ saved: AttachmentUploadReceipt, _ attachment: PendingMessageAttachment,
                                      _ progress: (@Sendable (Int, Int) async -> Void)?) async throws -> AttachmentUploadReceipt {
        guard !saved.path.isEmpty, saved.path.utf8.count <= 4_096,
              !saved.path.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              !saved.name.isEmpty, saved.name.utf8.count <= 255,
              !saved.name.contains("/"), !saved.name.contains("\\"),
              !saved.name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              saved.bytes == attachment.bytes,
              AttachmentPolicy.normalizedMIME(saved.mime) == AttachmentPolicy.normalizedMIME(attachment.mime) else {
            throw AttachmentUploadFailure(String(localized: "The uploaded file could not be used."))
        }
        await progress?(attachment.bytes, attachment.bytes)
        return saved
    }

    /// Lost replies, proxy/server faults and network loss are transient.
    /// A local file change, policy refusal or definitive 4xx is not.
    static func retryableAttachmentUpload(_ error: Error) -> Bool {
        switch error {
        case let APIError.status(code, _):
            return code == 408 || code == 409 || code == 425 || code == 429 || code >= 500
        case APIError.transport: return true
        case let error as URLError: return error.code != .cancelled
        default: return false
        }
    }
}

// Photos and files picked for the next message: read, checked against the
// attachment policy and kept per thread. Split out of ChatView.swift unchanged.
import SwiftUI
import CompanionCore
import PhotosUI
import UniformTypeIdentifiers
import ImageIO
import UIKit

extension ChatView {
    func importPhotos(_ items: [PhotosPickerItem]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let importingConnectionID = session.connection?.id
        let sharedHost = session.surfaceGate.organization
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard items.count <= available else {
            selectedPhotos = []
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer {
            preparingAttachments = false
            selectedPhotos = []
        }

        do {
            var imported: [PendingMessageAttachment] = []
            for item in items {
                guard let media = try await item.loadTransferable(type: PickedAttachmentMedia.self) else {
                    throw AttachmentImportError.unreadable("that photo or video")
                }
                let candidate = media.attachment
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate], sharedHost: sharedHost)
                imported.append(candidate)
            }
            session.keepAttachmentDraft(existingAttachments + imported, threadId: importingThread, connectionID: importingConnectionID)
            if threadId == importingThread, session.connection?.id == importingConnectionID { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    /// A photo just taken with the camera, as a JPEG.
    func importCameraPhoto(_ image: UIImage) {
        guard !preparingAttachments, !sendingMessage else { return }
        guard let data = image.jpegData(compressionQuality: 0.9) else {
            attachmentError = AttachmentImportError.unsupported("that photo").localizedDescription
            return
        }
        let candidate = PendingMessageAttachment(id: UUID(), data: data, name: "Photo.jpg", mime: "image/jpeg", kind: .image)
        do {
            try AttachmentPolicy.validate(attachments + [candidate], sharedHost: session.surfaceGate.organization)
            attachmentError = nil
            attachments.append(candidate)
            Haptics.selection()
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    func importFiles(_ result: Result<[URL], Error>) {
        guard case let .success(urls) = result else {
            if case let .failure(error) = result { attachmentError = error.localizedDescription }
            return
        }
        guard !urls.isEmpty else { return }
        Task { await importFiles(urls) }
    }

    func importFiles(_ urls: [URL]) async {
        guard !preparingAttachments, !sendingMessage else { return }
        let importingThread = threadId
        let importingConnectionID = session.connection?.id
        let sharedHost = session.surfaceGate.organization
        let existingAttachments = attachments
        let available = AttachmentPolicy.maximumItems - existingAttachments.count
        guard urls.count <= available else {
            attachmentError = "Send up to \(AttachmentPolicy.maximumItems) items at a time."
            return
        }

        preparingAttachments = true
        attachmentError = nil
        defer { preparingAttachments = false }

        do {
            var imported: [PendingMessageAttachment] = []
            for url in urls {
                let usedBytes = (existingAttachments + imported).filter { $0.kind == .image }.reduce(0) { $0 + $1.bytes }
                let remainingBytes = max(0, AttachmentPolicy.maximumTotalBytes - usedBytes)
                let candidate = try await Task.detached(priority: .userInitiated) {
                    try Self.readImportedFile(url, remainingBytes: remainingBytes, sharedHost: sharedHost)
                }.value
                try AttachmentPolicy.validate(existingAttachments + imported + [candidate], sharedHost: sharedHost)
                imported.append(candidate)
            }
            session.keepAttachmentDraft(existingAttachments + imported, threadId: importingThread, connectionID: importingConnectionID)
            if threadId == importingThread, session.connection?.id == importingConnectionID { attachments.append(contentsOf: imported) }
            else { threadDrafts[importingThread, default: ComposerSnapshot()].attachments.append(contentsOf: imported) }
            Haptics.selection()
        } catch {
            if threadId == importingThread { attachmentError = error.localizedDescription }
            else { threadDrafts[importingThread]?.error = error.localizedDescription }
        }
    }

    nonisolated static func readImportedFile(
        _ url: URL,
        remainingBytes: Int,
        sharedHost: Bool
    ) throws -> PendingMessageAttachment {
        let accessed = url.startAccessingSecurityScopedResource()
        defer { if accessed { url.stopAccessingSecurityScopedResource() } }

        let values = try url.resourceValues(
            forKeys: [.contentTypeKey, .isRegularFileKey, .fileSizeKey]
        )
        guard values.isRegularFile != false else {
            throw AttachmentImportError.unreadable(url.lastPathComponent)
        }
        let name = url.lastPathComponent.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw AttachmentImportError.unreadable("that file") }
        let inferred = values.contentType ?? UTType(filenameExtension: url.pathExtension)
        let mime = AttachmentPolicy.normalizedMIME(
            inferred?.preferredMIMEType ?? "application/octet-stream"
        )
        guard let kind = AttachmentPolicy.kind(forMIME: mime) else {
            throw AttachmentImportError.unsupported(name)
        }
        let itemLimit = AttachmentPolicy.itemLimit(mime: mime, sharedHost: sharedHost)
        let readLimit = kind == .image ? min(itemLimit, remainingBytes) : itemLimit
        if let fileSize = values.fileSize, fileSize > readLimit {
            throw AttachmentImportError.tooLarge(name, readLimit)
        }
        return try PendingMessageAttachment.copyingFile(
            url, name: name, mime: mime, kind: kind, maximumBytes: readLimit
        )
    }
}

/// Photos supplies temporary file representations for both videos and
/// images. Copy inside Transferable's callback, before Photos releases them.
private struct PickedAttachmentMedia: Transferable {
    let attachment: PendingMessageAttachment

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(importedContentType: .movie) { received in
            let type = UTType(filenameExtension: received.file.pathExtension)
            let mime = AttachmentPolicy.normalizedMIME(type?.preferredMIMEType ?? "video/quicktime")
            guard AttachmentPolicy.videoMIMETypes.contains(mime) else {
                throw AttachmentImportError.unsupported(received.file.lastPathComponent)
            }
            return Self(attachment: try PendingMessageAttachment.copyingFile(
                received.file, name: "Video.\(type?.preferredFilenameExtension ?? "mov")",
                mime: mime, kind: .file, maximumBytes: AttachmentPolicy.maximumVideoBytes
            ))
        }
        FileRepresentation(importedContentType: .image) { received in
            let actualType = CGImageSourceCreateWithURL(received.file as CFURL, nil)
                .flatMap(CGImageSourceGetType).flatMap { UTType($0 as String) }
            let mime = actualType?.preferredMIMEType.map(AttachmentPolicy.normalizedMIME) ?? ""
            if AttachmentPolicy.imageMIMETypes.contains(mime) {
                return Self(attachment: try PendingMessageAttachment.copyingFile(
                    received.file, name: "Photo.\(actualType?.preferredFilenameExtension ?? "jpg")",
                    mime: mime, kind: .image, maximumBytes: AttachmentPolicy.maximumSoloImageBytes
                ))
            }
            // Keep the existing HEIC-to-JPEG behavior for models that cannot
            // consume HEIC. Video never passes through an in-memory Data.
            guard let image = UIImage(contentsOfFile: received.file.path),
                  let data = image.jpegData(compressionQuality: 0.9) else {
                throw AttachmentImportError.unsupported("that photo")
            }
            guard data.count <= AttachmentPolicy.maximumSoloImageBytes else {
                throw AttachmentImportError.tooLarge("that photo", AttachmentPolicy.maximumSoloImageBytes)
            }
            return Self(attachment: PendingMessageAttachment(data: data, name: "Photo.jpg", mime: "image/jpeg", kind: .image))
        }
    }
}

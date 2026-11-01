import Foundation

/// One attachment waiting in the mobile composer. The bytes are app-owned:
/// picker URLs are copied before this value is created, so a later send never
/// depends on a security-scoped URL still being alive.
public struct PendingMessageAttachment: Identifiable, Hashable, Sendable {
    public enum Kind: Hashable, Sendable {
        case image
        case file
    }

    public let id: UUID
    public let data: Data
    public let name: String
    public let mime: String
    public let kind: Kind
    /// Large picker representations stay on disk. `data` is used only by
    /// bounded native producers (camera, clipboard and recorded voice).
    private let ownedFile: OwnedAttachmentFile?
    public var fileURL: URL? { ownedFile?.url }
    public let bytes: Int

    public init(
        id: UUID = UUID(),
        data: Data,
        name: String,
        mime: String,
        kind: Kind
    ) {
        self.id = id
        self.data = data
        self.name = name
        self.mime = mime
        self.kind = kind
        self.ownedFile = nil
        self.bytes = data.count
    }

    public init(id: UUID = UUID(), fileURL: URL, bytes: Int, name: String, mime: String, kind: Kind, removeWhenReleased: Bool = false) {
        self.id = id
        self.data = Data()
        self.name = name
        self.mime = mime
        self.kind = kind
        self.bytes = bytes
        self.ownedFile = OwnedAttachmentFile(url: fileURL, removeWhenReleased: removeWhenReleased)
    }

    /// Copy a provider URL while its security scope/callback is alive. Count
    /// bytes actually read, including providers whose file grows during copy.
    public static func copyingFile(_ source: URL, id: UUID = UUID(), name: String, mime: String, kind: Kind, maximumBytes: Int) throws -> Self {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("SagaxAttachmentDrafts", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let target = directory.appendingPathComponent(id.uuidString)
        guard FileManager.default.createFile(atPath: target.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        #if os(iOS)
        try FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: target.path)
        #endif
        do {
            let input = try FileHandle(forReadingFrom: source)
            defer { try? input.close() }
            let output = try FileHandle(forWritingTo: target)
            defer { try? output.close() }
            var count = 0
            while let chunk = try input.read(upToCount: 64 * 1_024), !chunk.isEmpty {
                try Task.checkCancellation()
                guard chunk.count <= maximumBytes - count else {
                    throw AttachmentPolicyError.itemTooLarge(name: name, limitMB: maximumBytes / (1_024 * 1_024))
                }
                try output.write(contentsOf: chunk)
                count += chunk.count
            }
            guard count > 0 else { throw CocoaError(.fileReadCorruptFile) }
            return Self(id: id, fileURL: target, bytes: count, name: name, mime: mime, kind: kind, removeWhenReleased: true)
        } catch {
            try? FileManager.default.removeItem(at: target)
            throw error
        }
    }
}

private final class OwnedAttachmentFile: Hashable, @unchecked Sendable {
    let url: URL
    let removeWhenReleased: Bool
    init(url: URL, removeWhenReleased: Bool) { self.url = url; self.removeWhenReleased = removeWhenReleased }
    static func == (lhs: OwnedAttachmentFile, rhs: OwnedAttachmentFile) -> Bool { lhs.url == rhs.url }
    func hash(into hasher: inout Hasher) { hasher.combine(url) }
    deinit { if removeWhenReleased { try? FileManager.default.removeItem(at: url) } }
}

public enum AttachmentPolicyError: Error, LocalizedError, Equatable, Sendable {
    case tooManyItems
    case totalTooLarge
    case invalidName
    case unsupportedType(String)
    case itemTooLarge(name: String, limitMB: Int)

    public var errorDescription: String? {
        switch self {
        case .tooManyItems:
            return String(localized: "Attach up to 32 items at a time.")
        case .totalTooLarge:
            return String(localized: "Those images are larger than 200 MB together.")
        case .invalidName:
            return "That file doesn't have a valid filename."
        case let .unsupportedType(name):
            return String(localized: "\(name) isn't a supported file. Try an image, document, archive, audio, or video file.")
        case let .itemTooLarge(name, limitMB):
            return String(localized: "\(name) is larger than \(limitMB) MB.")
        }
    }
}

/// The same limits apply to the in-app composer and the Share extension.
/// Keeping the policy in CompanionCore prevents either entry point from
/// accepting an attachment that the authenticated upload route will reject.
public enum AttachmentPolicy {
    public static let maximumItems = 32
    public static let maximumTotalBytes = 200 * 1_024 * 1_024
    /// Same as IMAGE_MAX_BYTES in server/attachments.ts (32 MiB since #899); the
    /// server shrinks a large picture before the model sees it. A unit test on
    /// the server side keeps the two numbers equal.
    public static let maximumImageBytes = 32 * 1_024 * 1_024
    public static var maximumImageMegabytes: Int { maximumImageBytes / (1_024 * 1_024) }
    public static let maximumSoloImageBytes = 90 * 1_024 * 1_024
    public static let maximumFileBytes = 250 * 1_024 * 1_024
    public static let maximumVideoBytes = 1_024 * 1_024 * 1_024
    public static let videoMIMETypes: Set<String> = ["video/mp4", "video/webm", "video/quicktime"]
    public static let archiveMIMETypes: Set<String> = [
        "application/zip", "application/x-zip-compressed", "application/x-tar", "application/gzip",
        "application/x-gzip", "application/x-gtar", "application/x-compressed-tar", "application/x-7z-compressed",
    ]

    public static let imageMIMETypes: Set<String> = [
        "image/png", "image/jpeg", "image/gif", "image/webp",
    ]

    public static let documentMIMETypes: Set<String> = [
        "text/plain", "text/markdown", "text/csv", "text/tab-separated-values",
        "application/json", "application/pdf", "application/rtf", "text/rtf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.oasis.opendocument.text",
        "application/vnd.oasis.opendocument.spreadsheet",
        "application/vnd.oasis.opendocument.presentation",
    ]

    /// Recorded voice notes (VoiceNoteRecording): WAV only, the one audio
    /// type the phone makes. The upload route accepts it like the desktop's.
    public static let audioMIMETypes: Set<String> = [
        "audio/wav", "audio/x-wav", "audio/wave", "audio/opus", "audio/ogg", "audio/mpeg",
        "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac", "audio/webm",
    ]

    public static func normalizedMIME(_ value: String) -> String {
        value.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: true)
            .first.map(String.init)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
    }

    public static func kind(forMIME value: String) -> PendingMessageAttachment.Kind? {
        let mime = normalizedMIME(value)
        if imageMIMETypes.contains(mime) { return .image }
        if documentMIMETypes.contains(mime) || audioMIMETypes.contains(mime)
            || videoMIMETypes.contains(mime) || archiveMIMETypes.contains(mime) { return .file }
        return nil
    }

    public static func itemLimit(mime: String, sharedHost: Bool = true) -> Int {
        let normalized = normalizedMIME(mime)
        if imageMIMETypes.contains(normalized) { return sharedHost ? maximumImageBytes : maximumSoloImageBytes }
        return videoMIMETypes.contains(normalized) ? maximumVideoBytes : maximumFileBytes
    }

    public static func validate(_ attachments: [PendingMessageAttachment], sharedHost: Bool = true) throws {
        guard attachments.count <= maximumItems else { throw AttachmentPolicyError.tooManyItems }
        guard attachments.filter({ $0.kind == .image }).reduce(0, { $0 + $1.bytes }) <= maximumTotalBytes else {
            throw AttachmentPolicyError.totalTooLarge
        }

        for attachment in attachments {
            let name = attachment.name.trimmingCharacters(in: .whitespacesAndNewlines)
            guard validDisplayName(name) else { throw AttachmentPolicyError.invalidName }
            let mime = normalizedMIME(attachment.mime)
            switch attachment.kind {
            case .image:
                guard imageMIMETypes.contains(mime) else {
                    throw AttachmentPolicyError.unsupportedType(name)
                }
                let limit = itemLimit(mime: mime, sharedHost: sharedHost)
                guard attachment.bytes > 0, attachment.bytes <= limit else {
                    throw AttachmentPolicyError.itemTooLarge(name: name, limitMB: limit / (1_024 * 1_024))
                }
            case .file:
                guard kind(forMIME: mime) == .file else {
                    throw AttachmentPolicyError.unsupportedType(name)
                }
                let limit = itemLimit(mime: mime, sharedHost: sharedHost)
                guard attachment.bytes > 0, attachment.bytes <= limit else {
                    throw AttachmentPolicyError.itemTooLarge(name: name, limitMB: limit / (1_024 * 1_024))
                }
            }
        }
    }

    static func validMIME(_ value: String) -> Bool {
        let mime = normalizedMIME(value)
        guard !mime.isEmpty, mime.utf8.count <= 127, mime.contains("/") else { return false }
        return mime.utf8.allSatisfy { byte in
            (48...57).contains(byte) || (65...90).contains(byte) || (97...122).contains(byte)
                || [33, 35, 36, 38, 43, 45, 46, 47, 94, 95].contains(byte)
        }
    }

    private static func validDisplayName(_ value: String) -> Bool {
        !value.isEmpty && value.utf8.count <= 255
            && !value.contains("/") && !value.contains("\\")
            && !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    }
}

/// What tapping a Markdown link in a message is allowed to do. Web links go
/// to the system. Absolute desktop paths go back through the authenticated
/// companion file route. Relative paths are resolved by that route against
/// the originating conversation's workspace. Custom schemes do nothing.
public enum LocalMessageLink: Equatable, Sendable {
    case web(URL)
    case desktopFile(path: String)

    public static func resolve(_ rawValue: String) -> LocalMessageLink? {
        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, value.utf8.count <= 8_192,
              !value.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
        else { return nil }

        if isWindowsAbsolutePath(value) || isBackslashUNCPath(value) {
            return .desktopFile(path: value)
        }
        // In Markdown, //host/path is a protocol-relative web link. Keep it
        // out of the UNC path branch; file://host/path remains the explicit
        // spelling for a network share.
        if value.hasPrefix("//") {
            guard let components = URLComponents(string: "https:\(value)"),
                  let url = components.url,
                  components.host?.isEmpty == false
            else { return nil }
            return .web(url)
        }
        if value.hasPrefix("/") { return .desktopFile(path: value) }

        if let schemeRange = value.range(
            of: #"^[A-Za-z][A-Za-z0-9+.-]*:"#,
            options: .regularExpression
        ) {
            guard schemeRange.lowerBound == value.startIndex,
                  let components = URLComponents(string: value),
                  let scheme = components.scheme?.lowercased()
            else { return nil }
            if scheme == "http" || scheme == "https" {
                guard let url = components.url, components.host?.isEmpty == false else { return nil }
                return .web(url)
            }
            if scheme == "file" {
                guard components.query == nil, components.fragment == nil else { return nil }
                guard var path = components.percentEncodedPath.removingPercentEncoding else { return nil }
                if path.hasPrefix("/"), isWindowsAbsolutePath(String(path.dropFirst())) {
                    path.removeFirst()
                }
                if let host = components.host, !host.isEmpty, host.lowercased() != "localhost" {
                    let sharePath = path.replacingOccurrences(of: "/", with: "\\")
                    path = "\\\\\(host)\(sharePath)"
                }
                guard path.hasPrefix("/") || isWindowsAbsolutePath(path) || isBackslashUNCPath(path) else {
                    return nil
                }
                return .desktopFile(path: path)
            }
            return nil
        }

        // Query strings and fragments belong to the Markdown target, not the
        // local filename. Decode the path the same way as the scoped server
        // matcher, while refusing query-only/fragment-only links.
        let delimiter = value.firstIndex(where: { $0 == "?" || $0 == "#" }) ?? value.endIndex
        let pathPart = String(value[..<delimiter])
        guard !pathPart.isEmpty, let path = pathPart.removingPercentEncoding, !path.isEmpty else { return nil }
        return .desktopFile(path: path)
    }

    public static func resolve(_ url: URL) -> LocalMessageLink? {
        let value = url.absoluteString
        if let decoded = value.removingPercentEncoding,
           isWindowsAbsolutePath(decoded) || isBackslashUNCPath(decoded) {
            return .desktopFile(path: decoded)
        }
        return resolve(value)
    }

    private static func isWindowsAbsolutePath(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard bytes.count >= 3 else { return false }
        let letter = (65...90).contains(bytes[0]) || (97...122).contains(bytes[0])
        return letter && bytes[1] == 58 && (bytes[2] == 47 || bytes[2] == 92)
    }

    private static func isBackslashUNCPath(_ value: String) -> Bool {
        value.hasPrefix("\\\\")
    }
}

/// Bytes returned by the authenticated file route. `localURL` is nil on the
/// low-level client and populated by Session after it safely writes a preview
/// into the app's temporary directory.
public struct DownloadedFile: Sendable {
    public let data: Data
    public let filename: String
    public let contentType: String
    public let localURL: URL?

    public init(data: Data, filename: String, contentType: String, localURL: URL? = nil) {
        self.data = data
        self.filename = filename
        self.contentType = contentType
        self.localURL = localURL
    }

    public func stored(at url: URL) -> DownloadedFile {
        DownloadedFile(data: data, filename: filename, contentType: contentType, localURL: url)
    }
}

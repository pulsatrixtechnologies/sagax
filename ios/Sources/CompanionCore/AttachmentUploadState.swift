import Foundation

public enum AttachmentUploadState: Equatable, Sendable {
    case uploading(uploaded: Int, total: Int)
    case failed(String)
    case ready(AttachmentUploadReceipt)

    public var ready: Bool { if case .ready = self { return true }; return false }
}

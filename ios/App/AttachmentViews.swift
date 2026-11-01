import CompanionCore
import ImageIO
import QuickLook
import SwiftUI
import UIKit

private struct SendableAttachmentImage: @unchecked Sendable {
    let value: CGImage?
}

private func decodeAttachmentThumbnail(_ attachment: PendingMessageAttachment, maximumPixelSize: Int) -> SendableAttachmentImage {
    let source = attachment.fileURL.flatMap { CGImageSourceCreateWithURL($0 as CFURL, nil) }
        ?? (attachment.fileURL == nil ? CGImageSourceCreateWithData(attachment.data as CFData, nil) : nil)
    return decodeAttachmentThumbnailSource(source, maximumPixelSize: maximumPixelSize)
}

private func decodeAttachmentThumbnail(_ data: Data, maximumPixelSize: Int) -> SendableAttachmentImage {
    decodeAttachmentThumbnailSource(CGImageSourceCreateWithData(data as CFData, nil), maximumPixelSize: maximumPixelSize)
}

private func decodeAttachmentThumbnailSource(_ source: CGImageSource?, maximumPixelSize: Int) -> SendableAttachmentImage {
    guard let source else {
        return SendableAttachmentImage(value: nil)
    }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maximumPixelSize,
        kCGImageSourceShouldCacheImmediately: true,
    ]
    return SendableAttachmentImage(
        value: CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
    )
}

enum AttachmentImportError: LocalizedError {
    case unreadable(String)
    case unsupported(String)
    case tooLarge(String, Int)

    var errorDescription: String? {
        switch self {
        case let .unreadable(name):
            return "Sagax couldn't read \(name). Try exporting it to Files first."
        case let .unsupported(name):
            return String(localized: "\(name) isn't a supported attachment. Try an image, document, archive, audio, or video file.")
        case let .tooLarge(name, bytes):
            let limit = ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file)
            return "\(name) is larger than the \(limit) remaining attachment limit."
        }
    }
}

/// Thumbnails of the pictures waiting in the composer, decoded once per
/// attachment off the main thread. The chip used to decode the full picture
/// in `body`, on every keystroke while it was there.
@MainActor
enum PendingAttachmentThumbnails {
    private static let cache = NSCache<NSUUID, UIImage>()
    /// 34 pt at 3x, rounded up.
    private static let maximumPixelSize = 120

    static func cached(_ attachment: PendingMessageAttachment) -> UIImage? {
        cache.object(forKey: attachment.id as NSUUID)
    }

    static func load(_ attachment: PendingMessageAttachment) async -> UIImage? {
        if let hit = cached(attachment) { return hit }
        let size = maximumPixelSize
        let decoded = await Task.detached(priority: .userInitiated) {
            decodeAttachmentThumbnail(attachment, maximumPixelSize: size)
        }.value
        guard let cgImage = decoded.value else { return nil }
        let image = UIImage(cgImage: cgImage)
        cache.setObject(image, forKey: attachment.id as NSUUID)
        return image
    }
}

struct PendingAttachmentChip: View {
    @Environment(\.themePalette) var themePalette
    let attachment: PendingMessageAttachment
    var uploadState: AttachmentUploadState? = nil
    var retry: () -> Void = {}
    let remove: () -> Void
    @State private var thumbnail: UIImage?
    @State private var thumbnailFailed = false

    var body: some View {
        HStack(spacing: 8) {
            preview

            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.name)
                    .font(.system(size: 13, weight: .semibold))
                    .lineLimit(1)
                Text(ByteCountFormatter.string(fromByteCount: Int64(attachment.bytes), countStyle: .file))
                    .font(.system(size: 11))
                    .foregroundStyle(Theme.textSecondary)
                switch uploadState {
                case let .uploading(uploaded, total):
                    ProgressView(value: Double(uploaded), total: Double(max(1, total)))
                        .accessibilityLabel("Uploading \(attachment.name)")
                    Text("Uploading \(Int(Double(uploaded) / Double(max(1, total)) * 100))%")
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.textSecondary)
                case let .failed(error):
                    Text(error)
                        .font(.system(size: 11))
                        .foregroundStyle(Theme.danger)
                        .lineLimit(2)
                    Button("Retry", action: retry)
                        .font(.system(size: 12, weight: .semibold))
                        .accessibilityLabel("Retry uploading \(attachment.name)")
                case .ready, nil:
                    EmptyView()
                }
            }

            Button(action: remove) {
                Image(systemName: "xmark")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(Theme.textSecondary)
                    .frame(width: 24, height: 24)
                    .background(Theme.cardRaised, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(attachment.name)")
        }
        .padding(.leading, 7)
        .padding(.trailing, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: 280, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 14))
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(Theme.hairline)
        )
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var preview: some View {
        if attachment.kind == .image, let image = thumbnail ?? PendingAttachmentThumbnails.cached(attachment) {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: 34, height: 34)
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
        } else if attachment.kind == .image, !thumbnailFailed {
            // decoding (a few milliseconds, once per attachment)
            RoundedRectangle(cornerRadius: 8)
                .fill(Theme.cardRaised)
                .frame(width: 34, height: 34)
                .accessibilityHidden(true)
                .task(id: attachment.id) {
                    let image = await PendingAttachmentThumbnails.load(attachment)
                    thumbnail = image
                    thumbnailFailed = image == nil
                }
        } else {
            Image(systemName: "doc.fill")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.accentText)
                .frame(width: 34, height: 34)
                .background(Theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 8))
                .accessibilityHidden(true)
        }
    }
}

/// One attachment already present in a user message. Its desktop path is
/// transport metadata only: every byte still comes through the authenticated
/// route for the message that introduced it.
struct TranscriptAttachmentView: View {
    @Environment(\.themePalette) var themePalette
    let attachment: DisplayedMessageAttachment
    let threadId: String
    let messageId: String
    var foreground: Color = BubbleColor.mineText

    @EnvironmentObject private var session: Session
    /// The conversation's pictures, so the viewer pages through all of them.
    @Environment(\.conversationGallery) private var gallery
    @State private var lightbox: LightboxStart?
    @State private var thumbnail: UIImage?
    @State private var thumbnailLoading = false
    @State private var previewLoading = false
    @State private var errorMessage: Text?
    @State private var thumbnailAttempt = 0
    @State private var thumbnailVisible = false
    @State private var preview: FilePreviewItem?
    @State private var previewTask: Task<Void, Never>?
    /// iPad desktop shell: the desktop's picture tile and file chip.
    @Environment(\.desktopChatText) private var desktop

    private var taskID: String {
        "\(threadId)\u{1F}\(messageId)\u{1F}\(attachment.path)\u{1F}\(thumbnailAttempt)\u{1F}\(thumbnailVisible)"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if attachment.kind == .image {
                if desktop != nil { desktopImageTile } else { imageCard }
            } else {
                if desktop != nil { desktopFileChip } else { fileCard }
            }

            if let errorMessage {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .accessibilityHidden(true)
                    errorMessage
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 2)
                    Button("Retry", action: retry)
                        .fontWeight(.semibold)
                        .foregroundStyle(foreground)
                }
                .font(.system(size: 11))
                .foregroundStyle(foreground.opacity(0.92))
                .accessibilityElement(children: .contain)
            }
        }
        .frame(maxWidth: desktop != nil ? (attachment.kind == .image ? DesktopChatMetrics.imageMax : nil) : (attachment.kind == .image ? 360 : 320), alignment: .leading)
        .background {
            if attachment.kind == .image {
                GeometryReader { proxy in
                    let frame = proxy.frame(in: .global)
                    Color.clear
                        .onAppear { updateThumbnailVisibility(frame) }
                        .onValueChange(of: frame) { nextFrame in
                            updateThumbnailVisibility(nextFrame)
                        }
                }
            }
        }
        .task(id: taskID) {
            guard attachment.kind == .image, thumbnailVisible, thumbnail == nil else { return }
            await loadThumbnail()
        }
        .onDisappear { previewTask?.cancel() }
        .fullScreenCover(item: $preview) { item in
            FilePreviewView(item: item) {
                preview = nil
            }
        }
        .fullScreenCover(item: $lightbox) { start in
            ConversationLightbox(threadId: threadId, images: start.images, startIndex: start.index) {
                lightbox = nil
            }
            .environmentObject(session)
        }
    }

    /// A picture opens the conversation's lightbox at itself (CA31); one
    /// the gallery does not list opens on its own, as before.
    private func openImage() {
        if let gallery, gallery.threadId == threadId,
           let index = gallery.images.firstIndex(where: { $0.messageId == messageId && $0.path == attachment.path }) {
            lightbox = LightboxStart(images: gallery.images, index: index)
        } else {
            openPreview()
        }
    }

    private var imageCard: some View {
        Button(action: openImage) {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 13)
                    .fill(foreground.opacity(0.12))

                if let thumbnail {
                    Image(uiImage: thumbnail)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .clipped()
                } else if thumbnailLoading {
                    ProgressView()
                        .tint(foreground)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    Image(systemName: "photo")
                        .font(.system(size: 30, weight: .medium))
                        .foregroundStyle(foreground.opacity(0.72))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }

                LinearGradient(
                    colors: [.clear, .black.opacity(0.68)],
                    startPoint: .center,
                    endPoint: .bottom
                )

                HStack(spacing: 6) {
                    Image(systemName: "photo")
                        .accessibilityHidden(true)
                    Text(attachment.name)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if previewLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(.white)
                            .accessibilityHidden(true)
                    }
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white)
                .padding(10)
            }
            .frame(maxWidth: .infinity)
            .frame(height: 168)
            .clipShape(RoundedRectangle(cornerRadius: 13))
            .overlay {
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(foreground.opacity(0.18))
            }
            .contentShape(RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .disabled(previewLoading || thumbnailLoading)
        .accessibilityLabel("Image: \(attachment.name)")
        .accessibilityValue(thumbnail != nil ? "Loaded" : (thumbnailLoading ? "Loading" : "Unavailable"))
        .accessibilityHint(thumbnail == nil ? "Loads the image preview" : "Opens the image full screen")
    }

    /// AttachmentThumbnail on the desktop: the picture itself, square, at
    /// most 288, 16 pt corners, no caption.
    private var desktopImageTile: some View {
        Button(action: openImage) {
            Color.clear
                .aspectRatio(1, contentMode: .fit)
                .overlay {
                    if let thumbnail {
                        Image(uiImage: thumbnail).resizable().scaledToFill()
                    } else if thumbnailLoading {
                        ProgressView()
                    } else {
                        Image(systemName: "photo").font(.system(size: 24)).foregroundStyle(.secondary)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(previewLoading || thumbnailLoading)
        .accessibilityLabel("Image: \(attachment.name)")
        .accessibilityHint("Opens the image full screen")
    }

    /// AttachedFileChip: "Save a copy of NAME" on the desktop; here it
    /// opens the same preview as the phone's card.
    private var desktopFileChip: some View {
        Button(action: openPreview) {
            if attachment.name.lowercased().hasSuffix(".pdf") {
                DesktopPdfCard(name: attachment.name, loading: previewLoading)
            } else {
                DesktopFileChip(name: attachment.name, loading: previewLoading)
            }
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .disabled(previewLoading)
        .accessibilityLabel("File: \(attachment.name)")
        .accessibilityHint("Opens a preview")
    }

    private var fileCard: some View {
        Button(action: openPreview) {
            HStack(spacing: 10) {
                Image(systemName: "doc.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(foreground)
                    .frame(width: 38, height: 38)
                    .background(foreground.opacity(0.12), in: RoundedRectangle(cornerRadius: 9))
                    .accessibilityHidden(true)

                VStack(alignment: .leading, spacing: 2) {
                    Text(attachment.name)
                        .font(.system(size: 13, weight: .semibold))
                        .lineLimit(1)
                    Text(previewLoading ? "Opening…" : "Tap to preview")
                        .font(.system(size: 11))
                        .foregroundStyle(foreground.opacity(0.68))
                }

                Spacer(minLength: 8)
                if previewLoading {
                    ProgressView()
                        .controlSize(.small)
                        .tint(foreground)
                        .accessibilityHidden(true)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(foreground.opacity(0.65))
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(foreground)
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(foreground.opacity(0.10), in: RoundedRectangle(cornerRadius: 13))
            .overlay {
                RoundedRectangle(cornerRadius: 13)
                    .strokeBorder(foreground.opacity(0.12))
            }
            .contentShape(RoundedRectangle(cornerRadius: 13))
        }
        .buttonStyle(.plain)
        .disabled(previewLoading)
        .accessibilityLabel("File: \(attachment.name)")
        .accessibilityHint("Opens a preview")
    }

    @MainActor
    private func loadThumbnail() async {
        thumbnailLoading = true
        errorMessage = nil
        defer { thumbnailLoading = false }
        do {
            let downloaded = try await session.fetchAttachment(
                threadId: threadId,
                messageId: messageId,
                path: attachment.path,
                cacheResult: true
            )
            try Task.checkCancellation()
            guard downloaded.data.count <= AttachmentPolicy.maximumImageBytes,
                  AttachmentPolicy.normalizedMIME(downloaded.contentType).hasPrefix("image/")
            else {
                errorMessage = Text("This image couldn't be previewed.")
                return
            }
            let decoded = await Task.detached(priority: .userInitiated) {
                decodeAttachmentThumbnail(downloaded.data, maximumPixelSize: 720)
            }.value
            try Task.checkCancellation()
            guard let image = decoded.value else {
                errorMessage = Text("This image couldn't be previewed.")
                return
            }
            thumbnail = UIImage(cgImage: image)
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            errorMessage = Text(verbatim: error.localizedDescription)
        }
    }

    private func openPreview() {
        guard !previewLoading else { return }
        previewTask?.cancel()
        errorMessage = nil
        previewLoading = true
        previewTask = Task { @MainActor in
            var unfinishedItem: FilePreviewItem?
            defer {
                previewLoading = false
                unfinishedItem?.cleanUp()
            }
            do {
                let downloaded = try await session.prepareAttachmentPreview(
                    threadId: threadId,
                    messageId: messageId,
                    path: attachment.path,
                    cacheResult: attachment.kind == .image
                )
                guard let item = FilePreviewItem(downloaded: downloaded) else {
                    errorMessage = Text("The downloaded file couldn't be previewed.")
                    return
                }
                // Adopt cleanup ownership before observing cancellation. The
                // materialized directory otherwise has a one-suspension leak
                // window between Session returning and this view owning it.
                unfinishedItem = item
                try Task.checkCancellation()
                if attachment.kind == .image {
                    guard downloaded.data.count <= AttachmentPolicy.maximumImageBytes,
                          AttachmentPolicy.normalizedMIME(downloaded.contentType).hasPrefix("image/")
                    else {
                        errorMessage = Text("This image couldn't be previewed.")
                        return
                    }
                    if thumbnail == nil {
                        let decoded = await Task.detached(priority: .userInitiated) {
                            decodeAttachmentThumbnail(downloaded.data, maximumPixelSize: 64)
                        }.value
                        try Task.checkCancellation()
                        guard decoded.value != nil else {
                            errorMessage = Text("This image couldn't be previewed.")
                            return
                        }
                    }
                }
                preview = item
                unfinishedItem = nil
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = Text(verbatim: error.localizedDescription)
            }
        }
    }

    private func retry() {
        if attachment.kind == .image, thumbnail == nil {
            thumbnailAttempt += 1
        } else {
            openPreview()
        }
    }

    @MainActor
    private func updateThumbnailVisibility(_ frame: CGRect) {
        let windowBounds = UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap(\.windows)
            .first(where: \.isKeyWindow)?
            .bounds ?? UIScreen.main.bounds
        // Begin just before the card reaches the viewport so the placeholder
        // usually resolves during the final part of the scroll gesture.
        let visible = frame.intersects(windowBounds.insetBy(dx: 0, dy: -120))
        if thumbnailVisible != visible { thumbnailVisible = visible }
        // The transcript intentionally uses an eager VStack for correct
        // bottom anchoring. Do not let that turn every image ever visited into
        // permanent row state: keep nearby cards warm, then release the decode.
        let retentionFrame = windowBounds.insetBy(dx: 0, dy: -windowBounds.height)
        if !retentionFrame.intersects(frame), thumbnail != nil { thumbnail = nil }
    }

}

struct FilePreviewItem: Identifiable {
    enum Kind { case markdown, text, quickLook }

    let id = UUID()
    let url: URL
    let filename: String
    let contentType: String
    let data: Data

    init?(downloaded: DownloadedFile) {
        guard let localURL = downloaded.localURL else { return nil }
        data = downloaded.data
        filename = downloaded.filename
        contentType = downloaded.contentType
        url = localURL
    }

    var kind: Kind {
        let mime = contentType.lowercased()
        let suffix = url.pathExtension.lowercased()
        if mime == "text/markdown" || suffix == "md" || suffix == "markdown" {
            return .markdown
        }
        if mime.hasPrefix("text/") || mime == "application/json" {
            return .text
        }
        return .quickLook
    }

    var text: String {
        let limit = 2 * 1_024 * 1_024
        let available: Data
        if data.isEmpty, let handle = try? FileHandle(forReadingFrom: url) {
            defer { try? handle.close() }
            available = (try? handle.read(upToCount: limit + 1)) ?? Data()
        } else { available = data }
        let visible = available.prefix(limit)
        var decoded = String(decoding: visible, as: UTF8.self)
        if available.count > limit {
            decoded += "\n\n(Preview truncated. Share or open the file to read the rest.)"
        }
        return decoded
    }

    func cleanUp() {
        let directory = url.deletingLastPathComponent()
        if directory.deletingLastPathComponent().lastPathComponent == "SagaxFilePreviews" {
            try? FileManager.default.removeItem(at: directory)
        } else {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

struct FilePreviewView: View {
    @Environment(\.themePalette) var themePalette
    let item: FilePreviewItem
    let close: () -> Void
    @State private var linkError: LocalizedStringKey?

    var body: some View {
        NavigationStack {
            Group {
                switch item.kind {
                case .markdown:
                    ScrollView {
                        MarkdownText(source: item.text, openLink: openPreviewLink)
                            .textSelection(.enabled)
                            .frame(maxWidth: 900, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .top)
                            .padding(20)
                    }
                case .text:
                    ScrollView([.horizontal, .vertical]) {
                        Text(item.text)
                            .font(Theme.mono(14))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .topLeading)
                            .padding(20)
                    }
                case .quickLook:
                    QuickLookPreview(url: item.url)
                        .ignoresSafeArea(edges: .bottom)
                }
            }
            .background(Theme.bg)
            .navigationTitle(item.filename)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Done", action: close)
                }
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: item.url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share \(item.filename)")
                }
            }
        }
        .onDisappear { item.cleanUp() }
        .alert("Couldn't open link", isPresented: Binding(
            get: { linkError != nil },
            set: { if !$0 { linkError = nil } }
        )) {
            Button("OK", role: .cancel) { linkError = nil }
        } message: {
            Text(linkError ?? "That link couldn't be opened.")
        }
    }

    private func openPreviewLink(_ url: URL) -> OpenURLAction.Result {
        guard let scheme = url.scheme?.lowercased(),
              (scheme == "http" || scheme == "https"),
              url.host != nil
        else {
            linkError = "Open links to other computer files from the original chat message."
            return .handled
        }
        return .systemAction(url)
    }
}

private struct QuickLookPreview: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator { Coordinator(url: url) }

    func makeUIViewController(context: Context) -> QLPreviewController {
        let controller = QLPreviewController()
        controller.dataSource = context.coordinator
        return controller
    }

    func updateUIViewController(_ controller: QLPreviewController, context: Context) {
        context.coordinator.url = url
        controller.reloadData()
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL

        init(url: URL) { self.url = url }

        func numberOfPreviewItems(in controller: QLPreviewController) -> Int { 1 }

        func previewController(
            _ controller: QLPreviewController,
            previewItemAt index: Int
        ) -> QLPreviewItem {
            url as NSURL
        }
    }
}

// MARK: - The conversation's lightbox (CA31)

/// Every picture of the conversation on screen, in reading order. Set by the
/// chat screen; without it a picture opens on its own.
struct ConversationGalleryContext: Equatable {
    let threadId: String
    let images: [GalleryImage]
}

private struct ConversationGalleryKey: EnvironmentKey {
    static let defaultValue: ConversationGalleryContext? = nil
}

extension EnvironmentValues {
    var conversationGallery: ConversationGalleryContext? {
        get { self[ConversationGalleryKey.self] }
        set { self[ConversationGalleryKey.self] = newValue }
    }
}

struct LightboxStart: Identifiable {
    let id = UUID()
    let images: [GalleryImage]
    let index: Int
}

/// The phone's AttachmentPreviewDialog with the conversation's pictures:
/// swipe or the side arrows (← → on a keyboard) to step through all of them,
/// wrapping at both ends; the name and "2 of 5" (or "Image preview") on
/// top; pinch, double tap or + − 0 to zoom; Escape or Close to leave.
struct ConversationLightbox: View {
    let threadId: String
    let images: [GalleryImage]
    let close: () -> Void
    @State private var index: Int
    @State private var zoom: CGFloat = 1
    @State private var sharing: FilePreviewItem?
    @EnvironmentObject private var session: Session

    static let zoomSteps: [CGFloat] = [1, 1.5, 2, 3, 4]

    init(threadId: String, images: [GalleryImage], startIndex: Int, close: @escaping () -> Void) {
        self.threadId = threadId
        self.images = images
        self.close = close
        _index = State(initialValue: min(max(startIndex, 0), max(images.count - 1, 0)))
    }

    private var current: GalleryImage? { images.indices.contains(index) ? images[index] : nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            TabView(selection: $index) {
                ForEach(Array(images.enumerated()), id: \.element.id) { offset, image in
                    LightboxPage(
                        threadId: threadId, image: image,
                        zoom: offset == index ? $zoom : .constant(1)
                    )
                    .tag(offset)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .never))
            .ignoresSafeArea()

            if images.count > 1 {
                HStack {
                    arrow("chevron.left", label: "Previous image", id: "lightbox-previous", key: .leftArrow) { navigate(-1) }
                    Spacer()
                    arrow("chevron.right", label: "Next image", id: "lightbox-next", key: .rightArrow) { navigate(1) }
                }
                .padding(.horizontal, 10)
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .background(zoomKeys)
        .onValueChange(of: index) { _ in zoom = 1 }
        .preferredColorScheme(.dark)
        .sheet(item: $sharing) { item in
            ActivityShareSheet(items: [item.url])
                .onDisappear { item.cleanUp() }
        }
    }

    private var header: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: current?.name ?? "")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                (images.count > 1 ? Text("\(index + 1) of \(images.count)") : Text("Image preview"))
                .font(.system(size: 11))
                .foregroundStyle(.white.opacity(0.55))
                .accessibilityIdentifier("lightbox-position")
            }
            Spacer(minLength: 8)
            Button(action: share) {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .medium))
                    .frame(width: 40, height: 40)
            }
            .accessibilityLabel(Text("Share \(current?.name ?? "")"))
            .accessibilityIdentifier("lightbox-share")
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .semibold))
                    .frame(width: 40, height: 40)
            }
            .keyboardShortcut(.cancelAction)
            .accessibilityLabel(Text("Close image preview"))
            .accessibilityIdentifier("lightbox-close")
        }
        .buttonStyle(.plain)
        .foregroundStyle(.white)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(.black.opacity(0.45))
    }

    private func arrow(_ symbol: String, label: LocalizedStringKey, id: String, key: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white.opacity(0.85))
                .frame(width: 40, height: 40)
                .background(.black.opacity(0.55), in: Circle())
        }
        .buttonStyle(.plain)
        .keyboardShortcut(key, modifiers: [])
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(id)
    }

    /// + − 0, as on the desktop.
    private var zoomKeys: some View {
        HStack {
            Button("Zoom in") { stepZoom(1) }.keyboardShortcut("+", modifiers: [])
            Button("Zoom in") { stepZoom(1) }.keyboardShortcut("=", modifiers: [])
            Button("Zoom out") { stepZoom(-1) }.keyboardShortcut("-", modifiers: [])
            Button("Fit to window (0)") { withAnimation(.snappy) { zoom = 1 } }.keyboardShortcut("0", modifiers: [])
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }

    private func stepZoom(_ direction: Int) {
        let steps = Self.zoomSteps
        let next = direction > 0 ? steps.first { $0 > zoom + 0.01 } ?? steps.last! : steps.last { $0 < zoom - 0.01 } ?? 1
        withAnimation(.snappy) { zoom = next }
    }

    private func navigate(_ step: Int) {
        withAnimation(.easeInOut(duration: 0.2)) {
            index = ConversationGallery.wrapped(index, step: step, count: images.count)
        }
    }

    private func share() {
        guard let image = current else { return }
        Task { @MainActor in
            guard let downloaded = try? await session.prepareAttachmentPreview(
                threadId: threadId, messageId: image.messageId, path: image.path, cacheResult: true
            ), let item = FilePreviewItem(downloaded: downloaded) else { return }
            sharing = item
        }
    }
}

/// One picture of the lightbox, fetched through its message's route.
private struct LightboxPage: View {
    let threadId: String
    let image: GalleryImage
    @Binding var zoom: CGFloat
    @EnvironmentObject private var session: Session
    @State private var picture: UIImage?
    @State private var failed = false
    @State private var pinch: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var dragStart: CGSize = .zero

    var body: some View {
        GeometryReader { proxy in
            Group {
                if let picture {
                    Image(uiImage: picture)
                        .resizable()
                        .scaledToFit()
                        .scaleEffect(zoom * pinch)
                        .offset(zoom > 1 ? offset : .zero)
                        .gesture(
                            MagnificationGesture()
                                .onChanged { pinch = $0 }
                                .onEnded { value in
                                    zoom = min(max(zoom * value, 1), 4)
                                    pinch = 1
                                    if zoom == 1 { offset = .zero }
                                }
                        )
                        .simultaneousGesture(zoom > 1 ? DragGesture()
                            .onChanged { offset = CGSize(width: dragStart.width + $0.translation.width, height: dragStart.height + $0.translation.height) }
                            .onEnded { _ in dragStart = offset } : nil)
                        .onTapGesture(count: 2) {
                            withAnimation(.snappy) {
                                zoom = zoom > 1 ? 1 : 2
                                offset = .zero
                                dragStart = .zero
                            }
                        }
                        .accessibilityLabel(Text(verbatim: image.name))
                        .accessibilityIdentifier("lightbox-image")
                } else if failed {
                    VStack(spacing: 8) {
                        Image(systemName: "photo")
                            .font(.system(size: 28))
                        Text("This image couldn't be previewed.")
                            .font(.system(size: 13))
                    }
                    .foregroundStyle(.white.opacity(0.7))
                } else {
                    ProgressView().tint(.white)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .onValueChange(of: zoom) { value in
            if value <= 1 { offset = .zero; dragStart = .zero }
        }
        .task(id: image.id) { await load() }
    }

    @MainActor
    private func load() async {
        guard picture == nil else { return }
        do {
            let downloaded = try await session.fetchAttachment(
                threadId: threadId, messageId: image.messageId, path: image.path, cacheResult: true
            )
            guard downloaded.data.count <= AttachmentPolicy.maximumImageBytes else { failed = true; return }
            let decoded = await Task.detached(priority: .userInitiated) {
                decodeAttachmentThumbnail(downloaded.data, maximumPixelSize: 2400)
            }.value
            guard let cgImage = decoded.value else { failed = true; return }
            picture = UIImage(cgImage: cgImage)
        } catch {
            if !Task.isCancelled { failed = true }
        }
    }
}

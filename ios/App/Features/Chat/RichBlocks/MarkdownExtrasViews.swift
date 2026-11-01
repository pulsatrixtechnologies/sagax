// The Markdown extras the desktop's ChatMarkdown draws: GitHub alerts
// (`Callout`), the footnote section, and pictures written in a reply
// (`MarkdownImagePreview`).
import SwiftUI
import UIKit
import CompanionCore

/// `> [!NOTE]` and its four siblings: a tinted panel with a coloured
/// leading rule, the kind's icon and title, then the body.
struct CalloutView<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    let kind: CalloutKind
    let title: String
    var identifier: String?
    @ViewBuilder var content: () -> Content

    private var tone: Color {
        switch kind {
        case .note: Color(hex: 0x2a78d6)
        case .tip: Theme.success
        case .important: Color(hex: 0x8a63d2)
        case .warning: Theme.warning
        case .caution: Theme.danger
        }
    }

    private var icon: String {
        switch kind {
        case .note: "info.circle"
        case .tip: "lightbulb"
        case .important: "exclamationmark.bubble"
        case .warning: "exclamationmark.triangle"
        case .caution: "exclamationmark.octagon"
        }
    }

    private var label: LocalizedStringKey {
        switch kind {
        case .note: "Note"
        case .tip: "Tip"
        case .important: "Important"
        case .warning: "Warning"
        case .caution: "Caution"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold)).accessibilityHidden(true)
                if title.isEmpty { Text(label) } else { Text(verbatim: title) }
            }
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tone)
            content()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tone.opacity(0.09))
        .overlay(alignment: .leading) { Rectangle().fill(tone).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }
}

/// GFM's footnote section: a rule, then the notes in number order, small.
struct FootnotesView: View {
    @Environment(\.themePalette) var themePalette
    let notes: [MarkdownFootnote]
    let inline: (String) -> Text
    var identifier: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5).padding(.bottom, 4)
            ForEach(notes, id: \.number) { note in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(verbatim: "\(note.number).")
                        .monospacedDigit()
                        .frame(minWidth: 16, alignment: .trailing)
                    inline(note.text)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .font(.system(size: 12))
                .foregroundStyle(Theme.textSecondary)
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("footnote-\(note.number)")
            }
        }
        .padding(.top, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Footnotes"))
        .modifier(RichIdentifier(identifier: identifier))
    }
}

/// A picture written in a reply. A path on the computer loads through the
/// message's own file route (the transcript's image tile); an inline raster
/// `data:` image shows as itself; a web image is held behind "Load image",
/// since loading it tells that server the message was read.
struct MarkdownImageView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let image: MarkdownImage
    /// The message the picture belongs to; nil where there is none.
    var scope: (threadId: String, messageId: String)?
    var foreground: Color = BubbleColor.theirsText
    var identifier: String?
    @State private var approved = false
    /// The inline `data:` raster, decoded once off the main thread: decoding
    /// it in `body` ran again on every streaming tick of the reply.
    @State private var inline: (source: String, image: UIImage?)?

    private var name: String { RichBlocks.markdownImageName(image.source, alt: image.alt) }
    private var openOriginal: URL? {
        RichBlocks.markdownImageOpenURL(image.link ?? image.source)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            picture
            if let openOriginal {
                Button {
                    openURL(openOriginal)
                } label: {
                    Text("Open original").font(.system(size: 11)).foregroundStyle(Theme.accent)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(identifier.map { "\($0)-open" } ?? "markdown-image-open")
            }
        }
        .frame(maxWidth: 360, alignment: .leading)
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }

    @ViewBuilder
    private var picture: some View {
        let source = image.source.trimmingCharacters(in: .whitespaces)
        if RichBlocks.isInlineRasterDataURL(source), inline?.source != source {
            placeholder(icon: nil) { ProgressView() }
                .task(id: source) {
                    let data = await Task.detached(priority: .userInitiated) { RichBlocks.inlineRasterData(source) }.value
                    let decoded: UIImage? = if let data { await ImageDecoding.prepared(data) } else { nil }
                    inline = (source, decoded)
                }
        } else if let decoded = inline?.source == source ? inline?.image : nil {
            Image(uiImage: decoded)
                .resizable()
                .scaledToFit()
                .frame(maxHeight: 384)
                .clipShape(RoundedRectangle(cornerRadius: 13))
                .accessibilityLabel(Text(verbatim: name))
        } else if RichBlocks.isExternalImageSource(source) {
            if approved, let url = RichBlocks.markdownImageOpenURL(source) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case let .success(loaded):
                        loaded.resizable().scaledToFit().frame(maxHeight: 384)
                            .clipShape(RoundedRectangle(cornerRadius: 13))
                    case .failure:
                        placeholder(icon: "photo.badge.exclamationmark") { Text("Image unavailable") }
                    default:
                        placeholder(icon: nil) { ProgressView() }
                    }
                }
                .accessibilityLabel(Text(verbatim: name))
            } else {
                placeholder(icon: "eye.slash") {
                    VStack(spacing: 8) {
                        Text("External image hidden for privacy")
                            .multilineTextAlignment(.center)
                        Button("Load image") { approved = true }
                            .font(.system(size: 12, weight: .medium))
                            .buttonStyle(.bordered)
                            .accessibilityIdentifier(identifier.map { "\($0)-load" } ?? "markdown-image-load")
                    }
                }
            }
        } else if case .desktopFile? = LocalMessageLink.resolve(source), let scope {
            TranscriptAttachmentView(
                attachment: DisplayedMessageAttachment(kind: .image, path: source, name: name),
                threadId: scope.threadId,
                messageId: scope.messageId,
                foreground: foreground
            )
        } else if case .desktopFile? = LocalMessageLink.resolve(source) {
            placeholder(icon: "photo") { Text("This older image reference is no longer available") }
        } else {
            placeholder(icon: "photo") { Text("Image unavailable") }
        }
    }

    private func placeholder<Inner: View>(icon: String?, @ViewBuilder content: () -> Inner) -> some View {
        VStack(spacing: 8) {
            if let icon {
                Image(systemName: icon).font(.system(size: 20)).accessibilityHidden(true)
            }
            content()
        }
        .font(.system(size: 12))
        .foregroundStyle(Theme.textSecondary)
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 150)
        .background(RoundedRectangle(cornerRadius: 13).fill(Theme.inset))
        .overlay(RoundedRectangle(cornerRadius: 13).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
    }
}

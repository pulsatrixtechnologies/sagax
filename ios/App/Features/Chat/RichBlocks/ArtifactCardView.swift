// A published page the Claude harness (Artifact tool) or a ```artifact JSON
// fence handed us: title, an Open button for a real https URL, nothing
// invented. HTML previews ride a sibling ```widget fence, not this card
// (`ArtifactCard.tsx` on the desktop).
import SwiftUI
import CompanionCore

struct ArtifactCardView: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.openURL) private var openURL
    let page: ArtifactPage
    var pending = false
    var identifier: String?

    private var url: URL? {
        guard let value = page.url, RichBlocks.isSafeHttpUrl(value) else { return nil }
        return URL(string: value)
    }

    private var title: String {
        page.title.isEmpty ? String(localized: "Page") : page.title
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Image(systemName: "macwindow")
                    .accessibilityHidden(true)
                Text("Page")
                    .fontWeight(.medium)
                    .foregroundStyle(Theme.textPrimary)
                Spacer(minLength: 4)
                if pending {
                    Text("Still being written…").font(.system(size: 11))
                }
            }
            .font(.system(size: 12))
            .foregroundStyle(Theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.cardRaised.opacity(0.3))
            Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5)
            HStack(alignment: .center, spacing: 8) {
                Text(verbatim: title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let url {
                    HStack(spacing: 6) {
                        Button {
                            openURL(url)
                        } label: {
                            Label("Open", systemImage: "arrow.up.right.square")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 32)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier(identifier.map { "\($0)-open" } ?? "artifact-open")
                        ShareLink(item: url) {
                            Label("Share", systemImage: "square.and.arrow.up")
                                .font(.system(size: 12))
                                .foregroundStyle(Theme.textPrimary)
                                .lineLimit(1)
                                .padding(.horizontal, 10)
                                .frame(minHeight: 32)
                                .background(RoundedRectangle(cornerRadius: 8).fill(Theme.card))
                                .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
                        }
                        .accessibilityIdentifier(identifier.map { "\($0)-share" } ?? "artifact-share")
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Theme.card))
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Page: \(title)"))
        .modifier(RichIdentifier(identifier: identifier))
    }
}

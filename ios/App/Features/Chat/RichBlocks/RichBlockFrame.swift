// The chrome every rich block shares (`rich-ui.tsx` BlockFrame, BlockHeader,
// ToolButton): an inset panel with a hairline border, a header strip with a
// small icon, the block's name in a chip and its tools on the right. Theme
// tokens only, so every skin applies; no fixed width, so the same blocks sit
// in a phone bubble or an iPad column.
import SwiftUI
import UIKit
import CompanionCore

struct RichBlockFrame<Tools: View, Content: View>: View {
    @Environment(\.themePalette) var themePalette
    let icon: String
    let title: String
    var identifier: String?
    @ViewBuilder var tools: () -> Tools
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textSecondary)
                    .accessibilityHidden(true)
                Text(verbatim: title)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Theme.textPrimary)
                    .lineLimit(1)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 4).fill(Theme.cardRaised))
                    .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
                Spacer(minLength: 6)
                HStack(spacing: 2) { tools() }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(Theme.cardRaised.opacity(0.3))
            Rectangle().fill(Theme.hairline.opacity(0.3)).frame(height: 0.5)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 10, style: .continuous).fill(Theme.inset))
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
        .accessibilityElement(children: .contain)
        .modifier(RichIdentifier(identifier: identifier))
    }
}

extension RichBlockFrame where Tools == EmptyView {
    init(icon: String, title: String, identifier: String? = nil, @ViewBuilder content: @escaping () -> Content) {
        self.init(icon: icon, title: title, identifier: identifier, tools: { EmptyView() }, content: content)
    }
}

/// A header tool: an icon, pressed when its view is showing.
struct RichToolButton: View {
    @Environment(\.themePalette) var themePalette
    let icon: String
    let label: LocalizedStringKey
    var pressed = false
    var identifier: String?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: icon)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(pressed ? Theme.accent : Theme.textSecondary)
                .frame(width: 28, height: 24)
                .background(RoundedRectangle(cornerRadius: 5).fill(pressed ? Theme.accent.opacity(0.15) : Color.clear))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
        .accessibilityAddTraits(pressed ? .isSelected : [])
        .modifier(RichIdentifier(identifier: identifier))
    }
}

/// The desktop's block tool (`rich-ui.tsx` ToolButton): an 11 pt glyph and
/// label, ink-secondary, 6 x 2 in, radius 4.
struct DesktopBlockTool: View {
    @Environment(\.desktopTheme) private var theme
    let icon: String
    let title: LocalizedStringKey?
    var pressed = false
    /// The renderer's own lucide glyph (11 pt) instead of the symbol.
    var lucide: [String]? = nil
    let action: () -> Void

    init(icon: String, title: LocalizedStringKey?, pressed: Bool = false, lucide: [String]? = nil, action: @escaping () -> Void) {
        self.icon = icon
        self.title = title
        self.pressed = pressed
        self.lucide = lucide
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 4) {
                if let lucide {
                    DesktopLucideGlyph(paths: lucide, size: 11)
                } else {
                    Image(systemName: icon).font(.system(size: 10, weight: .medium))
                }
                if let title { Text(title).font(theme.font(11)) }
            }
            .foregroundStyle(pressed ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(pressed ? theme.raised : .clear, in: RoundedRectangle(cornerRadius: 4))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
    }
}

struct RichIdentifier: ViewModifier {
    let identifier: String?

    func body(content: Content) -> some View {
        if let identifier { content.accessibilityIdentifier(identifier) } else { content }
    }
}

/// The desktop's `useCopyFeedback`: copy, then say "Copied" for a moment.
/// HTML rides along for a rich editor when there is some.
@MainActor
final class RichCopyFeedback: ObservableObject {
    @Published private(set) var copied: String?
    /// What the last copy put on the clipboard, for the parity UI tests
    /// (DEBUG only; release builds never expose clipboard text).
    @Published private(set) var lastText = ""
    private var reset: Task<Void, Never>?

    func copy(_ id: String, _ text: String, html: String? = nil) {
        var item: [String: Any] = ["public.utf8-plain-text": text]
        if let html { item["public.html"] = html }
        UIPasteboard.general.items = [item]
        Haptics.selection()
        copied = id
        #if DEBUG
        lastText = text
        #endif
        reset?.cancel()
        reset = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard !Task.isCancelled else { return }
            self?.copied = nil
        }
    }
}

/// "Copied" for a moment after a copy from a long-press menu, where the
/// menu itself cannot say so.
struct RichCopiedBadge: View {
    @Environment(\.themePalette) var themePalette
    @ObservedObject var feedback: RichCopyFeedback
    var identifier: String

    var body: some View {
        #if DEBUG
        // what the last copy put on the clipboard, for the parity UI tests:
        // it outlives the badge's moment on screen
        if !feedback.lastText.isEmpty {
            Rectangle().fill(Color.white.opacity(0.001)).frame(width: 1, height: 1)
                .accessibilityElement()
                .accessibilityLabel(Text(verbatim: "clipboard"))
                .accessibilityValue(Text(verbatim: feedback.lastText))
                .accessibilityIdentifier("\(identifier)-clipboard")
        }
        #endif
        if feedback.copied != nil {
            Label("Copied", systemImage: "checkmark")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Theme.success)
                .padding(.horizontal, 8)
                .padding(.vertical, 3)
                .background(Capsule().fill(Theme.cardRaised))
                .overlay(Capsule().strokeBorder(Theme.hairline.opacity(0.4), lineWidth: 0.5))
                .padding(6)
                .transition(.opacity)
                .accessibilityIdentifier(identifier)
                .modifier(RichLastCopied(text: feedback.lastText))
        }
    }
}

/// DEBUG: the copied text as the badge's accessibility value, so a UI test
/// can check what reached the clipboard without a paste prompt.
struct RichLastCopied: ViewModifier {
    let text: String

    func body(content: Content) -> some View {
        #if DEBUG
        content.accessibilityValue(Text(verbatim: text))
        #else
        content
        #endif
    }
}

/// A file to hand to the share sheet ("Save" on the desktop downloads it).
struct RichShareItem: Identifiable {
    let url: URL
    var id: String { url.path }

    static func writing(_ text: String, named name: String) -> RichShareItem? {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("rich-\(UUID().uuidString)", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(name)
            try Data(text.utf8).write(to: url, options: .atomic)
            return RichShareItem(url: url)
        } catch {
            return nil
        }
    }
}

/// The categorical chart slots (`ChartBlock.tsx` CHART_PALETTE), light and
/// dark steps of the same eight hues.
enum ChartPalette {
    static let light: [UInt32] = [0x2a78d6, 0xeb6834, 0x1baf7a, 0xeda100, 0xe87ba4, 0x008300, 0x4a3aa7, 0xe34948]
    static let dark: [UInt32] = [0x3987e5, 0xd95926, 0x199e70, 0xc98500, 0xd55181, 0x008300, 0x9085e9, 0xe66767]

    static var colors: [Color] {
        (Theme.palette.isDark ? dark : light).map { Color(hex: $0) }
    }

    static func color(_ index: Int) -> Color {
        let all = colors
        return all[index % all.count]
    }
}

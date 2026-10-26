// Parts the Plugins pages share (WP9): the section heading and empty line of
// the Plugins screen (15), the pill buttons, a status badge, the two-way
// switch of Connected apps, a notice block and an app's mark. Everything is
// drawn from Theme tokens so every skin applies, at the Plugins screen's
// geometry (rows on the page background, 21.7 pt side insets). No layout
// assumes a phone: the parts size to the column they are given, so an iPad
// shell can host them as they are.
import CompanionCore
import SwiftUI

/// "Featured"-style heading: an 11 pt grey title and an optional trailing link.
struct PluginsSectionHeading: View {
    @Environment(\.themePalette) var themePalette
    let title: Text
    var trailing: Text?
    var trailingAction: (() -> Void)?

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            title
                .font(Theme.Font.label)
                .foregroundStyle(Theme.parity(Color(hex: 0x575658), Theme.placeholder))
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            if let trailing, let trailingAction {
                Button {
                    Haptics.selection()
                    trailingAction()
                } label: { trailing }
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.parity(Color(hex: 0x97969C), Theme.textSecondary))
                    .buttonStyle(.plain)
            }
        }
        .padding(.leading, 21.7)
        .padding(.trailing, 22)
        .padding(.bottom, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A grey sentence where a list would be.
struct PluginsNote: View {
    @Environment(\.themePalette) var themePalette
    let text: Text
    var color: Color?

    var body: some View {
        text
            .font(Theme.Font.label)
            .foregroundStyle(color ?? Theme.textSecondary)
            .lineSpacing(0.87)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 21.7)
            .padding(.vertical, 10)
    }
}

/// A tinted block: the stale warning, an error, a notice, the per-bot tip.
struct PluginsCallout<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    enum Tone { case neutral, warning, danger, success }
    var tone: Tone = .neutral
    @ViewBuilder let content: () -> Content

    private var tint: Color {
        switch tone {
        case .neutral: Theme.textSecondary
        case .warning: Theme.warning
        case .danger: Theme.danger
        case .success: Theme.success
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6, content: content)
            .font(Theme.Font.label)
            .foregroundStyle(tone == .neutral ? Theme.textSecondary : tint)
            .lineSpacing(0.87)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(tone == .neutral ? Theme.card : tint.opacity(0.12),
                        in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 12, style: .continuous))
            .padding(.horizontal, SettingsMetrics.cardMargin)
            .padding(.bottom, 10)
    }
}

/// The Plugins screen's pill ("Add"): #2B2B2D on the references, the skin's
/// pill elsewhere. Disabled pills keep a readable label and refuse the tap.
struct PluginsPillButton: View {
    @Environment(\.themePalette) var themePalette
    let title: Text
    var enabled = true
    var busy = false
    var prominent = false
    var identifier: String?
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Group {
                if busy {
                    ProgressView().controlSize(.small).tint(Theme.textPrimary)
                } else {
                    title
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(prominent ? Theme.accentInk : (enabled ? Theme.textPrimary : Theme.addedText))
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 12.3)
            .frame(minWidth: 44.67)
            .frame(height: 32.67)
            .background(prominent ? Theme.accent : Theme.pill, in: Capsule())
        }
        .buttonStyle(.plain)
        .allowsHitTesting(enabled && !busy)
        .accessibilityAddTraits(enabled && !busy ? [] : .isStaticText)
        .accessibilityIdentifier(identifier ?? "")
    }
}

/// A small rounded status word: On / Off, Connected, Sign-in required.
struct PluginsBadge: View {
    @Environment(\.themePalette) var themePalette
    enum Tone { case neutral, success, warning }
    let text: Text
    var tone: Tone = .neutral

    var body: some View {
        text
            .font(Theme.font(10.5, .medium))
            .foregroundStyle(tone == .success ? Theme.success : tone == .warning ? Theme.warning : Theme.textSecondary)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 2.5)
            .background(
                (tone == .success ? Theme.success.opacity(0.14) : tone == .warning ? Theme.warning.opacity(0.14) : Theme.pill),
                in: Capsule()
            )
    }
}

/// Two choices in a glass capsule (Marketplace / Connected).
struct PluginsSegmented<Value: Hashable>: View {
    @Environment(\.themePalette) var themePalette
    let options: [(value: Value, label: Text, identifier: String)]
    @Binding var selection: Value

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                let selected = option.value == selection
                Button {
                    Haptics.selection()
                    selection = option.value
                } label: {
                    option.label
                        .font(Theme.Font.labelMedium)
                        .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                        .lineLimit(1)
                        .padding(.horizontal, 14)
                        .frame(height: 32)
                        .background(selected ? Theme.pill : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier(option.identifier)
            }
        }
        .padding(4)
        .themeGlass(Capsule())
    }
}

/// A glyph on a tinted tile (MCP rows, Claude connectors).
struct PluginsGlyphTile: View {
    @Environment(\.themePalette) var themePalette
    let systemImage: String
    var active = false
    var size: CGFloat = 38.5

    var body: some View {
        ZStack {
            (active ? Theme.success.opacity(0.14) : Theme.pill)
            Image(systemName: systemImage)
                .font(.system(size: size * 0.45, weight: .regular))
                .foregroundStyle(active ? Theme.success : Theme.textSecondary)
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: size * 11.5 / 38.5, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// The glass refresh circle in a page header.
struct PluginsRefreshButton: View {
    @Environment(\.themePalette) var themePalette
    let label: LocalizedStringKey
    var spinning = false
    var identifier: String
    let action: () -> Void

    var body: some View {
        Group {
            if spinning {
                ProgressView()
                    .tint(Theme.textPrimary)
                    .frame(width: Theme.Metric.glassSheet, height: Theme.Metric.glassSheet)
                    .themeGlass(Circle())
            } else {
                GlassCircleButton(systemImage: "arrow.clockwise", size: .sheet, accessibilityLabel: label, action: action)
            }
        }
        .accessibilityIdentifier(identifier)
    }
}

/// Formats an English source string with arguments in the app's language.
func pluginsFormat(_ key: String, _ arguments: CVarArg...) -> String {
    String(format: AppStrings.localized(key), arguments: arguments)
}

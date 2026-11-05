// iPad I4: the small controls the desktop's bot panel is made of, measured
// in the references (desktop-*-3[3-9]-panel-*.json, 4x-panel-more-*):
// the inset field (`inputCls`: rounded-lg, 1 pt hairline/40, bg-inset,
// 13 pt, px 10 py 6), the 44x20 switch (`Toggle.tsx`), the cards
// (`rounded-xl bg-hover p-3` and `rounded-xl border border-hairline/40
// p-4`), the chip row and the section heading. Desktop styling only: these
// are drawn inside the desktop shell, never on the iPhone.
import SwiftUI
import UIKit
import CompanionCore

extension DesktopTheme {
    /// `border-hairline/40`
    var hairline40: Color { hairline.opacity(0.4) }
    /// `border-hairline/50`
    var hairline50: Color { hairline.opacity(0.5) }
    /// The switch's "on" track (`bg-success`, rgb(56, 213, 145) in Pulsatrix).
    /// The desktop's switch track (styles/skin-switch.css).
    var switchOn: Color { DesktopSwitchColors.of(skin).on }

    /// `bg-hover` (#77777752 at 0.173) composited over the panel's `app`
    /// ground in sRGB, as the browser does.
    var hoverOnApp: Color {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(app).getRed(&r, green: &g, blue: &b, alpha: &a)
        let gray: CGFloat = 0x77 / 255, alpha: CGFloat = 0.173
        return Color(.sRGB, red: r + (gray - r) * alpha, green: g + (gray - g) * alpha, blue: b + (gray - b) * alpha)
    }
}

/// A 13 pt label above a control (`Field`).
struct PanelLabel: View {
    @Environment(\.desktopTheme) private var theme
    let text: LocalizedStringKey
    var size: CGFloat = 13

    var body: some View {
        Text(text)
            .font(theme.font(size))
            .foregroundStyle(theme.inkSecondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The inset single-line field (`inputCls`).
struct PanelTextField: View {
    @Environment(\.desktopTheme) private var theme
    let placeholder: LocalizedStringKey
    @Binding var text: String
    var mono = false
    var onCommit: () -> Void = {}

    var body: some View {
        TextField("", text: $text, prompt: Text(placeholder).foregroundColor(theme.inkSecondary))
            .font(mono ? .system(size: 12.5, design: .monospaced) : theme.font(13))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .padding(.horizontal, 10)
            .frame(height: 33.5)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
            .onSubmit(onCommit)
    }
}

/// The inset multi-line field (`textarea` with `inputCls`).
struct PanelTextArea: View {
    @Environment(\.desktopTheme) private var theme
    let placeholder: LocalizedStringKey
    @Binding var text: String
    var minHeight: CGFloat = 72
    var mono = false
    /// The CSS line height (`leading-relaxed` = 21.125 at 13 pt).
    var lineHeight: CGFloat = 21.125

    private var uiFont: UIFont { mono ? .monospacedSystemFont(ofSize: 13, weight: .regular) : theme.uiFont(13) }

    var body: some View {
        ZStack(alignment: .topLeading) {
            if text.isEmpty {
                Text(placeholder)
                    .font(theme.font(13))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.horizontal, 10)
                    .padding(.top, 9)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $text)
                .font(mono ? .system(size: 13, design: .monospaced) : theme.font(13))
                .lineSpacing(max(0, lineHeight - uiFont.lineHeight))
                .foregroundStyle(theme.ink)
                .tint(theme.focus)
                .scrollContentBackground(.hidden)
                .padding(.horizontal, 5)
                .padding(.vertical, 1)
        }
        .frame(minHeight: minHeight, alignment: .topLeading)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
        // One accessibility node (the editor), so a UI test that targets this
        // field does not hit the placeholder StaticText sharing the same id.
        .accessibilityElement(children: .contain)
    }
}

/// The desktop's 44x20 switch: a 26x16 knob in `ink`, the track `success`
/// when on and 10 % ink when off.
struct PanelSwitch: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    let isOn: Bool
    var disabled = false
    /// The track when on; nil: the skin's (a routine's switch wears its bot's colour).
    var onColor: Color? = nil
    let set: (Bool) -> Void

    var body: some View {
        Button { set(!isOn) } label: {
            ZStack(alignment: isOn ? .trailing : .leading) {
                Capsule().fill(isOn ? (onColor ?? theme.switchOn) : DesktopSwitchColors.of(theme.skin).off)
                Capsule().fill(Color.white).frame(width: 26, height: 16).padding(2)
            }
            .frame(width: 44, height: 20)
            .opacity(disabled ? 0.5 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .animation(.easeOut(duration: 0.15), value: isOn)
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(isOn ? "On" : "Off"))
    }
}

/// `rounded-xl bg-hover p-3`: the Overview's cards.
struct PanelFillCard<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.hoverOnApp, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/// `rounded-xl border border-hairline/40 p-4`: every other section's cards.
struct PanelCard<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    /// p-4 inside the 1 pt border.
    var padding: CGFloat = 17
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }
}

/// A card's title (13 medium) and its explanation (12.5 / 13 secondary).
struct PanelCardTitle: View {
    @Environment(\.desktopTheme) private var theme
    let title: LocalizedStringKey
    var detail: LocalizedStringKey?
    var detailText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(theme.font(13, .medium))
                .foregroundStyle(theme.ink)
            if let detail {
                Text(detail).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    .lineSpacing(2.5)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let detailText {
                Text(verbatim: detailText).font(theme.font(12.5)).foregroundStyle(theme.inkSecondary)
                    .lineSpacing(2.5)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// A row of choice chips (`rounded-lg border px-3 py-1`): the chosen one
/// takes the accent ring and fill.
struct PanelChips<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let options: [(Value, String)]
    let selected: Value?
    var disabled = false
    let pick: (Value) -> Void

    var body: some View {
        PanelFlow(spacing: 6, lineSpacing: 6) {
            ForEach(options, id: \.0) { option in
                let on = option.0 == selected
                Button { pick(option.0) } label: {
                    Text(verbatim: option.1)
                        .font(theme.font(12.5))
                        .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(on ? theme.accent.opacity(0.18) : .clear, in: Capsule())
                        .overlay(Capsule().strokeBorder(on ? theme.accent.opacity(0.6) : theme.hairline50, lineWidth: 1))
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .disabled(disabled)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }
}

/// A wrapping row, like `flex flex-wrap`.
struct PanelFlow: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        var x: CGFloat = 0, y: CGFloat = 0, line: CGFloat = 0, widest: CGFloat = 0
        for view in subviews {
            let size = Self.size(of: view, in: width)
            if x > 0, x + size.width > width {
                y += line + lineSpacing
                x = 0
                line = 0
            }
            x += size.width + spacing
            line = max(line, size.height)
            widest = max(widest, x - spacing)
        }
        return CGSize(width: proposal.width ?? widest, height: y + line)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var x = bounds.minX, y = bounds.minY, line: CGFloat = 0
        for view in subviews {
            let size = Self.size(of: view, in: bounds.width)
            if x > bounds.minX, x + size.width > bounds.maxX {
                y += line + lineSpacing
                x = bounds.minX
                line = 0
            }
            view.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
            x += size.width + spacing
            line = max(line, size.height)
        }
    }

    /// Its natural size, wrapped to the row when it is wider.
    private static func size(of view: LayoutSubview, in width: CGFloat) -> CGSize {
        let natural = view.sizeThatFits(.unspecified)
        guard width.isFinite, natural.width > width else { return natural }
        return view.sizeThatFits(ProposedViewSize(width: width, height: nil))
    }
}

/// A grid of choices (Works on): equal cells, 32 tall, 6 apart, the chosen
/// one `border-hairline bg-control text-ink`, the others hairline/40, an
/// unavailable one at 40 %.
struct PanelSegmentGrid<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let options: [(Value, String, Bool)]
    let selected: Value?
    var columns = 3
    let pick: (Value) -> Void

    var body: some View {
        let rows = stride(from: 0, to: options.count, by: columns).map { Array(options[$0..<min($0 + columns, options.count)]) }
        VStack(spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 6) {
                    ForEach(row, id: \.0) { option in
                        let on = option.0 == selected
                        Button { pick(option.0) } label: {
                            Text(verbatim: option.1)
                                .font(theme.font(12))
                                .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                                .lineLimit(1)
                                .minimumScaleFactor(0.85)
                                .frame(maxWidth: .infinity)
                                .frame(height: 32)
                                .background(on ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .strokeBorder(on ? theme.hairline : theme.hairline40, lineWidth: 1))
                                .opacity(option.2 || on ? 1 : 0.4)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(!option.2)
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                    if row.count < columns {
                        ForEach(0..<(columns - row.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity, maxHeight: 1) }
                    }
                }
            }
        }
    }
}

/// A plain text button in the panel's small style (`rounded-lg border
/// border-hairline/50 px-3 py-1.5 text-[12.5px]`).
struct PanelButton: View {
    @Environment(\.desktopTheme) private var theme
    let title: LocalizedStringKey
    var systemImage: String?
    var prominent = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let systemImage { Image(systemName: systemImage).font(.system(size: 12)) }
                Text(title).font(theme.font(12.5, prominent ? .medium : .regular))
            }
            .foregroundStyle(disabled ? theme.inkSecondary.opacity(0.6) : (prominent ? theme.ink : theme.inkSecondary))
            .padding(.horizontal, 12)
            .frame(height: 32)
            .background(prominent ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline50, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .hoverEffect(.highlight)
    }
}

/// A line that says something could not load (a refused route, an older
/// computer): quiet, never an alert.
struct PanelNotice: View {
    @Environment(\.desktopTheme) private var theme
    let text: String

    var body: some View {
        Text(verbatim: text)
            .font(theme.font(12.5))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

/// CSS line boxes for panel copy: the font, the leading between lines, and
/// half of it above and below the block, so a paragraph is as tall as the
/// desktop draws it (`text-[13px] leading-relaxed` = 13 / 21.125).
struct PanelTextStyle: ViewModifier {
    @Environment(\.desktopTheme) private var theme
    let size: CGFloat
    let lineHeight: CGFloat
    var weight: Font.Weight = .regular

    func body(content: Content) -> some View {
        let natural = theme.uiFont(size, weight).lineHeight
        let leading = max(0, lineHeight - natural)
        return content
            .font(theme.font(size, weight))
            .lineSpacing(leading)
            .padding(.vertical, leading / 2)
            .fixedSize(horizontal: false, vertical: true)
    }
}

extension View {
    /// `text-[size] leading-[lineHeight]` in the panel.
    func panelText(_ size: CGFloat, _ lineHeight: CGFloat, _ weight: Font.Weight = .regular) -> some View {
        modifier(PanelTextStyle(size: size, lineHeight: lineHeight, weight: weight))
    }
}

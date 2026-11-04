// iPad I5: the pieces the desktop's Settings and Plugins modals are made of
// (src/components/SettingsPrimitives.tsx, SettingsModal.tsx, ApiKeys.tsx,
// PluginsPanel.tsx), at the renderer's metrics read from the DOM dumps
// (ios/parity/desktop/refs/desktop-*-59..79-*.json): the modal frame and
// scrim, the collapsible card, the setting row, the switch, the select, the
// key field and the buttons. Text sits in CSS line boxes (`desktopLine`):
// the face's own line plus half the leading above and below, as Chrome
// centres it.
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Icons

enum DesktopSettingsIcon: String, CaseIterable {
    case user, building2, palette, flaskConical, keyRound, zap, terminal, tabletSmartphone, monitor, coins, mail, archive, users, scrollText, search, x, chevronDown, chevronUp, circleQuestionMark, refreshCw, check, externalLink, download, upload, arrowUpRight, loaderCircle, shield, rotateCcw, triangleAlert, clipboardPaste, plus, circlePower, pencil, trash2, globe, plugZap, plug, circle, circleCheck, audioLines, info, bell, chevronRight, copy, fileUp, fingerprint

    /// Path data in the 24 pt viewBox (lucide-react 0.539, ISC).
    var paths: [String] {
        switch self {
        case .user: ["M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2","M8 7A4 4 0 1 0 16 7A4 4 0 1 0 8 7Z"]
        case .building2: ["M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z","M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2","M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2","M10 6h4","M10 10h4","M10 14h4","M10 18h4"]
        case .palette: ["M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z","M13 6.5A.5 .5 0 1 0 14 6.5A.5 .5 0 1 0 13 6.5Z","M17 10.5A.5 .5 0 1 0 18 10.5A.5 .5 0 1 0 17 10.5Z","M6 12.5A.5 .5 0 1 0 7 12.5A.5 .5 0 1 0 6 12.5Z","M8 7.5A.5 .5 0 1 0 9 7.5A.5 .5 0 1 0 8 7.5Z"]
        case .flaskConical: ["M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2","M6.453 15h11.094","M8.5 2h7"]
        case .keyRound: ["M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z","M16 7.5A.5 .5 0 1 0 17 7.5A.5 .5 0 1 0 16 7.5Z"]
        case .zap: ["M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"]
        case .terminal: ["M12 19h8","m4 17 6-6-6-6"]
        case .tabletSmartphone: ["M5 8H11A2 2 0 0 1 13 10V20A2 2 0 0 1 11 22H5A2 2 0 0 1 3 20V10A2 2 0 0 1 5 8Z","M5 4a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2h-2.4","M8 18h.01"]
        case .monitor: ["M4 3H20A2 2 0 0 1 22 5V15A2 2 0 0 1 20 17H4A2 2 0 0 1 2 15V5A2 2 0 0 1 4 3Z","M8 21L16 21","M12 17L12 21"]
        case .coins: ["M2 8A6 6 0 1 0 14 8A6 6 0 1 0 2 8Z","M18.09 10.37A6 6 0 1 1 10.34 18","M7 6h1v4","m16.71 13.88.7.71-2.82 2.82"]
        case .mail: ["m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7","M4 4H20A2 2 0 0 1 22 6V18A2 2 0 0 1 20 20H4A2 2 0 0 1 2 18V6A2 2 0 0 1 4 4Z"]
        case .archive: ["M3 3H21A1 1 0 0 1 22 4V7A1 1 0 0 1 21 8H3A1 1 0 0 1 2 7V4A1 1 0 0 1 3 3Z","M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8","M10 12h4"]
        case .users: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2","M16 3.128a4 4 0 0 1 0 7.744","M22 21v-2a4 4 0 0 0-3-3.87","M5 7A4 4 0 1 0 13 7A4 4 0 1 0 5 7Z"]
        case .scrollText: ["M15 12h-5","M15 8h-5","M19 17V5a2 2 0 0 0-2-2H4","M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3"]
        case .search: ["m21 21-4.34-4.34","M3 11A8 8 0 1 0 19 11A8 8 0 1 0 3 11Z"]
        case .x: ["M18 6 6 18","m6 6 12 12"]
        case .chevronDown: ["m6 9 6 6 6-6"]
        case .chevronUp: ["m18 15-6-6-6 6"]
        case .circleQuestionMark: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3","M12 17h.01"]
        case .refreshCw: ["M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8","M21 3v5h-5","M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16","M8 16H3v5"]
        case .check: ["M20 6 9 17l-5-5"]
        case .externalLink: ["M15 3h6v6","M10 14 21 3","M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"]
        case .download: ["M12 15V3","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4","m7 10 5 5 5-5"]
        case .upload: ["M12 3v12","m17 8-5-5-5 5","M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"]
        case .arrowUpRight: ["M7 7h10v10","M7 17 17 7"]
        case .loaderCircle: ["M21 12a9 9 0 1 1-6.219-8.56"]
        case .shield: ["M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"]
        case .rotateCcw: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8","M3 3v5h5"]
        case .triangleAlert: ["m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3","M12 9v4","M12 17h.01"]
        case .clipboardPaste: ["M11 14h10","M16 4h2a2 2 0 0 1 2 2v1.344","m17 18 4-4-4-4","M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 1.793-1.113","M9 2H15A1 1 0 0 1 16 3V5A1 1 0 0 1 15 6H9A1 1 0 0 1 8 5V3A1 1 0 0 1 9 2Z"]
        case .plus: ["M5 12h14","M12 5v14"]
        case .circlePower: ["M12 7v4","M7.998 9.003a5 5 0 1 0 8-.005","M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z"]
        case .pencil: ["M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z","m15 5 4 4"]
        case .trash2: ["M10 11v6","M14 11v6","M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6","M3 6h18","M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"]
        case .globe: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20","M2 12h20"]
        case .plugZap: ["M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z","m2 22 3-3","M7.5 13.5 10 11","M10.5 16.5 13 14","m18 3-4 4h6l-4 4"]
        case .plug: ["M12 22v-5","M9 8V2","M15 8V2","M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"]
        case .circle: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z"]
        case .circleCheck: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","m9 12 2 2 4-4"]
        case .audioLines: ["M2 10v3","M6 6v11","M10 3v18","M14 8v7","M18 5v13","M22 10v3"]
        case .info: ["M2 12A10 10 0 1 0 22 12A10 10 0 1 0 2 12Z","M12 16v-4","M12 8h.01"]
        case .bell: ["M10.268 21a2 2 0 0 0 3.464 0","M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326"]
        case .chevronRight: ["m9 18 6-6-6-6"]
        case .copy: ["M10 8H20A2 2 0 0 1 22 10V20A2 2 0 0 1 20 22H10A2 2 0 0 1 8 20V10A2 2 0 0 1 10 8Z","M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"]
        case .fileUp: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z","M14 2v4a2 2 0 0 0 2 2h4","M12 12v6","m15 15-3-3-3 3"]
        case .fingerprint: ["M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4","M14 13.12c0 2.38 0 6.38-1 8.88","M17.29 21.02c.12-.6.43-2.3.5-3.02","M2 12a10 10 0 0 1 18-6","M2 16h.01","M21.8 16c.2-2 .131-5.354 0-6","M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2","M8.65 22c.21-.66.45-1.32.57-2","M9 6.8a6 6 0 0 1 9 5.2v2"]
        }
    }
}

/// One lucide icon of the Settings and Plugins modals.
struct DesktopSettingsIconView: View {
    let icon: DesktopSettingsIcon
    var size: CGFloat = 16
    var strokeWidth: CGFloat = 2

    var body: some View {
        Canvas { context, canvas in
            let scale = canvas.width / 24
            context.scaleBy(x: scale, y: scale)
            let style = StrokeStyle(lineWidth: strokeWidth, lineCap: .round, lineJoin: .round)
            for d in icon.paths {
                context.stroke(Path(SVGPath.cached(d)), with: .foreground, style: style)
            }
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

// MARK: - Text in CSS line boxes

extension View {
    /// The CSS line box of `size`-point text at `line` points: the leading
    /// split above and below, and between wrapped lines.
    func desktopLine(_ size: CGFloat, _ line: CGFloat, _ theme: DesktopTheme, weight: Font.Weight = .regular) -> some View {
        let font = theme.uiFont(size, weight)
        let natural = font.lineHeight
        let leading = line - natural
        // Chrome lays the line out in whole CSS pixels: ascent and descent
        // rounded, the half leading floored. Its baseline sits up to a point
        // higher than the exact half leading puts SwiftUI's.
        let ascent = font.ascender.rounded()
        let content = ascent + (-font.descender).rounded()
        let chromeBaseline = ((line - content) / 2).rounded(.down) + ascent
        let nudge = chromeBaseline - (leading / 2 + font.ascender)
        return self
            .lineSpacing(max(0, leading))
            .padding(.top, leading / 2 + nudge)
            .padding(.bottom, leading / 2 - nudge)
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Text at a desktop size, weight, colour and line height. Plain strings
/// are laid out by UIKit with Chrome's rules (`DesktopLabel`): a fixed line
/// box and no orphan control, so a paragraph wraps where the desktop's does;
/// a `Text` (formatted, concatenated) is drawn by SwiftUI in the same box.
struct DesktopText: View {
    @Environment(\.desktopTheme) private var theme
    private enum Content { case text(Text), string(String) }
    private let content: Content
    var size: CGFloat = 13
    var weight: Font.Weight = .regular
    var line: CGFloat = 18
    var color: KeyPath<DesktopTheme, Color> = \.ink
    var tracking: CGFloat = 0
    var strikethrough = false

    init(_ text: Text, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0) {
        content = .text(text)
        self.size = size
        self.weight = weight
        self.line = line
        self.color = color
        self.tracking = tracking
    }

    /// A string-catalog key, in the app's language (`AppStrings`).
    init(_ key: StaticString, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0, strikethrough: Bool = false) {
        self.init(verbatim: AppStrings.localized("\(key)"), size: size, weight: weight, line: line, color: color,
                  tracking: tracking, strikethrough: strikethrough)
    }

    init(verbatim value: String, size: CGFloat = 13, weight: Font.Weight = .regular, line: CGFloat = 18,
         color: KeyPath<DesktopTheme, Color> = \.ink, tracking: CGFloat = 0, strikethrough: Bool = false) {
        content = .string(value)
        self.size = size
        self.weight = weight
        self.line = line
        self.color = color
        self.tracking = tracking
        self.strikethrough = strikethrough
    }

    var body: some View {
        switch content {
        case let .text(text):
            text
                .font(theme.font(size, weight))
                .tracking(tracking)
                .foregroundStyle(theme[keyPath: color])
                .desktopLine(size, line, theme, weight: weight)
        case let .string(value):
            DesktopLabel(
                text: value, font: theme.uiFont(size, weight), line: line,
                color: UIColor(theme[keyPath: color]), tracking: tracking, strikethrough: strikethrough
            )
        }
    }
}

/// A UILabel in a CSS line box: every line `line` points tall, the
/// baseline where Chrome puts it (ascent and descent rounded to whole CSS
/// pixels, the half leading floored), words wrapped without iOS's orphan
/// control. Sizes itself to the proposed width.
/// Draws every line from the top even when fractional line boxes add up a
/// hair past the bounds (UILabel would drop the last line).
final class DesktopUILabel: UILabel {
    override func drawText(in rect: CGRect) {
        let open = CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: .greatestFiniteMagnitude)
        let needed = super.textRect(forBounds: open, limitedToNumberOfLines: numberOfLines).height
        super.drawText(in: CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: max(rect.height, needed)))
    }
}

struct DesktopLabel: UIViewRepresentable {
    let text: String
    let font: UIFont
    let line: CGFloat
    let color: UIColor
    var tracking: CGFloat = 0
    var strikethrough = false

    func makeUIView(context: Context) -> UILabel {
        let label = DesktopUILabel()
        label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        label.setContentHuggingPriority(.required, for: .vertical)
        label.adjustsFontForContentSizeCategory = false
        return label
    }

    func updateUIView(_ label: UILabel, context: Context) {
        let limit = context.environment.lineLimit
        label.numberOfLines = limit ?? 0
        label.attributedText = attributed(context.environment.textCase, truncates: limit != nil)
        label.lineBreakMode = limit == nil ? .byWordWrapping : .byTruncatingTail
        label.lineBreakStrategy = []
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView label: UILabel, context: Context) -> CGSize? {
        let width = proposal.width ?? .greatestFiniteMagnitude
        let fitted = label.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        let lines = max(1, (fitted.height / line).rounded())
        // A wrapped paragraph keeps the whole width: laid out again in the
        // width of its longest line (rounded by UIKit), it could wrap anew.
        let used = lines > 1 && proposal.width != nil ? width : min(ceil(fitted.width) + 1, width)
        return CGSize(width: used, height: lines * line)
    }

    private func attributed(_ textCase: Text.Case?, truncates: Bool) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = line
        paragraph.maximumLineHeight = line
        paragraph.lineBreakStrategy = []
        paragraph.lineBreakMode = truncates ? .byTruncatingTail : .byWordWrapping
        // UIKit puts a tall line's extra room above the glyphs (baseline at
        // line - descent); Chrome's baseline is higher: raise to meet it.
        let ascent = font.ascender.rounded()
        let content = ascent + (-font.descender).rounded()
        let chromeBaseline = ((line - content) / 2).rounded(.down) + ascent
        let uikitBaseline = line + font.descender
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph,
            .baselineOffset: uikitBaseline - chromeBaseline,
        ]
        // an explicit kern of 0 would turn the font's own kerning off
        if tracking != 0 { attributes[.kern] = tracking }
        if strikethrough { attributes[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        let shown: String
        switch textCase {
        case .uppercase: shown = text.uppercased()
        case .lowercase: shown = text.lowercased()
        default: shown = text
        }
        return NSAttributedString(string: shown, attributes: attributes)
    }
}

// MARK: - Modal frame

/// The modal geometry (`fixed inset-0 flex items-center justify-center
/// bg-black/50 p-3 sm:p-6`): a box `min(width, 100vw-40)` by
/// `min(700, 100dvh-96)` centred in the window.
enum DesktopModalGeometry {
    static func frame(width: CGFloat, in window: CGSize, height: CGFloat = 700) -> CGRect {
        let w = min(width, window.width - 40)
        let h = min(height, window.height - 96)
        return CGRect(x: ((window.width - w) / 2).rounded(), y: ((window.height - h) / 2).rounded(), width: w, height: h)
    }
}

/// The scrim and the centred box; a click on the scrim closes, as on the
/// desktop (`onMouseDown` on the backdrop), and so does Escape.
struct DesktopModalFrame<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let width: CGFloat
    var background: KeyPath<DesktopTheme, Color> = \.app
    let close: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geometry in
            let box = DesktopModalGeometry.frame(width: width, in: geometry.size)
            ZStack(alignment: .topLeading) {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                content()
                    .padding(1)
                    .frame(width: box.width, height: box.height)
                    .background(theme[keyPath: background])
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(theme.border, lineWidth: 1)
                    )
                    .offset(x: box.minX, y: box.minY)
            }
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
    }
}

/// Escape on a hardware keyboard.
struct DesktopEscapeKey: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) { Text("Close") }
            .keyboardShortcut(.escape, modifiers: [])
            .opacity(0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// The round close button of a modal (`size-8 rounded-full text-ink-tertiary`, X 18).
struct DesktopCloseButton: View {
    @Environment(\.desktopTheme) private var theme
    let label: LocalizedStringKey
    let identifier: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            DesktopSettingsIconView(icon: .x, size: 18)
                .foregroundStyle(theme.inkTertiary)
                .frame(width: 32, height: 32)
                .contentShape(Circle())
        }
        .buttonStyle(DesktopHoverFill(radius: 16))
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(identifier)
    }
}

/// `hover:bg-*` for a plain button.
struct DesktopHoverFill: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    var radius: CGFloat = 8
    var fill: KeyPath<DesktopTheme, Color> = \.hover
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                (hovering || configuration.isPressed) ? theme[keyPath: fill] : .clear,
                in: RoundedRectangle(cornerRadius: radius, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

// MARK: - Cards and rows

/// `Card` (SettingsPrimitives.tsx): a hairline box; collapsible ones have a
/// 42 pt header (title, summary, chevron) and a body under it.
struct DesktopSettingsCard<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var summary: Text? = nil
    var subtitle: Text? = nil
    var identifier: String
    @State private var open: Bool
    @ViewBuilder let content: () -> Content

    init(_ title: Text, summary: Text? = nil, subtitle: Text? = nil, open: Bool = true, identifier: String,
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.summary = summary
        self.subtitle = subtitle
        self.identifier = identifier
        _open = State(initialValue: open)
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
            } label: {
                HStack(spacing: 12) {
                    DesktopText(title)
                        .layoutPriority(1)
                    Spacer(minLength: 0)
                    if let summary, !open {
                        DesktopText(summary, size: 12.5, color: \.inkSecondary)
                            .lineLimit(1)
                    }
                    DesktopSettingsIconView(icon: open ? .chevronUp : .chevronDown, size: 14)
                        .foregroundStyle(theme.inkSecondary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(DesktopHoverFill(radius: 14))
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(open ? Text("Expanded") : Text("Collapsed"))
            .accessibilityIdentifier("settings-card.\(identifier)")
            if open {
                VStack(alignment: .leading, spacing: 0) {
                    if let subtitle {
                        DesktopText(subtitle, color: \.inkSecondary)
                            .padding(.top, -4)
                            .padding(.bottom, 10)
                    }
                    content()
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(1)
        .desktopHairlineBox()
    }
}

extension View {
    /// `rounded-[14px] border-[0.5px] border-border`.
    func desktopHairlineBox(radius: CGFloat = 14) -> some View {
        modifier(DesktopHairlineBox(radius: radius))
    }
}

struct DesktopHairlineBox: ViewModifier {
    @Environment(\.desktopTheme) private var theme
    let radius: CGFloat

    func body(content: Content) -> some View {
        // `border-[0.5px]` lays out and draws as one CSS pixel in Chrome
        content.overlay(
            RoundedRectangle(cornerRadius: radius, style: .continuous)
                .strokeBorder(theme.border, lineWidth: 1)
        )
    }
}

/// `SettingsGroup`: a grey heading outside the card (`gap-2`), then one
/// `rounded-xl border-[0.5px] border-border bg-elevated py-1.5` card of rows.
/// `plain` keeps the heading only (the children are cards of their own).
struct DesktopSettingsGroup<Content: View>: View {
    @Environment(\.desktopTheme) private var theme
    var title: Text? = nil
    var accessory: AnyView? = nil
    var plain = false
    var identifier: String = ""
    @ViewBuilder let content: () -> Content

    init(_ title: Text? = nil, accessory: AnyView? = nil, plain: Bool = false, identifier: String = "",
         @ViewBuilder content: @escaping () -> Content) {
        self.title = title
        self.accessory = accessory
        self.plain = plain
        self.identifier = identifier
        self.content = content
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let title {
                HStack(spacing: 6) {
                    DesktopSettingsHeading(title)
                    if let accessory { accessory }
                }
            }
            if plain {
                VStack(alignment: .leading, spacing: 8, content: content)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                VStack(alignment: .leading, spacing: 0, content: content)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .desktopHairlineBox(radius: 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier.isEmpty ? "" : "settings-group.\(identifier)")
    }
}

/// `HelpTip`: the 20 pt circle-help button and its popover (`w-64`, 12/17).
struct DesktopHelpTip: View {
    @Environment(\.desktopTheme) private var theme
    let help: Text
    @State private var showing = false

    var body: some View {
        Button { showing.toggle() } label: {
            DesktopSettingsIconView(icon: .circleQuestionMark, size: 13)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 20, height: 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("More about this setting"))
        .popover(isPresented: $showing) {
            DesktopText(help, size: 12, line: 17, color: \.inkSecondary)
                .frame(width: 232, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
                .desktopPopoverOnCompact()
        }
    }
}

/// `CompactRow`: the label at the left, the control at the right
/// (`min-h-[44px] px-3.5 py-2 gap-5`).
struct DesktopCompactRow<Control: View>: View {
    let label: Text
    var help: Text? = nil
    var identifier: String = ""
    @ViewBuilder let control: () -> Control

    init(_ label: Text, help: Text? = nil, identifier: String = "", @ViewBuilder control: @escaping () -> Control) {
        self.label = label
        self.help = help
        self.identifier = identifier
        self.control = control
    }

    var body: some View {
        HStack(spacing: 20) {
            HStack(spacing: 6) {
                DesktopText(label)
                if let help { DesktopHelpTip(help: help) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 8) { control() }
                .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(minHeight: 44)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier.isEmpty ? "" : "settings-row.\(identifier)")
    }
}

/// `DescribedRow`: the label and its one grey line (12/16) at the left, the
/// control at the right (`px-3.5 py-2.5`, `min-h-[28px]`), what it opens below.
struct DesktopDescribedRow<Control: View, Below: View>: View {
    let label: Text
    var description: Text? = nil
    var help: Text? = nil
    var identifier: String = ""
    @ViewBuilder let control: () -> Control
    @ViewBuilder let below: () -> Below

    init(_ label: Text, description: Text? = nil, help: Text? = nil, identifier: String = "",
         @ViewBuilder control: @escaping () -> Control, @ViewBuilder below: @escaping () -> Below) {
        self.label = label
        self.description = description
        self.help = help
        self.identifier = identifier
        self.control = control
        self.below = below
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .center, spacing: 20) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        DesktopText(label)
                        if let help { DesktopHelpTip(help: help) }
                    }
                    if let description {
                        DesktopText(description, size: 12, line: 16, color: \.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                HStack(spacing: 8) { control() }
                    .fixedSize()
            }
            .frame(minHeight: 28)
            below()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier.isEmpty ? "" : "settings-row.\(identifier)")
    }
}

extension DesktopDescribedRow where Below == EmptyView {
    init(_ label: Text, description: Text? = nil, help: Text? = nil, identifier: String = "",
         @ViewBuilder control: @escaping () -> Control) {
        self.init(label, description: description, help: help, identifier: identifier, control: control, below: { EmptyView() })
    }
}

/// `LinkRow`: a row that opens something, the arrow (or the leave-the-app
/// mark) at the right, the whole row one button.
struct DesktopLinkRow: View {
    @Environment(\.desktopTheme) private var theme
    let label: Text
    var external = false
    var identifier: String = ""
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                DesktopText(label)
                    .frame(maxWidth: .infinity, alignment: .leading)
                DesktopSettingsIconView(icon: external ? .externalLink : .chevronRight, size: 14)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityIdentifier(identifier)
    }
}

/// `SettingsTextRow`: a line of explanation with a row's insets (12/16).
struct DesktopSettingsTextRow: View {
    let text: Text
    var color: KeyPath<DesktopTheme, Color> = \.inkSecondary
    init(_ text: Text, color: KeyPath<DesktopTheme, Color> = \.inkSecondary) {
        self.text = text
        self.color = color
    }

    var body: some View {
        DesktopText(text, size: 12, line: 16, color: color)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// `SettingsNotice`: a page's message as a card of its own, one row, the
/// words at the left and at most one action at the right.
struct DesktopSettingsNotice<Action: View>: View {
    @Environment(\.desktopTheme) private var theme
    let text: Text
    var color: KeyPath<DesktopTheme, Color> = \.inkSecondary
    @ViewBuilder let action: () -> Action

    init(_ text: Text, color: KeyPath<DesktopTheme, Color> = \.inkSecondary, @ViewBuilder action: @escaping () -> Action) {
        self.text = text
        self.color = color
        self.action = action
    }

    var body: some View {
        HStack(spacing: 20) {
            DesktopText(text, color: color)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            action()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .padding(.vertical, 6)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .desktopHairlineBox(radius: 12)
    }
}

extension DesktopSettingsNotice where Action == EmptyView {
    init(_ text: Text, color: KeyPath<DesktopTheme, Color> = \.inkSecondary) {
        self.init(text, color: color) { EmptyView() }
    }
}

/// `CountPill` ("12 ⌄"): how many items a row holds, and the button that
/// unfolds them under the row (`h-7 rounded-full px-2.5 gap-1`).
struct DesktopCountPill: View {
    @Environment(\.desktopTheme) private var theme
    var count: Int? = nil
    let open: Bool
    let label: Text
    var identifier: String = ""
    let toggle: () -> Void

    var body: some View {
        Button(action: toggle) {
            HStack(spacing: 4) {
                if let count { DesktopText(verbatim: "\(count)").monospacedDigit() }
                DesktopSettingsIconView(icon: .chevronDown, size: 13)
                    .foregroundStyle(theme.inkSecondary)
                    .rotationEffect(.degrees(open ? 180 : 0))
            }
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(open ? theme.hover : .clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(open ? Text("Expanded") : Text("Collapsed"))
        .accessibilityIdentifier(identifier)
    }
}

/// A native checkbox as Chrome draws it (13 pt, a 3 pt radius).
struct DesktopCheckbox: View {
    @Environment(\.desktopTheme) private var theme
    let checked: Bool
    let label: Text
    var identifier: String = ""
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(checked ? theme.accent : Color.clear)
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .strokeBorder(checked ? theme.accent : theme.inkSecondary, lineWidth: 1)
                if checked {
                    DesktopSettingsIconView(icon: .check, size: 10, strokeWidth: 3)
                        .foregroundStyle(theme.accentInk)
                }
            }
            .frame(width: 13, height: 13)
            .frame(width: 20, height: 20)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(checked ? Text("On") : Text("Off"))
        .accessibilityIdentifier(identifier)
    }
}

/// `SettingRow`: title (and its help), subtitle, and the control at the
/// right (`px-3.5 py-2.5`, columns `minmax(0,1fr) auto`, gap 16).
struct DesktopSettingRow<Control: View>: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    var subtitle: Text? = nil
    var help: Text? = nil
    @ViewBuilder let control: () -> Control
    @State private var showingHelp = false

    var body: some View {
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    DesktopText(title)
                    if let help {
                        Button { showingHelp.toggle() } label: {
                            DesktopSettingsIconView(icon: .circleQuestionMark, size: 13)
                                .foregroundStyle(theme.inkSecondary)
                                .frame(width: 20, height: 20)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("More about this setting"))
                        .popover(isPresented: $showingHelp) {
                            DesktopText(help, size: 12, line: 17, color: \.inkSecondary)
                                .frame(width: 232)
                                .padding(12)
                                .desktopPopoverOnCompact()
                        }
                    }
                }
                // the help button (size-5) makes the title line 20 tall
                .frame(height: help == nil ? 18 : 20)
                if let subtitle {
                    DesktopText(subtitle, color: \.inkSecondary)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            control()
                .frame(maxWidth: 240, alignment: .trailing)
                .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }
}

// MARK: - Controls

/// The switch tracks per skin (src/styles/skin-switch.css, generated by
/// scripts/gen-switch-tokens.mjs); ios-desktop-tokens.test.ts pins them.
enum DesktopSwitchColors {
    static let table: [String: (on: String, off: String)] = [
        "pulsatrix": ("#3c76f4", "#6c6c6c"), "pulsatrix-light": ("#2f62dd", "#778194"),
        "midnight": ("#929292", "#6c6c6c"), "atelier": ("#a05f25", "#898980"),
        "foundry": ("#c58527", "#746d5b"), "lagoon": ("#11736d", "#688582"),
        "graphite": ("#8993a2", "#6d798b"), "linen": ("#2a2a2a", "#788495"),
        "dusk": ("#9474a3", "#816c89"), "daylight": ("#2a2a2a", "#7e7e7e"),
        "retro98": ("#000080", "#676767"),
    ]

    static func of(_ skin: SkinID) -> (on: Color, off: Color) {
        let pair = table[skin.rawValue] ?? table["pulsatrix"]!
        func color(_ css: String) -> Color { (SkinColor(css: css) ?? SkinColor(0x3c76f4)).color }
        return (color(pair.on), color(pair.off))
    }
}

/// `Switch` (h-5 w-11): success fill when on, the 26 by 16 knob.
struct DesktopSwitch: View {
    @Environment(\.desktopTheme) private var theme
    let isOn: Bool
    let label: Text
    var identifier: String = ""
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack(alignment: isOn ? .trailing : .leading) {
                // the desktop's switch tracks (styles/skin-switch.css): the
                // skin's on colour and a neutral off, a white thumb on both
                let colors = DesktopSwitchColors.of(theme.skin)
                Capsule().fill(isOn ? colors.on : colors.off)
                Capsule().fill(Color.white)
                    .frame(width: 26, height: 16)
                    .padding(.horizontal, 2)
            }
            .frame(width: 44, height: 20)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(isOn ? Text("On") : Text("Off"))
        .accessibilityIdentifier(identifier)
    }
}

/// A `<select>`: the hairline box at the width of its longest option, the
/// current label and the chevron; the options in a menu.
struct DesktopSelect<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let options: [(Value, String)]
    let selection: Value
    /// What the box shows when it differs from the selected option's label.
    var shown: String? = nil
    let label: Text
    var identifier: String = ""
    var disabled = false
    let choose: (Value) -> Void

    var body: some View {
        let current = shown ?? options.first { $0.0 == selection }?.1 ?? ""
        let font = theme.uiFont(13)
        let longest = options.map { ($0.1 as NSString).size(withAttributes: [.font: font]).width }.max() ?? 0
        Menu {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button {
                    choose(option.0)
                } label: {
                    if option.0 == selection {
                        Label(option.1, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.1)
                    }
                }
            }
        } label: {
            HStack(spacing: 0) {
                Text(verbatim: current)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                Spacer(minLength: 4)
                DesktopSettingsIconView(icon: .chevronDown, size: 12, strokeWidth: 2.5)
                    .foregroundStyle(theme.ink)
            }
            .padding(.leading, 11)
            .padding(.trailing, 9)
            .frame(width: min(240, (longest + 36).rounded(.up)), height: 33)
            .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(Text(verbatim: current))
        .accessibilityIdentifier(identifier)
    }
}

/// `PillSelect`: the borderless pill menu ("Dark ⌄"): the current value
/// and a grey chevron (`h-7 rounded-full px-2.5 gap-1`), the choices in a menu.
struct DesktopPillSelect<Value: Hashable>: View {
    @Environment(\.desktopTheme) private var theme
    let options: [(Value, String)]
    let selection: Value
    var shown: String? = nil
    let label: Text
    var identifier: String = ""
    var disabled = false
    /// Fill a table cell: the value at the left, the chevron at the right edge.
    var fill = false
    let choose: (Value) -> Void

    var body: some View {
        let current = shown ?? options.first { $0.0 == selection }?.1 ?? ""
        Menu {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button {
                    if option.0 != selection { choose(option.0) }
                } label: {
                    if option.0 == selection {
                        Label(option.1, systemImage: "checkmark")
                    } else {
                        Text(verbatim: option.1)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(verbatim: current)
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                if fill { Spacer(minLength: 0) }
                DesktopSettingsIconView(icon: .chevronDown, size: 13)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, fill ? 8 : 10)
            .frame(maxWidth: fill ? .infinity : 240, alignment: .leading)
            .frame(height: fill ? 32 : 28)
            .contentShape(Capsule())
        }
        .fixedSize(horizontal: !fill, vertical: false)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(Text(verbatim: current))
        .accessibilityIdentifier(identifier)
    }
}

/// `ui-button` and its relatives.
struct DesktopButtonStyle: ButtonStyle {
    enum Kind { case control, ghost, accent, outline, hover }
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled
    var kind: Kind = .control
    var size: CGFloat = 13
    var weight: Font.Weight = .regular
    var height: CGFloat = 31.5
    var horizontal: CGFloat = 12
    var radius: CGFloat = 8

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(size, weight))
            .foregroundStyle(foreground)
            .padding(.horizontal, horizontal)
            .frame(height: height)
            .background(background(pressed: configuration.isPressed), in: RoundedRectangle(cornerRadius: radius, style: .continuous))
            .overlay {
                if kind == .outline {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).strokeBorder(theme.border, lineWidth: 1)
                }
            }
            .opacity(enabled ? 1 : 0.4)
            .contentShape(Rectangle())
    }

    private var foreground: Color {
        switch kind {
        case .accent: theme.accentInk
        case .ghost: theme.inkSecondary
        default: theme.ink
        }
    }

    private func background(pressed: Bool) -> Color {
        switch kind {
        case .control: pressed ? theme.raised : theme.control
        case .accent: pressed ? theme.accent.opacity(0.85) : theme.accent
        case .hover: theme.hover
        case .ghost, .outline: pressed ? theme.hover : .clear
        }
    }
}

/// A write-only key field (`ApiKeyRow`): status dot, label, the Optional
/// badge, help, and a secure field that saves on submit. The saved key is
/// never read back: the field shows its placeholder or "Saved".
struct DesktopKeyField: View {
    @Environment(\.desktopTheme) private var theme
    let title: Text
    let provider: DesktopAPIKeyProvider
    let configured: Bool
    var help: Text? = nil
    var showsHeader = true
    let save: (String) async -> String?
    @State private var draft = ""
    @State private var saving = false
    @State private var error: String?
    @State private var showingHelp = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if showsHeader {
                HStack(spacing: 8) {
                    Circle().fill(configured ? theme.success : theme.raisedHover).frame(width: 6, height: 6)
                    DesktopText(title, line: 19.5, color: \.inkSecondary)
                    DesktopText(configured ? Text("Saved") : Text("Optional"), size: 10, weight: .medium, line: 15,
                                color: configured ? \.success : \.inkSecondary, tracking: 0.5)
                        .textCase(.uppercase)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
                    Spacer(minLength: 0)
                    if let help {
                        Button { showingHelp.toggle() } label: {
                            DesktopSettingsIconView(icon: .circleQuestionMark, size: 14)
                                .foregroundStyle(theme.inkSecondary)
                                .frame(width: 24, height: 24)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text("About this key"))
                        .popover(isPresented: $showingHelp) {
                            DesktopText(help, size: 12, line: 17, color: \.inkSecondary)
                                .frame(width: 232)
                                .padding(12)
                                .desktopPopoverOnCompact()
                        }
                    }
                }
                .frame(height: 24)
                .padding(.bottom, 6)
            }
            SecureField(text: $draft, prompt: Text(verbatim: configured ? AppStrings.localized("Saved. Paste a new key to replace it.") : provider.placeholder)
                .foregroundColor(theme.inkSecondary)) {
                title
            }
            .font(theme.font(13))
            .foregroundStyle(theme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.done)
            .onSubmit { commit() }
            .disabled(saving)
            .padding(.horizontal, 13)
            .frame(height: 37.5)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            .accessibilityIdentifier("settings-key.\(provider.rawValue)")
            if let error {
                DesktopText(verbatim: error, size: 12, line: 17, color: \.danger)
                    .padding(.top, 6)
            }
        }
    }

    private func commit() {
        let key = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty, !saving else { return }
        saving = true
        Task {
            error = await save(key)
            if error == nil { draft = "" }
            saving = false
        }
    }
}

/// An uppercase pill (`rounded bg-control px-1.5 py-0.5 text-[10px] uppercase`).
struct DesktopBadge: View {
    @Environment(\.desktopTheme) private var theme
    let text: Text
    var color: KeyPath<DesktopTheme, Color> = \.inkSecondary

    var body: some View {
        DesktopText(text, size: 10, weight: .medium, line: 15, color: color, tracking: 0.5)
            .textCase(.uppercase)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(theme.control, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
    }
}

extension View {
    /// Keeps a help popover a popover in a compact window (iOS 16.4+).
    @ViewBuilder
    func desktopPopoverOnCompact() -> some View {
        if #available(iOS 16.4, *) {
            presentationCompactAdaptation(.popover)
        } else {
            self
        }
    }
}

// MARK: - Provider badges

/// A model provider's neutral badge: its monogram (CompanionCore
/// `EngineMonogram`) on a soft tone of Sagax's own palette. Never a third
/// party's official mark (App Store 5.2); the provider's name stays in text
/// beside it.
struct DesktopEngineBadge: View {
    @Environment(\.desktopTheme) private var theme
    let monogram: EngineMonogram
    var size: CGFloat = 28

    /// Sagax's badge tones (muted slate, sage, sand, plum, teal, clay), not
    /// any provider's colour.
    static let tones: [Color] = [
        Color(hex: 0x7C8799), Color(hex: 0x7FA08A), Color(hex: 0xB49A6A),
        Color(hex: 0x9A84A8), Color(hex: 0x6E9CA3), Color(hex: 0xB07F6E),
    ]

    var body: some View {
        let tone = Self.tones[monogram.tone % Self.tones.count]
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .fill(tone.opacity(0.28))
            RoundedRectangle(cornerRadius: size * 0.28, style: .continuous)
                .strokeBorder(tone.opacity(0.55), lineWidth: 1)
            Text(verbatim: monogram.letters)
                .font(.system(size: size * (monogram.letters.count > 1 ? 0.42 : 0.5), weight: .semibold, design: .rounded))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

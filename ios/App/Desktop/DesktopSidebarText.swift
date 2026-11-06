// iPad I2b: one line of desktop text drawn the way Chrome draws it.
//
// SwiftUI's `Text` lays glyphs on CoreText's quantized subpixel grid; the
// renderer's Skia positions them at their exact advances. The glyph images
// are the same (Geist, grayscale), only where each lands differs, which is
// most of what the parity diff still counts on a sidebar. A `CTLine` drawn
// with subpixel quantization off lands every glyph where Chrome does
// (measured against desktop-1366x1024-03-main: mean |Δ| 0.7 of 255 against
// 3.3 for `Text`).
//
// The line box is CSS's: the font's ascent and descent rounded to whole
// points, the half-leading floored, so the baseline sits at
// `top + floor((lineHeight - A - D) / 2) + A`. One line, ellipsized at the
// end when it does not fit (`truncate`).
import SwiftUI
import UIKit
import CoreText

struct DesktopLineText: View {
    @Environment(\.desktopTheme) private var theme
    let text: String
    var size: CGFloat
    var weight: Font.Weight = .regular
    var color: Color
    var lineHeight: CGFloat
    var tracking: CGFloat = 0
    /// Centre the line in its box instead of starting it at the leading edge.
    var centered = false

    /// The skin's face at this weight (`theme.uiFont` keeps the system
    /// face regular; the sidebar's labels need their weight).
    private var font: UIFont {
        guard theme.face == .system else { return theme.uiFont(size, weight) }
        let ui: UIFont.Weight
        switch weight {
        case .medium: ui = .medium
        case .semibold: ui = .semibold
        case .bold: ui = .bold
        default: ui = .regular
        }
        return .systemFont(ofSize: size, weight: ui)
    }

    var body: some View {
        let line = DesktopLineTextLine.make(text, font: font, key: "\(theme.face)|\(size)|\(DesktopFonts.wght(weight))", tracking: tracking)
        let ideal = line.width
        return Canvas(opaque: false, rendersAsynchronously: false) { context, canvas in
            let resolved = UIColor(color).cgColor
            context.withCGContext { cg in
                cg.setAllowsFontSubpixelPositioning(true)
                cg.setShouldSubpixelPositionFonts(true)
                cg.setAllowsFontSubpixelQuantization(false)
                cg.setShouldSubpixelQuantizeFonts(false)
                cg.setShouldSmoothFonts(false)
                let drawn = line.fitting(canvas.width, color: resolved)
                let x = centered ? max(0, (canvas.width - drawn.width) / 2) : 0
                let baseline = DesktopLineTextLine.baseline(lineHeight: lineHeight, font: line.font)
                    + max(0, (canvas.height - lineHeight) / 2)
                cg.saveGState()
                cg.translateBy(x: 0, y: canvas.height)
                cg.scaleBy(x: 1, y: -1)
                cg.textMatrix = .identity
                cg.textPosition = CGPoint(x: x, y: canvas.height - baseline)
                CTLineDraw(drawn.line, cg)
                cg.restoreGState()
            }
        }
        .frame(minWidth: 0, idealWidth: ideal, maxWidth: centered ? .infinity : ideal)
        .frame(height: lineHeight)
        // GroupListItem's name row is `items-baseline`: the Canvas must
        // report the same baseline the glyphs use, or a 12 pt time next to
        // a 14 pt name sits ~4 pt too high.
        .alignmentGuide(.firstTextBaseline) { _ in
            DesktopLineTextLine.baseline(lineHeight: lineHeight, font: line.font)
        }
        // takes its own width before a Spacer beside it does (`truncate`
        // only when the row is truly out of room)
        .layoutPriority(1)
        .accessibilityElement()
        .accessibilityLabel(Text(verbatim: text))
        .accessibilityAddTraits(.isStaticText)
    }
}

/// A measured line and its font, cached by content.
final class DesktopLineTextLine {
    let text: String
    let font: CTFont
    let attributes: [NSAttributedString.Key: Any]
    let width: CGFloat

    private init(text: String, font: CTFont, tracking: CGFloat) {
        self.text = text
        self.font = font
        var attributes: [NSAttributedString.Key: Any] = [kCTFontAttributeName as NSAttributedString.Key: font]
        if tracking != 0 { attributes[kCTKernAttributeName as NSAttributedString.Key] = tracking }
        self.attributes = attributes
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: attributes))
        width = CGFloat(CTLineGetTypographicBounds(line, nil, nil, nil))
    }

    private static var cache: [String: DesktopLineTextLine] = [:]

    static func make(_ text: String, font: UIFont, key fontKey: String, tracking: CGFloat) -> DesktopLineTextLine {
        let key = "\(fontKey)|\(tracking)|\(text)"
        if let hit = cache[key] { return hit }
        if cache.count > 4000 { cache.removeAll() }
        let made = DesktopLineTextLine(text: text, font: font as CTFont, tracking: tracking)
        cache[key] = made
        return made
    }

    /// The line in `color`, ellipsized to `width` when it overflows.
    func fitting(_ available: CGFloat, color: CGColor) -> (line: CTLine, width: CGFloat) {
        var colored = attributes
        colored[kCTForegroundColorAttributeName as NSAttributedString.Key] = color
        let line = CTLineCreateWithAttributedString(NSAttributedString(string: text, attributes: colored))
        // the frame lands on the pixel grid, up to half a point short of
        // the line's own width: that is not overflow
        guard width > available + 0.5 else { return (line, width) }
        let ellipsis = CTLineCreateWithAttributedString(NSAttributedString(string: "\u{2026}", attributes: colored))
        let cut = CTLineCreateTruncatedLine(line, Double(max(0, available)), .end, ellipsis) ?? line
        return (cut, CGFloat(CTLineGetTypographicBounds(cut, nil, nil, nil)))
    }

    /// CSS's baseline in a line box of `lineHeight`.
    static func baseline(lineHeight: CGFloat, font: CTFont) -> CGFloat {
        let ascent = CTFontGetAscent(font).rounded()
        let descent = CTFontGetDescent(font).rounded()
        return floor((lineHeight - ascent - descent) / 2) + ascent
    }
}

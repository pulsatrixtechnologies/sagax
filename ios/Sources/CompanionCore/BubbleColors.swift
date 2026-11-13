import Foundation

/// The colours of the conversation bubbles (2026-10-28; white ink as the
/// reference, #4096), the same rule as the desktop's `src/lib/bubble-colors.ts`:
/// the person's own message is filled with the accent, and a bot's reply is a
/// neutral grey a step off the page.
///
/// - on a coloured accent the text is white, as the reference writes every
///   accent bubble; the fill is the accent itself where white reads on it at
///   4.5:1, else the same hue a step deeper until it does (`whiteInkFill`);
/// - a neutral accent (white, grey, black) keeps the accent exactly with the
///   accent button's ink (`accentInk`), or the skin's own button ink when it
///   reads at 4.5:1;
/// - the grey is neutral in every skin, lighter than a dark page and darker
///   than a light one.
public enum BubbleColors {
    /// WCAG 1.4.3, normal text.
    public static let minimumContrast = 4.5
    private static let lightInk = SkinColor(0xFFFFFF)
    private static let darkInk = SkinColor(0x111111)
    private static let blackInk = SkinColor(0x000000)

    /// `accentInk`: white or near black, whichever contrasts more on the
    /// accent; black when the winner still falls under 4.5:1 (a mid tone).
    public static func accentInk(on accent: SkinColor) -> SkinColor {
        let fill = SkinColor(accent.hex)
        let light = lightInk.contrast(on: fill), dark = darkInk.contrast(on: fill)
        let best = light >= dark ? lightInk : darkInk
        return max(light, dark) >= minimumContrast ? best : blackInk
    }

    /// The person's bubble and the text on it, for an accent. A coloured
    /// accent: white text, on the accent where white reads, else on the same
    /// hue a step deeper (`whiteInkFill`). A neutral accent: the accent
    /// exactly, with `buttonInk` (the skin's accent button ink) when it reads
    /// at 4.5:1 on it, else `accentInk`.
    public static func user(accent: SkinColor, buttonInk: SkinColor? = nil) -> (fill: SkinColor, ink: SkinColor) {
        let fill = SkinColor(accent.hex)
        if !isNeutral(fill) { return (whiteInkFill(fill), lightInk) }
        if let buttonInk, buttonInk.contrast(on: fill) >= minimumContrast { return (fill, SkinColor(buttonInk.hex)) }
        return (fill, accentInk(on: fill))
    }

    /// How far from grey (max minus min channel, 0 to 1) an accent must be to
    /// count as a colour, as `isNeutralAccent` on the desktop.
    private static let neutralChroma = 0.1

    /// Whether an accent is a neutral (white, grey, black) rather than a colour.
    public static func isNeutral(_ accent: SkinColor) -> Bool {
        let (r, g, b) = (accent.red, accent.green, accent.blue)
        return max(r, g, b) - min(r, g, b) < neutralChroma
    }

    /// The fill of an accent bubble that carries white text: the accent
    /// itself where white reads on it at 4.5:1, else the same hue a step
    /// deeper until it does (`toneForSurface` on the desktop).
    public static func whiteInkFill(_ accent: SkinColor) -> SkinColor {
        let fill = SkinColor(accent.hex)
        if lightInk.contrast(on: fill) >= minimumContrast { return fill }
        let (h, s, l) = hsl(fill)
        var lo = 0.0, hi = l, best = fill
        for _ in 0..<28 {
            let mid = (lo + hi) / 2
            let candidate = fromHSL(h, s, mid)
            if lightInk.contrast(on: candidate) >= minimumContrast { best = candidate; lo = mid } else { hi = mid }
        }
        // a near grey still short at the hue's extreme: step toward black
        var nudged = best
        for _ in 0..<24 where lightInk.contrast(on: nudged) < minimumContrast {
            func dim(_ c: Double) -> UInt32 { UInt32(min(255, max(0, (c * 255 * 0.92).rounded()))) }
            nudged = SkinColor(dim(nudged.red) << 16 | dim(nudged.green) << 8 | dim(nudged.blue))
        }
        return nudged
    }

    /// Black, the default skin, is the Grok look (2026-11-01): the person's
    /// bubble is a neutral grey a step lighter than the bot's, as in Grok
    /// Bot. Every other skin keeps the accent and bot-colour rule below.
    public static func keepsNeutralBubbles(_ skin: SkinID) -> Bool { skin == .black }

    /// The person's bubble in a bot's colour (a 1:1 with that bot, 2026-10-28):
    /// the bot's colour in white text (`user(accent:)`), so a skin with a neutral accent
    /// (Midnight's near white) no longer leaves it white. Nil for a name that
    /// is not a bot colour: the skin's bubble then stays.
    public static func user(botColor name: String?) -> (fill: SkinColor, ink: SkinColor)? {
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty,
              let hex = MausColors.hex(for: name), let color = SkinColor(css: hex) else { return nil }
        return user(accent: color)
    }

    /// The bot's grey: the page's lightness, neutral, a step lighter (dark) or darker (light).
    public static func bot(app: SkinColor, dark: Bool) -> SkinColor {
        let l = hsl(app).l
        let next = dark ? min(1, l + 0.075) : max(0, l - 0.065)
        return fromHSL(0, 0, next)
    }

    private static func hsl(_ c: SkinColor) -> (h: Double, s: Double, l: Double) {
        let (r, g, b) = (c.red, c.green, c.blue)
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        if mx == mn { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        var h: Double
        if mx == r { h = (g - b) / d + (g < b ? 6 : 0) }
        else if mx == g { h = (b - r) / d + 2 }
        else { h = (r - g) / d + 4 }
        h /= 6
        return (h, s, l)
    }

    private static func fromHSL(_ h: Double, _ s: Double, _ l: Double) -> SkinColor {
        func byte(_ v: Double) -> UInt32 { UInt32(min(255, max(0, (v * 255).rounded()))) }
        if s == 0 { let v = byte(l); return SkinColor(v << 16 | v << 8 | v) }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        func channel(_ t: Double) -> Double {
            let u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
            if u < 1.0 / 6 { return p + (q - p) * 6 * u }
            if u < 1.0 / 2 { return q }
            if u < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - u) * 6 }
            return p
        }
        return SkinColor(byte(channel(h + 1.0 / 3)) << 16 | byte(channel(h)) << 8 | byte(channel(h - 1.0 / 3)))
    }
}

public extension SkinPalette {
    /// This palette with the bubbles drawn from its accent and its page.
    func bubbled() -> SkinPalette {
        var p = self
        let user = BubbleColors.user(accent: accent, buttonInk: accentInk)
        p.bubbleUser = user.fill
        p.bubbleUserText = user.ink
        p.bubbleAssistant = BubbleColors.bot(app: bg, dark: isDark)
        p.bubbleAssistantText = textPrimary
        return p
    }
}

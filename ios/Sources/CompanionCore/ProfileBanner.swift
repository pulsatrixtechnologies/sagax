// The bot profile banner's two colours (top, bottom), kept apart from the
// mascot that sits on its lower edge: `src/lib/profile-banner.ts` and
// `src/lib/mascot-dominant.ts` on the desktop. The wash comes from the bot
// colour and the mascot wears the same colour (or a skin near it), so the two
// can land on almost the same tone and the mascot disappears. Under 2:1
// between the mascot's body colour and the band, the band's lightness moves
// away from the mascot by just enough to reach the target, hue and saturation
// kept.
import Foundation

public enum ProfileBanner {
    /// `BANNER_MIN_CONTRAST`: below this the band moves.
    public static let minContrast = 2.0
    /// `BANNER_TARGET_CONTRAST`: what a moved band reaches.
    public static let targetContrast = 2.2
    /// `BANNER_TOP_SHARE` / `BANNER_BOTTOM_SHARE`: the accent's share of the wash.
    public static let topShare = 0.58
    public static let bottomShare = 0.36

    /// WCAG contrast between two `#RRGGBB` colours.
    public static func contrast(_ a: String, _ b: String) -> Double {
        let la = luminance(a), lb = luminance(b)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }

    static func luminance(_ hex: String) -> Double {
        let c = RGB(hex: hex)
        func lin(_ v: Double) -> Double {
            let s = v / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b)
    }

    /// `wash`: the accent taking `share` of the wash over `base`, the rest the base.
    public static func wash(_ accent: String, share: Double, base: String) -> String {
        let a = RGB(hex: accent), b = RGB(hex: base)
        return RGB(r: a.r * share + b.r * (1 - share), g: a.g * share + b.g * (1 - share), b: a.b * share + b.b * (1 - share)).hex
    }

    static func hsl(_ hex: String) -> (h: Double, s: Double, l: Double) {
        let c = RGB(hex: hex)
        let r = c.r / 255, g = c.g / 255, b = c.b / 255
        let mx = max(r, g, b), mn = min(r, g, b)
        let l = (mx + mn) / 2
        if mx == mn { return (0, 0, l) }
        let d = mx - mn
        let s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
        let h: Double
        if mx == r { h = (g - b) / d + (g < b ? 6 : 0) } else if mx == g { h = (b - r) / d + 2 } else { h = (r - g) / d + 4 }
        return (h / 6, s, l)
    }

    static func hex(h: Double, s: Double, l: Double) -> String {
        func channel(_ p: Double, _ q: Double, _ t: Double) -> Double {
            let u = t < 0 ? t + 1 : t > 1 ? t - 1 : t
            if u < 1.0 / 6 { return p + (q - p) * 6 * u }
            if u < 0.5 { return q }
            if u < 2.0 / 3 { return p + (q - p) * (2.0 / 3 - u) * 6 }
            return p
        }
        if s == 0 { return RGB(r: l * 255, g: l * 255, b: l * 255).hex }
        let q = l < 0.5 ? l * (1 + s) : l + s - l * s
        let p = 2 * l - q
        return RGB(r: channel(p, q, h + 1.0 / 3) * 255, g: channel(p, q, h) * 255, b: channel(p, q, h - 1.0 / 3) * 255).hex
    }

    /// `lightnessShift`: the signed step in lightness that makes `band` hold
    /// the target against `mascot`, the shorter way either side; nil when
    /// neither side gets there.
    static func lightnessShift(_ band: String, against mascot: String) -> Double? {
        let (h, s, l) = hsl(band)
        let step = 0.005
        func reach(_ direction: Double) -> Double? {
            var shift = step
            while l + direction * shift >= -step && l + direction * shift <= 1 + step {
                let next = min(1, max(0, l + direction * shift))
                if contrast(hex(h: h, s: s, l: next), mascot) >= targetContrast { return next - l }
                shift += step
            }
            return nil
        }
        let lighter = reach(1), darker = reach(-1)
        guard let up = lighter, let down = darker else { return lighter ?? darker }
        return abs(down) < abs(up) ? down : up
    }

    /// `profileBannerColors`: the banner's top and bottom colours for
    /// `accent`, kept apart from the mascot's body colour (nil: a picture).
    public static func colors(accent: String, mascot: String?, base: String = "#F7F7F7") -> (from: String, to: String) {
        let from = wash(accent, share: topShare, base: base)
        let to = wash(accent, share: bottomShare, base: base)
        guard let mascot, contrast(to, mascot) < minContrast, let shift = lightnessShift(to, against: mascot) else { return (from, to) }
        func move(_ color: String) -> String {
            let (h, s, l) = hsl(color)
            return hex(h: h, s: s, l: min(1, max(0, l + shift)))
        }
        return (move(from), move(to))
    }
}

public enum MascotDominant {
    /// `mascotDominantColor`: the body colour a bot's character and skin
    /// paint (a gradient role falls back to the solid beside it), as `#RRGGBB`.
    public static func color(look: CompleteMascotLook, color name: String, owlSkin: MascotSkin) -> String {
        let green = MausColors.hex["green"]!
        let hex = MausColors.hex(for: name) ?? green
        func solid(_ fallback: String, _ paints: String?...) -> String {
            paints.compactMap { $0 }.first { MausColors.isHex($0) } ?? fallback
        }
        switch look.character {
        case .shape:
            return solid(hex, ShapeArt.paint(look.shapeSkin, hex: hex).fill)
        case .bunbu:
            return solid(hex, BunbuArt.paint(look.bunbuSkin, hex: BunbuArt.hex(name)).fill)
        case .shiba:
            let paint = ShibaArt.paint(look.shibaSkin, hex: MausColors.hex(for: name) ?? MausColors.hex["orange"]!)
            return solid(hex, paint[.coat]?.solidColor, paint[.lid]?.solidColor)
        case .grump:
            let palette = GrumpArt.palette(skin: look.grumpSkin.rawValue, hex: GrumpArt.hex(name))
            return solid(hex, palette[.coat], palette[.lid])
        case .ogre:
            let paint = OgreArt.paint(look.ogreSkin, hex: OgreArt.hex(name))
            return solid(hex, paint.palette["skin"], paint.palette["lid"])
        case .frog:
            let paint = FrogArt.paint(look.frogSkin, hex: hex)
            return solid(hex, paint[.skin]?.solidColor, paint[.lid]?.solidColor)
        case .crab:
            let paint = CrabArt.paint(look.crabSkin, hex: CrabArt.hex(name))
            return solid(hex, paint.fill, paint.accent)
        case .trombi:
            // the paperclip is a thin wire: the note it holds is Trombi's body (`trombiPaint().paper[1]`)
            return Self.trombiNote[look.trombiSkin] ?? "#FDF1A6"
        case .owl:
            return solid(hex, OwlSkins.palette(owlSkin, base: OwlArt.palette(hex), hex: hex).plumage)
        }
    }

    static let trombiNote: [TrombiSkin: String] = [
        .classic: "#FDF1A6", .retro98: "#FDF1A6", .gold: "#F8ECD0", .chrome: "#E6ECF2",
        .neon: "#121738", .holo: "#F0EBFF", .molten: "#E7C690", .glitch: "#0B1611",
    ]
}

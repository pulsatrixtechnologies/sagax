// Skin families on the phone, the desktop's model (src/lib/skin-families.ts,
// JC 2026-10-19): the skins that only differed by a tint or by light and
// dark are the variants of one family, chosen with a swatch, and the mode
// is Light, Dark or Auto (follows the phone).
//
// Nothing stored moved: a ThemeSelection keeps its mode and skins. A family,
// a variant and a mode are read from it, and a choice writes it back:
// Auto is `.system` with the variant's light and dark skins, Light or Dark
// is `.fixed` with one of them. A pair saved before (Pulsatrix Light by day,
// Black at night, say) still wears the same skins until the person picks
// again in the new picker.
import Foundation

public enum SkinScheme: String, CaseIterable, Sendable {
    case light, dark
}

/// What the person picked: one scheme, or Auto (follow the phone).
public enum SkinModeChoice: String, CaseIterable, Identifiable, Sendable {
    case light, dark, auto
    public var id: String { rawValue }
}

public struct SkinVariant: Equatable, Hashable, Identifiable, Sendable {
    /// The desktop's variant id where the desktop has it (`blue`, `neutral`…).
    public let id: String
    /// English name; the app localizes it.
    public let name: String
    public let light: SkinID?
    public let dark: SkinID?

    public var schemes: [SkinScheme] {
        var out: [SkinScheme] = []
        if light != nil { out.append(.light) }
        if dark != nil { out.append(.dark) }
        return out
    }

    /// True when the variant has a light and a dark skin, so Auto can follow the phone.
    public var followsSystem: Bool { light != nil && dark != nil }

    /// The variant's skin for a scheme, or the one scheme it has.
    public func skin(_ scheme: SkinScheme) -> SkinID {
        // every variant declares at least one (SkinFamiliesTests)
        (scheme == .light ? light : dark) ?? light ?? dark ?? .black
    }
}

public enum SkinFamilyID: String, CaseIterable, Identifiable, Sendable {
    case phone, pulsatrix, studio, atelier, retro98
    public var id: String { rawValue }
}

public struct SkinFamily: Equatable, Identifiable, Sendable {
    public let id: SkinFamilyID
    public let name: String
    /// One line, English; the app localizes it.
    public let tagline: String
    public let variants: [SkinVariant]
    /// Hibou 98: listed only while worn (the computer's choice) or, for the
    /// computer, once unlocked; the phone never offers it for itself.
    public var secret: Bool { id == .retro98 }

    /// The phone's families: the phone's own Black and Dim are one, Hibou 98
    /// (secret, the computer's choice only) another. Meadow is not on the
    /// phone yet.
    public static let all: [SkinFamily] = [
        SkinFamily(
            id: .phone, name: "Black", tagline: "The phone's own look. Near-black, quiet greys.",
            variants: [
                SkinVariant(id: "black", name: "Black", light: nil, dark: .black),
                SkinVariant(id: "dim", name: "Dim", light: nil, dark: .dim),
            ]
        ),
        SkinFamily(
            id: .pulsatrix, name: "Pulsatrix", tagline: "Perspicax's own look: navy chrome, Geist and a soft glow from the top.",
            variants: [SkinVariant(id: "blue", name: "Blue", light: .pulsatrixLight, dark: .pulsatrix)]
        ),
        SkinFamily(
            id: .studio, name: "Studio", tagline: "Flat and neutral with monochrome buttons. In light, your own messages are inverted.",
            variants: [
                SkinVariant(id: "neutral", name: "Neutral", light: .daylight, dark: .midnight),
                SkinVariant(id: "slate", name: "Slate", light: .linen, dark: .graphite),
                SkinVariant(id: "plum", name: "Plum", light: nil, dark: .dusk),
            ]
        ),
        SkinFamily(
            id: .atelier, name: "Atelier", tagline: "Paper and brass: a tinted ground where cards get brighter as they rise.",
            variants: [
                SkinVariant(id: "brass", name: "Brass", light: .atelier, dark: .foundry),
                SkinVariant(id: "lagoon", name: "Lagoon", light: .lagoon, dark: nil),
            ]
        ),
        SkinFamily(
            id: .retro98, name: "Hibou 98", tagline: "Bevelled grey windows on a teal desktop, straight out of the late 90s.",
            variants: [SkinVariant(id: "classic", name: "Classic", light: .retro98, dark: nil)]
        ),
    ]

    /// The variants the picker offers for the scheme worn now: those with a
    /// skin in it (Plum and Black are dark only, Lagoon and Classic light
    /// only), so a dark phone never lists a light look and the reverse.
    /// `keeping` is the variant worn now, always listed.
    public func variants(for scheme: SkinScheme, keeping worn: SkinVariant? = nil) -> [SkinVariant] {
        variants.filter { $0 == worn || $0.schemes.contains(scheme) }
    }

    public static func of(_ id: SkinFamilyID) -> SkinFamily {
        all.first { $0.id == id } ?? all[0]
    }
}

/// Where a skin sits: its family, its variant and its scheme.
public struct SkinPlace: Equatable, Sendable {
    public let family: SkinFamily
    public let variant: SkinVariant
    public let scheme: SkinScheme

    /// Every skin has one place (Hibou 98 in its own secret family).
    public static func of(_ skin: SkinID) -> SkinPlace {
        for family in SkinFamily.all {
            for variant in family.variants {
                if variant.light == skin { return SkinPlace(family: family, variant: variant, scheme: .light) }
                if variant.dark == skin { return SkinPlace(family: family, variant: variant, scheme: .dark) }
            }
        }
        let pulsatrix = SkinFamily.of(.pulsatrix)
        return SkinPlace(family: pulsatrix, variant: pulsatrix.variants[0], scheme: .light)
    }
}

public extension ThemeSelection {
    /// The picker's state for a phone in `deviceDark` appearance: the place
    /// of the skin worn now, and Auto when the pair is that variant's own.
    func skinChoice(deviceDark: Bool) -> (place: SkinPlace, mode: SkinModeChoice) {
        let worn = skin(deviceDark: deviceDark)
        let place = SkinPlace.of(worn)
        if mode == .system, place.variant.followsSystem, lightSkin == place.variant.light, darkSkin == place.variant.dark {
            return (place, .auto)
        }
        return (place, place.scheme == .light ? .light : .dark)
    }

    /// This selection with a family's variant worn in a mode (local modes;
    /// the computer's own choice goes through the computer). A mode the
    /// variant lacks falls to the one it has.
    func choosing(_ variant: SkinVariant, mode choice: SkinModeChoice) -> ThemeSelection {
        var next = self
        if choice == .auto, variant.followsSystem, let light = variant.light, let dark = variant.dark {
            next.mode = .system
            next.lightSkin = light
            next.darkSkin = dark
        } else {
            let scheme: SkinScheme = choice == .light ? .light : choice == .dark ? .dark : (variant.schemes.first ?? .dark)
            next.mode = .fixed
            next.fixedSkin = variant.skin(scheme)
        }
        return next
    }

    /// The mode a newly picked variant keeps: Auto where it can follow the
    /// phone, else the scheme worn now when it has it, else the one it has.
    static func carry(_ choice: SkinModeChoice, to variant: SkinVariant, worn scheme: SkinScheme) -> SkinModeChoice {
        if choice == .auto { return variant.followsSystem ? .auto : (variant.schemes.first == .light ? .light : .dark) }
        let wanted: SkinScheme = choice == .light ? .light : .dark
        if variant.schemes.contains(wanted) { return choice }
        let fallback = variant.schemes.contains(scheme) ? scheme : (variant.schemes.first ?? .dark)
        return fallback == .light ? .light : .dark
    }
}

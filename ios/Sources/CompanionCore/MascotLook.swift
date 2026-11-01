// A bot's character and its look, as the desktop stores them with the bot:
// `shared/mascot-look.ts` (owl, shape, Trombi, Bunbu, Shiba, Frog or Crab, with each one's
// skin), `shared/mascot-skins.ts` (the owl's special editions), the colours
// of `shared/mascot-colors.ts` (the Clay palette included) and the picture
// framing of `shared/bot-avatar.ts`.
//
// Every id the desktop can store decodes here (the fixture test reads them
// from the desktop's own lists: MascotLookFixtureTests). Everything is
// cosmetic, so nothing here ever fails a decode: a value this build does not
// understand falls back to what the desktop falls back to (the owl for an
// unknown character, the default skin for an unknown skin, the centred
// picture), and the bot still loads. Where the phone has no art for a known
// look yet it draws the closest one and says so (`MascotSubstitution`).
import CoreGraphics
import Foundation

// MARK: - Colours

/// The Sagax bot colours, `MASCOT_COLOR_HEX` in `shared/mascot-colors.ts`.
public enum MausColors {
    /// The original twelve, in the picker's order.
    public static let names = ["green", "blue", "red", "orange", "purple", "cyan", "pink", "yellow", "teal", "coral", "white", "black"]

    public static let hex: [String: String] = [
        "green": "#009957",
        "blue": "#377FE6",
        "red": "#D94B52",
        "orange": "#E78531",
        "purple": "#8057C8",
        "cyan": "#0EA5C6",
        "pink": "#D84F8B",
        "yellow": "#D8A729",
        "teal": "#01A492",
        "coral": "#E5634E",
        "white": "#F4F4F4",
        "black": "#1D1E22",
        // The other palettes of `shared/mascot-colors.ts` (vivid, pastel, deep,
        // neon, neutral): a bot may wear any of them.
        "amber": "#F2A51A",
        "blush": "#F3A5B6",
        "peach": "#F6B897",
        "butter": "#F1D88B",
        "pistachio": "#C5DE98",
        "mint": "#98DDB9",
        "aqua": "#92DCD8",
        "sky": "#9CC8F2",
        "periwinkle": "#AEB4F1",
        "lavender": "#C3AAEE",
        "lilac": "#DDA9E3",
        "wine": "#7A1F3A",
        "rust": "#8E3A1E",
        "olive": "#5F5E1F",
        "forest": "#1E5B3B",
        "petrol": "#0F5560",
        "navy": "#1E3A70",
        "midnight": "#1B2448",
        "indigo": "#3A2F8F",
        "plum": "#5B2A6A",
        "berry": "#7B1F5E",
        "scarlet": "#FF2D55",
        "blaze": "#FF6A13",
        "citrus": "#FFE81F",
        "lime": "#B6FF2E",
        "volt": "#2BFF88",
        "laser": "#1FE5FF",
        "electric": "#2F6BFF",
        "ultraviolet": "#8A3BFF",
        "magenta": "#F13BEB",
        "hotpink": "#FF3FA4",
        "silver": "#BFC5CD",
        "grey": "#8E949E",
        "graphite": "#4B4F58",
        "sand": "#D9C4A1",
        "taupe": "#8C7B6E",
        "brown": "#8B5E3C",
        "bronze": "#A86F38",
        "copper": "#C2643A",
        "brass": "#C7A13D",
        // The Clay palette (the Shapes colours of 2026-10-08); brown, of the
        // neutral palette, is its twelfth swatch.
        "ink": "#0A0A0C",
        "tomato": "#E8483F",
        "tangerine": "#F08A24",
        "honey": "#F0B429",
        "jade": "#3ECF8E",
        "turquoise": "#2FBFA0",
        "cobalt": "#3B93F0",
        "violet": "#8B5CF6",
        "rose": "#E152B0",
        "ash": "#A3A3A3",
        "cream": "#F1EFE9",
    ]

    /// The Clay palette's swatch row (`paletteSwatches("clay")`).
    public static let clay = ["ink", "brown", "tomato", "tangerine", "honey", "jade", "turquoise", "cobalt", "violet", "rose", "ash", "cream"]

    /// The picker's colour rows on the phone: the original twelve, and the
    /// Clay palette where the desktop offers it (`colorGroupsFor` in
    /// floating-bots/editor-tabs.ts).
    public enum PickerRow: String, CaseIterable, Sendable {
        case classic, clay

        public var swatches: [String] { self == .clay ? MausColors.clay : MausColors.names }
    }

    /// Clay is offered for Shapes, Shiba, Grump, Ogre and Frog, or to a bot
    /// that already wears one of its colours (`colorGroupsFor`).
    public static func offersClay(_ character: MascotCharacter, color: String) -> Bool {
        switch character {
        case .shape, .shiba, .grump, .ogre, .frog, .crab: return true
        case .owl, .trombi, .bunbu: return clay.contains(color) && color != "brown"
        }
    }

    /// The row the picker opens on: the current colour's (`colorTabFor`).
    public static func pickerRow(for color: String, character: MascotCharacter) -> PickerRow {
        offersClay(character, color: color) && clay.contains(color) && !names.contains(color) ? .clay : .classic
    }

    /// `MAUS_INK`: black has no light of its own on a dark surface, so as text
    /// or a tint it reads as a cool slate.
    public static let ink: [String: String] = hex.merging(["black": "#8B93A3"]) { _, new in new }

    /// The hex for a colour name, or the value itself when it already is a
    /// `#RRGGBB` hex, or nil.
    public static func hex(for color: String) -> String? {
        if let named = hex[color] { return named }
        return isHex(color) ? color.uppercased() : nil
    }

    /// The owl's reading of a colour (`MAUS_COLORS[color] ?? color`): any hex
    /// passes through; anything else is green, the default bot.
    public static func owlHex(_ color: String) -> String {
        hex(for: color) ?? hex["green"]!
    }

    static func isHex(_ value: String) -> Bool {
        let chars = Array(value.utf8)
        guard chars.count == 7, chars[0] == UInt8(ascii: "#") else { return false }
        return chars.dropFirst().allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 65 && $0 <= 70) || ($0 >= 97 && $0 <= 102) }
    }
}

/// sRGB in 0...255, the space the desktop's colour maths runs in.
public struct RGB: Equatable, Sendable {
    public var r: Double
    public var g: Double
    public var b: Double

    public init(r: Double, g: Double, b: Double) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// `#RGB` or `#RRGGBB`; anything else is black, as `hexToRgb` reads it.
    public init(hex: String) {
        var h = hex.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "#", with: "")
        if h.count == 3 { h = h.map { "\($0)\($0)" }.joined() }
        guard let n = UInt32(h, radix: 16), h.count == 6 else {
            self.init(r: 0, g: 0, b: 0)
            return
        }
        self.init(r: Double((n >> 16) & 255), g: Double((n >> 8) & 255), b: Double(n & 255))
    }

    /// `#RRGGBB`, rounded and clamped, upper case.
    public var hex: String {
        func c(_ v: Double) -> String {
            let byte = Int(min(255, max(0, v.rounded())))
            return String(format: "%02X", byte)
        }
        return "#\(c(r))\(c(g))\(c(b))"
    }
}

// MARK: - Character

public enum MascotCharacter: String, CaseIterable, Codable, Sendable {
    case owl, crab, shape, trombi, bunbu, shiba, grump, ogre, frog
}

public enum MascotStyle: String, CaseIterable, Codable, Sendable {
    case flat = "2d"
    case threeD = "3d"
}

/// The shapes, in the picker's order (`MASCOT_SHAPES`, 2026-10-28): the
/// bloub network's bodies and our pumpkin. The first eight keep the ids the
/// desktop and older builds store (bean is the pebble, pick the triangle), so
/// a look made on either side reads the same on the other.
public enum MascotShape: String, CaseIterable, Codable, Sendable {
    case circle
    case blob = "bean"
    case squircle, pill
    case triangle = "pick"
    case hexagon, cloud, drop
    case pumpkin, egg, gem, wedge, diamond, star, clover, flower, blossom
    case cat, ghost, jellyfish, axolotl, puff, pin, marker, sprite
    case flask, tube, potion, chomp, nibble, shield, bubble
    // Object silhouettes (shape-engine v2, 2026-11-01): portable JSON defs on desktop.
    case pad, cup, bulb, say, sprout, tin, tome, ship

    /// `LEGACY_SHAPES`: ids from earlier sets (and the phone's own old ids)
    /// land on the nearest shape.
    public static func stored(_ raw: String) -> MascotShape? {
        if let shape = MascotShape(rawValue: raw) { return shape }
        switch raw {
        case "blob", "pebble": return .blob
        case "triangle": return .triangle
        case "capsule": return .pill
        case "droplet": return .drop
        case "sparkle": return .squircle
        case "house": return .hexagon
        default: return nil
        }
    }

    /// The color a pumpkin takes when it is picked (`PUMPKIN_COLOR`), where its
    /// skin paints the bot's color (`SHAPE_SKINS_IN_BOT_COLOR`); nil otherwise.
    public static func pickedColor(_ shape: MascotShape, from current: MascotShape, skin: ShapeSkin) -> String? {
        guard shape == .pumpkin, current != .pumpkin, [.plain, .pastel, .glossy, .outline, .crystal].contains(skin) else { return nil }
        return "orange"
    }

    public init(from decoder: Decoder) throws {
        let raw = try decoder.singleValueContainer().decode(String.self)
        guard let shape = Self.stored(raw) else {
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "unknown shape \(raw)"))
        }
        self = shape
    }
}

/// Skins for the shapes (`SHAPE_SKINS`); every one renders on every shape.
/// Plain is the clay finish. The first four are the everyday finishes, the
/// rest premium editions.
public enum ShapeSkin: String, CaseIterable, Codable, Sendable {
    case plain, pastel, glossy, night, outline, gold, neon, chrome, crystal, circuit, holo, molten, galaxy

    /// `LEGACY_SHAPE_SKINS`.
    static let legacy: [String: ShapeSkin] = [
        "ink": .outline, "royal": .gold, "metal": .chrome, "liquid-metal": .chrome, "glass": .crystal,
        "cyber": .circuit, "iridescent": .holo, "holographic": .holo, "lava": .molten, "nebula": .galaxy,
    ]

    /// A stored id, current or legacy; nil for one this build does not know.
    public static func stored(_ raw: String) -> ShapeSkin? { ShapeSkin(rawValue: raw) ?? legacy[raw] }

}

/// Skins for Trombi (`TROMBI_SKINS`).
public enum TrombiSkin: String, CaseIterable, Codable, Sendable {
    case classic, retro98, gold, neon, chrome, glitch, holo, molten

    /// `LEGACY_TROMBI_SKINS`.
    static let legacy: [String: TrombiSkin] = [
        "retro": .retro98, "win98": .retro98, "royal": .gold, "metal": .chrome, "cyber": .glitch,
        "iridescent": .holo, "holographic": .holo, "lava": .molten,
    ]

    public static func stored(_ raw: String) -> TrombiSkin? { TrombiSkin(rawValue: raw) ?? legacy[raw] }

}

/// Skins for Bunbu (`BUNBU_SKINS`), by rarity.
public enum BunbuSkin: String, CaseIterable, Codable, Sendable {
    case plain, pastel, night, plush, velvet, gold, neon, chrome, crystal, holo, galaxy, molten

    /// `LEGACY_BUNBU_SKINS`.
    static let legacy: [String: BunbuSkin] = [
        "fur": .plush, "fuzzy": .plush, "royal": .gold, "metal": .chrome, "glass": .crystal,
        "iridescent": .holo, "holographic": .holo, "nebula": .galaxy, "lava": .molten,
    ]

    public static func stored(_ raw: String) -> BunbuSkin? { BunbuSkin(rawValue: raw) ?? legacy[raw] }

}

/// Skins for Shiba (`SHIBA_SKINS`): the bot's colour (plain), the breed's
/// coats, then the premium set every Mastery character wears.
public enum ShibaSkin: String, CaseIterable, Codable, Sendable {
    case plain, cream, blacktan, red, sesame, white, retro98, gold, neon, chrome, glitch, holo, molten

    /// `LEGACY_SHIBA_SKINS`.
    static let legacy: [String: ShibaSkin] = [
        "black-and-tan": .blacktan, "black_tan": .blacktan, "kuro": .blacktan, "aka": .red, "goma": .sesame,
        "shiro": .white, "retro": .retro98, "win98": .retro98, "royal": .gold, "metal": .chrome, "cyber": .glitch,
        "iridescent": .holo, "holographic": .holo, "lava": .molten,
    ]

    public static func stored(_ raw: String) -> ShibaSkin? { ShibaSkin(rawValue: raw) ?? legacy[raw] }
}

/// Skins for Grump (`GRUMP_SKINS`), by rarity: the cat coats, then the premium set.
public enum GrumpSkin: String, CaseIterable, Codable, Sendable {
    case plain, tuxedo, calico, tabby, siamese, void, retro98, gold, neon, chrome, glitch, holo, molten

    /// `LEGACY_GRUMP_SKINS`.
    static let legacy: [String: GrumpSkin] = [
        "tux": .tuxedo, "black-and-white": .tuxedo, "tortie": .calico, "tortoiseshell": .calico, "tiger": .tabby,
        "mackerel": .tabby, "colorpoint": .siamese, "colourpoint": .siamese, "seal-point": .siamese, "black": .void,
        "shadow": .void, "retro": .retro98, "win98": .retro98, "royal": .gold, "metal": .chrome, "cyber": .glitch,
        "iridescent": .holo, "holographic": .holo, "lava": .molten,
    ]

    public static func stored(_ raw: String) -> GrumpSkin? { GrumpSkin(rawValue: raw) ?? legacy[raw] }

}

/// Skins for Ogre (`OGRE_SKINS`), by rarity: the bot's colour, the ogre's
/// own hides, Lava and Armor, then the premium editions.
public enum OgreSkin: String, CaseIterable, Codable, Sendable {
    case plain, swamp, moss, stone, lava, armor, retro98, gold, neon, chrome, glitch, holo, molten

    /// `LEGACY_OGRE_SKINS`.
    static let legacy: [String: OgreSkin] = [
        "bog": .swamp, "marsh": .swamp, "forest": .moss, "granite": .stone, "rock": .stone, "grey": .stone, "gray": .stone,
        "magma": .lava, "basalt": .lava, "iron": .armor, "steel": .armor, "plate": .armor, "knight": .armor,
        "retro": .retro98, "win98": .retro98, "royal": .gold, "metal": .chrome, "cyber": .glitch, "iridescent": .holo, "holographic": .holo,
    ]

    public static func stored(_ raw: String) -> OgreSkin? { OgreSkin(rawValue: raw) ?? legacy[raw] }

}

/// Skins for Frog (`FROG_SKINS`): the bot's colour (plain), loud real frogs,
/// then the premium set every Mastery character wears.
public enum FrogSkin: String, CaseIterable, Codable, Sendable {
    case plain, leaf, tree, poison, bullfrog, ghost, retro98, gold, neon, chrome, glitch, holo, molten

    /// `LEGACY_FROG_SKINS`.
    static let legacy: [String: FrogSkin] = [
        "green": .leaf, "tree-frog": .tree, "treefrog": .tree, "red-eyed": .tree, "dart": .poison, "poison-dart": .poison,
        "bull": .bullfrog, "glass": .ghost, "glass-frog": .ghost, "golden": .gold, "retro": .retro98, "win98": .retro98,
        "royal": .gold, "metal": .chrome, "cyber": .glitch, "iridescent": .holo, "holographic": .holo, "lava": .molten,
    ]

    public static func stored(_ raw: String) -> FrogSkin? { FrogSkin(rawValue: raw) ?? legacy[raw] }
}

/// Skins for Crab (`CRAB_SKINS`): the bot's colour tinted into the coral
/// (plain), then the crab's own fills (common), then the premium set Shapes
/// wears (gold, pearl; neon, chrome, crystal, circuit; holo, molten, galaxy).
public enum CrabSkin: String, CaseIterable, Codable, Sendable {
    case plain, coral, sand, ink, mint, gold, pearl, neon, chrome, crystal, circuit, holo, molten, galaxy

    /// `LEGACY_CRAB_SKINS`.
    static let legacy: [String: CrabSkin] = [
        "classic": .coral, "orange": .coral, "cream": .sand, "black": .ink, "green": .mint,
        "royal": .gold, "treasure": .gold, "nacre": .pearl, "opal": .pearl, "frost": .pearl,
        "metal": .chrome, "liquid-metal": .chrome, "glass": .crystal, "cyber": .circuit,
        "iridescent": .holo, "holographic": .holo, "lava": .molten, "nebula": .galaxy,
    ]

    public static func stored(_ raw: String) -> CrabSkin? { CrabSkin(rawValue: raw) ?? legacy[raw] }
}

/// `mascotLook`: which character stands for the bot, and that character's
/// own look, read exactly as `botMascotLook` reads it. The desktop's schema
/// is strict: an unknown character, an unknown top-level key, or a
/// malformed style or shape throws the whole look away (the owl). A skin
/// is never worth the character: an unknown skin value, a skin of a newer
/// character, or a `skins` that is not an object is dropped and the
/// character keeps its default skin.
public struct MascotLook: Codable, Hashable, Sendable {
    public struct Skins: Codable, Hashable, Sendable {
        public var shape: ShapeSkin?
        public var trombi: TrombiSkin?
        public var bunbu: BunbuSkin?
        public var shiba: ShibaSkin?
        public var grump: GrumpSkin?
        public var ogre: OgreSkin?
        public var frog: FrogSkin?
        public var crab: CrabSkin?

        public init(shape: ShapeSkin? = nil, trombi: TrombiSkin? = nil, bunbu: BunbuSkin? = nil, shiba: ShibaSkin? = nil, grump: GrumpSkin? = nil, ogre: OgreSkin? = nil, frog: FrogSkin? = nil, crab: CrabSkin? = nil) {
            self.shape = shape
            self.trombi = trombi
            self.bunbu = bunbu
            self.shiba = shiba
            self.grump = grump
            self.ogre = ogre
            self.frog = frog
            self.crab = crab
        }

        var isEmpty: Bool { shape == nil && trombi == nil && bunbu == nil && shiba == nil && grump == nil && ogre == nil && frog == nil && crab == nil }
    }

    public var character: MascotCharacter
    public var style: MascotStyle?
    public var shape: MascotShape?
    public var skins: Skins?
    /// Portable Shape geometry (`shared/shape-avatar-def.ts`). Optional; colour stays separate.
    public var avatarDef: ShapeAvatarDef?

    /// The owl, what every bot wore before characters existed.
    public static let owl = MascotLook(character: .owl)

    public init(character: MascotCharacter, style: MascotStyle? = nil, shape: MascotShape? = nil, skins: Skins? = nil, avatarDef: ShapeAvatarDef? = nil) {
        self.character = character
        self.style = style
        self.shape = shape
        self.skins = skins
        self.avatarDef = avatarDef
    }

    private struct Key: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(_ string: String) { stringValue = string }
        init?(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }

    public init(from decoder: Decoder) throws {
        self = (try? Self.strict(decoder)) ?? .owl
    }

    private struct Malformed: Error {}

    private static func strict(_ decoder: Decoder) throws -> MascotLook {
        let container = try decoder.container(keyedBy: Key.self)
        let allowed: Set<String> = ["character", "style", "shape", "skins", "avatarDef"]
        guard container.allKeys.allSatisfy({ allowed.contains($0.stringValue) }) else { throw Malformed() }
        func optional<T: Decodable>(_ type: T.Type, _ key: String) throws -> T? {
            let k = Key(key)
            guard container.contains(k) else { return nil }
            if try container.decodeNil(forKey: k) { throw Malformed() }
            return try container.decode(T.self, forKey: k)
        }
        guard let character = try optional(MascotCharacter.self, "character") else { throw Malformed() }
        let style = try optional(MascotStyle.self, "style")
        let shape = try optional(MascotShape.self, "shape")
        var skins: Skins?
        if let nested = try? container.nestedContainer(keyedBy: Key.self, forKey: Key("skins")) {
            func raw(_ key: String) -> String? { try? nested.decode(String.self, forKey: Key(key)) }
            let read = Skins(
                shape: raw("shape").flatMap(ShapeSkin.stored),
                trombi: raw("trombi").flatMap(TrombiSkin.stored),
                bunbu: raw("bunbu").flatMap(BunbuSkin.stored),
                shiba: raw("shiba").flatMap(ShibaSkin.stored),
                grump: raw("grump").flatMap(GrumpSkin.stored),
                ogre: raw("ogre").flatMap(OgreSkin.stored),
                frog: raw("frog").flatMap(FrogSkin.stored),
                crab: raw("crab").flatMap(CrabSkin.stored)
            )
            skins = read.isEmpty ? nil : read
        }
        // Invalid avatarDef is dropped; the look still loads (cosmetic only).
        var avatarDef: ShapeAvatarDef?
        if container.contains(Key("avatarDef")), !(try container.decodeNil(forKey: Key("avatarDef"))) {
            if let raw = try? container.decode(ShapeAvatarDef.self, forKey: Key("avatarDef")),
               case let .ok(valid) = ShapeAvatarValidator.check(raw) {
                avatarDef = valid
            }
        }
        return MascotLook(character: character, style: style, shape: shape, skins: skins, avatarDef: avatarDef)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Key.self)
        try container.encode(character, forKey: Key("character"))
        try container.encodeIfPresent(style, forKey: Key("style"))
        try container.encodeIfPresent(shape, forKey: Key("shape"))
        try container.encodeIfPresent(avatarDef, forKey: Key("avatarDef"))
        if let skins, !skins.isEmpty {
            var nested = container.nestedContainer(keyedBy: Key.self, forKey: Key("skins"))
            try nested.encodeIfPresent(skins.shape, forKey: Key("shape"))
            try nested.encodeIfPresent(skins.trombi, forKey: Key("trombi"))
            try nested.encodeIfPresent(skins.bunbu, forKey: Key("bunbu"))
            try nested.encodeIfPresent(skins.shiba, forKey: Key("shiba"))
            try nested.encodeIfPresent(skins.grump, forKey: Key("grump"))
            try nested.encodeIfPresent(skins.ogre, forKey: Key("ogre"))
            try nested.encodeIfPresent(skins.frog, forKey: Key("frog"))
            try nested.encodeIfPresent(skins.crab, forKey: Key("crab"))
        }
    }

    /// `completeMascotLook`: every choice filled in.
    public var complete: CompleteMascotLook {
        CompleteMascotLook(
            character: character,
            style: style ?? .flat,
            shape: shape ?? .circle,
            shapeSkin: skins?.shape ?? .plain,
            trombiSkin: skins?.trombi ?? .classic,
            bunbuSkin: skins?.bunbu ?? .plain,
            shibaSkin: skins?.shiba ?? .plain,
            grumpSkin: skins?.grump ?? .plain,
            ogreSkin: skins?.ogre ?? .plain,
            frogSkin: skins?.frog ?? .plain,
            crabSkin: skins?.crab ?? .plain,
            avatarDef: avatarDef
        )
    }
}

/// A look with every choice made, what the renderers draw from.
public struct CompleteMascotLook: Hashable, Sendable {
    public var character: MascotCharacter
    public var style: MascotStyle
    public var shape: MascotShape
    public var shapeSkin: ShapeSkin
    public var trombiSkin: TrombiSkin
    public var bunbuSkin: BunbuSkin
    public var shibaSkin: ShibaSkin
    public var grumpSkin: GrumpSkin
    public var ogreSkin: OgreSkin
    public var frogSkin: FrogSkin
    public var crabSkin: CrabSkin
    public var avatarDef: ShapeAvatarDef?

    public init(character: MascotCharacter, style: MascotStyle = .flat, shape: MascotShape = .circle, shapeSkin: ShapeSkin = .plain, trombiSkin: TrombiSkin = .classic, bunbuSkin: BunbuSkin = .plain, shibaSkin: ShibaSkin = .plain, grumpSkin: GrumpSkin = .plain, ogreSkin: OgreSkin = .plain, frogSkin: FrogSkin = .plain, crabSkin: CrabSkin = .plain, avatarDef: ShapeAvatarDef? = nil) {
        self.character = character
        self.style = style
        self.shape = shape
        self.shapeSkin = shapeSkin
        self.trombiSkin = trombiSkin
        self.bunbuSkin = bunbuSkin
        self.shibaSkin = shibaSkin
        self.grumpSkin = grumpSkin
        self.ogreSkin = ogreSkin
        self.frogSkin = frogSkin
        self.crabSkin = crabSkin
        self.avatarDef = avatarDef
    }

    /// Back to a stored look, every choice explicit (what the editor saves,
    /// as the desktop's editor does: every character's skin).
    public var stored: MascotLook {
        MascotLook(character: character, style: style, shape: shape, skins: .init(shape: shapeSkin, trombi: trombiSkin, bunbu: bunbuSkin, shiba: shibaSkin, grump: grumpSkin, ogre: ogreSkin, frog: frogSkin, crab: crabSkin), avatarDef: avatarDef)
    }

    /// The colour a character wears where the bot gives none it can use:
    /// Bunbu's mint (`BUNBU_DEFAULT_COLOR`), Shiba's orange
    /// (`SHIBA_DEFAULT_COLOR`), Grump's brown, Crab's orange, green for the others
    /// (Ogre's `OGRE_DEFAULT_COLOR` and Frog's `FROG_DEFAULT_COLOR` too).
    public var fallbackColor: String {
        switch character {
        case .bunbu: return "mint"
        case .shiba, .crab: return "orange"
        case .grump: return "brown"
        default: return "green"
        }
    }
}

// MARK: - Owl skins

/// `mascotSkin`: the owl's special editions (`MASCOT_SKIN_IDS`), in the
/// picker's order. Legacy names read as the current id (`LEGACY_OWL_SKINS`);
/// missing or junk values (a number, an object, the wrong case) wear `none`,
/// as `botMascotSkin` reads them.
public enum MascotSkin: String, CaseIterable, Codable, Sendable {
    case none, snowy, barn, carbon, gold, frost, neon, lightning, chrome, inferno, holo, galaxy, spirit

    /// `LEGACY_OWL_SKINS`.
    static let legacy: [String: MascotSkin] = [
        "classic": .none, "plain": .none, "snow": .snowy, "royal": .gold, "ice": .frost,
        "electric": .lightning, "metal": .chrome, "liquid-metal": .chrome, "molten": .inferno,
        "lava": .inferno, "fire": .inferno, "holographic": .holo, "iridescent": .holo,
        "nebula": .galaxy, "ghost": .spirit, "ethereal": .spirit,
    ]

    public init(from decoder: Decoder) throws {
        let raw = try? decoder.singleValueContainer().decode(String.self)
        self = Self.resolve(raw)
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(rawValue)
    }

    /// `botMascotSkin`.
    public static func resolve(_ raw: String?) -> MascotSkin {
        guard let raw else { return .none }
        return MascotSkin(rawValue: raw) ?? legacy[raw] ?? .none
    }

}

// MARK: - Picture framing

/// `shared/bot-avatar.ts`: how an uploaded picture sits in its crop.
public enum AvatarFraming {
    public static let zoomMin: Double = 1
    public static let zoomMax: Double = 3
    public static let focusCenter: Double = 0.5

    /// `clampAvatarZoom`: 1...3, to the hundredth; missing or non-finite is 1.
    public static func clampZoom(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return zoomMin }
        return (min(zoomMax, max(zoomMin, value)) * 100).rounded() / 100
    }

    /// `clampAvatarFocus`: 0...1, to the thousandth; missing or non-finite is the centre.
    public static func clampFocus(_ value: Double?) -> Double {
        guard let value, value.isFinite else { return focusCenter }
        return (min(1, max(0, value)) * 1000).rounded() / 1000
    }

    /// Where the picture lands in a square box of side `box`: the desktop's
    /// `object-fit: cover` with `object-position: focus`, then
    /// `scale(zoom)` about that same focus point. The box clips the result.
    public static func imageRect(imageSize: CGSize, box: CGFloat, zoom: Double?, focusX: Double?, focusY: Double?) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, box > 0 else {
            return CGRect(x: 0, y: 0, width: box, height: box)
        }
        let z = CGFloat(clampZoom(zoom))
        let fx = CGFloat(clampFocus(focusX)), fy = CGFloat(clampFocus(focusY))
        let cover = max(box / imageSize.width, box / imageSize.height)
        let w = imageSize.width * cover, h = imageSize.height * cover
        let x = (box - w) * fx, y = (box - h) * fy
        let ox = fx * box, oy = fy * box
        return CGRect(x: ox + (x - ox) * z, y: oy + (y - oy) * z, width: w * z, height: h * z)
    }

    /// The crop's corner radius for a box: a circle, 22 %, or square corners.
    public static func cornerRadius(_ crop: AvatarCrop, box: CGFloat) -> CGFloat {
        switch crop {
        case .circle: return box / 2
        case .rounded: return box * 0.22
        case .square, .mascot: return 0
        }
    }
}

// MARK: - States for the characters

/// The app's mascot states (`MausState`, the desktop's 39 engine states and
/// the ten legacy names older bots still carry), as the characters read them.
public enum MascotStates {
    /// The desktop's legacy face names (`LEGACY_STATES` in `src/lib/mascot.ts`).
    public static let legacy: [String: String] = [
        "deadpan": "idle", "friendly": "happy", "focused": "working", "thinking": "thinking",
        "excited": "excited", "sleepy": "drowsy", "surprised": "surprised", "skeptical": "suspicious",
        "worried": "scared", "mischievous": "playful",
    ]

    /// All 39 current states.
    public static let all: Set<String> = [
        "sleeping", "waking", "idle", "listening", "thinking", "searching", "working",
        "excited", "surprised", "suspicious", "angry", "drowsy", "happy", "curious", "confused",
        "bored", "proud", "shy", "sad", "laughing", "scared", "playful", "celebrate",
        "orbit", "radar", "progress",
        "spawning", "humming", "loading", "dictating", "writing", "sending", "receiving",
        "uploading", "notifying", "alerting", "dragging", "bouncing", "powering-down",
    ]

    /// `normalizeState`: a current state, a legacy name, or nil.
    public static func normalize(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        if all.contains(value) { return value }
        return legacy[value]
    }
}

/// `ShapeMood` in `ShapeMascot.tsx`.
public enum ShapeMood: String, CaseIterable, Sendable {
    case idle, thinking, working, streaming, happy, blocked, sleeping

    /// `shapeMoodFor` in `Avatar.tsx`.
    public static func forState(_ state: String?) -> ShapeMood {
        guard let state else { return .idle }
        if ["thinking", "searching", "loading", "curious", "confused"].contains(state) { return .thinking }
        if state == "alerting" { return .blocked }
        if ["writing", "sending", "receiving", "dictating"].contains(state) { return .streaming }
        if ["working", "progress", "orbit", "radar", "uploading", "humming"].contains(state) { return .working }
        if ["happy", "celebrate", "proud", "laughing", "excited", "playful", "notifying"].contains(state) { return .happy }
        if ["sleeping", "drowsy", "powering-down"].contains(state) { return .sleeping }
        return .idle
    }

    /// The five moods Bunbu, Trombi and the other characters keep: the
    /// shapes' newer ones fold back onto them (`bunbuMoodFor`, `trombiPoseFor`).
    public var folded: ShapeMood {
        switch self {
        case .streaming: return .working
        case .blocked: return .idle
        default: return self
        }
    }
}

/// Trombi's poses (`TrombiPose` in `trombi-art.ts`).
public enum TrombiPose: String, CaseIterable, Sendable {
    case idle, speak, think, bored, sleep, celebrate, send

    /// `trombiPoseFor` in `Avatar.tsx`.
    public static func forState(_ state: String?) -> TrombiPose {
        if state == "listening" || state == "notifying" { return .speak }
        let mood = ShapeMood.forState(state).folded
        if mood == .thinking || mood == .working { return .think }
        if mood == .happy { return .celebrate }
        if mood == .sleeping { return .sleep }
        return .idle
    }
}

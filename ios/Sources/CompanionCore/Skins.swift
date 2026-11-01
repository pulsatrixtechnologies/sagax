// The phone's skins: every desktop skin (`src/lib/skins.ts`, the
// `[data-skin=…]` blocks of `src/styles.css`) plus the phone's own two
// references, Black (the visual-parity default) and Dim.
//
// This file holds only data and arithmetic: the desktop's tokens as hex, the
// mapping from those tokens to the phone's tokens, the choice of skin for a
// device appearance, and the WCAG contrast maths the tests run over every
// skin. The app turns a `SkinPalette` into SwiftUI colours (App/Theme.swift);
// the widgets and the share extension do the same from the app group
// (AppShared/SharedTheme.swift).
import Foundation

// MARK: - Colour

/// An sRGB colour: a 24-bit hex and an alpha.
public struct SkinColor: Equatable, Hashable, Sendable {
    public var hex: UInt32
    public var alpha: Double

    public init(_ hex: UInt32, alpha: Double = 1) {
        self.hex = hex
        self.alpha = alpha
    }

    public var red: Double { Double((hex >> 16) & 0xFF) / 255 }
    public var green: Double { Double((hex >> 8) & 0xFF) / 255 }
    public var blue: Double { Double(hex & 0xFF) / 255 }

    public func opacity(_ value: Double) -> SkinColor { SkinColor(hex, alpha: alpha * value) }

    /// This colour drawn over an opaque `ground`.
    public func over(_ ground: SkinColor) -> SkinColor {
        let a = alpha
        func mix(_ top: Double, _ bottom: Double) -> UInt32 {
            UInt32((top * a + bottom * (1 - a)) * 255 + 0.5)
        }
        return SkinColor(mix(red, ground.red) << 16 | mix(green, ground.green) << 8 | mix(blue, ground.blue))
    }

    /// WCAG 2.x relative luminance (alpha ignored: composite first).
    public var luminance: Double {
        func channel(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue)
    }

    /// WCAG contrast ratio of `self` drawn on `ground` (alpha composited).
    public func contrast(on ground: SkinColor) -> Double {
        let base = ground.alpha < 1 ? ground.over(SkinColor(0x000000)) : ground
        let a = over(base).luminance
        let b = base.luminance
        return (max(a, b) + 0.05) / (min(a, b) + 0.05)
    }

    /// This colour, deepened (on a light ground) or lifted (on a dark one)
    /// just enough to read as text on `ground`: a bot colour such as cyan or
    /// yellow keeps its hue on a light skin and still clears `minimum`.
    public func readable(on ground: SkinColor, minimum: Double = 4.5) -> SkinColor {
        guard contrast(on: ground) < minimum else { return self }
        let target = ground.luminance > 0.4 ? SkinColor(0x000000) : SkinColor(0xFFFFFF)
        var step = 0.05
        while step <= 1 {
            let mixed = target.opacity(step).over(SkinColor(hex))
            if mixed.contrast(on: ground) >= minimum { return mixed }
            step += 0.05
        }
        return target
    }

    /// `#RRGGBB` or `#RRGGBBAA`.
    public init?(css: String) {
        var text = css.trimmingCharacters(in: .whitespaces)
        guard text.hasPrefix("#") else { return nil }
        text.removeFirst()
        guard text.count == 6 || text.count == 8, let value = UInt32(text, radix: 16) else { return nil }
        if text.count == 6 { self.init(value) } else { self.init(value >> 8, alpha: Double(value & 0xFF) / 255) }
    }
}

// MARK: - Skins

/// Every skin the phone can wear. The desktop ids are the desktop's own
/// (`SKIN_IDS`), so a choice read from the computer maps one to one.
public enum SkinID: String, CaseIterable, Identifiable, Sendable, Codable {
    case black, dim
    case pulsatrix
    case pulsatrixLight = "pulsatrix-light"
    case midnight, atelier, foundry, lagoon, graphite, linen, dusk, daylight, retro98

    public var id: String { rawValue }

    public var name: String {
        switch self {
        case .black: "Black"
        case .dim: "Dim"
        case .pulsatrix: "Pulsatrix"
        case .pulsatrixLight: "Pulsatrix Light"
        case .midnight: "Midnight"
        case .atelier: "Atelier"
        case .foundry: "Foundry"
        case .lagoon: "Lagoon"
        case .graphite: "Graphite"
        case .linen: "Linen"
        case .dusk: "Dusk"
        case .daylight: "Daylight"
        case .retro98: "Hibou 98"
        }
    }

    /// One line under the name in the picker (the desktop's taglines, and two
    /// for the phone's own skins). English: the app localizes it.
    public var tagline: String {
        switch self {
        case .black: "The phone's own look. Near-black, quiet greys."
        case .dim: "The phone's own look, lifted to a softer grey."
        case .pulsatrix: "Pulsatrix blue. Deep navy with a soft glow from the top."
        case .pulsatrixLight: "Pulsatrix blue on a bright ice ground, with the same soft glow from the top."
        case .midnight: "The original. Cool and dark."
        case .atelier: "Daylight on paper, warm and quiet."
        case .foundry: "Night shift. Dark, warm, lit in brass."
        case .lagoon: "Cool daylight. Porcelain and deep teal."
        case .graphite: "Quiet charcoal and softened steel blue."
        case .linen: "Clean daylight with a restrained navy accent."
        case .dusk: "Muted plum after dark, calm and low-key."
        case .daylight: "Midnight in reverse. Near-white, ink-black bubbles."
        case .retro98: "Bevelled grey windows on a teal desktop, straight out of the late 90s."
        }
    }

    /// A secret skin: listed only once this device (or the computer) unlocked it.
    public var secret: Bool { self == .retro98 }

    /// True for the phone's own references (not on the desktop).
    public var phoneOnly: Bool { self == .black || self == .dim }

    public var isDark: Bool { palette.isDark }

    public var palette: SkinPalette { SkinPalette.of(self) }

    /// The skins a picker lists on iOS: the public ones. Hibou 98 is a
    /// desktop-only easter egg, never listed here, even unlocked or worn.
    /// The legacy skins (Graphite, Linen, Dusk, Lagoon) are worn as a base
    /// skin and a colour now (SkinVariants.legacy), so they are not listed.
    public static func visible(retroUnlocked: Bool, active: SkinID? = nil) -> [SkinID] {
        allCases.filter { !$0.secret && !$0.isLegacy }
    }

    /// A skin no desktop variant lists any more (LEGACY_SKINS).
    public var isLegacy: Bool { SkinVariants.legacy[rawValue] != nil }
}

/// How the interface font is chosen (`omb-font`, `src/lib/fonts.ts`). The
/// phone bundles no Inter, Poppins or Geist: those read as the system face.
public enum SkinFontChoice: String, CaseIterable, Identifiable, Sendable {
    case skin, system, inter, poppins, serif
    public var id: String { rawValue }
}

/// The face a palette draws its text with.
public enum SkinTypeface: String, Sendable {
    /// SF Pro.
    case system
    /// New York.
    case serif
    /// The Hibou 98 fallback for MS Sans Serif / Tahoma (Verdana on iOS).
    case retro

    public static func resolve(skin: SkinID, font: SkinFontChoice) -> SkinTypeface {
        switch font {
        case .serif: return .serif
        case .system, .inter, .poppins: return skin == .retro98 ? .retro : .system
        case .skin: return skin.palette.typeface
        }
    }
}

// MARK: - The desktop's tokens

/// One `[data-skin]` block of `src/styles.css`, the tokens the phone uses.
public struct DesktopSkinTokens: Sendable {
    public var app, panel, raised, raisedHover, card, menu, inset, control, hairline: SkinColor
    public var ink, inkSecondary, inkTertiary: SkinColor
    public var accent, accentBorder, accentText, focus, accentInk: SkinColor
    public var bubbleUser, bubbleUserInk, bubbleBot: SkinColor
    public var success, danger, dangerInk, successInk, warning: SkinColor
    public var composer: SkinColor
    /// `--color-unread` (#182): the skin's accent in a chromatic skin,
    /// Pulsatrix blue in the grey ones, so the unread dot is never white.
    public var unread: SkinColor
    public var dark: Bool
}

// MARK: - The phone's tokens

/// Every colour the phone draws with, for one skin. `App/Theme.swift` reads
/// these through `Theme.*`; the names match the parity tokens there.
public struct SkinPalette: Equatable, Sendable {
    public var id: SkinID
    public var isDark: Bool
    public var typeface: SkinTypeface = .system
    /// Square corners and bevels (Hibou 98).
    public var bevelled = false
    /// The variant laid over the base skin (SkinVariants.swift); nil for the family's own look.
    public var tint: SkinTint? = nil
    public var depth: SkinDepth = .accent
    /// The texture over the ground of the chat and the list (none under Hibou 98).
    public var texture: SkinTexture = .none
    /// The accent's gradient stops where it is filled (duo-tones, moods); empty for a flat accent.
    public var accentGradient: [SkinColor] = []
    /// The open bot's colour as the accent (BotAccent.swift), nil for the skin's own.
    public var botAccent: BotAccentColors? = nil

    // surfaces
    public var bg, card, cardRaised, hairline, tabHairline: SkinColor
    public var glassFill, glassRimLight, glassRimDark: SkinColor
    public var chip, chipText, pill, pillBorder, menuGlass: SkinColor
    public var disabledCapsule, disabledCapsuleText: SkinColor
    /// The filled call to action ("Next", "Create", Send): white on Black.
    public var primaryFill, primaryInk: SkinColor
    /// Code, quoted output and sunken fields.
    public var inset: SkinColor
    /// The desktop surface behind everything (teal on Hibou 98, = bg elsewhere).
    public var desktop: SkinColor

    // text
    public var textPrimary, textSecondary, textSecondaryHome, textTertiary, textDisabled: SkinColor
    public var placeholder, chevron, iconGrey, addedText, showMore: SkinColor

    // accents and states
    public var accent, accentText, accentInk, unreadDot, caret, focus: SkinColor
    public var toggleOn, toggleOff, toggleKnob: SkinColor
    public var destructive, destructiveMenu: SkinColor
    public var danger, dangerInk, success, successInk, warning: SkinColor
    public var routineActive, routinePaused, selectionRing: SkinColor

    // chat
    public var bubbleAssistant, bubbleAssistantText, bubbleUser, bubbleUserText: SkinColor
    public var chatTimestamp, bulletDot, composerPlaceholder, composerMic: SkinColor
    /// The approval / question card ("Approval needed").
    public var attentionSurface, attentionBorder, attentionText, attentionSecondary: SkinColor

    public static func of(_ id: SkinID) -> SkinPalette {
        switch id {
        case .black: return black
        case .dim: return dim
        case .retro98: return retro98
        default: return derived(id, DesktopSkins.tokens(id)!)
        }
    }

    /// The parity reference: every value measured from the 21 screenshots.
    /// Black is the Grok look (2026-11-01): its bubbles stay Grok's neutral
    /// greys (`BubbleColors.keepsNeutralBubbles`), the person's a step
    /// lighter than the bot's, never the accent or the bot's colour.
    public static let black: SkinPalette = blackBase
    private static let blackBase = SkinPalette(
        id: .black, isDark: true,
        bg: SkinColor(0x141414), card: SkinColor(0x202020), cardRaised: SkinColor(0x2E2E30),
        hairline: SkinColor(0x313131), tabHairline: SkinColor(0x262626),
        glassFill: SkinColor(0x333333), glassRimLight: SkinColor(0x7A7A7A), glassRimDark: SkinColor(0x060606),
        chip: SkinColor(0x252527), chipText: SkinColor(0x9E9EA4), pill: SkinColor(0x2B2B2D), pillBorder: SkinColor(0x363537),
        menuGlass: SkinColor(0x3B3A3B),
        disabledCapsule: SkinColor(0x999999), disabledCapsuleText: SkinColor(0x2D2D2D),
        primaryFill: SkinColor(0xFFFFFF), primaryInk: SkinColor(0x000000),
        inset: SkinColor(0x191919), desktop: SkinColor(0x141414),
        textPrimary: SkinColor(0xFFFFFF), textSecondary: SkinColor(0x9C9BA1), textSecondaryHome: SkinColor(0x97969D),
        textTertiary: SkinColor(0x575659), textDisabled: SkinColor(0x5F5E62),
        placeholder: SkinColor(0x6B6A6C), chevron: SkinColor(0x6B6A6D), iconGrey: SkinColor(0x9B9BA1),
        addedText: SkinColor(0x818183), showMore: SkinColor(0x97959C),
        accent: SkinColor(0x2D6DE7), accentText: SkinColor(0x2F6CE7), accentInk: SkinColor(0xFFFFFF),
        unreadDot: SkinColor(0x2D6BE3), caret: SkinColor(0x4C69EA), focus: SkinColor(0x4C69EA),
        toggleOn: SkinColor(0x68CE67), toggleOff: SkinColor(0x39393D), toggleKnob: SkinColor(0xFFFFFF),
        destructive: SkinColor(0xF49A96), destructiveMenu: SkinColor(0xFF7876),
        danger: SkinColor(0xFF5667), dangerInk: SkinColor(0xFFFFFF), success: SkinColor(0x38D591), successInk: SkinColor(0x072114),
        warning: SkinColor(0xFF9800),
        routineActive: SkinColor(0x5DA16B), routinePaused: SkinColor(0xD65555), selectionRing: SkinColor(0x545356),
        bubbleAssistant: SkinColor(0x202020), bubbleAssistantText: SkinColor(0xFFFFFF),
        bubbleUser: SkinColor(0x2E2E30), bubbleUserText: SkinColor(0xFFFFFF),
        chatTimestamp: SkinColor(0x555557), bulletDot: SkinColor(0x5F5E61),
        composerPlaceholder: SkinColor(0x6B6B6E), composerMic: SkinColor(0xA3A2AA),
        attentionSurface: SkinColor(0x202020), attentionBorder: SkinColor(0x2D6DE7, alpha: 0.4),
        attentionText: SkinColor(0xFFFFFF), attentionSecondary: SkinColor(0x9C9BA1)
    )

    /// Black lifted one step: the same family on the iOS grouped greys.
    public static let dim: SkinPalette = {
        var p = blackBase
        p.id = .dim
        p.bg = SkinColor(0x1C1C1E)
        p.desktop = p.bg
        p.card = SkinColor(0x2C2C2E)
        p.cardRaised = SkinColor(0x3A3A3C)
        p.hairline = SkinColor(0x3A3A3C)
        p.tabHairline = SkinColor(0x303032)
        p.inset = SkinColor(0x232325)
        p.glassFill = SkinColor(0x3A3A3C)
        p.chip = SkinColor(0x323234)
        p.pill = SkinColor(0x333335)
        p.pillBorder = SkinColor(0x3E3D3F)
        p.menuGlass = SkinColor(0x444345)
        p.attentionSurface = SkinColor(0x2C2C2E)
        p.textTertiary = SkinColor(0x6E6D72)
        p.chatTimestamp = SkinColor(0x6A6A6E)
        p.textSecondary = SkinColor(0xA3A2A8)
        p.attentionSecondary = SkinColor(0xA3A2A8)
        // #2F6CE7 measures 2.9:1 on the lifted card; one step brighter clears 3:1
        p.accentText = SkinColor(0x4A85F2)
        return p.bubbled()
    }()

    /// Hibou 98: grey 3D faces, white sunken fields, navy selection, and
    /// the teal desktop behind the window (desktop `retro98.css`).
    public static let retro98: SkinPalette = {
        var p = derived(.retro98, DesktopSkins.tokens(.retro98)!)
        p.typeface = .retro
        p.bevelled = true
        p.bg = SkinColor(0xC0C0C0)
        p.desktop = SkinColor(0x008080)
        p.card = SkinColor(0xFFFFFF)
        p.cardRaised = SkinColor(0xDFDFDF)
        p.hairline = SkinColor(0x808080)
        p.tabHairline = SkinColor(0x808080)
        p.inset = SkinColor(0xFFFFFF)
        p.glassFill = SkinColor(0xC0C0C0)
        p.glassRimLight = SkinColor(0xFFFFFF)
        p.glassRimDark = SkinColor(0x0A0A0A)
        p.chip = SkinColor(0xC0C0C0)
        p.pill = SkinColor(0xC0C0C0)
        p.menuGlass = SkinColor(0xC0C0C0)
        p.primaryFill = SkinColor(0xC0C0C0)
        p.primaryInk = SkinColor(0x000000)
        p.attentionSurface = SkinColor(0xFFFFFF)
        p.attentionBorder = SkinColor(0x000080)
        p.toggleOn = SkinColor(0x000080)
        p.toggleOff = SkinColor(0x808080)
        p.textTertiary = SkinColor(0x3C3C3C)
        p.chatTimestamp = SkinColor(0x3C3C3C)
        return p.bubbled()
    }()

    /// A desktop skin on the phone: the desktop's tokens, placed on the
    /// phone's surfaces by role.
    public static func derived(_ id: SkinID, _ t: DesktopSkinTokens) -> SkinPalette {
        let quiet = t.inkTertiary
        return SkinPalette(
            id: id, isDark: t.dark,
            typeface: .system,
            bg: t.app, card: t.card, cardRaised: t.raised,
            hairline: t.hairline, tabHairline: t.hairline,
            glassFill: t.raised, glassRimLight: t.dark ? t.hairline.opacity(1) : t.hairline,
            glassRimDark: t.dark ? t.inset : t.hairline,
            chip: t.dark ? t.raised : t.inset, chipText: t.inkSecondary,
            pill: t.raised, pillBorder: t.hairline, menuGlass: t.dark ? t.raised : t.menu,
            disabledCapsule: t.control, disabledCapsuleText: t.inkSecondary,
            primaryFill: t.accent, primaryInk: t.accentInk,
            inset: t.inset, desktop: t.app,
            textPrimary: t.ink, textSecondary: t.inkSecondary, textSecondaryHome: t.inkSecondary,
            textTertiary: quiet, textDisabled: quiet.opacity(0.7),
            placeholder: quiet, chevron: quiet, iconGrey: t.inkSecondary,
            addedText: t.inkSecondary, showMore: t.inkSecondary,
            accent: t.accent, accentText: t.accentText, accentInk: t.accentInk,
            unreadDot: t.unread, caret: t.focus, focus: t.focus,
            toggleOn: t.accent, toggleOff: t.control, toggleKnob: SkinColor(0xFFFFFF),
            destructive: t.danger, destructiveMenu: t.danger,
            danger: t.danger, dangerInk: t.dangerInk, success: t.success, successInk: t.successInk,
            warning: t.warning,
            // #188: on, paused and waiting read in the accent; green stays
            // for a real success, red for an error
            routineActive: t.accent, routinePaused: t.accentText, selectionRing: quiet,
            bubbleAssistant: t.bubbleBot, bubbleAssistantText: t.ink,
            bubbleUser: t.bubbleUser, bubbleUserText: t.bubbleUserInk,
            chatTimestamp: quiet, bulletDot: quiet,
            composerPlaceholder: quiet, composerMic: t.inkSecondary,
            attentionSurface: t.card, attentionBorder: t.accent.opacity(0.4),
            attentionText: t.ink, attentionSecondary: t.inkSecondary
        )
    }
}

// MARK: - The desktop's values

/// The desktop's tokens per skin, copied from `src/styles.css`. A test
/// (`SkinsTests.testDesktopTokensMatchStylesheet`) re-reads the stylesheet
/// when it is reachable, so the two cannot drift silently.
public enum DesktopSkins {
    public static func tokens(_ id: SkinID) -> DesktopSkinTokens? {
        table[id.rawValue].flatMap(tokens(from:))
    }

    /// The token names read from each `[data-skin]` block.
    public static let keys = [
        "code-scheme", "app", "panel", "raised", "raised-hover", "card", "menu", "inset", "control", "hairline",
        "ink", "ink-secondary", "ink-tertiary", "accent", "accent-border", "accent-text", "focus", "accent-ink",
        "bubble-user", "bubble-user-ink", "success", "danger", "danger-ink", "success-ink", "warning", "composer",
        "unread",
    ]

    public static let table: [String: [String: String]] = [
        "pulsatrix": [
            "code-scheme": "dark", "app": "#030b17", "panel": "#060f20", "raised": "#16233c",
            "raised-hover": "#1d2d4c", "card": "#0d192c", "menu": "#0d1729", "inset": "#081225", "control": "#16233c",
            "hairline": "#223353", "ink": "#eef2fb", "ink-secondary": "#9aa6c2", "ink-tertiary": "#8d99b5",
            "accent": "#3c76f4", "accent-border": "#4f86f7", "accent-text": "#c8e4ff", "focus": "#4f86f7",
            "accent-ink": "#030b17", "bubble-user": "#1e3358", "bubble-user-ink": "#eef2fb", "success": "#38d591",
            "danger": "#f25a64", "danger-ink": "#030b17", "success-ink": "#072114", "warning": "#ff9800",
            "composer": "#16233c", "unread": "var(--color-accent)",
        ],
        "pulsatrix-light": [
            "code-scheme": "light", "app": "#eef2f8", "panel": "#f6f8fb", "raised": "#ffffff",
            "raised-hover": "#e6ebf4", "card": "#ffffff", "menu": "#ffffff", "inset": "#dfe6f2", "control": "#bfcade",
            "hairline": "#b8c3d9", "ink": "#0b1526", "ink-secondary": "#4f5868", "ink-tertiary": "#4f5868",
            "accent": "#2f62dd", "accent-border": "#3c76f4", "accent-text": "#2652bd", "focus": "#2652bd",
            "accent-ink": "#f6f8fc", "bubble-user": "#dceafe", "bubble-user-ink": "#0b1526", "success": "#0f5132",
            "danger": "#c02936", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#7d4d09",
            "composer": "#ffffff", "unread": "var(--color-accent)",
        ],
        "midnight": [
            "code-scheme": "dark", "app": "#121212", "panel": "#161616", "raised": "#1f1f1f",
            "raised-hover": "#2c2c2c", "card": "#1f1f1f", "menu": "#1f1f1f", "inset": "#1b1b1b", "control": "#282828",
            "hairline": "#353535", "ink": "#f5f5f5", "ink-secondary": "#f5f5f5a8", "ink-tertiary": "#f5f5f58a",
            "accent": "#f5f5f5", "accent-border": "#dbdbdb", "accent-text": "#7cb5ff", "focus": "#1884fc",
            "accent-ink": "#121212", "bubble-user": "#3b3b3b", "bubble-user-ink": "#f5f5f5", "success": "#00ba69",
            "danger": "#ff6463", "danger-ink": "#121212", "success-ink": "#121212", "warning": "#e28600",
            "composer": "#1f1f1f", "unread": "#1884fc",
        ],
        "atelier": [
            "code-scheme": "light", "app": "#f5f1eb", "panel": "#fbf8f2", "raised": "#ffffff",
            "raised-hover": "#f2e9dc", "card": "#ffffff", "menu": "#ffffff", "inset": "#f5f1eb", "control": "#ece4d6",
            "hairline": "#c8bda8", "ink": "#1a1a18", "ink-secondary": "#5c564d", "ink-tertiary": "#5c564d",
            "accent": "#a05f25", "accent-border": "#b06a2c", "accent-text": "#96551f", "focus": "#96551f",
            "accent-ink": "#ffffff", "bubble-user": "#f2e9dc", "bubble-user-ink": "#1a1a18", "success": "#3f6b47",
            "danger": "#a33a32", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#7a5f31",
            "composer": "#ffffff", "unread": "var(--color-accent)",
        ],
        "foundry": [
            "code-scheme": "dark", "app": "#100e0b", "panel": "#171410", "raised": "#262019",
            "raised-hover": "#322b21", "card": "#1e1a14", "menu": "#1e1a14", "inset": "#0b0a08", "control": "#262019",
            "hairline": "#3d3529", "ink": "#f4efe4", "ink-secondary": "#b0a696", "ink-tertiary": "#a59c8f",
            "accent": "#d99a3e", "accent-border": "#e8b25e", "accent-text": "#e0a44c", "focus": "#e0a44c",
            "accent-ink": "#1c150c", "bubble-user": "#2a2318", "bubble-user-ink": "#f4efe4", "success": "#57b078",
            "danger": "#e27168", "danger-ink": "#1c0d0b", "success-ink": "#1c150c", "warning": "#dfa441",
            "composer": "#262019", "unread": "var(--color-accent)",
        ],
        "lagoon": [
            "code-scheme": "light", "app": "#dfeceb", "panel": "#ecf4f3", "raised": "#ffffff",
            "raised-hover": "#cfe4e1", "card": "#ffffff", "menu": "#ffffff", "inset": "#d5e8e5", "control": "#c3dcd9",
            "hairline": "#aebfbd", "ink": "#14201f", "ink-secondary": "#495655", "ink-tertiary": "#4b5655",
            "accent": "#11736d", "accent-border": "#14807a", "accent-text": "#0d5f5a", "focus": "#0d5f5a",
            "accent-ink": "#ffffff", "bubble-user": "#cfe4e1", "bubble-user-ink": "#14201f", "success": "#2f6b4f",
            "danger": "#a8382f", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#7a5a2a",
            "composer": "#ffffff", "unread": "var(--color-accent)",
        ],
        "graphite": [
            "code-scheme": "dark", "app": "#111214", "panel": "#181a1d", "raised": "#2a2d32",
            "raised-hover": "#353941", "card": "#22252a", "menu": "#22252a", "inset": "#0d0e10", "control": "#2a2d32",
            "hairline": "#3b4048", "ink": "#f2f4f7", "ink-secondary": "#b3b8c2", "ink-tertiary": "#9fa4ad",
            "accent": "#d0d4da", "accent-border": "#9aa3ad", "accent-text": "#e4e7ec", "focus": "#b3b8c2",
            "accent-ink": "#111214", "bubble-user": "#30343a", "bubble-user-ink": "#f2f4f7", "success": "#63b58a",
            "danger": "#e3838b", "danger-ink": "#1e0b0e", "success-ink": "#101a14", "warning": "#d3a150",
            "composer": "#2a2d32", "unread": "#3c76f4",
        ],
        "linen": [
            "code-scheme": "light", "app": "#eceff3", "panel": "#f5f6f8", "raised": "#ffffff",
            "raised-hover": "#e1e6ed", "card": "#ffffff", "menu": "#ffffff", "inset": "#e6e9ee", "control": "#d3d9e1",
            "hairline": "#b4bbc5", "ink": "#1d2229", "ink-secondary": "#515863", "ink-tertiary": "#515863",
            "accent": "#2a2a2a", "accent-border": "#3a3a3a", "accent-text": "#2a2a2a", "focus": "#2a2a2a",
            "accent-ink": "#ffffff", "bubble-user": "#e1e6ed", "bubble-user-ink": "#1d2229", "success": "#2f704f",
            "danger": "#a83d48", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#765b2b",
            "composer": "#ffffff", "unread": "#3c76f4",
        ],
        "dusk": [
            "code-scheme": "dark", "app": "#121014", "panel": "#19161c", "raised": "#2b2630",
            "raised-hover": "#37303d", "card": "#231f27", "menu": "#231f27", "inset": "#0d0b0f", "control": "#2b2630",
            "hairline": "#403847", "ink": "#f4eff6", "ink-secondary": "#b9afbd", "ink-tertiary": "#a49ca8",
            "accent": "#9474a3", "accent-border": "#9670a3", "accent-text": "#c49bd2", "focus": "#c49bd2",
            "accent-ink": "#121014", "bubble-user": "#332b38", "bubble-user-ink": "#f4eff6", "success": "#6fad83",
            "danger": "#de7e86", "danger-ink": "#210c10", "success-ink": "#101812", "warning": "#d0a35d",
            "composer": "#2b2630", "unread": "var(--color-accent)",
        ],
        "daylight": [
            "code-scheme": "light", "app": "#fcfcfc", "panel": "#f7f7f7", "raised": "#e1e1e1",
            "raised-hover": "#d7d7d7", "card": "#eeeeee", "menu": "#fcfcfc", "inset": "#e6e6e6", "control": "#dedede",
            "hairline": "#d0d0d0", "ink": "#0d0d0d", "ink-secondary": "#575757", "ink-tertiary": "#575757",
            "accent": "#2a2a2a", "accent-border": "#3a3a3a", "accent-text": "#2a2a2a", "focus": "#2a2a2a",
            "accent-ink": "#fcfcfc", "bubble-user": "#070707", "bubble-user-ink": "#fcfcfc", "success": "#1a6943",
            "danger": "#af2834", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#825400",
            "composer": "#fcfcfc", "unread": "var(--color-accent)",
        ],
        "retro98": [
            "code-scheme": "light", "app": "#ffffff", "panel": "#c0c0c0", "raised": "#c0c0c0",
            "raised-hover": "#b4b4b4", "card": "#c0c0c0", "menu": "#c0c0c0", "inset": "#ffffff", "control": "#d4d0c8",
            "hairline": "#808080", "ink": "#000000", "ink-secondary": "#3c3c3c", "ink-tertiary": "#3c3c3c",
            "accent": "#000080", "accent-border": "#000080", "accent-text": "#000080", "focus": "#000000",
            "accent-ink": "#ffffff", "bubble-user": "#ffffff", "bubble-user-ink": "#000000", "success": "#004c00",
            "danger": "#820000", "danger-ink": "#ffffff", "success-ink": "#ffffff", "warning": "#543c00",
            "composer": "#ffffff", "unread": "var(--color-accent)",
        ],
    ]
}

// MARK: - Choosing the skin

/// Settings > Appearance: how the phone picks its skin.
public enum ThemeMode: String, CaseIterable, Identifiable, Sendable {
    /// A light skin and a dark skin, following the phone's appearance.
    case system
    /// One skin, whatever the phone's appearance.
    case fixed
    /// "Same as my computer": the computer's omb-skin and omb-font.
    case computer
    public var id: String { rawValue }
}

/// Everything the phone stores about its look, per device.
public struct ThemeSelection: Equatable, Sendable {
    public var mode: ThemeMode
    public var fixedSkin: SkinID
    public var lightSkin: SkinID
    public var darkSkin: SkinID
    public var font: SkinFontChoice
    /// The computer's choice, as last read (computer mode).
    public var computerSkin: SkinID?
    public var computerFont: SkinFontChoice?
    /// The variant laid over this phone's skin (fixed and system modes): a
    /// colour, a duo-tone, a mood or a Windows edition (`omb-skin-tint` on
    /// the computer). One tint for the pair, as the desktop's Auto.
    public var tint: SkinTint?
    public var depth: SkinDepth
    public var texture: SkinTexture
    /// The computer's tint, intensity and texture, as last read (computer mode).
    public var computerTint: SkinTint?
    public var computerDepth: SkinDepth?
    public var computerTexture: SkinTexture?

    /// The default pair is Black twice: "System · Black", the reference look,
    /// whatever the phone's own appearance. A light skin for a light phone is
    /// a choice made in Settings > Appearance.
    public static let defaultLight: SkinID = .black
    public static let defaultDark: SkinID = .black
    /// The light skin offered first when a person picks a light look.
    public static let suggestedLight: SkinID = .pulsatrixLight

    public init(
        mode: ThemeMode = .system,
        fixedSkin: SkinID = .black,
        lightSkin: SkinID = ThemeSelection.defaultLight,
        darkSkin: SkinID = ThemeSelection.defaultDark,
        font: SkinFontChoice = .skin,
        computerSkin: SkinID? = nil,
        computerFont: SkinFontChoice? = nil,
        tint: SkinTint? = nil,
        depth: SkinDepth = .accent,
        texture: SkinTexture = .none,
        computerTint: SkinTint? = nil,
        computerDepth: SkinDepth? = nil,
        computerTexture: SkinTexture? = nil
    ) {
        self.mode = mode
        self.fixedSkin = fixedSkin
        self.lightSkin = lightSkin
        self.darkSkin = darkSkin
        self.font = font
        self.computerSkin = computerSkin
        self.computerFont = computerFont
        self.tint = tint
        self.depth = depth
        self.texture = texture
        self.computerTint = computerTint
        self.computerDepth = computerDepth
        self.computerTexture = computerTexture
    }

    /// The look worn when the phone is in `deviceDark` appearance: the skin
    /// with its tint, intensity and texture, normalized (a legacy skin as its
    /// base and colour, a tint the skin lacks dropped).
    public func look(deviceDark: Bool) -> SkinLook {
        let skin = skin(deviceDark: deviceDark)
        if mode == .computer, computerSkin != nil {
            return SkinLook(skin: skin, tint: computerTint, depth: computerDepth ?? .accent, texture: computerTexture ?? .none).normalized
        }
        return SkinLook(skin: skin, tint: tint, depth: depth, texture: texture).normalized
    }

    /// The skin worn when the phone is in `deviceDark` appearance.
    public func skin(deviceDark: Bool) -> SkinID {
        switch mode {
        case .fixed: return fixedSkin
        case .computer: return computerSkin ?? (deviceDark ? darkSkin : lightSkin)
        case .system: return deviceDark ? darkSkin : lightSkin
        }
    }

    public func fontChoice() -> SkinFontChoice {
        mode == .computer ? (computerFont ?? font) : font
    }

    /// True when the skin does not depend on the phone's appearance: the
    /// window (status bar, keyboard) is then forced to that skin's own light
    /// or dark. A system pair that names the same skin twice (the default,
    /// Black and Black) pins too, so a light phone looks like a dark one.
    public var pinsAppearance: Bool {
        switch mode {
        case .fixed: return true
        case .system: return lightSkin == darkSkin
        case .computer: return computerSkin != nil || lightSkin == darkSkin
        }
    }

    /// The earlier Settings > Appearance (System / Dark and Black / Dim).
    /// That app had no light look: System and Dark both wore the tone, so the
    /// tone becomes both halves of the pair. Never chosen: the default.
    public static func migrating(appearanceMode: String?, tone: String?) -> ThemeSelection {
        let shade: SkinID = tone == "dim" ? .dim : .black
        if appearanceMode == "dark" { return ThemeSelection(mode: .fixed, fixedSkin: shade, lightSkin: shade, darkSkin: shade) }
        return ThemeSelection(mode: .system, fixedSkin: shade, lightSkin: shade, darkSkin: shade)
    }
}

// MARK: - The computer's preferences

/// The desktop's appearance keys (shared/user-preferences.ts).
public enum DesktopAppearanceKeys {
    public static let skin = "omb-skin"
    public static let font = "omb-font"
    /// "auto": the computer follows its system between a variant's light
    /// and dark skins (src/lib/skin-families.ts); `skin` is the one worn now.
    public static let skinMode = "omb-skin-mode"
    /// The colour or Windows edition laid over `skin`; absent for the family's own look.
    public static let skinTint = "omb-skin-tint"
    /// "full": the colour reaches every surface; absent for the accent only.
    public static let skinDepth = "omb-skin-depth"
    /// A texture over the ground; absent for none.
    public static let skinTexture = "omb-skin-texture"
    public static let retroOn = "omb.retro98.on"
    public static let retroUnlocked = "omb.retro98.unlocked"
    /// Settings > Appearance > Mascots > HD mascots ("on" | "off", absent is on):
    /// on a personal computer it rides with the look (shared/desktop-appearance.ts).
    public static let hdMascots = "sagax.hdMascots.v1"
}

/// What the computer says about its look: from `/api/me/preferences`
/// (organization servers) or `/api/me/appearance` (a personal computer).
public struct ComputerAppearance: Equatable, Sendable {
    public var skin: SkinID?
    public var font: SkinFontChoice?
    public var retroUnlocked: Bool
    /// The computer's skin follows its system (Auto).
    public var auto: Bool
    public var tint: SkinTint?
    public var depth: SkinDepth
    public var texture: SkinTexture

    public init(skin: SkinID?, font: SkinFontChoice?, retroUnlocked: Bool, auto: Bool = false,
                tint: SkinTint? = nil, depth: SkinDepth = .accent, texture: SkinTexture = .none) {
        self.skin = skin
        self.font = font
        self.retroUnlocked = retroUnlocked
        self.auto = auto
        self.tint = tint
        self.depth = depth
        self.texture = texture
    }

    /// From the desktop's string preferences. An unknown or absent skin is
    /// the desktop's default (Pulsatrix), as the desktop itself reads it.
    public init(preferences: [String: String]) {
        // a legacy skin (Meadow, Graphite…) is its base and colour, as the desktop wears it
        let read = SkinVariants.read(skin: preferences[DesktopAppearanceKeys.skin], tint: preferences[DesktopAppearanceKeys.skinTint])
        let worn = read.flatMap { $0.skin.phoneOnly ? nil : $0 }
        let look = SkinLook(
            skin: worn?.skin ?? .pulsatrix,
            tint: worn?.tint,
            depth: preferences[DesktopAppearanceKeys.skinDepth].flatMap(SkinDepth.init(rawValue:)) ?? .accent,
            texture: preferences[DesktopAppearanceKeys.skinTexture].flatMap(SkinTexture.init(rawValue:)) ?? .none
        ).normalized
        self.skin = look.skin
        self.tint = look.tint
        // kept as the computer stored them: Full and a texture are choices of their own there
        self.depth = preferences[DesktopAppearanceKeys.skinDepth] == SkinDepth.full.rawValue ? .full : .accent
        self.texture = preferences[DesktopAppearanceKeys.skinTexture].flatMap(SkinTexture.init(rawValue:)) ?? .none
        self.font = preferences[DesktopAppearanceKeys.font].flatMap(SkinFontChoice.init(rawValue:)) ?? .skin
        self.retroUnlocked = preferences[DesktopAppearanceKeys.retroUnlocked] == "1" || preferences[DesktopAppearanceKeys.retroOn] == "1"
        self.auto = preferences[DesktopAppearanceKeys.skinMode] == "auto"
    }

    /// The keys the phone writes back when it changes the computer's look.
    /// A phone-only skin (Black, Dim) has no desktop twin: it writes Midnight
    /// for Black and Graphite for Dim, the nearest the desktop has.
    /// `auto` keeps the computer's Auto (a font change); a skin picked on the
    /// phone is a fixed choice, so it is written without it.
    /// The tint, Full and the texture are written as the desktop stores them:
    /// absent for the family's own look, the accent only and no texture.
    public static func preferences(skin: SkinID, font: SkinFontChoice, retroUnlocked: Bool, auto: Bool = false,
                                   tint: SkinTint? = nil, depth: SkinDepth = .accent, texture: SkinTexture = .none) -> [String: String] {
        let desktop: SkinID = skin == .black ? .midnight : skin == .dim ? .graphite : skin
        var out = [DesktopAppearanceKeys.skin: desktop.rawValue, DesktopAppearanceKeys.font: font.rawValue]
        if auto { out[DesktopAppearanceKeys.skinMode] = "auto" }
        if !skin.phoneOnly, let tint, SkinVariants.offers(desktop, tint) { out[DesktopAppearanceKeys.skinTint] = tint.rawValue }
        if depth == .full { out[DesktopAppearanceKeys.skinDepth] = SkinDepth.full.rawValue }
        if texture != .none { out[DesktopAppearanceKeys.skinTexture] = texture.rawValue }
        if retroUnlocked { out[DesktopAppearanceKeys.retroUnlocked] = "1" }
        out[DesktopAppearanceKeys.retroOn] = skin == .retro98 ? "1" : nil
        return out
    }
}

// MARK: - Shared with the widgets

/// The app group keys the widgets, the Live Activity and the share
/// extension read to draw in the app's skin.
public enum SharedThemeKeys {
    public static let mode = "theme.mode"
    public static let fixed = "theme.fixed"
    public static let light = "theme.light"
    public static let dark = "theme.dark"
    public static let font = "theme.font"
    public static let tint = "theme.tint"
    public static let depth = "theme.depth"
    public static let texture = "theme.texture"

    /// The look to draw with: the skin, with the app's tint and intensity.
    public static func look(in defaults: UserDefaults?, deviceDark: Bool) -> SkinLook {
        let skin = skin(in: defaults, deviceDark: deviceDark)
        return SkinLook(
            skin: skin,
            tint: defaults?.string(forKey: Self.tint).flatMap(SkinTint.init(rawValue:)),
            depth: defaults?.string(forKey: Self.depth).flatMap(SkinDepth.init(rawValue:)) ?? .accent,
            texture: defaults?.string(forKey: Self.texture).flatMap(SkinTexture.init(rawValue:)) ?? .none
        ).normalized
    }

    /// The skin to draw with, from the shared defaults and the drawing
    /// context's appearance.
    public static func skin(in defaults: UserDefaults?, deviceDark: Bool) -> SkinID {
        guard let defaults else { return deviceDark ? ThemeSelection.defaultDark : ThemeSelection.defaultLight }
        let mode = defaults.string(forKey: Self.mode).flatMap(ThemeMode.init(rawValue:)) ?? .system
        let read = { (key: String, fallback: SkinID) in defaults.string(forKey: key).flatMap(SkinID.init(rawValue:)) ?? fallback }
        if mode != .system, let fixed = defaults.string(forKey: Self.fixed).flatMap(SkinID.init(rawValue:)) { return fixed }
        return deviceDark ? read(Self.dark, ThemeSelection.defaultDark) : read(Self.light, ThemeSelection.defaultLight)
    }

    public static func write(_ selection: ThemeSelection, resolvedFixed: SkinID?, to defaults: UserDefaults?) {
        guard let defaults else { return }
        defaults.set(resolvedFixed == nil ? ThemeMode.system.rawValue : ThemeMode.fixed.rawValue, forKey: Self.mode)
        defaults.set(resolvedFixed?.rawValue, forKey: Self.fixed)
        defaults.set(selection.lightSkin.rawValue, forKey: Self.light)
        defaults.set(selection.darkSkin.rawValue, forKey: Self.dark)
        defaults.set(selection.fontChoice().rawValue, forKey: Self.font)
        let worn = selection.mode == .computer && selection.computerSkin != nil
        defaults.set((worn ? selection.computerTint : selection.tint)?.rawValue, forKey: Self.tint)
        defaults.set((worn ? selection.computerDepth ?? .accent : selection.depth).rawValue, forKey: Self.depth)
        defaults.set((worn ? selection.computerTexture ?? .none : selection.texture).rawValue, forKey: Self.texture)
    }
}

// MARK: - Mascot shadow

/// The drop shadow a character wears on a light skin, so a white mascot
/// reads on a light surface (#186, #204): `--mascot-shadow-color` and
/// `--mascot-shadow-wide` in src/styles.css, drawn as the desktop's
/// `--mascot-filter` (three drop shadows following the silhouette). Dark
/// skins, and the phone's own Black and Dim, take none.
public struct MascotShadowTone: Equatable, Sendable {
    /// The tight shadow (0 0 1px, then 0 1px 2px).
    public var color: SkinColor
    /// The wide one under it (0 3px 8px).
    public var wide: SkinColor

    /// The three layers of `--mascot-filter`: offset y, blur (CSS px), and which tone.
    public static let layers: [(y: Double, blur: Double, wide: Bool)] = [(0, 1, false), (1, 2, false), (3, 8, true)]

    public static func of(_ id: SkinID) -> MascotShadowTone? {
        func rgba(_ r: UInt32, _ g: UInt32, _ b: UInt32) -> MascotShadowTone {
            let hex = r << 16 | g << 8 | b
            return MascotShadowTone(color: SkinColor(hex, alpha: 0.35), wide: SkinColor(hex, alpha: 0.18))
        }
        switch id {
        case .pulsatrixLight: return rgba(20, 24, 40)
        case .atelier: return rgba(40, 30, 16)
        case .lagoon: return rgba(12, 36, 34)
        case .linen: return rgba(20, 24, 36)
        case .daylight: return rgba(20, 20, 20)
        case .retro98: return rgba(0, 0, 0)
        case .black, .dim, .pulsatrix, .midnight, .foundry, .graphite, .dusk: return nil
        }
    }
}

public extension SkinPalette {
    /// The mascot's drop shadow on this skin; nil on a dark one.
    var mascotShadow: MascotShadowTone? { MascotShadowTone.of(id) }
}

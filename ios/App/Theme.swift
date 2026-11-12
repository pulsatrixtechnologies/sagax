// Design tokens and building blocks for the visual-parity pass.
//
// Every value here comes from the measured references
// (docs/superpowers/specs/assets/ios-visual-parity/measure-*.md), in points.
// The odd sizes (11.5, 12.5, 13.5) are measured, not typos: the reference
// runs below the HIG sizes and Dynamic Type styles would not match it.
//
// Screens are not restyled here. This file only provides the parts the later
// phases assemble: glass circles and capsules, grouped cards and rows,
// section labels and footers, the role chip, the card sheet container and
// the top scroll-edge fade. `ThemeGalleryView` (DEBUG) shows them together.
import SwiftUI
import CompanionCore

// MARK: - Colour

extension Color {
    /// `Color(hex: 0x141414)`: an opaque sRGB colour from a 24-bit literal.
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

extension UIColor {
    /// `UIColor(hex: 0x141414)`: the UIKit twin of `Color(hex:)`, same sRGB values.
    convenience init(hex: UInt32, alpha: CGFloat = 1) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: alpha
        )
    }
}

enum Theme {
    // MARK: Surfaces
    //
    // Every colour is read from the active skin (CompanionCore/Skins.swift)
    // when it is asked for. `ThemeRoot`, applied once at the root, decides the
    // skin (Settings > Appearance, the phone's light or dark, the computer's
    // own choice), stores it in `ThemeRuntime` and in the environment
    // (`\.themePalette`); every view declares that environment value, so a
    // change redraws the whole tree live and these properties answer with the
    // new skin. Black keeps the reference values exactly (#141414, #202020, ...).

    /// The active skin's tokens.
    static var palette: SkinPalette { ThemeRuntime.palette }

    /// A value measured on the references, kept as is on Black and Dim (the
    /// phone's own skins), and the skin's token everywhere else. For the few
    /// parity surfaces whose measured colour is not one of the tokens.
    static func parity(_ reference: Color, _ themed: @autoclosure () -> Color) -> Color {
        keepsReference ? reference : themed()
    }

    /// True on Black and Dim, the phone's own measured skins.
    static var keepsReference: Bool { palette.id == .black || palette.id == .dim }

    /// A bot's colour used as text: unchanged on a dark skin, deepened on a
    /// light one until it reads on the skin's cards (4.5:1).
    static func readable(_ color: Color) -> Color {
        guard !palette.isDark else { return color }
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        guard UIColor(color).getRed(&r, green: &g, blue: &b, alpha: &a) else { return color }
        func byte(_ v: CGFloat) -> UInt32 { UInt32(max(0, min(1, v)) * 255 + 0.5) }
        let skin = SkinColor(byte(r) << 16 | byte(g) << 8 | byte(b))
        return skin.readable(on: palette.card).color
    }

    /// The app background: #141414 in Black (the parity value).
    static var bg: Color { palette.bg.color }
    /// The computer view draws on pure black, whatever the skin.
    static let bgComputer = Color(hex: 0x000000)
    static var card: Color { palette.card.color }
    /// One step above a card: a pressed row, the user's bubble on Black.
    static var cardRaised: Color { palette.cardRaised.color }
    static var hairline: Color { palette.hairline.color }
    static var tabHairline: Color { palette.tabHairline.color }
    /// Code, quoted output and sunken fields.
    static var inset: Color { palette.inset.color }
    /// Behind the window: teal on Hibou 98, the background elsewhere.
    static var desktop: Color { palette.desktop.color }

    /// Glass control fill: about 13% white over `bg` on Black.
    static var glassFill: Color { palette.glassFill.color }
    static var glassRimLight: Color { palette.glassRimLight.color }
    static var glassRimDark: Color { palette.glassRimDark.color }
    static var chip: Color { palette.chip.color }
    static var pill: Color { palette.pill.color }
    static var pillBorder: Color { palette.pillBorder.color }
    /// Behind a card sheet the home is dimmed with black at 50%.
    static var dim: Color { Color.black.opacity(palette.isDark ? 0.5 : 0.28) }
    /// A disabled light capsule ("Next", "Create"): about 57% white glass on Black.
    static var disabledCapsule: Color { palette.disabledCapsule.color }
    static var disabledCapsuleText: Color { palette.disabledCapsuleText.color }
    /// The filled call to action and the ink on it (white and black on Black).
    static var primaryFill: Color { palette.primaryFill.color }
    static var primaryInk: Color { palette.primaryInk.color }
    /// The filled call to action as a fill: the accent's gradient on a
    /// duo-tone or a mood (skin-duo.css paints `bg-accent` with it), else the flat colour.
    static var primaryFillStyle: AnyShapeStyle {
        let stops = palette.accentGradient
        guard stops.count > 1, palette.primaryFill == palette.accent else { return AnyShapeStyle(primaryFill) }
        return AnyShapeStyle(LinearGradient(colors: stops.map(\.color), startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    // MARK: Text
    static var textPrimary: Color { palette.textPrimary.color }
    static var textSecondary: Color { palette.textSecondary.color }
    /// Home previews, headers and pinned labels read a touch darker.
    static var textSecondaryHome: Color { palette.textSecondaryHome.color }
    static var textTertiary: Color { palette.textTertiary.color }
    static var textDisabled: Color { palette.textDisabled.color }
    static var placeholder: Color { palette.placeholder.color }
    static var chevron: Color { palette.chevron.color }
    static var iconGrey: Color { palette.iconGrey.color }
    static var chipText: Color { palette.chipText.color }
    static var addedText: Color { palette.addedText.color }

    // MARK: Accents
    /// Switches: the skin's switch accent (#68CE67 on Black and Dim, the
    /// skin's or the bot's accent elsewhere) and a neutral off, each at the
    /// lightness that holds 3:1 with the white knob and the surfaces
    /// (CompanionCore/SwitchContrast.swift), with an edge when needed.
    ///
    /// In a bot's panel (a bot chat on screen and what it opens) the on
    /// track is the bot's colour, with the setting off as well as on.
    private static var switches: SwitchColors {
        // read while SwiftUI draws, on the main actor (as BotBubblePaint)
        let name = MainActor.assumeIsolated { ThemeStore.shared.openBotColor }
        let bot = name.flatMap { MausColors.hex(for: $0) }.flatMap { SkinColor(css: $0) }
        return palette.switchColors(bot: bot)
    }
    static var toggleOn: Color { switches.on.color }
    static var toggleOff: Color { switches.off.color }
    static var toggleOnEdge: Color? { switches.onEdge?.color }
    static var toggleOffEdge: Color? { switches.offEdge?.color }
    /// White in both states, never dark on a coloured track.
    static var toggleKnob: Color { SwitchContrast.knob.color }
    /// Links and action text ("Upload", "Add routine", action rows): #2D6DE7
    /// on Black and Dim as measured, the skin's accent text elsewhere (the
    /// accent fill can be too dark or too light to read as text: Dusk's plum).
    static var blue: Color { palette.id == .black || palette.id == .dim ? palette.accent.color : palette.accentText.color }
    static var accent: Color { palette.accent.color }
    /// Ink on an accent fill.
    static var accentInk: Color { palette.accentInk.color }
    static var unreadDot: Color { palette.unreadDot.color }
    static var caret: Color { palette.caret.color }
    static var focus: Color { palette.focus.color }
    /// Destructive rows in settings cards.
    static var destructive: Color { palette.destructive.color }
    /// Destructive items in glass menus.
    static var destructiveMenu: Color { palette.destructiveMenu.color }
    static var danger: Color { palette.danger.color }
    static var dangerInk: Color { palette.dangerInk.color }
    static var success: Color { palette.success.color }
    static var successInk: Color { palette.successInk.color }
    static var warning: Color { palette.warning.color }
    static var routineActive: Color { palette.routineActive.color }
    static var routinePaused: Color { palette.routinePaused.color }
    static var selectionRing: Color { palette.selectionRing.color }

    // MARK: Chat (measure-chat-profile.md §1)
    /// The assistant bubble is a card: #202020 on Black, no tail.
    static var bubbleAssistant: Color { palette.bubbleAssistant.color }
    static var bubbleAssistantText: Color { palette.bubbleAssistantText.color }
    /// Your own words: one step lighter than the assistant card on Black.
    static var bubbleUser: Color { palette.bubbleUser.color }
    static var bubbleUserText: Color { palette.bubbleUserText.color }
    /// "Today 4:53 PM" between stretches of conversation.
    static var chatTimestamp: Color { palette.chatTimestamp.color }
    /// The 5 pt list dot inside a bubble.
    static var bulletDot: Color { palette.bulletDot.color }
    /// The composer's placeholder and its mic glyph.
    static var composerPlaceholder: Color { palette.composerPlaceholder.color }
    static var composerMic: Color { palette.composerMic.color }
    /// The approval / question card ("Approval needed").
    static var attentionSurface: Color { palette.attentionSurface.color }
    static var attentionBorder: Color { palette.attentionBorder.color }
    static var attentionText: Color { palette.attentionText.color }
    static var attentionSecondary: Color { palette.attentionSecondary.color }

    // MARK: Type (SF Pro at the measured sizes; no Dynamic Type)
    enum Font {
        /// Chat bubble, profile rows, composer: 14 regular, 18.1 line pitch.
        static var body: SwiftUI.Font { Theme.font(14) }
        static var bodyMedium: SwiftUI.Font { Theme.font(14, .medium) }
        /// Settings rows.
        static var rowTitle: SwiftUI.Font { Theme.font(13.5) }
        static var headerTitle: SwiftUI.Font { Theme.font(13.5, .medium) }
        static var buttonLabel: SwiftUI.Font { Theme.font(13.5, .semibold) }
        /// Settings subtitles, section labels and footers.
        static var label: SwiftUI.Font { Theme.font(11) }
        static var labelMedium: SwiftUI.Font { Theme.font(11, .medium) }
        /// Profile section labels, footers and two-line subtitles.
        static var profileLabel: SwiftUI.Font { Theme.font(12) }
        static var roleChip: SwiftUI.Font { Theme.font(12, .medium) }
        static var time: SwiftUI.Font { Theme.font(11.5) }
        static var preview: SwiftUI.Font { Theme.font(12.5) }
        static var tab: SwiftUI.Font { Theme.font(13) }
        static var profileName: SwiftUI.Font { Theme.font(18, .semibold) }
        static var code: SwiftUI.Font { Theme.mono(12) }
        static var timestamp: SwiftUI.Font { Theme.font(11) }
        static var appName: SwiftUI.Font { Theme.font(17) }
    }

    /// The skin's face at a measured size: SF Pro (Black and most skins), New
    /// York for the serif choice, Verdana standing in for MS Sans Serif on
    /// Hibou 98 (a touch smaller, as Tahoma sets tighter).
    static func font(_ size: CGFloat, _ weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
        switch ThemeRuntime.typeface {
        case .system:
            // Geist on every skin that does not impose a face, iPhone and iPad.
            if DesktopFonts.available { return DesktopFonts.geist(size, weight) }
            return .system(size: size, weight: weight)
        case .serif: return .system(size: size, weight: weight, design: .serif)
        case .retro:
            let bold = weight == .semibold || weight == .bold || weight == .heavy || weight == .black
            return .custom(bold ? "Verdana-Bold" : "Verdana", size: size * 0.9)
        }
    }

    /// Code and monospaced text: Geist Mono, system monospaced behind it.
    /// Hibou 98 keeps the era's monospace.
    static func mono(_ size: CGFloat, _ weight: SwiftUI.Font.Weight = .regular) -> SwiftUI.Font {
        if ThemeRuntime.typeface == .retro { return .system(size: size, weight: weight, design: .monospaced) }
        return DesktopFonts.geistMono(size, weight)
    }

    /// Body text renders at a 16.7 pt natural line; the reference pitch is 18.1.
    static let bodyLineSpacing: CGFloat = 1.4

    // MARK: Geometry
    enum Metric {
        static let screenEdge: CGFloat = 18
        static let controlGap: CGFloat = 8
        static let glassLarge: CGFloat = 44
        static let glassSheet: CGFloat = 42
        static let glassSmall: CGFloat = 38
        static var cardRadius: CGFloat { Theme.palette.bevelled ? 0 : 16 }
        static var bubbleRadius: CGFloat { Theme.palette.bevelled ? 0 : 20 }
        static let rowInset: CGFloat = 17.5
        static let rowHeight: CGFloat = 44.5
        static let toggleRowHeight: CGFloat = 53.67
        static let subtitleRowHeight: CGFloat = 61
        static let cardGap: CGFloat = 27
        static let sheetInset: CGFloat = 8
        /// Circle fits are 37/50; continuous corners render about 12% rounder.
        static var sheetTopRadius: CGFloat { Theme.palette.bevelled ? 0 : 33 }
        static var sheetBottomRadius: CGFloat { Theme.palette.bevelled ? 0 : 44 }
        static let chipHeight: CGFloat = 19
        static var chipRadius: CGFloat { Theme.palette.bevelled ? 0 : 6.3 }
        static var menuRadius: CGFloat { Theme.palette.bevelled ? 0 : 28 }
        /// The top scroll-edge fade runs over the header height.
        static let scrollEdgeHeight: CGFloat = 80
    }

    /// The chat screen (02), in points.
    enum Chat {
        /// Assistant bubble: x 16 to 349 on a 402 pt screen.
        static let bubbleLeading: CGFloat = 16
        /// The far side keeps 53 pt free: 16 pt margin plus this spacer.
        static let bubbleTrailingGap: CGFloat = 37
        static let bubblePaddingH: CGFloat = 14
        static let bubblePaddingV: CGFloat = 10
        /// Extra space between paragraphs and list items.
        static let paragraphSpacing: CGFloat = 9.21
        /// Bullet: 5 pt dot 5 pt in from the text column, text at +26.
        static let bulletDot: CGFloat = 5
        static let bulletDotInset: CGFloat = 5
        static let bulletIndent: CGFloat = 26
        /// Name capsule: 12 pt leading, 24 pt mascot, 10 pt gap, 15 pt trailing.
        static let capsuleMascot: CGFloat = 24
        /// Composer row: 12 pt from each edge of the safe area, 30 pt above
        /// the bottom. The chat bar of the reference app runs almost the full
        /// width, its "+" and its field 12 pt from the edges with the
        /// keyboard open or closed (owner, 2026-10-18: "la chatbar est pas
        /// assez large"). The earlier 29.3 pt (measure-chat-profile.md) left
        /// the bar narrow on every phone.
        static let composerMargin: CGFloat = 12
        static let composerBottom: CGFloat = 30
        static let composerGap: CGFloat = 9.6
        /// The white voice / send capsule inside the field.
        static let voiceCapsule = CGSize(width: 36, height: 28)
        /// The fade under the top bar ends here (screen y).
        static let edgeFadeEnd: CGFloat = 130
    }

    /// Circle-fit radii from the measurements, converted to `.continuous`.
    static func continuous(_ fitted: CGFloat) -> CGFloat { fitted * 0.88 }
}

// MARK: - Profile (measure-chat-profile.md §3, §4)

extension Theme {
    /// The bot profile (03, 04, 07 to 10) and the routine screens (05, 06),
    /// in points. Card-relative x values are measured from the card edge.
    enum Profile {
        /// Cards sit 24 pt from the screen edges on the profile, 16 on the
        /// routine screens.
        static let cardMargin: CGFloat = 24
        static let routineMargin: CGFloat = 16
        /// Text starts 18 pt into a card.
        static let textInset: CGFloat = 18
        /// Leading icons are centred 30 pt into the card; the text column
        /// beside them starts 52.7 pt in.
        static let iconCentre: CGFloat = 30
        static let iconColumn: CGFloat = 52
        /// The chevron's ink ends 22.3 pt from the card's trailing edge.
        static let chevronTrailing: CGFloat = 22.3
        /// Rows without the 1 pt divider.
        static let row: CGFloat = 45.3
        static let singleRow: CGFloat = 46.3
        static let routineRow: CGFloat = 63.3
        static let linkRow: CGFloat = 77
        static let fileRow: CGFloat = 45.67
        static let toggleRow: CGFloat = 56
        static let mascot: CGFloat = 84
        static let mascotTop: CGFloat = 133.3
        static let nameRow: CGFloat = 49.7
        static let roleRow: CGFloat = 42.6
        static let tabUnderline: CGFloat = 64.7
        static let mediaTile: CGFloat = 173
        static let mediaGap: CGFloat = 8
        /// Space between a card and the next element, and from a label's
        /// line box to its card.
        static let cardGap: CGFloat = 16
        static let labelToCard: CGFloat = 8.7
        static let footerTop: CGFloat = 8
        /// "Show more" sits about 29 pt under its card (cap top 32.7).
        static let showMoreTop: CGFloat = 29.3
        static let toggle = CGSize(width: 63, height: 28)
        /// The "..." glass menu: 250 pt wide, radius 32, 36 pt row pitch.
        static let menuWidth: CGFloat = 250
        static let menuRadius: CGFloat = 32
        static let menuRowPitch: CGFloat = 36.2
        static let menuIconColumn: CGFloat = 30.3
        static let menuTextColumn: CGFloat = 59.3
        /// Section labels, footers and subtitles: "12 pt" measures 11.53 by ink width.
        static let labelFont = SwiftUI.Font.system(size: 11.53)
    }

    /// Links, "Reset to default", "Add routine", "Share as Template".
    static var accentText: Color { palette.accentText.color }
    /// "Show more" under a profile list.
    static var showMore: Color { palette.showMore.color }
    /// The "..." glass menu body over the dark card.
    static var menuGlass: Color { palette.menuGlass.color }
}

// MARK: - Preferences

extension PrefKey {
    /// The earlier Appearance keys, read once to migrate (ThemeStore).
    static let appearanceMode = "companion.prefs.appearanceMode"
    static let appearanceTone = "companion.prefs.appearanceTone"
    /// On by default; read by `Haptics` before every generator fires.
    static let haptics = "companion.prefs.haptics"
}

// MARK: - Glass

/// The measured glass: a #333333 body, a bright 1 px rim top and bottom and a
/// dark hairline at the sides. On iOS 26 the system Liquid Glass supplies
/// refraction and the rim; the fill under it is tinted so the flat centre
/// reads #333333 over the dark background, as in the references.
struct ThemeGlass<S: InsettableShape>: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let shape: S
    var fill: Color = Theme.glassFill
    var interactive: Bool = true

    func body(content: Content) -> some View {
        if Theme.palette.bevelled {
            // Hibou 98: a raised grey button, square, bevelled.
            content
                .background(fill)
                .overlay(RetroBevel())
        } else if #available(iOS 26.0, *) {
            content
                .background(fill.opacity(0.92), in: shape)
                .glassEffect(interactive ? .clear.interactive() : .clear, in: shape)
        } else {
            content
                .background(fill, in: shape)
                .overlay(ThemeGlassRim(shape: shape))
        }
    }
}

/// The 98.css bevel: white and light grey on the top-left, black and dark
/// grey on the bottom-right (`--r98-raised`), or the reverse when sunken.
struct RetroBevel: View {
    @Environment(\.themePalette) var themePalette
    var sunken = false

    var body: some View {
        let light = sunken ? Color(hex: 0x0A0A0A) : Color.white
        let lightInner = sunken ? Color(hex: 0x808080) : Color(hex: 0xDFDFDF)
        let dark = sunken ? Color.white : Color(hex: 0x0A0A0A)
        let darkInner = sunken ? Color(hex: 0xDFDFDF) : Color(hex: 0x808080)
        GeometryReader { proxy in
            let w = proxy.size.width, h = proxy.size.height
            Path { p in
                p.move(to: CGPoint(x: 0.5, y: h)); p.addLine(to: CGPoint(x: 0.5, y: 0.5)); p.addLine(to: CGPoint(x: w, y: 0.5))
            }.stroke(light, lineWidth: 1)
            Path { p in
                p.move(to: CGPoint(x: 1.5, y: h - 1)); p.addLine(to: CGPoint(x: 1.5, y: 1.5)); p.addLine(to: CGPoint(x: w - 1, y: 1.5))
            }.stroke(lightInner, lineWidth: 1)
            Path { p in
                p.move(to: CGPoint(x: 0, y: h - 0.5)); p.addLine(to: CGPoint(x: w - 0.5, y: h - 0.5)); p.addLine(to: CGPoint(x: w - 0.5, y: 0))
            }.stroke(dark, lineWidth: 1)
            Path { p in
                p.move(to: CGPoint(x: 1, y: h - 1.5)); p.addLine(to: CGPoint(x: w - 1.5, y: h - 1.5)); p.addLine(to: CGPoint(x: w - 1.5, y: 1))
            }.stroke(darkInner, lineWidth: 1)
        }
        .allowsHitTesting(false)
    }
}

/// The fallback rim: light at the top and bottom edges, dark at the sides.
struct ThemeGlassRim<S: InsettableShape>: View {
    @Environment(\.themePalette) var themePalette
    let shape: S

    var body: some View {
        ZStack {
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: Theme.glassRimLight, location: 0),
                        .init(color: Theme.glassRimLight.opacity(0), location: 0.1),
                        .init(color: Theme.glassRimLight.opacity(0), location: 0.9),
                        .init(color: Theme.glassRimLight, location: 1),
                    ],
                    startPoint: .top, endPoint: .bottom
                ),
                lineWidth: 1
            )
            shape.strokeBorder(
                LinearGradient(
                    stops: [
                        .init(color: Theme.glassRimDark, location: 0),
                        .init(color: Theme.glassRimDark.opacity(0), location: 0.12),
                        .init(color: Theme.glassRimDark.opacity(0), location: 0.88),
                        .init(color: Theme.glassRimDark, location: 1),
                    ],
                    startPoint: .leading, endPoint: .trailing
                ),
                lineWidth: 0.5
            )
        }
        .allowsHitTesting(false)
    }
}

extension View {
    func themeGlass<S: InsettableShape>(_ shape: S, fill: Color = Theme.glassFill, interactive: Bool = true) -> some View {
        modifier(ThemeGlass(shape: shape, fill: fill, interactive: interactive))
    }
}

/// A round glass button: 44 pt on screens, 42 in sheets, 38 on the computer.
struct GlassCircleButton: View {
    @Environment(\.themePalette) var themePalette
    enum Size: CGFloat {
        case large = 44, sheet = 42, small = 38
        /// Glyphs are 17 to 20 pt medium in the references.
        var glyph: CGFloat {
            switch self {
            case .large: 19
            case .sheet: 17
            case .small: 16
            }
        }
    }

    let systemImage: String
    var size: Size = .large
    var fill: Color = Theme.glassFill
    var accessibilityLabel: LocalizedStringKey?
    /// A measured glyph size and optical offset, when a screen's reference
    /// differs from the size default.
    var glyphSize: CGFloat?
    var glyphOffset: CGSize = .zero
    /// The references draw the X lighter than the other glyphs.
    var weight: Font.Weight?
    /// The glyph's ink; the skin's text colour unless a stage has its own
    /// (the computer's black stage keeps white).
    var glyphColor: Color?
    let action: () -> Void

    var body: some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            Image(systemName: systemImage)
                .font(.system(size: glyphSize ?? size.glyph, weight: weight ?? (systemImage == "xmark" ? .regular : .medium)))
                .foregroundStyle(glyphColor ?? Theme.textPrimary)
                .offset(glyphOffset)
                .frame(width: size.rawValue, height: size.rawValue)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle(), fill: fill)
        .accessibilityLabel(accessibilityLabel.map { Text($0) } ?? Text(systemImage))
    }
}

/// A glass capsule holding arbitrary content (name pill, search field,
/// "N installed"). Height defaults to the 44 pt control height.
struct GlassCapsule<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    var height: CGFloat = Theme.Metric.glassLarge
    var horizontalPadding: CGFloat = 14
    var fill: Color = Theme.glassFill
    @ViewBuilder let content: () -> Content

    var body: some View {
        HStack(spacing: 10, content: content)
            .padding(.horizontal, horizontalPadding)
            .frame(height: height)
            .themeGlass(Capsule(), fill: fill)
    }
}

/// The light capsule action ("Next", "Create"): grey glass while disabled.
struct CapsuleActionButton: View {
    @Environment(\.themePalette) var themePalette
    let title: LocalizedStringKey
    var enabled: Bool
    var height: CGFloat = 44
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(Theme.Font.buttonLabel)
                .foregroundStyle(enabled ? Theme.primaryInk : Theme.disabledCapsuleText)
                .padding(.horizontal, 14)
                .frame(maxWidth: .infinity)
                .frame(height: height)
                .background(enabled ? Theme.primaryFill : Theme.disabledCapsule, in: Capsule())
                .overlay(Capsule().strokeBorder(Theme.palette.isDark ? Color.white.opacity(0.35) : Theme.hairline, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

// MARK: - Cards

/// A grouped card: #202020, radius 16, rows separated by a hairline inset to
/// the text column.
struct CardSection<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    var horizontalMargin: CGFloat = 23.17
    @ViewBuilder let content: () -> Content

    var body: some View {
        VStack(spacing: 0, content: content)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .overlay { if Theme.palette.bevelled { RetroBevel(sunken: true) } }
            .padding(.horizontal, horizontalMargin)
    }
}

/// The 1 pt divider between rows: from the text column to the trailing edge.
struct CardHairline: View {
    @Environment(\.themePalette) var themePalette
    var leadingInset: CGFloat = Theme.Metric.rowInset

    var body: some View {
        Rectangle()
            .fill(Theme.hairline)
            .frame(height: 1)
            .padding(.leading, leadingInset)
    }
}

/// One row of a card. The accessory decides the trailing side; the style
/// decides the title colour.
struct CardRow: View {
    @Environment(\.themePalette) var themePalette
    enum Accessory {
        case none
        case chevron
        case value(String)
        case valueChevron(String)
        case toggle(Binding<Bool>)
        case check
    }

    enum Style { case normal, destructive, action }

    let title: LocalizedStringKey
    var subtitle: LocalizedStringKey?
    var systemImage: String?
    var accessory: Accessory = .none
    var style: Style = .normal
    var action: (() -> Void)?

    private var titleColor: Color {
        switch style {
        case .normal: Theme.textPrimary
        case .destructive: Theme.destructive
        case .action: Theme.blue
        }
    }

    private var iconColor: Color {
        switch style {
        case .normal: Theme.iconGrey
        case .destructive: Theme.destructive
        case .action: Theme.blue
        }
    }

    private var minHeight: CGFloat {
        if subtitle != nil { return Theme.Metric.subtitleRowHeight }
        if case .toggle = accessory { return Theme.Metric.toggleRowHeight }
        return Theme.Metric.rowHeight
    }

    var body: some View {
        let row = HStack(alignment: subtitle == nil ? .center : .top, spacing: 0) {
            if let systemImage {
                Image(systemName: systemImage)
                    .font(.system(size: 15))
                    .foregroundStyle(iconColor)
                    .frame(width: 18)
                    .padding(.trailing, 9.3)
            }
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(Theme.Font.rowTitle)
                    .foregroundStyle(titleColor)
                if let subtitle {
                    Text(subtitle)
                        .font(Theme.Font.label)
                        .foregroundStyle(Theme.textSecondary)
                        .lineSpacing(1)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing
        }
        .padding(.leading, Theme.Metric.rowInset)
        .padding(.trailing, 17.2)
        .padding(.vertical, subtitle == nil ? 0 : 14)
        .frame(minHeight: minHeight)
        .contentShape(Rectangle())

        if let action {
            Button {
                Haptics.selection()
                action()
            } label: { row }
            .buttonStyle(.plain)
        } else {
            row
        }
    }

    @ViewBuilder private var trailing: some View {
        switch accessory {
        case .none:
            EmptyView()
        case .chevron:
            chevron
        case let .value(text):
            Text(text).font(Theme.Font.rowTitle).foregroundStyle(Theme.textSecondary)
        case let .valueChevron(text):
            HStack(spacing: 15) {
                Text(text).font(Theme.Font.rowTitle).foregroundStyle(Theme.textSecondary)
                chevron
            }
        case let .toggle(binding):
            Toggle("", isOn: binding)
                .labelsHidden()
                .toggleStyle(ParityToggleStyle())
        case .check:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Theme.textPrimary)
        }
    }

    private var chevron: some View {
        Image(systemName: "chevron.right")
            .font(.system(size: 14, weight: .semibold))
            .foregroundStyle(Theme.chevron)
            .padding(.trailing, 4)
    }
}

/// The iOS 26 switch as measured: 60x27 track, white pill knob 35x23.
/// The knob is white in both states and its side says on or off; the track
/// holds 3:1 with the knob and the surface, through an edge when needed.
struct ParityToggleStyle: ToggleStyle {
    @Environment(\.themePalette) var themePalette
    @Environment(\.isEnabled) private var isEnabled
    /// Re-reads the colours when a bot's chat opens or closes.
    @ObservedObject private var themeStore = ThemeStore.shared
    var width: CGFloat = 60.33
    var height: CGFloat = 26.67

    func makeBody(configuration: Configuration) -> some View {
        let knobWidth = width * 0.586
        let knobHeight = height - 4
        let edge = configuration.isOn ? Theme.toggleOnEdge : Theme.toggleOffEdge
        Button {
            Haptics.selection()
            withAnimation(.easeOut(duration: 0.22)) { configuration.isOn.toggle() }
        } label: {
            ZStack(alignment: configuration.isOn ? .trailing : .leading) {
                Capsule().fill(configuration.isOn ? Theme.toggleOn : Theme.toggleOff)
                if let edge {
                    Capsule().strokeBorder(edge, lineWidth: 1.5)
                }
                Capsule()
                    .fill(Theme.toggleKnob)
                    .shadow(color: .black.opacity(0.25), radius: 1, y: 1)
                    .frame(width: knobWidth, height: knobHeight)
                    .padding(2)
            }
            .frame(width: width, height: height)
            // disabled: dimmed, the knob keeps its side
            .opacity(isEnabled ? 1 : 0.55)
        }
        .buttonStyle(.plain)
        .accessibilityValue(configuration.isOn ? Text("On") : Text("Off"))
    }
}

/// "Bot", "Switch Account": grey 11 pt above a card.
struct SectionLabel: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey
    var leading: CGFloat = 41.67

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, leading)
            .padding(.bottom, 7)
    }
}

/// The grey explanation under a card.
struct Footer: View {
    @Environment(\.themePalette) var themePalette
    let text: LocalizedStringKey
    var leading: CGFloat = 41.67

    var body: some View {
        Text(text)
            .font(Theme.Font.label)
            .foregroundStyle(Theme.textTertiary)
            .lineSpacing(2)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, leading)
            .padding(.trailing, 40)
            .padding(.top, 7)
    }
}

/// The role beside a name: 19 pt high, radius 6.3, not a capsule.
struct RoleChip: View {
    @Environment(\.themePalette) var themePalette
    let text: String
    /// The home list's chips ink a touch narrower than 12 pt medium.
    var font: Font = Theme.Font.roleChip
    var horizontalPadding: CGFloat = 6.7

    var body: some View {
        Text(text)
            .font(font)
            .foregroundStyle(Theme.chipText)
            .lineLimit(1)
            .padding(.horizontal, horizontalPadding)
            .frame(height: Theme.Metric.chipHeight)
            .background(Theme.chip, in: RoundedRectangle(cornerRadius: Theme.Metric.chipRadius, style: .continuous))
    }
}

// MARK: - Card sheet

/// The floating card sheet (Settings, Create bot): inset 8 pt from the
/// screen, about 37 pt top and 50 pt bottom corners, over the home dimmed by
/// black at 50%. The home is not scaled or blurred.
struct CardSheetContainer<Content: View>: View {
    @Environment(\.themePalette) var themePalette
    var topOffset: CGFloat = 123.67
    var background: Color = Theme.bg
    let onDismiss: () -> Void
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack(alignment: .top) {
            Theme.dim
                .ignoresSafeArea()
                .onTapGesture(perform: onDismiss)
            content()
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                .background(background)
                .clipShape(CardSheetShape(
                    topRadius: Theme.Metric.sheetTopRadius,
                    bottomRadius: Theme.Metric.sheetBottomRadius
                ))
                .padding(.horizontal, Theme.Metric.sheetInset)
                .padding(.top, topOffset)
                .padding(.bottom, Theme.Metric.sheetInset)
                .ignoresSafeArea()
        }
    }
}

/// Different radii at the top and bottom, continuous at every corner.
struct CardSheetShape: Shape {
    var topRadius: CGFloat
    var bottomRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        if #available(iOS 17.0, *) {
            return UnevenRoundedRectangle(
                topLeadingRadius: topRadius,
                bottomLeadingRadius: bottomRadius,
                bottomTrailingRadius: bottomRadius,
                topTrailingRadius: topRadius,
                style: .continuous
            ).path(in: rect)
        }
        return RoundedRectangle(cornerRadius: topRadius, style: .continuous).path(in: rect)
    }
}

// MARK: - Scroll edge

/// Content scrolled under a header fades into the background over about the
/// header height. On iOS 26 the system soft edge effect is used as well.
struct TopScrollEdgeFade: ViewModifier {
    @Environment(\.themePalette) var themePalette
    var height: CGFloat = Theme.Metric.scrollEdgeHeight
    var background: Color = Theme.bg
    /// A full-screen list reaches under the status bar; a sheet (settings)
    /// starts below it, so its fade must start at the sheet's own top edge,
    /// or the sheet's clip leaves only the gradient's tail over the header.
    var underStatusBar = true

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content
                .scrollEdgeEffectStyle(.soft, for: .top)
                .overlay(alignment: .top) { fade }
        } else {
            content.overlay(alignment: .top) { fade }
        }
    }

    /// `height` is measured from the safe area's top (the header's band).
    /// Under the status bar, the band above it is the background itself.
    /// The gradient used to be moved up into the status bar at its fixed
    /// height, so it covered the status bar alone and rows scrolled sharp
    /// under the header's buttons (#4041).
    private var fade: some View {
        LinearGradient(
            stops: [
                .init(color: background, location: 0),
                .init(color: background.opacity(0.82), location: 0.23),
                .init(color: background.opacity(0.64), location: 0.58),
                .init(color: background.opacity(0.18), location: 0.96),
                .init(color: background.opacity(0), location: 1),
            ],
            startPoint: .top, endPoint: .bottom
        )
        .frame(height: height)
        .background(alignment: .top) {
            if underStatusBar {
                // zero high at the safe area's top, grown up to the screen's edge
                Color.clear.frame(height: 0).background(background.ignoresSafeArea(edges: .top))
            }
        }
        .allowsHitTesting(false)
    }
}

extension View {
    func topScrollEdgeFade(height: CGFloat = Theme.Metric.scrollEdgeHeight, background: Color = Theme.bg, underStatusBar: Bool = true) -> some View {
        modifier(TopScrollEdgeFade(height: height, background: background, underStatusBar: underStatusBar))
    }
}

// MARK: - Gallery

#if DEBUG
/// Every building block on one screen, for review and for the parity harness
/// (`-parityScreen theme-gallery`).
struct ThemeGalleryView: View {
    @Environment(\.themePalette) var themePalette
    @State private var toggleA = true
    @State private var toggleB = false
    @State private var showingSheet = false
    @AppStorage(PrefKey.haptics) private var haptics = true
    @ObservedObject private var themes = ThemeStore.shared

    var body: some View {
        ZStack {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HStack(spacing: Theme.Metric.controlGap) {
                        GlassCircleButton(systemImage: "chevron.left") {}
                        Spacer()
                        GlassCircleButton(systemImage: "magnifyingglass") {}
                        GlassCircleButton(systemImage: "plus") {}
                    }
                    .padding(.horizontal, Theme.Metric.screenEdge)

                    HStack(spacing: 12) {
                        GlassCircleButton(systemImage: "xmark", size: .sheet) {}
                        GlassCircleButton(systemImage: "keyboard", size: .small) {}
                        GlassCapsule {
                            Circle().fill(Color.purple).frame(width: 24, height: 24)
                            Text(verbatim: "Ara").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                        }
                    }
                    .padding(.horizontal, Theme.Metric.screenEdge)
                    .padding(.top, 16)

                    HStack(spacing: 8) {
                        Text(verbatim: "Aurora").font(Theme.Font.bodyMedium).foregroundStyle(Theme.textPrimary)
                        RoleChip(text: "Finance Manager")
                        Spacer()
                        Text(verbatim: "3:41 PM").font(Theme.Font.time).foregroundStyle(Theme.textTertiary)
                    }
                    .padding(.horizontal, 23)
                    .padding(.vertical, 20)

                    CardSection {
                        CardRow(title: "Usage", accessory: .valueChevron("35%")) {}
                        CardHairline()
                        CardRow(title: "Plugins", subtitle: "Tools and skills for Sagax", accessory: .chevron) {}
                    }
                    .padding(.bottom, Theme.Metric.cardGap)

                    SectionLabel(text: "Bot")
                    CardSection {
                        CardRow(
                            title: "Auto-review",
                            subtitle: "Require approval for risky shell, MCP, and computer actions.",
                            accessory: .toggle($toggleA)
                        )
                        CardHairline()
                        CardRow(title: "Notifications", accessory: .toggle($toggleB))
                        CardHairline()
                        CardRow(title: "Haptics", accessory: .toggle($haptics))
                        CardHairline()
                        CardRow(title: "Time Zone", accessory: .value("America/Toronto"))
                    }
                    Footer(text: "The one computer your Bots share.")
                        .padding(.bottom, Theme.Metric.cardGap)

                    CardSection {
                        CardRow(title: "Update Computer", subtitle: "Rebuilds from the latest image and keeps /workspace.", style: .action) {}
                        CardHairline()
                        CardRow(title: "Delete Account", systemImage: "trash", style: .destructive) {}
                    }
                    .padding(.bottom, Theme.Metric.cardGap)

                    CardSection {
                        CardRow(title: "Appearance", accessory: .valueChevron(themes.selection.mode.rawValue)) {
                            themes.update { $0.mode = $0.mode == .fixed ? .system : .fixed }
                        }
                        CardHairline()
                        CardRow(title: "Show card sheet", accessory: .chevron) { showingSheet = true }
                    }

                    HStack(spacing: 12) {
                        CapsuleActionButton(title: "Next", enabled: false) {}
                        CapsuleActionButton(title: "Create", enabled: true) {}
                    }
                    .padding(.horizontal, 36)
                    .padding(.vertical, 24)
                }
                .padding(.top, 24)
            }
            .topScrollEdgeFade()

            if showingSheet {
                CardSheetContainer(onDismiss: { showingSheet = false }) {
                    VStack(alignment: .leading) {
                        GlassCircleButton(systemImage: "xmark", size: .sheet) { showingSheet = false }
                            .padding(17.33)
                        Spacer()
                    }
                }
            }
        }
    }
}
#endif

// MARK: - Computer (13, 11)

extension Theme {
    /// The computer view (measure-chat-profile.md §2): everything on black.
    enum Computer {
        /// Glass on black reads #1F1F1F to #272727.
        static let glassFill = Color(hex: 0x222222)
        /// The small circles' top rim.
        static let smallRim = Color(hex: 0x626262)
        static let toastText = Color(hex: 0xF9F9F9)
        static let toastIcon = Color(hex: 0xF8F8F8)
        /// The frame's backdrop while no picture has arrived.
        static let frameEmpty = Color(hex: 0x111111)
        /// The frame: full width, 16:10, its top 76.7 pt under the bar's centre.
        static let frameAspect: CGFloat = 1.6
        static let frameTopFromBarCentre: CGFloat = 76.7
        /// 24 pt mascot 13.7 pt after the back circle, the name 10.6 pt after it.
        static let mascot: CGFloat = 24
        static let mascotLeading: CGFloat = 13.7
        static let nameLeading: CGFloat = 10.6
        /// "?" and "..." are 12 pt apart.
        static let trailingGap: CGFloat = 12
        /// Clipboard / keyboard circles end 27.7 pt above the visible keyboard (its frame starts 9.7 pt higher).
        static let buttonsBottom: CGFloat = 18
        /// The trackpad toast: 250 x 55.3, 8 pt from the right edge, from
        /// the top of the safe area; icon 30.3 pt in, label 14.7 pt after.
        static let toastSize = CGSize(width: 250, height: 55.3)
        static let toastTrailing: CGFloat = 8
        static let toastIconLeading: CGFloat = 30.3
        static let toastLabelGap: CGFloat = 14.7
        static let toastFont = SwiftUI.Font.system(size: 14)
        /// The "?" button seen through the toast: lens fill and glyph, and
        /// its centre from the toast's leading edge.
        static let toastLens = Color(hex: 0x363636)
        static let toastLensGlyph = Color(hex: 0x8A8A8A)
        static let toastLensCentre: CGFloat = 162
    }
}

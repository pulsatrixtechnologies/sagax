// Settings > Appearance: which skin the phone wears, and the one modifier
// that applies it everywhere (`ThemeRoot`).
//
// The choice is per device (UserDefaults). "Same as my computer" reads the
// computer's omb-skin and omb-font (CompanionClient.computerAppearance) and,
// while it is on, a skin picked here is written back to the computer.
import SwiftUI
import UIKit
import CompanionCore
import WidgetKit

/// The palette the `Theme` tokens answer with. Set by `ThemeRoot` before its
/// content is drawn; read on the main thread only.
enum ThemeRuntime {
    static var palette: SkinPalette = .black
    static var typeface: SkinTypeface = .system
    /// iPad: the skin's desktop face (Geist on Pulsatrix) for the system
    /// typeface, so the phone surfaces the iPad shows read like the desktop.
    /// Always false on the iPhone.
    static var desktopFace = false
}

private struct ThemePaletteKey: EnvironmentKey {
    static let defaultValue = SkinPalette.black
}

extension EnvironmentValues {
    /// The active skin. Every view declares it, so a skin change redraws the
    /// whole tree and the `Theme` tokens resolve to the new skin.
    var themePalette: SkinPalette {
        get { self[ThemePaletteKey.self] }
        set { self[ThemePaletteKey.self] = newValue }
    }
}

extension PrefKey {
    static let themeMode = "companion.prefs.theme.mode"
    static let themeFixed = "companion.prefs.theme.fixed"
    static let themeLight = "companion.prefs.theme.light"
    static let themeDark = "companion.prefs.theme.dark"
    static let themeFont = "companion.prefs.theme.font"
    static let themeComputerSkin = "companion.prefs.theme.computerSkin"
    static let themeComputerFont = "companion.prefs.theme.computerFont"
    /// Hibou 98 found on this phone (or on the computer).
    static let themeRetroUnlocked = "companion.prefs.theme.retroUnlocked"
}

@MainActor
final class ThemeStore: ObservableObject {
    static let shared = ThemeStore()

    @Published private(set) var selection: ThemeSelection
    @Published private(set) var retroUnlocked: Bool
    /// The computer's skin follows its system (`omb-skin-mode`), as last read.
    private var computerAuto = false
    /// Where the computer keeps its look, once read; nil before or when it has none.
    @Published private(set) var computerSource: ComputerAppearanceSource?
    @Published private(set) var computerError: String?

    private let defaults: UserDefaults
    /// A DEBUG launch override (`-paritySkin <id|system>`), never saved.
    private var launchOverride: ThemeSelection?

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        func skin(_ key: String) -> SkinID? { defaults.string(forKey: key).flatMap(SkinID.init(rawValue:)) }
        if let mode = defaults.string(forKey: PrefKey.themeMode).flatMap(ThemeMode.init(rawValue:)) {
            selection = ThemeSelection(
                mode: mode,
                fixedSkin: skin(PrefKey.themeFixed) ?? .black,
                lightSkin: skin(PrefKey.themeLight) ?? ThemeSelection.defaultLight,
                darkSkin: skin(PrefKey.themeDark) ?? ThemeSelection.defaultDark,
                font: defaults.string(forKey: PrefKey.themeFont).flatMap(SkinFontChoice.init(rawValue:)) ?? .skin,
                computerSkin: skin(PrefKey.themeComputerSkin),
                computerFont: defaults.string(forKey: PrefKey.themeComputerFont).flatMap(SkinFontChoice.init(rawValue:))
            )
        } else if UIDevice.current.userInterfaceIdiom == .pad,
                  defaults.string(forKey: PrefKey.appearanceMode) == nil,
                  defaults.string(forKey: PrefKey.appearanceTone) == nil {
            // An iPad that never chose a look wears the desktop's default
            // (Pulsatrix) in dark, as the desktop app it mirrors does.
            selection = ThemeSelection(mode: .system, darkSkin: .pulsatrix)
        } else {
            // The earlier System / Dark and Black / Dim, carried over once.
            selection = ThemeSelection.migrating(
                appearanceMode: defaults.string(forKey: PrefKey.appearanceMode),
                tone: defaults.string(forKey: PrefKey.appearanceTone)
            )
        }
        retroUnlocked = defaults.bool(forKey: PrefKey.themeRetroUnlocked)
        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-paritySkin"), index + 1 < arguments.count {
            let value = arguments[index + 1]
            if value == "system" {
                launchOverride = ThemeSelection(mode: .system, lightSkin: ThemeSelection.suggestedLight)
            } else if let skin = SkinID(rawValue: value) {
                launchOverride = ThemeSelection(mode: .fixed, fixedSkin: skin)
                if skin.secret { retroUnlocked = true }
            }
        }
        #endif
        writeShared(reload: false)
    }

    /// What decides the look now (a launch override wins in DEBUG).
    var effective: ThemeSelection { launchOverride ?? selection }

    func palette(deviceDark: Bool) -> SkinPalette { effective.skin(deviceDark: deviceDark).palette }

    func typeface(deviceDark: Bool) -> SkinTypeface {
        SkinTypeface.resolve(skin: effective.skin(deviceDark: deviceDark), font: effective.fontChoice())
    }

    /// The window's forced appearance: the pinned skin's own, or nil to
    /// follow the phone.
    var pinnedScheme: ColorScheme? {
        effective.pinsAppearance ? (effective.skin(deviceDark: true).isDark ? .dark : .light) : nil
    }

    func update(_ change: (inout ThemeSelection) -> Void) {
        var next = selection
        change(&next)
        guard next != selection else { return }
        selection = next
        launchOverride = nil
        save()
    }

    /// Picks the skin for a slot. With "Same as my computer" on, the choice
    /// becomes the computer's too.
    func choose(_ skin: SkinID, client: CompanionClient?) {
        switch selection.mode {
        case .fixed: update { $0.fixedSkin = skin }
        case .system: update { skin.isDark ? ($0.darkSkin = skin) : ($0.lightSkin = skin) }
        case .computer:
            update { $0.computerSkin = skin }
            // a skin picked here is a fixed choice on the computer: its Auto ends
            computerAuto = false
            writeBack(client: client)
        }
    }

    func chooseFont(_ font: SkinFontChoice, client: CompanionClient?) {
        if selection.mode == .computer {
            update { $0.computerFont = font }
            // a font change keeps the computer's Auto
            writeBack(client: client)
        } else {
            update { $0.font = font }
        }
    }

    func unlockRetro() {
        retroUnlocked = true
        defaults.set(true, forKey: PrefKey.themeRetroUnlocked)
    }

    /// The hidden composer line toggles Hibou 98, as on the desktop
    /// (src/lib/retro98.ts). Off goes back to the phone's pair.
    func toggleRetro(client: CompanionClient?) {
        unlockRetro()
        // That same line summons Trombi (AchievementToaster.tsx, Composer.tsx).
        AchievementStore.shared.report(.trombiSummoned)
        if effective.skin(deviceDark: true) == .retro98 {
            update { $0.mode = $0.mode == .computer ? .computer : .system; if $0.computerSkin == .retro98 { $0.computerSkin = .pulsatrix } }
        } else if selection.mode == .computer {
            update { $0.computerSkin = .retro98 }
        } else {
            update { $0.mode = .fixed; $0.fixedSkin = .retro98 }
        }
        if selection.mode == .computer { writeBack(client: client) }
    }

    // MARK: The computer

    /// Reads the computer's look (computer mode, or to know whether it can be offered).
    func refreshFromComputer(client: CompanionClient?) async {
        guard let client else { return }
        do {
            guard let record = try await client.computerAppearance() else {
                computerSource = nil
                computerError = String(localized: "This computer does not share its appearance yet.")
                return
            }
            computerSource = record.source
            computerError = nil
            if record.appearance.retroUnlocked { unlockRetro() }
            computerAuto = record.appearance.auto
            if selection.mode == .computer {
                update {
                    $0.computerSkin = record.appearance.skin
                    $0.computerFont = record.appearance.font
                }
            }
        } catch {
            computerError = String(localized: "Could not reach the computer to read its appearance.")
        }
    }

    private func writeBack(client: CompanionClient?) {
        guard let client, let source = computerSource, let skin = selection.computerSkin else { return }
        let values = ComputerAppearance.preferences(skin: skin, font: selection.computerFont ?? .skin, retroUnlocked: retroUnlocked, auto: computerAuto)
        Task {
            do { try await client.saveComputerAppearance(values, to: source) } catch {
                computerError = String(localized: "Could not save the appearance on the computer.")
            }
        }
    }

    // MARK: Storage

    private func save() {
        let s = selection
        defaults.set(s.mode.rawValue, forKey: PrefKey.themeMode)
        defaults.set(s.fixedSkin.rawValue, forKey: PrefKey.themeFixed)
        defaults.set(s.lightSkin.rawValue, forKey: PrefKey.themeLight)
        defaults.set(s.darkSkin.rawValue, forKey: PrefKey.themeDark)
        defaults.set(s.font.rawValue, forKey: PrefKey.themeFont)
        defaults.set(s.computerSkin?.rawValue, forKey: PrefKey.themeComputerSkin)
        defaults.set(s.computerFont?.rawValue, forKey: PrefKey.themeComputerFont)
        writeShared()
    }

    /// The widgets, the Live Activity and the share extension read this.
    /// At launch it is only written (the widgets already drew with it);
    /// a change also asks WidgetKit to draw them again.
    private func writeShared(reload: Bool = true) {
        let e = effective
        SharedThemeKeys.write(e, resolvedFixed: e.pinsAppearance ? e.skin(deviceDark: true) : nil, to: SagaxSharedConfiguration.sharedDefaults)
        if reload { WidgetCenter.shared.reloadAllTimelines() }
    }
}

// MARK: - Root

/// Applied once at the root of every window: chooses the skin, publishes it
/// to the `Theme` tokens and the environment, pins the window's light or dark
/// when the skin does not follow the phone, and dresses UIKit to match.
struct ThemeRoot: ViewModifier {
    @ObservedObject private var store = ThemeStore.shared
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = store.palette(deviceDark: scheme == .dark)
        let typeface = store.typeface(deviceDark: scheme == .dark)
        ThemeRuntime.palette = palette
        ThemeRuntime.typeface = typeface
        ThemeRuntime.desktopFace = UIDevice.current.userInterfaceIdiom == .pad
            && DesktopTheme.of(palette.id).face == .geist && DesktopFonts.available
        return content
            .environment(\.themePalette, palette)
            .environment(\.mascotShadow, palette.mascotShadow)
            .modifier(ThemeTint(palette: palette))
            .background(palette.desktop.color.ignoresSafeArea())
            .overlay(alignment: .top) { if palette.bevelled { RetroDesktopStrip() } }
            .preferredColorScheme(store.pinnedScheme)
            .onAppear { ThemeUIKit.apply(palette) }
            .onValueChange(of: palette) { ThemeUIKit.apply($0) }
    }
}

/// Black keeps the system tint the references were measured with; every
/// other skin tints controls with its accent, as the desktop does. One
/// modifier with an optional tint, never an `if`: a branch here would give
/// the whole app a new identity on a skin change and drop every view's state
/// (the open settings sheet, the navigation stack).
private struct ThemeTint: ViewModifier {
    let palette: SkinPalette

    func body(content: Content) -> some View {
        content.tint(palette.id == .black || palette.id == .dim ? nil : palette.accent.color)
    }
}

/// Hibou 98: the teal desktop shows above the window, in the status bar.
private struct RetroDesktopStrip: View {
    var body: some View {
        Color.clear
            .frame(height: 0)
            .background(alignment: .bottom) {
                Color(hex: 0x008080).ignoresSafeArea(edges: .top)
            }
            .overlay(alignment: .bottom) { Color.white.frame(height: 1) }
            .allowsHitTesting(false)
    }
}

/// For a window drawn above the app (the unlock banner's): the same skin in
/// the environment and the same tint, but no background, no pinned light or
/// dark and no UIKit dressing. The window stays transparent and the app
/// below stays visible.
struct ThemeOverlayRoot: ViewModifier {
    @ObservedObject private var store = ThemeStore.shared
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let palette = store.palette(deviceDark: scheme == .dark)
        return content
            .environment(\.themePalette, palette)
            .environment(\.mascotShadow, palette.mascotShadow)
            .modifier(ThemeTint(palette: palette))
            .preferredColorScheme(store.pinnedScheme)
    }
}

extension View {
    func themeRoot() -> some View { modifier(ThemeRoot()) }
    /// The skin for an overlay window: see `ThemeOverlayRoot`.
    func themeOverlay() -> some View { modifier(ThemeOverlayRoot()) }
}

/// The UIKit chrome SwiftUI does not reach: navigation and tab bars in the
/// legacy screens, switches, the window tint. Status bar and keyboard follow
/// the window's light or dark, which `ThemeRoot` pins to the skin (the
/// keyboard's appearance is not an appearance-proxy property: setting it on
/// UITextView.appearance() aborts).
enum ThemeUIKit {
    @MainActor
    static func apply(_ palette: SkinPalette) {
        let background = palette.bg.uiColor
        let text = palette.textPrimary.uiColor

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = background
        nav.shadowColor = palette.hairline.uiColor
        nav.titleTextAttributes = [.foregroundColor: text]
        nav.largeTitleTextAttributes = [.foregroundColor: text]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = background
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        // Black and Dim keep the measured #68CE67; other skins use their accent.
        UISwitch.appearance().onTintColor = palette.toggleOn.uiColor
        UITableView.appearance().backgroundColor = background

        let tint: UIColor? = (palette.id == .black || palette.id == .dim) ? nil : palette.accent.uiColor
        for scene in UIApplication.shared.connectedScenes {
            guard let windowScene = scene as? UIWindowScene else { continue }
            // An overlay window (the unlock banner's) stays transparent.
            for window in windowScene.windows where !(window is PassthroughWindow) {
                window.tintColor = tint
                window.backgroundColor = palette.desktop.uiColor
            }
        }
    }
}

// iPad Settings > Appearance > Skin, in the desktop's model (SkinPicker,
// src/lib/skin-families.ts, 2026-10-19) as the iPhone's picker since #1126:
// one card per family drawn in the variant it would wear, then the worn
// family's variants as swatches in the desktop's rows (Colour, Duo-tone,
// Mood, Edition), Intensity, Texture and Mode (Light, Dark or Auto).
//
// The choice is the iPhone's (`ThemeSelection.choosing`, `ThemeStore.choose`
// with a tint): in "Same as my computer" a pick is saved on the computer, else
// on this iPad. The cards keep `DesktopSkinCard`'s miniature, in the variant's
// own tokens (`DesktopTheme.of(look.palette)`).
import SwiftUI
import CompanionCore

struct DesktopSkinFamilies: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var themes = ThemeStore.shared
    /// The iPad's own light or dark (Auto follows it).
    @Environment(\.colorScheme) private var colorScheme

    private var selection: ThemeSelection { themes.effective }
    private var client: CompanionClient? { session.settingsClient }

    var body: some View {
        let state = current
        VStack(alignment: .leading, spacing: 4) {
            DesktopSkinFamilyGrid(families: families, state: state, depth: depth, texture: texture) { family, variant in
                wear(variant, mode: ThemeSelection.carry(state.mode, to: variant, worn: state.place.scheme))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            VStack(alignment: .leading, spacing: 0) {
                let offered = state.place.family.variants(for: state.place.scheme, keeping: state.place.variant)
                if offered.count > 1 {
                    ForEach(SkinVariantGroup.allCases, id: \.self) { group in
                        let variants = offered.filter { $0.group == group }
                        if !variants.isEmpty {
                            row(title: state.place.family.id == .phone ? Text("Variant") : Text(LocalizedStringKey(group.name))) {
                                SwatchFlow(spacing: 6) {
                                    ForEach(variants) { variant in swatch(variant, state: state) }
                                }
                            }
                        }
                    }
                }
                if state.place.variant.hasDepth {
                    row(title: Text(LocalizedStringKey(SkinDepth.label))) {
                        DesktopPillSelect(
                            options: SkinDepth.allCases.map { ($0, AppStrings.localized($0 == .full ? "Full (intensity)" : $0.name)) },
                            selection: depth,
                            label: Text(LocalizedStringKey(SkinDepth.label)),
                            identifier: "desktop-settings.skin-depth"
                        ) { themes.chooseDepth($0, client: client) }
                    }
                }
                if state.place.family.id != .retro98 {
                    row(title: Text(LocalizedStringKey(SkinTexture.label))) {
                        DesktopPillSelect(
                            options: SkinTexture.allCases.map { ($0, AppStrings.localized($0.name)) },
                            selection: texture,
                            label: Text(LocalizedStringKey(SkinTexture.label)),
                            identifier: "desktop-settings.skin-texture"
                        ) { themes.chooseTexture($0, client: client) }
                    }
                }
                row(title: Text("Mode")) {
                    let variant = state.place.variant
                    let modes: [SkinModeChoice] = selection.mode == .computer ? [.light, .dark] : SkinModeChoice.allCases
                    DesktopPillSelect(
                        options: modes.filter { mode in
                            mode == state.mode || (mode == .auto ? variant.followsSystem : variant.schemes.contains(mode == .light ? .light : .dark))
                        }.map { ($0, AppStrings.localized(modeTitle($0))) },
                        selection: state.mode,
                        label: Text("Mode"),
                        identifier: "desktop-settings.skin-mode"
                    ) { wear(variant, mode: $0) }
                }
            }
        }
        .accessibilityIdentifier("desktop-settings.skin-families")
    }

    private func modeTitle(_ mode: SkinModeChoice) -> String {
        switch mode {
        case .light: "Light"
        case .dark: "Dark"
        case .auto: "Auto (follow the iPad)"
        }
    }

    /// One setting under the cards: its name, then its control on the right.
    private func row<Control: View>(title: Text, @ViewBuilder control: @escaping () -> Control) -> some View {
        DesktopCompactRow(title, control: control)
    }

    private func swatch(_ variant: SkinVariant, state: (place: SkinPlace, mode: SkinModeChoice)) -> some View {
        let selected = variant == state.place.variant
        let scheme = variant.schemes.contains(state.place.scheme) ? state.place.scheme : (variant.schemes.first ?? .dark)
        let look = variant.look(scheme)
        let palette = look.palette
        let gradient = palette.accentGradient
        let flat = SkinVariants.swatch(skin: look.skin, tint: look.tint) ?? palette.accent
        return Button {
            guard !selected else { return }
            wear(variant, mode: ThemeSelection.carry(state.mode, to: variant, worn: state.place.scheme))
        } label: {
            ZStack {
                // `var(--color-app)` of the variant's own skin, then its colour
                Circle().fill(DesktopTheme.of(look.skin).app)
                Circle().trim(from: 0, to: 0.5)
                    .fill(gradient.count > 1
                          ? AnyShapeStyle(LinearGradient(colors: gradient.map(\.color), startPoint: .topLeading, endPoint: .bottomTrailing))
                          : AnyShapeStyle(flat.color))
                    .rotationEffect(.degrees(-45))
            }
            .frame(width: 22, height: 22)
            // `ring-1 ring-hairline`, or once chosen `ring-2 ring-accent-border
            // ring-offset-2`: a 2 pt gap, then the ring, outside the swatch
            .overlay(Circle().strokeBorder(theme.hairline, lineWidth: 1).opacity(selected ? 0 : 1))
            .overlay(Circle().stroke(theme.accentBorder, lineWidth: 2).frame(width: 28, height: 28).opacity(selected ? 1 : 0))
            .padding(.vertical, 3)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(LocalizedStringKey(variant.name)))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("desktop-settings.skin-variant.\(variant.id)")
    }

    // MARK: The state, as the iPhone's picker reads it

    private var deviceDark: Bool { colorScheme == .dark }

    private var current: (place: SkinPlace, mode: SkinModeChoice) {
        if selection.mode == .computer {
            let place = SkinPlace.of(selection.computerSkin ?? .pulsatrix, tint: selection.computerTint)
            return (place, place.scheme == .light ? .light : .dark)
        }
        return selection.skinChoice(deviceDark: deviceDark)
    }

    /// The computer's families (the phone's own Black and Dim never were the
    /// iPad's desktop skins), Hibou 98 once unlocked or worn.
    private var families: [SkinFamily] {
        let worn = current.place.family.id
        let scheme = current.place.scheme
        return SkinFamily.all.filter { family in
            if family.id == .phone { return worn == .phone }
            if family.id != worn && family.variants(for: scheme).isEmpty { return false }
            return family.id != .retro98 || worn == .retro98 || themes.retroUnlocked
        }
    }

    private var depth: SkinDepth { selection.mode == .computer ? (selection.computerDepth ?? .accent) : selection.depth }
    private var texture: SkinTexture { selection.mode == .computer ? (selection.computerTexture ?? .none) : selection.texture }

    private func wear(_ variant: SkinVariant, mode: SkinModeChoice) {
        if selection.mode == .computer {
            let scheme: SkinScheme = mode == .light ? .light : .dark
            themes.choose(variant.skin(scheme), tint: variant.tint, client: client)
        } else {
            themes.update { $0 = $0.choosing(variant, mode: mode) }
        }
    }
}

/// The family cards (`grid-cols-[repeat(auto-fill, minmax(190px,1fr))] gap-3`),
/// each drawn in the variant it would wear now.
struct DesktopSkinFamilyGrid: View {
    let families: [SkinFamily]
    let state: (place: SkinPlace, mode: SkinModeChoice)
    let depth: SkinDepth
    let texture: SkinTexture
    let choose: (SkinFamily, SkinVariant) -> Void
    @State private var width: CGFloat = 606

    var body: some View {
        let columns = max(1, Int((width + 8) / (132 + 8)))
        let rows = stride(from: 0, to: families.count, by: columns).map { Array(families[$0..<min($0 + columns, families.count)]) }
        VStack(alignment: .leading, spacing: 8) {
            ForEach(rows, id: \.first?.id) { row in
                HStack(alignment: .top, spacing: 8) {
                    ForEach(row) { family in
                        let selected = family.id == state.place.family.id
                        let variant = selected ? state.place.variant
                            : (family.variants.first { $0.schemes.contains(state.place.scheme) } ?? family.variants[0])
                        let look = variant.look(variant.schemes.contains(state.place.scheme) ? state.place.scheme : (variant.schemes.first ?? .dark),
                                                depth: depth, texture: texture)
                        Button {
                            guard !selected else { return }
                            choose(family, variant)
                        } label: {
                            DesktopSkinCard(
                                skin: look.skin, selected: selected,
                                theme: DesktopTheme.of(look.palette),
                                name: family.name, tagline: family.tagline
                            )
                            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: family.name))
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .accessibilityIdentifier("desktop-settings.skin-family.\(family.id.rawValue)")
                    }
                    ForEach(0..<(columns - row.count), id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GeometryReader { geometry in
            Color.clear
                .onAppear { width = geometry.size.width }
                .onValueChange(of: geometry.size.width) { width = $0 }
        })
    }
}

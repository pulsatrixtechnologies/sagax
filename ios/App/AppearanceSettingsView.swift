// Settings > Appearance: the skin families, with a small live preview like
// the desktop's picker (name, tagline, a miniature drawn in the family's
// current variant), the variant as swatches, Light, Dark or Auto (follows
// the phone), "Same as my computer", and the font
// (CompanionCore/SkinFamilies.swift, 2026-10-19).
import SwiftUI
import CompanionCore

struct AppearanceSettingsView: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var themes = ThemeStore.shared
    @AppStorage(RunCardPreference.key) private var showRunCard = true

    /// The skin in effect (a DEBUG launch override included).
    private var selection: ThemeSelection { themes.effective }
    private var client: CompanionClient? { session.settingsClient }

    var body: some View {
        SettingsPage(title: "Appearance") {
            // Skin families (2026-10-19, the desktop's model): the family,
            // its variant (swatches) and Light, Dark or Auto, in one place.
            // "Same as my computer" is where the choice comes from, not a
            // second light or dark switch.
            SettingsCard {
                SettingsRow(
                    title: "Same as my computer",
                    subtitle: "The skin and font chosen on the computer. A skin picked here is saved there too.",
                    accessory: .toggle(Binding(get: { selection.mode == .computer }, set: { setComputer($0) })),
                    identifier: "theme.mode.computer"
                )
            }
            if selection.mode == .computer, let error = themes.computerError {
                SettingsFooter(text: LocalizedStringKey(error))
            }

            SettingsSectionLabel(text: "Skin")
            familyGrid
            SettingsCard {
                if current.place.family.variants(for: current.place.scheme, keeping: current.place.variant).count > 1 {
                    variantRow
                    CardHairline(leadingInset: SettingsMetrics.rowInset)
                }
                modeRow
            }

            SettingsSectionLabel(text: "Font")
            SettingsCard {
                fontRow(.skin, title: "Skin default")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                fontRow(.system, title: "System")
                CardHairline(leadingInset: SettingsMetrics.rowInset)
                fontRow(.serif, title: "Serif")
            }
            SettingsFooter(text: "Black is the phone's own look. The other skins are the computer's, with the same colours.")

            // the thread switch and what is hidden from the home (WP6)
            SidebarAppearanceSettings()

            // list density, activity and home chrome (this phone's display)
            DisplaySettingsCard()

            // the run card above the composer (ST4, SettingsModal RunCardRow)
            SettingsSectionLabel(text: "Chat")
            SettingsCard {
                SettingsRow(
                    title: "This run",
                    subtitle: "Show a list of the shell commands a bot ran for your current request. Turn it off to hide the card and its shortcut for saving the run as a skill.",
                    accessory: .toggle($showRunCard),
                    identifier: "settings.runCard"
                )
            }
        }
        .task(id: selection.mode) {
            if selection.mode == .computer { await themes.refreshFromComputer(client: client) }
        }
    }

    private func fontRow(_ font: SkinFontChoice, title: LocalizedStringKey) -> some View {
        let current = selection.mode == .computer ? (selection.computerFont ?? .skin) : selection.font
        let selected = current == font || (font == .system && (current == .inter || current == .poppins))
        return SettingsRow(title: title, accessory: selected ? .check : .none, identifier: "theme.font.\(font.rawValue)") {
            themes.chooseFont(font, client: client)
        }
    }

    /// The phone's own appearance, not the window's (a pinned skin forces the window's).
    private var deviceDark: Bool { UIScreen.main.traitCollection.userInterfaceStyle == .dark }

    /// The family, variant and mode the picker shows: from the computer's
    /// skin in computer mode, else from this phone's selection.
    private var current: (place: SkinPlace, mode: SkinModeChoice) {
        if selection.mode == .computer {
            let place = SkinPlace.of(selection.computerSkin ?? .pulsatrix)
            return (place, place.scheme == .light ? .light : .dark)
        }
        return selection.skinChoice(deviceDark: deviceDark)
    }

    /// The computer has no Black family; Auto is the phone's own; Hibou 98 only when worn.
    private var families: [SkinFamily] {
        let wornFamily = current.place.family.id
        let scheme = current.place.scheme
        return SkinFamily.all.filter { family in
            if selection.mode == .computer && family.id == .phone { return false }
            // a family with no look in the scheme worn now is not offered (the worn one stays)
            if family.id != wornFamily && family.variants(for: scheme).isEmpty { return false }
            // Hibou 98 stays hidden until it is worn
            return family.id != .retro98 || wornFamily == .retro98
        }
    }

    private func wear(_ variant: SkinVariant, mode: SkinModeChoice) {
        if selection.mode == .computer {
            let scheme: SkinScheme = mode == .light ? .light : .dark
            themes.choose(variant.skin(scheme), client: client)
        } else {
            themes.update { $0 = $0.choosing(variant, mode: mode) }
        }
    }

    private func setComputer(_ on: Bool) {
        if on {
            themes.update { $0.mode = .computer }
        } else {
            // back to this phone: its own pair, never the computer's skin
            themes.update { $0.mode = .system }
        }
    }

    /// Two family cards a row, each drawn in its variant for this phone now.
    private var familyGrid: some View {
        let shown = families
        let rows = stride(from: 0, to: shown.count, by: 2).map { Array(shown[$0..<min($0 + 2, shown.count)]) }
        let state = current
        return VStack(spacing: 10) {
            ForEach(rows, id: \.first?.id) { row in
                HStack(alignment: .top, spacing: 10) {
                    ForEach(row) { family in
                        let selected = family.id == state.place.family.id
                        let variant = selected ? state.place.variant
                            : (family.variants.first { $0.schemes.contains(state.place.scheme) } ?? family.variants[0])
                        SkinPreviewCard(
                            skin: selected ? state.place.variant.skin(state.place.scheme) : variant.skin(state.place.scheme),
                            title: family.name,
                            tagline: family.tagline,
                            selected: selected,
                            identifier: "skin.family.\(family.id.rawValue)"
                        ) {
                            guard !selected else { return }
                            wear(variant, mode: ThemeSelection.carry(state.mode, to: variant, worn: state.place.scheme))
                        }
                    }
                    if row.count == 1 { Color.clear.frame(maxWidth: .infinity) }
                }
            }
        }
        .padding(.horizontal, 23.17)
    }

    /// The family's variants as swatches, as Background effects' Colour on the computer.
    private var variantRow: some View {
        let state = current
        return HStack(spacing: 12) {
            Text("Variant")
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            ForEach(state.place.family.variants(for: state.place.scheme, keeping: state.place.variant)) { variant in
                let selected = variant == state.place.variant
                let palette = variant.skin(state.place.scheme).palette
                Button {
                    Haptics.selection()
                    guard !selected else { return }
                    wear(variant, mode: ThemeSelection.carry(state.mode, to: variant, worn: state.place.scheme))
                } label: {
                    ZStack {
                        Circle().fill(palette.bg.color)
                        Circle().trim(from: 0, to: 0.5).fill(palette.accent.color).rotationEffect(.degrees(-45))
                    }
                    .frame(width: 26, height: 26)
                    .overlay(Circle().strokeBorder(selected ? Theme.accent : Theme.hairline, lineWidth: selected ? 2 : 1))
                    .padding(2)
                    .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(LocalizedStringKey(variant.name)))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("skin.variant.\(variant.id)")
            }
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .frame(minHeight: 52)
    }

    /// Light, Dark or Auto, as Background effects' Intensity on the computer.
    /// A mode the variant lacks is disabled; Auto is the phone's own.
    private var modeRow: some View {
        let state = current
        let variant = state.place.variant
        let modes: [SkinModeChoice] = selection.mode == .computer ? [.light, .dark] : SkinModeChoice.allCases
        return HStack(spacing: 12) {
            Text("Mode")
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textPrimary)
            Spacer(minLength: 8)
            Menu {
                ForEach(modes) { mode in
                    let available = mode == .auto ? variant.followsSystem : variant.schemes.contains(mode == .light ? .light : .dark)
                    Button {
                        wear(variant, mode: mode)
                    } label: {
                        if mode == state.mode { Label(modeTitle(mode), systemImage: "checkmark") } else { Text(modeTitle(mode)) }
                    }
                    .disabled(!available)
                    .accessibilityIdentifier("theme.mode.\(mode.rawValue)")
                }
            } label: {
                HStack(spacing: 4) {
                    Text(modeTitle(state.mode))
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 11, weight: .semibold))
                }
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
            }
            .accessibilityIdentifier("theme.mode")
        }
        .padding(.horizontal, SettingsMetrics.rowInset)
        .frame(minHeight: 52)
    }

    private func modeTitle(_ mode: SkinModeChoice) -> LocalizedStringKey {
        switch mode {
        case .light: "Light"
        case .dark: "Dark"
        case .auto: "Auto (follow the phone)"
        }
    }
}

/// One skin in the picker: a miniature in its own colours (a header bar, an
/// assistant and a user bubble, an accent button), then its name and tagline.
/// It draws from the skin's palette, never the active one, like the desktop's
/// live `[data-skin]` miniatures.
struct SkinPreviewCard: View {
    @Environment(\.themePalette) var themePalette
    let skin: SkinID
    var title: String? = nil
    var tagline: String? = nil
    let selected: Bool
    var identifier: String?
    let action: () -> Void

    var body: some View {
        let p = skin.palette
        Button {
            Haptics.selection()
            action()
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                miniature(p)
                    .frame(height: 74)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 10, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: Theme.Metric.cardRadius == 0 ? 0 : 10, style: .continuous)
                            .strokeBorder(selected ? Theme.accent : Theme.hairline, lineWidth: selected ? 2 : 1)
                    )
                HStack(spacing: 4) {
                    Text(verbatim: title ?? skin.name)
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.accentText)
                    }
                }
                .padding(.top, 8)
                Text(LocalizedStringKey(tagline ?? skin.tagline))
                    .font(Theme.Font.label)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 2)
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .topLeading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: title ?? skin.name))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier(identifier ?? "skin.\(skin.rawValue)")
    }

    private func miniature(_ p: SkinPalette) -> some View {
        ZStack(alignment: .topLeading) {
            (p.bevelled ? p.desktop : p.bg).color
            VStack(alignment: .leading, spacing: 5) {
                HStack(spacing: 4) {
                    Circle().fill(p.glassFill.color).frame(width: 10, height: 10)
                    Capsule().fill(p.textSecondary.color.opacity(0.6)).frame(width: 30, height: 4)
                    Spacer()
                    Circle().fill(p.accent.color).frame(width: 10, height: 10)
                }
                RoundedRectangle(cornerRadius: p.bevelled ? 0 : 6, style: .continuous)
                    .fill(p.bubbleAssistant.color)
                    .frame(width: 70, height: 16)
                    .overlay(alignment: .leading) {
                        Capsule().fill(p.bubbleAssistantText.color).frame(width: 46, height: 3).padding(.leading, 6)
                    }
                HStack {
                    Spacer()
                    RoundedRectangle(cornerRadius: p.bevelled ? 0 : 6, style: .continuous)
                        .fill(p.bubbleUser.color)
                        .frame(width: 52, height: 16)
                        .overlay(alignment: .leading) {
                            Capsule().fill(p.bubbleUserText.color).frame(width: 32, height: 3).padding(.leading, 6)
                        }
                }
            }
            .padding(8)
        }
    }
}

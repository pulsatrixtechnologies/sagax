// iPad: the bot editor's Appearance page (src/components/appearance/
// AppearancePane.tsx with floating-bots/MascotLookEditor.tsx): the source
// as a segmented control (Mascot, Generate, Upload) with Reset, then on
// Mascot the preview band (the character large on a ground tinted with the
// bot's color, its name, "family · shape · palette · skin", In use or Use
// <name> or its unlock hint, the move count opening every move, Play a move
// and Randomize) over the tabs (Mascot, Shape for Shapes, Color, Skin), each
// with its current value under its label and the open one underlined in the
// bot's color. Mascot is a search, the filter chips (All, Owned, To unlock,
// then one per family) and the shelves (Yours "n of m", To unlock) of the
// registry (wardrobe.ts); Color the palettes as chips over their swatches;
// Skin the rarities as chips over the skin cards.
//
// It saves through the same path the old avatar popover used (`PATCH
// /api/bots/:id/profile` via `ProfileClient.editBot`, then
// `Session.applyProfileBot`), each choice as it is made; a locked character
// or skin previews on the stage and saves nothing (#475, #518). Generate
// and Upload are the iPad's picture sources (`Session.generateAvatar`,
// `Session.uploadAvatar`).
import PhotosUI
import SwiftUI
import UIKit
import CompanionCore

// MARK: - Catalog

/// The gallery's registry rules (`mascots.tsx` families, `wardrobe.ts`
/// filters and shelves, `editor-tabs.ts` palettes) for the iPad's characters.
enum PersonaWardrobe {
    enum Family: String, CaseIterable { case classics, shapes, animals }
    enum Filter: Hashable { case all, owned, locked, family(Family) }
    enum Tab: String, CaseIterable { case mascot, shape, color, skin }
    enum ColorGroup: String, CaseIterable { case vivid, pastel, deep, neon, neutral, clay }

    static func family(_ character: MascotCharacter) -> Family {
        switch character {
        case .owl, .trombi: .classics
        case .shape: .shapes
        case .crab, .bunbu, .shiba, .grump, .ogre, .frog: .animals
        }
    }

    static func familyName(_ family: Family) -> String {
        switch family {
        case .classics: AppStrings.localized("Classics")
        case .shapes: AppStrings.localized("Shapes")
        case .animals: AppStrings.localized("Animals")
        }
    }

    static func filters(_ listed: [MascotCharacter], locked: (MascotCharacter) -> Bool) -> [Filter] {
        var out: [Filter] = [.all, .owned]
        if listed.contains(where: locked) { out.append(.locked) }
        out += Family.allCases.filter { family in listed.contains { self.family($0) == family } }.map(Filter.family)
        return out
    }

    static func filterName(_ filter: Filter) -> String {
        switch filter {
        case .all: AppStrings.localized("appearance.filter.all")
        case .owned: AppStrings.localized("Owned")
        case .locked: AppStrings.localized("To unlock")
        case let .family(family): familyName(family)
        }
    }

    /// The tabs a character offers: Shape for Shapes, Color for one that takes the bot's color.
    static func tabs(_ character: MascotCharacter) -> [Tab] {
        Tab.allCases.filter { ($0 != .shape || character == .shape) && ($0 != .color || character != .trombi) }
    }

    static func tabName(_ tab: Tab) -> String {
        switch tab {
        case .mascot: AppStrings.localized("Mascot")
        case .shape: AppStrings.localized("Shape")
        case .color: AppStrings.localized("Color")
        case .skin: AppStrings.localized("mascot.skin.title")
        }
    }

    /// `MASCOT_COLOR_PALETTES`, each in its swatch row's order (`paletteSwatches`).
    static func colors(_ group: ColorGroup) -> [String] {
        switch group {
        case .vivid: ["red", "coral", "orange", "amber", "yellow", "green", "teal", "cyan", "blue", "purple", "pink"]
        case .pastel: ["blush", "peach", "butter", "pistachio", "mint", "aqua", "sky", "periwinkle", "lavender", "lilac"]
        case .deep: ["wine", "rust", "olive", "forest", "petrol", "navy", "midnight", "indigo", "plum", "berry"]
        case .neon: ["scarlet", "blaze", "citrus", "lime", "volt", "laser", "electric", "ultraviolet", "magenta", "hotpink"]
        case .neutral: ["white", "silver", "grey", "graphite", "black", "sand", "taupe", "brown", "bronze", "copper", "brass"]
        case .clay: MausColors.clay
        }
    }

    /// The palette a color belongs to (`mascotColorGroup`): brown is neutral's, unknown reads as vivid.
    static func group(of color: String) -> ColorGroup {
        ColorGroup.allCases.first { group in group != .clay ? colors(group).contains(color) : (colors(.clay).contains(color) && color != "brown") } ?? .vivid
    }

    /// `colorGroupsFor`: Clay for Shapes, Shiba, Grump, Ogre, Frog and Crab, or a bot already in a Clay color.
    static func groups(for character: MascotCharacter, color: String) -> [ColorGroup] {
        let clay: Set<MascotCharacter> = [.shape, .shiba, .grump, .ogre, .frog, .crab]
        return ColorGroup.allCases.filter { $0 != .clay || clay.contains(character) || group(of: color) == .clay }
    }

    static func groupName(_ group: ColorGroup) -> String {
        switch group {
        case .vivid: AppStrings.localized("Vivid")
        case .pastel: AppStrings.localized("Pastel")
        case .deep: AppStrings.localized("Deep")
        case .neon: AppStrings.localized("Neon")
        case .neutral: AppStrings.localized("mascot.color.group.neutral")
        case .clay: AppStrings.localized("Clay")
        }
    }

    static func characterName(_ character: MascotCharacter) -> String {
        switch character {
        case .owl: AppStrings.localized("Owl")
        case .shape: AppStrings.localized("Shapes")
        case .trombi: AppStrings.localized("Trombi")
        case .bunbu: AppStrings.localized("Bunbu")
        case .shiba: AppStrings.localized("Shiba")
        case .grump: AppStrings.localized("Grump")
        case .ogre: AppStrings.localized("Ogre")
        case .frog: AppStrings.localized("Frog")
        case .crab: AppStrings.localized("Crab")
        }
    }

    static func tierName(_ tier: SkinTier) -> String {
        switch tier {
        case .common: AppStrings.localized("Common")
        case .rare: AppStrings.localized("Rare")
        case .epic: AppStrings.localized("Epic")
        case .legendary: AppStrings.localized("Legendary")
        }
    }

    /// A skin's name (the desktop's `*_SKIN_LABEL`).
    static func skinName(_ character: MascotCharacter, _ id: String) -> String {
        let table: [String: String]
        switch character {
        case .owl: table = PersonaMascotWords.owl
        case .shape: table = PersonaMascotWords.shapeSkin
        case .trombi: table = PersonaMascotWords.trombi
        case .bunbu: table = PersonaMascotWords.bunbu
        case .shiba: table = PersonaMascotWords.shiba
        case .grump: table = PersonaMascotWords.grump
        case .ogre: table = PersonaMascotWords.ogre
        case .frog: table = PersonaMascotWords.frog
        case .crab: table = PersonaMascotWords.crab
        }
        return table[id].map(AppStrings.localized) ?? id.capitalized
    }

    static func shapeName(_ shape: MascotShape) -> String {
        PersonaMascotWords.shape[shape.rawValue].map(AppStrings.localized) ?? shape.rawValue.capitalized
    }
}

/// The desktop's label keys for the skins and the shapes (`MascotLookEditor.tsx`).
enum PersonaMascotWords {
    // generated from MascotLookEditor.tsx's label maps (id: desktop key)
    static let shape: [String: String] = ["circle": "mascot.shape.circle", "bean": "mascot.shape.pebble", "squircle": "mascot.shape.squircle", "pill": "mascot.shape.capsule", "pick": "mascot.shape.triangle", "hexagon": "mascot.shape.hexagon", "cloud": "mascot.shape.cloud", "drop": "mascot.shape.droplet", "pumpkin": "mascot.shape.pumpkin", "egg": "mascot.shape.egg", "gem": "mascot.shape.gem", "wedge": "mascot.shape.wedge", "diamond": "mascot.shape.diamond", "star": "mascot.shape.star", "clover": "mascot.shape.clover", "flower": "mascot.shape.flower", "blossom": "mascot.shape.blossom", "cat": "mascot.shape.cat", "ghost": "mascot.shape.ghost", "jellyfish": "mascot.shape.jellyfish", "axolotl": "mascot.shape.axolotl", "puff": "mascot.shape.puff", "pin": "mascot.shape.pin", "marker": "mascot.shape.marker", "sprite": "mascot.shape.sprite", "flask": "mascot.shape.flask", "tube": "mascot.shape.tube", "potion": "mascot.shape.potion", "chomp": "mascot.shape.chomp", "nibble": "mascot.shape.nibble", "shield": "mascot.shape.shield", "bubble": "mascot.shape.bubble", "pad": "mascot.shape.pad", "cup": "mascot.shape.cup", "bulb": "mascot.shape.bulb", "say": "mascot.shape.say", "sprout": "mascot.shape.sprout", "tin": "mascot.shape.tin", "tome": "mascot.shape.tome", "ship": "mascot.shape.ship"]
    static let shapeSkin: [String: String] = ["plain": "mascot.shapeSkin.clay", "pastel": "mascot.shapeSkin.pastel", "glossy": "mascot.shapeSkin.glossy", "night": "mascot.shapeSkin.night", "outline": "mascot.shapeSkin.outline", "gold": "mascot.shapeSkin.gold", "neon": "mascot.shapeSkin.neon", "chrome": "mascot.shapeSkin.chrome", "crystal": "mascot.shapeSkin.crystal", "circuit": "mascot.shapeSkin.circuit", "holo": "mascot.shapeSkin.holo", "molten": "mascot.shapeSkin.molten", "galaxy": "mascot.shapeSkin.galaxy"]
    static let trombi: [String: String] = ["classic": "mascot.trombiSkin.classic", "retro98": "mascot.trombiSkin.retro98", "gold": "mascot.trombiSkin.gold", "neon": "mascot.trombiSkin.neon", "chrome": "mascot.trombiSkin.chrome", "glitch": "mascot.trombiSkin.glitch", "holo": "mascot.trombiSkin.holo", "molten": "mascot.trombiSkin.molten"]
    static let bunbu: [String: String] = ["plain": "mascot.bunbuSkin.plain", "pastel": "mascot.bunbuSkin.pastel", "night": "mascot.bunbuSkin.night", "plush": "mascot.bunbuSkin.plush", "velvet": "mascot.bunbuSkin.velvet", "gold": "mascot.bunbuSkin.gold", "neon": "mascot.bunbuSkin.neon", "chrome": "mascot.bunbuSkin.chrome", "crystal": "mascot.bunbuSkin.crystal", "holo": "mascot.bunbuSkin.holo", "galaxy": "mascot.bunbuSkin.galaxy", "molten": "mascot.bunbuSkin.molten"]
    static let shiba: [String: String] = ["plain": "mascot.shibaSkin.plain", "cream": "mascot.shibaSkin.cream", "blacktan": "mascot.shibaSkin.blacktan", "red": "mascot.shibaSkin.red", "sesame": "mascot.shibaSkin.sesame", "white": "mascot.shibaSkin.white", "retro98": "mascot.shibaSkin.retro98", "gold": "mascot.shibaSkin.gold", "neon": "mascot.shibaSkin.neon", "chrome": "mascot.shibaSkin.chrome", "glitch": "mascot.shibaSkin.glitch", "holo": "mascot.shibaSkin.holo", "molten": "mascot.shibaSkin.molten"]
    static let grump: [String: String] = ["plain": "mascot.grumpSkin.plain", "tuxedo": "mascot.grumpSkin.tuxedo", "calico": "mascot.grumpSkin.calico", "tabby": "mascot.grumpSkin.tabby", "siamese": "mascot.grumpSkin.siamese", "retro98": "mascot.grumpSkin.retro98", "gold": "mascot.grumpSkin.gold", "void": "mascot.grumpSkin.void", "neon": "mascot.grumpSkin.neon", "chrome": "mascot.grumpSkin.chrome", "glitch": "mascot.grumpSkin.glitch", "holo": "mascot.grumpSkin.holo", "molten": "mascot.grumpSkin.molten"]
    static let ogre: [String: String] = ["plain": "mascot.ogreSkin.plain", "swamp": "mascot.ogreSkin.swamp", "moss": "mascot.ogreSkin.moss", "stone": "mascot.ogreSkin.stone", "lava": "mascot.ogreSkin.lava", "armor": "mascot.ogreSkin.armor", "retro98": "mascot.ogreSkin.retro98", "gold": "mascot.ogreSkin.gold", "neon": "mascot.ogreSkin.neon", "chrome": "mascot.ogreSkin.chrome", "glitch": "mascot.ogreSkin.glitch", "holo": "mascot.ogreSkin.holo", "molten": "mascot.ogreSkin.molten"]
    static let frog: [String: String] = ["plain": "mascot.frogSkin.plain", "leaf": "mascot.frogSkin.leaf", "tree": "mascot.frogSkin.tree", "poison": "mascot.frogSkin.poison", "bullfrog": "mascot.frogSkin.bullfrog", "ghost": "mascot.frogSkin.ghost", "retro98": "mascot.frogSkin.retro98", "gold": "mascot.frogSkin.gold", "neon": "mascot.frogSkin.neon", "chrome": "mascot.frogSkin.chrome", "glitch": "mascot.frogSkin.glitch", "holo": "mascot.frogSkin.holo", "molten": "mascot.frogSkin.molten"]
    static let crab: [String: String] = ["plain": "mascot.crabSkin.plain", "coral": "mascot.crabSkin.coral", "sand": "mascot.crabSkin.sand", "ink": "mascot.crabSkin.ink", "mint": "mascot.crabSkin.mint", "gold": "mascot.crabSkin.gold", "pearl": "mascot.crabSkin.pearl", "neon": "mascot.crabSkin.neon", "chrome": "mascot.crabSkin.chrome", "crystal": "mascot.crabSkin.crystal", "circuit": "mascot.crabSkin.circuit", "holo": "mascot.crabSkin.holo", "molten": "mascot.crabSkin.molten", "galaxy": "mascot.crabSkin.galaxy"]
    static let owl: [String: String] = ["none": "mascot.skin.classic", "snowy": "mascot.skin.snowy", "barn": "mascot.skin.barn", "carbon": "mascot.skin.carbon", "gold": "mascot.skin.gold", "frost": "mascot.skin.frost", "neon": "mascot.skin.neon", "lightning": "mascot.skin.lightning", "chrome": "mascot.skin.chrome", "inferno": "mascot.skin.inferno", "holo": "mascot.skin.holo", "galaxy": "mascot.skin.galaxy", "spirit": "mascot.skin.spirit"]
}

// MARK: - Pane

/// The width the Appearance pane is given (see `PersonaAppearancePane.compact`).
private struct PersonaPaneWidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

struct PersonaAppearancePane: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot

    enum Mode: String, CaseIterable { case mascot, generate, upload }

    @State private var mode: Mode?
    @State private var draft = CharacterDraft()
    @State private var unlocks: MascotUnlocks = .lockedUntilLoaded
    @State private var working = false
    @State private var prompt = ""
    @State private var photo: PhotosPickerItem?
    @State private var config: ConfigStatus?

    // the look editor's own state
    @State private var shown: MascotCharacter?
    @State private var previewSkin: String?
    @State private var tab: PersonaWardrobe.Tab = .mascot
    @State private var query = ""
    @State private var filter: PersonaWardrobe.Filter = .all
    @State private var movesOpen = false
    @State private var colorTab: PersonaWardrobe.ColorGroup?
    @State private var tierTab: SkinTier?
    @State private var nextMove = 0
    @State private var hop = false
    @StateObject private var stageHandle = OwlMascotHandle()
    /// The width the pane is given: under `compactBelow` (a phone, or a
    /// narrow iPad window) its rows stack or scroll inside themselves
    /// instead of widening the page past the screen (#4041).
    @State private var paneWidth: CGFloat = 0

    /// The desktop's side by side preview needs the stage (170), the name
    /// and the two buttons beside it: below this width they stack.
    static let compactBelow: CGFloat = 560
    private var compact: Bool { paneWidth < Self.compactBelow }

    private var worn: CharacterDraft { CharacterDraft(bot: bot) }
    private var wornCharacter: MascotCharacter { worn.character }
    private var current: MascotCharacter { shown ?? draft.character }
    private var crop: AvatarCrop { bot.avatarCrop ?? .mascot }
    private var openMode: Mode { mode ?? (crop != .mascot && bot.avatarUrl != nil ? .upload : .mascot) }
    private var canGenerate: Bool { session.surfaceGate.allows(.botAvatarGenerate, bot: bot) && config?.imageGen?.configured == true }

    private func locked(_ character: MascotCharacter) -> Bool {
        unlocks.characterLocked(character, current: wornCharacter)
    }

    private var listed: [MascotCharacter] { unlocks.listedCharacters(current: wornCharacter) }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // the source and Reset side by side, or Reset under the source
            // when a language's words do not fit the phone's row (#4041)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    modes.fixedSize()
                    Spacer(minLength: 0)
                    resetButton
                }
                VStack(alignment: .leading, spacing: 8) {
                    modes.fixedSize()
                    resetButton
                }
            }
            .padding(.bottom, 16)
            Group {
                switch openMode {
                case .mascot:
                    if crop == .mascot { AnyView(lookEditor) } else { AnyView(pictureInUse) }
                case .generate: AnyView(generateTab)
                case .upload: AnyView(uploadTab)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background {
            GeometryReader { box in
                Color.clear.preference(key: PersonaPaneWidthKey.self, value: box.size.width)
            }
        }
        .onPreferenceChange(PersonaPaneWidthKey.self) { width in
            if abs(width - paneWidth) > 0.5 { paneWidth = width }
        }
        .overlay { if working { ProgressView().controlSize(.large) } }
        .onAppear { draft = worn }
        .onValueChange(of: CharacterDraft(bot: bot)) { server in
            if !working { draft = server }
        }
        .task {
            if session.isDemo { unlocks = .demo }
            config = await session.configStatus()
            if session.surfaceGate.allows(.characterExtras), session.surfaceGate.allows(.achievements),
               let client = session.profileClient, let earned = try? await client.mascotUnlocks() {
                unlocks = earned
            }
        }
        .onValueChange(of: photo) { item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance")
    }

    private var resetButton: some View {
        Button {
            draft = .default
            shown = nil
            previewSkin = nil
            Task { await edit(.resetLook) }
        } label: {
            Text(verbatim: AppStrings.localized("Reset"))
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
                .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 8, fill: \.control))
        .accessibilityIdentifier("persona-appearance.reset")
    }

    private var modes: some View {
        HStack(spacing: 2) {
            ForEach(Mode.allCases, id: \.self) { item in
                let on = item == openMode
                Button { mode = item } label: {
                    Text(verbatim: modeName(item))
                        .font(theme.font(13))
                        .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 12)
                        .frame(height: 28)
                        .background(on ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .shadow(color: on ? .black.opacity(0.08) : .clear, radius: 1, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("persona-appearance.mode.\(item.rawValue)")
            }
        }
        .padding(2)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: AppStrings.localized("Avatar source")))
    }

    private func modeName(_ mode: Mode) -> String {
        switch mode {
        case .mascot: AppStrings.localized("Mascot")
        case .generate: AppStrings.localized("Generate")
        case .upload: AppStrings.localized("Upload")
        }
    }

    private var pictureInUse: some View {
        HStack(spacing: 12) {
            Text(verbatim: AppStrings.localized("This bot shows a picture instead of its mascot."))
                .font(theme.font(12.5))
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            Button {
                Task { await edit(BotProfileEdit(avatarCrop: .mascot)) }
            } label: {
                Text(verbatim: AppStrings.localized("Use the mascot"))
                    .font(theme.font(12.5))
                    .foregroundStyle(theme.ink)
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("persona-appearance.use-mascot")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(theme.raised.opacity(0.6), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    // MARK: Look editor

    private var lookEditor: some View {
        let tabs = PersonaWardrobe.tabs(current)
        let open = tabs.contains(tab) ? tab : .mascot
        return VStack(alignment: .leading, spacing: 16) {
            AnyView(hero)
            AnyView(tabRow(tabs, open: open))
            Group {
                switch open {
                case .mascot: AnyView(browser)
                case .shape: AnyView(shapeGrid)
                case .color: AnyView(colorPicker)
                case .skin: AnyView(skinPicker)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("persona-appearance.panel.\(open.rawValue)")
        }
    }

    // MARK: Hero

    private var tint: Color { MausPalette.color(draft.color) }
    private var ink: Color { MausPalette.ink(draft.color) }

    private var shownLook: CompleteMascotLook {
        var look = draft.complete
        look.character = current
        if let previewSkin, current != .owl { look.setSkin(previewSkin, for: current) }
        return look
    }

    private var shownOwlSkin: MascotSkin {
        guard current == .owl else { return draft.skin }
        return previewSkin.flatMap(MascotSkin.init(rawValue:)) ?? draft.skin
    }

    private var shownSkinID: String {
        previewSkin ?? (current == .owl ? draft.skin.rawValue : (draft.complete.skinID(current) ?? ""))
    }

    private var summary: String {
        var parts = [PersonaWardrobe.familyName(PersonaWardrobe.family(current))]
        if current == .shape { parts.append(PersonaWardrobe.shapeName(draft.complete.shape)) }
        if current != .trombi { parts.append(PersonaWardrobe.groupName(PersonaWardrobe.group(of: draft.color))) }
        parts.append(PersonaWardrobe.skinName(current, shownSkinID))
        return parts.joined(separator: " · ")
    }

    private enum Move: Hashable { case owl(OwlWingMove), shape(ShapeMove), hop }

    private var moves: [Move] {
        switch current {
        case .owl: OwlWingMove.allCases.map(Move.owl)
        case .shape: ShapeMove.allCases.map(Move.shape)
        default: [.hop]
        }
    }

    private func moveName(_ move: Move) -> String {
        switch move {
        case let .owl(wing): CharacterMovesMenu.name(wing)
        case let .shape(shape): CharacterMovesMenu.name(shape)
        case .hop: AppStrings.localized("floatingBots.move.hop")
        }
    }

    private func play(_ move: Move) {
        switch move {
        case let .owl(wing):
            stageHandle.flourish(wing)
            // the wing move also plays on the bot's avatars across the app
            model.avatarMove = nil
            DispatchQueue.main.async { model.avatarMove = wing }
        case let .shape(shape):
            stageHandle.shape(shape)
            model.avatarShapeMove = nil
            DispatchQueue.main.async { model.avatarShapeMove = shape }
        case .hop:
            withAnimation(.spring(response: 0.22, dampingFraction: 0.5)) { hop = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.55)) { hop = false }
            }
        }
    }

    private func playNext() {
        guard !moves.isEmpty else { return }
        play(moves[nextMove % moves.count])
        nextMove += 1
    }

    /// The preview band. Wide (the desktop): the stage, the name column and
    /// the two buttons side by side, 210 high. Compact (a phone): the stage
    /// centred, the name, its pills and the moves under it, then the two
    /// buttons side by side at full width (#4041).
    private var hero: some View {
        let name = PersonaWardrobe.characterName(current)
        let isLocked = locked(current)
        let inUse = current == draft.character
        return Group {
            if compact {
                VStack(spacing: 16) {
                    heroStage(name: name, isLocked: isLocked)
                    heroIdentity(name: name, isLocked: isLocked, inUse: inUse, centered: true)
                    if movesOpen { AnyView(moveList(width: nil)) }
                    // side by side, or one under the other when a
                    // language's words do not fit half the row
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 8) { heroButtons }
                        VStack(spacing: 8) { heroButtons }
                    }
                }
                .padding(16)
                .frame(maxWidth: .infinity)
            } else {
                HStack(spacing: 28) {
                    heroStage(name: name, isLocked: isLocked)
                    heroIdentity(name: name, isLocked: isLocked, inUse: inUse, centered: false)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .zIndex(1)
                    VStack(spacing: 8) { heroButtons }
                        .fixedSize()
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, minHeight: 210, maxHeight: 210)
            }
        }
        .background { heroGround }
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .zIndex(2)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance.hero")
    }

    /// The character large, a tap plays the next move.
    private func heroStage(name: String, isLocked: Bool) -> some View {
        ZStack {
            MascotCharacterView(look: shownLook, color: draft.color, skin: shownOwlSkin, size: 150, animated: true, owlHandle: stageHandle)
                .grayscale(isLocked ? 1 : 0)
                .opacity(isLocked ? 0.6 : 1)
                .offset(y: hop ? -10 : 0)
            if isLocked {
                PersonaIconView(icon: .lock, size: 12, strokeWidth: 2.4)
                    .foregroundStyle(theme.inkSecondary)
                    .frame(width: 24, height: 24)
                    .background(theme.control, in: Circle())
                    .padding(4)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
            }
            if previewSkin != nil || isLocked {
                Text(verbatim: AppStrings.localized("Preview: locked, nothing is saved"))
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(theme.control.opacity(0.9), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(4)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .accessibilityIdentifier("persona-appearance.preview-note")
            }
        }
        .frame(width: 170, height: 170)
        .contentShape(Rectangle())
        .onTapGesture { playNext() }
        .onHover { inside in if inside, let first = moves.first { play(first) } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: String(format: AppStrings.localized("%@ preview"), name)))
        .accessibilityAddTraits(.isButton)
        .accessibilityIdentifier("persona-appearance.stage")
    }

    /// The name, "family · shape · palette · skin", then the action pill and
    /// the move count. Wide, the moves open as a card over the band; compact,
    /// the hero lists them in its own flow.
    private func heroIdentity(name: String, isLocked: Bool, inUse: Bool, centered: Bool) -> some View {
        VStack(alignment: centered ? .center : .leading, spacing: 6) {
            Text(verbatim: name)
                .font(theme.font(24, .semibold))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .frame(height: 32)
                .accessibilityIdentifier("persona-appearance.name")
            Text(verbatim: summary)
                .font(theme.font(13.5))
                .foregroundStyle(theme.inkSecondary)
                .lineLimit(centered ? 2 : 1)
                .multilineTextAlignment(centered ? .center : .leading)
                .fixedSize(horizontal: false, vertical: centered)
                .frame(minHeight: 20)
                .accessibilityIdentifier("persona-appearance.summary")
            HStack(spacing: 8) {
                actionPill(name: name, locked: isLocked, inUse: inUse)
                Button { withAnimation(.easeOut(duration: 0.12)) { movesOpen.toggle() } } label: {
                    HStack(spacing: 4) {
                        Text(verbatim: String(format: AppStrings.localized("%@ moves"), "\(moves.count)"))
                            .font(theme.font(12))
                        PersonaIconView(icon: .chevronDown, size: 12, strokeWidth: 2)
                            .rotationEffect(.degrees(movesOpen ? 180 : 0))
                    }
                    .foregroundStyle(theme.inkTertiary)
                    .padding(.horizontal, 8)
                    .frame(height: 24)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 12, fill: \.control))
                .accessibilityIdentifier("persona-appearance.moves")
            }
            .padding(.top, 10)
            .overlay(alignment: .topLeading) {
                if movesOpen, !centered { AnyView(moveList(width: 352)).offset(y: 46) }
            }
            .zIndex(1)
        }
    }

    /// Play a move and Randomize: a column beside the name when wide, a row under it when compact.
    @ViewBuilder
    private var heroButtons: some View {
        heroButton(.play, AppStrings.localized("Play a move"), id: "persona-appearance.play") { playNext() }
        heroButton(.shuffle, AppStrings.localized("Randomize"), id: "persona-appearance.randomize") { randomize() }
    }

    /// `radial-gradient(120% 140% at 20% 50%, tint 26 % into panel, panel 58 %)`.
    private var heroGround: some View {
        GeometryReader { geometry in
            let rx = geometry.size.width * 1.2
            let ry = geometry.size.height * 1.4
            ZStack {
                theme.panel
                RadialGradient(
                    stops: [
                        .init(color: tint.opacity(0.26), location: 0),
                        .init(color: tint.opacity(0), location: 0.58),
                    ],
                    center: .center, startRadius: 0, endRadius: rx
                )
                .frame(width: rx * 2, height: rx * 2)
                .scaleEffect(x: 1, y: ry / rx)
                .position(x: geometry.size.width * 0.2, y: geometry.size.height * 0.5)
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func actionPill(name: String, locked isLocked: Bool, inUse: Bool) -> some View {
        let text: String = isLocked ? (lockHint(current) ?? AppStrings.localized("To unlock"))
            : inUse ? AppStrings.localized("In use") : String(format: AppStrings.localized("Use %@"), name)
        return Button {
            previewSkin = nil
            var next = draft
            next.character = current
            save(next)
        } label: {
            HStack(spacing: 6) {
                if isLocked {
                    PersonaIconView(icon: .lock, size: 12, strokeWidth: 2)
                } else if inUse {
                    PersonaIconView(icon: .check, size: 13, strokeWidth: 3)
                }
                Text(verbatim: text).font(theme.font(12, !isLocked && !inUse ? .medium : .regular)).lineLimit(1)
            }
            .foregroundStyle(isLocked ? theme.inkSecondary : inUse ? theme.success : theme.accentInk)
            .padding(.horizontal, 12)
            .frame(minHeight: 28)
            .background(isLocked ? theme.control : inUse ? theme.success.opacity(0.15) : theme.accent, in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLocked || inUse || working)
        .accessibilityIdentifier("persona-appearance.action")
    }

    /// Every move. `width` set: a card floating over the band (wide); nil:
    /// in the stacked hero's flow, as wide as the hero, without a shadow.
    private func moveList(width: CGFloat?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: AppStrings.localized("Moves"))
                .font(theme.font(11, .medium))
                .foregroundStyle(theme.inkSecondary)
            PanelFlow(spacing: 4, lineSpacing: 4) {
                ForEach(moves, id: \.self) { move in
                    Button { play(move) } label: {
                        Text(verbatim: moveName(move))
                            .font(theme.font(11.5))
                            .foregroundStyle(theme.ink)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(theme.control, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .padding(10)
        .frame(width: width, alignment: .leading)
        .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
        .shadow(color: .black.opacity(width == nil ? 0 : 0.3), radius: 12, y: 6)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance.move-list")
    }

    private func heroButton(_ icon: PersonaIcon, _ title: String, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                PersonaIconView(icon: icon, size: 13, strokeWidth: 2)
                // one line in its 34 pt button, a longer language included
                Text(verbatim: title).font(theme.font(13)).lineLimit(1).minimumScaleFactor(0.8)
            }
            .foregroundStyle(theme.ink)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .frame(maxWidth: .infinity)
            .background(theme.control.opacity(0.7), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(working)
        .accessibilityIdentifier(id)
    }

    /// Randomize (`randomLook`): an owned character, a color it takes, an owned skin; saved at once.
    private func randomize() {
        let owned = listed.filter { !locked($0) }
        guard let character = owned.randomElement() else { return }
        var next = draft
        next.character = character
        if character != .trombi {
            let colors = PersonaWardrobe.groups(for: character, color: draft.color).flatMap(PersonaWardrobe.colors)
            next.color = colors.randomElement() ?? next.color
        }
        let skins = CompleteMascotLook.skinIDs(character).filter { !unlocks.skinLocked(character, skin: $0, current: "") }
        var look = next.complete
        if character == .shape, let shape = MascotShape.allCases.randomElement() { look.shape = shape }
        if character == .owl {
            next.skin = skins.randomElement().flatMap(MascotSkin.init(rawValue:)) ?? next.skin
        } else if let skin = skins.randomElement() {
            look.setSkin(skin, for: character)
        }
        if character != .owl { next.look = look.stored }
        shown = nil
        previewSkin = nil
        save(next)
    }

    // MARK: Tabs

    /// Mascot, Shape, Color, Skin over one hairline. Compact, the row scrolls
    /// inside itself and keeps the open tab in view (#4041).
    @ViewBuilder
    private func tabRow(_ tabs: [PersonaWardrobe.Tab], open: PersonaWardrobe.Tab) -> some View {
        if compact {
            ScrollViewReader { reader in
                ScrollView(.horizontal, showsIndicators: false) {
                    tabButtons(tabs, open: open)
                }
                .onAppear { reader.scrollTo(open, anchor: .center) }
                .onValueChange(of: open) { now in
                    withAnimation(.easeOut(duration: 0.15)) { reader.scrollTo(now, anchor: .center) }
                }
            }
            .overlay(alignment: .bottom) { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
        } else {
            tabButtons(tabs, open: open)
        }
    }

    private func tabButtons(_ tabs: [PersonaWardrobe.Tab], open: PersonaWardrobe.Tab) -> some View {
        HStack(spacing: 4) {
            ForEach(tabs, id: \.self) { item in
                let on = item == open
                Button { tab = item } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(verbatim: PersonaWardrobe.tabName(item))
                            .font(theme.font(13.5, .medium))
                            .foregroundStyle(on ? theme.ink : theme.inkSecondary)
                            .frame(height: 20)
                        AnyView(tabValue(item))
                            .font(theme.font(11.5))
                            .foregroundStyle(theme.inkTertiary)
                            .lineLimit(1)
                            .frame(height: 16)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                    .padding(.bottom, 10)
                    .overlay(alignment: .bottom) {
                        Rectangle().fill(on ? ink : .clear).frame(height: 2)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
                .accessibilityIdentifier("persona-appearance.tab.\(item.rawValue)")
                .id(item)
            }
            Spacer(minLength: 0)
        }
        .overlay(alignment: .bottom) { Rectangle().fill(theme.hairlineWeak).frame(height: 1) }
    }

    @ViewBuilder
    private func tabValue(_ tab: PersonaWardrobe.Tab) -> some View {
        switch tab {
        case .mascot: Text(verbatim: PersonaWardrobe.characterName(current))
        case .shape: Text(verbatim: PersonaWardrobe.shapeName(draft.complete.shape))
        case .color:
            HStack(spacing: 4) {
                Circle().fill(tint).frame(width: 8, height: 8).overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                Text(verbatim: PersonaWardrobe.groupName(PersonaWardrobe.group(of: draft.color)))
            }
        case .skin: Text(verbatim: PersonaWardrobe.skinName(current, shownSkinID))
        }
    }

    // MARK: Mascot tab

    private var browser: some View {
        let filters = PersonaWardrobe.filters(listed) { locked($0) }
        let wanted = query.trimmingCharacters(in: .whitespacesAndNewlines).folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
        let kept = listed.filter { character in
            let isLocked = locked(character)
            let keep: Bool = switch filter {
            case .all: true
            case .owned: !isLocked
            case .locked: isLocked
            case let .family(family): PersonaWardrobe.family(character) == family
            }
            guard keep else { return false }
            guard !wanted.isEmpty else { return true }
            let fold = { (text: String) in text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil) }
            return fold(PersonaWardrobe.characterName(character)).contains(wanted)
                || fold(PersonaWardrobe.familyName(PersonaWardrobe.family(character))).contains(wanted)
        }
        let yours = kept.filter { !locked($0) }
        let toUnlock = kept.filter { locked($0) }
        let owned = listed.filter { !locked($0) }.count
        return VStack(alignment: .leading, spacing: 12) {
            if compact {
                // a phone: the search on its own row, the chips scrolling in theirs (#4041)
                mascotSearch(width: nil)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) { filterChips(filters) }
                        .padding(.vertical, 1)
                }
            } else {
                HStack(spacing: 8) {
                    mascotSearch(width: 206)
                    PanelFlow(spacing: 6, lineSpacing: 6) { filterChips(filters) }
                }
            }
            if !yours.isEmpty {
                shelf(AppStrings.localized("Yours"), count: String(format: AppStrings.localized("%@ of %@"), "\(owned)", "\(listed.count)"), entries: yours, id: "yours")
            }
            if !toUnlock.isEmpty {
                shelf(AppStrings.localized("To unlock"), count: "\(toUnlock.count)", entries: toUnlock, id: "locked")
            }
            if kept.isEmpty {
                Text(verbatim: wanted.isEmpty ? AppStrings.localized("No mascot here yet.")
                     : String(format: AppStrings.localized("No mascot matches “%@”."), query.trimmingCharacters(in: .whitespacesAndNewlines)))
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 16)
            }
        }
    }

    /// The mascot search: 206 wide beside the chips, the full row when `width` is nil.
    private func mascotSearch(width: CGFloat?) -> some View {
        HStack(spacing: 6) {
            PersonaIconView(icon: .search, size: 13, strokeWidth: 2)
                .foregroundStyle(theme.inkSecondary)
            TextField(text: $query, prompt: Text(verbatim: String(format: AppStrings.localized("Search %@ mascots"), "\(listed.count)")).foregroundColor(theme.inkSecondary)) {
                Text(verbatim: AppStrings.localized("Search mascots"))
            }
            .font(theme.font(12.5))
            .foregroundStyle(theme.ink)
            .tint(theme.focus)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .accessibilityIdentifier("persona-appearance.search")
        }
        .padding(.horizontal, 10)
        .frame(width: width, height: 32)
        .frame(maxWidth: width == nil ? .infinity : nil)
        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairlineWeak, lineWidth: 1))
    }

    private func filterChips(_ filters: [PersonaWardrobe.Filter]) -> some View {
        ForEach(filters, id: \.self) { item in
            chip(PersonaWardrobe.filterName(item), on: filter == item) { filter = item }
                .accessibilityIdentifier("persona-appearance.filter.\(filterID(item))")
        }
    }

    private func filterID(_ filter: PersonaWardrobe.Filter) -> String {
        switch filter {
        case .all: "all"
        case .owned: "owned"
        case .locked: "locked"
        case let .family(family): "family-\(family.rawValue)"
        }
    }

    private func shelf(_ title: String, count: String, entries: [MascotCharacter], id: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(verbatim: title)
                    .font(theme.font(11, .medium))
                    .foregroundStyle(theme.inkSecondary)
                Text(verbatim: count)
                    .font(theme.font(11))
                    .monospacedDigit()
                    .foregroundStyle(theme.inkTertiary)
            }
            PersonaGrid(minimum: 84, spacing: 8) {
                ForEach(entries, id: \.self) { character in tile(character) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance.shelf.\(id)")
    }

    private func tile(_ character: MascotCharacter) -> some View {
        let isLocked = locked(character)
        let inUse = character == draft.character
        let selected = character == current
        var look = draft.complete
        look.character = character
        return Button {
            previewSkin = nil
            shown = character
            guard !isLocked, character != draft.character else { return }
            var next = draft
            next.character = character
            save(next)
        } label: {
            VStack(spacing: 4) {
                MascotCharacterView(look: look, color: draft.color, skin: character == .owl ? draft.skin : .none, size: 52, hd: false)
                    .frame(width: 56, height: 56)
                    .grayscale(isLocked ? 0.85 : 0)
                    .brightness(isLocked ? -0.2 : 0)
                    .opacity(isLocked ? 0.6 : 1)
                Text(verbatim: PersonaWardrobe.characterName(character))
                    .font(theme.font(12))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .frame(height: 16)
                Text(verbatim: PersonaWardrobe.familyName(PersonaWardrobe.family(character)))
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkTertiary)
                    .lineLimit(1)
                    .frame(height: 12)
                    .opacity(isLocked ? 0 : 1)
            }
            .padding(.top, 12)
            .padding(.horizontal, 4)
            .frame(maxWidth: .infinity, minHeight: 112, maxHeight: 112, alignment: .top)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected ? theme.accentBorder : .clear, lineWidth: 2))
            .overlay(alignment: .topLeading) {
                if inUse {
                    PersonaIconView(icon: .check, size: 10, strokeWidth: 3)
                        .foregroundStyle(theme.accentInk)
                        .frame(width: 16, height: 16)
                        .background(theme.accent, in: Circle())
                        .padding(6)
                }
            }
            .overlay(alignment: .topTrailing) { if isLocked { lockBadge } }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(working)
        .accessibilityLabel(Text(verbatim: PersonaWardrobe.characterName(character)))
        .accessibilityValue(isLocked ? Text(verbatim: lockHint(character) ?? "") : Text(verbatim: ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("persona-appearance.character.\(character.rawValue)")
    }

    private var lockBadge: some View {
        PersonaIconView(icon: .lock, size: 10, strokeWidth: 2.6)
            .foregroundStyle(.white)
            .frame(width: 16, height: 16)
            .background(Color(.sRGB, red: 15 / 255, green: 16 / 255, blue: 20 / 255, opacity: 0.72), in: Circle())
            .padding(3)
    }

    // MARK: Shape tab

    private var shapeGrid: some View {
        let isLocked = locked(current)
        return PersonaGrid(minimum: 76, spacing: 8) {
            ForEach(MascotShape.allCases, id: \.self) { shape in
                let on = draft.complete.shape == shape
                let look = shapeLook(shape)
                Button {
                    var next = draft
                    var complete = next.complete
                    if let color = MascotShape.pickedColor(shape, from: complete.shape, skin: complete.shapeSkin) { next.color = color }
                    complete.shape = shape
                    next.look = complete.stored
                    save(next)
                } label: {
                    VStack(spacing: 4) {
                        MascotCharacterView(look: look, color: draft.color, skin: .none, size: 40, hd: false)
                            .frame(width: 40, height: 40)
                        Text(verbatim: PersonaWardrobe.shapeName(shape))
                            .font(theme.font(11))
                            .foregroundStyle(theme.inkSecondary)
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, minHeight: 78)
                    .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(on ? theme.accentBorder : .clear, lineWidth: 2))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isLocked || working)
                .accessibilityLabel(Text(verbatim: PersonaWardrobe.shapeName(shape)))
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
    }

    // MARK: Color tab

    private var colorPicker: some View {
        let groups = PersonaWardrobe.groups(for: current, color: draft.color)
        let worn = PersonaWardrobe.group(of: draft.color)
        let open = colorTab.flatMap { groups.contains($0) ? $0 : nil } ?? (groups.contains(worn) ? worn : groups[0])
        let isLocked = locked(current)
        return VStack(alignment: .leading, spacing: 12) {
            PanelFlow(spacing: 6, lineSpacing: 6) {
                ForEach(groups, id: \.self) { group in
                    chip(PersonaWardrobe.groupName(group), on: group == open, dot: group == worn ? tint : nil) { colorTab = group }
                        .accessibilityIdentifier("persona-appearance.palette.\(group.rawValue)")
                }
            }
            PanelFlow(spacing: 12, lineSpacing: 12) {
                ForEach(PersonaWardrobe.colors(open), id: \.self) { name in
                    let on = draft.color == name
                    Button {
                        var next = draft
                        next.color = name
                        save(next)
                    } label: {
                        Circle()
                            .fill(MausPalette.color(name))
                            .frame(width: 36, height: 36)
                            .overlay(Circle().strokeBorder(.white.opacity(0.18), lineWidth: 1))
                            .overlay {
                                if on { Circle().strokeBorder(theme.ink.opacity(0.8), lineWidth: 2).frame(width: 46, height: 46) }
                            }
                            .frame(width: 36, height: 36)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isLocked || working)
                    .accessibilityLabel(Text(verbatim: name))
                    .accessibilityAddTraits(on ? .isSelected : [])
                    .accessibilityIdentifier("persona-appearance.color.\(name)")
                }
            }
            .padding(4)
        }
    }

    // MARK: Skin tab

    private var skinPicker: some View {
        let character = current
        let all = CompleteMascotLook.skinIDs(character)
        let tiers = SkinTier.allCases.map { tier in (tier, all.filter { MascotUnlocks.tier(character, skin: $0) == tier }) }.filter { !$0.1.isEmpty }
        let selected = shownSkinID
        let selectedTier = MascotUnlocks.tier(character, skin: selected)
        let open = tierTab.flatMap { tier in tiers.contains { $0.0 == tier } ? tier : nil }
            ?? (tiers.contains { $0.0 == selectedTier } ? selectedTier : tiers.first?.0 ?? .common)
        let wornSkin: String = character != wornCharacter ? "" : character == .owl ? worn.skin.rawValue : (worn.complete.skinID(character) ?? "")
        let characterLocked = locked(character)
        return VStack(alignment: .leading, spacing: 12) {
            PanelFlow(spacing: 6, lineSpacing: 6) {
                ForEach(tiers, id: \.0) { entry in
                    chip(PersonaWardrobe.tierName(entry.0), on: entry.0 == open, count: entry.1.count) { tierTab = entry.0 }
                        .accessibilityIdentifier("persona-appearance.tier.\(entry.0.rawValue)")
                }
            }
            PersonaGrid(minimum: 88, spacing: 8) {
                ForEach(tiers.first { $0.0 == open }?.1 ?? [], id: \.self) { id in
                    let isLocked = characterLocked || unlocks.skinLocked(character, skin: id, current: wornSkin)
                    let look = skinLook(character, id)
                    Button {
                        if isLocked { previewSkin = id; return }
                        previewSkin = nil
                        var next = draft
                        if character == .owl {
                            next.skin = MascotSkin(rawValue: id) ?? .none
                        } else {
                            var complete = next.complete
                            complete.setSkin(id, for: character)
                            next.look = complete.stored
                        }
                        save(next)
                    } label: {
                        VStack(spacing: 6) {
                            MascotCharacterView(look: look, color: draft.color, skin: character == .owl ? (MascotSkin(rawValue: id) ?? .none) : .none, size: 52, hd: false)
                                .frame(width: 56, height: 56)
                                .grayscale(isLocked ? 0.85 : 0)
                                .opacity(isLocked ? 0.6 : 1)
                            Text(verbatim: PersonaWardrobe.skinName(character, id))
                                .font(theme.font(12))
                                .foregroundStyle(theme.ink)
                                .lineLimit(1)
                        }
                        .padding(.top, 6)
                        .frame(maxWidth: .infinity, minHeight: 96, maxHeight: 96)
                        .background(theme.inset, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(selected == id ? theme.accentBorder : .clear, lineWidth: 2))
                        .overlay(alignment: .topTrailing) { if isLocked { lockBadge } }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(working)
                    .accessibilityLabel(Text(verbatim: "\(PersonaWardrobe.skinName(character, id)), \(PersonaWardrobe.tierName(MascotUnlocks.tier(character, skin: id)))"))
                    .accessibilityValue(isLocked ? Text(verbatim: lockHint(character, skin: id) ?? "") : Text(verbatim: ""))
                    .accessibilityAddTraits(selected == id ? .isSelected : [])
                    .accessibilityIdentifier("persona-appearance.skin.\(id)")
                }
            }
        }
    }

    // MARK: Pieces

    private func shapeLook(_ shape: MascotShape) -> CompleteMascotLook {
        var look = draft.complete
        look.character = .shape
        look.shape = shape
        return look
    }

    private func skinLook(_ character: MascotCharacter, _ id: String) -> CompleteMascotLook {
        var look = draft.complete
        look.character = character
        look.setSkin(id, for: character)
        return look
    }

    private func chip(_ title: String, on: Bool, dot: Color? = nil, count: Int? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let dot {
                    Circle().fill(dot).frame(width: 8, height: 8).overlay(Circle().strokeBorder(.white.opacity(0.4), lineWidth: 1))
                }
                Text(verbatim: title)
                if let count {
                    Text(verbatim: "\(count)").monospacedDigit().foregroundStyle(theme.inkTertiary)
                }
            }
            .font(theme.font(12))
            .foregroundStyle(on ? theme.ink : theme.inkSecondary)
            .padding(.horizontal, 12)
            .frame(height: 26)
            .background(on ? theme.selected : .clear, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? theme.accentBorder : theme.hairlineWeak, lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    /// "Unlock: <achievement>" (`lockHint`), or nil when no achievement unlocks it.
    private func lockHint(_ character: MascotCharacter, skin: String? = nil) -> String? {
        guard let achievement = unlocks.lockAchievement(character, skin: skin) else { return nil }
        let name = achievement.hidden ? String(localized: "Secret achievement") : achievement.name.resolved(AchievementLanguage.current)
        return String(localized: "Unlock: \(name)")
    }

    // MARK: Generate, Upload

    private var generateTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            if canGenerate {
                Text("Describe the picture. It is made with the image provider set up on your computer.")
                    .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
                PanelTextArea(placeholder: "Art direction", text: $prompt, minHeight: 80)
                PanelButton(title: "Generate", systemImage: "sparkles", prominent: true,
                            disabled: working || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
                    Task { await generate() }
                }
            } else {
                Text("To generate pictures, set up the shared image provider in Sagax on your computer. Provider keys cannot be added from this device.")
                    .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance.generate")
    }

    private var uploadTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer.")
                .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
            // compact: the two buttons stack, never past the screen's edge (#4041)
            (compact ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))) {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label("Choose a picture", systemImage: "photo.badge.plus")
                        .font(theme.font(12.5, .medium))
                        .foregroundStyle(theme.ink)
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(theme.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .disabled(working)
                if bot.avatarUrl != nil {
                    PanelButton(title: "Use the character", systemImage: "trash", disabled: working) {
                        Task { await edit(BotProfileEdit(avatarCrop: .mascot, avatarUrl: .clear)) }
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("persona-appearance.upload")
    }

    // MARK: Saving (the old avatar popover's path)

    private func save(_ next: CharacterDraft) {
        let previous = draft
        guard next != previous else { return }
        draft = next
        var change = BotProfileEdit()
        if next.color != previous.color { change.color = next.color }
        if next.look != previous.look { change.mascotLook = next.look }
        if next.skin != previous.skin { change.mascotSkin = next.skin }
        guard !change.isEmpty else { return }
        Task {
            if !(await edit(change)) { draft = previous }
        }
    }

    @discardableResult
    private func edit(_ change: BotProfileEdit) async -> Bool {
        guard let client = session.profileClient else { return false }
        do {
            session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change))
            return true
        } catch {
            session.actionError = error.localizedDescription
            return false
        }
    }

    private func generate() async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        working = true
        defer { working = false }
        if await session.generateAvatar(prompt: String(text.prefix(400)), for: bot) != nil { mode = .upload }
    }

    private func upload(_ item: PhotosPickerItem) async {
        working = true
        defer { working = false; photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        guard let mime = Self.imageMIME(data) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        let crop = bot.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        _ = await session.uploadAvatar(data, mime: mime, for: bot, crop: crop)
    }

    private static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        if bytes.count >= 12, bytes[0...3] == [0x52, 0x49, 0x46, 0x46], bytes[8...11] == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
        return nil
    }
}

// MARK: - Layout

/// `grid-cols-[repeat(auto-fill,minmax(<minimum>px,1fr))]`: as many equal
/// columns of at least `minimum` as the width holds.
struct PersonaGrid: Layout {
    var minimum: CGFloat
    var spacing: CGFloat

    /// ScrollView / full-bleed main column can propose infinity or NaN; fall
    /// back to a finite width so Int conversion never traps (#1939).
    private func finiteWidth(_ width: CGFloat) -> CGFloat {
        width.isFinite && width > 0 ? width : minimum * 4
    }

    private func columns(_ width: CGFloat) -> (count: Int, size: CGFloat) {
        let safe = finiteWidth(width)
        let count = max(1, Int(((safe + spacing) / (minimum + spacing)).rounded(.down)))
        return (count, (safe - CGFloat(count - 1) * spacing) / CGFloat(count))
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = finiteWidth(proposal.width ?? minimum * 4)
        let (count, size) = columns(width)
        var height: CGFloat = 0
        for row in stride(from: 0, to: subviews.count, by: count) {
            let rowHeight = subviews[row..<min(row + count, subviews.count)]
                .map { $0.sizeThatFits(ProposedViewSize(width: size, height: nil)).height }.max() ?? 0
            height += rowHeight + (row > 0 ? spacing : 0)
        }
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let (count, size) = columns(bounds.width)
        var y = bounds.minY
        for row in stride(from: 0, to: subviews.count, by: count) {
            let slice = subviews[row..<min(row + count, subviews.count)]
            let rowHeight = slice.map { $0.sizeThatFits(ProposedViewSize(width: size, height: nil)).height }.max() ?? 0
            for (index, subview) in slice.enumerated() {
                subview.place(at: CGPoint(x: bounds.minX + CGFloat(index) * (size + spacing), y: y),
                              proposal: ProposedViewSize(width: size, height: rowHeight))
            }
            y += rowHeight + spacing
        }
    }
}

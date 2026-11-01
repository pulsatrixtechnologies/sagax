// The Character editor: which Sagax character stands for a bot and how it
// looks. The create-bot sheet (reference 20) and the profile's Character
// card (03/04, P4) both use it; only the metrics and the optional rows
// differ. It follows the desktop's `MascotLookEditor.tsx`:
//
//   1. Character: Owl, Shape, Trombi, in the bot's colour.
//   2. Shape (Shape only): every shape, four to a row.
//   3. Skin: owl 7, shape 6, Trombi 4.
//   4. Colour: the 12 Sagax colours as 6+6 (hidden for Trombi); where the
//      desktop offers the Clay palette (Shapes, Shiba, Grump, Ogre, Frog, or
//      a bot already in a Clay colour), a Classic | Clay switch shows its
//      twelve swatches in the same 6+6 rows (`colorGroupsFor`, MS5).
//   5. Photo (optional): upload or remove a picture.
//   6. Reset to default (optional): the owl, green, no skin, no picture.
//
// Locks (matrix row BP6, #475): with `unlocks` from the person's
// achievements, every character and every skin shows; one not earned yet is
// greyed with a padlock and the achievement that unlocks it. A tap on it
// previews it ("Preview: locked, nothing is saved", #518) and never writes
// the draft. Trombi stays out until found (an easter egg). What the bot
// wears now always stays usable. Each skin names its rarity (Common, Rare,
// Epic, Legendary) to VoiceOver.
//
// Every choice is written to the binding at once; the owner decides whether
// that is a draft (create) or a save (profile).
//
// `section` draws one part only (the bot's Appearance sheet, track A,
// 2026-10-28: a preview on top, then Mascot | Shape | Color | Skin as a
// segmented control, one grid at a time). Nil draws every part, as above.
import PhotosUI
import SwiftUI
import CompanionCore

/// What the editor edits: the stored look, the colour and the owl's skin.
struct CharacterDraft: Equatable {
    var look: MascotLook = .owl
    var color: String = "green"
    var skin: MascotSkin = .none

    /// The desktop's reset (`BotProfileAvatarCard.tsx`).
    static let `default` = CharacterDraft()

    init(look: MascotLook = .owl, color: String = "green", skin: MascotSkin = .none) {
        self.look = look
        self.color = color
        self.skin = skin
    }

    init(bot: Bot) {
        self.init(look: bot.mascotLook ?? .owl, color: bot.color, skin: bot.resolvedMascotSkin)
    }

    var complete: CompleteMascotLook { look.complete }

    var character: MascotCharacter {
        get { look.character }
        set {
            var next = complete
            next.character = newValue
            look = newValue == .owl ? .owl : next.stored
        }
    }

    var newBotDraft: (MascotLook, MascotSkin) { (look, skin) }
}

struct CharacterEditor: View {
    @Environment(\.themePalette) var themePalette
    /// Grid sizes: the create sheet's (measured on 20) or the profile card's.
    struct Metrics {
        var cell: CGFloat
        var pitch: CGFloat
        var skinCell: CGFloat
        var skinPitch: CGFloat
        var swatch: CGFloat
        var swatchPitch: CGFloat
        var swatchRowPitch: CGFloat
        /// Skin row centre to first colour row centre.
        var skinToColours: CGFloat
        var topPadding: CGFloat
        /// The skin row's height when it differs from `pitch`.
        var skinRowHeight: CGFloat? = nil
        /// Space above the photo row.
        var photoTopPadding: CGFloat = 20

        /// Reference 20: 34 pt cells on a 57.67 pitch, 25 pt swatches on
        /// 53.33, colour rows 42.1 apart.
        static let createSheet = Metrics(
            cell: 34, pitch: 57.67, skinCell: 26, skinPitch: 35,
            swatch: 25, swatchPitch: 53.33, swatchRowPitch: 42.1, skinToColours: 65.4, topPadding: 25.3
        )

        /// Reference 03: 35 pt cells on a 60 pt pitch, 26 pt swatches on 53.
        /// The first row is centred 44 pt into the card, and the owl's rows
        /// plus the photo row end where the reference's divider is (252 pt).
        static let profileCard = Metrics(
            cell: 35, pitch: 60, skinCell: 27, skinPitch: 36,
            swatch: 26, swatchPitch: 53, swatchRowPitch: 40, skinToColours: 50, topPadding: 14,
            skinRowHeight: 50, photoTopPadding: 6
        )
    }

    /// One part of the editor, for a sheet that shows one grid at a time.
    enum Section: String, CaseIterable, Identifiable {
        case character, shape, colour, skin
        var id: String { rawValue }

        /// The parts a character offers: Shape only for Shapes, Color for every character but Trombi.
        static func offered(for character: MascotCharacter) -> [Section] {
            allCases.filter { ($0 != .shape || character == .shape) && ($0 != .colour || character != .trombi) }
        }
    }

    @Binding var draft: CharacterDraft
    var metrics: Metrics = .createSheet
    /// The one part to draw; nil draws them all.
    var section: Section? = nil
    /// The picture row (Upload, Remove): the profile shows it, create does not.
    var showsPhotoRow = false
    /// "Reset to default": the profile shows it, create does not.
    var showsReset = false
    var hasPhoto = false
    var onPhotoPicked: ((Data) -> Void)?
    var onRemovePhoto: (() -> Void)?
    /// "Generate": the owner asks for the art direction, then generates.
    var onGeneratePhoto: (() -> Void)?
    /// "Frame": pinch and drag the picture in its frame.
    var onFramePhoto: (() -> Void)?
    /// Called after the draft is reset, so the owner also clears the picture
    /// (`avatarCrop: mascot`).
    var onReset: (() -> Void)?
    /// What the person may wear. Enforced until a snapshot arrives; a 404 is `.nothingLocked`.
    /// The bot's current character stays wearable either way.
    var unlocks: MascotUnlocks = .lockedUntilLoaded

    @State private var photoItem: PhotosPickerItem?
    /// The colour row picked by hand; nil follows the colour worn.
    @State private var colourRow: MausColors.PickerRow?
    /// A locked character picked to look at; nil shows the one in the draft.
    @State private var previewCharacter: MascotCharacter?
    /// A locked skin picked to look at, on the character shown.
    @State private var previewSkin: String?

    private static let ringGap: CGFloat = 2.7
    private static let ringWidth: CGFloat = 2

    private func draws(_ part: Section) -> Bool { section == nil || section == part }

    var body: some View {
        VStack(spacing: 0) {
            let characters = unlocks.listedCharacters(current: wornDraft.character)
            let shown = shownCharacter
            let characterLines = Self.lines(characters, perRow: 5)
            if draws(.character) {
                ForEach(characterLines.indices, id: \.self) { line in
                    row(count: characterLines[line].count, pitch: metrics.pitch, height: metrics.pitch) { index in
                        characterCell(characterLines[line][index], shown: shown)
                    }
                }
            }

            if draft.character == .shape && draws(.shape) {
                // every shape, four to a row
                let shapeLines = Self.lines(MascotShape.allCases, perRow: 4)
                ForEach(shapeLines.indices, id: \.self) { line in
                    row(count: shapeLines[line].count, pitch: metrics.pitch, height: metrics.pitch) { index in
                        let shape = shapeLines[line][index]
                        thumbnail(look: edited { $0.shape = shape; $0.avatarDef = ShapeAvatarPresets.byShape(shape) }, skin: .none, size: metrics.cell, selected: draft.complete.shape == shape, label: Text(verbatim: shape.rawValue)) {
                            var next = draft.complete
                            if let color = MascotShape.pickedColor(shape, from: next.shape, skin: next.shapeSkin) { draft.color = color }
                            next.shape = shape
                            // Object shapes carry their path preset; polar catalog clears a custom def.
                            next.avatarDef = ShapeAvatarPresets.byShape(shape)
                            draft.look = next.stored
                        }
                    }
                }
                if section == .shape {
                    ShapeAvatarEditorPanel(draft: $draft)
                        .padding(.top, 12)
                        .padding(.horizontal, Theme.Metric.rowInset)
                }
            }

            if draws(.skin) { skinRow }

            if previewing {
                previewCard.padding(.top, 10)
            }

            if draft.character != .trombi && draws(.colour) {
                colourRows
                    .padding(.top, section == nil ? metrics.skinToColours - (metrics.skinRowHeight ?? metrics.pitch) / 2 - metrics.swatch / 2 : 8)
            }

            if showsPhotoRow { photoRow.padding(.top, metrics.photoTopPadding) }
            if showsReset { resetRow.padding(.top, 12) }
        }
        .padding(.top, metrics.topPadding)
        .frame(maxWidth: .infinity)
        .animation(.snappy(duration: 0.2), value: draft)
    }

    /// What the bot wears now: always usable (MascotLookEditor.tsx).
    private var wornDraft: CharacterDraft { draft }

    private func skinLocked(_ character: MascotCharacter, _ skin: String, worn current: String) -> Bool {
        unlocks.skinLocked(character, skin: skin, current: current)
    }

    private func tierLabel(_ character: MascotCharacter, _ skin: String) -> Text {
        switch MascotUnlocks.tier(character, skin: skin) {
        case .common: Text("Common")
        case .rare: Text("Rare")
        case .epic: Text("Epic")
        case .legendary: Text("Legendary")
        }
    }

    // MARK: Rows

    /// The character the skins are for: a locked one picked to look at, or the draft's.
    private var shownCharacter: MascotCharacter { previewCharacter ?? draft.character }
    private var shownCharacterLocked: Bool { unlocks.characterLocked(shownCharacter, current: wornDraft.character) }
    private var previewing: Bool { previewCharacter != nil || previewSkin != nil }

    /// The skin the draft wears on `character`.
    private func wornSkin(_ character: MascotCharacter) -> String {
        character == .owl ? draft.skin.rawValue : (draft.complete.skinID(character) ?? "")
    }

    /// Every skin of the character shown (#475): a locked one (or any skin
    /// of a locked character) greyed with its padlock, previewed on a tap.
    @ViewBuilder private var skinRow: some View {
        let character = shownCharacter
        let characterLocked = shownCharacterLocked
        let picked = previewSkin
        let ids = CompleteMascotLook.skinIDs(character)
        let large = character == .trombi
        let worn = character == draft.character ? wornSkin(character) : nil
        let skinLines = Self.lines(ids, perRow: large ? 5 : 9)
        ForEach(skinLines.indices, id: \.self) { line in
            row(count: skinLines[line].count, pitch: large ? metrics.pitch : metrics.skinPitch,
                height: large ? metrics.pitch : (metrics.skinRowHeight ?? metrics.pitch)) { index in
                skinCell(skinLines[line][index], character: character, characterLocked: characterLocked, picked: picked, worn: worn)
            }
        }
    }

    private func characterCell(_ character: MascotCharacter, shown: MascotCharacter) -> some View {
        let locked = unlocks.characterLocked(character, current: wornDraft.character)
        return thumbnail(
            look: lookFor(character),
            skin: character == .owl ? draft.skin : .none,
            size: metrics.cell,
            selected: shown == character,
            label: Text(Self.characterName(character)),
            locked: locked,
            hint: locked ? lockHint(character) : nil
        ) {
            previewSkin = nil
            if locked {
                previewCharacter = character
            } else {
                previewCharacter = nil
                draft.character = character
            }
        }
    }

    private func skinCell(_ id: String, character: MascotCharacter, characterLocked: Bool, picked: String?, worn: String?) -> some View {
        let large = character == .trombi
        let locked = characterLocked || unlocks.skinLocked(character, skin: id, current: worn ?? "")
        return thumbnail(
            look: skinLook(character, id),
            skin: character == .owl ? (MascotSkin(rawValue: id) ?? .none) : .none,
            size: large ? metrics.cell : metrics.skinCell,
            selected: picked.map { $0 == id } ?? (worn == id),
            label: Text(verbatim: id),
            tier: tierLabel(character, id),
            locked: locked,
            hint: locked ? lockHint(character, skin: id) : nil
        ) {
            if locked {
                previewSkin = id
            } else {
                previewSkin = nil
                if character == .owl {
                    draft.skin = MascotSkin(rawValue: id) ?? .none
                } else {
                    var next = draft.complete
                    next.setSkin(id, for: character)
                    draft.look = next.stored
                }
            }
        }
    }

    private func skinLook(_ character: MascotCharacter, _ id: String) -> CompleteMascotLook {
        var look = lookFor(character)
        look.setSkin(id, for: character)
        return look
    }

    /// "Unlock: <achievement>" (`lockHint`), or nil when no achievement unlocks it.
    private func lockHint(_ character: MascotCharacter, skin: String? = nil) -> String? {
        guard let achievement = unlocks.lockAchievement(character, skin: skin) else { return nil }
        let name = achievement.hidden ? String(localized: "Secret achievement") : achievement.name.resolved(AchievementLanguage.current)
        return String(localized: "Unlock: \(name)")
    }

    /// The look picked to look at (#518): the mascot as it would be, greyed
    /// when its character is locked, "Preview: locked, nothing is saved" and
    /// the achievement that unlocks it. A tap closes it.
    private var previewCard: some View {
        let character = shownCharacter
        let look = previewSkin.map { skinLook(character, $0) } ?? lookFor(character)
        let owlSkin = character == .owl ? (previewSkin.flatMap(MascotSkin.init(rawValue:)) ?? draft.skin) : .none
        let hint = lockHint(character, skin: previewSkin)
        let greyed = shownCharacterLocked
        return Button {
            previewCharacter = nil
            previewSkin = nil
        } label: {
            HStack(spacing: 12) {
                MascotCharacterView(look: look, color: draft.color, skin: owlSkin, size: 48, hd: false)
                    .frame(width: 48, height: 48)
                    .grayscale(greyed ? 1 : 0)
                    .opacity(greyed ? 0.6 : 1)
                VStack(alignment: .leading, spacing: 2) {
                    Text(Self.characterName(character))
                        .font(Theme.Font.rowTitle)
                        .foregroundStyle(Theme.textPrimary)
                    Text("Preview: locked, nothing is saved")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                    if let hint {
                        Text(verbatim: hint)
                            .font(.footnote)
                            .foregroundStyle(Theme.textTertiary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "lock.fill")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Theme.textSecondary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.horizontal, Theme.Metric.rowInset)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("character-skin-preview")
    }

    private var offersClay: Bool { MausColors.offersClay(draft.character, color: draft.color) }

    private var shownRow: MausColors.PickerRow {
        guard offersClay else { return .classic }
        return colourRow ?? MausColors.pickerRow(for: draft.color, character: draft.character)
    }

    private var colourRows: some View {
        let names = shownRow.swatches
        return VStack(spacing: metrics.swatchRowPitch - metrics.swatch) {
            if offersClay {
                Picker(String(localized: "Palettes"), selection: Binding(get: { shownRow }, set: { colourRow = $0 })) {
                    Text(String(localized: "Classic")).tag(MausColors.PickerRow.classic)
                    Text(String(localized: "Clay")).tag(MausColors.PickerRow.clay)
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 220)
                .accessibilityIdentifier("character-color-palette")
            }
            ForEach(0..<2, id: \.self) { line in
                HStack(spacing: metrics.swatchPitch - metrics.swatch) {
                    ForEach(0..<6, id: \.self) { index in
                        swatch(names[line * 6 + index])
                    }
                }
                // the second row sits half a pitch to the right
                .offset(x: line == 0 ? -metrics.swatchPitch / 4 : metrics.swatchPitch / 4)
            }
        }
        .onValueChange(of: draft.character) { _ in colourRow = nil }
    }

    private func swatch(_ name: String) -> some View {
        let selected = draft.color == name
        return Button {
            Haptics.selection()
            draft.color = name
        } label: {
            Circle()
                .fill(MausPalette.color(name))
                .frame(width: metrics.swatch, height: metrics.swatch)
                .overlay {
                    if selected {
                        Circle()
                            .strokeBorder(Theme.selectionRing, lineWidth: Self.ringWidth)
                            .frame(width: metrics.swatch + 2 * (Self.ringGap + Self.ringWidth), height: metrics.swatch + 2 * (Self.ringGap + Self.ringWidth))
                    }
                }
                .frame(width: metrics.swatch, height: metrics.swatch)
                .contentShape(Circle().inset(by: -6))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private var photoRow: some View {
        HStack(spacing: 12) {
            Text("Photo")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.textPrimary)
            Spacer()
            PhotosPicker(selection: $photoItem, matching: .images) {
                Text("Upload").font(Theme.Font.rowTitle).foregroundStyle(Theme.blue)
            }
            .accessibilityIdentifier("character-photo-upload")
            if let onGeneratePhoto {
                Button {
                    onGeneratePhoto()
                } label: {
                    Text("Generate").font(Theme.Font.rowTitle).foregroundStyle(Theme.blue)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("character-photo-generate")
            }
            if hasPhoto {
                if let onFramePhoto {
                    Button {
                        onFramePhoto()
                    } label: {
                        Text("Frame").font(Theme.Font.rowTitle).foregroundStyle(Theme.blue)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("character-photo-frame")
                }
                Button {
                    onRemovePhoto?()
                } label: {
                    Text("Remove").font(Theme.Font.rowTitle).foregroundStyle(Theme.destructive)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("character-photo-remove")
            }
        }
        .padding(.horizontal, Theme.Metric.rowInset)
        .frame(height: Theme.Metric.rowHeight)
        .onValueChange(of: photoItem) { item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) { onPhotoPicked?(data) }
                photoItem = nil
            }
        }
    }

    private var resetRow: some View {
        Button {
            Haptics.selection()
            draft = .default
            onReset?()
        } label: {
            Text("Reset to default")
                .font(Theme.Font.rowTitle)
                .foregroundStyle(Theme.blue)
                .frame(maxWidth: .infinity)
                .frame(height: Theme.Metric.rowHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: Parts

    /// `count` cells centred on a `pitch`, in a row `height` tall.
    private func row<Cell: View>(count: Int, pitch: CGFloat, height: CGFloat, @ViewBuilder cell: @escaping (Int) -> Cell) -> some View {
        HStack(spacing: 0) {
            ForEach(0..<count, id: \.self) { index in
                cell(index).frame(width: pitch, height: height)
            }
        }
        .frame(height: height)
    }

    /// `items` in rows of at most `perRow` (every character and every skin
    /// show now, more than one row holds).
    private static func lines<Item>(_ items: [Item], perRow: Int) -> [[Item]] {
        stride(from: 0, to: items.count, by: perRow).map { Array(items[$0..<min($0 + perRow, items.count)]) }
    }

    /// A tap always reaches `action`: the caller previews a locked choice
    /// and never writes it.
    private func thumbnail(look: CompleteMascotLook, skin: MascotSkin, size: CGFloat, selected: Bool, label: Text, tier: Text? = nil, locked: Bool = false, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.selection()
            action()
        } label: {
            MascotCharacterView(look: look, color: draft.color, skin: skin, size: size, hd: false)
                .frame(width: size, height: size)
                .grayscale(locked ? 1 : 0)
                .opacity(locked ? 0.55 : 1)
                .modifier(SilhouetteRing(visible: selected, gap: Self.ringGap, width: Self.ringWidth))
                .overlay(alignment: .bottomTrailing) {
                    if locked {
                        Image(systemName: "lock.fill")
                            .font(.system(size: 7, weight: .bold))
                            .foregroundStyle(Theme.textPrimary)
                            .frame(width: 13, height: 13)
                            .background(Theme.cardRaised, in: Circle())
                            .offset(x: 4, y: 4)
                            .accessibilityHidden(true)
                    }
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tier.map { Text("\(label), \($0)") } ?? label)
        .accessibilityValue(locked ? Text("Locked") : Text(verbatim: ""))
        .accessibilityHint(hint.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func edited(_ change: (inout CompleteMascotLook) -> Void) -> CompleteMascotLook {
        var look = draft.complete
        change(&look)
        return look
    }

    private func lookFor(_ character: MascotCharacter) -> CompleteMascotLook {
        var look = draft.complete
        look.character = character
        return look
    }

    static func characterName(_ character: MascotCharacter) -> LocalizedStringResource {
        switch character {
        case .owl: "Owl"
        case .shape: "Shape"
        case .trombi: "Trombi"
        case .bunbu: "Bunbu"
        case .shiba: "Shiba"
        case .grump: "Grump"
        case .ogre: "Ogre"
        case .frog: "Frog"
        case .crab: "Crab"
        }
    }
}

/// The selection outline that follows a mascot's own silhouette: a ring
/// `width` wide, `gap` away from the shape (reference 20's cloud).
struct SilhouetteRing: ViewModifier {
    @Environment(\.themePalette) var themePalette
    let visible: Bool
    var gap: CGFloat = 2.7
    var width: CGFloat = 2
    var ring: Color = Theme.selectionRing
    var background: Color = Theme.bg

    func body(content: Content) -> some View {
        if visible {
            content.background {
                ZStack {
                    stamp(content, color: ring, radius: gap + width)
                    stamp(content, color: background, radius: gap)
                }
            }
        } else {
            content
        }
    }

    private func stamp(_ content: Content, color: Color, radius: CGFloat) -> some View {
        ZStack {
            ForEach(0..<20, id: \.self) { i in
                let a = Double(i) / 20 * 2 * .pi
                color.mask(content).offset(x: cos(a) * radius, y: sin(a) * radius)
            }
        }
    }
}

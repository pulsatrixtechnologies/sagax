// iPad I4: the character editor the panel's mascot opens (`Edit avatar`,
// `BotProfileAvatarCard.tsx` with `floating-bots/MascotLookEditor.tsx`),
// as desktop-*-34-panel-avatar-editor draws it: a 452 pt card (radius 16,
// hairline/50 ring, `bg-card`, 14 pt in, shadow) 8 pt under the mascot,
// its trailing edge 12 pt inside the panel, so it reaches over the chat.
// Tabs Bot / Generate / Upload and Reset (12 pt); on Bot: the 64 pt
// preview (Lot 9: plain, no gradient card), Character, Color, Skin and
// the owl's Moves as scrolling sections. Saved as each choice is made
// (`PATCH /api/bots/:id/profile`), as on the desktop.
// Every character and skin shows (#475): a locked one greyed with its
// padlock and the achievement that unlocks it; a tap previews it on the
// stage, "Preview: locked, nothing is saved" (#518), and saves nothing.
import PhotosUI
import SwiftUI
import UIKit
import CompanionCore

/// The editor over the panel: docked, its trailing edge 12 pt inside the
/// panel (it reaches over the chat); over the leading edge below 1024, its
/// leading edge 12 pt in.
struct BotAvatarEditorLayer: View {
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let docked: Bool

    var body: some View {
        BotAvatarEditor(bot: bot, close: close)
            .padding(.top, 187)
            .padding(docked ? .trailing : .leading, 12)
    }

    private func close() {
        withAnimation(.easeOut(duration: 0.15)) { model.avatarEditorOpen = false }
    }
}

struct BotAvatarEditor: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let close: () -> Void

    enum Tab: String, CaseIterable { case bot, generate, upload }

    @State private var tab: Tab = .bot
    @State private var draft = CharacterDraft()
    @State private var unlocks: MascotUnlocks = .lockedUntilLoaded
    @State private var prompt = ""
    @State private var working = false
    @State private var photo: PhotosPickerItem?
    @State private var config: ConfigStatus?
    /// The colour row picked by hand; nil follows the colour worn.
    @State private var colourRow: MausColors.PickerRow?
    /// The stage's own mascot plays the moves (as MascotLookEditor.tsx's stage).
    @StateObject private var stageHandle = OwlMascotHandle()
    @State private var hop = false
    /// A locked character picked to look at; nil shows the draft's.
    @State private var previewCharacter: MascotCharacter?
    /// A locked skin picked to look at, on the character shown.
    @State private var previewSkin: String?

    private var shownRow: MausColors.PickerRow {
        guard MausColors.offersClay(draft.character, color: draft.color) else { return .classic }
        return colourRow ?? MausColors.pickerRow(for: draft.color, character: draft.character)
    }

    /// #1098: an admin, the owner's sidecar, or the bot's owner on an
    /// organization server (`SurfaceFeature.botAvatarGenerate`).
    private var canGenerate: Bool { session.surfaceGate.allows(.botAvatarGenerate, bot: bot) && config?.imageGen?.configured == true }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                ForEach(Tab.allCases, id: \.self) { item in
                    Button { tab = item } label: {
                        Text(title(item))
                            .font(theme.font(12))
                            .foregroundStyle(tab == item ? theme.ink : theme.inkSecondary)
                            .padding(.horizontal, 8)
                            .frame(height: 26)
                            .background(tab == item ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(tab == item ? .isSelected : [])
                    .accessibilityIdentifier("avatar-tab.\(item.rawValue)")
                }
                Spacer(minLength: 0)
                Button {
                    draft = .default
                    Task { await edit(.resetLook) }
                } label: {
                    Text("Reset").font(theme.font(12)).foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 8).frame(height: 26).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("avatar-reset")
            }
            Group {
                switch tab {
                case .bot: AnyView(botTab)
                case .generate: AnyView(generateTab)
                case .upload: AnyView(uploadTab)
                }
            }
            .padding(.top, 11)
        }
        .padding(14)
        .frame(width: 452, alignment: .leading)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(theme.hairline50, lineWidth: 1))
        .shadow(color: .black.opacity(0.35), radius: 24, y: 12)
        .overlay { if working { ProgressView().controlSize(.large) } }
        .onAppear { draft = CharacterDraft(bot: bot) }
        .onValueChange(of: CharacterDraft(bot: bot)) { server in if !working { draft = server } }
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
        .accessibilityLabel(Text("Edit avatar"))
        .accessibilityIdentifier("desktop-avatar-editor")
    }

    private func title(_ tab: Tab) -> LocalizedStringKey {
        switch tab {
        case .bot: "Bot"
        case .generate: "Generate"
        case .upload: "Upload"
        }
    }

    // MARK: Bot

    private var botTab: some View {
        VStack(alignment: .leading, spacing: 0) {
            stage
            VStack(alignment: .leading, spacing: 6) {
                VStack(alignment: .leading, spacing: 6) {
                    label("Character")
                    let wornCharacter = CharacterDraft(bot: bot).character
                    let characters = unlocks.listedCharacters(current: wornCharacter)
                    // the state read here, once: the cells' closures run later, outside the body
                    let shown = shownCharacter
                    // equal tiles on one grid, as the web gallery's (minmax(70px, 1fr))
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 70), spacing: 6)], alignment: .leading, spacing: 6) {
                        ForEach(characters, id: \.self) { character in
                            let locked = unlocks.characterLocked(character, current: wornCharacter)
                            cell(look: lookFor(character), skin: character == .owl ? draft.skin : .none,
                                 name: characterName(character), selected: shown == character, height: 64,
                                 locked: locked, hint: locked ? lockHint(character) : nil) {
                                previewSkin = nil
                                if locked {
                                    previewCharacter = character
                                } else {
                                    previewCharacter = nil
                                    var next = draft
                                    next.character = character
                                    save(next)
                                }
                            }
                        }
                    }
                }
            }
            if draft.character == .shape {
                label("Shape").padding(.top, 12)
                LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 4), spacing: 4) {
                    ForEach(MascotShape.allCases, id: \.self) { shape in
                        cell(look: edited { $0.shape = shape }, skin: .none, name: shape.rawValue.capitalized,
                             selected: draft.complete.shape == shape, height: 56, locked: false) {
                            var next = draft
                            var look = next.complete
                            if let color = MascotShape.pickedColor(shape, from: look.shape, skin: look.shapeSkin) { next.color = color }
                            look.shape = shape
                            next.look = look.stored
                            save(next)
                        }
                    }
                }
                .padding(.top, 6)
            }
            if draft.character != .trombi {
                HStack(spacing: 8) {
                    label("Color")
                    Spacer(minLength: 0)
                    if MausColors.offersClay(draft.character, color: draft.color) {
                        // the desktop's palette tabs, narrowed to the phone's rows (MS5)
                        HStack(spacing: 2) {
                            ForEach(MausColors.PickerRow.allCases, id: \.self) { row in
                                chip(row == .clay ? String(localized: "Clay") : String(localized: "Classic"), selected: shownRow == row) { colourRow = row }
                                    .accessibilityIdentifier("avatar-palette.\(row.rawValue)")
                            }
                        }
                    }
                }
                .padding(.top, 12)
                HStack(spacing: 6) {
                    ForEach(shownRow.swatches, id: \.self) { name in swatch(name) }
                }
                .padding(.top, 6)
            }
            label("Skin").padding(.top, 12)
            skins.padding(.top, 6)
            if draft.character == .owl {
                label("Moves").padding(.top, 12)
                HStack(spacing: 6) {
                    ForEach(OwlWingMove.allCases, id: \.self) { move in
                        chip(CharacterMovesMenu.name(move), selected: false) {
                            model.avatarMove = nil
                            DispatchQueue.main.async { model.avatarMove = move }
                        }
                        .accessibilityIdentifier("avatar-move.\(move.rawValue)")
                    }
                }
                .padding(.top, 6)
            }
            if draft.character == .shape {
                // the fourteen Shapes moves, played by the panel's shape (MascotLookEditor.tsx Moves)
                label("Moves").padding(.top, 12)
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 6)], alignment: .leading, spacing: 6) {
                    ForEach(ShapeMove.allCases, id: \.self) { move in
                        chip(CharacterMovesMenu.name(move), selected: false) {
                            model.avatarShapeMove = nil
                            stageHandle.shape(move)
                            DispatchQueue.main.async { model.avatarShapeMove = move }
                        }
                        .accessibilityLabel(Text("Play the \(CharacterMovesMenu.name(move)) move"))
                        .accessibilityIdentifier("avatar-move.\(move.rawValue)")
                    }
                }
                .padding(.top, 6)
            }
        }
    }

    /// The preview stage (Lot 9: plain, no gradient card). The mascot is
    /// large and centred; a tap or pointer hover previews a move.
    private var stage: some View {
        VStack(spacing: 8) {
            ZStack {
                MascotCharacterView(look: stageLook, color: draft.color, skin: stageOwlSkin,
                                    size: 104, animated: true, owlHandle: stageHandle)
                    .grayscale(shownCharacterLocked ? 1 : 0)
                    .opacity(shownCharacterLocked ? 0.6 : 1)
                    .offset(y: hop ? -10 : 0)
                    .scaleEffect(hop ? 1.04 : 1)
                if shownCharacterLocked {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 24, height: 24)
                        .background(theme.control, in: Circle())
                        .padding(8)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
                        .accessibilityHidden(true)
                }
                if previewing {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Preview: locked, nothing is saved")
                        if let hint = lockHint(shownCharacter, skin: previewSkin) { Text(verbatim: hint) }
                    }
                    .font(theme.font(11))
                    .foregroundStyle(theme.inkSecondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(theme.control.opacity(0.9), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .padding(8)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                    .accessibilityIdentifier("avatar-skin-preview")
                }
            }
            .frame(maxWidth: .infinity)
            .frame(height: 150)
            .contentShape(Rectangle())
            .onTapGesture { preview() }
            .onHover { inside in if inside { preview() } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("Preview of \(characterName(shownCharacter))"))
            .accessibilityAddTraits(.isButton)
            .accessibilityIdentifier("avatar-stage")
            Text(verbatim: characterName(shownCharacter))
                .font(theme.font(14, .medium))
                .foregroundStyle(theme.ink)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("avatar-stage-name")
        }
        .padding(.top, 11)
        .padding(.bottom, 4)
    }

    private func preview() {
        switch shownCharacter {
        case .owl: stageHandle.flourish(OwlWingMove.allCases.first!)
        case .shape: stageHandle.shape(ShapeMove.allCases.first!)
        default:
            withAnimation(.spring(response: 0.22, dampingFraction: 0.5)) { hop = true }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.22) {
                withAnimation(.spring(response: 0.3, dampingFraction: 0.55)) { hop = false }
            }
        }
    }

    /// The character on the stage and in the skins: a locked one picked to look at, or the draft's.
    private var shownCharacter: MascotCharacter { previewCharacter ?? draft.character }
    private var shownCharacterLocked: Bool { unlocks.characterLocked(shownCharacter, current: CharacterDraft(bot: bot).character) }
    private var previewing: Bool { previewCharacter != nil || previewSkin != nil }

    private var stageLook: CompleteMascotLook {
        var look = lookFor(shownCharacter)
        if let previewSkin { look.setSkin(previewSkin, for: shownCharacter) }
        return look
    }

    private var stageOwlSkin: MascotSkin {
        guard shownCharacter == .owl else { return .none }
        return previewSkin.flatMap(MascotSkin.init(rawValue:)) ?? draft.skin
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

    /// Every skin of the character shown (#475): a locked one, or any skin of
    /// a locked character, greyed with its padlock and previewed on the stage.
    private var skins: some View {
        let columns = Array(repeating: GridItem(.flexible(), spacing: 4), count: 7)
        let worn = CharacterDraft(bot: bot)
        let character = shownCharacter
        let characterLocked = shownCharacterLocked
        let wornSkin: String? = character != worn.character ? nil
            : character == .owl ? worn.skin.rawValue : worn.complete.skinID(character)
        let selectedSkin = previewSkin ?? (character == draft.character
            ? (character == .owl ? draft.skin.rawValue : draft.complete.skinID(character)) : nil)
        return LazyVGrid(columns: columns, spacing: 4) {
            ForEach(CompleteMascotLook.skinIDs(character), id: \.self) { id in
                let locked = characterLocked || unlocks.skinLocked(character, skin: id, current: wornSkin ?? "")
                cell(look: skinLook(character, id), skin: character == .owl ? (MascotSkin(rawValue: id) ?? .none) : .none,
                     name: skinName(id), selected: selectedSkin == id, height: 60,
                     locked: locked, hint: locked ? lockHint(character, skin: id) : nil) {
                    if locked {
                        previewSkin = id
                        return
                    }
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
                }
            }
        }
    }

    private func label(_ text: LocalizedStringKey) -> some View {
        Text(text)
            .textCase(.uppercase)
            .font(theme.font(11, .medium))
            .tracking(0.88)
            .foregroundStyle(theme.inkSecondary)
            .frame(height: 16.5)
    }

    /// A tap always reaches `action`: the caller previews a locked choice and saves nothing.
    private func cell(look: CompleteMascotLook, skin: MascotSkin, name: String, selected: Bool, height: CGFloat, locked: Bool, hint: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                MascotCharacterView(look: look, color: draft.color, skin: skin, size: height - 28, hd: false)
                    .frame(width: height - 28, height: height - 28)
                    .grayscale(locked ? 1 : 0)
                Text(verbatim: name)
                    .font(theme.font(11))
                    .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity)
            .frame(height: height)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(selected ? theme.accent : .clear, lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                if locked {
                    Image(systemName: "lock.fill").font(.system(size: 8)).foregroundStyle(theme.inkSecondary).padding(4)
                }
            }
            .opacity(locked ? 0.6 : 1)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(verbatim: name))
        .accessibilityValue(locked ? Text("Locked") : Text(verbatim: ""))
        .accessibilityHint(hint.map { Text(verbatim: $0) } ?? Text(verbatim: ""))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func swatch(_ name: String) -> some View {
        let selected = draft.color == name
        return Button {
            var next = draft
            next.color = name
            save(next)
        } label: {
            Circle()
                .fill(MausPalette.color(name))
                .frame(width: 24, height: 24)
                .overlay(Circle().strokeBorder(Color.white.opacity(0.18), lineWidth: 1))
                .overlay {
                    if selected {
                        Circle().strokeBorder(Color.white.opacity(0.8), lineWidth: 2).frame(width: 32, height: 32)
                    }
                }
                .frame(width: 24, height: 24)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Use \(name) mascot color"))
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    private func chip(_ text: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(verbatim: text)
                .font(theme.font(12.5))
                .foregroundStyle(theme.ink)
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(selected ? theme.control : theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
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
        .padding(.vertical, 4)
    }

    private var uploadTab: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer.")
                .panelText(12.5, 19).foregroundStyle(theme.inkSecondary)
            HStack(spacing: 8) {
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
        .padding(.vertical, 4)
    }

    // MARK: Saving

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
        if await session.generateAvatar(prompt: String(text.prefix(400)), for: bot) != nil { close() }
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
        if await session.uploadAvatar(data, mime: mime, for: bot, crop: crop) != nil { close() }
    }

    private static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: [0x47, 0x49, 0x46]) { return "image/gif" }
        if bytes.count >= 12, bytes[0...3] == [0x52, 0x49, 0x46, 0x46], bytes[8...11] == [0x57, 0x45, 0x42, 0x50] { return "image/webp" }
        return nil
    }

    // MARK: Looks

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

    private func characterName(_ character: MascotCharacter) -> String {
        switch character {
        case .owl: String(localized: "Owl")
        case .shape: String(localized: "Original shapes")
        case .trombi: String(localized: "Trombi")
        case .bunbu: String(localized: "Bunbu")
        case .shiba: String(localized: "Shiba")
        case .grump: String(localized: "Grump")
        case .ogre: String(localized: "Ogre")
        case .frog: String(localized: "Frog")
        case .crab: String(localized: "Crab")
        }
    }

    private func skinName(_ raw: String) -> String {
        switch raw {
        case "none": String(localized: "None")
        case "frost": String(localized: "Ice")
        default: raw.capitalized
        }
    }
}

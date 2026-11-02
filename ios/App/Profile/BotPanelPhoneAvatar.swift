// The character editor the panel's mascot opens (`Edit avatar`). Lot 9:
// Back + Done like Grok Bot (Back cancels the look draft; Done saves), a
// plain preview without the gradient card, and Mascot / Shape / Color /
// Skin as scrolling sections (no secondary segmented control). Top tabs
// stay Character / Generate / Upload. Sagax mascots stay ours.
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

struct PhoneBotAvatarSheet: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    let bot: Bot
    @Binding var draft: CharacterDraft

    enum Tab: String, CaseIterable { case bot, generate, upload }

    @State private var tab: Tab = .bot
    @State private var baseline = CharacterDraft()
    @State private var clearsPicture = false
    @State private var confirmDiscard = false
    @State private var unlocks: MascotUnlocks = .lockedUntilLoaded
    @State private var generating = false
    @State private var generatePrompt = ""
    @State private var framing = false
    @State private var photo: PhotosPickerItem?
    @State private var config: ConfigStatus?

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    /// #1098: an admin, the owner's sidecar, or the bot's owner on an
    /// organization server (`SurfaceFeature.botAvatarGenerate`).
    private var canGenerate: Bool { session.surfaceGate.allows(.botAvatarGenerate, bot: bot) && config?.imageGen?.configured == true }
    private var working: Bool { generating }
    private var dirty: Bool { draft != baseline || clearsPicture }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                tabBar
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                ScrollView {
                    VStack(spacing: 0) {
                        preview
                            .padding(.bottom, 20)
                        Group {
                            switch tab {
                            case .bot: botTab
                            case .generate: generateTab
                            case .upload: uploadTab
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 24)
                    .padding(.bottom, 40)
                }
            }
            .background(Theme.bg)
            .overlay { if working { ProgressView().controlSize(.large) } }
            .navigationTitle(Text("Avatar"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(String(localized: "Back")) { attemptBack() }
                        .accessibilityIdentifier("avatar-back")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(String(localized: "Done")) {
                        Task { await commitAndDismiss() }
                    }
                    .fontWeight(.semibold)
                    .accessibilityIdentifier("avatar-done")
                }
            }
        }
        .interactiveDismissDisabled(dirty)
        .confirmationDialog(
            String(localized: "Discard changes?"),
            isPresented: $confirmDiscard,
            titleVisibility: .visible
        ) {
            Button("Discard changes", role: .destructive) { discardAndDismiss() }
            Button("Keep editing", role: .cancel) {}
        } message: {
            Text("The avatar still has edits that are not saved.")
        }
        .sheet(isPresented: $framing) {
            PictureFramingSheet(bot: current) { zoom, x, y in
                Task { await edit(BotProfileEdit(avatarZoom: zoom, avatarFocusX: x, avatarFocusY: y)) }
            }
        }
        .onAppear { syncFromServer(force: true) }
        .onValueChange(of: CharacterDraft(bot: current)) { server in
            if !working && !dirty {
                draft = server
                baseline = server
                clearsPicture = false
            }
        }
        .onValueChange(of: photo) { item in
            guard let item else { return }
            Task { await upload(item) }
        }
        .task {
            config = await session.configStatus()
            if session.surfaceGate.allows(.characterExtras), session.surfaceGate.allows(.achievements),
               let earned = try? await session.profileClient?.mascotUnlocks() {
                unlocks = earned
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Edit avatar"))
        .accessibilityIdentifier("phone-avatar-editor")
    }

    /// Plain centred preview (Lot 9): no gradient card. A stored picture
    /// stays the face until the person clears it; otherwise the draft look.
    private var preview: some View {
        VStack(spacing: 6) {
            if current.avatarUrl != nil, (current.avatarCrop ?? .mascot) != .mascot {
                BotMascotView(bot: current, size: 96, state: .idle, animated: true)
                    .frame(height: 112)
                    .accessibilityHidden(true)
            } else {
                MascotCharacterView(look: draft.complete, color: draft.color, skin: draft.skin, size: 96, animated: true)
                    .frame(height: 112)
                    .accessibilityHidden(true)
            }
            Text(CharacterEditor.characterName(draft.character))
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.textPrimary)
                .accessibilityIdentifier("avatar-preview-name")
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
    }

    /// Character / Generate / Upload as one centred segmented pill: the
    /// chosen one sits on a raised capsule.
    private var tabBar: some View {
        HStack(spacing: 2) {
            ForEach(Tab.allCases, id: \.self) { item in
                let selected = tab == item
                Button {
                    Haptics.selection()
                    tab = item
                } label: {
                    Text(title(item))
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(selected ? Theme.textPrimary : Theme.textSecondary)
                        .padding(.horizontal, 16)
                        .frame(height: 36)
                        .background(selected ? Theme.cardRaised : Color.clear, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("avatar-tab.\(item.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
    }

    private func title(_ tab: Tab) -> LocalizedStringKey {
        switch tab {
        case .bot: "Character"
        case .generate: "Generate"
        case .upload: "Upload"
        }
    }

    /// Mascot, Shape, Color and Skin in one scrolling card, Reset at the foot.
    private var botTab: some View {
        VStack(spacing: 0) {
            CharacterEditor(
                draft: $draft,
                metrics: .createSheet,
                section: nil,
                showsSectionLabels: true,
                showsPhotoRow: false,
                showsReset: false,
                unlocks: session.isDemo ? .demo : session.surfaceGate.allows(.characterExtras) ? unlocks : .nothingLocked
            )
            .padding(.bottom, 16)
            Rectangle().fill(Theme.hairline).frame(height: 1).padding(.leading, Theme.Profile.textInset)
            Button {
                Haptics.selection()
                draft = .default
                clearsPicture = true
            } label: {
                Text("Reset to default")
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.accentText)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, Theme.Profile.textInset)
                    .frame(height: Theme.Profile.singleRow)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("character-reset")
        }
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
    }

    private var generateTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(canGenerate
                 ? "Describe the picture. It is made with the image provider set up on your computer."
                 : "To generate pictures, set up the shared image provider in Sagax on your computer. Provider keys cannot be added from this device.")
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
            TextField(String(localized: "Art direction"), text: $generatePrompt, axis: .vertical)
                .lineLimit(4...8)
                .padding(12)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .accessibilityIdentifier("avatar-generate-prompt")
            Button {
                Task { await generatePicture() }
            } label: {
                Label("Generate", systemImage: "sparkles")
                    .font(Theme.Font.bodyMedium)
                    .frame(maxWidth: .infinity)
                    .frame(height: 44)
            }
            .buttonStyle(.borderedProminent)
            .disabled(working || generatePrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            .accessibilityIdentifier("character-photo-generate")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    private var uploadTab: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("PNG, JPEG, GIF, or WebP, up to 10 MB. Images are stored on your paired computer.")
                .font(Theme.Font.body)
                .foregroundStyle(Theme.textSecondary)
            HStack(spacing: 8) {
                PhotosPicker(selection: $photo, matching: .images) {
                    Label("Choose a picture", systemImage: "photo.badge.plus")
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 12)
                        .frame(height: 36)
                        .background(Theme.cardRaised, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
                .disabled(working)
                .accessibilityIdentifier("character-photo-upload")
                if current.avatarUrl != nil {
                    Button {
                        Task { await edit(BotProfileEdit(avatarCrop: .mascot, avatarUrl: .clear)) }
                    } label: {
                        Label("Use the character", systemImage: "trash")
                            .font(Theme.Font.bodyMedium)
                    }
                    .disabled(working)
                    .accessibilityIdentifier("character-photo-remove")
                    Button { framing = true } label: {
                        Label("Frame", systemImage: "crop")
                            .font(Theme.Font.bodyMedium)
                    }
                    .accessibilityIdentifier("character-photo-frame")
                }
            }
            if current.avatarUrl != nil {
                Picker(String(localized: "Shape"), selection: Binding(get: { current.avatarCrop ?? .circle }, set: { crop in
                    var patch = BotProfilePatch()
                    patch.avatarCrop = crop
                    let target = current
                    Task { _ = await session.updateProfile(patch, for: target) }
                })) {
                    Text("Circle").tag(AvatarCrop.circle)
                    Text("Rounded").tag(AvatarCrop.rounded)
                    Text("Square").tag(AvatarCrop.square)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("avatar-shape")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 8)
    }

    private func syncFromServer(force: Bool) {
        let server = CharacterDraft(bot: current)
        if force || !dirty {
            draft = server
            baseline = server
            clearsPicture = false
        }
    }

    private func attemptBack() {
        if dirty {
            confirmDiscard = true
        } else {
            dismiss()
        }
    }

    private func discardAndDismiss() {
        draft = baseline
        clearsPicture = false
        dismiss()
    }

    private func commitAndDismiss() async {
        let change = BotProfileEdit.lookDiff(
            fromColor: baseline.color, fromLook: baseline.look, fromSkin: baseline.skin,
            toColor: draft.color, toLook: draft.look, toSkin: draft.skin,
            clearsPicture: clearsPicture
        )
        if !change.isEmpty {
            let ok = await edit(change, revert: { draft = baseline; clearsPicture = false })
            guard ok else { return }
        }
        baseline = draft
        clearsPicture = false
        dismiss()
    }

    @discardableResult
    private func edit(_ change: BotProfileEdit, revert: (() -> Void)? = nil) async -> Bool {
        guard let client = session.profileClient else { revert?(); return false }
        do {
            session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change))
            return true
        } catch {
            revert?()
            session.actionError = error.localizedDescription
            return false
        }
    }

    private func upload(_ item: PhotosPickerItem) async {
        generating = true
        defer { generating = false; photo = nil }
        guard let data = try? await item.loadTransferable(type: Data.self) else { return }
        guard let mime = Self.imageMIME(data) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        if data.count > 10 * 1_024 * 1_024 {
            session.actionError = String(localized: "That image is larger than 10 MB.")
            return
        }
        let crop = current.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        _ = await session.uploadAvatar(data, mime: mime, for: current, crop: crop)
    }

    private func generatePicture() async {
        let prompt = generatePrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        generating = true
        defer { generating = false }
        _ = await session.generateAvatar(prompt: String(prompt.prefix(400)), for: current)
        if current.avatarUrl != nil { tab = .upload }
    }

    static func imageMIME(_ data: Data) -> String? {
        let bytes = [UInt8](data.prefix(12))
        if bytes.starts(with: [0x89, 0x50, 0x4e, 0x47]) { return "image/png" }
        if bytes.starts(with: [0xff, 0xd8, 0xff]) { return "image/jpeg" }
        if bytes.starts(with: Array("GIF8".utf8)) { return "image/gif" }
        if bytes.count >= 12,
           String(bytes: bytes[0..<4], encoding: .ascii) == "RIFF",
           String(bytes: bytes[8..<12], encoding: .ascii) == "WEBP" { return "image/webp" }
        return nil
    }
}

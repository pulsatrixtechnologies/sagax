// The bot profile hero's editable parts on the iPad main column (#1939,
// round 7), twins of the desktop BotProfilePage.tsx header (#2313, #2398):
//
// - the name at 28 and the label under it, both edited in place
//   (`InlineEditableText`; never "Name · Label" on one line);
// - a picture dropped on the hero, or pasted on it, becomes the bot's
//   avatar (`useAvatarSources().upload`);
// - who sees the bot, its owner and the Primary Bot badge, then the short
//   description typed in place.
//
// Every write is `Session.updateProfile` / `Session.uploadAvatar`, the same
// calls Edit bot > Identity and Appearance send.
import CompanionCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Name and label

/// `heroTitle` / `heroLabel`: the name alone on its line, the label under it.
struct BotProfileHeroIdentity: View {
    @EnvironmentObject private var session: Session
    let bot: Bot
    /// The desktop's header (#3030): name and label centred under the mascot.
    var centered = false

    private var canName: Bool { session.canEditBotField(bot, "name") }
    private var canLabel: Bool { session.canEditBotField(bot, "title") }
    private var hasLabel: Bool { !bot.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 2) {
            PersonaInlineText(
                value: bot.name, placeholder: nil, required: true, maxLength: 100,
                size: 28, weight: .regular, line: 36, muted: false,
                label: "Edit name", identifier: "bot-profile.hero.name",
                onSave: canName ? { name in
                    var patch = BotProfilePatch()
                    patch.name = name
                    save(patch)
                } : nil
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("bot-profile-name")
            if hasLabel || canLabel {
                PersonaInlineText(
                    value: bot.title, placeholder: "Add a label", required: false, maxLength: 200,
                    size: 15, weight: .regular, line: 20, muted: true,
                    label: "Edit label", identifier: "bot-profile.hero.title",
                    onSave: canLabel ? { title in
                        var patch = BotProfilePatch()
                        patch.title = title
                        save(patch)
                    } : nil
                )
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("bot-profile-title")
            }
        }
        // The in-place control pads its text by 6: keep the text on the column's edge.
        .padding(.leading, centered ? 0 : -6)
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile.hero.identity")
    }

    private func save(_ patch: BotProfilePatch) {
        let target = bot
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}

// MARK: - Drop or paste a picture

/// `onDragOver` / `onDrop` / `onPaste` of `[data-bot-profile-hero]`: an image
/// dropped on the hero, or pasted from its menu, is uploaded as the avatar.
struct BotProfileHeroImageTarget: ViewModifier {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot
    var cornerRadius: CGFloat = 18

    @State private var dropping = false
    @State private var busy = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }

    func body(content: Content) -> some View {
        content
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(theme.accent, lineWidth: 2)
                    .opacity(dropping ? 1 : 0)
                    .allowsHitTesting(false)
            }
            .overlay {
                if busy {
                    ProgressView()
                        .controlSize(.large)
                        .accessibilityIdentifier("bot-profile.hero.uploading")
                }
            }
            .onDrop(of: [.image], isTargeted: $dropping) { providers in
                guard !busy,
                      let provider = providers.first(where: { $0.hasItemConformingToTypeIdentifier(UTType.image.identifier) })
                else { return false }
                Task { await take(BotProfileHeroImage.data(from: provider)) }
                return true
            }
            .contextMenu {
                Button {
                    Task { await take(BotProfileHeroImage.fromPasteboard()) }
                } label: {
                    Label("Paste image", systemImage: "doc.on.clipboard")
                }
                .disabled(busy || !UIPasteboard.general.hasImages)
                .accessibilityIdentifier("bot-profile.hero.paste")
            }
            .help(Text("Drag and drop or paste an image"))
            .accessibilityHint(Text("Drag and drop or paste an image"))
    }

    @MainActor
    private func take(_ raw: Data?) async {
        guard !busy, let raw else { return }
        guard let ready = BotProfileHeroImage.prepared(raw) else {
            session.actionError = String(localized: "Choose a PNG, JPEG, GIF, or WebP image.")
            return
        }
        let (data, mime) = ready
        if data.count > BotProfileHeroImage.maxBytes {
            session.actionError = String(localized: "That image is larger than 10 MB.")
            return
        }
        busy = true
        defer { busy = false }
        Haptics.selection()
        // A picture keeps the crop already chosen; from the mascot it starts as a circle.
        let crop = current.avatarCrop.flatMap { $0 == .mascot ? nil : $0 } ?? .circle
        _ = await session.uploadAvatar(data, mime: mime, for: current, crop: crop)
    }
}

extension View {
    /// The hero takes a dropped or pasted picture as the bot's avatar.
    func botProfileHeroImageTarget(_ bot: Bot, cornerRadius: CGFloat = 18) -> some View {
        modifier(BotProfileHeroImageTarget(bot: bot, cornerRadius: cornerRadius))
    }
}

/// Reading a dropped or pasted picture into bytes the avatar upload takes.
enum BotProfileHeroImage {
    static let maxBytes = 10 * 1_024 * 1_024

    static func data(from provider: NSItemProvider) async -> Data? {
        await withCheckedContinuation { continuation in
            _ = provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, _ in
                continuation.resume(returning: data)
            }
        }
    }

    @MainActor
    static func fromPasteboard() -> Data? {
        let board = UIPasteboard.general
        for type in [UTType.png, .jpeg, .gif, .webP] {
            if let data = board.data(forPasteboardType: type.identifier) { return data }
        }
        return board.image?.pngData()
    }

    /// PNG, JPEG, GIF and WebP go up as they are; any other picture (HEIC,
    /// TIFF, a screenshot) is redrawn as PNG, or JPEG when the PNG is too big.
    static func prepared(_ data: Data) -> (Data, String)? {
        if let mime = PhoneBotAvatarSheet.imageMIME(data) { return (data, mime) }
        guard let image = UIImage(data: data) else { return nil }
        if let png = image.pngData(), png.count <= maxBytes { return (png, "image/png") }
        if let jpeg = image.jpegData(compressionQuality: 0.85) { return (jpeg, "image/jpeg") }
        return nil
    }
}

// MARK: - Audience and description

/// Under the hero: who sees the bot, its owner, the Primary Bot badge, then
/// the short description typed in place (`data-bot-profile-description`).
struct BotProfileHeroDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var directory = PeopleDirectory.shared
    let bot: Bot
    let audience: String
    /// The desktop's header (#3030): facts and description centred.
    var centered = false

    @State private var blurb = ""
    @State private var viewerId = "local-owner"
    @FocusState private var blurbFocused: Bool

    private var canDescribe: Bool { session.canEditBotField(bot, "description") }

    /// The owner's name, only when it is someone else (`owner` of the desktop page).
    private var owner: String {
        guard !PrimaryBotRules.viewerOwns(bot, viewerId: viewerId) else { return "" }
        guard let ownerId = bot.ownerUserId?.trimmingCharacters(in: .whitespacesAndNewlines), !ownerId.isEmpty else { return "" }
        let person = directory.directory?.person(ownerId)
        return HumanID.readable(person?.name, person?.login, ownerId, or: AppStrings.localized("Unknown person"))
    }

    var body: some View {
        VStack(alignment: centered ? .center : .leading, spacing: 12) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { facts }
                VStack(alignment: centered ? .center : .leading, spacing: 4) { facts }
            }
            .font(.system(size: 13.5))
            .foregroundStyle(theme.inkSecondary)
            description
        }
        .multilineTextAlignment(centered ? .center : .leading)
        .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile.hero.details")
        .task(id: bot.id) {
            blurb = bot.description
            viewerId = PrimaryBotRules.viewerId(config: await session.configStatus())
            await directory.load(session)
        }
        .onValueChange(of: bot.description) { now in
            if !blurbFocused { blurb = now }
        }
        .onValueChange(of: blurbFocused) { focused in
            if !focused { commitBlurb() }
        }
        .onDisappear { commitBlurb() }
    }

    @ViewBuilder
    private var facts: some View {
        HStack(spacing: 6) {
            Image(systemName: "lock").font(.system(size: 12))
            Text(verbatim: audience)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("bot-profile-privacy")
        if !owner.isEmpty {
            HStack(spacing: 6) {
                Image(systemName: "person.2").font(.system(size: 12))
                Text("Owner") + Text(verbatim: ": \(owner)")
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("bot-profile.hero.owner")
        }
        if PrimaryBotRules.isViewersPrimary(bot, viewerId: viewerId) {
            HStack(spacing: 4) {
                Image(systemName: "star")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(theme.accent)
                Text("Primary Bot").font(.system(size: 11.5))
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(theme.hover, in: Capsule())
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("bot-profile.hero.primary")
        }
    }

    @ViewBuilder
    private var description: some View {
        if canDescribe {
            TextField(
                "",
                text: $blurb,
                prompt: Text("One line on what this bot is for").foregroundColor(theme.inkSecondary),
                axis: .vertical
            )
            .font(.system(size: 14))
            .foregroundStyle(theme.ink)
            .lineSpacing(6)
            .lineLimit(1...12)
            .focused($blurbFocused)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .onValueChange(of: blurb) { now in
                if now.count > NewBotRules.descriptionLimit { blurb = String(now.prefix(NewBotRules.descriptionLimit)) }
            }
            .accessibilityLabel(Text("Short description"))
            .accessibilityIdentifier("bot-profile.hero.description")
        } else {
            Group {
                let shown = bot.description.trimmingCharacters(in: .whitespacesAndNewlines)
                if shown.isEmpty {
                    Text("No description yet.").foregroundStyle(theme.inkSecondary)
                } else {
                    Text(verbatim: shown).foregroundStyle(theme.ink)
                }
            }
            .font(.system(size: 14))
            .lineSpacing(6)
            .frame(maxWidth: .infinity, alignment: centered ? .center : .leading)
            .accessibilityIdentifier("bot-profile.hero.description")
        }
    }

    private func commitBlurb() {
        guard let next = DesktopInlineEdit.commit(draft: blurb, current: bot.description, required: false) else { return }
        var patch = BotProfilePatch()
        patch.description = next
        let target = bot
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}

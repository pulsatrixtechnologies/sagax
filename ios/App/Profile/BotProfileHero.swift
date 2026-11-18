// The bot profile hero's editable parts on the iPad main column and the
// iPhone page (#1939, round 7), twins of the desktop BotProfilePage.tsx
// header (#2313, #2398, #4602):
//
// - the name and the label on ONE line "Name · Label" (the label after the
//   separator, secondary and regular), both edited in place
//   (`PersonaInlineText`); the line wraps under itself only when it does not fit;
// - a picture dropped on the hero, or pasted on it, becomes the bot's
//   avatar (`useAvatarSources().upload`);
// - who sees the bot, its owner and the Primary Bot badge. No description
//   line: the bot keeps its own description and changes it when asked.
//
// Every write is `Session.updateProfile` / `Session.uploadAvatar`, the same
// calls Edit bot > Identity and Appearance send.
import CompanionCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Name and label

/// `heroTitle` of the desktop: "Name · Label" on one line, aligned left.
struct BotProfileHeroIdentity: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    private var canName: Bool { session.canEditBotField(bot, "name") }
    private var canLabel: Bool { session.canEditBotField(bot, "title") }
    private var hasLabel: Bool { !bot.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    private var showsLabel: Bool { hasLabel || canLabel }

    private var name: some View {
        PersonaInlineText(
            value: bot.name, placeholder: nil, required: true, maxLength: 100,
            size: 26, weight: .medium, line: 32, muted: false,
            label: "Edit name", identifier: "bot-profile.hero.name",
            onSave: canName ? { name in
                var patch = BotProfilePatch()
                patch.name = name
                save(patch)
            } : nil
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile-name")
    }

    private var separator: some View {
        DesktopText(verbatim: "\u{00B7}", size: 26, weight: .regular, line: 32, color: \.inkSecondary)
            .accessibilityHidden(true)
    }

    private var label: some View {
        PersonaInlineText(
            value: bot.title, placeholder: "Add a label", required: false, maxLength: 200,
            size: 26, weight: .regular, line: 32, muted: true,
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

    var body: some View {
        // One line when it fits; otherwise the dot ends the name's line and
        // the label takes the next (the desktop's phone wrap).
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                name.layoutPriority(1)
                if showsLabel {
                    separator
                    label
                }
            }
            VStack(alignment: .leading, spacing: 0) {
                HStack(spacing: 0) {
                    name
                    if showsLabel { separator }
                }
                if showsLabel { label }
            }
        }
        // The in-place control pads its text by 6: keep the text on the column's edge.
        .padding(.leading, -6)
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Audience

/// Under the hero: who sees the bot, its owner and the Primary Bot badge.
struct BotProfileHeroDetails: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @ObservedObject private var directory = PeopleDirectory.shared
    let bot: Bot
    let audience: String

    @State private var viewerId = "local-owner"

    /// The owner's name, only when it is someone else (`owner` of the desktop page).
    private var owner: String {
        guard !PrimaryBotRules.viewerOwns(bot, viewerId: viewerId) else { return "" }
        guard let ownerId = bot.ownerUserId?.trimmingCharacters(in: .whitespacesAndNewlines), !ownerId.isEmpty else { return "" }
        let person = directory.directory?.person(ownerId)
        return HumanID.readable(person?.name, person?.login, ownerId, or: AppStrings.localized("Unknown person"))
    }

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 12) { facts }
            VStack(alignment: .leading, spacing: 4) { facts }
        }
        .font(.system(size: 13.5))
        .foregroundStyle(theme.inkSecondary)
        .multilineTextAlignment(.leading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-profile.hero.details")
        .task(id: bot.id) {
            viewerId = PrimaryBotRules.viewerId(config: await session.configStatus())
            await directory.load(session)
        }
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
}

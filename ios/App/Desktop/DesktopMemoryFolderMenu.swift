// A Memory folder's link and its menu on the iPad (src/components/memory-manager/
// MemorySidebar.tsx FolderMenu, MemoryManagerPanel.tsx folderMenu, linkLines,
// deleteBotFolder, deletePxFolder; 2026-11-03):
//   - the row hint: a linked folder wears its bot's colour, "Linked to <bot>"
//     for VoiceOver; a folder no bot is linked to says "Not linked";
//   - the menu: who uses the folder (the bot, its routines, or the bots of a
//     team section that read it), then "Delete folder..." which is greyed
//     with its reason when a bot is linked (or the folder is a team group or
//     read only). An unlinked bot folder's notes go to the Trash.
//
//     // a row
//     HStack {
//         DesktopMemoryLinkHint(link: link)
//         Menu {
//             DesktopMemoryFolderMenu(link: link, name: folder.name, block: block) {
//                 pendingDelete = request       // a DesktopMemoryFolderRequest
//             }
//         } label: { ... }
//     }
//     .desktopMemoryFolderDeleteConfirmation($pendingDelete) { request in
//         let done = try await request.perform(client: client)
//         // done.count notes deleted; done.undo puts them back; refresh the page
//     }
import CompanionCore
import SwiftUI
import UIKit

/// What the hint of a row shows, for a link.
struct DesktopMemoryLinkHint: View {
    @Environment(\.desktopTheme) private var theme
    let link: FolderLink
    /// The mark only (the row carries the words), or the words too.
    var showsMark = true

    var body: some View {
        if MemoryFolders.isLinked(link) {
            if showsMark, let bot = link.bots.first { DesktopMemoryLinkMark(bot: bot) }
        } else {
            Text("Not linked")
                .font(theme.font(11))
                .foregroundStyle(theme.inkTertiary)
                .padding(.horizontal, 4)
                .accessibilityIdentifier("desktop-memory-unlinked")
        }
    }
}

/// A linked folder's mark (MemoryManagerPanel.tsx LinkMark): the bot's
/// picture at 14 when it has one (not its mascot), else its colour dot.
struct DesktopMemoryLinkMark: View {
    @EnvironmentObject private var session: Session
    let bot: LinkBot

    /// `relativeLuminance(...) < 0.035`.
    static func dark(_ name: String) -> Bool {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        UIColor(MausPalette.color(name)).getRed(&r, green: &g, blue: &b, alpha: &a)
        func channel(_ c: CGFloat) -> CGFloat { c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b) < 0.035
    }

    var body: some View {
        Group {
            if bot.avatarUrl != nil, bot.avatarCrop != "mascot", let full = session.state.bot(bot.id) {
                BotMascotView(bot: full, size: 14).frame(width: 14, height: 14).clipShape(Circle())
            } else {
                Circle()
                    .fill(MausPalette.color(bot.color ?? "green"))
                    // `swatchStyle`: a dark colour keeps an inset 1.5 ring of white at 32 %
                    .overlay(Circle().strokeBorder(Color.white.opacity(Self.dark(bot.color ?? "green") ? 0.32 : 0), lineWidth: 1.5))
                    .frame(width: 10, height: 10)
                    .padding(.horizontal, 2)
            }
        }
            .accessibilityElement()
            .accessibilityLabel(Text(verbatim: DesktopMemoryText.l("Linked to %@", bot.name)))
            .accessibilityIdentifier("desktop-memory-link-mark")
    }
}

/// "Linked to <bot>", or the "Not linked to any bot." line: a row's tooltip or VoiceOver label.
func desktopMemoryLinkTitle(_ link: FolderLink) -> String {
    MemoryFolders.isLinked(link)
        ? DesktopMemoryText.l("Linked to %@", MemoryFolders.botNames(link))
        : DesktopMemoryText.l("Not linked to any bot.")
}

/// The ⋯ menu's first lines: who the folder belongs to and what uses it.
func desktopMemoryLinkLines(_ link: FolderLink) -> [String] {
    if !MemoryFolders.isLinked(link) {
        return [link.readBy.isEmpty
            ? DesktopMemoryText.l("Not linked to any bot.")
            : DesktopMemoryText.l("No bot owns it; the bots of this section read it: %@", link.readBy.joined(separator: ", "))]
    }
    return [DesktopMemoryText.l("Linked to %@", MemoryFolders.botNames(link))]
        + (link.routines.isEmpty ? [] : [DesktopMemoryText.l("Routines: %@", link.routines.joined(separator: ", "))])
}

func desktopMemoryDeleteReason(_ block: FolderDeleteBlock) -> String {
    switch block {
    case .linked(let bots): DesktopMemoryText.l("Linked to %@; remove or archive the bot first", bots)
    case .teamKind: DesktopMemoryText.l("A built-in group of team memory: delete its notes one by one")
    case .readOnly: DesktopMemoryText.l("You can read this folder, not change it")
    }
}

/// The content of a folder row's menu: put it in a `Menu { ... }`.
struct DesktopMemoryFolderMenu: View {
    let link: FolderLink
    let name: String
    /// Why "Delete folder..." is greyed (`MemoryFolders.deleteBlock`); nil when it can go.
    var block: FolderDeleteBlock?
    /// "Delete folder..." was chosen: the caller sets its pending request (the confirmation follows).
    let onDelete: () -> Void

    var body: some View {
        ForEach(Array(desktopMemoryLinkLines(link).enumerated()), id: \.offset) { _, line in
            Button {} label: { Text(verbatim: line) }.disabled(true)
        }
        Divider()
        Button(role: .destructive, action: onDelete) {
            Label { Text("Delete folder…") } icon: { Image(systemName: "trash") }
        }
        .disabled(block != nil)
        .accessibilityIdentifier("desktop-memory-folder-menu.delete")
        if let block {
            Button {} label: { Text(verbatim: desktopMemoryDeleteReason(block)) }
                .disabled(true)
                .accessibilityIdentifier("desktop-memory-folder-menu.reason")
        }
    }
}

// MARK: - Delete folder

/// A folder delete the person asked for, awaiting the confirmation.
struct DesktopMemoryFolderRequest: Identifiable {
    enum Kind {
        /// A bot memory folder no bot is linked to: its topics and logs, and MEMORY.md cleared.
        case bot(botId: String, paths: [String], clearIndex: Bool)
        /// A Perspicax folder: its notes by id.
        case perspicax(scope: String, ids: [String])
    }

    var id = UUID()
    var name: String
    var kind: Kind

    /// The notes the delete takes (the count the confirmation says).
    var count: Int {
        switch kind {
        case .bot(_, let paths, let clearIndex): paths.count + (clearIndex ? 1 : 0)
        case .perspicax(_, let ids): ids.count
        }
    }

    struct Done {
        /// "%@ notes deleted".
        var count: Int
        /// Puts the notes back (the Trash keeps them); nil when nothing can be undone.
        var undo: (() async -> Void)?
    }

    /// The delete, as the desktop's: notes go to the Trash, with Undo.
    func perform(client: CompanionClient) async throws -> Done {
        switch kind {
        case .bot(let botId, let paths, let clearIndex):
            let emptied = try await client.emptyBotMemoryFolder(botId: botId, paths: paths, clearIndex: clearIndex)
            return Done(count: emptied.count, undo: emptied.undoIds.isEmpty ? nil : { await client.undoBotMemoryFolderDelete(botId: botId, undoIds: emptied.undoIds) })
        case .perspicax(let scope, let ids):
            let report = try await client.deletePerspicaxMemoryFolder(scope: scope, ids: ids)
            let batch = report.batch
            return Done(count: report.done ?? ids.count, undo: batch == nil ? nil : { try? await client.undoPerspicaxMemoryTrash(batch: batch!) })
        }
    }
}

extension View {
    /// The confirmation of "Delete folder...": "Delete the folder X and its N notes? They go to the
    /// Trash, where you can restore them." with Delete (destructive) and Cancel.
    func desktopMemoryFolderDeleteConfirmation(
        _ request: Binding<DesktopMemoryFolderRequest?>,
        onConfirm: @escaping (DesktopMemoryFolderRequest) -> Void
    ) -> some View {
        alert(
            Text("Delete folder"),
            isPresented: Binding(get: { request.wrappedValue != nil }, set: { if !$0 { request.wrappedValue = nil } }),
            presenting: request.wrappedValue
        ) { pending in
            Button(role: .destructive) { onConfirm(pending) } label: { Text("Delete") }
            Button(role: .cancel) {} label: { Text("Cancel") }
        } message: { pending in
            Text(verbatim: DesktopMemoryText.l("Delete the folder %@ and its %@ notes? They go to the Trash, where you can restore them.", pending.name, String(pending.count)))
        }
    }
}

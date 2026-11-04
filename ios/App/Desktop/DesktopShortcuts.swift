// The keyboard shortcuts window as the desktop draws it
// (`KeyboardShortcutsModal.tsx`, the catalog `src/lib/keyboard-shortcuts.ts`):
// a 560 pt dialog (rounded 14, `bg-app`, the border, over a 50 % scrim),
// the title "Keyboard shortcuts" 17 semibold and the round close button,
// the search field under it, then each category as a grey 13 pt heading
// over one card of 36 pt rows (what the shortcut does, its keycaps 22 pt
// in `bg-inset`), and the foot: "Press ? outside a text field to open this
// window." and the Done pill.
//
// The rows are the desktop's catalog, every one of them. On the iPad a
// hardware keyboard answers them in the shell (DesktopKeyCommands), the
// composer (Return, ⇧Return, ↑, ⌘D), the find bar (⌘F) and the open
// windows (Esc); Live call and group instructions answer where those
// screens are open.
import SwiftUI
import CompanionCore

struct DesktopShortcut: Identifiable {
    let id: String
    let description: String
    let keys: [String]
}

struct DesktopShortcutGroup: Identifiable {
    let category: String
    let items: [DesktopShortcut]
    var id: String { category }

    /// `SHORTCUT_GROUPS`, in its order, with its macOS keys.
    static var all: [DesktopShortcutGroup] {
        let row = { (id: String, text: String, keys: [String]) in
            DesktopShortcut(id: id, description: AppStrings.localized(text), keys: keys)
        }
        return [
            DesktopShortcutGroup(category: AppStrings.localized("Navigation"), items: [
                row("command-palette", "Open command palette (switcher & transcript search)", ["⌘", "K"]),
                row("search-everything", "Search conversations and messages", ["⌘", "⇧", "F"]),
                row("new-bot", "Search or create a bot", ["⌘", "N"]),
                row("new-group", "Create a group chat", ["⌘", "⇧", "N"]),
                row("jump-bot", "Jump to bot 1 to 9 in the roster", ["⌘", "1–9"]),
                row("switch-bot", "Switch to previous / next bot", ["⌘", "⇧", "[ / ]"]),
                row("toggle-sidebar", "Collapse or expand the sidebar", ["⌘", "B"]),
                row("find-conversation", "Find in conversation", ["⌘", "F"]),
            ]),
            DesktopShortcutGroup(category: AppStrings.localized("Chat & Composer"), items: [
                row("send-message", "Send message", ["Return"]),
                row("focus-composer", "Go to the message field", ["⌘", "I"]),
                row("quote-selection", "Quote the selected text in the message", ["⌘", "L"]),
                row("dictate", "Dictate into the message field (again to stop)", ["⌘", "D"]),
                row("new-line", "Insert new line without sending", ["⇧", "Return"]),
                row("edit-last-message", "Edit last message (when composer is empty)", ["↑"]),
                row("close-panel", "Close active drawer, modal, or find bar", ["Esc"]),
                row("shortcuts-cheat-sheet", "Show keyboard shortcuts cheat sheet", ["⌘", "/"]),
            ]),
            DesktopShortcutGroup(category: AppStrings.localized("Calls"), items: [
                row("live-call-mute", "Mute or unmute a Live call", ["⌘", "⇧", "M"]),
                row("live-call-hang-up", "Hang up a Live call", ["⌘", "⇧", "H"]),
            ]),
            DesktopShortcutGroup(category: AppStrings.localized("Management & Groups"), items: [
                row("save-bulletin", "Save group instruction changes", ["⌘", "Return"]),
                row("reorder-section", "Reorder sidebar sections (focus a section heading)", ["⌥", "↑ / ↓"]),
            ]),
        ]
    }

    /// `filterShortcutGroups`: the rows whose description or keys contain
    /// the query; a category that matches keeps all its rows.
    static func filtered(_ query: String) -> [DesktopShortcutGroup] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !q.isEmpty else { return all }
        return all.compactMap { group in
            if group.category.lowercased().contains(q) { return group }
            let items = group.items.filter { item in
                item.description.lowercased().contains(q) || item.keys.joined(separator: " ").lowercased().contains(q)
            }
            return items.isEmpty ? nil : DesktopShortcutGroup(category: group.category, items: items)
        }
    }
}

struct DesktopShortcutsModal: View {
    @Environment(\.desktopTheme) private var theme
    let close: () -> Void
    @State private var query = ""
    @FocusState private var searching: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.black.opacity(0.5)
                    .contentShape(Rectangle())
                    .onTapGesture(perform: close)
                    .accessibilityHidden(true)
                // w-[min(560px,calc(100%-24px))], max-h-[min(700px,calc(100dvh-48px))]
                AnyView(box)
                    .frame(width: min(560, geometry.size.width - 24))
                    .frame(maxHeight: min(700, geometry.size.height - 48))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .background(DesktopEscapeKey(action: close))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-shortcuts")
    }

    private var box: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnyView(header)
            ScrollView {
                AnyView(list)
                    // DIALOG.body: px-5 pb-5 pt-3
                    .padding(.horizontal, 20)
                    .padding(.top, 12)
                    .padding(.bottom, 20)
            }
            AnyView(foot)
        }
        .background(theme.app)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            // DialogCloseButton: absolute right-2.5 top-2.5
            DesktopCloseButton(label: "Close keyboard shortcuts", identifier: "desktop-shortcuts-close", action: close)
                .padding(10)
        }
    }

    /// DIALOG.header (px-5 pb-1 pr-12 pt-5): the title, then the field 12 under it.
    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            DesktopText(Text("Keyboard shortcuts"), size: 17, weight: .semibold, line: 24, tracking: -0.136)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 8) {
                DesktopSettingsIconView(icon: .search, size: 14)
                    .foregroundStyle(theme.inkSecondary)
                TextField("", text: $query, prompt: Text("Search shortcuts…").foregroundColor(theme.inkSecondary))
                    .font(theme.font(13))
                    .foregroundStyle(theme.ink)
                    .tint(theme.focus)
                    .focused($searching)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityLabel(Text("Search shortcuts"))
                    .accessibilityIdentifier("desktop-shortcuts-search")
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(theme.ink.opacity(0.03), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(searching ? theme.borderStrong : theme.border, lineWidth: 1))
        }
        .padding(.leading, 20)
        .padding(.trailing, 48)
        .padding(.top, 20)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private var list: some View {
        let groups = DesktopShortcutGroup.filtered(query)
        if groups.isEmpty {
            DesktopText(Text("No shortcuts found for “\(query)”"), size: 13, line: 18, color: \.inkSecondary)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
        } else {
            // DIALOG.body gap-4; SettingsGroup: the heading 13 regular
            // ink-secondary at px-1, 8 above the card
            VStack(alignment: .leading, spacing: 16) {
                ForEach(groups) { group in
                    VStack(alignment: .leading, spacing: 8) {
                        DesktopText(Text(verbatim: group.category), size: 13, line: 18, color: \.inkSecondary)
                            .padding(.horizontal, 4)
                            .accessibilityAddTraits(.isHeader)
                        VStack(spacing: 0) {
                            ForEach(group.items) { item in AnyView(row(item)) }
                        }
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity)
                        .background(theme.elevated, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                    }
                }
            }
        }
    }

    /// ShortcutRow: min-h-[36px] px-3.5 py-1.5, 13/18 at the left, the
    /// keycaps (22 pt, rounded 6, `bg-inset`, 12 pt ink-secondary) 4 apart.
    private func row(_ item: DesktopShortcut) -> some View {
        HStack(spacing: 16) {
            DesktopText(Text(verbatim: item.description), size: 13, line: 18)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 4) {
                ForEach(Array(item.keys.enumerated()), id: \.offset) { _, key in keycap(key, height: 22, size: 12) }
            }
            .fixedSize()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .frame(minHeight: 36)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("desktop-shortcut.\(item.id)")
    }

    private func keycap(_ key: String, height: CGFloat, size: CGFloat) -> some View {
        Text(verbatim: key)
            // the app face has no ⇧ or ⌥: the system face draws those, as
            // the desktop's font stack falls back to it
            .font(["⇧", "⌥"].contains(key) ? .system(size: size) : theme.font(size))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, height > 20 ? 6 : 4)
            .frame(minWidth: height, minHeight: height)
            .background(theme.inset, in: RoundedRectangle(cornerRadius: height > 20 ? 6 : 4, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: height > 20 ? 6 : 4, style: .continuous).strokeBorder(theme.border, lineWidth: 0.5))
    }

    /// px-5 pb-5: the hint (12/16) with its "?" keycap, and the Done pill
    /// (`PILL`: 30 tall, px 13, rounded-full, `bg-hover`, 13).
    private var foot: some View {
        HStack(spacing: 12) {
            HStack(spacing: 4) {
                DesktopText(Text("Press"), size: 12, line: 16, color: \.inkSecondary)
                keycap("?", height: 18, size: 11)
                DesktopText(Text("outside a text field to open this window."), size: 12, line: 16, color: \.inkSecondary)
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            Button(action: close) { Text("Done") }
                .buttonStyle(DesktopButtonStyle(kind: .hover, size: 13, height: 30, horizontal: 13, radius: 15))
                .accessibilityIdentifier("desktop-shortcuts-done")
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
    }
}

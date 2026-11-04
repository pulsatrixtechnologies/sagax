// iPad lot 6: the sidebar's multi-select bar (`SidebarMultiSelectBar`,
// Sidebar.tsx-parts): a 36 pt pill above the foot, `border-hairline-weak
// bg-sidebar-card`, six evenly spread buttons: Mark as read, Pin or Unpin,
// Edit N bots (the wide one, with its word), Move to a team, Archive and
// Clear selection. Each acts on the chosen bots through the session's own
// calls. The rail has no bar: collapsing the sidebar ends the selection.
import SwiftUI
import UIKit
import CompanionCore

struct DesktopSelectionBar: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    private var chosen: [Bot] { model.selection.chosen(in: session.state.bots) }
    private var allPinned: Bool { DesktopBotSelection.allPinned(chosen) }
    private var archivable: [Bot] { DesktopSelectionActions.archivable(chosen, session: session) }

    var body: some View {
        let count = chosen.count
        let layout = prefs.layout(session)
        let canMove = layout.personal || session.canAdminister || session.surfaceGate.scope == .sidecar
        let countText = String(count)
        return DesktopWeightedRow {
            barButton(.checkCheck, label: String(localized: "Mark as read"), id: "mark-read", disabled: count == 0) {
                for bot in chosen { Task { await session.markRead(.bot(bot)) } }
                model.selection.clear()
            }
            barButton(allPinned ? .pinOff : .pin, label: allPinned ? String(localized: "Unpin") : String(localized: "Pin"),
                      id: "pin", disabled: count == 0) {
                let pinned = !allPinned
                for bot in chosen { Task { await session.setPinned(bot, pinned: pinned) } }
                model.selection.clear()
            }
            // Edit N bots: the wide button, the icon and its word
            Button { model.bulkEditing = true } label: {
                HStack(spacing: 4) {
                    DesktopIconView(icon: .slidersHorizontal, size: 15)
                    DesktopLineText(text: String(localized: "Edit"), size: 12.5, weight: .medium, color: theme.sidebarInk, lineHeight: 16)
                }
                .foregroundStyle(theme.sidebarInk)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .contentShape(Capsule())
            }
            .buttonStyle(DesktopSelectionButtonStyle())
            .layoutValue(key: DesktopRowWeight.self, value: 1.6)
            .accessibilityLabel(Text("Edit \(countText) selected bots: model, sharing, folder, access, voice, permissions"))
            .accessibilityIdentifier("desktop-select-edit")
            if canMove {
                moveMenu(layout: layout, disabled: count == 0, count: countText)
            }
            if !session.surfaceGate.organization || !archivable.isEmpty {
                barButton(.archive, label: String(localized: "Archive"), id: "archive", disabled: archivable.isEmpty) {
                    model.archivingSelection = true
                }
            }
            barButton(.x, label: String(localized: "Clear selection"), id: "clear", disabled: false) { model.selection.clear() }
        }
        .padding(.horizontal, 4)
        .frame(height: 36)
        .background(theme.sidebarInk.opacity(0.07), in: Capsule())
        .overlay(Capsule().strokeBorder(theme.sidebarInk.opacity(0.10), lineWidth: 1))
        // px-4 pb-2 around the pill
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("\(countText) selected"))
        .accessibilityIdentifier("desktop-select-bar")
        // Escape leaves the selection
        .background {
            Button("") { model.selection.clear() }
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    private func barButton(_ icon: DesktopIcon, label: String, id: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            DesktopIconView(icon: icon, size: 16)
                .foregroundStyle(theme.sidebarInkSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .contentShape(Capsule())
        }
        .buttonStyle(DesktopSelectionButtonStyle())
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(Text(verbatim: label))
        .accessibilityIdentifier("desktop-select-\(id)")
    }

    /// Move N selected to a team: the person's own sections on an
    /// organization server, the server's teams for a pairing that files bots.
    private func moveMenu(layout: SidebarLayout, disabled: Bool, count: String) -> some View {
        Menu {
            ForEach(layout.sectionNames, id: \.self) { name in
                Button(name) { DesktopSelectionActions.move(chosen, to: name, session: session, model: model, prefs: prefs) }
            }
            Button(String(localized: "Move to Unassigned")) {
                DesktopSelectionActions.move(chosen, to: "", session: session, model: model, prefs: prefs)
            }
        } label: {
            DesktopIconView(icon: .folderInput, size: 16)
                .foregroundStyle(theme.sidebarInkSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 32)
                .contentShape(Capsule())
        }
        .disabled(disabled)
        .opacity(disabled ? 0.4 : 1)
        .accessibilityLabel(Text("Move \(count) selected to a team"))
        .accessibilityIdentifier("desktop-select-move")
    }
}

/// `flex-1` children, one of them `flex-[1.6]`: the width shared by weight.
struct DesktopRowWeight: LayoutValueKey { static let defaultValue: CGFloat = 1 }

struct DesktopWeightedRow: Layout {
    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        CGSize(width: proposal.width ?? 240, height: 32)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let total = subviews.reduce(CGFloat(0)) { $0 + $1[DesktopRowWeight.self] }
        guard total > 0 else { return }
        var x = bounds.minX
        for subview in subviews {
            let width = bounds.width * subview[DesktopRowWeight.self] / total
            subview.place(at: CGPoint(x: x, y: bounds.minY), anchor: .topLeading, proposal: ProposedViewSize(width: width, height: 32))
            x += width
        }
    }
}

/// `hover:bg-sidebar-hover` on a bar button.
struct DesktopSelectionButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background((hovering || configuration.isPressed) ? theme.sidebarHover : .clear, in: Capsule())
            .onHover { hovering = $0 }
    }
}

/// What the bar does, through the session's calls.
@MainActor
enum DesktopSelectionActions {
    /// The chosen bots Archive takes (the desktop's `archivable`).
    static func archivable(_ chosen: [Bot], session: Session) -> [Bot] {
        DesktopBotSelection.archivable(chosen, in: session.state.bots) {
            session.surfaceGate.allows(.botOwnerExtras, bot: $0)
        }
    }

    /// Move to a team (a person's own section, or the server's team in one
    /// request for the whole selection); "" is Unassigned.
    static func move(_ chosen: [Bot], to name: String, session: Session, model: DesktopShellModel, prefs: SidebarPrefsModel) {
        defer { model.selection.clear() }
        if prefs.layout(session).personal {
            for bot in chosen {
                model.sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(bot: bot.id), to: name)
            }
            return
        }
        let ids = chosen.map(\.id)
        if name.isEmpty {
            // out of whatever team each one is in
            var byTeam: [String: [String]] = [:]
            for bot in chosen {
                let team = bot.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if !team.isEmpty { byTeam[team, default: []].append(bot.id) }
            }
            Task { for (team, members) in byTeam { _ = await session.setServerSectionBots(team, add: [], remove: members) } }
        } else {
            Task { _ = await session.assignSection(name: name, botIds: ids) }
        }
    }

    /// Archive the confirmed bots one after the other.
    static func archive(_ bots: [Bot], session: Session, model: DesktopShellModel) {
        Task { for bot in bots { await DesktopBotArchiving.set(bot, archived: true, session: session, model: model) } }
    }
}

/// The bar's prompts: the Archive confirmation and Edit N bots, mounted once.
struct DesktopSelectionPrompts: ViewModifier {
    @ObservedObject var model: DesktopShellModel
    @EnvironmentObject private var session: Session

    func body(content: Content) -> some View {
        let take = DesktopSelectionActions.archivable(model.selection.chosen(in: session.state.bots), session: session)
        let countText = String(take.count)
        return content
            .confirmationDialog(
                Text("Archive \(countText) selected bots?"),
                isPresented: $model.archivingSelection,
                titleVisibility: .visible
            ) {
                Button("Archive") {
                    model.archivingSelection = false
                    model.selection.clear()
                    DesktopSelectionActions.archive(take, session: session, model: model)
                }
                .accessibilityIdentifier("desktop-select-archive-confirm")
                Button("Cancel", role: .cancel) { model.archivingSelection = false }
            } message: {
                Text("They leave the sidebar and keep everything. Restore them any time from Archived bots.")
            }
            .sheet(isPresented: $model.bulkEditing) {
                DesktopBulkEditSheet(botIds: model.selection.ids) { model.bulkEditing = false }
                    .environmentObject(session)
            }
    }
}

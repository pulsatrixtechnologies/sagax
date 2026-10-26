// The home list's bulk selection (the desktop's multi-select, #911: mark
// as read, pin, move to a section, archive) and its "N more unread above or
// below" pills. Rules live in CompanionCore/HomeSelection.swift.
import CompanionCore
import SwiftUI

@MainActor
final class HomeSelectionModel: ObservableObject {
    @Published private(set) var active = false
    @Published private(set) var ids: [String] = []
    @Published var confirmingArchive = false

    func begin(_ botId: String) {
        active = true
        ids = [botId]
        Haptics.selection()
    }

    func toggle(_ botId: String) {
        if let index = ids.firstIndex(of: botId) { ids.remove(at: index) } else { ids.append(botId) }
        Haptics.selection()
        if ids.isEmpty { clear() }
    }

    func contains(_ botId: String) -> Bool { ids.contains(botId) }

    func clear() {
        active = false
        ids = []
        confirmingArchive = false
    }
}

/// The action bar that takes the place of the home's bottom bar while rows
/// are selected.
struct HomeSelectionBar: View {
    @ObservedObject var model: HomeSelectionModel
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var sectionActions: SidebarSectionActions
    @EnvironmentObject private var botActions: BotRowActions
    @ObservedObject private var prefs = SidebarPrefsModel.shared

    private var bots: [Bot] { model.ids.compactMap { session.state.bot($0) } }
    private var activeCount: Int { session.state.bots.filter { $0.hidden != true }.count }
    private var archivable: [Bot] { BulkBotSelection.archivable(bots, activeBotCount: activeCount) }

    var body: some View {
        let selected = bots
        let layout = prefs.layout(session)
        let canMove = layout.personal || session.canAdminister
        let pin = BulkBotSelection.shouldPin(selected)
        HStack(spacing: 4) {
            Text("\(selected.count) selected")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.leading, 6)
            Spacer(minLength: 4)
            barButton("Mark as read", "envelope.open", enabled: !selected.isEmpty) { markRead(selected) }
            barButton(pin ? "Pin" : "Unpin", pin ? "pin" : "pin.slash", enabled: !selected.isEmpty) { setPinned(selected, pin) }
            if canMove {
                Menu {
                    ForEach(layout.sectionNames, id: \.self) { name in
                        Button(name) { move(selected, to: name, layout: layout) }
                    }
                    Button(String(localized: "Unassigned")) { move(selected, to: "", layout: layout) }
                } label: {
                    barIcon("folder").foregroundStyle(Theme.textPrimary)
                }
                .disabled(selected.isEmpty)
                .accessibilityLabel(Text("Move \(selected.count) bots to a section"))
            }
            barButton("Archive", "archivebox", enabled: !archivable.isEmpty) { model.confirmingArchive = true }
            barButton("Clear selection", "xmark", enabled: true) { model.clear() }
        }
        .padding(.horizontal, 10)
        .frame(height: 52)
        .background(.regularMaterial, in: Capsule())
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.bottom, 8)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Actions on the selected bots"))
        .accessibilityIdentifier("selection-bar")
        .confirmationDialog(
            String(localized: "Archive \(archivable.count) selected bots?"),
            isPresented: $model.confirmingArchive, titleVisibility: .visible
        ) {
            Button(String(localized: "Archive"), role: .destructive) { archive(archivable) }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("They leave the sidebar and keep everything. Restore them any time from Archived bots.")
        }
    }

    private func barIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 17, weight: .medium))
            .frame(width: 40, height: 40)
            .contentShape(Rectangle())
    }

    private func barButton(_ label: String, _ symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) { barIcon(symbol).foregroundStyle(Theme.textPrimary) }
            .buttonStyle(.plain)
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.35)
            .accessibilityLabel(Text(LocalizedStringKey(label)))
    }

    private func markRead(_ bots: [Bot]) {
        model.clear()
        Task { for bot in bots { await session.markRead(.bot(bot)) } }
    }

    private func setPinned(_ bots: [Bot], _ pinned: Bool) {
        model.clear()
        Task { for bot in bots where (bot.pinned == true) != pinned { await session.setPinned(bot, pinned: pinned) } }
    }

    private func archive(_ bots: [Bot]) {
        model.clear()
        Task {
            var done = 0
            for bot in bots where await session.setArchived(bot, archived: true) { done += 1 }
            if done > 0 { botActions.flash(String(localized: "\(done) bots archived")) }
        }
    }

    private func move(_ bots: [Bot], to name: String, layout: SidebarLayout) {
        model.clear()
        if layout.personal {
            for bot in bots {
                sectionActions.error = prefs.assignPersonal(session, key: PersonalSections.itemKey(bot: bot.id), to: name)
            }
        } else if name.isEmpty {
            let bySection = Dictionary(grouping: bots) { $0.section?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }
            Task {
                for (section, group) in bySection where !section.isEmpty {
                    _ = await session.setServerSectionBots(section, add: [], remove: group.map(\.id))
                }
            }
        } else {
            Task { _ = await session.assignSection(name: name, botIds: bots.map(\.id)) }
        }
    }
}

/// The checkmark a selected (or selectable) row wears on its mascot.
struct HomeSelectionMark: View {
    let selected: Bool

    var body: some View {
        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 20))
            .foregroundStyle(selected ? Color.accentColor : Theme.textTertiary)
            .background(Circle().fill(Theme.bg).padding(2))
            .accessibilityHidden(true)
    }
}

// MARK: - More unread pills

struct HomeRowFramesKey: PreferenceKey {
    static var defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

extension View {
    /// Reports a list row's frame in the roster scroll's space, with the
    /// row's id for the pills to jump to.
    func reportsHomeRow(_ id: String, space: String) -> some View {
        background {
            GeometryReader { proxy in
                Color.clear.preference(key: HomeRowFramesKey.self, value: [id: proxy.frame(in: .named(space))])
            }
        }
    }
}

struct HomeUnreadPill: View {
    let count: Int
    let above: Bool
    let jump: () -> Void

    var body: some View {
        Button(action: jump) {
            HStack(spacing: 6) {
                Image(systemName: above ? "arrow.up" : "arrow.down")
                    .font(.system(size: 12, weight: .semibold))
                Text(above ? "\(count) more unread above" : "\(count) more unread below")
                    .font(.footnote.weight(.semibold))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(Capsule().fill(Theme.unreadDot))
            .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(above ? "unread-above" : "unread-below")
    }
}

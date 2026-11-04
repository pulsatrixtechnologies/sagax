// iPad I4/I4b: the bot panel (`BotSettingsDialog.tsx`), docked at the
// trailing edge from 1024 pt, over the leading edge below
// (`max-lg:absolute`). Its tabs are the current desktop's
// (`bot-settings/panel-tabs.ts`): Details (Coding, Activity, Routines),
// Library (Files, Skills, Plugins: BotPanelLibrary.swift), Computer; no More
// tab. Edit bot is a pencil on the mascot and the first entry of the
// bot's one "..." menu (`BotActionsMenu.tsx`, #518), which also holds
// Rename, the Primary Bot, the export and Archive. Edit bot is the
// desktop's centred window (PersonaEditorWindow.swift, 2026-11-03), on
// Identity from the menu and on Appearance from a tap on the mascot. The name and label are edited where they
// show, under the mascot (`InlineEditableText.tsx`). Which tabs and sections a pairing shows is
// `DesktopPanelTab` / `DesktopPanelSection` / `DesktopPersonaEditor`
// (CompanionCore), from `SurfaceGate`.
//
// Sizes from desktop-1366x1024-33-panel-details.json: top bar 48 with 36 pt
// round buttons at y 6 (Export, Inspector when the
// Appearance switch shows it, Close), the 112x119 mascot button at y 72 (it
// opens the character editor), the name 17/24 medium in a 28 pt button at
// y 211, the label 12.5/16 at y 241, the description 11.5/16 at y 263, tabs
// 13/20 at y 299 (px 6, py 4, radius 6, selected `elevated-hover`), the body
// from y 347, 16 pt in. Everything below the top bar scrolls as one column.
//
// Each sub-tree is type-erased (`AnyView`): a deep SwiftUI type overflowed
// the iPad's main-thread stack once (I1, build 6).
import SwiftUI
import UIKit
import CompanionCore

typealias BotPanelTab = DesktopPanelTab

extension DesktopPanelTab: Identifiable {
    public var id: String { rawValue }

    var title: LocalizedStringKey {
        switch self {
        case .details: "Details"
        case .library: "Library"
        case .computer: "Computer"
        }
    }
}

struct BotPanel: View {
    let bot: Bot
    let docked: Bool

    var body: some View {
        // one panel per bot: its loads and drafts start over
        AnyView(BotPanelContent(bot: bot, docked: docked)).id(bot.id)
    }
}

private struct BotPanelContent: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    let docked: Bool

    @State private var sharedFile: ShareFile?
    /// The bot's one "..." menu (`BotActionsMenu.tsx`, #518).
    @State private var menuOpen = false
    @State private var viewerId: String?
    @State private var renaming = false
    @State private var renameDraft = ""
    @State private var confirmingArchive = false
    @State private var confirmingDelete = false
    @State private var exportingZip = false
    @State private var pickingPrimary = false
    @State private var primaryWorking = false
    @State private var slackURL: URL?
    /// A name, label or description field is open: Escape cancels it, not the panel.
    @State private var inlineEditing = false

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: session.surfaceGate, slack: slackURL != nil) }
    private var tab: DesktopPanelTab { tabs.contains(model.panelTab) ? model.panelTab : .details }

    var body: some View {
        VStack(spacing: 0) {
            AnyView(topBar)
            ScrollView {
                VStack(spacing: 0) {
                    AnyView(BotPanelIdentity(bot: current, editing: $inlineEditing))
                    AnyView(tabRow)
                        .padding(.top, 16)
                        .padding(.bottom, 12)
                    AnyView(tabBody)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
            }
            .scrollIndicators(.automatic)
            .scrollDismissesKeyboard(.interactively)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(theme.app)
        .overlay(alignment: docked ? .leading : .trailing) {
            Rectangle().fill(theme.hairlineWeak).frame(width: 1)
        }
        .sheet(item: $sharedFile) { file in ActivityShareSheet(items: [file.url]) }
        .task(id: session.connection?.id) {
            async let config = session.configStatus()
            if session.surfaceGate.allows(.botSlack) {
                slackURL = await session.profileClient?.slackManagementURL(botId: bot.id)
            }
            viewerId = PrimaryBotRules.viewerId(config: await config)
        }
        .sheet(isPresented: $exportingZip) { BotZipExportSheet(bot: current) { exportingZip = false }.environmentObject(session) }
        .sheet(isPresented: $pickingPrimary) {
            PrimaryBotPicker(currentId: current.id, viewerId: viewerId ?? "local-owner") { _ in }
                .environmentObject(session)
        }
        .confirmationDialog(Text("Archive \(current.name)?"), isPresented: $confirmingArchive, titleVisibility: .visible) {
            Button("Archive") {
                let target = current
                Task { if await session.setArchived(target, archived: true) { model.togglePanel() } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Its conversations are kept. Archived bots in the account menu brings it back.")
        }
        .confirmationDialog(Text("Delete \(current.name)?"), isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                let target = current
                Task { if await session.deleteBot(target) { model.togglePanel() } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(String(localized: "The bot and its conversations will be deleted. This cannot be undone."))
        }
        .alert("Rename the bot", isPresented: $renaming) {
            TextField("Name", text: $renameDraft)
                .accessibilityIdentifier("desktop-panel-rename-field")
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let target = current
                let draft = renameDraft
                Task { await session.renameBot(target, to: draft) }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
        .accessibilityIdentifier("desktop-bot-panel")
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 8) {
            Spacer(minLength: 0)
            DesktopRoundButton(systemImage: "ellipsis", label: "Bot menu", active: menuOpen, icon: .ellipsis) { menuOpen.toggle() }
                .overlay(alignment: .topTrailing) {
                    if menuOpen { actionsMenu }
                }
                .zIndex(1)
                .accessibilityIdentifier("desktop-panel-menu")
            DesktopRoundButton(systemImage: "sidebar.right", label: "Close", icon: .panelRight) { model.togglePanel() }
                .keyboardShortcut(inlineEditing ? KeyboardShortcut("w", modifiers: [.command, .control, .option, .shift]) : KeyboardShortcut(.escape, modifiers: []))
                .accessibilityIdentifier("desktop-panel-close")
        }
        .padding(.horizontal, 12)
        .frame(height: 48)
        .zIndex(2)
    }

    private var menuPlan: BotActionsMenuPlan {
        let gate = session.surfaceGate
        return BotActionsMenuPlan(
            gate: gate, bot: current, viewerId: viewerId, editable: DesktopPersonaEditor.offered(gate: gate, slack: slackURL != nil, bot: current),
            zipExport: gate.scope != .sidecar && (session.canAdminister || PrimaryBotRules.viewerOwns(current, viewerId: session.roomViewer.actorId)),
            inspector: true,
            activeBotCount: session.state.bots.filter { $0.hidden != true }.count,
            wizard: true,
            editBot: true
        )
    }

    /// The bot's one "..." menu (lot 6): Primary, Redo the wizard, Share;
    /// Export; Archive, Delete, Inspector. Edit bot and Rename left.
    private var actionsMenu: some View {
        let plan = menuPlan
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(plan.groups.enumerated()), id: \.offset) { index, group in
                if index > 0 {
                    Rectangle().fill(theme.border).frame(height: 0.5).padding(.horizontal, 8).padding(.vertical, 4)
                }
                if group.contains(.copyConversation) {
                    Text("Export conversation")
                        .font(theme.font(12))
                        .foregroundStyle(theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                }
                ForEach(group, id: \.self) { item in
                    menuRow(item, enabled: plan.enables(item) && !(item == .makePrimary && primaryWorking))
                }
            }
        }
        .padding(6)
        .frame(width: 248, alignment: .leading)
        .background(theme.menu, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.25), radius: 14, y: 8)
        .fixedSize()
        .alignmentGuide(.top) { d in d[.top] - 40 }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-actions")
    }

    @ViewBuilder
    private func menuRow(_ item: BotActionsMenuItem, enabled: Bool) -> some View {
        let (icon, title): (String, LocalizedStringKey) = {
            switch item {
            case .editBot: return ("person.crop.circle.badge.pencil", "Edit bot")
            case .redoWizard: return ("wand.and.stars", "Redo the wizard")
            case .rename: return ("pencil", "Rename the bot")
            case .share: return ("person.badge.plus", "Share")
            case .makePrimary: return ("star", "Make primary bot")
            case .replacePrimary: return ("arrow.left.arrow.right", "Replace with different Bot")
            case .copyConversation: return ("doc.on.doc", "Copy as Markdown")
            case .downloadConversation: return ("arrow.down.to.line", "Download as .md")
            case .exportZip: return ("doc.zipper", "Export the bot (.zip)")
            case .archive: return ("archivebox", "Archive…")
            case .delete: return ("trash", "Delete bot…")
            case .inspector: return ("ladybug", "Inspector")
            }
        }()
        DesktopMenuRow(systemImage: icon, title: Text(title)) {
            menuOpen = false
            perform(item)
        }
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.4)
        .accessibilityIdentifier("desktop-panel-action.\(item.rawValue)")
    }

    private func perform(_ item: BotActionsMenuItem) {
        switch item {
        case .editBot: model.showPersona()
        case .redoWizard:
            // Close the panel first so the wizard's fullScreenCover can present.
            let botId = current.id
            model.togglePanel()
            Task { @MainActor in
                try? await Task.sleep(nanoseconds: 400_000_000)
                BotWizardPresenter.shared.open(botId: botId, redo: true)
            }
        case .rename:
            renameDraft = current.name
            renaming = true
        case .share: model.showPersona(.sharing)
        case .makePrimary:
            Task { await PrimaryBotActions.make(current.id, session: session, done: { _ in }, working: $primaryWorking) }
        case .replacePrimary: pickingPrimary = true
        case .copyConversation:
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown"),
                   let text = try? String(contentsOf: url, encoding: .utf8) {
                    PlatformBridge.copyToPasteboard(text)
                }
            }
        case .downloadConversation:
            Task {
                if let url = await session.export(threadId: current.threadId, format: "markdown") {
                    sharedFile = ShareFile(url: url)
                }
            }
        case .exportZip: exportingZip = true
        case .archive: confirmingArchive = true
        case .delete: confirmingDelete = true
        case .inspector: model.requestInspector()
        }
    }

    // MARK: Tabs

    private var tabRow: some View {
        HStack(spacing: 2) {
            ForEach(tabs) { item in
                let selected = tab == item
                Button { choose(item) } label: {
                    Text(item.title)
                        .font(theme.font(13))
                        .foregroundStyle(selected ? theme.ink : theme.inkSecondary)
                        .padding(.horizontal, 6)
                        .frame(height: 28)
                        .background(selected ? theme.elevatedHover : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverEffect(.highlight)
                .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
                .accessibilityIdentifier("desktop-panel-tab.\(item.rawValue)")
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
    }

    private func choose(_ item: DesktopPanelTab) {
        model.panelTab = item
    }

    @ViewBuilder
    private var tabBody: some View {
        switch tab {
        case .details:
            AnyView(BotPanelDetails(bot: current))
        case .library:
            AnyView(BotPanelLibrary(bot: current, docked: docked))
        case .computer:
            AnyView(BotPanelComputer(bot: current))
        }
    }
}

// MARK: - Identity

/// The Appearance switch that shows the Inspector button in the chat's and
/// the panel's top bars (`src/lib/inspector-preferences.ts`): off by default.
enum DesktopInspectorButton {
    static let key = "sagax-show-inspector-button"
}

/// The 112 pt mascot (the Edit avatar button, 112x119 at y 72), then the
/// name (17/24 medium) and the label (12.5/16, "Add a label" when empty),
/// each edited where it shows. The description lives in Edit persona.
private struct BotPanelIdentity: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopShellModel
    let bot: Bot
    @Binding var editing: Bool

    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var open: Field?

    private enum Field { case name, label }

    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .topTrailing) {
                Button {
                    // the desktop's avatar click: Edit bot on Appearance
                    model.showAppearance()
                } label: {
                    // BotProfileAvatarCard: the 144 pt mascot in the panel, pt-5
                    BotMascotView(bot: bot, size: 144, state: MausState.forChat(.bot(bot), in: session.state), animated: true, owlHandle: owlHandle)
                        .frame(width: 144, height: 144)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Edit avatar"))
                .accessibilityIdentifier("desktop-panel-avatar")
                // 2026-11-03: no pencil on the mascot (the desktop's Edit bot
                // is in the panel's ⋯ menu); kept only for VoiceOver
                if DesktopPersonaEditor.offered(gate: session.surfaceGate, bot: bot) {
                    Button { model.showPersona() } label: {
                        Image(systemName: "pencil")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(theme.ink)
                            .frame(width: 28, height: 28)
                            .background(theme.elevated, in: Circle())
                            .overlay(Circle().strokeBorder(theme.hairlineWeak, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .offset(x: -4, y: 28)
                    .opacity(0)
                    .accessibilityLabel(Text("Edit persona"))
                    .accessibilityIdentifier("desktop-panel-edit-persona")
                }
            }
            .padding(.top, 20)
            // the name under the mascot (`-mt-1` under BotAvatar's 144 pt
            // box, whose owl sits higher than the iPad's: measured on the
            // 1376x1032 references, the name's baseline 15 pt lower)
            PanelInlineText(value: bot.name, placeholder: nil, label: "Edit name", size: 17, lineHeight: 24, weight: .medium,
                            limit: 100, required: true, isEditing: binding(.name)) { save(name: $0) }
                .padding(.top, 11)
                .accessibilityIdentifier("desktop-panel-name")
            PanelInlineText(value: bot.title, placeholder: "Add a label", label: "Edit label", size: 12.5, lineHeight: 16,
                            muted: true, limit: 200, isEditing: binding(.label)) { save(title: $0) }
                .padding(.top, 2)
                .accessibilityIdentifier("desktop-panel-title")
        }
        .padding(.horizontal, 16)
        .frame(maxWidth: .infinity)
        .onValueChange(of: model.avatarMove) { move in
            if let move { owlHandle.flourish(move) }
        }
        .onValueChange(of: model.avatarShapeMove) { move in
            if let move { owlHandle.shape(move) }
        }
        .onValueChange(of: open) { field in editing = field != nil }
    }

    /// One field open at a time.
    private func binding(_ field: Field) -> Binding<Bool> {
        Binding(get: { open == field }, set: { on in
            if on { open = field } else if open == field { open = nil }
        })
    }

    private func save(name: String? = nil, title: String? = nil, description: String? = nil) {
        var patch = BotProfilePatch()
        patch.name = name
        patch.title = title
        patch.description = description
        let target = bot
        Task { _ = await session.updateProfile(patch, for: target) }
    }
}

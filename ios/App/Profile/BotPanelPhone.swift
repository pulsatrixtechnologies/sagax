// The iPhone's bot panel: the desktop's (`BotSettingsDialog.tsx`, tabs
// `bot-settings/panel-tabs.ts`) and the iPad's (Desktop/BotPanel*.swift)
// usage paths, drawn in the phone's own look (big mascot, cards, pill
// tabs), full screen over the chat.
//
//   header   the mascot (a tap opens the avatar editor, a long press the
//            owl's moves and style), the name (edited where it shows) and
//            an "Edit" pill. Title and description live in Edit bot.
//   top bar  Back, Share (a link that opens the bot in Sagax on a
//            computer), and the bot's one "..." menu (`BotActionsMenu.tsx`,
//            #518): Edit bot, Rename, Primary Bot; Export the conversation
//            (copy, download) and the bot (.zip); Archive
//   overview one grouped list (the reference design): Coding (n working,
//            the Coding and Activity card), Routines (n on), Library
//            (Files: the conversation's files by kind and the bot's links;
//            Skills; Plugins) and Computer (its state), each its own page:
//            the desktop's three tabs, Details split in two. Then the
//            Notifications switch with its caption.
//   Edit bot under "..." and as the "Edit" pill: the Grok Bot layout
//            (`BotEditTree`, BotEditPhone.swift): the bot's header, the main
//            sections in the wizard's order with its recap line, Advanced,
//            then Archive and Delete in red; the detail one page in.
//
// Which tabs and sections a pairing shows is `DesktopPanelTab` /
// `DesktopPanelSection` / `DesktopPersonaEditor` (CompanionCore, from
// SurfaceGate), the same rules as the iPad's. Every door into it is a
// `BotPanelDoor`.
//
// Each sub-tree is type-erased (`AnyView`): a deep SwiftUI type overflowed
// the iPad's main-thread stack once (I1, build 6).
import CompanionCore
import PhotosUI
import SwiftUI
import UIKit

/// The full screen cover: one panel per bot.
struct PhoneBotPanel: View {
    let bot: Bot
    var tab: DesktopPanelTab = .details
    /// Opens straight on an Edit persona section (Edit rule: Access).
    var section: DesktopPanelSection? = nil

    var body: some View {
        AnyView(PhoneBotPanelContent(bot: bot, startTab: tab, startSection: section)).id(bot.id)
    }
}

private struct PhoneBotPanelContent: View {
    @Environment(\.themePalette) var themePalette
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss

    let bot: Bot

    @State private var path = NavigationPath()
    @State private var slackURL: URL?
    /// B21 / CO5 (2026-10-21): the bot's own address from the Perspicax relay.
    @State private var mailRow: BotInboundMailRow?
    @State private var viewerId = "local-owner"
    @State private var menuOpen = false
    @State private var toast: String?
    @State private var editingAvatar = false
    @State private var confirmingArchive = false
    @State private var confirmingDelete = false
    @State private var renaming = false
    @State private var renameDraft = ""
    @State private var exportingZip = false
    @State private var pickingPrimary = false
    @State private var primaryWorking = false
    @State private var sharedFile: IdentifiedURL?
    /// "Share as Template": a public template link of this bot.
    @State private var sharingTemplate = false
    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var draft: CharacterDraft
    @State private var libraryStart: BotLibraryChip = .files(.all)
    /// Grok Bot's three tabs under the name (2026-11-01).
    @State private var tab: DesktopPanelTab
    /// Set when the person wakes the computer from its tab.
    @State private var wakeRequestedAt: Date?
    @State private var panelContentWidth: CGFloat = 402

    // Details
    @StateObject private var activity: BotActivityModel
    @State private var activityRoute: BotActivityRoute?
    @State private var routines: [Routine] = []
    @State private var routinesLoaded = false
    @State private var addingRoutine = false
    @State private var runLogs = false
    @State private var deletingRoutine: Routine?
    /// 2026-10-29: the routine renamed and the one duplicated from its menu.
    @State private var renamingRoutine: Routine?
    @State private var routineRuns: [RoutineRun] = []
    @State private var duplicatingRoutine: Routine?
    /// 2026-10-28: this bot's folder order (RoutineFolders) and its prompts.
    @State private var routineFolders: [String] = []
    /// An older server has no routine folders (2026-10-28).
    @State private var routineFoldersListed = true
    @StateObject private var folderController = RoutineFolderController()

    init(bot: Bot, startTab: DesktopPanelTab, startSection: DesktopPanelSection? = nil) {
        self.bot = bot
        // a deep link lands on the section with Edit persona under it (Back
        // returns to the persona list, as a tap through it would)
        var start = NavigationPath()
        if let startSection {
            start.append(PanelPersonaRoute())
            // the tree's pages that lead to it (the full tree: a row the
            // pairing hides has no page to land on anyway)
            for page in BotEditTree.path(to: startSection) ?? [] { start.append(page) }
            start.append(startSection)
        }
        // a door that names Library or Computer opens on that tab
        _tab = State(initialValue: startSection == nil ? startTab : .details)
        _path = State(initialValue: start)
        _draft = State(initialValue: CharacterDraft(bot: bot))
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: gate, slack: slackURL != nil) }
    private var sections: [DesktopPanelSection] { DesktopPanelSection.visible(gate: gate, slack: slackURL != nil, bot: current) }
    private var botRoutines: [Routine] { DesktopRoutineList.of(botId: bot.id, in: routines) }

    var body: some View {
        NavigationStack(path: $path) {
            AnyView(root)
                .navigationDestination(for: DesktopPanelSection.self) { section in
                    BotPanelSectionPage(section: section, bot: current, worksOnListed: sections.contains(.worksOn), slackURL: slackURL)
                }
                .navigationDestination(for: PanelRoutineRoute.self) { route in
                    if let routine = routines.first(where: { $0.id == route.id }) {
                        RoutineDetailView(routine: routine, showsInstruction: route.instruction) { await loadRoutines() }
                    }
                }
                .navigationDestination(for: PanelComputerRoute.self) { _ in ComputerView(bot: current) }
                .navigationDestination(for: PanelOverviewPage.self) { page in AnyView(overviewPage(page)) }
                .navigationDestination(for: PanelPersonaRoute.self) { _ in AnyView(personaPage) }
                .navigationDestination(for: BotEditPageID.self) { page in
                    AnyView(PhoneBotEditPage(page: page, bot: current, context: editContext, actions: editActions))
                }
        }
        .tint(Theme.accentText)
        .sheet(isPresented: $editingAvatar) { PhoneBotAvatarSheet(bot: current, draft: $draft) }
        .sheet(item: $activityRoute) { route in
            BotActivitySheet(botId: bot.id, route: route, model: activity) { _, threadId in
                activityRoute = nil
                openThread(threadId)
            }
        }
        .sheet(isPresented: $addingRoutine) {
            RoutineEditorView(routine: nil, presetBotId: bot.id) { await loadRoutines() }
        }
        .sheet(item: $duplicatingRoutine) { source in
            RoutineEditorView(routine: nil, copyOf: source) { await loadRoutines() }
        }
        .routineRenamePrompt($renamingRoutine) { routine, name in
            _ = await session.renameRoutine(routine, name: name)
            await loadRoutines()
        }
        .sheet(isPresented: $runLogs) { AutomationsSheet() }
        .sheet(isPresented: $pickingPrimary) {
            PrimaryBotPicker(currentId: current.id, viewerId: viewerId) { show($0) }
        }
        .sheet(item: $sharedFile) { file in ProfileShareSheet(items: [file.url]) }
        .sheet(isPresented: $sharingTemplate) { ShareTemplateSheet(bot: current).environmentObject(session) }
        .sheet(isPresented: $exportingZip) { BotZipExportSheet(bot: current) { exportingZip = false } }
        .confirmationDialog(
            String(localized: "Archive \(current.name)?"),
            isPresented: $confirmingArchive,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Archive")) { Task { await archiveBot() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text("Its conversations are kept. Archived bots in the account menu brings it back.")
        }
        .confirmationDialog(
            String(localized: "Delete \(current.name)?"),
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete"), role: .destructive) { Task { await deleteBot() } }
            Button(String(localized: "Cancel"), role: .cancel) {}
        } message: {
            Text(String(localized: "The bot and its conversations will be deleted. This cannot be undone."))
        }
        .alert("Rename the bot", isPresented: $renaming) {
            TextField("Name", text: $renameDraft)
                .accessibilityIdentifier("panel-rename-field")
            Button("Cancel", role: .cancel) {}
            Button("Save") {
                let target = current
                let draft = renameDraft
                Task { await session.renameBot(target, to: draft) }
            }
        }
        .confirmationDialog(
            String(localized: "Delete \(deletingRoutine?.name ?? String(localized: "this routine"))?"),
            isPresented: Binding(get: { deletingRoutine != nil }, set: { if !$0 { deletingRoutine = nil } }),
            titleVisibility: .visible
        ) {
            Button(String(localized: "Delete routine"), role: .destructive) {
                guard let routine = deletingRoutine else { return }
                Task {
                    if await session.deleteRoutine(routine) { await loadRoutines() }
                    deletingRoutine = nil
                }
            }
        } message: {
            Text("Past run receipts remain available.")
        }
        .routineFolderPrompts(folderController, session: session, folders: { _ in folderOrder }) { await loadRoutines() }
        .onValueChange(of: current.color) { _ in syncDraft() }
        .onValueChange(of: current.mascotLook) { _ in syncDraft() }
        .onValueChange(of: current.mascotSkin) { _ in syncDraft() }
        .onValueChange(of: BotActivityRules.signature(current.tasks)) { _ in Task { await activity.refresh() } }
        .onDisappear { activity.stop() }
        .task {
            if gate.allows(.botActivity) { activity.start(client: session.profileClient) }
            async let config = session.configStatus()
            await loadRoutines()
            viewerId = PrimaryBotRules.viewerId(config: await config)
            if gate.allows(.botSlack) { slackURL = await session.profileClient?.slackManagementURL(botId: bot.id) }
            mailRow = await session.profileClient?.botInboundMail(botId: bot.id)
            #if DEBUG
            await applyParityScreen()
            #endif
        }
    }

    // MARK: Root

    private var root: some View {
        ZStack(alignment: .top) {
            Theme.bg.ignoresSafeArea()
            ScrollView {
                VStack(spacing: 0) {
                    AnyView(identity)
                    PanelTabBar(tabs: tabs, selected: $tab)
                        .padding(.top, 14)
                    switch tab {
                    case .details: AnyView(detailsTab)
                    case .library:
                        AnyView(PhoneBotLibrary(bot: current, start: libraryStart, onShowInChat: { file in showInChat(file) }, onShowLink: { link in showInChat(link) }))
                            .padding(.top, 16)
                    case .computer: AnyView(computerTab)
                    }
                    Color.clear.frame(height: 1).id("panel-end")
                }
                .padding(.top, 64)
                .padding(.bottom, 48)
            }
            .scrollIndicators(.visible)
            .scrollDismissesKeyboard(.interactively)
            .accessibilityIdentifier("profile-scroll")
            ProfileTopFade().ignoresSafeArea()
            AnyView(topBar)
            if menuOpen {
                Color.black.opacity(0.001)
                    .ignoresSafeArea()
                    .onTapGesture { withAnimation(.snappy(duration: 0.2)) { menuOpen = false } }
                    .accessibilityHidden(true)
                HStack {
                    Spacer()
                    GlassMenuPanel(items: menuItems) { withAnimation(.snappy(duration: 0.2)) { menuOpen = false } }
                        .padding(.trailing, 8.3)
                }
                .transition(.scale(scale: 0.6, anchor: .topTrailing).combined(with: .opacity))
            }
            if let toast {
                Text(verbatim: toast)
                    .font(Theme.Font.body)
                    .foregroundStyle(Theme.textPrimary)
                    .padding(.horizontal, 18)
                    .frame(height: 40)
                    .themeGlass(Capsule(), interactive: false)
                    .padding(.top, 60)
                    .transition(.opacity)
                    .accessibilityIdentifier("panel-toast")
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("bot-panel")
    }

    // MARK: Top bar

    /// Back, then share and "...", each a round glass button (the
    /// reference design's bot detail).
    private var topBar: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            GlassCircleButton(
                systemImage: "chevron.left", accessibilityLabel: "Back",
                glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25)
            ) { dismiss() }
                .chatGlassRim(Circle())
                .accessibilityIdentifier("panel-close")
            Spacer()
            ShareGlassButton { shareBot() }
                .accessibilityLabel(Text("Share"))
                .accessibilityIdentifier("panel-share")
            GlassCircleButton(systemImage: "ellipsis", accessibilityLabel: "Bot menu", glyphSize: 15, weight: .semibold) {
                withAnimation(.snappy(duration: 0.22)) { menuOpen.toggle() }
            }
            .chatGlassRim(Circle())
            .accessibilityIdentifier("profile-more")
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
    }

    /// The bot's one "..." menu (`BotActionsMenuPlan`, the desktop's
    /// `BotActionsMenu`): a divider between its groups, the export under
    /// its heading.
    private var menuItems: [GlassMenuItem] {
        let plan = BotActionsMenuPlan(
            gate: gate, bot: current, viewerId: viewerId, editable: !sections.isEmpty,
            zipExport: gate.scope != .sidecar && (session.canAdminister || PrimaryBotRules.viewerOwns(current, viewerId: session.roomViewer.actorId)),
            activeBotCount: session.state.bots.filter { $0.hidden != true }.count,
            wizard: true
        )
        var out: [GlassMenuItem] = []
        for (groupIndex, group) in plan.groups.enumerated() {
            for (index, item) in group.enumerated() {
                let divider = groupIndex > 0 && index == 0
                let heading: Text? = item == .copyConversation ? Text("Export conversation") : nil
                out.append(menuItem(item, plan: plan, divider: divider, heading: heading))
            }
        }
        // Copy ID (the reference design's profile menu), after the identity group
        let copyId = GlassMenuItem(id: "copy-id", title: Text("Copy ID"), systemImage: "doc.on.clipboard") {
            UIPasteboard.general.string = current.id
            Haptics.selection()
            show(String(localized: "Copied"))
        }
        out.insert(copyId, at: out.firstIndex(where: \.dividerBefore) ?? out.endIndex)
        let shareTemplate = GlassMenuItem(id: "share-template", title: Text("Share as Template"), systemImage: "link") {
            sharingTemplate = true
        }
        out.insert(shareTemplate, at: out.firstIndex(where: \.dividerBefore) ?? out.endIndex)
        return out
    }

    private func menuItem(_ item: BotActionsMenuItem, plan: BotActionsMenuPlan, divider: Bool, heading: Text?) -> GlassMenuItem {
        switch item {
        case .editBot:
            return GlassMenuItem(id: "edit-bot", title: Text("Edit bot"), systemImage: "person.crop.circle.badge.pencil", dividerBefore: divider, heading: heading) { openPersona() }
        case .redoWizard:
            return GlassMenuItem(id: "redo-wizard", title: Text("Redo the wizard"), systemImage: "wand.and.stars", dividerBefore: divider, heading: heading) {
                BotWizardPresenter.shared.open(botId: current.id)
            }
        case .rename:
            return GlassMenuItem(id: "rename", title: Text("Rename the bot"), systemImage: "pencil", dividerBefore: divider, heading: heading) {
                renameDraft = current.name
                renaming = true
            }
        case .share:
            return GlassMenuItem(id: "share-people", title: Text("Share"), systemImage: "person.badge.plus", dividerBefore: divider, heading: heading) {
                Haptics.selection()
                openEditor(at: .sharing)
            }
        case .makePrimary:
            return GlassMenuItem(id: "make-primary", title: Text("Make primary bot"), systemImage: "star", disabled: primaryWorking, dividerBefore: divider, heading: heading) {
                Task { await PrimaryBotActions.make(current.id, session: session, done: { show($0) }, working: $primaryWorking) }
            }
        case .replacePrimary:
            return GlassMenuItem(id: "replace-primary", title: Text("Replace with different Bot"), systemImage: "arrow.left.arrow.right", dividerBefore: divider, heading: heading) {
                pickingPrimary = true
            }
        case .copyConversation:
            return GlassMenuItem(id: "copy-markdown", title: Text("Copy as Markdown"), systemImage: "doc.on.doc", dividerBefore: divider, heading: heading) { exportConversation(copy: true) }
        case .downloadConversation:
            return GlassMenuItem(id: "download-markdown", title: Text("Download as .md"), systemImage: "arrow.down.to.line", dividerBefore: divider, heading: heading) { exportConversation(copy: false) }
        case .exportZip:
            return GlassMenuItem(id: "export-zip", title: Text("Export the bot (.zip)"), systemImage: "doc.zipper", dividerBefore: divider, heading: heading) { exportingZip = true }
        case .archive:
            return GlassMenuItem(id: "archive", title: Text("Archive…"), systemImage: "archivebox", disabled: !plan.enables(.archive), dividerBefore: divider, heading: heading) {
                confirmingArchive = true
            }
        case .inspector:
            return GlassMenuItem(id: "inspector", title: Text("Inspector"), systemImage: "ladybug", dividerBefore: divider, heading: heading) {}
        }
    }

    // MARK: Identity

    /// The big mascot (a tap opens the avatar editor), the name (edited in
    /// place) and the "Edit" pill that opens the bot's editor.
    private var identity: some View {
        VStack(spacing: 0) {
            BotMascotView(bot: current, size: 112, state: MausState.forChat(.bot(current), in: session.state),
                          animated: true, owlHandle: owlHandle)
                .contentShape(Rectangle())
                // a tap opens the character editor, as the desktop's mascot does
                .onTapGesture {
                    Haptics.selection()
                    editingAvatar = true
                }
                .contextMenu {
                    CharacterMovesMenu(
                        look: draft.complete,
                        onMove: { owlHandle.flourish($0) },
                        onShapeMove: { owlHandle.shape($0) }
                    )
                }
                .accessibilityLabel(Text("Edit avatar"))
                .accessibilityIdentifier("profile-mascot")
                .accessibilityAddTraits(.isButton)
            PhoneInlineText(value: current.name, placeholder: nil, label: "Edit name", font: Theme.Font.profileName,
                            required: true, limit: 100, id: "profile-name") { save(name: $0) }
                .padding(.top, 6)
            if !sections.isEmpty {
                Button(action: openPersona) {
                    Text("Edit")
                        .font(Theme.Font.bodyMedium)
                        .foregroundStyle(Theme.textPrimary)
                        .padding(.horizontal, 16)
                        .frame(height: 36)
                        .background(Theme.cardRaised, in: Capsule())
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .padding(.top, 4)
                .accessibilityLabel(Text("Edit bot"))
                .accessibilityIdentifier("panel-edit-persona")
            }
        }
    }

    // MARK: Tabs

    /// Details, as Grok Bot's: the notices and suggestions, the to-do list,
    /// Coding, the routines with their switches, the email address and
    /// notifications.
    private var detailsTab: some View {
        VStack(spacing: 0) {
            BotPanelNoticesView(bot: current)
                .padding(.top, 16)
            // the desktop's Details > Suggestions (Hide turns it off everywhere)
            BotSuggestionsCard(bot: current) { runSuggestion($0) }
                .padding(.horizontal, 16)
                .padding(.top, 12)
            // the desktop's Details > Tasks: the to-do list the bot keeps
            BotTaskListCard(bot: current, openThread: { openThread($0) }, insets: true)
            if !overviewRows.isEmpty {
                AnyView(overviewCard)
                    .padding(.top, 8)
            }
            AnyView(routinesSection)
                .padding(.top, Theme.Profile.cardGap + 8)
            if let mailRow {
                AnyView(emailCard(mailRow))
                    .padding(.top, Theme.Profile.cardGap + 12)
            }
            AnyView(notificationsCard)
                .padding(.top, Theme.Profile.cardGap + 12)
        }
    }

    /// "Routines" over the bot's routines, each with its switch as in Grok
    /// Bot; "All" opens the full page (folders, sort, run logs).
    private var routinesSection: some View {
        VStack(spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text("Routines")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textTertiary)
                Spacer()
                Button {
                    Haptics.selection()
                    path.append(PanelOverviewPage.routines)
                } label: {
                    Text(routinesLoaded ? String(localized: "\(routinesOn) on") : String(localized: "All"))
                        .font(Theme.Profile.labelFont)
                        .foregroundStyle(Theme.accentText)
                        .padding(.vertical, 6)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("All routines"))
                .accessibilityIdentifier("panel-overview.routines")
            }
            .padding(.horizontal, Theme.Profile.cardMargin + Theme.Profile.textInset)
            .padding(.bottom, 2)
            ProfileCard {
                if !routinesLoaded {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading routines…")
                    }
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .frame(maxWidth: .infinity, minHeight: Theme.Profile.row)
                }
                ForEach(botRoutines.prefix(PanelRoutinePreview.limit)) { routine in
                    routineSwitchRow(routine)
                    ProfileDivider(leading: Theme.Profile.textInset)
                }
                if botRoutines.count > PanelRoutinePreview.limit {
                    Button {
                        Haptics.selection()
                        path.append(PanelOverviewPage.routines)
                    } label: {
                        ProfileRow(title: Text("Show all \(botRoutines.count)"), titleColor: Theme.accentText, height: Theme.Profile.row)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("panel-routines-all")
                    ProfileDivider(leading: Theme.Profile.textInset)
                }
                Button {
                    Haptics.selection()
                    addingRoutine = true
                } label: {
                    ProfileRow(icon: ProfileRowIcon(systemImage: "plus", size: 18, color: Theme.blue),
                               title: Text("Add routine"), titleColor: Theme.accentText, height: Theme.Profile.row)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("panel-add-routine")
            }
        }
    }

    /// A routine with its switch (Grok Bot's Details): the row opens the
    /// routine, the switch turns it on or off where the person may.
    private func routineSwitchRow(_ routine: Routine) -> some View {
        HStack(spacing: 8) {
            Button {
                Haptics.selection()
                path.append(PanelRoutineRoute(id: routine.id, instruction: false))
            } label: {
                ProfileRow(
                    title: Text(verbatim: routine.name),
                    subtitle: routine.enabled
                        ? Text(verbatim: RoutineWording.subtitle(routine))
                        : Text("Paused"),
                    height: Theme.Profile.routineRow
                )
            }
            .buttonStyle(.plain)
            Toggle("", isOn: Binding(get: { routine.enabled }, set: { on in
                Task { _ = await session.setRoutineEnabled(routine, enabled: on); await loadRoutines() }
            }))
            .labelsHidden()
            .tint(MausPalette.color(current.color))
            .disabled(!(routine.mayEdit && routine.canToggle()))
            .padding(.trailing, Theme.Profile.textInset)
            .accessibilityLabel(Text(verbatim: routine.name))
            .accessibilityIdentifier("panel-routine-switch.\(routine.name)")
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("profile-routine.\(routine.name)")
    }

    /// Computer, as Grok Bot shows it: asleep (the mascot dozing, "z Z"),
    /// waking up, or the live screen alone once it runs.
    private var computerTab: some View {
        let phase = BotComputerPhase.of(computer: current.computer, busy: current.busy == true,
                                        wakeRequestedAt: wakeRequestedAt, now: Date())
        return VStack(spacing: 0) {
            switch phase {
            case .running:
                // the live screen alone, with its own caption (Grok Bot)
                ComputerView(bot: current, embeddedWidth: panelContentWidth - 2 * Theme.Profile.cardMargin) {
                    path.append(PanelComputerRoute())
                }
                .padding(.horizontal, Theme.Profile.cardMargin)
                .accessibilityIdentifier("panel-computer-live")
            case .asleep, .waking, .off:
                BotComputerSleepCard(bot: current, phase: phase) {
                    wakeRequestedAt = Date()
                    Task {
                        try? await Task.sleep(nanoseconds: UInt64(BotComputerPhase.wakeWindow * 1_000_000_000))
                        // awake: the live screen takes the tab
                        if wakeRequestedAt != nil { wakeRequestedAt = .distantPast }
                    }
                } open: {
                    path.append(PanelComputerRoute())
                }
            }
            if phase != .running {
                Text("\(current.name)'s screen")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textTertiary)
                    .padding(.top, 10)
            }
        }
        .padding(.top, 16)
        .background(GeometryReader { box in
            Color.clear.onAppear { panelContentWidth = box.size.width }
                .onValueChange(of: box.size.width) { panelContentWidth = $0 }
        })
    }

    // MARK: Overview

    private var codingWorking: Int { (activity.coding ?? []).filter { $0.status.isActive }.count }
    private var routinesOn: Int { botRoutines.filter(\.enabled).count }

    /// Idle, Working or Off, from what the bot does now and where it works.
    private var computerStatus: String {
        if current.computer == "off" { return String(localized: "Off") }
        return current.busy == true ? String(localized: "Working") : String(localized: "Idle")
    }

    /// Coding, Routines, Library and Computer as one grouped list, each a
    /// page of its own (the reference design's bot detail). The Library and
    /// Computer rows keep the identifiers the tabs had.
    private var overviewCard: some View {
        ProfileCard {
            ForEach(Array(overviewRows.enumerated()), id: \.element.id) { index, row in
                if index > 0 { ProfileDivider() }
                Button {
                    Haptics.selection()
                    switch row.page {
                    case .computer: path.append(PanelComputerRoute())
                    case let .page(page): path.append(page)
                    }
                } label: {
                    ProfileRow(icon: ProfileRowIcon(systemImage: row.symbol, size: 16), title: row.title,
                               height: Theme.Profile.singleRow) {
                        HStack(spacing: 10) {
                            if let value = row.value {
                                Text(verbatim: value)
                                    .font(Theme.Font.body)
                                    .foregroundStyle(Theme.textSecondary)
                                    .lineLimit(1)
                            }
                            ProfileChevronTrailing()
                        }
                    }
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier(row.id)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Bot panel"))
    }

    private var overviewRows: [OverviewRow] {
        var rows: [OverviewRow] = []
        if gate.allows(.botActivity) {
            rows.append(OverviewRow(id: "panel-overview.coding", symbol: "chevron.left.forwardslash.chevron.right", title: Text("Coding"),
                                    value: String(localized: "\(codingWorking) working"), page: .page(.coding)))
        }
        // Routines, Library and Computer are Details' section and the
        // panel's tabs now (Grok Bot, 2026-11-01)
        return rows
    }

    /// The bot's own email address (B21 / CO5): the address with a copy
    /// button, then the one rule, or the wait for the administrator (off by
    /// default). Changing it is on the desktop (the owner's PUT). Absent
    /// when there is none (solo server, older Perspicax, inbound mail off).
    private func emailCard(_ row: BotInboundMailRow) -> some View {
        VStack(spacing: 0) {
            ProfileCard {
                ProfileRow(icon: ProfileRowIcon(systemImage: "envelope", size: 16), title: Text("Email address"),
                           // greyed while the administrator has not turned it on
                           subtitle: Text(verbatim: row.address).foregroundColor(row.waitingForAdmin ? Theme.textTertiary : Theme.textSecondary),
                           height: Theme.Profile.routineRow) {
                    Button {
                        UIPasteboard.general.string = row.address
                        Haptics.selection()
                        show(String(localized: "Email address copied"))
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 15))
                            .foregroundStyle(Theme.textSecondary)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Text("Copy email address"))
                    .accessibilityIdentifier("panel-email-copy")
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("panel-email")
            ProfileFooter(text: row.waitingForAdmin
                ? "Waiting for the administrator to turn it on"
                : "Mail received at this address only wakes a routine (Bot email trigger).")
        }
    }

    /// The bot's notifications switch, under the list, with its caption.
    private var notificationsCard: some View {
        VStack(spacing: 0) {
            ProfileCard {
                Toggle(isOn: Binding(get: { current.notifications }, set: { on in
                    var patch = BotProfilePatch()
                    patch.notifications = on
                    let target = current
                    Task { _ = await session.updateProfile(patch, for: target) }
                })) {
                    Text("Notifications").font(Theme.Font.body).foregroundStyle(Theme.textPrimary)
                }
                .tint(Theme.toggleOn)
                .padding(.horizontal, Theme.Profile.textInset)
                .frame(minHeight: Theme.Profile.singleRow)
                .accessibilityIdentifier("panel-notifications")
            }
            ProfileFooter(text: "Get notified when this Bot finishes or needs input")
        }
    }

    private func openPersona() {
        Haptics.selection()
        path.append(PanelPersonaRoute())
    }

    /// The system share sheet with a link that opens this bot in Sagax on
    /// a computer (the desktop's Copy link to this bot).
    private func shareBot() {
        guard let url = URL(string: "sagax://bot/\(current.id)") else { return }
        sharedFile = IdentifiedURL(url: url)
    }

    // MARK: Overview pages

    private func overviewPage(_ page: PanelOverviewPage) -> some View {
        ScrollView {
            VStack(spacing: 0) {
                switch page {
                case .coding: AnyView(codingPage)
                case .routines: AnyView(routinesPage)
                case .library:
                    AnyView(PhoneBotLibrary(bot: current, start: libraryStart, onShowInChat: { file in showInChat(file) }, onShowLink: { link in showInChat(link) }))
                }
            }
            .padding(.top, 16)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.visible)
        .scrollDismissesKeyboard(.interactively)
        .accessibilityIdentifier("profile-scroll")
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(page.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var codingPage: some View {
        VStack(spacing: 0) {
            if gate.allows(.botActivity) {
                BotActivityCard(
                    bot: current,
                    model: activity,
                    onOpen: { activityRoute = .detail($0) },
                    onHistory: { activityRoute = .history($0) }
                )
            }
        }
    }

    private var routinesPage: some View {
        VStack(spacing: 0) {
            Color.clear.frame(height: 0).id("profile-routines-anchor")
            AnyView(routinesCard)
        }
    }

    private var routinesCard: some View {
        ProfileCard {
            if !routinesLoaded {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading routines…")
                }
                .font(Theme.Profile.labelFont)
                .foregroundStyle(Theme.textSecondary)
                .frame(maxWidth: .infinity, minHeight: Theme.Profile.row)
            }
            // 2026-10-28: no folder first, then each folder of the bot in
            // its order, folded or open (kept per bot on this phone)
            let groups = RoutineFolders.group(botRoutines, order: routineFolders, botId: bot.id)
            ForEach(groups.first?.routines ?? []) { routine in routineCardRow(routine) }
            ForEach(groups.dropFirst()) { group in
                if let folder = group.folder {
                    RoutineFolderHeader(group: group, botId: bot.id, folder: folder, canSortByPrefix: canSortByPrefix, controller: folderController) { enabled in
                        Task { await folderController.setEnabled(group.routines, enabled: enabled, session: session) { await loadRoutines() } }
                    }
                    .padding(.leading, Theme.Profile.textInset)
                    .padding(.trailing, 8)
                    .frame(minHeight: Theme.Profile.row)
                    ProfileDivider()
                    if !folderController.isCollapsed(botId: bot.id, folder: folder) {
                        ForEach(group.routines) { routine in routineCardRow(routine).padding(.leading, 12) }
                    }
                }
            }
            Button {
                Haptics.selection()
                addingRoutine = true
            } label: {
                ProfileRow(icon: ProfileRowIcon(systemImage: "plus", size: 18, color: Theme.blue),
                           title: Text("Add routine"), titleColor: Theme.accentText, height: Theme.Profile.row)
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("profile-add-routine")
            ProfileDivider()
            // Permanent: it stays while a title starts with [X]
            if canSortByPrefix {
                Button {
                    Haptics.selection()
                    folderController.sortRequest = bot.id
                } label: {
                    ProfileRow(icon: ProfileRowIcon(systemImage: "folder.badge.gearshape", size: 16), title: Text("Sort by prefix"),
                               height: Theme.Profile.row)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("profile-sort-routines-by-prefix")
                ProfileDivider()
            }
            Button {
                Haptics.selection()
                runLogs = true
            } label: {
                ProfileRow(icon: ProfileRowIcon(systemImage: "doc.text", size: 16), title: Text("Run logs"),
                           height: Theme.Profile.row) { ProfileChevronTrailing() }
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("panel-run-logs")
        }
    }

    private var canSortByPrefix: Bool {
        routineFoldersListed && !session.routineFoldersMissing
            && !RoutineFolders.prefixCandidates(botRoutines.filter(\.mayEdit)).isEmpty
    }

    private var folderOrder: [String] { RoutineFolders.ordered(routineFolders, routines: botRoutines) }

    /// One routine of the card: opens its detail; the menu files it in a
    /// folder, deletes it (the schedule is never shown as cron, 2026-10-29).
    @ViewBuilder
    private func routineCardRow(_ routine: Routine) -> some View {
        Button {
            Haptics.selection()
            path.append(PanelRoutineRoute(id: routine.id, instruction: false))
        } label: {
            ProfileRow(
                icon: ProfileRowIcon(systemImage: "clock", size: 17,
                                     color: routine.enabled ? Theme.routineActive : Theme.routinePaused),
                title: Text(verbatim: routine.name),
                // #1202: "Runs on change" first, as the list's badge (a long schedule cuts its end)
                subtitle: (routine.runsOnChange ? Text("Runs on change") + Text(verbatim: " · ") : Text(verbatim: ""))
                    + Text(verbatim: RoutineWording.subtitle(routine)),
                height: Theme.Profile.routineRow
            ) { ProfileChevronTrailing() }
        }
        .buttonStyle(.plain)
        .contextMenu {
            // 2026-10-29: the desktop's row menu, then the folder choice.
            let live = routineRuns.first { $0.routineId == routine.id && ($0.status == "running" || $0.status == "waiting" || $0.status == "queued") }
            RoutineActionsMenu(
                routine: routine,
                runNow: routine.mayRun ? { Task { _ = await session.runRoutine(routine); await loadRoutines() } } : nil,
                stop: live != nil && routine.mayEdit ? { if let live { Task { _ = await session.cancelRoutineRun(live); await loadRoutines() } } } : nil,
                toggle: routine.mayEdit && routine.canToggle() ? { Task { _ = await session.setRoutineEnabled(routine, enabled: !routine.enabled); await loadRoutines() } } : nil,
                rename: routine.mayEdit ? { renamingRoutine = routine } : nil,
                open: { path.append(PanelRoutineRoute(id: routine.id, instruction: false)) },
                duplicate: routine.mayEdit ? { duplicatingRoutine = routine } : nil,
                delete: nil
            )
            // A phone has no drag and drop: the folder choice stays here.
            if routine.mayEdit && routineFoldersListed && !session.routineFoldersMissing {
                Button(String(localized: "Folder"), systemImage: "folder") { folderController.moving = routine }
            }
            if gate.allows(.routineDelete) {
                Divider()
                Button("Delete", systemImage: "trash", role: .destructive) { deletingRoutine = routine }
            }
        }
        .accessibilityIdentifier("profile-routine.\(routine.name)")
        ProfileDivider()
    }

    // MARK: Edit bot

    /// Edit bot's tree for this pairing and bot (`BotEditTree`).
    private var editContext: BotEditContext { BotEditContext(gate: gate, bot: current, slack: slackURL != nil) }

    private var editActions: BotEditActions {
        BotEditActions(
            openPage: { path.append($0) },
            openSection: { path.append($0) },
            openRoutines: { path.append(PanelOverviewPage.routines) },
            editAvatar: { editingAvatar = true },
            archive: { confirmingArchive = true },
            delete: { confirmingDelete = true },
            close: { if !path.isEmpty { path.removeLast() } }
        )
    }

    private var personaPage: some View {
        PhoneBotEditRoot(bot: current, context: editContext, routines: routinesLoaded ? routines : nil, actions: editActions)
    }

    /// Edit bot open on a section's page, through the tree's pages (Back
    /// walks back the way a tap would have come).
    private func openEditor(at section: DesktopPanelSection) {
        path.append(PanelPersonaRoute())
        for page in BotEditTree.path(to: section, editContext) ?? [] { path.append(page) }
        path.append(section)
    }

    // MARK: Actions

    private func save(name: String? = nil, title: String? = nil, description: String? = nil) {
        var patch = BotProfilePatch()
        patch.name = name
        patch.title = title
        patch.description = description
        let target = current
        Task { _ = await session.updateProfile(patch, for: target) }
    }

    private func saveLook(_ look: MascotLook) {
        var change = BotProfileEdit()
        change.mascotLook = look
        Task {
            guard let client = session.profileClient else { return }
            do { session.applyProfileBot(try await client.editBot(botId: bot.id, edit: change)) }
            catch { session.actionError = error.localizedDescription }
        }
    }

    private func syncDraft() {
        let server = CharacterDraft(bot: current)
        if server != draft { draft = server }
    }

    private func show(_ message: String) {
        withAnimation { toast = message }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation { toast = nil }
        }
    }

    private func exportConversation(copy: Bool) {
        let threadId = current.threadId
        Task {
            guard let url = await session.export(threadId: threadId, format: "markdown") else { return }
            if copy {
                if let text = try? String(contentsOf: url, encoding: .utf8) {
                    UIPasteboard.general.string = text
                    show(String(localized: "Copied"))
                }
            } else {
                sharedFile = IdentifiedURL(url: url)
            }
        }
    }

    /// Archive (`hidden: true`): the conversations stay; the panel closes.
    private func archiveBot() async {
        let target = current
        if await session.setArchived(target, archived: true) {
            dismiss()
        }
    }

    /// Delete (`DELETE /api/bots/:id`): the bot and its conversations; the panel closes.
    private func deleteBot() async {
        let target = current
        if await session.deleteBot(target) {
            dismiss()
        }
    }

    private func loadRoutines() async {
        let listing = await session.loadRoutineListing()
        routines = listing.routines
        routineRuns = listing.runs
        routineFolders = listing.folders[bot.id] ?? []
        routineFoldersListed = listing.foldersSupported
        routinesLoaded = true
    }

    /// A suggestion: its conversation, or the settings section it names.
    private func runSuggestion(_ action: BotSuggestion.Action) {
        switch action {
        case let .openThread(threadId):
            openThread(threadId)
        case .openSection("routines"):
            path.append(PanelOverviewPage.routines)
        case let .openSection(name):
            guard let section = DesktopPanelSection(rawValue: name), sections.contains(section) else { return }
            openEditor(at: section)
        }
    }

    /// An activity entry's thread: this chat is under the panel, so the
    /// panel goes; another thread opens like a deep link.
    private func openThread(_ threadId: String) {
        let here = threadId == bot.threadId
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            dismiss()
            guard !here else { return }
            try? await Task.sleep(nanoseconds: 700_000_000)
            session.openChat(threadId: threadId)
        }
    }

    /// A file's message in the chat under the panel (FilesSection.tsx `jump`).
    private func showInChat(_ file: ThreadFile) {
        let threadId = bot.threadId
        dismiss()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            await session.jump(to: file.messageId, inThread: threadId)
        }
    }

    /// Go to message on a link: its own conversation of this bot, which the
    /// chat under the panel switches to in place when it is another one.
    private func showInChat(_ link: BotLink) {
        guard let messageId = link.messageId else { return }
        let botId = bot.id
        let threadId = link.threadId ?? bot.threadId
        dismiss()
        Task {
            try? await Task.sleep(nanoseconds: 600_000_000)
            await session.showLinkMessage(messageId, botId: botId, threadId: threadId)
        }
    }

    // MARK: Parity harness

    #if DEBUG
    private func applyParityScreen() async {
        guard let screen = ParityLaunch.current?.screen else { return }
        switch screen {
        case .profileLinks: libraryStart = .links; path.append(PanelOverviewPage.library)
        case .profileMedia: libraryStart = .files(.image); path.append(PanelOverviewPage.library)
        case .profileFiles: path.append(PanelOverviewPage.library)
        case .profileComputer: path.append(PanelComputerRoute())
        case .profileInfoScrolled:
            try? await Task.sleep(nanoseconds: 600_000_000)
            path.append(PanelOverviewPage.routines)
        case .profileMoreMenu:
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            menuOpen = true
        case .profileInfo:
            // `-parityBotEditRoute root` (or a section) opens Edit bot
            guard let route = UserDefaults.standard.string(forKey: "parityBotEditRoute") else { break }
            try? await Task.sleep(nanoseconds: 800_000_000)
            path.append(PanelPersonaRoute())
            if let page = BotEditPageID(rawValue: route) {
                if page != .root { path.append(page) }
            } else if let section = DesktopPanelSection(rawValue: route) {
                for page in BotEditTree.path(to: section, editContext) ?? [] { path.append(page) }
                path.append(section)
            }
        case .routineDetail, .routineInstruction:
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            if let first = botRoutines.first(where: { $0.schedule.type == .cron }) ?? botRoutines.first {
                path.append(PanelRoutineRoute(id: first.id, instruction: screen == .routineInstruction))
            }
        default: break
        }
    }
    #endif
}

private struct PanelRoutineRoute: Hashable {
    let id: String
    let instruction: Bool
}

private struct PanelComputerRoute: Hashable {}

/// A page of the overview list (Computer has its own route).
private enum PanelOverviewPage: String, Hashable {
    case coding, routines, library

    var title: LocalizedStringKey {
        switch self {
        case .coding: "Coding"
        case .routines: "Routines"
        case .library: "Library"
        }
    }
}

/// One row of the overview list: its identifier, icon, title, the value at
/// its end and where it goes.
private struct OverviewRow {
    enum Target {
        case page(PanelOverviewPage)
        case computer
    }

    let id: String
    let symbol: String
    let title: Text
    let value: String?
    let page: Target
}

/// The persona editor's page (the sections list).
private struct PanelPersonaRoute: Hashable {}

// MARK: - Inline text

/// Text that becomes a field on a tap (`InlineEditableText`): Return or
/// leaving the field saves (`DesktopInlineEdit.commit`), so nothing waits
/// for a Save button.
struct PhoneInlineText: View {
    @Environment(\.themePalette) var themePalette
    let value: String
    let placeholder: LocalizedStringKey?
    let label: LocalizedStringKey
    let font: Font
    var muted = false
    var required = false
    var limit = 200
    var multiline = false
    let id: String
    let onSave: (String) -> Void

    @State private var editing = false
    @State private var draft = ""
    @FocusState private var focused: Bool

    private var shown: String { value.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        Group {
            if editing {
                AnyView(field)
            } else {
                AnyView(text)
            }
        }
        .padding(.horizontal, Theme.Profile.textInset)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
    }

    private var text: some View {
        Group {
            if shown.isEmpty, let placeholder {
                Text(placeholder).foregroundStyle(Theme.textTertiary)
            } else {
                Text(verbatim: shown).foregroundStyle(muted ? Theme.textSecondary : Theme.textPrimary)
            }
        }
        .font(font)
        .multilineTextAlignment(.center)
        .lineLimit(multiline ? 4 : 1)
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture {
            draft = value
            editing = true
        }
        .accessibilityLabel(Text(label))
        .accessibilityValue(Text(verbatim: shown))
        .accessibilityHint(Text("Double tap to edit"))
        .accessibilityIdentifier(id)
    }

    private var field: some View {
        TextField("", text: $draft, prompt: placeholder.map { Text($0) }, axis: multiline ? .vertical : .horizontal)
            .font(font)
            .foregroundStyle(Theme.textPrimary)
            .multilineTextAlignment(.center)
            .lineLimit(multiline ? 1...6 : 1...1)
            .focused($focused)
            .submitLabel(.done)
            .onSubmit { focused = false }
            .onValueChange(of: draft) { next in
                if multiline, next.contains("\n") { draft = next.replacingOccurrences(of: "\n", with: ""); focused = false }
                if draft.count > limit { draft = String(draft.prefix(limit)) }
            }
            .onAppear { focused = true }
            .onValueChange(of: focused) { now in if !now { commit() } }
            .accessibilityLabel(Text(label))
            .accessibilityIdentifier("\(id)-field")
    }

    private func commit() {
        guard editing else { return }
        editing = false
        if let next = DesktopInlineEdit.commit(draft: draft, current: value, required: required) { onSave(next) }
    }
}

// MARK: - Library loader

/// One list's pages: the first, then "Show more" pages, each from the
/// server's cursor.
@MainActor
final class LibraryLoader<Item: Sendable & Hashable>: ObservableObject {
    typealias Fetch = (_ cursor: String?, _ limit: Int) async throws -> LibraryPage<Item>

    @Published private(set) var page: LibraryPage<Item>?
    @Published private(set) var loading = false
    @Published private(set) var problem: String?
    private var fetch: Fetch?

    func loadFirst(first: Int = CompanionClient.ProfilePage.firstLinks, _ fetch: @escaping Fetch) {
        guard page == nil, !loading else { return }
        self.fetch = fetch
        loading = true
        problem = nil
        Task {
            do { page = try await fetch(nil, first) } catch { problem = error.localizedDescription }
            loading = false
        }
    }

    func loadMore() {
        guard let fetch, let current = page, let cursor = current.nextCursor, !loading else { return }
        loading = true
        Task {
            do { page = current.appending(try await fetch(cursor, CompanionClient.ProfilePage.more)) } catch { problem = error.localizedDescription }
            loading = false
        }
    }
}

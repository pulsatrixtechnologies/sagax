// The iPhone's bot panel (reference app parity, #2127): full screen over the chat.
//
//   top bar  gear (opens the profile page) and X (close).
//   header   centred mascot and name; Activity / Library pill tabs.
//   Activity Upcoming (routines with toggle, Show more after 5), Suggested,
//            Computer card, Voice chat; Coding / live work / notifications
//            stay as progressive disclosure under those cards.
//   Library  the bot's files (PhoneBotLibrary).
//   Profile  gear opens BotProfilePage: banner, overlapping mascot,
//            "Name · Title", privacy line, General / Knowledge / Settings.
//
// Which sections a pairing shows is `DesktopPanelSection` /
// `DesktopPersonaEditor` (CompanionCore, from SurfaceGate). Every door into
// it is a `BotPanelDoor` (Computer doors land on Activity).
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
    var tab: DesktopPanelTab = .activity
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
    /// A long press on the gear opened the menu: its release is not a tap.
    @State private var gearHeld = false
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
    @State private var panelTab: DesktopPanelTab

    // Activity
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
        let resolved = DesktopPanelTab.resolve(startTab)
        _panelTab = State(initialValue: resolved == .library ? .library : .activity)
        // a deep link lands on the profile section (Back returns to the
        // profile tabs, as a tap through them would)
        var start = NavigationPath()
        if let startSection {
            start.append(PanelProfileRoute(tab: .settings))
            for page in BotEditTree.path(to: startSection) ?? [] { start.append(page) }
            start.append(startSection)
        }
        _path = State(initialValue: start)
        _draft = State(initialValue: CharacterDraft(bot: bot))
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }
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
                .navigationDestination(for: PanelProfileRoute.self) { route in AnyView(profilePage(route.tab)) }
                .navigationDestination(for: PanelPersonaRoute.self) { _ in AnyView(profilePage(.settings)) }
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
                    AnyView(overviewBody)
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
                    GlassMenuPanel(items: menuItems) { withAnimation(.snappy(duration: 0.2)) { menuOpen = false } }
                        .padding(.leading, 8.3)
                    Spacer()
                }
                .transition(.scale(scale: 0.6, anchor: .topLeading).combined(with: .opacity))
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

    /// Gear (profile) on the left, X (close) on the right. Long-press gear
    /// opens the bot actions menu (Archive, Primary, Export, …).
    private var topBar: some View {
        HStack(spacing: Theme.Metric.controlGap) {
            GlassCircleButton(systemImage: "gearshape", accessibilityLabel: "Bot settings", glyphSize: 16) {
                // the release of the long press that opened the menu would
                // also push Settings over it
                if gearHeld { gearHeld = false; return }
                openProfile(tab: .settings)
            }
            .chatGlassRim(Circle())
            .simultaneousGesture(LongPressGesture(minimumDuration: 0.45).onEnded { _ in
                gearHeld = true
                Haptics.selection()
                withAnimation(.snappy(duration: 0.22)) { menuOpen = true }
            })
            .accessibilityIdentifier("panel-gear")
            // where the release fires no tap, closing the menu clears the hold
            .onChange(of: menuOpen) { open in if !open { gearHeld = false } }
            Spacer()
            GlassCircleButton(systemImage: "xmark", accessibilityLabel: "Close", glyphSize: 14, weight: .semibold) {
                dismiss()
            }
            .chatGlassRim(Circle())
            .accessibilityIdentifier("panel-close")
        }
        .padding(.horizontal, Theme.Metric.screenEdge)
        .padding(.top, 6)
    }

    /// The bot's one "..." menu (`BotActionsMenuPlan`, lot 6): Make primary,
    /// Copy ID, Share as Template, Redo the wizard, Share (org), Export,
    /// Archive, Delete. Edit bot and Rename stay off (the Edit button and
    /// the Name field cover them).
    private var menuItems: [GlassMenuItem] {
        let plan = BotActionsMenuPlan(
            gate: gate, bot: current, viewerId: viewerId, editable: !sections.isEmpty,
            zipExport: gate.scope != .sidecar && (session.canAdminister || PrimaryBotRules.viewerOwns(current, viewerId: session.roomViewer.actorId)),
            activeBotCount: session.state.bots.filter { $0.hidden != true }.count,
            wizard: true
        )
        var out: [GlassMenuItem] = []
        func add(_ item: BotActionsMenuItem, divider: Bool = false, heading: Text? = nil) {
            guard plan.items.contains(item) else { return }
            out.append(menuItem(item, plan: plan, divider: divider, heading: heading))
        }
        // Identity group: primary, Copy ID, Share as Template, Redo, Share
        add(.makePrimary)
        add(.replacePrimary)
        out.append(GlassMenuItem(id: "copy-id", title: Text("Copy ID"), systemImage: "doc.on.clipboard") {
            UIPasteboard.general.string = current.id
            Haptics.selection()
            show(String(localized: "Copied"))
        })
        out.append(GlassMenuItem(id: "share-template", title: Text("Share as Template"), systemImage: "link") {
            sharingTemplate = true
        })
        add(.redoWizard)
        add(.share)
        // Export
        var firstExport = true
        for item: BotActionsMenuItem in [.copyConversation, .downloadConversation, .exportZip] {
            guard plan.items.contains(item) else { continue }
            add(item, divider: firstExport, heading: firstExport ? Text("Export conversation") : nil)
            firstExport = false
        }
        // Archive, Delete, Inspector
        var firstLast = true
        for item: BotActionsMenuItem in [.archive, .delete, .inspector] {
            guard plan.items.contains(item) else { continue }
            add(item, divider: firstLast)
            firstLast = false
        }
        return out
    }

    private func menuItem(_ item: BotActionsMenuItem, plan: BotActionsMenuPlan, divider: Bool, heading: Text?) -> GlassMenuItem {
        switch item {
        case .editBot:
            // Kept for exhaustiveness; Lot 6 removed it from the plan.
            return GlassMenuItem(id: "edit-bot", title: Text("Edit bot"), systemImage: "person.crop.circle.badge.pencil", dividerBefore: divider, heading: heading) { openPersona() }
        case .redoWizard:
            return GlassMenuItem(id: "redo-wizard", title: Text("Redo the wizard"), systemImage: "wand.and.stars", dividerBefore: divider, heading: heading) {
                // The panel is a fullScreenCover; the wizard is too. Close
                // the panel first so the wizard can present (lot 6).
                let botId = current.id
                menuOpen = false
                dismiss()
                Task { @MainActor in
                    try? await Task.sleep(nanoseconds: 400_000_000)
                    BotWizardPresenter.shared.open(botId: botId, redo: true)
                }
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
        case .delete:
            return GlassMenuItem(id: "delete-bot", title: Text("Delete bot…"), systemImage: "trash", destructive: true, dividerBefore: divider, heading: heading) {
                confirmingDelete = true
            }
        case .inspector:
            return GlassMenuItem(id: "inspector", title: Text("Inspector"), systemImage: "ladybug", dividerBefore: divider, heading: heading) {}
        }
    }

    // MARK: Identity

    /// Centred mascot and name, then Activity / Library pills.
    private var identity: some View {
        VStack(spacing: 0) {
            BotMascotView(bot: current, size: 112, state: MausState.forChat(.bot(current), in: session.state),
                          animated: true, owlHandle: owlHandle)
                .contentShape(Rectangle())
                .onTapGesture {
                    Haptics.selection()
                    openProfile(tab: .general)
                }
                .contextMenu {
                    CharacterMovesMenu(
                        look: draft.complete,
                        onMove: { owlHandle.flourish($0) },
                        onShapeMove: { owlHandle.shape($0) }
                    )
                    Button("Edit avatar", systemImage: "pencil") {
                        editingAvatar = true
                    }
                }
                .accessibilityLabel(Text("Open bot profile"))
                .accessibilityIdentifier("profile-mascot")
                .accessibilityAddTraits(.isButton)
            PhoneInlineText(value: current.name, placeholder: nil, label: "Edit name", font: Theme.Font.profileName,
                            required: true, limit: 100, id: "profile-name") { save(name: $0) }
                .padding(.top, 6)
            PanelTabBar(tabs: DesktopPanelTab.visible(gate: gate), selected: $panelTab)
                .padding(.top, 14)
                .padding(.horizontal, Theme.Profile.cardMargin)
        }
    }

    // MARK: Activity / Library

    private var overviewBody: some View {
        VStack(spacing: 0) {
            BotPanelNoticesView(bot: current)
                .padding(.top, 16)
            switch panelTab {
            case .library:
                AnyView(libraryBody)
            case .activity, .computer:
                AnyView(activityBody)
            }
        }
    }

    private var activityBody: some View {
        VStack(spacing: 16) {
            BotPanelUpcomingCard(
                bot: current,
                routines: routines,
                loaded: routinesLoaded,
                onOpen: { path.append(PanelRoutineRoute(id: $0.id, instruction: false)) },
                onToggle: { routine, enabled in
                    Task {
                        _ = await session.setRoutineEnabled(routine, enabled: enabled)
                        await loadRoutines()
                    }
                },
                onAdd: { addingRoutine = true },
                onAll: { path.append(PanelOverviewPage.routines) }
            )
            .padding(.horizontal, Theme.Profile.cardMargin)

            BotSuggestionsCard(bot: current) { runSuggestion($0) }
                .padding(.horizontal, Theme.Profile.cardMargin)

            BotPanelComputerCard(bot: current) {
                Haptics.selection()
                path.append(PanelComputerRoute())
            }
            .padding(.horizontal, Theme.Profile.cardMargin)

            BotPanelVoiceChatCard(bot: current)
                .padding(.horizontal, Theme.Profile.cardMargin)

            // Progressive disclosure: tasks, coding, email, notifications stay.
            BotTaskListCard(bot: current, openThread: { openThread($0) }, insets: true)

            if gate.allows(.botActivity), activity.showsAnySection {
                BotActivityCard(
                    bot: current,
                    model: activity,
                    onOpen: { activityRoute = .detail($0) },
                    onHistory: { activityRoute = .history($0) }
                )
                .padding(.horizontal, Theme.Profile.cardMargin)
            }

            if let mailRow {
                AnyView(emailCard(mailRow))
            }
            AnyView(notificationsCard)
        }
        .padding(.top, 8)
    }

    private var libraryBody: some View {
        PhoneBotLibrary(
            bot: current,
            start: libraryStart,
            onShowInChat: { file in showInChat(file) },
            onShowLink: { link in showInChat(link) }
        )
        .padding(.top, 8)
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

    private func openProfile(tab: BotProfileTab) {
        Haptics.selection()
        path.append(PanelProfileRoute(tab: tab))
    }

    private func openPersona() {
        openProfile(tab: .settings)
    }

    private func profilePage(_ tab: BotProfileTab) -> some View {
        BotProfilePage(
            bot: current,
            startTab: tab,
            context: editContext,
            actions: editActions,
            slackURL: slackURL,
            mailRow: mailRow
        )
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
                // Empty Coding page when nothing runs (Lot 4).
                if activity.list != nil, !activity.showsAnySection {
                    ProfileCard {
                        Text("No coding work in progress")
                            .font(Theme.Profile.labelFont)
                            .foregroundStyle(Theme.textTertiary)
                            .frame(maxWidth: .infinity, minHeight: Theme.Profile.row, alignment: .leading)
                            .padding(.horizontal, Theme.Profile.textInset)
                    }
                    .accessibilityIdentifier("panel-coding-empty")
                    .padding(.top, Theme.Profile.cardGap)
                }
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

    /// One routine of the card (Lot 5): opens its detail; Active toggle on
    /// the row; swipe left deletes (with confirmation). The schedule is
    /// never shown as cron (2026-10-29).
    @ViewBuilder
    private func routineCardRow(_ routine: Routine) -> some View {
        let canToggle = routine.mayEdit && routine.canToggle()
        HStack(spacing: 0) {
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
                ) { EmptyView() }
            }
            .buttonStyle(.plain)
            Toggle("", isOn: Binding(
                get: { routine.enabled },
                set: { value in
                    Task { _ = await session.setRoutineEnabled(routine, enabled: value); await loadRoutines() }
                }
            ))
            .labelsHidden()
            .toggleStyle(ParityToggleStyle(width: Theme.Profile.toggle.width, height: Theme.Profile.toggle.height))
            .padding(.trailing, Theme.Profile.textInset)
            .disabled(!canToggle)
            .accessibilityLabel(Text("Active: \(routine.name)"))
            .accessibilityIdentifier("profile-routine-active.\(routine.name)")
        }
        .contentShape(Rectangle())
        .routineDeleteSwipe(enabled: gate.allows(.routineDelete), label: routine.name) {
            deletingRoutine = routine
        }
        .contextMenu {
            // 2026-10-29: the desktop's row menu, then the folder choice.
            let live = routineRuns.first { $0.routineId == routine.id && ($0.status == "running" || $0.status == "waiting" || $0.status == "queued") }
            RoutineActionsMenu(
                routine: routine,
                runNow: routine.mayRun ? { Task { _ = await session.runRoutine(routine); await loadRoutines() } } : nil,
                stop: live != nil && routine.mayEdit ? { if let live { Task { _ = await session.cancelRoutineRun(live); await loadRoutines() } } } : nil,
                toggle: canToggle ? { Task { _ = await session.setRoutineEnabled(routine, enabled: !routine.enabled); await loadRoutines() } } : nil,
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

    /// Profile open on a section's page, through the tree's pages (Back
    /// walks back the way a tap would have come).
    private func openEditor(at section: DesktopPanelSection) {
        path.append(PanelProfileRoute(tab: .settings))
        for page in BotEditTree.path(to: section, editContext) ?? [] { path.append(page) }
        if section == .voice { return }
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
        case .profileLinks: libraryStart = .links; panelTab = .library
        case .profileMedia: libraryStart = .files(.image); panelTab = .library
        case .profileFiles: panelTab = .library
        case .profileComputer: path.append(PanelComputerRoute())
        case .profileInfoScrolled:
            try? await Task.sleep(nanoseconds: 600_000_000)
            path.append(PanelOverviewPage.routines)
        case .profileMoreMenu:
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            menuOpen = true
        case .profileInfo:
            // `-parityBotEditRoute root` (or a section) opens the profile page
            guard let route = UserDefaults.standard.string(forKey: "parityBotEditRoute") else { break }
            try? await Task.sleep(nanoseconds: 800_000_000)
            path.append(PanelProfileRoute(tab: .settings))
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

/// The bot profile page (gear), opened on a tab.
private struct PanelProfileRoute: Hashable {
    var tab: BotProfileTab = .general
}

/// Legacy persona route; redirected to the profile Settings tab.
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

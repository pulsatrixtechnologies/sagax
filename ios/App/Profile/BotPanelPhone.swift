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
//   Edit bot under "..." and as the "Edit" pill. The editor starts with
//            the avatar, Name, Title, Description, Appearance and Voice calls, then lists
//            its groups (`PhoneBotEditGroup`, the desktop's order); a row opens its page.
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
    @State private var renaming = false
    @State private var renameDraft = ""
    @State private var exportingZip = false
    @State private var pickingPrimary = false
    @State private var primaryWorking = false
    @State private var sharedFile: IdentifiedURL?
    @StateObject private var owlHandle = OwlMascotHandle()
    @State private var draft: CharacterDraft
    @State private var libraryStart: BotLibraryChip = .files(.all)

    // Details
    @StateObject private var activity: BotActivityModel
    @State private var activityRoute: BotActivityRoute?
    @State private var routines: [Routine] = []
    @State private var routinesLoaded = false
    @State private var addingRoutine = false
    @State private var runLogs = false
    @State private var deletingRoutine: Routine?

    init(bot: Bot, startTab: DesktopPanelTab, startSection: DesktopPanelSection? = nil) {
        self.bot = bot
        // a deep link lands on the section with Edit persona under it (Back
        // returns to the persona list, as a tap through it would)
        var start = NavigationPath()
        if let startSection {
            start.append(PanelPersonaRoute())
            start.append(startSection)
        } else {
            // a door that names Library or Computer opens that page over
            // the overview, so Back lands on the overview list
            switch startTab {
            case .library: start.append(PanelOverviewPage.library)
            case .computer: start.append(PanelComputerRoute())
            case .details: break
            }
        }
        _path = State(initialValue: start)
        _draft = State(initialValue: CharacterDraft(bot: bot))
        _activity = StateObject(wrappedValue: BotActivityModel(botId: bot.id))
    }

    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var gate: SurfaceGate { session.surfaceGate }
    private var tabs: [DesktopPanelTab] { DesktopPanelTab.visible(gate: gate, slack: slackURL != nil) }
    private var sections: [DesktopPanelSection] { DesktopPanelSection.visible(gate: gate, slack: slackURL != nil) }
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
        .sheet(isPresented: $runLogs) { AutomationsSheet() }
        .sheet(isPresented: $pickingPrimary) {
            PrimaryBotPicker(currentId: current.id, viewerId: viewerId) { show($0) }
        }
        .sheet(item: $sharedFile) { file in ProfileShareSheet(items: [file.url]) }
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
                    BotPanelNoticesView(bot: current)
                        .padding(.top, 20)
                    AnyView(overviewCard)
                        .padding(.top, 8)
                    if let mailRow {
                        AnyView(emailCard(mailRow))
                            .padding(.top, Theme.Profile.cardGap + 12)
                    }
                    AnyView(notificationsCard)
                        .padding(.top, Theme.Profile.cardGap + 12)
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
            activeBotCount: session.state.bots.filter { $0.hidden != true }.count
        )
        var out: [GlassMenuItem] = []
        for (groupIndex, group) in plan.groups.enumerated() {
            for (index, item) in group.enumerated() {
                let divider = groupIndex > 0 && index == 0
                let heading: Text? = item == .copyConversation ? Text("Export conversation") : nil
                out.append(menuItem(item, plan: plan, divider: divider, heading: heading))
            }
        }
        // Copy ID (Grok Bot's profile menu), after the identity group
        let copyId = GlassMenuItem(id: "copy-id", title: Text("Copy ID"), systemImage: "doc.on.clipboard") {
            UIPasteboard.general.string = current.id
            Haptics.selection()
            show(String(localized: "Copied"))
        }
        out.insert(copyId, at: out.firstIndex(where: \.dividerBefore) ?? out.endIndex)
        return out
    }

    private func menuItem(_ item: BotActionsMenuItem, plan: BotActionsMenuPlan, divider: Bool, heading: Text?) -> GlassMenuItem {
        switch item {
        case .editBot:
            return GlassMenuItem(id: "edit-bot", title: Text("Edit bot"), systemImage: "person.crop.circle.badge.pencil", dividerBefore: divider, heading: heading) { openPersona() }
        case .rename:
            return GlassMenuItem(id: "rename", title: Text("Rename the bot"), systemImage: "pencil", dividerBefore: divider, heading: heading) {
                renameDraft = current.name
                renaming = true
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
        rows.append(OverviewRow(id: "panel-overview.routines", symbol: "clock", title: Text("Routines"),
                                value: routinesLoaded ? String(localized: "\(routinesOn) on") : nil, page: .page(.routines)))
        if tabs.contains(.library) {
            rows.append(OverviewRow(id: "panel-tab.library", symbol: "folder", title: Text("Library"), value: nil, page: .page(.library)))
        }
        if tabs.contains(.computer) {
            rows.append(OverviewRow(id: "panel-tab.computer", symbol: "desktopcomputer", title: Text("Computer"), value: computerStatus, page: .computer))
        }
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
            ForEach(botRoutines) { routine in
                Button {
                    Haptics.selection()
                    path.append(PanelRoutineRoute(id: routine.id, instruction: false))
                } label: {
                    ProfileRow(
                        icon: ProfileRowIcon(systemImage: "clock", size: 17,
                                             color: routine.enabled ? Theme.routineActive : Theme.routinePaused),
                        title: Text(verbatim: routine.name),
                        subtitle: Text(verbatim: RoutineWording.subtitle(routine)),
                        height: Theme.Profile.routineRow
                    ) { ProfileChevronTrailing() }
                }
                .buttonStyle(.plain)
                .contextMenu {
                    if let expression = routine.schedule.expression, routine.schedule.type == .cron {
                        Button(String(localized: "Copy cron expression"), systemImage: "doc.on.doc") { PlatformBridge.copyToPasteboard(expression) }
                    }
                    if gate.allows(.routineDelete) {
                        Button(String(localized: "Delete routine"), systemImage: "trash", role: .destructive) { deletingRoutine = routine }
                    }
                }
                .accessibilityIdentifier("profile-routine.\(routine.name)")
                ProfileDivider()
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

    // MARK: Persona editor

    private var personaPage: some View {
        ScrollView {
            VStack(spacing: 0) {
                // the reference design's Edit bot: avatar, Name, Title,
                // Appearance and Voice calls, then every other setting
                AnyView(PhoneBotEditHeader(bot: current) { editingAvatar = true })
                    .padding(.bottom, Theme.Profile.cardGap + 8)
                AnyView(personaList)
            }
            .padding(.top, 16)
            .padding(.bottom, 48)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.bg.ignoresSafeArea())
        .navigationTitle(Text("Edit bot"))
        .navigationBarTitleDisplayMode(.inline)
        // one way out, as Grok Bot's editor: Done (everything is saved as
        // it is left, so there is no Cancel)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") {
                    if !path.isEmpty { path.removeLast() }
                }
                .fontWeight(.semibold)
                .accessibilityIdentifier("panel-persona-done")
            }
        }
        .accessibilityIdentifier("panel-persona")
    }

    private var personaList: some View {
        // Grok Bot's phone editor: the identity block above, then the
        // desktop editor's groups in order, no search and no Profile list
        VStack(spacing: 12) {
            ForEach(PhoneBotEditGroup.visible(sections), id: \.self) { group in
                VStack(spacing: 0) {
                    ProfileSectionLabel(text: group.title)
                    ProfileCard {
                        ForEach(Array(group.sections(in: sections).enumerated()), id: \.element) { index, section in
                            if index > 0 { ProfileDivider() }
                            NavigationLink(value: section) {
                                ProfileRow(icon: ProfileRowIcon(systemImage: section.symbol, size: 16), title: Text(section.title),
                                           height: Theme.Profile.singleRow) { ProfileChevronTrailing() }
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("panel-row.\(section.rawValue)")
                        }
                    }
                }
                .padding(.top, 8)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("panel-group.\(group.rawValue)")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-persona-list")
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

    private func loadRoutines() async {
        routines = await session.loadRoutines().routines
        routinesLoaded = true
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

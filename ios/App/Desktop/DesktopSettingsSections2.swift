// iPad I5: Settings pages every pairing may list (Organization, Appearance,
// Pair devices) and the admin's Model providers and Local VM, laid out as the
// desktop draws them (SettingsModal.tsx, OrganizationSettings.tsx,
// EngineLibrary.tsx, ServerPairingCard.tsx, LocalComputerSection.tsx).
//
// What only the desktop window can do stays there: joining an organization
// from the desktop app, "Use Sagax from another device", control of the Mac,
// and installing a model provider's CLI. Sign-in and access keys happen on
// the phone; the computer finishes them.
import SwiftUI
import UIKit
import CoreImage.CIFilterBuiltins
import CompanionCore

// MARK: - Organization

/// The pairing's computer: what the desktop remote client's Organization
/// page shows (its connection to the host), plus the person's organization
/// on an organization server.
struct DesktopOrganizationSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var showingOrganization = false
    @State private var showingMyComputer = false
    @State private var pendingRemoval: Connection?

    var body: some View {
        if let active = session.connection {
            AnyView(computerCard(active))
        } else {
            DesktopText("Not connected", color: \.inkSecondary)
        }
        if session.surfaceGate.allows(.organizationSettings) {
            organizationRow
        }
        // #1098: the person's own server environment, updated or reset by
        // them (the desktop's Organization > Your server environment)
        if session.surfaceGate.allows(.myComputer) {
            myComputerRow
        }
        // This iPad's own pairing (#518): Pair devices left the app, the
        // device's own connection stays here
        AnyView(DesktopThisDeviceCard(open: false))
    }

    private var myComputerRow: some View {
        Button { showingMyComputer = true } label: {
            DesktopCollapsedRow(title: Text("Your computer"), summary: Text("Update or reset your bots' computer"))
        }
        .buttonStyle(DesktopHoverFill(radius: 14))
        .desktopHairlineBox()
        .accessibilityIdentifier("desktop-settings.my-computer")
        .sheet(isPresented: $showingMyComputer) {
            NavigationStack { BotComputerSettingsView() }
                .environmentObject(session)
        }
    }

    private var organizationRow: some View {
        Button { showingOrganization = true } label: {
            DesktopCollapsedRow(title: Text("Your organization"), summary: Text("Who can see and use your bots"))
        }
        .buttonStyle(DesktopHoverFill(radius: 14))
        .desktopHairlineBox()
        .accessibilityIdentifier("desktop-settings.organization")
        .sheet(isPresented: $showingOrganization) {
            NavigationStack { OrganizationSettingsPage() }
                .environmentObject(session)
        }
    }

    private func computerCard(_ active: Connection) -> some View {
            DesktopSettingsCard(Text("This computer"), summary: Text(verbatim: active.name), identifier: "organization.computer") {
                HStack(spacing: 12) {
                    Circle().fill(session.status == .live ? theme.success : theme.warning).frame(width: 8, height: 8)
                    VStack(alignment: .leading, spacing: 2) {
                        DesktopText(verbatim: active.name, weight: .medium, line: 19.5)
                        DesktopText(session.status.desktopText, size: 12.5, line: 18, color: \.inkSecondary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.bottom, 8)
                ForEach(session.connections.filter { $0.id != active.id }) { computer in
                    HStack(spacing: 12) {
                        DesktopText(verbatim: computer.name, line: 19.5)
                        Spacer(minLength: 0)
                        Button("Use") { session.switchComputer(to: computer.id) }
                            .buttonStyle(DesktopButtonStyle(kind: .control))
                            .accessibilityIdentifier("desktop-settings.use-computer")
                        Button("Remove") { pendingRemoval = computer }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost))
                    }
                    .padding(.vertical, 6)
                    .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                }
                Button("Connect another computer") { session.beginPairing() }
                    .buttonStyle(DesktopButtonStyle(kind: .outline))
                    .padding(.top, 8)
                    .accessibilityIdentifier("desktop-settings.connect-computer")
                DesktopText("Each computer is paired separately. Only the selected computer is active at a time.",
                            size: 12, line: 17, color: \.inkSecondary)
                    .padding(.top, 8)
            }
            .confirmationDialog(
                Text("Remove \(pendingRemoval?.name ?? "")?"),
                isPresented: Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }),
                titleVisibility: .visible
            ) {
                Button("Remove from this device", role: .destructive) {
                    if let pendingRemoval { session.forgetConnection(id: pendingRemoval.id) }
                    pendingRemoval = nil
                }
                Button("Cancel", role: .cancel) { pendingRemoval = nil }
            } message: {
                Text("This removes the saved connection from this device only.")
            }

    }
}

// MARK: - Appearance

struct DesktopAppearanceSettings: View {
    @Environment(\.themePalette) private var themePalette
    @EnvironmentObject private var session: Session
    @ObservedObject private var themes = ThemeStore.shared
    @AppStorage(PrefKey.desktopSidebarDensity) private var density = DesktopSidebarDensity.comfortable.rawValue
    @AppStorage(SidebarLogoPreference.key) private var showSidebarLogo = SidebarLogoPreference.defaultEnabled
    @AppStorage(RunCardPreference.key) private var showRunCard = true
    @AppStorage(NotificationSounds.key) private var sounds = true
    @AppStorage(DesktopInspectorButton.key) private var showInspector = false
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @ObservedObject private var toolCalls = ToolCallsSetting.shared

    var body: some View {
        DesktopSettingsCard(
            Text("Skin"),
            summary: Text(verbatim: SkinPlace.of(themePalette.id, tint: themePalette.tint).family.name),
            subtitle: Text("Applies instantly and is remembered on this machine."),
            identifier: "appearance.skin"
        ) {
            // the families and their variants, as the iPhone's picker (#1126) and the desktop's SkinPicker
            DesktopSkinFamilies()
        }
        DesktopSettingsGroup {
            let font = themes.effective.mode == .computer ? (themes.effective.computerFont ?? .skin) : themes.effective.font
            DesktopSettingRow(title: Text("Interface font"), subtitle: Text("Overrides the skin's font on this device.")) {
                DesktopSelect(
                    options: [(SkinFontChoice.skin, AppStrings.localized("Skin default")),
                              (.system, AppStrings.localized("System")), (.serif, AppStrings.localized("Serif"))],
                    selection: font == .inter || font == .poppins ? .system : font,
                    label: Text("Interface font"),
                    identifier: "desktop-settings.font"
                ) { themes.chooseFont($0, client: session.settingsClient) }
            }
            DesktopSettingRow(
                title: Text("Sidebar density"),
                subtitle: Text("How much room each bot and thread takes in the sidebar, on this device only.")
            ) {
                DesktopSelect(
                    options: [(DesktopSidebarDensity.comfortable.rawValue, AppStrings.localized("Comfortable")),
                              (DesktopSidebarDensity.compact.rawValue, AppStrings.localized("Compact")),
                              (DesktopSidebarDensity.icons.rawValue, AppStrings.localized("Avatars only"))],
                    selection: density,
                    label: Text("Sidebar density"),
                    identifier: "desktop-settings.density"
                ) { density = $0 }
            }
            if SidebarLogoRuntime.showsSetting {
                DesktopSettingRow(
                    title: Text("Sidebar logo"),
                    subtitle: Text("Show the Sagax logo and name at the top of the sidebar.")
                ) {
                    DesktopSwitch(
                        isOn: showSidebarLogo,
                        label: Text("Show the sidebar logo"),
                        identifier: "desktop-settings.sidebar-logo"
                    ) {
                        showSidebarLogo.toggle()
                    }
                }
            }
            // a display preference: an organization member opens the
            // Inspector on the bots they own (2026-10-26)
            if session.surfaceGate.allows(.inspector) || session.surfaceGate.isOrgMemberSession {
                DesktopSettingRow(
                    title: Text("Inspector button"),
                    subtitle: Text("Show the Inspector (run log, events, raw) button in the chat header.")
                ) {
                    DesktopSwitch(isOn: showInspector, label: Text("Show the Inspector button"), identifier: "desktop-settings.inspector-button") {
                        showInspector.toggle()
                    }
                }
            }
            DesktopSettingRow(title: Text("Notification sounds"), subtitle: Text("Play a sound when an agent finishes or needs you.")) {
                DesktopSwitch(isOn: sounds, label: Text("Notification sounds"), identifier: "desktop-settings.sounds") {
                    let next = !sounds
                    sounds = next
                    Task { await NotificationSounds.set(next, session: session) }
                }
            }
            DesktopSettingRow(
                title: Text("This run"),
                subtitle: Text("Show a list of the shell commands a bot ran for your current request.")
            ) {
                DesktopSwitch(isOn: showRunCard, label: Text("This run"), identifier: "desktop-settings.run-card") {
                    showRunCard.toggle()
                }
            }
            DesktopSettingRow(
                title: Text("Tool calls"),
                subtitle: Text("Show tool calls in chat. Off: the chat shows the messages, a turn's steps fold away. The same switch as on your computer.")
            ) {
                DesktopSwitch(isOn: toolCalls.showToolCalls, label: Text("Show tool calls in chat"), identifier: "desktop-settings.tool-calls", disabled: toolCalls.saving) {
                    let next = !toolCalls.showToolCalls
                    Task { await toolCalls.set(session, next) }
                }
            }
            DesktopSettingRow(title: Text("Use bot color as accent"), subtitle: Text("The accent follows the open bot's color.")) {
                DesktopSwitch(isOn: prefs.botAccent, label: Text("Use bot color as accent"), identifier: "desktop-settings.bot-accent") {
                    prefs.setBotAccent(session, !prefs.botAccent)
                }
            }
            DesktopSettingRow(title: Text("Color 1:1 messages with the bot color"), subtitle: Text("Assistant bubbles and cards in a one-to-one chat use the bot's color. Off leaves them in the skin's color.")) {
                DesktopSwitch(isOn: prefs.botBubble, label: Text("Color 1:1 messages with the bot color"), identifier: "desktop-settings.bot-bubble") {
                    prefs.setBotBubble(session, !prefs.botBubble)
                }
            }
            DesktopSettingRow(title: Text("Show replies as they are written"), subtitle: Text("Show a bot reply word by word while it is written, instead of all at once when it is finished")) {
                DesktopSwitch(isOn: prefs.streamReplies, label: Text("Show replies as they are written"), identifier: "desktop-settings.stream-replies") {
                    prefs.setStreamReplies(session, !prefs.streamReplies)
                }
            }
            DesktopSettingRow(title: Text("Show suggestions"), subtitle: Text("Show the Suggestions card in the bot panel")) {
                DesktopSwitch(isOn: prefs.showSuggestions, label: Text("Show suggestions"), identifier: "desktop-settings.show-suggestions") {
                    prefs.setShowSuggestions(session, !prefs.showSuggestions)
                }
            }
            DesktopSettingRow(
                title: Text("HD mascots"),
                subtitle: Text("Detailed art for the characters that have it. Colors and skins apply to the classic look.")
            ) {
                DesktopSwitch(isOn: prefs.hdMascots, label: Text("HD mascots"), identifier: "desktop-settings.hd-mascots") {
                    prefs.setHdMascots(session, !prefs.hdMascots)
                }
            }
            DesktopSettingRow(title: Text("Notification sound"), subtitle: Text("Play a sound when an agent finishes or needs you.")) {
                DesktopSelect(
                    options: NotificationSoundChoice.allCases.map { ($0, AppStrings.localized($0.label)) },
                    selection: prefs.notificationSound,
                    label: Text("Notification sound"),
                    identifier: "desktop-settings.notification-sound"
                ) { choice in
                    prefs.setNotificationSound(session, choice)
                    NotificationSounds.preview(choice)
                }
            }
            if prefs.synced {
                DesktopSettingRow(title: Text("Send read receipts"), subtitle: Text("Off: you do not see other people's either.")) {
                    DesktopSwitch(isOn: prefs.readReceipts, label: Text("Send read receipts"), identifier: "desktop-settings.read-receipts") {
                        prefs.setReadReceipts(session, !prefs.readReceipts)
                    }
                }
            }
        }
        .task(id: session.connection?.id) {
            await toolCalls.load(session)
            await prefs.readComputerHdMascots(session)
        }
    }
}

/// The skin picker (`SkinPicker`): `grid-cols-[repeat(auto-fill,
/// minmax(190px,1fr))] gap-3`, each row as tall as its tallest card.
struct DesktopSkinGrid: View {
    @Environment(\.desktopTheme) private var theme
    let skins: [SkinID]
    let selected: SkinID
    let choose: (SkinID) -> Void
    @State private var width: CGFloat = 606

    var body: some View {
        let columns = max(1, Int((width + 12) / (190 + 12)))
        let rows = stride(from: 0, to: skins.count, by: columns).map { Array(skins[$0..<min($0 + columns, skins.count)]) }
        VStack(alignment: .leading, spacing: 12) {
            ForEach(rows, id: \.first) { row in
                HStack(alignment: .top, spacing: 12) {
                    ForEach(row) { skin in
                        Button { choose(skin) } label: {
                            DesktopSkinCard(skin: skin, selected: skin == selected)
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Text(verbatim: skin.name))
                        .accessibilityAddTraits(skin == selected ? .isSelected : [])
                        .accessibilityIdentifier("desktop-settings.skin.\(skin.rawValue)")
                    }
                    ForEach(0..<(columns - row.count), id: \.self) { _ in
                        Color.clear.frame(maxWidth: .infinity, maxHeight: 1)
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(GeometryReader { geometry in
            Color.clear
                .onAppear { width = geometry.size.width }
                .onValueChange(of: geometry.size.width) { width = $0 }
        })
    }
}

/// One skin (`rounded-xl border p-2.5 gap-2.5`): the 104 pt miniature drawn
/// in the skin's own tokens, the name (13 medium) and tagline (12).
struct DesktopSkinCard: View {
    @Environment(\.desktopTheme) private var theme
    let skin: SkinID
    let selected: Bool
    /// The variant's tokens the miniature is drawn in (a family card); nil: the skin's own.
    var drawn: DesktopTheme? = nil
    /// A family's name and tagline; nil: the skin's.
    var name: String? = nil
    var tagline: String? = nil

    init(skin: SkinID, selected: Bool, theme drawn: DesktopTheme? = nil, name: String? = nil, tagline: String? = nil) {
        self.skin = skin
        self.selected = selected
        self.drawn = drawn
        self.name = name
        self.tagline = tagline
    }

    var body: some View {
        let t = drawn ?? DesktopTheme.of(skin)
        VStack(alignment: .leading, spacing: 10) {
            miniature(t)
                .frame(height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(t.hairline, lineWidth: 1))
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    DesktopText(verbatim: name ?? skin.name, weight: .medium, line: 19.5)
                    Spacer(minLength: 0)
                    if selected {
                        DesktopSettingsIconView(icon: .check, size: 14)
                            .foregroundStyle(theme.ink)
                    }
                }
                DesktopText(Text(LocalizedStringKey(tagline ?? skin.tagline)), size: 12, line: 16.5, color: \.inkSecondary)
                    .padding(.trailing, selected ? 0 : 0)
            }
            .padding(.horizontal, 2)
        }
        .padding(11)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(selected ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(selected ? theme.accentBorder : theme.hairline.opacity(0.4), lineWidth: 1)
        )
        .contentShape(Rectangle())
    }

    /// The renderer's miniature (`SkinPreview`): a rail, a sidebar with a
    /// selected row and three lines, a user bubble, a bot bubble and the
    /// composer with its send dot.
    private func miniature(_ t: DesktopTheme) -> some View {
        HStack(spacing: 0) {
            VStack(spacing: 3) {
                Circle().fill(t.accent).frame(width: 5, height: 5)
                Circle().fill(t.inkSecondary.opacity(0.4)).frame(width: 5, height: 5)
                Circle().fill(t.inkSecondary.opacity(0.4)).frame(width: 5, height: 5)
                Spacer(minLength: 0)
            }
            .padding(.top, 5)
            .frame(width: 11)
            .background(t.panel)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 2) {
                    Circle().fill(t.accent).frame(width: 4, height: 4)
                    Capsule().fill(t.ink.opacity(0.5)).frame(height: 2)
                }
                .padding(.horizontal, 2)
                .frame(height: 9)
                .background(t.raised, in: RoundedRectangle(cornerRadius: 2))
                Capsule().fill(t.inkSecondary.opacity(0.3)).frame(width: 16.8, height: 3)
                Capsule().fill(t.inkSecondary.opacity(0.3)).frame(width: 13, height: 3)
                Capsule().fill(t.inkSecondary.opacity(0.3)).frame(width: 15.5, height: 3)
                Spacer(minLength: 0)
            }
            .padding(4)
            .frame(width: 30)
            .background(t.panel)
            .overlay(alignment: .trailing) { Rectangle().fill(t.hairline).frame(width: 1) }
            GeometryReader { geometry in
                let w = geometry.size.width - 12
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Spacer(minLength: 0)
                        RoundedRectangle(cornerRadius: 6).fill(t.bubbleUser).frame(width: w * 0.62, height: 13)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Capsule().fill(t.ink.opacity(0.45)).frame(height: 2)
                        Capsule().fill(t.ink.opacity(0.45)).frame(width: w * 0.88 * 0.85 - 8, height: 2)
                        Capsule().fill(t.inkSecondary.opacity(0.4)).frame(width: w * 0.88 * 0.6 - 8, height: 2)
                    }
                    .padding(4)
                    .frame(width: w * 0.88, alignment: .leading)
                    .background(t.card, in: RoundedRectangle(cornerRadius: 6))
                    Spacer(minLength: 0)
                    HStack(spacing: 4) {
                        Capsule().fill(t.inset).frame(height: 11)
                            .overlay(Capsule().strokeBorder(t.hairline, lineWidth: 1))
                        Circle().fill(t.accent).frame(width: 11, height: 11)
                            .overlay(Capsule().fill(t.accentInk).frame(width: 5, height: 1.5))
                    }
                }
                .padding(6)
            }
            .background(t.app)
        }
    }
}

// MARK: - Pair devices

struct DesktopPairDevicesSettings: View {
    @EnvironmentObject private var session: Session

    var body: some View {
        DesktopText("For your own devices only. To add another person, invite them from Organization.", line: 19.5, color: \.inkSecondary)
        if session.surfaceGate.scope == .serverAdmin {
            AnyView(DesktopServerPairingCard())
        }
        AnyView(DesktopThisDeviceCard(open: session.surfaceGate.scope != .serverAdmin))
    }
}

/// `ServerPairingCard`: a one-time code with its QR for a phone or another
/// computer, and the devices that hold a session (sign one out).
struct DesktopServerPairingCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var fullAccess = true
    @State private var offer: ServerPairingOffer?
    @State private var devices: ServerSessionList?
    @State private var busy = false
    @State private var error: String?
    @State private var now = Date()

    var body: some View {
        DesktopSettingsCard(
            Text("Pair a phone or another computer"),
            summary: Text("\(devices?.sessions.count ?? 0) devices"),
            subtitle: Text("Create a one-time code, then scan it with the Sagax app or open the link in a browser. Codes work once and expire after five minutes."),
            identifier: "companion.pairing"
        ) {
            HStack(spacing: 16) {
                radio(Text("Full access"), on: fullAccess) { fullAccess = true }
                radio(Text("Chat and approvals only"), on: !fullAccess) { fullAccess = false }
                Button(busy ? "Creating…" : "Create pairing code", action: create)
                    .buttonStyle(DesktopButtonStyle(kind: .accent, weight: .medium, height: 33.5))
                    .disabled(busy)
                    .accessibilityIdentifier("desktop-settings.create-pairing")
                Spacer(minLength: 0)
            }
            .padding(.top, 2)
            if let offer {
                offerBox(offer)
                    .padding(.top, 16)
            }
            DesktopText("Paired devices", weight: .medium, line: 19.5)
                .padding(.top, 20)
            if let list = devices {
                if list.sessions.isEmpty {
                    DesktopText("No devices paired yet.", size: 12.5, color: \.inkSecondary).padding(.top, 4)
                }
                ForEach(list.sessions) { device in
                    deviceRow(device, current: device.id == list.current)
                }
            }
            if let error {
                DesktopText(verbatim: error, size: 13, color: \.danger).padding(.top, 12)
            }
        }
        .task { await load() }
        .task(id: offer?.id) {
            while offer != nil, !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                now = Date()
            }
        }
    }

    private func radio(_ label: Text, on: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                ZStack {
                    Circle().strokeBorder(on ? theme.accent : theme.inkSecondary, lineWidth: on ? 4 : 1)
                        .background(Circle().fill(on ? theme.ink : .clear).padding(3))
                }
                .frame(width: 13, height: 13)
                DesktopText(label, line: 19.5)
            }
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? [.isSelected] : [])
    }

    private func offerBox(_ offer: ServerPairingOffer) -> some View {
        HStack(alignment: .top, spacing: 20) {
            if offer.expired(now: now) {
                DesktopText("That code expired. Create a new one.", color: \.inkSecondary)
            } else {
                if let url = offer.url, let qr = Self.qr(url) {
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 160, height: 160)
                        .padding(8)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: 6))
                        .accessibilityLabel(Text("Pairing QR code"))
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(verbatim: offer.code)
                        .font(Theme.mono(18))
                        .tracking(2.5)
                        .foregroundStyle(theme.ink)
                        .textSelection(.enabled)
                        .accessibilityIdentifier("desktop-settings.pairing-code")
                    DesktopText(Text("Expires in \(offer.minutesLeft(now: now)) min"), size: 12.5, color: \.inkSecondary)
                    if let url = offer.url {
                        HStack(spacing: 8) {
                            Text(verbatim: url).font(Theme.mono(12)).foregroundStyle(theme.inkSecondary)
                                .lineLimit(2)
                            Button("Copy link") { UIPasteboard.general.string = url }
                                .buttonStyle(DesktopButtonStyle(kind: .outline, height: 30))
                        }
                        .padding(.top, 8)
                    } else {
                        DesktopText(Text(verbatim: offer.hint ?? AppStrings.localized("This server has no public address for a link yet: open /pair on the address you use and type the code.")),
                                    size: 12.5, color: \.inkSecondary)
                            .padding(.top, 8)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .padding(1)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }

    private func deviceRow(_ device: ServerSessionDevice, current: Bool) -> some View {
        HStack(spacing: 8) {
            (Text(verbatim: device.label).foregroundColor(theme.ink)
                + Text(verbatim: " · ").foregroundColor(theme.inkSecondary)
                + (device.fullAccess ? Text("Full access") : Text("Chat and approvals only")).foregroundColor(theme.inkSecondary)
                + Text(verbatim: " · ").foregroundColor(theme.inkSecondary)
                + Self.seen(LastSeen(lastSeenAt: device.lastSeenAt, now: now)).foregroundColor(theme.inkSecondary)
                + (current ? Text(" · this iPad").foregroundColor(theme.inkSecondary) : Text(verbatim: "")))
                .font(theme.font(13))
                .desktopLine(13, 19.5, theme)
            Spacer(minLength: 0)
            if !current {
                Button("Sign out") { Task { await signOut(device.id) } }
                    .buttonStyle(DesktopButtonStyle(kind: .outline, height: 33.5))
                    .accessibilityIdentifier("desktop-settings.sign-out-device")
            }
        }
        .frame(minHeight: 33.5)
        .padding(.vertical, 8)
    }

    static func seen(_ when: LastSeen) -> Text {
        switch when {
        case .justNow: Text("seen just now")
        case let .minutes(n): Text("seen \(n) min ago")
        case let .hours(n): Text("seen \(n) h ago")
        case let .days(n): Text("seen \(n) d ago")
        }
    }

    static func qr(_ value: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(value.utf8)
        filter.correctionLevel = "M"
        guard let image = filter.outputImage,
              let cg = CIContext().createCGImage(image, from: image.extent) else { return nil }
        return UIImage(cgImage: cg)
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do { devices = try await client.pairedDevices() } catch { self.error = error.localizedDescription }
    }

    private func create() {
        guard let client = session.settingsClient, !busy else { return }
        busy = true
        error = nil
        Task {
            defer { busy = false }
            do {
                offer = try await client.createPairingCode(fullAccess: fullAccess)
                now = Date()
            } catch {
                self.error = error.localizedDescription
            }
        }
    }

    private func signOut(_ id: String) async {
        guard let client = session.settingsClient else { return }
        do {
            try await client.signOutDevice(id: id)
            await load()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// This iPad's own pairing: the computer it reaches, forget it or pair again.
struct DesktopThisDeviceCard: View {
    @EnvironmentObject private var session: Session
    var open: Bool
    @State private var confirming = false

    var body: some View {
        DesktopSettingsCard(
            Text("This iPad"),
            summary: Text(verbatim: session.connection?.name ?? AppStrings.localized("Not paired")),
            subtitle: Text("This iPad's own pairing with the computer. Forgetting it removes the saved connection from this iPad only."),
            open: open, identifier: "companion.this-device"
        ) {
            HStack(spacing: 8) {
                Button("Pair again") { session.beginPairing() }
                    .buttonStyle(DesktopButtonStyle(kind: .control))
                    .accessibilityIdentifier("desktop-settings.pair-again")
                if session.connection != nil {
                    Button("Forget this computer") { confirming = true }
                        .buttonStyle(DesktopButtonStyle(kind: .ghost))
                        .accessibilityIdentifier("desktop-settings.forget")
                }
                Spacer(minLength: 0)
            }
        }
        .confirmationDialog(Text("Forget this computer?"), isPresented: $confirming, titleVisibility: .visible) {
            Button("Forget", role: .destructive) {
                if let id = session.connection?.id { session.forgetConnection(id: id) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This removes the saved connection from this device only.")
        }
    }
}

// MARK: - Model providers

struct DesktopEnginesSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @State private var engines: [DesktopEngine]?
    @State private var checking = false
    @State private var open: String?
    @State private var error: String?

    @State private var toConnectOpen = false
    /// The desktop's Show filter (`providers.filter.*`): All, Mine, This computer.
    @State private var filter = "all"

    /// Settings > Providers (ProvidersSettings.tsx, 2026-10-30): "Providers"
    /// over one card, the connected providers as rows (their mark, the name,
    /// how it is reached, "Connected"), then "To connect" with its count,
    /// folded; a row opens the provider's card with its setup.
    var body: some View {
        HStack(spacing: 8) {
            DesktopSettingsHeading(Text("Providers"))
            Spacer(minLength: 0)
            HStack(spacing: 4) {
                ForEach([("all", String(localized: "All")), ("mine", String(localized: "Mine")), ("computer", String(localized: "This computer"))], id: \.0) { option in
                    Button { filter = option.0 } label: {
                        DesktopText(Text(verbatim: option.1), size: 12, line: 16, color: filter == option.0 ? \.ink : \.inkSecondary)
                            .padding(.horizontal, 8)
                            .frame(minHeight: 30)
                            .background(filter == option.0 ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(filter == option.0 ? .isSelected : [])
                    .accessibilityIdentifier("desktop-settings.providers.filter.\(option.0)")
                }
            }
            Button { Task { await load() } } label: {
                HStack(spacing: 6) {
                    DesktopSettingsIconView(icon: .refreshCw, size: 13)
                    Text(checking ? "Checking…" : "Check again")
                }
                .foregroundStyle(theme.inkSecondary)
            }
            .buttonStyle(DesktopButtonStyle(kind: .ghost, size: 12, weight: .medium, height: 34, horizontal: 10))
            .disabled(checking)
            .accessibilityIdentifier("desktop-settings.engines-refresh")
        }
        .task { if engines == nil { await load() } }
        if let all = engines {
            let engines = all.filter { filter == "all" || (filter == "computer") == Self.onThisComputer($0) }
            let ready = engines.filter(\.ready)
            let rest = engines.filter { !$0.ready }
            VStack(alignment: .leading, spacing: 0) {
                if engines.isEmpty {
                    DesktopText("No model provider apps detected yet.", color: \.inkSecondary)
                        .padding(14)
                }
                ForEach(ready) { engine in
                    providerRow(engine)
                    if open == engine.id {
                        DesktopEngineGrid(engines: [engine], open: $open, client: session.settingsClient, reload: { await load() }) { _ in
                            shell.settingsSection = .connections
                        }
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                    }
                }
                if !rest.isEmpty {
                    if !ready.isEmpty { Rectangle().fill(theme.hairlineWeak).frame(height: 0.5).padding(.horizontal, 14) }
                    Button { withAnimation(.easeOut(duration: 0.15)) { toConnectOpen.toggle() } } label: {
                        HStack(spacing: 8) {
                            DesktopText(Text("To connect"))
                            Spacer(minLength: 0)
                            DesktopText(Text(verbatim: "\(rest.count)"), color: \.inkSecondary).monospacedDigit()
                            DesktopSettingsIconView(icon: toConnectOpen ? .chevronUp : .chevronDown, size: 12, strokeWidth: 2.5)
                                .foregroundStyle(theme.inkSecondary)
                        }
                        .padding(.horizontal, 14)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 0))
                    .accessibilityIdentifier("desktop-settings.providers.to-connect")
                    if toConnectOpen {
                        DesktopEngineGrid(engines: rest, open: $open, client: session.settingsClient, reload: { await load() }) { _ in
                            shell.settingsSection = .connections
                        }
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                    }
                }
            }
            .padding(1)
            .frame(maxWidth: .infinity, alignment: .leading)
            .desktopHairlineBox()
        } else if let error {
            DesktopText(verbatim: error, color: \.danger)
        } else {
            ProgressView().controlSize(.small)
        }
    }

    /// A model server of this computer (a local endpoint), not an account or a key.
    static func onThisComputer(_ engine: DesktopEngine) -> Bool {
        let kind = engine.driverKind.lowercased()
        return kind.contains("ollama") || kind.contains("lmstudio") || kind.contains("local")
    }

    static func detail(_ engine: DesktopEngine) -> String {
        if onThisComputer(engine) { return [String(localized: "This computer"), String(localized: "No key")].joined(separator: " · ") }
        let whereKey = engine.access == "custom" ? String(localized: "Key on the Sagax server") : String(localized: "Signed-in session")
        return [String(localized: "Me"), whereKey].joined(separator: " · ")
    }

    private func providerRow(_ engine: DesktopEngine) -> some View {
        Button { withAnimation(.easeOut(duration: 0.15)) { open = open == engine.id ? nil : engine.id } } label: {
            HStack(spacing: 10) {
                DesktopText(Text(verbatim: String((engine.displayName ?? engine.driverKind).prefix(2))), size: 11, weight: .semibold, line: 14, color: \.inkSecondary)
                    .frame(width: 24, height: 24)
                    .background(theme.raised, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    DesktopText(Text(verbatim: engine.displayName ?? engine.driverKind), size: 13, weight: .medium, line: 18)
                    // who pays · where its key is (ProvidersSettings.tsx rowDetail)
                    DesktopText(Text(verbatim: Self.detail(engine)), size: 12, line: 16, color: \.inkSecondary)
                }
                Spacer(minLength: 0)
                DesktopText(Text("Connected"), size: 12.5, weight: .medium, line: 18, color: \.success)
                DesktopSettingsIconView(icon: open == engine.id ? .chevronUp : .chevronDown, size: 12, strokeWidth: 2.5)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 14)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 0))
        .accessibilityIdentifier("desktop-settings.provider.\(engine.id)")
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        checking = true
        defer { checking = false }
        do { engines = try await client.desktopEngines() } catch { self.error = error.localizedDescription }
    }
}

/// `grid-cols-[repeat(auto-fit,minmax(min(100%,280px),1fr))] gap-3`, an
/// open card spanning the row.
struct DesktopEngineGrid: View {
    let engines: [DesktopEngine]
    @Binding var open: String?
    var client: CompanionClient?
    var reload: () async -> Void = {}
    let openKeys: (DesktopAPIKeyProvider) -> Void

    var body: some View {
        GeometryReader { geometry in
            let columns = max(1, Int((geometry.size.width + 12) / (280 + 12)))
            VStack(alignment: .leading, spacing: 12) {
                ForEach(rows(columns), id: \.first?.id) { row in
                    if row.count == 1, row[0].id == open {
                        card(row[0])
                    } else {
                        HStack(alignment: .top, spacing: 12) {
                            ForEach(row) { card($0) }
                            if row.count < columns {
                                ForEach(0..<(columns - row.count), id: \.self) { _ in Color.clear.frame(maxWidth: .infinity) }
                            }
                        }
                    }
                }
            }
            .background(GeometryReader { inner in Color.clear.preference(key: DesktopGridHeight.self, value: inner.size.height) })
        }
        .frame(height: height)
        .onPreferenceChange(DesktopGridHeight.self) { height = $0 }
    }

    @State private var height: CGFloat = 122.5

    private func rows(_ columns: Int) -> [[DesktopEngine]] {
        var out: [[DesktopEngine]] = []
        var current: [DesktopEngine] = []
        for engine in engines {
            if engine.id == open {
                if !current.isEmpty { out.append(current); current = [] }
                out.append([engine])
                continue
            }
            current.append(engine)
            if current.count == columns { out.append(current); current = [] }
        }
        if !current.isEmpty { out.append(current) }
        return out
    }

    private func card(_ engine: DesktopEngine) -> some View {
        DesktopEngineCard(engine: engine, open: open == engine.id, client: client, reload: reload, toggle: {
            withAnimation(.easeOut(duration: 0.15)) { open = open == engine.id ? nil : engine.id }
        }, openKeys: openKeys)
        .frame(maxWidth: .infinity)
    }
}

struct DesktopGridHeight: PreferenceKey {
    static var defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = max(value, nextValue()) }
}

/// One provider (`EngineCard`): mark, name, provider line, chevron; the
/// status pill and the version or "Set up".
struct DesktopEngineCard: View {
    @Environment(\.desktopTheme) private var theme
    let engine: DesktopEngine
    let open: Bool
    var client: CompanionClient?
    var reload: () async -> Void = {}
    let toggle: () -> Void
    let openKeys: (DesktopAPIKeyProvider) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button(action: toggle) {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 12) {
                        Group {
                            if let monogram = EngineMonogram(driverKind: engine.driverKind, preset: engine.iconPreset)
                                ?? EngineMonogram(name: engine.name) {
                                DesktopEngineBadge(monogram: monogram, size: 28)
                            } else {
                                Text(verbatim: String(engine.driverKind.replacingOccurrences(of: "Agent", with: "").prefix(1)).uppercased())
                                    .font(theme.font(10, .semibold))
                                    .foregroundStyle(theme.inkSecondary)
                            }
                        }
                            .frame(width: 48, height: 48)
                            .background(theme.panel, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline.opacity(0.3), lineWidth: 1))
                        VStack(alignment: .leading, spacing: 4) {
                            DesktopText(verbatim: engine.name, size: 15, weight: .semibold, line: 22.5, tracking: -0.225)
                                .lineLimit(1)
                            DesktopText(engine.providerLine.map { Text(verbatim: $0) } ?? Text("Bring your own model"),
                                        size: 12, color: \.inkSecondary)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        DesktopSettingsIconView(icon: open ? .chevronUp : .chevronDown, size: 16)
                            .foregroundStyle(theme.inkSecondary)
                    }
                    HStack {
                        HStack(spacing: 6) {
                            if engine.ready {
                                DesktopSettingsIconView(icon: .check, size: 12)
                            } else {
                                Circle().fill(theme.warning).frame(width: 6, height: 6)
                            }
                            Text(engine.ready ? "Ready" : "Needs setup")
                                .font(theme.font(11, .medium))
                        }
                        .foregroundStyle(engine.ready ? theme.success : theme.inkSecondary)
                        .padding(.horizontal, 8)
                        .frame(height: 24.5)
                        .background(engine.ready ? theme.success.opacity(0.1) : theme.control, in: Capsule())
                        Spacer(minLength: 0)
                        if engine.ready {
                            DesktopText(engine.versionNumber.map { Text(verbatim: "v\($0)") } ?? Text("Manage"),
                                        size: 11, line: 16.5, color: \.inkSecondary)
                                .monospacedDigit()
                        } else {
                            HStack(spacing: 4) {
                                Text("Set up").font(theme.font(12, .semibold))
                                DesktopSettingsIconView(icon: .arrowUpRight, size: 13)
                            }
                            .foregroundStyle(theme.accentText)
                        }
                    }
                }
                .padding(16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("desktop-settings.engine.\(engine.id)")
            if open {
                if let client, (engine.interactiveSignIn && !engine.ready) || engine.wantsAccessKey {
                    DesktopEngineSetup(engine: engine, client: client, reload: reload, openKeys: openKeys)
                } else {
                    VStack(alignment: .leading, spacing: 10) {
                        if let provider = engine.apiKeyProvider {
                            DesktopText("This provider runs on an API key saved on the computer.", color: \.inkSecondary)
                            Button("Open API keys") { openKeys(provider) }
                                .buttonStyle(DesktopButtonStyle(kind: .control))
                        } else if engine.ready {
                            DesktopText("Ready on the computer. Its sign-in and updates are managed in Sagax there.", color: \.inkSecondary)
                        } else {
                            DesktopText("Install it and sign in on the computer, in Sagax > Settings > Model providers. This list updates when you check again.",
                                        color: \.inkSecondary)
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                }
            }
        }
        .padding(1)
        .background(theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(theme.hairline.opacity(open ? 0.7 : 0.4), lineWidth: 1)
        )
    }
}

/// Sign-in and access keys for one provider. The computer runs the login and
/// stores the key; this view only shows the page, the code and whether a key
/// is saved. The key itself never stays in the view after a save.
struct DesktopEngineSetup: View {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.openURL) private var openURL
    let engine: DesktopEngine
    let client: CompanionClient
    let reload: () async -> Void
    let openKeys: (DesktopAPIKeyProvider) -> Void

    @State private var auth: EngineSignInState?
    @State private var busy = false
    @State private var error: String?
    @State private var notice: String?
    @State private var pasted = ""
    @State private var key = ""
    @State private var keyConfigured = false
    @State private var keyBusy = false
    @State private var openedLink = false

    private var method: String? { engine.authentication?.method }
    private var waitingId: String? { auth?.phase == "waiting" ? auth?.flowId : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if engine.ready {
                DesktopText("Ready on the computer. Its sign-in and updates are managed in Sagax there.", color: \.inkSecondary)
            }
            if engine.interactiveSignIn, !engine.ready {
                signIn
            }
            if engine.wantsAccessKey {
                if engine.interactiveSignIn, !engine.ready {
                    DisclosureGroup {
                        keyFields
                    } label: {
                        Text("Or paste an access key")
                    }
                } else {
                    keyFields
                    if !engine.interactiveSignIn, let provider = engine.apiKeyProvider {
                        Button("Open API keys") { openKeys(provider) }
                            .buttonStyle(DesktopButtonStyle(kind: .control))
                    }
                }
            }
            if let command = engine.manualCommand {
                DisclosureGroup {
                    Text(verbatim: command)
                        .font(Theme.mono(12))
                        .textSelection(.enabled)
                        .foregroundStyle(theme.inkSecondary)
                    Button("Copy command") { UIPasteboard.general.string = command }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                } label: {
                    Text("Prefer a terminal?")
                }
                .accessibilityIdentifier("desktop-settings.engine.manual.\(engine.id)")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
        .task { await loadKey() }
        .task(id: waitingId) { await poll() }
    }

    @ViewBuilder
    private var signIn: some View {
        if let auth { statusLine(auth) }
        if auth?.phase == "waiting" {
            if method == "device-code", let code = auth?.userCode, !code.isEmpty {
                DesktopText("Enter this code on the sign-in page", color: \.inkSecondary)
                HStack(spacing: 8) {
                    Text(verbatim: code)
                        .font(Theme.mono(18))
                        .tracking(2)
                        .textSelection(.enabled)
                        .foregroundStyle(theme.ink)
                    Spacer(minLength: 8)
                    Button("Copy code") { UIPasteboard.general.string = code }
                        .buttonStyle(DesktopButtonStyle(kind: .control))
                }
            }
            if method == "paste-code" {
                TextField("Paste the code from that page", text: $pasted)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Finish sign-in") { Task { await finish() } }
                    .buttonStyle(DesktopButtonStyle(kind: .accent))
                    .disabled(busy || pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let raw = auth?.authorizationUrl, let url = EngineSignInLink.allowed(raw) {
                Button("Open sign-in") {
                    openedLink = true
                    openURL(url)
                }
                .buttonStyle(DesktopButtonStyle(kind: .accent))
            }
            Button("Cancel sign-in") { Task { await cancel() } }
                .buttonStyle(DesktopButtonStyle(kind: .control))
                .disabled(busy)
        } else if auth?.phase != "succeeded" {
            Button(auth == nil && error == nil ? "Sign in" : "Try again") { Task { await start() } }
                .buttonStyle(DesktopButtonStyle(kind: .accent))
                .disabled(busy)
        }
        if let error {
            DesktopText(verbatim: error, color: \.danger)
        } else if let notice, auth?.phase != "waiting" {
            DesktopText(verbatim: notice, color: \.success)
        }
    }

    private func statusLine(_ auth: EngineSignInState) -> some View {
        let text: String
        switch auth.phase {
        case "waiting": text = String(localized: "Waiting for you to finish signing in…")
        case "succeeded": text = String(localized: "Connected. Your models are being refreshed.")
        case "cancelled": text = String(localized: "Sign-in was cancelled.")
        case "expired": text = String(localized: "This sign-in expired. Start again.")
        default: text = auth.message ?? String(localized: "Sign-in could not be completed. Try again.")
        }
        return DesktopText(verbatim: text, color: auth.phase == "succeeded" ? \.success : \.inkSecondary)
    }

    @ViewBuilder
    private var keyFields: some View {
        DesktopText("Access key", size: 12, weight: .semibold)
        SecureField("Paste the access key", text: $key)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .textFieldStyle(.roundedBorder)
        HStack(spacing: 8) {
            Button(keyBusy ? "Saving…" : "Save key") { Task { await saveKey(key) } }
                .buttonStyle(DesktopButtonStyle(kind: .accent))
                .disabled(keyBusy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if keyConfigured {
                Button("Remove key") { Task { await saveKey("") } }
                    .buttonStyle(DesktopButtonStyle(kind: .control))
                    .disabled(keyBusy)
            }
        }
    }

    private func start() async {
        busy = true
        error = nil
        notice = nil
        defer { busy = false }
        do {
            let next = try await client.startEngineSignIn(instanceId: engine.instanceId)
            auth = next
            if next.phase == "succeeded" {
                notice = String(localized: "Connected. Your models are being refreshed.")
                await reload()
            } else {
                openOnce(next)
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func openOnce(_ state: EngineSignInState) {
        guard !openedLink, method == "open-link" || method == "browser-pkce" else { return }
        guard let raw = state.authorizationUrl, let url = EngineSignInLink.allowed(raw) else {
            error = String(localized: "The sign-in page could not be opened.")
            return
        }
        openedLink = true
        openURL(url)
    }

    private func poll() async {
        guard let flowId = waitingId else { return }
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if Task.isCancelled { return }
            guard auth?.phase == "waiting", auth?.flowId == flowId else { return }
            do {
                let next = try await client.engineSignInStatus(instanceId: engine.instanceId, flowId: flowId)
                if Task.isCancelled { return }
                auth = next
                error = nil
                if next.phase == "succeeded" {
                    notice = String(localized: "Connected. Your models are being refreshed.")
                    await reload()
                    return
                }
                if next.phase != "waiting" { return }
            } catch {
                if Task.isCancelled { return }
                self.error = error.localizedDescription
            }
        }
    }

    private func cancel() async {
        guard let flowId = auth?.flowId else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await client.cancelEngineSignIn(instanceId: engine.instanceId, flowId: flowId)
            auth = EngineSignInState(phase: "cancelled", flowId: nil, authorizationUrl: nil, expiresAt: nil, userCode: nil, message: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func finish() async {
        guard let flowId = auth?.flowId else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            try await client.completeEngineSignIn(instanceId: engine.instanceId, flowId: flowId, code: pasted)
            pasted = ""
            notice = String(localized: "Connected. Your models are being refreshed.")
            auth = EngineSignInState(phase: "succeeded", flowId: flowId, authorizationUrl: nil, expiresAt: nil, userCode: nil, message: nil)
            await reload()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func loadKey() async {
        guard engine.wantsAccessKey else { return }
        do { keyConfigured = try await client.engineAccessKeyConfigured(instanceId: engine.instanceId) }
        catch { self.error = error.localizedDescription }
    }

    private func saveKey(_ value: String) async {
        keyBusy = true
        error = nil
        defer { keyBusy = false }
        do {
            let saved = try await client.saveEngineAccessKey(instanceId: engine.instanceId, key: value)
            key = ""
            keyConfigured = saved
            notice = saved ? String(localized: "Key saved") : String(localized: "Key removed")
            await reload()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Local VM

struct DesktopComputerSettings: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var model: DesktopSettingsModel
    @State private var status: LocalComputerStatus?
    @State private var loading = true
    @State private var pending: LocalComputerAction?
    @State private var confirmingRecreate = false
    @State private var error: String?

    var body: some View {
        let perBot = model.config?.localVm?.mode == "perBot"
        let ready = status?.ready == true
        let statusText: Text = loading ? Text("Checking…")
            : status == nil ? Text("Status unavailable")
            : ready ? Text("Ready") : Text(verbatim: status?.problem ?? AppStrings.localized("Not ready"))
        DesktopSettingsCard(
            Text("Local VM"),
            summary: statusText,
            subtitle: perBot
                ? Text("Private Cua Linux desktops on the computer, with one container and durable folder per bot. Distinct bots can work concurrently and unused desktops stop after 10 minutes.")
                : Text("A shared Cua Linux sandbox on the computer for bots to browse and work in: isolated, backed by one durable folder, and stopped automatically after 10 minutes without use."),
            identifier: "computer.main"
        ) {
            HStack(spacing: 8) {
                HStack(spacing: 6) {
                    if loading { ProgressView().controlSize(.mini) }
                    else if ready { DesktopSettingsIconView(icon: .check, size: 12) }
                    else { DesktopSettingsIconView(icon: .circle, size: 9) }
                    statusText.font(theme.font(12.5)).lineLimit(1)
                }
                .foregroundStyle(ready ? theme.success : theme.inkSecondary)
                .padding(.horizontal, 10)
                .frame(height: 26.8)
                .background(ready ? theme.success.opacity(0.15) : theme.control, in: Capsule())
                Button { Task { await load() } } label: {
                    HStack(spacing: 6) {
                        DesktopSettingsIconView(icon: .refreshCw, size: 12)
                        Text("Re-check")
                    }
                }
                .buttonStyle(DesktopRecheckStyle())
                .disabled(loading || pending != nil)
                .accessibilityIdentifier("desktop-settings.vm-recheck")
                Spacer(minLength: 0)
            }
            if let error {
                DesktopText(verbatim: error, size: 12, line: 17, color: \.danger).padding(.top, 10)
            }
        }
        .task { await load() }
        .confirmationDialog(Text("Replace the Local VM?"), isPresented: $confirmingRecreate, titleVisibility: .visible) {
            Button("Delete and recreate", role: .destructive) { Task { await recreate() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Replace the existing Local VM with the pinned image and safety limits? Files and browser sign-ins in its durable folder will remain.")
        }
        DesktopSettingsCard(
            Text("Isolation"),
            summary: perBot ? Text("Per bot") : Text("Shared"),
            subtitle: Text("Shared keeps the original single-desktop behavior. Per bot gives each bot its own container, folder, viewer port, lease, and idle timer."),
            open: false, identifier: "computer.isolation"
        ) {
            EmptyView()
        }
        if let status {
            DesktopSettingsCard(
                Text("Setup"),
                summary: ready ? Text("Done") : Text("Step \(status.setupStep) of 4"),
                subtitle: Text("Once a container runtime is open, Sagax prepares Cua and the VM for you."),
                open: !ready, identifier: "computer.setup"
            ) {
                VStack(alignment: .leading, spacing: 17) {
                    step(1, Text("Install a container runtime"), done: status.runtime != nil)
                    step(2, status.runtime != nil && !status.daemonUp
                            ? Text("Open and start \(status.runtime ?? "")") : Text("Start the container runtime"),
                         done: status.daemonUp)
                    step(3, Text("Prepare the Cua desktop (one-time download and build)"), done: status.image) {
                        if status.daemonUp && !status.image {
                            actionButton(Text("Prepare Cua desktop"), action: .pull, danger: false)
                        }
                    }
                    step(4, status.needsRecreate ? Text("Replace the older or unsafe VM") : Text("Create and start the Local VM"),
                         done: !perBot && ready) {
                        if !perBot, status.needsRecreate {
                            VStack(alignment: .leading, spacing: 8) {
                                if let problem = status.problem {
                                    HStack(alignment: .top, spacing: 8) {
                                        DesktopSettingsIconView(icon: .triangleAlert, size: 15)
                                        DesktopText(verbatim: problem, line: 19.5, color: \.warning)
                                    }
                                    .foregroundStyle(theme.warning)
                                }
                                if status.image {
                                    Button { confirmingRecreate = true } label: {
                                        HStack(spacing: 6) {
                                            DesktopSettingsIconView(icon: .rotateCcw, size: 13)
                                            Text("Delete and recreate")
                                        }
                                    }
                                    .buttonStyle(DesktopDangerStyle())
                                    .disabled(pending != nil)
                                    .accessibilityIdentifier("desktop-settings.vm-recreate")
                                }
                            }
                        } else if !perBot, !ready, status.image, status.daemonUp {
                            actionButton(Text("Create and start the Local VM"), action: .run, danger: false)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func step(_ n: Int, _ title: Text, done: Bool, @ViewBuilder detail: () -> some View = { EmptyView() }) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                if done {
                    Circle().fill(theme.success.opacity(0.15))
                    DesktopSettingsIconView(icon: .check, size: 12).foregroundStyle(theme.success)
                } else {
                    Circle().strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1)
                    Text(verbatim: "\(n)").font(theme.font(11)).foregroundStyle(theme.inkSecondary)
                }
            }
            .frame(width: 20, height: 20)
            .padding(.top, 2)
            VStack(alignment: .leading, spacing: 8) {
                DesktopText(title, size: 14, line: 21, color: done ? \.inkSecondary : \.ink)
                    .strikethrough(done, color: theme.inkSecondary)
                detail()
            }
        }
    }

    private func actionButton(_ label: Text, action: LocalComputerAction, danger: Bool) -> some View {
        Button { Task { await run(action) } } label: {
            HStack(spacing: 6) {
                if pending == action { ProgressView().controlSize(.mini) }
                label
            }
        }
        .buttonStyle(DesktopButtonStyle(kind: .control, size: 12.5, weight: .medium, height: 30.8))
        .disabled(pending != nil)
    }

    private func load() async {
        guard let client = session.settingsClient else { loading = false; return }
        loading = true
        defer { loading = false }
        status = try? await client.localComputerStatus()
    }

    private func run(_ action: LocalComputerAction) async {
        guard let client = session.settingsClient else { return }
        pending = action
        error = nil
        defer { pending = nil }
        do { status = try await client.localComputerAction(action) } catch { self.error = error.localizedDescription }
    }

    private func recreate() async {
        await run(.remove)
        if error == nil { await run(.run) }
        await load()
    }
}

/// `rounded-lg border border-hairline/40 px-2.5 py-1 text-[12.5px] text-ink-secondary`.
struct DesktopRecheckStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(12.5))
            .foregroundStyle(theme.inkSecondary)
            .padding(.horizontal, 10)
            .frame(height: 28.8)
            .background(configuration.isPressed ? theme.control : .clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
    }
}

/// The danger action (`bg-danger/10 text-danger`).
struct DesktopDangerStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(12.5, .medium))
            .foregroundStyle(theme.danger)
            .padding(.horizontal, 12)
            .frame(height: 30.8)
            .background(theme.danger.opacity(configuration.isPressed ? 0.2 : 0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private extension Session.Status {
    var desktopText: Text {
        switch self {
        case .live: Text("Connected")
        case .connecting: Text("Connecting…")
        case .unpaired: Text("Not paired")
        case .unauthorized: Text("Needs pairing")
        case .offline: Text("Offline")
        }
    }
}

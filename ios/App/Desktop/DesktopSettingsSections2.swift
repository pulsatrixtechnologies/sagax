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
        // Settings > Organization on a solo computer (OrganizationSettings.tsx):
        // the Servers heading over "Your servers" (this iPad's paired
        // computers: switch or forget one) and the "Connect to a server" card
        DesktopSettingsGroup(Text("Servers"), plain: true, identifier: "servers") {
            AnyView(DesktopConnectServerCard())
            if let active = session.connection {
                AnyView(serversCard(active))
            }
        }
        if session.surfaceGate.allows(.organizationSettings) {
            organizationRow
        }
        // #1098: the person's own server environment, updated or reset by
        // them (the desktop's Organization > Your server environment)
        if session.surfaceGate.allows(.myComputer) {
            myComputerRow
        }
    }

    private func serversCard(_ active: Connection) -> some View {
        DesktopSettingsCard(Text("Your servers"), summary: Text(verbatim: active.name), open: false, identifier: "organization.servers") {
            VStack(spacing: 0) {
                ForEach([active] + session.connections.filter { $0.id != active.id }) { computer in
                    HStack(spacing: 12) {
                        DesktopSettingsIconView(icon: .monitor, size: 18).foregroundStyle(theme.inkSecondary)
                        VStack(alignment: .leading, spacing: 0) {
                            DesktopText(verbatim: computer.name, weight: .medium)
                            if computer.id == active.id {
                                DesktopText(session.status.desktopText, size: 12, line: 16, color: \.inkSecondary)
                            }
                        }
                        Spacer(minLength: 0)
                        if computer.id == active.id {
                            HStack(spacing: 4) {
                                DesktopSettingsIconView(icon: .check, size: 13)
                                DesktopText(Text("Current"), size: 12, line: 16, color: \.inkSecondary)
                            }
                            .foregroundStyle(theme.inkSecondary)
                        } else {
                            Button("Switch") { session.switchComputer(to: computer.id) }
                                .buttonStyle(DesktopPillButtonStyle())
                                .accessibilityLabel(Text(verbatim: String(format: AppStrings.localized("Switch to %@"), computer.name)))
                                .accessibilityIdentifier("desktop-settings.use-computer")
                        }
                        Button("Forget") { pendingRemoval = computer }
                            .buttonStyle(DesktopPillButtonStyle())
                            .accessibilityLabel(Text(verbatim: String(format: AppStrings.localized("Forget %@"), computer.name)))
                    }
                    .padding(.vertical, 12)
                    .overlay(alignment: .top) {
                        if computer.id != active.id { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                    }
                }
                // ServerLinkForm's place: another computer or Sagax server, by its code or link
                HStack {
                    DesktopText(Text("By its address or a pairing link from that server."), size: 12, line: 16, color: \.inkSecondary)
                    Spacer(minLength: 0)
                    Button("Connect") { session.beginPairing() }
                        .buttonStyle(DesktopPillButtonStyle())
                        .accessibilityIdentifier("desktop-settings.connect-computer")
                }
                .padding(.vertical, 10)
                .overlay(alignment: .top) { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
            }
        }
        .confirmationDialog(
            Text(verbatim: String(format: AppStrings.localized("Forget %@? This app stops connecting to it; the server and its bots stay as they are."), pendingRemoval?.name ?? "")),
            isPresented: Binding(get: { pendingRemoval != nil }, set: { if !$0 { pendingRemoval = nil } }),
            titleVisibility: .visible
        ) {
            Button("Forget", role: .destructive) {
                if let pendingRemoval { session.forgetConnection(id: pendingRemoval.id) }
                pendingRemoval = nil
            }
            Button("Cancel", role: .cancel) { pendingRemoval = nil }
        }
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

}

/// "Connect to a server" (ConnectServerWizard.tsx): what to connect to,
/// then its steps. Your organization's Perspicax server: copy your own
/// bots (JoinPerspicaxCard, the served page's form: the copy file). A
/// Sagax server: this iPad pairs with it, by its code or link.
struct DesktopConnectServerCard: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var choices: [String: OrgJoinChoice] = [:]
    @State private var preview: OrgExportAnswer?
    @State private var busy = false
    @State private var error: String?
    @State private var file: URL?

    /// The person's own bots (`offeredBots`); on the computer's own pairing
    /// every visible bot is the owner's, as on the solo desktop.
    private var bots: [Bot] {
        let principal = session.surfaceGate.viewer?.principalId ?? session.account?.principalId
        if session.surfaceGate.scope == .sidecar { return session.state.bots.filter { $0.hidden != true } }
        return OrgJoin.offered(session.state.bots, principalId: principal)
    }

    var body: some View {
        DesktopSettingsCard(
            Text("Connect to a server"),
            summary: Text("Your organization's Perspicax server"),
            subtitle: Text("Pick what you connect this app to, then follow its steps."),
            open: true, identifier: "organization.connect"
        ) {
            // one way in here, as the served page: no choice cards; this
            // iPad's own pairing is under Your servers
            joinBody
        }
    }

    private var joinBody: some View {
        let request = OrgJoin.request(bots, choices)
        return VStack(alignment: .leading, spacing: 12) {
            DesktopText(Text("Copy your own bots into your organization's Sagax. They arrive private and yours, and they stay here too."), line: 21, color: \.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if bots.isEmpty {
                DesktopText(Text("You have no bots of your own to copy."), color: \.inkSecondary)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(bots.enumerated()), id: \.element.id) { index, bot in
                        let choice = choices[bot.id] ?? .default
                        HStack(spacing: 16) {
                            HStack(spacing: 8) {
                                DesktopCheckbox(checked: choice.copy, label: Text(verbatim: bot.name), identifier: "desktop-settings.join.\(bot.id)") {
                                    choices = OrgJoin.with(choices, bot: bot.id, copy: !choice.copy); preview = nil
                                }
                                DesktopText(Text(verbatim: bot.name)).lineLimit(1)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            HStack(spacing: 6) {
                                DesktopCheckbox(checked: choice.copy && choice.threads, label: Text("Conversations"), disabled: !choice.copy) {
                                    choices = OrgJoin.with(choices, bot: bot.id, threads: !(choice.copy && choice.threads)); preview = nil
                                }
                                DesktopText(Text("Conversations"), color: \.inkSecondary).fixedSize()
                            }
                            HStack(spacing: 6) {
                                DesktopCheckbox(checked: choice.copy && choice.memory, label: Text("Memory"), disabled: !choice.copy) {
                                    choices = OrgJoin.with(choices, bot: bot.id, memory: !(choice.copy && choice.memory)); preview = nil
                                }
                                DesktopText(Text("Memory"), color: \.inkSecondary)
                            }
                        }
                        .padding(.vertical, 8)
                        .overlay(alignment: .top) {
                            if index > 0 { Rectangle().fill(theme.hairline.opacity(0.4)).frame(height: 1) }
                        }
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(Text("Your bots"))
            }
            DesktopText(Text("Never copied: keys, files, pictures, model settings, connections, computer and browser access. Secrets in messages and memory are removed."), size: 12, line: 16, color: \.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("See what will be copied") { Task { await runExport(request) } }
                .buttonStyle(DesktopPillButtonStyle())
                .disabled(busy || request.isEmpty)
            if let summary = preview?.summary {
                VStack(alignment: .leading, spacing: 4) {
                    DesktopText(verbatim: String(format: AppStrings.localized("%@ bots, %@ rooms and %@ routines will be copied."), "\(summary.bots.count)", "\(summary.groups.count)", "\(summary.routines.count)"))
                    if !summary.routines.isEmpty { DesktopText(Text("Routines start paused in the organization."), color: \.inkSecondary) }
                    if summary.redacted > 0 { DesktopText(verbatim: String(format: AppStrings.localized("%@ secrets will be removed."), "\(summary.redacted)"), color: \.inkSecondary) }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.4), lineWidth: 1))
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Button("Download the copy file") { Task { await runExport(request, save: true) } }
                        .buttonStyle(DesktopPillButtonStyle())
                        .disabled(busy || request.isEmpty)
                    if let file {
                        ShareLink(item: file) { DesktopText(verbatim: file.lastPathComponent, size: 12, color: \.accentText) }
                    }
                }
                DesktopText(Text("Keep this file as a copy or backup of these bots. Copying bots into an organization is only done from the local Sagax of a Sagax desktop app, in Settings > Organization > Join and copy."), color: \.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error { DesktopText(verbatim: error, color: \.danger) }
        }
    }

    private func runExport(_ request: [[String: Any]], save: Bool = false) async {
        guard let client = session.settingsClient, !request.isEmpty else { return }
        busy = true
        error = nil
        defer { busy = false }
        do {
            let answer = try await client.orgExport(request)
            preview = answer
            if save {
                let url = FileManager.default.temporaryDirectory.appendingPathComponent(answer.filename.isEmpty ? "sagax-bots.json" : answer.filename)
                try answer.document.write(to: url, options: .atomic)
                file = url
            }
        } catch {
            self.error = AppStrings.localized("The copy could not be prepared.")
        }
    }
}

// MARK: - Appearance

/// Simple or Advanced (`sagax.interfaceMode.v1`, interface-mode.ts): one
/// choice per person, Advanced by default; on an organization server the key
/// is one of the person's synced preferences.
@MainActor
final class DesktopInterfaceMode: ObservableObject {
    static let shared = DesktopInterfaceMode()
    @Published private(set) var advanced = UserDefaults.standard.string(forKey: ModelMenu.interfaceModeKey) != "simple"

    func load(_ session: Session) async {
        guard let record = try? await session.settingsClient?.sidebarPreferenceRecord(),
              let raw = record.preferences[ModelMenu.interfaceModeKey] else { return }
        UserDefaults.standard.set(raw, forKey: ModelMenu.interfaceModeKey)
        advanced = raw != "simple"
    }

    func set(_ on: Bool, session: Session) {
        let raw = on ? "advanced" : "simple"
        advanced = on
        UserDefaults.standard.set(raw, forKey: ModelMenu.interfaceModeKey)
        guard let client = session.settingsClient else { return }
        Task { _ = try? await client.saveSidebarPreferences([ModelMenu.interfaceModeKey: raw]) }
    }
}

struct DesktopAppearanceSettings: View {
    @EnvironmentObject private var session: Session
    @ObservedObject private var themes = ThemeStore.shared
    @ObservedObject private var mode = DesktopInterfaceMode.shared
    @AppStorage(PrefKey.desktopSidebarDensity) private var density = DesktopSidebarDensity.comfortable.rawValue
    @AppStorage(SidebarLogoPreference.key) private var showSidebarLogo = SidebarLogoPreference.defaultEnabled
    @AppStorage(RunCardPreference.key) private var showRunCard = true
    @AppStorage(DesktopInspectorButton.key) private var showInspector = false
    @ObservedObject private var prefs = SidebarPrefsModel.shared
    @ObservedObject private var toolCalls = ToolCallsSetting.shared

    var body: some View {
        let advanced = mode.advanced
        DesktopSettingsGroup(Text("Interface"), identifier: "interface") {
            DesktopDescribedRow(Text("Advanced mode"), description: Text("Show technical controls. Saved choices stay either way."), identifier: "advancedMode") {
                DesktopSwitch(isOn: advanced, label: Text("Advanced mode"), identifier: "desktop-settings.advanced-mode") {
                    mode.set(!advanced, session: session)
                }
            }
            DesktopCompactRow(Text("Interface font"), identifier: "font") {
                let font = themes.effective.mode == .computer ? (themes.effective.computerFont ?? .skin) : themes.effective.font
                DesktopPillSelect(
                    options: [(SkinFontChoice.skin, AppStrings.localized("Skin default")),
                              (.system, AppStrings.localized("System")), (.serif, AppStrings.localized("Serif"))],
                    selection: font == .inter || font == .poppins ? .system : font,
                    label: Text("Interface font"),
                    identifier: "desktop-settings.font"
                ) { themes.chooseFont($0, client: session.settingsClient) }
            }
        }
        DesktopSettingsGroup(Text("Skin"), identifier: "skin") {
            // the families and their variants, as the iPhone's picker (#1126) and the desktop's SkinPicker
            DesktopSkinFamilies()
            DesktopDescribedRow(Text("Use bot color as accent"), description: Text("The accent follows the open bot's color."), identifier: "botAccent") {
                DesktopSwitch(isOn: prefs.botAccent, label: Text("Use bot color as accent"), identifier: "desktop-settings.bot-accent") {
                    prefs.setBotAccent(session, !prefs.botAccent)
                }
            }
        }
        DesktopSettingsGroup(Text("Background effects"), identifier: "backgroundEffects") {
            DesktopBackgroundEffectsPicker()
        }
        DesktopSettingsGroup(Text("Conversations"), identifier: "conversation") {
            DesktopCompactRow(Text("Show replies as they are written"), identifier: "streamReplies") {
                DesktopSwitch(isOn: prefs.streamReplies, label: Text("Show a bot reply word by word while it is written, instead of all at once when it is finished"), identifier: "desktop-settings.stream-replies") {
                    prefs.setStreamReplies(session, !prefs.streamReplies)
                }
            }
            if advanced {
                DesktopDescribedRow(Text("Tool calls"), description: Text("Show tool calls in chat. Off: the chat shows the messages, a turn's steps fold away. The same switch as on your computer."), identifier: "toolCalls") {
                    DesktopSwitch(isOn: toolCalls.showToolCalls, label: Text("Show tool calls in chat"), identifier: "desktop-settings.tool-calls", disabled: toolCalls.saving) {
                        let next = !toolCalls.showToolCalls
                        Task { await toolCalls.set(session, next) }
                    }
                }
                DesktopCompactRow(Text("This run"), identifier: "runCard") {
                    DesktopSwitch(isOn: showRunCard, label: Text("Show the run card"), identifier: "desktop-settings.run-card") {
                        showRunCard.toggle()
                    }
                }
                // a display preference: an organization member opens the
                // Inspector on the bots they own (2026-10-26)
                if session.surfaceGate.allows(.inspector) || session.surfaceGate.isOrgMemberSession {
                    DesktopCompactRow(Text("Inspector button"), identifier: "inspectorButton") {
                        DesktopSwitch(isOn: showInspector, label: Text("Show the Inspector button"), identifier: "desktop-settings.inspector-button") {
                            showInspector.toggle()
                        }
                    }
                }
            }
        }
        DesktopSettingsGroup(Text("Sidebar"), identifier: "sidebar") {
            DesktopCompactRow(Text("Sidebar density"), identifier: "sidebarDensity") {
                DesktopPillSelect(
                    options: [(DesktopSidebarDensity.comfortable.rawValue, AppStrings.localized("Comfortable")),
                              (DesktopSidebarDensity.compact.rawValue, AppStrings.localized("Compact")),
                              (DesktopSidebarDensity.icons.rawValue, AppStrings.localized("Avatars only"))],
                    selection: density,
                    label: Text("Choose sidebar density"),
                    identifier: "desktop-settings.density"
                ) { density = $0 }
            }
            if advanced && SidebarLogoRuntime.showsSetting {
                DesktopCompactRow(Text("Sidebar logo"), identifier: "sidebarLogo") {
                    DesktopSwitch(isOn: showSidebarLogo, label: Text("Show the sidebar logo"), identifier: "desktop-settings.sidebar-logo") {
                        showSidebarLogo.toggle()
                    }
                }
            }
            DesktopCompactRow(Text("Show suggestions"), identifier: "showSuggestions") {
                DesktopSwitch(isOn: prefs.showSuggestions, label: Text("Show the Suggestions card in the bot panel"), identifier: "desktop-settings.show-suggestions") {
                    prefs.setShowSuggestions(session, !prefs.showSuggestions)
                }
            }
        }
        DesktopSettingsGroup(Text("Mascots"), identifier: "mascots") {
            DesktopDescribedRow(Text("HD mascots"), description: Text("Detailed art for the characters that have it. Colors and skins apply to the classic look."), identifier: "hdMascots") {
                DesktopSwitch(isOn: prefs.hdMascots, label: Text("HD mascots"), identifier: "desktop-settings.hd-mascots") {
                    prefs.setHdMascots(session, !prefs.hdMascots)
                }
            }
        }
        Color.clear.frame(height: 0)
            .task(id: session.connection?.id) {
                await mode.load(session)
                await toolCalls.load(session)
                await prefs.readComputerHdMascots(session)
            }
    }
}

/// Settings > Appearance > Background effects (BackgroundEffectsPicker.tsx):
/// the preview, the gallery and, for an effect, its colour and intensity.
/// The choice is kept on this device under the desktop's key
/// (`sagax-background-effect`); the effects themselves are drawn behind the
/// conversation on a desktop, as the hint says.
struct DesktopBackgroundEffectsPicker: View {
    @Environment(\.desktopTheme) private var theme
    @AppStorage("sagax-background-effect") private var raw = ""

    static let effects: [(id: String, palettes: [String])] = [
        ("none", []),
        ("glyphs", ["theme", "aurora", "ocean", "ember", "neon", "violet", "gold", "mono"]),
        ("matrix", ["aurora", "theme", "ocean", "ember", "neon", "mono"]),
        ("starfield", ["ocean", "theme", "violet", "gold", "ember", "mono"]),
        ("aurora", ["aurora", "violet", "ocean", "ember", "neon", "theme"]),
        ("magnetic", ["theme", "ocean", "ember", "neon", "gold", "mono"]),
        ("synthwave", ["neon", "violet", "ocean", "ember", "aurora", "theme"]),
        ("ink", ["violet", "ocean", "ember", "aurora", "theme", "mono"]),
        ("bubbles", ["ocean", "neon", "violet", "aurora", "theme", "gold"]),
        ("constellation", ["theme", "ocean", "gold", "violet", "aurora", "mono"]),
        ("sonar", ["aurora", "ocean", "ember", "theme", "neon", "mono"]),
        ("fireflies", ["gold", "aurora", "ember", "ocean", "violet", "theme"]),
        ("crystal", ["ocean", "violet", "aurora", "gold", "theme", "mono"]),
    ]

    private struct Prefs: Codable { var effect = "none"; var palettes: [String: String] = [:]; var intensity = "medium" }

    private var prefs: Prefs {
        (raw.data(using: .utf8)).flatMap { try? JSONDecoder().decode(Prefs.self, from: $0) } ?? Prefs()
    }

    private func save(_ edit: (inout Prefs) -> Void) {
        var next = prefs
        edit(&next)
        if let data = try? JSONEncoder().encode(next) { raw = String(decoding: data, as: UTF8.self) }
    }

    private func palette(_ effect: String) -> String {
        let offered = Self.effects.first { $0.id == effect }?.palettes ?? []
        if let chosen = prefs.palettes[effect], offered.contains(chosen) { return chosen }
        return offered.first ?? "theme"
    }

    static func name(_ id: String) -> String {
        switch id {
        case "none": AppStrings.localized("None")
        case "glyphs": AppStrings.localized("Glyph ripple")
        case "matrix": AppStrings.localized("Digital rain")
        case "starfield": AppStrings.localized("Starfield")
        case "aurora": AppStrings.localized("Aurora")
        case "magnetic": AppStrings.localized("Magnetic field")
        case "synthwave": AppStrings.localized("Neon horizon")
        case "ink": AppStrings.localized("Ink in water")
        case "bubbles": AppStrings.localized("Bubbles")
        case "constellation": AppStrings.localized("Constellation")
        case "sonar": AppStrings.localized("Sonar")
        case "fireflies": AppStrings.localized("Fireflies")
        default: AppStrings.localized("Crystal")
        }
    }

    static func paletteName(_ id: String) -> String {
        switch id {
        case "theme": AppStrings.localized("Theme")
        case "aurora": AppStrings.localized("Aurora")
        case "ocean": AppStrings.localized("Ocean")
        case "ember": AppStrings.localized("Ember")
        case "neon": AppStrings.localized("Neon")
        case "violet": AppStrings.localized("Violet")
        case "gold": AppStrings.localized("Gold")
        default: AppStrings.localized("Mono")
        }
    }

    /// The palettes' three colours (background-effects.ts PALETTES, dark).
    private func swatch(_ id: String) -> [Color] {
        func c(_ hex: UInt32) -> Color { SkinColor(hex).color }
        let dark = theme.dark
        switch id {
        case "aurora": return dark ? [c(0x3dffa8), c(0x2fd5ff), c(0xc3a2ff)] : [c(0x0b9e62), c(0x0a7fa8), c(0x7a3fd1)]
        case "ocean": return dark ? [c(0x3d8bff), c(0x35e0ff), c(0xd2f6ff)] : [c(0x1f5fd1), c(0x0a8fb0), c(0x0b3d8c)]
        case "ember": return dark ? [c(0xff8a3d), c(0xff3d5a), c(0xffe0a3)] : [c(0xd4570b), c(0xc21f3a), c(0x8a4a00)]
        case "neon": return dark ? [c(0xff3dcb), c(0x35e8ff), c(0xfff06b)] : [c(0xc2189a), c(0x0a8fb0), c(0x7a6200)]
        case "violet": return dark ? [c(0xa06bff), c(0xff6bd5), c(0xebdcff)] : [c(0x6a3fd1), c(0xb0228a), c(0x3d1f8c)]
        case "gold": return dark ? [c(0xffc54d), c(0xff9a3d), c(0xfff3cf)] : [c(0xa87400), c(0xb0570b), c(0x5c3e00)]
        case "mono": return [theme.ink, theme.inkSecondary, theme.ink]
        default: return [theme.accent, theme.accentText, theme.accent]
        }
    }

    private func gradient(_ id: String) -> AngularGradient {
        let colors = swatch(id)
        return AngularGradient(colors: colors + [colors[0]], center: .center, angle: .degrees(120))
    }

    var body: some View {
        let current = prefs
        VStack(alignment: .leading, spacing: 4) {
            preview(current.effect)
            DesktopText("Behind the conversation, on a desktop. Nothing moves when animations are reduced, and the effect stops when the window is hidden or in the background.",
                        size: 12, line: 16, color: \.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 14)
                .padding(.top, 4)
            grid(current)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
            if current.effect != "none" {
                let offered = Self.effects.first { $0.id == current.effect }?.palettes ?? []
                DesktopCompactRow(Text("Colour"), identifier: "backgroundPalette") {
                    HStack(spacing: 6) {
                        ForEach(offered, id: \.self) { id in
                            let selected = id == palette(current.effect)
                            Button { save { $0.palettes[current.effect] = id } } label: {
                                Circle().fill(gradient(id)).frame(width: 22, height: 22)
                                    .overlay(Circle().strokeBorder(theme.hairline, lineWidth: 1).opacity(selected ? 0 : 1))
                                    .overlay(Circle().stroke(theme.accentBorder, lineWidth: 2).frame(width: 28, height: 28).opacity(selected ? 1 : 0))
                                    .padding(.vertical, 3)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(Text(verbatim: Self.paletteName(id)))
                            .accessibilityAddTraits(selected ? .isSelected : [])
                        }
                    }
                }
                DesktopCompactRow(Text("Intensity"), identifier: "backgroundIntensity") {
                    DesktopPillSelect(
                        options: [("low", AppStrings.localized("Low")), ("medium", AppStrings.localized("Medium")), ("high", AppStrings.localized("High"))],
                        selection: current.intensity,
                        label: Text("Intensity"),
                        identifier: "desktop-settings.background-intensity"
                    ) { level in save { $0.intensity = level } }
                }
            }
        }
        .accessibilityIdentifier("desktop-settings.background-effects")
    }

    private func preview(_ effect: String) -> some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(theme.app)
            if effect != "none" {
                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(gradient(palette(effect))).opacity(0.3)
            }
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Spacer(minLength: 0)
                    DesktopText("Can you sum up this week's open tickets?")
                        .padding(.horizontal, 12).padding(.vertical, 6)
                        .background(theme.bubbleUser, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }
                DesktopText("Fourteen are open: three wait on the client and two are ready to bill.", line: 19)
                Spacer(minLength: 0)
                DesktopText(effect == "none" ? "No effect behind the conversation." : "Move the pointer and click here to try it.",
                            size: 12, line: 16, color: \.inkTertiary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
        }
        .frame(height: 168)
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.hairline.opacity(0.6), lineWidth: 1))
        .padding(.horizontal, 8)
    }

    private func grid(_ current: Prefs) -> some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 132), spacing: 8)], alignment: .leading, spacing: 8) {
            ForEach(Self.effects, id: \.id) { entry in
                let selected = entry.id == current.effect
                Button { save { $0.effect = entry.id } } label: {
                    VStack(alignment: .leading, spacing: 6) {
                        ZStack(alignment: .topLeading) {
                            RoundedRectangle(cornerRadius: 8, style: .continuous).fill(theme.app)
                            if entry.id != "none" {
                                RoundedRectangle(cornerRadius: 8, style: .continuous).fill(gradient(palette(entry.id))).opacity(0.3)
                            }
                            GeometryReader { geometry in
                                let w = geometry.size.width
                                RoundedRectangle(cornerRadius: 6).fill(theme.bubbleUser.opacity(0.9))
                                    .frame(width: w * 0.42, height: 11)
                                    .position(x: w - 8 - w * 0.21, y: 9 + 5.5)
                                VStack(alignment: .leading, spacing: 3) {
                                    Capsule().fill(theme.ink.opacity(0.45)).frame(width: w * 0.62, height: 2)
                                    Capsule().fill(theme.ink.opacity(0.45)).frame(width: w * 0.62 * 0.82, height: 2)
                                    Capsule().fill(theme.inkSecondary.opacity(0.4)).frame(width: w * 0.62 * 0.58, height: 2)
                                }
                                .offset(x: 8, y: 28)
                            }
                        }
                        .frame(height: 78)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(selected ? theme.accentBorder : theme.hairline.opacity(0.6), lineWidth: selected ? 2 : 1))
                        HStack(spacing: 6) {
                            DesktopText(verbatim: Self.name(entry.id)).lineLimit(1)
                            Spacer(minLength: 0)
                            if selected {
                                DesktopSettingsIconView(icon: .check, size: 13).foregroundStyle(theme.accentText)
                            }
                        }
                        .padding(.horizontal, 2)
                    }
                    .padding(6)
                    .background(selected ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: Self.name(entry.id)))
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("desktop-settings.background-effect.\(entry.id)")
            }
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
        // 0.5.6 (SkinPicker.tsx): the picture, the name and a check; the
        // tagline is the tile's accessible description, not drawn
        VStack(alignment: .leading, spacing: 6) {
            miniature(t)
                .frame(height: 78)
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(selected ? theme.accentBorder : t.hairline.opacity(0.6), lineWidth: selected ? 2 : 1))
            HStack(spacing: 6) {
                DesktopText(verbatim: name ?? skin.name)
                    .lineLimit(1)
                Spacer(minLength: 0)
                if selected {
                    DesktopSettingsIconView(icon: .check, size: 13)
                        .foregroundStyle(theme.accentText)
                }
            }
            .padding(.horizontal, 2)
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(selected ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .contentShape(Rectangle())
        .accessibilityHint(Text(LocalizedStringKey(tagline ?? skin.tagline)))
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
                    .buttonStyle(DesktopPillButtonStyle())
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

    @State private var adding = false
    @State private var addStep = "choose"

    /// Settings > Providers (ProvidersSettings.tsx, 2026-10-30): "Providers"
    /// with its help and the Show filter over one card: "Add a provider",
    /// the connected providers as rows (their mark, the name, who pays and
    /// where the key lives, "Connected"), "To connect" folded under its
    /// count, then the cloud coding agents' keys.
    var body: some View {
        DesktopSettingsGroup(Text("Providers"), accessory: AnyView(header), identifier: "providers") {
            if adding {
                addProvider
            } else {
                Button { addStep = "choose"; adding = true } label: {
                    HStack(spacing: 12) {
                        DesktopSettingsIconView(icon: .plus, size: 14)
                        DesktopText(Text("Add a provider"), color: \.accentText)
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(theme.accentText)
                    .padding(.horizontal, 8)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(DesktopHoverFill(radius: 8))
                .padding(.horizontal, 6)
                .accessibilityIdentifier("desktop-settings.providers.add")
            }
            if let all = engines {
                let engines = all.filter { filter == "all" || (filter == "computer") == Self.onThisComputer($0) }
                let ready = engines.filter(\.ready)
                let rest = engines.filter { !$0.ready }
                if ready.isEmpty {
                    DesktopText("No provider connected yet. Add one to start.", color: \.inkSecondary)
                        .padding(.horizontal, 14).padding(.vertical, 8)
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
                    DesktopDescribedRow(Text("To connect"), identifier: "providers.toConnect") {
                        DesktopCountPill(count: rest.count, open: toConnectOpen, label: Text("To connect"), identifier: "desktop-settings.providers.to-connect") {
                            withAnimation(.easeOut(duration: 0.15)) { toConnectOpen.toggle() }
                        }
                    } below: {
                        if toConnectOpen {
                            VStack(spacing: 0) {
                                ForEach(rest) { engine in
                                    providerRow(engine)
                                    if open == engine.id {
                                        DesktopEngineGrid(engines: [engine], open: $open, client: session.settingsClient, reload: { await load() }) { _ in
                                            shell.settingsSection = .connections
                                        }
                                        .padding(.bottom, 10)
                                    }
                                }
                            }
                            .padding(.horizontal, -14)
                            .padding(.top, 8)
                        }
                    }
                }
            } else if let error {
                DesktopText(verbatim: error, color: \.danger).padding(14)
            } else {
                ProgressView().controlSize(.small).padding(14)
            }
            DesktopCloudAgentKeys()
        }
        .task { if engines == nil { await load() } }
    }

    private var header: some View {
        HStack(spacing: 4) {
            DesktopHelpTip(help: Text("A provider is an account, a key or a server. Each row says who pays, where its key lives and what it brings. Bots, Auto and voice only choose among them."))
            Spacer(minLength: 0)
            ForEach([("all", AppStrings.localized("All")), ("mine", AppStrings.localized("Mine")), ("computer", AppStrings.localized("This computer"))], id: \.0) { option in
                Button { filter = option.0 } label: {
                    DesktopText(Text(verbatim: option.1), size: 12, line: 16, color: filter == option.0 ? \.ink : \.inkSecondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(filter == option.0 ? theme.selected : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(filter == option.0 ? .isSelected : [])
                .accessibilityIdentifier("desktop-settings.providers.filter.\(option.0)")
            }
        }
    }

    /// "Add a provider" (AddProvider): an account, a key or a server. An
    /// account opens its row under To connect; a key and a server open
    /// the API keys page, where they are saved.
    private var addProvider: some View {
        VStack(alignment: .leading, spacing: 8) {
            if addStep == "key" || addStep == "server" {
                // the keys and the OpenAI-compatible server, saved on the computer
                AnyView(DesktopAPIKeysSettings())
            } else if addStep == "account" {
                let rest = (engines ?? []).filter { !$0.ready }
                if rest.isEmpty {
                    DesktopText("Every account is connected already.", size: 12.5, color: \.inkSecondary).padding(.horizontal, 8)
                }
                ForEach(rest) { engine in
                    Button {
                        adding = false
                        toConnectOpen = true
                        open = engine.id
                    } label: {
                        HStack(spacing: 12) {
                            DesktopText(verbatim: engine.name).lineLimit(1)
                            Spacer(minLength: 0)
                            DesktopText(engine.providerLine.map { Text(verbatim: $0) } ?? Text("To connect"), size: 12, color: \.inkSecondary).lineLimit(1)
                        }
                        .padding(.horizontal, 8).frame(minHeight: 36).contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 8))
                }
            } else {
                ForEach([("account", Text("Connect an account"), Text("Claude, ChatGPT, Grok, Kimi and the other subscriptions"), DesktopSettingsIcon.user),
                         ("key", Text("Paste a key"), Text("Anthropic, OpenAI, xAI, OpenRouter, Mistral, ElevenLabs, Fish Audio…"), .keyRound),
                         ("server", Text("An OpenAI-compatible server"), Text("Azure AI Foundry, vLLM, a gateway: each server is a provider of its own, under its name"), .monitor)], id: \.0) { way in
                    Button {
                        addStep = way.0
                    } label: {
                        HStack(alignment: .top, spacing: 12) {
                            DesktopSettingsIconView(icon: way.3, size: 14).foregroundStyle(theme.inkSecondary).padding(.top, 2)
                            VStack(alignment: .leading, spacing: 0) {
                                DesktopText(way.1)
                                DesktopText(way.2, size: 12, line: 16, color: \.inkSecondary)
                            }
                            Spacer(minLength: 0)
                        }
                        .padding(8).contentShape(Rectangle())
                    }
                    .buttonStyle(DesktopHoverFill(radius: 8))
                    .accessibilityIdentifier("desktop-settings.providers.add.\(way.0)")
                }
            }
            HStack(spacing: 8) {
                Spacer(minLength: 0)
                if addStep != "choose" {
                    Button("Back") { addStep = "choose" }.buttonStyle(DesktopPillButtonStyle())
                }
                Button("Cancel") { adding = false }.buttonStyle(DesktopPillButtonStyle())
            }
        }
        .padding(8)
        .background(theme.inset.opacity(0.4), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(.horizontal, 6)
        .padding(.bottom, 6)
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
            HStack(spacing: 12) {
                ProviderMarkView(driverKind: engine.driverKind, size: 16)
                    .frame(width: 28, height: 28)
                    .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(Text(verbatim: engine.displayName ?? engine.driverKind)).lineLimit(1)
                    // who pays · where its key is (ProvidersSettings.tsx providerLine)
                    DesktopText(Text(verbatim: Self.detail(engine)), size: 12, line: 16, color: \.inkSecondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                if engine.ready {
                    DesktopText(Text("Connected"), size: 12, weight: .medium, line: 16, color: \.success)
                }
                DesktopSettingsIconView(icon: open == engine.id ? .chevronUp : .chevronDown, size: 13)
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(DesktopHoverFill(radius: 8))
        .padding(.horizontal, 6)
        .accessibilityIdentifier("desktop-settings.provider.\(engine.id)")
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        checking = true
        defer { checking = false }
        do { engines = try await client.desktopEngines() } catch { self.error = error.localizedDescription }
    }
}

/// Cloud coding agents (CloudAgentProvidersSettings.tsx): a folding row of
/// the Providers card, each provider's key saved, tested, replaced or removed.
struct DesktopCloudAgentKeys: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @State private var rows: [CloudAgentProviderRow]?
    @State private var error: String?
    @State private var open = false

    var body: some View {
        Group {
            if let rows, !rows.isEmpty {
                DesktopDescribedRow(
                    Text("Cloud coding agents"),
                    description: CloudAgentProviderRow.anyConfigured(rows) ? Text("At least one provider connected") : Text("No keys saved"),
                    help: Text("Keys you save here are encrypted on this server and used when you launch cloud coding agents (Cursor, Claude Code, Codex). They are never shown again after you save them."),
                    identifier: "connections.cloudAgents"
                ) {
                    DesktopCountPill(count: rows.count, open: open, label: Text("Cloud coding agents"), identifier: "desktop-settings.cloud-agents") {
                        withAnimation(.easeOut(duration: 0.15)) { open.toggle() }
                    }
                } below: {
                    if open {
                        VStack(spacing: 8) {
                            ForEach(rows) { row in DesktopCloudAgentRow(row: row) { await load() } }
                        }
                        .padding(.top, 8)
                    }
                }
            } else if rows == nil, let error {
                DesktopText(verbatim: error, size: 12.5, line: 18, color: \.danger).padding(.horizontal, 14).padding(.vertical, 10)
            }
        }
        Color.clear.frame(height: 0)
            .task { await load() }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        do { rows = try await client.cloudAgentProviders(); error = nil }
        catch { if rows == nil { self.error = AppStrings.localized("Your cloud agent keys could not be loaded. Try again in a moment.") } }
    }
}

struct DesktopCloudAgentRow: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let row: CloudAgentProviderRow
    let changed: () async -> Void
    @State private var token = ""
    @State private var busy = false
    @State private var note: String?
    @State private var editing: Bool?

    var body: some View {
        let isEditing = editing ?? !row.configured
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                VStack(alignment: .leading, spacing: 0) {
                    DesktopText(verbatim: row.label)
                    if row.configured && !isEditing {
                        DesktopText(verbatim: String(format: AppStrings.localized("Saved key ····%@"), row.last4 ?? "····"), size: 12, line: 16, color: \.inkSecondary)
                    }
                }
                Spacer(minLength: 0)
                if row.configured && !isEditing {
                    Button("Test connection") { run { try await $0.testCloudAgentProvider(row.provider, token: nil); return AppStrings.localized("Connection succeeded.") } }
                        .buttonStyle(DesktopPillButtonStyle()).disabled(busy)
                    Button("Replace") { editing = true; note = nil }
                        .buttonStyle(DesktopPillButtonStyle()).disabled(busy)
                    Button { run { try await $0.removeCloudAgentProvider(row.provider); return nil } } label: { Text("Remove").foregroundStyle(theme.danger) }
                        .buttonStyle(DesktopPillButtonStyle()).disabled(busy)
                }
            }
            if isEditing {
                SecureField(text: $token, prompt: Text("Paste an API key or token").foregroundColor(theme.inkSecondary)) { Text("Paste an API key or token") }
                    .font(theme.font(13))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .padding(.horizontal, 10).frame(minHeight: 32)
                    .background(theme.panel, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(theme.border, lineWidth: 1))
                    .accessibilityIdentifier("desktop-settings.cloud-agent.\(row.provider).token")
                HStack(spacing: 8) {
                    Button("Save key") { let value = token; run { try await $0.saveCloudAgentProvider(row.provider, token: value); return nil } }
                        .buttonStyle(DesktopPillButtonStyle(primary: true))
                        .disabled(busy || token.trimmingCharacters(in: .whitespaces).isEmpty)
                    Button("Test connection") { let value = token; run { try await $0.testCloudAgentProvider(row.provider, token: value); return AppStrings.localized("Connection succeeded.") } }
                        .buttonStyle(DesktopPillButtonStyle())
                        .disabled(busy || token.trimmingCharacters(in: .whitespaces).isEmpty)
                    if row.configured {
                        Button("Cancel") { editing = false; token = ""; note = nil }
                            .buttonStyle(DesktopButtonStyle(kind: .ghost)).disabled(busy)
                    }
                }
            }
            if let note { DesktopText(verbatim: note, size: 12, line: 16, color: \.inkSecondary) }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .background(theme.inset, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    private func run(_ work: @escaping (CompanionClient) async throws -> String?) {
        guard let client = session.settingsClient else { return }
        busy = true
        note = nil
        Task {
            defer { busy = false }
            do {
                let said = try await work(client)
                await changed()
                token = ""
                editing = false
                note = said
            } catch {
                note = AppStrings.localized("That did not work. Check the key and try again.")
            }
        }
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
                                .buttonStyle(DesktopPillButtonStyle())
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
                            .buttonStyle(DesktopPillButtonStyle())
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
                        .buttonStyle(DesktopPillButtonStyle())
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
                        .buttonStyle(DesktopPillButtonStyle())
                }
            }
            if method == "paste-code" {
                TextField("Paste the code from that page", text: $pasted)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)
                Button("Finish sign-in") { Task { await finish() } }
                    .buttonStyle(DesktopPillButtonStyle(primary: true))
                    .disabled(busy || pasted.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let raw = auth?.authorizationUrl, let url = EngineSignInLink.allowed(raw) {
                Button("Open sign-in") {
                    openedLink = true
                    openURL(url)
                }
                .buttonStyle(DesktopPillButtonStyle(primary: true))
            }
            Button("Cancel sign-in") { Task { await cancel() } }
                .buttonStyle(DesktopPillButtonStyle())
                .disabled(busy)
        } else if auth?.phase != "succeeded" {
            Button(auth == nil && error == nil ? "Sign in" : "Try again") { Task { await start() } }
                .buttonStyle(DesktopPillButtonStyle(primary: true))
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
                .buttonStyle(DesktopPillButtonStyle(primary: true))
                .disabled(keyBusy || key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            if keyConfigured {
                Button("Remove key") { Task { await saveKey("") } }
                    .buttonStyle(DesktopPillButtonStyle())
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

/// The rows above the Bots' computer group: "Allow control of this
/// computer" (the Mac's Accessibility and Screen Recording, set on the Mac),
/// "Use Messages" and Computer care (Recover or Update now, Reset,
/// Scheduled update, Disk saver).
struct DesktopComputerTopRows: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    @EnvironmentObject private var shell: DesktopShellModel
    @State private var messages: MessagesSetupStatus?
    @State private var macOpen = false
    @State private var messagesError: String?
    @State private var computer: ComputerStatus?
    @State private var maintenance: ComputerMaintenance?
    @State private var careHidden = false
    @State private var careBusy: String?
    @State private var careError: String?
    @State private var confirming: String?
    @State private var preview: DiskSaverPreview?
    @State private var selection: Set<String> = []
    @State private var freed: Double?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
        if messages?.available == true {
            VStack(alignment: .leading, spacing: 0) {
                Button { withAnimation(.easeOut(duration: 0.15)) { macOpen.toggle() } } label: {
                    HStack(spacing: 12) {
                        DesktopSettingsIconView(icon: .shield, size: 15).foregroundStyle(theme.inkSecondary)
                        DesktopText(Text("Allow control of this computer"), weight: .medium, color: \.inkSecondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        DesktopSettingsIconView(icon: .chevronDown, size: 16).foregroundStyle(theme.inkSecondary)
                            .rotationEffect(.degrees(macOpen ? 180 : 0))
                    }
                    .padding(.horizontal, 16).padding(.vertical, 10).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("desktop-settings.mac-control")
                if macOpen {
                    DesktopText(Text("Local computer control is not ready. Sagax needs Accessibility and Screen Recording to use this Mac. Check Driver detail or System Settings, then click Retry."),
                                size: 12.5, line: 20, color: \.inkSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.horizontal, 16).padding(.bottom, 14)
                }
            }
            .desktopHairlineBox(radius: 12)
            .padding(.top, 16)
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            DesktopText(Text("Use Messages"), weight: .medium)
                            DesktopHelpTip(help: Text("Reading Messages needs Full Disk Access for Sagax. Sending needs Automation for Messages. Nothing is sent to someone who is not on the bot's allowed recipients without a card."))
                        }
                        DesktopText(Text("Lets Sagax read and send messages on the Mac where this app runs. Not from a server, and not through another Mac."), size: 12, line: 16, color: \.inkSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    DesktopSwitch(isOn: messages?.useMessages == true, label: Text("Use Messages"), identifier: "desktop-settings.use-messages") {
                        Task { await setMessages(!(messages?.useMessages ?? false)) }
                    }
                }
                Button { shell.modal = .plugins } label: {
                    DesktopText(Text("Open Messages setup in Plugins"), size: 12.5, weight: .medium, color: \.accentText)
                }
                .buttonStyle(.plain)
                if let messagesError { DesktopText(verbatim: messagesError, size: 12, line: 16, color: \.danger) }
            }
            .padding(.horizontal, 16).padding(.vertical, 16)
            .desktopHairlineBox(radius: 12)
            .padding(.top, 16)
        }
        if !careHidden {
            DesktopSettingsGroup(Text("Computer care"), identifier: "computerCare") {
                if let computer, let action = Self.action(computer) {
                    let recover = action == "recover"
                    DesktopDescribedRow(recover ? Text("Recover computer") : Text("Update now"),
                                        description: careBusy == "update" ? (recover ? Text("Recovering… This can take a few minutes.") : Text("Updating… This can take a few minutes."))
                                            : recover ? Text("It is not answering. Recover rebuilds it from the current image: your files stay, installed apps and packages are removed.")
                                                      : Text("Moves the computer to the latest version now. Files and logins stay, installed apps and packages are removed."),
                                        icon: .rotateCcw, identifier: "computerRecover") {
                        Button(recover ? "Recover" : "Update") { confirming = recover ? "recover" : "update" }
                            .buttonStyle(DesktopPillButtonStyle())
                            .disabled(careBusy != nil)
                            .accessibilityIdentifier("desktop-settings.computer-recover")
                    }
                }
                if computer?.configured == true {
                    DesktopDescribedRow(Text("Reset computer"),
                                        description: careBusy == "reset" ? Text("Resetting… This can take a few minutes.")
                                            : Text("Rebuild the computer from the last snapshot. More than an update: anything set up since the snapshot is lost. Use it only when Update does not fix the problem."),
                                        icon: .rotateCcw, identifier: "computerReset") {
                        Button { confirming = "reset" } label: { Text("Reset").fontWeight(.medium).foregroundStyle(Color.white) }
                            .buttonStyle(DesktopDangerButtonStyle())
                            .disabled(careBusy != nil)
                            .accessibilityIdentifier("desktop-settings.computer-reset")
                    }
                }
                DesktopDescribedRow(Text("Scheduled update"), description: Text(verbatim: maintenanceSummary),
                                    help: Text("Rebuilds the bot's computer from the current image in a maintenance window, which updates its system and packages. Its working folder is kept. It never runs while the computer is in use: it waits inside the window, and is postponed to the next one when the computer stays busy."),
                                    identifier: "maintenance") {
                    DesktopSwitch(isOn: maintenance?.schedule.enabled == true, label: Text("Scheduled update"), identifier: "desktop-settings.scheduled-update",
                                  disabled: maintenance == nil || careBusy == "schedule") {
                        Task { await toggleSchedule() }
                    }
                }
                DesktopDescribedRow(Text("Disk saver"), description: Text("Measures caches and old files on the bot's computer and shows what a cleanup would free. Nothing is deleted until you choose."), icon: .hardDrive, identifier: "diskSaver") {
                    Button { Task { await scan() } } label: {
                        HStack(spacing: 6) {
                            DesktopSettingsIconView(icon: .refreshCw, size: 12)
                            Text(preview == nil ? "Analyze" : "Analyze again")
                        }
                    }
                    .buttonStyle(DesktopPillButtonStyle())
                    .disabled(careBusy == "scan" || careBusy == "clean")
                    .accessibilityIdentifier("desktop-settings.disk-saver")
                    if let preview, !selection.isEmpty {
                        Button(String(format: AppStrings.localized("Free %@"), Self.size(preview.bytes(of: selection)))) { confirming = "clean" }
                            .buttonStyle(DesktopPillButtonStyle())
                            .disabled(careBusy == "clean")
                    }
                } below: {
                    if let preview {
                        VStack(alignment: .leading, spacing: 6) {
                            if !preview.computerRunning {
                                DesktopText(Text("The bot's computer is not running, so only this server's files were measured. Start it to measure its caches."), size: 12, line: 16, color: \.inkSecondary)
                            }
                            ForEach(preview.items) { item in
                                HStack(spacing: 8) {
                                    DesktopCheckbox(checked: selection.contains(item.id), label: Text(verbatim: Self.diskLabel(item.id)), disabled: item.bytes <= 0) {
                                        if selection.contains(item.id) { selection.remove(item.id) } else { selection.insert(item.id) }
                                    }
                                    DesktopText(verbatim: Self.diskLabel(item.id), size: 12.5)
                                    if item.userFiles { DesktopText(Text("your files"), size: 12, color: \.danger) }
                                    Spacer(minLength: 0)
                                    DesktopText(verbatim: Self.size(item.bytes), size: 12, color: \.inkSecondary).monospacedDigit()
                                }
                            }
                            if let freed { DesktopText(verbatim: String(format: AppStrings.localized("Freed %@."), Self.size(freed)), size: 12, color: \.success) }
                        }
                        .padding(.top, 8)
                    }
                }
                if let careError {
                    DesktopText(verbatim: careError, size: 12, line: 16, color: \.danger).padding(.horizontal, 14).padding(.bottom, 8)
                }
            }
            .confirmationDialog(Text(verbatim: confirmText), isPresented: Binding(get: { confirming != nil }, set: { if !$0 { confirming = nil } }), titleVisibility: .visible) {
                Button(confirming == "clean" ? AppStrings.localized("Delete") : confirming == "reset" ? AppStrings.localized("Reset") : AppStrings.localized("Confirm"), role: .destructive) {
                    let what = confirming
                    confirming = nil
                    Task { await run(what) }
                }
                Button("Cancel", role: .cancel) { confirming = nil }
            }
        }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await load() }
    }

    static func action(_ status: ComputerStatus) -> String? {
        guard status.configured else { return nil }
        if ComputerCare.needsRecover(configured: status.configured, state: status.state, problem: status.problem, waking: status.waking != nil) { return "recover" }
        if status.waking != nil { return nil }
        return ["running", "ready", "idle"].contains(status.state) ? "update" : nil
    }

    private var confirmText: String {
        switch confirming {
        case "recover": AppStrings.localized("Recover your bots' computer? It is rebuilt from the current image: your files and logins stay, installed apps and packages are removed. It waits until no bot is working on it.")
        case "update": AppStrings.localized("Update your bots' computer now? It moves to the latest version: your files and logins stay, installed apps and packages are removed. It waits until no bot is working on it.")
        case "reset": AppStrings.localized("Reset your bots' computer? It is rebuilt from the last snapshot. This is more than an update: anything set up since is lost, and it cannot be undone.")
        case "clean":
            if let preview, preview.touchesUserFiles(selection) {
                String(format: AppStrings.localized("Delete the selected items (%@), including everything in the trash of the bot's computer? Files in the trash cannot be recovered."), Self.size(preview.bytes(of: selection)))
            } else {
                String(format: AppStrings.localized("Delete the selected caches and old files (%@)? Your working folder is not touched."), Self.size(preview?.bytes(of: selection) ?? 0))
            }
        default: ""
        }
    }

    private var maintenanceSummary: String {
        guard let maintenance else { return AppStrings.localized("Loading…") }
        if maintenance.running { return AppStrings.localized("Updating now…") }
        if maintenance.schedule.enabled, let next = maintenance.nextWindowAt {
            let when = Date(timeIntervalSince1970: next / 1000).formatted(date: .abbreviated, time: .shortened)
            return String(format: AppStrings.localized("Next window: %@."), when)
        }
        return AppStrings.localized("Off. Update the computer yourself from its menu.")
    }

    static func size(_ bytes: Double) -> String { ByteCountFormatter.string(fromByteCount: Int64(bytes), countStyle: .file) }

    static func diskLabel(_ id: String) -> String {
        switch id {
        case "packageCaches": AppStrings.localized("Package caches (pip, npm, pnpm, yarn, Go, Cargo)")
        case "browserCache": AppStrings.localized("Browser cache")
        case "thumbnails": AppStrings.localized("Thumbnails")
        case "tempFiles": AppStrings.localized("Temporary files older than a day")
        case "trash": AppStrings.localized("Trash")
        default: AppStrings.localized("Turn checkpoints older than 30 days (those turns can no longer be undone)")
        }
    }

    private func load() async {
        guard let client = session.settingsClient else { return }
        messages = try? await client.messagesSetup()
        computer = try? await client.computerStatus()
        do { maintenance = try await client.computerMaintenance() }
        catch let APIError.status(code, _) where [403, 404, 409].contains(code) { careHidden = true }
        catch {}
    }

    private func setMessages(_ on: Bool) async {
        guard let client = session.settingsClient else { return }
        messagesError = nil
        do { messages = try await client.setMessagesEnabled(on) } catch { messagesError = error.localizedDescription }
    }

    private func toggleSchedule() async {
        guard let client = session.settingsClient, var schedule = maintenance?.schedule else { return }
        careBusy = "schedule"
        defer { careBusy = nil }
        schedule.enabled.toggle()
        schedule.timeZone = TimeZone.current.identifier
        do { maintenance = try await client.setComputerMaintenance(schedule) } catch { careError = error.localizedDescription }
    }

    private func scan() async {
        guard let client = session.settingsClient else { return }
        careBusy = "scan"
        careError = nil
        freed = nil
        defer { careBusy = nil }
        do {
            let next = try await client.diskSaverPreview()
            preview = next
            selection = next.defaultSelection
        } catch { careError = error.localizedDescription }
    }

    private func run(_ what: String?) async {
        guard let client = session.settingsClient, let what else { return }
        careError = nil
        careBusy = what == "recover" ? "update" : what
        defer { careBusy = nil }
        do {
            switch what {
            case "recover", "update": computer = try await client.updateComputer()
            case "reset": computer = try await client.resetComputer()
            case "clean":
                guard let preview else { return }
                let result = try await client.diskSaverClean(selection, userFiles: preview.touchesUserFiles(selection))
                freed = result.freedBytes
                self.preview = result.preview
                selection = result.preview.defaultSelection
            default: break
            }
        } catch {
            careError = what == "reset" ? AppStrings.localized("The computer could not be reset. Try again.")
                : what == "clean" ? error.localizedDescription
                : what == "recover" ? AppStrings.localized("The computer could not be recovered. Try again.")
                : AppStrings.localized("The computer could not be updated. Try again.")
        }
    }
}

/// `DANGER_PILL`: the filled red pill of a reset that erases.
struct DesktopDangerButtonStyle: ButtonStyle {
    @Environment(\.desktopTheme) private var theme
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(theme.font(13, .medium))
            .padding(.horizontal, 12)
            .frame(height: 31.5)
            .background(theme.danger.opacity(configuration.isPressed ? 0.85 : 1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .opacity(enabled ? 1 : 0.5)
    }
}

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
        // LocalComputerSection.tsx: control of the Mac, Messages, Computer
        // care, then the Bots' computer group and its folded cards
        AnyView(DesktopComputerTopRows())
        DesktopSettingsGroup(Text("Bots' computer"), identifier: "botsComputer") {
            DesktopDescribedRow(Text("Local VM"), description: ready ? Text(verbatim: "✓ ") + statusText : Text(verbatim: "○ ") + statusText, identifier: "localVm") {
                Button { Task { await load() } } label: {
                    HStack(spacing: 6) {
                        DesktopSettingsIconView(icon: .refreshCw, size: 12)
                        Text("Re-check")
                    }
                }
                .buttonStyle(DesktopPillButtonStyle())
                .disabled(loading || pending != nil)
                .accessibilityIdentifier("desktop-settings.vm-recheck")
            } below: {
                if let error {
                    DesktopText(verbatim: error, size: 12, line: 16, color: \.danger).padding(.top, 8)
                }
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

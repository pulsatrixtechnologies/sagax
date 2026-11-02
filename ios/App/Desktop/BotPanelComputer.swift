// iPad I4: the bot panel's Computer tab (`ComputerPanel` embedded, as the
// reference draws it): "Ara's screen" 13 secondary at y 313, the 16:10
// screen in a `bg-card` frame (radius 6) with the live picture or the power
// glyph and "This bot's computer is off", then the "Allow control of this
// computer" section (rounded-xl, hairline/40, shield glyph, chevron) that
// opens on Take control / Release and the full computer view. The picture
// and control are the phone's ComputerController (POST
// /api/bots/:id/computer/{screenshot,control}), the stream's frames first.
// On an organization server, Local VM and This computer use
// LocalVmComputerPanel instead: a still and power buttons, no Take control.
// Cloud uses SandboxDesktopScreen (the desktop's SandboxDesktopView). There
// `ComputerChooser` on top lists Cloud and Other VMs; the host name sits
// under Other VMs. iOS offers no Browser entry (the desktop keeps its own).
import SwiftUI
import UIKit
import CompanionCore

struct BotPanelComputer: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let bot: Bot

    @StateObject private var controller: ComputerController
    @StateObject private var choices = ComputerChoicesModel()
    @StateObject private var remoteHosts: BotRemoteSessionsModel
    /// The screen the person picked, or browser mode; nil is the one the
    /// bot works on.
    @State private var picked: String?
    @State private var config: ConfigStatus?
    @State private var controlOpen = false
    @State private var fullView = false

    init(bot: Bot) {
        self.bot = bot
        _controller = StateObject(wrappedValue: ComputerController(botId: bot.id, client: { nil }))
        _remoteHosts = StateObject(wrappedValue: BotRemoteSessionsModel(botId: bot.id))
    }

    private var streamFrame: ScreenFrame? { session.state.screens[bot.id] }
    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var showsLocalVm: Bool {
        OrgLocalVmScreen.shows(worksOn: DesktopWorksOn.of(current), organization: session.surfaceGate.organization)
    }
    private var worksOn: DesktopWorksOn { DesktopWorksOn.of(bot) }
    private var polls: Bool { DesktopComputerPhase.polls(worksOn) }
    private var phase: DesktopComputerPhase { DesktopComputerPhase.of(worksOn: worksOn, hasPicture: controller.image != nil) }
    private var offline: Bool {
        if case .live = session.status { return false }
        return true
    }

    /// The screen shown once the person's desktops are known.
    private var chosen: ComputerChoice? {
        guard session.surfaceGate.organization else { return nil }
        return choices.bridge?.chosen(worksOnLocal: showsLocalVm, picked: picked)
    }

    private var showsLocal: Bool {
        if let chosen { return chosen != .cloud }
        return showsLocalVm
    }

    /// The bots' browser is never offered on iOS (owner, 2026-10-15): no
    /// Browser entry in the chooser and no live browser in place of the
    /// screen. The desktop keeps its own.
    private var browserOffered: Bool { false }

    /// Browser mode: picked, or the bot works on its browser and nothing
    /// else was picked.
    private var showsBrowser: Bool {
        guard browserOffered else { return false }
        return picked == ComputerChooser.browserKey || (picked == nil && DesktopWorksOn.of(current) == .browser)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            AnyView(chooser)
            if showsBrowser {
                BrowserLiveView(bot: current, secondary: theme.inkSecondary, track: theme.control)
                    .padding(.top, 16)
                    .padding(.leading, 17)
                    .padding(.trailing, 16)
                    .padding(.bottom, 24)
                    .accessibilityIdentifier("desktop-panel-browser")
            } else if showsLocal {
                LocalVmComputerPanel(name: current.name, chrome: .pad(theme), desktopId: chosen?.desktopId, computerName: chosen?.name)
                    .id(chosen?.key ?? "current")
                    .padding(.top, 16)
                    .padding(.leading, 17)
                    .padding(.trailing, 16)
                    .padding(.bottom, 24)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("desktop-panel-computer")
            } else if session.surfaceGate.organization {
                sandbox
            } else {
                cloud
            }
        }
        .onAppear {
            if session.surfaceGate.organization { choices.start { [weak session] in session?.computerClient } }
            remoteHosts.start(client: session.profileClient ?? session.settingsClient)
        }
        .onDisappear {
            choices.stop()
            remoteHosts.stop()
        }
        .task { config = await session.configStatus() }
    }

    /// Cloud, the person's computers, and enrolled unattended hosts, when
    /// there is more than one screen to look at.
    @ViewBuilder
    private var chooser: some View {
        let items = ComputerChooser.items(
            bridge: choices.bridge,
            organization: session.surfaceGate.organization,
            worksOnLocal: showsLocalVm,
            browser: browserOffered,
            remoteHosts: remoteHosts.places
        )
        if items.count > 1 {
            VStack(spacing: 6) {
                ComputerChooser(
                    items: items,
                    chosen: selectedChooserKey,
                    colors: .init(ink: theme.ink, secondary: theme.inkSecondary, track: theme.control, selected: theme.elevated, dot: theme.focus),
                    onAttachHost: { hostId in Task { await remoteHosts.attach(hostId: hostId) } },
                    onDetachHost: { hostId in Task { await remoteHosts.detach(hostId: hostId) } }
                ) { key in
                    if let hostId = RemoteBotHostsLogic.parsePlaceKey(key) {
                        picked = key
                        let place = remoteHosts.places.first { $0.hostId == hostId }
                        if place?.attached == true {
                            Task { await remoteHosts.open(hostId: hostId) }
                        } else {
                            Task { await remoteHosts.attach(hostId: hostId) }
                        }
                        return
                    }
                    picked = ComputerChooser.resolvePick(key, bridge: choices.bridge, current: chosen)
                }
                ComputerChooser.provenance(
                    bridge: choices.bridge, chosen: showsBrowser || isRemoteHostPick ? nil : chosen,
                    pick: { picked = $0 },
                    secondary: theme.inkSecondary
                )
            }
            .padding(.top, 16)
            .padding(.horizontal, 16)
            .accessibilityIdentifier("computer-picker-with-hosts")
        }
    }

    private var isRemoteHostPick: Bool {
        guard let picked else { return false }
        return RemoteBotHostsLogic.parsePlaceKey(picked) != nil
    }

    private var selectedChooserKey: String {
        if let picked, RemoteBotHostsLogic.parsePlaceKey(picked) != nil { return picked }
        return ComputerChooser.selectedKey(showsBrowser: showsBrowser, chosen: chosen)
    }

    private var sandbox: some View {
        SandboxDesktopScreen(
            botName: current.name,
            ink: theme.ink,
            secondary: theme.inkSecondary,
            card: theme.card
        )
        .padding(.top, 16)
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-computer")
    }

    private var cloud: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("\(bot.name)'s screen")
                .font(theme.font(13))
                .foregroundStyle(theme.inkSecondary)
                .frame(height: 19.5)
            AnyView(screen)
                .padding(.top, 6)
            AnyView(controlSection)
                .padding(.top, 16)
            if let notice = controller.notice {
                Text(verbatim: notice)
                    .font(theme.font(12))
                    .foregroundStyle(theme.inkSecondary)
                    .padding(.top, 8)
            }
        }
        .padding(.top, 16)
        .padding(.leading, 17)
        .padding(.trailing, 16)
        .padding(.bottom, 24)
        .onAppear {
            controller.attach { [weak session] in session?.computerClient }
            session.watchScreen(of: bot.id)
            controller.streamFrame(streamFrame?.data)
            // Auto, Off and Browser never create or wake a computer
            if polls { controller.appear() }
        }
        .onDisappear {
            if polls { controller.disappear() }
            session.stopWatchingScreen(of: bot.id)
        }
        .onValueChange(of: streamFrame) { controller.streamFrame($0?.data) }
        .sheet(isPresented: $fullView) {
            NavigationStack { ComputerView(bot: bot) }
                .environmentObject(session)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("desktop-panel-computer")
    }

    private var screen: some View {
        ZStack {
            theme.card
            if phase == .picture, let image = controller.image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .accessibilityLabel(Text("\(bot.name)'s screen"))
            } else {
                VStack(spacing: 8) {
                    switch phase {
                    case .browser:
                        Image(systemName: "globe").font(.system(size: 19))
                        Text("This bot works in the built-in browser: no desktop here")
                    case .waiting:
                        ProgressView().controlSize(.small)
                        Text(offline ? "This computer is offline" : "Starting your bot's computer…")
                    case .off, .picture:
                        Image(systemName: "power").font(.system(size: 19, weight: .regular))
                        Text("This bot's computer is off")
                    }
                }
                .font(theme.font(12))
                .multilineTextAlignment(.center)
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 24)
            }
        }
        .aspectRatio(16 / 10, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .contentShape(Rectangle())
        .onTapGesture { if controller.image != nil { fullView = true } }
    }

    private var controlSection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { controlOpen.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "shield")
                        .font(.system(size: 13))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(width: 15)
                    Text("Allow control of this computer")
                        .font(theme.font(13, .medium))
                        .foregroundStyle(theme.inkSecondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.down")
                        .font(.system(size: 12))
                        .foregroundStyle(theme.inkSecondary)
                        .rotationEffect(.degrees(controlOpen ? 180 : 0))
                }
                .padding(.horizontal, 17)
                .frame(height: 41.5)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("desktop-computer-control")
            if controlOpen {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Take control to move the pointer and type on this computer from this iPad. The bot waits while you hold it.")
                        .font(theme.font(12.5))
                        .foregroundStyle(theme.inkSecondary)
                        .lineSpacing(3)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        if controller.isHeld {
                            PanelButton(title: "Release control", systemImage: "hand.raised.slash", prominent: true) {
                                Task { await controller.releaseControl() }
                            }
                        } else {
                            PanelButton(title: "Take control", systemImage: "cursorarrow.rays", prominent: true,
                                        disabled: controller.noComputer || offline || controller.phase == .taking) {
                                Task { await controller.takeControl() }
                            }
                        }
                        PanelButton(title: "Open full view", systemImage: "arrow.up.left.and.arrow.down.right") { fullView = true }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.hairline40, lineWidth: 1))
    }
}

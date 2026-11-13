// A bot's computer, live, and driven from the phone (parity 13 and 11).
//
// Black screen, a glass top bar (back, the bot's 24 pt mascot and name, "?"
// for the gestures, "..." for control and view options), the remote screen
// full width at 16:10, and the clipboard and keyboard circles under it.
//
// Watching costs nothing extra: frames come from the event stream while this
// view is on screen (`watchScreen`). Taking control turns the frame into a
// trackpad and the keyboard button into a remote keyboard; while held the
// picture is also refreshed with direct captures, faster than the stream.
// See `ComputerController` for the wire side.
//
// On an organization server, Works on Local VM or This computer does not
// use that viewer. `LocalVmComputerPanel` below shows a still and the
// power buttons, and it never takes control. Cloud uses `SandboxDesktopScreen`
// (GET /api/desktop-viewer/sandbox/me), because POST computer/screenshot
// answers 409 org_user_sandbox. `ComputerChooser` above the screen lists
// Cloud and Other VMs (no Browser on iOS); the host name sits under Other VMs.
import SwiftUI
import CompanionCore
import UIKit

enum ComputerFit: String { case fit, fill }

struct ComputerView: View {
    @Environment(\.themePalette) var themePalette
    let bot: Bot
    @EnvironmentObject private var session: Session
    @Environment(\.dismiss) private var dismiss
    @StateObject private var controller: ComputerController
    @State private var keyboardUp = false
    @State private var showingHelp = false
    @State private var confirmingDesktop = false
    @State private var openingDesktop = false
    @State private var desktopURL: URL?
    @StateObject private var choices = ComputerChoicesModel()
    /// The screen the person picked (`ComputerChoice.key`, or browser
    /// mode's key); nil is the one the bot works on.
    @State private var picked: String?
    @State private var config: ConfigStatus?
    @AppStorage("companion.computer.fit") private var fitRaw = ComputerFit.fit.rawValue
    @AppStorage("companion.computer.specialKeys") private var specialKeys = false

    /// The bot panel's Computer tab (`ComputerPanel` embedded): the picture
    /// at this width in a rounded black card, with Gestures, More and Full
    /// screen above it; nil is the full screen view (parity 13 and 11).
    var embeddedWidth: CGFloat?
    /// Embedded: open the full screen view.
    var onFullScreen: (() -> Void)?

    init(bot: Bot, embeddedWidth: CGFloat? = nil, onFullScreen: (() -> Void)? = nil) {
        self.bot = bot
        self.embeddedWidth = embeddedWidth
        self.onFullScreen = onFullScreen
        _controller = StateObject(wrappedValue: ComputerController(botId: bot.id, client: { nil }))
        _screen = ObservedObject(wrappedValue: ScreenStore.shared.screen(bot.id))
    }

    /// Embedded in the bot panel the card follows the app's navy theme (the
    /// name card and tab bar colours); the full screen view stays black.
    private var cardBackdrop: Color { embeddedWidth == nil ? Theme.bgComputer : Theme.card }
    private var frameBackdrop: Color { embeddedWidth == nil ? Theme.Computer.frameEmpty : Theme.bg }
    private var glassFill: Color { embeddedWidth == nil ? Theme.Computer.glassFill : Theme.cardRaised }
    private var panelInk: Color { isEmbeddedPanel ? Theme.textPrimary : Theme.Computer.ink }
    private var panelInkSecondary: Color { isEmbeddedPanel ? Theme.textSecondary : Theme.Computer.inkSecondary }

    private var fit: ComputerFit { ComputerFit(rawValue: fitRaw) ?? .fit }
    /// The screen from its own store, so a frame redraws only the views
    /// that draw it (#3017, L01).
    @ObservedObject private var screen: BotScreen
    private var streamFrame: ScreenFrame? { screen.frame ?? session.state.screens[bot.id] }
    private var isEmbeddedPanel: Bool { embeddedWidth != nil }

    /// The bot as the stream last described it.
    private var current: Bot { session.state.bot(bot.id) ?? bot }
    private var offline: Bool {
        if case .live = session.status { return false }
        return true
    }
    private var canOpenLiveDesktop: Bool {
        current.computer == "cloud" && current.cloudBackend != "vps" && session.canAdminister
    }

    private var showsLocalVm: Bool {
        OrgLocalVmScreen.shows(worksOn: DesktopWorksOn.of(current), organization: session.surfaceGate.organization)
    }

    /// The screen shown on an organization server once the person's
    /// desktops are known: the bot's own, or the one picked.
    private var chosen: ComputerChoice? {
        guard session.surfaceGate.organization else { return nil }
        return choices.bridge?.chosen(worksOnLocal: showsLocalVm, picked: picked)
    }

    /// A Local VM is on screen: the one picked, else the bot's own (Works on
    /// Local VM or This computer, connected or not).
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
        Group { screens }
            .onAppear {
                if session.surfaceGate.organization { choices.start { [weak session] in session?.computerClient } }
            }
            .onDisappear { choices.stop() }
            .task { config = await session.configStatus() }
    }

    @ViewBuilder
    private var screens: some View {
        if showsBrowser {
            browserScreen
        } else if showsLocal {
            localVmScreen
        } else if session.surfaceGate.organization {
            sandboxScreen
        } else if let embeddedWidth {
            VStack(spacing: 12) {
                AnyView(chooser(dark: false))
                AnyView(lifecycle(AnyView(embedded(width: embeddedWidth))))
            }
        } else {
            AnyView(lifecycle(AnyView(fullScreen))
                .toolbar(.hidden, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
                .background(SwipeBackBridge())
                .preferredColorScheme(.dark))
        }
    }

    /// Organization Local VM: the same still the desktop Computer tab shows.
    /// The cloud viewer (and its Take control lease) stays unmounted.
    @ViewBuilder
    private var localVmScreen: some View {
        if let embeddedWidth {
            VStack(spacing: 12) {
                AnyView(chooser(dark: false))
                localVmPanel
                    .frame(width: embeddedWidth)
                    .background(cardBackdrop, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("panel-computer")
            }
        } else {
            orgImmersiveScreen {
                localVmPanel
                    .padding(.horizontal, Theme.PhonePanel.margin)
            }
        }
    }

    /// The Local VM shown: the one picked by name, else the person's current
    /// computer. A new computer starts over (its own status and stills).
    private var localVmPanel: some View {
        LocalVmComputerPanel(
            name: current.name,
            chrome: isEmbeddedPanel ? .panel : .phone,
            desktopId: chosen?.desktopId,
            computerName: chosen?.name
        )
        .id(chosen?.key ?? "current")
    }

    /// Organization full-screen computer stages share floating chrome in
    /// landscape (back, screen picker) over the picture.
    private func orgImmersiveScreen<Content: View>(@ViewBuilder content: @escaping () -> Content) -> some View {
        ComputerImmersiveShell(
            top: {
                HStack {
                    GlassCircleButton(
                        systemImage: "chevron.left", fill: Theme.Computer.glassFill, accessibilityLabel: "Back",
                        glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25), glyphColor: Theme.Computer.ink
                    ) { dismiss() }
                        .accessibilityIdentifier("computer-back")
                    Spacer(minLength: 0)
                }
            },
            bottom: { EmptyView() },
            content: {
                // under the floating back control, not behind it: the shell's
                // bars no longer draw a band that hid the stage's top (#4101)
                VStack(spacing: 12) {
                    AnyView(chooser(dark: true))
                        .padding(.horizontal, Theme.PhonePanel.margin)
                    content()
                }
                .padding(.top, Theme.PhonePanel.barCentre + Theme.Metric.glassLarge / 2 + 12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
        )
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden(true)
        .background(SwipeBackBridge())
        .preferredColorScheme(.dark)
    }

    /// Organization Cloud: the server-environment desktop (SandboxDesktopView).
    /// The bot screenshot path is not mounted; it 409s with org_user_sandbox.
    @ViewBuilder
    private var sandboxScreen: some View {
        if let embeddedWidth {
            VStack(spacing: 12) {
                AnyView(chooser(dark: false))
                SandboxDesktopScreen(
                    botName: current.name,
                    ink: Theme.textPrimary,
                    secondary: Theme.textSecondary,
                    card: Theme.card
                )
                .frame(width: embeddedWidth)
                .accessibilityIdentifier("panel-computer")
            }
        } else {
            orgImmersiveScreen {
                SandboxDesktopScreen(
                    botName: current.name,
                    ink: Theme.Computer.ink,
                    secondary: Theme.Computer.inkSecondary,
                    card: Theme.Computer.frameEmpty
                )
                .padding(.horizontal, Theme.PhonePanel.margin)
            }
        }
    }

    /// Cloud and each of the person's computers (an organization server),
    /// then Browser, when there is more than one choice. `dark`: on the
    /// black full screen view rather than the panel's page.
    @ViewBuilder
    private func chooser(dark: Bool) -> some View {
        let items = ComputerChooser.items(bridge: choices.bridge, organization: session.surfaceGate.organization,
                                          worksOnLocal: showsLocalVm, browser: browserOffered)
        if items.count > 1 {
            VStack(alignment: dark ? .center : .leading, spacing: 6) {
                ComputerChooser(
                    items: items,
                    chosen: ComputerChooser.selectedKey(showsBrowser: showsBrowser, chosen: chosen),
                    colors: dark
                        ? .init(ink: Theme.Computer.ink, secondary: Theme.Computer.ink.opacity(0.6), track: Theme.Computer.glassFill,
                                selected: Theme.Computer.ink.opacity(0.18), dot: Theme.accent)
                        : .init(ink: Theme.textPrimary, secondary: Theme.textSecondary, track: Theme.card,
                                selected: Theme.cardRaised, dot: Theme.accent)
                ) { picked = ComputerChooser.resolvePick($0, bridge: choices.bridge, current: chosen) }
                ComputerChooser.provenance(
                    bridge: choices.bridge, chosen: showsBrowser ? nil : chosen,
                    pick: { picked = $0 },
                    secondary: dark ? Theme.Computer.ink.opacity(0.6) : Theme.textSecondary
                )
            }
            // Embedded in the profile sheet, the picker's horizontal scroll
            // view would take the sheet's full width and start at its edge;
            // it takes the screen's own width, which the sheet already
            // insets by `Theme.Profile.cardMargin`.
            .frame(width: dark ? nil : embeddedWidth, alignment: .leading)
        }
    }

    /// Browser mode: the bot's live browser in place of the screen.
    @ViewBuilder
    private var browserScreen: some View {
        if let embeddedWidth {
            VStack(spacing: 12) {
                AnyView(chooser(dark: false))
                BrowserLiveView(bot: current, secondary: Theme.textSecondary, track: Theme.card)
                    .frame(width: embeddedWidth)
                    .accessibilityIdentifier("panel-computer")
            }
        } else {
            orgImmersiveScreen {
                BrowserLiveView(bot: current, secondary: Theme.Computer.ink.opacity(0.6), track: Theme.Computer.glassFill)
                    .padding(.horizontal, Theme.PhonePanel.margin)
            }
        }
    }

    /// The panel's card: Gestures, More and Full screen, the picture, its
    /// status line and the clipboard and keyboard circles.
    private func embedded(width: CGFloat) -> some View {
        let inner = width - 24
        return VStack(spacing: 0) {
            HStack(spacing: 8) {
                Text("\(current.name)'s screen")
                    .font(Theme.Profile.labelFont)
                    .foregroundStyle(Theme.textSecondary)
                    .lineLimit(1)
                Spacer(minLength: 8)
                GlassCircleButton(
                    systemImage: "questionmark", fill: glassFill, accessibilityLabel: "Gestures",
                    glyphSize: 20, weight: .regular, glyphColor: Theme.textPrimary
                ) { showingHelp = true }
                    .accessibilityIdentifier("computer-help")
                moreMenu
                if let onFullScreen {
                    GlassCircleButton(
                        systemImage: "arrow.up.left.and.arrow.down.right", fill: glassFill,
                        accessibilityLabel: "Full screen", glyphSize: 16, weight: .regular, glyphColor: Theme.textPrimary
                    ) { onFullScreen() }
                        .accessibilityIdentifier("computer-full-screen")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            screen(width: inner, height: inner / Theme.Computer.frameAspect)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            statusLine
            bottomButtons
                .padding(.horizontal, Theme.Metric.screenEdge)
                .padding(.vertical, 12)
            RemoteKeyboardField(
                isActive: $keyboardUp,
                showsSpecialKeys: specialKeys,
                modifiers: controller.modifiers,
                onInsert: { controller.type($0) },
                onDelete: { controller.deleteBackward() },
                onSpecial: { controller.special($0) },
                onModifier: { controller.toggle($0) }
            )
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .accessibilityHidden(true)
        }
        .frame(width: width)
        .background(cardBackdrop, in: RoundedRectangle(cornerRadius: Theme.Metric.cardRadius, style: .continuous))
        .overlay(alignment: .top) { toast.padding(.top, 4) }
        .onAppear { controller.frameWidth = inner }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("panel-computer")
    }

    private var fullScreen: some View {
        ComputerImmersiveShell(
            top: { topBar },
            bottom: {
                VStack(spacing: 0) {
                    statusLine
                    bottomButtons
                }
            },
            content: {
                GeometryReader { proxy in
                    let size = ComputerPictureLayout.fit(in: proxy.size)
                    screen(width: size.width, height: size.height)
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .onAppear { controller.frameWidth = size.width }
                        .onValueChange(of: proxy.size) {
                            controller.frameWidth = ComputerPictureLayout.fit(in: $0).width
                        }
                }
            }
        )
        .overlay(alignment: .top) {
            toast
                .padding(.top, 6 - (Theme.Computer.toastSize.height - Theme.Metric.glassLarge) / 2)
        }
        .overlay {
            RemoteKeyboardField(
                isActive: $keyboardUp,
                showsSpecialKeys: specialKeys,
                modifiers: controller.modifiers,
                onInsert: { controller.type($0) },
                onDelete: { controller.deleteBackward() },
                onSpecial: { controller.special($0) },
                onModifier: { controller.toggle($0) }
            )
            .frame(width: 1, height: 1)
            .opacity(0.01)
            .accessibilityHidden(true)
        }
    }

    /// What both forms share: the prompts, the stream, the parity hooks.
    private func lifecycle(_ content: AnyView) -> some View {
        content
        .sheet(isPresented: $showingHelp) { ComputerGestureHelp() }
        .alert(item: $controller.prompt) { prompt in
            switch prompt {
            case .takeControl:
                Alert(
                    title: Text("Take control?"),
                    message: Text("You need control of \(current.name)'s computer to use it. The bot waits while you have it."),
                    primaryButton: .default(Text("Take control")) { Task { await controller.takeControl() } },
                    secondaryButton: .cancel()
                )
            case .heldElsewhere:
                Alert(title: Text("Someone else has control"),
                      message: Text("Another device holds control of this computer. Try again once it is released."))
            case let .message(text):
                Alert(title: Text(text))
            }
        }
        .alert("Open live desktop?", isPresented: $confirmingDesktop) {
            Button("Cancel", role: .cancel) {}
            Button("Open desktop") { Task { await openDesktop() } }
        } message: {
            Text("This gives this device full control of the cloud computer, including anything signed in inside it.")
        }
        .sheet(isPresented: Binding(get: { desktopURL != nil }, set: { if !$0 { desktopURL = nil } })) {
            if let desktopURL {
                CloudDesktopBrowser(url: desktopURL).ignoresSafeArea()
            }
        }
        .onAppear {
            controller.attach { [weak session] in session?.computerClient }
            session.watchScreen(of: bot.id)
            controller.streamFrame(streamFrame?.data)
            controller.appear()
        }
        .onDisappear {
            keyboardUp = false
            controller.disappear()
            session.stopWatchingScreen(of: bot.id)
        }
        .onValueChange(of: streamFrame) { controller.streamFrame($0?.data) }
        .onValueChange(of: controller.phase) { phase in
            if phase != .held { keyboardUp = false }
        }
        .task {
#if DEBUG
            // Parity 13 and 11: in control with the keyboard up; 11 keeps
            // the trackpad toast for its screenshot.
            if let screen = ParityLaunch.current?.screen, screen.opensComputer {
                controller.pinsToast = screen == .computerTrackpadToast
                await controller.takeControl()
                keyboardUp = true
            }
#endif
        }
    }

    // MARK: Top bar

    private var topBar: some View {
        HStack(spacing: 0) {
            GlassCircleButton(
                systemImage: "chevron.left", fill: glassFill, accessibilityLabel: "Back",
                glyphSize: 18, glyphOffset: CGSize(width: 0.85, height: -0.25), glyphColor: Theme.Computer.ink
            ) { dismiss() }
                .accessibilityIdentifier("computer-back")
            BotMascotView(bot: current, size: Theme.Computer.mascot)
                .frame(width: Theme.Computer.mascot, height: Theme.Computer.mascot)
                .padding(.leading, Theme.Computer.mascotLeading)
                .accessibilityHidden(true)
            Text(current.name)
                .font(Theme.Font.bodyMedium)
                .foregroundStyle(Theme.Computer.ink)
                .lineLimit(1)
                .padding(.leading, Theme.Computer.nameLeading)
            Spacer(minLength: 8)
            GlassCircleButton(
                systemImage: "questionmark", fill: glassFill, accessibilityLabel: "Gestures",
                glyphSize: 20, weight: .regular, glyphColor: Theme.Computer.ink
            ) { showingHelp = true }
                .accessibilityIdentifier("computer-help")
            moreMenu
                .padding(.leading, Theme.Computer.trailingGap)
        }
        // the shell puts the bar on the page margin (#4101): no inner edge
        .frame(height: Theme.Metric.glassLarge)
    }

    private var moreMenu: some View {
        Menu {
            Section {
                if controller.isHeld {
                    Button { Task { await controller.releaseControl() } } label: {
                        Label("Release control", systemImage: "hand.raised.slash")
                    }
                } else {
                    Button { Task { await controller.takeControl() } } label: {
                        Label("Take control", systemImage: "cursorarrow.rays")
                    }
                    .disabled(controller.noComputer || offline)
                }
            }
            Section {
                Picker(selection: $fitRaw) {
                    Label("Fit", systemImage: "arrow.down.right.and.arrow.up.left").tag(ComputerFit.fit.rawValue)
                    Label("Fill", systemImage: "arrow.up.left.and.arrow.down.right").tag(ComputerFit.fill.rawValue)
                } label: {
                    Text("Picture")
                }
                .pickerStyle(.inline)
                Button { Task { await controller.refreshPicture(silently: false) } } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                Toggle(isOn: $specialKeys) {
                    Label("Special keys", systemImage: "command")
                }
            }
            if canOpenLiveDesktop {
                Section {
                    Button { confirmingDesktop = true } label: {
                        Label("Open live desktop", systemImage: "display")
                    }
                    .disabled(openingDesktop)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(panelInk)
                .frame(width: Theme.Metric.glassLarge, height: Theme.Metric.glassLarge)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .themeGlass(Circle(), fill: glassFill)
        .accessibilityLabel(Text("More"))
        .accessibilityIdentifier("computer-more")
    }

    // MARK: Screen

    private func screen(width: CGFloat, height: CGFloat) -> some View {
        ZStack {
            frameBackdrop
            if let image = controller.image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: fit == .fill ? .fill : .fit)
                    .frame(width: width, height: height)
                    .clipped()
                    .accessibilityLabel(Text("\(current.name)'s computer"))
                    .accessibilityIdentifier("computer-picture")
            } else {
                waiting
            }
            if controller.isHeld {
                pointerIndicator(width: width, height: height)
            }
            TrackpadSurface { controller.handle($0) }
        }
        .frame(width: width, height: height)
        .clipped()
    }

    /// Where the remote pointer is believed to be, inside the picture as drawn.
    private func pointerIndicator(width: CGFloat, height: CGFloat) -> some View {
        let remote = controller.remoteSize
        let scale = fit == .fill
            ? max(width / remote.width, height / remote.height)
            : min(width / remote.width, height / remote.height)
        let drawn = CGSize(width: remote.width * scale, height: remote.height * scale)
        let x = (width - drawn.width) / 2 + drawn.width * controller.pointer.x
        let y = (height - drawn.height) / 2 + drawn.height * controller.pointer.y
        return Image(systemName: "cursorarrow")
            .font(.system(size: 16, weight: .regular))
            .foregroundStyle(Color.white)
            .shadow(color: .black.opacity(0.8), radius: 1.5)
            // The arrow's tip sits on the point.
            .offset(x: 5, y: 7)
            .position(x: x, y: y)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var waiting: some View {
        VStack(spacing: 8) {
            if controller.noComputer {
                Image(systemName: "desktopcomputer.trianglebadge.exclamationmark")
                    .font(.system(size: 22))
                Text("This bot has no computer")
                    .font(Theme.Font.body)
            } else if offline {
                Text("Offline")
                    .font(Theme.Font.body)
            } else {
                ProgressView().tint(.white)
                Text(current.busy == true || controller.isHeld ? "Waiting for a picture…" : "Nothing to show yet")
                    .font(Theme.Font.body)
            }
        }
        .foregroundStyle(Theme.Computer.inkSecondary)
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var statusLine: some View {
        if let notice = controller.notice ?? (offline ? String(localized: "This computer is offline. Reconnecting…") : nil) {
            Text(notice)
                .font(Theme.Font.profileLabel)
                .foregroundStyle(panelInkSecondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .accessibilityIdentifier("computer-notice")
                .onTapGesture { controller.notice = nil }
        }
    }

    // MARK: Bottom

    private var bottomButtons: some View {
        HStack {
            Menu {
                Button { Task { await controller.sendClipboard() } } label: {
                    Label("Send clipboard to computer", systemImage: "arrow.up.doc.on.clipboard")
                }
                Button { Task { await controller.copyComputerClipboard() } } label: {
                    Label("Copy computer clipboard", systemImage: "doc.on.clipboard")
                }
            } label: {
                ClipboardGlyph()
                    .fill(panelInk, style: FillStyle(eoFill: true))
                    .frame(width: ClipboardGlyph.size.width, height: ClipboardGlyph.size.height)
                    .frame(width: Theme.Metric.glassSmall, height: Theme.Metric.glassSmall)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .themeGlass(Circle(), fill: glassFill)
            .accessibilityLabel(Text("Clipboard"))
            .accessibilityIdentifier("computer-clipboard")
            .disabled(controller.noComputer)

            Spacer()

            Button {
                Haptics.selection()
                toggleKeyboard()
            } label: {
                KeyboardDotsGlyph()
                    .fill(panelInk)
                    .frame(width: KeyboardDotsGlyph.size.width, height: KeyboardDotsGlyph.size.height)
                    .frame(width: Theme.Metric.glassSmall, height: Theme.Metric.glassSmall)
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .themeGlass(Circle(), fill: glassFill)
            .accessibilityLabel(Text(keyboardUp ? "Hide keyboard" : "Keyboard"))
            .accessibilityIdentifier("computer-keyboard")
            .disabled(controller.noComputer)
            .onLongPressGesture { specialKeys.toggle() }
        }
        // no edge of its own: the full-screen shell sets the page margin, the
        // embedded panel its card edge (#4101: both counted made 35 pt)
    }

    private func toggleKeyboard() {
        if keyboardUp { keyboardUp = false; return }
        if controller.isHeld { keyboardUp = true; return }
        Task {
            await controller.takeControl()
            if controller.isHeld { keyboardUp = true }
        }
    }

    // MARK: Toast

    @ViewBuilder
    private var toast: some View {
        if controller.showsToast {
            HStack(spacing: 0) {
                Image(systemName: "cursorarrow.motionlines")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(Theme.Computer.toastIcon)
                    .frame(width: 16.5, height: 16.5)
                    .padding(.leading, Theme.Computer.toastIconLeading - 1.4)
                Text("Trackpad mode")
                    .font(Theme.Computer.toastFont)
                    .foregroundStyle(Theme.Computer.toastText)
                    .padding(.leading, Theme.Computer.toastLabelGap - 1.4)
                Spacer(minLength: 0)
            }
            .frame(width: Theme.Computer.toastSize.width, height: Theme.Computer.toastSize.height)
            .background(alignment: .leading) {
                // The toast covers "?" and "..." (it grows out of them); the
                // "?" circle melts into the toast's glass, as in the
                // reference: a lighter lens with the glyph showing through.
                ZStack {
                    Circle()
                        .fill(Theme.Computer.toastLens)
                        .frame(width: 44, height: 44)
                        .blur(radius: 1.5)
                    Image(systemName: "questionmark")
                        .font(.system(size: 20, weight: .regular))
                        .foregroundStyle(Theme.Computer.toastLensGlyph)
                        .blur(radius: 0.6)
                }
                .offset(x: Theme.Computer.toastLensCentre - 22)
            }
            .background(Theme.Computer.glassFill, in: Capsule())
            .themeGlass(Capsule(), fill: Theme.Computer.glassFill, interactive: false)
            .frame(maxWidth: .infinity, alignment: .trailing)
            .padding(.trailing, Theme.Computer.toastTrailing)
            .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .trailing)))
            .allowsHitTesting(false)
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("computer-toast")
        }
    }

    // MARK: Live desktop (admins, cloud Boat)

    @MainActor
    private func openDesktop() async {
        openingDesktop = true
        defer { openingDesktop = false }
        do {
            desktopURL = try await session.cloudDesktop(for: current)
        } catch {
            controller.notice = error.localizedDescription
        }
    }
}

/// "?": what each gesture does.
struct ComputerGestureHelp: View {
    @Environment(\.themePalette) var themePalette
    @Environment(\.dismiss) private var dismiss

    private let rows: [(String, LocalizedStringKey, LocalizedStringKey)] = [
        ("hand.point.up.left", "Move", "Slide one finger on the picture to move the pointer. Faster strokes go further."),
        ("hand.tap", "Click", "Tap once. Tap twice to double-click."),
        ("hand.tap.fill", "Right-click", "Tap with two fingers."),
        ("arrow.up.and.down", "Scroll", "Slide two fingers."),
        ("hand.draw", "Drag", "Touch and hold, then move without lifting."),
        ("keyboard", "Type", "The keyboard button sends what you type. Touch and hold it for Esc, Tab, Ctrl, Alt, Cmd and the arrows."),
        ("list.clipboard", "Clipboard", "Send this phone's clipboard to the computer, or copy the computer's."),
        ("hand.raised", "Hand it back", "From the \"...\" menu, choose Release control so the bot can use its computer again."),
    ]

    var body: some View {
        NavigationStack {
            ThemedList {
                Section {
                    ForEach(rows, id: \.0) { row in
                        HStack(alignment: .top, spacing: 14) {
                            Image(systemName: row.0)
                                .font(.system(size: 17))
                                .frame(width: 26)
                                .foregroundStyle(Theme.textSecondary)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(row.1).font(Theme.Font.bodyMedium)
                                Text(row.2).font(Theme.Font.profileLabel).foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                } footer: {
                    Text("Take control from the \"...\" menu when you need the trackpad or keyboard. Hand it back when you are done.")
                }
            }
            .navigationTitle("Using the computer")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        // The stage behind forces dark; this sheet follows the skin.
        .preferredColorScheme(Theme.palette.isDark ? .dark : .light)
    }
}

// MARK: - Glyphs

/// The clipboard circle's glyph as measured (ink 14 x 17.3): a board with a
/// clip and three bars. Drawn: the system symbol differs between releases.
struct ClipboardGlyph: Shape {
    static let size = CGSize(width: 14, height: 17.3)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width, sy = rect.height / Self.size.height
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * sx, y: rect.minY + y * sy) }
        let stroke: CGFloat = 1.35
        let inset = stroke / 2
        var board = Path()
        let left = inset, right = 14 - inset, top: CGFloat = 1.6, bottom = 17.3 - inset, r: CGFloat = 2
        board.move(to: p(2.2, top))
        board.addLine(to: p(left + r, top))
        board.addQuadCurve(to: p(left, top + r), control: p(left, top))
        board.addLine(to: p(left, bottom - r))
        board.addQuadCurve(to: p(left + r, bottom), control: p(left, bottom))
        board.addLine(to: p(right - r, bottom))
        board.addQuadCurve(to: p(right, bottom - r), control: p(right, bottom))
        board.addLine(to: p(right, top + r))
        board.addQuadCurve(to: p(right - r, top), control: p(right, top))
        board.addLine(to: p(11.8, top))
        var path = board.strokedPath(StrokeStyle(lineWidth: stroke * sx, lineCap: .round, lineJoin: .round))
        // The clip, with its hole.
        path.addRoundedRect(in: CGRect(origin: p(3.6, 0), size: CGSize(width: 6.8 * sx, height: 3.4 * sy)),
                            cornerSize: CGSize(width: 1.2 * sx, height: 1.2 * sx), style: .continuous)
        path.addEllipse(in: CGRect(origin: p(6.2, 0.9), size: CGSize(width: 1.6 * sx, height: 1.6 * sx)))
        for y in [8.3, 10.4, 12.5] as [CGFloat] {
            path.addRoundedRect(in: CGRect(origin: p(3.5, y - 0.72), size: CGSize(width: 7 * sx, height: 1.44 * sy)),
                                cornerSize: CGSize(width: 0.72 * sx, height: 0.72 * sy))
        }
        return path
    }
}

/// The keyboard circle's glyph as measured (ink 17.3 x 14): a rounded frame
/// with three dots over two.
struct KeyboardDotsGlyph: Shape {
    static let size = CGSize(width: 17.3, height: 14)

    func path(in rect: CGRect) -> Path {
        let sx = rect.width / Self.size.width, sy = rect.height / Self.size.height
        let stroke: CGFloat = 1.35
        let frame = CGRect(x: rect.minX + stroke / 2 * sx, y: rect.minY + stroke / 2 * sy,
                           width: (17.3 - stroke) * sx, height: (14 - stroke) * sy)
        var path = Path(roundedRect: frame, cornerRadius: 2.2 * sx, style: .continuous)
            .strokedPath(StrokeStyle(lineWidth: stroke * sx))
        let d: CGFloat = 2.3
        for (x, y) in [(5.05, 4.9), (8.65, 4.9), (12.25, 4.9), (6.85, 8.6), (10.45, 8.6)] as [(CGFloat, CGFloat)] {
            path.addEllipse(in: CGRect(x: rect.minX + (x - d / 2) * sx, y: rect.minY + (y - d / 2) * sy, width: d * sx, height: d * sy))
        }
        return path
    }
}

extension Theme.Computer {
    /// The stage is black whatever the skin: its ink is Black's, never the
    /// skin's (a light skin's dark ink would vanish on it).
    static let ink = Color.white
    static let inkSecondary = Color(hex: 0x9C9BA1)
}

// MARK: - Organization Local VM

/// Colours supplied by the phone or the iPad. The computer stage does not
/// read the theme environment, so the parent passes them.
struct LocalVmComputerChrome {
    var ink: Color
    var secondary: Color
    var frame: Color
    var accent: Color
    var accentInk: Color
    var danger: Color
    var warning: Color
    var hairline: Color
    var control: Color

    /// The phone's computer stage is black, with the skin's accent on the
    /// setup button.
    static var phone: LocalVmComputerChrome {
        LocalVmComputerChrome(
            ink: Theme.Computer.ink,
            secondary: Theme.Computer.inkSecondary,
            frame: Theme.Computer.frameEmpty,
            accent: Theme.accent,
            accentInk: Theme.accentInk,
            danger: Theme.danger,
            warning: Theme.warning,
            hairline: Color.white.opacity(0.16),
            control: Color.white.opacity(0.12)
        )
    }

    /// The bot panel's Computer tab on iPhone: same navy card as the name
    /// block and tab bar, not the full-screen black stage.
    static var panel: LocalVmComputerChrome {
        LocalVmComputerChrome(
            ink: Theme.textPrimary,
            secondary: Theme.textSecondary,
            frame: Theme.bg,
            accent: Theme.accent,
            accentInk: Theme.accentInk,
            danger: Theme.danger,
            warning: Theme.warning,
            hairline: Theme.hairline,
            control: Theme.cardRaised
        )
    }

    static func pad(_ theme: DesktopTheme) -> LocalVmComputerChrome {
        LocalVmComputerChrome(
            ink: theme.ink,
            secondary: theme.inkSecondary,
            frame: theme.card,
            accent: theme.accent,
            accentInk: theme.accentInk,
            danger: theme.danger,
            warning: theme.warning,
            hairline: theme.hairline,
            control: theme.control
        )
    }
}

/// The person's Local VM on an organization server (`LocalComputerScreen`).
/// A still while it runs, Play / Pause / Stop on the screen. There is no
/// hover on a phone, so the buttons stay visible and dim when they do
/// nothing. The sentence and the setup buttons sit under the 16:10 frame:
/// that frame is short, and a sentence inside it would be clipped. The
/// desktop's Details row (disk, CPU, memory, OS) is not on this screen.
/// The bot drives the desktop with `local_vm` `use`. This view never sends it.
struct LocalVmComputerPanel: View {
    @EnvironmentObject private var session: Session
    @Environment(\.scenePhase) private var scenePhase
    let name: String
    let chrome: LocalVmComputerChrome
    /// The computer the person picked by name; their current one when nil.
    var desktopId: String? = nil
    /// That computer's name, under the screen.
    var computerName: String? = nil
    @StateObject private var model = LocalVmComputerModel()
    @State private var consent: LocalVmConsent?

    var body: some View {
        contents(model.view, image: model.image)
    }

    @ViewBuilder
    private func contents(_ view: LocalVmView, image: UIImage?) -> some View {
        let picture = view.state == .running ? image : nil
        VStack(spacing: 8) {
            screen(view: view, picture: picture)
            if picture == nil, let words = view.words(status: model.status) {
                Text(words)
                    .font(.system(size: 12))
                    .foregroundStyle(chrome.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("local-vm-message")
            }
            if picture == nil {
                actions(view: view)
            }
            if !model.error.isEmpty {
                Text(model.error)
                    .font(.system(size: 12))
                    .foregroundStyle(chrome.danger)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("local-vm-error")
            }
            Group {
                if let computerName {
                    Text("\(name)'s screen · \(computerName)")
                } else {
                    Text("\(name)'s screen")
                }
            }
                .font(.system(size: 13))
                .foregroundStyle(chrome.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            if model.status?.setup?.state == "done", let folder = model.status?.setup?.previousFolder, !folder.isEmpty {
                Text("The files of the previous Local VM are still in \(folder).")
                    .font(.system(size: 12))
                    .foregroundStyle(chrome.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("local-vm-computer")
        .onAppear {
            model.attach(desktopId: desktopId) { [weak session] in session?.computerClient }
            if scenePhase == .active { model.start() }
        }
        .onDisappear { model.stop() }
        .onValueChange(of: scenePhase) { phase in
            if phase == .active { model.start() } else { model.stop() }
        }
        .alert(consentTitle, isPresented: consentShown) {
            Button("Cancel", role: .cancel) {}
            Button("Continue") { Task { await model.act(.setup) } }
        } message: {
            Text(consent?.message ?? "")
        }
    }

    private var consentTitle: String {
        switch consent {
        case .repair: "Repair"
        case .create: "Set up in one click"
        case nil: ""
        }
    }

    private var consentShown: Binding<Bool> {
        Binding(get: { consent != nil }, set: { if !$0 { consent = nil } })
    }

    private func screen(view: LocalVmView, picture: UIImage?) -> some View {
        ZStack {
            chrome.frame
            if let picture {
                Image(uiImage: picture)
                    .resizable()
                    .scaledToFit()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .accessibilityLabel(Text("\(name)'s screen"))
                    .accessibilityIdentifier("local-vm-picture")
            } else {
                VStack(spacing: 8) {
                    if view.state == .starting {
                        ProgressView().controlSize(.small).tint(chrome.secondary)
                    } else if view.state == .error {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 22))
                            .foregroundStyle(chrome.warning)
                    } else {
                        Image(systemName: "display")
                            .font(.system(size: 22))
                            .foregroundStyle(chrome.secondary)
                    }
                    Text(view.stateLabel)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(chrome.ink)
                }
                .padding(.horizontal, 24)
            }
            if view.state != .running {
                stateChip(view)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                    .padding(8)
            }
            power(view)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 8)
        }
        .aspectRatio(16.0 / 10.0, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(chrome.hairline, lineWidth: 1))
    }

    private func stateChip(_ view: LocalVmView) -> some View {
        let dot: Color = view.state == .paused || view.state == .starting
            ? chrome.warning
            : view.state == .error ? chrome.danger : Color.white.opacity(0.5)
        return HStack(spacing: 6) {
            Circle().fill(dot).frame(width: 6, height: 6)
            Text(view.stateLabel)
                .font(.system(size: 11))
                .foregroundStyle(Color.white)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(Color.black.opacity(0.55), in: Capsule())
        .accessibilityHidden(true)
    }

    private func power(_ view: LocalVmView) -> some View {
        let playOn = view.state == .paused ? view.canResume : view.canPlay
        return HStack(spacing: 4) {
            LocalVmPowerButton(systemImage: "play.fill", label: view.playLabel, identifier: "local-vm-play", enabled: playOn && !model.busy, action: setUp)
            LocalVmPowerButton(systemImage: "pause.fill", label: "Pause", identifier: "local-vm-pause", enabled: view.canPause && !model.busy) {
                Task { await model.act(.pause) }
            }
            LocalVmPowerButton(systemImage: "stop.fill", label: "Stop", identifier: "local-vm-stop", enabled: view.canStop && !model.busy) {
                Task { await model.act(.stop) }
            }
        }
        .padding(4)
        .background(Color.black.opacity(0.6), in: Capsule())
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func actions(view: LocalVmView) -> some View {
        if view.problem == .noRuntime {
            installChoices
        } else if let title = view.setupTitle {
            wordButton(title, identifier: "local-vm-setup", primary: true, action: setUp)
        }
    }

    private var installChoices: some View {
        let choices = LocalVmInstall.choices(platform: model.platform)
        return VStack(spacing: 8) {
            ForEach(choices) { choice in
                wordButton(choice.title, identifier: "local-vm-install-\(choice.raw)", primary: choice.raw == choices.first?.raw) {
                    Task { await model.act(.install, choice: choice.raw) }
                }
            }
        }
    }

    private func wordButton(_ title: String, identifier: String, primary: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 12, weight: primary ? .medium : .regular))
                .foregroundStyle(primary ? chrome.accentInk : chrome.ink)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, minHeight: 44)
                .background(primary ? chrome.accent : chrome.control, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(model.busy)
        .opacity(model.busy ? 0.5 : 1)
        .accessibilityIdentifier(identifier)
    }

    /// Play sets the VM up. While it is paused, the same button resumes it.
    /// A create or a repair asks first.
    private func setUp() {
        let view = model.view
        if view.state == .paused {
            guard view.canResume, !model.busy else { return }
            Task { await model.act(.resume) }
            return
        }
        guard view.canPlay, !model.busy else { return }
        if let next = view.consent(workspace: model.status?.workspace) {
            consent = next
        } else {
            Task { await model.act(.setup) }
        }
    }
}

private struct LocalVmPowerButton: View {
    let systemImage: String
    let label: String
    let identifier: String
    let enabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Color.white)
                .frame(width: 36, height: 36)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
        .opacity(enabled ? 1 : 0.35)
        .accessibilityLabel(Text(label))
        .accessibilityIdentifier(identifier)
    }
}

/// Polls the person's desktop bridge. Status every 10 seconds, every 2
/// while a setup runs, and a still every 4 seconds while the VM is running.
@MainActor
final class LocalVmComputerModel: ObservableObject {
    @Published private(set) var view = LocalVmView.loading
    @Published private(set) var status: LocalVmStatus?
    @Published private(set) var image: UIImage?
    @Published private(set) var error = ""
    @Published private(set) var platform: String?
    @Published private(set) var busy = false

    private var clientProvider: @MainActor () -> CompanionClient? = { nil }
    /// The computer asked (`desktopId`); the person's current one when nil.
    private var desktopId: String?
    private var pending: LocalVmAction?
    private var connected = false
    private var bridgeKnown = false
    private var bridgeStopped = false
    private var bridgeLoop: Task<Void, Never>?
    private var statusLoop: Task<Void, Never>?
    private var frameLoop: Task<Void, Never>?

    func attach(desktopId: String? = nil, _ provider: @escaping @MainActor () -> CompanionClient?) {
        self.desktopId = desktopId
        clientProvider = provider
    }

    func start() {
        guard bridgeLoop == nil, statusLoop == nil else { return }
        if !bridgeStopped {
            bridgeLoop = Task { [weak self] in await self?.bridgeLoopBody() }
        }
        statusLoop = Task { [weak self] in await self?.statusLoopBody() }
    }

    func stop() {
        bridgeLoop?.cancel()
        statusLoop?.cancel()
        frameLoop?.cancel()
        bridgeLoop = nil
        statusLoop = nil
        frameLoop = nil
    }

    func act(_ action: LocalVmAction, choice: String? = nil) async {
        guard pending == nil else { return }
        guard let client = clientProvider() else {
            error = "Your computer is not connected. Open the Sagax app on it to use its Local VM."
            connected = false
            bridgeKnown = true
            publish()
            return
        }
        pending = action
        busy = true
        error = ""
        publish()
        do {
            let answer = try await client.localVm(action: action, choice: choice, desktopId: desktopId)
            if !answer.ok { error = answer.text }
        } catch {
            self.error = Self.failed(error)
        }
        pending = nil
        busy = false
        publish()
        await refreshStatus()
    }

    private func bridgeLoopBody() async {
        while !Task.isCancelled, !bridgeStopped {
            await refreshBridge()
            if bridgeStopped || Task.isCancelled { return }
            try? await Task.sleep(nanoseconds: 20_000_000_000)
        }
    }

    private func statusLoopBody() async {
        // Wake every 2 seconds so a setup that just started is seen at the
        // desktop's setup interval. Idle status is still every 10 seconds.
        var tick = 0
        while !Task.isCancelled {
            let fast = connected && status?.setup?.state == "running"
            if connected && (fast || tick == 0) { await refreshStatus() }
            tick = fast ? 0 : (tick + 1) % 5
            try? await Task.sleep(nanoseconds: 2_000_000_000)
        }
    }

    private func frameLoopBody() async {
        while !Task.isCancelled {
            await grab()
            try? await Task.sleep(nanoseconds: 4_000_000_000)
        }
    }

    private func refreshBridge() async {
        guard let client = clientProvider() else {
            connected = false
            platform = nil
            bridgeKnown = true
            publish()
            return
        }
        do {
            guard let bridge = try await client.personDesktopBridge() else {
                bridgeStopped = true
                connected = false
                platform = nil
                bridgeKnown = true
                publish()
                return
            }
            let picked = bridge.localVmDesktop(id: desktopId)
            connected = picked.connected
            platform = picked.platform
            bridgeKnown = true
            publish()
            if connected { await refreshStatus() }
        } catch {
            // Keep the last answer. The next poll asks again.
        }
    }

    private func refreshStatus() async {
        guard connected, let client = clientProvider() else { return }
        do {
            let answer = try await client.localVm(action: .status, desktopId: desktopId)
            if let next = answer.status {
                status = next
                publish()
            } else if !answer.ok {
                error = answer.text
            }
        } catch {
            self.error = Self.failed(error)
        }
    }

    private func grab() async {
        guard !Task.isCancelled, view.state == .running, let client = clientProvider() else { return }
        do {
            let answer = try await client.localVm(action: .screenshot, desktopId: desktopId)
            guard !Task.isCancelled, view.state == .running, let data = answer.image, let picture = UIImage(data: data) else { return }
            image = picture
        } catch {
            // Keep the last frame.
        }
    }

    private func publish() {
        if bridgeKnown {
            view = LocalVmView.of(status: status, connected: connected, pending: pending)
        } else {
            view = .loading
        }
        let live = view.state == .running
        if live {
            if frameLoop == nil {
                frameLoop = Task { [weak self] in await self?.frameLoopBody() }
            }
        } else {
            frameLoop?.cancel()
            frameLoop = nil
            image = nil
        }
    }

    private static func failed(_ error: Error) -> String {
        if let text = (error as? LocalizedError)?.errorDescription, !text.isEmpty { return text }
        return "That did not work. Try again in a moment."
    }
}

/// The bots' computer screens, apart from the session (#3017, L01). Each
/// frame used to publish the whole session, which redrew the roster, the
/// chat and every row while a screen was watched. Each bot has its own
/// store (#3029): a frame of one bot redraws only the views that draw
/// that bot's screen, never another bot's computer card.
@MainActor
final class ScreenStore {
    static let shared = ScreenStore()
    private var screens: [String: BotScreen] = [:]

    /// The bot's own store, made on first use and kept for the session.
    func screen(_ botId: String) -> BotScreen {
        if let existing = screens[botId] { return existing }
        let made = BotScreen()
        screens[botId] = made
        return made
    }

    func update(_ botId: String, _ frame: ScreenFrame) {
        screen(botId).frame = frame
    }

    func clear() {
        for screen in screens.values where screen.frame != nil { screen.frame = nil }
    }
}

/// One bot's latest screen frame.
@MainActor
final class BotScreen: ObservableObject {
    @Published fileprivate(set) var frame: ScreenFrame?
}

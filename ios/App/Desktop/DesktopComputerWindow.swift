// iPad lot 6: the bot's computer in its own large window (the desktop's
// `SandboxDesktopModal`, src/components/computer/SandboxDesktopModal.tsx;
// gallery computer-screens ?modal=sandbox). The desktop opens it over the
// app (92vw by 88vh, a dark panel `#161618` on a 60 % veil, radius 16, a
// white-10 % border); one collapse button at the top right closes it and
// releases control; the live screen sits in the middle on black with
// rounded-xl corners; under it one segmented control, Watching or Take
// control / You have control.
//
// On iPadOS the equivalent is a separate window scene (`WindowGroup(id:for:)`,
// opened with `openWindow`; Info.plist carries UIApplicationSupportsMultipleScenes),
// which fills the whole window with the panel. Where a second scene is not
// available, or for the parity captures, the same panel is drawn in the
// desktop shell over a veil (`DesktopShellModel.computerWindow`).
//
// The picture and the control are the phone's `ComputerController`, as
// `ComputerView` uses it (stream frames first, direct captures while held,
// the trackpad over the picture).
import SwiftUI
import UIKit
import CompanionCore

/// Where a bot's computer window is asked for.
enum DesktopComputerWindow {
    /// The scene's id (`WindowGroup(id:for:)`).
    static let sceneId = "computer-window"

    /// iPadOS can show a second scene when the app supports several.
    @MainActor
    static var supportsScenes: Bool { UIApplication.shared.supportsMultipleScenes }

    /// Opens the window: a scene when there can be one, else in the shell.
    @MainActor
    static func open(botId: String, openWindow: OpenWindowAction, model: DesktopShellModel?) {
        if supportsScenes, !ParityMode.isActive || UserDefaults.standard.bool(forKey: "computerWindowScene") {
            openWindow(id: sceneId, value: botId)
        } else {
            model?.computerWindow = botId
        }
    }
}

/// The window's content. `floating`: drawn over the shell (veil, rounded
/// panel at 92 % by 88 %); otherwise it is the whole scene.
struct DesktopComputerWindowView: View {
    @Environment(\.desktopTheme) private var theme
    @EnvironmentObject private var session: Session
    let botId: String
    var floating = false
    let close: () -> Void

    @StateObject private var controller: ComputerController
    @StateObject private var choices = ComputerChoicesModel()
    @State private var keyboardUp = false
    @State private var started = false

    init(botId: String, floating: Bool = false, close: @escaping () -> Void) {
        self.botId = botId
        self.floating = floating
        self.close = close
        _controller = StateObject(wrappedValue: ComputerController(botId: botId, client: { nil }))
    }

    private var bot: Bot? { session.state.bot(botId) }
    private var name: String { bot?.name ?? "" }
    private var streamFrame: ScreenFrame? { session.state.screens[botId] }
    private var offline: Bool {
        if case .live = session.status { return false }
        return true
    }

    /// The panel's own colours: `bg-[#161618]`, dark `#121214`.
    private var panelFill: Color { theme.dark ? Color(red: 0x12 / 255, green: 0x12 / 255, blue: 0x14 / 255) : Color(red: 0x16 / 255, green: 0x16 / 255, blue: 0x18 / 255) }

    private var showsLocalVm: Bool {
        guard let bot else { return false }
        return OrgLocalVmScreen.shows(worksOn: DesktopWorksOn.of(bot), organization: session.surfaceGate.organization)
    }

    private var chosen: ComputerChoice? {
        guard session.surfaceGate.organization else { return nil }
        return choices.bridge?.chosen(worksOnLocal: showsLocalVm, picked: nil)
    }

    private var isLocalVm: Bool {
        if let chosen { return chosen != .cloud }
        return showsLocalVm
    }

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                if floating {
                    Color.black.opacity(0.6)
                        .contentShape(Rectangle())
                        .accessibilityHidden(true)
                        .onTapGesture {}
                }
                panel
                    .frame(
                        width: floating ? geometry.size.width * 0.92 : geometry.size.width,
                        height: floating ? geometry.size.height * 0.88 : geometry.size.height
                    )
            }
            .frame(width: geometry.size.width, height: geometry.size.height)
        }
        .ignoresSafeArea()
        .accessibilityIdentifier("desktop-computer-window")
        .onAppear {
            if session.surfaceGate.organization { choices.start { [weak session] in session?.computerClient } }
        }
        .onDisappear { choices.stop() }
    }

    private var panel: some View {
        let shape = RoundedRectangle(cornerRadius: floating ? 16 : 0, style: .continuous)
        return VStack(spacing: 0) {
            // window chrome only: collapse back, top right
            HStack {
                Spacer()
                Button(action: closeAndRelease) {
                    DesktopIconView(icon: .minimize, size: 14)
                        .foregroundStyle(Color.white.opacity(0.55))
                        .frame(width: 28, height: 28)
                        .background(collapseHover ? Color.white.opacity(0.10) : .clear, in: Circle())
                        // a 44 pt touch target around the 28 pt circle
                        .frame(width: 44, height: 44)
                        .contentShape(Circle())
                }
                .buttonStyle(.plain)
                .onHover { collapseHover = $0 }
                .accessibilityLabel(Text("Close and release control (Cmd/Ctrl+Shift+Esc)"))
                .accessibilityIdentifier("desktop-computer-window-close")
                .keyboardShortcut(.cancelAction)
            }
            .padding(.horizontal, 3)
            .frame(height: 44)
            VStack(spacing: 0) {
                screenWell
                    .padding(.top, 1)
                if !isLocalVm, !session.surfaceGate.organization || chosen == .cloud || chosen == nil {
                    segments.padding(.top, 16)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 16)
        }
        .background(panelFill, in: shape)
        .overlay(shape.strokeBorder(Color.white.opacity(floating ? 0.10 : 0), lineWidth: 1))
        .clipShape(shape)
        .shadow(color: .black.opacity(floating ? 0.5 : 0), radius: 24, y: 12)
        .environment(\.colorScheme, .dark)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .accessibilityLabel(Text("\(name)'s screen"))
    }

    @State private var collapseHover = false

    // MARK: Screen

    /// The live screen on black, rounded-xl, filling the middle.
    private var screenWell: some View {
        ZStack {
            Color.black
            if isLocalVm {
                ScrollView {
                    LocalVmComputerPanel(name: name, chrome: .phone, desktopId: chosen?.desktopId, computerName: chosen?.name)
                        .id(chosen?.key ?? "current")
                        .padding(16)
                }
            } else if session.surfaceGate.organization {
                SandboxDesktopScreen(botName: name, ink: .white, secondary: Color.white.opacity(0.6), card: Color(white: 0.11))
                    .padding(16)
            } else {
                liveScreen
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityIdentifier("desktop-computer-window-screen")
    }

    private var liveScreen: some View {
        GeometryReader { proxy in
            let size = ComputerPictureLayout.fit(in: proxy.size)
            ZStack {
                if let image = controller.image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: size.width, height: size.height)
                        .accessibilityLabel(Text("\(name)'s screen"))
                        .accessibilityIdentifier("computer-picture")
                } else {
                    waiting
                }
                if controller.isHeld { pointer(width: size.width, height: size.height) }
                TrackpadSurface { controller.handle($0) }
                    .frame(width: size.width, height: size.height)
                RemoteKeyboardField(
                    isActive: $keyboardUp,
                    showsSpecialKeys: false,
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
            .frame(width: proxy.size.width, height: proxy.size.height)
            .onAppear { controller.frameWidth = size.width }
            .onValueChange(of: proxy.size) { controller.frameWidth = ComputerPictureLayout.fit(in: $0).width }
        }
        .onAppear {
            controller.attach { [weak session] in session?.computerClient }
            session.watchScreen(of: botId)
            controller.streamFrame(streamFrame?.data)
            controller.appear()
        }
        .onDisappear {
            keyboardUp = false
            controller.disappear()
            session.stopWatchingScreen(of: botId)
        }
        .onValueChange(of: streamFrame) { controller.streamFrame($0?.data) }
        .task {
            // the desktop opens in control (`useState(true)`)
            guard !started else { return }
            started = true
            await controller.takeControl()
        }
        .alert(item: $controller.prompt) { prompt in
            switch prompt {
            case .takeControl:
                Alert(title: Text("Take control?"),
                      message: Text("You need control of \(name)'s computer to use it. The bot waits while you have it."),
                      primaryButton: .default(Text("Take control")) { Task { await controller.takeControl() } },
                      secondaryButton: .cancel())
            case .heldElsewhere:
                Alert(title: Text("Someone else has control"),
                      message: Text("Another device holds control of this computer. Try again once it is released."))
            case let .message(text):
                Alert(title: Text(text))
            }
        }
    }

    private func pointer(width: CGFloat, height: CGFloat) -> some View {
        let remote = controller.remoteSize
        let scale = min(width / max(remote.width, 1), height / max(remote.height, 1))
        let drawn = CGSize(width: remote.width * scale, height: remote.height * scale)
        let x = (width - drawn.width) / 2 + drawn.width * controller.pointer.x
        let y = (height - drawn.height) / 2 + drawn.height * controller.pointer.y
        return Image(systemName: "cursorarrow")
            .font(.system(size: 16))
            .foregroundStyle(Color.white)
            .shadow(color: .black.opacity(0.8), radius: 1.5)
            .offset(x: 5, y: 7)
            .position(x: x, y: y)
            .frame(width: width, height: height)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    private var waiting: some View {
        VStack(spacing: 8) {
            if controller.noComputer {
                Image(systemName: "desktopcomputer.trianglebadge.exclamationmark").font(.system(size: 22))
                Text("This bot has no computer")
            } else if offline {
                Text("Offline")
            } else {
                ProgressView().tint(.white)
                Text(bot?.busy == true || controller.isHeld ? "Waiting for a picture…" : "Nothing to show yet")
            }
        }
        .font(theme.font(13))
        .foregroundStyle(Color.white.opacity(0.6))
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
        .allowsHitTesting(false)
    }

    // MARK: Segments

    /// `inline-flex rounded-full bg-white/8 p-0.5`: Watching, then Take
    /// control (You have control once held).
    private var segments: some View {
        let control = controller.isHeld
        return HStack(spacing: 2) {
            segment(icon: .eye, title: Text("Watching"), selected: !control, id: "watch") {
                Task { await controller.releaseControl() }
            }
            segment(icon: .hand, title: control ? Text("You have control") : Text("Take control"), selected: control, id: "take") {
                Task { await controller.takeControl() }
            }
        }
        .padding(2)
        .background(Color.white.opacity(0.08), in: Capsule())
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("Who drives the computer"))
        .accessibilityIdentifier("desktop-computer-window-segments")
    }

    private func segment(icon: DesktopIcon, title: Text, selected: Bool, id: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 6) {
                DesktopIconView(icon: icon, size: 13)
                title.font(theme.font(12, .medium))
            }
            .foregroundStyle(Color.white.opacity(selected ? 1 : 0.55))
            .padding(.horizontal, 14)
            .frame(height: 29)
            .background(selected ? Color.white.opacity(0.16) : .clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("desktop-computer-window-\(id)")
    }

    // MARK: Closing

    /// Closing releases control (the control view unmounts).
    private func closeAndRelease() {
        Task {
            if controller.isHeld { await controller.releaseControl() }
            close()
        }
    }
}

// MARK: - The scene

/// The window scene's root: the paired session, the skin and the app's
/// language, then the panel filling the window. Closing asks UIKit to
/// destroy this scene.
struct DesktopComputerWindowScene: View {
    @Environment(\.themePalette) private var themePalette
    @EnvironmentObject private var session: Session
    @StateObject private var closer = SceneCloser()
    let botId: String

    var body: some View {
        DesktopComputerWindowView(botId: botId, floating: false) { closer.close() }
            .background(SceneReader(closer: closer))
            .environment(\.desktopTheme, DesktopTheme.of(themePalette))
            .statusBarHidden(true)
    }
}

/// Finds the window scene a view sits in, to close it.
@MainActor
final class SceneCloser: ObservableObject {
    weak var scene: UIWindowScene?

    func close() {
        guard let session = scene?.session else { return }
        UIApplication.shared.requestSceneSessionDestruction(session, options: nil, errorHandler: nil)
    }
}

private struct SceneReader: UIViewRepresentable {
    let closer: SceneCloser

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ view: UIView, context: Context) {
        DispatchQueue.main.async { closer.scene = view.window?.windowScene }
    }
}

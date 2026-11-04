// "Put on the desktop" (BotContextMenu, `floatingBots.menu.float`): on the
// desktop the bot leaves the app as a floating character on the computer's
// desktop, a small window of its own to chat with (FloatingBotWindow.tsx).
// The iPadOS equivalent is a window scene of its own: the bot's chat in a
// small window that Stage Manager floats over the other apps and keeps on
// screen beside them (or, without Stage Manager, a Split View / Slide Over
// window). "Remove from the desktop" closes that window; closing it by hand
// does the same. Where the device cannot show a second scene the entry
// opens the bot in the app instead.
import SwiftUI
import UIKit
import CompanionCore

@MainActor
final class DesktopFloatingBots: ObservableObject {
    static let shared = DesktopFloatingBots()
    static let sceneId = "floating-bot"

    /// The bots on the desktop, each in its own scene.
    @Published private(set) var floating: Set<String> = []
    private var closers: [String: SceneCloser] = [:]
    /// The shell's `openWindow`, registered by DesktopKeyCommands.
    var openWindow: OpenWindowAction?

    func isFloating(_ botId: String) -> Bool { floating.contains(botId) }

    /// Puts the bot on the desktop, or takes it back.
    func toggle(_ botId: String, model: DesktopShellModel, session: Session) {
        if floating.contains(botId) {
            closers[botId]?.close()
            ended(botId)
            return
        }
        if UIApplication.shared.supportsMultipleScenes, let openWindow {
            openWindow(id: Self.sceneId, value: botId)
        } else if let bot = session.state.bot(botId) {
            model.open(session.returning(to: .bot(bot)))
        }
    }

    fileprivate func began(_ botId: String, closer: SceneCloser) {
        floating.insert(botId)
        closers[botId] = closer
    }

    fileprivate func ended(_ botId: String) {
        floating.remove(botId)
        closers[botId] = nil
    }
}

/// The floating bot's window: its chat, as the phone draws it, with the
/// bot's mascot and name in the bar.
struct DesktopFloatingBotScene: View {
    @EnvironmentObject private var session: Session
    @StateObject private var closer = SceneCloser()
    let botId: String

    var body: some View {
        NavigationStack {
            if let bot = session.state.bot(botId) {
                ChatView(chat: .bot(bot))
            } else {
                ProgressView()
            }
        }
        .background(FloatingSceneReader(closer: closer))
        .onAppear { DesktopFloatingBots.shared.began(botId, closer: closer) }
        .onDisappear { DesktopFloatingBots.shared.ended(botId) }
        .accessibilityIdentifier("desktop-floating-bot.\(botId)")
    }
}

private struct FloatingSceneReader: UIViewRepresentable {
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

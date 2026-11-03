// iPad I3: the desktop chat surfaces of the parity harness
// (ios/parity/desktop/surfaces.mjs, "chat"), opened on Ara's chat the way
// the reference opens them: a scroll position, a draft, an open menu, or
// transcript rows injected into this screen only (the reference injects
// them into its page's store; nothing reaches the fixture server).
import SwiftUI
import UIKit
import CompanionCore

extension IPadParityScreen {
    /// Drawn by the desktop chat (DesktopShell opens Ara for these).
    var isDesktopChat: Bool {
        switch self {
        case .chatTop, .chatAttachments, .chatMarkdown, .chatApproval, .chatQuestion, .chatMessageHover,
             .chatComposerDraft, .chatComposerSlash, .chatExportMenu, .chatModelPicker, .chatApprovalMode,
             .chatWhereMenu, .chatFind, .chatThreads, .inspector, .groupChat:
            true
        default:
            false
        }
    }
}

#if DEBUG
enum DesktopChatParity {
    static var screen: IPadParityScreen? { ParityLaunch.current?.iPadScreen }

    /// chat-message-hover: the reply the pointer rests on.
    static func forcesHover(_ message: Message) -> Bool {
        screen == .chatMessageHover && (message.text ?? "").contains("Veux-tu que je refasse")
    }

    /// Which row the scroll is read from, and where its edge sits on the
    /// reference (window points; refs/*.json): chat-top, the top of the
    /// "Voici les références" row; chat-attachments, the bottom of the
    /// "Les deux captures" bubble, per window size.
    static var scrollTarget: (prefix: String, edge: CGFloat, bottom: Bool)? {
        switch screen {
        case .chatTop:
            return ("Voici les références", 45.5 - 7 - 12, false)
        case .chatAttachments:
            let size = UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.screen.bounds.size }.first ?? .zero
            let wide = max(size.width, size.height) > 1300
            let landscape = size.width > size.height
            let bottom: CGFloat = wide ? (landscape ? 529 : 685) : (landscape ? 434 : 610.59)
            return ("Les deux captures de remplacement", bottom, true)
        default:
            return nil
        }
    }

    /// The find bar draws as focused without taking the keyboard.
    static var findLooksFocused: Bool { screen == .chatFind }

    /// The composer's open policy menu on its surface.
    static var openMenu: DesktopComposerMenu? {
        switch screen {
        // the desktop's composer has no approval control any more: the
        // approval-mode and model-picker surfaces are the + menu (2026-11-03)
        case .chatApprovalMode, .chatModelPicker: .plus
        default: nil
        }
    }

    static let markdown = """
    Voici le tableau de remplacement demandé, avec un exemple de code :

    | Poste | Responsable | Échéance | État |
    | --- | --- | --- | --- |
    | Sauvegarde | Ara | 3 oct. | Fait |
    | Migration | Keepler | 10 oct. | En cours |
    | Documentation | Lux | 17 oct. | À faire |

    ```ts
    export function prochainLundi(date: Date): Date {
      const jour = date.getDay();
      const ecart = (8 - jour) % 7 || 7;
      return new Date(date.getTime() + ecart * 86_400_000);
    }
    ```

    1. **Gras** et *italique* pour la forme.
    2. Un lien : [documentation](https://docs.example.com).

    > Une citation courte, en texte de remplacement.
    """

    /// The rows surfaces.mjs injects, as wire JSON.
    static var injected: [[String: Any]] {
        switch screen {
        case .chatMarkdown:
            return [
                ["role": "user", "kind": "text", "text": "Montre-moi le tableau."],
                ["role": "bot", "kind": "text", "text": markdown, "turnTerminal": true],
            ]
        case .chatApproval:
            return [
                ["role": "user", "kind": "text", "text": "Pousse la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Run a command?", "subtitle": "git push origin main",
                    "options": ["Deny", "Always allow", "Allow once"], "requestId": "parity-req-1", "tool": "Bash",
                    "allowKey": "Bash:git",
                    "commandAllowlist": ["command": "git push origin main", "cwd": "/workspace/fixture", "providerInstanceId": "claude"],
                ] as [String: Any]],
            ]
        case .chatQuestion:
            return [
                ["role": "user", "kind": "text", "text": "Planifie la sauvegarde."],
                ["role": "bot", "kind": "options", "card": [
                    "title": "Question", "subtitle": "", "options": ["Dimanche soir", "Lundi matin", "Chaque jour"],
                    "requestId": "parity-req-2", "tool": "AskUserQuestion",
                    "questionRequest": ["version": 1, "questions": [[
                        "question": "Quand faut-il refaire la sauvegarde ?", "header": "Horaire", "multiSelect": false,
                        "options": [
                            ["label": "Dimanche soir", "description": "Une fois par semaine, à 21 h."],
                            ["label": "Lundi matin", "description": "Avant la réunion d'équipe."],
                            ["label": "Chaque jour", "description": "À 2 h, en dehors des heures de travail."],
                        ],
                    ]]] as [String: Any],
                ] as [String: Any]],
            ]
        default:
            return []
        }
    }
}

extension ChatView {
    /// Opens this chat's parity surface once the transcript has settled
    /// (after the newest-message settle at 150 and 450 ms).
    func desktopParityLaunch(_ proxy: ScrollViewProxy) async {
        guard desktopChat != nil, let screen = DesktopChatParity.screen, screen.isDesktopChat else { return }
        for _ in 0..<100 where messages.isEmpty {
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        let rows = DesktopChatParity.injected
        if !rows.isEmpty {
            var parent = messages.last?.id
            var at = messages.last.map { $0.at } ?? Date().timeIntervalSince1970 * 1000
            for (index, row) in rows.enumerated() {
                at += 60_000
                var wire = row
                wire["id"] = "parity-desktop-\(index + 1)"
                wire["at"] = at
                if let parent { wire["parentId"] = parent }
                guard let data = try? JSONSerialization.data(withJSONObject: wire),
                      let message = try? JSONDecoder().decode(Message.self, from: data) else { continue }
                session.parityApply(.message(threadId: threadId, message: message))
                parent = message.id
            }
        }
        try? await Task.sleep(nanoseconds: 900_000_000)
        switch screen {
        case .chatTop, .chatAttachments:
            // The reference's scroll, read from its DOM dump: the row of
            // "Voici les références" (its 12 pt gap, then the bubble) starts
            // at this window y. Again as late layout settles.
            guard let desired = DesktopChatParity.scrollTarget else { return }
            follow.pause()
            for delay in [0, 600, 1_200, 2_000] {
                try? await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
                ParityRowProbe.place(edge: desired.edge, bottom: desired.bottom)
            }
        case .chatComposerDraft:
            // the simulator's software keyboard would cover the screen: the
            // draft without the focus (the reference hides its caret anyway)
            draft = "Brouillon de remplacement : vérifie la sauvegarde de dimanche\net envoie le résumé à l'équipe."
        case .chatComposerSlash:
            draft = "/"
        case .chatFind:
            openFind()
            finder.query = "sauvegarde"
        default:
            if !rows.isEmpty { proxy.scrollTo(Self.bottomId, anchor: .bottom) }
        }
    }

    /// chat-top / chat-attachments: a probe in the row the reference's
    /// scroll position is read from ("Voici les références", the reply under
    /// the first question).
    @ViewBuilder
    func desktopParityRowProbe(_ row: TranscriptRow) -> some View {
        if desktopChat != nil, let target = DesktopChatParity.scrollTarget,
           row.head.role == .bot, (row.head.text ?? "").hasPrefix(target.prefix) {
            ParityRowProbe()
        }
    }

    /// The transcript row that holds this message (a folded turn holds several).
    private func rowId(for message: Message) -> String {
        rows.first { row in
            if case let .activityRun(run) = row { return run.messages.contains { $0.id == message.id } }
            if case let .voiceCall(card) = row { return card.messages.contains { $0.id == message.id } }
            return row.id == message.id
        }?.id ?? message.id
    }
}

/// A UIKit view inside the probed row: where it is in the window, and the
/// transcript's scroll view around it.
struct ParityRowProbe: UIViewRepresentable {
    private static weak var current: UIView?

    func makeUIView(context: Context) -> UIView {
        let view = UIView()
        view.isUserInteractionEnabled = false
        Self.current = view
        return view
    }

    func updateUIView(_ view: UIView, context: Context) { Self.current = view }

    /// Scrolls the transcript so the probed row's top is at `y` in the window.
    @MainActor
    static func place(edge y: CGFloat, bottom: Bool) {
        guard let probe = current, probe.window != nil else { return }
        var view = probe.superview
        while let candidate = view, !(candidate is UIScrollView) { view = candidate.superview }
        guard let scroll = view as? UIScrollView else { return }
        let now = probe.convert(CGPoint(x: 0, y: bottom ? probe.bounds.height : 0), to: nil).y
        var offset = scroll.contentOffset
        let lowest = -scroll.adjustedContentInset.top
        let highest = max(lowest, scroll.contentSize.height - scroll.bounds.height + scroll.adjustedContentInset.bottom)
        offset.y = min(highest, max(lowest, offset.y + now - y))
        scroll.setContentOffset(offset, animated: false)
    }
}
#endif

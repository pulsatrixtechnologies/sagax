// #3689 captures (DEBUG, store preview only): the desktop's pinned-once
// gallery cases (src/gallery/pinned-once.tsx) on the phone and the tablet,
// in the cards chat's bot: an ask that waits is drawn once, on the pinned
// card over the composer; once settled, its record is in the conversation.
// `-pinned-once-preview question|two|approval|answered`, in the app's
// language (French or English words, as the desktop's gallery).
#if DEBUG
import Foundation
import CompanionCore

extension Session {
    /// The case's conversation, chained, and the server's list of what
    /// still waits in it, each item with its message.
    static func pinnedOncePreview(_ which: String, bot: Bot) -> (rows: [Message], waiting: WaitingPayload) {
        let botId = bot.id
        let thread = bot.threadId
        let fr = (Locale.preferredLanguages.first ?? "en").hasPrefix("fr")
        let from: [String: Any] = ["botId": botId, "name": bot.name, "color": bot.color]
        let at = Double(Int(Date().timeIntervalSince1970 * 1000) - 10 * 60_000)
        let question = fr
            ? "Avant de lancer la migration de ce soir, qu'est-ce que je fais avec les intégrations qui écrivent encore dans l'ancien système ? Je peux les mettre en pause, les rediriger vers le nouveau, les laisser rouler ou attendre ta confirmation pour chacune."
            : "Before tonight's migration starts, what do I do with the integrations that still write to the old system? I can pause them, point them at the new one, leave them running or wait for your word on each one."
        let choices = fr
            ? ["Toutes en pause pendant la migration", "Les rediriger vers le nouveau système", "Les laisser rouler, je surveille", "Me demander pour chacune"]
            : ["Pause all of them during the migration", "Point them at the new system", "Leave them running, I will watch", "Ask me for each one"]
        let command = "ls /workspace/integrations; echo READY"

        func message(_ object: [String: Any]) -> Message? {
            guard let data = try? JSONSerialization.data(withJSONObject: object) else { return nil }
            return try? JSONDecoder().decode(Message.self, from: data)
        }
        func ask(_ id: String, _ text: String, _ options: [String], at offset: Double, answered: String? = nil) -> Message? {
            var card: [String: Any] = [
                "title": "", "subtitle": "", "options": [String](), "requestId": "req-\(id)", "requestType": "question",
                "questionRequest": ["version": 1, "questions": [["question": text, "options": options.map { ["label": $0] }]]],
            ]
            if let answered { card["answered"] = "answer"; card["answeredText"] = answered }
            return message(["id": id, "role": "bot", "kind": "options", "at": at + offset, "text": "", "from": from, "card": card])
        }
        func approval(answered: Bool) -> Message? {
            var card: [String: Any] = [
                "title": "", "subtitle": command, "options": ["Allow", "Deny"], "requestId": "req-a1",
                "tool": "mcp__sagax-environment__run_command", "toolInput": #"{"command":"\#(command)"}"#,
            ]
            if answered { card["answered"] = "allow" }
            return message(["id": "a1", "role": "bot", "kind": "options", "at": at + 180_000, "text": "", "from": from, "card": card])
        }
        func words(_ id: String, _ text: String, at offset: Double, person: Bool = false) -> Message? {
            var object: [String: Any] = ["id": id, "role": person ? "user" : "bot", "kind": "text", "at": at + offset, "text": text]
            if !person { object["from"] = from }
            return message(object)
        }
        let person = words("u1", fr ? "Prépare la migration de ce soir." : "Get tonight's migration ready.", at: 0, person: true)
        let before = words("w1", fr ? "La migration est prête. Il reste une décision avant de lancer." : "The migration is ready. One decision is left before I start.", at: 60_000)
        let after = words("w2", fr ? "Je t'attends pour continuer." : "I am waiting for you to go on.", at: 240_000)
        let second = ask("q2", fr ? "Je préviens l'équipe avant de commencer ?" : "Do I tell the team before I start?", fr ? ["Oui", "Non"] : ["Yes", "No"], at: 150_000)
        let picked: [Message?] = switch which {
        case "two": [person, before, ask("q1", question, choices, at: 120_000), second, after]
        case "approval": [person, before, approval(answered: false), after]
        case "answered": [person, before, ask("q1", question, choices, at: 120_000, answered: choices[1]), approval(answered: true), after]
        default: [person, before, ask("q1", question, choices, at: 120_000), after]
        }
        let rows = picked.compactMap { $0 }
        var parent: String?
        var chained: [Message] = []
        for var row in rows {
            row.parentId = parent
            parent = row.id
            chained.append(row)
        }
        // the server's list: the asks that still wait, each with its message
        var payload = WaitingPayload(waiting: [], messages: [:])
        for row in chained {
            guard let card = row.card, let requestId = card.requestId, card.answered == nil else { continue }
            let item = WaitingItem(id: requestId, kind: card.questionRequest != nil ? "question" : "approval", botId: botId,
                                   botName: bot.name, threadId: thread, messageId: row.id, at: row.at)
            payload.waiting.append(item)
            payload.messages[item.key] = row
        }
        return (chained, payload)
    }
}
#endif

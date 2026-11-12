// #4066: a bot's chat holding the routine run rows the desktop chat draws
// and the ones it leaves to the routine's run log (shared/routine-repeat.ts
// `routineRunRowOutOfChat`), for the captures of the phone's filter and of
// a streak's wording. DEBUG only, with the store preview:
// `-store-preview -routine-rows-preview -previewOpenBot reviewer`.
// Every name and text is synthetic. Not shipped.
#if DEBUG
import CompanionCore
import Foundation

enum RoutineRowsPreview {
    static let botId = "reviewer"
    static let threadId = "reviewer-thread"

    static func fleet(in arguments: [String], french: Bool) -> Fleet? {
        guard arguments.contains("-routine-rows-preview") else { return nil }
        func say(_ en: String, _ fr: String) -> String { french ? fr : en }
        let now = (Date().timeIntervalSince1970 * 1000).rounded()
        let start = now - 6 * 3_600_000
        func run(_ id: String, _ at: Double, _ fields: [String: Any]) -> [String: Any] {
            var card: [String: Any] = [
                "runId": "run-\(id)", "routineId": "inbox", "routineName": say("Inbox watch", "Veille de la boîte"),
                "status": "completed", "scheduledFor": at,
            ]
            card.merge(fields) { _, new in new }
            return ["id": id, "role": "bot", "kind": "routine.run", "at": at, "routineRun": card]
        }
        var rows: [[String: Any]] = [
            ["id": "u", "role": "user", "kind": "text", "at": start, "text": say("Watch my inbox and tell me what matters.", "Surveille ma boîte et dis-moi ce qui compte.")],
            ["id": "a", "role": "bot", "kind": "text", "at": start + 2_000, "turnId": "t0", "turnTerminal": true,
             "text": say("Done: I check it every hour.", "C'est fait : je la regarde chaque heure.")],
            // a result the person set the routine to post: drawn
            run("r-result", start + 3_600_000, ["summary": say("Two new requests from the supplier, both answered.", "Deux nouvelles demandes du fournisseur, les deux répondues.")]),
            // only how it went (with problems): the run log keeps it
            run("r-problems", start + 7_200_000, ["summary": say("Checked the inbox.", "Boîte vérifiée."), "problems": say("The mail server did not answer twice.", "Le serveur de courriel n'a pas répondu deux fois.")]),
            // a wake that had nothing for the person: the run log keeps it
            run("r-wake", start + 9_000_000, ["wakeTopic": "mail", "summary": say("Nothing for you in this mail.", "Rien pour toi dans ce courriel.")]),
            // a run the person started, in a streak of different problems
            run("r-streak", start + 10_800_000, [
                "startedBy": "person", "summary": say("Checked the inbox.", "Boîte vérifiée."),
                "problems": say("The calendar could not be read.", "L'agenda n'a pas pu être lu."),
                "repeat": ["firstRunId": "run-r-problems", "count": 3, "since": start + 7_200_000, "lastAt": start + 10_800_000, "anyProblem": true],
            ]),
            // a streak's summary whose run failed: the card, with its count
            run("r-streak-failed", start + 12_600_000, [
                "routineId": "backup", "routineName": say("Backup check", "Vérification des sauvegardes"), "status": "failed",
                "error": say("The backup server refused the sign-in.", "Le serveur de sauvegarde a refusé la connexion."),
                "repeat": ["firstRunId": "run-b1", "count": 4, "since": start + 1_800_000, "lastAt": start + 12_600_000, "streak": true],
            ]),
            // a streak's summary whose run was blocked: the card, with its count
            run("r-streak-blocked", start + 14_400_000, [
                "routineId": "invoices", "routineName": say("Invoice review", "Revue des factures"), "status": "blocked",
                "error": say("Blocked: the billing connector is not set up.", "Bloqué : le connecteur de facturation n'est pas configuré."),
                "repeat": ["firstRunId": "run-i1", "count": 3, "since": start + 3_600_000, "lastAt": start + 14_400_000, "streak": true],
            ]),
        ]
        for index in rows.indices { rows[index]["parentId"] = index > 0 ? rows[index - 1]["id"]! : NSNull() }
        let task: [String: Any] = ["threadId": threadId, "title": "Reviewer", "createdAt": start - 3_600_000, "busy": false]
        let bot: [String: Any] = [
            "id": botId, "threadId": threadId, "name": "Reviewer", "title": "", "description": "",
            "notifications": true, "color": "purple", "unread": false,
            "modelSelection": ["instanceId": "preview", "model": "m"], "createdAt": start - 3_600_000,
            "busy": false, "activity": "idle",
            "tasks": [task], "messages": rows, "activeLeafId": rows.last?["id"] ?? NSNull(),
        ]
        let json: [String: Any] = ["bots": [bot], "groups": [], "botQueuedMessages": [:], "sections": []]
        guard let data = try? JSONSerialization.data(withJSONObject: json) else { return nil }
        return try? JSONDecoder().decode(Fleet.self, from: data)
    }
}
#endif

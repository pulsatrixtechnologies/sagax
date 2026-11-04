// Search in Edit bot (2026-10-29), the phone's twin of the desktop box under
// "Edit bot": a word leads to the rows of the tree that hold it, in French or
// English, accents and case ignored. The rows are the ones `BotEditTree`
// draws in this context, so a row the bot's pairing does not reach is never
// offered.
import Foundation

public enum BotEditSearch {
    /// Words each row answers to, beyond its label (an index, not copy).
    static let words: [BotEditItem: [String]] = [
        .identity: ["identité", "identity", "nom", "name", "description", "rôle", "role", "propriétaire"],
        .name: ["nom", "name"],
        .role: ["rôle", "role", "titre", "title", "étiquette"],
        .botDescription: ["description"],
        .avatar: ["avatar", "mascotte", "mascot", "apparence", "appearance", "photo", "image", "couleur", "personnage"],
        .callVoice: ["voix", "voice", "appel", "call", "parler"],
        .callSpeed: ["vitesse", "speed", "débit"],
        .callLanguage: ["langue", "language"],
        // More voice options (lot 3): spoken replies, notes, preview.
        // Notifications live on the bot profile only. Leave "moteur"/"engine"
        // to the Model row.
        .voiceAlerts: ["voix", "voice", "alertes", "alerts", "aperçu", "preview", "notes vocales", "voice notes", "lire à voix haute", "read aloud", "elevenlabs", "fish audio"],
        .personality: ["personnalité", "personality", "instructions", "ton", "style", "règles", "rules"],
        .soul: ["âme", "soul", "personnalité", "instructions", "ton", "règles", "rules", "consignes"],
        .skills: ["compétences", "habiletés", "skills", "procédures", "apprendre"],
        .memory: ["mémoire", "memory", "dossier", "folder", "fichiers", "files", "notes", "souvenirs"],
        .model: ["modèle", "model", "moteur", "engine", "fournisseur", "provider", "effort", "raisonnement", "claude", "codex", "grok", "auto"],
        .approvals: ["approbation", "approbations", "approvals", "approval", "approuver", "permissions", "mode auto", "auto mode", "révision", "pairs", "peers", "horaire", "routines"],
        .toolsApps: ["outils", "tools", "applications", "apps", "mcp", "navigateur", "browser", "ordinateur", "computer"],
        .computer: ["zone de travail", "espace de travail", "workspace", "ordinateur", "computer", "machine virtuelle", "vm", "navigateur", "browser", "nuage", "cloud"],
        .access: ["accès", "access", "mcp", "outils", "tools", "webhooks", "autoriser", "allow", "exclure", "exclude", "horaire", "schedule"],
        .slack: ["slack", "messages directs", "mentions"],
        .routines: ["routines", "horaire", "schedule", "planifié", "cron", "tâches"],
        .sharing: ["partage", "sharing", "partager", "share", "équipe", "team", "personnes", "people"],
        .sharedWith: ["partagé avec", "shared with", "partage", "équipe", "team", "personnes", "people", "droits", "niveau"],
        .whoCanSee: ["qui peut le voir", "who can see it", "visibilité", "visibility", "privé", "private", "administrateurs", "admins"],
        .advanced: ["avancé", "advanced", "utilisation", "usage", "changements", "changes", "résumé", "ce qu'il fait"],
        .overview: ["résumé", "overview", "ce qu'il fait", "what it does", "aperçu", "prompt", "invite"],
        .usage: ["utilisation", "usage", "jetons", "tokens", "coût", "cost", "facturation", "billing"],
        .changes: ["changements", "changes", "historique", "history", "annuler", "undo", "restaurer", "journal"],
    ]

    /// Accents and case folded, inner space collapsed: "Modèle" and "modele" meet.
    public static func fold(_ text: String) -> String {
        text.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil)
            .lowercased()
            .split(whereSeparator: \.isWhitespace)
            .joined(separator: " ")
    }

    /// The rows `query` leads to, best first (the label, then the index), with
    /// the rows of the tree they sit under. `label` is the row's name in the
    /// language shown. Archive and Delete are never results. An empty query
    /// returns nothing: the screen shows the tree.
    public static func results(
        _ query: String,
        context: BotEditContext,
        label: (BotEditItem) -> String
    ) -> [BotEditItem] {
        let q = fold(query)
        guard !q.isEmpty else { return [] }
        var ranked: [(item: BotEditItem, rank: Int, order: Int)] = []
        var seen = Set<BotEditItem>()
        for (order, entry) in BotEditTree.reachable(context).enumerated() {
            let item = entry.item
            if item == .header || item.destructive || !seen.insert(item).inserted { continue }
            if fold(label(item)).contains(q) {
                ranked.append((item, 0, order))
            } else if (words[item] ?? []).contains(where: { fold($0).contains(q) }) {
                ranked.append((item, 1, order))
            }
        }
        return ranked.sorted { ($0.rank, $0.order) < ($1.rank, $1.order) }.map(\.item)
    }
}

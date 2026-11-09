import Foundation

/// What the bot overview slot shows (iPad Overview and Personality pages,
/// the iPhone "What it does" summary), as the desktop `BotProfilePage`:
/// the overview, or nothing at all when this pairing has none to read.
/// Only a real failure says so; a refusal never reads as an error.
public enum BotOverviewLoad: Equatable, Sendable {
    case loading
    case loaded(BotOverview)
    /// The computer has no overview for this pairing (403 owner only, 404
    /// an older computer or a bot it does not hold) or there is no
    /// computer: the section is hidden, never greyed, never an error.
    case hidden
    /// Reached the computer and it failed: worth saying.
    case failed

    public init(error: Error) {
        if case let APIError.status(code, _) = error, code == 403 || code == 404 {
            self = .hidden
        } else {
            self = .failed
        }
    }

    public var overview: BotOverview? {
        if case let .loaded(overview) = self { return overview }
        return nil
    }
}

extension BotOverview {
    /// The overview built from what the phone already holds, for the demo
    /// and the store preview (no computer to ask). The same sentences the
    /// computer writes (`server/bots/bot-overview.ts`), kept short.
    public static func local(bot: Bot, routines: [Routine], language: DemoLanguage) -> BotOverview {
        let t = language.pick
        let does = routines.filter { $0.botId == bot.id }.map { routine -> String in
            guard routine.enabled else { return t("Paused: \(routine.name).", "En pause : \(routine.name).") }
            let days = routine.schedule.weekdays ?? Array(0...6)
            if routine.schedule.type == .daily, let time = routine.schedule.time {
                return days.count == 7
                    ? t("Every day at \(time): \(routine.name).", "Chaque jour à \(time) : \(routine.name).")
                    : t("Some days at \(time): \(routine.name).", "Certains jours à \(time) : \(routine.name).")
            }
            return t("On a schedule: \(routine.name).", "Selon un horaire : \(routine.name).")
        }
        var wont: [String] = []
        if !routines.contains(where: { $0.botId == bot.id && $0.enabled }) {
            wont.append(t("Won't act on a schedule.", "N'agit pas selon un horaire."))
        }
        wont.append(t("Profile proposal cards require your approval.", "Les cartes de proposition de profil demandent ton approbation."))
        return BotOverview(
            who: BotOverviewWho(name: bot.name, title: bot.title, blurb: bot.description, soulLead: ""),
            does: does,
            reaches: [t("Works in its private workspace.", "Travaille dans son espace privé.")],
            wont: wont,
            recent: []
        )
    }
}

// Why the bot's model waits for a turn (desktop `modelTurnLock`,
// bot-settings/ModelSection.tsx): only the viewer's selected thread counts,
// as the server checks it. A turn waiting on the person is an approval,
// one waiting on an admin only (every open card is an admin's) is admin;
// any other busy turn is working.
import Foundation

public enum ModelTurnLock: String, Sendable, Equatable {
    case working
    case approval
    case admin

    /// Nil when the model can change now.
    public static func of(_ bot: Bot) -> ModelTurnLock? {
        let task = bot.tasks?.first { $0.threadId == bot.threadId }
        guard (task?.busy ?? bot.busy) == true else { return nil }
        guard (task?.activity ?? bot.activity) == "waiting-on-you" else { return .working }
        let open = ApprovalDockRules.pendingApprovals(bot.messages ?? [])
        return !open.isEmpty && open.allSatisfy { $0.card.adminApproval == true } ? .admin : .approval
    }
}

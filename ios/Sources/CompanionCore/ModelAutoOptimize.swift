// #2106: Auto's Edit preference in the chat-bar model picker (Cursor-like).
// Intelligence / Balance / Cost. Absent on a selection means Balance.
// Matches shared/model-auto-optimize.ts.
import Foundation

public enum ModelAutoOptimize: String, Codable, Hashable, Sendable, CaseIterable {
    case intelligence
    case balance
    case cost

    /// The preference Auto uses when none is stored.
    public static func of(_ value: String?) -> ModelAutoOptimize {
        value.flatMap(ModelAutoOptimize.init(rawValue:)) ?? .balance
    }

    public var labelKey: String {
        switch self {
        case .intelligence: "Intelligence"
        case .balance: "Balance"
        case .cost: "Cost"
        }
    }
}

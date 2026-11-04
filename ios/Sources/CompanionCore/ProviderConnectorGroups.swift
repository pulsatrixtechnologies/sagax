// Capabilities > Installed > Providers (src/components/plugins/
// HarnessConnectorGroups.tsx `connectorGroups`, AccountsView.tsx
// `accountServices`): Claude and Grok always have their section (their
// connectors, or why there are none and how to connect), ChatGPT when the
// server lists its connectors; the pills are All and each engine, only
// when there are two or more.
import Foundation

public enum ProviderEngine: String, CaseIterable, Hashable, Sendable {
    case claude, grok, codex
}

/// Why a section lists no connector (`HarnessGroupNotice`).
public enum ProviderGroupNotice: Hashable, Sendable {
    case loading, empty, noAccount
    /// managed_policy, no_engine, not_signed_in, not_operator, key, unknown
    case unavailable(String)

    /// What the notice offers (`noticeAction`).
    public enum Action: Hashable, Sendable { case setup, retry, manage }

    public var action: Action? {
        switch self {
        case .loading: nil
        case .empty: .manage
        case .noAccount: .setup
        case let .unavailable(reason):
            switch reason {
            case "no_engine", "not_signed_in", "key": .setup
            case "unknown": .retry
            default: nil
            }
        }
    }
}

public struct ProviderConnector: Hashable, Sendable, Identifiable {
    public var name: String
    /// A Grok connector's id; nil for the others.
    public var grokId: String?
    /// connected, needs_auth, failed, unknown; nil: managed on the engine's site.
    public var status: String?
    public var id: String { grokId ?? name }

    public init(name: String, grokId: String? = nil, status: String? = nil) {
        self.name = name
        self.grokId = grokId
        self.status = status
    }
}

public struct ProviderConnectorGroup: Hashable, Sendable, Identifiable {
    public var engine: ProviderEngine
    public var name: String
    public var manageUrl: String
    public var connectors: [ProviderConnector]
    public var notice: ProviderGroupNotice?
    public var id: ProviderEngine { engine }
}

public enum ProviderConnectorGroups {
    public static let grokConnectorsUrl = "https://grok.com/connectors"

    /// `GROK_CLOUD_CONNECTORS` (shared/grok-cloud-connectors.ts).
    public static let grokCloudConnectors: [(id: String, name: String)] = [
        ("outlook", "Outlook (Exchange)"), ("microsoft-teams", "Microsoft Teams"), ("x", "X"), ("gmail", "Gmail"),
        ("google-drive", "Google Drive"), ("onedrive", "OneDrive"), ("sharepoint", "SharePoint"), ("salesforce", "Salesforce"),
    ]

    /// `grokProviderConfigured`: an available grokAgent or grok engine.
    public static func grokConfigured(_ instances: [Instance]) -> Bool {
        instances.contains { ["grokAgent", "grok"].contains($0.driverKind) && $0.snapshot.state == "available" }
    }

    public static func groups(claude answer: HarnessConnectorsAnswer?, claudeLoading: Bool, grokConfigured: Bool) -> [ProviderConnectorGroup] {
        var groups: [ProviderConnectorGroup] = []
        let claudeUrl = answer?.manageLink.absoluteString ?? "https://claude.ai/customize/connectors"
        let claude = answer?.claude
        let connectors = claude?.available == true ? claude!.connectors.filter { !$0.name.trimmingCharacters(in: .whitespaces).isEmpty } : []
        let notice: ProviderGroupNotice?
        if !connectors.isEmpty { notice = nil }
        else if claude == nil { notice = claudeLoading ? .loading : .unavailable("unknown") }
        else if claude!.available { notice = .empty }
        else { notice = .unavailable(claude!.reason ?? "unknown") }
        groups.append(ProviderConnectorGroup(engine: .claude, name: "Claude", manageUrl: claudeUrl,
                                             connectors: connectors.map { ProviderConnector(name: $0.name, status: $0.status) }, notice: notice))
        if grokConfigured {
            groups.append(ProviderConnectorGroup(engine: .grok, name: "Grok", manageUrl: grokConnectorsUrl,
                                                 connectors: grokCloudConnectors.map { ProviderConnector(name: $0.name, grokId: $0.id) }, notice: nil))
        } else {
            groups.append(ProviderConnectorGroup(engine: .grok, name: "Grok", manageUrl: grokConnectorsUrl, connectors: [], notice: .noAccount))
        }
        return groups
    }

    /// `accountServices`: All and each engine, with the person's own servers
    /// last; fewer than two, no pills.
    public static func services(_ groups: [ProviderConnectorGroup], servers: Bool) -> [String] {
        let services = groups.map(\.engine.rawValue) + (servers ? ["servers"] : [])
        return services.count >= 2 ? ["all"] + services : []
    }
}
